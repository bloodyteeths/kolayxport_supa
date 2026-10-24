// components/domain/bulk/useBulkAi.ts — bulk-grid §7 "Improve with AI" (M7-D).
//
// Runs `/api/ai/etsy` `bulk_optimize` (existing action, import-only use) over the grid rows the seller picked and
// hands every usable result to the grid as ordinary cell edits: `onCellsChange(patches, 'ai')` (BulkGrid contract,
// bulk-grid §5.1). From there M7-C's staging queue writes them into the listing's DRAFT like any typed edit, so an
// AI suggestion never goes live without the explicit "Send N changes" (founder decision: staged drafts). This hook
// never stages, never syncs and never calls a marketplace mutation itself.
//
// Cost: tiers.md AI_ACTION_COST prices `bulk_optimize` at 1 AI credit per listing. NOTE: `/api/ai/etsy` does NOT meter
// credits today (only a 30 requests / minute rate limit; no 402 path), so the `limited` branch below is forward-
// compatible handling for the billing track's metering, not live behaviour (outOfScopeNeeds: AI credit metering).
// When a 402 does arrive it stops new chunks, keeps the suggestions already applied (including answers already in
// flight on the other lane), and flips `limited` so the page renders the C6 inline Banner on this action only
// (every request carries LIMIT_UI_HEADER: 'inline', so the global limit dialog stays closed).
//
// Late answers never overwrite the seller: before a chunk's patches are applied, each target cell's CURRENT value
// (`getCurrent`) is compared with the value that was sent; a cell the seller changed meanwhile is skipped.
//
// Guards (feedback_ai_response_safety): coerceAiString / decodeEntities / normalizeTitle / looksGarbled for titles
// (and the 140-char Etsy limit), normalizeTags (13 × 20, no title-word overlap) for tags. A result that fails the
// guards leaves the cell untouched and is counted in `unusable` ("2 listings didn't get a usable suggestion").
// Raw model or server text is never shown: only i18n keys.
//
// eBay lane (legacy EbayListingsLegacy `handleAIBulkOptimize`): `/api/clawd/ebay-ai?action=bulk_optimize_titles`
// (existing action, ≤ 10 listings per request, title only). Titles are guarded with `guardEbayTitle` (entity-decoded,
// not garbled, ≤ 80 characters; Etsy's house style is NOT applied). Same staging path: suggestions are cell edits.
import { TEXT_AI_CREDITS } from '@/lib/billing/aiCredits';
import { useAiCostsVisible } from '@/components/domain/credits/useCredits';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  TITLE_MAX,
  aiErrorCode,
  coerceAiString,
  coerceAiStringArray,
  looksGarbled,
  normalizeTags,
  normalizeTitle,
  type AiErrorCode,
} from '@/lib/etsy/seoRules';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';

// ── Types ────────────────────────────────────────────────────────────────────────────────────────

/** The listing fields AI improves in the grid (description is not a grid column, bulk-grid §3.1). */
export type BulkAiField = 'title' | 'tags';
export const BULK_AI_FIELDS: readonly BulkAiField[] = ['title', 'tags'];

/** Marketplaces with a bulk AI action. Others: `supported === false` (the bar action is not rendered). */
export type BulkAiMarketplace = 'etsy' | 'ebay';
export function bulkAiSupported(marketplace: string): marketplace is BulkAiMarketplace {
  return marketplace === 'etsy' || marketplace === 'ebay';
}

/** Fields each marketplace's AI action can improve (eBay `bulk_optimize_titles` returns titles only). */
export const BULK_AI_MARKETPLACE_FIELDS: Readonly<Record<BulkAiMarketplace, readonly BulkAiField[]>> = {
  etsy: ['title', 'tags'],
  ebay: ['title'],
};

/** Listings per request each endpoint accepts. */
export const BULK_AI_MAX_CHUNK: Readonly<Record<BulkAiMarketplace, number>> = { etsy: 20, ebay: 10 };

/** eBay title limit (Inventory API `product.title`). */
export const EBAY_AI_TITLE_MAX = 80;

/** What the hook needs per grid row: the CURRENT (draft-overlaid) values the seller sees in the grid. */
export interface BulkAiRow {
  /** BulkGrid row id (`getRowId`). */
  rowId: string;
  /** Marketplace listing id sent to the AI endpoint and matched on the way back. */
  listingId: string | number;
  title: string;
  tags: readonly string[];
  /** Context only (trimmed server-side to 400 chars); never rewritten here. */
  description?: string;
  /** Category path / name, context only. */
  category?: string;
}

/** Same shape as `BulkGridProps.onCellsChange` patches (bulk-grid §5.1). */
export interface BulkAiPatch {
  rowId: string;
  field: string;
  value: unknown;
}

export interface UseBulkAiOptions {
  marketplace: string;
  /** BulkGrid edit sink. Called once per AI response chunk with origin 'ai'. */
  onCellsChange(patches: BulkAiPatch[], origin: 'ai'): void;
  /** Grid staging field key per AI field (default: identity, i.e. 'title' and 'tags'). */
  fieldKeys?: Partial<Record<BulkAiField, string>>;
  /**
   * Per-cell guard from the grid (e.g. rows `syncing`, read-only reasons). A proposal for a cell that returns false
   * is dropped and counted in `skipped`. Default: every cell editable.
   */
  canEdit?(rowId: string, field: string): boolean;
  /**
   * The cell's current (draft-overlaid) value at apply time. When it no longer equals the value sent with the
   * request (the seller typed, pasted or reverted while the chunk was in flight), the proposal is dropped and
   * counted in `skippedCells`. Return undefined when the value is unknown (treated as unchanged). Default: none.
   */
  getCurrent?(rowId: string, field: string): unknown;
  /** Optional seller instructions forwarded to the prompt (server sanitizes). */
  instructions?: string;
  /** Listings per request; the API accepts at most 20. */
  chunkSize?: number;
  /** Requests in flight (default 2; the AI route allows 30 requests / minute per user). */
  concurrency?: number;
  /** Test seam. */
  fetcher?: typeof fetch;
}

export type BulkAiStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'limited' | 'error';

export interface BulkAiSummary {
  status: Exclude<BulkAiStatus, 'idle' | 'running'>;
  /** Listings asked for. */
  total: number;
  /** Listings answered (usable, unusable or unchanged); `done` in the progress meta. */
  processed: number;
  /** Listings that got at least one new suggestion applied as a cell edit. */
  improved: number;
  /** Listings whose result failed the guards or was missing from the response. */
  unusable: number;
  /** Listings where every suggestion equalled the current value (nothing written). */
  unchanged: number;
  /** Cells dropped because the grid reported them read-only, or the seller changed them while the run was going. */
  skippedCells: number;
  /** Listings in a request that failed (network / server), not counting 402 or cancel. */
  failed: number;
  /** Cell edits emitted through onCellsChange. */
  edits: number;
  /** i18n key (full path) of the last request error, if any. */
  errorKey: string | null;
}

export interface UseBulkAi {
  supported: boolean;
  status: BulkAiStatus;
  running: boolean;
  progress: { done: number; total: number };
  /** Last finished run (null before the first). */
  summary: BulkAiSummary | null;
  /** Credits ran out (402) during this session: disable the action and show the C6 inline Banner. */
  limited: boolean;
  /** Start a run over these rows (de-duplicated by rowId). Resolves with the summary; a second start while running
   *  resolves with null and does nothing. */
  start(rows: readonly BulkAiRow[], fields?: readonly BulkAiField[]): Promise<BulkAiSummary | null>;
  /** Cancel: in-flight responses are discarded (their credits are already spent server-side); applied edits stay. */
  cancel(): void;
  /** True when this cell currently shows an AI proposal: the cell's current value still equals the suggestion AND the
   *  cell is still an unsent draft edit. `currentValue` undefined → false. Pass `dirty` (the grid's dirty set) so a
   *  sent cell (value now live, nothing left to revert) loses the marker. */
  isProposal(rowId: string, field: string, currentValue?: unknown, dirty?: boolean): boolean;
  /** Drop proposal markers (field undefined = the whole row), e.g. after Revert cell / row or a successful send. */
  forget(cells: readonly { rowId: string; field?: string }[]): void;
  /** Drop every proposal marker. */
  forgetAll(): void;
  /** Number of cells currently marked as AI proposals. */
  proposalCount: number;
  /** "12 credits" (bulk.ai.cost), for the bar action tooltip "· 12 credits". */
  costLabel(listings: number): string;
  /** "Improving 7 / 12…" while running, else null (header meta). */
  metaLabel: string | null;
  /** Result line for a toast/Banner after a run, or null when there is nothing to say. */
  resultLabel: string | null;
  /** C6 inline Banner text when `limited`. */
  limitLabel: string | null;
  /** Bulk bar action label "Improve with AI" and the cancel button label "Stop". */
  actionLabel: string;
  cancelLabel: string;
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────────────────────────

/** 1 credit per listing (tiers.md `bulk_optimize`). */
/** Credits a bulk text run spends: none. Text AI is plan-included (lib/billing/aiCredits.ts meters image/video only). */
export function bulkAiCredits(listings: number): number {
  return TEXT_AI_CREDITS * Math.max(0, Math.floor(listings));
}

export function chunkRows<T>(rows: readonly T[], size: number, max = 20): T[][] {
  const n = Math.max(1, Math.min(max, Math.floor(size) || max));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

/** Title guard: entity-decoded, house style, not garbled, within Etsy's 140. Returns '' when unusable. */
export function guardTitle(raw: unknown): string {
  const coerced = coerceAiString(raw);
  if (!coerced) return '';
  const t = normalizeTitle(decodeEntities(coerced));
  if (!t || t.length > TITLE_MAX || looksGarbled(t)) return '';
  return t;
}

/** eBay title guard: entity-decoded, whitespace collapsed, not garbled, within eBay's 80. Returns '' when unusable. */
export function guardEbayTitle(raw: unknown): string {
  const coerced = coerceAiString(raw);
  if (!coerced) return '';
  const t = decodeEntities(coerced).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > EBAY_AI_TITLE_MAX) return '';
  // eBay titles keep separators ("Lamp - Brass | Gold"); stand-alone punctuation is not a garbled word.
  const words = t.replace(/(^|\s)[^\p{L}\p{N}\s]+(?=\s|$)/gu, '$1').replace(/\s+/g, ' ').trim();
  if (!words || looksGarbled(words)) return '';
  return t;
}

/**
 * eBay `bulk_optimize_titles` answer → the item shape `resolveRow` reads (`{ listing_id, title }`). Pure; anything
 * that is not `{ results: [{ id, optimized }] }` yields no items (every row then counts as unusable).
 */
export function ebayAiItems(body: unknown): Array<{ listing_id: string; title: unknown }> {
  const results = body && typeof body === 'object' ? (body as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) return [];
  const out: Array<{ listing_id: string; title: unknown }> = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const id = (r as { id?: unknown }).id;
    if (id === undefined || id === null || id === '') continue;
    out.push({ listing_id: String(id), title: (r as { optimized?: unknown }).optimized });
  }
  return out;
}

/** Tags guard against the title the listing will have. Returns [] when unusable. */
export function guardTags(raw: unknown, title: string): string[] {
  const list = coerceAiStringArray(raw).map((s) => decodeEntities(s));
  if (list.length === 0) return [];
  return normalizeTags(list, { title, dropTitleOverlap: true }).tags;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].trim().toLowerCase() !== b[i].trim().toLowerCase()) return false;
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export interface ResolvedRow {
  patches: BulkAiPatch[];
  outcome: 'improved' | 'unusable' | 'unchanged';
  skippedCells: number;
}

/**
 * Turns one AI item into grid patches for one row. Pure. `item` may be anything the model produced.
 * - title: guarded; equal to the current title → no patch.
 * - tags: guarded against the NEW title when one was accepted, else the current title; equal → no patch.
 * - read-only cells (canEdit false) are dropped and counted.
 */
export function resolveRow(
  row: BulkAiRow,
  item: unknown,
  fields: readonly BulkAiField[],
  keys: Record<BulkAiField, string>,
  canEdit: (rowId: string, field: string) => boolean,
  titleGuard: (raw: unknown) => string = guardTitle,
): ResolvedRow {
  const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
  if (!obj) return { patches: [], outcome: 'unusable', skippedCells: 0 };
  const patches: BulkAiPatch[] = [];
  let usable = 0;
  let skippedCells = 0;
  const currentTitle = decodeEntities(row.title ?? '');
  let finalTitle = currentTitle;

  if (fields.includes('title')) {
    const t = titleGuard(obj.title);
    if (t) {
      usable++;
      if (t !== currentTitle) {
        if (canEdit(row.rowId, keys.title)) {
          patches.push({ rowId: row.rowId, field: keys.title, value: t });
          finalTitle = t;
        } else skippedCells++;
      }
    }
  }
  if (fields.includes('tags')) {
    const tags = guardTags(obj.tags, finalTitle);
    if (tags.length > 0) {
      usable++;
      if (!sameTags(tags, row.tags ?? [])) {
        if (canEdit(row.rowId, keys.tags)) patches.push({ rowId: row.rowId, field: keys.tags, value: tags });
        else skippedCells++;
      }
    }
  }
  if (usable === 0) return { patches: [], outcome: 'unusable', skippedCells };
  return { patches, outcome: patches.length > 0 ? 'improved' : 'unchanged', skippedCells };
}

/** i18n key (full path) for a failed request; null for 402 (handled as `limited`). */
export function errorKeyFor(status: number, body: unknown): string | null {
  if (status === 402) return null;
  const code: AiErrorCode | null = aiErrorCode(body);
  if (code && code !== 'invalid_ai_response' && !code.endsWith('_failed')) return `etsy.aiErrors.${code}`;
  if (status === 429) return 'etsy.aiErrors.rate_limited';
  if (status === 401) return 'etsy.aiErrors.unauthorized';
  return 'bulk.ai.failed';
}

/** Statuses that stop the whole run (retrying the next chunk would fail the same way). */
function isFatal(status: number, body: unknown): boolean {
  if (status === 401 || status === 402 || status === 429) return true;
  const code = aiErrorCode(body);
  return code === 'ai_not_configured' || code === 'rate_limited' || code === 'unauthorized';
}

// ── Hook ─────────────────────────────────────────────────────────────────────────────────────────

const key = (rowId: string, field: string) => `${rowId}\u0000${field}`;

export function useBulkAi(options: UseBulkAiOptions): UseBulkAi {
  const t = useTranslations();
  // No credit costs for Shopify-connected accounts (App Store 1.2.1).
  const showCosts = useAiCostsVisible();
  const opts = useRef(options);
  opts.current = options;

  const supported = bulkAiSupported(options.marketplace);
  const [status, setStatus] = useState<BulkAiStatus>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<BulkAiSummary | null>(null);
  const [limited, setLimited] = useState(false);
  const [proposals, setProposals] = useState<Map<string, unknown>>(() => new Map());

  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(
    async (rowsIn: readonly BulkAiRow[], fieldsIn?: readonly BulkAiField[]): Promise<BulkAiSummary | null> => {
      if (runningRef.current) return null;
      const o = opts.current;
      if (!bulkAiSupported(o.marketplace)) return null;
      const mp: BulkAiMarketplace = o.marketplace;
      const allowed = BULK_AI_MARKETPLACE_FIELDS[mp];
      const fields = (fieldsIn && fieldsIn.length ? fieldsIn : allowed).filter((f) => allowed.includes(f));
      const titleGuard = mp === 'ebay' ? guardEbayTitle : guardTitle;
      const seen = new Set<string>();
      const rows = rowsIn.filter((r) => r && !seen.has(r.rowId) && (seen.add(r.rowId), true));
      if (rows.length === 0 || fields.length === 0) return null;

      const keys: Record<BulkAiField, string> = { title: o.fieldKeys?.title ?? 'title', tags: o.fieldKeys?.tags ?? 'tags' };
      const canEdit = (rowId: string, field: string) => (opts.current.canEdit ? opts.current.canEdit(rowId, field) : true);
      const changedSinceSent = (row: BulkAiRow, field: string): boolean => {
        const get = opts.current.getCurrent;
        if (!get) return false;
        const now = get(row.rowId, field);
        if (now === undefined) return false;
        if (field === keys.title) return typeof now !== 'string' || now !== (row.title ?? '');
        if (field === keys.tags) return !Array.isArray(now) || !sameTags(now.map(String), row.tags ?? []);
        return false;
      };
      const f = o.fetcher ?? fetch;
      const controller = new AbortController();
      abortRef.current = controller;
      runningRef.current = true;

      const s: BulkAiSummary = {
        status: 'done', total: rows.length, processed: 0, improved: 0, unusable: 0, unchanged: 0,
        skippedCells: 0, failed: 0, edits: 0, errorKey: null,
      };
      const run: { stop: 'limited' | 'error' | null } = { stop: null };
      setStatus('running');
      setProgress({ done: 0, total: rows.length });

      const chunks = chunkRows(rows, o.chunkSize ?? BULK_AI_MAX_CHUNK[mp], BULK_AI_MAX_CHUNK[mp]);
      let next = 0;

      const runChunk = async (chunk: BulkAiRow[]) => {
        let res: Response;
        let body: unknown = null;
        try {
          const init: RequestInit = {
            method: 'POST',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
          };
          res =
            mp === 'ebay'
              ? await f('/api/clawd/ebay-ai?action=bulk_optimize_titles', {
                  ...init,
                  body: JSON.stringify({
                    listings: chunk.map((r) => ({
                      id: String(r.listingId),
                      title: decodeEntities(r.title ?? ''),
                      ...(r.category ? { categoryName: r.category } : {}),
                    })),
                  }),
                })
              : await f('/api/ai/etsy', {
                  ...init,
                  body: JSON.stringify({
                    action: 'bulk_optimize',
                    fields,
                    ...(o.instructions ? { instructions: o.instructions } : {}),
                    listings: chunk.map((r) => ({
                      listing_id: r.listingId,
                      title: decodeEntities(r.title ?? ''),
                      tags: [...(r.tags ?? [])],
                      description: r.description ?? '',
                      category: r.category ?? '',
                    })),
                  }),
                });
          body = await res.json().catch(() => null);
        } catch {
          if (controller.signal.aborted) return;
          s.failed += chunk.length;
          s.errorKey = 'bulk.ai.failed';
          return;
        }
        // Only a cancel / unmount discards an answer. A lane that stopped the run (402 / 401 / 429) only stops NEW
        // chunks: an answer already in flight on the other lane is paid for and still applied and counted.
        if (controller.signal.aborted) return;

        if (!res.ok) {
          if (res.status === 402) {
            run.stop = 'limited';
            if (mounted.current) setLimited(true);
            return;
          }
          if (res.status === 502 && aiErrorCode(body) === 'invalid_ai_response') {
            s.unusable += chunk.length;
            s.processed += chunk.length;
            if (mounted.current) setProgress({ done: s.processed, total: s.total });
            return;
          }
          s.errorKey = errorKeyFor(res.status, body);
          if (isFatal(res.status, body)) { run.stop = 'error'; return; }
          s.failed += chunk.length;
          return;
        }

        const items: unknown[] =
          mp === 'ebay'
            ? ebayAiItems(body)
            : body && typeof body === 'object' && Array.isArray((body as { optimized?: unknown }).optimized)
              ? (body as { optimized: unknown[] }).optimized
              : [];
        const byId = new Map<string, unknown>();
        for (const it of items) {
          if (!it || typeof it !== 'object') continue;
          const id = String((it as { listing_id?: unknown }).listing_id ?? '');
          if (id && !byId.has(id)) byId.set(id, it);
        }
        const patches: BulkAiPatch[] = [];
        for (const row of chunk) {
          // A cell the seller changed while this chunk was in flight is not editable for the AI any more.
          const editable = (rowId: string, field: string) => canEdit(rowId, field) && !changedSinceSent(row, field);
          const r = resolveRow(row, byId.get(String(row.listingId)), fields, keys, editable, titleGuard);
          s.skippedCells += r.skippedCells;
          s[r.outcome] += 1;
          patches.push(...r.patches);
        }
        s.processed += chunk.length;
        if (patches.length > 0) {
          s.edits += patches.length;
          opts.current.onCellsChange(patches, 'ai');
          if (mounted.current) {
            setProposals((prev) => {
              const m = new Map(prev);
              for (const p of patches) m.set(key(p.rowId, p.field), p.value);
              return m;
            });
          }
        }
        if (mounted.current) setProgress({ done: s.processed, total: s.total });
      };

      const worker = async () => {
        while (!controller.signal.aborted && !run.stop && next < chunks.length) {
          const chunk = chunks[next++];
          await runChunk(chunk);
        }
      };
      const lanes = Math.max(1, Math.min(o.concurrency ?? 2, chunks.length));
      try {
        await Promise.all(Array.from({ length: lanes }, () => worker()));
      } finally {
        runningRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }

      s.status = controller.signal.aborted ? 'cancelled' : run.stop === 'limited' ? 'limited' : run.stop === 'error' ? 'error' : 'done';
      if (mounted.current) {
        setStatus(s.status);
        setSummary({ ...s });
      }
      return { ...s };
    },
    [],
  );

  const isProposal = useCallback(
    (rowId: string, field: string, currentValue?: unknown, dirty?: boolean) => {
      const k = key(rowId, field);
      if (dirty === false || currentValue === undefined || !proposals.has(k)) return false;
      return sameValue(proposals.get(k), currentValue);
    },
    [proposals],
  );

  const forgetAll = useCallback(() => {
    setProposals((prev) => (prev.size ? new Map() : prev));
  }, []);

  const forget = useCallback((cells: readonly { rowId: string; field?: string }[]) => {
    if (cells.length === 0) return;
    setProposals((prev) => {
      let changed = false;
      const m = new Map(prev);
      for (const c of cells) {
        if (c.field !== undefined) {
          changed = m.delete(key(c.rowId, c.field)) || changed;
        } else {
          const prefix = `${c.rowId}\u0000`;
          for (const k of Array.from(m.keys())) if (k.startsWith(prefix)) { m.delete(k); changed = true; }
        }
      }
      return changed ? m : prev;
    });
  }, []);

  const costLabel = useCallback((n: number) => (showCosts ? t('bulk.ai.cost', { count: bulkAiCredits(n) }) : ''), [t, showCosts]);

  const running = status === 'running';
  const metaLabel = running ? t('bulk.ai.progress', { done: progress.done, total: progress.total }) : null;

  const resultLabel = useMemo(() => {
    if (!summary) return null;
    if (summary.status === 'cancelled') return t('bulk.ai.cancelled', { count: summary.improved });
    // The error reason leads, but the "N improved · not sent yet" part is kept: those AI edits are staged drafts
    // the seller still has to send or revert.
    const parts: string[] = summary.status === 'error' && summary.errorKey ? [t(summary.errorKey)] : [];
    if (summary.improved > 0) parts.push(t('bulk.ai.done', { count: summary.improved }));
    if (summary.unusable > 0) parts.push(t('bulk.ai.unusable', { count: summary.unusable }));
    if (summary.failed > 0) parts.push(t('bulk.ai.failedCount', { count: summary.failed }));
    if (parts.length === 0 && summary.status === 'done') parts.push(t('bulk.ai.nothingNew'));
    return parts.length ? parts.join(' · ') : null;
  }, [summary, t]);

  const limitLabel = limited ? t('bulk.ai.limitReached') : null;

  return {
    supported,
    status,
    running,
    progress,
    summary,
    limited,
    start,
    cancel,
    isProposal,
    forget,
    forgetAll,
    proposalCount: proposals.size,
    costLabel,
    metaLabel,
    resultLabel,
    limitLabel,
    actionLabel: t('bulk.ai.action'),
    cancelLabel: t('bulk.ai.cancel'),
  };
}

export default useBulkAi;

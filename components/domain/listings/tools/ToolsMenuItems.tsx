// components/domain/listings/tools/ToolsMenuItems.tsx — listings-grid §10 (M5 G6).
// The PageHeader `⋯` Tools items, the shared tool context every tool panel takes, and two small helpers the
// panels share (query → URL, staging pool). G5 (`ListingsPage`) renders the items in `overflowActions` and the
// panels by `?tool=`, importing each panel by path:
//
//   const toolItems = useToolsMenuItems({ tools: config.tools, onOpen: (tool) => setUrl({ tool }), activityHref });
//   <FindReplacePanel open={url.tool === 'findReplace'} onClose={closeTool} ctx={toolCtx} />
//   <DuplicatesPanel  open={url.tool === 'duplicates'}  onClose={closeTool} ctx={toolCtx} />
//   <CsvImportPanel   open={url.tool === 'import'}      onClose={closeTool} ctx={toolCtx} />
//   <ExportCsvModal   open={url.tool === 'export'}      onClose={closeTool} ctx={toolCtx} />
//   <ScheduledSendsPanel open={url.tool === 'scheduled'} onClose={closeTool} ctx={toolCtx} />
//
// Every tool STAGES through `ctx.adapter` (never a live write); the seller sends from the header primary.
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { icons } from '@/lib/ds/icons';
import type { ActionSpec } from '@/components/ds/types/actions';
import { neutral as n, px, type as typeScale } from '@/lib/ds/tokens';
import { stageableFields } from '@/lib/listings/csvImport';
import {
  toListingsSearchParams,
  DEFAULT_LISTING_SORT,
  LISTING_PAGE_SIZES,
  type ListingMarketplace,
  type ListingRow,
  type ListingsQuery,
  type ListingsResponse,
  type StageOptions,
  type StagePatch,
  type StagingAdapter,
} from '@/lib/listings/types';

/** `?tool=` values (§5 URL state) plus `export` (a Modal, also driven by `?tool=` so a reload restores it). */
export const LISTINGS_TOOL_KEYS = ['findReplace', 'duplicates', 'import', 'export', 'scheduled'] as const;
export type ListingsToolKey = (typeof LISTINGS_TOOL_KEYS)[number];

export function isListingsToolKey(v: unknown): v is ListingsToolKey {
  return typeof v === 'string' && (LISTINGS_TOOL_KEYS as readonly string[]).includes(v);
}

/** Everything a tool needs from the page. One object, built once by G5 per render (memoised). */
export interface ListingsToolContext {
  marketplace: ListingMarketplace;
  /** `ListingsResponse.store`. Null while the first page loads (tools then wait). */
  store: { id: string; name: string; currency: string } | null;
  /** The list query of the current view (filters, search, view; page/size/sort are ignored by the tools). */
  query: Partial<ListingsQuery> & Pick<ListingsQuery, 'marketplace'>;
  /** `ListingsResponse.total` (rows matching the current view). */
  viewCount: number;
  /** `ListingsResponse.counts.all`. */
  allCount: number;
  /** Selected row ids (marketplace ids, `ListingRow.id`). */
  selectedIds: string[];
  /** G5 `useStagedChanges` adapter for this marketplace. */
  adapter: StagingAdapter;
  /** `config.editorHref(id)`. */
  editorHref(id: string): string;
  /** Revalidate the list after a tool staged, scheduled or sent something. */
  onChanged?(): void;
  /**
   * `config.rowActions`. Optional: the tools fall back to `listingsConfig(marketplace).rowActions`, so a panel
   * never offers an action the marketplace's draft rejects.
   */
  rowActions?: readonly string[];
}

export interface ListingsToolPanelProps {
  open: boolean;
  onClose(): void;
  ctx: ListingsToolContext;
}

const TOOL_ICON: Record<ListingsToolKey, ActionSpec['icon']> = {
  findReplace: icons.search,
  duplicates: icons.copy,
  import: icons.upload,
  export: icons.download,
  scheduled: icons.schedule,
};

export interface ToolsMenuOptions {
  /** `config.tools`, in menu order. Unknown keys are skipped. */
  tools: readonly string[];
  onOpen(tool: ListingsToolKey): void;
  /** Etsy only (BUILD_PLAN §7 item 6): "Activity" link to `/app/etsy-aktivite`, from config. */
  activityHref?: string | null;
  /** Disable every tool with this reason (e.g. while the store is not connected). */
  disabledReason?: string | null;
  /**
   * When given, Find & replace is disabled (with a reason) on a marketplace that has no stageable text field
   * (Trendyol v1 stages only price and stock).
   */
  marketplace?: ListingMarketplace;
}

/** PageHeader `⋯` items: Find & replace · Find duplicates · Import CSV · Export CSV · Scheduled sends [· Activity]. */
export function useToolsMenuItems({ tools, onOpen, activityHref, disabledReason, marketplace }: ToolsMenuOptions): ActionSpec[] {
  const t = useTranslations('listings.tools');
  return useMemo(() => {
    const noTextField = marketplace ? !hasFindReplaceField(marketplace) : false;
    const items: ActionSpec[] = tools.filter(isListingsToolKey).map((key) => {
      const reason = disabledReason ?? (key === 'findReplace' && noTextField ? t('findReplaceUnavailable') : null);
      return {
        id: `tool-${key}`,
        label: t(key),
        icon: TOOL_ICON[key],
        onClick: () => onOpen(key),
        disabled: !!reason,
        disabledReason: reason ?? undefined,
      };
    });
    if (activityHref) {
      items.push({ id: 'tool-activity', label: t('activity'), icon: icons.etsyActivity, href: activityHref, paletteGroup: 'goto' });
    }
    return items;
  }, [tools, onOpen, activityHref, disabledReason, marketplace, t]);
}

/** Find & replace edits title or tags; a marketplace that can stage neither has nothing to offer. */
export function hasFindReplaceField(marketplace: ListingMarketplace): boolean {
  return stageableFields(marketplace).some((f) => f === 'title' || f === 'tags');
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** List filters of the current view for `/api/listings/export` and friends (no page/size/sort). */
export function toolSearchParams(ctx: Pick<ListingsToolContext, 'query' | 'store' | 'marketplace'>): URLSearchParams {
  const p = toListingsSearchParams({ ...ctx.query, marketplace: ctx.marketplace, store: ctx.query.store ?? ctx.store?.id });
  p.delete('page');
  p.delete('size');
  p.delete('sort');
  return p;
}

/** Adds the list's sort (Export keeps the order the seller sees; Find & replace and Import ignore it). */
export function withSort(p: URLSearchParams, ctx: Pick<ListingsToolContext, 'query'>): URLSearchParams {
  const sort = ctx.query.sort;
  if (sort && sort !== DEFAULT_LISTING_SORT) p.set('sort', sort);
  return p;
}

/** Only the store (every listing in the shop). */
export function storeSearchParams(ctx: Pick<ListingsToolContext, 'query' | 'store' | 'marketplace'>): URLSearchParams {
  const p = new URLSearchParams();
  p.set('marketplace', ctx.marketplace);
  const store = ctx.query.store ?? ctx.store?.id;
  if (store) p.set('store', store);
  return p;
}

export class ToolFetchError extends Error {
  constructor(public status: number, public errorId?: string) {
    super(`listings tool request failed (${status})`);
  }
}

export async function fetchToolText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    let errorId: string | undefined;
    try {
      errorId = ((await res.json()) as { errorId?: string }).errorId;
    } catch {
      /* body is not JSON */
    }
    throw new ToolFetchError(res.status, errorId);
  }
  return res.text();
}

export async function fetchToolJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchToolText(url)) as T;
}

/** Open-draft sync states (a `synced` row has nothing unsent). */
const OPEN_DRAFT_SYNC = 'pending,syncing,sync_failed,conflict';
const ROWS_PAGE_SIZE = LISTING_PAGE_SIZES[LISTING_PAGE_SIZES.length - 1];
/** Safety cap on pages read for one tool (250 × 40 = 10 000 drafted listings). */
const MAX_TOOL_PAGES = 40;

/**
 * Every listing in the store that has an open draft (`/api/listings?sync=…`, paged), so Find & replace and
 * Import compute from the unsent values instead of the export's live ones.
 */
export async function fetchOpenDraftRows(ctx: Pick<ListingsToolContext, 'query' | 'store' | 'marketplace'>): Promise<ListingRow[]> {
  const rows: ListingRow[] = [];
  for (let page = 1; page <= MAX_TOOL_PAGES; page++) {
    const p = storeSearchParams(ctx);
    p.set('sync', OPEN_DRAFT_SYNC);
    p.set('size', String(ROWS_PAGE_SIZE));
    if (page > 1) p.set('page', String(page));
    const body = await fetchToolJson<ListingsResponse>(`/api/listings?${p.toString()}`);
    rows.push(...body.rows);
    if (body.rows.length < ROWS_PAGE_SIZE || rows.length >= body.total) break;
  }
  return rows;
}

/** Ids per `/api/listings?ids=` request: one page, and short enough for the URL even with long eBay SKUs. */
const IDS_PER_REQUEST = 100;

/** `/api/listings?ids=` in chunks of 100: editability and thumbnails for specific listings. */
export async function fetchRowsByIds(ctx: Pick<ListingsToolContext, 'query' | 'store' | 'marketplace'>, ids: readonly string[]): Promise<Map<string, ListingRow>> {
  const out = new Map<string, ListingRow>();
  const unique = Array.from(new Set(ids));
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + IDS_PER_REQUEST);
    const p = storeSearchParams(ctx);
    p.set('ids', chunk.join(','));
    p.set('size', String(IDS_PER_REQUEST));
    const body = await fetchToolJson<ListingsResponse>(`/api/listings?${p.toString()}`);
    for (const r of body.rows) out.set(r.id, r);
  }
  return out;
}

export type StageItem = { id: string; patch: StagePatch; opts?: StageOptions };
export type StageRunResult = { done: string[]; failed: string[] };

/**
 * Stages items through the adapter, `concurrency` at a time, reporting progress after each one. A failure never
 * stops the run; the caller retries `failed` ("resumable"). `signal.aborted` stops starting new items.
 */
export async function stageMany(
  adapter: Pick<StagingAdapter, 'stage'>,
  items: StageItem[],
  onProgress?: (done: number, total: number) => void,
  opts: { concurrency?: number; signal?: { aborted: boolean } } = {},
): Promise<StageRunResult> {
  const done: string[] = [];
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && !opts.signal?.aborted) {
      const item = items[next++];
      try {
        await adapter.stage(item.id, item.patch, item.opts);
        done.push(item.id);
      } catch {
        failed.push(item.id);
      }
      onProgress?.(done.length + failed.length, items.length);
    }
  };
  const workers = Math.max(1, Math.min(opts.concurrency ?? 4, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return { done, failed };
}

/** DS type scale as an inline style (tool panels use plain elements + tokens, no raw MUI). */
export function textStyle(key: keyof typeof typeScale, color: string = n[900]): CSSProperties {
  const [size, line, weight, spacing] = typeScale[key];
  return { fontSize: px(size), lineHeight: px(line), fontWeight: weight, letterSpacing: spacing, color, margin: 0 };
}

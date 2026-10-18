// components/domain/bulk/BulkEditPage.tsx — the bulk editor page (bulk-grid §2, §3, §6, §7, §8; M7-C).
// `/app/{marketplace-listings}/bulk?ids=…` or `?view=&q=&…` (same filters as the list). One page of ≤ 250 rows.
//
// Safety (founder decision, CLAUDE.md "Etsy editing"): every cell edit, paste, fill and bulk-bar action STAGES a
// draft (one draft per listing, written by the batch queue). Nothing goes live until the explicit
// "Send N changes to {marketplace}" with its confirm. Send never includes conflicts, queued deletes, new-listing
// drafts or drafts already sending (`planSend`), and a conflict is never forced. "Delete N listings…" only stages
// a queued delete; it is sent from the listings page's "Send deletion…" with type-to-confirm.
import * as React from 'react';
import Box from '@mui/material/Box';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { useFormatter, useTranslations } from 'next-intl';
import { Page, PageHeader, type ActionSpec } from '@/components/ds/page';
import { useIsPhone } from '@/components/ds/page/useViewport';
import { BulkGrid, usePasteSummary, type CellOrigin, type CellPatch as GridCellPatch, type PasteOutcome } from '@/components/ds/data/BulkGrid';
import { useToast } from '@/components/ds/feedback/toast';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { TableSkeleton } from '@/components/ds/state/Skeletons';
import type { BulkActionBarProps } from '@/components/ds/toolbar/BulkActionBar';
import { useUrlState, urlField } from '@/lib/ds/useUrlState';
import { useAsyncRegion } from '@/lib/ds/useAsyncState';
import { dispatchShortcutEvent, useShortcuts } from '@/lib/ds/useShortcuts';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { icons } from '@/lib/ds/icons';
import { useFeatureAction } from '@/lib/billing/useFeatureAction';
import { useLimitDialogOptOut } from '@/lib/http/limitInterceptor';
import { useConnections } from '@/lib/hooks/useConnections';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import { readListingsCsv } from '@/lib/listings/csvImport';
import type { ListingMarketplace, ListingRow, ListingSortKey, ListingSyncKey, ListingsQuery, ListingsResponse, StagedAction } from '@/lib/listings/types';
import { CONNECT_HREF, MARKETPLACE_NAME } from '@/components/domain/listings/config';
import type { ListingsT } from '@/components/domain/listings/columns';
import {
  LISTINGS_LIVE_EVENTS,
  LISTINGS_URL_SCHEMA,
  ListingsFetchError,
  listingsFetcher,
  listingsKey,
  storeOf,
  toListingsQuery,
} from '@/components/domain/listings/useListings';
import { planSend, useStagedChanges, type ListingsStagingAdapter } from '@/components/domain/listings/useStagedChanges';
import { excludedClauses, useSendChanges } from '@/components/domain/listings/SendChangesAction';
import { useFetchedFilterOptions } from '@/components/domain/listings/ListingsToolbar';
import { ChangePriceModal } from '@/components/domain/listings/bulk/ChangePriceModal';
import { AddTagsModal } from '@/components/domain/listings/bulk/AddTagsModal';
import { fetchToolText, hasFindReplaceField, type ListingsToolContext } from '@/components/domain/listings/tools/ToolsMenuItems';
import { FindReplacePanel } from '@/components/domain/listings/tools/FindReplacePanel';
import { exportUrl, filenameFromDisposition, selectedTooLong } from '@/components/domain/listings/tools/ExportCsvModal';
import { BULK_PAGE_SIZE, bulkConfig, isBulkField, type BulkConfig, type BulkField } from './config';
import { bulkColumns } from './config/columns';
import {
  cellKeyOf,
  cellReadOnlyReason,
  hasOpenDraft,
  liveValue,
  normalizeValue,
  sameValue,
  serverDirtyFields,
  serverDraftValue,
  splitCellKey,
  translateServerKey,
  validateField,
  type FieldRuleContext,
} from './config/fields';
import { createTransport, useBulkStaging, type BulkStageTransport, type CellPatch, type FieldValues, type QueueSnapshot } from './useBulkStaging';
import { planDiscard, revertDraftFields, useSessionEdits, type Baseline, type RestoreValues, type RevertDeps } from './useSessionEdits';
import { BulkBanner, pickBulkBanner, type PasteSummary } from './BulkBanner';
import { BulkToolbar, filterGridRows, type BulkShow } from './BulkToolbar';
import { useBulkAi } from './useBulkAi';
import { withAiMarker } from './AiProposalCell';
import { useStockManagedRows } from '@/components/domain/listings/stockManaged';
import { isPlayClient } from '@/lib/billing/playClient';

// ─── URL ────────────────────────────────────────────────────────────────────

/** The list's URL schema (filters, sort, store, view) + `ids` and a 250-row default page (bulk-grid §1.2). */
export const BULK_URL_SCHEMA = {
  ...LISTINGS_URL_SCHEMA,
  size: urlField.int(BULK_PAGE_SIZE, { allowed: [50, 100, 250] }),
  ids: urlField.string(undefined, { maxLength: 8000 }),
  /** "Improve with AI" from the listings bar: the grid opens with every row selected (no credits spent on load). */
  ai: urlField.optionalEnum(['1'] as const),
};

/** `?ids=a,b,c` → unique ids, at most one page (pure). Null when absent. */
export function parseIdsParam(raw: string | undefined, max = BULK_PAGE_SIZE): string[] | null {
  if (!raw) return null;
  const ids = Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))).slice(0, max);
  return ids.length ? ids : null;
}

/**
 * The read query (pure). With `ids` the grid shows exactly those listings: the list view/filters are NOT applied
 * (Etsy's default view is "active", which would hide selected inactive listings).
 */
export function bulkListQuery(
  url: Parameters<typeof toListingsQuery>[0],
  config: BulkConfig,
  ids: string[] | null,
): { query: ListingsQuery; key: string } {
  const lc = config.listings;
  if (ids) {
    const store = storeOf(url, lc);
    const query: ListingsQuery = { marketplace: lc.marketplace, sort: url.sort as ListingSortKey, page: 1, size: BULK_PAGE_SIZE };
    if (store) query.store = store;
    return { query, key: `${listingsKey(query)}&ids=${encodeURIComponent(ids.join(','))}` };
  }
  const query = toListingsQuery(url, lc);
  return { query, key: listingsKey(query) };
}

// ─── Pure state helpers (unit-tested) ───────────────────────────────────────

export type LocalInvalid = ReadonlyMap<string, { value: unknown; message: string }>;

/** BulkGrid `values`: the draft overlay per row (server draft → staged → in flight → pending → failed → invalid). */
export function overlayValues(rows: ListingRow[], fields: readonly BulkField[], snap: Pick<QueueSnapshot, 'staged' | 'inFlight' | 'pending' | 'failed'>, localInvalid: LocalInvalid): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const put = (rowId: string, values: FieldValues | undefined) => {
    if (!values) return;
    for (const [k, v] of Object.entries(values)) {
      (out[rowId] ??= {})[k] = v;
    }
  };
  for (const r of rows) {
    const server: FieldValues = {};
    for (const f of fields) {
      const v = serverDraftValue(r, f);
      if (v !== undefined) server[f] = v;
    }
    put(r.id, server);
    put(r.id, snap.staged.get(r.id));
    put(r.id, snap.inFlight.get(r.id));
    put(r.id, snap.pending.get(r.id));
    put(r.id, snap.failed.get(r.id)?.values);
  }
  for (const [key, { value }] of localInvalid) {
    const { rowId, field } = splitCellKey(key);
    (out[rowId] ??= {})[field] = value;
  }
  return out;
}

/**
 * Server draft fields whose unsent value the row overlay carries (title, price, qty). A draft change the overlay
 * can't show (e.g. Etsy section) is not marked dirty: the cell would show the live value as if it were the edit.
 * The row's Changes pill still says it has unsent changes.
 */
export function serverDirtyShown(row: ListingRow, fields: readonly BulkField[]): BulkField[] {
  return serverDirtyFields(row, fields).filter((f) => serverDraftValue(row, f) !== undefined);
}

/** The pre-session draft value of a cell, read on its first edit of the session (pure, see `Baseline`). */
export function baselineOfRow(row: ListingRow | undefined, field: BulkField): Baseline {
  if (!row || !serverDirtyFields(row, [field]).length) return { kind: 'none' };
  const v = serverDraftValue(row, field);
  return v === undefined ? { kind: 'unknown' } : { kind: 'value', value: v };
}

/** BulkGrid `dirty`: cells with a staged or pending value (server draft fields + this session's queue). */
export function dirtyCells(rows: ListingRow[], fields: readonly BulkField[], snap: Pick<QueueSnapshot, 'staged' | 'inFlight' | 'pending'>): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    for (const f of serverDirtyShown(r, fields)) out.add(cellKeyOf(r.id, f));
    for (const m of [snap.staged, snap.inFlight, snap.pending]) {
      const v = m.get(r.id);
      if (v) for (const f of Object.keys(v)) if ((fields as readonly string[]).includes(f)) out.add(cellKeyOf(r.id, f));
    }
  }
  return out;
}

/** "N edits not sent": the dirty cells plus server draft changes the grid can't show as a value (pure). */
export function unsentEditCount(rows: ListingRow[], fields: readonly BulkField[], dirty: ReadonlySet<string>): number {
  const keys = new Set(dirty);
  for (const r of rows) for (const f of serverDirtyFields(r, fields)) keys.add(cellKeyOf(r.id, f));
  return keys.size;
}

export type RowSendState = 'sendable' | 'conflict' | 'delete' | 'syncing' | null;

/** What "Send N" will do with a row (C1: a change = one listing with an unsent draft). */
export function rowSendState(row: ListingRow, snap: Pick<QueueSnapshot, 'staged' | 'inFlight' | 'pending' | 'drafts'>, sendingIds: ReadonlySet<string>): RowSendState {
  if (sendingIds.has(row.id) || row.sync?.status === 'syncing') return 'syncing';
  const open = hasOpenDraft(row);
  if (open && row.sync!.queuedDelete) return 'delete';
  const status = snap.drafts.get(row.id)?.status;
  if (status === 'conflict' || (open && row.sync!.status === 'conflict')) return 'conflict';
  if (snap.pending.has(row.id) || snap.inFlight.has(row.id) || snap.staged.has(row.id)) return 'sendable';
  if (open && (row.sync!.status === 'pending' || row.sync!.status === 'sync_failed')) return 'sendable';
  return null;
}

/** Change pill for the grid's Changes column. */
export function rowSyncKey(row: ListingRow, snap: Pick<QueueSnapshot, 'staged' | 'inFlight' | 'pending' | 'drafts'>, sendingIds: ReadonlySet<string>): ListingSyncKey | null {
  if (sendingIds.has(row.id)) return 'syncing';
  const status = snap.drafts.get(row.id)?.status;
  if (status === 'conflict') return 'conflict';
  if (row.sync && row.sync.status !== 'synced') return row.sync.status;
  if (snap.pending.has(row.id) || snap.inFlight.has(row.id) || snap.staged.has(row.id)) return status === 'failed' ? 'sync_failed' : 'pending';
  return row.sync?.status ?? null;
}

export type ApplyCellsResult = {
  valid: CellPatch[];
  invalid: LocalInvalid;
  skipped: number;
  invalidCount: number;
};

/** BulkGrid `onPasteResult` (ok outcome) → banner summary (pure). Refusals are handled by `usePasteSummary`. */
export function pasteSummaryOf(outcome: Extract<PasteOutcome, { kind: 'ok' }>): PasteSummary {
  return {
    rows: outcome.rows,
    cols: outcome.cols,
    edits: outcome.edits,
    invalid: outcome.invalid,
    skipped: outcome.skipped,
    overflow: outcome.overflow,
    listings: outcome.rowIds.length,
  };
}

/**
 * Splits grid patches into valid edits (→ staging queue) and invalid ones (stay local with their message).
 * A patch with `error` (BulkGrid parse/validate) is invalid as is; every other patch is re-checked with the same
 * field rules (the page is the last gate before staging). Per-row read-only cells are skipped and counted; no-op
 * edits (same as the live value, no draft value) are dropped (pure, unit-tested).
 */
export function applyCellPatches(
  patches: GridCellPatch[],
  rowsById: ReadonlyMap<string, ListingRow>,
  ctx: FieldRuleContext,
  current: { invalid: LocalInvalid; dirty: ReadonlySet<string> },
): ApplyCellsResult {
  const invalid = new Map(current.invalid);
  const valid: CellPatch[] = [];
  let skipped = 0;
  let invalidCount = 0;
  for (const p of patches) {
    if (!isBulkField(p.field)) {
      skipped += 1;
      continue;
    }
    const row = rowsById.get(p.rowId);
    if (!row) continue;
    const key = cellKeyOf(p.rowId, p.field);
    if (cellReadOnlyReason(row, p.field, ctx)) {
      skipped += 1;
      continue;
    }
    if (p.error) {
      invalid.set(key, { value: p.value, message: p.error });
      invalidCount += 1;
      continue;
    }
    const value = normalizeValue(p.field, p.value);
    const message = validateField(p.field, value, row, ctx);
    if (message) {
      invalid.set(key, { value: p.value, message });
      invalidCount += 1;
      continue;
    }
    invalid.delete(key);
    // Same as live and nothing unsent on that field (locally or in the server draft): a no-op.
    if (!current.dirty.has(key) && p.field !== 'tags' && !serverDirtyFields(row, [p.field]).length && sameValue(value, liveValue(row, p.field))) continue;
    valid.push({ rowId: p.rowId, field: p.field, value });
  }
  return { valid, invalid, skipped, invalidCount };
}

// ─── Data ───────────────────────────────────────────────────────────────────

function useBulkRows(key: string | null) {
  const swr = useSWR<ListingsResponse, ListingsFetchError>(key, listingsFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    shouldRetryOnError: (err: unknown) => !(err instanceof ListingsFetchError && err.status < 500),
  });
  const region = useAsyncRegion(swr, { isEmpty: () => false });
  const mutate = React.useCallback(() => swr.mutate(), [swr]);
  // Live refresh, DB-only (BUILD_PLAN §7 item 3): never a live marketplace read. Local edits stay in the queue.
  useLiveRevalidate(LISTINGS_LIVE_EVENTS, mutate, { throttleMs: 2000, enabled: Boolean(key) });
  return { data: swr.data, error: swr.error, state: region.state, retry: region.retry, mutate };
}

type SettingsSlice = { subscription?: { billingProvider?: string | null; subscriptionPlan?: string | null } | null };

const settingsFetcher = async (url: string): Promise<SettingsSlice> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

function withParams(href: string, params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${href}${href.includes('?') ? '&' : '?'}${s}` : href;
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Fields Find & replace can stage (it writes through its own draft calls, not the grid queue). */
const FIND_REPLACE_FIELDS: readonly BulkField[] = ['title', 'tags'];

// ─── Page ───────────────────────────────────────────────────────────────────

export type BulkEditPageProps = {
  marketplace: ListingMarketplace;
  /** Test seams. */
  transport?: BulkStageTransport;
  stagingAdapter?: ListingsStagingAdapter;
  revertDeps?: RevertDeps;
};

export function BulkEditPage({ marketplace, transport: injectedTransport, stagingAdapter, revertDeps }: BulkEditPageProps) {
  const config = bulkConfig(marketplace);
  const lc = config.listings;
  const t = useTranslations() as unknown as ListingsT;
  const format = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsPhone(); // tablets get the full tool; only phones see the 'bigger screen' state
  const mpName = MARKETPLACE_NAME[marketplace];
  const to = t('listings.mp.to', { marketplace });

  // 402s here show the inline usage Banner instead of the global dialog (CRITIQUE C6).
  useLimitDialogOptOut();

  // ── data ──
  const [url, setUrl] = useUrlState(BULK_URL_SCHEMA);
  const ids = React.useMemo(() => parseIdsParam(url.ids), [url.ids]);
  const { query, key } = React.useMemo(() => bulkListQuery(url, config, ids), [url, config, ids]);
  const list = useBulkRows(mobile ? null : key);
  const data = list.data;
  const rows = React.useMemo(() => data?.rows ?? [], [data]);
  const rowsById = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const storeId = data?.store.id ?? query.store ?? null;
  const storeCurrency = data?.store.currency ?? rows[0]?.price?.currency ?? 'USD';
  const total = data?.total ?? 0;

  const { data: settings } = useSWR<SettingsSlice>('/api/user/settings', settingsFetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });
  const sub = settings?.subscription ?? null;
  const stripeUpsell = sub != null && sub.billingProvider !== 'shopify_free' && sub.subscriptionPlan !== 'shopify_free' && !isPlayClient();

  const connections = useConnections();
  const notConnected = connections.has(marketplace) === false || list.error?.code === 'not_connected';
  const needsReauth = Boolean(connections.get(marketplace)?.needsReauth);

  // ── staging ──
  const rowsRef = React.useRef(rowsById);
  rowsRef.current = rowsById;
  const staged = useStagedChanges({ config: lc, storeId, rows, onChanged: list.mutate, adapter: stagingAdapter });
  const transport = React.useMemo<BulkStageTransport>(
    () =>
      injectedTransport ??
      createTransport(config.transport, {
        marketplace,
        storeId,
        currencyOf: (id) => rowsRef.current.get(id)?.price?.currency ?? storeCurrency,
      }),
    [injectedTransport, config.transport, marketplace, storeId, storeCurrency],
  );
  const queue = useBulkStaging(transport);
  const session = useSessionEdits();
  const [localInvalid, setLocalInvalid] = React.useState<LocalInvalid>(() => new Map());
  const [paste, setPaste] = React.useState<PasteSummary | null>(null);
  const [sendLimitHit, setSendLimitHit] = React.useState(false);
  const [sentOnce, setSentOnce] = React.useState(false);
  const limitHit = queue.limitHit || sendLimitHit;

  // Leaving with edits still saving (staged drafts are already safe; only the last < 1 s is at risk).
  // Only leaving the page asks; page / filter changes inside the grid keep the queue running.
  useUnsavedChangesGuard(queue.busy, {
    labels: { title: t('bulk.leaveSaving') },
    shouldBlock: (next) => next.split(/[?#]/)[0] !== (typeof window === 'undefined' ? '' : window.location.pathname),
  });

  // ── formatting / rules ──
  const formatMoney = React.useCallback(
    (amount: number, currency: string) => {
      try {
        return format.number(amount, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' });
      } catch {
        return format.number(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    },
    [format],
  );
  const sections = useFetchedFilterOptions(lc, storeId);
  const sectionOptions = React.useMemo(() => (sections.key === 'section' ? sections.options.map((o) => ({ value: String(o.value), label: o.label })) : []), [sections.key, sections.options]);
  const sectionIds = React.useMemo(() => (sectionOptions.length ? new Set(sectionOptions.map((o) => o.value)) : undefined), [sectionOptions]);
  // Stock-managed quantities: one batch request for the loaded rows (BR-11); empty in dry run / off Etsy.
  const stockManagedIds = useStockManagedRows(rows, marketplace, storeId);
  const ruleCtx: FieldRuleContext = React.useMemo(
    () => ({ config, t, formatMoney, sendingIds: staged.sendingIds, sectionIds, stockManagedIds }),
    [config, t, formatMoney, staged.sendingIds, sectionIds, stockManagedIds],
  );
  const formatNumber = React.useCallback((n: number) => format.number(n), [format]);

  // ── grid state ──
  const values = React.useMemo(() => overlayValues(rows, config.fields, queue, localInvalid), [rows, config.fields, queue, localInvalid]);
  const dirty = React.useMemo(() => dirtyCells(rows, config.fields, queue), [rows, config.fields, queue]);
  const failedMessage = React.useCallback(
    (error: { code?: string; key?: string; params?: Record<string, string | number> }) =>
      error.code === 'LIMIT' ? t('listings.error.usageLimit') : translateServerKey(t, error.key, error.params) ?? t('listings.cell.stageFailed'),
    [t],
  );
  const invalid = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const [rowId, f] of queue.failed) for (const field of Object.keys(f.values)) out.set(cellKeyOf(rowId, field), failedMessage(f.error));
    for (const [k, v] of localInvalid) out.set(k, v.message);
    return out;
  }, [queue.failed, localInvalid, failedMessage]);

  const rowSets = React.useMemo(() => {
    const dirtyRows = new Set<string>();
    const invalidRows = new Set<string>();
    dirty.forEach((k) => dirtyRows.add(splitCellKey(k).rowId));
    invalid.forEach((_m, k) => invalidRows.add(splitCellKey(k).rowId));
    return { dirtyRows, invalidRows };
  }, [dirty, invalid]);

  const [q, setQ] = React.useState('');
  const [show, setShow] = React.useState<BulkShow>('all');
  const displayRows = React.useMemo(() => filterGridRows(rows, { q, show, ...rowSets }), [rows, q, show, rowSets]);

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const aiPreselect = React.useRef(url.ai === '1');
  React.useEffect(() => setSelectedIds([]), [key]);
  React.useEffect(() => {
    if (!aiPreselect.current || !rows.length) return;
    aiPreselect.current = false;
    setSelectedIds(rows.map((r) => r.id));
  }, [rows]);
  const selectedRows = React.useMemo(() => selectedIds.map((id) => rowsById.get(id)).filter((r): r is ListingRow => Boolean(r)), [selectedIds, rowsById]);

  const sendStates = React.useMemo(() => rows.map((r) => rowSendState(r, queue, staged.sendingIds)), [rows, queue, staged.sendingIds]);
  const changes = sendStates.filter((s) => s === 'sendable').length;
  const conflicts = sendStates.filter((s) => s === 'conflict').length;
  const failedListings = React.useMemo(() => Array.from(queue.failed.values()).filter((f) => f.error.code !== 'LIMIT').length, [queue.failed]);

  // ── edits ──
  const onCellsChange = React.useCallback(
    (patches: GridCellPatch[], origin: CellOrigin) => {
      const res = applyCellPatches(patches, rowsById, ruleCtx, { invalid: localInvalid, dirty });
      setLocalInvalid(res.invalid);
      if (res.valid.length) {
        queue.enqueue(res.valid);
        session.record(res.valid, (rowId, field) => baselineOfRow(rowsById.get(rowId), field));
      }
      // The paste banner comes from `onPasteResult`; any other edit replaces it.
      if (origin !== 'paste') {
        setPaste(null);
        setPasteRefusal(null);
      }
    },
    [rowsById, ruleCtx, localInvalid, dirty, queue, session],
  );

  const pasteRefusalOf = usePasteSummary();
  const [pasteRefusal, setPasteRefusal] = React.useState<string | null>(null);
  const onPasteResult = React.useCallback(
    (outcome: PasteOutcome) => {
      if (outcome.kind === 'ok') {
        setPaste(pasteSummaryOf(outcome));
        setPasteRefusal(null);
        return;
      }
      setPaste(null);
      setPasteRefusal(pasteRefusalOf(outcome)?.message ?? null);
    },
    [pasteRefusalOf],
  );

  // ── Improve with AI (M7-D): proposals arrive as ordinary cell edits (origin 'ai') and are only staged ──
  const onCellsChangeRef = React.useRef(onCellsChange);
  onCellsChangeRef.current = onCellsChange;
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  /** Live tags loaded for the current AI run (tags are not on the list row). */
  const aiTagsRef = React.useRef<Map<string, string[] | null>>(new Map());
  const ai = useBulkAi({
    marketplace,
    onCellsChange: (patches) => onCellsChangeRef.current(patches, 'ai'),
    canEdit: (rowId, field) => {
      const row = rowsRef.current.get(rowId);
      return Boolean(row && isBulkField(field) && config.fields.includes(field) && !cellReadOnlyReason(row, field, ruleCtx));
    },
    // What the cell shows NOW (draft overlay, else live), so a late AI answer never overwrites a seller's edit.
    getCurrent: (rowId, field) => {
      const ov = valuesRef.current[rowId];
      if (ov && Object.prototype.hasOwnProperty.call(ov, field)) return ov[field];
      if (field === 'title') return rowsRef.current.get(rowId)?.title;
      if (field === 'tags') return aiTagsRef.current.get(rowId) ?? undefined;
      return undefined;
    },
  });

  /**
   * Revert cell / row (§6.3): local values dropped; the draft rewritten without those fields. `restore` (Discard
   * all) puts a field's pre-session draft value back instead of dropping it.
   */
  const revertCells = React.useCallback(
    async (cells: Array<{ rowId: string; field?: string }>, restore?: ReadonlyMap<string, RestoreValues>) => {
      const byRow = new Map<string, Set<BulkField>>();
      for (const c of cells) {
        const fields = c.field === undefined ? config.fields : isBulkField(c.field) ? [c.field] : [];
        if (!fields.length) continue;
        const set = byRow.get(c.rowId) ?? new Set<BulkField>();
        fields.forEach((f) => set.add(f));
        byRow.set(c.rowId, set);
      }
      if (!byRow.size) return;
      ai.forget(cells);
      const snap = queue.queue.getSnapshot();
      const touched: Array<{ rowId: string; fields: BulkField[] }> = [];
      setLocalInvalid((prev) => {
        const next = new Map(prev);
        byRow.forEach((fields, rowId) => fields.forEach((f) => next.delete(cellKeyOf(rowId, f))));
        return next;
      });
      byRow.forEach((set, rowId) => {
        const row = rowsById.get(rowId);
        if (!row || rowSendState(row, snap, staged.sendingIds) === 'syncing') return;
        const fields = Array.from(set);
        const local = snap.staged.has(rowId) || snap.inFlight.has(rowId) || snap.drafts.has(rowId);
        queue.drop(rowId, fields);
        session.forget(rowId, fields);
        if (local || serverDirtyFields(row, fields).length || hasOpenDraft(row)) touched.push({ rowId, fields });
      });
      if (!touched.length) return;
      await queue.whenIdle();
      let failed = 0;
      for (const { rowId, fields } of touched) {
        try {
          await revertDraftFields({ kind: config.transport, marketplace, storeId }, rowId, fields, revertDeps, restore?.get(rowId));
        } catch {
          failed += 1;
        }
      }
      if (failed) toast.error(t('bulk.revert.failed', { count: failed }));
      await list.mutate();
    },
    [config.fields, config.transport, queue, rowsById, staged.sendingIds, session, marketplace, storeId, revertDeps, toast, t, list, ai],
  );

  const discardAll = React.useCallback(async () => {
    const { edits, listings } = session.counts;
    if (!edits) return;
    const ok = await confirm({ title: t('bulk.discardAll.confirm', { edits, listings }), confirmLabel: t('bulk.discardAll.cta'), tone: 'danger' });
    if (!ok) return;
    // A field that already had an unsent value before this session gets that value back; one whose earlier value
    // can't be read is kept (never guessed) and left out of the session, so Revert on the cell still removes it.
    const plan = planDiscard(session.edits, session.baseline);
    plan.kept.forEach(({ rowId, field }) => session.forget(rowId, [field]));
    if (plan.cells.length) {
      await revertCells(plan.cells, plan.restore);
      toast.success(t('bulk.discardAll.done', { count: plan.cells.length }));
    }
    if (plan.kept.length) toast.info(t('bulk.discardAll.kept', { count: plan.kept.length }));
  }, [session, confirm, t, revertCells, toast]);

  // ── send (§6.5) ──
  const sendDisabledReason = needsReauth ? t('listings.banner.reconnect', { marketplace: mpName }) : limitHit ? t('listings.error.usageLimit') : undefined;
  const send = useSendChanges({
    marketplace,
    unsent: changes,
    staged,
    t,
    disabledReason: sendDisabledReason,
    onLimit: () => setSendLimitHit(true),
    onSent: (r) => {
      if (r.sent.length) setSentOnce(true);
    },
  });
  const [preparing, setPreparing] = React.useState(false);
  // ⌘↵ is bound by both BulkGrid (`onSend`) and the page: one send at a time, whatever fires.
  const sendLock = React.useRef(false);
  const runSend = React.useCallback(async () => {
    if (sendLock.current || send.sending || sendDisabledReason) return;
    sendLock.current = true;
    setPreparing(true);
    try {
      await queue.whenIdle(); // every edit is a draft before anything is sent
      let open;
      try {
        open = await staged.adapter.listOpen();
      } catch {
        toast.error(t('listings.send.failedGeneric'));
        return;
      }
      const gridIds = new Set(rows.map((r) => r.id));
      const plan = planSend(open.filter((d) => gridIds.has(d.id)));
      const waiting = excludedClauses(plan, t, marketplace);
      const count = plan.sendable.length;
      if (!count) {
        toast.info(waiting ? t('listings.send.nothingSendable', { waiting }) : t('listings.send.nothingToSend'));
        return;
      }
      const ok = await confirm({
        title: waiting ? t('listings.send.confirmExcluded', { count, to, waiting }) : t('bulk.send.confirm', { count, to }),
        confirmLabel: t('listings.send.cta', { count, to }),
      });
      if (!ok) return;
      setPreparing(false);
      const result = await send.sendDrafts(plan.sendable);
      if (result) {
        const rowOf = new Map(plan.sendable.map((d) => [d.draftId, d.id]));
        const done = [...result.sent, ...result.failed.map((f) => f.id), ...result.conflicts].map((id) => rowOf.get(id)).filter((id): id is string => Boolean(id));
        queue.settle(done);
        const sentRows: Array<{ rowId: string }> = [];
        result.sent.forEach((id) => {
          const rowId = rowOf.get(id);
          if (rowId) {
            session.forget(rowId);
            sentRows.push({ rowId });
          }
        });
        // Sent AI suggestions are live now: nothing left to revert, so no marker.
        ai.forget(sentRows);
      }
    } finally {
      sendLock.current = false;
      setPreparing(false);
    }
  }, [send, sendDisabledReason, queue, staged.adapter, toast, t, rows, marketplace, confirm, to, session, ai]);

  const sendAction: ActionSpec | null =
    changes > 0 || send.sending
      ? {
          id: 'sendChanges',
          label: t('listings.send.cta', { count: changes, to }),
          icon: icons.push,
          loading: send.sending || preparing,
          loadingLabel: t('listings.send.loading', { count: changes }),
          disabled: Boolean(sendDisabledReason),
          disabledReason: sendDisabledReason,
          shortcut: 'mod+enter',
          onClick: () => void runSend(),
        }
      : null;

  useShortcuts(
    {
      'mod+s': { handler: () => queue.flushNow(), description: t('bulk.shortcuts.save'), allowInInput: true },
      'mod+enter': sendAction && !sendAction.disabled ? { handler: () => void runSend(), description: sendAction.label } : null,
    },
    { scope: 'page', enabled: !mobile, describe: true },
  );

  // ── bulk bar (§7) ──
  const [modal, setModal] = React.useState<null | 'price' | 'tags' | 'section'>(null);
  const [sectionValue, setSectionValue] = React.useState<string | null>(null);
  const [modalRows, setModalRows] = React.useState<ListingRow[]>([]);
  const [tagLookup, setTagLookup] = React.useState<Map<string, string[] | null>>(new Map());
  const photo = useFeatureAction('bulkPhotoStudio', { lockedHref: config.photosRoute ?? undefined });
  // "Edit photos…" opens PhotoStudio; `back` returns to this grid (safeBackHref).
  const gridRouter = useRouter();

  const editableRows = React.useCallback(
    (targets: ListingRow[], field: BulkField) => targets.filter((r) => !cellReadOnlyReason(r, field, ruleCtx) || (field === 'price' && r.editable.reason === 'variations')),
    [ruleCtx],
  );

  const stageActions = React.useCallback(
    async (targets: ListingRow[], action: StagedAction) => {
      if (!targets.length) return;
      await queue.whenIdle(); // never two writers on one draft
      const res = await staged.stageActions(targets.map((r) => r.id), action);
      if (res.failed.length) toast.error(t('listings.tools.stageFailed', { count: res.failed.length }));
      else if (res.ok.length) toast.success(t('listings.tools.staged', { count: res.ok.length }));
    },
    [queue, staged, toast, t],
  );

  const deleteSelected = React.useCallback(async () => {
    const snap = queue.queue.getSnapshot();
    const eligible = selectedRows.filter(
      (r) => !hasOpenDraft(r) && !snap.pending.has(r.id) && !snap.inFlight.has(r.id) && !snap.staged.has(r.id),
    );
    const skipped = selectedRows.length - eligible.length;
    if (skipped) toast.info(t('bulk.delete.skippedEdited', { count: skipped }));
    if (!eligible.length) return;
    const many = eligible.length > 1;
    const ok = await confirm({
      title: many ? t('listings.action.deleteManyConfirm', { count: eligible.length }) : t('listings.action.deleteConfirm', { title: eligible[0].title }),
      body: t('listings.action.deleteStagedNote', { on: t('listings.mp.on', { marketplace }) }),
      items: many ? eligible.map((r) => r.title) : undefined,
      confirmLabel: many ? t('listings.action.deleteMany', { count: eligible.length }) : t('listings.action.delete'),
      tone: 'danger',
      typeToConfirm: eligible.length > 10 ? String(eligible.length) : undefined,
    });
    if (ok) await stageActions(eligible, { type: 'delete' });
  }, [queue, selectedRows, toast, t, confirm, marketplace, stageActions]);

  const loadTags = React.useCallback(
    async (targets: ListingRow[]) => {
      const p = new URLSearchParams({ marketplace });
      if (storeId) p.set('store', storeId);
      p.set('ids', targets.map((r) => r.id).join(','));
      const csv = readListingsCsv(await fetchToolText(`/api/listings/export?${p.toString()}`));
      const map = new Map<string, string[] | null>();
      for (const r of targets) map.set(r.id, csv.get(r.id)?.tags ?? null);
      return map;
    },
    [marketplace, storeId],
  );

  const improveWithAi = React.useCallback(
    async (targets: ListingRow[]) => {
      if (!targets.length) return;
      // Current tags (live + this session's staged tags). Tags are only improved when every row's tags are known,
      // so an unknown tag list is never replaced by a suggestion.
      // Marketplaces without a tags column (eBay: title only) skip the tag lookup.
      let lookup = new Map<string, string[] | null>();
      if (config.fields.includes('tags')) {
        try {
          lookup = await loadTags(targets);
        } catch {
          lookup = new Map();
        }
      }
      const tagsOf = (r: ListingRow): string[] | null => {
        const v = values[r.id]?.tags;
        return Array.isArray(v) ? (v as string[]) : lookup.get(r.id) ?? null;
      };
      aiTagsRef.current = lookup;
      const tagsKnown = config.fields.includes('tags') && targets.every((r) => tagsOf(r) !== null);
      const summary = await ai.start(
        targets.map((r) => {
          const title = values[r.id]?.title;
          const category = r.extra.category;
          return {
            rowId: r.id,
            listingId: r.id,
            title: typeof title === 'string' ? title : r.title,
            tags: tagsOf(r) ?? [],
            ...(typeof category === 'string' && category ? { category } : {}),
          };
        }),
        tagsKnown ? ['title', 'tags'] : ['title'],
      );
      if (summary) setSelectedIds([]);
    },
    [loadTags, values, config.fields, ai],
  );
  React.useEffect(() => {
    if (ai.resultLabel && !ai.running) toast.info(ai.resultLabel);
  }, [ai.resultLabel, ai.running, toast]);

  const bulkSelection: BulkActionBarProps | undefined = React.useMemo(() => {
    if (!selectedRows.length) return undefined;
    const actions: ActionSpec[] = [];
    if (config.listings.tags && config.fields.includes('tags')) {
      actions.push({
        id: 'addTags',
        label: t('listings.bulk.addTags'),
        onClick: () => {
          const targets = editableRows(selectedRows, 'tags');
          if (!targets.length) return;
          setModalRows(targets);
          void loadTags(targets)
            .then((m) => {
              setTagLookup(m);
              setModal('tags');
            })
            .catch(() => toast.error(t('listings.tools.loadFailed')));
        },
      });
    }
    if (config.fields.includes('section') && sectionOptions.length) {
      actions.push({
        id: 'setSection',
        label: t('bulk.section.set'),
        onClick: () => {
          setModalRows(editableRows(selectedRows, 'section'));
          setSectionValue(null);
          setModal('section');
        },
      });
    }
    if (ai.supported && config.fields.includes('title')) {
      const n = selectedRows.length;
      actions.push({
        id: 'improveWithAi',
        label: [ai.actionLabel, ai.costLabel(n)].filter(Boolean).join(' · '),
        icon: icons.ai,
        disabled: ai.limited || ai.running,
        disabledReason: ai.limited ? ai.limitLabel ?? undefined : undefined,
        onClick: () => void improveWithAi(selectedRows),
      });
    }
    if (config.photosHref && photo.visible) {
      const back = gridRouter.asPath.startsWith('/app/') ? `&back=${encodeURIComponent(gridRouter.asPath)}` : '';
      const href = `${config.photosHref(selectedRows.map((r) => r.id), storeId)}${back}`;
      actions.push({
        id: 'editPhotos',
        label: photo.tag ? t('bulk.photos.editPro') : t('bulk.photos.edit'),
        icon: icons.photos,
        ...(photo.onBlockedClick ? { onClick: photo.onBlockedClick } : { href }),
      });
    }
    const overflow: ActionSpec[] = [];
    if (sendAction) overflow.push({ ...sendAction, shortcut: undefined });
    overflow.push({ id: 'revertRows', label: t('bulk.revert.selected'), icon: icons.revert, onClick: () => void revertCells(selectedRows.map((r) => ({ rowId: r.id }))) });
    for (const a of config.stateActions) {
      const targets = selectedRows.filter((r) =>
        a === 'deactivate' ? r.status === 'active' || r.status === 'sold_out' : a === 'activate' ? r.status === 'inactive' || r.status === 'draft' : r.status === 'expired' || r.status === 'sold_out',
      );
      if (targets.length) overflow.push({ id: a, label: t(`listings.action.${a}`), onClick: () => void stageActions(targets, { type: a }) });
    }
    if (config.deleteAction) {
      overflow.push({ id: 'delete', label: t('bulk.delete.cta', { count: selectedRows.length }), icon: icons.delete, tone: 'danger', onClick: () => void deleteSelected() });
    }
    return {
      count: selectedRows.length,
      primary: config.fields.includes('price')
        ? {
            id: 'changePrice',
            label: t('listings.bulk.changePrice'),
            onClick: () => {
              setModalRows(editableRows(selectedRows, 'price'));
              setModal('price');
            },
          }
        : undefined,
      actions,
      overflow,
      onClear: () => setSelectedIds([]),
    };
  }, [selectedRows, config, t, editableRows, loadTags, toast, photo, storeId, sendAction, revertCells, stageActions, deleteSelected, ai, improveWithAi, sectionOptions, gridRouter.asPath]);

  // ── header overflow (§2): Find & replace · Export these rows (CSV) · Keyboard shortcuts ──
  // Find & replace stages through its own draft calls, so the grid queue is drained first (one writer per draft)
  // and, after it staged, this session's staged title/tags values give way to the re-read server draft.
  // With `?ids=` the list query has no filters, so its "view" scope would be the whole store: not offered there.
  const findDisabledReason = ids
    ? t('bulk.tools.findReplaceIds')
    : !hasFindReplaceField(marketplace)
      ? t('listings.tools.findReplaceUnavailable')
      : undefined;
  const openFind = React.useCallback(async () => {
    if (findDisabledReason) return;
    await queue.whenIdle();
    setUrl({ tool: 'findReplace' });
  }, [findDisabledReason, queue, setUrl]);
  const closeTool = React.useCallback(() => setUrl({ tool: undefined }), [setUrl]);
  const toolCtx: ListingsToolContext = React.useMemo(
    () => ({
      marketplace,
      store: data?.store ? { id: data.store.id, name: data.store.name, currency: data.store.currency } : null,
      query,
      viewCount: total,
      allCount: data?.counts?.all ?? total,
      selectedIds,
      adapter: staged.adapter,
      editorHref: (id: string) => lc.editorHref(id, storeId) ?? withParams(lc.route, { open: id }),
      onChanged: () => {
        const snap = queue.queue.getSnapshot();
        for (const rowId of snap.staged.keys()) {
          if (!snap.pending.has(rowId) && !snap.inFlight.has(rowId)) queue.drop(rowId, FIND_REPLACE_FIELDS);
        }
        void list.mutate();
      },
    }),
    [marketplace, data?.store, data?.counts?.all, query, total, selectedIds, staged.adapter, lc, storeId, queue, list],
  );
  const exportRows = React.useCallback(async () => {
    const gridIds = rows.map((r) => r.id);
    const exact = gridIds.length > 0 && !selectedTooLong(gridIds);
    const href = exportUrl({ query, store: toolCtx.store, marketplace, selectedIds: gridIds }, exact ? 'selected' : 'view', false);
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const today = new Date().toISOString().slice(0, 10);
      saveBlob(await res.blob(), filenameFromDisposition(res.headers.get('content-disposition')) ?? `${marketplace}-listings-${today}.csv`);
    } catch {
      toast.error(t('listings.export.failed'));
    }
  }, [rows, query, toolCtx.store, marketplace, toast, t]);
  const headerOverflow: ActionSpec[] = [
    {
      id: 'findReplace',
      label: t('listings.tools.findReplace'),
      icon: icons.search,
      disabled: Boolean(findDisabledReason),
      disabledReason: findDisabledReason,
      onClick: () => void openFind(),
    },
    { id: 'exportRows', label: t('bulk.tools.exportRows'), icon: icons.download, disabled: !rows.length, onClick: () => void exportRows() },
    {
      id: 'shortcuts',
      label: t('shell.shortcuts.title'),
      shortcut: '?',
      onClick: () => void dispatchShortcutEvent(new KeyboardEvent('keydown', { key: '?' })),
    },
  ];

  // ── columns ──
  const syncKeyOf = React.useCallback((r: ListingRow) => rowSyncKey(r, queue, staged.sendingIds), [queue, staged.sendingIds]);
  const columns = React.useMemo(() => {
    const cols = bulkColumns(t, { ...ruleCtx, config, sectionOptions, syncKeyOf, formatNumber });
    if (!ai.supported) return cols;
    // AI proposals carry the Sparkles marker (with its tooltip) until the seller edits, reverts or sends the cell (M7-D).
    return cols.map((c) =>
      c.field === 'title'
        ? withAiMarker(c, { isProposal: ai.isProposal, getRowId: (r: ListingRow) => r.id, isDirty: (rowId, field) => dirty.has(cellKeyOf(rowId, field)) })
        : c,
    );
  }, [t, ruleCtx, config, sectionOptions, syncKeyOf, formatNumber, ai, dirty]);
  const rowMeta = React.useCallback(
    (r: ListingRow): React.ReactNode =>
      r.sync?.queuedDelete && r.sync.status !== 'synced' ? (
        <Box component="span" data-testid="bulk-row-will-delete">
          {t('listings.cell.willDelete')}
        </Box>
      ) : null,
    [t],
  );

  // ── header ──
  const title = t('bulk.title');
  const pageTitle = `${title} · ${t('listings.title', { marketplace })}`;
  const backHref = withParams(lc.route, { [lc.storeParam ?? 'store']: lc.storeParam ? storeId : null, view: url.view ?? null });
  const edits = unsentEditCount(rows, config.fields, dirty);
  const metaParts: string[] = [t('bulk.meta.counts', { listings: rows.length, edits })];
  if (ai.metaLabel) metaParts.push(ai.metaLabel);
  if (queue.progress) metaParts.push(t('bulk.meta.saving', { done: queue.progress.done, total: queue.progress.total }));
  else if (queue.savedAt) metaParts.push(t('bulk.meta.saved', { time: format.dateTime(queue.savedAt, { hour: '2-digit', minute: '2-digit' }) }));
  const meta = data ? (sentOnce && !edits && !changes ? t('bulk.meta.allSent', { to }) : metaParts.join(' · ')) : null;
  const discardAction: ActionSpec | null = session.counts.edits
    ? { id: 'discardAll', label: t('bulk.discardAll.cta'), icon: icons.revert, onClick: () => void discardAll() }
    : null;
  const selecting = selectedRows.length > 0;
  const headerPrimary = !selecting && sendAction ? sendAction : undefined;
  const stopAi: ActionSpec | null = ai.running ? { id: 'stopAi', label: ai.cancelLabel, onClick: () => ai.cancel() } : null;
  const headerSecondary = [stopAi, selecting ? sendAction : null, discardAction].filter((a): a is ActionSpec => Boolean(a)).slice(0, 2);

  const banner = pickBulkBanner(
    {
      marketplace,
      limitHit,
      stripeUpsell,
      needsReauth,
      paste,
      saving: queue.progress,
      failedListings,
      invalid: { count: localInvalid.size + Array.from(queue.failed.values()).reduce((n, f) => n + Object.keys(f.values).length, 0), reason: invalid.values().next().value ?? null },
      conflicts,
    },
    t,
    {
      onShowInvalid: () => {
        setPaste(null);
        setShow('invalid');
      },
      onShowFailed: () => setShow('invalid'),
    },
  );

  // ── render ──
  if (mobile) {
    return (
      <Page title={pageTitle} width="list" backHref={backHref}>
        <EmptyState
          kind="first-use"
          icon={icons.listing}
          title={t('bulk.mobile.title')}
          body={t('bulk.mobile.body')}
          action={{ id: 'back', label: t('bulk.back', { marketplace: mpName }), href: backHref }}
          data-testid="bulk-mobile"
        />
      </Page>
    );
  }

  if (notConnected) {
    return (
      <Page title={pageTitle} width="list" backHref={backHref}>
        <PageHeader title={title} backHref={backHref} backLabel={t('bulk.back', { marketplace: mpName })} data-testid="bulk-header" />
        <ConnectState brand={marketplace} title={t('listings.empty.connectTitle', { marketplace: mpName })} connectHref={CONNECT_HREF} data-testid="bulk-connect" />
      </Page>
    );
  }

  const pageSize = query.size ?? BULK_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  let body: React.ReactNode;
  if (list.state === 'error') {
    body = (
      <ErrorState
        variant="page"
        title={t('bulk.error.load')}
        errorId={list.error?.errorId}
        onRetry={list.retry}
        data-testid="bulk-error"
      />
    );
  } else if (!data && (list.state === 'loading' || list.state === 'slow')) {
    body = (
      <>
        {list.state === 'slow' ? <SlowState variant="inline" onRetry={list.retry} data-testid="bulk-slow" /> : null}
        <TableSkeleton rows={12} thumb columns={6} data-testid="bulk-loading" />
      </>
    );
  } else if (!rows.length) {
    body = (
      <EmptyState
        kind="no-results"
        title={t('bulk.empty.title')}
        action={{ id: 'back', label: t('bulk.back', { marketplace: mpName }), href: backHref }}
        data-testid="bulk-empty"
      />
    );
  } else {
    body = (
      <>
        <BulkToolbar t={t} q={q} onQ={setQ} show={show} onShow={setShow} shown={displayRows.length} page={url.page} pages={pages} selection={bulkSelection} />
        <BulkGrid<ListingRow>
          rows={displayRows}
          getRowId={(r) => r.id}
          columns={columns}
          values={values}
          dirty={dirty}
          invalid={invalid}
          onCellsChange={onCellsChange}
          onRevert={(cells) => void revertCells(cells)}
          selection={{ ids: selectedIds, onChange: setSelectedIds }}
          pagination={ids ? undefined : { mode: 'pages', page: url.page, pageSize, total, onChange: ({ page }) => setUrl({ page }) }}
          columnStateKey={config.columnStateKey}
          rowMeta={rowMeta}
          onPasteResult={onPasteResult}
          onFind={() => void openFind()}
          onSend={() => void runSend()}
          onFlush={() => queue.flushNow()}
          sourceLabel={mpName}
          ariaLabel={pageTitle}
          data-testid="bulk-grid"
        />
      </>
    );
  }

  return (
    <Page title={pageTitle} width="list" backHref={backHref}>
      <PageHeader
        title={title}
        count={data ? rows.length : undefined}
        meta={meta ? <span data-testid="bulk-meta">{meta}</span> : undefined}
        backHref={backHref}
        backLabel={t('bulk.back', { marketplace: mpName })}
        primaryAction={headerPrimary}
        secondaryActions={headerSecondary}
        overflowActions={headerOverflow}
        mobilePrimary="none"
        data-testid="bulk-header"
      />
      {pasteRefusal ? (
        <BulkBanner spec={{ id: 'paste', tone: 'danger', title: pasteRefusal }} />
      ) : ai.limited && ai.limitLabel && !limitHit ? (
        <BulkBanner
          spec={{
            id: 'limit',
            tone: 'warning',
            title: ai.limitLabel,
            action: stripeUpsell ? { id: 'seePlans', label: t('listings.error.seePlans'), href: `/fiyatlandirma?from=bulk-ai-${marketplace}` } : undefined,
          }}
        />
      ) : (
        <BulkBanner spec={banner} />
      )}
      {body}

      <ChangePriceModal
        open={modal === 'price'}
        onClose={() => setModal(null)}
        rows={modalRows}
        currency={storeCurrency}
        priceMin={lc.validation.priceMin}
        currentPrice={(r) => {
          const v = values[r.id]?.price;
          return typeof v === 'number' ? v : r.price?.amount ?? null;
        }}
        formatMoney={formatMoney}
        onStage={async (patches) => {
          onCellsChange(
            patches.flatMap(({ id, patch }) => (patch.price !== undefined ? [{ rowId: id, field: 'price', value: patch.price }] : [])),
            'edit',
          );
          setSelectedIds([]);
          return { ok: patches.map((p) => p.id), failed: [] };
        }}
        t={t}
      />
      {lc.tags ? (
        <AddTagsModal
          open={modal === 'tags'}
          onClose={() => setModal(null)}
          rows={modalRows}
          limits={lc.tags}
          currentTags={(r) => {
            const v = values[r.id]?.tags;
            return Array.isArray(v) ? (v as string[]) : tagLookup.get(r.id) ?? null;
          }}
          onStage={async (patches) => {
            onCellsChange(
              patches.flatMap(({ id, patch }) => (patch.tags !== undefined ? [{ rowId: id, field: 'tags', value: patch.tags }] : [])),
              'edit',
            );
            setSelectedIds([]);
            return { ok: patches.map((p) => p.id), failed: [] };
          }}
          t={t}
        />
      ) : null}
      <Modal
        open={modal === 'section'}
        onClose={() => setModal(null)}
        size="sm"
        title={t('bulk.section.title')}
        primary={{
          id: 'stageSection',
          label: t('bulk.section.stage', { count: modalRows.length }),
          disabled: sectionValue === null || !modalRows.length,
          disabledReason: !modalRows.length ? t('listings.price.nothingToStage') : sectionValue === null ? t('bulk.section.pick') : undefined,
          onClick: () => {
            if (sectionValue === null) return;
            onCellsChange(modalRows.map((r) => ({ rowId: r.id, field: 'section', value: sectionValue })), 'edit');
            setSelectedIds([]);
            setModal(null);
          },
        }}
        data-testid="bulk-section-modal"
      >
        <FormField label={t('bulk.col.section')}>
          <Select<string> value={sectionValue} onChange={setSectionValue} options={sectionOptions} placeholder={t('bulk.section.pick')} fullWidth aria-label={t('bulk.col.section')} />
        </FormField>
      </Modal>
      {ids ? null : <FindReplacePanel open={url.tool === 'findReplace'} onClose={closeTool} ctx={toolCtx} />}
    </Page>
  );
}

export default BulkEditPage;

// ─── Route ───────────────────────────────────────────────────────────────────

/** `/app/{marketplace-listings}/bulk`. */
export function BulkEditRoute({ marketplace }: { marketplace: ListingMarketplace }) {
  return <BulkEditPage marketplace={marketplace} />;
}

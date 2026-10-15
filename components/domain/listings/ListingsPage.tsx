// components/domain/listings/ListingsPage.tsx — listings-grid §2–§8 (M5 G5): the one listings page for all five
// marketplaces. Everything marketplace-specific comes from `config/*` (DS P4); there is no marketplace branching
// here (listings-grid §15).
//
// Safety (CLAUDE.md "Etsy editing", founder decision): every edit on this page STAGES a draft. The only writes to
// a marketplace are explicit sends: "Send N changes" (never conflicts, never queued deletes, never new-listing
// drafts), "Send this change", "Send selected changes", and "Send deletion…" behind type-to-confirm. Nothing is
// sent automatically. Pull ("Refresh from Etsy") uses the existing sync endpoints; the list itself reads only the
// DB caches (`GET /api/listings`) and revalidates on live listing events (BUILD_PLAN §7 item 3).
import * as React from 'react';
import Box from '@mui/material/Box';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { useFormatter, useTranslations } from 'next-intl';
import { Page, PageHeader, SyncMeta, type ActionSpec, type PageBreadcrumb } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { useLocalSavedViews, type Density } from '@/components/ds/toolbar';
import type { BulkActionBarProps } from '@/components/ds/toolbar/BulkActionBar';
import type { FilterValues, SavedView } from '@/components/ds/toolbar/types';
import { Banner } from '@/components/ds/feedback/Banner';
import { useToast } from '@/components/ds/feedback/toast';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { useConfirm } from '@/components/ds/overlay/ConfirmDialog';
import { useUrlState } from '@/lib/ds/useUrlState';
import { renderSendError, type SendErrorTranslator } from '@/lib/listings/sendError';
import { listQueryForEditor, writeEditorNav } from '@/lib/listingEditor/editorNav';
import { crosslistCreateHref } from '@/lib/listings/legacyHandoff';
import { useCommands, type Command } from '@/lib/ds/useCommand';
import { icons } from '@/lib/ds/icons';
import { useAuth } from '@/lib/auth-context';
import { useConnections } from '@/lib/hooks/useConnections';
import { useLimitDialogOptOut } from '@/lib/http/limitInterceptor';
import CacheFreshnessChip from '@/components/etsy-history/CacheFreshnessChip';
import { readListingsCsv } from '@/lib/listings/csvImport';
import {
  builtInViewCount,
  splitSortKey,
  unsentCount,
  type ListingMarketplace,
  type ListingPageSize,
  type ListingRow,
  type ListingSortKey,
  type StagedAction,
  type StagePatch,
} from '@/lib/listings/types';
import {
  CONNECT_HREF,
  FRESHNESS_CHIP,
  MARKETPLACE_NAME,
  SCHEDULED_SENDS_ENABLED,
  listingsConfig,
} from './config';
import type { BulkActionKey, RowActionKey } from './config/types';
import {
  COLUMN_SORT_FIELD,
  dirtyCellKeys,
  displayPrice,
  displayListPrice,
  displayQty,
  hasOpenChanges,
  isArchivedRow,
  listingColumns,
  removalKindOf,
  type ListingCellContext,
  type ListingsT,
} from './columns';
import {
  LISTINGS_URL_SCHEMA,
  activeViewOf,
  fromFilterValues,
  hasActiveFilters,
  savedViewQuery,
  storeOf,
  toFilterValues,
  toListingsQuery,
  useListings,
  usePull,
  viewPatch,
} from './useListings';
import { useStagedChanges, type ExtendedStagePatch, type UseStagedChanges } from './useStagedChanges';
import { useStockManagedRows, withStockManaged } from './stockManaged';
import { useSendChanges, SendChangesBar } from './SendChangesAction';
import { FailureBanner } from './FailureBanner';
import { ListingsToolbar, useFetchedFilterOptions } from './ListingsToolbar';
import { ListingsTable, listingsEmptyKind } from './ListingsTable';
import { QuickViewPanel } from './QuickViewPanel';
import { useListingsShortcuts } from './useListingsShortcuts';
import { ChangePriceModal } from './bulk/ChangePriceModal';
import { ChangeStockModal } from './bulk/ChangeStockModal';
import { AddTagsModal } from './bulk/AddTagsModal';
import { ScheduleSendModal } from './bulk/ScheduleSendModal';
import { CopyToShopModal } from './bulk/CopyToShopModal';
import { SetFieldModal } from './bulk/SetFieldModal';
import { NewDraftsBanner } from './NewDraftsBanner';
import { buildVariationPriceInventories, priceModeToOp, type VariationMatch } from '@/lib/bulk/variationPriceOps';
import { useToolsMenuItems, fetchToolText, storeSearchParams, type ListingsToolContext, type ListingsToolKey } from './tools/ToolsMenuItems';
import { FindReplacePanel } from './tools/FindReplacePanel';
import { DuplicatesPanel } from './tools/DuplicatesPanel';
import { CsvImportPanel } from './tools/CsvImportPanel';
import { ExportCsvModal, type ExportScope } from './tools/ExportCsvModal';
import { ScheduledSendsPanel } from './tools/ScheduledSendsPanel';

const SETTINGS_KEY = '/api/user/settings';
const DEFAULT_TIMEZONE = 'Europe/Istanbul';
const LEGACY_SCHEDULE_KEYS = ['etsy_scheduled_updates', 'ebay_scheduled_updates'] as const;
/** `changedFields` an overlay can re-stage after "Discard changes" (Undo). */
const UNDOABLE_FIELDS = new Set(['price', 'quantity', 'qty', 'title']);

type SettingsSlice = {
  subscription?: { billingProvider?: string | null; subscriptionPlan?: string | null } | null;
  preferences?: { timezone?: string | null } | null;
};

const settingsFetcher = async (url: string): Promise<SettingsSlice> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

function densityKey(mp: ListingMarketplace) {
  return `kx.listings.${mp}.density`;
}

function readDensity(mp: ListingMarketplace): Density {
  try {
    return window.localStorage.getItem(densityKey(mp)) === 'compact' ? 'compact' : 'standard';
  } catch {
    return 'standard';
  }
}

function writeDensity(mp: ListingMarketplace, d: Density) {
  try {
    window.localStorage.setItem(densityKey(mp), d);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Old tab-bound scheduler entries (`components/{etsy,ebay}/ScheduledUpdateDialog`), for the one-time migration
 * banner. `raw` is the entry's original JSON, so storage keeps every entry that was not staged, byte for byte.
 */
export type LegacyScheduledUpdate = {
  listingId: string;
  /** Etsy entries carry the shop they were scheduled from; eBay entries have one store (null). */
  shopId: string | null;
  changes: ExtendedStagePatch;
  scheduledAt: string;
  raw: string;
};

function parseLegacyList(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Reads the pending legacy schedules (pure over the raw JSON; try/catch at the caller). Carries price, quantity,
 * title, tags and description. An entry with nothing stageable (or no listing id / time) is not returned; it is
 * never removed from storage either.
 */
export function parseLegacySchedules(raw: string | null): LegacyScheduledUpdate[] {
  return parseLegacyList(raw).flatMap((item) => {
    const u = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const id = u.listingId ?? u.listing_id ?? u.sku;
    const at = u.scheduledAt ?? u.scheduledTime ?? u.scheduled_at;
    const ch = ((u.changes ?? u.updates ?? {}) || {}) as Record<string, unknown>;
    if (id == null || id === '' || typeof at !== 'string') return [];
    if (u.status && u.status !== 'pending') return [];
    const patch: ExtendedStagePatch = {};
    const price = Number(ch.price);
    if (ch.price !== undefined && ch.price !== null && Number.isFinite(price) && price > 0) patch.price = price;
    const rawQty = ch.quantity ?? ch.qty;
    const qty = Number(rawQty);
    if (rawQty !== undefined && rawQty !== null && Number.isInteger(qty) && qty >= 0) patch.qty = qty;
    if (typeof ch.title === 'string' && ch.title.trim()) patch.title = ch.title.trim();
    if (Array.isArray(ch.tags)) patch.tags = ch.tags.filter((t): t is string => typeof t === 'string');
    if (typeof ch.description === 'string') patch.description = ch.description;
    if (!Object.keys(patch).length) return [];
    const shop = u.shop_id ?? u.shopId;
    return [{ listingId: String(id), shopId: shop == null || shop === '' ? null : String(shop), changes: patch, scheduledAt: at, raw: JSON.stringify(item) }];
  });
}

/**
 * Splits the parsed entries for the open store: `movable` can be staged here and now; `kept` belongs to this
 * store but carries a change the adapter cannot stage (description outside Etsy) and stays in storage. Entries
 * of another shop are in neither list: they are offered when that shop is open (pure, unit-tested).
 */
export function legacyForStore(
  entries: LegacyScheduledUpdate[],
  storeId: string | null,
  opts: { stagesDescription: boolean },
): { movable: LegacyScheduledUpdate[]; kept: LegacyScheduledUpdate[] } {
  const movable: LegacyScheduledUpdate[] = [];
  const kept: LegacyScheduledUpdate[] = [];
  for (const u of entries) {
    if (u.shopId !== null && u.shopId !== storeId) continue;
    if (u.changes.description !== undefined && !opts.stagesDescription) kept.push(u);
    else movable.push(u);
  }
  return { movable, kept };
}

/** The raw storage list minus the entries that were staged (each staged `raw` removes one match; pure). */
export function remainingLegacyRaw(raw: string | null, stagedRaw: string[]): unknown[] {
  const pending = new Map<string, number>();
  for (const r of stagedRaw) pending.set(r, (pending.get(r) ?? 0) + 1);
  return parseLegacyList(raw).filter((item) => {
    const key = JSON.stringify(item);
    const n = pending.get(key) ?? 0;
    if (n > 0) {
      pending.set(key, n - 1);
      return false;
    }
    return true;
  });
}

function legacyScheduleKey(mp: ListingMarketplace): string | null {
  const key = `${mp}_scheduled_updates`;
  return (LEGACY_SCHEDULE_KEYS as readonly string[]).includes(key) ? key : null;
}

/**
 * True when the row "click" ended a text selection (the user dragged across the title to copy it), same rule as the
 * Orders grid. Keyboard opens (Enter) never count: only a mouse click with a non-empty selection does.
 */
export function rowClickIsTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const ev = (window as unknown as { event?: Event }).event;
    if (ev && ev.type !== 'click') return false;
    const sel = window.getSelection?.();
    return Boolean(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
  } catch {
    return false;
  }
}

function withQuery(href: string, key: string, value: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

export type ListingsPageProps = {
  marketplace: ListingMarketplace;
  /** Test seam. */
  now?: Date;
  /** Test seam: replaces the staging adapter. */
  stagingAdapter?: UseStagedChanges['adapter'];
};

export function ListingsPage({ marketplace, now, stagingAdapter }: ListingsPageProps) {
  const config = listingsConfig(marketplace);
  const t = useTranslations() as unknown as ListingsT;
  const format = useFormatter();
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsMobile();
  const router = useRouter();
  const mpName = MARKETPLACE_NAME[marketplace];
  const to = t('listings.mp.to', { marketplace });
  const from = t('listings.mp.from', { marketplace });

  // 402s on this route show the inline usage Banner instead of the global dialog (CRITIQUE C6).
  useLimitDialogOptOut();

  // ── URL state + data ─────────────────────────────────────────────────────────────────────────────────
  const { user } = useAuth() as { user?: { id?: string } | null };
  const userId = user?.id ?? null;

  const [url, setUrl] = useUrlState(LISTINGS_URL_SCHEMA);
  const query = React.useMemo(() => toListingsQuery(url, config), [url, config]);
  // Rows from this viewer's last visit paint at once (dimmed, "Updating…") while the fresh list loads.
  const list = useListings(query, { cacheScope: userId });
  const data = list.data;
  const rows = list.rows;
  const counts = data?.counts;
  const storeId = data?.store.id ?? storeOf(url, config) ?? null;
  const storeName = data?.store.name ?? '';
  const storeCurrency = data?.store.currency ?? rows[0]?.price?.currency ?? 'USD';
  const activeView = activeViewOf(url, config);

  const { data: settings } = useSWR<SettingsSlice>(SETTINGS_KEY, settingsFetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });
  const sub = settings?.subscription ?? null;
  const stripeUpsell = sub != null && sub.billingProvider !== 'shopify_free' && sub.subscriptionPlan !== 'shopify_free';
  const timezone = settings?.preferences?.timezone || DEFAULT_TIMEZONE;

  // ── connection (§7: not connected / reconnect / couldn't check) ──────────────────────────────────────
  const connections = useConnections();
  const connected = connections.has(marketplace);
  // Cross-list targets ("Copy to eBay" / "Copy to Etsy"): hidden only when known not connected.
  const ebayConnected = connections.has('ebay');
  const etsyConnected = connections.has('etsy');
  const notConnected = connected === false || list.error?.code === 'not_connected';
  const needsReauth = Boolean(connections.get(marketplace)?.needsReauth);
  const couldntCheck = Boolean(connections.error) && !connections.connections;

  // ── staging ──────────────────────────────────────────────────────────────────────────────────────────
  const staged = useStagedChanges({ config, storeId, rows, onChanged: list.mutate, adapter: stagingAdapter });
  const [sendLimitHit, setSendLimitHit] = React.useState(false);

  const pull = usePull(config, { storeId, userId }, list.mutate);
  const limitHit = pull.limitHit || sendLimitHit;
  const limitText = t('listings.error.usageLimit');
  const reconnectText = t('listings.banner.reconnect', { marketplace: mpName });
  const sendDisabledReason = needsReauth ? reconnectText : limitHit ? limitText : undefined;

  const unsent = counts ? unsentCount(counts) : 0;
  const send = useSendChanges({
    marketplace,
    unsent,
    staged,
    t,
    disabledReason: sendDisabledReason,
    onLimit: () => setSendLimitHit(true),
  });

  // ── formatting helpers ───────────────────────────────────────────────────────────────────────────────
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
  // Stored keys (etsy.draftSync.* / ebay.draftSync.* / listings.*) come from the server already resolved; a key the
  // catalog lacks, or whose ICU params the attempt did not record, renders the generic cause (never raw text).
  const errorText = React.useCallback(
    (row: ListingRow) => {
      const key = row.sync?.errorKey;
      if (!key) return t('listings.sendError.generic');
      const errorKey = !t.has || t.has(key) || !t.has(`etsy.${key}`) ? key : `etsy.${key}`;
      return renderSendError(t as SendErrorTranslator, { errorKey, errorParams: row.sync?.errorParams });
    },
    [t],
  );

  // Section / collection names for the id-valued column (same request as the filter menu, §9.2).
  const fetchedOptions = useFetchedFilterOptions(config, storeId);
  const optionLabels = React.useMemo<ListingCellContext['optionLabels']>(
    () => (fetchedOptions.key && fetchedOptions.options.length ? { [fetchedOptions.key]: new Map(fetchedOptions.options.map((o) => [o.value, o.label])) } : undefined),
    [fetchedOptions.key, fetchedOptions.options],
  );
  const removalKind = removalKindOf(config);
  // Stock-managed quantities: one batch request for the loaded rows (BR-11); empty in dry run / off Etsy.
  const stockManagedIds = useStockManagedRows(rows, marketplace, storeId);

  const cellCtx: ListingCellContext = React.useMemo(
    () => ({
      config,
      marketplaceName: mpName,
      overlays: staged.overlays,
      sendingIds: staged.sendingIds,
      formatMoney,
      errorText,
      storeCurrency,
      removalKind,
      optionLabels,
      stockManagedIds,
    }),
    [config, mpName, staged.overlays, staged.sendingIds, formatMoney, errorText, storeCurrency, removalKind, optionLabels, stockManagedIds],
  );
  const columns = React.useMemo(() => listingColumns(t, cellCtx), [t, cellCtx]);
  const dirtyCells = React.useMemo(() => dirtyCellKeys(rows, staged.overlays), [rows, staged.overlays]);

  // ── density (per viewer) ─────────────────────────────────────────────────────────────────────────────
  const [density, setDensity] = React.useState<Density>('standard');
  React.useEffect(() => setDensity(readDensity(marketplace)), [marketplace]);

  // ── saved views ──────────────────────────────────────────────────────────────────────────────────────
  const userViews = useLocalSavedViews(`listings.${marketplace}`);
  const viewLabelKey: Record<string, string> = {
    all: 'listings.view.all',
    active: 'listings.view.active',
    not_sent: 'listings.view.notSent',
    send_failed: 'listings.view.sendFailed',
    needs_work: 'listings.view.needsWork',
    sold_out: 'listings.view.soldOut',
    inactive: 'listings.view.inactive',
    review: 'listings.view.review',
  };
  const views: SavedView[] = React.useMemo(() => {
    const builtIn = config.views.map((v) => ({
      id: v,
      label: t(viewLabelKey[v]),
      count: counts ? builtInViewCount(v, counts) : undefined,
      countTone: v === 'send_failed' ? ('danger' as const) : ('neutral' as const),
    }));
    return [...builtIn, ...userViews.views];
  }, [config.views, counts, userViews.views, t]);
  const selectView = React.useCallback((id: string) => setUrl(viewPatch(id, userViews.views, config)), [setUrl, userViews.views, config]);

  // ── selection (kept across pages) ────────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [selectAllInView, setSelectAllInView] = React.useState(false);
  const knownRows = React.useRef(new Map<string, ListingRow>());
  rows.forEach((r) => knownRows.current.set(r.id, r));
  const selectedRows = React.useMemo(
    () => selectedIds.map((id) => knownRows.current.get(id)).filter((r): r is ListingRow => Boolean(r)),
    [selectedIds, rows],
  );
  const filterKey = JSON.stringify(query.status ?? []) + (query.q ?? '') + activeView + (query.health ?? '') + storeId;
  React.useEffect(() => {
    setSelectedIds([]);
    setSelectAllInView(false);
  }, [filterKey]);
  const clearSelection = React.useCallback(() => {
    setSelectedIds([]);
    setSelectAllInView(false);
  }, []);

  // ── panels / modals ──────────────────────────────────────────────────────────────────────────────────
  const [modal, setModal] = React.useState<null | 'price' | 'stock' | 'tags' | 'schedule' | 'copyShop' | 'setField'>(null);
  const [modalRows, setModalRows] = React.useState<ListingRow[]>([]);
  // "Change stock" skips stock-managed rows (counted as skipped, like variation rows).
  const stockModalRows = React.useMemo(() => modalRows.map((r) => withStockManaged(r, stockManagedIds)), [modalRows, stockManagedIds]);
  const [scheduleDrafts, setScheduleDrafts] = React.useState<string[]>([]);
  const [tagLookup, setTagLookup] = React.useState<Map<string, string[] | null>>(new Map());
  const [exportScope, setExportScope] = React.useState<ExportScope | undefined>(undefined);

  const openId = url.open ?? null;
  const openRow = openId ? rows.find((r) => r.id === openId) ?? knownRows.current.get(openId) ?? null : null;
  const openIndex = openRow ? rows.findIndex((r) => r.id === openRow.id) : -1;
  const setPanel = React.useCallback(
    (patch: { open?: string; tool?: ListingsToolKey | undefined }, history: 'push' | 'replace' = 'push') =>
      setUrl((prev) => ({ ...patch, page: prev.page }), { history }),
    [setUrl],
  );
  const openQuick = React.useCallback((r: ListingRow) => setPanel({ open: r.id, tool: undefined }), [setPanel]);
  const closePanel = React.useCallback(() => setPanel({ open: undefined, tool: undefined }, 'replace'), [setPanel]);

  const editorHref = React.useCallback(
    (id: string): string | null => config.editorHref(id, storeId),
    [config, storeId],
  );
  const openEditor = React.useCallback(
    (r: ListingRow) => {
      const href = editorHref(r.id);
      if (!href) {
        openQuick(r);
        return;
      }
      // ‹ › / j k and Back in the editor read the list's current page and URL state (listing-editor §1).
      writeEditorNav({
        marketplace,
        // Store-scoped marketplaces (Etsy `shop`, Wix `site`, Shopify `shop`) keep ‹ › inside the same store.
        shopId: config.storeParam ? storeId : null,
        ids: rows.map((x) => x.id),
        query: listQueryForEditor(),
      });
      void router.push(href);
    },
    [editorHref, router, openQuick, marketplace, storeId, rows, config.storeParam],
  );
  // Row click / Enter (founder follow-up, supersedes listings-grid §2 "row click = quick view"): the whole row opens
  // the listing in the full editor (the quick view when the marketplace has no editor route). The checkbox,
  // ✎ / ⋯ buttons and the inline price/qty cells stop the click in DataTable. A drag that selects title text does not
  // navigate.
  const openFromRow = React.useCallback(
    (r: ListingRow) => {
      if (rowClickIsTextSelection()) return;
      openEditor(r);
    },
    [openEditor],
  );
  const newHref = config.newListingHref(storeId);
  const bulkHref = config.bulkEditHref ? config.bulkEditHref(storeId) : null;
  // The quick view is the `md` peek (every marketplace has the full editor, M6b).

  // ── stage helpers ────────────────────────────────────────────────────────────────────────────────────
  const stageOne = React.useCallback(
    async (row: ListingRow, patch: StagePatch) => {
      try {
        await staged.stage(row.id, patch);
      } catch (err) {
        if ((err as { status?: number })?.status === 402) setSendLimitHit(true);
        toast.error(t('listings.cell.stageFailed'), { action: { onClick: () => void staged.stage(row.id, patch).catch(() => undefined) } });
        throw err;
      }
    },
    [staged, toast, t],
  );

  const onCellCommit = React.useCallback(
    (rowId: string, key: string, value: number | null) => {
      const row = knownRows.current.get(rowId);
      if (!row || value === null) return;
      const patch: StagePatch = key === 'price' ? { price: value } : key === 'qty' ? { qty: value } : {};
      if (!Object.keys(patch).length) return;
      void stageOne(row, patch).catch(() => undefined);
    },
    [stageOne],
  );

  const reportStaged = React.useCallback(
    (res: { ok: string[]; failed: string[] }) => {
      if (res.failed.length) toast.error(t('listings.tools.stageFailed', { count: res.failed.length }));
      else if (res.ok.length) toast.success(t('listings.tools.staged', { count: res.ok.length }));
    },
    [toast, t],
  );

  const stageActionFor = React.useCallback(
    async (targets: ListingRow[], action: StagedAction) => {
      const res = await staged.stageActions(
        targets.map((r) => r.id),
        action,
      );
      reportStaged(res);
    },
    [staged, reportStaged],
  );

  const discardRow = React.useCallback(
    (row: ListingRow) => {
      const sync = row.sync;
      if (!sync) return;
      const count = Math.max(1, sync.changedFields.length);
      void confirm({
        title: t('listings.action.discardConfirm', { count, title: row.title }),
        confirmLabel: t('listings.action.discard'),
        tone: 'danger',
      }).then(async (ok) => {
        if (!ok) return;
        try {
          await staged.discard([sync.draftId]);
          // Undo re-stages from the overlay, which holds price/qty/title only. It is offered only when that is the
          // whole draft; otherwise Undo would claim to restore tags, photos or queued actions it can't.
          const redo: StagePatch = { ...sync.draft };
          const restorable =
            !sync.queuedDelete && sync.changedFields.length > 0 && sync.changedFields.every((f) => UNDOABLE_FIELDS.has(f)) && Object.keys(redo).length > 0;
          toast.success(t('listings.action.discarded'), restorable ? { undo: () => void staged.stage(row.id, redo).catch(() => undefined) } : undefined);
        } catch {
          toast.error(t('listings.cell.stageFailed'));
        }
      });
    },
    [confirm, staged, toast, t],
  );

  const sendDeletion = React.useCallback(
    (row: ListingRow) => {
      const sync = row.sync;
      if (!sync?.queuedDelete) return;
      const typed = storeName || mpName;
      void confirm({
        title: t('listings.send.deletionConfirm', { kind: removalKind, title: row.title, on: t('listings.mp.on', { marketplace }), shop: typed }),
        confirmLabel: t('listings.action.deleteNow', { kind: removalKind }),
        tone: 'danger',
        typeToConfirm: typed,
      }).then(async (ok) => {
        if (!ok) return;
        try {
          const res = await staged.sendDeletion({ draftId: sync.draftId, id: row.id });
          if (res.sent.length) toast.success(t('listings.send.deletionSent', { kind: removalKind }));
          else toast.error(t('listings.send.failedGeneric'));
        } catch (err) {
          if ((err as { status?: number })?.status === 402) setSendLimitHit(true);
          else toast.error(t('listings.send.failedGeneric'));
        }
      });
    },
    [confirm, staged, toast, t, storeName, mpName, marketplace, removalKind],
  );

  const confirmDelete = React.useCallback(
    (targets: ListingRow[]) => {
      if (!targets.length) return;
      const many = targets.length > 1;
      void confirm({
        title: many ? t('listings.action.deleteManyConfirm', { count: targets.length }) : t('listings.action.deleteConfirm', { title: targets[0].title }),
        body: t('listings.action.deleteStagedNote', { on: t('listings.mp.on', { marketplace }) }),
        items: many ? targets.map((r) => r.title) : undefined,
        confirmLabel: many ? t('listings.action.deleteMany', { count: targets.length }) : t('listings.action.delete'),
        tone: 'danger',
        typeToConfirm: targets.length > 10 ? String(targets.length) : undefined,
      }).then((ok) => {
        if (ok) void stageActionFor(targets, { type: 'delete' });
      });
    },
    [confirm, t, marketplace, stageActionFor],
  );

  const openSchedule = React.useCallback((draftIds: string[]) => {
    if (!draftIds.length) return;
    setScheduleDrafts(draftIds);
    setModal('schedule');
  }, []);

  const sendRows = React.useCallback(
    (targets: ListingRow[]) => {
      const drafts = targets
        .filter((r) => r.sync && (r.sync.status === 'pending' || r.sync.status === 'sync_failed') && !r.sync.queuedDelete)
        .map((r) => ({ draftId: r.sync!.draftId, id: r.id }));
      void send.sendDrafts(drafts);
    },
    [send],
  );

  const copyHref = React.useCallback((r: ListingRow) => (newHref ? withQuery(newHref, 'copy', r.id) : null), [newHref]);

  // ── row actions (config order, filtered by row state) ────────────────────────────────────────────────
  const rowActions = React.useCallback(
    (r: ListingRow): ActionSpec[] => {
      const out: ActionSpec[] = [];
      const sync = r.sync;
      const open = sync && sync.status !== 'synced';
      const busy = sync?.status === 'syncing' || staged.sendingIds.has(r.id);
      // A queued removal must be the draft's only change (draft services: DELETE_NOT_EXCLUSIVE), so state
      // actions are not offered next to it, and Delete waits until other open changes are sent or discarded.
      const removalQueued = Boolean(open && sync.queuedDelete);
      for (const key of config.rowActions as RowActionKey[]) {
        switch (key) {
          case 'quickView':
            // Enter opens the editor while it is on, so the hint only shows when Enter opens this quick view.
            out.push({ id: key, label: t('listings.action.openQuick'), ...(editorHref(r.id) ? {} : { shortcut: 'enter' }), onClick: () => openQuick(r) });
            break;
          case 'viewExternal': {
            const href = config.externalUrl(r);
            if (href) out.push({ id: key, label: t('listings.action.viewOn', { marketplace: mpName }), icon: icons.externalLink, onClick: () => window.open(href, '_blank', 'noopener,noreferrer') });
            break;
          }
          case 'copyListing': {
            const href = copyHref(r);
            if (href) out.push({ id: key, label: t('listings.action.duplicate'), icon: icons.copy, href });
            break;
          }
          case 'copyToEbay':
          case 'copyToEtsy': {
            // Hidden when the target marketplace is known not connected (unknown while loading: shown).
            if ((key === 'copyToEbay' ? ebayConnected : etsyConnected) === false) break;
            const href = crosslistCreateHref(key, marketplace, r.id);
            if (href) out.push({ id: key, label: t(key === 'copyToEbay' ? 'listingEditor.action.copyToEbay' : 'listings.action.copyToEtsy'), icon: icons.copy, href });
            break;
          }
          case 'reviewDifferences':
            if (sync?.status === 'conflict' && editorHref(r.id)) out.push({ id: key, label: t('listings.action.reviewDiff'), onClick: () => openEditor(r) });
            break;
          case 'sendChange':
            if (open && !busy && (sync.status === 'pending' || sync.status === 'sync_failed') && !sync.queuedDelete) {
              out.push({ id: key, label: t('listings.send.thisChange'), icon: icons.push, disabled: Boolean(sendDisabledReason), disabledReason: sendDisabledReason, onClick: () => sendRows([r]) });
            }
            break;
          case 'scheduleSend':
            if (SCHEDULED_SENDS_ENABLED && open && !busy && sync.status === 'pending' && !sync.queuedDelete) {
              out.push({ id: key, label: t('listings.action.schedule'), icon: icons.schedule, onClick: () => openSchedule([sync.draftId]) });
            }
            break;
          case 'discardChanges':
            if (open && !busy) out.push({ id: key, label: t('listings.action.discard'), icon: icons.revert, onClick: () => discardRow(r) });
            break;
          case 'sendDeletion':
            if (open && !busy && sync.queuedDelete && sync.status !== 'conflict') {
              out.push({ id: key, label: t('listings.send.deletion', { kind: removalKind }), tone: 'danger', disabled: Boolean(sendDisabledReason), disabledReason: sendDisabledReason, onClick: () => sendDeletion(r) });
            }
            break;
          case 'deactivate':
            if (!removalQueued && (r.status === 'active' || r.status === 'sold_out')) out.push({ id: key, label: t('listings.action.deactivate'), onClick: () => void stageActionFor([r], { type: 'deactivate' }) });
            break;
          case 'activate':
            if (!removalQueued && (r.status === 'inactive' || r.status === 'draft')) out.push({ id: key, label: t('listings.action.activate'), onClick: () => void stageActionFor([r], { type: 'activate' }) });
            break;
          case 'renew':
            if (!removalQueued && (r.status === 'expired' || r.status === 'sold_out')) out.push({ id: key, label: t('listings.action.renew'), onClick: () => void stageActionFor([r], { type: 'renew' }) });
            break;
          case 'unarchive':
            if (!removalQueued && isArchivedRow(r)) {
              const pendingOther = hasOpenChanges(r);
              out.push({
                id: key,
                label: t('listings.action.unarchive'),
                disabled: pendingOther,
                disabledReason: pendingOther ? t('listings.action.unarchiveNeedsAlone') : undefined,
                onClick: () => void stageActionFor([r], { type: 'unarchive' }),
              });
            }
            break;
          case 'archive':
            if (!removalQueued && r.status !== 'inactive' && !isArchivedRow(r)) {
              const pendingOther = hasOpenChanges(r);
              out.push({
                id: key,
                label: t('listings.action.archive'),
                disabled: pendingOther,
                disabledReason: pendingOther ? t('listings.action.removalNeedsAlone', { kind: 'archive' }) : undefined,
                onClick: () => void stageActionFor([r], { type: 'archive' }),
              });
            }
            break;
          case 'showInStore':
            if (!removalQueued && (r.extra.visible === false || r.status === 'inactive')) out.push({ id: key, label: t('listings.action.showInStore'), onClick: () => void stageActionFor([r], { type: 'show' }) });
            break;
          case 'hideInStore':
            if (!removalQueued && r.extra.visible !== false && r.status !== 'inactive') out.push({ id: key, label: t('listings.action.hideInStore'), onClick: () => void stageActionFor([r], { type: 'hide' }) });
            break;
          case 'delete':
            if (!removalQueued) {
              const pendingOther = hasOpenChanges(r);
              out.push({
                id: key,
                label: t('listings.action.delete'),
                icon: icons.delete,
                tone: 'danger',
                disabled: pendingOther,
                disabledReason: pendingOther ? t('listings.action.removalNeedsAlone', { kind: 'delete' }) : undefined,
                onClick: () => confirmDelete([r]),
              });
            }
            break;
          default:
            break;
        }
      }
      return out;
    },
    [config, t, mpName, copyHref, marketplace, editorHref, openEditor, openQuick, sendRows, openSchedule, discardRow, sendDeletion, stageActionFor, confirmDelete, sendDisabledReason, staged.sendingIds, removalKind, ebayConnected, etsyConnected],
  );

  const inlineAction = React.useCallback(
    (r: ListingRow): ActionSpec => ({ id: 'edit', label: t('listings.action.edit'), icon: icons.edit, shortcut: 'e', onClick: () => openEditor(r) }),
    [t, openEditor],
  );

  // Etsy shops other than the open one ("Copy to another shop…", shop names in the new-listings list).
  const otherStores = React.useMemo(() => (data?.stores ?? []).filter((s) => s.id !== storeId), [data?.stores, storeId]);
  const storeNameOf = React.useCallback((id: string) => data?.stores.find((s) => s.id === id)?.name ?? null, [data?.stores]);

  // Change price on listings with variations (Etsy): the same change on every variation, staged as inventory.
  const stageVariationPrices = React.useMemo(() => {
    if (!staged.adapter.stagesEtsyExtras || !storeId) return undefined;
    return async (targets: ListingRow[], op: { mode: Parameters<typeof priceModeToOp>[0]; value: number; round: '99' | '00' | 'none'; match?: VariationMatch | null }) => {
      const { patches, skipped } = await buildVariationPriceInventories(storeId, targets.map((r) => r.id), [priceModeToOp(op.mode, op.value)], {
        round: op.round,
        minPrice: config.validation.priceMin,
        match: op.match,
      });
      const res = patches.length
        ? await staged.stageMany(
            patches.map((p) => {
              const patch: ExtendedStagePatch = { etsy: { inventory: p.inventory } };
              return { id: p.id, patch };
            }),
          )
        : { ok: [], failed: [] };
      if (res.failed.length) toast.error(t('listings.tools.stageFailed', { count: res.failed.length }));
      else if (skipped.length) toast.info(t('listings.price.variationsSkipped', { count: skipped.length }));
      else if (res.ok.length) toast.success(t('listings.tools.staged', { count: res.ok.length }));
      if (!res.failed.length) clearSelection();
    };
  }, [staged, storeId, config.validation.priceMin, toast, t, clearSelection]);

  // ── bulk bar (§6.3) ──────────────────────────────────────────────────────────────────────────────────
  const loadTags = React.useCallback(
    async (targets: ListingRow[]) => {
      const p = storeSearchParams({ marketplace, store: data?.store ?? null, query: { marketplace, store: storeId ?? undefined } });
      p.set('ids', targets.map((r) => r.id).join(','));
      const csv = readListingsCsv(await fetchToolText(`/api/listings/export?${p.toString()}`));
      const map = new Map<string, string[] | null>();
      for (const r of targets) map.set(r.id, csv.get(r.id)?.tags ?? null);
      return map;
    },
    [marketplace, data?.store, storeId],
  );

  // Live Etsy materials for "Set field… → Materials → Add / Remove" (the export's `materials` column).
  const loadMaterials = React.useCallback(
    async (targets: ListingRow[]) => {
      const p = storeSearchParams({ marketplace, store: data?.store ?? null, query: { marketplace, store: storeId ?? undefined } });
      p.set('ids', targets.map((r) => r.id).join(','));
      const csv = readListingsCsv(await fetchToolText(`/api/listings/export?${p.toString()}`));
      const map = new Map<string, string[] | null>();
      for (const r of targets) map.set(r.id, csv.get(r.id)?.materials ?? null);
      return map;
    },
    [marketplace, data?.store, storeId],
  );

  // Live Etsy descriptions for "Set field… → Description → Add before / after" (export with includeDescription).
  const loadDescriptions = React.useCallback(
    async (targets: ListingRow[]) => {
      const p = storeSearchParams({ marketplace, store: data?.store ?? null, query: { marketplace, store: storeId ?? undefined } });
      p.set('ids', targets.map((r) => r.id).join(','));
      p.set('includeDescription', '1');
      const csv = readListingsCsv(await fetchToolText(`/api/listings/export?${p.toString()}`));
      const map = new Map<string, string | null>();
      for (const r of targets) map.set(r.id, csv.get(r.id)?.description ?? null);
      return map;
    },
    [marketplace, data?.store, storeId],
  );

  // Bulk edits skip rows with a queued removal (the draft service rejects any other change next to it).
  const editableTargets = React.useCallback(
    (targets: ListingRow[]): ListingRow[] | null => {
      const ok = targets.filter((r) => !(r.sync?.queuedDelete && r.sync.status !== 'synced'));
      const skipped = targets.length - ok.length;
      if (skipped) toast.info(t('listings.bulk.skippedRemovals', { count: skipped, kind: removalKind }));
      return ok.length ? ok : null;
    },
    [toast, t, removalKind],
  );

  const runBulk = React.useCallback(
    (key: BulkActionKey) => {
      const targets = selectedRows;
      switch (key) {
        case 'editInGrid':
          if (bulkHref) {
            const href = selectAllInView ? withQuery(bulkHref, 'view', activeView) : withQuery(bulkHref, 'ids', targets.map((r) => r.id).join(','));
            void router.push(href);
          }
          return;
        case 'improveWithAi':
          if (bulkHref) {
            const base = selectAllInView ? withQuery(bulkHref, 'view', activeView) : withQuery(bulkHref, 'ids', targets.map((r) => r.id).join(','));
            void router.push(withQuery(base, 'ai', '1'));
          }
          return;
        case 'changePrice':
        case 'changeStock': {
          const rowsFor = editableTargets(targets);
          if (!rowsFor) return;
          setModalRows(rowsFor);
          setModal(key === 'changePrice' ? 'price' : 'stock');
          return;
        }
        case 'addTags': {
          const rowsFor = editableTargets(targets);
          if (!rowsFor) return;
          setModalRows(rowsFor);
          void loadTags(rowsFor)
            .then((m) => {
              setTagLookup(m);
              setModal('tags');
            })
            .catch(() => toast.error(t('listings.tools.loadFailed')));
          return;
        }
        case 'setField': {
          const rowsFor = editableTargets(targets);
          if (!rowsFor) return;
          setModalRows(rowsFor);
          setModal('setField');
          return;
        }
        case 'copyToShop':
          setModalRows(targets);
          setModal('copyShop');
          return;
        case 'sendSelected':
          sendRows(targets);
          return;
        case 'discardSelected': {
          const ids = targets.filter((r) => r.sync && r.sync.status !== 'synced' && r.sync.status !== 'syncing').map((r) => r.sync!.draftId);
          if (!ids.length) return;
          void confirm({ title: t('listings.bulk.discardConfirm', { count: ids.length }), confirmLabel: t('listings.action.discard'), tone: 'danger' }).then(async (ok) => {
            if (!ok) return;
            try {
              await staged.discard(ids);
              toast.success(t('listings.action.discarded'));
            } catch {
              toast.error(t('listings.cell.stageFailed'));
            }
          });
          return;
        }
        case 'scheduleSend':
          openSchedule(targets.filter((r) => r.sync?.status === 'pending' && !r.sync.queuedDelete).map((r) => r.sync!.draftId));
          return;
        case 'exportSelected':
          // "Select all N in this view" exports the view, not just the loaded page.
          setExportScope(selectAllInView ? 'view' : 'selected');
          setPanel({ tool: 'export' });
          return;
        case 'deactivate':
        case 'activate':
        case 'renew':
        case 'showInStore':
        case 'hideInStore': {
          const rowsFor = editableTargets(targets);
          if (rowsFor) void stageActionFor(rowsFor, { type: key === 'showInStore' ? 'show' : key === 'hideInStore' ? 'hide' : key });
          return;
        }
        case 'unarchive': {
          // Only archived rows without other open changes (an unarchive is sent alone).
          const archived = targets.filter((r) => isArchivedRow(r) && !(r.sync?.queuedDelete && r.sync.status !== 'synced'));
          const alone = archived.filter((r) => !hasOpenChanges(r));
          const skipped = targets.length - alone.length;
          if (skipped) toast.info(t('listings.bulk.unarchiveSkipped', { count: skipped }));
          if (alone.length) void stageActionFor(alone, { type: 'unarchive' });
          return;
        }
        case 'archive':
        case 'delete': {
          // A removal is staged alone: rows that already queue one, or hold other open changes, are skipped.
          const notQueued = targets.filter((r) => !(r.sync?.queuedDelete && r.sync.status !== 'synced'));
          const alone = notQueued.filter((r) => !hasOpenChanges(r));
          const busyRows = notQueued.length - alone.length;
          if (busyRows) toast.info(t('listings.bulk.skippedOpenChanges', { count: busyRows, kind: key }));
          if (!alone.length) return;
          if (key === 'delete') confirmDelete(alone);
          else void stageActionFor(alone, { type: 'archive' });
          return;
        }
        default:
          return;
      }
    },
    [selectedRows, bulkHref, selectAllInView, activeView, router, loadTags, toast, t, sendRows, confirm, staged, openSchedule, setPanel, stageActionFor, confirmDelete, editableTargets],
  );

  const bulkLabel = (key: BulkActionKey, count: number): string | null => {
    switch (key) {
      // BulkGrid is desktop-only (§6.5: not offered below 900px), so the mobile primary falls back to Change price.
      case 'editInGrid':
        return bulkHref && !mobile ? t('listings.bulk.editInGrid') : null;
      case 'improveWithAi':
        return bulkHref && !mobile ? t('listings.bulk.improveAi') : null;
      case 'changePrice':
        return t('listings.bulk.changePrice');
      case 'changeStock':
        return t('listings.bulk.changeStock');
      case 'addTags':
        return config.tags ? t('listings.bulk.addTags') : null;
      case 'setField':
        return staged.adapter.stagesEtsyExtras && storeId ? t('listings.action.setField') : null;
      case 'copyToShop':
        return staged.adapter.stagesCopyToShop && otherStores.length > 0 ? t('listings.action.copyToShop') : null;
      case 'sendSelected':
        return selectedRows.some((r) => r.sync && (r.sync.status === 'pending' || r.sync.status === 'sync_failed') && !r.sync.queuedDelete) ? t('listings.send.selected') : null;
      case 'discardSelected':
        return selectedRows.some((r) => r.sync && r.sync.status !== 'synced' && r.sync.status !== 'syncing') ? t('listings.bulk.discardSelected') : null;
      case 'scheduleSend':
        return SCHEDULED_SENDS_ENABLED && selectedRows.some((r) => r.sync?.status === 'pending' && !r.sync.queuedDelete) ? t('listings.action.schedule') : null;
      case 'exportSelected':
        return t('listings.bulk.exportSelected');
      case 'deactivate':
        return t('listings.action.deactivate');
      case 'activate':
        return t('listings.action.activate');
      case 'renew':
        return t('listings.action.renew');
      case 'archive':
        return t('listings.action.archive');
      case 'unarchive':
        return selectedRows.some(isArchivedRow) ? t('listings.action.unarchive') : null;
      case 'showInStore':
        return t('listings.action.showInStore');
      case 'hideInStore':
        return t('listings.action.hideInStore');
      case 'delete':
        return t('listings.action.deleteMany', { count });
      default:
        return null;
    }
  };
  const bulkSpec = (key: BulkActionKey): ActionSpec | null => {
    const label = bulkLabel(key, selectedIds.length);
    if (!label) return null;
    // These follow "Select all N in this view" (?view= / export scope 'view'); the rest act on loaded rows only.
    const viewAware = key === 'editInGrid' || key === 'improveWithAi' || key === 'exportSelected';
    const disabledForAll = selectAllInView && !viewAware;
    return {
      id: `bulk-${key}`,
      label,
      tone: key === 'delete' ? 'danger' : 'default',
      icon: key === 'improveWithAi' ? icons.ai : key === 'delete' ? icons.delete : undefined,
      disabled: disabledForAll,
      disabledReason: disabledForAll ? t('listings.bulk.pageOnly') : undefined,
      onClick: () => runBulk(key),
    };
  };
  const bulkPrimaryKey = bulkLabel(config.bulkPrimary, selectedIds.length) ? config.bulkPrimary : config.bulkActions.find((k) => bulkLabel(k, selectedIds.length));
  const bulkPrimary = bulkPrimaryKey ? bulkSpec(bulkPrimaryKey) : null;
  const bulkActions = config.bulkActions.filter((k) => k !== bulkPrimaryKey).map(bulkSpec).filter((a): a is ActionSpec => Boolean(a)).slice(0, 4);
  const bulkOverflow = config.bulkOverflow.map(bulkSpec).filter((a): a is ActionSpec => Boolean(a));
  const knownTotal = list.total;
  const selection: BulkActionBarProps | undefined =
    selectedIds.length > 0
      ? {
          count: selectAllInView && knownTotal !== undefined ? knownTotal : selectedIds.length,
          primary: bulkPrimary ?? undefined,
          actions: bulkActions,
          overflow: bulkOverflow,
          onClear: clearSelection,
          selectAll:
            knownTotal !== undefined && knownTotal > selectedIds.length && bulkHref && !mobile
              ? { total: knownTotal, active: selectAllInView, onChange: setSelectAllInView, label: t('listings.bulk.selectAllInView', { count: knownTotal }) }
              : undefined,
        }
      : undefined;

  // ── tools (G6) ───────────────────────────────────────────────────────────────────────────────────────
  const activity = config.headerLinks?.find((l) => l.key === 'activity');
  const toolItems = useToolsMenuItems({
    tools: config.tools.filter((k) => k !== 'scheduled' || SCHEDULED_SENDS_ENABLED),
    onOpen: (tool) => {
      setExportScope(undefined);
      setPanel({ tool, open: undefined });
    },
    activityHref: activity ? activity.href(storeId) : null,
    disabledReason: notConnected ? t('listings.empty.connectTitle', { marketplace: mpName }) : null,
  });
  const toolCtx: ListingsToolContext = React.useMemo(
    () => ({
      marketplace,
      store: data?.store ? { id: data.store.id, name: data.store.name, currency: data.store.currency } : null,
      query,
      viewCount: knownTotal ?? 0,
      allCount: counts?.all ?? 0,
      selectedIds,
      adapter: staged.adapter,
      editorHref: (id: string) => editorHref(id) ?? withQuery(config.route, 'open', id),
      onChanged: () => void list.mutate(),
    }),
    [marketplace, data?.store, query, knownTotal, counts?.all, selectedIds, staged.adapter, editorHref, config.route, list],
  );

  // ── header (§2, §6.2, §6.3) ──────────────────────────────────────────────────────────────────────────
  const pullNow = React.useCallback(async () => {
    const before = counts?.all;
    const res = await pull.run();
    if (res.ok && typeof res.synced === 'number' && res.synced !== before) toast.success(t('listings.meta.refreshToast', { count: res.synced }));
  }, [pull, counts?.all, toast, t]);

  const newAction: ActionSpec | null = newHref
    ? { id: 'newListing', label: t('listings.action.new'), icon: icons.add, shortcut: 'n', onClick: () => void router.push(newHref) }
    : null;
  const bulkEditAction: ActionSpec | null = bulkHref && !mobile ? { id: 'bulkEdit', label: t('listings.action.bulkEdit'), href: bulkHref } : null;
  const refreshAction: ActionSpec = {
    id: 'refresh',
    label: t('listings.meta.refresh', { from }),
    icon: icons.pull,
    loading: pull.state === 'pulling',
    disabled: pull.state === 'pulling' || Boolean(sendDisabledReason) || notConnected,
    disabledReason: sendDisabledReason,
    onClick: () => void pullNow(),
  };
  const selecting = selectedIds.length > 0;
  let headerPrimary: ActionSpec | undefined;
  let headerSecondary: ActionSpec[] = [];
  if (selecting) {
    headerSecondary = [send.action, bulkEditAction].filter((a): a is ActionSpec => Boolean(a));
  } else if (send.action) {
    headerPrimary = send.action;
    headerSecondary = [newAction, bulkEditAction].filter((a): a is ActionSpec => Boolean(a));
  } else {
    headerPrimary = newAction ?? undefined;
    headerSecondary = [bulkEditAction].filter((a): a is ActionSpec => Boolean(a));
  }
  const headerOverflow: ActionSpec[] = [...toolItems, refreshAction, ...(selecting && newAction ? [newAction] : [])];

  // ⌘K: saved views as "Go to view: …" (header actions register themselves through PageHeader).
  const viewCommands = React.useMemo<Command[]>(
    () =>
      views.map((v) => ({
        id: `listings.${marketplace}.view.${v.id}`,
        label: t('listings.view.goTo', { view: v.label }),
        group: 'goto' as const,
        brand: marketplace,
        run: () => selectView(v.id),
      })),
    [views, marketplace, t, selectView],
  );
  useCommands(viewCommands);

  useListingsShortcuts({
    onSend: send.action && !send.action.disabled ? () => void send.run() : undefined,
    sendLabel: send.action?.label,
    onNew: newAction ? () => newAction.onClick?.() : undefined,
    newLabel: newAction?.label,
    enabled: !openId && !url.tool && modal === null,
  });

  // ── legacy localStorage scheduled updates → one-time migration (§13) ─────────────────────────────────
  // Only this store's entries are offered; storage keeps every entry that was not staged (other shops, failures,
  // changes the adapter can't carry) and the key is removed only when nothing is left.
  const legacyKey = legacyScheduleKey(marketplace);
  const [legacyAll, setLegacyAll] = React.useState<LegacyScheduledUpdate[]>([]);
  const readLegacyRaw = React.useCallback((): string | null => {
    if (!legacyKey) return null;
    try {
      return window.localStorage.getItem(legacyKey);
    } catch {
      return null;
    }
  }, [legacyKey]);
  React.useEffect(() => {
    setLegacyAll(parseLegacySchedules(readLegacyRaw()));
  }, [readLegacyRaw]);
  const stagesDescription = Boolean(staged.adapter.stagesDescription);
  const legacySplit = React.useMemo(
    () => (storeId || legacyAll.every((u) => u.shopId === null) ? legacyForStore(legacyAll, storeId, { stagesDescription }) : { movable: [], kept: [] }),
    [legacyAll, storeId, stagesDescription],
  );
  const legacy = legacySplit.movable;
  const migrateLegacy = React.useCallback(async () => {
    if (!legacyKey || !legacy.length) return;
    const ok = await confirm({
      title: t('listings.legacySchedule.confirm', { count: legacy.length }),
      body: SCHEDULED_SENDS_ENABLED ? t('listings.legacySchedule.bodyScheduled') : t('listings.legacySchedule.bodyStaged'),
      confirmLabel: t('listings.legacySchedule.cta', { count: legacy.length }),
    });
    if (!ok) return;
    const stagedRaw: string[] = [];
    let failed = 0;
    for (const u of legacy) {
      try {
        const at = new Date(u.scheduledAt);
        const future = Number.isFinite(at.getTime()) && at.getTime() > Date.now();
        await staged.adapter.stage(u.listingId, u.changes, SCHEDULED_SENDS_ENABLED && future ? { scheduledSendAt: at.toISOString() } : undefined);
        stagedRaw.push(u.raw);
      } catch {
        failed += 1;
      }
    }
    // Re-read so entries the old tool wrote meanwhile are kept too.
    const remaining = remainingLegacyRaw(readLegacyRaw(), stagedRaw);
    try {
      if (remaining.length) window.localStorage.setItem(legacyKey, JSON.stringify(remaining));
      else window.localStorage.removeItem(legacyKey);
    } catch {
      /* storage unavailable: the banner state below still reflects what was staged */
    }
    setLegacyAll(parseLegacySchedules(remaining.length ? JSON.stringify(remaining) : null));
    void list.mutate();
    // One toast (a later one replaces an earlier one): failures first, then what was kept, then the success.
    if (failed) toast.error(t('listings.tools.stageFailed', { count: failed }));
    else if (legacySplit.kept.length) toast.info(t('listings.legacySchedule.kept', { count: legacySplit.kept.length }));
    else if (stagedRaw.length) toast.success(t('listings.tools.staged', { count: stagedRaw.length }));
  }, [legacyKey, legacy, legacySplit.kept.length, confirm, t, staged.adapter, list, toast, readLegacyRaw]);

  // ── meta line (pull + freshness) ─────────────────────────────────────────────────────────────────────
  const meta =
    notConnected || !data ? null : (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <SyncMeta
          source={mpName}
          lastPulledAt={data.store.lastPulledAt}
          state={pull.state}
          onPull={() => void pullNow()}
          pullDisabledReason={sendDisabledReason}
          copy={{
            refreshed: (ago) => t('listings.meta.refreshed', { from, ago }),
            refreshing: t('listings.meta.refreshing', { from }),
            failed: t('listings.meta.refreshFailed', { from }),
            pullLabel: t('listings.meta.refresh', { from }),
          }}
          now={now}
          data-testid="listings-sync-meta"
        />
        {/* Phones: one freshness line ("Refreshed … ago"), not two. */}
        {FRESHNESS_CHIP[marketplace] && storeId && !mobile ? <CacheFreshnessChip shopId={storeId} /> : null}
      </Box>
    );

  // ── table state ──────────────────────────────────────────────────────────────────────────────────────
  const filtered = hasActiveFilters(url);
  const emptyKind = list.state === 'ready' || list.state === 'stale' ? listingsEmptyKind({ data, view: activeView, filtered }) : null;
  const sortParts = splitSortKey(url.sort as ListingSortKey);
  const sortColumn = Object.entries(COLUMN_SORT_FIELD).find(([, f]) => f === sortParts.field)?.[0] ?? null;
  const filterValues: FilterValues = React.useMemo(() => toFilterValues(url, config.filters), [url, config.filters]);
  const clearFilters = React.useCallback(() => setUrl(viewPatch(activeView, userViews.views, config)), [setUrl, activeView, userViews.views, config]);

  const title = t('listings.title', { marketplace });
  // TopBar breadcrumb shop switch (`Listings / [E] Etsy / Belle Couture Gifts ▾`, §1.1): the URL `?shop=` / `?site=`.
  const storeParam = config.storeParam;
  const breadcrumbs: PageBreadcrumb[] | undefined =
    storeParam && data && storeName
      ? [
          {
            label: storeName,
            menu:
              data.stores.length > 1
                ? data.stores.map((s) => ({ label: s.name, href: withQuery(config.route, storeParam, s.id) }))
                : undefined,
          },
        ]
      : undefined;

  // ── render ───────────────────────────────────────────────────────────────────────────────────────────
  if (notConnected) {
    return (
      <Page title={title} width="list">
        <PageHeader title={title} data-testid="listings-header" />
        <ConnectState
          brand={marketplace}
          title={t('listings.empty.connectTitle', { marketplace: mpName })}
          connectHref={CONNECT_HREF}
          data-testid="listings-connect"
        />
      </Page>
    );
  }

  const failureBanner = (
    <FailureBanner marketplace={marketplace} sync={counts?.sync} onShow={activeView === 'send_failed' ? undefined : () => selectView('send_failed')} t={t} />
  );

  return (
    <Page title={title} width="list" breadcrumbs={breadcrumbs} mobileAction={newAction ?? undefined}>
      <PageHeader
        title={title}
        count={counts?.all}
        meta={meta}
        primaryAction={mobile ? undefined : headerPrimary}
        secondaryActions={headerSecondary}
        overflowActions={headerOverflow}
        mobilePrimary="none"
        data-testid="listings-header"
      />

      {needsReauth ? (
        <Box sx={{ mb: '8px' }}>
          <Banner
            tone="warning"
            title={reconnectText}
            action={{ id: 'reconnect', label: t('listings.banner.reconnectCta', { marketplace: mpName }), href: CONNECT_HREF }}
            data-testid="listings-reconnect"
          />
        </Box>
      ) : couldntCheck ? (
        <Box sx={{ mb: '8px' }}>
          <Banner
            tone="neutral"
            title={t('listings.banner.couldntCheck', { marketplace: mpName })}
            action={{ id: 'retryCheck', label: t('listings.banner.retry'), onClick: () => void connections.mutate() }}
            data-testid="listings-couldnt-check"
          />
        </Box>
      ) : null}

      {limitHit ? (
        <Box sx={{ mb: '8px' }}>
          <Banner
            tone="warning"
            title={limitText}
            action={stripeUpsell ? { id: 'seePlans', label: t('listings.error.seePlans'), href: `/fiyatlandirma?from=listings-${marketplace}` } : undefined}
            data-testid="listings-limit-banner"
          />
        </Box>
      ) : null}

      {failureBanner}

      {staged.adapter.listNewListings ? (
        <NewDraftsBanner
          marketplaceName={mpName}
          load={staged.adapter.listNewListings}
          version={data}
          hrefFor={(d) => (d.listingId ? editorHref(d.listingId) : null) ?? (newHref ? withQuery(newHref, 'draft', d.draftId) : null)}
          shopName={storeNameOf}
          discard={(id) => staged.discard([id])}
          t={t}
        />
      ) : null}

      {legacy.length ? (
        <Box sx={{ mb: '8px' }}>
          <Banner
            tone="info"
            title={t('listings.legacySchedule.banner', { count: legacy.length })}
            action={{ id: 'reviewLegacy', label: t('listings.legacySchedule.review'), onClick: () => void migrateLegacy() }}
            data-testid="listings-legacy-schedules"
          />
        </Box>
      ) : null}

      {list.state === 'stale' || pull.partial ? (
        <Box sx={{ mb: '8px' }}>
          <ErrorState variant="stale" staleSince={list.lastGoodAt ?? undefined} onRetry={() => void list.mutate()} data-testid="listings-stale" />
        </Box>
      ) : null}

      <ListingsToolbar
        config={config}
        t={t}
        storeId={storeId}
        storeCurrency={storeCurrency}
        rows={rows}
        search={url.q ?? ''}
        onSearch={(q) => setUrl({ q: q || undefined })}
        values={filterValues}
        onChange={(v) => setUrl(fromFilterValues(v, config.filters))}
        onClearAll={clearFilters}
        resultCount={knownTotal}
        updating={list.refetching}
        filtered={filtered}
        views={views}
        activeView={activeView}
        onSelectView={selectView}
        onSaveView={(label) => {
          const v = userViews.save(label, savedViewQuery(url));
          setUrl({ view: v.id });
        }}
        onDeleteView={(id) => {
          userViews.remove(id);
          if (url.view === id) selectView(config.defaultView);
        }}
        density={density}
        onDensity={(d) => {
          setDensity(d);
          writeDensity(marketplace, d);
        }}
        selection={selection}
      />

      <ListingsTable
        rows={rows}
        columns={columns}
        state={list.state}
        emptyKind={emptyKind}
        mobile={mobile}
        t={t}
        marketplace={marketplace}
        marketplaceName={mpName}
        storeName={storeName}
        refetching={list.refetching}
        onRetry={list.retry}
        errorId={list.error?.errorId}
        onClearFilters={clearFilters}
        onFirstPull={() => void pullNow()}
        pulling={pull.state === 'pulling'}
        newListing={newAction ?? undefined}
        selection={{
          ids: selectedIds,
          onChange: (ids) => {
            setSelectedIds(ids);
            if (!ids.length) setSelectAllInView(false);
          },
        }}
        onRowOpen={openFromRow}
        onRowEdit={openEditor}
        // Cards: the whole card opens the editor, so no full-width "Edit" button per card (⋯ stays).
        inlineAction={mobile ? undefined : inlineAction}
        rowActions={rowActions}
        onCellCommit={onCellCommit}
        dirtyCells={dirtyCells}
        density={density}
        sort={sortColumn ? { key: sortColumn, dir: sortParts.dir } : null}
        onSortChange={(s) => {
          const field = COLUMN_SORT_FIELD[s.key];
          if (field) setUrl({ sort: `${field}.${s.dir}` as ListingSortKey });
        }}
        page={url.page}
        pageSize={url.size as ListingPageSize}
        total={knownTotal}
        onPage={({ page, pageSize }) => setUrl({ page, size: pageSize })}
        columnStateKey={config.columnStateKey}
        unscored={counts?.unscored}
        activeRowId={openId}
        ariaLabel={title}
        mobileCountLabel={
          list.refetching ? t('listings.toolbar.updating') : knownTotal !== undefined ? t('listings.toolbar.results', { count: knownTotal }) : undefined
        }
      />

      {mobile && !selecting ? <SendChangesBar action={send.action} unsent={unsent} t={t} /> : null}

      <QuickViewPanel
        row={openRow}
        open={Boolean(openRow) && !url.tool}
        size="md"
        editTitle={false}
        ctx={cellCtx}
        t={t}
        onClose={closePanel}
        onPrev={openIndex > 0 ? () => setPanel({ open: rows[openIndex - 1].id }, 'replace') : undefined}
        onNext={
          openIndex >= 0 && openIndex < rows.length - 1
            ? () => setPanel({ open: rows[openIndex + 1].id }, 'replace')
            : openIndex === rows.length - 1 && knownTotal !== undefined && url.page * url.size < knownTotal
              ? () => setUrl({ page: url.page + 1, open: undefined })
              : undefined
        }
        onStage={stageOne}
        onSend={(r) => sendRows([r])}
        onDiscard={discardRow}
        onOpenEditor={editorHref(openRow?.id ?? 'x') ? (r) => openEditor(r) : null}
        onReviewDifferences={editorHref(openRow?.id ?? 'x') ? (r) => openEditor(r) : null}
        rowActions={(r) => rowActions(r).filter((a) => a.id !== 'quickView')}
        sendDisabledReason={sendDisabledReason}
      />

      <ChangePriceModal
        open={modal === 'price'}
        onClose={() => setModal(null)}
        rows={modalRows}
        currency={storeCurrency}
        priceMin={config.validation.priceMin}
        currentPrice={(r) => displayPrice(r, staged.overlays)}
        // Trendyol: list price moves with the sale price (a sale price above the list price is rejected).
        currentListPrice={marketplace === 'trendyol' ? (r) => displayListPrice(r, staged.overlays) : undefined}
        formatMoney={formatMoney}
        onStageVariations={stageVariationPrices}
        onStage={async (patches) => {
          const res = await staged.stageMany(patches);
          reportStaged(res);
          if (!res.failed.length) clearSelection();
          return res;
        }}
        t={t}
      />
      <ChangeStockModal
        open={modal === 'stock'}
        onClose={() => setModal(null)}
        rows={stockModalRows}
        qtyMax={config.validation.qtyMax}
        currentQty={(r) => displayQty(r, staged.overlays)}
        onStage={async (patches) => {
          const res = await staged.stageMany(patches);
          reportStaged(res);
          if (!res.failed.length) clearSelection();
          return res;
        }}
        t={t}
      />
      {config.tags ? (
        <AddTagsModal
          open={modal === 'tags'}
          onClose={() => setModal(null)}
          rows={modalRows}
          limits={config.tags}
          currentTags={(r) => tagLookup.get(r.id) ?? null}
          onStage={async (patches) => {
            const res = await staged.stageMany(patches);
            reportStaged(res);
            if (!res.failed.length) clearSelection();
            return res;
          }}
          t={t}
        />
      ) : null}
      <SetFieldModal
        open={modal === 'setField'}
        onClose={() => setModal(null)}
        rows={modalRows}
        shopId={storeId}
        loadMaterials={loadMaterials}
        loadDescriptions={loadDescriptions}
        onStage={async (patches) => {
          const res = await staged.stageMany(patches);
          reportStaged(res);
          if (!res.failed.length) clearSelection();
          return res;
        }}
      />
      {staged.adapter.stagesCopyToShop ? (
        <CopyToShopModal
          open={modal === 'copyShop'}
          onClose={() => setModal(null)}
          rows={modalRows}
          shops={otherStores}
          onStage={async (targets, targetShopId) => {
            const res = await staged.stageActions(
              targets.map((r) => r.id),
              { type: 'copy', targetShopId },
            );
            if (res.failed.length) toast.error(t('listings.tools.stageFailed', { count: res.failed.length }));
            else if (res.ok.length) {
              toast.success(t('listings.copyToShop.staged', { count: res.ok.length, shop: storeNameOf(targetShopId) ?? targetShopId }));
              clearSelection();
            }
          }}
          t={t}
        />
      ) : null}
      {SCHEDULED_SENDS_ENABLED ? (
        <ScheduleSendModal
          open={modal === 'schedule'}
          onClose={() => setModal(null)}
          count={scheduleDrafts.length}
          timezone={timezone}
          now={now}
          onSchedule={async (at) => {
            try {
              await staged.schedule(scheduleDrafts, at);
              toast.success(t('listings.sched.done', { count: scheduleDrafts.length }));
            } catch {
              toast.error(t('listings.sched.sendFailed'));
              throw new Error('schedule failed');
            }
          }}
          t={t}
        />
      ) : null}

      {/* Tools (G6), driven by ?tool= so a reload restores them. */}
      <FindReplacePanel open={url.tool === 'findReplace'} onClose={closePanel} ctx={toolCtx} />
      <DuplicatesPanel open={url.tool === 'duplicates'} onClose={closePanel} ctx={toolCtx} />
      <CsvImportPanel open={url.tool === 'import'} onClose={closePanel} ctx={toolCtx} />
      <ExportCsvModal open={url.tool === 'export'} onClose={closePanel} ctx={toolCtx} initialScope={exportScope} />
      {SCHEDULED_SENDS_ENABLED ? <ScheduledSendsPanel open={url.tool === 'scheduled'} onClose={closePanel} ctx={toolCtx} /> : null}
    </Page>
  );
}

export default ListingsPage;

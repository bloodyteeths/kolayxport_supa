// components/domain/listings/columns.tsx — listings-grid §4: one master column list, the config picks (G5).
// Cell rules: the draft value overlays the live value (attention tint via `dirtyCells`, tooltip "On Etsy: $54.00");
// read-only edit cells carry their reason; ScoreMeter null renders "—" with "Not scored yet"; at most one sync
// pill; money only through Money and dates only through DateText.
import * as React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import type { Column } from '@/components/ds/data';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Money } from '@/components/ds/format/Money';
import { DateText } from '@/components/ds/format/DateText';
import { neutral, tone } from '@/lib/ds/tokens';
import { LISTING_EDITABLE_REASON_I18N, type ListingColumnKey, type ListingDraftOverlay, type ListingRow, type ListingSyncKey } from '@/lib/listings/types';
import type { ListingsConfig } from './config/types';
import { StockManagedQty } from './stockManaged';

/** Root-level translator (`useTranslations()`), full key paths. */
export type ListingsT = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has?: (key: string) => boolean;
};

export type ListingCellContext = {
  config: Pick<ListingsConfig, 'marketplace' | 'inlineEdit' | 'validation' | 'columns' | 'hiddenByDefault'>;
  /** Proper noun ("Etsy"). */
  marketplaceName: string;
  /** Public listing page on the marketplace (the visible "View on Etsy ↗" link next to the ID). */
  externalUrl?: (r: ListingRow) => string | null | undefined;
  /** Local optimistic overlays per listing id (useStagedChanges). */
  overlays: ReadonlyMap<string, ListingDraftOverlay>;
  /** Listing ids being sent from this tab. */
  sendingIds: ReadonlySet<string>;
  /** Plain money text for tooltips (e.g. "$54.00"). */
  formatMoney: (amount: number, currency: string) => string;
  /** Translates a draft error key (draftErrorI18n contract), or null. */
  errorText: (row: ListingRow) => string | null;
  /** The marketplace's own message for a general failure key ("Etsy said: …"), or null. */
  errorDetail?: (row: ListingRow) => string | null;
  /** The failure's fix button (lib/listings/failureFix): label + action, or null. */
  fixAction?: (row: ListingRow) => { label: string; run: () => void } | null;
  /** Store currency (validation messages, e.g. Etsy's $0.20 minimum). */
  storeCurrency: string;
  /**
   * What a queued `ListingRowSync.queuedDelete` does on send: `archive` on marketplaces whose only removal is
   * Archive (Trendyol), otherwise `delete`. Derived from the config's row actions by the page.
   */
  removalKind?: RemovalKind;
  /** id → label for id-valued text columns (Etsy section, Wix collection), from the filter option sources. */
  optionLabels?: Partial<Record<ListingColumnKey, ReadonlyMap<string, string>>>;
  /**
   * Listing ids whose quantity live stock sync manages (`useStockManagedRows`, BR-11). Their qty cell is read-only
   * ("Stock is managed by stock sync") with a link to the stock sync page; price is unaffected. Empty / undefined
   * while loading, on error, in dry run (`live=false`) and off Etsy.
   */
  stockManagedIds?: ReadonlySet<string>;
};

/** True when the row's quantity is owned by live stock sync (pure). */
export function isStockManaged(row: ListingRow, ctx: Pick<ListingCellContext, 'stockManagedIds'>): boolean {
  return Boolean(ctx.stockManagedIds?.has(row.id));
}

export type RemovalKind = 'delete' | 'archive';

/** `archive` when the config can archive but not delete (Trendyol), else `delete` (pure). */
export function removalKindOf(config: { rowActions: readonly string[] }): RemovalKind {
  return config.rowActions.includes('archive') && !config.rowActions.includes('delete') ? 'archive' : 'delete';
}

/** True when the row's open draft holds changes besides a queued removal (a delete must be staged alone). */
export function hasOpenChanges(row: ListingRow): boolean {
  const s = row.sync;
  return Boolean(s && s.status !== 'synced' && !s.queuedDelete && s.changedFields.length > 0);
}

/** Trendyol rows the marketplace archived (`statusRaw` carries `archived`); only these offer Unarchive (pure). */
export function isArchivedRow(row: ListingRow): boolean {
  return row.statusRaw.split(',').includes('archived');
}

// ─── Row value helpers (pure) ───────────────────────────────────────────────

/** The draft overlay shown for a row: local optimistic values first, then the server draft. */
export function overlayOf(row: ListingRow, overlays: ReadonlyMap<string, ListingDraftOverlay>): ListingDraftOverlay {
  return { ...(row.sync?.draft ?? {}), ...(overlays.get(row.id) ?? {}) };
}

export function displayPrice(row: ListingRow, overlays: ReadonlyMap<string, ListingDraftOverlay>): number | null {
  const o = overlayOf(row, overlays);
  return o.price ?? row.price?.amount ?? null;
}

/** Trendyol list price shown for a row (draft overlay first, then the live `extra.listPrice`); null when unknown. */
export function displayListPrice(row: ListingRow, overlays: ReadonlyMap<string, ListingDraftOverlay>): number | null {
  const o = overlayOf(row, overlays);
  if (typeof o.listPrice === 'number') return o.listPrice;
  const v = row.extra.listPrice;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function displayQty(row: ListingRow, overlays: ReadonlyMap<string, ListingDraftOverlay>): number | null {
  const o = overlayOf(row, overlays);
  return o.qty ?? row.qty;
}

export function displayTitle(row: ListingRow, overlays: ReadonlyMap<string, ListingDraftOverlay>): string {
  return overlayOf(row, overlays).title ?? row.title;
}

/** Sync pill for the row: a send in progress from this tab reads as `syncing`. */
export function rowSyncKey(row: ListingRow, sendingIds: ReadonlySet<string>, overlays?: ReadonlyMap<string, ListingDraftOverlay>): ListingSyncKey | null {
  if (sendingIds.has(row.id)) return 'syncing';
  if (row.sync) return row.sync.status;
  if (overlays?.has(row.id)) return 'pending';
  return null;
}

/** `${rowId}:${columnKey}` of cells whose draft value differs from the live value (DataTable `dirtyCells`). */
export function dirtyCellKeys(rows: ListingRow[], overlays: ReadonlyMap<string, ListingDraftOverlay>): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const o = overlayOf(r, overlays);
    if (o.price !== undefined && o.price !== r.price?.amount) out.add(`${r.id}:price`);
    if (o.qty !== undefined && o.qty !== r.qty) out.add(`${r.id}:qty`);
    if (o.title !== undefined && o.title !== r.title) out.add(`${r.id}:listing`);
  }
  return out;
}

/** Inline edit validation (§8). Returns a translated error or null. */
export function validatePrice(v: number | null, t: ListingsT, ctx: Pick<ListingCellContext, 'config' | 'marketplaceName' | 'formatMoney'>, currency: string): string | null {
  if (v === null || !(v > 0) || Math.round(v * 100) / 100 !== v) return t('listings.validate.priceInvalid');
  const min = ctx.config.validation.priceMin;
  if (min !== undefined && v < min) return t('listings.validate.priceMin', { marketplace: ctx.marketplaceName, min: ctx.formatMoney(min, currency) });
  return null;
}

export function validateQty(v: number | null, t: ListingsT, ctx: Pick<ListingCellContext, 'config'>): string | null {
  const max = ctx.config.validation.qtyMax;
  if (v === null || !Number.isInteger(v) || v < 0 || (max !== undefined && v > max)) {
    return t('listings.validate.qtyInvalid', { min: 0, max: max ?? 999999 });
  }
  return null;
}

/**
 * Why price/qty can't be edited here (grid cell, quick view, bulk modals), or null. A queued removal blocks
 * every other change: the draft service rejects it (DELETE_NOT_EXCLUSIVE), so the cell says so up front.
 */
export function editReadOnlyReason(
  row: ListingRow,
  field: 'price' | 'qty',
  t: ListingsT,
  ctx: Pick<ListingCellContext, 'config' | 'sendingIds' | 'removalKind' | 'stockManagedIds'>,
): string | null {
  if (ctx.sendingIds.has(row.id) || row.sync?.status === 'syncing') return t('listings.cell.sending', { to: t('listings.mp.to', { marketplace: ctx.config.marketplace }) });
  if (row.sync?.queuedDelete && row.sync.status !== 'synced') return t('listings.cell.removalQueued', { kind: ctx.removalKind ?? 'delete' });
  if (field === 'qty' && isStockManaged(row, ctx)) return t(LISTING_EDITABLE_REASON_I18N.stock_managed);
  if (!ctx.config.inlineEdit[field]) return t('listings.cell.editInEditor');
  if (!row.editable[field]) {
    const reason = row.editable.reason;
    return reason ? t(LISTING_EDITABLE_REASON_I18N[reason]) : t('listings.cell.editInEditor');
  }
  return null;
}

function readOnlyReason(row: ListingRow, field: 'price' | 'qty', t: ListingsT, ctx: ListingCellContext): string | null {
  return editReadOnlyReason(row, field, t, ctx);
}

// ─── Cells ──────────────────────────────────────────────────────────────────

const clamp2 = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
  wordBreak: 'break-word' as const,
};

function MetaLine({ row }: { row: ListingRow }) {
  if (!row.metaLine.length) return null;
  return (
    <Box component="span" className="mono" sx={{ display: 'block', fontSize: 12, color: neutral[500], fontFamily: 'var(--kx-font-mono, ui-monospace, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {row.metaLine.join(' · ')}
    </Box>
  );
}

function WillDelete({ row, t, kind }: { row: ListingRow; t: ListingsT; kind: RemovalKind }) {
  if (!row.sync?.queuedDelete) return null;
  return (
    <Box component="span" data-testid="listing-will-delete" sx={{ display: 'block', fontSize: 12, color: tone.danger.fg }}>
      {kind === 'archive' ? t('listings.cell.willArchive') : t('listings.cell.willDelete')}
    </Box>
  );
}

function SyncCell({ row, t, ctx }: { row: ListingRow; t: ListingsT; ctx: ListingCellContext }) {
  const key = rowSyncKey(row, ctx.sendingIds, ctx.overlays);
  if (!key) return null;
  const failed = key === 'sync_failed' || key === 'conflict';
  const err = failed ? ctx.errorText(row) : null;
  const pill = <StatusPill domain="sync" status={key} />;
  if (!err) return pill;
  const detail = ctx.errorDetail?.(row) ?? null;
  const fix = ctx.fixAction?.(row) ?? null;
  // Reason, the marketplace's own words when our reason is a general one, and the one-tap fix (founder 2026-10-17:
  // every failure must say exactly why and offer the way out, on every marketplace).
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', maxWidth: 260 }} data-testid="listing-sync-error">
      {pill}
      <Box component="span" title={err} sx={{ fontSize: 12, lineHeight: '16px', color: key === 'conflict' ? 'warning.dark' : 'error.main', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {err}
      </Box>
      {detail && (
        <Box component="span" title={detail} sx={{ fontSize: 12, lineHeight: '16px', color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} data-testid="listing-sync-error-detail">
          {detail}
        </Box>
      )}
      {fix && (
        <Box
          component="button"
          type="button"
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); fix.run(); }}
          sx={{ mt: '2px', p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit', fontSize: 12, lineHeight: '18px', fontWeight: 600, color: 'primary.main', textAlign: 'left', '&:hover': { textDecoration: 'underline' } }}
          data-testid="listing-sync-fix"
        >
          {fix.label} →
        </Box>
      )}
    </Box>
  );
}

/** ScoreMeter carries its own tooltip (score · band · "Scored on N of M checks", or "Not scored yet"). */
function HealthCell({ row }: { row: ListingRow }) {
  const { score, used, total } = row.health;
  return <ScoreMeter variant="cell" score={score} checksUsed={used} checksTotal={total} />;
}

function PriceText({ row, ctx, t }: { row: ListingRow; ctx: ListingCellContext; t: ListingsT }) {
  const amount = displayPrice(row, ctx.overlays);
  if (amount === null || !row.price) return <>{'—'}</>;
  const money = <Money amount={amount} currency={row.price.currency} />;
  if (!row.price.from) return money;
  return <>{t('listings.cell.priceFrom', { price: ctx.formatMoney(amount, row.price.currency) })}</>;
}

function extraText(row: ListingRow, key: ListingColumnKey): string | number | null {
  const v = row.extra[key];
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/**
 * Native hover text with the full title for the 2-line clamped title cell. Omitted when the cell already has the
 * "On Etsy: …" draft tooltip (two tooltips would stack).
 */
export function fullTitleHint(row: ListingRow, ctx: Pick<ListingCellContext, 'overlays'>): string | undefined {
  if (row.sync?.draft.title !== undefined && row.sync.draft.title !== row.title) return undefined;
  return displayTitle(row, ctx.overlays) || undefined;
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Columns for the config, in config order. `select` and `actions` are DataTable features, not columns.
 * Card roles (§6.5): media = thumb · title = listing · subtitle = meta line (card-only) · trailing = price +
 * stock · status = listing pill + sync pill · meta = health.
 */
/** Visible "View on Etsy ↗" link (users looked for the old "View" link; it was only inside ⋯). */
function ViewOnLink({ row, t, ctx }: { row: ListingRow; t: ListingsT; ctx: ListingCellContext }) {
  const href = ctx.externalUrl?.(row);
  if (!href) return null;
  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-row-stop="true"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      sx={{ fontSize: 12, lineHeight: '16px', color: 'primary.main', textDecoration: 'none', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}
      data-testid="listing-view-on"
    >
      {t('listings.action.viewOnShort', { marketplace: ctx.marketplaceName })}
    </Box>
  );
}

export function listingColumns(t: ListingsT, ctx: ListingCellContext): Column<ListingRow>[] {
  const onMp = (value: string) => t('listings.cell.onMarketplace', { marketplace: ctx.marketplaceName, value });
  const hidden = new Set(ctx.config.hiddenByDefault);
  const cols: Column<ListingRow>[] = [];

  const hideable = (key: ListingColumnKey) => ({ hideable: true, defaultHidden: hidden.has(key) });
  const hasChanges = ctx.config.columns.includes('changes');
  const healthOnCard = ctx.config.columns.includes('health') && ctx.config.columns.includes('listing');

  for (const key of ctx.config.columns) {
    switch (key) {
      case 'select':
      case 'actions':
        break;
      case 'thumb':
        cols.push({ key, header: '', type: 'thumb', width: 64, value: (r) => r.thumbUrl, thumbAlt: (r) => r.title, mobile: 'media' });
        break;
      case 'listing':
        cols.push({
          key,
          header: t('listings.col.listing'),
          minWidth: 320,
          sortable: true,
          mobile: 'title',
          render: (r) => (
            <Box sx={{ minWidth: 0 }}>
              <Box component="span" sx={{ ...clamp2, fontWeight: 500 }} data-testid="listing-title" title={fullTitleHint(r, ctx)}>
                {displayTitle(r, ctx.overlays)}
              </Box>
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <MetaLine row={r} />
                <ViewOnLink row={r} t={t} ctx={ctx} />
              </Box>
              <WillDelete row={r} t={t} kind={ctx.removalKind ?? 'delete'} />
            </Box>
          ),
          mobileRender: (r) => (
            <Box component="span" sx={clamp2} title={fullTitleHint(r, ctx)}>
              {displayTitle(r, ctx.overlays)}
            </Box>
          ),
          cellTooltip: (r) => (r.sync?.draft.title !== undefined && r.sync.draft.title !== r.title ? onMp(r.title) : null),
        });
        // Card-only second line: "ID 1490012234 · BB-PINK · ▪▪▪▪ 75" (+ "Will be deleted on send"). The health
        // meter rides on this line so a card is three short lines (title, meta, price + status), not four.
        cols.push({
          key: 'listingMeta',
          header: t('listings.col.listing'),
          desktop: false,
          mobile: 'subtitle',
          render: (r) => (
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
              {r.metaLine.length ? (
                <Box component="span" sx={{ minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
                  <MetaLine row={r} />
                </Box>
              ) : null}
              <ViewOnLink row={r} t={t} ctx={ctx} />
              {healthOnCard && r.health.score != null ? ( /* no lone "—" when unscored */
                <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }} data-testid="listing-card-health">
                  <HealthCell row={r} />
                </Box>
              ) : null}
              <WillDelete row={r} t={t} kind={ctx.removalKind ?? 'delete'} />
            </Box>
          ),
        });
        break;
      case 'price':
        cols.push({
          key,
          header: t('listings.col.price'),
          type: 'money-edit',
          width: 112,
          align: 'right',
          sortable: true,
          mobile: 'trailing',
          value: (r) => displayPrice(r, ctx.overlays),
          currency: (r) => r.price?.currency,
          render: (r) => <PriceText row={r} ctx={ctx} t={t} />,
          mobileRender: (r) => {
            const qty = displayQty(r, ctx.overlays);
            return (
              <Box component="span">
                <PriceText row={r} ctx={ctx} t={t} />
                {qty !== null ? ` · ${t('listings.cell.inStock', { count: qty })}` : ''}
                {qty !== null && isStockManaged(r, ctx) ? <StockManagedQty text="" label={t('listings.cell.stockManagedLink')} /> : null}
              </Box>
            );
          },
          readOnlyReason: (r) => readOnlyReason(r, 'price', t, ctx),
          validate: (v) => validatePrice(v, t, ctx, ctx.storeCurrency),
          cellTooltip: (r) => {
            const d = overlayOf(r, ctx.overlays).price;
            return d !== undefined && r.price && d !== r.price.amount ? onMp(ctx.formatMoney(r.price.amount, r.price.currency)) : null;
          },
        });
        break;
      case 'qty':
        cols.push({
          key,
          header: t('listings.col.qty'),
          type: 'int-edit',
          width: 72,
          align: 'right',
          sortable: true,
          mobile: 'hidden',
          value: (r) => displayQty(r, ctx.overlays),
          render: (r) => {
            const q = displayQty(r, ctx.overlays);
            const text = q === null ? t('listings.cell.notTracked') : String(q);
            return isStockManaged(r, ctx) ? <StockManagedQty text={text} label={t('listings.cell.stockManagedLink')} /> : text;
          },
          readOnlyReason: (r) => readOnlyReason(r, 'qty', t, ctx),
          validate: (v) => validateQty(v, t, ctx),
          cellTooltip: (r) => {
            const d = overlayOf(r, ctx.overlays).qty;
            return d !== undefined && d !== r.qty && r.qty !== null ? onMp(String(r.qty)) : null;
          },
        });
        break;
      case 'status':
        cols.push({
          key,
          header: t('listings.col.status'),
          type: 'status',
          // Listing pill with the change pill under it (one column instead of two, so the grid fits 1024–1440px
          // without scrolling sideways and both pills stay readable).
          width: hasChanges ? 140 : 112,
          mobile: 'status',
          value: (r) => ({ domain: 'listing', status: r.status, raw: r.statusNote ?? r.statusRaw }),
          render: hasChanges
            ? (r) => (
                <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <StatusPill domain="listing" status={r.status} raw={r.statusNote ?? r.statusRaw} />
                  <SyncCell row={r} t={t} ctx={ctx} />
                </Box>
              )
            : undefined,
          mobileRender: (r) => (
            <Box component="span" sx={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap' }}>
              <StatusPill domain="listing" status={r.status} raw={r.statusNote ?? r.statusRaw} />
              <SyncCell row={r} t={t} ctx={ctx} />
            </Box>
          ),
        });
        break;
      case 'changes':
        // Shown inside the status cell (desktop) and next to the status pill (cards); kept as a key so configs and
        // saved column state stay valid.
        cols.push({ key, header: t('listings.col.changes'), width: 120, desktop: false, mobile: 'hidden', render: (r) => <SyncCell row={r} t={t} ctx={ctx} /> });
        break;
      case 'health':
        cols.push({
          key,
          header: t('listings.col.health'),
          type: 'score',
          width: 96,
          align: 'right',
          sortable: true,
          // Cards show it on the meta line (listingMeta) when the listing column is there.
          mobile: healthOnCard ? 'hidden' : 'meta',
          value: (r) => r.health.score,
          render: (r) => <HealthCell row={r} />,
        });
        break;
      case 'updated':
      case 'created':
        cols.push({
          key,
          header: t(`listings.col.${key}`),
          type: 'date',
          dateMode: 'relative',
          width: key === 'updated' ? 88 : 96,
          align: 'right',
          sortable: true,
          mobile: 'hidden',
          ...(key === 'created' ? hideable(key) : {}),
          value: (r) => (key === 'updated' ? r.updatedAt : r.createdAt),
          render: (r) => {
            const v = key === 'updated' ? r.updatedAt : r.createdAt;
            return v ? <DateText value={v} mode="relative" /> : '—';
          },
        });
        break;
      case 'views':
      case 'favorites':
      case 'variants':
        cols.push({
          key,
          header: t(`listings.col.${key}`),
          type: 'number',
          width: key === 'variants' ? 80 : 96,
          align: 'right',
          sortable: key === 'views',
          mobile: 'hidden',
          ...hideable(key),
          value: (r) => {
            const v = extraText(r, key);
            return typeof v === 'number' ? v : v === null ? null : Number(v);
          },
        });
        break;
      case 'listPrice':
      case 'compareAt':
        cols.push({
          key,
          header: t(`listings.col.${key}`),
          type: 'money',
          width: 110,
          align: 'right',
          mobile: 'hidden',
          ...hideable(key),
          value: (r) => {
            const v = extraText(r, key);
            return typeof v === 'number' ? v : v === null ? null : Number(v);
          },
          currency: (r) => r.price?.currency,
        });
        break;
      case 'visible':
        cols.push({
          key,
          header: t('listings.col.visible'),
          width: 100,
          mobile: 'hidden',
          ...hideable(key),
          render: (r) => {
            const v = r.extra.visible;
            return v === true ? t('listings.cell.yes') : v === false ? t('listings.cell.no') : '—';
          },
        });
        break;
      case 'condition':
        cols.push({
          key,
          header: t('listings.col.condition'),
          width: 120,
          mobile: 'hidden',
          ...hideable(key),
          render: (r) => {
            const v = r.extra.condition;
            if (typeof v !== 'string' || !v) return '—';
            const k = `listings.condition.${v}`;
            return t.has?.(k) ? t(k) : v;
          },
        });
        break;
      case 'format':
        cols.push({
          key,
          header: t('listings.col.format'),
          width: 100,
          mobile: 'hidden',
          ...hideable(key),
          render: (r) => {
            const v = r.extra.format;
            if (typeof v !== 'string' || !v) return '—';
            const k = `listings.format.${v}`;
            return t.has?.(k) ? t(k) : v;
          },
        });
        break;
      default:
        // Text columns: section, category, brand, collection, vendor, productType, barcode, ribbon.
        cols.push({
          key,
          header: t(`listings.col.${key}`),
          width: key === 'category' || key === 'collection' ? 160 : 140,
          mobile: 'hidden',
          ...hideable(key),
          render: (r) => {
            const v = extraText(r, key);
            if (v === null) return '—';
            const named = ctx.optionLabels?.[key]?.get(String(v));
            // Never show a raw id (Wix collection UUIDs appeared when the names failed to load): "—" until named.
            const label = named ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(v)) ? '—' : String(v));
            return (
              <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}
              </Box>
            );
          },
        });
    }
  }
  return cols;
}

/** Sort keys the API understands, by column key. */
export const COLUMN_SORT_FIELD: Partial<Record<string, 'updated' | 'title' | 'price' | 'qty' | 'health' | 'views' | 'created'>> = {
  listing: 'title',
  price: 'price',
  qty: 'qty',
  health: 'health',
  updated: 'updated',
  views: 'views',
  created: 'created',
};

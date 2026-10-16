// components/domain/orders/orderColumns.tsx (orders G2) — DataTable columns, the row inline action and the
// row ⋯ menu of the Orders list (orders §4.1, §4.3, §7.2). Pure builders: the page passes translators,
// formatters and handlers in; nothing here fetches.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Column } from '@/components/ds/data';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Thumb } from '@/components/ds/data/Thumb';
import { Money } from '@/components/ds/format/Money';
import { ShipBy } from '@/components/ds/format/ShipBy';
import { DateText } from '@/components/ds/format/DateText';
import { CopyText } from '@/components/ds/format/CopyText';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import type { ActionSpec } from '@/components/ds/page';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { neutral, radius, tone } from '@/lib/ds/tokens';
import type { OrderRow, ShipToField } from '@/lib/orders/types';
import OrderLifecycleBadges from '@/components/orders-live/OrderLifecycleBadges';
import type { OrderLifecycleFlags } from '@/components/orders-live/useOrderLifecycleFlags';

/** next-intl translator bound to the `orders` namespace. */
export type OrdersT = (key: string, values?: Record<string, string | number | Date>) => string;

/** Live arrivals keep the "New" meta for 10 minutes (BUILD_PLAN §7 item 9). */
export const NEW_ORDER_MS = 10 * 60 * 1000;

export type OrderColumnsContext = {
  /** `useRecentLiveOrders()`: orderId → arrival time (ms). */
  recent?: ReadonlyMap<string, number>;
  /** `useOrderLifecycleFlags(visibleIds).flags` (W4 caption under the pill). */
  lifecycle?: Readonly<Record<string, OrderLifecycleFlags | undefined>>;
  onLifecycleChanged?: () => void;
  /** Translated "New" chip (`liveOrders.badge.new`). */
  newLabel: string;
  /** Translated status labels for accessible text (`status.order.*`). */
  now?: Date;
};

// ── row facts ───────────────────────────────────────────────────────────────────────────────────────────

export function isNewOrder(row: Pick<OrderRow, 'id'>, recent: ReadonlyMap<string, number> | undefined, now = Date.now()): boolean {
  const at = recent?.get(row.id);
  return typeof at === 'number' && now - at < NEW_ORDER_MS;
}

/** orders §1.4 / §10: may get a label from the list (G1 computes `canLabel`; the status re-check keeps it honest). */
export function isLabelable(row: OrderRow): boolean {
  if (!row.canLabel || row.isFBA || row.isMCF) return false;
  const s = row.status;
  return s.domain === 'label' || s.key === 'to_ship' || s.key === 'overdue';
}

/** orders §1.4: the page primary when nothing is selected (with a selection the bulk bar owns it). */
export function pagePrimaryKind(rows: readonly OrderRow[], selectedCount: number): 'createLabels' | 'addManualOrder' | 'none' {
  if (selectedCount > 0) return 'none';
  return rows.some(isLabelable) ? 'createLabels' : 'addManualOrder';
}

/** Why a selected row cannot get a label here (first reason wins), for the "Create N labels" tooltip. */
export type NotLabelableReason = 'fba' | 'address' | 'hasLabel' | 'closed';

export function notLabelableReason(row: OrderRow): NotLabelableReason | null {
  if (isLabelable(row)) return null;
  if (row.isFBA || row.isMCF) return 'fba';
  if (row.status.domain === 'order' && row.status.key === 'label_created') return 'hasLabel';
  if (row.shipTo.missing.length > 0 || row.shipTo.unavailable) return 'address';
  return 'closed';
}

export function buyerText(row: OrderRow, t: OrdersT): string {
  if (row.shipTo.nameHidden) return t('row.buyerHidden');
  return row.buyerName || row.shipTo.name || '';
}

export function storeText(row: OrderRow, t: OrdersT): string {
  return row.isManual ? t('row.manualStore') : row.storeName || row.marketplace;
}

function missingFieldsText(fields: readonly ShipToField[], t: OrdersT): string {
  return fields.map((f) => t(`problem.field.${f}`)).join(', ');
}

/** Caption under the status pill: the reason of a problem pill, or the tracking push result (orders §2.2). */
export function statusCaption(row: OrderRow, t: OrdersT): { text: string; tone: 'neutral' | 'danger' | 'success'; hint?: string } | null {
  const s = row.status;
  if (s.domain === 'label') {
    const reason = row.labelFailure?.errorMessage || s.detail;
    return reason ? { text: t('problem.labelFailed', { reason }), tone: 'danger' } : null;
  }
  if (s.key === 'problem') {
    if (s.reason === 'address_unavailable' || row.shipTo.unavailable) {
      return { text: t('problem.addressIncomplete', { fields: missingFieldsText(row.shipTo.missing, t) }), tone: 'danger', hint: t('problem.etsyAddressHidden') };
    }
    if (row.shipTo.missing.length) {
      return { text: t('problem.addressIncomplete', { fields: missingFieldsText(row.shipTo.missing, t) }), tone: 'danger' };
    }
  }
  const push = row.trackingSubmission;
  if (push && (s.key === 'label_created' || s.key === 'shipped' || s.key === 'delivered')) {
    if (push.state === 'sent') return { text: t('row.trackingSent'), tone: 'success' };
    if (push.state === 'queued') return { text: t('row.trackingQueued'), tone: 'neutral' };
    if (push.state === 'failed') return { text: t('row.trackingFailed'), tone: 'danger', hint: push.error ?? undefined };
  }
  return null;
}

// ── cells ───────────────────────────────────────────────────────────────────────────────────────────────

const captionSx = { fontSize: 12, lineHeight: '16px', color: neutral[600] } as const;
const NoteIcon = icons.note;
const RushIcon = icons.rush;

function NewChip({ label }: { label: string }) {
  return (
    <Box
      component="span"
      data-testid="order-new-chip"
      sx={{ ml: '6px', px: '6px', height: 18, display: 'inline-flex', alignItems: 'center', borderRadius: `${radius.full}px`, fontSize: 11, fontWeight: 600, bgcolor: tone.success.bg, color: tone.success.fg }}
    >
      {label}
    </Box>
  );
}

function OrderMetaLine({ row, t, withStore }: { row: OrderRow; t: OrdersT; withStore?: boolean }) {
  const buyer = buyerText(row, t);
  const orderNo = `#${row.orderNumber}`;
  const parts: React.ReactNode[] = [<span key="n">{orderNo}</span>];
  if (withStore) {
    parts.push(
      <Box key="s" component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {row.isManual ? null : <LogoTile brand={row.store.marketplace === 'other' ? row.marketplace : row.store.marketplace} size={16} />}
        <span>{storeText(row, t)}</span>
      </Box>,
    );
  }
  if (buyer) {
    parts.push(
      row.shipTo.nameHidden ? (
        <Tooltip key="b" title={t('row.buyerHiddenHint')}>
          <span tabIndex={0}>{buyer}</span>
        </Tooltip>
      ) : (
        <span key="b">{buyer}</span>
      ),
    );
  }
  if (row.shipTo.country) parts.push(<span key="c">{row.shipTo.country}</span>);
  return (
    <Box component="span" className="mono" sx={{ ...captionSx, display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '4px' }}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span aria-hidden>{'·'}</span> : null}
          {p}
        </React.Fragment>
      ))}
      {row.note ? (
        <Tooltip title={`${t('row.note')}: ${row.note}`}>
          <Box component="span" tabIndex={0} aria-label={t('row.note')} data-testid="order-note-indicator" sx={{ display: 'inline-flex', color: neutral[500] }}>
            <NoteIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </Box>
        </Tooltip>
      ) : null}
    </Box>
  );
}

function OrderTitle({ row, t, isNew, newLabel }: { row: OrderRow; t: OrdersT; isNew: boolean; newLabel: string }) {
  const first = row.items[0];
  const more = Math.max(0, row.items.length - 1);
  const title = first?.title || `#${row.orderNumber}`;
  const moreText = more > 0 ? ` (${t('row.moreItems', { count: more })})` : null;
  return (
    <Typography
      component="span"
      sx={{ fontSize: 14, lineHeight: '20px', fontWeight: 500, color: neutral[900], display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      title={title}
    >
      {title}
      {moreText ? <Box component="span" sx={{ color: neutral[600], fontWeight: 400 }}>{moreText}</Box> : null}
      {isNew ? <NewChip label={newLabel} /> : null}
    </Typography>
  );
}

function StatusCell({ row, t, ctx }: { row: OrderRow; t: OrdersT; ctx: OrderColumnsContext }) {
  const s = row.status;
  const caption = statusCaption(row, t);
  const flags = ctx.lifecycle?.[row.id];
  const captionNode = caption ? (
    <Typography component="span" sx={{ ...captionSx, display: 'block', color: caption.tone === 'danger' ? tone.danger.fg : caption.tone === 'success' ? tone.success.fg : neutral[600] }}>
      {caption.text}
    </Typography>
  ) : null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', minWidth: 0 }}>
      {s.domain === 'label' ? <StatusPill domain="label" status="label_failed" raw={s.raw || null} /> : <StatusPill domain="order" status={s.key} raw={s.raw || null} />}
      {caption?.hint ? (
        <Tooltip title={caption.hint}>
          <span tabIndex={0}>{captionNode}</span>
        </Tooltip>
      ) : (
        captionNode
      )}
      {row.isFBA || row.isMCF ? <Typography component="span" sx={captionSx}>{t(row.isMCF ? 'row.mcf' : 'row.fba')}</Typography> : null}
      {flags ? (
        <Box data-row-stop sx={{ mt: '2px' }} onClick={(e) => e.stopPropagation()}>
          <OrderLifecycleBadges orderId={row.id} flags={flags} onChanged={ctx.onLifecycleChanged} compact />
        </Box>
      ) : null}
    </Box>
  );
}

function ShipByCell({ row, t }: { row: OrderRow; t: OrdersT }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <ShipBy date={row.shipBy} shippedAt={row.shippedAt} />
      {row.shippingUpgrade ? (
        <Box component="span" sx={{ ...captionSx, display: 'inline-flex', alignItems: 'center', gap: '4px', color: neutral[700] }}>
          <RushIcon size={12} strokeWidth={ICON_STROKE} aria-hidden />
          {t('row.upgrade', { upgrade: row.shippingUpgrade })}
        </Box>
      ) : null}
    </Box>
  );
}

function TotalCell({ row, t }: { row: OrderRow; t: OrdersT }) {
  if (row.total == null) return <span>{'—'}</span>;
  if (!row.currency) {
    return (
      <Tooltip title={t('row.currencyUnknown')}>
        <Box component="span" tabIndex={0} className="tnum">
          <Money amount={row.total} currency={null} />
        </Box>
      </Tooltip>
    );
  }
  return <Money amount={row.total} currency={row.currency} />;
}

function TrackingCell({ row }: { row: OrderRow }) {
  const tn = row.label?.trackingNumber || row.trackingSubmission?.trackingNumber;
  if (!tn) return <span>{'—'}</span>;
  const carrier = row.label?.carrier || row.trackingSubmission?.carrierName || null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
      {carrier ? <LogoTile brand={carrier} size={16} /> : null}
      <CopyText value={tn} mono truncate={14} />
    </Box>
  );
}

// ── columns (orders §4.1) ───────────────────────────────────────────────────────────────────────────────

export function orderColumns(t: OrdersT, ctx: OrderColumnsContext): Column<OrderRow>[] {
  const now = ctx.now?.getTime() ?? Date.now();
  return [
    {
      key: 'thumb',
      header: '',
      width: 56,
      mobile: 'media',
      render: (r) => {
        const more = r.items.length > 1 ? `+${r.items.length - 1}` : undefined;
        return <Thumb src={r.items[0]?.image ?? null} alt={r.items[0]?.title ?? ''} size={48} preview badge={more} />;
      },
      mobileRender: (r) => <Thumb src={r.items[0]?.image ?? null} alt={r.items[0]?.title ?? ''} size={64} />,
    },
    {
      key: 'order',
      header: t('columns.order'),
      minWidth: 280,
      // The order column takes the spare width; the others hug their content (no wide empty gaps on big screens).
      width: '100%',
      mobile: 'title',
      render: (r) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <OrderTitle row={r} t={t} isNew={isNewOrder(r, ctx.recent, now)} newLabel={ctx.newLabel} />
          <OrderMetaLine row={r} t={t} />
        </Box>
      ),
      mobileRender: (r) => <OrderTitle row={r} t={t} isNew={isNewOrder(r, ctx.recent, now)} newLabel={ctx.newLabel} />,
    },
    {
      key: 'orderMeta',
      header: t('columns.order'),
      desktop: false,
      mobile: 'subtitle',
      render: (r) => <OrderMetaLine row={r} t={t} withStore />,
    },
    {
      key: 'store',
      header: t('columns.store'),
      width: 160,
      sortable: true,
      hideable: true,
      mobile: 'hidden',
      render: (r) => (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {r.isManual ? null : <LogoTile brand={r.store.marketplace === 'other' ? r.marketplace : r.store.marketplace} size={16} />}
          <Typography component="span" noWrap sx={{ fontSize: 13, color: neutral[800] }}>
            {storeText(r, t)}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'total',
      header: t('columns.total'),
      width: 112,
      align: 'right',
      sortable: true,
      hideable: true,
      mobile: 'trailing',
      render: (r) => <TotalCell row={r} t={t} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      width: 148,
      mobile: 'status',
      render: (r) => <StatusCell row={r} t={t} ctx={ctx} />,
      mobileRender: (r) =>
        r.status.domain === 'label' ? <StatusPill domain="label" status="label_failed" raw={r.status.raw || null} /> : <StatusPill domain="order" status={r.status.key} raw={r.status.raw || null} />,
    },
    {
      key: 'shipBy',
      header: t('columns.shipBy'),
      width: 156,
      sortable: true,
      hideable: true,
      mobile: 'meta',
      render: (r) => <ShipByCell row={r} t={t} />,
    },
    {
      key: 'orderedAt',
      header: t('columns.orderedAt'),
      width: 120,
      sortable: true,
      hideable: true,
      defaultHidden: true,
      mobile: 'hidden',
      render: (r) => (r.orderedAt ? <DateText value={r.orderedAt} mode="date" /> : <span>{'—'}</span>),
    },
    {
      key: 'tracking',
      header: t('columns.tracking'),
      width: 180,
      hideable: true,
      defaultHidden: true,
      mobile: 'hidden',
      render: (r) => <TrackingCell row={r} />,
    },
    {
      key: 'carrierCost',
      header: t('columns.carrierCost'),
      width: 112,
      align: 'right',
      hideable: true,
      defaultHidden: true,
      mobile: 'hidden',
      render: (r) => (r.carrierCost ? <Money amount={r.carrierCost.amount} currency={r.carrierCost.currency} /> : <span>{'—'}</span>),
    },
  ];
}

/** Column keys the API can sort by (orders §4.1). */
export const SORTABLE_COLUMN_KEYS = ['store', 'total', 'shipBy', 'orderedAt'] as const;

// ── row actions (orders §4.3) ───────────────────────────────────────────────────────────────────────────

export type OrderRowHandlers = {
  open(row: OrderRow): void;
  createLabel(row: OrderRow): void;
  fixAddress(row: OrderRow): void;
  printLabel(row: OrderRow): void;
  copyTracking(row: OrderRow): void;
  /** Opens the OrderPanel's tracking flow (AddTrackingModal lives in the panel, G3). */
  addTracking(row: OrderRow): void;
  copyAddress(row: OrderRow, style: 'intl' | 'tr'): void;
  openOnMarketplace(row: OrderRow): void;
  printPackingSlip(row: OrderRow): void;
  messageBuyer(row: OrderRow): void;
  deleteLabel(row: OrderRow): void;
  deleteOrder(row: OrderRow): void;
};

const isClosed = (row: OrderRow) =>
  row.status.domain === 'order' && ['shipped', 'delivered', 'cancelled', 'refunded'].includes(row.status.key);

/** The one inline action of a row (DS §3.4: at most 1 + ⋯). */
export function orderInlineAction(row: OrderRow, h: OrderRowHandlers, t: OrdersT): ActionSpec | null {
  if (row.isFBA || row.isMCF || isClosed(row)) return null;
  const s = row.status;
  if (s.domain === 'label') return { id: 'createLabel', label: t('actions.createLabel'), icon: icons.label, onClick: () => h.createLabel(row) };
  if (s.key === 'problem' && (row.shipTo.missing.length > 0 || row.shipTo.unavailable)) {
    return { id: 'fixAddress', label: t('actions.fixAddress'), icon: icons.edit, onClick: () => h.fixAddress(row) };
  }
  if (s.key === 'label_created') {
    if (row.label?.labelHref) return { id: 'printLabel', label: t('actions.printLabel'), icon: icons.print, onClick: () => h.printLabel(row) };
    if (row.label?.trackingNumber) return { id: 'copyTracking', label: t('actions.copyTracking'), icon: icons.copy, onClick: () => h.copyTracking(row) };
    return null;
  }
  if ((s.key === 'to_ship' || s.key === 'overdue') && isLabelable(row)) {
    return { id: 'createLabel', label: t('actions.createLabel'), icon: icons.label, onClick: () => h.createLabel(row) };
  }
  return null;
}

/** Row ⋯ (danger last; the DS menu adds the divider). */
export function orderRowActions(row: OrderRow, h: OrderRowHandlers, t: OrdersT, opts: { marketplaceName?: string } = {}): ActionSpec[] {
  const items: ActionSpec[] = [{ id: 'open', label: t('actions.openOrder'), onClick: () => h.open(row) }];
  if (row.label?.labelHref) items.push({ id: 'printLabel', label: t('actions.printLabel'), icon: icons.print, onClick: () => h.printLabel(row) });
  else if (isLabelable(row)) items.push({ id: 'createLabel', label: t('actions.createLabel'), icon: icons.label, onClick: () => h.createLabel(row) });
  if (!row.isManual && !row.isFBA && !row.isMCF) items.push({ id: 'addTracking', label: `${t('actions.addTracking')}…`, onClick: () => h.addTracking(row) });
  items.push(
    { id: 'copyAddressIntl', label: t('actions.copyAddressIntl'), icon: icons.copy, onClick: () => h.copyAddress(row, 'intl') },
    { id: 'copyAddressTr', label: t('actions.copyAddressTr'), onClick: () => h.copyAddress(row, 'tr') },
  );
  if (row.marketplaceUrl) {
    items.push({
      id: 'openOn',
      label: t('actions.openOn', { marketplace: opts.marketplaceName || storeText(row, t) }),
      icon: icons.externalLink,
      onClick: () => h.openOnMarketplace(row),
    });
  }
  items.push({ id: 'printPackingSlip', label: t('actions.printPackingSlip'), onClick: () => h.printPackingSlip(row) });
  if (row.store.marketplace === 'amazon' && !row.isManual) {
    items.push({ id: 'messageBuyer', label: `${t('actions.messageBuyer')}…`, icon: icons.message, onClick: () => h.messageBuyer(row) });
  }
  if (row.label?.shipmentId) items.push({ id: 'deleteLabel', label: t('actions.deleteLabel'), tone: 'danger', onClick: () => h.deleteLabel(row) });
  items.push({ id: 'deleteOrder', label: t('actions.deleteOrder'), icon: icons.delete, tone: 'danger', onClick: () => h.deleteOrder(row) });
  return items;
}

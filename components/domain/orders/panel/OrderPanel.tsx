/**
 * OrderPanel (orders §2.4, §3.3, §5, §7.3): SidePanel md 560 (bottom sheet < 600) over the mounted list.
 * Sections: Marketplace updates (lifecycle flags, BUILD_PLAN §7 item 9) · Items (+ gift message, buyer note) ·
 * Ship to · Label & tracking · Private note · Costs · History.
 *
 * One primary (P1): Create label (labelable) · Print label (label with a file) · Fix address (address problem) ·
 * none (FBA / MCF, shipped, cancelled). Secondary: Print packing slip (not for FBA / MCF).
 * ⋯ (header without footer, footer-left otherwise): Open on {marketplace} ↗ · Copy address (international) ·
 * Copy address (Turkish format) · Print packing slip · Add tracking number… · Message buyer… (Amazon) ·
 * Delete label… (Shipment labels only) · Delete order… (danger last).
 *
 * An `orderId` that is not in `rows` (a `?open=` link to another page) loads through `useOrder` (A3).
 * prev/next stay within `rows` (no cross-page jump in v1). Live order events keep both fresh: the list and
 * `useOrder` use the `/api/orders` SWR prefix, and the lifecycle flags revalidate on order/shipment events.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import useSWR from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { ConfirmDialog } from '@/components/ds/overlay/ConfirmDialog';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { ShipBy } from '@/components/ds/format/ShipBy';
import { CopyText } from '@/components/ds/format/CopyText';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { useToast } from '@/components/ds/feedback/toast';
import type { ActionSpec } from '@/components/ds/types/actions';
import OrderLifecycleBadges from '@/components/orders-live/OrderLifecycleBadges';
import { useOrderLifecycleFlags, type OrderLifecycleFlags } from '@/components/orders-live/useOrderLifecycleFlags';
import { icons } from '@/lib/ds/icons';
import { logoDisplayName } from '@/lib/ds/logos';
import { useFormatters } from '@/lib/format';
import { useOrder } from '@/lib/hooks/useOrdersList';
import { getLocaleConfig } from '@/lib/i18n/localeConfig';
import { resolveBaseCurrency } from '@/lib/orders/manualOrder';
import type { OrderRow } from '@/lib/orders/types';
import { ItemsSection } from './ItemsSection';
import { ShipToSection } from './ShipToSection';
import { LabelSection } from './LabelSection';
import { NoteSection } from './NoteSection';
import { CostsSection } from './CostsSection';
import { HistorySection } from './HistorySection';
import { AddTrackingModal } from './AddTrackingModal';
import { MessageBuyerModal } from './MessageBuyerModal';
import { useOrderActions } from './useOrderActions';
import { useOrderNote } from './useOrderNote';

export interface OrderPanelProps {
  orderId: string | null;
  rows: OrderRow[];
  onClose(): void;
  onNavigate(id: string): void;
  onCreateLabel(row: OrderRow): void;
  onChanged(): void;
  /**
   * Optional (additive to the frozen contract): open a modal right away, for the row ⋯ items
   * "Add tracking number…" and "Message buyer…" that the list routes to the panel.
   */
  initialAction?: 'addTracking' | 'messageBuyer' | null;
  /**
   * Optional (additive): the panel opened the `initialAction` modal. The parent should clear its
   * `initialAction` here, so the same ⋯ request on the same order can open the modal again later.
   */
  onInitialActionHandled?(): void;
}

/** Same SWR key as the shell and ManualOrderPanel (usually already cached). */
const SETTINGS_KEY = '/api/user/settings';
type SettingsSlice = {
  shipperProfile?: { defaultCurrencyCode?: string | null; shipperCountryCode?: string | null } | null;
} | null;
const settingsFetcher = async (url: string): Promise<SettingsSlice> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

/** The lifecycle flags have something to show (mirrors OrderLifecycleBadges' chip rules). */
export function hasLifecycleBadges(f: OrderLifecycleFlags | null | undefined): boolean {
  if (!f) return false;
  return Boolean(
    f.cancelledAfterLabel || f.cancelled || f.voidRequested || f.shippedExternally || f.late || f.shippedLate ||
      f.dispatchState === 'label_not_pushed' || f.deliveredAt,
  );
}

export type OrderPanelPrimary = 'create_label' | 'print_label' | 'fix_address' | null;

/** P1: the one primary of the panel for a row (exported for tests). */
export function orderPanelPrimary(row: OrderRow): OrderPanelPrimary {
  if (row.isFBA || row.isMCF) return null;
  // Closed orders get no primary (orders §1.4 / §2.4), even with a label file: a cancelled-after-label order
  // points to the lifecycle "void" badge, not to printing. Print label stays in the Label section.
  const closed = row.status.domain === 'order' && ['shipped', 'delivered', 'cancelled', 'refunded'].includes(row.status.key);
  if (closed) return null;
  if (row.canLabel) return 'create_label';
  if (row.label?.labelHref) return 'print_label';
  if (!row.label && !row.shipTo.unavailable && row.shipTo.missing.length > 0) return 'fix_address';
  return null;
}

/** Display name of the order's marketplace ("Etsy", "Amazon"); the shop name is the store, not this. */
export function marketplaceDisplayName(row: OrderRow): string {
  return logoDisplayName(row.store.marketplace) ?? row.storeName ?? row.marketplace;
}

export function OrderPanel({ orderId, rows, onClose, onNavigate, onCreateLabel, onChanged, initialAction, onInitialActionHandled }: OrderPanelProps) {
  const t = useTranslations('orders');
  const f = useFormatters();
  const toast = useToast();
  const locale = useLocale();
  const open = orderId != null;

  const index = orderId ? rows.findIndex((r) => r.id === orderId) : -1;
  const inList = index >= 0 ? rows[index] : undefined;
  const single = useOrder(orderId && !inList ? orderId : null);
  const liveRow = inList ?? single.row;
  // Keep the last order while the panel slides out, so it closes with its content instead of a skeleton.
  const lastRowRef = useRef<OrderRow | undefined>(undefined);
  if (liveRow) lastRowRef.current = liveRow;
  const row = liveRow ?? (open ? undefined : lastRowRef.current);

  // Carrier cost default = the account base currency (orders §5), resolved as ManualOrderPanel does.
  const { data: settings } = useSWR<SettingsSlice>(open ? SETTINGS_KEY : null, settingsFetcher, { revalidateOnFocus: false });
  const localeCurrency = getLocaleConfig(locale === 'en' ? 'en' : 'tr').defaultCurrency;
  const baseCurrency = resolveBaseCurrency({ shipperProfile: settings?.shipperProfile ?? null, localeCurrency });
  const prevRow = index > 0 ? rows[index - 1] : null;
  const nextRow = index >= 0 && index < rows.length - 1 ? rows[index + 1] : null;

  const { mutate: mutateSingle } = single;
  const changed = useCallback(() => {
    onChanged();
    if (!inList) void mutateSingle();
  }, [onChanged, inList, mutateSingle]);

  const actions = useOrderActions({ onChanged: changed });
  const note = useOrderNote({
    orderId: row?.id ?? null,
    note: row?.note,
    onSaved: () => changed(),
    onError: () => toast.error(t('panel.noteSaveFailed'), { persist: false }),
  });

  const { flags, mutate: mutateFlags } = useOrderLifecycleFlags(row ? [row.id] : []);
  const lifecycle = row ? flags[row.id] : undefined;

  const [editingShipTo, setEditingShipTo] = useState(false);
  const [shipToDirty, setShipToDirty] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'deleteOrder' | 'deleteLabel'>(null);
  /** `${orderId}:${action}` already opened: a row that leaves and re-enters `rows` must not reopen the modal. */
  const consumedActionRef = useRef<string | null>(null);
  const handledRef = useRef(onInitialActionHandled);
  handledRef.current = onInitialActionHandled;

  // A different order starts clean.
  useEffect(() => {
    consumedActionRef.current = null;
    setEditingShipTo(false);
    setShipToDirty(false);
    setTrackingOpen(false);
    setMessageOpen(false);
    setConfirm(null);
  }, [orderId]);

  // Row ⋯ "Add tracking number…" / "Message buyer…" → open the modal once the order is loaded.
  // Fires once per request: a cleared `initialAction` re-arms it for the next ⋯ request.
  const rowReady = Boolean(liveRow);
  useEffect(() => {
    if (!initialAction) consumedActionRef.current = null;
  }, [initialAction]);
  useEffect(() => {
    if (!rowReady || !initialAction || !orderId) return;
    const key = `${orderId}:${initialAction}`;
    if (consumedActionRef.current === key) return;
    consumedActionRef.current = key;
    if (initialAction === 'addTracking') setTrackingOpen(true);
    if (initialAction === 'messageBuyer') setMessageOpen(true);
    handledRef.current?.();
  }, [rowReady, initialAction, orderId]);

  const mpName = row ? marketplaceDisplayName(row) : '';
  const storeLabel = row ? (row.isManual ? t('row.manualStore') : row.storeName) : '';
  const isAmazon = row?.store.marketplace === 'amazon';
  const canTrack = !!row && !row.isFBA && !row.isMCF && !row.isManual;

  const printPackingSlip = useCallback(() => row && actions.printPackingSlip(row), [row, actions]);

  const primaryKind = row ? orderPanelPrimary(row) : null;
  const primary: ActionSpec | undefined = useMemo(() => {
    if (!row) return undefined;
    switch (primaryKind) {
      case 'create_label':
        return { id: 'create-label', label: t('actions.createLabel'), icon: icons.label, onClick: () => onCreateLabel(row), shortcut: '⌘↵' };
      case 'print_label':
        return { id: 'print-label', label: t('actions.printLabel'), icon: icons.print, onClick: () => actions.printLabel(row) };
      case 'fix_address':
        return { id: 'fix-address', label: t('actions.fixAddress'), icon: icons.edit, onClick: () => setEditingShipTo(true) };
      default:
        return undefined;
    }
  }, [row, primaryKind, t, onCreateLabel, actions]);

  const secondary: ActionSpec | undefined = row && !row.isFBA && !row.isMCF
    ? { id: 'packing-slip', label: t('actions.printPackingSlip'), icon: icons.print, onClick: printPackingSlip }
    : undefined;

  const overflow: ActionSpec[] = useMemo(() => {
    if (!row) return [];
    const items: ActionSpec[] = [];
    if (row.marketplaceUrl) items.push({ id: 'open-on', label: t('actions.openOn', { marketplace: mpName }), href: row.marketplaceUrl, icon: icons.externalLink });
    const hasAddress = !row.shipTo.unavailable && Boolean(row.shipTo.street1 || row.shipTo.city);
    if (hasAddress) {
      items.push({ id: 'copy-intl', label: t('actions.copyAddressIntl'), icon: icons.copy, onClick: () => void actions.copyAddress(row, 'intl') });
      items.push({ id: 'copy-tr', label: t('actions.copyAddressTr'), icon: icons.copy, onClick: () => void actions.copyAddress(row, 'tr') });
    }
    if (row.isFBA || row.isMCF) items.push({ id: 'packing-slip-menu', label: t('actions.printPackingSlip'), icon: icons.print, onClick: printPackingSlip });
    if (canTrack) items.push({ id: 'add-tracking', label: `${t('actions.addTracking')}…`, icon: icons.push, onClick: () => setTrackingOpen(true) });
    if (isAmazon && !row.isMCF) items.push({ id: 'message-buyer', label: `${t('actions.messageBuyer')}…`, icon: icons.message, onClick: () => setMessageOpen(true) });
    if (row.label?.shipmentId) items.push({ id: 'delete-label', label: t('actions.deleteLabel'), icon: icons.delete, tone: 'danger', onClick: () => setConfirm('deleteLabel') });
    items.push({ id: 'delete-order', label: t('actions.deleteOrder'), icon: icons.delete, tone: 'danger', onClick: () => setConfirm('deleteOrder') });
    return items;
  }, [row, t, mpName, actions, canTrack, isAmazon, printPackingSlip]);

  const navigate = (target: OrderRow | null) => (target ? () => onNavigate(target.id) : undefined);

  // ── loading / error / gone (an off-page ?open= id) ─────────────────────────────────────────────────
  if (!row) {
    const gone = single.state === 'empty';
    const failed = single.state === 'error';
    return (
      <SidePanel open={open} onClose={onClose} size="md" title={t('columns.order')} data-testid="order-panel">
        {gone ? (
          <Box sx={{ p: '20px' }}>
            <ErrorState
              variant="inline"
              title={t('error.orderGone')}
              action={{ id: 'back', label: t('error.backToOrders'), onClick: onClose }}
              data-testid="order-panel-gone"
            />
          </Box>
        ) : failed ? (
          <Box sx={{ p: '20px' }}>
            <ErrorState variant="inline" title={t('error.orderTitle')} onRetry={() => void single.mutate()} data-testid="order-panel-error" />
          </Box>
        ) : (
          <PanelSkeleton sections={4} data-testid="order-panel-loading" />
        )}
      </SidePanel>
    );
  }

  const statusTooltipRaw = row.status.raw ? t('status.rawTooltip', { marketplace: mpName, raw: row.status.raw }) : null;

  const meta = (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
      {/* The order number is copyable here (orders §5); SidePanel's title only takes a string. */}
      <CopyText value={row.orderNumber} display={`#${row.orderNumber}`} mono data-testid="order-panel-number" />
      <span aria-hidden>·</span>
      <span>{storeLabel}</span>
      {row.orderedAt && (
        <>
          <span aria-hidden>·</span>
          <span>{t('panel.ordered', { date: f.date(row.orderedAt, 'datetime') })}</span>
        </>
      )}
      {!row.isFBA && !row.isMCF && row.shipBy && (
        <>
          <span aria-hidden>·</span>
          <ShipBy date={row.shipBy} shippedAt={row.shippedAt} />
        </>
      )}
      {(row.isFBA || row.isMCF) && (
        <>
          <span aria-hidden>·</span>
          <span>{row.isMCF ? t('row.mcf') : t('row.fba')}</span>
        </>
      )}
    </Box>
  );

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        size="md"
        title={t('panel.title', { number: `#${row.orderNumber}` })}
        leading={row.isManual ? undefined : <LogoTile brand={row.store.marketplace} size={24} label={mpName} />}
        status={<StatusPill domain={row.status.domain} status={row.status.key as never} raw={statusTooltipRaw} />}
        meta={meta}
        onPrev={navigate(prevRow)}
        onNext={navigate(nextRow)}
        primary={primary}
        secondary={secondary}
        overflow={overflow}
        dirty={shipToDirty}
        onSave={note.flush}
        data-testid="order-panel"
      >
        {hasLifecycleBadges(lifecycle) && (
          <SidePanelSection id="order-lifecycle" title={t('panel.lifecycle')}>
            <OrderLifecycleBadges
              orderId={row.id}
              flags={lifecycle}
              onChanged={() => {
                void mutateFlags();
                changed();
              }}
            />
          </SidePanelSection>
        )}
        <ItemsSection row={row} openOnLabel={row.marketplaceUrl ? t('actions.openOn', { marketplace: mpName }) : undefined} />
        <ShipToSection
          row={row}
          editing={editingShipTo}
          onEdit={() => setEditingShipTo(true)}
          onCancelEdit={() => {
            setEditingShipTo(false);
            setShipToDirty(false);
          }}
          onSave={async (value) => {
            const ok = await actions.saveShipTo(row, value);
            if (ok) {
              setEditingShipTo(false);
              setShipToDirty(false);
            }
            return ok;
          }}
          saving={actions.busy.shipTo}
          onCopy={(style) => void actions.copyAddress(row, style)}
          onDirtyChange={setShipToDirty}
        />
        <LabelSection row={row} onAddTracking={canTrack ? () => setTrackingOpen(true) : undefined} />
        <NoteSection note={note} />
        <CostsSection row={row} onSave={(amount, currency) => actions.saveCarrierCost(row, amount, currency)} saving={actions.busy.cost} baseCurrency={baseCurrency} />
        <HistorySection row={row} marketplaceName={mpName} />
      </SidePanel>

      <AddTrackingModal
        open={trackingOpen && canTrack}
        row={row}
        onClose={() => setTrackingOpen(false)}
        onSubmit={(input) => actions.submitTracking(row, input)}
      />
      {isAmazon && <MessageBuyerModal open={messageOpen} row={row} onClose={() => setMessageOpen(false)} />}

      <ConfirmDialog
        open={confirm === 'deleteOrder'}
        tone="danger"
        title={t('confirm.deleteOrder.title', { number: `#${row.orderNumber}` })}
        body={row.isManual ? t('confirm.deleteOrder.bodyManual') : t('confirm.deleteOrder.body', { marketplace: mpName })}
        confirmLabel={t('confirm.deleteOrder.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          const ok = await actions.deleteOrder(row);
          if (ok) onClose();
        }}
        data-testid="confirm-delete-order"
      />
      <ConfirmDialog
        open={confirm === 'deleteLabel'}
        tone="danger"
        title={t('confirm.deleteLabel.title', { number: `#${row.orderNumber}` })}
        body={t('confirm.deleteLabel.body')}
        confirmLabel={t('confirm.deleteLabel.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void actions.deleteLabel(row);
        }}
        data-testid="confirm-delete-label"
      />
    </>
  );
}

export default OrderPanel;

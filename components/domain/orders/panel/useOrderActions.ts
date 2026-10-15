/**
 * OrderPanel side effects (orders §5, §8): ship-to save, carrier cost, tracking push, delete order / label,
 * copy address, print. Same endpoints and bodies as the legacy labels page; nothing new on the wire
 * except that the ship-to save sends the fields `/api/orders/update` actually reads (see `buildShipToUpdateBody`).
 *
 * Every action reports through the DS toast (i18n text, no server JSON) and calls `onChanged()` after a
 * successful write so the list (SWR prefix `/api/orders`) revalidates.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ds/feedback/toast';
import { copyText } from '@/lib/hooks/useCopy';
import { fetchWithLimit, UsageLimitError } from '@/lib/fetchWithLimit';
import { formatAddressForCopy, type AddressCopyStyle } from '@/lib/format/address';
import { openPrintPage } from '@/lib/print/openPrintPage';
import { openLabelUrl } from '@/lib/shipping/labelLinks';
import { trackingPushOutcome, normalizeTrackingNumber, type TrackingPushOutcome } from '@/lib/shipping/trackingCarriers';
import { logoDisplayName } from '@/lib/ds/logos';
import type { CarrierCost, OrderRow, ShipTo } from '@/lib/orders/types';
import type { ShipToValue } from './ShipToForm';

/* ------------------------------------------------------------------ pure request builders (tested) */

/** "Sarah Ann Miller" → { first: "Sarah Ann", last: "Miller" } (split at the last space, as the FedEx adapter). */
export function splitRecipientName(name: string): { first: string; last: string } {
  const n = (name || '').trim().replace(/\s+/g, ' ');
  const i = n.lastIndexOf(' ');
  if (i <= 0) return { first: n, last: '' };
  return { first: n.slice(0, i), last: n.slice(i + 1) };
}

/**
 * Body for `POST /api/orders/update`. The route reads the top-level `recipient*` fields (and only `email`
 * from `shippingAddress`), then stores `{ firstName, lastName, street1, street2, city, state, postal, country,
 * phone, email }` as `Order.shippingAddress`. KolayXport only: the marketplace is never touched.
 */
export function buildShipToUpdateBody(orderId: string, v: ShipToValue) {
  const { first, last } = splitRecipientName(v.name);
  const tr = (s: string) => (s || '').trim();
  return {
    id: orderId,
    recipientFirstName: first,
    recipientLastName: last,
    recipientStreet1: tr(v.street1),
    recipientStreet2: tr(v.street2),
    recipientCity: tr(v.city),
    recipientState: tr(v.state),
    recipientPostal: tr(v.postal),
    recipientCountry: tr(v.country).toUpperCase(),
    recipientPhone: tr(v.phone),
    shippingAddress: {
      firstName: first,
      lastName: last,
      street1: tr(v.street1),
      street2: tr(v.street2),
      city: tr(v.city),
      state: tr(v.state),
      postal: tr(v.postal),
      country: tr(v.country).toUpperCase(),
      phone: tr(v.phone),
      email: tr(v.email),
    },
  };
}

export interface TrackingInput {
  trackingNumber: string;
  carrierId: number;
  notifyCustomer: boolean;
}

/** Body for `POST /api/orders/:id/submit-tracking` (orders §2.8). */
export function buildTrackingBody(input: TrackingInput) {
  return {
    trackingNumber: normalizeTrackingNumber(input.trackingNumber),
    carrierId: input.carrierId,
    notifyCustomer: input.notifyCustomer,
    updateRemoteOrder: true,
  };
}

/** Carrier-cost currencies the API accepts (`shipping-cost.ts`). */
export const CARRIER_COST_CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'] as const;

/** Address as `formatAddressForCopy` expects it. */
export function copyableShipTo(shipTo: ShipTo) {
  return {
    name: shipTo.name,
    street1: shipTo.street1,
    street2: shipTo.street2,
    neighborhood: shipTo.neighbourhood,
    district: shipTo.district,
    city: shipTo.city,
    state: shipTo.state,
    postal: shipTo.postal,
    country: shipTo.country,
    phone: shipTo.phone,
    email: shipTo.email,
  };
}

/** Server error text for an inline cause (never JSON; max 200 chars). */
export async function readServerError(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; details?: unknown } | null;
  const msg = typeof body?.details === 'string' ? body.details : typeof body?.error === 'string' ? body.error : null;
  return msg ? msg.slice(0, 200) : null;
}

export class ActionError extends Error {
  status: number;
  cause?: string | null;
  constructor(status: number, cause?: string | null) {
    super(cause || `HTTP ${status}`);
    this.name = 'ActionError';
    this.status = status;
    this.cause = cause ?? null;
  }
}

/* ------------------------------------------------------------------ hook */

export type OrderActionKey = 'shipTo' | 'cost' | 'tracking' | 'deleteOrder' | 'deleteLabel' | 'message';

export interface TrackingResult {
  outcome: TrackingPushOutcome;
}

export interface UseOrderActionsResult {
  busy: Partial<Record<OrderActionKey, boolean>>;
  /** Resolves true when saved. */
  saveShipTo: (row: OrderRow, value: ShipToValue) => Promise<boolean>;
  /** Resolves the stored cost (null = cleared), or `undefined` on failure. */
  saveCarrierCost: (row: OrderRow, amount: number | null, currency: string | null) => Promise<CarrierCost | null | undefined>;
  /** Throws `ActionError` (with the server cause) or `UsageLimitError`; the modal shows it inline. */
  submitTracking: (row: OrderRow, input: TrackingInput) => Promise<TrackingResult>;
  deleteOrder: (row: OrderRow) => Promise<boolean>;
  deleteLabel: (row: OrderRow) => Promise<boolean>;
  copyAddress: (row: OrderRow, style: AddressCopyStyle) => Promise<boolean>;
  /** Call synchronously inside the click (popup rule). */
  printPackingSlip: (row: OrderRow) => void;
  /** Call synchronously inside the click (popup rule). */
  printLabel: (row: OrderRow) => void;
}

export function useOrderActions({ onChanged }: { onChanged?: () => void } = {}): UseOrderActionsResult {
  const t = useTranslations('orders');
  const tp = useTranslations('printSlips');
  const toast = useToast();
  const [busy, setBusy] = useState<Partial<Record<OrderActionKey, boolean>>>({});

  const run = useCallback(async <T,>(key: OrderActionKey, fn: () => Promise<T>): Promise<T> => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      return await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }, []);

  const changed = useCallback(() => onChanged?.(), [onChanged]);

  const saveShipTo = useCallback((row: OrderRow, value: ShipToValue) => run('shipTo', async () => {
    try {
      const res = await fetch('/api/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildShipToUpdateBody(row.id, value)),
      });
      if (!res.ok) throw new ActionError(res.status, await readServerError(res));
      // {marketplace} is the marketplace ("Etsy"), not the shop name; manual orders have no marketplace copy.
      if (row.isManual) toast.success(t('panel.addressSavedManual'));
      else toast.success(t('panel.addressSaved', { marketplace: logoDisplayName(row.store.marketplace) ?? row.marketplace }));
      changed();
      return true;
    } catch {
      toast.error(t('panel.addressSaveFailed'), { persist: false });
      return false;
    }
  }), [run, t, toast, changed]);

  const saveCarrierCost = useCallback((row: OrderRow, amount: number | null, currency: string | null) => run('cost', async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(row.id)}/shipping-cost`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cost: amount, currency: amount == null ? null : currency }),
      });
      if (!res.ok) throw new ActionError(res.status, await readServerError(res));
      const data = (await res.json().catch(() => ({}))) as { manualShippingCost?: number | null; manualShippingCostCurrency?: string | null };
      const stored: CarrierCost | null = data.manualShippingCost != null
        ? { amount: Number(data.manualShippingCost), currency: data.manualShippingCostCurrency ?? null }
        : null;
      toast.success(t('panel.carrierCostSaved'));
      changed();
      return stored;
    } catch {
      toast.error(t('panel.carrierCostSaveFailed'), { persist: false });
      return undefined;
    }
  }), [run, t, toast, changed]);

  const submitTracking = useCallback((row: OrderRow, input: TrackingInput) => run('tracking', async () => {
    const res = await fetchWithLimit(`/api/orders/${encodeURIComponent(row.id)}/submit-tracking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(buildTrackingBody(input)),
    });
    if (!res.ok) throw new ActionError(res.status, await readServerError(res));
    const body = await res.json().catch(() => ({}));
    changed();
    return { outcome: trackingPushOutcome(body) };
  }), [run, changed]);

  const deleteOrder = useCallback((row: OrderRow) => run('deleteOrder', async () => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(row.id)}/delete`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new ActionError(res.status, await readServerError(res));
      toast.success(t('confirm.deleteOrder.done', { number: `#${row.orderNumber}` }));
      changed();
      return true;
    } catch {
      toast.error(t('confirm.deleteOrder.failed'), { persist: false });
      return false;
    }
  }), [run, t, toast, changed]);

  const deleteLabel = useCallback((row: OrderRow) => run('deleteLabel', async () => {
    const shipmentId = row.label?.shipmentId;
    if (!shipmentId) return false;
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}/delete`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new ActionError(res.status, await readServerError(res));
      toast.success(t('confirm.deleteLabel.done'));
      changed();
      return true;
    } catch {
      toast.error(t('confirm.deleteLabel.failed'), { persist: false });
      return false;
    }
  }), [run, t, toast, changed]);

  const copyAddress = useCallback(async (row: OrderRow, style: AddressCopyStyle) => {
    const text = formatAddressForCopy(copyableShipTo(row.shipTo), style);
    const ok = text ? await copyText(text) : false;
    if (ok) toast.success(t('panel.addressCopied'));
    else toast.error(t('panel.copyFailed'), { persist: false });
    return ok;
  }, [t, toast]);

  const printPackingSlip = useCallback((row: OrderRow) => {
    const r = openPrintPage('packing-slips', [row.id]);
    if (!r.ok && r.reason === 'blocked') toast.error(tp('popupBlocked'), { persist: false });
  }, [toast, tp]);

  const printLabel = useCallback((row: OrderRow) => {
    const href = row.label?.labelHref;
    const ok = openLabelUrl(href, `label-${row.orderNumber}`);
    if (!ok) toast.error(tp('popupBlocked'), { persist: false });
  }, [toast, tp]);

  return useMemo(
    () => ({ busy, saveShipTo, saveCarrierCost, submitTracking, deleteOrder, deleteLabel, copyAddress, printPackingSlip, printLabel }),
    [busy, saveShipTo, saveCarrierCost, submitTracking, deleteOrder, deleteLabel, copyAddress, printPackingSlip, printLabel],
  );
}

export { UsageLimitError };
export default useOrderActions;

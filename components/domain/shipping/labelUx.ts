// components/domain/shipping/labelUx.ts — pure helpers behind the compact Create-label panel (usability wave
// 2026-10-15): route (domestic TR → TR vs international), which carriers lead the list for that route, the
// last-used service per route (localStorage, try/catch), and masked marketplace addresses (Trendyol shows
// "***" until the parcel is handed to its carrier).
import type { CarrierKey, ShipTo } from '@/lib/shipping/labelDraft';
import { parseRateId, serviceCodes, type Eligibility } from '@/lib/shipping/carriers';

export type Route = 'domestic' | 'international';

export const routeOf = (senderCountry: string | null | undefined, recipientCountry: string | null | undefined): Route =>
  (senderCountry || '').toUpperCase() === 'TR' && (recipientCountry || '').toUpperCase() === 'TR' ? 'domestic' : 'international';

/** Carriers shown up front for a route; the rest sit behind "Other carriers". */
export function primaryCarriersFor(route: Route): CarrierKey[] {
  return route === 'domestic' ? ['dhl'] : ['fedex', 'ups'];
}

const ROUTE_RATE_KEY = 'kx.createLabel.lastRate.';

/** Last-used `rateId` for a route, or null (storage blocked / nothing stored / unknown service). */
export function readRouteRate(route: Route): { carrier: CarrierKey; service: string } | null {
  try {
    const v = window.localStorage.getItem(ROUTE_RATE_KEY + route);
    const p = v ? parseRateId(v) : null;
    return p && serviceCodes(p.carrier).includes(p.service) ? p : null;
  } catch {
    return null;
  }
}

export function rememberRouteRate(route: Route, carrier: CarrierKey, service: string): void {
  try {
    window.localStorage.setItem(ROUTE_RATE_KEY + route, `${carrier}:${service}`);
  } catch { /* storage blocked: nothing to remember */ }
}

/** The remembered rate when its carrier is still available for this route. */
export function rememberedRate(route: Route, elig: readonly Eligibility[]): { carrier: CarrierKey; service: string } | null {
  const p = readRouteRate(route);
  if (!p) return null;
  return elig.some((e) => e.carrier === p.carrier && e.available) ? p : null;
}

const MASK = /\*{3,}/;
const MASKABLE: ReadonlyArray<keyof ShipTo> = ['name', 'street1', 'street2', 'city', 'district', 'neighbourhood', 'postal', 'state'];

/** Trendyol (and similar) hide the address with "***" until shipment. */
export function isMaskedShipTo(s: Partial<ShipTo> | null | undefined): boolean {
  if (!s) return false;
  return (['name', 'street1', 'city'] as const).some((f) => MASK.test(String(s[f] ?? '')));
}

/** Masked values become '' so a form never shows "***" as if it were data. */
export function stripMasked(s: ShipTo): ShipTo {
  const out = { ...s };
  for (const f of MASKABLE) if (MASK.test(String(out[f] ?? ''))) out[f] = '';
  return out;
}

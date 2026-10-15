/**
 * Carrier ids for `POST /api/orders/:id/submit-tracking` (`carrierId`), moved out of the legacy labels
 * page (`VEEQO_CARRIERS_BASE`, orders §12). The ids are Veeqo carrier ids; the server maps them to each
 * marketplace's carrier name (`getCarrierName`). Pure, no I/O.
 */

export interface TrackingCarrier {
  /** Veeqo carrier id sent as `carrierId`. */
  id: number;
  /** Proper-noun carrier name (not translated). `null` = "Other" (the UI shows `orders.tracking.carrierOther`). */
  name: string | null;
  /** Brand key for `LogoTile` (`lib/ds/logos.ts`), when the carrier has a mark. */
  brand?: string;
}

/** Same ids and order as the legacy `VEEQO_CARRIERS_BASE`. */
export const TRACKING_CARRIERS: readonly TrackingCarrier[] = [
  { id: 1, name: 'Royal Mail' },
  { id: 2, name: 'FedEx', brand: 'fedex' },
  { id: 3, name: null },
  { id: 4, name: 'DPD' },
  { id: 5, name: 'UPS', brand: 'ups' },
  { id: 7, name: 'USPS' },
  { id: 9, name: 'DHL', brand: 'dhl' },
  { id: 10, name: 'DHL eCommerce (MNG Kargo)', brand: 'mng' },
  { id: 12, name: 'Yurtiçi Kargo' },
  { id: 13, name: 'Aras Kargo' },
  { id: 14, name: 'Sürat Kargo' },
  { id: 15, name: 'Trendyol Express' },
] as const;

/** "Other" carrier id (the server default when `carrierId` is missing). */
export const OTHER_CARRIER_ID = 3;

/** Map a stored carrier name (Shipment.carrier, LabelJob.carrier) to the tracking carrier id (3 = Other). */
export function carrierToTrackingId(carrier: string | null | undefined): number {
  const c = (carrier || '').toLowerCase();
  if (!c || c === '—') return OTHER_CARRIER_ID;
  if (c.includes('fedex')) return 2;
  if (c.includes('ups')) return 5;
  if (c.includes('mng') || c.includes('dhl ecommerce') || c.includes('dhl e-commerce')) return 10;
  if (c.includes('dhl')) return 9;
  if (c.includes('usps')) return 7;
  if (c.includes('dpd')) return 4;
  if (c.includes('royal')) return 1;
  if (c.includes('yurti')) return 12;
  if (c.includes('aras')) return 13;
  if (c.includes('sürat') || c.includes('surat')) return 14;
  if (c.includes('trendyol')) return 15;
  return OTHER_CARRIER_ID;
}

export function trackingCarrierById(id: number): TrackingCarrier | undefined {
  return TRACKING_CARRIERS.find((c) => c.id === id);
}

/** Server-side format check mirrored from submit-tracking.ts (8–40 alphanumerics after trimming). */
export const TRACKING_NUMBER_RE = /^[A-Za-z0-9]{8,40}$/;

/** Normalize what a user pasted: trims and drops inner spaces ("794 6129 0012" → "79461290012"). */
export function normalizeTrackingNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

export function isValidTrackingNumber(raw: string): boolean {
  return TRACKING_NUMBER_RE.test(normalizeTrackingNumber(raw));
}

/**
 * Marketplace key for the ICU `select` messages (`{mp, select, etsy {…} … other {…}}`, orders §11 rule).
 * Accepts the raw `Order.marketplace` / canonical key; unknown values (Etsy shop names included, when the
 * caller did not canonicalize) fall back to `other`.
 */
export type MarketplaceSelectKey = 'etsy' | 'ebay' | 'amazon' | 'trendyol' | 'wix' | 'shopify' | 'hepsiburada' | 'other';

export function marketplaceSelectKey(marketplace: string | null | undefined): MarketplaceSelectKey {
  const m = (marketplace || '').toLowerCase();
  if (m.includes('etsy')) return 'etsy';
  if (m.includes('ebay')) return 'ebay';
  if (m.includes('amazon')) return 'amazon';
  if (m.includes('trendyol')) return 'trendyol';
  if (m.includes('wix')) return 'wix';
  if (m.includes('shopify')) return 'shopify';
  if (m.includes('hepsiburada')) return 'hepsiburada';
  return 'other';
}

/**
 * What a `submit-tracking` 200 response actually means. The route answers `success: true` both when the
 * marketplace accepted the number and when it only saved it locally after a push failure (its `message`
 * then reads "Tracking saved locally. <X> push failed…"), and `etsyPending: true` when the Chrome
 * extension will push it. Until the route returns an explicit flag (outOfScope request), the UI reads it here.
 */
export type TrackingPushOutcome = 'sent' | 'queued' | 'saved_not_sent';

export function trackingPushOutcome(body: unknown): TrackingPushOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { etsyPending?: unknown; message?: unknown; warning?: unknown };
  if (b.etsyPending === true) return 'queued';
  const msg = typeof b.message === 'string' ? b.message : '';
  if (b.warning || /saved locally/i.test(msg)) return 'saved_not_sent';
  return 'sent';
}

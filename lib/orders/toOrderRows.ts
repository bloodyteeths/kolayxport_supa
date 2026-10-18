/**
 * `/api/orders` payload → `OrderRow[]` (orders §10, §4.2, §7.2). One row per order.
 *
 * Moved from `pages/app/labels.tsx` (`extractAddress`, `toLabelRows`, `getProductTitle`,
 * `parseEtsyPersonalization`, `resolveEtsyCountryCode`) without changing what it reads, with
 * these fixes the spec asks for:
 * - no "USD" default currency, no `/placeholder.png`, no invented ship-by (extension "Ship by
 *   tomorrow" text is not used; effective ship-by = `lib/orders/views.ts` `effectiveShipBy`);
 * - voided labels are no label; Trendyol's pre-assigned `cargoTrackingNumber` is not a label;
 * - duplicate line items (one per LabelJob from the API's LEFT JOIN) are merged;
 * - the async fetches (`/api/etsy-addresses`, `/api/listing-urls`) are split out into
 *   `fetchOrderEnrichment`, so the mapping itself is pure and unit-tested.
 */
import { trendyolCargoInfo } from '@/lib/trendyol/cargoInfo';
import { orderRowStatus } from '@/lib/ds/status/orders';
import { logoDisplayName } from '@/lib/ds/logos';
import { canonicalStore } from '@/lib/marketplaces/canonical';
import { marketplaceOrderUrl, itemListingUrl } from './marketplaceUrls';
import {
  NO_POSTAL_COUNTRIES,
  VOIDED_LABEL_STATUS,
  effectiveShipBy,
  isLabelFailedOrder,
  orderHasLabel,
  type OrderViewFacts,
} from './views';
import type {
  ApiLabelJob,
  ApiLineItem,
  ApiOrder,
  ApiShipment,
  ApiTrackingSubmission,
  CarrierCost,
  EtsyAddressEnrichment,
  LabelFailure,
  LatestLabel,
  ListingUrlLookup,
  OrderEnrichment,
  OrderHistoryEvent,
  OrderItemRow,
  OrderRow,
  ShipTo,
  ShipToField,
  TrackingSubmissionSummary,
} from './types';

export interface ToOrderRowsContext {
  enrichment?: OrderEnrichment;
  /** The user's Etsy shop names (`/api/orders` `etsyShopNames`). */
  etsyShopNames?: readonly string[];
  now?: Date;
}

/* ------------------------------------------------------------------ small helpers */

type Obj = Record<string, any>;

export function parseJsonObject(v: unknown): Obj {
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return {};
    try {
      const p = JSON.parse(t);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

const isAnonymized = (v: unknown) => typeof v === 'string' && /anonymi[sz]ed/i.test(v);

/** First non-blank string that is not an Amazon "Anonymized" placeholder or the legacy '—'. */
function pick(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t && t !== '—' && !isAnonymized(t)) return t;
    }
  }
  return '';
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let d: Date;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
    const n = Number(v);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

const timeOf = (v: string | null | undefined) => (v ? new Date(v).getTime() : Number.NEGATIVE_INFINITY);

/* ------------------------------------------------------------------ country */

const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'united states': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states of america': 'US',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
  canada: 'CA', australia: 'AU', 'new zealand': 'NZ',
  germany: 'DE', deutschland: 'DE',
  france: 'FR', italy: 'IT', italia: 'IT',
  spain: 'ES', españa: 'ES', espana: 'ES',
  netherlands: 'NL', holland: 'NL',
  belgium: 'BE', switzerland: 'CH', austria: 'AT',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', iceland: 'IS',
  ireland: 'IE', portugal: 'PT',
  poland: 'PL', 'czech republic': 'CZ', czechia: 'CZ',
  hungary: 'HU', romania: 'RO', bulgaria: 'BG',
  greece: 'GR', turkey: 'TR', türkiye: 'TR', turkiye: 'TR',
  russia: 'RU', ukraine: 'UA',
  japan: 'JP', 'south korea': 'KR', korea: 'KR', china: 'CN',
  india: 'IN', singapore: 'SG', 'hong kong': 'HK', taiwan: 'TW',
  thailand: 'TH', vietnam: 'VN', indonesia: 'ID', malaysia: 'MY', philippines: 'PH',
  mexico: 'MX', brazil: 'BR', argentina: 'AR', chile: 'CL', colombia: 'CO', peru: 'PE',
  'south africa': 'ZA', egypt: 'EG', israel: 'IL',
  'saudi arabia': 'SA', 'united arab emirates': 'AE', uae: 'AE', qatar: 'QA',
  // Postal-free countries stores send by name (views.ts NO_POSTAL_NAMES): each must resolve to its code.
  macau: 'MO', macao: 'MO', bahamas: 'BS', 'the bahamas': 'BS', belize: 'BZ', fiji: 'FJ', ghana: 'GH',
};

/** ISO2 for a code or an English/Turkish country name; the raw value uppercased otherwise; '' when blank. */
export function resolveCountryCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRY_NAME_TO_ISO[t.toLocaleLowerCase('en')] ?? t.toUpperCase();
}

/** Legacy `resolveEtsyCountryCode` (extension can send ISO2, a display name or "USA"). */
function etsyCountry(addr: Obj | null | undefined): string {
  return resolveCountryCode(addr?.country_iso ?? addr?.countryCode ?? addr?.country_code ?? addr?.country ?? addr?.countryName ?? '');
}

/* ------------------------------------------------------------------ address */

/** Legacy `parseEtsyPersonalization`: the "Personalization…|" segment of the extension notes. */
export function parseEtsyPersonalization(notes: unknown): string {
  if (!notes || typeof notes !== 'string') return '';
  const m = notes.match(/Personalization([^|]*)/);
  if (!m || !m[1]) return '';
  const p = m[1].trim();
  if (/not requested|no personalization/i.test(p)) return '';
  return p;
}

/** Required fields that are empty (orders §4.2 rule 7). Twin of ADDRESS_INCOMPLETE_SQL. */
export function shipToMissing(a: Pick<ShipTo, 'street1' | 'city' | 'postal' | 'country'>): ShipToField[] {
  const missing: ShipToField[] = [];
  if (!a.street1.trim()) missing.push('street1');
  if (!a.city.trim()) missing.push('city');
  const country = resolveCountryCode(a.country);
  if (!a.postal.trim() && !(NO_POSTAL_COUNTRIES as readonly string[]).includes(country)) missing.push('postal');
  if (!country) missing.push('country');
  return missing;
}

const NAME_HIDDEN = /anonymi[sz]ed|^amazon customer$/i;

/**
 * Ship-to of an order: legacy `extractAddress` (shippingAddress JSON, rawData deliver_to /
 * billing_address / top level, to_address, Wix destination, Trendyol shipmentAddress), the API's
 * flattened `recipient*` fields as a last fallback, then the Chrome extension's EtsyAddress.
 */
export function extractShipTo(
  order: ApiOrder,
  etsy: EtsyAddressEnrichment | null | undefined,
  isEtsyStore: boolean,
): ShipTo {
  const addr = parseJsonObject(order.shippingAddress);
  const raw = parseJsonObject(order.rawData);
  const deliverTo: Obj = raw.deliver_to || {};
  const billing: Obj = raw.billing_address || {};
  const fb = (keys: string[]) => {
    for (const k of keys) {
      const v = pick(addr[k]) || pick(raw[k]);
      if (v) return v;
    }
    return '';
  };

  let firstName = pick(addr.recipientFirstName, addr.recipient_first_name, addr.first_name, deliverTo.first_name, billing.first_name, raw.first_name, fb(['recipientFirstName', 'recipient_first_name', 'first_name']));
  let lastName = pick(addr.recipientLastName, addr.recipient_last_name, addr.last_name, deliverTo.last_name, billing.last_name, raw.last_name, fb(['recipientLastName', 'recipient_last_name', 'last_name']));
  if (!firstName && !lastName) {
    const full = pick(addr.name, raw.name, fb(['name']));
    if (full) {
      const parts = full.split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ');
    }
  }
  firstName = firstName || pick(order.recipientFirstName);
  lastName = lastName || pick(order.recipientLastName);

  const a = {
    street1: pick(addr.recipientStreet1, addr.recipient_street1, addr.address1, addr.street1, deliverTo.address1, deliverTo.street1, billing.address1, raw.address1, raw.street1, fb(['recipientStreet1', 'recipient_street1', 'address1', 'street1'])),
    street2: pick(addr.recipientStreet2, addr.recipient_street2, addr.address2, addr.street2, deliverTo.address2, deliverTo.street2, billing.address2, raw.address2, raw.street2, fb(['recipientStreet2', 'recipient_street2', 'address2', 'street2'])),
    city: pick(addr.recipientCity, addr.recipient_city, addr.city, deliverTo.city, billing.city, raw.city, fb(['recipientCity', 'recipient_city', 'city'])),
    state: pick(addr.recipientState, addr.recipient_state, addr.state, addr.province, deliverTo.state, deliverTo.province, billing.state, raw.state, raw.province, fb(['recipientState', 'recipient_state', 'state', 'province'])),
    postal: pick(addr.recipientPostal, addr.recipient_postal, addr.postal, addr.zip, addr.postalCode, addr.postcode, deliverTo.zip, deliverTo.postalCode, deliverTo.postcode, billing.zip, billing.postalCode, billing.postcode, raw.zip, raw.postalCode, raw.postcode, fb(['recipientPostal', 'recipient_postal', 'postal', 'zip', 'postalCode', 'postcode'])),
    country: pick(addr.recipientCountry, addr.recipient_country, addr.country, deliverTo.country, billing.country, raw.country, fb(['recipientCountry', 'recipient_country', 'country'])),
    phone: pick(addr.recipientPhone, addr.recipient_phone, addr.phone, deliverTo.phone, billing.phone, raw.phone, fb(['recipientPhone', 'recipient_phone', 'phone'])),
    email: pick(addr.recipientEmail, addr.recipient_email, addr.email, deliverTo.email, billing.email, raw.email, fb(['recipientEmail', 'recipient_email', 'email'])),
  };

  // rawData fallbacks (legacy order: to_address, Wix, shipmentAddress). Legacy ran them only when street or
  // city was missing; they also run when postal or country is missing, and each fills only empty fields,
  // so the result matches ADDRESS_INCOMPLETE_SQL, which accepts each field from any source.
  const incomplete = () => !a.street1 || !a.city || !a.postal || !a.country;
  if (incomplete()) {
    const to: Obj | null = raw.to_address && typeof raw.to_address === 'object' ? raw.to_address : null;
    if (to) {
      a.street1 = a.street1 || pick(to.street1);
      a.street2 = a.street2 || pick(to.street2);
      a.city = a.city || pick(to.city);
      a.state = a.state || pick(to.state);
      a.postal = a.postal || pick(to.postal, to.zip);
      a.country = a.country || pick(to.country);
      a.phone = a.phone || pick(to.phone);
      if ((!firstName || !lastName) && pick(to.name)) {
        const parts = pick(to.name).split(' ');
        firstName = firstName || parts[0] || '';
        lastName = lastName || parts.slice(1).join(' ');
      }
    }
    const wixDest: Obj | undefined = raw.shippingInfo?.logistics?.shippingDestination;
    if (wixDest?.address) {
      const w: Obj = wixDest.address;
      const c: Obj = wixDest.contactDetails || raw.billingInfo?.contactDetails || {};
      a.street1 = a.street1 || pick(w.addressLine, w.addressLine1);
      a.street2 = a.street2 || pick(w.addressLine2);
      a.city = a.city || pick(w.city);
      a.state = a.state || pick(w.subdivisionFullname, w.subdivision);
      a.postal = a.postal || pick(w.postalCode);
      a.country = a.country || pick(w.country);
      a.phone = a.phone || pick(c.phone);
      firstName = firstName || pick(c.firstName);
      lastName = lastName || pick(c.lastName);
      a.email = a.email || pick(raw.buyerInfo?.email);
    }
  }
  const sa: Obj | null = raw.shipmentAddress && typeof raw.shipmentAddress === 'object' ? raw.shipmentAddress : null;
  if (sa && incomplete()) {
    a.street1 = a.street1 || pick(sa.address1, sa.address);
    a.street2 = a.street2 || pick(sa.address2);
    a.city = a.city || pick(sa.city);
    a.state = a.state || pick(sa.stateName, sa.state);
    a.postal = a.postal || pick(sa.postalCode, sa.zipCode);
    a.country = a.country || pick(sa.countryCode);
    a.phone = a.phone || pick(sa.phone);
    if (!firstName || !lastName) {
      if (sa.firstName || sa.lastName) {
        firstName = firstName || pick(sa.firstName);
        lastName = lastName || pick(sa.lastName);
      } else if (pick(sa.fullName)) {
        const parts = pick(sa.fullName).split(' ');
        firstName = firstName || parts[0] || '';
        lastName = lastName || parts.slice(1).join(' ');
      }
    }
  }

  // The API's own flattening (Trendyol / Wix structured addresses) as the last source.
  a.street1 = a.street1 || pick(order.recipientStreet1);
  a.street2 = a.street2 || pick(order.recipientStreet2);
  a.city = a.city || pick(order.recipientCity);
  a.state = a.state || pick(order.recipientState);
  a.postal = a.postal || pick(order.recipientPostal);
  a.country = a.country || pick(order.recipientCountry);
  a.phone = a.phone || pick(order.recipientPhone);

  // Chrome extension EtsyAddress (legacy: whenever street or city is missing).
  let enrichedFromEtsy = false;
  const ea: Obj | null = etsy?.shippingAddress && typeof etsy.shippingAddress === 'object' ? (etsy.shippingAddress as Obj) : null;
  if (ea && (!a.street1 || !a.city)) {
    enrichedFromEtsy = true;
    const nameParts = pick(ea.name).split(' ');
    firstName = firstName || nameParts[0] || '';
    lastName = lastName || nameParts.slice(1).join(' ');
    a.street1 = a.street1 || pick(ea.line1);
    a.street2 = a.street2 || pick(ea.line2);
    a.city = a.city || pick(ea.city);
    a.state = a.state || pick(ea.state);
    a.postal = a.postal || pick(ea.postalCode);
    a.country = a.country || etsyCountry(ea);
    a.email = a.email || pick(ea.email);
    a.phone = a.phone || pick(ea.phone);
  }

  const rawNames = [addr.name, order.customerName, firstName, sa?.fullName].filter((v) => typeof v === 'string') as string[];
  const nameHidden = rawNames.some((n) => NAME_HIDDEN.test(n.trim())) && !firstName && !lastName;
  const name = `${firstName} ${lastName}`.trim();
  const country = resolveCountryCode(a.country);
  const base = { ...a, country };
  const missing = shipToMissing(base);
  const unavailable = isEtsyStore && !enrichedFromEtsy && !a.street1 && !a.city && !a.postal;

  return {
    name,
    firstName,
    lastName,
    phone: a.phone,
    email: a.email,
    country,
    street1: a.street1,
    street2: a.street2,
    city: a.city,
    state: a.state,
    postal: a.postal,
    district: pick(sa?.district),
    neighbourhood: pick(sa?.neighborhood, sa?.neighbourhood),
    missing,
    unavailable,
    nameHidden,
    enrichedFromEtsy,
  };
}

/* ------------------------------------------------------------------ items */

const MISSING_TITLE = new Set(['', 'Unknown Product', 'N/A']);

/** Merges the API's one-row-per-LabelJob line items by id (LEFT JOIN "LabelJob"). */
export function mergeLineItems(items: readonly ApiLineItem[]): ApiLineItem[] {
  const byId = new Map<string, ApiLineItem>();
  const order: string[] = [];
  items.forEach((item, idx) => {
    const id = String(item.id ?? `idx-${idx}`);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...item, labelJobs: [...(item.labelJobs ?? [])] });
      order.push(id);
    } else {
      prev.labelJobs = [...(prev.labelJobs ?? []), ...(item.labelJobs ?? [])];
    }
  });
  return order.map((id) => byId.get(id)!);
}

const PERSONALIZATION_SEGMENT = /^\s*personali[sz]ation\s*:\s*/i;

/** Splits Etsy's "Color: Pink, Personalization: LENA" into variant text and personalization. */
export function splitVariant(variant: unknown): { variant: string | null; personalization: string | null } {
  const text = typeof variant === 'string' ? variant.trim() : '';
  if (!text || text === '—') return { variant: null, personalization: null };
  const parts = text.split(/,\s*(?=[^,:]+:)/);
  const keep: string[] = [];
  let personalization: string | null = null;
  for (const p of parts) {
    if (PERSONALIZATION_SEGMENT.test(p)) {
      const v = p.replace(PERSONALIZATION_SEGMENT, '').trim();
      if (v && !/not requested/i.test(v)) personalization = v;
    } else if (p.trim()) keep.push(p.trim());
  }
  return { variant: keep.length ? keep.join(', ') : null, personalization };
}

function itemRows(order: ApiOrder, raw: Obj, listingUrls: ListingUrlLookup | undefined, isTrendyol: boolean): OrderItemRow[] {
  const apiItems = Array.isArray(order.line_items) && order.line_items.length > 0 ? order.line_items : null;
  const source: ApiLineItem[] = apiItems ? mergeLineItems(apiItems) : Array.isArray(raw.line_items) ? (raw.line_items as ApiLineItem[]) : [];
  const veeqoProductIds: number[] = Array.isArray(raw.line_items)
    ? (raw.line_items as Obj[]).map((r) => Number(r?.sellable?.product?.id)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const images = listingUrls?.images ?? {};
  const txs: Obj[] = Array.isArray(raw.transactions) ? raw.transactions : [];

  return source.map((item, index) => {
    const veeqo = item.sellable ?? null;
    const title =
      pick(veeqo?.full_title) ||
      [item.productName, item.title, order.commodityDesc, veeqo?.full_title].find((v) => typeof v === 'string' && !MISSING_TITLE.has(v.trim()))?.trim() ||
      '';
    const { variant, personalization: fromVariant } = splitVariant(item.variantInfo);
    const tx = txs.find((t) => item.remoteLineId != null && String(t?.transaction_id) === String(item.remoteLineId));
    const txPersonalization = pick(tx?.personalization);

    let image: string | null = null;
    if (!veeqo && pick(item.image) && item.image !== '/placeholder.png') image = String(item.image);
    else if (veeqo) image = pick(veeqo.image_url, veeqo.product?.main_image_src) || null;
    if (!image) {
      const pid = veeqoProductIds[index];
      image = (pid && images[`veeqo-${pid}`]) || (title && images[title]) || pick(order.imageUrl) || null;
      if (image === '/placeholder.png') image = null;
    }

    const unitPrice = num(veeqo ? veeqo.price : item.unitPrice ?? item.value ?? item.total_price);
    const weight = num(veeqo ? veeqo.weight : item.weight);
    return {
      id: String(item.id ?? item.object_id ?? `${order.id}-item-${index}`),
      title,
      listingUrl: itemListingUrl(
        {
          index,
          title,
          serverUrl: pick(item.etsyListingUrl) || null,
          lineId: (item.remoteLineId as string | undefined) ?? (item.marketplaceKey as string | undefined) ?? item.id ?? null,
          veeqoProductId: veeqo?.product?.id ?? null,
        },
        { isTrendyol, rawData: raw, veeqoProductIds, listingUrls },
      ),
      variant,
      sku: pick(veeqo ? veeqo.sku_code : item.sku) || null,
      quantity: num(item.quantity) && Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      unitPrice,
      image,
      personalization: fromVariant || txPersonalization || null,
      weightKg: weight !== null && weight > 0 ? weight : null,
      hsCode: pick(veeqo ? veeqo.product?.hs_tariff_number : item.hs_code, order.harmonizedCode) || null,
      originCountry: resolveCountryCode(pick(veeqo ? veeqo.product?.origin_country : item.country_of_origin, order.countryOfMfg)) || null,
      shipBy: iso(item.shipBy),
    };
  });
}

/* ------------------------------------------------------------------ labels + tracking */

function allLabelJobs(order: ApiOrder): ApiLabelJob[] {
  return mergeLineItems(order.line_items ?? []).flatMap((i) => i.labelJobs ?? []);
}

/** Newest active label (Shipment created with tracking/PDF, LabelJob created), else the order-level label. */
export function getLatestLabel(order: ApiOrder): LatestLabel | null {
  const candidates: LatestLabel[] = [];
  for (const s of order.shipments ?? []) {
    if (s?.status === 'created' && (s.trackingNumber || s.pdfUrl)) {
      candidates.push({
        source: 'shipment',
        shipmentId: s.id,
        carrier: pick(s.carrier) || null,
        trackingNumber: pick(s.trackingNumber) || null,
        labelHref: pick(s.pdfUrl) || null,
        createdAt: iso(s.createdAt),
      });
    }
  }
  for (const j of allLabelJobs(order)) {
    if (j.status === 'created' && (j.trackingNumber || j.pdfUrl)) {
      candidates.push({
        source: 'labelJob',
        shipmentId: null,
        carrier: pick(j.carrier) || null,
        trackingNumber: pick(j.trackingNumber) || null,
        labelHref: pick(j.pdfUrl) || null,
        createdAt: iso(j.createdAt),
      });
    }
  }
  if (candidates.length > 0) {
    return candidates.reduce((best, c) => (timeOf(c.createdAt) > timeOf(best.createdAt) ? c : best));
  }
  const voided = String(order.labelStatus ?? '').toLowerCase() === VOIDED_LABEL_STATUS;
  if (!voided && (pick(order.trackingNumber) || pick(order.shippingLabelUrl) || order.labelStatus === 'created')) {
    return {
      source: 'order',
      shipmentId: null,
      carrier: null,
      trackingNumber: pick(order.trackingNumber) || null,
      labelHref: pick(order.shippingLabelUrl) || null,
      createdAt: null,
    };
  }
  return null;
}

function latestFailure(order: ApiOrder): LabelFailure | null {
  let best: { carrier: string | null; errorMessage: string | null; at: string | null } | null = null;
  const consider = (carrier: unknown, error: unknown, at: unknown) => {
    const cand = { carrier: pick(carrier) || null, errorMessage: pick(error) || null, at: iso(at) };
    if (!best || timeOf(cand.at) > timeOf(best.at)) best = cand;
  };
  for (const j of allLabelJobs(order)) if (String(j.status).toLowerCase() === 'failed') consider(j.carrier, j.errorMessage, j.createdAt);
  for (const s of order.shipments ?? []) if (String(s?.status).toLowerCase() === 'failed') consider(s.carrier, s.errorMessage, s.createdAt);
  if (!best && String(order.labelStatus ?? '').toLowerCase() === 'failed') best = { carrier: null, errorMessage: null, at: null };
  return best;
}

function latestSubmission(order: ApiOrder): ApiTrackingSubmission | null {
  let best: ApiTrackingSubmission | null = null;
  for (const s of order.trackingSubmissions ?? []) if (!best || timeOf(iso(s.submittedAt)) > timeOf(iso(best.submittedAt))) best = s;
  return best;
}

/** Tracking push result of the newest submission (orders §2.2 caption). */
export function summarizeTracking(order: ApiOrder, isEtsyStore: boolean): TrackingSubmissionSummary | null {
  const s = latestSubmission(order);
  if (!s) return null;
  const status = String(s.status ?? '').toLowerCase();
  const etsy = String(s.etsySubmitStatus ?? '').toLowerCase();
  let state: TrackingSubmissionSummary['state'];
  if (status === 'failed' || etsy === 'failed') state = 'failed';
  else if (isEtsyStore) state = etsy === 'submitted' || etsy === 'submitted_external' ? 'sent' : 'queued';
  else state = status === 'submitted' ? 'sent' : 'pending';
  return {
    state,
    trackingNumber: String(s.trackingNumber ?? ''),
    carrierName: pick(s.carrierName) || null,
    submittedAt: iso(s.submittedAt),
    deliveredAt: iso(s.etsySubmittedAt),
    error: state === 'failed' ? pick(s.errorMessage, s.etsySubmitError) || null : null,
  };
}

function history(order: ApiOrder, orderedAt: string | null, isEtsyStore: boolean): OrderHistoryEvent[] {
  const ev: OrderHistoryEvent[] = [];
  if (orderedAt) ev.push({ kind: 'ordered', at: orderedAt });
  const imported = iso(order.createdAt);
  if (imported) ev.push({ kind: 'imported', at: imported });
  const labelEvent = (status: string, carrier: unknown, tracking: unknown, error: unknown, at: unknown) => {
    const t = iso(at);
    if (!t) return;
    const s = status.toLowerCase();
    if (s === 'created') ev.push({ kind: 'label_created', at: t, carrier: pick(carrier) || null, trackingNumber: pick(tracking) || null });
    else if (s === 'failed') ev.push({ kind: 'label_failed', at: t, carrier: pick(carrier) || null, detail: pick(error) || null });
  };
  for (const s of order.shipments ?? []) labelEvent(String(s?.status ?? ''), s.carrier, s.trackingNumber, s.errorMessage, s.createdAt);
  for (const j of allLabelJobs(order)) labelEvent(String(j.status ?? ''), j.carrier, j.trackingNumber, j.errorMessage, j.createdAt);
  for (const s of order.trackingSubmissions ?? []) {
    const at = iso(s.submittedAt);
    if (!at) continue;
    const failed = String(s.status ?? '').toLowerCase() === 'failed' || String(s.etsySubmitStatus ?? '').toLowerCase() === 'failed';
    const base = { carrier: pick(s.carrierName) || null, trackingNumber: pick(s.trackingNumber) || null };
    if (failed) ev.push({ kind: 'tracking_failed', at, ...base, detail: pick(s.errorMessage, s.etsySubmitError) || null });
    else if (isEtsyStore) {
      ev.push({ kind: 'tracking_queued', at, ...base });
      const sent = iso(s.etsySubmittedAt);
      if (sent) ev.push({ kind: 'tracking_sent', at: sent, ...base });
    } else ev.push({ kind: 'tracking_sent', at, ...base });
  }
  return ev.sort((a, b) => timeOf(a.at) - timeOf(b.at));
}

/* ------------------------------------------------------------------ order row */

/** Legacy order-date order: rawData dates first, then the API's marketplaceOrderDate. Never the epoch. */
function orderedAtOf(order: ApiOrder, raw: Obj): string | null {
  return (
    iso(raw.created_at) ??
    iso(raw.to_address?.object_created) ??
    iso(raw.placed_at) ??
    iso(raw.to_address?.object_updated) ??
    iso(order.marketplaceOrderDate) ??
    iso(order.uiOrderDate) ??
    iso(order.createdAt)
  );
}

/** The fields the views predicates read, from an API order (+ address fact). */
export function viewFactsOf(order: ApiOrder, addressIncomplete?: boolean): OrderViewFacts {
  const items = mergeLineItems(order.line_items ?? []).map((i) => ({ shipBy: i.shipBy ?? null, labelJobs: i.labelJobs ?? [] }));
  return {
    status: order.status,
    marketplace: order.marketplace,
    labelStatus: order.labelStatus,
    trackingNumber: order.trackingNumber,
    shippingLabelUrl: order.shippingLabelUrl,
    shipByAt: order.shipByAt ?? null,
    rawData: order.rawData,
    items,
    shipments: (order.shipments ?? []).map((s: ApiShipment) => ({ status: s.status, trackingNumber: s.trackingNumber ?? null, pdfUrl: s.pdfUrl ?? null })),
    trackingSubmissions: order.trackingSubmissions ?? [],
    addressIncomplete,
  };
}

export function toOrderRow(order: ApiOrder, ctx: ToOrderRowsContext = {}): OrderRow {
  const now = ctx.now ?? new Date();
  const raw = parseJsonObject(order.rawData);
  const store = canonicalStore(order.marketplace, ctx.etsyShopNames ?? []);
  const isEtsyStore = store.marketplace === 'etsy' || String(order.channel ?? '').toLowerCase().includes('etsy');
  const isManual = store.marketplace === 'manual' || raw.manualOrder === true;
  const isTrendyol = store.marketplace === 'trendyol';
  const etsy = order.orderNumber ? ctx.enrichment?.etsyAddresses?.[order.orderNumber] : undefined;

  const shipTo = extractShipTo(order, etsy, isEtsyStore);
  const items = itemRows(order, raw, ctx.enrichment?.listingUrls, isTrendyol);
  const facts = viewFactsOf(order, shipTo.missing.length > 0);
  const hasLabel = orderHasLabel(facts);
  const labelFailed = isLabelFailedOrder(facts);
  const failure = labelFailed ? latestFailure(order) : null;
  const shipByDate = marketplaceShipByDay(effectiveShipBy(facts), order.marketplace);
  const isFBA = order.isFBA === true;

  const status = orderRowStatus({
    rawStatus: order.status,
    marketplace: order.marketplace,
    isFBA,
    labelFailed,
    labelError: failure?.errorMessage ?? null,
    hasLabel,
    addressMissing: shipTo.missing,
    addressUnavailable: shipTo.unavailable,
    shipBy: shipByDate,
    now,
  });
  const labelable = status.key === 'to_ship' || status.key === 'overdue' || status.key === 'label_failed';
  const orderedAt = orderedAtOf(order, raw);

  const total = num(order.orderTotalPrice ?? order.totalPrice ?? raw.total_price);
  const currency = pick(order.currency, raw.currency) || null;
  const costAmount = num(order.manualShippingCost);
  const carrierCost: CarrierCost | null = costAmount !== null ? { amount: costAmount, currency: pick(order.manualShippingCostCurrency) || null } : null;

  const customer = pick(order.customerName);
  const buyerName = shipTo.name || (customer && !NAME_HIDDEN.test(customer) ? customer : '');
  const isHepsiburada = store.marketplace === 'hepsiburada';
  const cargo = (isTrendyol || isHepsiburada) && raw.cargoTrackingNumber != null && String(raw.cargoTrackingNumber).trim() ? String(raw.cargoTrackingNumber).trim() : null;
  const tracking = summarizeTracking(order, isEtsyStore);

  return {
    id: order.id,
    orderNumber: String(order.orderNumber || order.marketplaceOrderId || order.id),
    marketplace: order.marketplace ?? '',
    store,
    storeName: store.shopName ?? logoDisplayName(store.marketplace) ?? (order.marketplace || ''),
    isManual,
    orderedAt,
    importedAt: iso(order.createdAt),
    shipBy: shipByDate ? shipByDate.toISOString() : null,
    shippedAt: iso(order.shippedAt),
    shippingUpgrade: pick(order.shippingUpgrade) || null,
    total,
    currency: currency ? currency.toUpperCase() : null,
    buyerName,
    items,
    shipTo,
    giftMessage: pick(order.giftMessage) || null,
    buyerNote: pick(order.customerNote) || parseEtsyPersonalization(etsy?.notes) || null,
    note: pick(order.senkronData?.internalNote) || null,
    status,
    rawStatus: String(order.status ?? ''),
    label: hasLabel ? getLatestLabel(order) : null,
    labelFailure: failure,
    marketplaceCargoNumber: cargo,
    trendyol: isTrendyol
      ? (({ cargoNumber, carrier, commonLabel, nextStatus }) => ({ cargoNumber, carrier, commonLabel, nextStatus, labelPrintedAt: iso(order.cargoLabelPrintedAt) }))(trendyolCargoInfo(raw))
      : null,
    hepsiburada: isHepsiburada ? {
      packageNumber: raw.packageNumber ? String(raw.packageNumber) : null,
      cargoCompany: raw.cargoProviderName ? String(raw.cargoProviderName) : null,
      canPack: Array.isArray(raw.hbLines) && raw.hbLines.some((l: any) => l?.state === 'open' && !l?.packageNumber),
    } : null,
    trackingSubmission: tracking,
    carrierCost,
    isFBA,
    isMCF: order.isMCF === true,
    canLabel: labelable && !isFBA && shipTo.missing.length === 0,
    marketplaceUrl: isManual ? null : marketplaceOrderUrl(order.marketplace, order.orderNumber, order.channel, { isEtsyStore }),
    history: history(order, orderedAt, isEtsyStore),
    raw: order,
  };
}

/** `/api/orders` orders → rows (one per order id, first occurrence wins). */
export function toOrderRows(orders: readonly ApiOrder[] | null | undefined, ctx: ToOrderRowsContext = {}): OrderRow[] {
  const seen = new Set<string>();
  const rows: OrderRow[] = [];
  for (const o of orders ?? []) {
    if (!o || typeof o !== 'object' || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    rows.push(toOrderRow(o, ctx));
  }
  return rows;
}

/* ------------------------------------------------------------------ enrichment fetch (client) */

/** Order numbers whose ship-to still lacks street or city (candidates for the extension's EtsyAddress). */
export function ordersNeedingEtsyAddress(orders: readonly ApiOrder[]): string[] {
  const out = new Set<string>();
  for (const o of orders) {
    if (!o?.orderNumber) continue;
    const s = extractShipTo(o, null, false);
    if (!s.street1 || !s.city) out.add(o.orderNumber);
  }
  return Array.from(out);
}

/** Body of `POST /api/listing-urls` (Veeqo product ids + titles), or null when nothing to resolve. */
export function listingUrlRequest(orders: readonly ApiOrder[]): { productIds: number[]; titles: string[] } | null {
  const ids = new Set<number>();
  const titles = new Set<string>();
  for (const o of orders) {
    const raw = parseJsonObject(o?.rawData);
    const items: Obj[] = (o?.line_items as Obj[] | undefined) ?? (Array.isArray(raw.line_items) ? raw.line_items : []);
    for (const it of items) {
      const pid = Number(it?.sellable?.product?.id);
      if (Number.isFinite(pid) && pid > 0) ids.add(pid);
      else if (typeof it?.title === 'string' && it.title) titles.add(it.title);
    }
    if (Array.isArray(raw.line_items)) {
      for (const r of raw.line_items as Obj[]) {
        const pid = Number(r?.sellable?.product?.id);
        if (Number.isFinite(pid) && pid > 0) ids.add(pid);
      }
    }
  }
  if (ids.size === 0 && titles.size === 0) return null;
  return { productIds: Array.from(ids), titles: Array.from(titles) };
}

/**
 * Fetches the two enrichments the legacy `toLabelRows` fetched inline. Failures are partial
 * data, never an error (orders §7.2): the rows render without them.
 */
export async function fetchOrderEnrichment(
  orders: readonly ApiOrder[],
  fetchImpl: typeof fetch = fetch,
): Promise<OrderEnrichment> {
  const out: OrderEnrichment = {};
  const numbers = ordersNeedingEtsyAddress(orders);
  const body = listingUrlRequest(orders);
  await Promise.all([
    numbers.length > 0
      ? fetchImpl(`/api/etsy-addresses?${new URLSearchParams({ orderNumbers: numbers.join(',') }).toString()}`, { cache: 'no-store' })
          .then(async (r) => {
            if (!r.ok) return;
            const data = await r.json();
            if (data?.lookup && typeof data.lookup === 'object') out.etsyAddresses = data.lookup;
          })
          .catch(() => undefined)
      : undefined,
    body
      ? fetchImpl('/api/listing-urls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(async (r) => {
            if (!r.ok) return;
            const data = await r.json();
            out.listingUrls = { byProductId: data?.byProductId || {}, byTitle: data?.byTitle || {}, images: data?.images || {} };
          })
          .catch(() => undefined)
      : undefined,
  ]);
  return out;
}

/**
 * eBay states ship-by as a calendar day in US Pacific time ("Ship by Oct 14" = 23:59:59 PT, stored as
 * 2026-10-15T06:59:59Z). Shown in Turkey that instant read "15 Oct 09:59", which is not what eBay shows the seller.
 * Keep eBay's calendar day and end it at 23:59 local time (never later than eBay's own deadline).
 */
export function marketplaceShipByDay(d: Date | null, marketplace: string | null | undefined): Date | null {
  if (!d || String(marketplace ?? '').toLowerCase() !== 'ebay') return d;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = new Date(get('year'), get('month') - 1, get('day'), 23, 59, 0, 0);
  return local.getTime() < d.getTime() ? local : d;
}

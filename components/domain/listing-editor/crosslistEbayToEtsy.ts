// components/domain/listing-editor/crosslistEbayToEtsy.ts — eBay → Etsy "Copy to Etsy" (`/app/etsy-listings/new?crosslist=ebay:<sku>`).
// Mirror of the Etsy → eBay loader (`adapters/ebay.ts` `loadEtsyCrosslistSource`): the eBay listing is read with the
// same read the eBay `?copy=` uses (`/api/clawd/ebay?action=listing&sku=`, read-only) and mapped to the Etsy
// creator's copy data. Nothing is staged here: the create workspace stages it on the seller's first save, and
// nothing reaches Etsy until the explicit send. Legacy equivalent: EtsyListingsLegacy `ebayItemToCopySource`.
import type { CopySourceData } from '@/lib/listingEditor/types';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { parseEbayCrosslist } from '@/lib/listings/legacyHandoff';
import { decodeAspects, loadEbayCopySource, type EbayCopySourceData } from './adapters/ebay';
import { ETSY_MAX_IMAGES } from './adapters/etsy';

/** Etsy title limit. */
const ETSY_TITLE_MAX = 140;
/** Etsy material limits. */
const ETSY_MATERIALS_MAX = 13;
const ETSY_MATERIAL_LEN = 45;

const WEIGHT_UNIT: Record<string, string> = { POUND: 'lb', OUNCE: 'oz', GRAM: 'g', KILOGRAM: 'kg' };
const DIMENSION_UNIT: Record<string, string> = { INCH: 'in', FEET: 'ft', CENTIMETER: 'cm', METER: 'm', MILLIMETER: 'mm' };

/** eBay descriptions are HTML; Etsy wants plain text (pure; no DOM, entities decoded as text). */
export function ebayHtmlToPlainText(html: string): string {
  if (!html) return '';
  const text = html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** eBay copy data (`loadEbayCopySource`) → Etsy create copy data (pure). Tags stay empty: eBay has none. */
export function etsyCopyFromEbaySource(src: EbayCopySourceData): CopySourceData {
  const e = src.ebay ?? {};
  const aspects = decodeAspects(e.aspects ?? '');
  const materialKey = Object.keys(aspects).find((k) => /^materials?$/i.test(k));
  const materials = (materialKey ? aspects[materialKey] : [])
    .map((m) => decodeEntities(String(m)).trim().slice(0, ETSY_MATERIAL_LEN))
    .filter(Boolean)
    .slice(0, ETSY_MATERIALS_MAX);
  const out: CopySourceData = {
    source: 'ebay',
    title: decodeEntities(src.title ?? '').trim().slice(0, ETSY_TITLE_MAX),
    description: ebayHtmlToPlainText(src.description ?? ''),
    tags: [],
    materials,
    price: positive(src.price),
    quantity: typeof src.quantity === 'number' && Number.isInteger(src.quantity) && src.quantity > 0 ? src.quantity : undefined,
    imageUrls: Array.from(new Set((src.imageUrls ?? []).filter((u) => typeof u === 'string' && /^https:\/\//i.test(u)))).slice(0, ETSY_MAX_IMAGES),
  };
  const weight = positive(e.weight);
  const wUnit = e.weightUnit ? WEIGHT_UNIT[String(e.weightUnit).toUpperCase()] : undefined;
  if (weight && wUnit) {
    out.item_weight = weight;
    out.item_weight_unit = wUnit;
  }
  const dUnit = e.dimensionUnit ? DIMENSION_UNIT[String(e.dimensionUnit).toUpperCase()] : undefined;
  const [l, w, h] = [positive(e.length), positive(e.width), positive(e.height)];
  if (dUnit && l && w && h) {
    out.item_length = l;
    out.item_width = w;
    out.item_height = h;
    out.item_dimensions_unit = dUnit;
  }
  return out;
}

/**
 * Pure: the copy keeps its price only when the eBay currency is known and equals the Etsy shop's (no conversion).
 * `priceCleared` → the page tells the seller to set a price in the shop currency.
 */
export function fitEbayCopyToShop(copy: CopySourceData, ebayCurrency: string | null, shopCurrency: string | null): { copy: CopySourceData; priceCleared: boolean } {
  if (typeof copy.price !== 'number') return { copy, priceCleared: false };
  const same = Boolean(ebayCurrency && shopCurrency && ebayCurrency.trim().toUpperCase() === shopCurrency.trim().toUpperCase());
  if (same) return { copy, priceCleared: false };
  const { price: _drop, ...rest } = copy;
  return { copy: rest as CopySourceData, priceCleared: true };
}

/** The Etsy shop's currency from the listings API (`store.currency`); null when unknown. Never throws. */
export async function loadEtsyShopCurrency(shopId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const qs = new URLSearchParams({ marketplace: 'etsy', store: shopId });
    const res = await fetcher(`/api/listings?${qs.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { store?: { currency?: unknown } | null };
    const c = body?.store?.currency;
    return typeof c === 'string' && c.trim() ? c.trim() : null;
  } catch {
    return null;
  }
}

/** Reads the eBay listing (by SKU) and returns the Etsy copy data plus the eBay price currency. Null = not found. */
export async function loadEbayCrosslistForEtsy(sku: string): Promise<{ copy: CopySourceData; currency: string | null } | null> {
  const src = await loadEbayCopySource({ shopId: 'ebay', listingId: sku });
  if (!src) return null;
  const currency = typeof src.ebay?.currency === 'string' && src.ebay.currency ? src.ebay.currency : null;
  return { copy: etsyCopyFromEbaySource(src), currency };
}

/** `/app/etsy-listings/new` bootstrap from the first ready query (pure). Precedence: draft › copy › crosslist › prefill. */
export interface EtsyCreateQuery {
  draftId: string | null;
  copyFromId: string | null;
  /** eBay SKU of a `crosslist=ebay:<sku>` hand-off. */
  crosslistEbaySku: string | null;
  prefill: boolean;
}

export function parseEtsyCreateQuery(q: Record<string, string | string[] | undefined>): EtsyCreateQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const draft = one(q.draft);
  const draftId = typeof draft === 'string' && /^[\w-]{1,64}$/.test(draft) ? draft : null;
  const copy = one(q.copy);
  const copyFromId = !draftId && typeof copy === 'string' && /^\d{1,20}$/.test(copy) ? copy : null;
  const crosslistEbaySku = !draftId && !copyFromId ? parseEbayCrosslist(one(q.crosslist)) : null;
  return { draftId, copyFromId, crosslistEbaySku, prefill: !draftId && !copyFromId && !crosslistEbaySku && one(q.prefill) === 'session' };
}

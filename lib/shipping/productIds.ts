// lib/shipping/productIds.ts — EU customs product identifiers per order item, server side (lib/shipping/euPid.ts holds
// the pure rules). Order: what the seller confirmed on an earlier label for the same SKU / listing, then the barcode
// and MPN on the seller's eBay listing (item specifics EAN / UPC / ISBN / MPN), else the euPid defaults.
import prisma from '@/lib/prisma';
import { defaultProductIds, normalizeGtin, productIdsComplete, type ProductIds } from './euPid';

export type ProductIdSource = 'saved' | 'ebay' | 'default';
export interface ItemProductIds extends ProductIds { source: ProductIdSource }

interface ItemRef { id: string; sku?: string | null; listingRef?: string | null }

const clean = (v: unknown) => String(v ?? '').trim();

/** Storage keys for an item, most specific first. */
export function productKeys(item: { sku?: string | null; listingRef?: string | null }): string[] {
  const out: string[] = [];
  if (clean(item.sku)) out.push(`sku:${clean(item.sku).slice(0, 120)}`);
  if (clean(item.listingRef)) out.push(`listing:${clean(item.listingRef).slice(0, 120)}`);
  return out;
}

/** First value of an eBay aspect (stored as string[] or string). */
function aspect(aspects: unknown, name: string): string {
  if (!aspects || typeof aspects !== 'object') return '';
  const v = (aspects as Record<string, unknown>)[name];
  return clean(Array.isArray(v) ? v[0] : v);
}

/** Barcode + MPN from an eBay listing's item specifics. */
export function idsFromEbayAspects(aspects: unknown): { gtin: string; mpn: string } {
  const gtin = ['EAN', 'UPC', 'ISBN', 'GTIN'].map((k) => normalizeGtin(aspect(aspects, k))).find(Boolean) ?? '';
  return { gtin, mpn: aspect(aspects, 'MPN') };
}

export async function lookupProductIds(userId: string, items: readonly ItemRef[]): Promise<Record<string, ItemProductIds>> {
  const keys = Array.from(new Set(items.flatMap((i) => productKeys(i))));
  const listingRefs = Array.from(new Set(items.map((i) => clean(i.listingRef)).filter(Boolean)));
  const skus = Array.from(new Set(items.map((i) => clean(i.sku)).filter(Boolean)));
  const saved = keys.length ? await prisma.productIdentifier.findMany({ where: { userId, key: { in: keys } } }) : [];
  const ebayWhere = [...(listingRefs.length ? [{ listingId: { in: listingRefs } }] : []), ...(skus.length ? [{ sku: { in: skus } }] : [])];
  const ebay = ebayWhere.length
    ? await prisma.ebayListing.findMany({ where: { userId, OR: ebayWhere }, select: { listingId: true, sku: true, aspects: true } })
    : [];
  const savedByKey = new Map(saved.map((s) => [s.key, s]));
  const out: Record<string, ItemProductIds> = {};
  for (const item of items) {
    const hit = productKeys(item).map((k) => savedByKey.get(k)).find(Boolean);
    if (hit) {
      out[item.id] = { merchant: hit.merchant, manufacturer: hit.manufacturer, gtin: hit.gtin, source: 'saved' };
      continue;
    }
    const listing = ebay.find((e) => (clean(item.listingRef) && e.listingId === clean(item.listingRef)) || (clean(item.sku) && e.sku === clean(item.sku)));
    const fromEbay = listing ? idsFromEbayAspects(listing.aspects) : null;
    const ids = defaultProductIds({ sku: item.sku, listingRef: item.listingRef, itemId: item.id, gtin: fromEbay?.gtin, mpn: fromEbay?.mpn });
    out[item.id] = { ...ids, source: fromEbay && (fromEbay.gtin || ids.manufacturer !== ids.merchant) ? 'ebay' : 'default' };
  }
  return out;
}

/** Remember what the seller sent on a created EU label (only complete sets; best effort, never throws). */
export async function saveProductIds(userId: string, entries: ReadonlyArray<{ sku?: string | null; listingRef?: string | null; pid: ProductIds | null | undefined }>): Promise<void> {
  try {
    for (const e of entries) {
      if (!e.pid || !productIdsComplete(e.pid)) continue;
      const data = { merchant: clean(e.pid.merchant).slice(0, 100), manufacturer: clean(e.pid.manufacturer).slice(0, 100), gtin: normalizeGtin(e.pid.gtin) };
      for (const key of productKeys(e)) {
        await prisma.productIdentifier.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, ...data }, update: data });
      }
    }
  } catch {
    /* remembering IDs is a convenience; the label already exists */
  }
}

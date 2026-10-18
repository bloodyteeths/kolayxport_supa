/**
 * Hepsiburada listing cache sync → HepsiburadaListing.
 *
 * `listing-external` gives price/stock/state per hbSku but no content; the catalog's all-products-of-merchant gives
 * title/brand/images/barcode/category per merchantSku/hbSku. Both are paged and joined here. Listings that vanished
 * from HB are deleted from the cache.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import { isAuthFailure, isConnectionBlocked, recordAuthFailure, recordAuthSuccess } from '@/lib/integrations/authFailures';
import { inAuthorizationGrace, loadHepsiburadaClient } from './server';
import { hbErrorMessage, type HepsiburadaClient } from './client';
import type { Listing } from './generated/listing';
import type { IntegratorProductInformation } from './generated/catalog';

const LISTING_PAGE = 500;
const MAX_LISTING_PAGES = 100;
const PRODUCT_PAGE = 100;
const MAX_PRODUCT_PAGES = 200;

export interface HbListingRow {
  hbSku: string;
  merchantSku: string | null;
  listingId: string | null;
  productId: string | null;
  barcode: string | null;
  title: string | null;
  brand: string | null;
  categoryId: number | null;
  categoryName: string | null;
  images: string[];
  price: number | null;
  availableStock: number;
  dispatchTime: number | null;
  maximumPurchasableQuantity: number | null;
  cargoCompanies: string[];
  isSalable: boolean;
  isSuspended: boolean;
  isLocked: boolean;
  isFrozen: boolean;
  isFulfilledByHB: boolean;
  deactivationReasons: string[];
}

/** Pure join of one listing with its catalog product (either may be missing). */
export function toListingRow(l: Listing, p?: IntegratorProductInformation): HbListingRow {
  const finalPrice = Array.isArray(l.pricings) && l.pricings.length ? l.pricings[0]?.finalPrice : undefined;
  return {
    hbSku: String(l.hepsiburadaSku || p?.hbSku || ''),
    merchantSku: l.merchantSku || p?.merchantSku || null,
    listingId: l.listingId || null,
    productId: l.productId || null,
    barcode: p?.barcode || null,
    title: p?.productName || null,
    brand: p?.brand || null,
    categoryId: typeof p?.categoryId === 'number' ? p.categoryId : null,
    categoryName: p?.categoryName || null,
    images: Array.isArray(p?.images) ? p!.images.filter((x) => typeof x === 'string' && x) : [],
    price: typeof l.price === 'number' ? l.price : typeof finalPrice === 'number' ? finalPrice : p?.price ? Number(p.price) || null : null,
    availableStock: Number.isFinite(l.availableStock) ? Number(l.availableStock) : 0,
    dispatchTime: typeof l.dispatchTime === 'number' ? l.dispatchTime : null,
    maximumPurchasableQuantity: typeof l.maximumPurchasableQuantity === 'number' ? l.maximumPurchasableQuantity : null,
    cargoCompanies: [l.cargoCompany1, l.cargoCompany2, l.cargoCompany3].filter((x): x is string => !!x),
    isSalable: !!l.isSalable,
    isSuspended: !!l.isSuspended,
    isLocked: !!l.isLocked,
    isFrozen: !!l.isFrozen,
    isFulfilledByHB: !!l.isFulfilledByHB,
    deactivationReasons: Array.isArray(l.deactivationReasons) ? l.deactivationReasons : [],
  };
}

async function fetchAllListings(client: HepsiburadaClient, signal?: AbortSignal): Promise<Listing[]> {
  const out: Listing[] = [];
  for (let page = 0; page < MAX_LISTING_PAGES; page++) {
    if (signal?.aborted) break;
    const res = await client.listListings({ offset: page * LISTING_PAGE, limit: LISTING_PAGE });
    const rows = res?.listings || [];
    out.push(...rows);
    if (rows.length < LISTING_PAGE || (res?.totalCount && out.length >= res.totalCount)) break;
  }
  return out;
}

async function fetchAllProducts(client: HepsiburadaClient, signal?: AbortSignal): Promise<IntegratorProductInformation[]> {
  const out: IntegratorProductInformation[] = [];
  for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
    if (signal?.aborted) break;
    const res = await client.allProducts({ page, size: PRODUCT_PAGE });
    const rows: IntegratorProductInformation[] = res?.data || [];
    out.push(...rows);
    if (rows.length < PRODUCT_PAGE || res?.last === true) break;
  }
  return out;
}

export async function syncHepsiburadaListingsForUser(userId: string, opts: { signal?: AbortSignal } = {}) {
  const loaded = await loadHepsiburadaClient(userId);
  if (!loaded.ok) return { skipped: loaded.reason };
  const { client, merchantId } = loaded;
  if (await isConnectionBlocked(userId, 'hepsiburada', merchantId)) return { skipped: 'reconnect' };

  let listings: Listing[];
  try {
    listings = await fetchAllListings(client, opts.signal);
    await recordAuthSuccess(userId, 'hepsiburada', merchantId);
  } catch (err) {
    // Within 2 h of saving, a 401 is HB still activating the authorization: not a strike toward "reconnect".
    if (isAuthFailure(err) && !(await inAuthorizationGrace(userId))) await recordAuthFailure(userId, 'hepsiburada', merchantId, err);
    throw err;
  }
  // Content is best-effort: price/stock still sync when the catalog service is down.
  let products: IntegratorProductInformation[] = [];
  try {
    products = await fetchAllProducts(client, opts.signal);
  } catch (err) {
    logger.warn('[HEPSIBURADA LISTINGS] catalog fetch failed; keeping cached content', { userId, error: hbErrorMessage(err) });
  }
  const byHbSku = new Map(products.filter((p) => p.hbSku).map((p) => [p.hbSku!, p]));
  const byMerchantSku = new Map(products.filter((p) => p.merchantSku).map((p) => [p.merchantSku!, p]));

  const rows = listings
    .map((l) => toListingRow(l, (l.hepsiburadaSku && byHbSku.get(l.hepsiburadaSku)) || (l.merchantSku && byMerchantSku.get(l.merchantSku)) || undefined))
    .filter((r) => r.hbSku);
  const rawBySku = new Map(listings.map((l) => [String(l.hepsiburadaSku || ''), l]));
  const now = new Date();

  for (let i = 0; i < rows.length; i += 50) {
    if (opts.signal?.aborted) break;
    await prisma.$transaction(rows.slice(i, i + 50).map((r) => {
      const content = r.title || r.images.length || r.barcode
        ? { title: r.title, brand: r.brand, barcode: r.barcode, categoryId: r.categoryId, categoryName: r.categoryName, images: r.images as unknown as Prisma.InputJsonValue, thumbnailUrl: r.images[0] ?? null }
        : {};
      const state = {
        merchantSku: r.merchantSku, listingId: r.listingId, productId: r.productId,
        price: r.price === null ? null : new Prisma.Decimal(r.price), availableStock: r.availableStock, dispatchTime: r.dispatchTime,
        maximumPurchasableQuantity: r.maximumPurchasableQuantity, cargoCompanies: r.cargoCompanies,
        isSalable: r.isSalable, isSuspended: r.isSuspended, isLocked: r.isLocked, isFrozen: r.isFrozen,
        isFulfilledByHB: r.isFulfilledByHB, deactivationReasons: r.deactivationReasons,
        raw: (rawBySku.get(r.hbSku) ?? null) as unknown as Prisma.InputJsonValue, syncedAt: now,
      };
      return prisma.hepsiburadaListing.upsert({
        where: { userId_merchantId_hbSku: { userId, merchantId, hbSku: r.hbSku } },
        create: { userId, merchantId, hbSku: r.hbSku, ...state, ...content },
        update: { ...state, ...content },
      });
    }));
  }

  // A complete pass (not aborted) is authoritative: drop listings HB no longer returns.
  let removed = 0;
  if (!opts.signal?.aborted) {
    const del = await prisma.hepsiburadaListing.deleteMany({ where: { userId, merchantId, syncedAt: { lt: now } } });
    removed = del.count;
  }
  return { listings: rows.length, products: products.length, removed };
}

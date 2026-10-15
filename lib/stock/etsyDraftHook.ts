/**
 * Etsy draft inventory overlay (W2, T7). Server-only.
 *
 * Called by the draft sync right before its inventory PUT. When stock sync is
 * LIVE for the user, quantities of stock-managed variants are replaced by the
 * hub's target. If the seller explicitly changed a managed variant's quantity
 * in the editor (userChangedVariantKeys), that number is first recorded as a
 * manual adjustment, so the editor stays a valid way to set stock.
 *
 * Not live (disabled or dry run), or the Etsy channel switched off -> products
 * are returned unchanged.
 *
 * If the overlay would leave the listing with nothing purchasable (every
 * enabled offering at 0), the quantities are NOT overlaid (Etsy rejects that
 * PUT on an active listing); a lower-only stock push is queued instead, and it
 * deactivates the listing through the normal push path.
 *
 * Each overlaid link also gets an echo-marker StockPush (status 'in_flight',
 * reason 'manual', externalRef 'draft_sync') so the post-sync observation
 * recognises the draft's write as our own echo. The caller settles the markers
 * with settleEtsyDraftStockEcho(ids, ok) after its PUT; an unsettled marker
 * goes stale -> 'unknown' -> verified by a fresh read (or re-pushed) by the
 * push worker, so a failed draft PUT never leaves a fake 'applied' behind.
 */
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';
import { SHARED_QUANTITY_KEY } from '@/lib/etsy/variantKey';
import { channelEnabled, getStockSettings, isStockLive, isStockSyncActive } from './settings';
import { enqueuePushes, manualAdjust } from './engine';
import { computeLinkTarget } from './math';
import { payloadAllZero, productVariantKey } from './etsyInventoryPayload';

export const DRAFT_ECHO_REF = 'draft_sync';

type Args = {
  userId: string;
  shopId: string;
  listingId: string;
  actorUserId: string;
  products: any[];
  userChangedVariantKeys: Set<string>;
};

function firstQty(product: any): number | null {
  const o = (Array.isArray(product?.offerings) ? product.offerings : []).find((x: any) => !x?.is_deleted);
  if (!o || o.quantity === undefined || o.quantity === null) return null;
  return Math.max(0, Math.trunc(Number(o.quantity)));
}

export type DraftOverlayResult = {
  products: any[];
  overridden: Array<{ variantKey: string; from: number; to: number }>;
  manualAdjusts: number;
  /** Echo-marker push ids to settle after the draft's inventory PUT. */
  echoPushIds: string[];
  /** true: the hub has nothing to sell here; quantities were left alone and a stock push was queued. */
  outOfStock?: boolean;
};

export async function applyStockToEtsyDraftInventoryImpl(a: Args): Promise<DraftOverlayResult> {
  const unchanged: DraftOverlayResult = { products: a.products, overridden: [], manualAdjusts: 0, echoPushIds: [] };
  const settings = await getStockSettings(a.userId);
  if (!isStockLive(settings) || !channelEnabled(settings, 'etsy')) return unchanged;
  if (!Array.isArray(a.products) || !a.products.length) return unchanged;

  const links = await prisma.stockLink.findMany({
    where: { userId: a.userId, channel: 'etsy', accountRef: String(a.shopId), externalId: String(a.listingId), status: 'active' },
  });
  if (!links.length) return unchanged;

  const products = a.products.map((p) => ({ ...p, offerings: Array.isArray(p?.offerings) ? p.offerings.map((o: any) => ({ ...o })) : p?.offerings }));
  const keyed = products.map((p) => ({ p, vk: productVariantKey(p) }));
  const single = products.length === 1;
  let manualAdjusts = 0;
  const overridden: Array<{ variantKey: string; from: number; to: number }> = [];
  const overlaid: Array<{ linkId: string; stockItemId: string; target: number }> = [];

  for (const link of links) {
    const controlled = keyed.filter(({ vk }) => link.variantRef === SHARED_QUANTITY_KEY || link.variantRef === vk || (single && link.variantRef === ''));
    if (!controlled.length) continue;

    // 1) Seller edited this variant's quantity in the editor -> record it as a manual adjust.
    const changed = controlled.find(({ vk }) => a.userChangedVariantKeys.has(vk) || (link.variantRef === SHARED_QUANTITY_KEY && a.userChangedVariantKeys.has(SHARED_QUANTITY_KEY)));
    if (changed) {
      const draftQty = firstQty(changed.p);
      if (draftQty !== null) {
        const item = await prisma.stockItem.findUnique({ where: { id: link.stockItemId }, select: { safetyBuffer: true } });
        const setTo = draftQty * Math.max(1, link.unitsPerSale) + (item?.safetyBuffer ?? 0) + link.buffer;
        const out = await manualAdjust({
          userId: a.userId,
          stockItemId: link.stockItemId,
          setTo,
          actor: `user:${a.actorUserId}`,
          note: 'etsy_editor',
          linkId: link.id,
          channel: 'etsy',
        });
        if (out.status === 'applied') manualAdjusts++;
      }
    }

    // 2) Overlay the hub's target.
    const item = await prisma.stockItem.findUnique({ where: { id: link.stockItemId }, select: { onHand: true, safetyBuffer: true, tracking: true, status: true } });
    if (!item || item.tracking !== 'tracked' || item.status !== 'active') continue;
    const target = computeLinkTarget({ onHand: item.onHand, safetyBuffer: item.safetyBuffer, buffer: link.buffer, unitsPerSale: link.unitsPerSale, maxListedQty: link.maxListedQty });
    for (const { p, vk } of controlled) {
      const from = firstQty(p);
      for (const o of Array.isArray(p.offerings) ? p.offerings : []) {
        if (o?.is_deleted) continue;
        if (target === 0 && products.length > 1) {
          // Out of stock variation: disable it (same rule as the stock push).
          o.is_enabled = false;
        } else {
          o.quantity = target;
          if (target > 0 && o.is_enabled === false && link.deactivatedByStock) o.is_enabled = true;
        }
      }
      const to = target === 0 && products.length > 1 ? 0 : target;
      if (from !== to) overridden.push({ variantKey: vk, from: from ?? 0, to });
    }
    overlaid.push({ linkId: link.id, stockItemId: link.stockItemId, target });
  }

  if (!overlaid.length) return { ...unchanged, manualAdjusts };

  // 3) Nothing purchasable left: never send that PUT. Keep the draft's
  //    quantities and let a lower-only push deactivate the listing.
  if (payloadAllZero({ products })) {
    for (const o of overlaid) await enqueuePushes(o.stockItemId, 'reconcile', { onlyLinkIds: [o.linkId] }).catch(() => 0);
    return { ...unchanged, manualAdjusts, outOfStock: true };
  }

  // 4) Echo markers for the observation that follows this draft's write.
  const now = new Date();
  const echoPushIds: string[] = [];
  for (const o of overlaid) {
    const id = randomUUID();
    await prisma.stockPush.create({
      data: {
        id,
        userId: a.userId,
        stockItemId: o.stockItemId,
        linkId: o.linkId,
        reason: 'manual',
        targetQty: o.target,
        sentQty: o.target,
        status: 'in_flight',
        claimedAt: now,
        externalRef: DRAFT_ECHO_REF,
      },
    });
    echoPushIds.push(id);
  }

  return { products, overridden, manualAdjusts, echoPushIds };
}

/** After the draft's inventory PUT: mark its echo markers applied (ok) or failed. */
export async function settleEtsyDraftStockEchoImpl(pushIds: string[], ok: boolean): Promise<void> {
  if (!pushIds.length) return;
  const now = new Date();
  await prisma.stockPush.updateMany({
    where: { id: { in: pushIds }, status: { in: ['in_flight', 'unknown'] }, externalRef: DRAFT_ECHO_REF },
    data: ok ? { status: 'applied', appliedAt: now, remoteQtyAfter: null, lastError: null } : { status: 'failed', lastError: 'draft_put_failed' },
  });
}

/** Active links on the listing while stock sync is active (dry run included). */
export async function isListingStockManagedImpl(userId: string, shopId: string, listingId: string): Promise<boolean> {
  const settings = await getStockSettings(userId);
  if (!isStockSyncActive(settings)) return false;
  const n = await prisma.stockLink.count({
    where: { userId, channel: 'etsy', accountRef: String(shopId), externalId: String(listingId), status: 'active' },
  });
  return n > 0;
}

export type EtsyManagedVariant = { variantKey: string; canonical: number; stockItemId: string; sku: string };
export type EtsyManagedInfo = { managed: boolean; live: boolean; variants: EtsyManagedVariant[] };

/**
 * Batch form of etsyManagedVariants (BR-11, grid rows): one settings read and one StockLink query.
 * `listingShops` maps listingId -> its (already ownership-checked) shopId; ids with no shop are unmanaged.
 * Returns an entry for every requested listing id.
 */
export async function etsyManagedVariantsMany(userId: string, listingShops: Map<string, string | null>): Promise<{ live: boolean; listings: Record<string, EtsyManagedInfo> }> {
  const listings: Record<string, EtsyManagedInfo> = {};
  const settings = await getStockSettings(userId);
  const active = isStockSyncActive(settings);
  const live = active ? isStockLive(settings) : false;
  for (const id of listingShops.keys()) listings[id] = { managed: false, live, variants: [] };
  const pairs = [...listingShops.entries()].filter((e): e is [string, string] => !!e[1]);
  if (!active || pairs.length === 0) return { live, listings };
  const byShop = new Map<string, string[]>();
  for (const [id, shop] of pairs) byShop.set(shop, [...(byShop.get(shop) || []), id]);
  const links = await prisma.stockLink.findMany({
    where: {
      userId,
      channel: 'etsy',
      status: 'active',
      OR: [...byShop.entries()].map(([shop, ids]) => ({ accountRef: shop, externalId: { in: ids } })),
    },
    include: { stockItem: { select: { onHand: true, safetyBuffer: true, displaySku: true } } },
  });
  for (const l of links) {
    const entry = listings[l.externalId];
    if (!entry || listingShops.get(l.externalId) !== l.accountRef) continue;
    entry.managed = true;
    entry.variants.push({
      variantKey: l.variantRef,
      stockItemId: l.stockItemId,
      sku: l.stockItem.displaySku,
      canonical: computeLinkTarget({ onHand: l.stockItem.onHand, safetyBuffer: l.stockItem.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty }),
    });
  }
  return { live, listings };
}

/** For the editor chip: managed variants and their canonical (target) quantity. */
export async function etsyManagedVariants(userId: string, shopId: string, listingId: string) {
  const settings = await getStockSettings(userId);
  if (!isStockSyncActive(settings)) return { managed: false, live: false, variants: [] as Array<{ variantKey: string; canonical: number; stockItemId: string; sku: string }> };
  const links = await prisma.stockLink.findMany({
    where: { userId, channel: 'etsy', accountRef: String(shopId), externalId: String(listingId), status: 'active' },
    include: { stockItem: { select: { onHand: true, safetyBuffer: true, displaySku: true } } },
  });
  return {
    managed: links.length > 0,
    live: isStockLive(settings),
    variants: links.map((l) => ({
      variantKey: l.variantRef,
      stockItemId: l.stockItemId,
      sku: l.stockItem.displaySku,
      canonical: computeLinkTarget({ onHand: l.stockItem.onHand, safetyBuffer: l.stockItem.safetyBuffer, buffer: l.buffer, unitsPerSale: l.unitsPerSale, maxListedQty: l.maxListedQty }),
    })),
  };
}

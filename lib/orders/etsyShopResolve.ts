/**
 * Which EtsyShop does a stored direct-Etsy order belong to? (W4)
 *
 * Etsy v3 ShopReceipt has NO shop_id field (verified against prod rawData:
 * 0 of 457 receipts carry one), so `rawData.shop_id` cannot be used. Order:
 *   1. rawData._kxShopId — written by upsertEtsyReceipt (KX-owned key);
 *   2. Order.marketplace === EtsyShop.shopName (direct orders use the shop name);
 *   3. otherwise every active shop of the user, default shop first — callers
 *      that can verify (a receipt GET returns 404 on the wrong shop) try them
 *      in order; callers that cannot use `resolveEtsyShopId` (null when ambiguous).
 */
import prisma from '@/lib/prisma';

export const KX_SHOP_ID_KEY = '_kxShopId';

/** Raw receipt + the KX-owned shop id key (pure). */
export function withKxShopId<T extends Record<string, any>>(receipt: T, shopId: string): T & { _kxShopId: string } {
  return { ...receipt, [KX_SHOP_ID_KEY]: String(shopId) } as T & { _kxShopId: string };
}

export function shopIdHintFromRaw(rawData: unknown): string | null {
  const raw = rawData && typeof rawData === 'object' ? (rawData as any) : null;
  const v = raw?.[KX_SHOP_ID_KEY] ?? raw?.shop_id;
  return v !== undefined && v !== null && String(v) !== '' ? String(v) : null;
}

type ShopRow = { shopId: string; shopName: string | null; isDefault: boolean };

/** Pure: candidate shop ids in priority order. `resolved` = the first is certain. */
export function pickEtsyShopCandidates(
  shops: ShopRow[],
  order: { marketplace?: string | null; rawData?: unknown },
): { candidates: string[]; resolved: boolean } {
  const hint = shopIdHintFromRaw(order.rawData);
  if (hint && shops.some((s) => s.shopId === hint)) return { candidates: [hint], resolved: true };
  const byName = order.marketplace ? shops.find((s) => !!s.shopName && s.shopName === order.marketplace) : undefined;
  if (byName) return { candidates: [byName.shopId], resolved: true };
  const sorted = [...shops].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return { candidates: sorted.map((s) => s.shopId), resolved: sorted.length === 1 };
}

export async function etsyShopCandidatesForOrder(
  userId: string,
  order: { marketplace?: string | null; rawData?: unknown },
): Promise<{ candidates: string[]; resolved: boolean }> {
  const shops = await prisma.etsyShop.findMany({
    where: { userId, isActive: true },
    select: { shopId: true, shopName: true, isDefault: true },
  });
  return pickEtsyShopCandidates(shops, order);
}

/** The order's shop, or null when it cannot be determined unambiguously. */
export async function resolveEtsyShopId(userId: string, order: { marketplace?: string | null; rawData?: unknown }): Promise<string | null> {
  const { candidates, resolved } = await etsyShopCandidatesForOrder(userId, order);
  return resolved ? candidates[0] ?? null : null;
}

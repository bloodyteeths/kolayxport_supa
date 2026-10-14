/**
 * Etsy return window (W4 T7 delivered_metrics).
 *
 * GET /shops/{shop_id}/policies/return (one call per shop per 24 h, in-memory
 * cache). The window is the longest return_deadline among policies that
 * accept returns or exchanges; fallback 30 days when Etsy cannot be read.
 * A shop whose policies accept neither returns nor exchanges has no window.
 */
import { resolveEtsyShopId } from './etsyShopResolve';
import { logger } from '@/lib/logger';
import { EtsyPriority, withEtsyBudget } from '@/lib/etsy/rateBudget';

export const FALLBACK_RETURN_DAYS = 30;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { days: number | null; at: number }>();

/** Pure: longest deadline (days) among policies that accept returns/exchanges; null when none do. */
export function returnDaysFromPolicies(policies: any[]): number | null {
  const list = Array.isArray(policies) ? policies : [];
  if (list.length === 0) return FALLBACK_RETURN_DAYS;
  let best: number | null = null;
  for (const p of list) {
    if (!p || !(p.accepts_returns || p.accepts_exchanges)) continue;
    const d = Number(p.return_deadline);
    const days = Number.isFinite(d) && d > 0 ? d : FALLBACK_RETURN_DAYS;
    best = best === null ? days : Math.max(best, days);
  }
  return best;
}

export async function getShopReturnDays(userId: string, shopId: string): Promise<number | null> {
  const hit = cache.get(shopId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.days;
  let days: number | null = FALLBACK_RETURN_DAYS;
  try {
    const data = await withEtsyBudget({ shopId, userId, priority: EtsyPriority.Reconcile }, async () => {
      const { getEtsyAccessToken } = await import('@/lib/etsy/etsyToken');
      const { callEtsyAPI } = await import('@/lib/etsy/http');
      const token = await getEtsyAccessToken(shopId, userId);
      return callEtsyAPI(`/shops/${shopId}/policies/return`, token);
    });
    days = returnDaysFromPolicies(Array.isArray(data?.results) ? data.results : []);
  } catch (err) {
    logger.warn('[returnPolicy] Etsy return policy read failed; using fallback', { shopId, error: (err as Error)?.message });
  }
  cache.set(shopId, { days, at: Date.now() });
  return days;
}

/** deliveredAt + shop return window; null when the shop accepts no returns. */
export async function computeReturnWindowEnd(userId: string, rawData: any, deliveredAt: Date, marketplace?: string | null): Promise<Date | null> {
  let days: number | null = FALLBACK_RETURN_DAYS;
  if (rawData?.receipt_id) {
    // Receipts carry no shop_id: KX-stored shop id, then shop name; ambiguous -> fallback window.
    const shopId = await resolveEtsyShopId(userId, { marketplace, rawData });
    if (shopId) days = await getShopReturnDays(userId, shopId);
  }
  if (days === null) return null;
  return new Date(deliveredAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Test hook. */
export function __resetReturnPolicyCache() {
  cache.clear();
}

/**
 * Amazon ship-by dates. The flat-file order report the sync reads has no
 * ship-by column, so Order.shipByAt stayed empty for every Amazon order. The
 * Orders API (getOrders by AmazonOrderIds, up to 50 per call) returns
 * LatestShipDate / EarliestShipDate. getOrders is heavily throttled
 * (~1 req/min, burst 20), so callers only ask for orders that don't have a
 * ship-by yet, and a failure just leaves the dates empty.
 */
import { logger } from '@/lib/logger';

export interface AmazonShipBy {
  latest: string | null;
  earliest: string | null;
}

const BATCH = 50;
const MAX_CALLS_PER_RUN = 10; // stay well inside the burst

export async function fetchAmazonShipByDates(
  token: string,
  region: 'na' | 'eu' | 'fe',
  marketplaceIds: string[],
  orderIds: string[],
): Promise<Map<string, AmazonShipBy>> {
  const out = new Map<string, AmazonShipBy>();
  const ids = Array.from(new Set(orderIds.filter(Boolean)));
  if (!ids.length || !marketplaceIds.length) return out;
  const { callSpApiWithRetry } = await import('./amazonClient');
  const mids = encodeURIComponent(marketplaceIds.join(','));
  let calls = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    if (calls >= MAX_CALLS_PER_RUN) {
      logger.info('[AmazonShipBy] Call cap reached; rest next run', { remaining: ids.length - i });
      break;
    }
    const chunk = ids.slice(i, i + BATCH);
    calls++;
    try {
      const r: any = await callSpApiWithRetry(
        `/orders/v0/orders?MarketplaceIds=${mids}&AmazonOrderIds=${encodeURIComponent(chunk.join(','))}&MaxResultsPerPage=${BATCH}`,
        token,
        region,
      );
      for (const o of r?.payload?.Orders || []) {
        if (!o?.AmazonOrderId) continue;
        out.set(String(o.AmazonOrderId), { latest: o.LatestShipDate || null, earliest: o.EarliestShipDate || null });
      }
    } catch (err: any) {
      logger.warn('[AmazonShipBy] getOrders failed; ship-by left empty for this batch', {
        batchSize: chunk.length,
        error: String(err?.message || err).slice(0, 200),
      });
      break; // throttled or no access — don't burn the rest of the burst
    }
  }
  return out;
}

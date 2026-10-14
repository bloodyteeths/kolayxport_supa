/**
 * GET /api/etsy/cache-status?shop_id=
 * How fresh the Etsy listing cache is, for the freshness chip:
 *   { lastChangeAt, lastCheckAt, live, mode: 'live' | 'polling', checkIntervalMinutes }
 * live = Etsy push notifications (webhooks) seen for this shop in the last 24 h.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { assertShopOwnership } from '@/lib/etsy/draftService';
import { draftErrorResponse } from '@/lib/etsy/draftErrors';
import { queryString } from '@/lib/etsy/listingIntelApi';

const LIVE_WINDOW_MS = 24 * 60 * 60_000;
/** Without push notifications listings are re-checked by the nightly reconcile. */
const POLL_INTERVAL_MINUTES = 24 * 60;

function maxDate(...ds: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of ds) if (d && (!best || d > best)) best = d;
  return best;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const shopId = queryString(req, 'shop_id');
  if (!shopId) return res.status(400).json({ error: 'shop_id is required' });
  try {
    await assertShopOwnership(user.id, shopId);
    const [shop, agg, lastVersion] = await Promise.all([
      prisma.etsyShop.findUnique({
        where: { shopId },
        select: { lastWebhookAt: true, lastListingReconcileAt: true, lastListingSyncAt: true, needsReauth: true },
      }),
      prisma.etsyListing.aggregate({ where: { etsyShopId: shopId }, _max: { lastWebhookAt: true, lastRefreshAt: true } }),
      prisma.etsyListingVersion.findFirst({
        where: { etsyShopId: shopId, OR: [{ isTombstone: true }, { changedKeys: { isEmpty: false } }] },
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      }),
    ]);
    const lastWebhookAt = maxDate(shop?.lastWebhookAt, agg._max.lastWebhookAt);
    const live = !!lastWebhookAt && Date.now() - lastWebhookAt.getTime() < LIVE_WINDOW_MS && !shop?.needsReauth;
    const lastCheckAt = maxDate(shop?.lastListingReconcileAt, shop?.lastListingSyncAt, agg._max.lastRefreshAt);
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({
      lastChangeAt: lastVersion?.capturedAt?.toISOString() ?? null,
      lastCheckAt: lastCheckAt?.toISOString() ?? null,
      live,
      mode: live ? 'live' : 'polling',
      checkIntervalMinutes: live ? null : POLL_INTERVAL_MINUTES,
      needsReauth: !!shop?.needsReauth,
    });
  } catch (err: any) {
    const { status, body } = draftErrorResponse(err, 'Failed to load cache status');
    return res.status(status).json(body);
  }
}

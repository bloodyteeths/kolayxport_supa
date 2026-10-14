/**
 * GET /api/etsy/seo-experiments?shop_id=&status=&limit=
 * SEO cohort experiments with their measured before/after metrics.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { ownedShopIds, parseLimit, queryString } from '@/lib/etsy/listingIntelApi';
import { experimentWindows } from '@/lib/etsy/seoExperiments';

const STATUSES = new Set(['collecting', 'low_traffic', 'ready', 'insufficient_data', 'confounded', 'cancelled']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const shopFilter = queryString(req, 'shop_id');
    const shops = await ownedShopIds(user.id, shopFilter || undefined);
    if (!shops.length) return res.status(200).json({ items: [] });
    const status = queryString(req, 'status');
    const limit = parseLimit(req.query.limit, 50, 200);
    const rows = await prisma.seoExperiment.findMany({
      where: { userId: user.id, etsyShopId: { in: shops }, ...(status && STATUSES.has(status) ? { status } : {}) },
      orderBy: { changedAt: 'desc' },
      take: limit,
    });
    const allIds = Array.from(new Set(rows.flatMap((r) => r.listingIds.slice(0, 5).map((id) => `${r.etsyShopId}|${id}`))));
    const listings = allIds.length
      ? await prisma.etsyListing.findMany({
          where: { OR: allIds.map((k) => ({ etsyShopId: k.split('|')[0], etsyListingId: BigInt(k.split('|')[1]) })) },
          select: { etsyShopId: true, etsyListingId: true, title: true, thumbnailUrl75x75: true },
        })
      : [];
    const byKey = new Map(listings.map((l) => [`${l.etsyShopId}|${l.etsyListingId}`, l]));
    return res.status(200).json({
      items: rows.map((r) => {
        const w = experimentWindows(r.changedAt, r.windowDays);
        return {
          id: r.id,
          shopId: r.etsyShopId,
          listingCount: r.listingIds.length,
          listings: r.listingIds.slice(0, 5).map((id) => {
            const l = byKey.get(`${r.etsyShopId}|${id}`);
            return { listingId: String(id), title: l?.title ?? null, thumbnail: l?.thumbnailUrl75x75 ?? null };
          }),
          changeKinds: r.changeKinds,
          changedAt: r.changedAt.toISOString(),
          windowDays: r.windowDays,
          readyAfter: w.afterEnd.toISOString(),
          status: r.status,
          controlType: r.controlType,
          seasonal: r.seasonal,
          evaluatedAt: r.evaluatedAt?.toISOString() ?? null,
          verdict: r.verdict,
          confidence: r.confidence,
          metrics: r.metrics ?? null,
          kind: r.cohortKey.startsWith('batch:') ? 'kolayxport' : 'external',
        };
      }),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load SEO experiments' });
  }
}

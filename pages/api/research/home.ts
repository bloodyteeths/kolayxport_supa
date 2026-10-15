/**
 * GET /api/research/home — Research Home cards (research.md §4.1, §10). DB only.
 *
 * Query: `mkt?` (etsy | ebay; which store the "needs work" card reads; default: Etsy when connected, else eBay) ·
 *        `shop?` (Etsy shop id).
 * 200 → ResearchResponse<HomeData>:
 *   - `needsWork`: top 3 Doctor rows by opportunity; `needsWorkTotal`: listings under 50.
 *   - `recentWatched`: tracked keywords with their latest rank change (R3 adds watched shops). Recent searches
 *     are per viewer in localStorage (`kx.research.recent`) and merged by the UI.
 *   - `connected`: when neither is connected the UI renders the compact ConnectState.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { firstParam } from '@/lib/research/etsySearch';
import type { HomeData, RecentWatchedItem, ResearchErrorBody, ResearchResponse } from '@/lib/research/types';
import { SHIPPED_RESEARCH_TARGETS, type ShippedResearchKey } from '@/lib/research/legacyRedirects';
import { loadDoctor } from './listings';

/**
 * Where a tracked keyword opens. The Keywords page (`/app/research/keywords?view=tracked&listing=&shop=&mkt=`,
 * research.md §2) is R2; until `keywords:etsy` ships, the item deep-links the listing in the Listing doctor
 * (`?open=`), whose panel shows the tracked main keyword and its rank, so a Home click never 404s.
 */
export function trackedKeywordHref(
  listingId: string,
  shopId: string | null,
  shipped: ReadonlySet<ShippedResearchKey> = SHIPPED_RESEARCH_TARGETS,
): string {
  const p = new URLSearchParams();
  if (shipped.has('keywords:etsy')) {
    p.set('view', 'tracked');
    p.set('listing', listingId);
    if (shopId) p.set('shop', shopId);
    p.set('mkt', 'etsy');
    return `/app/research/keywords?${p.toString()}`;
  }
  p.set('mkt', 'etsy');
  if (shopId) p.set('shop', shopId);
  p.set('open', listingId);
  return `/app/research/listings?${p.toString()}`;
}

export async function recentTracked(userId: string, limit = 5): Promise<RecentWatchedItem[]> {
  const rows = await prisma.rankTrackedKeyword.findMany({
    where: { userId, isActive: true },
    select: {
      keyword: true, etsyListingId: true, etsyShopId: true, listingTitle: true, updatedAt: true,
      snapshots: { orderBy: { checkedAt: 'desc' }, take: 8, select: { rank: true, checkedAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  const items = rows.map((r) => {
    const latest = r.snapshots[0];
    // Week-ago reading (or the oldest of the last 8) for the change fact.
    const prev = r.snapshots.find((s) => latest && latest.checkedAt.getTime() - s.checkedAt.getTime() >= 6 * 86_400_000) ?? r.snapshots[r.snapshots.length - 1];
    const at = latest?.checkedAt ?? r.updatedAt;
    const item: RecentWatchedItem = {
      kind: 'keyword',
      label: r.keyword,
      href: trackedKeywordHref(String(r.etsyListingId), r.etsyShopId ? String(r.etsyShopId) : null),
      at: at.toISOString(),
    };
    if (latest && prev && prev !== latest && latest.rank !== prev.rank) {
      item.change = {
        key: latest.rank == null ? 'research.home.rankLost' : prev.rank == null ? 'research.home.rankFound' : 'research.home.rankChange',
        params: { from: prev.rank ?? 0, to: latest.rank ?? 0 },
      };
    }
    return { item, moved: item.change ? 1 : 0 };
  });
  return items
    .sort((a, b) => b.moved - a.moved || (a.item.at < b.item.at ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.item);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);

  try {
    const [etsyShops, cred] = await Promise.all([
      prisma.etsyShop.count({ where: { userId: user.id, isActive: true } }),
      prisma.credential.findUnique({ where: { userId: user.id }, select: { ebayRefreshToken: true } }),
    ]);
    const connected = { etsy: etsyShops > 0, ebay: !!cred?.ebayRefreshToken };
    const asked = firstParam(req.query.mkt);
    const mkt: 'etsy' | 'ebay' | null = asked === 'ebay' && connected.ebay ? 'ebay'
      : asked === 'etsy' && connected.etsy ? 'etsy'
        : connected.etsy ? 'etsy' : connected.ebay ? 'ebay' : null;

    const [doctor, recentWatched] = await Promise.all([
      mkt ? loadDoctor(user.id, { mkt, shop: firstParam(req.query.shop), sort: 'opportunity', page: 1, size: 3 }) : Promise.resolve(null),
      recentTracked(user.id),
    ]);
    const data: HomeData = {
      connected,
      needsWorkMkt: mkt,
      needsWork: doctor?.rows ?? [],
      needsWorkTotal: doctor?.needsWorkTotal ?? 0,
      recentWatched,
    };
    const body: ResearchResponse<HomeData> = {
      data,
      source: {
        source: mkt === 'ebay' ? 'research.sourceName.healthEbay' : 'research.sourceName.healthEtsy',
        fetchedAt: new Date().toISOString(),
        kind: 'measured',
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    logger.error('[research/home] failed', err as Error);
    return res.status(500).json({ error: 'server_error' } satisfies ResearchErrorBody);
  }
}

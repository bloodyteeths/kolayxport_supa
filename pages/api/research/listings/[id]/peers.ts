/**
 * GET /api/research/listings/[id]/peers — "Compared with peers" for one own Etsy listing (research.md §7.1, §10).
 *
 * Path: `id` = Etsy listing_id. Query: `shop?` (Etsy shop id; default: whichever of the user's shops owns it) ·
 *       `keyword?` (main keyword override) · `locale?`.
 * 200 → ResearchResponse<PeersData> (`checks` = peer checks, `listingChecks` = the full listing score checks with the
 *       peer band as market input). Peer checks are `group: 'peers'` (never stored in the health score) and
 *       `na` when fewer than 20 peers were compared. Budget breaker → cached peers only, else every check `na`
 *       with `errors[{ section: 'peers', key: 'research.error.budget' }]` (the rest of the Doctor still works).
 * eBay listings: not in R1 (`data: null`, `errors[{ section: 'marketplace', key: 'research.doc.peersEtsyOnly' }]`).
 * Read-only (Etsy public search, shared 24 h cache).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { convertCurrency } from '@/lib/finance/fx';
import { buildFxTable, summarizePrices } from '@/lib/research/stats';
import {
  firstParam, formattersFor, getEtsyListingDetails, isBudgetError, requestLocale, searchEtsy, userRateLimit,
} from '@/lib/research/etsySearch';
import { computePeers, peerChecks, pickMainKeyword, selectPeers } from '@/lib/research/peers';
import { etsyInputFromCache, scoreEtsyListing } from '@/lib/listingScore/etsy';
import type { PeersBlock } from '@/lib/research/types';
import type { MainKeyword, PeersData, ResearchErrorBody, ResearchResponse, ResearchSectionError } from '@/lib/research/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);

  const id = firstParam(req.query.id);
  const mkt = firstParam(req.query.mkt) ?? 'etsy';
  if (mkt === 'ebay') {
    const body: ResearchResponse<PeersData> = {
      data: null,
      source: { source: 'research.sourceName.ebayBrowse', fetchedAt: new Date().toISOString(), kind: 'measured' },
      errors: [{ section: 'marketplace', key: 'research.doc.peersEtsyOnly' }],
    };
    return res.status(200).json(body);
  }
  if (!id || !/^\d{1,20}$/.test(id)) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  if (!userRateLimit(user.id, 'research:peers', 30)) return res.status(429).json({ error: 'rate_limited' } satisfies ResearchErrorBody);

  const shopParam = firstParam(req.query.shop);
  const keywordParam = firstParam(req.query.keyword)?.slice(0, 80);
  const fmt = formattersFor(requestLocale(req));

  try {
    const shops = await prisma.etsyShop.findMany({ where: { userId: user.id, isActive: true }, select: { shopId: true } });
    const shopIds = shops.map((s) => s.shopId).filter((s) => !shopParam || s === shopParam);
    if (shopIds.length === 0) return res.status(404).json({ error: 'not_found' } satisfies ResearchErrorBody);
    const listing = await prisma.etsyListing.findFirst({
      where: { etsyShopId: { in: shopIds }, etsyListingId: BigInt(id) },
      select: {
        etsyShopId: true, title: true, description: true, tags: true, materials: true, priceAmount: true, priceDivisor: true,
        priceCurrencyCode: true, imageCount: true, hasVideo: true, shippingProfileId: true, processingMin: true, itemWeight: true,
      },
    });
    if (!listing) return res.status(404).json({ error: 'not_found' } satisfies ResearchErrorBody);

    const tracked = await prisma.rankTrackedKeyword.findMany({
      where: { userId: user.id, etsyListingId: id, isActive: true },
      select: { keyword: true, snapshots: { orderBy: { checkedAt: 'desc' }, take: 1, select: { rank: true } } },
    });
    const trackedRows = tracked.map((t) => ({ keyword: t.keyword, rank: t.snapshots[0]?.rank ?? null }));
    const matchTracked = keywordParam ? trackedRows.find((t) => t.keyword.toLowerCase() === keywordParam.toLowerCase()) : undefined;
    const keyword: MainKeyword = keywordParam
      ? (matchTracked ? { keyword: matchTracked.keyword, source: 'tracked', rank: matchTracked.rank } : { keyword: keywordParam, source: 'user', rank: null })
      : pickMainKeyword(listing.title, trackedRows);

    const currency = listing.priceCurrencyCode || 'USD';
    const divisor = listing.priceDivisor > 0 ? listing.priceDivisor : 100;
    const own = {
      id,
      title: listing.title,
      tags: listing.tags,
      price: listing.priceAmount > 0 ? listing.priceAmount / divisor : null,
      currency,
      imageCount: listing.imageCount,
      hasVideo: listing.hasVideo,
    };
    const errors: ResearchSectionError[] = [];
    /** Full listing checks with the peer band as the market input (only when the band is usable and same-currency). */
    const listingChecks = (block: PeersBlock) => {
      const p = block.price;
      const market = p.quality === 'ok' && p.p25 != null && p.p75 != null && p.currency.toUpperCase() === currency.toUpperCase()
        ? { p25: p.p25, p75: p.p75 }
        : null;
      return scoreEtsyListing({ ...etsyInputFromCache(listing), market }).checks;
    };

    let peersData: PeersData;
    let fetchedAt = new Date().toISOString();
    try {
      const served = await searchEtsy({ q: keyword.keyword, country: 'US' });
      fetchedAt = served.fetchedAt;
      if (served.budgetLimited) errors.push({ section: 'peers', key: 'research.error.budget' });
      else if (served.stale) errors.push({ section: 'peers', key: 'research.error.stale' });
      const peers = selectPeers(served.data.items, id);
      const [fx, details] = await Promise.all([
        buildFxTable(peers.map((p) => p.currency), currency, convertCurrency).catch(() => ({})),
        getEtsyListingDetails(peers.map((p) => p.listingId)).then((d) => d.data).catch(() => ({})),
      ]);
      const block = computePeers(peers, details, { currency, fx });
      peersData = { keyword, peers: block, checks: peerChecks(own, block, fmt.money, fmt.percent), listingChecks: listingChecks(block), fetchedAt };
    } catch (err) {
      if (!isBudgetError(err)) throw err;
      errors.push({ section: 'peers', key: 'research.error.budget' });
      const block = computePeers([], {}, { currency });
      block.price = summarizePrices([], { currency });
      peersData = { keyword, peers: block, checks: peerChecks(own, block, fmt.money, fmt.percent), listingChecks: listingChecks(block), fetchedAt };
    }

    const body: ResearchResponse<PeersData> = {
      data: peersData,
      source: { source: 'research.sourceName.etsySearch', sourceParams: { keyword: keyword.keyword }, fetchedAt, sample: peersData.peers.n, sampleUnit: 'listings', kind: 'measured' },
      ...(errors.length ? { errors } : {}),
    };
    return res.status(200).json(body);
  } catch (err) {
    logger.error('[research/peers] failed', err as Error, { listingId: id });
    return res.status(502).json({ error: 'server_error', key: 'research.error.etsy' } satisfies ResearchErrorBody);
  }
}

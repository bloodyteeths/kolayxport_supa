import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { AMAZON_MARKETPLACES, getValidToken } from '@/lib/integrations/amazonClient';
import { fetchProductSignals } from '@/lib/amazon/spapiSignals';
import { withResearchQuota, sendResearchOutcome, sharedCacheKey, readSharedMany, writeShared, getResearchQuota, RESEARCH_TTL } from '@/lib/ext/researchQuota';

/**
 * POST /api/ext/amazon-enrich
 * Body: { asins: string[] (≤20), marketplace: 'US' | 'UK' | 'DE' | 'TR' | … }
 *
 * Official Amazon numbers (SP-API) for the Chrome extension overlay: Best
 * Seller Rank per ASIN (Catalog Items) and competing offer counts + buy box
 * (Product Pricing). Uses the signed-in user's own connected Amazon seller
 * account. Always answers 200 with `available: false` + `reason` when the data
 * cannot be fetched, so the extension falls back to page data:
 *   not_connected             no Amazon seller credential
 *   marketplace_not_connected seller is not registered in that marketplace
 *   access_denied             SP-API app lacks the Catalog / Pricing role (403)
 *   unavailable               any other upstream failure
 *
 * Research quota (lib/ext/researchQuota.ts): the call uses the user's own seller token,
 * but catalog salesRanks and competitive pricing are public product facts, so each
 * ASIN's signals are shared across users for 24 h by ASIN + marketplace (only from
 * responses without any API error, so a seller without the pricing role never caches
 * half a record). Only the ASINs missing from that cache are fetched, as one lookup.
 * Under the global Amazon brake the cached ASINs are still served (`partial: true`).
 */

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

function allow(userId: string): boolean {
  const now = Date.now();
  const e = hits.get(userId);
  if (!e || now > e.resetAt) {
    hits.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (e.count >= LIMIT) return false;
  e.count++;
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await getAuthUser(req, res).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!allow(user.id)) return res.status(429).json({ error: 'Too many lookups, try again in a few minutes' });

  const rawAsins: unknown[] = Array.isArray(req.body?.asins) ? req.body.asins : [];
  const asins = Array.from(new Set(rawAsins.map((a) => String(a).toUpperCase())))
    .filter((a) => /^[A-Z0-9]{10}$/.test(a))
    .slice(0, 20);
  if (!asins.length) return res.status(400).json({ error: 'asins required' });

  const code = String(req.body?.marketplace || 'US').toUpperCase();
  const mkt = AMAZON_MARKETPLACES[code];
  if (!mkt) return res.status(400).json({ error: 'unknown marketplace' });

  const credential = await prisma.credential.findUnique({ where: { userId: user.id } });
  if (!credential?.amazonRefreshToken) {
    return res.status(200).json({ available: false, reason: 'not_connected' });
  }

  const connectedIds = [
    ...((credential.amazonMarketplaceIds as string[] | null) || []),
    credential.amazonMarketplaceId,
  ].filter(Boolean) as string[];
  if (connectedIds.length ? !connectedIds.includes(mkt.id) : (credential.amazonRegion || 'eu') !== mkt.region) {
    return res.status(200).json({ available: false, reason: 'marketplace_not_connected' });
  }

  const keyOf = (asin: string) => sharedCacheKey('amazon', 'signals', mkt.id, asin);
  const cached = await readSharedMany<any>(asins.map(keyOf));
  const cachedItems: Record<string, any> = {};
  for (const a of asins) if (cached[keyOf(a)]) cachedItems[a] = cached[keyOf(a)];
  const missing = asins.filter((a) => !cachedItems[a]);

  const ok = (items: Record<string, any>, errors: Record<string, string>, quota: unknown, extra: Record<string, unknown> = {}) =>
    res.status(200).json({
      available: true,
      source: 'sp-api',
      marketplace: code,
      marketplaceId: mkt.id,
      items,
      errors,
      fetchedAt: new Date().toISOString(),
      ...extra,
      ...(quota ? { quota } : {}),
    });

  if (!missing.length) return ok(cachedItems, {}, await getResearchQuota(user.id));

  try {
    const outcome = await withResearchQuota(
      {
        req,
        userId: user.id,
        marketplace: 'amazon',
        cacheKey: null, // per-ASIN sharing below (the token is the user's own)
        ttl: RESEARCH_TTL.detail,
        apiCallsEstimate: 2, // one Catalog Items + one Product Pricing batch call
      },
      async () => {
        const token = await getValidToken(credential, async (newToken, expiresAt) => {
          await prisma.credential.update({
            where: { userId: user.id },
            data: { amazonAccessToken: newToken, amazonTokenExpiresAt: expiresAt },
          });
        });
        if (!token) return { status: 200, body: { available: false, reason: 'not_connected' }, charge: false, cacheable: false };

        const result = await fetchProductSignals({
          token,
          region: mkt.region,
          marketplaceId: mkt.id,
          asins: missing,
          sellerKey: user.id,
        });
        return { status: 200, body: result, cacheable: false };
      },
    );

    if (outcome.kind === 'limited') {
      if (outcome.body.reason === 'global_brake' && Object.keys(cachedItems).length) {
        return ok(cachedItems, {}, null, { partial: true });
      }
      return sendResearchOutcome(res, outcome);
    }

    const body = outcome.body as any;
    if (body && body.available === false) return res.status(200).json(body);

    const result = body as { items: Record<string, any>; errors: Record<string, string> };
    const errs = Object.values(result.errors || {});
    if (!errs.length) {
      await Promise.all(Object.entries(result.items || {}).map(([asin, item]) => writeShared(keyOf(asin), item, RESEARCH_TTL.detail)));
    }
    const items = { ...cachedItems, ...(result.items || {}) };
    if (!Object.keys(items).length && errs.length) {
      const reason = errs.every((e) => e === 'access_denied') ? 'access_denied' : 'unavailable';
      return res.status(200).json({ available: false, reason, errors: result.errors });
    }

    return ok(items, result.errors || {}, outcome.quota);
  } catch (err) {
    logger.warn('ext/amazon-enrich failed', { err: (err as Error)?.message || String(err) });
    return res.status(200).json({ available: false, reason: 'unavailable' });
  }
}

import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { AMAZON_MARKETPLACES, regionForMarketplaceId } from '@/lib/integrations/amazonClient';

export const config = { runtime: 'nodejs' };

type MarketplaceInfo = { id: string; code: string; name: string; domain: string; region: string };

function describeMarketplaces(ids: string[]): MarketplaceInfo[] {
  const byId = new Map<string, MarketplaceInfo>();
  for (const [code, m] of Object.entries(AMAZON_MARKETPLACES)) {
    byId.set(m.id, { id: m.id, code, name: m.name, domain: m.domain, region: m.region });
  }
  return ids
    .map((id) => byId.get(id))
    .filter((m): m is MarketplaceInfo => Boolean(m));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const credential = await prisma.credential.findUnique({
      where: { userId: user.id },
      select: {
        amazonAccessToken: true,
        amazonTokenExpiresAt: true,
        amazonSellerId: true,
        amazonMarketplaceId: true,
        amazonMarketplaceIds: true,
        amazonRegion: true,
      },
    });

    const ids = credential?.amazonMarketplaceIds?.length
      ? credential.amazonMarketplaceIds
      : credential?.amazonMarketplaceId
        ? [credential.amazonMarketplaceId]
        : [];

    return res.status(200).json({
      connected: !!credential?.amazonAccessToken,
      tokenExpiresAt: credential?.amazonTokenExpiresAt || null,
      sellerId: credential?.amazonSellerId || null,
      marketplaceId: credential?.amazonMarketplaceId || null,
      marketplaceIds: ids,
      marketplaces: describeMarketplaces(ids),
      region: credential?.amazonRegion || null,
      availableMarketplaces: Object.entries(AMAZON_MARKETPLACES).map(([code, m]) => ({
        id: m.id,
        code,
        name: m.name,
        domain: m.domain,
        region: m.region,
      })),
    });
  }

  if (req.method === 'PUT') {
    const { marketplaceIds } = (req.body || {}) as { marketplaceIds?: unknown };
    if (!Array.isArray(marketplaceIds) || marketplaceIds.length === 0) {
      return res.status(400).json({ error: 'marketplaceIds (non-empty array) required' });
    }
    const ids = marketplaceIds.filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) {
      return res.status(400).json({ error: 'marketplaceIds must contain strings' });
    }
    const knownIds = new Set(Object.values(AMAZON_MARKETPLACES).map((m) => m.id));
    const invalid = ids.filter((id) => !knownIds.has(id));
    if (invalid.length > 0) {
      return res.status(400).json({ error: 'Unknown marketplaceIds', invalid });
    }
    const primary = ids[0];
    await prisma.credential.update({
      where: { userId: user.id },
      data: {
        amazonMarketplaceId: primary,
        amazonMarketplaceIds: ids,
        amazonRegion: regionForMarketplaceId(primary),
      },
    });
    return res.status(200).json({ success: true, marketplaceIds: ids });
  }

  if (req.method === 'DELETE') {
    await prisma.credential.update({
      where: { userId: user.id },
      data: {
        amazonAccessToken: null,
        amazonRefreshToken: null,
        amazonTokenExpiresAt: null,
        amazonSellerId: null,
        amazonMarketplaceId: null,
        amazonMarketplaceIds: [],
        amazonRegion: null,
      },
    });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

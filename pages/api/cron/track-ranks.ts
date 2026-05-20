import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';
const MAX_KEYWORDS_PER_RUN = 200; // Self-hosted: no timeout limit, process more per run
const RATE_LIMIT_MS = 120;

async function callEtsyPublicAPI(endpoint: string) {
  const apiKey = (process.env.ETSY_API_KEY || '').trim().replace(/^"|"$/g, '');
  const apiSecret = (process.env.ETSY_API_SECRET || '').trim().replace(/^"|"$/g, '');
  const response = await fetch(`${ETSY_API_BASE}${endpoint}`, {
    headers: { 'x-api-key': `${apiKey}:${apiSecret}` },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Etsy Public API error: ${response.status} - ${errorText}`);
  }
  if (response.status === 204) return { success: true };
  return response.json();
}

async function checkRankForKeyword(keyword: string, listingId: string): Promise<{
  rank: number | null;
  page: number | null;
  totalResults: number;
}> {
  let rank: number | null = null;
  let page: number | null = null;
  let totalResults = 0;

  for (let p = 0; p < 5; p++) {
    if (p > 0) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));

    const params = new URLSearchParams({
      keywords: keyword,
      limit: '100',
      offset: String(p * 100),
      sort_on: 'score',
      sort_order: 'desc',
    });

    const data = await callEtsyPublicAPI(`/listings/active?${params}`);
    if (p === 0) totalResults = data.count || 0;
    const results: any[] = data.results || [];

    const idx = results.findIndex((r: any) => String(r.listing_id) === String(listingId));
    if (idx !== -1) {
      rank = p * 100 + idx + 1;
      page = p + 1;
      break;
    }
    if (results.length < 100) break;
  }

  return { rank, page, totalResults };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const methodAllowed = req.method === 'GET' || req.method === 'POST';

  if (!methodAllowed) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active tracked keywords, grouped by user
    const keywords = await prisma.rankTrackedKeyword.findMany({
      where: { isActive: true },
      orderBy: { updatedAt: 'asc' }, // Oldest checked first
      take: MAX_KEYWORDS_PER_RUN,
    });

    logger.info(`Rank tracker cron: checking ${keywords.length} keywords`);

    let checked = 0;
    let errors = 0;

    for (const kw of keywords) {
      try {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));

        const result = await checkRankForKeyword(kw.keyword, kw.etsyListingId);

        await prisma.rankSnapshot.create({
          data: {
            keywordId: kw.id,
            rank: result.rank,
            page: result.page,
            totalResults: result.totalResults,
          },
        });

        // Touch updatedAt so this keyword goes to the back of the queue
        await prisma.rankTrackedKeyword.update({
          where: { id: kw.id },
          data: { updatedAt: new Date() },
        });

        checked++;
      } catch (err: any) {
        errors++;
        logger.error(`Rank check failed for keyword "${kw.keyword}" (listing ${kw.etsyListingId}):`, err);
      }
    }

    return res.status(200).json({
      success: true,
      checked,
      errors,
      total: keywords.length,
    });
  } catch (error: any) {
    logger.error('Rank tracker cron error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

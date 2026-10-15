/**
 * GET /api/research/seasons — Research Home "Upcoming seasons (shipping from Türkiye)" (research.md §4.1, §10).
 *
 * Query: `country?` (ISO-2, default US) · `productionDays?` (0–60, default 3; the per-viewer value the UI keeps
 *        in localStorage in v1) · `limit?` (1–12, default 6).
 * 200 → ResearchResponse<SeasonsData>. Transit = median of the user's own delivered labels to that country per
 *       carrier (Measured, ≥ 3 labels), else the carrier rate card (Estimate). Medians cached per user 24 h.
 * DB only (Order.shippedAt / deliveredAt + Shipment.carrier); no marketplace calls.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { firstParam, readShared, writeShared } from '@/lib/research/etsySearch';
import {
  clampProductionDays, countryFromAddress, transitMedians, upcomingSeasons, type TransitSample, type TransitStat,
} from '@/lib/research/seasons';
import type { ResearchErrorBody, ResearchResponse, SeasonsData } from '@/lib/research/types';

const TRANSIT_TTL_MS = 24 * 3_600_000;

export async function loadTransitStats(userId: string, now = new Date()): Promise<{ stats: TransitStat[]; fetchedAt: string }> {
  const key = 'research:transit:v1';
  const hit = await readShared<TransitStat[]>(key, userId);
  if (hit && hit.fresh) return { stats: hit.data, fetchedAt: hit.fetchedAt };
  const orders = await prisma.order.findMany({
    where: {
      userId,
      shippedAt: { not: null, gte: new Date(now.getTime() - 365 * 86_400_000) },
      deliveredAt: { not: null },
    },
    select: { shippedAt: true, deliveredAt: true, shippingAddress: true, shipments: { select: { carrier: true, status: true }, take: 3 } },
    orderBy: { shippedAt: 'desc' },
    take: 2000,
  });
  const samples: TransitSample[] = [];
  for (const o of orders) {
    const country = countryFromAddress(o.shippingAddress);
    const carrier = o.shipments.find((s) => s.status !== 'voided' && s.status !== 'void_requested')?.carrier;
    if (!country || !carrier || !o.shippedAt || !o.deliveredAt) continue;
    samples.push({ carrier, country, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt });
  }
  const stats = transitMedians(samples);
  const fetchedAt = new Date().toISOString();
  await writeShared(key, stats, TRANSIT_TTL_MS, fetchedAt, userId);
  return { stats, fetchedAt };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);

  const countryRaw = (firstParam(req.query.country) ?? 'US').toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : 'US';
  const productionDays = clampProductionDays(firstParam(req.query.productionDays));
  const limitRaw = parseInt(firstParam(req.query.limit) ?? '6', 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(12, limitRaw)) : 6;

  try {
    const { stats, fetchedAt } = await loadTransitStats(user.id);
    const events = upcomingSeasons({ country, productionDays, transit: stats, limit });
    const measured = events[0]?.lastShip.transitDays.kind === 'measured';
    const body: ResearchResponse<SeasonsData> = {
      data: { events, productionDays },
      source: {
        source: measured ? 'research.sourceName.ownLabels' : 'research.sourceName.rateCard',
        sourceParams: { carrier: events[0]?.lastShip.carrier ?? '', country },
        fetchedAt,
        ...(measured ? { sample: events[0].lastShip.sample, sampleUnit: 'orders' as const } : {}),
        kind: measured ? 'measured' : 'estimate',
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    logger.error('[research/seasons] failed', err as Error);
    return res.status(500).json({ error: 'server_error' } satisfies ResearchErrorBody);
  }
}

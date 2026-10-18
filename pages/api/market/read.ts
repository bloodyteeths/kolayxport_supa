/**
 * POST /api/market/read — crowd market data for the extension overlays and the app (Trendyol, Hepsiburada).
 * Body: { mkt, kind: 'cards', ids: string[] } | { mkt, kind: 'product', id } | { mkt, kind: 'seller', sellerId }.
 *
 * Give-to-get: full answers for sellers who shared pages in the last 30 days (MarketContribution). Others get
 * { gated: true }; the overlays then show only what the page itself says. Session or extension Bearer auth.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { userRateLimit } from '@/lib/research/etsySearch';
import { SNAPSHOT_MKTS, type SnapshotMkt } from '@/lib/research/marketSnapshot';
import { hasContributed, readCards, readProduct, readSeller } from '@/lib/market/read';

const idOk = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!userRateLimit(user.id, 'market:read', 120)) return res.status(429).json({ error: 'rate_limited' });

  const body = req.body ?? {};
  const mkt = body.mkt as SnapshotMkt;
  if (!SNAPSHOT_MKTS.includes(mkt)) return res.status(400).json({ error: 'bad_request' });
  if (!(await hasContributed(user.id))) return res.status(200).json({ gated: true });

  try {
    if (body.kind === 'cards') {
      const ids = Array.isArray(body.ids) ? body.ids.filter(idOk).slice(0, 120) : [];
      if (!ids.length) return res.status(400).json({ error: 'bad_request' });
      return res.status(200).json({ cards: await readCards(mkt, ids) });
    }
    if (body.kind === 'product' && idOk(body.id)) {
      const data = await readProduct(mkt, body.id);
      return res.status(200).json(data ?? { unknown: true });
    }
    if (body.kind === 'seller' && idOk(body.sellerId)) {
      const data = await readSeller(mkt, body.sellerId);
      return res.status(200).json(data ?? { unknown: true });
    }
    return res.status(400).json({ error: 'bad_request' });
  } catch (err) {
    logger.warn('[market/read] failed', { kind: body.kind, mkt, error: (err as Error)?.message });
    return res.status(500).json({ error: 'read_failed' });
  }
}

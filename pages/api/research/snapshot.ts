/**
 * POST /api/research/snapshot — a marketplace search page as the seller's browser saw it (Chrome extension).
 *
 * Body: { mkt: 'trendyol', query, total, items: [{ id, title, url, thumbUrl, price, brand, sellerId, favorites,
 * orderBadge, rating, ratingCount, sponsored, category }] } (≤ 120 items). Validated and clamped
 * (lib/research/marketSnapshot `parseSnapshot`), stored as a shared 24 h snapshot for the query; Product finder's
 * Trendyol answer reads it. Session or extension Bearer auth; 20 snapshots/min per user. Never touches a marketplace.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { userRateLimit, writeShared } from '@/lib/research/etsySearch';
import { parseSnapshot, snapshotKey, SNAPSHOT_TTL_MS } from '@/lib/research/marketSnapshot';

export const config = { api: { bodyParser: { sizeLimit: '512kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!userRateLimit(user.id, 'research:snapshot', 20)) return res.status(429).json({ error: 'rate_limited' });

  const snap = parseSnapshot(req.body);
  if (!snap) return res.status(400).json({ error: 'bad_request' });
  try {
    await writeShared(snapshotKey(snap.mkt, snap.query), snap, SNAPSHOT_TTL_MS, snap.capturedAt);
  } catch (err) {
    logger.warn('[research/snapshot] write failed', { userId: user.id, error: (err as Error)?.message });
    return res.status(500).json({ error: 'write_failed' });
  }
  const href = `/app/research/products?mkt=${snap.mkt}&q=${encodeURIComponent(snap.query)}`;
  return res.status(200).json({ ok: true, items: snap.items.length, href });
}

// GET /api/tools/trendyol-bestsellers            → { categories: [{ id, name }] }
// GET /api/tools/trendyol-bestsellers?c=<catId>  → { teaser: { categoryName, top[3], more } | null }
// Public (the /araclar Trendyol calculator), read-only, cached 6 h per category, rate-limited per IP so the teaser
// can't be used to scrape the dataset. Top 3 only; nothing else leaves the server (lib/tools/trendyolBestsellers).
import type { NextApiRequest, NextApiResponse } from 'next';
import { categoryTeaser, teaserCategories } from '@/lib/tools/trendyolBestsellers';

const hits = new Map<string, { n: number; reset: number }>();
const LIMIT = 30; // per IP per hour
function limited(req: NextApiRequest): boolean {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) { hits.set(ip, { n: 1, reset: now + 3600_000 }); return false; }
  h.n += 1;
  return h.n > LIMIT;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('X-Robots-Tag', 'noindex');
  const c = typeof req.query.c === 'string' ? req.query.c.slice(0, 20) : '';
  if (!c) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const list = await teaserCategories();
    return res.status(200).json({ categories: list.map(({ id, name }) => ({ id, name })) });
  }
  if (!/^\d+$/.test(c)) return res.status(400).json({ error: 'bad_category' });
  if (limited(req)) return res.status(429).json({ error: 'rate_limited' });
  res.setHeader('Cache-Control', 'private, max-age=600');
  return res.status(200).json({ teaser: await categoryTeaser(c) });
}

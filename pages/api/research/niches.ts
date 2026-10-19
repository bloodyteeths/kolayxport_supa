/**
 * GET /api/research/niches — "Strong niches today" on Research Home: the niche library's best-scored niches with
 * measured/estimated sales (lib/research/nicheLibrary, refreshed daily). Shared data, no per-user cost.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { readNiches } from '@/lib/research/nicheLibrary';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.setHeader('Cache-Control', 'private, max-age=300');
  const limit = Math.max(1, Math.min(24, Number(req.query.limit) || 12));
  return res.status(200).json(await readNiches(limit));
}

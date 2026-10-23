// GET /api/admin/signups?days=30[&format=csv] — signup funnel for the team (lib/admin/signups.ts). Admin only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { loadSignups, signupsToCsv } from '@/lib/admin/signups';

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
  const report = await loadSignups(days);
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kolayxport-signups-${days}d.csv"`);
    return res.status(200).send(signupsToCsv(report));
  }
  return res.status(200).json(report);
});

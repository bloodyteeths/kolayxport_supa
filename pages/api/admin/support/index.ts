// GET /api/admin/support?status=open|answered|closed|all — every ticket with messages and the user. Admin only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { listAllTickets } from '@/lib/support/tickets';

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ tickets: await listAllTickets(String(req.query.status || 'open')) });
});

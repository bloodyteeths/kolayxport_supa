import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { getSecurityEvents } from '@/lib/admin/monitoring';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, private');
  const data = await getSecurityEvents({
    limit: req.query.limit as any,
    offset: req.query.offset as any,
  });
  return res.json(data);
}

export default withAdmin(handler);

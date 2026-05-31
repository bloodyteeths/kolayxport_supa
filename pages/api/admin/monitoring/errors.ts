import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { getRecentErrors } from '@/lib/admin/monitoring';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, private');
  const data = await getRecentErrors({
    limit: req.query.limit as any,
    offset: req.query.offset as any,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
  });
  return res.json(data);
}

export default withAdmin(handler);

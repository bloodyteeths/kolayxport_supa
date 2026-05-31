import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { getExtensionHealth } from '@/lib/admin/monitoring';

async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, private');
  const data = await getExtensionHealth();
  return res.json(data);
}

export default withAdmin(handler);

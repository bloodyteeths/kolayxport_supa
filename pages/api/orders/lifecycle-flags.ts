import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { getLifecycleFlags } from '@/lib/orders/lifecycleFlags';

/**
 * GET  /api/orders/lifecycle-flags?ids=a,b,c   (max 200 ids)
 * POST /api/orders/lifecycle-flags  { ids: string[] }
 * -> { flags: { [orderId]: OrderLifecycleFlags } }   (lib/orders/lifecycleFlags.ts)
 * Only the caller's orders are returned; unknown ids are omitted.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const raw = req.method === 'POST' ? req.body?.ids : req.query.ids;
  const ids: string[] = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  if (ids.length > 200) return res.status(400).json({ error: 'At most 200 ids' });

  try {
    const flags = await getLifecycleFlags(user.id, ids);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ flags });
  } catch (error: any) {
    console.error('[lifecycle-flags] error', error?.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// POST /api/support/tickets/:id — reply {body} (reopens). PATCH — {status: 'closed'} close my ticket.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { setStatus, userReply } from '@/lib/support/tickets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const id = String(req.query.id || '');
  if (req.method === 'POST') {
    const r = await userReply(user.id, id, req.body ?? {});
    if (!r.ok) return res.status(r.error === 'not_found' ? 404 : 400).json({ error: r.error });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'PATCH') {
    if (req.body?.status !== 'closed') return res.status(400).json({ error: 'bad_status' });
    return (await setStatus(id, 'closed', user.id)) ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'not_found' });
  }
  res.setHeader('Allow', 'POST, PATCH');
  return res.status(405).json({ error: 'method_not_allowed' });
}

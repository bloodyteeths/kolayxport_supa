// GET /api/support/tickets — my tickets with their messages. POST — open a ticket {subject, category, body}.
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { listUserTickets, openTicket } from '@/lib/support/tickets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ tickets: await listUserTickets(user.id) });
  if (req.method === 'POST') {
    const r = await openTicket(user.id, req.body ?? {});
    if (!r.ok) return res.status(r.error === 'rate_limited' ? 429 : 400).json({ error: r.error });
    return res.status(201).json(r.ticket);
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}

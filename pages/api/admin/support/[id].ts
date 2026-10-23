// POST /api/admin/support/:id — staff answer {body} (emails the user). PATCH — {status}. Admin only.
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdmin } from '@/lib/middleware/withAdmin';
import { setStatus, staffReply } from '@/lib/support/tickets';

const STATUSES = new Set(['open', 'answered', 'closed']);

export default withAdmin(async (req: NextApiRequest, res: NextApiResponse, admin) => {
  const id = String(req.query.id || '');
  if (req.method === 'POST') {
    const r = await staffReply(admin.id, id, req.body ?? {});
    if (!r.ok) return res.status(r.error === 'not_found' ? 404 : 400).json({ error: r.error });
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'PATCH') {
    const status = String(req.body?.status || '');
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'bad_status' });
    return (await setStatus(id, status as 'open' | 'answered' | 'closed')) ? res.status(200).json({ ok: true }) : res.status(404).json({ error: 'not_found' });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
});

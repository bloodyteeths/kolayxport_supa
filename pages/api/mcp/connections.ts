// Settings → AI → "Connect your own AI" (session user only):
// GET    /api/mcp/connections            → { connections: [{ id, name, kind, scopes, tokenPrefix, createdAt, lastUsedAt, expiresAt }] }
// POST   /api/mcp/connections { name, scopes, shareBuyer } → { token, connection }   (a personal key, shown once;
//        orders:buyer only when shareBuyer === true)
// DELETE /api/mcp/connections?id=        → revokes a connection (it stops working at once)
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { createConnection, grantScopes } from '@/lib/mcp/tokens';

const MAX_ACTIVE = 20;
const view = (c: any) => ({ id: c.id, name: c.name, kind: c.kind, scopes: c.scopes, tokenPrefix: c.tokenPrefix, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, expiresAt: c.expiresAt });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ code: 'unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'GET') {
    const rows = await prisma.aiConnection.findMany({ where: { userId: user.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: 'desc' } });
    return res.status(200).json({ connections: rows.map(view) });
  }
  if (req.method === 'POST') {
    const active = await prisma.aiConnection.count({ where: { userId: user.id, revokedAt: null } });
    if (active >= MAX_ACTIVE) return res.status(409).json({ code: 'tooMany' });
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : 'AI';
    const c = await createConnection({ userId: user.id, name, kind: 'token', scopes: grantScopes(req.body?.scopes, req.body?.shareBuyer) });
    return res.status(200).json({ token: c.token, connection: view(c.connection) });
  }
  if (req.method === 'DELETE') {
    const id = String(req.query.id || '');
    const r = await prisma.aiConnection.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return r.count ? res.status(200).json({ ok: true }) : res.status(404).json({ code: 'notFound' });
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).end();
}

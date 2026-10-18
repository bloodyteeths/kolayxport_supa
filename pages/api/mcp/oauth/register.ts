// POST /api/mcp/oauth/register — dynamic client registration (RFC 7591) for AI apps (Claude, ChatGPT …).
// Public clients only (PKCE, no secret); redirect URIs must be https (or the loopback for desktop apps).
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { redirectUriAllowed } from '@/lib/mcp/tokens';

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'invalid_request' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: 'slow_down' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const uris: unknown[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectUriAllowed)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https URLs (or http on localhost)' });
  }
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : 'AI app';
  const id = `kxc_${crypto.randomBytes(16).toString('hex')}`;
  await prisma.mcpOAuthClient.create({ data: { id, name, redirectUris: uris as string[] } });
  return res.status(201).json({
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
}

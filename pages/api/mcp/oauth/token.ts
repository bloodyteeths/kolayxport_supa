// POST /api/mcp/oauth/token — OAuth 2.1 token endpoint for /api/mcp (public clients, PKCE S256).
// authorization_code → a new seller connection (access + refresh token); refresh_token → rotated tokens.
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { createConnection, hashToken, pkceOk, rotateConnection, type McpScope } from '@/lib/mcp/tokens';

const err = (res: NextApiResponse, error: string, description?: string, status = 400) =>
  res.status(status).json({ error, ...(description ? { error_description: description } : {}) });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return err(res, 'invalid_request', 'POST only', 405);
  }
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
  const clientId = String(b.client_id || '');
  const client = clientId ? await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } }) : null;
  if (!client) return err(res, 'invalid_client', undefined, 401);

  if (b.grant_type === 'authorization_code') {
    const row = await prisma.mcpOAuthCode.findUnique({ where: { codeHash: hashToken(String(b.code || '')) } });
    if (!row || row.clientId !== clientId || row.usedAt || row.expiresAt.getTime() < Date.now()) return err(res, 'invalid_grant', 'Code expired or already used');
    if (row.redirectUri !== String(b.redirect_uri || '')) return err(res, 'invalid_grant', 'redirect_uri does not match');
    if (!pkceOk(b.code_verifier, row.codeChallenge)) return err(res, 'invalid_grant', 'PKCE verification failed');
    // One use only, even under a race.
    const used = await prisma.mcpOAuthCode.updateMany({ where: { codeHash: row.codeHash, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) return err(res, 'invalid_grant', 'Code already used');
    const c = await createConnection({ userId: row.userId, name: client.name, kind: 'oauth', clientId, scopes: row.scopes as McpScope[] });
    return res.status(200).json({ access_token: c.token, token_type: 'Bearer', expires_in: c.expiresIn, refresh_token: c.refreshToken, scope: row.scopes.join(' ') });
  }

  if (b.grant_type === 'refresh_token') {
    const r = await rotateConnection(String(b.refresh_token || ''), clientId);
    if (!r) return err(res, 'invalid_grant', 'Refresh token invalid or revoked');
    return res.status(200).json({ access_token: r.token, token_type: 'Bearer', expires_in: r.expiresIn, refresh_token: r.refreshToken, scope: r.scopes.join(' ') });
  }

  return err(res, 'unsupported_grant_type');
}

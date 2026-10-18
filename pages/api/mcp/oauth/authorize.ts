// GET  /api/mcp/oauth/authorize?client_id&redirect_uri → { clientName } (the consent page's check)
// POST /api/mcp/oauth/authorize { client_id, redirect_uri, state, code_challenge, scope, share_buyer, approve } → { redirect }
// orders:buyer (buyer names + addresses) only when the seller ticked it (share_buyer === true), never from `scope`.
// The signed-in seller (session) allows or denies an AI app; an allowed request gets a one-time code (10 min, PKCE).
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { grantScopes, hashToken, mcpBaseUrl, redirectUriRegistered } from '@/lib/mcp/tokens';

function withParams(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  // RFC 9207: the issuer on every authorization response, success or error (metadata advertises it).
  for (const [k, v] of Object.entries({ ...params, iss: mcpBaseUrl() })) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return u.toString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const src = req.method === 'POST' ? (req.body ?? {}) : req.query;
  const clientId = String(src.client_id || '');
  const redirectUri = String(src.redirect_uri || '');
  const client = clientId ? await prisma.mcpOAuthClient.findUnique({ where: { id: clientId } }) : null;
  // Never redirect to a URI the client did not register (no open redirect).
  if (!client || !redirectUriRegistered(client.redirectUris, redirectUri)) return res.status(400).json({ error: 'invalid_client' });

  // The consent page shows where the answer goes (MCP authorization spec: display the redirect URI's host).
  if (req.method === 'GET') return res.status(200).json({ clientName: client.name, redirectHost: new URL(redirectUri).host });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end();
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'login_required' });
  // `state` goes back to the client exactly as sent: ChatGPT's is a long encoded JSON value and cutting it (it was
  // sliced to 500) broke its OAuth completion. Oversized values are refused instead of truncated.
  const state = typeof src.state === 'string' ? src.state : undefined;
  if (state && state.length > 8192) return res.status(400).json({ error: 'invalid_request', error_description: 'state too long' });
  if (src.approve !== true) return res.status(200).json({ redirect: withParams(redirectUri, { error: 'access_denied', state }) });
  const challenge = String(src.code_challenge || '');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || (src.code_challenge_method && src.code_challenge_method !== 'S256')) {
    return res.status(200).json({ redirect: withParams(redirectUri, { error: 'invalid_request', error_description: 'PKCE S256 required', state }) });
  }
  const code = crypto.randomBytes(32).toString('base64url');
  await prisma.mcpOAuthCode.create({
    data: { codeHash: hashToken(code), clientId, userId: user.id, redirectUri, codeChallenge: challenge, scopes: grantScopes(src.scope, src.share_buyer), expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return res.status(200).json({ redirect: withParams(redirectUri, { code, state }) });
}

// lib/mcp/tokens.ts — credentials for "Connect your own AI" (MCP, /api/mcp). SERVER ONLY.
// Every connection is one seller's: its token only ever opens that seller's data (lib/mcp/tools takes the userId
// from here, never from the request). Tokens are random, shown once, and stored as SHA-256 hashes; a revoked or
// expired connection stops working at once.
import crypto from 'crypto';
import type { NextApiRequest } from 'next';
import prisma from '@/lib/prisma';

/** read / write open tools; `orders:buyer` (opt-in, off by default) adds buyer names + shipping addresses to orders
 * (never Amazon, never e-mail or phone). It is only ever granted by the seller's own tick (grantScopes), never by
 * the scopes an app asks for. */
export const MCP_SCOPES = ['read', 'write', 'orders:buyer'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const BUYER_SCOPE: McpScope = 'orders:buyer';
const TOOL_SCOPES: readonly McpScope[] = ['read', 'write'];

/** OAuth access tokens live 30 days (refresh rotates them); personal keys 1 year unless revoked. */
export const ACCESS_TTL_DAYS = 30;
export const PERSONAL_TTL_DAYS = 365;

export const hashToken = (t: string) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
export const randomToken = (prefix: string) => `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;

/** The tool scopes (read / write) in a request; unknown ones — and orders:buyer — are dropped, read by default. */
export function normalizeScopes(raw: unknown): McpScope[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const set = new Set(list.map(String).filter((s): s is McpScope => (TOOL_SCOPES as readonly string[]).includes(s)));
  if (!set.size) set.add('read');
  return MCP_SCOPES.filter((s) => set.has(s));
}

/** The scopes a new connection gets: the requested tool scopes, plus orders:buyer ONLY when the seller ticked
 * "share buyer names and addresses" (`shareBuyer === true`), whatever the app requested. */
export function grantScopes(requested: unknown, shareBuyer: unknown): McpScope[] {
  const s = normalizeScopes(requested);
  return shareBuyer === true ? [...s, BUYER_SCOPE] : s;
}

export type McpAuth = { userId: string; connectionId: string; scopes: McpScope[]; name: string };

/** Creates a connection; returns the plain tokens once (never stored). */
export async function createConnection(input: { userId: string; name: string; kind: 'oauth' | 'token'; clientId?: string; scopes: McpScope[] }) {
  const token = randomToken(input.kind === 'oauth' ? 'kxo' : 'kxp');
  const refreshToken = input.kind === 'oauth' ? randomToken('kxr') : null;
  const days = input.kind === 'oauth' ? ACCESS_TTL_DAYS : PERSONAL_TTL_DAYS;
  const connection = await prisma.aiConnection.create({
    data: {
      userId: input.userId, name: input.name.slice(0, 80) || 'AI', kind: input.kind, clientId: input.clientId ?? null,
      tokenHash: hashToken(token), tokenPrefix: token.slice(0, 10), refreshHash: refreshToken ? hashToken(refreshToken) : null,
      scopes: input.scopes, expiresAt: new Date(Date.now() + days * 86_400_000),
    },
  });
  return { token, refreshToken, connection, expiresIn: days * 86_400 };
}

/** Refresh-token rotation (OAuth): a new access + refresh token for the same connection. */
export async function rotateConnection(refreshToken: string, clientId: string) {
  const conn = await prisma.aiConnection.findUnique({ where: { refreshHash: hashToken(refreshToken) } });
  if (!conn || conn.revokedAt || conn.clientId !== clientId) return null;
  const token = randomToken('kxo');
  const next = randomToken('kxr');
  await prisma.aiConnection.update({
    where: { id: conn.id },
    data: { tokenHash: hashToken(token), tokenPrefix: token.slice(0, 10), refreshHash: hashToken(next), expiresAt: new Date(Date.now() + ACCESS_TTL_DAYS * 86_400_000) },
  });
  return { token, refreshToken: next, scopes: conn.scopes as McpScope[], expiresIn: ACCESS_TTL_DAYS * 86_400 };
}

function bearer(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** The connection behind `Authorization: Bearer …` (only from the header), or null. */
export async function authenticateMcp(req: NextApiRequest): Promise<McpAuth | null> {
  const token = bearer(req);
  if (!token || !/^kx[op]_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const conn = await prisma.aiConnection.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!conn || conn.revokedAt || (conn.expiresAt && conn.expiresAt.getTime() < Date.now())) return null;
  // lastUsedAt at most every 5 minutes (one write per session, not per call).
  if (!conn.lastUsedAt || Date.now() - conn.lastUsedAt.getTime() > 5 * 60_000) {
    void prisma.aiConnection.update({ where: { id: conn.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { userId: conn.userId, connectionId: conn.id, scopes: conn.scopes as McpScope[], name: conn.name };
}

/** PKCE S256: base64url(sha256(verifier)) === challenge. Pure, exported for tests. */
export function pkceOk(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) return false;
  const digest = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  const a = Buffer.from(digest);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Redirect URIs an AI client may register: https anywhere, http only on the loopback (desktop apps). Pure. */
export function redirectUriAllowed(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** Whether `uri` is one of the client's registered redirect URIs. Exact match, except a loopback http URI matches
 * whatever its port (RFC 8252 §7.3; Claude Code and other desktop apps pick a free port per session). Pure. */
export function redirectUriRegistered(registered: readonly string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== 'http:' || !LOOPBACK.includes(u.hostname) || u.hash) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return x.protocol === 'http:' && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    } catch {
      return false;
    }
  });
}

/** Public base URL (issuer / resource). */
export function mcpBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://kolayxport.com').replace(/\/+$/, '');
}

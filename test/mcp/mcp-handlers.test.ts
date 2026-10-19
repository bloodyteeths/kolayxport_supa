// MCP endpoints: the buyer-data opt-in on the consent API and the personal-key API, RFC 9207 iss, loopback
// redirects, the OpenAI domain challenge, and the MCP transport (401 + resource_metadata, initialize, tools/list).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  codes: [] as any[],
  connections: [] as any[],
  tokenHash: '',
  client: { id: 'kxc_1', name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback'] },
}));

vi.mock('@/lib/auth', () => ({ getAuthUser: async () => h.user }));
vi.mock('@/lib/prisma', () => ({
  default: {
    mcpOAuthClient: { findUnique: async ({ where }: any) => (where.id === h.client.id ? h.client : null) },
    mcpOAuthCode: { create: async ({ data }: any) => { h.codes.push(data); return data; } },
    aiConnection: {
      count: async () => 0,
      create: async ({ data }: any) => { const c = { id: `c${h.connections.length}`, createdAt: new Date(), lastUsedAt: null, ...data }; h.connections.push(c); return c; },
      findUnique: async ({ where }: any) => (where.tokenHash === h.tokenHash
        ? { id: 'conn1', userId: 'u1', name: 'Claude', scopes: ['read'], revokedAt: null, expiresAt: null, lastUsedAt: new Date() }
        : null),
    },
  },
}));

import authorize from '@/pages/api/mcp/oauth/authorize';
import connections from '@/pages/api/mcp/connections';
import challenge from '@/pages/api/mcp/openai-challenge';
import metadata from '@/pages/api/mcp/oauth/metadata';
import mcp from '@/pages/api/mcp/index';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const run = async (handler: any, req: any) => { const r = res(); await handler({ headers: {}, query: {}, socket: {}, ...req }, r); return r; };
const consent = (extra: Record<string, unknown>) => run(authorize, {
  method: 'POST',
  body: { approve: true, client_id: 'kxc_1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 's', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', ...extra },
});

beforeEach(() => { h.codes = []; h.connections = []; h.user = { id: 'u1' }; });

describe('consent API: orders:buyer only when ticked', () => {
  it('requested by the app but not ticked → not granted', async () => {
    const r = await consent({ scope: 'read write orders:buyer' });
    expect(r.statusCode).toBe(200);
    expect(h.codes[0].scopes).toEqual(['read', 'write']);
    expect(h.codes[0].userId).toBe('u1');
  });
  it('ticked → granted', async () => {
    await consent({ scope: 'read', share_buyer: true });
    expect(h.codes[0].scopes).toEqual(['read', 'orders:buyer']);
  });
  it('a truthy non-boolean is not a tick', async () => {
    await consent({ scope: 'read', share_buyer: 'true' });
    expect(h.codes[0].scopes).toEqual(['read']);
  });
  it('the redirect carries iss (RFC 9207), on success and on deny', async () => {
    const ok = new URL((await consent({ scope: 'read' })).body.redirect);
    expect(ok.searchParams.get('iss')).toBe('https://kolayxport.com');
    expect(ok.searchParams.get('code')).toBeTruthy();
    const no = new URL((await consent({ approve: false })).body.redirect);
    expect(no.searchParams.get('error')).toBe('access_denied');
    expect(no.searchParams.get('iss')).toBe('https://kolayxport.com');
  });
  it('loopback redirect on any port is accepted; the consent check shows the host', async () => {
    const r = await run(authorize, { method: 'GET', query: { client_id: 'kxc_1', redirect_uri: 'http://localhost:51234/callback' } });
    expect(r.body).toEqual({ clientName: 'Claude', redirectHost: 'localhost:51234' });
    const bad = await run(authorize, { method: 'GET', query: { client_id: 'kxc_1', redirect_uri: 'https://evil.example/cb' } });
    expect(bad.statusCode).toBe(400);
  });
  it('a long state (ChatGPT sends encoded JSON) comes back unchanged; an oversized one is refused', async () => {
    const longState = Buffer.from(JSON.stringify({ connector: 'kolayxport', nonce: 'n'.repeat(600), redirect: 'https://chatgpt.com/x' })).toString('base64url');
    expect(longState.length).toBeGreaterThan(500);
    const ok = new URL((await consent({ scope: 'read', state: longState })).body.redirect);
    expect(ok.searchParams.get('state')).toBe(longState);
    const tooLong = await consent({ scope: 'read', state: 'x'.repeat(8193) });
    expect(tooLong.statusCode).toBe(400);
  });
  it('metadata advertises S256 and the iss parameter', async () => {
    const r = await run(metadata, { method: 'GET' });
    expect(r.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(r.body.authorization_response_iss_parameter_supported).toBe(true);
    expect(r.body.issuer).toBe('https://kolayxport.com');
  });
});

describe('personal keys: orders:buyer only when ticked', () => {
  it('not ticked (even if asked for) → read/write only', async () => {
    await run(connections, { method: 'POST', body: { name: 'Cursor', scopes: ['read', 'write', 'orders:buyer'] } });
    expect(h.connections[0].scopes).toEqual(['read', 'write']);
    expect(h.connections[0].userId).toBe('u1');
  });
  it('ticked → granted, and the list shows it', async () => {
    const r = await run(connections, { method: 'POST', body: { name: 'Cursor', scopes: ['read'], shareBuyer: true } });
    expect(h.connections[0].scopes).toEqual(['read', 'orders:buyer']);
    expect(r.body.connection.scopes).toContain('orders:buyer');
  });
});

describe('OpenAI domain challenge', () => {
  it('serves the token from the env as plain text, 404 when unset', async () => {
    delete process.env.OPENAI_APPS_CHALLENGE;
    expect((await run(challenge, { method: 'GET' })).statusCode).toBe(404);
    process.env.OPENAI_APPS_CHALLENGE = ' tok_123 ';
    const r = await run(challenge, { method: 'GET' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('tok_123');
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    delete process.env.OPENAI_APPS_CHALLENGE;
  });
});

describe('MCP transport', () => {
  it('unauthenticated POST → 401 with WWW-Authenticate resource_metadata', async () => {
    const r = await run(mcp, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toBe('Bearer resource_metadata="https://kolayxport.com/.well-known/oauth-protected-resource"');
  });
  it('initialize (2025-11-25), tools/list with annotations, tools/call with content + structuredContent', async () => {
    const { hashToken } = await import('@/lib/mcp/tokens');
    const token = `kxp_${'A'.repeat(40)}`;
    h.tokenHash = hashToken(token);
    const headers = { authorization: `Bearer ${token}` };
    const init = await run(mcp, { method: 'POST', headers, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } } });
    expect(init.body.result.protocolVersion).toBe('2025-11-25');
    expect(init.body.result.capabilities.tools).toBeTruthy();
    const list = await run(mcp, { method: 'POST', headers, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    const tools = list.body.result.tools;
    expect(tools.length).toBeGreaterThan(5);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ title: t.title, readOnlyHint: true, destructiveHint: false, openWorldHint: expect.any(Boolean) });
    }
    const callRes = await run(mcp, { method: 'POST', headers, body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'seo_rules', arguments: { marketplace: 'etsy' } } } });
    expect(callRes.body.result.content[0].type).toBe('text');
    expect(typeof callRes.body.result.structuredContent).toBe('object');
    const denied = await run(mcp, { method: 'POST', headers, body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'stage_listing_changes', arguments: {} } } });
    expect(denied.body.result.isError).toBe(true);
    const note = await run(mcp, { method: 'POST', headers, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(note.statusCode).toBe(202);
  });
});

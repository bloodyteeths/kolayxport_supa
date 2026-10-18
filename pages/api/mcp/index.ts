// POST /api/mcp — KolayXport's MCP server (Model Context Protocol, Streamable HTTP, JSON responses).
// A seller connects their own AI (Claude, ChatGPT, Cursor, Claude Code …) to their shop; tools in lib/mcp/tools.
// Auth: `Authorization: Bearer <token>` from an OAuth connection (/oauth/authorize) or a personal key (Settings → AI).
// Unauthenticated → 401 + WWW-Authenticate pointing at the protected-resource metadata, so MCP clients start OAuth.
import type { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/lib/logger';
import { authenticateMcp, mcpBaseUrl, type McpAuth } from '@/lib/mcp/tokens';
import { MCP_TOOLS, ToolError, toolsFor } from '@/lib/mcp/tools';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'kolayxport', title: 'KolayXport', version: '1.0.0' };
const INSTRUCTIONS = 'KolayXport is the seller\'s multi-marketplace back office (Etsy, eBay, Amazon, Trendyol, Hepsiburada, Shopify, Wix). '
  + 'Use get_store_overview first. Orders never include buyer names or addresses. For listing work: audit_listing, then seo_rules + '
  + 'research_keywords (keywords from real data, never invented), check_listing_text before staging. Every write tool '
  + '(stage_listing_changes, create_listing_draft, add_listing_photos) only prepares drafts: tell the seller to review and send them in '
  + 'KolayXport (give the reviewUrl); nothing changes on a marketplace by itself. generate_product_image uses the seller\'s AI credits.';

/** Per-connection rate limit: 60 calls a minute (in-process). */
const calls = new Map<string, number[]>();
function limited(id: string): boolean {
  const now = Date.now();
  const list = (calls.get(id) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  calls.set(id, list);
  if (calls.size > 5000) calls.delete(calls.keys().next().value as string);
  return list.length > 60;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, auth: McpAuth): Promise<object | null> {
  const id = msg.id;
  const isNotification = id === undefined || id === null;
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion || '');
      return ok(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, {
        tools: toolsFor(auth.scopes).map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: t.readOnly, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name || '');
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`);
      if (!auth.scopes.includes(tool.scope)) {
        return ok(id, { isError: true, content: [{ type: 'text', text: 'This connection is read-only. Reconnect with permission to prepare drafts.' }] });
      }
      if (limited(auth.connectionId)) return ok(id, { isError: true, content: [{ type: 'text', text: 'Too many requests: wait a minute.' }] });
      const args = msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {};
      try {
        const result = await tool.run(auth, args);
        logger.info('MCP tool call', { userId: auth.userId, connectionId: auth.connectionId, tool: name });
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result });
      } catch (err: any) {
        const message = err instanceof ToolError ? err.message : 'The tool failed. Try again.';
        if (!(err instanceof ToolError)) logger.warn('MCP tool failed', { userId: auth.userId, tool: name, error: err?.message });
        return ok(id, { isError: true, content: [{ type: 'text', text: message }] });
      }
    }
    default:
      return isNotification ? null : fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' || req.method === 'DELETE') {
    // No server-initiated stream and no sessions: plain request / response.
    res.setHeader('Allow', 'POST');
    return res.status(405).json(fail(null, -32000, 'Use POST'));
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  const auth = await authenticateMcp(req);
  if (!auth) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${mcpBaseUrl()}/.well-known/oauth-protected-resource"`);
    return res.status(401).json(fail(null, -32001, 'Connect KolayXport first (OAuth or a personal key from Settings → AI).'));
  }
  const body = req.body;
  const batch = Array.isArray(body);
  const messages: Rpc[] = batch ? body : [body];
  if (!messages.length || messages.some((m) => !m || typeof m !== 'object')) return res.status(400).json(fail(null, -32700, 'Parse error'));
  const replies = (await Promise.all(messages.map((m) => handle(m, auth)))).filter((r): r is object => Boolean(r));
  if (!replies.length) return res.status(202).end();
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(batch ? replies : replies[0]);
}

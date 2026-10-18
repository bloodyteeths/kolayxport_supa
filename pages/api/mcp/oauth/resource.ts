// GET /.well-known/oauth-protected-resource[/api/mcp] (rewritten here) — protected resource metadata (RFC 9728):
// the MCP server at /api/mcp is protected by KolayXport's own authorization server.
import type { NextApiRequest, NextApiResponse } from 'next';
import { MCP_SCOPES, mcpBaseUrl } from '@/lib/mcp/tokens';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const base = mcpBaseUrl();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'KolayXport',
  });
}

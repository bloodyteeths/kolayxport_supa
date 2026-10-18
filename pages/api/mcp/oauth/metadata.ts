// GET /.well-known/oauth-authorization-server (rewritten here) — OAuth 2.1 authorization server metadata (RFC 8414)
// for AI apps connecting to /api/mcp: public clients, PKCE S256, dynamic client registration.
import type { NextApiRequest, NextApiResponse } from 'next';
import { MCP_SCOPES, mcpBaseUrl } from '@/lib/mcp/tokens';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const base = mcpBaseUrl();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/mcp/oauth/token`,
    registration_endpoint: `${base}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // RFC 9207: every authorization response (success and error) carries iss = issuer (ChatGPT's stable redirect URI).
    authorization_response_iss_parameter_supported: true,
    scopes_supported: MCP_SCOPES,
    service_documentation: `${base}/ayarlar?tab=ai`,
  });
}

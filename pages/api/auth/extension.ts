import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { encode } from 'next-auth/jwt';
import { logger } from '@/lib/logger';
import { logSecurityEvent } from '@/lib/admin/events';

/**
 * Chrome Extension Authentication Endpoint
 *
 * Two call paths reach this route in production:
 *   1. The kolayxport.com content script (kolayxport.js) calls `fetch('/api/auth/extension')`
 *      from the page context. This is a same-origin request (origin = https://kolayxport.com)
 *      and carries the user's NextAuth cookie. This is the normal path.
 *   2. Some background-script paths may call directly with a `chrome-extension://<id>` origin.
 *
 * Hardening (no short-lived-token redesign):
 *   - Path 1 (same-origin) is unchanged and continues to work even when OFFICIAL_EXTENSION_ID
 *     is not yet set on the host.
 *   - Path 2 is pinned: if the request carries an `Origin: chrome-extension://...`, it is
 *     accepted ONLY when the id matches `process.env.OFFICIAL_EXTENSION_ID`. If the env var
 *     is unset, all `chrome-extension://` origins are rejected (fail-closed). Other
 *     extensions cannot trick this endpoint into issuing a token.
 *
 * Returned token shape is unchanged so the existing Etsy DOM workflow keeps working.
 */
const ALLOWED_PROD_HOSTS = new Set([
  'https://kolayxport.com',
  'https://www.kolayxport.com',
]);

function isAllowedOrigin(origin: string | undefined): { ok: boolean; reason?: string } {
  if (!origin) return { ok: true }; // Same-origin browser fetch — no Origin header.
  if (ALLOWED_PROD_HOSTS.has(origin)) return { ok: true };
  if (origin.startsWith('chrome-extension://')) {
    const officialId = process.env.OFFICIAL_EXTENSION_ID;
    if (!officialId) {
      return { ok: false, reason: 'OFFICIAL_EXTENSION_ID not configured' };
    }
    const expected = `chrome-extension://${officialId}`;
    if (origin === expected || origin === `${expected}/`) return { ok: true };
    return { ok: false, reason: 'unknown extension id' };
  }
  // Dev: allow http://localhost:* only when NODE_ENV !== 'production'.
  if (
    process.env.NODE_ENV !== 'production' &&
    (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))
  ) {
    return { ok: true };
  }
  return { ok: false, reason: 'origin not allowed' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const origin = req.headers.origin;
  const allow = isAllowedOrigin(origin);

  if (!allow.ok) {
    // Do not set Access-Control-Allow-Origin for disallowed origins. The browser will
    // block the response on the client side, and we additionally return 403.
    logSecurityEvent('warn', {
      message: 'Extension auth: origin rejected',
      operation: 'extension.origin_rejected',
      details: { origin, reason: allow.reason },
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  // For valid chrome-extension origins, reflect the origin in CORS headers so the
  // background script can read the response. Same-origin requests don't need this.
  if (origin && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUser(req, res);

    if (!user) {
      // 200 here is intentional: the extension popup uses this response to decide whether
      // to render the "Please sign in" CTA. Don't change the shape.
      return res.status(200).json({
        authenticated: false,
        error: 'Not authenticated',
        message: 'Please log in to Kolayxport first',
      });
    }

    // Generate a JWT token the extension can use as Bearer token
    const token = await encode({
      token: { sub: user.id, email: user.email, name: user.name },
      secret: process.env.NEXTAUTH_SECRET!,
    });

    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({
      authenticated: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
      },
      message: 'Authentication successful',
    });
  } catch (error) {
    logger.error(
      'Extension auth endpoint error',
      error instanceof Error ? error : new Error(String(error)),
      {},
    );
    return res.status(500).json({
      authenticated: false,
      error: 'Internal server error',
      message: 'Failed to validate authentication',
    });
  }
}

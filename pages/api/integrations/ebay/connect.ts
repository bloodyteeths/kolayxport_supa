import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { signOAuthState } from '@/lib/auth/oauthState';

// Force serverless runtime (not edge)
export const config = {
  runtime: 'nodejs',
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate user
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const clientId = process.env.EBAY_CLIENT_ID;
    const ruName = process.env.EBAY_RU_NAME;

    if (!clientId || !ruName) {
      throw new Error('EBAY_CLIENT_ID and EBAY_RU_NAME environment variables are required');
    }

    // Generate CSRF token and store in HttpOnly cookie
    const csrfToken = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `ebay_csrf=${csrfToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);

    // Sign the state so the callback can detect tampering. The CSRF cookie
    // is a second layer, but without an HMAC signature an attacker could
    // still mint a state with a victim's userId and a CSRF value the
    // attacker controls.
    const state = signOAuthState({
      userId: user.id,
      csrfToken,
    });

    // eBay OAuth scopes — must match scopes enabled in eBay Developer Portal
    const scopes = [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.marketing',
      'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.finances',
    ].join(' ');

    // Build eBay OAuth URL
    const authParams = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: ruName,
      scope: scopes,
      state,
    });

    const authUrl = `https://auth.ebay.com/oauth2/authorize?${authParams}`;

    logger.info('Initiating eBay OAuth flow', {
      userId: user.id,
      ruName,
    });

    // Redirect to eBay consent page
    res.redirect(authUrl);

  } catch (error) {
    logger.error('Failed to initiate eBay OAuth',
      error instanceof Error ? error : new Error(String(error)), {
        userId: user.id,
      });

    return res.status(500).json({
      error: 'Failed to initiate eBay connection',
    });
  }
}

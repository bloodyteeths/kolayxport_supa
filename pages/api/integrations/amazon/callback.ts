import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { exchangeAuthCode } from '@/lib/integrations/amazonClient';
import { logger } from '@/lib/logger';
import { encryptIfNeeded } from '@/lib/crypto/credentials';

export const config = { runtime: 'nodejs' };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  logger.info('Amazon OAuth callback received', { query: req.query });

  const {
    spapi_oauth_code,
    state,
    selling_partner_id,
    error,
    error_description,
  } = req.query;

  // Handle errors from Amazon
  if (error) {
    logger.error('Amazon OAuth error', undefined, {
      error: error as string,
      description: error_description as string,
    });
    return res.redirect('/ayarlar?error=amazon_auth_failed');
  }

  if (!spapi_oauth_code || !state) {
    logger.error('Amazon callback missing params', undefined, {
      hasCode: !!spapi_oauth_code,
      hasState: !!state,
    });
    return res.redirect('/ayarlar?error=amazon_callback_failed');
  }

  let userId = '';

  try {
    // Decode state to get userId and CSRF token
    const stateData = JSON.parse(
      Buffer.from(state as string, 'base64url').toString(),
    );
    userId = stateData.userId;
    const csrfTokenFromState = stateData.csrfToken;

    // Verify CSRF token from cookie matches token in state
    const cookies = req.headers.cookie || '';
    const csrfCookie = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('amazon_csrf='));
    const csrfTokenFromCookie = csrfCookie?.split('=')[1];

    if (!csrfTokenFromState || !csrfTokenFromCookie || csrfTokenFromState !== csrfTokenFromCookie) {
      logger.error('Amazon OAuth CSRF validation failed', undefined, {
        userId,
        hasCsrfInState: !!csrfTokenFromState,
        hasCsrfCookie: !!csrfTokenFromCookie,
      });
      // Clear the CSRF cookie
      res.setHeader('Set-Cookie', 'amazon_csrf=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
      return res.redirect('/ayarlar?error=amazon_csrf_failed');
    }

    // Clear the CSRF cookie after successful verification
    res.setHeader('Set-Cookie', 'amazon_csrf=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');

    logger.info('Decoded Amazon OAuth state', {
      userId,
      sellingPartnerId: selling_partner_id,
    });

    // Exchange authorization code for tokens
    const tokens = await exchangeAuthCode(spapi_oauth_code as string);

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Determine marketplace/region from selling_partner_id or default to EU
    const region = 'eu'; // Default for Turkish sellers
    const marketplaceId = 'A33AVAJ2PDY3EV'; // Turkey default

    // Store tokens in Credential table, encrypted at rest via `enc:v1:` envelope.
    const encAccess = encryptIfNeeded(tokens.access_token);
    const encRefresh = tokens.refresh_token ? encryptIfNeeded(tokens.refresh_token) : undefined;
    await prisma.credential.upsert({
      where: { userId },
      update: {
        amazonAccessToken: encAccess,
        amazonRefreshToken: encRefresh,
        amazonTokenExpiresAt: tokenExpiresAt,
        amazonSellerId: (selling_partner_id as string) || undefined,
        amazonMarketplaceId: marketplaceId,
        amazonRegion: region,
        updatedAt: new Date(),
      },
      create: {
        userId,
        amazonAccessToken: encAccess,
        amazonRefreshToken: encRefresh,
        amazonTokenExpiresAt: tokenExpiresAt,
        amazonSellerId: (selling_partner_id as string) || undefined,
        amazonMarketplaceId: marketplaceId,
        amazonRegion: region,
      },
    });

    logger.info('Amazon OAuth completed successfully', {
      userId,
      sellingPartnerId: selling_partner_id,
      expiresAt: tokenExpiresAt,
    });

    res.redirect('/ayarlar?success=amazon_connected');
  } catch (error) {
    logger.error(
      'Amazon OAuth callback failed',
      error instanceof Error ? error : new Error(String(error)),
      { userId: userId || 'unknown' },
    );

    const errorMsg = error instanceof Error ? error.message : String(error);
    const encoded = encodeURIComponent(errorMsg.substring(0, 100));
    return res.redirect(`/ayarlar?error=amazon_callback_failed&details=${encoded}`);
  }
}

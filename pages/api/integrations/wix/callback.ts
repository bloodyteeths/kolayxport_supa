import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code, state, instanceId, error } = req.query;

  if (error) {
    logger.error('Wix OAuth error', undefined, { error: error as string });
    return res.redirect('/ayarlar?error=wix_auth_failed');
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  let userId = '';

  try {
    // Decode state
    const stateData = JSON.parse(Buffer.from(state as string, 'base64url').toString());
    userId = stateData.userId;

    logger.info('Processing Wix OAuth callback', { userId, hasInstanceId: !!instanceId });

    const appId = process.env.WIX_APP_ID;
    const appSecret = process.env.WIX_APP_SECRET;
    if (!appId || !appSecret) throw new Error('WIX_APP_ID or WIX_APP_SECRET not configured');

    // Exchange code for tokens
    const tokenRes = await fetch('https://www.wixapis.com/oauth/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: appSecret,
        code: code as string,
      }),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      logger.error('Wix token exchange failed', undefined, { status: tokenRes.status, body: errorBody, userId });
      return res.redirect('/ayarlar?error=wix_token_failed');
    }

    const tokens = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const tokenExpiresAt = new Date(Date.now() + ((tokens.expires_in || 600) * 1000));
    const siteId = (instanceId as string) || '';

    // Try to fetch site info
    let siteName = `Wix Site ${siteId}`;
    try {
      const siteRes = await fetch('https://www.wixapis.com/site-properties/v4/properties', {
        headers: {
          'Authorization': tokens.access_token,
          'wix-site-id': siteId,
        },
      });
      if (siteRes.ok) {
        const siteData = await siteRes.json() as any;
        siteName = siteData.properties?.siteDisplayName || siteData.properties?.siteName || siteName;
      }
    } catch (e) {
      logger.warn('Could not fetch Wix site name', { userId, siteId });
    }

    // Upsert WixSite
    await prisma.wixSite.upsert({
      where: { userId_siteId: { userId, siteId } },
      update: {
        siteName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        tokenExpiresAt,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        siteId,
        siteName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        tokenExpiresAt,
        isActive: true,
      },
    });

    // Also upsert Credential for backward compatibility
    await prisma.credential.upsert({
      where: { userId },
      update: {
        wixAccessToken: tokens.access_token,
        wixRefreshToken: tokens.refresh_token || null,
        wixSiteId: siteId,
        wixInstanceId: siteId,
        wixTokenExpiresAt: tokenExpiresAt,
        updatedAt: new Date(),
      },
      create: {
        userId,
        wixAccessToken: tokens.access_token,
        wixRefreshToken: tokens.refresh_token || null,
        wixSiteId: siteId,
        wixInstanceId: siteId,
        wixTokenExpiresAt: tokenExpiresAt,
      },
    });

    logger.info('Wix OAuth completed successfully', { userId, siteId, siteName });
    res.redirect('/ayarlar?success=wix_connected');
  } catch (err) {
    logger.error('Wix OAuth callback failed', err instanceof Error ? err : new Error(String(err)), { userId });
    const errorMsg = err instanceof Error ? err.message : String(err);
    const encoded = encodeURIComponent(errorMsg.substring(0, 100));
    return res.redirect(`/ayarlar?error=wix_callback_failed&details=${encoded}`);
  }
}

import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { instanceId, state, error } = req.query;

  if (error) {
    logger.error('Wix install error', undefined, { error: error as string });
    return res.redirect('/ayarlar?error=wix_auth_failed');
  }

  if (!instanceId || !state) {
    return res.status(400).json({ error: 'Missing instanceId or state parameter' });
  }

  let userId = '';

  try {
    const stateData = JSON.parse(Buffer.from(state as string, 'base64url').toString());
    userId = stateData.userId;

    logger.info('Processing Wix install callback', { userId, instanceId: instanceId as string });

    const appId = process.env.WIX_APP_ID;
    const appSecret = process.env.WIX_APP_SECRET;
    if (!appId || !appSecret) throw new Error('WIX_APP_ID or WIX_APP_SECRET not configured');

    // Get access token using client_credentials grant
    const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appSecret,
        instance_id: instanceId as string,
      }),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text();
      logger.error('Wix token request failed', undefined, { status: tokenRes.status, body: errorBody, userId });
      return res.redirect('/ayarlar?error=wix_token_failed');
    }

    const tokenData = await tokenRes.json() as { access_token: string; expires_in?: number };
    const tokenExpiresAt = new Date(Date.now() + ((tokenData.expires_in || 14400) * 1000));

    // Get site info using the token
    let siteName = `Wix Site`;
    let siteId = instanceId as string;
    try {
      const instanceRes = await fetch('https://www.wixapis.com/apps/v1/instance', {
        headers: { 'Authorization': tokenData.access_token },
      });
      if (instanceRes.ok) {
        const instanceData = await instanceRes.json() as any;
        siteName = instanceData.instance?.siteName || instanceData.site?.siteDisplayName || siteName;
        siteId = instanceData.site?.siteId || instanceData.instance?.siteId || siteId;
      }
    } catch (e) {
      logger.warn('Could not fetch Wix site info', { userId, instanceId: instanceId as string });
    }

    // Upsert WixSite
    await prisma.wixSite.upsert({
      where: { userId_siteId: { userId, siteId } },
      update: {
        siteName,
        accessToken: tokenData.access_token,
        tokenExpiresAt,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        siteId,
        siteName,
        accessToken: tokenData.access_token,
        tokenExpiresAt,
        isActive: true,
      },
    });

    // Also update Credential for sync pipeline compatibility
    await prisma.credential.upsert({
      where: { userId },
      update: {
        wixAccessToken: tokenData.access_token,
        wixSiteId: siteId,
        wixInstanceId: instanceId as string,
        wixTokenExpiresAt: tokenExpiresAt,
        updatedAt: new Date(),
      },
      create: {
        userId,
        wixAccessToken: tokenData.access_token,
        wixSiteId: siteId,
        wixInstanceId: instanceId as string,
        wixTokenExpiresAt: tokenExpiresAt,
      },
    });

    logger.info('Wix connection completed', { userId, siteId, siteName, instanceId: instanceId as string });
    res.redirect('/ayarlar?success=wix_connected');
  } catch (err) {
    logger.error('Wix callback failed', err instanceof Error ? err : new Error(String(err)), { userId });
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.redirect(`/ayarlar?error=wix_callback_failed&details=${encodeURIComponent(errorMsg.substring(0, 100))}`);
  }
}

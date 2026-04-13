import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Receives Wix webhook events (App Instance Installed).
 * Wix sends a JWT in the body — we decode it to extract instanceId.
 * Also accepts plain JSON { instanceId } for direct calls.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let instanceId: string | undefined;
    let siteId: string | undefined;
    let userId: string | undefined;

    // Try to extract from JWT (Wix webhook format)
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    logger.info('Wix webhook received', {
      contentType: req.headers['content-type'],
      bodyType: typeof req.body,
      bodyPreview: rawBody?.substring(0, 200),
      hasDigest: !!req.headers['digest'],
    });

    // Wix sends JWT — could be in body directly or in body.data
    const jwtToken = typeof req.body === 'string'
      ? req.body
      : req.body?.data || req.body?.token;

    if (jwtToken && typeof jwtToken === 'string' && jwtToken.includes('.')) {
      // Decode JWT payload (middle part)
      try {
        const parts = jwtToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          logger.info('Wix webhook JWT decoded', { payload });
          instanceId = payload.instanceId;
          // eventType might be something like "AppInstalled"
        }
      } catch (jwtErr) {
        logger.warn('Failed to decode Wix JWT', { error: String(jwtErr) });
      }
    }

    // Fallback: plain JSON body
    if (!instanceId && req.body?.instanceId) {
      instanceId = req.body.instanceId;
      siteId = req.body.siteId;
      userId = req.body.userId;
    }

    if (!instanceId) {
      logger.warn('Wix webhook: no instanceId found', { body: rawBody?.substring(0, 500) });
      return res.status(400).json({ error: 'Missing instanceId' });
    }

    const appId = process.env.WIX_APP_ID;
    const appSecret = process.env.WIX_APP_SECRET;
    if (!appId || !appSecret) return res.status(500).json({ error: 'Wix not configured' });

    // Get access token using client_credentials
    const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appSecret,
        instance_id: instanceId,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      logger.error('Wix webhook token request failed', undefined, { status: tokenRes.status, body });
      return res.status(500).json({ error: 'Token request failed' });
    }

    const tokenData = await tokenRes.json() as { access_token: string; expires_in?: number };
    const tokenExpiresAt = new Date(Date.now() + ((tokenData.expires_in || 14400) * 1000));

    // Get site info
    let siteName = 'Wix Site';
    let resolvedSiteId = siteId || instanceId;
    try {
      const instanceRes = await fetch('https://www.wixapis.com/apps/v1/instance', {
        headers: { 'Authorization': tokenData.access_token },
      });
      if (instanceRes.ok) {
        const data = await instanceRes.json() as any;
        siteName = data.instance?.siteName || data.site?.siteDisplayName || siteName;
        resolvedSiteId = data.site?.siteId || resolvedSiteId;
      }
    } catch {
      logger.warn('Could not fetch Wix site info from webhook');
    }

    // Store as a pending connection (no userId yet — will be claimed when user polls)
    // If userId was provided (from authenticated call), use it directly
    if (userId) {
      await saveWixConnection(userId, instanceId, resolvedSiteId, siteName, tokenData.access_token, tokenExpiresAt);
      return res.status(200).json({ success: true, siteId: resolvedSiteId, siteName });
    }

    // Store pending connection keyed by instanceId
    await prisma.wixSite.upsert({
      where: { siteId: resolvedSiteId },
      update: {
        siteName,
        accessToken: tokenData.access_token,
        tokenExpiresAt,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId: 'pending', // Will be claimed by the user
        siteId: resolvedSiteId,
        siteName,
        accessToken: tokenData.access_token,
        tokenExpiresAt,
        isActive: true,
      },
    });

    logger.info('Wix webhook: stored pending connection', { instanceId, siteId: resolvedSiteId, siteName });
    return res.status(200).json({ success: true, siteId: resolvedSiteId, siteName });
  } catch (err) {
    logger.error('Wix webhook failed', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function saveWixConnection(
  userId: string, instanceId: string, siteId: string,
  siteName: string, accessToken: string, tokenExpiresAt: Date
) {
  await prisma.wixSite.upsert({
    where: { userId_siteId: { userId, siteId } },
    update: { siteName, accessToken, tokenExpiresAt, isActive: true, updatedAt: new Date() },
    create: { userId, siteId, siteName, accessToken, tokenExpiresAt, isActive: true },
  });

  await prisma.credential.upsert({
    where: { userId },
    update: {
      wixAccessToken: accessToken,
      wixSiteId: siteId,
      wixInstanceId: instanceId,
      wixTokenExpiresAt: tokenExpiresAt,
      updatedAt: new Date(),
    },
    create: {
      userId,
      wixAccessToken: accessToken,
      wixSiteId: siteId,
      wixInstanceId: instanceId,
      wixTokenExpiresAt: tokenExpiresAt,
    },
  });
}

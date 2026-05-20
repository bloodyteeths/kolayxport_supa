import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Receives Wix webhook events (App Instance Installed).
 * Wix sends a JWT in the body — we decode it to extract instanceId.
 * Also accepts plain JSON { instanceId } for direct calls.
 *
 * IMPORTANT: Must always return 200 to Wix, even if we can't process the event.
 * Returning non-200 causes the app install to hang in a spinner.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let instanceId: string | undefined;
    let siteId: string | undefined;
    let userId: string | undefined;

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    logger.info('Wix webhook received', {
      contentType: req.headers['content-type'],
      bodyType: typeof req.body,
      bodyPreview: rawBody?.substring(0, 200),
    });

    // Wix sends JWT — could be in body directly or in body.data
    const jwtToken = typeof req.body === 'string'
      ? req.body
      : req.body?.data || req.body?.token;

    if (jwtToken && typeof jwtToken === 'string' && jwtToken.includes('.')) {
      try {
        const parts = jwtToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          logger.info('Wix webhook JWT decoded', { payload });

          // --- JWT claim validation ---
          // NOTE: Full cryptographic signature verification requires Wix's public key,
          // which is not currently available via their developer docs. For now, we
          // validate the issuer and expiration claims as a defense-in-depth measure.
          // TODO: Implement full signature verification when Wix exposes a JWKS endpoint.
          const expectedIssuers = ['wix.com', 'www.wix.com', 'dev.wix.com'];
          if (payload.iss && !expectedIssuers.includes(payload.iss)) {
            logger.warn('Wix webhook JWT issuer mismatch', {
              iss: payload.iss,
              expected: expectedIssuers,
            });
            return res.status(200).json({ success: false, reason: 'invalid_jwt_issuer' });
          }
          if (payload.exp && typeof payload.exp === 'number') {
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp < now) {
              logger.warn('Wix webhook JWT expired', {
                exp: payload.exp,
                now,
                expiredAgo: now - payload.exp,
              });
              return res.status(200).json({ success: false, reason: 'jwt_expired' });
            }
          }

          if (payload.data && typeof payload.data === 'string') {
            try {
              const eventData = JSON.parse(payload.data);
              logger.info('Wix webhook event data', { eventData });

              // Check if this event is for our app or a CLI-registered component.
              // The appId can be directly on eventData OR nested in eventData.data (another JSON string).
              const ourAppId = process.env.WIX_APP_ID;
              let eventAppId = eventData.appId;
              if (!eventAppId && eventData.data && typeof eventData.data === 'string') {
                try { eventAppId = JSON.parse(eventData.data).appId; } catch {}
              }
              if (eventAppId && ourAppId && eventAppId !== ourAppId) {
                logger.info('Wix webhook: event is for different component, acknowledging', {
                  eventAppId, ourAppId,
                });
                return res.status(200).json({ success: true, skipped: true, reason: 'different_component' });
              }

              instanceId = eventData.instanceId;
            } catch {
              instanceId = payload.instanceId;
            }
          } else {
            instanceId = payload.instanceId;
          }
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
      // Return 200 anyway so Wix doesn't retry endlessly
      return res.status(200).json({ success: false, reason: 'no_instance_id' });
    }

    const appId = process.env.WIX_APP_ID;
    const appSecret = process.env.WIX_APP_SECRET;
    if (!appId || !appSecret) {
      return res.status(200).json({ success: false, reason: 'not_configured' });
    }

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
      logger.error('Wix webhook token request failed', undefined, { status: tokenRes.status, body, instanceId });
      // Return 200 so Wix completes the install flow
      return res.status(200).json({ success: false, reason: 'token_failed', instanceId });
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

    if (userId) {
      await saveWixConnection(userId, instanceId, resolvedSiteId, siteName, tokenData.access_token, tokenExpiresAt);
      return res.status(200).json({ success: true, siteId: resolvedSiteId, siteName });
    }

    // Store pending connection keyed by siteId
    await prisma.wixSite.upsert({
      where: { siteId: resolvedSiteId },
      update: {
        instanceId,
        siteName,
        accessToken: tokenData.access_token,
        tokenExpiresAt,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId: 'pending',
        siteId: resolvedSiteId,
        instanceId,
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
    // Always return 200 to prevent install from hanging
    return res.status(200).json({ success: false, reason: 'internal_error' });
  }
}

async function saveWixConnection(
  userId: string, instanceId: string, siteId: string,
  siteName: string, accessToken: string, tokenExpiresAt: Date
) {
  await prisma.wixSite.upsert({
    where: { userId_siteId: { userId, siteId } },
    update: { instanceId, siteName, accessToken, tokenExpiresAt, isActive: true, updatedAt: new Date() },
    create: { userId, siteId, instanceId, siteName, accessToken, tokenExpiresAt, isActive: true },
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

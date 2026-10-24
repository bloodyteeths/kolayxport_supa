import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { encryptIfNeeded } from '@/lib/crypto/credentials';
import { verifyOAuthState } from '@/lib/auth/oauthState';
import { recordActivation } from '@/lib/activation/events';

/** Reject a signedInstance older than this (limits replay of a leaked redirect URL). */
const SIGNED_INSTANCE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * GET: Wix external-install redirect (postInstallationUrl built by ./connect).
 *   Wix appends `instanceId` + `signedInstance` and preserves our signed `state`.
 *   We verify the state is bound to the logged-in user, verify `signedInstance`
 *   with the app secret, then mint a token for that instance and store the site
 *   for that user. This is the ONLY place a Wix site gets attached to a user.
 *
 * POST: Polled by the settings page after opening the install URL. Body `{ since }`
 *   (ISO string from ./connect). Returns 200 once the user has an active WixSite
 *   stored/updated at or after `since`, else 404. It never claims anything — the
 *   old "claim the newest pending row" behaviour handed one user's site to whoever
 *   polled first and has been removed.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleInstallRedirect(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { since } = req.body || {};
  const sinceDate = typeof since === 'string' ? new Date(since) : null;

  try {
    const site = await prisma.wixSite.findFirst({
      where: {
        userId: user.id,
        isActive: true,
        ...(sinceDate && !isNaN(sinceDate.getTime()) ? { updatedAt: { gte: sinceDate } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: { siteId: true, siteName: true },
    });

    if (!site) {
      return res.status(404).json({ error: 'No Wix connection found yet. Please finish installing the app.' });
    }
    return res.status(200).json({ success: true, siteName: site.siteName, siteId: site.siteId });
  } catch (err) {
    logger.error('Failed to check Wix connection', err instanceof Error ? err : new Error(String(err)), { userId: user.id });
    return res.status(500).json({ error: 'Failed to check connection' });
  }
}

/**
 * Verify Wix's `signedInstance` (`<base64url HMAC-SHA256(data, appSecret)>.<base64url JSON>`)
 * and return its decoded payload, or null.
 */
function verifySignedInstance(signedInstance: string, appSecret: string): Record<string, any> | null {
  const dot = signedInstance.indexOf('.');
  if (dot <= 0 || dot === signedInstance.length - 1) return null;
  const sigPart = signedInstance.slice(0, dot);
  const dataPart = signedInstance.slice(dot + 1);

  const provided = Buffer.from(sigPart, 'base64url');
  const expected = crypto.createHmac('sha256', appSecret).update(dataPart).digest();
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  try {
    return JSON.parse(Buffer.from(dataPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function handleInstallRedirect(req: NextApiRequest, res: NextApiResponse) {
  const fail = (code: 'wix_auth_failed' | 'wix_token_failed' | 'wix_callback_failed', reason: string, extra?: Record<string, unknown>) => {
    logger.warn('Wix install callback rejected', { reason, ...extra });
    return res.redirect(`/ayarlar?error=${code}`);
  };

  const { instanceId, signedInstance, state } = req.query;
  if (typeof instanceId !== 'string' || !instanceId || typeof signedInstance !== 'string' || !signedInstance) {
    // Wix omits these when the install was cancelled or failed.
    return fail('wix_callback_failed', 'missing_instance');
  }

  // 1. The signed state proves which KolayXport user started this install.
  const stateData = verifyOAuthState<{ userId?: string; exp?: number }>(typeof state === 'string' ? state : null);
  if (!stateData || typeof stateData.userId !== 'string' || typeof stateData.exp !== 'number' || stateData.exp < Date.now()) {
    return fail('wix_auth_failed', 'invalid_or_expired_state');
  }

  // 2. ...and it must be the same user who is logged in in this browser, so a
  //    victim can't be lured into installing on their site with an attacker's link.
  const user = await getAuthUser(req, res);
  if (!user || user.id !== stateData.userId) {
    return fail('wix_auth_failed', 'session_mismatch', { hasSession: !!user });
  }

  const appId = process.env.WIX_APP_ID;
  const appSecret = process.env.WIX_APP_SECRET;
  if (!appId || !appSecret) return fail('wix_callback_failed', 'not_configured');

  // 3. Query params are forgeable; signedInstance is what proves the install happened.
  const instanceData = verifySignedInstance(signedInstance, appSecret);
  if (!instanceData || instanceData.instanceId !== instanceId) {
    return fail('wix_auth_failed', 'signed_instance_invalid', { userId: user.id });
  }
  if (instanceData.signDate) {
    const signedAt = new Date(instanceData.signDate).getTime();
    if (!isNaN(signedAt) && Date.now() - signedAt > SIGNED_INSTANCE_MAX_AGE_MS) {
      return fail('wix_auth_failed', 'signed_instance_stale', { userId: user.id });
    }
  }

  try {
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
      return fail('wix_token_failed', 'token_request_failed', { userId: user.id, status: tokenRes.status });
    }
    const tokenData = await tokenRes.json() as { access_token: string; expires_in?: number };
    const tokenExpiresAt = new Date(Date.now() + ((tokenData.expires_in || 14400) * 1000));

    // Same site-info lookup as the webhook, so both paths key the row identically.
    let siteName = 'Wix Site';
    let siteId = instanceId;
    try {
      const instanceRes = await fetch('https://www.wixapis.com/apps/v1/instance', {
        headers: { 'Authorization': tokenData.access_token },
      });
      if (instanceRes.ok) {
        const data = await instanceRes.json() as any;
        siteName = data.instance?.siteName || data.site?.siteDisplayName || siteName;
        siteId = data.site?.siteId || siteId;
      }
    } catch {
      logger.warn('Could not fetch Wix site info in install callback');
    }

    // WixSite.siteId is globally unique. The webhook may already have stored this
    // site as 'pending' (normal) — take it over. Never take a site from another
    // user who still has it active; they must disconnect first.
    const existing = await prisma.wixSite.findUnique({ where: { siteId }, select: { userId: true, isActive: true } });
    if (existing && existing.isActive && existing.userId !== 'pending' && existing.userId !== user.id) {
      return fail('wix_callback_failed', 'site_owned_by_other_user', { userId: user.id, siteId });
    }

    const encAccess = encryptIfNeeded(tokenData.access_token);
    await prisma.wixSite.upsert({
      where: { siteId },
      update: { userId: user.id, instanceId, siteName, accessToken: encAccess, tokenExpiresAt, isActive: true, updatedAt: new Date() },
      create: { userId: user.id, siteId, instanceId, siteName, accessToken: encAccess, tokenExpiresAt, isActive: true },
    });

    await prisma.credential.upsert({
      where: { userId: user.id },
      update: {
        wixAccessToken: encAccess,
        wixSiteId: siteId,
        wixInstanceId: instanceId,
        wixTokenExpiresAt: tokenExpiresAt,
        updatedAt: new Date(),
      },
      create: {
        userId: user.id,
        wixAccessToken: encAccess,
        wixSiteId: siteId,
        wixInstanceId: instanceId,
        wixTokenExpiresAt: tokenExpiresAt,
      },
    });

    logger.info('Wix connection stored from install callback', { userId: user.id, siteId, siteName });
    recordActivation(user.id, 'oauth_ok', 'wix');
    return res.redirect('/ayarlar?success=wix_connected');
  } catch (err) {
    logger.error('Wix install callback failed', err instanceof Error ? err : new Error(String(err)), { userId: user.id });
    recordActivation(user.id, 'oauth_fail', 'wix');
    return res.redirect('/ayarlar?error=wix_callback_failed');
  }
}

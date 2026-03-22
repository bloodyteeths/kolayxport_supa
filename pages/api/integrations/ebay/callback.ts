import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;

  // Handle eBay OAuth errors
  if (error) {
    logger.error('eBay OAuth error', undefined, {
      error: error as string,
      description: req.query.error_description as string,
    });
    return res.redirect('/ayarlar?error=ebay_auth_failed');
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  let userId: string = '';

  try {
    logger.info('Starting eBay OAuth callback processing', {
      hasCode: !!code,
      hasState: !!state,
    });

    // Decode state to get userId
    const stateData = JSON.parse(
      Buffer.from(state as string, 'base64url').toString()
    );
    userId = stateData.userId;

    logger.info('Decoded eBay OAuth state', { userId });

    // Exchange authorization code for tokens
    const clientId = (process.env.EBAY_CLIENT_ID || '').trim();
    const certId = (process.env.EBAY_CERT_ID || '').trim();

    if (!clientId || !certId) {
      throw new Error('EBAY_CLIENT_ID and EBAY_CERT_ID are required');
    }

    const basicAuth = Buffer.from(`${clientId}:${certId}`).toString('base64');
    const redirectUri = process.env.EBAY_RU_NAME || 'Tamsar__Inc.-TamsarIn-kolayx-fejubx';

    const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      logger.error('eBay token exchange failed', undefined, {
        status: tokenResponse.status,
        body: errorBody,
        userId,
      });
      return res.redirect('/ayarlar?error=ebay_token_failed');
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_token_expires_in: number;
      token_type: string;
    };

    logger.info('eBay token exchange successful', {
      userId,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Store tokens in Credential table
    await prisma.credential.upsert({
      where: { userId },
      update: {
        ebayAccessToken: tokens.access_token,
        ebayRefreshToken: tokens.refresh_token,
        ebayTokenExpiresAt: tokenExpiresAt,
        updatedAt: new Date(),
      },
      create: {
        userId,
        ebayAccessToken: tokens.access_token,
        ebayRefreshToken: tokens.refresh_token,
        ebayTokenExpiresAt: tokenExpiresAt,
      },
    });

    logger.info('eBay OAuth completed successfully', {
      userId,
      expiresAt: tokenExpiresAt,
    });

    // Redirect back to settings with success message
    res.redirect('/ayarlar?success=ebay_connected');

  } catch (error) {
    logger.error('eBay OAuth callback failed',
      error instanceof Error ? error : new Error(String(error)), {
        userId: userId || 'unknown',
        step: 'callback_processing',
      });

    const errorMsg = error instanceof Error ? error.message : String(error);
    const encodedError = encodeURIComponent(errorMsg.substring(0, 100));
    return res.redirect(`/ayarlar?error=ebay_callback_failed&details=${encodedError}`);
  }
}

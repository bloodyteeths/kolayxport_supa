import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import fetch from 'node-fetch';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, state, error } = req.query;

  // Handle Etsy OAuth errors
  if (error) {
    logger.error('Etsy OAuth error', undefined, {
      error: error as string,
      description: req.query.error_description as string
    });
    return res.redirect('/ayarlar?error=etsy_auth_failed');
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter' });
  }

  try {
    // Decode state to get userId and codeVerifier
    const stateData = JSON.parse(
      Buffer.from(state as string, 'base64url').toString()
    );
    const { userId, codeVerifier } = stateData;

    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.ETSY_API_KEY!,
      redirect_uri: process.env.ETSY_REDIRECT_URI!,
      code: code as string,
      code_verifier: codeVerifier
    });

    const tokenResponse = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      logger.error('Etsy token exchange failed', undefined, {
        status: tokenResponse.status,
        body: errorBody,
        userId
      });
      return res.redirect('/ayarlar?error=etsy_token_failed');
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
    };

    // Get shop info to store shop ID
    const shopResponse = await fetch('https://api.etsy.com/v3/application/users/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-api-key': process.env.ETSY_API_KEY!
      }
    });

    let shopId = '';
    if (shopResponse.ok) {
      const userData = await shopResponse.json() as any;
      shopId = userData.user_id?.toString() || '';
      
      logger.info('Etsy user info retrieved', {
        userId,
        etsyUserId: shopId
      });
    }

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    // Store tokens in database
    await prisma.credential.upsert({
      where: { userId },
      update: {
        etsyAccessToken: tokens.access_token,
        etsyRefreshToken: tokens.refresh_token,
        etsyShopId: shopId,
        etsyTokenExpiresAt: tokenExpiresAt,
        updatedAt: new Date()
      },
      create: {
        userId,
        etsyAccessToken: tokens.access_token,
        etsyRefreshToken: tokens.refresh_token,
        etsyShopId: shopId,
        etsyTokenExpiresAt: tokenExpiresAt
      }
    });

    logger.info('Etsy OAuth completed successfully', {
      userId,
      shopId,
      expiresAt: tokenExpiresAt
    });

    // Redirect back to settings with success message
    res.redirect('/ayarlar?success=etsy_connected');

  } catch (error) {
    logger.error('Etsy OAuth callback failed', 
      error instanceof Error ? error : new Error(String(error)));

    return res.redirect('/ayarlar?error=etsy_callback_failed');
  }
}
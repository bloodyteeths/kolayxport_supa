import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '@/lib/supabase';
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

  let userId: string = '';
  let codeVerifier: string = '';
  let shopData: any = null;

  try {
    logger.info('Starting Etsy OAuth callback processing', { hasCode: !!code, hasState: !!state });

    // Decode state to get userId and codeVerifier
    const stateData = JSON.parse(
      Buffer.from(state as string, 'base64url').toString()
    );
    userId = stateData.userId;
    codeVerifier = stateData.codeVerifier;

    logger.info('Decoded OAuth state', { userId, hasCodeVerifier: !!codeVerifier });

    // Exchange authorization code for access token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: (process.env.ETSY_API_KEY || '').trim(),
      redirect_uri: (process.env.ETSY_REDIRECT_URI || '').trim(),
      code: code as string,
      code_verifier: codeVerifier
    });

    const tokenResponse = await fetch('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
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

    logger.info('Token exchange successful', { userId, hasAccessToken: !!tokens.access_token });

    // Validate API key is available before making API calls
    const etsyApiKeyRaw = process.env.ETSY_API_KEY;
    if (!etsyApiKeyRaw) {
      logger.error('ETSY_API_KEY environment variable is not set', undefined, { userId });
      throw new Error('ETSY_API_KEY environment variable is not configured');
    }
    // Trim whitespace/newlines that may be introduced when pasting env vars in Vercel UI
    const etsyApiKey = etsyApiKeyRaw.trim();

    logger.info('Etsy API key check', {
      userId,
      keyLength: etsyApiKey.length,
      keyRawLength: etsyApiKeyRaw.length,
      keyPrefix: etsyApiKey.substring(0, 4) + '...',
      hadWhitespace: etsyApiKey !== etsyApiKeyRaw
    });

    // Step 1: Get user_id from /users/me
    const userResponse = await fetch('https://api.etsy.com/v3/application/users/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-api-key': etsyApiKey
      }
    });

    if (!userResponse.ok) {
      const errorBody = await userResponse.text();
      logger.error('Failed to fetch Etsy user info', undefined, {
        status: userResponse.status,
        body: errorBody,
        userId,
        apiKeySet: !!etsyApiKey,
        apiKeyLength: etsyApiKey.length
      });
      throw new Error(`Failed to get Etsy user info: ${userResponse.status} - ${errorBody}`);
    }

    const userData = await userResponse.json() as any;
    const etsyUserId = userData.user_id?.toString() || '';

    logger.info('Etsy user info retrieved', {
      userId,
      etsyUserId
    });

    // Step 2: Get actual shop_id from /users/{user_id}/shops
    const shopsResponse = await fetch(`https://api.etsy.com/v3/application/users/${etsyUserId}/shops`, {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-api-key': etsyApiKey
      }
    });

    if (!shopsResponse.ok) {
      const errorBody = await shopsResponse.text();
      logger.error('Failed to fetch Etsy shops', undefined, {
        status: shopsResponse.status,
        body: errorBody,
        userId,
        etsyUserId
      });
      throw new Error(`Failed to get Etsy shops: ${shopsResponse.status} - ${errorBody}`);
    }

    const shopsData = await shopsResponse.json() as any;

    // Use the first shop (most users have one shop)
    const firstShop = shopsData.results?.[0] || shopsData;
    const actualShopId = firstShop.shop_id?.toString() || '';
    const shopName = firstShop.shop_name || `Shop ${actualShopId}`;

    if (!actualShopId) {
      throw new Error('No shop found for this Etsy user');
    }

    shopData = {
      shop_id: actualShopId,
      shop_name: shopName
    };

    logger.info('Etsy shop info retrieved', {
      userId,
      etsyUserId,
      shopId: actualShopId,
      shopName
    });

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    if (!shopData) {
      throw new Error('No shop data available');
    }

    // Check if user already has this shop
    const existingShop = await prisma.etsyShop.findUnique({
      where: {
        userId_shopId: {
          userId,
          shopId: shopData.shop_id.toString()
        }
      }
    });

    // Check if user has any Etsy shops yet (to determine if this should be default)
    const userShopCount = await prisma.etsyShop.count({
      where: { 
        userId,
        isActive: true 
      }
    });

    // Also check for legacy credentials
    const hasLegacyCredentials = await prisma.credential.findFirst({
      where: { 
        userId,
        etsyAccessToken: { not: null }
      }
    });

    const isFirstShop = userShopCount === 0 && !hasLegacyCredentials;

    // Store/update shop in new EtsyShop model
    let etsyShopSaved = false;
    try {
      await prisma.etsyShop.upsert({
        where: {
          userId_shopId: {
            userId,
            shopId: shopData.shop_id.toString()
          }
        },
        update: {
          shopName: shopData.shop_name,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: tokenExpiresAt,
          isActive: true,
          updatedAt: new Date()
        },
        create: {
          userId,
          shopId: shopData.shop_id.toString(),
          shopName: shopData.shop_name,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: tokenExpiresAt,
          isDefault: false, // No default shops - always auto-match
          isActive: true
        }
      });

      etsyShopSaved = true;
      logger.info('Successfully stored shop in EtsyShop model', {
        userId,
        shopId: shopData.shop_id,
        shopName: shopData.shop_name,
        isFirstShop
      });
    } catch (etsyShopError) {
      logger.error('Failed to store in EtsyShop model', etsyShopError, {
        userId,
        shopId: shopData.shop_id
      });
    }

    // Update Credential table if this is the first shop OR if EtsyShop save failed (fallback)
    if (isFirstShop || !etsyShopSaved) {
      await prisma.credential.upsert({
        where: { userId },
        update: {
          etsyAccessToken: tokens.access_token,
          etsyRefreshToken: tokens.refresh_token,
          etsyShopId: shopData.shop_id.toString(),
          etsyTokenExpiresAt: tokenExpiresAt,
          updatedAt: new Date()
        },
        create: {
          userId,
          etsyAccessToken: tokens.access_token,
          etsyRefreshToken: tokens.refresh_token,
          etsyShopId: shopData.shop_id.toString(),
          etsyTokenExpiresAt: tokenExpiresAt
        }
      });

      if (!etsyShopSaved) {
        logger.warn('Fell back to Credential table for Etsy shop storage', {
          userId,
          shopId: shopData.shop_id
        });
      }
    }

    logger.info('Etsy OAuth completed successfully', {
      userId,
      shopId: shopData.shop_id,
      shopName: shopData.shop_name,
      expiresAt: tokenExpiresAt
    });

    // Redirect back to settings with success message
    logger.info('Etsy OAuth callback completed successfully', { 
      userId, 
      shopId: shopData.shop_id,
      shopName: shopData.shop_name 
    });
    res.redirect('/ayarlar?success=etsy_connected');

  } catch (error) {
    logger.error('Etsy OAuth callback failed', 
      error instanceof Error ? error : new Error(String(error)), {
        userId: userId || 'unknown',
        hasShopData: !!shopData,
        shopId: shopData?.shop_id,
        step: 'callback_processing'
      });

    const errorMsg = error instanceof Error ? error.message : String(error);
    const encodedError = encodeURIComponent(errorMsg.substring(0, 100));
    return res.redirect(`/ayarlar?error=etsy_callback_failed&details=${encodedError}`);
  }
}
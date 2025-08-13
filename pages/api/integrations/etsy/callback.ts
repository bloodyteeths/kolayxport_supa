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

    // Get user's shops info
    const shopsResponse = await fetch('https://openapi.etsy.com/v3/application/users/me/shops', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'x-api-key': process.env.ETSY_API_KEY!
      }
    });

    let shopData: any = null;
    if (shopsResponse.ok) {
      const shopsData = await shopsResponse.json() as any;
      const shops = shopsData.results || [];
      
      if (shops.length > 0) {
        // For now, use the first shop (primary shop)
        shopData = shops[0];
        
        logger.info('Etsy shops retrieved', {
          userId,
          shopCount: shops.length,
          primaryShopId: shopData.shop_id,
          primaryShopName: shopData.shop_name
        });
      } else {
        throw new Error('No Etsy shops found for this user');
      }
    } else {
      const errorBody = await shopsResponse.text();
      throw new Error(`Failed to get Etsy shops: ${shopsResponse.status} - ${errorBody}`);
    }

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

    const isFirstShop = userShopCount === 0;

    // Store/update shop in new EtsyShop model
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
        isDefault: isFirstShop, // First shop becomes default
        isActive: true
      }
    });

    // Also maintain backward compatibility with old Credential model for now
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

    logger.info('Etsy OAuth completed successfully', {
      userId,
      shopId: shopData.shop_id,
      shopName: shopData.shop_name,
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
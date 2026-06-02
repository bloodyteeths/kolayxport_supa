import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { EtsyClient, EtsyTrackingData, EtsyCredentials } from '@/lib/integrations/etsyClient';
import { logger } from '@/lib/logger';
import { decryptIfNeeded, encryptIfNeeded } from '@/lib/crypto/credentials';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { shopId, receiptId, trackingNumber, carrier } = req.body as EtsyTrackingData;

    // Validate required fields
    if (!shopId || !receiptId || !trackingNumber || !carrier) {
      return res.status(400).json({ 
        error: 'Missing required fields: shopId, receiptId, trackingNumber, carrier' 
      });
    }

    // Get user's Etsy credentials
    const credential = await prisma.credential.findFirst({
      where: {
        userId: user.id
      },
      select: {
        etsyAccessToken: true,
        etsyRefreshToken: true,
        etsyShopId: true,
        etsyTokenExpiresAt: true
      }
    });

    if (!credential || !credential.etsyAccessToken || !credential.etsyShopId) {
      return res.status(400).json({ 
        error: 'Etsy not connected. Please connect your Etsy shop first.' 
      });
    }

    // Decrypt the enc:v1: envelopes before handing tokens to EtsyClient,
    // which uses them as raw Bearer tokens.
    const accessTokenPlain = decryptIfNeeded(credential.etsyAccessToken) as string;
    const refreshTokenPlain = decryptIfNeeded(credential.etsyRefreshToken) as string | null;
    if (!accessTokenPlain) {
      return res.status(400).json({
        error: 'Etsy credentials could not be decrypted. Please reconnect your Etsy shop.'
      });
    }

    const etsyCredentials = {
      accessToken: accessTokenPlain,
      refreshToken: refreshTokenPlain || undefined,
      shopId: shopId || credential.etsyShopId, // Use provided shopId or default to user's shop
      tokenExpiresAt: credential.etsyTokenExpiresAt || undefined
    };

    // Create token refresh callback to update database (re-encrypt on write).
    const onTokenRefresh = async (newCredentials: EtsyCredentials) => {
      await prisma.credential.update({
        where: {
          userId: user.id
        },
        data: {
          etsyAccessToken: encryptIfNeeded(newCredentials.accessToken) as string,
          etsyRefreshToken: newCredentials.refreshToken
            ? (encryptIfNeeded(newCredentials.refreshToken) as string)
            : null,
          etsyTokenExpiresAt: newCredentials.tokenExpiresAt
        }
      });

      logger.info('Updated Etsy credentials in database after token refresh', {
        userId: user.id,
        shopId: newCredentials.shopId
      });
    };

    // Initialize Etsy client with token refresh callback
    const etsyClient = new EtsyClient(etsyCredentials, onTokenRefresh);

    // Validate credentials before proceeding
    const isValid = await etsyClient.validateCredentials();
    if (!isValid) {
      return res.status(401).json({ 
        error: 'Invalid Etsy credentials. Please re-authenticate.' 
      });
    }

    // Submit tracking to Etsy
    const trackingData: EtsyTrackingData = {
      shopId,
      receiptId,
      trackingNumber,
      carrier
    };

    const result = await etsyClient.submitTracking(trackingData);

    // Log the tracking submission
    await prisma.trackingSubmission.create({
      data: {
        orderId: receiptId,
        trackingNumber,
        carrierId: 1, // Default carrier ID for Etsy
        carrierName: carrier,
        submittedBy: user.id,
        submittedAt: new Date(),
        status: 'submitted',
        veeqoResponse: JSON.parse(JSON.stringify(result))
      }
    });

    logger.info('Etsy tracking submission completed', {
      userId: user.id,
      receiptId,
      trackingNumber,
      carrier,
      receiptShippingId: result.receipt_shipping_id
    });

    return res.status(200).json({ 
      ok: true,
      receipt_shipping_id: result.receipt_shipping_id,
      receipt_id: result.receipt_id,
      tracking_code: result.tracking_code,
      carrier_name: result.carrier_name
    });

  } catch (error: any) {
    logger.error('Etsy tracking submission failed', 
      error instanceof Error ? error : new Error(String(error)), {
        userId: user.id,
        body: req.body
      });

    return res.status(500).json({ 
      error: 'Failed to submit tracking to Etsy',
      message: error.message 
    });
  }
}
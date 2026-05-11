import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { getAuthUser } from '../../../lib/auth';
import formidable from 'formidable';
import fs from 'fs';

async function refreshEtsyToken(shopId: string, refreshToken: string): Promise<string> {
  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: (process.env.ETSY_API_KEY || '').trim(),
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) throw new Error('Failed to refresh Etsy token');
  const data = await response.json();
  const newAccessToken = data.access_token;

  await prisma.etsyShop.updateMany({
    where: { shopId },
    data: {
      accessToken: newAccessToken,
      refreshToken: data.refresh_token || refreshToken,
      tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });
  return newAccessToken;
}

type EtsyTokenContext = {
  shopId: string;
  accessToken: string;
};

function firstFormValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

async function getEtsyTokenContext(shopInput: string, userId: string): Promise<EtsyTokenContext> {
  const normalizedShopInput = shopInput.trim();
  const etsyShop = await prisma.etsyShop.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [
        { shopId: normalizedShopInput },
        { shopName: normalizedShopInput },
      ],
    },
    select: { shopId: true, accessToken: true, refreshToken: true, tokenExpiresAt: true },
  });

  if (etsyShop) {
    const now = new Date();
    if (!etsyShop.tokenExpiresAt || etsyShop.tokenExpiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      if (!etsyShop.refreshToken) throw new Error('No refresh token available');
      return {
        shopId: etsyShop.shopId,
        accessToken: await refreshEtsyToken(etsyShop.shopId, etsyShop.refreshToken),
      };
    }
    return { shopId: etsyShop.shopId, accessToken: etsyShop.accessToken };
  }

  const credential = await prisma.credential.findFirst({
    where: { userId, etsyShopId: normalizedShopInput },
    select: { etsyAccessToken: true, etsyRefreshToken: true, etsyTokenExpiresAt: true },
  });
  if (!credential?.etsyAccessToken) {
    logger.warn('Etsy video upload shop lookup failed', {
      userId,
      receivedShopId: normalizedShopInput,
    });
    throw new Error('Etsy shop not found or not connected');
  }

  const now = new Date();
  if (!credential.etsyTokenExpiresAt || credential.etsyTokenExpiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    if (!credential.etsyRefreshToken) throw new Error('No refresh token available');
    return {
      shopId: normalizedShopInput,
      accessToken: await refreshEtsyToken(normalizedShopInput, credential.etsyRefreshToken),
    };
  }
  return { shopId: normalizedShopInput, accessToken: credential.etsyAccessToken };
}

// Disable default body parser to handle multipart form data
export const config = {
  api: {
    bodyParser: false,
  },
};

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';

interface ParsedForm {
  fields: formidable.Fields;
  files: formidable.Files;
}

function parseForm(req: NextApiRequest): Promise<ParsedForm> {
  const form = formidable({
    maxFileSize: 100 * 1024 * 1024, // 100MB
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return;
  let tempVideoPath: string | null = null;

  try {
    const { fields, files } = await parseForm(req);

    const listing_id = firstFormValue(fields.listing_id as string | string[] | undefined);
    const shop_id = firstFormValue(fields.shop_id as string | string[] | undefined);
    const videoName = firstFormValue(fields.name as string | string[] | undefined) || `Video for listing ${listing_id}`;

    if (!listing_id || !shop_id) {
      return res.status(400).json({ error: 'listing_id and shop_id are required' });
    }

    // Get the uploaded file
    const videoFile = Array.isArray(files.video) ? files.video[0] : files.video;
    if (!videoFile) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    tempVideoPath = videoFile.filepath;

    // Validate content type
    const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg'];
    const contentType = videoFile.mimetype || 'video/mp4';
    if (!allowedTypes.includes(contentType)) {
      return res.status(400).json({
        error: `Unsupported video format: ${contentType}. Supported: MP4, WebM, MOV, AVI, MPEG`,
      });
    }

    // Read file buffer
    const videoBuffer = fs.readFileSync(videoFile.filepath);

    logger.info('Direct video upload to Etsy listing', {
      listing_id,
      size: `${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      contentType,
    });

    // Get Etsy access token (handles token refresh)
    let accessToken: string;
    let canonicalShopId: string;
    try {
      const tokenContext = await getEtsyTokenContext(shop_id, user.id);
      accessToken = tokenContext.accessToken;
      canonicalShopId = tokenContext.shopId;
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Etsy not connected' });
    }

    // Build multipart form data for Etsy API
    const boundary = '----EtsyVideoUpload' + Date.now();
    const textEncoder = new TextEncoder();

    // Part 1: name field
    let namePart = `--${boundary}\r\n`;
    namePart += `Content-Disposition: form-data; name="name"\r\n\r\n`;
    namePart += `${videoName}\r\n`;
    const nameBytes = textEncoder.encode(namePart);

    // Part 2: video file
    const ext = contentType === 'video/webm' ? 'webm' : contentType === 'video/quicktime' ? 'mov' : 'mp4';
    const filename = videoFile.originalFilename || `listing_${listing_id}_video.${ext}`;
    let videoPart = `--${boundary}\r\n`;
    videoPart += `Content-Disposition: form-data; name="video"; filename="${filename}"\r\n`;
    videoPart += `Content-Type: ${contentType}\r\n\r\n`;
    const videoHeaderBytes = textEncoder.encode(videoPart);

    const footerPart = `\r\n--${boundary}--\r\n`;
    const footerBytes = textEncoder.encode(footerPart);

    // Combine all parts
    const totalLength = nameBytes.length + videoHeaderBytes.length + videoBuffer.length + footerBytes.length;
    const bodyParts = new Uint8Array(totalLength);
    let offset = 0;
    bodyParts.set(nameBytes, offset); offset += nameBytes.length;
    bodyParts.set(videoHeaderBytes, offset); offset += videoHeaderBytes.length;
    bodyParts.set(new Uint8Array(videoBuffer), offset); offset += videoBuffer.length;
    bodyParts.set(footerBytes, offset);

    // Upload to Etsy
    const uploadUrl = `${ETSY_API_BASE}/shops/${canonicalShopId}/listings/${listing_id}/videos`;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': `${(process.env.ETSY_API_KEY || '').trim()}:${(process.env.ETSY_API_SECRET || '').trim()}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyParts,
    });

    // Clean up temp file
    try {
      fs.unlinkSync(videoFile.filepath);
      tempVideoPath = null;
    } catch {}

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      logger.error('Etsy video upload failed', new Error(errorText), {
        listing_id,
        status: uploadResponse.status,
      });
      return res.status(uploadResponse.status).json({
        error: `Video upload failed: ${uploadResponse.status}`,
        details: errorText,
      });
    }

    const uploadResult = await uploadResponse.json();

    return res.status(200).json({
      success: true,
      listing_id,
      video_id: uploadResult.video_id,
      video_state: uploadResult.video_state,
      message: 'Video uploaded successfully',
    });
  } catch (err: any) {
    logger.error('Video upload error', err);
    return res.status(500).json({ error: err.message || 'Video upload failed' });
  } finally {
    if (tempVideoPath) {
      try { fs.unlinkSync(tempVideoPath); } catch {}
    }
  }
}

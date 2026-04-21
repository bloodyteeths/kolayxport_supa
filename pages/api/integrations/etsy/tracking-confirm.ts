import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS for Chrome extension
  const origin = req.headers.origin;
  const ALLOWED_EXTENSION_IDS = [process.env.CHROME_EXTENSION_ID].filter(Boolean);
  if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
    const extensionId = origin.replace('chrome-extension://', '').replace('moz-extension://', '');
    if (ALLOWED_EXTENSION_IDS.length === 0 || ALLOWED_EXTENSION_IDS.includes(extensionId)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://kolayxport.com');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Extension-Version, X-Extension-Auth');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth: NextAuth session or extension fallback
  let user = await getAuthUser(req, res);

  if (!user && origin && origin.startsWith('chrome-extension://')) {
    const shopName = req.body?.shopName as string | undefined;
    if (shopName) {
      const shop = await prisma.etsyShop.findFirst({
        where: { shopName: { equals: shopName, mode: 'insensitive' }, isActive: true },
        select: { userId: true, user: { select: { id: true, email: true, name: true } } },
      });
      if (shop?.user) {
        user = { id: shop.user.id, email: shop.user.email, name: shop.user.name };
      }
    }
  }

  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { submissionId, status, error: errorMsg } = req.body;

    if (!submissionId || !status) {
      return res.status(400).json({ error: 'submissionId and status are required' });
    }

    if (!['submitted', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'status must be "submitted" or "failed"' });
    }

    // Verify the submission belongs to this user
    const submission = await prisma.trackingSubmission.findFirst({
      where: { id: submissionId, submittedBy: user.id },
    });

    if (!submission) {
      return res.status(404).json({ error: 'Tracking submission not found' });
    }

    // Update the submission
    const updated = await prisma.trackingSubmission.update({
      where: { id: submissionId },
      data: {
        etsySubmitStatus: status,
        etsySubmittedAt: status === 'submitted' ? new Date() : undefined,
        etsySubmitError: status === 'failed' ? (errorMsg || 'Unknown error') : null,
      },
    });

    logger.info('[tracking-confirm] Etsy tracking submission confirmed', {
      userId: user.id,
      submissionId,
      status,
      trackingNumber: updated.trackingNumber,
    });

    return res.status(200).json({ success: true, status: updated.etsySubmitStatus });
  } catch (error) {
    logger.error('[tracking-confirm] Error', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).json({ error: 'Internal server error' });
  }
}

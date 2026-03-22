import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN || 'ebay-kolayxport-2026-verify-token';
const ENDPOINT_URL = process.env.EBAY_DELETION_ENDPOINT_URL || 'https://kolayxport.com/api/ebay/account-deletion';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleChallenge(req, res);
  }

  if (req.method === 'POST') {
    return handleDeletionNotification(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function handleChallenge(req: NextApiRequest, res: NextApiResponse) {
  const challengeCode = req.query.challenge_code;

  if (!challengeCode || typeof challengeCode !== 'string') {
    return res.status(400).json({ error: 'Missing challenge_code parameter' });
  }

  const hash = crypto
    .createHash('sha256')
    .update(challengeCode)
    .update(VERIFICATION_TOKEN)
    .update(ENDPOINT_URL)
    .digest('hex');

  return res.status(200).json({ challengeResponse: hash });
}

function handleDeletionNotification(req: NextApiRequest, res: NextApiResponse) {
  const { metadata, notification } = req.body || {};

  console.log('[eBay Account Deletion]', JSON.stringify({
    topic: metadata?.topic,
    userId: notification?.userId,
    username: notification?.username,
    timestamp: new Date().toISOString(),
  }));

  // Acknowledge receipt — eBay expects 200 OK
  return res.status(200).json({ status: 'ok' });
}

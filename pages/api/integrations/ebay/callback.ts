import { NextApiRequest, NextApiResponse } from 'next';
import { logger } from '@/lib/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error } = req.query;

  if (error) {
    logger.error('eBay OAuth error', undefined, {
      error: error as string,
      description: req.query.error_description as string,
    });
    return res.redirect('/ayarlar?error=ebay_auth_failed');
  }

  if (!code) {
    return res.redirect('/ayarlar?error=ebay_missing_code');
  }

  // TODO: Exchange authorization code for access token
  logger.info('eBay OAuth callback received', { hasCode: !!code });

  return res.redirect('/ayarlar?success=ebay_connected');
}

import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const appId = process.env.WIX_APP_ID;
    const redirectUri = process.env.WIX_REDIRECT_URI;
    if (!appId || !redirectUri) {
      return res.status(500).json({ error: 'Wix app not configured' });
    }

    const state = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64url');

    const authUrl = `https://www.wix.com/installer/install?appId=${appId}&redirectUrl=${encodeURIComponent(redirectUri)}&token=${state}`;

    logger.info('Initiating Wix OAuth flow', { userId: user.id });
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Failed to initiate Wix OAuth', error instanceof Error ? error : new Error(String(error)), { userId: user.id });
    return res.status(500).json({ error: 'Failed to initiate Wix connection' });
  }
}

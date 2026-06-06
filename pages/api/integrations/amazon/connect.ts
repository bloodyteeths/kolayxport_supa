import { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { buildAuthUrl } from '@/lib/integrations/amazonClient';
import { logger } from '@/lib/logger';

export const config = { runtime: 'nodejs' };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const marketplaceIdsParam = (req.query.marketplaceIds as string | undefined) || '';
    const marketplaceIds = marketplaceIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (marketplaceIds.length === 0) {
      return res.redirect('/ayarlar?error=amazon_no_marketplace_selected');
    }

    const { url: authUrl, csrfToken } = buildAuthUrl(user.id, marketplaceIds);

    // Store CSRF token in HttpOnly cookie for callback verification
    res.setHeader('Set-Cookie', `amazon_csrf=${csrfToken}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`);

    logger.info('Initiating Amazon OAuth flow', { userId: user.id });

    res.redirect(authUrl);
  } catch (error) {
    logger.error(
      'Failed to initiate Amazon OAuth',
      error instanceof Error ? error : new Error(String(error)),
      { userId: user.id },
    );

    return res.status(500).json({ error: 'Failed to initiate Amazon connection' });
  }
}

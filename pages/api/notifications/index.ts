import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { listNotifications } from '@/lib/notifications';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/notifications?limit=20
 * -> { items: [{ id, type, severity, titleKey, params, link, readAt, createdAt }], unreadCount }
 * Only unresolved notifications, newest first. Text is rendered client-side via
 * useTranslations('notifications') -> t(titleKey, params).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Cache-Control', 'private, no-store');

  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = rawLimit ? parseInt(rawLimit, 10) : 20;

  try {
    const data = await listNotifications(user.id, Number.isFinite(limit) ? limit : 20);
    return res.status(200).json(data);
  } catch (error) {
    logger.error(
      'Notifications list failed',
      error instanceof Error ? error : new Error(String(error)),
      { userId: user.id },
    );
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { listNotifications } from '@/lib/notifications';

export const config = { runtime: 'nodejs' };

function q(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * GET /api/notifications/activity?limit=30[&cursor=][&group=]
 * -> { items, unreadCount, nextCursor }
 *
 * The Activity feed: badge=false rows (events that never raise the bell, e.g.
 * orderShippedExternal, listingChangedExternally, or types whose in-app
 * preference is off). Includes resolved rows. unreadCount is the BELL count
 * (same as GET /api/notifications) so one response can refresh both.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');

  const rawLimit = q(req.query.limit);
  const limit = rawLimit ? parseInt(rawLimit, 10) : 30;
  try {
    const data = await listNotifications(user.id, Number.isFinite(limit) ? limit : 30, {
      feed: 'activity',
      cursor: q(req.query.cursor) || null,
      group: q(req.query.group) || null,
      includeResolved: true,
    });
    return res.status(200).json(data);
  } catch (error) {
    logger.error(
      'Notifications activity failed',
      error instanceof Error ? error : new Error(String(error)),
      { userId: user.id },
    );
    return res.status(500).json({ error: 'Failed to load activity' });
  }
}

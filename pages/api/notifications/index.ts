import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { listNotifications, type NotificationFeed } from '@/lib/notifications';
import { captureLocale } from '@/lib/notificationCenter/preferences';

export const config = { runtime: 'nodejs' };

function q(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * GET /api/notifications?limit=20[&feed=badge|activity|all][&cursor=][&group=][&unread=1][&includeResolved=1]
 * -> { items: [{ id, type, severity, titleKey, params, link, readAt, createdAt, badge, entityType, entityId, resolvedAt }],
 *      unreadCount, nextCursor }
 *
 * Default feed=badge = the bell (unresolved, badge=true rows), newest first.
 * unreadCount counts badge=true, unread, unresolved rows only. Text is
 * rendered client-side via useTranslations('notifications') -> t(titleKey, params).
 *
 * Optional header X-KX-Locale: tr|en — remembered (max once/hour) so emails
 * go out in the user's UI language.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  res.setHeader('Cache-Control', 'private, no-store');

  const localeHeader = req.headers['x-kx-locale'];
  if (localeHeader) void captureLocale(user.id, Array.isArray(localeHeader) ? localeHeader[0] : localeHeader);

  const rawLimit = q(req.query.limit);
  const limit = rawLimit ? parseInt(rawLimit, 10) : 20;
  const feedRaw = q(req.query.feed);
  const feed: NotificationFeed = feedRaw === 'activity' || feedRaw === 'all' ? feedRaw : 'badge';

  try {
    const data = await listNotifications(user.id, Number.isFinite(limit) ? limit : 20, {
      feed,
      cursor: q(req.query.cursor) || null,
      group: q(req.query.group) || null,
      unreadOnly: q(req.query.unread) === '1',
      includeResolved: q(req.query.includeResolved) === '1',
    });
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

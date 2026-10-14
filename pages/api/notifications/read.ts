import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { markNotificationsRead } from '@/lib/notifications';

export const config = { runtime: 'nodejs' };

/**
 * POST /api/notifications/read
 * body { ids?: string[], all?: boolean } -> { ok: true }
 * Marks the caller's own notifications as read (ids outside the user are ignored).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const all = body.all === true;
  const ids = Array.isArray(body.ids) ? body.ids.filter((v: unknown): v is string => typeof v === 'string') : [];
  if (!all && ids.length === 0) {
    return res.status(400).json({ error: 'Provide ids or all: true' });
  }

  try {
    await markNotificationsRead(user.id, { ids, all });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error(
      'Notifications mark-read failed',
      error instanceof Error ? error : new Error(String(error)),
      { userId: user.id },
    );
    return res.status(500).json({ error: 'Failed to update notifications' });
  }
}

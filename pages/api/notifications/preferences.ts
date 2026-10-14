import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import {
  applyPreferencesPatch,
  getPreferences,
  isAdminUser,
  validatePreferencesPatch,
} from '@/lib/notificationCenter/preferencesService';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/notifications/preferences
 *   -> { settings, preset, customized, telegramAvailable,
 *        types: [{ type, group, severity, badge, inApp, email, emailMode, telegram, telegramAvailable, customized }] }
 * PUT /api/notifications/preferences
 *   body { settings?: { locale?, timezone?, emailEnabled?, quietHoursStart?, quietHoursEnd?, digestHour? },
 *          preset?: 'critical'|'recommended'|'all', types?: [{ type, inApp?, email?, emailMode? }], resetTypes? }
 *   -> same shape as GET (fresh). 400 { error, fields } on invalid input.
 * Admin-only types are hidden from (and rejected for) non-admin users.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await getAuthUser(req, res, { allowBearer: false });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const isAdmin = await isAdminUser(user.id);
    if (req.method === 'GET') {
      return res.status(200).json(await getPreferences(user.id, isAdmin));
    }
    const v = validatePreferencesPatch(req.body, isAdmin);
    if (!v.ok) return res.status(400).json({ error: 'Invalid preferences', fields: v.errors });
    return res.status(200).json(await applyPreferencesPatch(user.id, v.patch, isAdmin));
  } catch (error) {
    logger.error(
      'Notification preferences failed',
      error instanceof Error ? error : new Error(String(error)),
      { userId: user.id, method: req.method },
    );
    return res.status(500).json({ error: 'Failed to load notification preferences' });
  }
}

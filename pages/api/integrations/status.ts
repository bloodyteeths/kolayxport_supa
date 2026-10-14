import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getConnectionStatus } from '@/lib/integrations/connectionStatus';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/integrations/status
 * Unified "which integrations does this user have" snapshot.
 * Read-only, DB-only (no marketplace API calls), never returns secrets.
 * Response: ConnectionStatusResponse (lib/integrations/connectionStatus.ts).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // Per-user data: never cache in shared proxies.
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    const status = await getConnectionStatus(user.id);
    return res.status(200).json(status);
  } catch (error) {
    logger.error(
      'Integration status check failed',
      error instanceof Error ? error : new Error(String(error)),
      { userId: user.id },
    );
    return res.status(500).json({ error: 'Failed to load integration status' });
  }
}

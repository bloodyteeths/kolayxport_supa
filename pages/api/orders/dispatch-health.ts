import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { getDispatchHealth } from '@/lib/orders/dispatch';

/**
 * GET /api/orders/dispatch-health?days=90
 * -> DispatchHealth (lib/orders/dispatch.ts): onTimeRate, onTimeWithTrackingRate,
 *    shippedCount, lateCount, avgHandlingHours, deliveryDaysByCarrier, openByState.
 * Rates are 0..1 or null when there is no shipped order with a ship-by date.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const days = Number(req.query.days) || 90;
  try {
    const health = await getDispatchHealth(user.id, days);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(health);
  } catch (error: any) {
    console.error('[dispatch-health] error', error?.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

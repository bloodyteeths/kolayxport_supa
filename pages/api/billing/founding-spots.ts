import type { NextApiRequest, NextApiResponse } from 'next';
import { getFoundingSpots } from '@/lib/billing/foundingServer';

/** Public: the founding-member counter on the pricing page (lib/billing/useFoundingSpots.ts). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }
  const spots = await getFoundingSpots();
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
  return res.status(200).json(spots);
}

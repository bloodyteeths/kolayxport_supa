import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res
      .status(405)
      .json({ error: `Method ${req.method} Not Allowed` });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Get unique marketplace values for the current user
    const marketplaces = await prisma.order.groupBy({
      by: ['marketplace'],
      where: {
        userId: user.id,
        status: {
          notIn: ['PENDING', 'AWAITING_PAYMENT', 'pending', 'awaiting_payment', 'pending_payment']
        }
      },
      _count: {
        _all: true
      },
      orderBy: {
        marketplace: 'asc'
      }
    });

    const marketplaceOptions = marketplaces.map(mp => ({
      value: mp.marketplace,
      label: mp.marketplace,
      count: mp._count._all
    }));

    return res.status(200).json({
      marketplaces: marketplaceOptions
    });

  } catch (error) {
    console.error('Error fetching marketplace options:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
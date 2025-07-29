import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
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

  let user, authError;
  const supabase = getSupabaseServerClient(req, res);
  const result = await supabase.auth.getUser();
  user = result.data.user;
  authError = result.error;
  
  if (authError || !user) {
    // Try Authorization header fallback
    const authHeaderRaw = req.headers['authorization'] || req.headers['Authorization'];
    let authHeader = Array.isArray(authHeaderRaw) ? authHeaderRaw[0] : authHeaderRaw;
    const token = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        console.error('[API marketplace-options] Missing Supabase environment variables for Authorization header fallback.');
      } else {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        
        const supabaseDirect = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error: userError } = await supabaseDirect.auth.getUser(token);
        user = data.user;
        authError = userError;
      }
    }
  }
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

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
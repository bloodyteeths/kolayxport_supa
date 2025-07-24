import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import prisma from '../../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res
      .status(405)
      .json({ error: `Method ${req.method} Not Allowed` });
  }

  const { orderId } = req.query;

  if (!orderId || typeof orderId !== 'string') {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  // Authentication
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
        console.error('[API delete order] Missing Supabase environment variables for Authorization header fallback.');
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
    // First, verify that the order belongs to the authenticated user
    const existingOrder = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId: user.id
      },
      include: {
        items: true,
        shipments: true
      }
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Delete related records in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete label jobs for order items
      if (existingOrder.items.length > 0) {
        await tx.labelJob.deleteMany({
          where: {
            orderItemId: {
              in: existingOrder.items.map(item => item.id)
            }
          }
        });
      }

      // Delete order items
      await tx.orderItem.deleteMany({
        where: {
          orderId: orderId
        }
      });

      // Delete shipments
      await tx.shipment.deleteMany({
        where: {
          orderId: orderId
        }
      });

      // Delete order shipping
      await tx.orderShipping.deleteMany({
        where: {
          orderId: orderId
        }
      });

      // Finally, delete the order itself
      await tx.order.delete({
        where: {
          id: orderId
        }
      });
    });

    console.log(`[DELETE ORDER] Successfully deleted order ${orderId} for user ${user.id}`);

    return res.status(200).json({ 
      success: true,
      message: 'Order deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting order:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
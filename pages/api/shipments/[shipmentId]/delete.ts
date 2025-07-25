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

  const { shipmentId } = req.query;

  if (!shipmentId || typeof shipmentId !== 'string') {
    return res.status(400).json({ error: 'Shipment ID is required' });
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
        console.error('[API delete shipment] Missing Supabase environment variables for Authorization header fallback.');
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
    // First, verify that the shipment belongs to an order owned by the authenticated user
    const existingShipment = await prisma.shipment.findFirst({
      where: {
        id: shipmentId
      },
      include: {
        order: {
          select: {
            id: true,
            userId: true,
            orderNumber: true
          }
        }
      }
    });

    if (!existingShipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    if (existingShipment.order.userId !== user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete the shipment
    await prisma.shipment.delete({
      where: {
        id: shipmentId
      }
    });

    console.log(`[DELETE SHIPMENT] Successfully deleted shipment ${shipmentId} for order ${existingShipment.order.orderNumber} (user ${user.id})`);

    return res.status(200).json({ 
      success: true,
      message: 'Shipment deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting shipment:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
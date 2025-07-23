import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getSupabaseServerClient } from '@/lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user via Supabase client
  const supabase = getSupabaseServerClient(req, res);
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { orderNumbers } = req.query;
    
    let where: any = { userId: user.id };
    
    // If specific order numbers requested, filter by them
    if (orderNumbers) {
      const orderNumberList = Array.isArray(orderNumbers) 
        ? orderNumbers 
        : orderNumbers.split(',');
      where.orderNumber = { in: orderNumberList };
    }

    const etsyAddresses = await prisma.etsyAddress.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        etsyStoreId: true,
        etsyStoreName: true,
        shippingAddress: true,
        notes: true,
        shipByDate: true,
        orderDate: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Create a lookup map by order number for easy access
    const addressLookup = etsyAddresses.reduce((acc, addr) => {
      acc[addr.orderNumber] = addr;
      return acc;
    }, {} as Record<string, any>);

    return res.status(200).json({
      success: true,
      count: etsyAddresses.length,
      addresses: etsyAddresses,
      lookup: addressLookup
    });

  } catch (error: any) {
    console.error('Error fetching Etsy addresses:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
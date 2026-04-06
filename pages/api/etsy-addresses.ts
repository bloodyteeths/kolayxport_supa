import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { getAuthUser } from '@/lib/auth';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set cache control headers
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { orderNumbers } = req.query;
    
    let where: any = { userId: user.id };
    
    // If specific order numbers requested, filter by them
    if (orderNumbers) {
      const orderNumberList = Array.isArray(orderNumbers) 
        ? orderNumbers 
        : orderNumbers.split(',');
      where.orderNumber = { in: orderNumberList };
      console.log('[etsy-addresses] Querying for order numbers:', orderNumberList);
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

    console.log('[etsy-addresses] Found', etsyAddresses.length, 'addresses for query:', where);

    // Create a lookup map by order number for easy access
    const addressLookup = etsyAddresses.reduce((acc, addr) => {
      // Parse shippingAddress if it's a JSON string
      let parsedAddr = { ...addr };
      if (typeof addr.shippingAddress === 'string') {
        try {
          parsedAddr.shippingAddress = JSON.parse(addr.shippingAddress);
        } catch (e) {
          console.warn(`Failed to parse shippingAddress for order ${addr.orderNumber}:`, e);
        }
      }
      acc[addr.orderNumber] = parsedAddr;
      return acc;
    }, {} as Record<string, any>);

    // Also parse shippingAddress in the addresses array
    const parsedAddresses = etsyAddresses.map(addr => {
      let parsedAddr = { ...addr };
      if (typeof addr.shippingAddress === 'string') {
        try {
          parsedAddr.shippingAddress = JSON.parse(addr.shippingAddress);
        } catch (e) {
          console.warn(`Failed to parse shippingAddress for order ${addr.orderNumber}:`, e);
        }
      }
      return parsedAddr;
    });

    return res.status(200).json({
      success: true,
      count: etsyAddresses.length,
      addresses: parsedAddresses,
      lookup: addressLookup,
      debug: {
        queriedOrderNumbers: orderNumbers ? (Array.isArray(orderNumbers) ? orderNumbers : orderNumbers.split(',')) : 'all',
        foundOrderNumbers: etsyAddresses.map(addr => addr.orderNumber),
        userId: user.id
      }
    });

  } catch (error: any) {
    console.error('Error fetching Etsy addresses:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
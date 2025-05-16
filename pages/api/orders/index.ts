import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getSupabaseServerClient } from '../../../lib/supabase';

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

  const supabase = getSupabaseServerClient(req, res);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * pageSize;

  // Filters
  const {
    startDate,
    endDate,
    status,
    marketplace,
    search,
    sort = 'desc',
  } = req.query;

  // Only apply createdAt filter if at least one date is provided
  let marketplaceCreatedAtFilter: any = {};
  if (startDate || endDate) {
    if (startDate) marketplaceCreatedAtFilter.gte = new Date(startDate as string);
    if (endDate) marketplaceCreatedAtFilter.lte = new Date(endDate as string);
  }

  // Build where clause
  const where: any = { userId: user.id };
  if (Object.keys(marketplaceCreatedAtFilter).length > 0) where.marketplaceCreatedAt = marketplaceCreatedAtFilter;
  if (status) where.status = status;
  if (marketplace) where.marketplace = marketplace;
  if (search) {
    where.OR = [
      { customerName: { contains: search, mode: 'insensitive' } },
      { orderNumber: { contains: search, mode: 'insensitive' } }
    ];
  }

  try {
    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        select: {
          marketplace: true,
          id: true,
          customerName: true,
          status: true,
          createdAt: true,
          orderNumber: true,
          shipByDate: true,
          items: {
            select: {
              image: true,
              variantInfo: true,
              notes: true,
              quantity: true,
              unitPrice: true,
              totalPrice: true,
              productName: true,
              sku: true,
              shipBy: true,
              orderNumber: true,
              uniqueLineKey: true,
            },
          },
          
        },
        orderBy: { updatedAt: (!sort || sort === 'desc') ? 'desc' : 'asc' },
        skip: skip,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ]);
    console.log('[DEBUG] Orders fetched from Prisma:', JSON.stringify(orders, null, 2));
    // Fallback for customerName
    const ordersWithCustomer = orders.map(o => {
      // Fallback for customer name
      let customerName = o.customerName;
      let debugLog: any = {};
      if (!customerName || customerName === 'Unknown Customer') {
        const rd = o.rawData || {};
        debugLog.rawData = rd;
        customerName =
          (rd.deliver_to?.first_name && rd.deliver_to?.last_name)
            ? `${rd.deliver_to.first_name} ${rd.deliver_to.last_name}`
            : (rd.customer?.first_name && rd.customer?.last_name)
              ? `${rd.customer.first_name} ${rd.customer.last_name}`
              : 'Unknown Customer';
        debugLog.computedCustomerName = customerName;
      }
      // Fallback for item fields
      let item = o.items?.[0] || {};
      if (customerName === 'Unknown Customer' || !item.image) {
        console.warn('[DEBUG] Order missing data:', { id: o.id, customerName, item, debugLog });
      }
      return {
        ...o,
        customerName,
        orderNumber: o.orderNumber,
        shipByDate: o.shipByDate,
        items: [
          {
            ...item,
            shipBy: item.shipBy,
            orderNumber: item.orderNumber,
            uniqueLineKey: item.uniqueLineKey,
          }
        ],
      };

    });
    return res.status(200).json({ orders: ordersWithCustomer, total, page, pageSize });
  } catch (error: any) {
    console.error('Error fetching orders:', error, error?.stack);
    return res
      .status(500)
      .json({ error: 'Failed to fetch orders', details: error.message, stack: error?.stack });
  }
} 
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  
  res.setHeader('Cache-Control', 'no-store, max-age=0');
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
        // Keep essential error logging
        console.error('[API orders/index] Missing Supabase environment variables for Authorization header fallback.');
      } else {
        // Environment variables are now guaranteed to be strings here due to the check above.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        
        const supabaseDirect = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error: userError } = await supabaseDirect.auth.getUser(token);
        user = data.user;
        authError = userError; // Assign to the outer authError
      }
    }
  }
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.limit as string) || 15;
  const search = req.query.search as string;
  const source = req.query.source as string;
  const channel = req.query.channel as string;
  const sort = req.query.sort as string || 'desc';

  // Filters
  const {
    startDate,
    endDate,
    status,
    marketplace,
    labelStatus,
    serviceType,
    packagingType,
    pickupType,
    dutiesPaymentType,
    signatureType,
    labelStockType,
  } = req.query;

  // Only apply createdAt filter if at least one date is provided
  let createdAtFilter: any = {};
  if (startDate || endDate) {
    if (startDate) createdAtFilter.gte = new Date(startDate as string);
    if (endDate) createdAtFilter.lte = new Date(endDate as string);
  }

  // Build where clause
  const where: any = { userId: user.id };
  if (Object.keys(createdAtFilter).length > 0) where.createdAt = createdAtFilter;
  if (status) where.status = status;
  if (marketplace) where.marketplace = marketplace;
  if (labelStatus) where.labelStatus = labelStatus;
  if (serviceType) where.fedexServiceType = serviceType;
  if (packagingType) where.fedexPackagingType = packagingType;
  if (pickupType) where.fedexPickupType = pickupType;
  if (dutiesPaymentType) where.fedexDutiesPaymentType = dutiesPaymentType;
  if (signatureType) where.signatureType = signatureType;
  if (labelStockType) where.labelStockType = labelStockType;

  // Add debug log for userId and query
  // console.log('[ORDERS API] Fetching orders for userId:', user.id, 'Query:', req.query);

  try {
    let whereClause = 'WHERE o."userId" = $1';
    const params: any[] = [user.id];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (
        o."orderNumber" ILIKE $${paramIndex} OR
        o."customerName" ILIKE $${paramIndex} OR
        o."marketplace" ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."status" = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (marketplace) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."marketplace" = $${paramIndex}`;
      params.push(marketplace);
      paramIndex++;
    }
    if (labelStatus) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."labelStatus" = $${paramIndex}`;
      params.push(labelStatus);
      paramIndex++;
    }
    if (serviceType) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."fedexServiceType" = $${paramIndex}`;
      params.push(serviceType);
      paramIndex++;
    }
    if (packagingType) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."fedexPackagingType" = $${paramIndex}`;
      params.push(packagingType);
      paramIndex++;
    }
    if (pickupType) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."fedexPickupType" = $${paramIndex}`;
      params.push(pickupType);
      paramIndex++;
    }
    if (dutiesPaymentType) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."fedexDutiesPaymentType" = $${paramIndex}`;
      params.push(dutiesPaymentType);
      paramIndex++;
    }
    if (signatureType) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."signatureType" = $${paramIndex}`;
      params.push(signatureType);
      paramIndex++;
    }
    if (labelStockType) {
      whereClause += (whereClause ? ' AND' : ' WHERE') + ` o."labelStockType" = $${paramIndex}`;
      params.push(labelStockType);
      paramIndex++;
    }

    if (startDate) {
      whereClause += ` AND COALESCE(o."uiOrderDate", o."createdAt") >= $${paramIndex}::timestamp`;
      params.push(startDate as string);
      paramIndex++;
    }

    if (endDate) {
      // Create end of day in UTC to properly filter orders
      const endOfDay = new Date(endDate as string + 'T23:59:59.999Z');
      whereClause += ` AND COALESCE(o."uiOrderDate", o."createdAt") <= $${paramIndex}::timestamp`;
      params.push(endOfDay.toISOString());
      paramIndex++;
    }

    // Pagination
    const offset = (page - 1) * pageSize;
    const limit = pageSize;
    // --- MAIN ORDERS QUERY ---
    /*
      This query fetches all orders for the authenticated user, joining with OrderItem and ShipperProfile tables.
      - Aggregates order items and shipper profiles as JSON arrays for each order.
      - Supports filtering by search, source, channel, status, marketplace, and date range.
      - Uses GROUP BY and JSON aggregation for efficient retrieval of related data in a single query.
      - Chosen for performance and flexibility, as Prisma's client does not natively support complex JSON aggregation and multi-table joins in a single call.
      - Returns paginated results and total count for UI display.
    */
    // OPTIMIZED: Simple query without expensive JSON aggregation
    const ordersQuery = `
      SELECT 
        o.*,
        o."shippingAddress" as "shippingAddress",
        o."rawData" as "rawData",
        o."createdAt" as "marketplaceOrderDate",
        o."trackingNumber" as "trackingNumber",
        o."labelStatus" as "labelStatus",
        o."shippingLabelUrl" as "shippingLabelUrl"
      FROM "Order" o
      ${whereClause}
      ORDER BY COALESCE(o."uiOrderDate", o."createdAt") ${sort === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Debug logs
    // console.log('SQL Query:', ordersQuery);
    // console.log('SQL Params:', params);

    const result = await prisma.$queryRawUnsafe(ordersQuery, ...params);
    
    // OPTIMIZED: Fetch items and shipments separately only for returned orders
    const orderIds = (result as any[]).map(order => order.id);
    
    // Fetch items for all orders in one query
    const itemsQuery = `
      SELECT 
        oi.*,
        lj.status as "labelJobStatus",
        lj."trackingNumber" as "labelJobTrackingNumber"
      FROM "OrderItem" oi
      LEFT JOIN "LabelJob" lj ON lj."orderItemId" = oi.id
      WHERE oi."orderId" = ANY($1)
      ORDER BY oi."orderId", oi.id
    `;
    const itemsResult = orderIds.length > 0 ? await prisma.$queryRawUnsafe(itemsQuery, orderIds) : [];
    
    // Fetch shipments for all orders in one query  
    const shipmentsQuery = `
      SELECT *
      FROM "Shipment" s
      WHERE s."orderId" = ANY($1)
      ORDER BY s."orderId", s."createdAt" DESC
    `;
    const shipmentsResult = orderIds.length > 0 ? await prisma.$queryRawUnsafe(shipmentsQuery, orderIds) : [];
    
    // Group items and shipments by orderId for easy lookup
    const itemsByOrderId = new Map();
    const shipmentsByOrderId = new Map();
    
    (itemsResult as any[]).forEach(item => {
      if (!itemsByOrderId.has(item.orderId)) {
        itemsByOrderId.set(item.orderId, []);
      }
      itemsByOrderId.get(item.orderId).push(item);
    });
    
    (shipmentsResult as any[]).forEach(shipment => {
      if (!shipmentsByOrderId.has(shipment.orderId)) {
        shipmentsByOrderId.set(shipment.orderId, []);
      }
      shipmentsByOrderId.get(shipment.orderId).push(shipment);
    });
    // OPTIMIZED: Simplified order processing with reduced complexity
    const processedOrders = (result as any[]).map((rawOrder: any) => {
      // --- Simplified Address Extraction ---
      const extractAddress = () => {
        // Trendyol orders - check for structured address
        if ((rawOrder.source === 'trendyol' || rawOrder.marketplace === 'Trendyol') && rawOrder.rawData?.to_address) {
          return rawOrder.rawData.to_address;
        }
        if ((rawOrder.source === 'trendyol' || rawOrder.marketplace === 'Trendyol') && rawOrder.rawData?.shipmentAddress) {
          const addr = rawOrder.rawData.shipmentAddress;
          return {
            name: addr.fullName || `${addr.firstName || ''} ${addr.lastName || ''}`.trim(),
            street1: addr.address1 || '',
            street2: addr.address2 || '',
            city: addr.city || '',
            state: addr.stateName || '',
            postal: addr.postalCode || '',
            country: addr.countryCode || 'TR',
            phone: addr.phone || ''
          };
        }
        // Standard shipping address handling
        if (typeof rawOrder.shippingAddress === 'string') {
          const trimmed = rawOrder.shippingAddress.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              return JSON.parse(rawOrder.shippingAddress);
            } catch (e) {
              return { fullAddress: rawOrder.shippingAddress };
            }
          }
          return { fullAddress: rawOrder.shippingAddress };
        }
        return rawOrder.shippingAddress || {};
      };

      const effectiveAddress = extractAddress();
      
      // Simplified name processing
      const fullName = effectiveAddress.name || effectiveAddress.recipientFirstName || rawOrder.customerName || '';
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || effectiveAddress.recipientFirstName || '';
      const lastName = nameParts.slice(1).join(' ') || effectiveAddress.recipientLastName || '';

      // Extract address fields with simplified logic
      const recipientStreet1 = effectiveAddress.street1 || effectiveAddress.recipientStreet1 || '';
      const recipientStreet2 = effectiveAddress.street2 || effectiveAddress.recipientStreet2 || '';
      const recipientCity = effectiveAddress.city || effectiveAddress.recipientCity || '';
      const recipientState = effectiveAddress.state || effectiveAddress.recipientState || effectiveAddress.province || '';
      const recipientPostal = effectiveAddress.postal || effectiveAddress.recipientPostal || effectiveAddress.zip || effectiveAddress.postcode || '';
      const recipientCountry = effectiveAddress.country || effectiveAddress.recipientCountry || '';
      const recipientPhone = effectiveAddress.phone || effectiveAddress.recipientPhone || '';

      // --- Simplified Line Items Mapping ---
      const itemsFromDb = itemsByOrderId.get(rawOrder.id) || [];
      const line_items_for_ui = itemsFromDb.map(item => ({
        id: item.id,
        title: item.productName || item.title || 'Unknown Product',
        value: parseFloat(String(item.unitPrice)) || 0,
        quantity: item.quantity || 1,
        weight: item.weightKg || 0.01,
        hs_code: item.harmonizedCode || '',
        country_of_origin: item.countryOfMfg || '',
        sku: item.sku || '',
        image: item.image || '',
        variantInfo: item.variantInfo || '',
        labelJobStatus: item.labelJobStatus || '',
        trackingNumber: item.trackingNumber || '',
        shipBy: item.shipBy ? new Date(item.shipBy).toISOString() : null,
        labelJobs: item.labelJobStatus ? [{
          status: item.labelJobStatus,
          trackingNumber: item.labelJobTrackingNumber,
        }] : [],
      }));

      // --- Simplified Date Processing ---
      let marketplaceOrderDate = rawOrder.uiOrderDate || rawOrder.createdAt;
      let shipByDate = null;
      if (rawOrder.rawData) {
        try {
          const rawData = typeof rawOrder.rawData === 'string' ? JSON.parse(rawOrder.rawData) : rawOrder.rawData;
          if (!marketplaceOrderDate) {
            marketplaceOrderDate = rawData.created_at || rawData.order_date || rawData.ordered_at || rawData.placed_at;
          }
          shipByDate = rawData.due_date || null;
        } catch (e) {
          console.error('Error parsing rawData for dates:', e);
        }
      }

      // --- Simplified Source Detection ---
      const marketplace = (rawOrder.marketplace || '').toLowerCase();
      const source = rawOrder.source || 
        (marketplace.includes('etsy') ? 'shippo' : 
         marketplace.includes('trendyol') ? 'trendyol' : 'veeqo');

      return {
        ...rawOrder,
        customerName: fullName || `${firstName} ${lastName}`.trim(),
        recipientFirstName: firstName,
        recipientLastName: lastName,
        recipientStreet1,
        recipientStreet2,
        recipientCity,
        recipientState,
        recipientPostal,
        recipientCountry,
        recipientPhone,
        line_items: line_items_for_ui,
        marketplaceOrderDate,
        orderTotalPrice: rawOrder.totalPrice,
        source,
        channel: '',
        marketplaceOrderId: rawOrder.marketplaceOrderId || rawOrder.orderNumber || rawOrder.id || '',
        orderNumber: rawOrder.orderNumber || rawOrder.marketplaceOrderId || rawOrder.id || '',
        trackingNumber: rawOrder.trackingNumber || null,
        labelStatus: rawOrder.labelStatus || null,
        shipByDate,
        shipments: shipmentsByOrderId.get(rawOrder.id) || [],
      };
    });

    // Filter orders for Labels page
    const context = req.query.context as string;
    // REMOVE the filter that excludes orders with missing address fields
    // Always return all processedOrders
    // if (context === 'labelsPage') {
    //   processedOrders = processedOrders.filter(order => {
    //     // Always include Shippo orders
    //     if (order.source === 'shippo') return true;
    //     // For Veeqo orders, check if they have valid shipping address
    //     if (order.source === 'veeqo') {
    //       const shippingAddress = order.shippingAddress;
    //       if (!shippingAddress) return false;
    //       // Parse shipping address if it's a string
    //       const address = typeof shippingAddress === 'string' 
    //         ? JSON.parse(shippingAddress) 
    //         : shippingAddress;
    //       // Check for required address fields
    //       return !!(
    //         address.street1 && 
    //         address.city && 
    //         address.postal && 
    //         address.country
    //       );
    //     }
    //     return false;
    //   });
    // }

    // --- Helper utils for deduplication and address filtering ---

    /**
     * UIOrder type extension for dedupe/filter helpers
     */
    type UIOrder = {
      source: string; // 'shippo' | 'veeqo'
      marketplace: string;
      marketplaceOrderId?: string;
      orderNumber?: string;
      shippingAddress?: {
        recipientStreet1?: string;
        recipientCity?: string;
        // ...other fields
      } | string;
      recipientStreet1?: string;
      recipientCity?: string;
      [key: string]: any;
    };

    const hasAddress = (o: UIOrder) => {
      // Check object-style shipping address (Veeqo/Shippo)
      const objectAddress = o.shippingAddress && typeof o.shippingAddress === 'object' 
        ? o.shippingAddress 
        : null;
      
      // Check to_address field (Trendyol/mapped orders)
      const toAddress = o.to_address || (o.rawData && typeof o.rawData === 'object' ? o.rawData.to_address : null);
      
      // Check top-level recipient fields (processed orders)
      const topLevel = {
        street1: o.recipientStreet1,
        city: o.recipientCity
      };
      
      // Check if any address format has required fields
      const hasObjectAddr = objectAddress?.recipientStreet1 && objectAddress?.recipientCity;
      const hasToAddr = toAddress?.street1 && toAddress?.city;
      const hasTopLevelAddr = topLevel.street1 && topLevel.city;
      const hasStringAddr = typeof o.shippingAddress === 'string' && o.shippingAddress.length > 10; // Basic check for string addresses
      
      return !!(hasObjectAddr || hasToAddr || hasTopLevelAddr || hasStringAddr);
    };

    const makeKey = (o: UIOrder) =>
      `${o.marketplace}-${o.marketplaceOrderId ?? o.orderNumber}`;

    const dedupeAndFilter = async (raw: UIOrder[]): Promise<UIOrder[]> => {
      const map = new Map<string, UIOrder>();
      for (const order of raw) {
        // 3-B. De-duplicate by marketplace+orderNumber
        const key = makeKey(order);
        const existing = map.get(key);
        if (!existing) {
          map.set(key, order);
          continue;
        }
        // Preference rules
        const existingHasAddr = hasAddress(existing);
        const candidateHasAddr = hasAddress(order);
        if (!existingHasAddr && candidateHasAddr) {
          map.set(key, order); // replace blank with filled
        } else if (existingHasAddr === candidateHasAddr) {
          // both have / both lack address → prefer Shippo
          if (existing.source !== 'shippo' && order.source === 'shippo') {
            map.set(key, order);
          }
        }
      }
      return Array.from(map.values());
    };

    // Restore total count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM "Order" o
      ${whereClause}
    `;
    const countResult = await prisma.$queryRawUnsafe(countQuery, ...params.slice(0, paramIndex - 1)) as any[];
    const total = parseInt(countResult[0]?.total || '0', 10);

    // OPTIMIZED: Simple filtering without async deduplication
    const cleanedOrders = processedOrders.filter(Boolean);
    
    
    return res.status(200).json({
      orders: cleanedOrders,
      total, // Use the correct total count from the count query
      page,
      pageSize
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
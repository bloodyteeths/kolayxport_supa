import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseServerClient } from '../../../lib/supabase';
import { createClient } from '@supabase/supabase-js';
import prisma from '../../../lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // DEBUG: Log every request to this endpoint
  console.log(`[API DEBUG] === NEW REQUEST TO /api/orders ===`);
  console.log(`[API DEBUG] Method: ${req.method}`);
  console.log(`[API DEBUG] Query params:`, req.query);
  console.log(`[API DEBUG] Context:`, req.query.context);
  console.log(`[API DEBUG] Date filters:`, {
    startDate: req.query.startDate,
    endDate: req.query.endDate
  });
  
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
  const pageSize = parseInt(req.query.limit as string) || 20;
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
    const ordersQuery = `
      SELECT 
        o.*,
        o."shippingAddress" as "shippingAddress",
        o."rawData" as "rawData",
        o."createdAt" as "marketplaceOrderDate",
        o."trackingNumber" as "trackingNumber",
        o."labelStatus" as "labelStatus",
        o."shippingLabelUrl" as "shippingLabelUrl",
        COALESCE(
          json_agg(DISTINCT
            jsonb_build_object(
              'id', oi.id,
              'sku', oi.sku,
              'productName', oi."productName",
              'variantInfo', oi."variantInfo",
              'quantity', oi.quantity,
              'unitPrice', oi."unitPrice",
              'totalPrice', oi."totalPrice",
              'weightKg', oi."weightKg",
              'harmonizedCode', oi."harmonizedCode",
              'countryOfMfg', oi."countryOfMfg",
              'notes', oi.notes,
              'image', oi.image,
              'marketplaceKey', oi."marketplaceKey",
              'shipBy', oi."shipBy",
              'orderNumber', oi."orderNumber",
              'uniqueLineKey', oi."uniqueLineKey",
              'productId', oi."productId",
              'remoteLineId', oi."remoteLineId",
              'labelJobStatus', lj.status,
              'trackingNumber', lj."trackingNumber"
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'::json
        ) as items,
        COALESCE(
          json_agg(DISTINCT
            jsonb_build_object(
              'id', s.id,
              'status', s.status,
              'carrier', s.carrier,
              'trackingNumber', s."trackingNumber",
              'pdfUrl', s."pdfUrl",
              'createdAt', s."createdAt"
            )
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) as shipments
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
      LEFT JOIN "LabelJob" lj ON lj."orderItemId" = oi.id
      LEFT JOIN "Shipment" s ON s."orderId" = o.id
      ${whereClause}
      GROUP BY o.id
      ORDER BY COALESCE(o."uiOrderDate", o."createdAt") ${sort === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Debug logs
    // console.log('SQL Query:', ordersQuery);
    // console.log('SQL Params:', params);

    const result = await prisma.$queryRawUnsafe(ordersQuery, ...params);
    
    // DEBUG: Always log for now
    console.log(`[API DEBUG] Raw DB query returned ${(result as any[]).length} orders`);
    console.log(`[API DEBUG] Sample raw order:`, (result as any[])[0] ? {
      id: (result as any[])[0].id,
      orderNumber: (result as any[])[0].orderNumber,
      marketplace: (result as any[])[0].marketplace,
      createdAt: (result as any[])[0].createdAt,
      uiOrderDate: (result as any[])[0].uiOrderDate
    } : 'No orders');
    
    // To re-enable order debug logs, set ORDERS_DEBUG=1 in your environment and uncomment the lines below.
    // if (process.env.ORDERS_DEBUG === '1') {
    //   console.log('[API Orders] Raw Result Rows:', result.rows.length);
    //   console.log('[API Orders] Sample Order:', result.rows[0]);
    // }
    let processedOrders = await Promise.all((result as any[]).map(async (rawOrder: any) => {
      // if (process.env.ORDERS_DEBUG === '1') {
      //   console.log('[API Orders] Processing order:', rawOrder.id);
      //   console.log('[API Orders] Order items:', rawOrder.items);
      // }
      
      // --- Address Extraction ---
      let primaryAddressSource: any = {};
      
      // For Trendyol orders, try to get structured address from rawData
      if ((rawOrder.source === 'trendyol' || rawOrder.marketplace === 'Trendyol') && rawOrder.rawData) {
        if (rawOrder.rawData.to_address) {
          // New format with to_address
          primaryAddressSource = rawOrder.rawData.to_address;
        } else if (rawOrder.rawData.shipmentAddress) {
          // Existing format with shipmentAddress from Trendyol API
          const shipmentAddr = rawOrder.rawData.shipmentAddress;
          primaryAddressSource = {
            name: shipmentAddr.fullName || `${shipmentAddr.firstName || ''} ${shipmentAddr.lastName || ''}`.trim(),
            street1: shipmentAddr.address1 || '',
            street2: shipmentAddr.address2 || '',
            city: shipmentAddr.city || '',
            state: shipmentAddr.stateName || '',
            postal: shipmentAddr.postalCode || '',
            country: shipmentAddr.countryCode || 'TR',
            phone: shipmentAddr.phone || ''
          };
        }
      } else if (rawOrder.shippingAddress) {
        try {
          if (typeof rawOrder.shippingAddress === 'string') {
            // Check if it's a JSON string (starts with { or [) or just a plain address string
            const trimmed = rawOrder.shippingAddress.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              primaryAddressSource = JSON.parse(rawOrder.shippingAddress);
            } else {
              // It's a plain address string, create a simple object
              primaryAddressSource = { fullAddress: rawOrder.shippingAddress };
            }
          } else {
            primaryAddressSource = rawOrder.shippingAddress;
          }
        } catch (e) {
          console.error(`Error parsing shippingAddress JSON for order ${rawOrder.id}`, e);
          // Fallback: treat as plain address string
          primaryAddressSource = { fullAddress: rawOrder.shippingAddress };
        }
      }
      let notesAddress: any = {};
      if (rawOrder.source === 'veeqo' && rawOrder.channel === 'etsy' && rawOrder.notes && typeof rawOrder.notes === 'string') {
        // Try to parse Shippo notes for to_address
        try {
          const notesObj = JSON.parse(rawOrder.notes);
          if (notesObj.to_address) notesAddress = notesObj.to_address;
        } catch (e) {
          // fallback: try to extract to_address with regex or other methods if needed
        }
      }
      // Merge: notesAddress overrides primaryAddressSource for Etsy/Veeqo
      const effectiveAddress = { ...primaryAddressSource, ...notesAddress };
      // Name logic
      const fullName = (effectiveAddress.name || effectiveAddress.recipientFirstName || rawOrder.customerName || '').trim();
      let recipientFirstName = '';
      let recipientLastName = '';
      if (fullName) {
        const split = fullName.split(/\s+/);
        recipientFirstName = split[0] || '';
        recipientLastName = split.slice(1).join(' ') || '';
        if (!recipientLastName && recipientFirstName && effectiveAddress.recipientLastName) {
          recipientLastName = effectiveAddress.recipientLastName;
        }
      } else {
        recipientFirstName = effectiveAddress.recipientFirstName || '';
        recipientLastName = effectiveAddress.recipientLastName || '';
      }
      // Populate recipient fields
      const finalRecipientFirstName = recipientFirstName || effectiveAddress.recipientFirstName || '';
      const finalRecipientLastName = recipientLastName || effectiveAddress.recipientLastName || '';
      const recipientStreet1 = effectiveAddress.street1 || effectiveAddress.recipientStreet1 || '';
      const recipientStreet2 = effectiveAddress.street2 || effectiveAddress.recipientStreet2 || '';
      const recipientCity    = effectiveAddress.city    || effectiveAddress.recipientCity    || '';
      const recipientState   = effectiveAddress.state   || effectiveAddress.recipientState   || effectiveAddress.province || '';
      const recipientPostal  = effectiveAddress.postal  || effectiveAddress.recipientPostal  || effectiveAddress.zip || effectiveAddress.postcode || '';
      const recipientCountry = effectiveAddress.country || effectiveAddress.recipientCountry || '';
      const recipientPhone   = effectiveAddress.phone   || effectiveAddress.recipientPhone   || '';

      // --- Line Items Mapping ---
      let itemsFromDb: any[] = [];
      try {
        itemsFromDb = Array.isArray(rawOrder.items) ? rawOrder.items : JSON.parse(rawOrder.items);
      } catch (e) { itemsFromDb = []; }
      // Fetch all label jobs for items in this order
      let labelJobsByItemId: Record<string, any[]> = {};
      if (itemsFromDb.length > 0) {
        const itemIds = itemsFromDb.map(item => item.id).filter(Boolean);
        if (itemIds.length > 0) {
          try {
            const labelJobs = await prisma.labelJob.findMany({
              where: {
                orderItemId: {
                  in: itemIds
                }
              },
              orderBy: {
                createdAt: 'desc'
              }
            });
            
            labelJobs.forEach(job => {
              if (!labelJobsByItemId[job.orderItemId]) labelJobsByItemId[job.orderItemId] = [];
              labelJobsByItemId[job.orderItemId].push({
                id: job.id,
                status: job.status,
                createdAt: job.createdAt,
                trackingNumber: job.trackingNumber,
                pdfUrl: job.pdfUrl,
                errorMessage: job.errorMessage,
                carrier: job.carrier
              });
            });
          } catch (e) {
            console.error('Error fetching label jobs for items:', e);
          }
        }
      }
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
        shipBy: item.shipBy || '',
        labelJobs: labelJobsByItemId[item.id] || [],
      }));
      // --- Order Date ---
      let marketplaceOrderDate = rawOrder.uiOrderDate || rawOrder.createdAt;
      let shipByDate = null; // Add shipByDate reconstruction
      if (!marketplaceOrderDate && rawOrder.rawData) {
        try {
          const rawData = typeof rawOrder.rawData === 'string' ? JSON.parse(rawOrder.rawData) : rawOrder.rawData;
          marketplaceOrderDate = rawData.created_at || rawData.order_date || rawData.ordered_at || rawData.placed_at;
          // Reconstruct shipByDate from Veeqo's due_date (same logic as sync)
          shipByDate = rawData.due_date || null;
        } catch (e) {
          // Keep essential error logging
          console.error('Error parsing rawData for order date:', e);
        }
      } else if (rawOrder.rawData) {
        // Still need to extract shipByDate even if we have marketplaceOrderDate
        try {
          const rawData = typeof rawOrder.rawData === 'string' ? JSON.parse(rawOrder.rawData) : rawOrder.rawData;
          shipByDate = rawData.due_date || null;
        } catch (e) {
          console.error('Error parsing rawData for shipByDate:', e);
        }
      }
      return {
        ...rawOrder,
        customerName: fullName || `${finalRecipientFirstName} ${finalRecipientLastName}`.trim(),
        recipientFirstName: finalRecipientFirstName,
        recipientLastName: finalRecipientLastName,
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
        source: rawOrder.source || (() => {
          const marketplace = (rawOrder.marketplace || '').toLowerCase();
          if (marketplace.includes('etsy')) return 'shippo';
          if (marketplace.includes('trendyol')) return 'trendyol';
          return 'veeqo';
        })(),
        channel: '',
        marketplaceOrderId: rawOrder.marketplaceOrderId || rawOrder.orderNumber || rawOrder.id || '',
        orderNumber: rawOrder.orderNumber || rawOrder.marketplaceOrderId || rawOrder.id || '',
        trackingNumber: rawOrder.trackingNumber || null,
        labelStatus: rawOrder.labelStatus || null,
        shipByDate: shipByDate, // Add reconstructed shipByDate
      };
    }));

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

    // TEMPORARILY DISABLED: Deduplication and filtering for debugging
    // const cleanedOrders = await dedupeAndFilter(processedOrders.filter(Boolean));
    const cleanedOrders = processedOrders.filter(Boolean); // Just remove null/undefined orders
    
    console.log(`[API DEBUG] Before deduplication: ${processedOrders.length} orders`);
    console.log(`[API DEBUG] After filtering nulls: ${cleanedOrders.length} orders`);
    console.log(`[API DEBUG] Sample orders:`, cleanedOrders.slice(0, 3).map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      marketplace: o.marketplace,
      source: o.source,
      marketplaceOrderDate: o.marketplaceOrderDate
    })));
    
    console.log(`[API DEBUG] === RESPONSE BEING SENT ===`);
    console.log(`[API DEBUG] Sending ${cleanedOrders.length} orders to frontend`);
    console.log(`[API DEBUG] Total: ${total}, Page: ${page}, PageSize: ${pageSize}`);
    console.log(`[API DEBUG] First 3 order numbers:`, cleanedOrders.slice(0, 3).map(o => o.orderNumber));
    
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
import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
import { getSupabaseServerClient } from '../../../lib/supabase';
import { createClient } from '@supabase/supabase-js';

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

  console.debug('🛠️ DATABASE_URL:', process.env.DATABASE_URL);

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
      const supabaseDirect = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const { data, error } = await supabaseDirect.auth.getUser(token);
      user = data.user;
      authError = error;
    }
  }
  if (authError || !user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  console.debug('🛠️ Authenticated user ID:', user.id);
  // Quick connectivity check: count rows in the Order table
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS count FROM "Order"');
  console.debug('🛠️ Total rows in "Order" table:', countRows[0].count);

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

    if (source) {
      whereClause += ` AND o."source" = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    if (channel) {
      whereClause += ` AND o."channel" = $${paramIndex}`;
      params.push(channel);
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
        o."marketplaceCreatedAt" as "marketplaceOrderDate",
        o."weightKg",
        o."harmonizedCode",
        o."countryOfMfg",
        o."termsOfSale",
        o."sendCommercialInvoiceViaEtd",
        o."fedexServiceType",
        o."fedexPackagingType",
        o."fedexPickupType",
        o."fedexDutiesPaymentType",
        o."packageLength",
        o."packageWidth",
        o."packageHeight",
        o."dimensionUnits",
        o."labelStockType",
        o."signatureType",
        COALESCE(
          json_agg(
            json_build_object(
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
              'remoteLineId', oi."remoteLineId"
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) as items,
        COALESCE(
          json_agg(
            json_build_object(
              'id', sp.id,
              'shipperName', sp."shipperName",
              'shipperPersonName', sp."shipperPersonName",
              'shipperPhoneNumber', sp."shipperPhoneNumber",
              'shipperStreet1', sp."shipperStreet1",
              'shipperStreet2', sp."shipperStreet2",
              'shipperCity', sp."shipperCity",
              'shipperStateCode', sp."shipperStateCode",
              'shipperPostalCode', sp."shipperPostalCode",
              'shipperCountryCode', sp."shipperCountryCode",
              'shipperTinNumber', sp."shipperTinNumber",
              'shipperTinType', sp."shipperTinType",
              'importerOfRecord', sp."importerOfRecord",
              'fedexFolderId', sp."fedexFolderId",
              'defaultCurrencyCode', sp."defaultCurrencyCode",
              'dutiesPaymentType', sp."dutiesPaymentType",
              'defaultShippingChargesPaymentType', sp."defaultShippingChargesPaymentType",
              'createdAt', sp."createdAt",
              'updatedAt', sp."updatedAt",
              'defaultCountryOfMfg', sp."defaultCountryOfMfg",
              'defaultHarmonizedCode', sp."defaultHarmonizedCode",
              'defaultPackagingType', sp."defaultPackagingType",
              'defaultServiceType', sp."defaultServiceType",
              'defaultWeightKg', sp."defaultWeightKg"
            )
          ) FILTER (WHERE sp.id IS NOT NULL),
          '[]'
        ) as profiles,
        COUNT(*) OVER() as total_count
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      LEFT JOIN "ShipperProfile" sp ON sp."userId" = o."userId"
      ${whereClause}
      GROUP BY o.id
      ORDER BY o."marketplaceCreatedAt" ${sort === 'desc' ? 'DESC' : 'ASC'}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);
    const { rows: orders } = await pool.query(ordersQuery, params);
    // Query total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM "Order" o
      ${whereClause}
    `;
    const { rows: countRows2 } = await pool.query(countQuery, params.slice(0, paramIndex - 1));
    const total = parseInt(countRows2[0]?.total || '0', 10);
    // Debug log for raw order
    orders.forEach((rawOrder: any) => {
      console.debug('rawOrder:', JSON.stringify(rawOrder, null, 2));
      console.debug('Order ID:', rawOrder.id, 'marketplaceCreatedAt:', rawOrder.marketplaceCreatedAt, 'createdAt:', rawOrder.createdAt);
    });
    let processedOrders = orders.map((rawOrder: any) => {
      // --- Address Extraction ---
      let primaryAddressSource: any = {};
      if (rawOrder.shippingAddress) {
        try {
          primaryAddressSource = typeof rawOrder.shippingAddress === 'string'
            ? JSON.parse(rawOrder.shippingAddress)
            : rawOrder.shippingAddress;
        } catch (e) {
          console.error(`Error parsing shippingAddress JSON for order ${rawOrder.id}`, e);
          primaryAddressSource = {};
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
      const recipientPostal  = effectiveAddress.zip     || effectiveAddress.recipientPostal  || effectiveAddress.postcode || '';
      const recipientCountry = effectiveAddress.country || effectiveAddress.recipientCountry || '';
      const recipientPhone   = effectiveAddress.phone   || effectiveAddress.recipientPhone   || '';
      // --- Line Items Mapping ---
      let itemsFromDb: any[] = [];
      try {
        itemsFromDb = Array.isArray(rawOrder.items) ? rawOrder.items : JSON.parse(rawOrder.items);
      } catch (e) { itemsFromDb = []; }
      const line_items_for_ui = itemsFromDb.map(item => ({
        id: item.id,
        title: item.productName || item.title || 'Unknown Product',
        value: parseFloat(String(item.totalPrice)) || (parseFloat(String(item.unitPrice)) * (item.quantity || 1)) || 0,
        quantity: item.quantity || 1,
        weight: item.weightKg || 0.01,
        hs_code: item.harmonizedCode || '',
        country_of_origin: item.countryOfMfg || '',
        sku: item.sku || '',
        image: item.image || '',
        variantInfo: item.variantInfo || '',
      }));
      // --- Order Date ---
      let marketplaceOrderDate = rawOrder.marketplaceOrderDate || rawOrder.marketplaceCreatedAt;
      if (!marketplaceOrderDate && rawOrder.rawData) {
        try {
          const rawData = typeof rawOrder.rawData === 'string' ? JSON.parse(rawOrder.rawData) : rawOrder.rawData;
          marketplaceOrderDate = rawData.created_at || rawData.order_date || rawData.ordered_at || rawData.placed_at;
        } catch (e) {
          console.error('Error parsing rawData for order date:', e);
        }
      }
      // --- Debug logs ---
      console.debug('Order ID:', rawOrder.id, 'Effective Address:', effectiveAddress);
      console.debug('Order ID:', rawOrder.id, 'Final recipient fields:', {
        finalRecipientFirstName, finalRecipientLastName, recipientStreet1, recipientStreet2, recipientCity, recipientState, recipientPostal, recipientCountry, recipientPhone
      });
      console.debug('Order ID:', rawOrder.id, 'Line items for UI:', line_items_for_ui);
      console.debug('Order ID:', rawOrder.id, 'marketplaceOrderDate:', marketplaceOrderDate);
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
      };
    });

    // Filter orders for Labels page
    const context = req.query.context as string;
    if (context === 'labelsPage') {
      processedOrders = processedOrders.filter(order => {
        // Always include Shippo orders
        if (order.source === 'shippo') return true;
        
        // For Veeqo orders, check if they have valid shipping address
        if (order.source === 'veeqo') {
          const shippingAddress = order.shippingAddress;
          if (!shippingAddress) return false;
          
          // Parse shipping address if it's a string
          const address = typeof shippingAddress === 'string' 
            ? JSON.parse(shippingAddress) 
            : shippingAddress;
            
          // Check for required address fields
          return !!(
            address.street1 && 
            address.city && 
            address.postal && 
            address.country
          );
        }
        
        return false;
      });
    }

    return res.status(200).json({
      orders: processedOrders,
      total,
      page,
      pageSize
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
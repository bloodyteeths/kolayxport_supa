import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '../../../lib/prisma';
import { safeIsoDate, safeDate } from '../../../lib/utils/safeDate';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  
  // Optimized caching for senkron page with cache busting for updates
  if (req.query.context === 'senkronPage') {
    // Check if this is likely a post-update refetch (has _ts parameter or recent activity)
    const hasTimestamp = req.query._ts || req.query.bust;
    if (hasTimestamp) {
      res.setHeader('Cache-Control', 'no-store, max-age=0'); // No cache for updates
    } else {
      res.setHeader('Cache-Control', 'private, max-age=15'); // Reduced to 15 seconds
    }
  } else {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res
      .status(405)
      .json({ error: `Method ${req.method} Not Allowed` });
  }

  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.limit as string) || 15;
  const search = req.query.search as string;
  const searchType = req.query.searchType as string || 'all';
  const source = req.query.source as string;
  const channel = req.query.channel as string;
  const sortRaw = req.query.sort as string || 'desc';
  const sort = sortRaw.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Filters
  const {
    startDate,
    endDate,
    status,
    marketplace,
    labelStatus,
    labelFilter,
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
    const gte = safeDate(startDate);
    const lte = safeDate(endDate);
    if (gte) createdAtFilter.gte = gte;
    if (lte) createdAtFilter.lte = lte;
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
    let whereClause = 'WHERE o."userId" = $1 AND o."status" NOT IN (\'PENDING\', \'AWAITING_PAYMENT\', \'pending\', \'awaiting_payment\', \'pending_payment\')';
    const params: any[] = [user.id];
    let paramIndex = 2;

    if (search) {
      const searchPattern = `%${search}%`;
      
      switch (searchType) {
        case 'customer':
          whereClause += ` AND (
            o."customerName" ILIKE $${paramIndex} OR
            o."shippingAddress"::text ILIKE $${paramIndex}
          )`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'order':
          whereClause += ` AND o."orderNumber" ILIKE $${paramIndex}`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'tracking':
          whereClause += ` AND (
            o."trackingNumber" ILIKE $${paramIndex} OR
            o."rawData"::text ILIKE $${paramIndex}
          )`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'marketplace':
          whereClause += ` AND o."marketplace" ILIKE $${paramIndex}`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'product':
          whereClause += ` AND EXISTS (
            SELECT 1 FROM "OrderItem" oi 
            WHERE oi."orderId" = o.id 
            AND oi."productName" ILIKE $${paramIndex}
          )`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'sku':
          whereClause += ` AND EXISTS (
            SELECT 1 FROM "OrderItem" oi 
            WHERE oi."orderId" = o.id 
            AND oi."sku" ILIKE $${paramIndex}
          )`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'city':
          whereClause += ` AND o."shippingAddress"::text ILIKE $${paramIndex}`;
          params.push(`%"city"%${search}%`);
          paramIndex++;
          break;
          
        case 'phone':
          whereClause += ` AND o."shippingAddress"::text ILIKE $${paramIndex}`;
          params.push(`%"phone"%${search}%`);
          paramIndex++;
          break;
          
        case 'note':
          whereClause += ` AND (
            o."rawData"::text ILIKE $${paramIndex} OR
            EXISTS (
              SELECT 1 FROM "OrderItem" oi 
              WHERE oi."orderId" = o.id 
              AND oi."notes" ILIKE $${paramIndex}
            )
          )`;
          params.push(searchPattern);
          paramIndex++;
          break;
          
        case 'all':
        default:
          // Search across all main fields
          whereClause += ` AND (
            o."orderNumber" ILIKE $${paramIndex} OR
            o."customerName" ILIKE $${paramIndex} OR
            o."marketplace" ILIKE $${paramIndex} OR
            o."trackingNumber" ILIKE $${paramIndex} OR
            o."rawData"::text ILIKE $${paramIndex} OR
            o."shippingAddress"::text ILIKE $${paramIndex} OR
            EXISTS (
              SELECT 1 FROM "OrderItem" oi 
              WHERE oi."orderId" = o.id 
              AND (oi."productName" ILIKE $${paramIndex} OR oi."sku" ILIKE $${paramIndex})
            )
          )`;
          params.push(searchPattern);
          paramIndex++;
          break;
      }
    }

    if (status) {
      // Handle multiple status filtering (comma-separated)
      const statusValues = (status as string).split(',').filter(s => s.trim());
      
      if (statusValues.length > 0) {
        // For senkron page, we need to filter by customStatus in SenkronOrderData
        if (req.query.context === 'senkronPage') {
          const placeholders = statusValues.map((_, index) => `$${paramIndex + index}`).join(', ');
          whereClause += ` AND sod."customStatus" IN (${placeholders})`;
          statusValues.forEach(statusValue => {
            params.push(statusValue.trim());
            paramIndex++;
          });
        } else {
          // Handle unified status filters for other pages
          const statusMappings: Record<string, string[]> = {
            'onaylandi': ['PAID', 'CREATED', 'Created', 'awaiting_fulfillment', 'AWAITING_FULFILLMENT', 'UNSHIPPED', 'awaiting_payment'],
            'kargolandi': ['SHIPPED', 'shipped', 'Shipped', 'PARTIALLY_SHIPPED'],
            'iptal': ['CANCELLED', 'cancelled', 'Cancelled', 'REFUNDED', 'refunded', 'returned'],
            'Delivered': ['DELIVERED', 'delivered', 'Delivered', 'COMPLETED']
          };

          // Collect all mapped statuses
          const allMappedStatuses: string[] = [];
          statusValues.forEach(statusValue => {
            if (statusMappings[statusValue as keyof typeof statusMappings]) {
              allMappedStatuses.push(...statusMappings[statusValue as keyof typeof statusMappings]);
            } else {
              allMappedStatuses.push(statusValue);
            }
          });

          if (allMappedStatuses.length > 0) {
            const placeholders = allMappedStatuses.map((_, index) => `$${paramIndex + index}`).join(', ');
            whereClause += ` AND o."status" IN (${placeholders})`;
            allMappedStatuses.forEach(mappedStatus => {
              params.push(mappedStatus);
              paramIndex++;
            });
          }
        }
      }
    }
    if (marketplace) {
      // Handle multiple marketplace filtering
      const marketplaceValues = Array.isArray(marketplace) ? marketplace : [marketplace];
      const placeholders = marketplaceValues.map((_, index) => `$${paramIndex + index}`).join(', ');
      whereClause += ` AND o."marketplace" IN (${placeholders})`;
      marketplaceValues.forEach(value => {
        params.push(value);
        paramIndex++;
      });
    }
    if (labelStatus) {
      // Handle label status filter with complex logic
      if (labelStatus === 'created') {
        // Has label: trackingNumber OR shippingLabelUrl OR labelStatus='created' OR has shipment
        whereClause += ` AND (
          o."trackingNumber" IS NOT NULL OR 
          o."shippingLabelUrl" IS NOT NULL OR 
          o."labelStatus" = 'created' OR
          EXISTS (
            SELECT 1 FROM "Shipment" s 
            WHERE s."orderId" = o.id 
            AND s.status = 'created' 
            AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL)
          )
        )`;
      } else if (labelStatus === 'not_created') {
        // No label: no trackingNumber AND no shippingLabelUrl AND labelStatus != 'created' AND no shipment
        whereClause += ` AND (
          (o."trackingNumber" IS NULL OR o."trackingNumber" = '') AND
          (o."shippingLabelUrl" IS NULL OR o."shippingLabelUrl" = '') AND
          (o."labelStatus" IS NULL OR o."labelStatus" != 'created') AND
          NOT EXISTS (
            SELECT 1 FROM "Shipment" s 
            WHERE s."orderId" = o.id 
            AND s.status = 'created' 
            AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL)
          )
        )`;
      } else if (labelStatus === 'failed') {
        whereClause += ` AND o."labelStatus" = 'failed'`;
      }
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

    if (labelFilter && labelFilter !== 'all') {
      if (labelFilter === 'labeled') {
        // Has label: trackingNumber OR shippingLabelUrl OR labelStatus='created' OR has shipment
        whereClause += ` AND (
          o."trackingNumber" IS NOT NULL OR 
          o."shippingLabelUrl" IS NOT NULL OR 
          o."labelStatus" = 'created' OR
          EXISTS (
            SELECT 1 FROM "Shipment" s 
            WHERE s."orderId" = o.id 
            AND s.status = 'created' 
            AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL)
          )
        )`;
      } else if (labelFilter === 'unlabeled') {
        // No label: opposite of above
        whereClause += ` AND (
          (o."trackingNumber" IS NULL OR o."trackingNumber" = '') AND
          (o."shippingLabelUrl" IS NULL OR o."shippingLabelUrl" = '') AND
          (o."labelStatus" IS NULL OR o."labelStatus" != 'created') AND
          NOT EXISTS (
            SELECT 1 FROM "Shipment" s 
            WHERE s."orderId" = o.id 
            AND s.status = 'created' 
            AND (s."trackingNumber" IS NOT NULL OR s."pdfUrl" IS NOT NULL)
          )
        )`;
      }
    }

    if (startDate) {
      whereClause += ` AND COALESCE(o."uiOrderDate", o."createdAt") >= $${paramIndex}::timestamp`;
      params.push(startDate as string);
      paramIndex++;
    }

    if (endDate) {
      // Create end of day in UTC to properly filter orders.
      // Guard against malformed endDate query values that would otherwise
      // throw RangeError on .toISOString() and 500 the whole endpoint.
      const endOfDayIso = safeIsoDate((endDate as string) + 'T23:59:59.999Z');
      if (endOfDayIso) {
        whereClause += ` AND COALESCE(o."uiOrderDate", o."createdAt") <= $${paramIndex}::timestamp`;
        params.push(endOfDayIso);
        paramIndex++;
      }
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
        COALESCE(o."uiOrderDate", o."createdAt") as "marketplaceOrderDate",
        o."trackingNumber" as "trackingNumber",
        o."labelStatus" as "labelStatus",
        o."shippingLabelUrl" as "shippingLabelUrl",
        sod."internalNote" as "senkronInternalNote",
        sod."customStatus" as "senkronCustomStatus"
      FROM "Order" o
      LEFT JOIN "SenkronOrderData" sod ON sod."orderId" = o.id
      ${whereClause}
      ORDER BY COALESCE(o."uiOrderDate", o."createdAt") ${sort}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Debug logs
    // console.log('SQL Query:', ordersQuery);
    // console.log('SQL Params:', params);

    const result = await prisma.$queryRawUnsafe(ordersQuery, ...params);
    
    // OPTIMIZED: Fetch items and shipments separately only for returned orders
    const orderIds = (result as any[]).map(order => order.id);
    const context = req.query.context as string;
    
    // For senkron page, we only need basic items data (skip complex joins for performance)
    let itemsResult, shipmentsResult, trackingSubmissionsResult;
    
    if (context === 'senkronPage') {
      // Simplified queries for senkron page - skip heavy joins
      const itemsQuery = `
        SELECT oi.*, null as "labelJobStatus", null as "labelJobTrackingNumber", null as "labelJobCarrier", null as "labelJobPdfUrl"
        FROM "OrderItem" oi
        WHERE oi."orderId" = ANY($1)
        ORDER BY oi."orderId", oi.id
      `;
      itemsResult = orderIds.length > 0 ? await prisma.$queryRawUnsafe(itemsQuery, orderIds) : [];
      
      // Skip shipments and tracking for senkron page (not displayed)
      shipmentsResult = [];
      trackingSubmissionsResult = [];
    } else {
      // Full queries for labels page and other contexts
      const itemsQuery = `
        SELECT 
          oi.*,
          lj.status as "labelJobStatus",
          lj."trackingNumber" as "labelJobTrackingNumber",
          lj.carrier as "labelJobCarrier",
          lj."pdfUrl" as "labelJobPdfUrl"
        FROM "OrderItem" oi
        LEFT JOIN "LabelJob" lj ON lj."orderItemId" = oi.id
        WHERE oi."orderId" = ANY($1)
        ORDER BY oi."orderId", oi.id
      `;
      itemsResult = orderIds.length > 0 ? await prisma.$queryRawUnsafe(itemsQuery, orderIds) : [];
      
      const shipmentsQuery = `
        SELECT *
        FROM "Shipment" s
        WHERE s."orderId" = ANY($1)
        ORDER BY s."orderId", s."createdAt" DESC
      `;
      shipmentsResult = orderIds.length > 0 ? await prisma.$queryRawUnsafe(shipmentsQuery, orderIds) : [];
      
      const trackingSubmissionsQuery = `
        SELECT *
        FROM "TrackingSubmission" ts
        WHERE ts."orderId" = ANY($1)
        ORDER BY ts."orderId", ts."submittedAt" DESC
      `;
      trackingSubmissionsResult = orderIds.length > 0 ? await prisma.$queryRawUnsafe(trackingSubmissionsQuery, orderIds) : [];
    }
    
    // Group items, shipments, and tracking submissions by orderId for easy lookup
    const itemsByOrderId = new Map();
    const shipmentsByOrderId = new Map();
    const trackingSubmissionsByOrderId = new Map();
    
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
    
    (trackingSubmissionsResult as any[]).forEach(submission => {
      if (!trackingSubmissionsByOrderId.has(submission.orderId)) {
        trackingSubmissionsByOrderId.set(submission.orderId, []);
      }
      trackingSubmissionsByOrderId.get(submission.orderId).push(submission);
    });
    // --- Lazy-enrich OrderItems with EtsyListing data ---
    // Run for ALL orders — marketplace from Veeqo is the shop name, not "etsy"
    // Title matching against EtsyListing naturally only matches Etsy products
    const allItems = itemsResult as any[];

    if (allItems.length > 0) {
        try {
          // Fetch ALL EtsyListings — active first, then by highest ID (newest)
          const etsyListings = await prisma.$queryRawUnsafe(`
            SELECT "etsyListingId", title, url, state, "thumbnailUrl570xN", "thumbnailUrl170x135"
            FROM "EtsyListing"
            ORDER BY (CASE WHEN state = 'active' THEN 0 ELSE 1 END), "etsyListingId" DESC
          `) as any[];

          const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

          type ListingEntry = { imageUrl: string; url: string; etsyListingId: string; isActive: boolean };

          // Build TWO lookups — group ALL matches per normalized title
          const allListingsByTitle = new Map<string, ListingEntry[]>();
          for (const l of etsyListings) {
            const norm = normalize(l.title);
            if (!allListingsByTitle.has(norm)) allListingsByTitle.set(norm, []);
            allListingsByTitle.get(norm)!.push({
              imageUrl: l.thumbnailUrl570xN || l.thumbnailUrl170x135 || '',
              url: l.url || `https://www.etsy.com/listing/${l.etsyListingId}`,
              etsyListingId: String(l.etsyListingId),
              isActive: l.state === 'active',
            });
          }

          // Pick best from candidates: active wins, then highest listing ID
          const pickBest = (candidates: ListingEntry[]): ListingEntry | undefined => {
            if (!candidates || candidates.length === 0) return undefined;
            const active = candidates.filter(c => c.isActive);
            const pool = active.length > 0 ? active : candidates;
            return pool.reduce((best, c) =>
              BigInt(c.etsyListingId) > BigInt(best.etsyListingId) ? c : best
            );
          };

          const findCandidates = (itemTitle: string): ListingEntry[] => {
            // 1. Exact match
            const exact = allListingsByTitle.get(itemTitle);
            if (exact && exact.length > 0) return exact;

            // 2. Prefix match (first 30 chars)
            const prefix = itemTitle.slice(0, 30);
            for (const [key, entries] of allListingsByTitle) {
              if (key.startsWith(prefix) || itemTitle.startsWith(key.slice(0, 30))) {
                return entries;
              }
            }

            // 3. Word overlap (≥50% — more lenient for renewed listings)
            const itemWords = new Set(itemTitle.split(/\s+/).filter(w => w.length > 2));
            let bestOverlap = 0;
            let bestEntries: ListingEntry[] = [];
            for (const [key, entries] of allListingsByTitle) {
              const listingWords = new Set(key.split(/\s+/).filter(w => w.length > 2));
              const overlap = [...itemWords].filter(w => listingWords.has(w)).length;
              const ratio = overlap / Math.max(itemWords.size, 1);
              if (ratio >= 0.5 && overlap > bestOverlap) {
                bestOverlap = overlap;
                bestEntries = entries;
              }
            }
            return bestEntries;
          };

          // Build orderId→marketplace lookup to skip non-Etsy orders
          const orderMarketplaceMap = new Map<string, string>();
          for (const rawOrder of (result as any[])) {
            orderMarketplaceMap.set(rawOrder.id, (rawOrder.marketplace || '').toLowerCase());
          }

          // Match items and enrich — only for Etsy-sourced orders
          const imageUpdates: { id: string; image: string }[] = [];
          for (const item of allItems) {
            const orderMp = orderMarketplaceMap.get(item.orderId) || '';
            if (orderMp.includes('ebay') || orderMp.includes('trendyol') || orderMp.includes('amazon') || orderMp === 'wix') continue;

            const itemTitle = normalize(item.productName || '');
            if (!itemTitle) continue;

            const candidates = findCandidates(itemTitle);
            const best = pickBest(candidates);

            if (best) {
              // Only use URL from active listings (expired URLs are broken)
              if (best.isActive) {
                item.etsyListingUrl = best.url;
              }
              // Only fill empty images — listing_id-based images from sync are more accurate
              if (best.imageUrl && !item.image) {
                item.image = best.imageUrl;
                imageUpdates.push({ id: item.id, image: best.imageUrl });
              }
            }
          }

          // Persist image updates back to DB (fire-and-forget)
          if (imageUpdates.length > 0) {
            Promise.all(
              imageUpdates.map(u =>
                prisma.orderItem.update({
                  where: { id: u.id },
                  data: { image: u.image },
                })
              )
            ).catch(() => {});
          }
        } catch (err) {
          console.warn('[orders] Etsy enrichment failed:', err);
        }
    }

    // --- Wix listing URL enrichment: build slug map from WixProduct + WixSite ---
    let wixSlugMap: Record<string, string> = {}; // wixProductId → full URL
    const hasWixOrders = (result as any[]).some(o => o.marketplace === 'Wix');
    if (hasWixOrders) {
      try {
        const wixSite = await prisma.wixSite.findFirst({ where: { userId: user.id, isActive: true } });
        if (wixSite?.siteUrl) {
          const baseUrl = wixSite.siteUrl.replace(/\/$/, '');
          const slugs = await prisma.wixProduct.findMany({
            where: { userId: user.id, wixSiteId: wixSite.id },
            select: { wixProductId: true, slug: true },
          });
          for (const p of slugs) {
            if (p.slug) wixSlugMap[p.wixProductId] = `${baseUrl}/product-page/${p.slug}`;
          }
        }
      } catch { /* non-critical */ }
    }

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
        // Wix orders - extract structured address from rawData
        if (rawOrder.source === 'wix' || rawOrder.marketplace === 'Wix') {
          if (rawOrder.rawData?.to_address) {
            return rawOrder.rawData.to_address;
          }
          // Fallback: extract from nested Wix API structure in rawData
          const shippingDest = rawOrder.rawData?.shippingInfo?.logistics?.shippingDestination;
          if (shippingDest?.address) {
            const wAddr = shippingDest.address;
            const wContact = shippingDest.contactDetails || rawOrder.rawData?.billingInfo?.contactDetails || {};
            return {
              name: `${wContact.firstName || ''} ${wContact.lastName || ''}`.trim(),
              phone: wContact.phone || '',
              street1: wAddr.addressLine || wAddr.addressLine1 || '',
              street2: wAddr.addressLine2 || '',
              city: wAddr.city || '',
              state: wAddr.subdivisionFullname || wAddr.subdivision || '',
              postal: wAddr.postalCode || '',
              country: wAddr.country || '',
              email: rawOrder.rawData?.buyerInfo?.email || '',
            };
          }
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
      // Build Wix catalogItemId → URL for this order's line items
      const isWixOrder = rawOrder.marketplace === 'Wix';
      const parsedRawData = typeof rawOrder.rawData === 'string' ? (() => { try { return JSON.parse(rawOrder.rawData); } catch { return {}; } })() : (rawOrder.rawData || {});
      const wixRawLineItems = isWixOrder ? (parsedRawData.lineItems || []) : [];
      const line_items_for_ui = itemsFromDb.map((item, idx) => {
        // Match Wix product URL from catalogReference
        let wixListingUrl = '';
        if (isWixOrder) {
          const catId = wixRawLineItems[idx]?.catalogReference?.catalogItemId;
          wixListingUrl = catId ? (wixSlugMap[catId] || '') : '';
        }
        return {
        id: item.id,
        title: item.productName || item.title || 'Unknown Product',
        value: parseFloat(String(item.unitPrice)) || 0,
        quantity: item.quantity || 1,
        weight: item.weightKg || 0.01,
        hs_code: item.harmonizedCode || '',
        country_of_origin: item.countryOfMfg || '',
        sku: item.sku || '',
        image: item.image || '',
        etsyListingUrl: item.etsyListingUrl || wixListingUrl,
        variantInfo: item.variantInfo || '',
        labelJobStatus: item.labelJobStatus || '',
        trackingNumber: item.trackingNumber || '',
        shipBy: safeIsoDate(item.shipBy),
        labelJobs: item.labelJobStatus ? [{
          status: item.labelJobStatus,
          trackingNumber: item.labelJobTrackingNumber,
          carrier: item.labelJobCarrier,
          pdfUrl: item.labelJobPdfUrl,
        }] : [],
      };
      });

      // --- Enhanced Date Processing ---
      let marketplaceOrderDate = rawOrder.uiOrderDate;
      let shipByDate = null;
      
      // Always try to extract the actual order date from rawData first
      if (rawOrder.rawData) {
        try {
          const rawData = typeof rawOrder.rawData === 'string' ? JSON.parse(rawOrder.rawData) : rawOrder.rawData;
          
          // Extract actual marketplace order date from various possible fields
          const possibleOrderDate = rawData.created_at || rawData.order_date || rawData.ordered_at || 
                                   rawData.placed_at || rawData.order_placed_at || rawData.date_created ||
                                   rawData.order_datetime || rawData.created_date;
          
          if (possibleOrderDate && !marketplaceOrderDate) {
            marketplaceOrderDate = possibleOrderDate;
          }
          
          shipByDate = rawData.due_date || rawData.ship_by_date || null;
        } catch (e) {
          console.error('Error parsing rawData for dates:', e);
        }
      }
      
      // Fall back to createdAt only if no other date is found
      if (!marketplaceOrderDate) {
        marketplaceOrderDate = rawOrder.createdAt;
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
        images: line_items_for_ui.map((i: any) => i.image).filter(Boolean),
        marketplaceOrderDate,
        orderTotalPrice: rawOrder.totalPrice,
        source,
        channel: '',
        trackingSubmissions: trackingSubmissionsByOrderId.get(rawOrder.id) || [],
        marketplaceOrderId: rawOrder.marketplaceOrderId || rawOrder.orderNumber || rawOrder.id || '',
        orderNumber: rawOrder.orderNumber || rawOrder.marketplaceOrderId || rawOrder.id || '',
        trackingNumber: rawOrder.trackingNumber || null,
        labelStatus: rawOrder.labelStatus || null,
        shipByDate,
        shipments: shipmentsByOrderId.get(rawOrder.id) || [],
        senkronData: {
          internalNote: rawOrder.senkronInternalNote || null,
          customStatus: rawOrder.senkronCustomStatus || null,
        },
      };
    });

    // Filter orders for Labels page
    // context already declared above
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
      `${(o.marketplace || '').toLowerCase()}-${o.marketplaceOrderId ?? o.orderNumber}`;

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
        // Preference rules: prefer order with real item prices and address
        const existingHasAddr = hasAddress(existing);
        const candidateHasAddr = hasAddress(order);
        const existingHasItemPrices = existing.line_items?.some((i: any) => i.value > 0 || i.unitPrice > 0);
        const candidateHasItemPrices = order.line_items?.some((i: any) => i.value > 0 || i.unitPrice > 0);

        // Prefer the one with real item prices
        if (!existingHasItemPrices && candidateHasItemPrices) {
          map.set(key, order);
        } else if (existingHasItemPrices && !candidateHasItemPrices) {
          // keep existing — it has prices
        } else if (!existingHasAddr && candidateHasAddr) {
          map.set(key, order);
        }
      }
      return Array.from(map.values());
    };

    // Restore total count query
    const countQuery = `
      SELECT COUNT(*) as total
      FROM "Order" o
      LEFT JOIN "SenkronOrderData" sod ON sod."orderId" = o.id
      ${whereClause}
    `;
    // Invariant: paramIndex starts at 2 ($1 = userId) and is incremented in
    // lockstep with every filter `params.push(...)`, so it always equals
    // `params.length + 1` BEFORE LIMIT/OFFSET are appended on line ~376.
    // After that push, `params.slice(0, paramIndex - 1)` yields exactly the
    // filter params (userId + all WHERE-clause bindings), excluding LIMIT/OFFSET.
    const countResult = await prisma.$queryRawUnsafe(countQuery, ...params.slice(0, paramIndex - 1)) as any[];
    const total = parseInt(countResult[0]?.total || '0', 10);

    const cleanedOrders = await dedupeAndFilter(processedOrders.filter(Boolean) as UIOrder[]);
    
    
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
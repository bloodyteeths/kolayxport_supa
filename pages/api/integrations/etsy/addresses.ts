import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';
import { applyExtensionCors } from '@/lib/security/internalApiKey';

// Etsy's API no longer returns buyer shipping addresses, so the Chrome extension
// scrapes them off Shop Manager. Map the scraped shape → the Order.shippingAddress
// shape and normalise country display names to ISO-2 for carrier/label APIs.
const COUNTRY_TO_ISO: Record<string, string> = {
  'united states': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  canada: 'CA', australia: 'AU', 'new zealand': 'NZ', germany: 'DE', deutschland: 'DE',
  france: 'FR', italy: 'IT', italia: 'IT', spain: 'ES', 'españa': 'ES', espana: 'ES',
  netherlands: 'NL', holland: 'NL', belgium: 'BE', switzerland: 'CH', austria: 'AT',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', iceland: 'IS', ireland: 'IE',
  portugal: 'PT', poland: 'PL', czechia: 'CZ', 'czech republic': 'CZ', croatia: 'HR', greece: 'GR',
  hungary: 'HU', romania: 'RO', slovakia: 'SK', slovenia: 'SI', japan: 'JP', china: 'CN',
  'south korea': 'KR', korea: 'KR', singapore: 'SG', 'hong kong': 'HK', mexico: 'MX',
  brazil: 'BR', brasil: 'BR', israel: 'IL', turkey: 'TR', 'türkiye': 'TR', turkiye: 'TR',
  india: 'IN', 'south africa': 'ZA', 'puerto rico': 'PR',
};

function toIso(country: string): string {
  if (!country) return '';
  if (country.length === 2) return country.toUpperCase();
  let key = country.trim().toLowerCase();
  if (key.startsWith('the ')) key = key.slice(4);
  return COUNTRY_TO_ISO[key] || country;
}

function parseAddr(val: unknown): any {
  if (!val) return {};
  if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
  return val as any;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // CORS: only kolayxport.com and the configured official extension origin are
  // reflected (fail closed when no extension id is configured). The extension's
  // background service worker uses host_permissions and is not subject to CORS.
  applyExtensionCors(req, res, 'POST, OPTIONS');

  // Handle preflight request - don't check auth for OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: NextAuth cookie session or Bearer token issued by /api/auth/extension.
  // There is deliberately NO fallback based on a (public) Etsy shop name.
  const user = await getAuthUser(req, res);

  if (!user) {
    logger.warn('Unauthorized Etsy address sync attempt', {
      hasAuthorization: !!req.headers.authorization,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const userId = user.id;

  try {
    const { orders, source, timestamp } = req.body;

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Invalid request: orders array required' });
    }

    if (!source || !source.includes('chrome-extension')) {
      return res.status(400).json({ error: 'Invalid source' });
    }

    logger.info(`[Etsy Chrome Extension] Received ${orders.length} address updates from user ${userId}`, {
      userId,
      orderCount: orders.length,
      timestamp
    });

    const results = {
      success: true,
      processed: 0,
      updated: 0,
      ordersFilled: 0,
      notFound: 0,
      errors: [] as any[]
    };

    // Process each address to store in Etsy addresses table
    for (const addressData of orders) {
      try {
        const { orderNumber, etsyStoreId, etsyStoreName, shippingAddress, notes, shipByDate, orderDate } = addressData;

        // Must be a plain string/number: an object here would be interpreted by Prisma
        // as a filter (e.g. { contains: '' }) and match arbitrary orders.
        if (!orderNumber || (typeof orderNumber !== 'string' && typeof orderNumber !== 'number')) {
          results.errors.push({ orderNumber: 'missing', error: 'Order number required' });
          continue;
        }
        if (etsyStoreId != null && typeof etsyStoreId !== 'string' && typeof etsyStoreId !== 'number') {
          results.errors.push({ orderNumber: String(orderNumber), error: 'Invalid etsyStoreId' });
          continue;
        }
        const orderNumberStr = String(orderNumber);
        const etsyStoreIdStr = etsyStoreId != null ? String(etsyStoreId) : '';

        if (!shippingAddress || Object.keys(shippingAddress).length === 0) {
          results.errors.push({ orderNumber, error: 'Shipping address required' });
          continue;
        }

        // Upsert Etsy address data. Merge with any existing record so partial
        // pushes (e.g. an email-only update from the detail-panel watcher)
        // never clobber a previously scraped full address — and vice versa.
        const existing = await prisma.etsyAddress.findUnique({
          where: {
            userId_etsyStoreId_orderNumber: {
              userId,
              etsyStoreId: etsyStoreIdStr,
              orderNumber: orderNumberStr
            }
          }
        });
        const existingAddr = parseAddr(existing?.shippingAddress);
        const mergedAddr = { ...existingAddr };
        for (const [k, v] of Object.entries(shippingAddress)) {
          if (typeof v === 'string' ? v.trim() : v) mergedAddr[k] = v;
        }
        await prisma.etsyAddress.upsert({
          where: {
            userId_etsyStoreId_orderNumber: {
              userId,
              etsyStoreId: etsyStoreIdStr,
              orderNumber: orderNumberStr
            }
          },
          update: {
            shippingAddress: mergedAddr,
            notes: notes || existing?.notes || null,
            etsyStoreName: etsyStoreName || existing?.etsyStoreName || null,
            shipByDate: shipByDate || existing?.shipByDate || null,
            orderDate: orderDate || existing?.orderDate || null,
            updatedAt: new Date()
          },
          create: {
            userId,
            orderNumber: orderNumberStr,
            etsyStoreId: etsyStoreIdStr,
            etsyStoreName: etsyStoreName || null,
            shippingAddress: mergedAddr,
            notes: notes || null,
            shipByDate: shipByDate || null,
            orderDate: orderDate || null
          }
        });

        logger.info(`Stored Etsy address for order ${orderNumber}`, {
          userId,
          orderNumber,
          etsyStoreId,
          etsyStoreName,
          hasAddress: !!shippingAddress,
          hasNotes: !!notes
        });

        // Fill the live Order.shippingAddress right now so the address/email
        // shows in the dashboard immediately — Etsy's API never returns buyer
        // PII to third-party apps, so the scrape is the only source. Address
        // fields fill only when the order's street is empty (never clobber a
        // manually-corrected/real address); email fills whenever it's missing.
        const scrapedStreet = (shippingAddress?.line1 || shippingAddress?.street1 || '').trim();
        const scrapedEmail = (shippingAddress?.email || '').trim();
        if (scrapedStreet || scrapedEmail) {
          const order = await prisma.order.findFirst({
            where: { userId, orderNumber: orderNumberStr },
            select: { id: true, shippingAddress: true, customerNote: true },
          });
          if (!order) {
            results.notFound++;
          } else {
            const cur = parseAddr(order.shippingAddress);
            const fillStreet = scrapedStreet && !(cur.street1 || '').trim();
            const fillEmail = scrapedEmail && !(cur.email || '').trim();
            if (fillStreet || fillEmail) {
              const merged = fillStreet ? {
                name: shippingAddress.name || cur.name || '',
                phone: cur.phone || '',
                street1: scrapedStreet,
                street2: (shippingAddress.line2 || '').trim(),
                city: (shippingAddress.city || '').trim(),
                state: (shippingAddress.state || '').trim(),
                postal: (shippingAddress.postalCode || shippingAddress.postal || '').trim(),
                country: toIso((shippingAddress.country || '').trim()),
                isResidential: true,
                email: scrapedEmail || cur.email || '',
              } : { ...cur, email: scrapedEmail };
              // Only fill the address. Personalization/notes come from the Etsy API
              // (message_from_buyer / transaction personalization in etsyOrderSync) — the
              // scraped `notes` is the whole order-card text and would overwrite the real
              // (often empty) personalization with junk, so we deliberately do NOT touch
              // customerNote here.
              await prisma.order.update({
                where: { id: order.id },
                data: { shippingAddress: JSON.stringify(merged) },
              });
              results.ordersFilled++;
            }
          }
        }

        results.updated++;
        results.processed++;

      } catch (error) {
        logger.error(`Failed to store Etsy address for order ${addressData.orderNumber}, store ${addressData.etsyStoreId}: ${error instanceof Error ? error.message : String(error)}`);
        results.errors.push({
          orderNumber: addressData.orderNumber,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    logger.info(`[Etsy Chrome Extension] Address sync complete for user ${userId}`, results);

    return res.status(200).json(results);

  } catch (error) {
    logger.error('[Etsy Chrome Extension] Address sync error', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Apply usage limiter middleware
export default withUsageLimiter(handler, 'orderSync');
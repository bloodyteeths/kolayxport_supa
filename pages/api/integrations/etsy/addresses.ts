import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

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
  // Set CORS headers for Chrome extension (whitelist only known extension IDs)
  const origin = req.headers.origin;
  const ALLOWED_EXTENSION_IDS = [process.env.CHROME_EXTENSION_ID].filter(Boolean);
  if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
    const extensionId = origin.replace('chrome-extension://', '').replace('moz-extension://', '');
    if (ALLOWED_EXTENSION_IDS.length === 0 || ALLOWED_EXTENSION_IDS.includes(extensionId)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      logger.warn('Unknown extension origin rejected', { origin, extensionId });
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://kolayxport.com');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie, X-Extension-Version, X-Extension-Auth');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight request - don't check auth for OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Debug: log all auth-related headers from extension
  const authHeader = req.headers.authorization;
  const extAuth = req.headers['x-extension-auth'];
  const cookies = req.headers.cookie;
  logger.info('[ext-debug] Auth headers received', {
    hasAuthorization: !!authHeader,
    authorizationPrefix: authHeader ? authHeader.substring(0, 30) + '...' : null,
    hasExtensionAuth: !!extAuth,
    extAuthPrefix: extAuth ? String(extAuth).substring(0, 30) + '...' : null,
    hasSessionCookie: cookies?.includes('next-auth.session-token') || cookies?.includes('__Secure-next-auth.session-token') || false,
    cookieNames: cookies ? cookies.split(';').map(c => c.trim().split('=')[0]) : [],
    origin: req.headers.origin,
  });

  // Get user via NextAuth (cookie or Bearer token)
  let user = await getAuthUser(req, res);

  // Extension fallback: if extension sends request from chrome-extension:// origin
  // and provides shop name in orders, look up user via EtsyShop
  if (!user && origin && origin.startsWith('chrome-extension://')) {
    const { orders } = req.body || {};
    const shopName = orders?.[0]?.etsyStoreName || orders?.[0]?.shopName;
    if (shopName) {
      const shop = await prisma.etsyShop.findFirst({
        where: { shopName: { equals: shopName, mode: 'insensitive' }, isActive: true },
        select: { userId: true, user: { select: { id: true, email: true, name: true } } },
      });
      if (shop?.user) {
        user = { id: shop.user.id, email: shop.user.email, name: shop.user.name };
        logger.info('[ext-auth] Authenticated via shop name lookup', { shopName, userId: user.id });
      }
    }
  }

  if (!user) {
    logger.warn('Unauthorized Etsy address sync attempt', {
      hasExtensionAuth: !!extAuth,
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

        if (!orderNumber) {
          results.errors.push({ orderNumber: 'missing', error: 'Order number required' });
          continue;
        }

        if (!shippingAddress || Object.keys(shippingAddress).length === 0) {
          results.errors.push({ orderNumber, error: 'Shipping address required' });
          continue;
        }

        // Upsert Etsy address data
        await prisma.etsyAddress.upsert({
          where: {
            userId_etsyStoreId_orderNumber: {
              userId,
              etsyStoreId: etsyStoreId || '',
              orderNumber
            }
          },
          update: {
            shippingAddress,
            notes: notes || null,
            etsyStoreName: etsyStoreName || null,
            shipByDate: shipByDate || null,
            orderDate: orderDate || null,
            updatedAt: new Date()
          },
          create: {
            userId,
            orderNumber,
            etsyStoreId: etsyStoreId || '',
            etsyStoreName: etsyStoreName || null,
            shippingAddress,
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

        // Fill the live Order.shippingAddress right now so the address shows in the
        // dashboard immediately — Etsy's API never returns it, so the scrape is the
        // only source. Only when the order's street is empty (never clobber a
        // manually-corrected/real address).
        const scrapedStreet = (shippingAddress?.line1 || shippingAddress?.street1 || '').trim();
        if (scrapedStreet) {
          const order = await prisma.order.findFirst({
            where: { userId, orderNumber },
            select: { id: true, shippingAddress: true, customerNote: true },
          });
          if (!order) {
            results.notFound++;
          } else {
            const cur = parseAddr(order.shippingAddress);
            if (!(cur.street1 || '').trim()) {
              const merged = {
                name: shippingAddress.name || cur.name || '',
                phone: cur.phone || '',
                street1: scrapedStreet,
                street2: (shippingAddress.line2 || '').trim(),
                city: (shippingAddress.city || '').trim(),
                state: (shippingAddress.state || '').trim(),
                postal: (shippingAddress.postalCode || shippingAddress.postal || '').trim(),
                country: toIso((shippingAddress.country || '').trim()),
                isResidential: true,
                email: cur.email || '',
              };
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
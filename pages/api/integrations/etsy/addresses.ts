import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSupabaseServerClient } from '@/lib/supabase';
import { withUsageLimiter } from '@/lib/middleware/withUsageLimiter';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Set CORS headers for Chrome extension
  const origin = req.headers.origin;
  if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
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

  // Get user via Supabase client
  let supabase = getSupabaseServerClient(req, res);
  let { data: { user }, error: authError } = await supabase.auth.getUser();

  // If regular auth fails, try extension auth header
  if ((authError || !user) && req.headers['x-extension-auth']) {
    try {
      const extensionToken = req.headers['x-extension-auth'] as string;
      // Create a new Supabase client with the extension token
      const { createClient } = require('@supabase/supabase-js');
      const tempSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${extensionToken}`
            }
          }
        }
      );
      const { data: { user: extensionUser }, error: extensionError } = await tempSupabase.auth.getUser();
      if (extensionUser && !extensionError) {
        user = extensionUser;
        authError = null;
      }
    } catch (extensionAuthError) {
      logger.warn('Extension auth also failed', { error: extensionAuthError });
    }
  }

  if (authError || !user) {
    logger.warn('Unauthorized Etsy address sync attempt', { 
      authError: authError?.message,
      hasExtensionAuth: !!req.headers['x-extension-auth'],
      origin: req.headers.origin,
      userAgent: req.headers['user-agent']
    });
    return res.status(401).json({ error: 'Unauthorized', details: authError?.message });
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
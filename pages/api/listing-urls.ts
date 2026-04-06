import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';

// In-memory cache: veeqoProductId -> { url, channel }
const productUrlCache = new Map<number, { url: string; channel: string }>();

/**
 * Batch lookup listing URLs for order items.
 * POST /api/listing-urls
 * Body: { productIds: number[], titles?: string[] }
 *   - productIds: Veeqo product IDs → calls Veeqo Product API for channel URLs
 *   - titles: fallback title matching against EtsyListing table
 * Returns: { byProductId: { [id]: url }, byTitle: { [title]: url } }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productIds, titles } = req.body;
  const result: { byProductId: Record<string, string>; byTitle: Record<string, string> } = {
    byProductId: {},
    byTitle: {},
  };

  try {
    // 1. Resolve Veeqo product IDs to listing URLs
    if (Array.isArray(productIds) && productIds.length > 0) {
      // Get Veeqo API key
      const cred = await prisma.credential.findFirst({
        where: { veeqoApiKey: { not: null } },
        select: { veeqoApiKey: true },
      });

      if (cred?.veeqoApiKey) {
        const uniqueIds = [...new Set(productIds.map(Number).filter(Boolean))];

        // Resolve uncached IDs
        const uncachedIds = uniqueIds.filter(id => !productUrlCache.has(id));

        // Fetch in parallel (max 10 concurrent to avoid rate limiting)
        const batchSize = 10;
        for (let i = 0; i < uncachedIds.length; i += batchSize) {
          const batch = uncachedIds.slice(i, i + batchSize);
          await Promise.all(batch.map(async (productId) => {
            try {
              const resp = await fetch(`https://api.veeqo.com/products/${productId}`, {
                headers: { 'x-api-key': cred.veeqoApiKey! },
              });
              if (!resp.ok) return;

              const product = await resp.json();

              // Check channel_products for remote_id (Etsy listing ID)
              // and channel_sellables for direct URLs (Amazon)
              let bestUrl = '';
              let bestChannel = '';

              // First check channel_sellables for direct URLs
              if (product.sellables) {
                for (const sellable of product.sellables) {
                  if (sellable.channel_sellables) {
                    for (const cs of sellable.channel_sellables) {
                      if (cs.url && cs.url.trim()) {
                        bestUrl = cs.url;
                        bestChannel = cs.channel?.type_code || '';
                        break;
                      }
                    }
                  }
                  if (bestUrl) break;
                }
              }

              // If no direct URL, check channel_products for Etsy remote_id
              if (!bestUrl && product.channel_products) {
                for (const cp of product.channel_products) {
                  const typeCode = (cp.channel?.type_code || cp.type_code || '').toLowerCase();
                  if (typeCode === 'etsy' && cp.remote_id) {
                    bestUrl = `https://www.etsy.com/listing/${cp.remote_id}`;
                    bestChannel = 'etsy';
                    break;
                  }
                  if (typeCode === 'amazon' && cp.remote_id) {
                    bestUrl = `https://www.amazon.com/dp/${cp.remote_id}`;
                    bestChannel = 'amazon';
                    break;
                  }
                  if (typeCode === 'ebay' && cp.remote_id) {
                    bestUrl = `https://www.ebay.com/itm/${cp.remote_id}`;
                    bestChannel = 'ebay';
                    break;
                  }
                }
              }

              if (bestUrl) {
                productUrlCache.set(productId, { url: bestUrl, channel: bestChannel });
              }
            } catch (err) {
              // Skip failed product lookups
            }
          }));
        }

        // Build response from cache
        for (const id of uniqueIds) {
          const cached = productUrlCache.get(id);
          if (cached) {
            result.byProductId[String(id)] = cached.url;
          }
        }
      }
    }

    // 2. Title-based fallback for Etsy listings (Shippo orders without Veeqo product IDs)
    if (Array.isArray(titles) && titles.length > 0) {
      const listings = await prisma.etsyListing.findMany({
        select: { etsyListingId: true, title: true, url: true },
      });

      for (const title of titles) {
        if (!title || title === '—' || title === 'N/A (Order Level)') continue;
        const lower = title.toLowerCase().trim();
        const prefix = lower.slice(0, 30);
        const match = listings.find(
          (l) =>
            l.title.toLowerCase().startsWith(prefix) ||
            lower.startsWith(l.title.toLowerCase().slice(0, 30))
        );
        if (match) {
          result.byTitle[title] = match.url || `https://www.etsy.com/listing/${match.etsyListingId}`;
        }
      }
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('[listing-urls] Error:', error);
    res.status(500).json({ byProductId: {}, byTitle: {} });
  }
}

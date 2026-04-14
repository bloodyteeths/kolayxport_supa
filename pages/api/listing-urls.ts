import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';

// In-memory cache: veeqoProductId -> { url, channel }
const productUrlCache = new Map<number, { url: string; channel: string }>();

/**
 * Batch lookup listing URLs and thumbnails for order items.
 * POST /api/listing-urls
 * Body: { productIds: number[], titles?: string[], listingIds?: string[] }
 *   - productIds: Veeqo product IDs → calls Veeqo Product API for channel URLs
 *   - titles: fallback title matching against EtsyListing table
 *   - listingIds: direct Etsy listing ID lookup
 * Returns: { byProductId: { [id]: url }, byTitle: { [title]: url }, images: { [title]: imageUrl } }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productIds, titles, listingIds } = req.body;
  const result: { byProductId: Record<string, string>; byTitle: Record<string, string>; images: Record<string, string> } = {
    byProductId: {},
    byTitle: {},
    images: {},
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

    // 2. Direct listing ID lookup for Etsy listings
    if (Array.isArray(listingIds) && listingIds.length > 0) {
      const bigintIds = listingIds.map((id: string) => {
        try { return BigInt(id); } catch { return null; }
      }).filter(Boolean) as bigint[];

      if (bigintIds.length > 0) {
        const directMatches = await prisma.etsyListing.findMany({
          where: { etsyListingId: { in: bigintIds } },
          select: { etsyListingId: true, title: true, url: true, thumbnailUrl170x135: true, thumbnailUrl570xN: true },
        });
        for (const match of directMatches) {
          const idStr = match.etsyListingId.toString();
          const url = match.url || `https://www.etsy.com/listing/${idStr}`;
          // Store by listing ID for direct resolution
          result.byProductId[`etsy-${idStr}`] = url;
          // Also store image
          const imageUrl = match.thumbnailUrl570xN || match.thumbnailUrl170x135 || '';
          if (imageUrl && match.title) {
            result.images[match.title] = imageUrl;
          }
        }
      }
    }

    // 3. Title-based fallback for Etsy listings (Shippo/chrome extension orders)
    if (Array.isArray(titles) && titles.length > 0) {
      const listings = await prisma.etsyListing.findMany({
        where: { state: 'active' }, // Only match active listings — expired ones have dead URLs
        select: { etsyListingId: true, title: true, url: true, state: true, thumbnailUrl170x135: true, thumbnailUrl570xN: true },
        orderBy: { syncedAt: 'desc' },
      });

      // Build normalized lookup, prioritizing active listings with highest listing ID (newest)
      const normalizedListings = listings.map(l => ({
        ...l,
        normalizedTitle: l.title.toLowerCase().replace(/\s+/g, ' ').trim(),
        isActive: l.state === 'active',
      }));

      // Helper: among multiple matches, pick the best one (active > inactive, then highest ID = newest)
      const pickBest = (candidates: typeof normalizedListings) => {
        if (candidates.length === 0) return undefined;
        if (candidates.length === 1) return candidates[0];
        // Prefer active listings
        const active = candidates.filter(c => c.isActive);
        const pool = active.length > 0 ? active : candidates;
        // Among those, pick highest etsyListingId (newest listing)
        return pool.reduce((best, c) => c.etsyListingId > best.etsyListingId ? c : best);
      };

      for (const title of titles) {
        if (!title || title === '—' || title === 'N/A (Order Level)') continue;
        if (result.byTitle[title]) continue; // Already resolved by listing ID

        const normalizedInput = title.toLowerCase().replace(/\s+/g, ' ').trim();

        // Try exact match first
        let candidates = normalizedListings.filter(l => l.normalizedTitle === normalizedInput);
        let match = pickBest(candidates);

        // Then try prefix match (first 30 chars) in both directions
        if (!match) {
          const prefix = normalizedInput.slice(0, 30);
          candidates = normalizedListings.filter(
            (l) =>
              l.normalizedTitle.startsWith(prefix) ||
              normalizedInput.startsWith(l.normalizedTitle.slice(0, 30))
          );
          match = pickBest(candidates);
        }

        // Then try substring/contains match for partial titles
        if (!match) {
          candidates = normalizedListings.filter(
            (l) =>
              l.normalizedTitle.includes(normalizedInput) ||
              normalizedInput.includes(l.normalizedTitle)
          );
          match = pickBest(candidates);
        }

        if (match) {
          result.byTitle[title] = match.url || `https://www.etsy.com/listing/${match.etsyListingId}`;
          const imageUrl = match.thumbnailUrl570xN || match.thumbnailUrl170x135 || '';
          if (imageUrl) {
            result.images[title] = imageUrl;
          }
        }
      }
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('[listing-urls] Error:', error);
    res.status(500).json({ byProductId: {}, byTitle: {}, images: {} });
  }
}

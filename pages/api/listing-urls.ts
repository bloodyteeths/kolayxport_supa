import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';

type CachedProduct = { url: string; channel: string; remoteId?: string };

/**
 * Batch lookup listing URLs and thumbnails for order items.
 * POST /api/listing-urls
 * Body: { productIds: number[], titles?: string[], listingIds?: string[] }
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
    // 1. Resolve Veeqo product IDs to listing URLs (DB-cached, Veeqo API only for new products)
    if (Array.isArray(productIds) && productIds.length > 0) {
      const uniqueIds = [...new Set(productIds.map(Number).filter(Boolean))];
      const productCache = new Map<number, CachedProduct>();

      // Load cached mappings from DB in one query
      const cacheKeys = uniqueIds.map(id => `veeqo-product-${id}`);
      try {
        const cached = await prisma.arbitrageCache.findMany({
          where: { key: { in: cacheKeys } },
        });
        for (const c of cached) {
          const pid = parseInt(c.key.replace('veeqo-product-', ''));
          if (!isNaN(pid)) {
            productCache.set(pid, c.value as unknown as CachedProduct);
          }
        }
      } catch { /* cache miss is fine */ }

      // Find IDs not in DB cache
      const uncachedIds = uniqueIds.filter(id => !productCache.has(id));

      // Only call Veeqo API for uncached products
      if (uncachedIds.length > 0) {
        const cred = await prisma.credential.findFirst({
          where: { veeqoApiKey: { not: null } },
          select: { veeqoApiKey: true },
        });

        if (cred?.veeqoApiKey) {
          const batchSize = 10;
          const newCacheEntries: { key: string; value: any; expiresAt: Date }[] = [];

          for (let i = 0; i < uncachedIds.length; i += batchSize) {
            const batch = uncachedIds.slice(i, i + batchSize);
            await Promise.all(batch.map(async (productId) => {
              try {
                const resp = await fetch(`https://api.veeqo.com/products/${productId}`, {
                  headers: { 'x-api-key': cred.veeqoApiKey! },
                });
                if (!resp.ok) return;
                const product = await resp.json();

                let bestUrl = '';
                let bestChannel = '';

                // Check channel_sellables for direct URLs
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

                // Check channel_products for marketplace remote_id
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

                let etsyRemoteId = '';
                if (product.channel_products) {
                  for (const cp of product.channel_products) {
                    if ((cp.channel?.type_code || cp.type_code || '').toLowerCase() === 'etsy' && cp.remote_id) {
                      etsyRemoteId = String(cp.remote_id);
                      break;
                    }
                  }
                }

                if (bestUrl) {
                  const entry: CachedProduct = { url: bestUrl, channel: bestChannel, remoteId: etsyRemoteId };
                  productCache.set(productId, entry);
                  newCacheEntries.push({
                    key: `veeqo-product-${productId}`,
                    value: entry as any,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                  });
                }
              } catch { /* skip failed lookups */ }
            }));
          }

          // Persist new cache entries to DB (fire-and-forget)
          if (newCacheEntries.length > 0) {
            Promise.all(newCacheEntries.map(entry =>
              prisma.arbitrageCache.upsert({
                where: { key: entry.key },
                create: entry,
                update: { value: entry.value, expiresAt: entry.expiresAt },
              })
            )).catch(() => {});
          }
        }
      }

      // Cross-check Etsy listing IDs against EtsyListing DB for active status + images
      const etsyRemoteIds = uniqueIds
        .map(id => productCache.get(id)?.remoteId)
        .filter(Boolean) as string[];

      let activeListingMap = new Map<string, { url: string; imageUrl: string }>();
      if (etsyRemoteIds.length > 0) {
        try {
          const bigintIds = etsyRemoteIds.map(id => { try { return BigInt(id); } catch { return null; } }).filter(Boolean) as bigint[];
          if (bigintIds.length > 0) {
            const activeListings = await prisma.etsyListing.findMany({
              where: { etsyListingId: { in: bigintIds } },
              select: { etsyListingId: true, url: true, state: true, thumbnailUrl570xN: true, thumbnailUrl170x135: true },
            });
            for (const l of activeListings) {
              if (l.state === 'active') {
                activeListingMap.set(l.etsyListingId.toString(), {
                  url: l.url || `https://www.etsy.com/listing/${l.etsyListingId}`,
                  imageUrl: l.thumbnailUrl570xN || l.thumbnailUrl170x135 || '',
                });
              }
            }
          }
        } catch { /* non-critical */ }
      }

      for (const id of uniqueIds) {
        const cached = productCache.get(id);
        if (cached) {
          if (cached.remoteId && activeListingMap.has(cached.remoteId)) {
            const active = activeListingMap.get(cached.remoteId)!;
            result.byProductId[String(id)] = active.url;
            if (active.imageUrl) {
              result.images[`veeqo-${id}`] = active.imageUrl;
            }
          } else {
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
        select: { etsyListingId: true, title: true, url: true, state: true, thumbnailUrl170x135: true, thumbnailUrl570xN: true },
        orderBy: [{ state: 'asc' }, { etsyListingId: 'desc' }], // 'active' sorts before other states, highest ID first
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
          // Only set URL for active listings (expired URLs show "item not available")
          if (match.isActive) {
            result.byTitle[title] = match.url || `https://www.etsy.com/listing/${match.etsyListingId}`;
          }
          // Images stay valid even for expired listings
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

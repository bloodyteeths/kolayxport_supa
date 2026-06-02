import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

// Resolve a Trendyol order line to its canonical public product URL and 302
// redirect the browser there.
//
// Why this exists: the `contentId` field Trendyol returns in the seller
// Integration API order payload is NOT the same id used in their storefront
// `/<slug>-p-<id>` URLs, so we can't construct a working link client-side.
// The seller product API also doesn't return a public URL field. The only
// reliable path is to hit Trendyol's public search HTML with the barcode (the
// universal product code), parse the canonical URL out of the PROPS JSON, and
// follow it.
//
// First call per barcode pays a ~500ms scrape. Subsequent calls hit the
// TrendyolProductIndex cache row keyed by `productId`, with `barcode` indexed
// for the reverse lookup. Cache TTL is 14 days — Trendyol URLs change rarely
// and stale-but-working beats fresh-but-broken.

const TRENDYOL_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
  'sec-ch-ua': '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;

interface ResolvedHit {
  productId: number;
  url: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  priceTry: number;
}

function searchUrlFallback(barcode: string, contentId: string | null, name: string | null): string {
  const q = barcode || contentId || (name || '').slice(0, 60);
  if (!q) return 'https://www.trendyol.com';
  return `https://www.trendyol.com/sr?q=${encodeURIComponent(q)}`;
}

async function scrapeTrendyolByBarcode(barcode: string): Promise<ResolvedHit | null> {
  const searchUrl = `https://www.trendyol.com/sr?q=${encodeURIComponent(barcode)}`;
  const res = await fetch(searchUrl, { headers: TRENDYOL_HEADERS });
  if (!res.ok) return null;
  const html = await res.text();

  const propsMarker = 'window["__single-search-result__PROPS"]=';
  const propsIdx = html.indexOf(propsMarker);
  if (propsIdx === -1) return null;
  const propsStart = propsIdx + propsMarker.length;
  const propsEnd = html.indexOf('</script>', propsStart);
  if (propsEnd <= propsStart) return null;

  let propsData: any;
  try {
    propsData = JSON.parse(html.substring(propsStart, propsEnd));
  } catch {
    return null;
  }

  const candidates =
    propsData?.data?.products ??
    propsData?.noResultSuggestions?.contents ??
    [];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const top = candidates[0];
  const productId = Number(top.id || top.contentId);
  const rawUrl = String(top.url || '').replace(/\\u002F/g, '/');
  if (!productId || !rawUrl) return null;

  const url = rawUrl.startsWith('http') ? rawUrl : `https://www.trendyol.com${rawUrl}`;
  return {
    productId,
    url,
    name: String(top.name || ''),
    brand: String(top.brand || ''),
    imageUrl: top.image ? String(top.image).replace(/\\u002F/g, '/') : null,
    priceTry: Number(top.price?.discountedPrice ?? top.price?.current ?? 0),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const barcode = String(req.query.barcode || '').trim();
  const contentId = req.query.contentId ? String(req.query.contentId).trim() : null;
  const name = req.query.name ? String(req.query.name) : null;

  if (!barcode && !contentId) {
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, 'https://www.trendyol.com');
  }

  try {
    // 1) Cache hit — return immediately
    if (barcode) {
      const cached = await prisma.trendyolProductIndex.findFirst({
        where: { barcode, expiresAt: { gt: new Date() } },
        select: { url: true },
      });
      if (cached?.url) {
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.redirect(302, cached.url);
      }
    }

    // 2) Scrape Trendyol public search
    let hit: ResolvedHit | null = null;
    if (barcode) {
      try {
        hit = await scrapeTrendyolByBarcode(barcode);
      } catch (err: any) {
        logger.warn('Trendyol URL resolver: scrape failed', {
          barcode,
          error: err.message,
        });
      }
    }

    if (hit?.url) {
      // Cache the resolution. Use upsert keyed on productId (unique) so two
      // orders sharing the same product don't race.
      try {
        await prisma.trendyolProductIndex.upsert({
          where: { productId: hit.productId },
          update: {
            url: hit.url,
            barcode,
            name: hit.name,
            brand: hit.brand,
            imageUrl: hit.imageUrl ?? undefined,
            priceTry: hit.priceTry,
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + CACHE_TTL_MS),
          },
          create: {
            productId: hit.productId,
            url: hit.url,
            barcode,
            name: hit.name || 'Unknown',
            brand: hit.brand || '',
            priceTry: hit.priceTry,
            originalPriceTry: hit.priceTry,
            imageUrl: hit.imageUrl ?? undefined,
            categorySlug: 'unknown',
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + CACHE_TTL_MS),
          },
        });
      } catch (cacheErr: any) {
        // Cache failure is non-fatal — still redirect the user.
        logger.warn('Trendyol URL resolver: cache write failed', {
          productId: hit.productId,
          error: cacheErr.message,
        });
      }
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.redirect(302, hit.url);
    }

    // 3) Fallback — short-cache the search URL so we don't re-scrape on
    // every click for a product that genuinely has no search result.
    res.setHeader('Cache-Control', `private, max-age=${Math.floor(FALLBACK_TTL_MS / 1000)}`);
    return res.redirect(302, searchUrlFallback(barcode, contentId, name));
  } catch (err: any) {
    logger.error('Trendyol URL resolver: unexpected error', err, { barcode, contentId });
    return res.redirect(302, searchUrlFallback(barcode, contentId, name));
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getAuthUser } from '@/lib/auth';

// Resolve a Trendyol order line to its canonical public product URL and 302
// redirect the browser there.
//
// Why this exists: the `contentId` field Trendyol returns in the seller
// Integration API order payload is NOT the same id used in their storefront
// `/<slug>-p-<id>` URLs. Public search by barcode also fails — barcodes are
// not indexed for the storefront search, so `/sr?q=<barcode>` lands on
// "Aradığın ürün bulunamadı" with unrelated suggestions.
//
// The Integration API's product-by-barcode endpoint (with the seller's own
// credentials) returns a `productUrl` field with the canonical storefront
// URL. That's what we use as the primary resolver. Public HTML scrape stays
// as a last-ditch fallback for the unauthenticated / no-creds case.

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

  // ONLY trust direct hits. `noResultSuggestions` is Trendyol's "we have no
  // idea, here's some random products" fallback and previously landed users
  // on hardware wrenches when they were looking for a kid's dress.
  const candidates = propsData?.data?.products;
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

// Primary resolver: hit the seller's Integration API. The product-by-barcode
// endpoint returns a `productUrl` field — the actual canonical URL we want.
async function lookupViaIntegrationAPI(userId: string, barcode: string): Promise<ResolvedHit | null> {
  const cred = await prisma.credential.findFirst({
    where: { userId },
    select: { trendyolApiKey: true, trendyolApiSecret: true, trendyolSupplierId: true },
  });
  if (!cred?.trendyolApiKey || !cred?.trendyolApiSecret || !cred?.trendyolSupplierId) {
    return null;
  }
  // Trendyol creds are plaintext today; if/when crypto envelopes get rolled
  // out for them, swap this to decryptIfNeeded.
  const auth = 'Basic ' + Buffer.from(`${cred.trendyolApiKey}:${cred.trendyolApiSecret}`).toString('base64');
  const url = `https://apigw.trendyol.com/integration/product/sellers/${cred.trendyolSupplierId}/products?barcode=${encodeURIComponent(barcode)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      'User-Agent': `${cred.trendyolSupplierId} - SelfIntegration`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    logger.warn('Trendyol URL resolver: Integration API non-200', {
      status: res.status,
      barcode,
    });
    return null;
  }
  const json: any = await res.json().catch(() => null);
  const item = json?.content?.[0];
  if (!item) return null;

  const productUrl: string | null = item.productUrl || null;
  // productContentId from this API is the storefront product-detail id —
  // distinct from order-line `contentId`. Use it as the cache key.
  const productId = Number(item.productContentId || item.id || item.productMainId || 0);
  if (!productUrl || !productId) return null;

  return {
    productId,
    url: productUrl.startsWith('http') ? productUrl : `https://www.trendyol.com${productUrl}`,
    name: String(item.title || ''),
    brand: String(item.brand || ''),
    imageUrl: Array.isArray(item.images) && item.images[0]
      ? String(item.images[0].url || item.images[0]).replace(/\\u002F/g, '/')
      : null,
    priceTry: Number(item.salePrice ?? item.listPrice ?? 0),
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

    // 2a) Primary resolver — seller's own Integration API. Returns the
    // canonical storefront URL directly. Requires an authenticated user
    // whose Credential row has Trendyol creds.
    let hit: ResolvedHit | null = null;
    if (barcode) {
      const user = await getAuthUser(req, res);
      if (user?.id) {
        try {
          hit = await lookupViaIntegrationAPI(user.id, barcode);
        } catch (err: any) {
          logger.warn('Trendyol URL resolver: Integration API failed', {
            barcode,
            error: err.message,
          });
        }
      }
    }

    // 2b) Fallback — public search scrape. Only useful if the product is
    // actively indexed in Trendyol's search (which dress listings often
    // aren't, but accessory listings are).
    if (!hit && barcode) {
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

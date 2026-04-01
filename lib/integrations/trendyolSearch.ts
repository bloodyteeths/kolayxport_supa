/**
 * Trendyol product search via category page HTML parsing.
 * Category pages (/{slug}-x-c{categoryId}) return 200 with embedded product JSON.
 * Search pages (/sr?q=...) are Cloudflare-blocked, so we use category browsing instead.
 */
import fetch from 'node-fetch';
import type { TrendyolProduct } from '../arbitrage/types';

/**
 * Pre-defined Trendyol categories popular for Turkish export / eBay arbitrage.
 */
export const TRENDYOL_CATEGORIES = [
  { slug: 'havlu-x-c104073', label: 'Havlu (Towels)', labelTr: 'Havlu', ebaySearch: 'Turkish towel cotton' },
  { slug: 'el-yapimi-sabun-x-c104389', label: 'Handmade Soap', labelTr: 'El Yapımı Sabun', ebaySearch: 'Turkish handmade soap natural' },
  { slug: 'seramik-tabak-x-c104209', label: 'Ceramic Plates', labelTr: 'Seramik Tabak', ebaySearch: 'Turkish ceramic plate hand painted' },
  { slug: 'turk-kahvesi-seti-x-c103760', label: 'Turkish Coffee Set', labelTr: 'Türk Kahvesi Seti', ebaySearch: 'Turkish coffee cup set' },
  { slug: 'kilim-x-c104037', label: 'Kilim (Rugs)', labelTr: 'Kilim', ebaySearch: 'Turkish kilim rug' },
  { slug: 'nazar-boncugu-x-c104271', label: 'Evil Eye Jewelry', labelTr: 'Nazar Boncuğu', ebaySearch: 'evil eye nazar jewelry Turkish' },
  { slug: 'bakir-cezve-x-c104262', label: 'Copper Coffee Pot', labelTr: 'Bakır Cezve', ebaySearch: 'Turkish copper coffee pot cezve' },
  { slug: 'deri-canta-x-c103891', label: 'Leather Bags', labelTr: 'Deri Çanta', ebaySearch: 'Turkish leather bag handmade' },
  { slug: 'yastik-kilifi-x-c104063', label: 'Pillow Covers', labelTr: 'Yastık Kılıfı', ebaySearch: 'Turkish pillow cover kilim' },
  { slug: 'lokum-x-c104301', label: 'Turkish Delight', labelTr: 'Lokum', ebaySearch: 'Turkish delight lokum' },
  { slug: 'baharat-x-c103966', label: 'Spices', labelTr: 'Baharat', ebaySearch: 'Turkish spice set' },
  { slug: 'cam-bardak-x-c104216', label: 'Glass Cups', labelTr: 'Cam Bardak', ebaySearch: 'Turkish tea glass set' },
  { slug: 'pestemal-x-c104074', label: 'Peshtemal (Hammam Towel)', labelTr: 'Peştemal', ebaySearch: 'Turkish peshtemal towel hammam' },
  { slug: 'zeytinyagi-x-c103955', label: 'Olive Oil', labelTr: 'Zeytinyağı', ebaySearch: 'Turkish olive oil' },
  { slug: 'seramik-kase-x-c104210', label: 'Ceramic Bowls', labelTr: 'Seramik Kase', ebaySearch: 'Turkish ceramic bowl hand painted' },
  { slug: 'bornoz-x-c103825', label: 'Bathrobes', labelTr: 'Bornoz', ebaySearch: 'Turkish cotton bathrobe' },
  { slug: 'taki-seti-x-c104256', label: 'Jewelry Sets', labelTr: 'Takı Seti', ebaySearch: 'Turkish jewelry set ottoman' },
  { slug: 'cay-bardagi-x-c104217', label: 'Tea Glasses', labelTr: 'Çay Bardağı', ebaySearch: 'Turkish tea glass set' },
  { slug: 'lamba-x-c104155', label: 'Lamps', labelTr: 'Lamba', ebaySearch: 'Turkish mosaic lamp' },
  { slug: 'halhal-x-c104260', label: 'Anklets', labelTr: 'Halhal', ebaySearch: 'Turkish anklet gold silver' },
];

interface TrendyolSearchResult {
  products: TrendyolProduct[];
  totalCount: number;
  categorySlug: string;
}

/**
 * Fetch products from a Trendyol category page by parsing embedded JSON from HTML.
 * Category pages return 200 and contain ~24-100+ products as JSON in the SSR HTML.
 * Supports pagination via ?pi={page} parameter.
 */
export async function fetchTrendyolCategoryProducts(categorySlug: string, page = 1): Promise<TrendyolSearchResult> {
  const url = page > 1
    ? `https://www.trendyol.com/${categorySlug}?pi=${page}`
    : `https://www.trendyol.com/${categorySlug}`;

  const res = await fetch(url, {
    headers: {
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
    },
  });

  if (!res.ok) {
    throw new Error(`Trendyol category page failed: ${res.status}`);
  }

  const html = await res.text();

  // Extract product data from SSR HTML.
  // Trendyol embeds data in two possible structures:
  // 1. "products":[{...},...] — standard category listing
  // 2. "noResultSuggestions":{"contents":[{...},...]} — suggested products
  // Both are inside window["__single-search-result__PROPS"]={...}
  const products: TrendyolProduct[] = [];
  const seenIds = new Set<number>();

  let bestRaw: any[] = [];

  // Strategy 1: Parse the PROPS JSON object (most reliable)
  const propsMarker = 'window["__single-search-result__PROPS"]=';
  const propsIdx = html.indexOf(propsMarker);
  if (propsIdx > -1) {
    const propsStart = propsIdx + propsMarker.length;
    const propsEnd = html.indexOf('</script>', propsStart);
    if (propsEnd > propsStart) {
      try {
        const propsData = JSON.parse(html.substring(propsStart, propsEnd));
        // Check standard products location
        const dataProducts = propsData?.data?.products;
        if (Array.isArray(dataProducts) && dataProducts.length > 0) {
          bestRaw = dataProducts;
        }
        // Check noResultSuggestions (category redirect/fallback)
        if (bestRaw.length === 0) {
          const suggestions = propsData?.noResultSuggestions?.contents;
          if (Array.isArray(suggestions) && suggestions.length > 0) {
            bestRaw = suggestions;
          }
        }
      } catch {
        // PROPS parse failed, fall through to regex
      }
    }
  }

  // Strategy 2: Find largest "products":[ array in raw HTML (fallback)
  if (bestRaw.length === 0) {
    let searchFrom = 0;
    while (true) {
      const marker = '"products":[';
      const idx = html.indexOf(marker, searchFrom);
      if (idx === -1) break;

      const arrStart = idx + marker.length - 1;
      let depth = 0;
      let arrEnd = arrStart;
      for (let i = arrStart; i < html.length && i < arrStart + 500000; i++) {
        if (html[i] === '[') depth++;
        if (html[i] === ']') {
          depth--;
          if (depth === 0) { arrEnd = i + 1; break; }
        }
      }

      if (arrEnd > arrStart) {
        try {
          const raw = JSON.parse(html.substring(arrStart, arrEnd));
          if (Array.isArray(raw) && raw.length > bestRaw.length) {
            bestRaw = raw;
          }
        } catch {
          // Not valid JSON, skip
        }
      }
      searchFrom = idx + marker.length;
    }
  }

  // Map raw product objects to TrendyolProduct
  for (const p of bestRaw) {
    const id = p.id || p.contentId;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const discountedPrice = p.price?.discountedPrice ?? p.price?.current ?? 0;
    const originalPrice = p.price?.originalPrice ?? p.price?.current ?? discountedPrice;

    const imgUrl = (p.image || p.images?.[0] || '')
      .replace(/\\u002F/g, '/');
    const productUrl = (p.url || '')
      .replace(/\\u002F/g, '/');

    products.push({
      id,
      name: p.name || '',
      brand: p.brand || '',
      priceTry: discountedPrice,
      originalPriceTry: originalPrice,
      imageUrl: imgUrl.startsWith('http') ? imgUrl : `https://cdn.dsmcdn.com${imgUrl}`,
      url: productUrl.startsWith('http') ? productUrl : `https://www.trendyol.com${productUrl}`,
      categoryName: p.category?.name || categorySlug.split('-x-c')[0].replace(/-/g, ' '),
      ratingScore: p.ratingScore?.averageRating || 0,
      ratingCount: p.ratingScore?.totalCount || 0,
      merchantName: '',
      freeShipping: p.freeCargo || false,
    });
  }

  return {
    products,
    totalCount: products.length,
    categorySlug,
  };
}

/**
 * Fetch products from multiple categories with pagination support.
 * Will fetch additional pages if maxPerCategory exceeds a single page (~24 products).
 */
export async function searchTrendyolByCategories(
  categorySlugs: string[],
  maxPerCategory = 30
): Promise<{ products: TrendyolProduct[]; totalCount: number }> {
  const allProducts: TrendyolProduct[] = [];

  for (const slug of categorySlugs) {
    const seenIds = new Set<number>();
    let page = 1;
    let collected = 0;

    while (collected < maxPerCategory && page <= 5) {
      try {
        const result = await fetchTrendyolCategoryProducts(slug, page);
        if (result.products.length === 0) break;

        for (const p of result.products) {
          if (seenIds.has(p.id)) continue;
          seenIds.add(p.id);
          allProducts.push(p);
          collected++;
          if (collected >= maxPerCategory) break;
        }
        page++;
      } catch {
        break;
      }
    }
  }

  return { products: allProducts, totalCount: allProducts.length };
}

/**
 * Fetch current TRY→USD exchange rate from a public API.
 */
export async function getExchangeRate(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/TRY', {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Exchange rate API: ${res.status}`);
    const data: any = await res.json();
    return data?.rates?.USD || 0.028;
  } catch {
    return 0.028;
  }
}

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
  { slug: 'havlu-x-c104073', label: 'Havlu (Towels)', labelTr: 'Havlu' },
  { slug: 'el-yapimi-sabun-x-c104389', label: 'Handmade Soap', labelTr: 'El Yapımı Sabun' },
  { slug: 'seramik-tabak-x-c104209', label: 'Ceramic Plates', labelTr: 'Seramik Tabak' },
  { slug: 'turk-kahvesi-seti-x-c103760', label: 'Turkish Coffee Set', labelTr: 'Türk Kahvesi Seti' },
  { slug: 'kilim-x-c104037', label: 'Kilim (Rugs)', labelTr: 'Kilim' },
  { slug: 'nazar-boncugu-x-c104271', label: 'Evil Eye Jewelry', labelTr: 'Nazar Boncuğu' },
  { slug: 'bakir-cezve-x-c104262', label: 'Copper Coffee Pot', labelTr: 'Bakır Cezve' },
  { slug: 'deri-canta-x-c103891', label: 'Leather Bags', labelTr: 'Deri Çanta' },
  { slug: 'yastik-kilifi-x-c104063', label: 'Pillow Covers', labelTr: 'Yastık Kılıfı' },
  { slug: 'lokum-x-c104301', label: 'Turkish Delight', labelTr: 'Lokum' },
  { slug: 'baharat-x-c103966', label: 'Spices', labelTr: 'Baharat' },
  { slug: 'cam-bardak-x-c104216', label: 'Glass Cups', labelTr: 'Cam Bardak' },
  { slug: 'pestemal-x-c104074', label: 'Peshtemal (Hammam Towel)', labelTr: 'Peştemal' },
  { slug: 'zeytinyagi-x-c103955', label: 'Olive Oil', labelTr: 'Zeytinyağı' },
  { slug: 'seramik-kase-x-c104210', label: 'Ceramic Bowls', labelTr: 'Seramik Kase' },
  { slug: 'bornoz-x-c103825', label: 'Bathrobes', labelTr: 'Bornoz' },
  { slug: 'taki-seti-x-c104256', label: 'Jewelry Sets', labelTr: 'Takı Seti' },
  { slug: 'cay-bardagi-x-c104217', label: 'Tea Glasses', labelTr: 'Çay Bardağı' },
  { slug: 'lamba-x-c104155', label: 'Lamps', labelTr: 'Lamba' },
  { slug: 'halhal-x-c104260', label: 'Anklets', labelTr: 'Halhal' },
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

  // Parse embedded product JSON from the SSR HTML
  // Products appear in the second "products":[ block (the first is a small boutique carousel)
  const products: TrendyolProduct[] = [];

  // Find all product blocks with priceInfos (the real product listings)
  const productRegex = /\{"brand":"([^"]*)"[^}]*"title":"([^"]*)"[^}]*"id":(\d+)[^}]*"price":"([^"]*)"[^}]*"imgUrl":"([^"]*)"[^}]*"productUrl":"([^"]*)"[^}]*?"priceInfos":\{[^}]*"discountedPrice":([\d.]+)[^}]*"sellingPrice":([\d.]+)/g;

  let match;
  const seenIds = new Set<number>();

  while ((match = productRegex.exec(html)) !== null) {
    const id = parseInt(match[3]);
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const imgUrl = match[5].replace(/\\u002F/g, '/');
    const productUrl = match[6].replace(/\\u002F/g, '/');

    products.push({
      id,
      name: match[2],
      brand: match[1],
      priceTry: parseFloat(match[7]) || 0, // discountedPrice
      originalPriceTry: parseFloat(match[8]) || 0, // sellingPrice
      imageUrl: imgUrl.startsWith('http') ? imgUrl : `https://cdn.dsmcdn.com${imgUrl}`,
      url: `https://www.trendyol.com${productUrl}`,
      categoryName: categorySlug.split('-x-c')[0].replace(/-/g, ' '),
      ratingScore: 0,
      ratingCount: 0,
      merchantName: '',
      freeShipping: false,
    });
  }

  // Try to extract rating info separately
  const ratingRegex = /"id":(\d+)[^}]*?"ratingScore":\{"averageRating":([\d.]+),"totalCount":(\d+)\}/g;
  while ((match = ratingRegex.exec(html)) !== null) {
    const id = parseInt(match[1]);
    const product = products.find(p => p.id === id);
    if (product) {
      product.ratingScore = parseFloat(match[2]);
      product.ratingCount = parseInt(match[3]);
    }
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

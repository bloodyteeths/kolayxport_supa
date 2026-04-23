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
  // --- Ev & Dekor (Home & Decor) --- (updated 2026-04-23 from Trendyol category API)
  { slug: 'havlu-x-c839', label: 'Havlu (Towels)', labelTr: 'Havlu', ebaySearch: 'Turkish towel cotton', group: 'Ev & Dekor' },
  { slug: 'bornoz-x-c2359', label: 'Bathrobes', labelTr: 'Bornoz', ebaySearch: 'Turkish cotton bathrobe', group: 'Ev & Dekor' },
  { slug: 'kilim-x-c1853', label: 'Kilim (Rugs)', labelTr: 'Kilim', ebaySearch: 'Turkish kilim rug', group: 'Ev & Dekor' },
  { slug: 'hali---kilim-x-c484', label: 'Carpets & Kilims', labelTr: 'Halı / Kilim', ebaySearch: 'Turkish carpet handwoven', group: 'Ev & Dekor' },
  { slug: 'yastik-kilifi-x-c1851', label: 'Pillow Covers', labelTr: 'Yastık Kılıfı', ebaySearch: 'Turkish pillow cover kilim', group: 'Ev & Dekor' },
  { slug: 'lambader-x-c935', label: 'Floor Lamps', labelTr: 'Lambader', ebaySearch: 'Turkish mosaic lamp', group: 'Ev & Dekor' },
  { slug: 'avize-x-c934', label: 'Chandeliers', labelTr: 'Avize', ebaySearch: 'Turkish chandelier mosaic', group: 'Ev & Dekor' },
  { slug: 'mum-ve-kandil-x-c1880', label: 'Candles', labelTr: 'Mum & Kandil', ebaySearch: 'Turkish handmade candle', group: 'Ev & Dekor' },
  { slug: 'perde-x-c1847', label: 'Curtains', labelTr: 'Perde', ebaySearch: 'Turkish curtain panel', group: 'Ev & Dekor' },
  { slug: 'nevresim-takimi-x-c492', label: 'Duvet Sets', labelTr: 'Nevresim Takımı', ebaySearch: 'Turkish cotton duvet cover set', group: 'Ev & Dekor' },
  { slug: 'masa-ortusu-x-c483', label: 'Tablecloths', labelTr: 'Masa Örtüsü', ebaySearch: 'Turkish tablecloth embroidered', group: 'Ev & Dekor' },
  { slug: 'dekoratif-obje-ve-biblo-x-c1877', label: 'Decorative Objects', labelTr: 'Dekoratif Obje', ebaySearch: 'Turkish decorative ornament', group: 'Ev & Dekor' },
  { slug: 'vazo-x-c1881', label: 'Vases', labelTr: 'Vazo', ebaySearch: 'Turkish ceramic vase handmade', group: 'Ev & Dekor' },
  { slug: 'duvar-saati-x-c2885', label: 'Wall Clocks', labelTr: 'Duvar Saati', ebaySearch: 'Turkish wall clock decorative', group: 'Ev & Dekor' },
  // --- Mutfak (Kitchen) ---
  { slug: 'tepsi-x-c2710', label: 'Serving Trays', labelTr: 'Tepsi', ebaySearch: 'Turkish serving tray copper', group: 'Mutfak' },
  { slug: 'caydanlik-x-c2424', label: 'Teapots', labelTr: 'Çaydanlık', ebaySearch: 'Turkish teapot stainless steel', group: 'Mutfak' },
  { slug: 'sahan-x-c4439', label: 'Copper Pans', labelTr: 'Sahan', ebaySearch: 'Turkish copper pan', group: 'Mutfak' },
  { slug: 'kesme-tahtasi-x-c2137', label: 'Cutting Boards', labelTr: 'Kesme Tahtası', ebaySearch: 'Turkish olive wood cutting board', group: 'Mutfak' },
  // --- Takı & Aksesuar (Jewelry & Accessories) ---
  { slug: 'gumus-kolye-x-c1247', label: 'Silver Necklaces', labelTr: 'Gümüş Kolye', ebaySearch: 'Turkish silver necklace 925', group: 'Takı & Aksesuar' },
  { slug: 'gumus-yuzuk-x-c1259', label: 'Silver Rings', labelTr: 'Gümüş Yüzük', ebaySearch: 'Turkish silver ring men women', group: 'Takı & Aksesuar' },
  { slug: 'gumus-bileklik-x-c1239', label: 'Silver Bracelets', labelTr: 'Gümüş Bileklik', ebaySearch: 'Turkish silver bracelet', group: 'Takı & Aksesuar' },
  { slug: 'gumus-kupe-x-c1255', label: 'Silver Earrings', labelTr: 'Gümüş Küpe', ebaySearch: 'Turkish silver earrings', group: 'Takı & Aksesuar' },
  { slug: 'gumus-halhal-x-c3499', label: 'Silver Anklets', labelTr: 'Gümüş Halhal', ebaySearch: 'Turkish anklet silver', group: 'Takı & Aksesuar' },
  { slug: 'bros-x-c2874', label: 'Brooches', labelTr: 'Broş', ebaySearch: 'Turkish brooch vintage', group: 'Takı & Aksesuar' },
  { slug: 'anahtarlik-x-c2840', label: 'Keychains', labelTr: 'Anahtarlık', ebaySearch: 'Turkish evil eye keychain', group: 'Takı & Aksesuar' },
  // --- Tekstil & Çanta (Textile & Bags) ---
  { slug: 'el-cantasi-x-c2197', label: 'Handbags', labelTr: 'El Çantası', ebaySearch: 'Turkish handbag women', group: 'Tekstil' },
  { slug: 'cuzdan-x-c1806', label: 'Wallets', labelTr: 'Cüzdan', ebaySearch: 'Turkish leather wallet', group: 'Tekstil' },
  { slug: 'sirt-cantasi-x-c448', label: 'Backpacks', labelTr: 'Sırt Çantası', ebaySearch: 'Turkish leather backpack', group: 'Tekstil' },
  { slug: 'fular-x-c392', label: 'Shawls', labelTr: 'Fular', ebaySearch: 'Turkish pashmina shawl', group: 'Tekstil' },
  // --- Yiyecek (Food & Gourmet) ---
  { slug: 'lokum-x-c1463', label: 'Turkish Delight', labelTr: 'Lokum', ebaySearch: 'Turkish delight lokum', group: 'Yiyecek' },
  { slug: 'baharat-x-c1428', label: 'Spices', labelTr: 'Baharat', ebaySearch: 'Turkish spice set', group: 'Yiyecek' },
  { slug: 'zeytinyagi-x-c3541', label: 'Olive Oil', labelTr: 'Zeytinyağı', ebaySearch: 'Turkish olive oil', group: 'Yiyecek' },
  { slug: 'kuru-meyve-x-c5038', label: 'Dried Fruits', labelTr: 'Kuru Meyve', ebaySearch: 'Turkish dried fruit mix', group: 'Yiyecek' },
  { slug: 'baklava-x-c5632', label: 'Baklava', labelTr: 'Baklava', ebaySearch: 'Turkish baklava', group: 'Yiyecek' },
  { slug: 'helva-x-c1450', label: 'Halva', labelTr: 'Helva', ebaySearch: 'Turkish halva sesame', group: 'Yiyecek' },
  { slug: 'turk-kahvesi-x-c2399', label: 'Turkish Coffee', labelTr: 'Türk Kahvesi', ebaySearch: 'Turkish coffee ground', group: 'Yiyecek' },
  { slug: 'kuruyemis-x-c5046', label: 'Nuts', labelTr: 'Kuruyemiş', ebaySearch: 'Turkish pistachios hazelnuts', group: 'Yiyecek' },
  // --- Hediyelik (Gifts & Souvenirs) ---
  { slug: 'magnet-x-c4764', label: 'Magnets', labelTr: 'Magnet', ebaySearch: 'Turkish fridge magnet souvenir', group: 'Hediyelik' },
];

/**
 * Trendyol category node from the public categories API.
 */
export interface TrendyolCategoryTreeNode {
  id: number;
  name: string;
  parentId?: number;
  subCategories?: TrendyolCategoryTreeNode[];
}

export interface FlatCategory {
  id: number;
  name: string;
  slug: string;
  parentId?: number;
  parentPath: string; // e.g. "Ev & Mobilya > Ev Tekstili > Havlu"
  depth: number;
}

// In-memory cache for the full category tree (refreshes every 24h)
let cachedCategoryTree: FlatCategory[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch all Trendyol categories from the public API.
 * Returns ~3800 leaf categories with full parent paths.
 * No authentication required.
 */
export async function fetchTrendyolCategoryTree(): Promise<FlatCategory[]> {
  // Return cached if fresh
  if (cachedCategoryTree && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return cachedCategoryTree;
  }

  try {
    const res = await fetch('https://apigw.trendyol.com/integration/product/product-categories', {
      headers: {
        'User-Agent': 'KolayXport/1.0',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const categories = data?.categories;
    if (!Array.isArray(categories) || categories.length === 0) {
      throw new Error('Empty categories response');
    }

    const flat: FlatCategory[] = [];
    flattenTree(categories, flat, '', 0);

    cachedCategoryTree = flat;
    cacheTimestamp = Date.now();
    return flat;
  } catch (err) {
    // Fallback to hardcoded categories
    console.warn('Failed to fetch Trendyol category tree, using hardcoded fallback:', err);
    return TRENDYOL_CATEGORIES.map(cat => ({
      id: parseInt(cat.slug.split('-x-c')[1] || '0'),
      name: cat.labelTr,
      slug: cat.slug,
      parentPath: cat.group,
      depth: 1,
    }));
  }
}

function flattenTree(
  nodes: TrendyolCategoryTreeNode[],
  result: FlatCategory[],
  parentPath: string,
  depth: number
): void {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath} > ${node.name}` : node.name;
    const hasChildren = node.subCategories && node.subCategories.length > 0;

    // Build slug from name + id
    const slug = buildCategorySlug(node.name, node.id);

    // Add all categories (both parent and leaf) so users can browse any level
    result.push({
      id: node.id,
      name: node.name,
      slug,
      parentId: node.parentId,
      parentPath: path,
      depth,
    });

    if (hasChildren) {
      flattenTree(node.subCategories!, result, path, depth + 1);
    }
  }
}

function buildCategorySlug(name: string, id: number): string {
  const slugified = name
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/&/g, '-ve-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slugified}-x-c${id}`;
}

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
  let url = page > 1
    ? `https://www.trendyol.com/${categorySlug}?pi=${page}`
    : `https://www.trendyol.com/${categorySlug}`;

  const HEADERS = {
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

  // First request with manual redirect to detect slug changes
  let res = await fetch(url, { headers: HEADERS, redirect: 'manual' });

  // If Trendyol redirects (301/302), the slug prefix changed.
  // Extract the category ID from our slug to verify the redirect is for the same category.
  if (res.status === 301 || res.status === 302) {
    const location = res.headers.get('location');
    const ourCategoryId = categorySlug.match(/-x-c(\d+)/)?.[1];
    if (location && ourCategoryId && location.includes(`-x-c${ourCategoryId}`)) {
      // Same category ID, just slug prefix changed — follow it
      url = location.startsWith('http') ? location : `https://www.trendyol.com${location}`;
      res = await fetch(url, { headers: HEADERS });
    } else {
      // Redirect goes to a different category — skip to avoid wrong data
      throw new Error(`Trendyol category slug "${categorySlug}" redirects to a different category (${location}). Slug is stale.`);
    }
  }

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

    // Extract social proof data (favorites, orders, views, basket count)
    const socialProof: Record<string, string> = {};
    if (Array.isArray(p.socialProof)) {
      for (const sp of p.socialProof) {
        if (sp.key && sp.value) socialProof[sp.key] = sp.value;
      }
    }

    // Extract images array
    const imageUrls = Array.isArray(p.images)
      ? p.images.map((img: string) => {
          const cleaned = img.replace(/\\u002F/g, '/');
          return cleaned.startsWith('http') ? cleaned : `https://cdn.dsmcdn.com${cleaned}`;
        })
      : [];

    // Extract seller badge type
    let sellerBadgeType: string | undefined;
    if (p.badges) {
      const badgeEntry = Object.values(p.badges)[0] as any;
      if (badgeEntry?.type) sellerBadgeType = badgeEntry.type;
    }
    if (!sellerBadgeType && p.stripBadge?.type) {
      sellerBadgeType = p.stripBadge.type;
    }

    // Extract product card attributes
    const productAttributes = Array.isArray(p.productCardAttributes?.attributes)
      ? p.productCardAttributes.attributes.map((a: any) => ({
          attributeName: a.attributeName || '',
          attributeValueName: a.attributeValueName || '',
        }))
      : undefined;

    products.push({
      id,
      name: p.name || '',
      brand: p.brand || '',
      brandId: p.brandId || undefined,
      priceTry: discountedPrice,
      originalPriceTry: originalPrice,
      imageUrl: imgUrl.startsWith('http') ? imgUrl : `https://cdn.dsmcdn.com${imgUrl}`,
      images: imageUrls.length > 0 ? imageUrls : undefined,
      url: productUrl.startsWith('http') ? productUrl : `https://www.trendyol.com${productUrl}`,
      categoryName: p.category?.name || categorySlug.split('-x-c')[0].replace(/-/g, ' '),
      categoryId: p.category?.id || undefined,
      ratingScore: p.ratingScore?.averageRating || 0,
      ratingCount: p.ratingScore?.totalCount || 0,
      merchantName: '', // Not available in category listing HTML
      merchantId: p.merchantId || undefined,
      freeShipping: p.freeCargo || false,
      // Social proof
      favoriteCount: socialProof.favoriteCount || undefined,
      orderCount: socialProof.orderCount || undefined,
      basketCount: socialProof.basketCount || undefined,
      pageViewCount: socialProof.pageViewCount || undefined,
      // Badges & delivery
      rushDelivery: p.rushDelivery || false,
      sameDayShipping: p.sameDayShipping || false,
      hasOfficialSellerBadge: p.hasOfficialSellerBadge || false,
      sellerBadgeType,
      // Variant info
      groupId: p.groupId || undefined,
      variantValue: p.variantValue || undefined,
      // Attributes
      productAttributes,
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
  maxPerCategory = 100
): Promise<{ products: TrendyolProduct[]; totalCount: number }> {
  const allProducts: TrendyolProduct[] = [];

  for (const slug of categorySlugs) {
    const seenIds = new Set<number>();
    let page = 1;
    let collected = 0;

    while (collected < maxPerCategory && page <= 10) {
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

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
  // --- Ev & Dekor (Home & Decor) ---
  { slug: 'havlu-x-c104073', label: 'Havlu (Towels)', labelTr: 'Havlu', ebaySearch: 'Turkish towel cotton', group: 'Ev & Dekor' },
  { slug: 'pestemal-x-c104074', label: 'Peshtemal (Hammam Towel)', labelTr: 'Peştemal', ebaySearch: 'Turkish peshtemal towel hammam', group: 'Ev & Dekor' },
  { slug: 'bornoz-x-c103825', label: 'Bathrobes', labelTr: 'Bornoz', ebaySearch: 'Turkish cotton bathrobe', group: 'Ev & Dekor' },
  { slug: 'kilim-x-c104037', label: 'Kilim (Rugs)', labelTr: 'Kilim', ebaySearch: 'Turkish kilim rug', group: 'Ev & Dekor' },
  { slug: 'yastik-kilifi-x-c104063', label: 'Pillow Covers', labelTr: 'Yastık Kılıfı', ebaySearch: 'Turkish pillow cover kilim', group: 'Ev & Dekor' },
  { slug: 'lamba-x-c104155', label: 'Lamps', labelTr: 'Lamba', ebaySearch: 'Turkish mosaic lamp', group: 'Ev & Dekor' },
  { slug: 'mum-x-c104141', label: 'Candles', labelTr: 'Mum', ebaySearch: 'Turkish handmade candle', group: 'Ev & Dekor' },
  { slug: 'perde-x-c104041', label: 'Curtains', labelTr: 'Perde', ebaySearch: 'Turkish curtain panel', group: 'Ev & Dekor' },
  { slug: 'hali-x-c104036', label: 'Carpets', labelTr: 'Halı', ebaySearch: 'Turkish carpet handwoven', group: 'Ev & Dekor' },
  { slug: 'nevresim-takimi-x-c104057', label: 'Duvet Sets', labelTr: 'Nevresim Takımı', ebaySearch: 'Turkish cotton duvet cover set', group: 'Ev & Dekor' },
  { slug: 'masa-ortusu-x-c104067', label: 'Tablecloths', labelTr: 'Masa Örtüsü', ebaySearch: 'Turkish tablecloth embroidered', group: 'Ev & Dekor' },
  { slug: 'dekoratif-obje-x-c104147', label: 'Decorative Objects', labelTr: 'Dekoratif Obje', ebaySearch: 'Turkish decorative ornament', group: 'Ev & Dekor' },
  { slug: 'vazo-x-c104149', label: 'Vases', labelTr: 'Vazo', ebaySearch: 'Turkish ceramic vase handmade', group: 'Ev & Dekor' },
  { slug: 'duvar-saati-x-c104143', label: 'Wall Clocks', labelTr: 'Duvar Saati', ebaySearch: 'Turkish wall clock decorative', group: 'Ev & Dekor' },
  // --- Mutfak (Kitchen) ---
  { slug: 'seramik-tabak-x-c104209', label: 'Ceramic Plates', labelTr: 'Seramik Tabak', ebaySearch: 'Turkish ceramic plate hand painted', group: 'Mutfak' },
  { slug: 'seramik-kase-x-c104210', label: 'Ceramic Bowls', labelTr: 'Seramik Kase', ebaySearch: 'Turkish ceramic bowl hand painted', group: 'Mutfak' },
  { slug: 'cam-bardak-x-c104216', label: 'Glass Cups', labelTr: 'Cam Bardak', ebaySearch: 'Turkish tea glass set', group: 'Mutfak' },
  { slug: 'cay-bardagi-x-c104217', label: 'Tea Glasses', labelTr: 'Çay Bardağı', ebaySearch: 'Turkish tea glass set', group: 'Mutfak' },
  { slug: 'bakir-cezve-x-c104262', label: 'Copper Coffee Pot', labelTr: 'Bakır Cezve', ebaySearch: 'Turkish copper coffee pot cezve', group: 'Mutfak' },
  { slug: 'turk-kahvesi-seti-x-c103760', label: 'Turkish Coffee Set', labelTr: 'Türk Kahvesi Seti', ebaySearch: 'Turkish coffee cup set', group: 'Mutfak' },
  { slug: 'fincan-takimi-x-c104218', label: 'Cup Sets', labelTr: 'Fincan Takımı', ebaySearch: 'Turkish espresso cup set', group: 'Mutfak' },
  { slug: 'sahan-x-c104223', label: 'Copper Pans', labelTr: 'Sahan', ebaySearch: 'Turkish copper pan', group: 'Mutfak' },
  { slug: 'tepsi-x-c104224', label: 'Serving Trays', labelTr: 'Tepsi', ebaySearch: 'Turkish serving tray copper', group: 'Mutfak' },
  { slug: 'yemek-takimi-x-c104208', label: 'Dinnerware Sets', labelTr: 'Yemek Takımı', ebaySearch: 'Turkish dinnerware set ceramic', group: 'Mutfak' },
  { slug: 'caydanlik-x-c104220', label: 'Teapots', labelTr: 'Çaydanlık', ebaySearch: 'Turkish teapot stainless steel', group: 'Mutfak' },
  { slug: 'kesme-tahtasi-x-c104230', label: 'Cutting Boards', labelTr: 'Kesme Tahtası', ebaySearch: 'Turkish olive wood cutting board', group: 'Mutfak' },
  // --- Takı & Aksesuar (Jewelry & Accessories) ---
  { slug: 'nazar-boncugu-x-c104271', label: 'Evil Eye Jewelry', labelTr: 'Nazar Boncuğu', ebaySearch: 'evil eye nazar jewelry Turkish', group: 'Takı & Aksesuar' },
  { slug: 'taki-seti-x-c104256', label: 'Jewelry Sets', labelTr: 'Takı Seti', ebaySearch: 'Turkish jewelry set ottoman', group: 'Takı & Aksesuar' },
  { slug: 'halhal-x-c104260', label: 'Anklets', labelTr: 'Halhal', ebaySearch: 'Turkish anklet gold silver', group: 'Takı & Aksesuar' },
  { slug: 'kolye-x-c104250', label: 'Necklaces', labelTr: 'Kolye', ebaySearch: 'Turkish necklace pendant', group: 'Takı & Aksesuar' },
  { slug: 'bileklik-x-c104253', label: 'Bracelets', labelTr: 'Bileklik', ebaySearch: 'Turkish bracelet handmade', group: 'Takı & Aksesuar' },
  { slug: 'yuzuk-x-c104251', label: 'Rings', labelTr: 'Yüzük', ebaySearch: 'Turkish ring silver ottoman', group: 'Takı & Aksesuar' },
  { slug: 'kupe-x-c104252', label: 'Earrings', labelTr: 'Küpe', ebaySearch: 'Turkish earrings handmade', group: 'Takı & Aksesuar' },
  { slug: 'bros-x-c104258', label: 'Brooches', labelTr: 'Broş', ebaySearch: 'Turkish brooch vintage', group: 'Takı & Aksesuar' },
  { slug: 'gumus-kolye-x-c104279', label: 'Silver Necklaces', labelTr: 'Gümüş Kolye', ebaySearch: 'Turkish silver necklace 925', group: 'Takı & Aksesuar' },
  { slug: 'gumus-yuzuk-x-c104280', label: 'Silver Rings', labelTr: 'Gümüş Yüzük', ebaySearch: 'Turkish silver ring men women', group: 'Takı & Aksesuar' },
  // --- Tekstil & Çanta (Textile & Bags) ---
  { slug: 'deri-canta-x-c103891', label: 'Leather Bags', labelTr: 'Deri Çanta', ebaySearch: 'Turkish leather bag handmade', group: 'Tekstil' },
  { slug: 'ipek-sal-x-c103863', label: 'Silk Scarves', labelTr: 'İpek Şal', ebaySearch: 'Turkish silk scarf', group: 'Tekstil' },
  { slug: 'pamuklu-atki-x-c103865', label: 'Cotton Scarves', labelTr: 'Pamuklu Atkı', ebaySearch: 'Turkish cotton scarf', group: 'Tekstil' },
  { slug: 'fular-x-c103864', label: 'Shawls', labelTr: 'Fular', ebaySearch: 'Turkish pashmina shawl', group: 'Tekstil' },
  { slug: 'el-cantasi-x-c103890', label: 'Handbags', labelTr: 'El Çantası', ebaySearch: 'Turkish handbag women', group: 'Tekstil' },
  { slug: 'cuzdan-x-c103897', label: 'Wallets', labelTr: 'Cüzdan', ebaySearch: 'Turkish leather wallet', group: 'Tekstil' },
  { slug: 'sirt-cantasi-x-c103893', label: 'Backpacks', labelTr: 'Sırt Çantası', ebaySearch: 'Turkish leather backpack', group: 'Tekstil' },
  // --- Yiyecek (Food & Gourmet) ---
  { slug: 'lokum-x-c104301', label: 'Turkish Delight', labelTr: 'Lokum', ebaySearch: 'Turkish delight lokum', group: 'Yiyecek' },
  { slug: 'baharat-x-c103966', label: 'Spices', labelTr: 'Baharat', ebaySearch: 'Turkish spice set', group: 'Yiyecek' },
  { slug: 'zeytinyagi-x-c103955', label: 'Olive Oil', labelTr: 'Zeytinyağı', ebaySearch: 'Turkish olive oil', group: 'Yiyecek' },
  { slug: 'kuru-meyve-x-c103968', label: 'Dried Fruits', labelTr: 'Kuru Meyve', ebaySearch: 'Turkish dried fruit mix', group: 'Yiyecek' },
  { slug: 'baklava-x-c104303', label: 'Baklava', labelTr: 'Baklava', ebaySearch: 'Turkish baklava', group: 'Yiyecek' },
  { slug: 'helva-x-c104302', label: 'Halva', labelTr: 'Helva', ebaySearch: 'Turkish halva sesame', group: 'Yiyecek' },
  { slug: 'pestil-x-c103970', label: 'Fruit Leather', labelTr: 'Pestil', ebaySearch: 'Turkish fruit leather pestil', group: 'Yiyecek' },
  { slug: 'turk-cayi-x-c103957', label: 'Turkish Tea', labelTr: 'Türk Çayı', ebaySearch: 'Turkish black tea', group: 'Yiyecek' },
  { slug: 'turk-kahvesi-x-c103958', label: 'Turkish Coffee', labelTr: 'Türk Kahvesi', ebaySearch: 'Turkish coffee ground', group: 'Yiyecek' },
  { slug: 'kuruyemis-x-c103967', label: 'Nuts', labelTr: 'Kuruyemiş', ebaySearch: 'Turkish pistachios hazelnuts', group: 'Yiyecek' },
  // --- Kozmetik & Bakım (Beauty & Care) ---
  { slug: 'el-yapimi-sabun-x-c104389', label: 'Handmade Soap', labelTr: 'El Yapımı Sabun', ebaySearch: 'Turkish handmade soap natural', group: 'Kozmetik' },
  { slug: 'argan-yagi-x-c104375', label: 'Argan Oil', labelTr: 'Argan Yağı', ebaySearch: 'argan oil pure natural', group: 'Kozmetik' },
  { slug: 'gul-suyu-x-c104376', label: 'Rose Water', labelTr: 'Gül Suyu', ebaySearch: 'Turkish rose water natural', group: 'Kozmetik' },
  { slug: 'kese-x-c104385', label: 'Bath Mitt (Kese)', labelTr: 'Kese', ebaySearch: 'Turkish bath mitt kese hammam', group: 'Kozmetik' },
  { slug: 'hamam-seti-x-c104386', label: 'Hammam Set', labelTr: 'Hamam Seti', ebaySearch: 'Turkish hammam bath set', group: 'Kozmetik' },
  { slug: 'dogal-sabun-x-c104388', label: 'Natural Soap', labelTr: 'Doğal Sabun', ebaySearch: 'Turkish natural olive oil soap', group: 'Kozmetik' },
  { slug: 'masaj-yagi-x-c104377', label: 'Massage Oil', labelTr: 'Masaj Yağı', ebaySearch: 'Turkish massage oil natural', group: 'Kozmetik' },
  // --- Hediyelik (Gifts & Souvenirs) ---
  { slug: 'magnet-x-c104148', label: 'Magnets', labelTr: 'Magnet', ebaySearch: 'Turkish fridge magnet souvenir', group: 'Hediyelik' },
  { slug: 'anahtar-ligi-x-c104270', label: 'Keychains', labelTr: 'Anahtarlık', ebaySearch: 'Turkish evil eye keychain', group: 'Hediyelik' },
  { slug: 'el-sanatlari-x-c104160', label: 'Handcrafts', labelTr: 'El Sanatları', ebaySearch: 'Turkish handcraft artisan', group: 'Hediyelik' },
  { slug: 'hat-sanati-x-c104163', label: 'Calligraphy Art', labelTr: 'Hat Sanatı', ebaySearch: 'Turkish Islamic calligraphy art', group: 'Hediyelik' },
  { slug: 'ebru-sanati-x-c104164', label: 'Marbling Art', labelTr: 'Ebru Sanatı', ebaySearch: 'Turkish marbling art ebru', group: 'Hediyelik' },
  { slug: 'seramik-cini-x-c104165', label: 'Iznik Ceramics', labelTr: 'Çini', ebaySearch: 'Turkish Iznik tile ceramic', group: 'Hediyelik' },
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

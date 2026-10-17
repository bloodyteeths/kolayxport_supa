/**
 * KolayXport Research — Shared Content Script Utilities
 * Shadow DOM overlay injection, URL change observer, DOM selectors, inline helpers
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
console.log('[KX-shared] loading content-shared.js');
const KX_PREFIX = 'kx-research';
const API_BASE = 'https://kolayxport.com';

// ---------------------------------------------------------------------------
// Inline CSS (injected into page DOM for data rows & stats bars)
// ---------------------------------------------------------------------------
const KX_INLINE_CSS = `
.kx-data-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 8px; font-size: 11px; font-weight: 600;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5fa; border-top: 1px solid #e8e8ee; color: #555;
  line-height: 1.4;
}
.kx-data-row .kx-sep { color: #ccc; font-weight: 400; }
.kx-data-row .kx-best { color: #b8860b; }
.kx-data-row .kx-green { color: #2e7d32; }
.kx-data-row .kx-orange { color: #e65100; }
.kx-data-row .kx-red { color: #c62828; }
.kx-data-row .kx-mini-badge {
  display: inline-block; padding: 0 5px; border-radius: 8px; font-size: 9px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.6;
}
.kx-data-row .kx-mini-measured { background: #e8f5e9; color: #1b5e20; border: 1px solid #a5d6a7; }
.kx-data-row .kx-mini-estimated { background: #fff3e0; color: #e65100; border: 1px solid #ffcc80; }
.kx-data-row .kx-mini-none { background: #eee; color: #777; border: 1px solid #ddd; }
.kx-stats-bar {
  background: #f5f5fa; border: 1px solid #e0e0e8; border-radius: 8px;
  padding: 10px 14px; margin: 10px 0; font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #444; line-height: 1.6;
}
.kx-stats-bar .kx-stats-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  font-weight: 700; font-size: 13px; color: #333;
}
.kx-stats-bar .kx-stats-logo {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;
}
.kx-stats-bar .kx-stats-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.kx-stats-bar .kx-sep { color: #ccc; }
.kx-stats-bar .kx-best { color: #b8860b; font-weight: 700; }
.kx-stats-bar .kx-green { color: #2e7d32; }
.kx-stats-bar .kx-orange { color: #e65100; }
.kx-stats-bar .kx-red { color: #c62828; }
.kx-stats-bar .kx-seo-bar {
  display: inline-flex; align-items: center; gap: 4px;
}
.kx-stats-bar .kx-seo-track {
  width: 60px; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;
  display: inline-block; vertical-align: middle;
}
.kx-stats-bar .kx-seo-fill {
  height: 100%; border-radius: 3px;
}
.kx-stats-bar .kx-tag-pill {
  display: inline-block; padding: 1px 6px; margin: 1px; border-radius: 10px;
  font-size: 10px; background: #eee; color: #555;
}
.kx-stats-bar .kx-collapse-btn {
  background: none; border: none; cursor: pointer; font-size: 11px; color: #667eea;
  font-weight: 600; padding: 0; margin-left: auto;
}
.kx-stats-bar .kx-metrics-grid {
  display: flex; flex-wrap: wrap; gap: 2px;
}
.kx-stats-bar .kx-metric {
  display: inline-flex; flex-direction: column; align-items: center;
  padding: 4px 10px; background: #fff; border-radius: 6px;
  border: 1px solid #e8e8ee; min-width: 54px;
}
.kx-stats-bar .kx-metric-label {
  font-size: 9px; color: #888; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.3px; line-height: 1;
}
.kx-stats-bar .kx-metric > span:last-child {
  font-size: 13px; line-height: 1.3;
}
.kx-stats-bar .kx-sales {
  background: #fff; border: 1px solid #e8e8ee; border-radius: 6px; padding: 8px 10px; margin-bottom: 6px;
}
.kx-stats-bar .kx-sales-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kx-stats-bar .kx-sales-value { font-size: 16px; font-weight: 800; color: #222; }
.kx-stats-bar .kx-sales-rev { font-size: 12px; font-weight: 700; color: #1565c0; }
.kx-stats-bar .kx-badge {
  display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.3px; text-transform: uppercase; line-height: 1.6;
}
.kx-stats-bar .kx-badge-measured { background: #e8f5e9; color: #1b5e20; border: 1px solid #a5d6a7; }
.kx-stats-bar .kx-badge-estimated { background: #fff3e0; color: #e65100; border: 1px solid #ffcc80; }
.kx-stats-bar .kx-badge-none { background: #eee; color: #666; border: 1px solid #ddd; }
.kx-stats-bar .kx-badge-conf { background: #f3f3f8; color: #555; border: 1px solid #e0e0e8; text-transform: none; font-weight: 600; }
.kx-stats-bar .kx-sales-how { font-size: 11px; color: #666; margin-top: 4px; line-height: 1.45; }
.kx-stats-bar .kx-sales-meta { font-size: 10px; color: #999; margin-top: 3px; }
.kx-stats-bar .kx-signal { color: #1b5e20; }
`;

function injectInlineCSS() {
  if (document.getElementById('kx-inline-css')) return;
  const style = document.createElement('style');
  style.id = 'kx-inline-css';
  style.textContent = KX_INLINE_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Shadow DOM Container (for summary bar only)
// ---------------------------------------------------------------------------
function createOverlayContainer(id, position = 'top') {
  const existing = document.getElementById(id);
  if (existing) return existing.shadowRoot;

  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all: initial; position: relative; z-index: 9999;';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .kx-bar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff; padding: 8px 16px; display: flex; align-items: center; gap: 12px;
      font-size: 13px; flex-wrap: wrap; border-radius: 8px; margin: 8px;
      box-shadow: 0 2px 12px rgba(102,126,234,0.3);
    }
    .kx-bar-item { display: flex; align-items: center; gap: 4px; }
    .kx-bar-label { opacity: 0.8; font-size: 11px; }
    .kx-bar-value { font-weight: 700; font-size: 14px; }
    .kx-bar-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.3); }
    .kx-btn {
      display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px;
      border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff;
      transition: opacity 0.2s;
    }
    .kx-btn:hover { opacity: 0.9; }
    .kx-btn-sm { padding: 3px 8px; font-size: 11px; }
    .kx-panel {
      position: fixed; top: 80px; right: 0; width: 320px; max-height: calc(100vh - 100px);
      background: #fff; border-left: 1px solid #e0e0e0; box-shadow: -4px 0 20px rgba(0,0,0,0.1);
      overflow-y: auto; z-index: 10000; font-size: 13px;
    }
    .kx-panel-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 1;
    }
    .kx-panel-body { padding: 12px 16px; }
    .kx-panel-section { margin-bottom: 12px; }
    .kx-panel-section-title { font-weight: 700; font-size: 12px; color: #667eea; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kx-metric { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
    .kx-metric-label { color: #666; font-size: 12px; }
    .kx-metric-value { font-weight: 700; font-size: 13px; }
    .kx-loading { text-align: center; padding: 20px; color: #999; }
    .kx-shop-bar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff; padding: 10px 20px; display: flex; align-items: center; gap: 16px;
      font-size: 13px; flex-wrap: wrap; margin: 0; border-radius: 0;
    }
  `;
  shadow.appendChild(style);

  if (position === 'top') {
    document.body.prepend(host);
  } else {
    document.body.appendChild(host);
  }

  return shadow;
}

// ---------------------------------------------------------------------------
// URL Change Observer (SPA navigation)
// ---------------------------------------------------------------------------
let _lastUrl = location.href;
const _urlCallbacks = [];

function onUrlChange(callback) {
  _urlCallbacks.push(callback);
}

const _urlObserver = new MutationObserver(() => {
  if (location.href !== _lastUrl) {
    const oldUrl = _lastUrl;
    _lastUrl = location.href;
    _urlCallbacks.forEach(cb => cb(_lastUrl, oldUrl));
  }
});
_urlObserver.observe(document.body, { childList: true, subtree: true });

window.addEventListener('popstate', () => {
  if (location.href !== _lastUrl) {
    const oldUrl = _lastUrl;
    _lastUrl = location.href;
    _urlCallbacks.forEach(cb => cb(_lastUrl, oldUrl));
  }
});

// ---------------------------------------------------------------------------
// DOM Selectors
// ---------------------------------------------------------------------------
const SELECTORS = {
  searchResultsGrid: '[data-search-results], .search-listings-group, .wt-grid',
  searchResultCard: '[data-listing-id], .v2-listing-card, .listing-link',
  searchResultLink: 'a[href*="/listing/"]',
  searchQuery: () => {
    const params = new URLSearchParams(location.search);
    return params.get('q') || params.get('search_query') || '';
  },
  listingId: () => {
    const match = location.pathname.match(/\/listing\/(\d+)/);
    return match ? match[1] : null;
  },
  shopName: () => {
    const match = location.pathname.match(/\/shop\/([^/?#]+)/);
    return match ? match[1] : null;
  },
  shopId: () => {
    const meta = document.querySelector('meta[property="og:url"]');
    const content = meta?.getAttribute('content') || '';
    const match = content.match(/shop\/([^/?#]+)/);
    return match ? match[1] : null;
  },
};

// ---------------------------------------------------------------------------
// API Communication (via background script)
// ---------------------------------------------------------------------------
async function apiCall(action, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'kx_research', action, params },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      }
    );
  });
}

async function listingStatsCall(listingId, page) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'kx_listing_stats', params: { listingId, page } },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          const err = new Error(response.error);
          err.status = response.status;
          reject(err);
          return;
        }
        resolve(response);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatNum(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatPrice(n) {
  return '$' + Number(n).toFixed(2);
}

function competitionColor(level) {
  if (level === 'low') return '#4caf50';
  if (level === 'medium') return '#ff9800';
  return '#f44336';
}

function scoreClass(score) {
  if (score >= 70) return 'kx-green';
  if (score >= 40) return 'kx-orange';
  return 'kx-red';
}

function salesColor(est) {
  if (est >= 5) return 'kx-green';
  if (est >= 1) return 'kx-orange';
  return 'kx-red';
}

// ---------------------------------------------------------------------------
// Best Seller Computation
// ---------------------------------------------------------------------------
function computeBestSellerRanks(badges) {
  const entries = Object.entries(badges || {});
  if (entries.length === 0) return {};

  // Sort by estimated monthly sales descending, then by favorites
  const sorted = entries.sort((a, b) => {
    const salesDiff = (b[1].estMonthlySales || 0) - (a[1].estMonthlySales || 0);
    if (salesDiff !== 0) return salesDiff;
    return (b[1].favorites || 0) - (a[1].favorites || 0);
  });

  const total = sorted.length;
  const ranks = {};
  sorted.forEach(([id], index) => {
    const rank = index + 1;
    const percentile = Math.round((rank / total) * 100);
    ranks[id] = { rank, total, percentile, isBestSeller: percentile <= 10 };
  });
  return ranks;
}

// ---------------------------------------------------------------------------
// Settings Check
// ---------------------------------------------------------------------------
async function isOverlayEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get('kx_overlays_enabled', (result) => {
      resolve(result.kx_overlays_enabled !== false); // default true
    });
  });
}

// ---------------------------------------------------------------------------
// i18n — Turkish / English
// ---------------------------------------------------------------------------
const _lang = (() => {
  try { return chrome.i18n.getUILanguage().startsWith('tr') ? 'tr' : 'en'; }
  catch { return (navigator.language || '').startsWith('tr') ? 'tr' : 'en'; }
})();

const _i18n = {
  tr: {
    loading: 'KolayXport yükleniyor...',
    loadFailed: 'Veri yüklenemedi',
    result: 'Sonuç',
    avgPrice: 'Ort. Fiyat',
    range: 'Aralık',
    avgFav: 'Ort. Fav',
    shops: 'Mağaza',
    sellers: 'Satıcı',
    competition: 'Rekabet',
    compLow: 'Düşük',
    compMed: 'Orta',
    compHigh: 'Yüksek',
    fullAnalysis: 'Tam Analiz',
    perMonth: '/ay',
    bestSeller: 'En Çok Satan',
    seo: 'SEO',
    sales: 'satış',
    views: 'görüntülenme',
    months: 'ay',
    tags: 'Tagler',
    missing: 'eksik',
    shop: 'Mağaza',
    price: 'Fiyat',
    positive: 'olumlu',
    products: 'ürün',
    topSales: 'Toplam Satış',
    rating: 'Puan',
    reviews: 'Yorum',
    activeListings: 'Aktif Ürün',
    bestSellers: 'Best Sellers',
    shopAnalysisLoading: 'KolayXport mağaza analizi yükleniyor...',
    shopIdNotFound: 'Mağaza ID bulunamadı',
    estRevenue: 'Tah. Gelir',
    estRevenueShort: 'Gelir',
    demand: 'Talep',
    demandHot: '🔥 Çok Yüksek',
    demandGood: '📈 İyi',
    demandModerate: '📊 Orta',
    demandLow: '📉 Düşük',
    convRate: 'Dönüşüm',
    engRate: 'Etkileşim',
    favsDay: ' fav/gün',
    totalSales: 'toplam satış',
    fromReviews: 'yorumdan',
    fromFavs: 'favorilerden',
    lowStock: '🔥 Az Stok',
    estMktRevenue: 'Tah. Pazar Geliri',
    shopAge: 'Mağaza Yaşı',
    years: 'yıl',
    estShopRevenue: 'Tah. Aylık Gelir',
    estShopSales: 'Tah. Aylık Satış',
    hotListings: 'Sıcak Ürünler',
    lowStockItems: 'Az Stok',
    avgConversion: 'Ort. Dönüşüm',
    revenuePerListing: 'Ürün Başına Gelir',
    salesPerMonth: 'satış/ay',
    badgeMeasured: 'Ölçüldü',
    badgeEstimated: 'Tahmin',
    badgeInsufficient: 'Yetersiz veri',
    confHigh: 'Güven: yüksek',
    confMedium: 'Güven: orta',
    confLow: 'Güven: düşük',
    revenueApprox: 'gelir/ay (tahmini)',
    lessThan: '<',
    howMeasured: 'Mağaza satışları {days} günde +{delta} arttı (Etsy API, {perDay}/gün). Bu ürün mağazanın son {window} gündeki yorumlarının %{share}\'ine sahip ({mine}/{total}).',
    howMeasuredLifetime: 'Mağaza satışları {days} günde +{delta} arttı (Etsy API, {perDay}/gün). Ürün payı tüm zamanların yorumlarından: %{share} ({mine}/{total}).',
    howEstimated: 'Bu ürün son {window} günde {recent} yorum aldı × bu mağazanın gerçek satış/yorum oranı {ratio} ({sold} satış / {reviews} yorum).',
    howEstimatedNone: 'Bu ürün son {window} günde hiç yorum almadı. Mağazanın satış/yorum oranı {ratio} ile aylık satış muhtemelen {upper}\'in altında.',
    howInsufficient: 'Satış hesaplamak için yeterli gerçek veri yok (mağazada yeterli yorum yok). Tahmin göstermiyoruz.',
    howShopOnly: 'Ölçülen mağaza hızı: {days} günde +{delta} satış ({perDay}/gün, Etsy API). Bu ürüne pay atamak için yeterli yorum yok.',
    measuredAfter: 'Ölçülen değer, bu mağaza için ilk kayıttan 24 saat sonra görünür.',
    trackingSince: 'Takip: {date} tarihinden beri · {count} kayıt',
    updatedAgo: 'Veri: {age} önce',
    minutes: 'dk',
    hours: 'sa',
    days: 'gün',
    justNow: 'az önce',
    listingDeltas: 'Son {days} gün: {favs} favori, {reviews} yorum',
    bought24h: 'Etsy: son 24 saatte {n} satış',
    inCarts: 'Sepette: {n}',
    bestsellerBadge: 'Etsy Bestseller',
    starSeller: 'Star Seller',
    favorites: 'Favori',
    age: 'Yaş',
    stock: 'Stok',
    shopSalesLifetime: 'Mağaza Satış',
    salesPerReview: 'Satış/Yorum',
    signInRequired: 'Gerçek satış verileri için kolayxport.com\'da oturum açın.',
    sourceApi: 'Etsy API',
    sourcePage: 'Etsy sayfası',
    salesMo: 'Satış/ay',
    revenueMo: 'Gelir/ay',
    cardTipMeasured: 'Ölçüldü: mağaza {days} günde +{delta} sattı; bu ürün son {window} günün yorumlarının {mine}/{total}\'i.',
    cardTipEstimated: 'Tahmin: son {window} günde {recent} yorum × mağazanın satış/yorum oranı {ratio}.',
    cardTipUpper: 'Tahmin: son {window} günde yorum yok; mağaza oranı {ratio} ile muhtemelen bu değerin altında.',
    cardTipInsufficient: 'Yeterli gerçek veri yok — tahmin gösterilmiyor.',
    cardTipPending: 'Mağaza verisi yükleniyor…',
    shopHowMeasured: 'Mağaza satışları {days} günde +{delta} arttı (Etsy API). Gelir = satış × medyan liste fiyatı {avg} (kaba tahmin; satıcı indirimleri hesaba katılmaz).',
    shopHowEstimated: 'Son {window} günde {recent} mağaza yorumu × satış/yorum oranı {ratio}. Gelir = satış × medyan liste fiyatı {avg} (kaba tahmin).',
    priceTipShop: 'Mağazanın ilk 100 aktif ürününün medyan LİSTE fiyatı (Etsy API, indirim öncesi; mağaza para birimi).',
    topRecent: 'En çok yorum alan (son dönem)',
    medianPrice: 'Medyan Fiyat',
    medianListPrice: 'Medyan Liste Fiyatı',
    typicalRange: 'Tipik (P25–P75)',
    medianFav: 'Medyan Fav',
    shopsTop100: 'Mağaza (ilk 100)',
    vsMedian: 'medyana göre',
    vsMedianTip: 'Bu ürünün fiyatı {price}, bu sayfadaki {n} ürünün medyan fiyatı {median} (reklamlar hariç).',
    priceTipPage: 'Bu sayfadaki {n} ürünün gösterilen fiyatlarının medyanı (indirimli fiyat, reklamlar hariç). Ham aralık: {rawMin} – {rawMax}. Etsy API örneği (ilk 100, indirimsiz liste fiyatı): medyan {apiMedian}.',
    priceTipApi: 'Etsy API anahtar kelime örneği (ilk {n} ürün, dijital ürünler hariç). Bunlar indirimsiz LİSTE fiyatlarıdır; Etsy sayfasında görünen indirimli fiyatlardan yüksek olabilir. Ham aralık: {rawMin} – {rawMax}.',
    favTipPage: 'Bu sayfadaki {n} ürünün favori sayılarının medyanı (Etsy API, reklamlar hariç).',
    favTipApi: 'Etsy API örneğindeki {n} ürünün favori medyanı.',
    shopsTip: 'Etsy API anahtar kelime aramasının ilk {n} sonucundaki farklı mağaza sayısı. Rekabet: >50 yüksek, >20 orta.',
    revTipPage: 'Gelir = {sales} satış/ay × kartta gösterilen fiyat {price}.',
    revTipList: 'Gelir = {sales} satış/ay × Etsy liste fiyatı {price} (kartta fiyat okunamadı; indirim öncesi fiyat olabilir).',
    revenueFromPage: 'sayfadaki fiyat {price} ile',
    revenueFromList: 'Etsy liste fiyatı {price} ile (indirim öncesi olabilir)',
    qtySeller: 'Adet (satıcı)',
    qtyTip: 'Satıcının girdiği stok adedi. Etsy satıcıları bunu çoğu zaman yer tutucu olarak yüksek girer; gerçek stok değildir.',
    itemReviews: 'Ürün Yorumu',
    itemReviewsTip: 'Yalnızca bu ürünün yorumları (mağazanın tüm yorumları değil).',
    confShortHigh: 'yüksek güven',
    confShortMedium: 'orta güven',
    confShortLow: 'düşük güven',
    medianListPriceShop: 'Medyan Liste Fiyatı',
  },
  en: {
    loading: 'KolayXport loading...',
    loadFailed: 'Failed to load data',
    result: 'Results',
    avgPrice: 'Avg Price',
    range: 'Range',
    avgFav: 'Avg Fav',
    shops: 'Shops',
    sellers: 'Sellers',
    competition: 'Competition',
    compLow: 'Low',
    compMed: 'Medium',
    compHigh: 'High',
    fullAnalysis: 'Full Analysis',
    perMonth: '/mo',
    bestSeller: 'Best Seller',
    seo: 'SEO',
    sales: 'sales',
    views: 'views',
    months: 'mo',
    tags: 'Tags',
    missing: 'missing',
    shop: 'Shop',
    price: 'Price',
    positive: 'positive',
    products: 'products',
    topSales: 'Total Sales',
    rating: 'Rating',
    reviews: 'Reviews',
    activeListings: 'Active Listings',
    bestSellers: 'Best Sellers',
    shopAnalysisLoading: 'KolayXport shop analysis loading...',
    shopIdNotFound: 'Shop ID not found',
    estRevenue: 'Est. Revenue',
    estRevenueShort: 'Revenue',
    demand: 'Demand',
    demandHot: '🔥 Hot',
    demandGood: '📈 Good',
    demandModerate: '📊 Moderate',
    demandLow: '📉 Low',
    convRate: 'Conv. Rate',
    engRate: 'Engage',
    favsDay: ' fav/day',
    totalSales: 'total sales',
    fromReviews: 'from reviews',
    fromFavs: 'from favs',
    lowStock: '🔥 Low Stock',
    estMktRevenue: 'Est. Market Revenue',
    shopAge: 'Shop Age',
    years: 'yr',
    estShopRevenue: 'Est. Monthly Revenue',
    estShopSales: 'Est. Monthly Sales',
    hotListings: 'Hot Listings',
    lowStockItems: 'Low Stock',
    avgConversion: 'Avg Conversion',
    revenuePerListing: 'Rev/Listing',
    salesPerMonth: 'sales/mo',
    badgeMeasured: 'Measured',
    badgeEstimated: 'Estimate',
    badgeInsufficient: 'Not enough data',
    confHigh: 'Confidence: high',
    confMedium: 'Confidence: medium',
    confLow: 'Confidence: low',
    revenueApprox: 'revenue/mo (approx.)',
    lessThan: '<',
    howMeasured: 'Shop sold +{delta} in {days} days (Etsy API, {perDay}/day). This listing has {share}% of the shop\'s reviews in the last {window} days ({mine} of {total}).',
    howMeasuredLifetime: 'Shop sold +{delta} in {days} days (Etsy API, {perDay}/day). Listing share from lifetime reviews: {share}% ({mine} of {total}).',
    howEstimated: 'This listing got {recent} reviews in the last {window} days × this shop\'s real sales-per-review ratio {ratio} ({sold} sales / {reviews} reviews).',
    howEstimatedNone: 'No reviews on this listing in the last {window} days. With this shop\'s sales-per-review ratio of {ratio}, monthly sales are likely below {upper}.',
    howInsufficient: 'Not enough real data to compute sales (too few shop reviews). We don\'t show a guess.',
    howShopOnly: 'Measured shop velocity: +{delta} sales in {days} days ({perDay}/day, Etsy API). Not enough reviews to attribute a share to this listing.',
    measuredAfter: 'A measured figure appears 24h after this shop was first tracked.',
    trackingSince: 'Tracked since {date} · {count} snapshots',
    updatedAgo: 'Data: {age} ago',
    minutes: 'min',
    hours: 'h',
    days: 'd',
    justNow: 'just now',
    listingDeltas: 'Last {days} days: {favs} favorites, {reviews} reviews',
    bought24h: 'Etsy: {n} bought in last 24h',
    inCarts: 'In carts: {n}',
    bestsellerBadge: 'Etsy Bestseller',
    starSeller: 'Star Seller',
    favorites: 'Favorites',
    age: 'Age',
    stock: 'Stock',
    shopSalesLifetime: 'Shop Sales',
    salesPerReview: 'Sales/Review',
    signInRequired: 'Sign in at kolayxport.com to see real sales data.',
    sourceApi: 'Etsy API',
    sourcePage: 'Etsy page',
    salesMo: 'Sales/mo',
    revenueMo: 'Revenue/mo',
    cardTipMeasured: 'Measured: shop sold +{delta} in {days} days; this listing has {mine} of {total} shop reviews in the last {window} days.',
    cardTipEstimated: 'Estimate: {recent} reviews in the last {window} days × this shop\'s sales-per-review ratio {ratio}.',
    cardTipUpper: 'Estimate: no reviews in the last {window} days; with the shop ratio {ratio} sales are likely below this.',
    cardTipInsufficient: 'Not enough real data — no guess shown.',
    cardTipPending: 'Loading shop data…',
    shopHowMeasured: 'Shop sold +{delta} in {days} days (Etsy API). Revenue = sales × median list price {avg} (rough; ignores seller discounts).',
    shopHowEstimated: '{recent} shop reviews in the last {window} days × sales-per-review ratio {ratio}. Revenue = sales × median list price {avg} (rough).',
    priceTipShop: 'Median LIST price of the shop\'s top 100 active listings (Etsy API, before discounts; shop currency).',
    topRecent: 'Most reviewed (recent)',
    medianPrice: 'Median Price',
    medianListPrice: 'Median List Price',
    typicalRange: 'Typical (P25–P75)',
    medianFav: 'Median Fav',
    shopsTop100: 'Shops (top 100)',
    vsMedian: 'vs median',
    vsMedianTip: 'This listing costs {price}; the median of the {n} listings on this page is {median} (ads excluded).',
    priceTipPage: 'Median of the prices shown for the {n} listings on this page (sale prices, ads excluded). Raw range: {rawMin} – {rawMax}. Etsy API sample (top 100, pre-discount list prices): median {apiMedian}.',
    priceTipApi: 'Etsy API keyword sample (top {n} listings, digital downloads excluded). These are pre-discount LIST prices and can be higher than the sale prices Etsy shows. Raw range: {rawMin} – {rawMax}.',
    favTipPage: 'Median favorites of the {n} listings on this page (Etsy API, ads excluded).',
    favTipApi: 'Median favorites of {n} listings in the Etsy API sample.',
    shopsTip: 'Distinct shops in the top {n} Etsy API keyword results. Competition: >50 high, >20 medium.',
    revTipPage: 'Revenue = {sales} sales/mo × the price shown on this card {price}.',
    revTipList: 'Revenue = {sales} sales/mo × Etsy list price {price} (card price not readable; may be before a seller discount).',
    revenueFromPage: 'at the page price {price}',
    revenueFromList: 'at the Etsy list price {price} (may be before a discount)',
    qtySeller: 'Qty (seller-set)',
    qtyTip: 'Quantity the seller entered. Sellers often set a placeholder like 999; this is not real stock.',
    itemReviews: 'Item Reviews',
    itemReviewsTip: 'Reviews of this listing only (not the whole shop).',
    confShortHigh: 'high conf.',
    confShortMedium: 'medium conf.',
    confShortLow: 'low conf.',
    medianListPriceShop: 'Median List Price',
  },
};

function t(key, vars) {
  let s = _i18n[_lang]?.[key] || _i18n.en[key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  return s;
}

function demandLabel(score) {
  if (score === 'hot') return { text: t('demandHot'), cssClass: 'kx-red' };
  if (score === 'good') return { text: t('demandGood'), cssClass: 'kx-green' };
  if (score === 'moderate') return { text: t('demandModerate'), cssClass: 'kx-orange' };
  return { text: t('demandLow'), cssClass: 'kx-red' };
}

function demandColor(score) {
  if (score === 'hot') return '#c62828';
  if (score === 'good') return '#2e7d32';
  if (score === 'moderate') return '#e65100';
  return '#999';
}


// ---------------------------------------------------------------------------
// Sales display helpers shared by search / shop overlays (DOM-built, no innerHTML)
// ---------------------------------------------------------------------------
function el(tag, cls, text, style) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (style) n.style.cssText = style;
  return n;
}

function formatMoney(amount, currency, digits) {
  if (amount === null || amount === undefined) return '—';
  const d = digits === undefined ? 0 : digits;
  if (!currency) return Number(amount).toFixed(d);
  try {
    return new Intl.NumberFormat(_lang === 'tr' ? 'tr-TR' : 'en-US', { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(amount);
  } catch (_) {
    return currency + ' ' + Number(amount).toFixed(d);
  }
}

function confShort(c) {
  return c === 'high' ? t('confShortHigh') : c === 'medium' ? t('confShortMedium') : c === 'low' ? t('confShortLow') : '';
}

function formatSales(n) {
  if (n === null || n === undefined) return '—';
  return n >= 10 ? formatNum(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function cardTooltip(sales) {
  const i = (sales && sales.inputs) || {};
  switch (sales && sales.kind) {
    case 'measured':
      return t('cardTipMeasured', { delta: i.shopSoldDelta, days: i.spanDays, mine: i.shareListingReviews, total: i.shareShopReviews, window: i.shareWindowDays });
    case 'estimated':
      return sales.monthlySales !== null && sales.monthlySales !== undefined
        ? t('cardTipEstimated', { recent: i.recentListingReviews, window: i.windowDays, ratio: i.salesPerReview })
        : t('cardTipUpper', { window: i.windowDays, ratio: i.salesPerReview });
    case 'pending':
      return t('cardTipPending');
    default:
      return t('cardTipInsufficient');
  }
}

/**
 * Inline row under a listing card. `stats` is a CardStats from listings_batch.
 * ctx = { display: { [id]: { price: {amount, currency}|null, isAd } }, market: pageMarketSummary() }
 */
function buildCardRow(stats, ctx) {
  const M = window.__KX_MATH;
  const row = el('div', 'kx-data-row');
  row.dataset.kxListing = stats.listingId;
  const sales = stats.sales || { kind: 'insufficient' };
  const tips = [cardTooltip(sales)];
  const sep = () => row.appendChild(el('span', 'kx-sep', '·'));
  const disp = (ctx && ctx.display && ctx.display[stats.listingId]) || {};

  if (sales.kind === 'pending') {
    row.appendChild(el('span', null, '…'));
  } else if (sales.monthlySales !== null && sales.monthlySales !== undefined) {
    row.appendChild(el('span', salesColor(sales.monthlySales), (sales.kind === 'estimated' ? '~' : '') + formatSales(sales.monthlySales) + t('perMonth'), 'font-weight:700;'));
  } else if (sales.monthlySalesUpperBound !== null && sales.monthlySalesUpperBound !== undefined) {
    row.appendChild(el('span', 'kx-orange', '<' + formatSales(sales.monthlySalesUpperBound) + t('perMonth'), 'font-weight:700;'));
  } else {
    row.appendChild(el('span', null, '—'));
  }
  if (sales.kind !== 'pending') {
    const cls = sales.kind === 'measured' ? 'kx-mini-measured' : sales.kind === 'estimated' ? 'kx-mini-estimated' : 'kx-mini-none';
    let label = sales.kind === 'measured' ? t('badgeMeasured') : sales.kind === 'estimated' ? t('badgeEstimated') : t('badgeInsufficient');
    if (sales.confidence) label += ' · ' + confShort(sales.confidence);
    row.appendChild(el('span', 'kx-mini-badge ' + cls, label));
  }

  // Revenue = shown sales x the price shown on this card (fallback: API list price).
  const rev = M ? M.cardRevenue(stats, disp.price) : null;
  if (rev && rev.amount) {
    sep();
    row.appendChild(el('span', 'kx-green', '≈' + formatMoney(rev.amount, rev.currency) + t('perMonth')));
    tips.push(t(rev.source === 'page' ? 'revTipPage' : 'revTipList', {
      sales: formatSales(sales.monthlySales), price: formatMoney(rev.unitPrice, rev.currency, 2),
    }));
  }
  if (stats.favorites !== null && stats.favorites !== undefined) {
    sep();
    row.appendChild(el('span', null, '♥ ' + formatNum(stats.favorites)));
  }
  if (M && M.quantitySignal(stats.quantity) === 'low') {
    sep();
    row.appendChild(el('span', 'kx-red', t('lowStock'), 'font-weight:700;'));
  }

  // Price vs the median of the cards on this page, both as displayed (same currency).
  const market = ctx && ctx.market;
  if (M && market && market.price && market.price.n >= 5 && disp.price && !disp.isAd) {
    const diff = M.priceVsMedian(disp.price.amount, market.price.median, disp.price.currency, market.currency);
    if (diff) {
      sep();
      const span = el('span', null, diff.text + ' ' + t('vsMedian'), 'color:#666;');
      span.title = t('vsMedianTip', {
        price: formatMoney(disp.price.amount, disp.price.currency, 2),
        median: formatMoney(market.price.median, market.currency, 2),
        n: market.price.n,
      });
      row.appendChild(span);
    }
  }
  row.title = tips.join('\n');
  return row;
}

function findListingCard(link) {
  return link.closest('[data-listing-id]') ||
         link.closest('[data-listing-card-v2]') ||
         link.closest('.v2-listing-card') ||
         link.closest('.listing-link') ||
         link.closest('.wt-grid__item-xs-6') ||
         link.closest('[class*="listing-card"]') ||
         link.parentElement?.parentElement || link.parentElement;
}

const STRIKE_SEL = 's, del, .wt-text-strikethrough, [class*="strikethrough"], [class*="original-price"], [class*="promotion-price"]';

/** Text of a node without the KX row we injected into it. */
function cardText(card) {
  const own = card.querySelector('.kx-data-row');
  const full = card.innerText || card.textContent || '';
  return own ? full.replace(own.innerText || own.textContent || '', '') : full;
}

/** The price a shopper sees on the card (sale price when on sale), or null. */
function readCardPrice(card) {
  const M = window.__KX_MATH;
  if (!M || !card) return null;
  for (const v of card.querySelectorAll('.currency-value')) {
    if (v.closest(STRIKE_SEL) || v.closest('.kx-data-row')) continue;
    const parent = v.parentElement || v;
    const sym = parent.querySelector('.currency-symbol');
    const amount = M.parseAmount(v.textContent);
    if (!amount) continue;
    const currency = (sym && M.currencyFromSymbol(sym.textContent)) || (M.parseDisplayedPrice(parent.textContent) || {}).currency || null;
    return { amount, currency };
  }
  return M.pickCardPriceFromText(cardText(card));
}

/** Etsy promoted listings ("Ad by Etsy seller", "Sponsored"). Heuristic — verify live. */
function isAdCard(card) {
  if (!card) return false;
  if (card.matches('[data-is-ad="true"], [data-ad]') || card.querySelector('[data-is-ad="true"], [data-ad-label]')) return true;
  const head = cardText(card).slice(0, 600);
  // Case-sensitive "Ad by"/"Ad from" with no left word boundary: textContent can glue it
  // to the previous node ("…titleAd by Etsy seller").
  return /Ad(?:vertisement)?\s+(?:by|from)\s/.test(head) || /\bSponsored\b|\bReklam\b|satıcısının\s+reklamı/i.test(head);
}

/**
 * Listing ids on the page in order, with what the shopper sees on each card.
 * Returns { ids: [...], display: { [id]: { price, isAd } } }.
 */
function collectPageCards() {
  const ids = [];
  const display = {};
  document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
    const match = link.href.match(/\/listing\/(\d+)/);
    if (!match || display[match[1]]) return;
    const card = findListingCard(link);
    ids.push(match[1]);
    display[match[1]] = { price: readCardPrice(card), isAd: isAdCard(card) };
  });
  return { ids, display };
}

function pageListingIds() {
  return collectPageCards().ids;
}

/** Page market summary from displayed prices + API favourites/shops of the loaded cards. */
function pageMarket(display, statsById) {
  const M = window.__KX_MATH;
  if (!M) return null;
  const cards = Object.keys(display || {}).map(id => ({
    price: display[id].price ? display[id].price.amount : null,
    currency: display[id].price ? display[id].price.currency : null,
    isAd: display[id].isAd,
    favorites: statsById && statsById[id] ? statsById[id].favorites : null,
    shopId: statsById && statsById[id] ? statsById[id].shopId : null,
  }));
  return M.pageMarketSummary(cards);
}

/** Render/replace the KX row on each visible card for the given stats map. */
function renderCardRows(statsById, ctx) {
  const processed = new Set();
  document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
    const match = link.href.match(/\/listing\/(\d+)/);
    if (!match || processed.has(match[1])) return;
    const stats = statsById[match[1]];
    if (!stats) return;
    processed.add(match[1]);
    const card = findListingCard(link);
    if (!card) return;
    const old = card.querySelector('.kx-data-row');
    const row = buildCardRow(stats, ctx);
    if (old) old.replaceWith(row); else card.appendChild(row);
  });
}

/**
 * Fetch per-card stats in batches of 48, then re-poll the ids whose shop data
 * was still 'pending' (the server caps fresh shop fetches per request).
 */
async function loadCardStats(ids, ctx, isStillCurrent, onUpdate) {
  const all = {};
  ctx = ctx || {};
  const refresh = () => {
    if (ctx.display) ctx.market = pageMarket(ctx.display, all);
    renderCardRows(all, ctx);
    if (onUpdate) onUpdate(all, ctx);
  };
  const chunks = [];
  for (let i = 0; i < ids.length; i += 48) chunks.push(ids.slice(i, i + 48));
  let pending = [];
  for (const chunk of chunks) {
    if (!isStillCurrent()) return all;
    const res = await apiCall('listings_batch', { listingIds: chunk });
    Object.assign(all, res.listings || {});
    pending = pending.concat(res.pendingIds || []);
    refresh();
  }
  for (let round = 0; round < 3 && pending.length && isStillCurrent(); round++) {
    await new Promise(r => setTimeout(r, 2500));
    const res = await apiCall('listings_batch', { listingIds: pending.slice(0, 48) });
    Object.assign(all, res.listings || {});
    pending = (res.pendingIds || []).concat(pending.slice(48));
    refresh();
  }
  return all;
}

// ---------------------------------------------------------------------------
// Page Type Detection
// ---------------------------------------------------------------------------
function getPageType() {
  const path = location.pathname;
  // Check listing and shop BEFORE search — search query params (ga_search_query)
  // can appear in listing/shop URLs when navigating from search results
  if (path.match(/\/listing\/\d+/)) return 'listing';
  if (path.match(/\/shop\/[^/]+/)) return 'shop';
  if (path.includes('/search') || location.search.includes('search_query=') || location.search.includes('q=')) return 'search';
  return 'other';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
console.log('[KX-shared] exporting __KX_SHARED, pageType:', getPageType());
window.__KX_SHARED = {
  KX_PREFIX, API_BASE,
  createOverlayContainer,
  injectInlineCSS,
  onUrlChange,
  SELECTORS,
  apiCall,
  listingStatsCall,
  el, formatMoney, formatSales, confShort,
  buildCardRow, renderCardRows, loadCardStats, pageListingIds, findListingCard,
  collectPageCards, pageMarket, readCardPrice, isAdCard,
  lang: _lang,
  formatNum, formatPrice,
  competitionColor, scoreClass, salesColor,
  computeBestSellerRanks,
  demandLabel, demandColor,
  isOverlayEnabled,
  getPageType,
  t,
};

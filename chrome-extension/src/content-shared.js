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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatNum(n) {
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

function priceVsAvg(price, avgPrice) {
  if (!price || !avgPrice) return null;
  const diff = ((price - avgPrice) / avgPrice * 100).toFixed(0);
  const isLower = price <= avgPrice;
  return {
    text: (isLower ? '' : '+') + diff + t('vsAvg'),
    cssClass: isLower ? 'kx-green' : 'kx-red',
  };
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
    vsAvg: '% ort.',
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
    vsAvg: '% avg.',
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
  },
};

function t(key) { return _i18n[_lang]?.[key] || _i18n.en[key] || key; }

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
  formatNum, formatPrice,
  competitionColor, scoreClass, salesColor,
  computeBestSellerRanks, priceVsAvg,
  demandLabel, demandColor,
  isOverlayEnabled,
  getPageType,
  t,
};

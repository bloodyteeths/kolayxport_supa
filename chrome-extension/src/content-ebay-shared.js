/**
 * KolayXport Research — eBay Shared Content Script Utilities
 * Shadow DOM overlay, URL change observer, DOM selectors for eBay
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KX_EBAY_PREFIX = 'kx-ebay-research';
const EBAY_API_BASE = 'https://kolayxport.com';

// ---------------------------------------------------------------------------
// Inline CSS (reuse from Etsy shared if already injected)
// ---------------------------------------------------------------------------
const KX_EBAY_INLINE_CSS = `
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
.kx-stats-bar .kx-collapse-btn {
  background: none; border: none; cursor: pointer; font-size: 11px; color: #667eea;
  font-weight: 600; padding: 0; margin-left: auto;
}
`;

function injectEbayInlineCSS() {
  if (document.getElementById('kx-ebay-inline-css')) return;
  const style = document.createElement('style');
  style.id = 'kx-ebay-inline-css';
  style.textContent = KX_EBAY_INLINE_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Shadow DOM Container (for summary bar)
// ---------------------------------------------------------------------------
function createEbayOverlayContainer(id, position = 'top') {
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
// URL Change Observer
// ---------------------------------------------------------------------------
let _ebayLastUrl = location.href;
const _ebayUrlCallbacks = [];

function onEbayUrlChange(callback) {
  _ebayUrlCallbacks.push(callback);
}

const _ebayUrlObserver = new MutationObserver(() => {
  if (location.href !== _ebayLastUrl) {
    const oldUrl = _ebayLastUrl;
    _ebayLastUrl = location.href;
    _ebayUrlCallbacks.forEach(cb => cb(_ebayLastUrl, oldUrl));
  }
});
_ebayUrlObserver.observe(document.body, { childList: true, subtree: true });

window.addEventListener('popstate', () => {
  if (location.href !== _ebayLastUrl) {
    const oldUrl = _ebayLastUrl;
    _ebayLastUrl = location.href;
    _ebayUrlCallbacks.forEach(cb => cb(_ebayLastUrl, oldUrl));
  }
});

// ---------------------------------------------------------------------------
// DOM Selectors (eBay)
// ---------------------------------------------------------------------------
const EBAY_SELECTORS = {
  searchResultCard: '.s-item',
  searchResultLink: 'a[href*="/itm/"]',
  searchQuery: () => {
    const params = new URLSearchParams(location.search);
    return params.get('_nkw') || '';
  },
  itemId: () => {
    const match = location.pathname.match(/\/itm\/(?:[^/]*\/)?(\d+)/);
    if (match) return match[1];
    const trailingMatch = location.pathname.match(/\/itm\/.*?(\d{8,})(?:\?|$)/);
    return trailingMatch ? trailingMatch[1] : null;
  },
  sellerName: () => {
    const match = location.pathname.match(/\/usr\/([^/?#]+)/);
    return match ? match[1] : null;
  },
  itemTitle: () => {
    const h1 = document.querySelector('h1.x-item-title__mainTitle') ||
               document.querySelector('#itemTitle') ||
               document.querySelector('h1[data-testid="x-item-title"]') ||
               document.querySelector('.x-item-title h1');
    return h1 ? h1.textContent.trim() : '';
  },
};

// ---------------------------------------------------------------------------
// i18n — Turkish / English
// ---------------------------------------------------------------------------
const _ebayLang = (() => {
  try { return chrome.i18n.getUILanguage().startsWith('tr') ? 'tr' : 'en'; }
  catch { return (navigator.language || '').startsWith('tr') ? 'tr' : 'en'; }
})();

const _ebayI18n = {
  tr: {
    loading: 'KolayXport yükleniyor...',
    loadFailed: 'Veri yüklenemedi',
    result: 'Sonuç', avgPrice: 'Ort. Fiyat', range: 'Aralık',
    sellers: 'Satıcı', competition: 'Rekabet',
    compLow: 'Düşük', compMed: 'Orta', compHigh: 'Yüksek',
    fullAnalysis: 'Tam Analiz', perMonth: '/ay', vsAvg: '% ort.',
    bestSeller: 'En Çok Satan', seo: 'SEO', price: 'Fiyat',
    positive: 'olumlu', products: 'ürün',
    estRevenue: 'Tah. Gelir',
    demand: 'Talep',
    demandHot: '🔥 Çok Yüksek', demandGood: '📈 İyi',
    demandModerate: '📊 Orta', demandLow: '📉 Düşük',
    convRate: 'Dönüşüm', lowStock: '🔥 Az Stok',
    estMktRevenue: 'Tah. Pazar Geliri',
  },
  en: {
    loading: 'KolayXport loading...',
    loadFailed: 'Failed to load data',
    result: 'Results', avgPrice: 'Avg Price', range: 'Range',
    sellers: 'Sellers', competition: 'Competition',
    compLow: 'Low', compMed: 'Medium', compHigh: 'High',
    fullAnalysis: 'Full Analysis', perMonth: '/mo', vsAvg: '% avg.',
    bestSeller: 'Best Seller', seo: 'SEO', price: 'Price',
    positive: 'positive', products: 'products',
    estRevenue: 'Est. Revenue',
    demand: 'Demand',
    demandHot: '🔥 Hot', demandGood: '📈 Good',
    demandModerate: '📊 Moderate', demandLow: '📉 Low',
    convRate: 'Conv. Rate', lowStock: '🔥 Low Stock',
    estMktRevenue: 'Est. Market Revenue',
  },
};

function ebayT(key) { return _ebayI18n[_ebayLang]?.[key] || _ebayI18n.en[key] || key; }

// ---------------------------------------------------------------------------
// Page Type Detection
// ---------------------------------------------------------------------------
function getEbayPageType() {
  const path = location.pathname;
  const search = location.search;
  if (path.includes('/sch/') || search.includes('_nkw=')) return 'search';
  if (path.includes('/itm/')) return 'listing';
  if (path.includes('/usr/')) return 'seller';
  return 'other';
}

// ---------------------------------------------------------------------------
// API Communication
// ---------------------------------------------------------------------------
async function ebayApiCall(action, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'kx_ebay_research', action, params },
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
function ebayFormatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function ebayFormatPrice(n) {
  return '$' + Number(n).toFixed(2);
}

function ebayCompetitionColor(level) {
  if (level === 'low') return '#4caf50';
  if (level === 'medium') return '#ff9800';
  return '#f44336';
}

function ebayScoreClass(score) {
  if (score >= 70) return 'kx-green';
  if (score >= 40) return 'kx-orange';
  return 'kx-red';
}

function ebaySalesColor(est) {
  if (est >= 5) return 'kx-green';
  if (est >= 1) return 'kx-orange';
  return 'kx-red';
}

function ebayComputeBestSellerRanks(badges) {
  const entries = Object.entries(badges || {});
  if (entries.length === 0) return {};

  const sorted = entries.sort((a, b) => {
    const salesDiff = (b[1].estMonthlySales || b[1].soldQuantity || 0) - (a[1].estMonthlySales || a[1].soldQuantity || 0);
    if (salesDiff !== 0) return salesDiff;
    return (b[1].price || 0) - (a[1].price || 0);
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

function ebayPriceVsAvg(price, avgPrice) {
  if (!price || !avgPrice) return null;
  const diff = ((price - avgPrice) / avgPrice * 100).toFixed(0);
  const isLower = price <= avgPrice;
  return {
    text: (isLower ? '' : '+') + diff + ebayT('vsAvg'),
    cssClass: isLower ? 'kx-green' : 'kx-red',
  };
}

function ebayDemandLabel(score) {
  if (score === 'hot') return { text: ebayT('demandHot'), cssClass: 'kx-red' };
  if (score === 'good') return { text: ebayT('demandGood'), cssClass: 'kx-green' };
  if (score === 'moderate') return { text: ebayT('demandModerate'), cssClass: 'kx-orange' };
  return { text: ebayT('demandLow'), cssClass: 'kx-red' };
}

async function ebayIsOverlayEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get('kx_overlays_enabled', (result) => {
      resolve(result.kx_overlays_enabled !== false);
    });
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.__KX_EBAY_SHARED = {
  KX_EBAY_PREFIX,
  API_BASE: EBAY_API_BASE,
  createOverlayContainer: createEbayOverlayContainer,
  injectInlineCSS: injectEbayInlineCSS,
  onUrlChange: onEbayUrlChange,
  SELECTORS: EBAY_SELECTORS,
  apiCall: ebayApiCall,
  formatNum: ebayFormatNum,
  formatPrice: ebayFormatPrice,
  competitionColor: ebayCompetitionColor,
  scoreClass: ebayScoreClass,
  salesColor: ebaySalesColor,
  computeBestSellerRanks: ebayComputeBestSellerRanks,
  priceVsAvg: ebayPriceVsAvg,
  demandLabel: ebayDemandLabel,
  isOverlayEnabled: ebayIsOverlayEnabled,
  getPageType: getEbayPageType,
  t: ebayT,
};

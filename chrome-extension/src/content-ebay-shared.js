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
/* Placeholders for values still loading: same line box as the text that replaces them (no jump). */
@keyframes kx-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
.kx-skel {
  display: inline-block; vertical-align: middle; height: 0.9em; min-width: 3.2em; border-radius: 4px;
  background: linear-gradient(90deg, #e4e4ec 25%, #f3f3f8 50%, #e4e4ec 75%); background-size: 200% 100%;
  animation: kx-shimmer 1.2s ease-in-out infinite;
}
.kx-skel-wide { min-width: 7em; }
@media (prefers-reduced-motion: reduce) { .kx-skel { animation: none; } }
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
    @keyframes kx-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
    .kx-skel {
      display: inline-block; vertical-align: middle; height: 0.95em; min-width: 3.2em; border-radius: 4px;
      background: linear-gradient(90deg, rgba(255,255,255,0.16) 25%, rgba(255,255,255,0.36) 50%, rgba(255,255,255,0.16) 75%);
      background-size: 200% 100%; animation: kx-shimmer 1.2s ease-in-out infinite;
    }
    .kx-skel-wide { min-width: 6.5em; }
    @media (prefers-reduced-motion: reduce) { .kx-skel { animation: none; } }
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
  // New markup (2025+) is li.s-card; old is li.s-item. Parsing lives in lib/ebayMath.js.
  searchResultCard: 'li.s-card, li.s-item',
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
// Resolved by lib/lang.js: the popup choice (kx_lang) → account language → 'tr'.
function ebayLang() {
  const L = window.__KX_LANG;
  return (L && L.get()) || 'tr';
}

/** Numbers and money follow the overlay language; the currency stays the marketplace's. */
function ebayLocale() {
  return ebayLang() === 'en' ? 'en-US' : 'tr-TR';
}

function onEbayLangChange(cb) {
  const L = window.__KX_LANG;
  if (L && L.onChange) L.onChange(cb);
}

const _ebayI18n = {
  tr: {
    loading: 'KolayXport yükleniyor...',
    loadFailed: 'Veri yüklenemedi',
    result: 'Sonuç', avgPrice: 'Medyan Fiyat', range: 'Tipik (P25–P75)',
    sellers: 'Satıcı', competition: 'Rekabet',
    compLow: 'Düşük', compMed: 'Orta', compHigh: 'Yüksek', compUnknown: 'Veri yetersiz',
    distinctOf: 'farklı / {n} ilan', sold: 'satıldı', estTag: 'tahmini',
    soldDepth: 'Satış derinliği', withSales: '{k}/{n} ilanda satış var',
    srcApi: 'Kaynak: eBay API, en iyi eşleşen {n} ilan', srcPage: 'Kaynak: bu sayfadaki {n} ilan',
    notEnough: 'yetersiz veri', unusual: 'olağandışı',
    topBySold: 'satışa göre ilk %{p}', sellThrough: 'Stok satış oranı',
    available: 'mevcut', feedback: 'değerlendirme', competingListings: 'benzer ilan',
    vsMedian: 'medyana göre', pctVsMedian: '{sign}%{n} medyana göre',
    titleCoverage: 'Başlık anahtar kelime kapsamı: rakiplerin en sık 20 anahtar kelimesinden kaçı başlığınızda geçiyor',
    tipShorter: 'Başlığınız ({mine} karakter) rakiplerinkinden kısa (tipik: {typical}).',
    tipFewKeywords: 'Başlık en sık 20 anahtar kelimeden yalnızca {count} tanesini içeriyor.',
    tipTopKeywords: 'En sık anahtar kelimeler: {keywords}',
    fullAnalysis: 'Tam Analiz', perMonth: '/ay', vsAvg: '% ort.',
    compScore: 'skor {score}/100', pct: '%{n}', factorResults: 'sonuç', factorSold: 'satış', factorSellers: 'satıcı', factorPrice: 'fiyat',
    bestSeller: 'En Çok Satan', seo: 'SEO', price: 'Fiyat',
    positive: 'olumlu', products: 'ilan',
    estRevenue: 'Tahmini Gelir',
    demand: 'Talep',
    demandHot: '🔥 Çok Yüksek', demandGood: '📈 İyi',
    demandModerate: '📊 Orta', demandLow: '📉 Düşük',
    convRate: 'Dönüşüm', lowStock: '🔥 Az Stok',
    estMktRevenue: 'Tahmini Pazar Geliri',
  },
  en: {
    loading: 'KolayXport loading...',
    loadFailed: 'Failed to load data',
    result: 'Results', avgPrice: 'Median Price', range: 'Typical (P25–P75)',
    sellers: 'Sellers', competition: 'Competition',
    compLow: 'Low', compMed: 'Medium', compHigh: 'High', compUnknown: 'Not enough data',
    distinctOf: 'distinct / {n} listings', sold: 'sold', estTag: 'est.',
    soldDepth: 'Sold depth', withSales: '{k}/{n} listings show sales',
    srcApi: 'Source: eBay API, top {n} best-match listings', srcPage: 'Source: {n} listings on this page',
    notEnough: 'not enough data', unusual: 'unusual range',
    topBySold: 'top {p}% by sold', sellThrough: 'Stock sell-through',
    available: 'available', feedback: 'feedback', competingListings: 'similar listings',
    vsMedian: 'vs median', pctVsMedian: '{sign}{n}% vs median',
    titleCoverage: 'Title keyword coverage: how many of the 20 most common competitor keywords your title contains',
    tipShorter: 'Your title ({mine} chars) is shorter than competitors (typical {typical}).',
    tipFewKeywords: 'Title contains only {count} of the 20 most common keywords.',
    tipTopKeywords: 'Most common keywords: {keywords}',
    fullAnalysis: 'Full Analysis', perMonth: '/mo', vsAvg: '% avg.',
    compScore: 'score {score}/100', pct: '{n}%', factorResults: 'results', factorSold: 'sold', factorSellers: 'sellers', factorPrice: 'price',
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

function ebayT(key, vars) {
  let s = _ebayI18n[ebayLang()]?.[key] || _ebayI18n.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  return s;
}

/** Shimmer placeholder markup for a value that is still loading (static HTML, no data). */
function ebaySkel(wide) {
  return '<span class="kx-skel' + (wide ? ' kx-skel-wide' : '') + '" aria-hidden="true" data-kx-skel="1"></span>';
}

/** Debug timing marks (lib/perf.js; only with localStorage kx_debug). */
function ebayPerf(surface, label, extra) {
  const P = window.__KX_PERF;
  if (P) P.mark(surface, label, extra);
}

function ebayPerfStart(surface) {
  const P = window.__KX_PERF;
  if (P) P.start(surface);
}

function ebayEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Marketplace of the current page: { id: 'EBAY_US', currency: 'USD', locale: 'en-US' }. */
function getEbayMarketplace() {
  return window.__KX_EBAY_MATH.marketplaceForHost(location.hostname);
}

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
    const L = window.__KX_LIMIT;
    chrome.runtime.sendMessage(
      { type: 'kx_ebay_research', action, params, pv: L ? L.pageViewId() : undefined },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          // A 429 research-limit body rides along as err.limitInfo (lib/limitCard.js).
          if (L) { reject(L.toError(response)); return; }
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
  const dec = (s) => (ebayLang() === 'tr' ? s.replace('.', ',') : s);
  if (n >= 1000000) return dec((n / 1000000).toFixed(1)) + 'M';
  if (n >= 1000) return dec((n / 1000).toFixed(1)) + 'K';
  return dec(String(n));
}

/** Integer with the overlay language's grouping ("1.234" in Turkish). */
function ebayFormatInt(n) {
  return Number.isFinite(Number(n)) ? Number(n).toLocaleString(ebayLocale()) : '—';
}

/** Format a price in its own currency (never assume $). '—' when unknown. */
function ebayFormatPrice(n, currency) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const cur = currency || getEbayMarketplace().currency || 'USD';
  try {
    return new Intl.NumberFormat(ebayLocale(), { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(Number(n));
  } catch (_) {
    return cur + ' ' + Number(n).toFixed(2);
  }
}

/** Result count as eBay shows it: 9500 + plus → "9,500+". */
function ebayFormatCount(rc) {
  if (!rc || !Number.isFinite(rc.count)) return '—';
  return rc.count.toLocaleString(ebayLocale()) + (rc.plus ? '+' : '');
}

function ebayCompetitionColor(level) {
  if (level === 'low') return '#a5d6a7';
  if (level === 'medium') return '#ffcc80';
  if (level === 'high') return '#ef9a9a';
  return 'rgba(255,255,255,0.7)';
}

function ebayCompetitionLabel(level) {
  return level === 'low' ? ebayT('compLow') : level === 'medium' ? ebayT('compMed') : level === 'high' ? ebayT('compHigh') : ebayT('compUnknown');
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

function ebayPriceVsMedian(price, median) {
  const pct = window.__KX_EBAY_MATH.pctVsMedian(price, median);
  if (pct == null) return null;
  return {
    text: ebayT('pctVsMedian', { sign: pct > 0 ? '+' : pct < 0 ? '-' : '', n: Math.abs(pct) }),
    cssClass: pct <= 0 ? 'kx-green' : 'kx-red',
  };
}

function ebayDemandLabel(score) {
  if (score === 'hot') return { text: ebayT('demandHot'), cssClass: 'kx-red' };
  if (score === 'good') return { text: ebayT('demandGood'), cssClass: 'kx-green' };
  if (score === 'moderate') return { text: ebayT('demandModerate'), cssClass: 'kx-orange' };
  return { text: ebayT('demandLow'), cssClass: 'kx-red' };
}

// Overlays await this before their first render, so the language (lib/lang.js) is resolved
// by then: no flash of the wrong language.
async function ebayIsOverlayEnabled() {
  const enabled = await new Promise(resolve => {
    chrome.storage.local.get('kx_overlays_enabled', (result) => {
      resolve((result || {}).kx_overlays_enabled !== false);
    });
  });
  const L = window.__KX_LANG;
  if (L && L.ready) await L.ready;
  return enabled;
}

/** Replace an overlay's numbers with the research-limit card when `err` carries a 429 payload. */
function ebayShowLimitCard(container, err, surface) {
  const L = window.__KX_LIMIT;
  const info = L && (L.fromError(err) || L.fromResponse(err));
  if (!info || !container) return false;
  L.render(container, info, { surface });
  return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.__KX_EBAY_SHARED = {
  showLimitCard: ebayShowLimitCard,
  KX_EBAY_PREFIX,
  API_BASE: EBAY_API_BASE,
  createOverlayContainer: createEbayOverlayContainer,
  injectInlineCSS: injectEbayInlineCSS,
  onUrlChange: onEbayUrlChange,
  SELECTORS: EBAY_SELECTORS,
  apiCall: ebayApiCall,
  formatNum: ebayFormatNum,
  formatInt: ebayFormatInt,
  locale: ebayLocale,
  get lang() { return ebayLang(); },
  onLangChange: onEbayLangChange,
  formatPrice: ebayFormatPrice,
  formatCount: ebayFormatCount,
  competitionColor: ebayCompetitionColor,
  competitionLabel: ebayCompetitionLabel,
  scoreClass: ebayScoreClass,
  salesColor: ebaySalesColor,
  priceVsMedian: ebayPriceVsMedian,
  escape: ebayEscape,
  skel: ebaySkel,
  perf: ebayPerf,
  perfStart: ebayPerfStart,
  getMarketplace: getEbayMarketplace,
  M: window.__KX_EBAY_MATH,
  demandLabel: ebayDemandLabel,
  isOverlayEnabled: ebayIsOverlayEnabled,
  getPageType: getEbayPageType,
  t: ebayT,
};

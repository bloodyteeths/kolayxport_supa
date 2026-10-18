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
// Styles: the shared UI module (lib/ui.js, "Blade" brand). Card strips and the item panel
// live in the page DOM (CSS once in <head>, scoped under .kx-ui); the top bar lives in a
// shadow root with its own copy.
// ---------------------------------------------------------------------------
function ebayUI() { return window.__KX_UI || null; }

function injectEbayInlineCSS() {
  const U = ebayUI();
  if (U) U.ensureStyles(document);
}

// ---------------------------------------------------------------------------
// Shadow DOM Container (top bar)
// ---------------------------------------------------------------------------
function createEbayOverlayContainer(id, position = 'top') {
  const existing = document.getElementById(id);
  if (existing) return existing.shadowRoot;

  const host = document.createElement('div');
  host.id = id;
  // all: initial isolates the host; the font is set on .kx-ui inside (never the serif default).
  host.style.cssText = 'all: initial; display: block; position: relative; z-index: 9999;';
  const shadow = host.attachShadow({ mode: 'open' });
  const U = ebayUI();
  if (U) U.ensureStyles(shadow);

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
    result: 'Sonuç', avgPrice: "Tipik fiyat", range: "Fiyatların çoğu",
    sellers: "Farklı satıcı", competition: "Rekabet",
    compLow: 'Düşük', compMed: 'Orta', compHigh: 'Yüksek', compUnknown: 'Veri yetersiz',
    distinctOf: "/ {n} ilan", sold: 'satıldı', estTag: 'tahmini',
    soldDepth: "Satış yapan ilan", withSales: "{n} ilandan {k}{of} satış yapmış",
    srcApi: 'Kaynak: eBay API, en iyi eşleşen {n} ilan', srcPage: 'Kaynak: bu sayfadaki {n} ilan',
    notEnough: 'yetersiz veri', unusual: 'olağandışı',
    topBySold: 'satışa göre ilk %{p}', sellThrough: "Stoğun satılan kısmı",
    available: 'mevcut', feedback: 'değerlendirme', competingListings: 'benzer ilan',
    vsMedian: 'medyana göre', pctVsMedian: '{sign}%{n} medyana göre',
    titleCoverage: 'Başlık anahtar kelime kapsamı: rakiplerin en sık 20 anahtar kelimesinden kaçı başlığınızda geçiyor',
    tipShorter: 'Başlığınız ({mine} karakter) rakiplerinkinden kısa (tipik: {typical}).',
    tipFewKeywords: 'Başlık en sık 20 anahtar kelimeden yalnızca {count} tanesini içeriyor.',
    tipTopKeywords: 'En sık anahtar kelimeler: {keywords}',
    fullAnalysis: "Tam analiz", perMonth: '/ay', vsAvg: '% ort.',
    compScore: 'skor {score}/100', pct: '%{n}', factorResults: 'sonuç', factorSold: 'satış', factorSellers: 'satıcı', factorPrice: 'fiyat',
    bestSeller: 'En Çok Satan', seo: 'SEO', price: 'Fiyat',
    positive: 'olumlu', products: 'ilan',
    estRevenue: 'Tahmini Gelir',
    demand: 'Talep',
    demandHot: '🔥 Çok Yüksek', demandGood: '📈 İyi',
    demandModerate: '📊 Orta', demandLow: '📉 Düşük',
    convRate: 'Dönüşüm', lowStock: '🔥 Az Stok',
    estMktRevenue: 'Tahmini Pazar Geliri',
    perMonthSales: " satış/ay",
    itemInsights: "İlan analizi",
    plainResults: "eBay'in bu arama için gösterdiği sonuç sayısı.",
    plainTypicalPrice: "Ortadaki fiyat: ilanların yarısı daha ucuz, yarısı daha pahalı.",
    plainRange: "İlanların ortadaki yarısı bu fiyat aralığında; en ucuz ve en pahalı çeyrek hariç.",
    formulaRange: "P25–P75 (25. ile 75. yüzdelik arası).",
    plainSellers: "Örnekteki ilanlarda kaç farklı satıcı olduğu. Az satıcı, pazarın birkaç satıcıda toplandığını gösterir.",
    plainSold: "Örnekteki ilanlardan kaçında satış göründüğü: talebin kabaca bir işareti.",
    plainCompetition: "Sonuç sayısı, satış, satıcı ve fiyat dağılımından hesaplanan 0–100 skor. Skor yükseldikçe pazar zorlaşır.",
    plainMonthly: "Toplam satılan adet ÷ ilanın yayında olduğu ay sayısı. Kaba bir ortalama; son aylar farklı olabilir.",
    plainVsTypical: "Bu ilanın fiyatı, aynı aramadaki ilanların tipik fiyatıyla karşılaştırıldı.",
    plainSeo: "Rakiplerin başlıklarında en sık geçen 20 anahtar kelimeden kaçının sizin başlığınızda olduğu (0–100).",
    plainSellThrough: "Satılan ÷ (satılan + kalan stok), eBay'in kendi tahmini adetleriyle.",
    plainBest: "Bu aramada satış sayısına göre ilk %10 içinde.",
    formulaMonthly: "{sold} satış ÷ {months} ay.",
    cardSoldNote: "Toplam satılan: {n}.",
    cardBestNote: "Satışa göre ilk %{p}.",
    tipsTitle: "Başlık önerileri",
  },
  en: {
    loading: 'KolayXport loading...',
    loadFailed: 'Failed to load data',
    result: 'Results', avgPrice: "Typical price", range: "Most prices",
    sellers: "Different sellers", competition: "Competition",
    compLow: 'Low', compMed: 'Medium', compHigh: 'High', compUnknown: 'Not enough data',
    distinctOf: "of {n} listings", sold: 'sold', estTag: 'est.',
    soldDepth: "Listings with sales", withSales: "{k} of {n} listings have sales",
    srcApi: 'Source: eBay API, top {n} best-match listings', srcPage: 'Source: {n} listings on this page',
    notEnough: 'not enough data', unusual: 'unusual range',
    topBySold: 'top {p}% by sold', sellThrough: "Share of stock sold",
    available: 'available', feedback: 'feedback', competingListings: 'similar listings',
    vsMedian: 'vs median', pctVsMedian: '{sign}{n}% vs median',
    titleCoverage: 'Title keyword coverage: how many of the 20 most common competitor keywords your title contains',
    tipShorter: 'Your title ({mine} chars) is shorter than competitors (typical {typical}).',
    tipFewKeywords: 'Title contains only {count} of the 20 most common keywords.',
    tipTopKeywords: 'Most common keywords: {keywords}',
    fullAnalysis: "Full analysis", perMonth: '/mo', vsAvg: '% avg.',
    compScore: 'score {score}/100', pct: '{n}%', factorResults: 'results', factorSold: 'sold', factorSellers: 'sellers', factorPrice: 'price',
    bestSeller: 'Best Seller', seo: 'SEO', price: 'Price',
    positive: 'positive', products: 'products',
    estRevenue: 'Est. Revenue',
    demand: 'Demand',
    demandHot: '🔥 Hot', demandGood: '📈 Good',
    demandModerate: '📊 Moderate', demandLow: '📉 Low',
    convRate: 'Conv. Rate', lowStock: '🔥 Low Stock',
    estMktRevenue: 'Est. Market Revenue',
    perMonthSales: " sales/mo",
    itemInsights: "Item insights",
    plainResults: "How many results eBay shows for this search.",
    plainTypicalPrice: "The middle price: half of the listings cost less, half cost more.",
    plainRange: "The middle half of the listings is priced in this range; the cheapest and priciest quarters are left out.",
    formulaRange: "P25–P75 (25th to 75th percentile).",
    plainSellers: "How many different sellers are in the sample. Few sellers means a few sellers hold the market.",
    plainSold: "How many sampled listings show sales: a rough sign of demand.",
    plainCompetition: "A 0–100 score from the result count, sales, sellers and price spread. The higher the score, the tougher the market.",
    plainMonthly: "Total sold ÷ months the listing has been live. A rough average; recent months can differ.",
    plainVsTypical: "This listing's price compared with the typical price of listings in the same search.",
    plainSeo: "How many of the 20 keywords competitors use most are in your title (0–100).",
    plainSellThrough: "Sold ÷ (sold + remaining stock), from eBay's own estimated quantities.",
    plainBest: "In the top 10% by sales in this search.",
    formulaMonthly: "{sold} sold ÷ {months} months.",
    cardSoldNote: "Total sold: {n}.",
    cardBestNote: "Top {p}% by sold.",
    tipsTitle: "Title tips",
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
  get UI() { return ebayUI(); },
};

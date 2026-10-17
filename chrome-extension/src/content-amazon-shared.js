/**
 * KolayXport Research — Amazon Shared Content Script Utilities
 * ASIN extraction, BSR parsing, price parsing, DOM selectors for Amazon
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KX_AMZ_PREFIX = 'kx-amz-research';
const KX_AMZ_API_BASE = 'https://kolayxport.com';

// ---------------------------------------------------------------------------
// Inline CSS
// ---------------------------------------------------------------------------
const KX_AMZ_INLINE_CSS = `
.kx-data-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 8px; font-size: 11px; font-weight: 600;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #fff8e1; border-top: 1px solid #ffe0b2; color: #555;
  line-height: 1.4;
}
.kx-data-row .kx-sep { color: #ccc; font-weight: 400; }
.kx-data-row .kx-best { color: #b8860b; }
.kx-data-row .kx-green { color: #2e7d32; }
.kx-data-row .kx-orange { color: #e65100; }
.kx-data-row .kx-red { color: #c62828; }
.kx-data-row .kx-muted, .kx-stats-bar .kx-muted { color: #999; font-weight: 400; }
.kx-data-row .kx-tag {
  background: #eee; color: #666; border-radius: 3px; padding: 0 4px; font-size: 10px; font-weight: 700;
}
.kx-stats-bar .kx-stats-note { margin-top: 4px; font-size: 11px; color: #888; }
.kx-amz-badge {
  display: inline-flex; align-items: center; gap: 3px;
  background: linear-gradient(135deg, #FF9900 0%, #FF6600 100%);
  color: #fff; padding: 2px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 800; letter-spacing: 0.5px;
}
.kx-stats-bar {
  background: #fff8e1; border: 1px solid #ffe0b2; border-radius: 8px;
  padding: 10px 14px; margin: 10px 0; font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #444; line-height: 1.6;
}
.kx-stats-bar .kx-stats-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  font-weight: 700; font-size: 13px; color: #333;
}
.kx-stats-bar .kx-stats-logo {
  background: linear-gradient(135deg, #FF9900 0%, #FF6600 100%);
  color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800;
}
.kx-stats-bar .kx-stats-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.kx-stats-bar .kx-sep { color: #ccc; }
.kx-stats-bar .kx-green { color: #2e7d32; }
.kx-stats-bar .kx-orange { color: #e65100; }
.kx-stats-bar .kx-red { color: #c62828; }
.kx-ai-btn {
  background: linear-gradient(135deg, #FF9900 0%, #FF6600 100%);
  color: #fff; border: none; border-radius: 4px;
  padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
  transition: opacity 0.2s;
}
.kx-ai-btn:hover { opacity: 0.85; }
`;

function injectAmazonCSS() {
  if (document.getElementById('kx-amz-inline-css')) return;
  const style = document.createElement('style');
  style.id = 'kx-amz-inline-css';
  style.textContent = KX_AMZ_INLINE_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// ASIN Extraction
// ---------------------------------------------------------------------------

/**
 * Extract ASIN from a URL or the current page.
 * Supports /dp/ASIN, /gp/product/ASIN, /exec/obidos/ASIN patterns.
 */
function extractAsinFromUrl(url) {
  if (!url) url = window.location.href;
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/exec\/obidos\/ASIN\/([A-Z0-9]{10})/i,
    /\/(?:product|item)\/([A-Z0-9]{10})/i,
  ];
  for (const pat of patterns) {
    const match = url.match(pat);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/**
 * Extract ASINs from search result items.
 */
function extractAsinFromElement(el) {
  // data-asin attribute (most reliable)
  const asin = el.getAttribute('data-asin');
  if (asin && /^[A-Z0-9]{10}$/i.test(asin)) return asin.toUpperCase();

  // Try link href
  const link = el.querySelector('a[href*="/dp/"]');
  if (link) return extractAsinFromUrl(link.href);

  return null;
}

// ---------------------------------------------------------------------------
// Pure math/parsing lives in lib/amazonMath.js (unit-tested); this file only
// does DOM lookups and hands text to those parsers.
// ---------------------------------------------------------------------------
const kxAmzMath = window.__kxAmzMath;

const KX_AMZ_DEFAULT_CURRENCY = { US: 'USD', UK: 'GBP', DE: 'EUR', TR: 'TRY' };

function kxText(el) {
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

// ---------------------------------------------------------------------------
// Search results — card discovery and per-card fields
// ---------------------------------------------------------------------------

/**
 * Real search-result cards only. `[data-asin]` alone also matches carousel
 * tiles, "Related searches", sponsored-brand video widgets and nested
 * elements, which is how a 48-result page was reported as "141 products".
 */
function extractSearchCards(root) {
  const scope = root || document;
  const valid = (el) => /^[A-Z0-9]{10}$/i.test(el.getAttribute('data-asin') || '');
  let cards = Array.from(scope.querySelectorAll('[data-component-type="s-search-result"][data-asin]')).filter(valid);
  if (!cards.length) {
    cards = Array.from(scope.querySelectorAll('.s-main-slot > .s-result-item[data-asin], .s-search-results > .s-result-item[data-asin]'))
      .filter(valid)
      .filter((el) => !el.parentElement || !el.parentElement.closest('[data-asin]'));
  }
  return cards;
}

const KX_SPONSORED_WORDS = /^(sponsored|gesponsert|sponsorlu|sponsorisé|sponsorizzato|patrocinado)\b/i;

function isSponsoredCard(card) {
  if (card.classList.contains('AdHolder')) return true;
  if (card.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text, .puis-sponsored-label-info-icon, [data-component-type="sp-sponsored-result"], a[href*="/sspa/click"]')) {
    return true;
  }
  const labels = card.querySelectorAll('.puis-label-popover, .s-label-popover-default, .a-color-secondary');
  for (const l of labels) {
    if (KX_SPONSORED_WORDS.test(kxText(l))) return true;
  }
  return false;
}

// "4.4 out of 5 stars" / "4,4 von 5 Sternen" — never a review count.
const KX_RATING_LABEL = /out of 5|von 5|üzerinden|sur 5|su 5|de 5|stars?\b|sterne/i;
// "(633)", "(1.2K)", "15,234", "1.234"
const KX_BARE_COUNT = /^\(?\s*\d[\d.,  ]*\s*[KkMm]?\+?\s*\)?$/;

/**
 * Review (rating) count on a search card. Order of trust:
 *  1. aria-label of the link to #customerReviews ("15,234 ratings" — full number)
 *  2. its visible text ("(15,234)" or abbreviated "(15K)")
 *  3. any bare "(633)" count in the reviews block
 * The old selector `.a-size-small .a-link-normal` picked whatever link came
 * first in the card (variant links, "More buying choices $19.99", the rating
 * popover) and could not read "1.2K", which dragged the average to ~68.
 */
function extractCardReviewCount(card, marketplace) {
  const opts = { marketplace };
  const links = card.querySelectorAll('a[href*="#customerReviews"], a[href*="customerReviews"]');
  for (const a of links) {
    const aria = a.getAttribute('aria-label') || '';
    if (aria && !KX_RATING_LABEL.test(aria)) {
      const n = kxAmzMath.parseCount(aria, opts);
      if (n != null) return n;
    }
    const t = kxText(a);
    if (KX_BARE_COUNT.test(t)) {
      const n = kxAmzMath.parseCount(t, opts);
      if (n != null) return n;
    }
  }
  const block = card.querySelector('[data-cy="reviews-block"]') || card;
  const candidates = block.querySelectorAll('[aria-label], .s-underline-text, .a-size-base, .a-size-small');
  for (const el of candidates) {
    const aria = el.getAttribute('aria-label') || '';
    if (aria && /\d/.test(aria) && !KX_RATING_LABEL.test(aria) && /rating|review|bewertung|değerlendirme|^\s*[\d.,]+\s*$/i.test(aria)) {
      const n = kxAmzMath.parseCount(aria, opts);
      if (n != null) return n;
    }
    const t = kxText(el);
    if (el.children.length === 0 && KX_BARE_COUNT.test(t) && /^\(|\)$/.test(t)) {
      const n = kxAmzMath.parseCount(t, opts);
      if (n != null) return n;
    }
  }
  return null;
}

function extractCardRating(card) {
  const alt = card.querySelector('[data-cy="reviews-block"] .a-icon-alt, i[class*="a-star"] .a-icon-alt, .a-icon-star-small .a-icon-alt, .a-icon-star-mini .a-icon-alt');
  const r = alt ? kxAmzMath.parseRating(kxText(alt)) : null;
  if (r != null) return r;
  const trigger = card.querySelector('[aria-label*="out of 5"], [aria-label*="von 5"], [aria-label*="üzerinden"]');
  return trigger ? kxAmzMath.parseRating(trigger.getAttribute('aria-label')) : null;
}

/** Current price on a card. Skips list/strike-through and per-unit prices (.a-text-price). */
function extractCardPrice(card, marketplace) {
  const cur = KX_AMZ_DEFAULT_CURRENCY[marketplace];
  const prices = card.querySelectorAll('[data-cy="price-recipe"] .a-price, .a-price');
  for (const p of prices) {
    if (p.classList.contains('a-text-price') || p.closest('.a-text-price')) continue;
    const parsed = extractPrice(p, cur);
    if (parsed) return parsed;
  }
  return null;
}

/** "5K+ bought in past month" — Amazon's own demand floor. */
function extractCardBought(card, marketplace) {
  const spans = card.querySelectorAll('[data-cy="reviews-block"] span, .a-row.a-size-base span, span.a-color-secondary, span');
  for (const s of spans) {
    if (s.children.length > 2) continue;
    const t = kxText(s);
    if (!t || t.length > 90) continue;
    const b = kxAmzMath.parseBoughtPastMonth(t, { marketplace });
    if (b) return b;
  }
  return null;
}

function parseSearchCard(card, marketplace) {
  const price = extractCardPrice(card, marketplace);
  return {
    asin: extractAsinFromElement(card),
    sponsored: isSponsoredCard(card),
    price: price ? price.value : null,
    currency: price ? price.currency : KX_AMZ_DEFAULT_CURRENCY[marketplace] || null,
    reviews: extractCardReviewCount(card, marketplace),
    rating: extractCardRating(card),
    bought: extractCardBought(card, marketplace),
  };
}

/** "1-48 of over 3,000 results for "turkish towel"" → { total, isLowerBound } */
function extractTotalResults() {
  const el = document.querySelector('[data-component-type="s-result-info-bar"] h1, [data-component-type="s-result-info-bar"] .a-section, .s-desktop-toolbar h1, #search .s-breadcrumb');
  return el ? kxAmzMath.parseTotalResults(kxText(el)) : null;
}

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

const KX_BSR_LABEL = /best\s*sellers?\s*rank|bestseller-rang|amazon bestseller|en çok satanlar|çok satanlar sıralaması|classement des meilleures ventes/i;

/**
 * Best Seller Rank on a product page: { rank, category, sub: [{rank, category}] }.
 * Handles the product-details table, detail bullets, and de "Nr. 1.234 in …".
 */
function extractBsrInfo() {
  const texts = [];
  document.querySelectorAll('#productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr, #productDetails_db_sections tr, .prodDetTable tr').forEach((row) => {
    const th = row.querySelector('th');
    const td = row.querySelector('td');
    if (th && td && KX_BSR_LABEL.test(kxText(th))) texts.push(kxText(td));
  });
  document.querySelectorAll('#detailBulletsWrapper_feature_div li, #detailBullets_feature_div li, #SalesRank').forEach((li) => {
    const t = kxText(li);
    if (KX_BSR_LABEL.test(t) || li.id === 'SalesRank') texts.push(t);
  });
  for (const t of texts) {
    const ranks = kxAmzMath.parseBsrText(t);
    if (ranks.length) return { rank: ranks[0].rank, category: ranks[0].category, sub: ranks.slice(1) };
  }
  return null;
}

/** Back-compat: just the top-level rank number. */
function extractBsr() {
  const info = extractBsrInfo();
  return info ? info.rank : null;
}

function extractCategory() {
  const breadcrumbs = document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a, .a-breadcrumb a');
  if (breadcrumbs.length > 0) {
    return Array.from(breadcrumbs).map(a => a.textContent?.trim()).filter(Boolean).join(' > ');
  }
  return null;
}

/**
 * Price from an `.a-price` element → { value, currency }.
 * Prefers the localized `.a-offscreen` string ("1.234,56 €"); falls back to
 * whole + fraction digits.
 */
function extractPrice(el, fallbackCurrency) {
  if (!el) return null;
  const offscreen = el.querySelector('.a-offscreen') || (el.classList.contains('a-offscreen') ? el : null);
  const offText = kxText(offscreen);
  if (offText) {
    const p = kxAmzMath.parsePrice(offText, fallbackCurrency);
    if (p) return p;
  }
  const whole = el.querySelector('.a-price-whole');
  if (whole) {
    const w = (whole.textContent || '').replace(/[^0-9]/g, '');
    const fEl = el.querySelector('.a-price-fraction');
    const f = fEl ? (fEl.textContent || '').replace(/[^0-9]/g, '') : '00';
    const value = parseFloat(`${w}.${f || '00'}`);
    if (value > 0) {
      const sym = kxText(el.querySelector('.a-price-symbol'));
      const p = kxAmzMath.parsePrice(`${sym}${value}`, fallbackCurrency);
      return p || { value, currency: fallbackCurrency || null };
    }
  }
  const own = kxText(el);
  return own ? kxAmzMath.parsePrice(own, fallbackCurrency) : null;
}

function extractPriceFromPage(marketplace) {
  const cur = KX_AMZ_DEFAULT_CURRENCY[marketplace || detectAmazonMarketplace()];
  const selectors = [
    '#corePrice_feature_div .a-price.priceToPay',
    '#corePriceDisplay_desktop_feature_div .a-price.priceToPay',
    '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price)',
    '#corePrice_feature_div .a-price:not(.a-text-price)',
    '#apex_desktop .a-price:not(.a-text-price)',
    '#price_inside_buybox',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const price = extractPrice(el, cur);
    if (price) return price;
  }
  return null;
}

function extractReviewCount(marketplace) {
  const el = document.querySelector('#acrCustomerReviewText, #acrCustomerReviewLink');
  if (!el) return null;
  const aria = el.getAttribute('aria-label') || '';
  const n = kxAmzMath.parseCount(aria && !KX_RATING_LABEL.test(aria) ? aria : kxText(el), { marketplace });
  return n;
}

function extractRating() {
  const pop = document.querySelector('#acrPopover');
  const fromTitle = pop ? kxAmzMath.parseRating(pop.getAttribute('title') || '') : null;
  if (fromTitle != null) return fromTitle;
  const el = document.querySelector('#acrPopover .a-icon-alt, [data-hook="rating-out-of-text"], .reviewCountTextLinkedHistogram .a-icon-alt');
  return el ? kxAmzMath.parseRating(kxText(el)) : null;
}

function extractBoughtFromPage(marketplace) {
  const el = document.querySelector('#social-proofing-faceout-title-tk_bought, #socialProofingAsinFaceout_feature_div');
  return el ? kxAmzMath.parseBoughtPastMonth(kxText(el), { marketplace }) : null;
}

// ---------------------------------------------------------------------------
// Official Amazon data (SP-API via KolayXport server) — optional enrichment.
// Resolves to null on any failure; callers fall back to page data.
// ---------------------------------------------------------------------------

function requestSpApiSignals(asins, marketplace) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.sendMessage || !asins.length) return resolve(null);
      const L = window.__KX_LIMIT;
      chrome.runtime.sendMessage(
        { type: 'kx_amazon_enrich', params: { asins: asins.slice(0, 20), marketplace }, pv: L ? L.pageViewId() : undefined },
        (response) => {
          if (chrome.runtime.lastError || !response) return resolve(null);
          if (response.error) {
            // 429 research limit: the overlays show the limit card instead of numbers.
            const limit = L ? L.fromResponse(response) : null;
            if (limit) return resolve({ available: false, reason: 'research_limit', limit });
            return resolve({ available: false, reason: response.status === 401 ? 'not_signed_in' : 'unavailable' });
          }
          resolve(response);
        }
      );
    } catch (_) {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Marketplace detection
// ---------------------------------------------------------------------------

function detectAmazonMarketplace() {
  const host = window.location.hostname;
  if (host.includes('amazon.com.tr')) return 'TR';
  if (host.includes('amazon.de')) return 'DE';
  if (host.includes('amazon.co.uk')) return 'UK';
  if (host.includes('amazon.com')) return 'US';
  return 'US';
}

// ---------------------------------------------------------------------------
// URL change observer (Amazon is an SPA in many cases)
// ---------------------------------------------------------------------------

function observeUrlChanges(callback) {
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      callback(lastUrl);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

/** Replace an overlay's content with the research-limit card for a `research_limit` SP-API answer. */
function amzShowLimitCard(container, resp, surface) {
  const L = window.__KX_LIMIT;
  if (!L || !container || !resp || !resp.limit) return false;
  L.render(container, resp.limit, { surface });
  return true;
}

// ---------------------------------------------------------------------------
// i18n — Turkish / English (language from lib/lang.js: popup choice → account → 'tr')
// ---------------------------------------------------------------------------

function amzLang() {
  const L = window.__KX_LANG;
  return (L && L.get()) || 'tr';
}

/** Numbers and money follow the overlay language; the currency stays the marketplace's. */
function amzLocale() {
  return amzLang() === 'en' ? 'en-US' : 'tr-TR';
}

/** Resolves once the language is known; overlays render only after this. */
function amzLangReady() {
  const L = window.__KX_LANG;
  return L && L.ready ? L.ready : Promise.resolve(amzLang());
}

function onAmzLangChange(cb) {
  const L = window.__KX_LANG;
  if (L && L.onChange) L.onChange(cb);
}

const KX_AMZ_I18N = {
  tr: {
    perMonth: '/ay',
    ad: 'Reklam',
    adTip: 'Sponsorlu sonuç (reklam)',
    ratings: '{n} değerlendirme',
    offers: '{n} teklif',
    offersTip: 'Bu ASIN\'deki rakip teklifler (resmi Amazon API)',
    bsrTip: 'Resmi Amazon API\'sinden En Çok Satanlar sıralaması (BSR)',
    aiTip: 'KolayXport AI ile analiz edin',
    amazonFig: 'Amazon: {label} satış/ay',
    amazonFigTip: 'Amazon\'un ilanda gösterdiği kendi verisi: "geçen ay {label} satın alındı". Kesin sayı değil, alt sınırdır.',
    revFloorTip: 'Amazon\'un alt sınırı × güncel fiyat. {label} adetten fazla satıldıysa gerçek gelir daha yüksektir.',
    estUnits: 'tahmini ~{n}/ay',
    estRev: 'tahmini ~{money}/ay',
    estTip: 'Ölçüm değil, tahmin: {cat} kategorisinde BSR #{bsr} (resmi Amazon verisi), {curve} BSR→satış eğrisiyle hesaplandı. Olası aralık {band}/ay.',
    itsCategory: 'kendi',
    uncalibrated: ' Model amazon.com verisiyle kalibre edildi; bu pazaryerinde muhtemelen olduğundan yüksek gösterir.',
    noSales: 'satış: veri yok',
    noSalesTip: 'Amazon bu ürün için "geçen ay satın alındı" rozeti göstermiyor (genellikle ayda ~50\'nin altı, kesin değil) ve resmi sıralama verisi yok. Tahmin yürütmüyoruz.',
    reason_not_signed_in: 'resmi Amazon verilerini eklemek için bu tarayıcıda KolayXport\'a giriş yapın',
    reason_not_connected: 'BSR ve teklif sayılarını eklemek için Amazon satıcı hesabınızı KolayXport\'a bağlayın',
    reason_marketplace_not_connected: 'Amazon satıcı hesabınız bu pazaryerinde kayıtlı değil',
    reason_access_denied: 'Amazon, KolayXport uygulamasına katalog/fiyat rolünü henüz vermedi',
    reason_unavailable: 'Amazon API yanıt vermedi',
    compLow: 'Düşük', compMedium: 'Orta', compHigh: 'Yüksek', compUnknown: 'Veri yetersiz',
    compTipScore: 'Skor {score}/100 (Yüksek ≥ {high}, Orta ≥ {medium}).',
    compTipResults: 'Sonuç: {results}.',
    unknown: 'bilinmiyor',
    overN: '{n}+',
    compTipMedians: 'Medyan değerlendirme (organik, bu sayfa): {page}; ilk 10 medyanı: {top10}.',
    compTipShares: '1K+ değerlendirmeli organik sonuçlar: {big}. Sayfadaki reklamlar: {ads}.',
    compTipOffers: 'Medyan rakip teklif (Amazon API): {n}.',
    compTipNote: 'Not: {reasons}.',
    'reason:not enough organic results with review counts': 'değerlendirme sayısı okunabilen yeterli organik sonuç yok',
    'reason:deep review moat among top results': 'üst sıralardaki ürünlerin çok sayıda değerlendirmesi var',
    'reason:top results already have hundreds of reviews': 'üst sıralardaki ürünlerin şimdiden yüzlerce değerlendirmesi var',
    sourcePage: 'Kaynak: bu sayfa',
    sourceSp: ' + {n} ürün için resmi Amazon verisi (SP-API)',
    sourceSpOne: ' + {n} ürün için resmi Amazon verisi (SP-API)',
    sourceOff: ' · Resmi Amazon verisi kapalı: {reason}',
    snapshot: 'Amazon Pazar Özeti · bu sayfada {organic} sonuç + {ads} reklam{total}',
    snapshotTotal: ' (toplam {total})',
    adWordOne: 'reklam', adWordMany: 'reklam',
    medianPrice: 'Medyan fiyat',
    range: 'Aralık',
    medianRatings: 'Medyan değerlendirme',
    medianRatingsTip: 'Bu sayfadaki organik (reklamsız) sonuçların medyan değerlendirme sayısı',
    top10Median: 'İlk 10 medyanı',
    top10MedianTip: 'İlk 10 organik sonucun medyan değerlendirme sayısı',
    avgRating: 'Ort. puan',
    ads: 'Reklam',
    competition: 'Rekabet',
    deepAi: 'Detaylı AI Analizi',
    boughtNote: 'Amazon "geçen ay satın alındı": {n} üründen {k} tanesinde var; toplamda en az {units} adet/ay (Amazon\'un alt sınırları, tahmin değil).',
    boughtNone: 'Bu sayfadaki hiçbir üründe Amazon\'un "geçen ay satın alındı" verisi yok.',
    productIntel: 'Ürün Analizi',
    sales: 'Satış',
    boughtLastMonth: 'Geçen ay satılan (Amazon)',
    boughtLastMonthTip: 'Amazon\'un kendi verisi: kesin sayı değil, alt sınır',
    revFloor: 'Gelir/ay (alt sınır)',
    revFloorShortTip: 'Amazon\'un alt sınırı × güncel fiyat',
    bsrCompare: 'Karşılaştırma için BSR modeli: tahmini ~{units}/ay (aralık {low}–{high})',
    estSales: 'Tahmini satış/ay',
    estSalesTip: 'Aralık {low}–{high}/ay',
    estRevenue: 'Tahmini gelir/ay',
    estFromBsr: 'BSR\'den tahmin ({curve} eğrisi), olası aralık {low}–{high}/ay.',
    curveUncalibrated: ' Eğri amazon.com verisiyle kalibre edildi; bu pazaryerinde muhtemelen olduğundan yüksek gösterir.',
    noBoughtFigure: ' Amazon bu ürün için "geçen ay satın alındı" verisi göstermiyor.',
    noSalesData: 'Satış verisi yok: bu sayfada "geçen ay satın alındı" verisi ve BSR yok.',
    bsrIn: '{cat} kategorisinde BSR #{rank}',
    subRankIn: '{cat}: #{rank}',
    officialData: ' (resmi Amazon verisi)',
    feeTitle: 'Komisyon tahmini (kaba)',
    referral: 'Satış komisyonu ~%15',
    afterReferral: 'Komisyon sonrası',
    feeNote: 'Komisyon oranları kategoriye göre değişir (yaklaşık %8–17). FBA gönderim ücretleri boyut ve ağırlığa bağlıdır ve dahil değildir.',
    aiAnalysis: 'AI Analizi',
    marketResearch: 'Pazar Araştırması',
  },
  en: {
    perMonth: '/mo',
    ad: 'Ad',
    adTip: 'Sponsored result (ad)',
    ratings: '{n} ratings',
    offers: '{n} offers',
    offersTip: 'Competing offers on this ASIN (official Amazon API)',
    bsrTip: 'Best Seller Rank from the official Amazon API',
    aiTip: 'Analyze with KolayXport AI',
    amazonFig: 'Amazon: {label} bought/mo',
    amazonFigTip: 'Amazon\'s own figure, shown on the listing: \'{label} bought in past month\'. It is a floor, not an exact count.',
    revFloorTip: 'Amazon\'s floor × current price. Real revenue is higher if more than {label} were sold.',
    estUnits: 'est. ~{n}/mo',
    estRev: 'est. ~{money}/mo',
    estTip: 'Estimate, not measured: Best Seller Rank #{bsr} in {cat} (official Amazon data) run through a {curve} BSR-to-sales curve. Likely range {band}/mo.',
    itsCategory: 'its category',
    uncalibrated: ' Model is calibrated on amazon.com and likely overstates this marketplace.',
    noSales: 'sales: no data',
    noSalesTip: 'Amazon shows no \'bought in past month\' badge for this item (usually under ~50/mo, not guaranteed) and no official rank data is available. We do not guess.',
    reason_not_signed_in: 'sign in to KolayXport in this browser to add official Amazon data',
    reason_not_connected: 'connect your Amazon seller account in KolayXport to add BSR and offer counts',
    reason_marketplace_not_connected: 'your Amazon seller account is not registered in this marketplace',
    reason_access_denied: 'Amazon has not granted the KolayXport app the catalog/pricing role yet',
    reason_unavailable: 'Amazon API did not respond',
    compLow: 'Low', compMedium: 'Medium', compHigh: 'High', compUnknown: 'Unknown',
    compTipScore: 'Score {score}/100 (High ≥ {high}, Medium ≥ {medium}).',
    compTipResults: 'Results: {results}.',
    unknown: 'unknown',
    overN: 'over {n}',
    compTipMedians: 'Median ratings (organic, this page): {page}; top-10 median: {top10}.',
    compTipShares: 'Organic results with 1K+ ratings: {big}. Ads on page: {ads}.',
    compTipOffers: 'Median competing offers (Amazon API): {n}.',
    compTipNote: 'Note: {reasons}.',
    sourcePage: 'Source: this page',
    sourceSp: ' + official Amazon data (SP-API) for {n} products',
    sourceSpOne: ' + official Amazon data (SP-API) for {n} product',
    sourceOff: ' · Official Amazon data off: {reason}',
    snapshot: 'Amazon Market Snapshot · {organic} results + {ads} {adWord} on this page{total}',
    snapshotTotal: ' (of {total})',
    adWordOne: 'ad', adWordMany: 'ads',
    medianPrice: 'Median price',
    range: 'Range',
    medianRatings: 'Median ratings',
    medianRatingsTip: 'Median rating count of organic (non-ad) results on this page',
    top10Median: 'Top-10 median',
    top10MedianTip: 'Median rating count of the first 10 organic results',
    avgRating: 'Avg rating',
    ads: 'Ads',
    competition: 'Competition',
    deepAi: 'Deep AI Analysis',
    boughtNote: 'Amazon "bought in past month": {k} of {n} products show it, together at least {units} units/mo (Amazon\'s floors, not estimates).',
    boughtNone: 'No product on this page shows Amazon\'s "bought in past month" figure.',
    productIntel: 'Product Intelligence',
    sales: 'Sales',
    boughtLastMonth: 'Bought last month (Amazon)',
    boughtLastMonthTip: 'Amazon\'s own figure: a floor, not an exact count',
    revFloor: 'Revenue/mo (floor)',
    revFloorShortTip: 'Amazon\'s floor × current price',
    bsrCompare: 'BSR model for comparison: est. ~{units}/mo (range {low}–{high})',
    estSales: 'Est. sales/mo',
    estSalesTip: 'Range {low}–{high}/mo',
    estRevenue: 'Est. revenue/mo',
    estFromBsr: 'Estimate from BSR ({curve} curve), likely range {low}–{high}/mo.',
    curveUncalibrated: ' Curve is calibrated on amazon.com; likely overstates this marketplace.',
    noBoughtFigure: ' Amazon shows no "bought in past month" figure for this item.',
    noSalesData: 'No sales data: no "bought in past month" figure and no Best Seller Rank on this page.',
    bsrIn: 'BSR #{rank} in {cat}',
    subRankIn: '#{rank} in {cat}',
    officialData: ' (official Amazon data)',
    feeTitle: 'Fee estimate (rough)',
    referral: 'Referral ~15%',
    afterReferral: 'After referral',
    feeNote: 'Referral rates vary by category (about 8–17%). FBA fulfilment fees depend on size and weight and are not included.',
    aiAnalysis: 'AI Analysis',
    marketResearch: 'Market Research',
  },
};

function amzT(key, vars) {
  const table = KX_AMZ_I18N[amzLang()] || KX_AMZ_I18N.tr;
  let s = table[key] !== undefined ? table[key] : (KX_AMZ_I18N.en[key] !== undefined ? KX_AMZ_I18N.en[key] : key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  return s;
}

/** Competition level from amazonMath ('Low' | 'Medium' | 'High' | 'Unknown') in the overlay language. */
function amzCompLabel(level) {
  return amzT({ Low: 'compLow', Medium: 'compMedium', High: 'compHigh' }[level] || 'compUnknown');
}

/** A reason string from amazonMath.computeCompetition in the overlay language. */
function amzReason(r) {
  const k = 'reason:' + r;
  const table = KX_AMZ_I18N[amzLang()] || {};
  return table[k] || r;
}

/** "3.2K" → "3,2K" in Turkish (K/M kept: what sellers see on Amazon). */
function amzFormatCompact(n) {
  const s = kxAmzMath.formatCompact(n);
  return amzLang() === 'tr' ? s.replace('.', ',') : s;
}

/** Integer with the language's grouping ("1.234" in Turkish). */
function amzFormatInt(n) {
  return n == null || !isFinite(n) ? '—' : Number(n).toLocaleString(amzLocale());
}

/** Money in the marketplace currency, formatted for the overlay language ("$24,99" in Turkish). */
function amzFormatMoney(value, currency, compact) {
  if (value == null || !isFinite(value)) return '—';
  if (compact) {
    const m = kxAmzMath.formatMoney(value, currency, true);
    return amzLang() === 'tr' ? m.replace(/(\d)\.(\d)/, '$1,$2') : m;
  }
  if (currency) {
    try {
      return new Intl.NumberFormat(amzLocale(), { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    } catch (_) { /* unknown currency code */ }
  }
  return kxAmzMath.formatMoney(value, currency, false);
}

/** Rating with one decimal ("4,4" in Turkish). */
function amzFormatRating(r) {
  return Number(r).toLocaleString(amzLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Make shared functions available to other content scripts
window.__kxAmzShared = {
  showLimitCard: amzShowLimitCard,
  t: amzT,
  get lang() { return amzLang(); },
  locale: amzLocale,
  langReady: amzLangReady,
  onLangChange: onAmzLangChange,
  compLabel: amzCompLabel,
  reasonText: amzReason,
  formatCompact: amzFormatCompact,
  formatInt: amzFormatInt,
  formatMoney: amzFormatMoney,
  formatRating: amzFormatRating,
  math: kxAmzMath,
  injectAmazonCSS,
  extractAsinFromUrl,
  extractAsinFromElement,
  extractSearchCards,
  parseSearchCard,
  isSponsoredCard,
  extractTotalResults,
  extractBsr,
  extractBsrInfo,
  extractCategory,
  extractPrice,
  extractPriceFromPage,
  extractReviewCount,
  extractRating,
  extractBoughtFromPage,
  requestSpApiSignals,
  detectAmazonMarketplace,
  observeUrlChanges,
  KX_AMZ_DEFAULT_CURRENCY,
  KX_AMZ_PREFIX,
  KX_AMZ_API_BASE,
};

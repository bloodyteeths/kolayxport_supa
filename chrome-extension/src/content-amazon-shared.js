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
// BSR Extraction
// ---------------------------------------------------------------------------

/**
 * Extract Best Seller Rank from product detail page.
 */
function extractBsr() {
  // Method 1: Product details table
  const detailBullets = document.querySelectorAll('#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr');
  for (const el of detailBullets) {
    const text = el.textContent || '';
    if (/best\s*seller/i.test(text)) {
      const match = text.match(/#?([\d,]+)\s+in\s+/i);
      if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    }
  }

  // Method 2: SalesRank in product info
  const rankEl = document.querySelector('#SalesRank');
  if (rankEl) {
    const match = (rankEl.textContent || '').match(/#?([\d,]+)/);
    if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  }

  // Method 3: Product information section
  const infoRows = document.querySelectorAll('.a-keyvalue tr, #productDetails_detailBullets_sections1 tr');
  for (const row of infoRows) {
    const label = row.querySelector('th, .a-span3');
    const value = row.querySelector('td, .a-span9');
    if (label && value && /best\s*seller/i.test(label.textContent || '')) {
      const match = (value.textContent || '').match(/#?([\d,]+)/);
      if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    }
  }

  return null;
}

/**
 * Extract category from product page.
 */
function extractCategory() {
  const breadcrumbs = document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a, .a-breadcrumb a');
  if (breadcrumbs.length > 0) {
    return Array.from(breadcrumbs).map(a => a.textContent?.trim()).filter(Boolean).join(' > ');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Price Extraction
// ---------------------------------------------------------------------------

function extractPrice(el) {
  // Try whole + fraction pattern
  const whole = el?.querySelector('.a-price-whole');
  const fraction = el?.querySelector('.a-price-fraction');
  if (whole) {
    const w = whole.textContent.replace(/[^0-9]/g, '');
    const f = fraction ? fraction.textContent.replace(/[^0-9]/g, '') : '00';
    return parseFloat(`${w}.${f}`);
  }

  // Try offscreen price
  const offscreen = el?.querySelector('.a-offscreen');
  if (offscreen) {
    const match = offscreen.textContent.match(/[\d,.]+/);
    if (match) return parseFloat(match[0].replace(/,/g, ''));
  }

  return null;
}

function extractPriceFromPage() {
  const selectors = [
    '#corePrice_feature_div .a-price',
    '#price_inside_buybox',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
    '.a-price.aok-align-center',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const price = extractPrice(el);
    if (price) return price;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Review Extraction
// ---------------------------------------------------------------------------

function extractReviewCount() {
  const el = document.querySelector('#acrCustomerReviewCount, #ratings-summary .a-link-normal');
  if (el) {
    const match = (el.textContent || '').match(/([\d,]+)/);
    if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return null;
}

function extractRating() {
  const el = document.querySelector('#acrPopover .a-icon-alt, .reviewCountTextLinkedHistogram .a-icon-alt');
  if (el) {
    const match = (el.textContent || '').match(/([\d.]+)/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// BSR-to-Sales Estimation (simplified — matches server-side algorithm)
// ---------------------------------------------------------------------------

const AMZ_CATEGORY_CURVES = {
  _default: { base: 5000, exponent: 0.57 },
  'Electronics': { base: 5000, exponent: 0.57 },
  'Home & Kitchen': { base: 8000, exponent: 0.60 },
  'Toys & Games': { base: 7000, exponent: 0.60 },
  'Books': { base: 10000, exponent: 0.63 },
  'Clothing': { base: 8000, exponent: 0.60 },
  'Sports': { base: 6000, exponent: 0.58 },
  'Health': { base: 6000, exponent: 0.58 },
  'Beauty': { base: 6000, exponent: 0.58 },
  'Pet Supplies': { base: 5000, exponent: 0.57 },
  'Baby': { base: 5000, exponent: 0.57 },
  'Garden': { base: 5000, exponent: 0.57 },
  'Tools': { base: 5000, exponent: 0.57 },
  'Automotive': { base: 4000, exponent: 0.55 },
  'Grocery': { base: 6000, exponent: 0.58 },
  'Office': { base: 4000, exponent: 0.55 },
};

function estimateMonthlySales(bsr, categoryName) {
  if (!bsr || bsr < 1) return 0;

  let curve = AMZ_CATEGORY_CURVES._default;
  if (categoryName) {
    const lower = categoryName.toLowerCase();
    for (const [key, val] of Object.entries(AMZ_CATEGORY_CURVES)) {
      if (key === '_default') continue;
      if (lower.includes(key.toLowerCase())) { curve = val; break; }
    }
  }

  return Math.max(1, Math.round(curve.base * Math.pow(bsr, -curve.exponent)));
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

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function salesColor(sales) {
  if (sales >= 300) return 'kx-green';
  if (sales >= 50) return 'kx-orange';
  return 'kx-red';
}

// Make shared functions available to other content scripts
window.__kxAmzShared = {
  injectAmazonCSS,
  extractAsinFromUrl,
  extractAsinFromElement,
  extractBsr,
  extractCategory,
  extractPrice,
  extractPriceFromPage,
  extractReviewCount,
  extractRating,
  estimateMonthlySales,
  detectAmazonMarketplace,
  observeUrlChanges,
  formatNumber,
  salesColor,
  KX_AMZ_PREFIX,
  KX_AMZ_API_BASE,
};

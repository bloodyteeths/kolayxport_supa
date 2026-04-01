/**
 * KolayXport Research — eBay Shared Content Script Utilities
 * Shadow DOM overlay injection, URL change observer, DOM selectors for eBay
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KX_EBAY_PREFIX = 'kx-ebay-research';
const EBAY_API_BASE = 'https://kolayxport.com';

// ---------------------------------------------------------------------------
// Shadow DOM Container (same styling as Etsy)
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
    .kx-badge {
      position: absolute; top: 4px; left: 4px; z-index: 100;
      background: rgba(0,0,0,0.85); color: #fff; padding: 3px 6px;
      border-radius: 4px; font-size: 10px; font-weight: 600;
      display: flex; align-items: center; gap: 3px;
      backdrop-filter: blur(4px); pointer-events: none;
    }
    .kx-badge-green { background: rgba(76,175,80,0.9); }
    .kx-badge-yellow { background: rgba(255,152,0,0.9); }
    .kx-badge-red { background: rgba(244,67,54,0.9); }
    .kx-panel {
      position: fixed; top: 80px; right: 0; width: 320px; max-height: calc(100vh - 100px);
      background: #fff; border-left: 1px solid #e0e0e0; box-shadow: -4px 0 20px rgba(0,0,0,0.1);
      overflow-y: auto; z-index: 10000; font-size: 13px; transition: transform 0.3s;
    }
    .kx-panel-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 1;
    }
    .kx-panel-body { padding: 12px 16px; }
    .kx-panel-section { margin-bottom: 12px; }
    .kx-panel-section-title { font-weight: 700; font-size: 12px; color: #667eea; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kx-score-ring {
      width: 60px; height: 60px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-weight: 900; font-size: 18px; color: #fff;
    }
    .kx-score-high { background: linear-gradient(135deg, #11998e, #38ef7d); }
    .kx-score-mid { background: linear-gradient(135deg, #F2994A, #F2C94C); }
    .kx-score-low { background: linear-gradient(135deg, #eb3349, #f45c43); }
    .kx-tag { display: inline-block; padding: 2px 8px; margin: 2px; border-radius: 12px; font-size: 11px; background: #f0f0f0; color: #333; }
    .kx-tag-good { background: #e8f5e9; color: #2e7d32; }
    .kx-tag-weak { background: #ffebee; color: #c62828; }
    .kx-btn {
      display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px;
      border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff;
      transition: opacity 0.2s;
    }
    .kx-btn:hover { opacity: 0.9; }
    .kx-btn-sm { padding: 3px 8px; font-size: 11px; }
    .kx-btn-outline { background: transparent; border: 1px solid #667eea; color: #667eea; }
    .kx-metric { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
    .kx-metric-label { color: #666; font-size: 12px; }
    .kx-metric-value { font-weight: 700; font-size: 13px; }
    .kx-progress { height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; }
    .kx-progress-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
    .kx-hidden { display: none !important; }
    .kx-loading { text-align: center; padding: 20px; color: #999; }
    .kx-toggle {
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff; border: none; cursor: pointer; padding: 8px 4px;
      border-radius: 6px 0 0 6px; font-size: 11px; writing-mode: vertical-rl;
      z-index: 9999; box-shadow: -2px 0 8px rgba(102,126,234,0.3);
    }
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
// URL Change Observer (eBay SPA navigation)
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
// DOM Selectors (eBay-specific)
// ---------------------------------------------------------------------------
const EBAY_SELECTORS = {
  // Search results
  searchResultCard: '.s-item',
  searchResultLink: 'a[href*="/itm/"]',

  searchQuery: () => {
    const params = new URLSearchParams(location.search);
    return params.get('_nkw') || '';
  },

  // Listing page — item ID is the last numeric segment of /itm/ URL
  itemId: () => {
    const match = location.pathname.match(/\/itm\/(?:[^/]*\/)?(\d+)/);
    if (match) return match[1];
    // Also try just trailing number
    const trailingMatch = location.pathname.match(/\/itm\/.*?(\d{8,})(?:\?|$)/);
    return trailingMatch ? trailingMatch[1] : null;
  },

  // Seller page
  sellerName: () => {
    const match = location.pathname.match(/\/usr\/([^/?#]+)/);
    return match ? match[1] : null;
  },

  // Item title on listing page
  itemTitle: () => {
    const h1 = document.querySelector('h1.x-item-title__mainTitle') ||
               document.querySelector('#itemTitle') ||
               document.querySelector('h1[data-testid="x-item-title"]') ||
               document.querySelector('.x-item-title h1');
    return h1 ? h1.textContent.trim() : '';
  },
};

// ---------------------------------------------------------------------------
// Page Type Detection (eBay)
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
// API Communication (via background script — uses kx_ebay_research type)
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
// Helpers (same as Etsy shared)
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
  if (level === 'low') return 'kx-badge-green';
  if (level === 'medium') return 'kx-badge-yellow';
  return 'kx-badge-red';
}

function ebayScoreClass(score) {
  if (score >= 70) return 'kx-score-high';
  if (score >= 40) return 'kx-score-mid';
  return 'kx-score-low';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
window.__KX_EBAY_SHARED = {
  KX_EBAY_PREFIX,
  API_BASE: EBAY_API_BASE,
  createOverlayContainer: createEbayOverlayContainer,
  onUrlChange: onEbayUrlChange,
  SELECTORS: EBAY_SELECTORS,
  apiCall: ebayApiCall,
  formatNum: ebayFormatNum,
  formatPrice: ebayFormatPrice,
  competitionColor: ebayCompetitionColor,
  scoreClass: ebayScoreClass,
  getPageType: getEbayPageType,
};

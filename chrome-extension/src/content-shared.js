/**
 * KolayXport Research — Shared Content Script Utilities
 * Shadow DOM overlay injection, URL change observer, DOM selectors
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const KX_PREFIX = 'kx-research';
const API_BASE = 'https://kolayxport.com';

// ---------------------------------------------------------------------------
// Shadow DOM Container
// ---------------------------------------------------------------------------
function createOverlayContainer(id, position = 'top') {
  const existing = document.getElementById(id);
  if (existing) return existing.shadowRoot;

  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all: initial; position: relative; z-index: 9999;';
  const shadow = host.attachShadow({ mode: 'open' });

  // Inject base styles
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
  } else if (position === 'fixed') {
    document.body.appendChild(host);
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

// Start observing
const _urlObserver = new MutationObserver(() => {
  if (location.href !== _lastUrl) {
    const oldUrl = _lastUrl;
    _lastUrl = location.href;
    _urlCallbacks.forEach(cb => cb(_lastUrl, oldUrl));
  }
});
_urlObserver.observe(document.body, { childList: true, subtree: true });

// Also catch popstate
window.addEventListener('popstate', () => {
  if (location.href !== _lastUrl) {
    const oldUrl = _lastUrl;
    _lastUrl = location.href;
    _urlCallbacks.forEach(cb => cb(_lastUrl, oldUrl));
  }
});

// ---------------------------------------------------------------------------
// DOM Selectors (with fallback)
// ---------------------------------------------------------------------------
const SELECTORS = {
  // Search results page
  searchResultsGrid: '[data-search-results], .search-listings-group, .wt-grid',
  searchResultCard: '[data-listing-id], .v2-listing-card, .listing-link',
  searchResultLink: 'a[href*="/listing/"]',
  searchQuery: () => {
    const params = new URLSearchParams(location.search);
    return params.get('q') || params.get('search_query') || '';
  },

  // Listing page
  listingId: () => {
    const match = location.pathname.match(/\/listing\/(\d+)/);
    return match ? match[1] : null;
  },

  // Shop page
  shopName: () => {
    const match = location.pathname.match(/\/shop\/([^/?#]+)/);
    return match ? match[1] : null;
  },
  shopId: () => {
    // Try data attribute first, then meta
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
// Helper: Format numbers
// ---------------------------------------------------------------------------
function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatPrice(n) {
  return '$' + Number(n).toFixed(2);
}

// ---------------------------------------------------------------------------
// Helper: Competition color
// ---------------------------------------------------------------------------
function competitionColor(level) {
  if (level === 'low') return 'kx-badge-green';
  if (level === 'medium') return 'kx-badge-yellow';
  return 'kx-badge-red';
}

function scoreClass(score) {
  if (score >= 70) return 'kx-score-high';
  if (score >= 40) return 'kx-score-mid';
  return 'kx-score-low';
}

// ---------------------------------------------------------------------------
// Page Type Detection
// ---------------------------------------------------------------------------
function getPageType() {
  const path = location.pathname;
  if (path.includes('/search') || location.search.includes('search_query') || location.search.includes('q=')) return 'search';
  if (path.match(/\/listing\/\d+/)) return 'listing';
  if (path.match(/\/shop\/[^/]+\/?$/)) return 'shop';
  return 'other';
}

// ---------------------------------------------------------------------------
// Exports (attached to window for cross-script access)
// ---------------------------------------------------------------------------
window.__KX_SHARED = {
  KX_PREFIX, API_BASE,
  createOverlayContainer,
  onUrlChange,
  SELECTORS,
  apiCall,
  formatNum, formatPrice,
  competitionColor, scoreClass,
  getPageType,
};

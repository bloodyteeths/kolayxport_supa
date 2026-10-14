/**
 * KolayXport — Background Service Worker
 *
 * Auth: kolayxport.js (content script on kolayxport.com) fetches a token from
 * /api/auth/extension (same-origin, carries the session cookie) and pushes it here
 * via `authTokenFromPage`. Every API call sends it as `Authorization: Bearer`.
 * The raw token never leaves this worker: popup / content scripts only get a
 * boolean auth status. On 401 we drop the token, ask an open kolayxport.com tab
 * for a fresh one, and retry once.
 */

const API_BASE = 'https://kolayxport.com';
// Server-issued tokens may be short-lived (~24h). Refresh well before that unless
// the server told us the real expiry.
const DEFAULT_TOKEN_MAX_AGE_MS = 20 * 60 * 60 * 1000;
const BADGE_COLORS = {
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
  default: '#2196F3'
};

let authToken = null;
let authTokenExpiresAt = 0;
let syncStats = { totalSynced: 0, lastSyncTime: null, errors: 0 };

function extVersion() {
  try { return chrome.runtime.getManifest().version; } catch (_) { return ''; }
}

function tokenStillValid(expiresAt) {
  return typeof expiresAt === 'number' && expiresAt - Date.now() > 60 * 1000;
}

// Restore auth token on service-worker wake-up
chrome.storage.local.get(['kx_auth_token', 'kx_auth_token_expires_at', 'kx_auth_token_time'], (result) => {
  let expiresAt = result.kx_auth_token_expires_at;
  if (!expiresAt && result.kx_auth_token_time) expiresAt = result.kx_auth_token_time + DEFAULT_TOKEN_MAX_AGE_MS;
  if (result.kx_auth_token && tokenStillValid(expiresAt)) {
    authToken = result.kx_auth_token;
    authTokenExpiresAt = expiresAt;
    updateBadge('authenticated');
  }
});

function computeExpiry(meta) {
  // Accept either an absolute expiry (ISO / ms / s) or a relative lifetime in seconds.
  if (meta) {
    if (meta.expiresAt) {
      const v = typeof meta.expiresAt === 'number'
        ? (meta.expiresAt < 1e12 ? meta.expiresAt * 1000 : meta.expiresAt)
        : Date.parse(meta.expiresAt);
      if (Number.isFinite(v) && v > Date.now()) return v;
    }
    const rel = Number(meta.expiresIn);
    if (Number.isFinite(rel) && rel > 0) return Date.now() + rel * 1000;
  }
  return Date.now() + DEFAULT_TOKEN_MAX_AGE_MS;
}

function storeToken(token, meta, user) {
  authToken = token;
  authTokenExpiresAt = computeExpiry(meta);
  updateBadge('authenticated');
  const data = {
    kx_auth_token: token,
    kx_auth_token_expires_at: authTokenExpiresAt,
    kx_auth_token_time: Date.now()
  };
  if (user) data.kx_user = { email: user.email || null, name: user.name || null };
  chrome.storage.local.set(data);
}

function clearToken() {
  authToken = null;
  authTokenExpiresAt = 0;
  chrome.storage.local.remove(['kx_auth_token', 'kx_auth_token_expires_at', 'kx_auth_token_time', 'kx_last_auth_check']);
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.default });
  chrome.action.setBadgeText({ text: '' });
  // Old builds stored logs that could contain buyer data — drop them. Tokens issued
  // before the 9.5 auth change are no longer accepted, so start from a fresh token.
  chrome.storage.local.remove(['kx_logs', 'kx_api_key']);
  clearToken();
  await checkAuthentication({ force: true });
  chrome.contextMenus.create({ id: 'syncNow', title: 'Sync Etsy Orders Now', contexts: ['action'] });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});

/**
 * Authenticated fetch. Adds the Bearer token, and on 401 refreshes the token via
 * an open kolayxport.com tab and retries exactly once.
 * Returns { ok, status, data } — data is parsed JSON (or { error } text).
 */
async function apiFetch(path, { method = 'GET', body } = {}) {
  if (!authToken || !tokenStillValid(authTokenExpiresAt)) {
    if (authToken) clearToken();
    await checkAuthentication();
  }
  if (!authToken) return { ok: false, status: 401, data: { error: 'NOT_AUTHENTICATED' } };

  const doFetch = async () => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-Extension-Version': extVersion()
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data;
    try { data = await res.json(); } catch (_) { data = { error: `HTTP ${res.status}` }; }
    return { ok: res.ok, status: res.status, data };
  };

  let result = await doFetch();
  if (result.status === 401) {
    clearToken();
    await checkAuthentication({ force: true });
    if (!authToken) {
      updateBadge('unauthenticated');
      return { ok: false, status: 401, data: { error: 'NOT_AUTHENTICATED' } };
    }
    result = await doFetch();
    if (result.status === 401) {
      clearToken();
      updateBadge('unauthenticated');
    }
  }
  return result;
}

function errorOf(result, fallback) {
  return (result.data && result.data.error) || fallback || `HTTP ${result.status}`;
}

async function handleMessage(request, sender, sendResponse) {
  try {
    // --- Etsy listing stats (measured vs estimated) ---
    if (request.type === 'kx_listing_stats') {
      const r = await apiFetch('/api/ext/listing-stats', {
        method: 'POST',
        body: { listingId: request.params?.listingId, page: request.params?.page || {} }
      });
      sendResponse(r.ok ? r.data : { error: errorOf(r), status: r.status });
      return;
    }

    // --- Etsy research (search / shop / legacy listing) ---
    if (request.type === 'kx_research') {
      const r = await apiFetch('/api/ext/research', {
        method: 'POST',
        body: { action: request.action, ...(request.params || {}) }
      });
      sendResponse(r.ok ? r.data : { error: errorOf(r), status: r.status });
      return;
    }

    // --- eBay research ---
    if (request.type === 'kx_ebay_research') {
      const params = request.params || {};
      const enc = encodeURIComponent;
      let path = '';
      switch (request.action) {
        case 'search_enrich':
          path = `/api/clawd/ebay-research?action=product_database&q=${enc(params.query || '')}&limit=50`;
          break;
        case 'listing_enrich':
          path = `/api/clawd/ebay?action=get_item_details&legacy_item_id=${enc(params.itemId || '')}`;
          break;
        case 'seo_analyze':
          path = `/api/clawd/ebay?action=analyze_seo&q=${enc(params.query || '')}&my_title=${enc(params.title || '')}`;
          break;
        case 'niche_analyze':
          path = `/api/clawd/ebay-research?action=niche_analyze&q=${enc(params.query || '')}`;
          break;
        default:
          sendResponse({ error: `Unknown eBay action: ${request.action}` });
          return;
      }
      const r = await apiFetch(path);
      sendResponse(r.ok ? r.data : { error: errorOf(r, 'eBay API error'), status: r.status });
      return;
    }

    switch (request.action) {
      case 'authTokenFromPage':
        // Only accept tokens from our own kolayxport.com content script.
        if (request.token && sender.url && /^https:\/\/(www\.)?kolayxport\.com\//.test(sender.url)) {
          storeToken(request.token, { expiresAt: request.expiresAt, expiresIn: request.expiresIn }, request.user);
        }
        sendResponse({ success: true });
        break;

      case 'contentScriptReady':
        if (!authToken) checkAuthentication();
        sendResponse({ success: true });
        break;

      case 'syncComplete':
        handleSyncComplete(request);
        sendResponse({ success: true });
        break;

      case 'getAuthStatus':
        // Boolean only — the token itself stays in the service worker.
        if (!authToken) await checkAuthentication();
        sendResponse({ authenticated: !!authToken });
        break;

      case 'fetchPendingTracking': {
        const qs = request.shopName ? `?shopName=${encodeURIComponent(request.shopName)}` : '';
        const r = await apiFetch(`/api/integrations/etsy/tracking-pending${qs}`);
        sendResponse(r.ok ? { success: true, ...r.data } : { success: false, error: errorOf(r) });
        break;
      }

      case 'confirmTrackingSubmission': {
        const r = await apiFetch('/api/integrations/etsy/tracking-confirm', {
          method: 'POST',
          body: {
            submissionId: request.submissionId,
            status: request.status,
            error: request.error,
            shopName: request.shopName
          }
        });
        sendResponse(r.ok ? { success: true, ...r.data } : { success: false, error: errorOf(r) });
        break;
      }

      case 'syncOrders': {
        const { orders, source, timestamp } = request;
        const r = await apiFetch('/api/integrations/etsy/addresses', {
          method: 'POST',
          body: { orders, source, timestamp }
        });
        if (r.ok) {
          sendResponse({ success: true, result: r.data });
        } else {
          sendResponse({ success: false, error: `Server error ${r.status}: ${errorOf(r)}` });
        }
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (err) {
    sendResponse({ success: false, error: (err && err.message) || 'Extension error' });
  }
}

/**
 * Ensure we have a token. Uses the cached one if still valid; otherwise asks an
 * open kolayxport.com tab (content script does a same-origin fetch to
 * /api/auth/extension). `force` skips the cache.
 */
let _authInFlight = null;
async function checkAuthentication({ force = false } = {}) {
  if (_authInFlight) return _authInFlight;
  _authInFlight = (async () => {
    try {
      if (!force) {
        if (authToken && tokenStillValid(authTokenExpiresAt)) {
          updateBadge('authenticated');
          return;
        }
        const stored = await chrome.storage.local.get(['kx_auth_token', 'kx_auth_token_expires_at', 'kx_auth_token_time']);
        let expiresAt = stored.kx_auth_token_expires_at;
        if (!expiresAt && stored.kx_auth_token_time) expiresAt = stored.kx_auth_token_time + DEFAULT_TOKEN_MAX_AGE_MS;
        if (stored.kx_auth_token && tokenStillValid(expiresAt)) {
          authToken = stored.kx_auth_token;
          authTokenExpiresAt = expiresAt;
          updateBadge('authenticated');
          return;
        }
      }

      const tabs = await chrome.tabs.query({ url: ['https://kolayxport.com/*', 'https://www.kolayxport.com/*'] });
      for (const tab of tabs) {
        if (!tab.id || tab.status !== 'complete') continue;
        if (tab.url && (tab.url.includes('/login') || tab.url.includes('/auth/'))) continue;
        try {
          const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
            chrome.tabs.sendMessage(tab.id, { action: 'getAuthToken' }, (resp) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(resp);
            });
          });
          if (response && response.success && response.token) {
            storeToken(response.token, { expiresAt: response.expiresAt, expiresIn: response.expiresIn }, response.user);
            return;
          }
        } catch (_) { /* try next tab */ }
      }

      // No usable tab. If a session cookie exists, the user just needs to open kolayxport.com.
      try {
        const cookies = await chrome.cookies.getAll({ domain: 'kolayxport.com' });
        const hasSession = cookies.some(c =>
          c.name === 'next-auth.session-token' || c.name === '__Secure-next-auth.session-token'
        );
        if (hasSession) {
          updateBadge('warning');
          return;
        }
      } catch (_) { /* ignore */ }

      authToken = null;
      updateBadge('unauthenticated');
    } catch (error) {
      authToken = null;
      updateBadge('error');
    }
  })();
  try {
    await _authInFlight;
  } finally {
    _authInFlight = null;
  }
}

function handleSyncComplete(data) {
  syncStats.totalSynced += Number(data.count) || 0;
  syncStats.lastSyncTime = new Date().toISOString();
  syncStats.errors = 0;
  updateBadge('success', String(syncStats.totalSynced));
  chrome.storage.local.set({ syncStats });
}

function updateBadge(status, text = '') {
  let color = BADGE_COLORS.default;
  let badgeText = text;
  switch (status) {
    case 'authenticated': color = BADGE_COLORS.success; break;
    case 'unauthenticated': color = BADGE_COLORS.warning; badgeText = badgeText || '?'; break;
    case 'warning': color = BADGE_COLORS.warning; badgeText = badgeText || '!'; break;
    case 'success': color = BADGE_COLORS.success; break;
    case 'error': color = BADGE_COLORS.error; break;
  }
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: badgeText });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'syncNow') return;
  const tabs = await chrome.tabs.query({
    url: ['https://www.etsy.com/your/orders/*', 'https://www.etsy.com/your/shops/*/orders*']
  });
  if (tabs.length > 0) {
    try { await chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeNow' }); } catch (_) {}
  }
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason && event.reason.message);
});

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
  // KolayXport account language → overlays use it unless the popup has an explicit choice
  // (lib/lang.js: kx_lang → kx_account_lang → 'tr').
  const accountLang = user && typeof user.locale === 'string' ? user.locale.trim().toLowerCase().slice(0, 2) : null;
  if (accountLang === 'tr' || accountLang === 'en') data.kx_account_lang = accountLang;
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
  // removeAll first: on reload/update the old menu still exists ("duplicate id syncNow").
  const createMenu = () => chrome.contextMenus.create({ id: 'syncNow', title: 'Sync Etsy Orders Now', contexts: ['action'] });
  if (chrome.contextMenus.removeAll) chrome.contextMenus.removeAll(createMenu); else createMenu();
  await syncMarketScripts();
});

// ---------------------------------------------------------------------------
// Trendyol / Hepsiburada overlays: optional host permissions, granted in the popup together with the consent to
// share what those pages show. The content scripts are registered only for the granted sites.
// ---------------------------------------------------------------------------
const MARKET_ORIGINS = ['https://www.trendyol.com/*', 'https://www.hepsiburada.com/*'];
const MARKET_JS = ['src/lib/lang.js', 'src/lib/ui.js', 'src/lib/marketReader.js', 'src/content-market.js'];

// One search page per seller click in Product finder, opened inactive and closed once read (or after 30 s).
// Never more than one every 8 s and 30 an hour: a seller's own searches, not crawling.
const marketFetchTabs = new Map();
const marketFetchTimes = [];
const MARKET_SEARCH_URL = {
  trendyol: (q) => `https://www.trendyol.com/sr?q=${encodeURIComponent(q)}`,
  hepsiburada: (q) => `https://www.hepsiburada.com/ara?q=${encodeURIComponent(q)}`,
};
function closeMarketTab(tabId) {
  const t = marketFetchTabs.get(tabId);
  if (t) clearTimeout(t);
  marketFetchTabs.delete(tabId);
  try { chrome.tabs.remove(tabId, () => void chrome.runtime.lastError); } catch (_) { /* already closed */ }
}
async function openMarketSearch({ mkt, q }) {
  const build = MARKET_SEARCH_URL[mkt];
  if (!build || typeof q !== 'string' || !q.trim()) return { ok: false, reason: 'bad_request' };
  const origin = mkt === 'hepsiburada' ? MARKET_ORIGINS[1] : MARKET_ORIGINS[0];
  const granted = chrome.permissions ? await chrome.permissions.contains({ origins: [origin] }) : false;
  if (!granted) return { ok: false, reason: 'no_permission' };
  const share = await new Promise((res) => chrome.storage.local.get('kx_market_share', (r) => res(r.kx_market_share !== false)));
  if (!share) return { ok: false, reason: 'sharing_off' };
  const now = Date.now();
  while (marketFetchTimes.length && now - marketFetchTimes[0] > 3600000) marketFetchTimes.shift();
  if (marketFetchTimes.length >= 30 || (marketFetchTimes.length && now - marketFetchTimes[marketFetchTimes.length - 1] < 8000)) return { ok: false, reason: 'rate_limited' };
  marketFetchTimes.push(now);
  const tab = await chrome.tabs.create({ url: build(q.trim().slice(0, 120)), active: false });
  if (tab && tab.id != null) marketFetchTabs.set(tab.id, setTimeout(() => closeMarketTab(tab.id), 30000));
  return { ok: true };
}

async function syncMarketScripts() {
  if (!chrome.permissions || !chrome.scripting) return;
  try {
    const granted = await chrome.permissions.getAll();
    const matches = MARKET_ORIGINS.filter((o) => (granted.origins || []).includes(o));
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['kx-market'] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: ['kx-market'] });
    if (!matches.length) return;
    await chrome.scripting.registerContentScripts([{ id: 'kx-market', matches, js: MARKET_JS, runAt: 'document_idle', persistAcrossSessions: true }]);
  } catch (e) {
    console.warn('[kx] market scripts', e && e.message);
  }
}
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => { syncMarketScripts(); });
if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => { syncMarketScripts(); });
  chrome.permissions.onRemoved.addListener(() => { syncMarketScripts(); });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});

/**
 * Authenticated fetch. Adds the Bearer token, and on 401 refreshes the token via
 * an open kolayxport.com tab and retries exactly once.
 * `research: { pv }` marks a research-overlay call: adds `X-KX-Client: ext/<version>`
 * (the server applies the research quota only to calls carrying it) and the page-view id.
 * `allowAnonymous`: send without a token when signed out (the server answers with its
 * signed-out allowance or a 429 `research_limit` / `signed_out` card payload).
 * Returns { ok, status, data } — data is parsed JSON (or { error } text).
 */
async function apiFetch(path, { method = 'GET', body, research, allowAnonymous = false } = {}) {
  if (!authToken || !tokenStillValid(authTokenExpiresAt)) {
    if (authToken) clearToken();
    await checkAuthentication();
  }
  const anonymous = !authToken;
  if (anonymous && !allowAnonymous) return { ok: false, status: 401, data: { error: 'NOT_AUTHENTICATED' } };

  const doFetch = async () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Extension-Version': extVersion()
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    if (research) {
      headers['X-KX-Client'] = `ext/${extVersion()}`;
      if (typeof research.pv === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(research.pv)) headers['X-KX-Page-View'] = research.pv;
    }
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data;
    try { data = await res.json(); } catch (_) { data = { error: `HTTP ${res.status}` }; }
    return { ok: res.ok, status: res.status, data };
  };

  let result = await doFetch();
  if (result.status === 401 && !anonymous) {
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

/** 429 research-limit payload from the server, or null. */
function researchLimitOf(result) {
  const d = result && result.data;
  return result && result.status === 429 && d && d.error === 'research_limit' ? d : null;
}

/** Today's research usage for the popup ("Bugün: X / Y araştırma"). */
function rememberQuota(result) {
  try {
    const limit = researchLimitOf(result);
    const q = limit || (result.ok && result.data && result.data.quota);
    if (!q || typeof q.limit !== 'number') return;
    chrome.storage.local.set({
      kx_research_quota: {
        used: Number(q.used) || 0,
        limit: q.limit,
        resetAt: q.resetAt || null,
        reason: limit ? limit.reason : null,
        upgradeUrl: limit ? limit.upgradeUrl : null,
        at: Date.now()
      }
    });
  } catch (_) { /* best effort */ }
}

/**
 * Response for a research call. Errors keep their message, and a 429 research-limit
 * body reaches the content script whole (`limit`), so the overlay can show the card.
 */
function researchResponse(r, fallback) {
  rememberQuota(r);
  if (r.ok) return r.data;
  const out = { error: errorOf(r, fallback), status: r.status };
  const limit = researchLimitOf(r);
  if (limit) out.limit = limit;
  return out;
}

async function handleMessage(request, sender, sendResponse) {
  try {
    // --- Etsy listing stats (measured vs estimated) ---
    if (request.type === 'kx_listing_stats') {
      // phase 'core': the fast first answer (listing facts), sent alongside the full request.
      const phase = request.params?.phase === 'core' ? 'core' : undefined;
      const r = await apiFetch('/api/ext/listing-stats', {
        method: 'POST',
        body: { listingId: request.params?.listingId, page: request.params?.page || {}, ...(phase ? { phase } : {}) },
        research: { pv: request.pv }
      });
      sendResponse(researchResponse(r));
      return;
    }

    // --- Etsy research (search / shop / legacy listing) ---
    if (request.type === 'kx_research') {
      const r = await apiFetch('/api/ext/research', {
        method: 'POST',
        body: { action: request.action, ...(request.params || {}) },
        research: { pv: request.pv },
        // Signed out: the server serves a small daily allowance, then the sign-up card.
        allowAnonymous: true
      });
      sendResponse(researchResponse(r));
      return;
    }

    // --- Amazon: official SP-API signals (BSR, offer counts) for the overlay ---
    if (request.type === 'kx_amazon_enrich') {
      const params = request.params || {};
      const asins = (Array.isArray(params.asins) ? params.asins : [])
        .filter((a) => /^[A-Z0-9]{10}$/i.test(String(a))).slice(0, 20);
      if (!asins.length) { sendResponse({ available: false, reason: 'unavailable' }); return; }
      const r = await apiFetch('/api/ext/amazon-enrich', {
        method: 'POST',
        body: { asins, marketplace: params.marketplace || 'US' },
        research: { pv: request.pv }
      });
      sendResponse(researchResponse(r));
      return;
    }

    // --- Trendyol / Hepsiburada: a page the seller viewed (shared, anonymous) and the numbers over time ---
    if (request.type === 'kx_market_observe') {
      const share = await new Promise((res) => chrome.storage.local.get('kx_market_share', (r) => res(r.kx_market_share !== false)));
      if (!share) { sendResponse({ skipped: 'sharing_off' }); return; }
      const r = await apiFetch('/api/market/observe', { method: 'POST', body: request.params || {} });
      sendResponse(r.ok ? r.data : { error: errorOf(r, 'observe_failed'), status: r.status });
      // A search tab we opened for the app: its page is read, close it.
      const tabId = sender && sender.tab && sender.tab.id;
      if (tabId != null && marketFetchTabs.has(tabId)) closeMarketTab(tabId);
      return;
    }
    if (request.type === 'kx_market_status') {
      const granted = chrome.permissions ? await chrome.permissions.contains({ origins: MARKET_ORIGINS }) : false;
      const share = await new Promise((res) => chrome.storage.local.get('kx_market_share', (r) => res(r.kx_market_share !== false)));
      sendResponse({ granted, share });
      return;
    }
    if (request.type === 'kx_market_fetch') {
      sendResponse(await openMarketSearch(request.params || {}));
      return;
    }
    if (request.type === 'kx_market_read') {
      const r = await apiFetch('/api/market/read', { method: 'POST', body: request.params || {} });
      sendResponse(r.ok ? r.data : { error: errorOf(r, 'read_failed'), status: r.status });
      return;
    }
    if (request.type === 'kx_market_sync_scripts') {
      await syncMarketScripts();
      sendResponse({ ok: true });
      return;
    }

    // --- eBay research ---
    if (request.type === 'kx_ebay_research') {
      const params = request.params || {};
      const enc = encodeURIComponent;
      // Marketplace of the page the user is on (EBAY_US, EBAY_DE, ...), so API
      // prices/currency match the cards on screen.
      const mkt = /^EBAY_[A-Z]{2}$/.test(params.marketplace || '') ? params.marketplace : 'EBAY_US';
      let path = '';
      switch (request.action) {
        case 'search_enrich': {
          // sort=bestMatch: same order the shopper sees (was newlyListed by default).
          // Sold quantities: only the cards in the first viewport (enrich_ids first, 8 at most).
          const ids = (Array.isArray(params.enrichIds) ? params.enrichIds : [])
            .map(String).filter((id) => /^\d{1,20}$/.test(id)).slice(0, 8);
          path = `/api/clawd/ebay-research?action=product_database&q=${enc(params.query || '')}&limit=50&sort=bestMatch&marketplace_id=${mkt}&enrich=8` +
            (ids.length ? `&enrich_ids=${ids.join(',')}` : '');
          break;
        }
        case 'listing_enrich':
          path = `/api/clawd/ebay?action=get_item_details&legacy_item_id=${enc(params.itemId || '')}&marketplace_id=${mkt}`;
          break;
        case 'seo_analyze':
          path = `/api/clawd/ebay?action=analyze_seo&q=${enc(params.query || '')}&my_title=${enc(params.title || '')}&marketplace_id=${mkt}`;
          break;
        case 'niche_analyze':
          path = `/api/clawd/ebay-research?action=niche_analyze&q=${enc(params.query || '')}`;
          break;
        default:
          sendResponse({ error: `Unknown eBay action: ${request.action}` });
          return;
      }
      const r = await apiFetch(path, { research: { pv: request.pv } });
      sendResponse(researchResponse(r, 'eBay API error'));
      return;
    }

    // --- Product telemetry from the limit card (lib/limitCard.js) ---
    if (request.type === 'kx_telemetry_event') {
      if (request.event !== 'research_upgrade_click') { sendResponse({ success: false }); return; }
      const r = await apiFetch('/api/ext/telemetry', {
        method: 'POST',
        body: {
          events: [{
            event: request.event,
            reason: typeof request.reason === 'string' ? request.reason : undefined,
            surface: typeof request.surface === 'string' ? request.surface : undefined,
            extensionVersion: extVersion()
          }]
        }
      });
      sendResponse({ success: !!r.ok });
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

      case 'fetchAddressPending': {
        const r = await refreshAddressPending();
        sendResponse(r);
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
          // An address was just scraped: refresh the missing-address queue count.
          refreshAddressPending().catch(() => {});
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

// ---------------------------------------------------------------------------
// Missing-address queue (v9.6.0). Etsy's API withholds buyer addresses, so
// orders without one are listed by the server; the popup shows the count and
// opens the next order page, where the existing scrape-on-visit fills it.
// Polled with the same request/response pattern as tracking-pending, on an
// alarm (15 min), on startup and after every address sync.
// ---------------------------------------------------------------------------
const ADDRESS_PENDING_ALARM = 'kx-address-pending';

async function refreshAddressPending() {
  const r = await apiFetch('/api/integrations/etsy/address-pending');
  if (!r.ok) return { success: false, error: errorOf(r) };
  const pending = Array.isArray(r.data && r.data.pending) ? r.data.pending : [];
  const state = {
    count: pending.length,
    next: pending.length ? { receiptId: pending[0].receiptId, orderUrl: pending[0].orderUrl } : null,
    at: Date.now()
  };
  await chrome.storage.local.set({ kx_address_pending: state });
  return { success: true, ...state };
}

try {
  if (chrome.alarms) {
    chrome.alarms.create(ADDRESS_PENDING_ALARM, { periodInMinutes: 15, delayInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === ADDRESS_PENDING_ALARM && authToken) refreshAddressPending().catch(() => {});
    });
  }
} catch (_) { /* alarms unavailable: popup still fetches on open */ }

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

/**
 * KolayXport Extension Popup v8.0 — Minimal, i18n
 */

const $ = (id) => document.getElementById(id);

// Language: lib/lang.js (popup choice kx_lang → account language → 'tr').
function _lang() {
  const L = window.__KX_LANG;
  return (L && L.get()) || 'tr';
}

const _t = {
  tr: {
    status: 'Durum', checking: 'Kontrol ediliyor...', connected: 'Bağlı',
    disconnected: 'Bağlı Değil', error: 'Hata', user: 'Kullanıcı',
    overlayTitle: 'Araştırma Panelleri', allOverlays: 'Tüm paneller',
    cacheTitle: 'Önbellek', researchData: 'Araştırma verileri',
    clear: 'Temizle', cleared: 'Temizlendi!',
    openApp: 'KolayXport\'u Aç', help: 'Yardım',
    trackingTitle: 'Kargo Takip', pendingTracking: 'Bekleyen takip no',
    goToEtsyOrders: 'Etsy Siparişlerine Git',
    addressTitle: 'Etsy adresleri', openNextOrder: 'Sıradaki siparişi aç (listede görünmeyenler)',
    addressPending: (n) => `${n} siparişte adres eksik`,
    addressesComplete: 'Tüm adresler tamam',
    importAllAddresses: 'Tüm adresleri içe aktar',
    importing: 'İçe aktarılıyor…',
    importSent: (n) => `${n} siparişin adresi gönderildi`,
    openingOrders: 'Etsy sipariş listesi açılıyor — adresler otomatik gönderilecek',
    researchTitle: 'Araştırma',
    researchUsage: (used, limit) => `Bugün: ${used} / ${limit} araştırma`,
    langAuto: 'Otomatik',
    langHintAuto: 'Hesap dilinizi kullanır, yoksa Türkçe.',
    langHintSet: 'Açık Etsy, eBay ve Amazon sayfalarındaki paneller hemen güncellenir.',
  },
  en: {
    status: 'Status', checking: 'Checking...', connected: 'Connected',
    disconnected: 'Not Connected', error: 'Error', user: 'User',
    overlayTitle: 'Research Panels', allOverlays: 'All panels',
    cacheTitle: 'Cache', researchData: 'Research data',
    clear: 'Clear', cleared: 'Cleared!',
    openApp: 'Open KolayXport', help: 'Help',
    trackingTitle: 'Tracking Push', pendingTracking: 'Pending tracking',
    goToEtsyOrders: 'Go to Etsy Orders',
    addressTitle: 'Etsy addresses', openNextOrder: 'Open next order (not on the list)',
    addressPending: (n) => `${n} ${n === 1 ? 'order is' : 'orders are'} missing an address`,
    addressesComplete: 'All addresses complete',
    importAllAddresses: 'Import all addresses',
    importing: 'Importing…',
    importSent: (n) => `Sent addresses for ${n} ${n === 1 ? 'order' : 'orders'}`,
    openingOrders: 'Opening your Etsy orders — addresses are sent automatically',
    researchTitle: 'Research',
    researchUsage: (used, limit) => `Today: ${used} / ${limit} lookups`,
    langAuto: 'Automatic',
    langHintAuto: 'Uses your account language, otherwise Turkish.',
    langHintSet: 'Panels on open Etsy, eBay and Amazon pages update right away.',
  },
};

function t(key, ...args) {
  const v = _t[_lang()]?.[key] || _t.en[key] || key;
  return typeof v === 'function' ? v(...args) : v;
}

// Apply i18n to all elements with data-i18n attribute
function applyI18n() {
  document.documentElement.lang = _lang();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key);
    if (text) el.textContent = text;
  });
}

// Language selector: "Otomatik" = no stored choice (account language, else Turkish).
let _langChoice = 'auto';

function renderLangHint() {
  const hint = $('langHint');
  if (!hint) return;
  const key = _langChoice === 'auto' ? 'langHintAuto' : 'langHintSet';
  hint.setAttribute('data-i18n', key);
  hint.textContent = t(key);
}

async function loadLangChoice() {
  try {
    const stored = await new Promise((r) => chrome.storage.local.get(['kx_lang'], r));
    const v = stored && stored.kx_lang;
    _langChoice = v === 'tr' || v === 'en' ? v : 'auto';
  } catch (_) {
    _langChoice = 'auto';
  }
  const sel = $('langSelect');
  if (sel) sel.value = _langChoice;
  renderLangHint();
}

function onLangSelect(e) {
  const v = e.target.value;
  _langChoice = v === 'tr' || v === 'en' ? v : 'auto';
  renderLangHint();
  try {
    // Open overlays re-render via chrome.storage.onChanged (lib/lang.js), and so does this popup.
    if (_langChoice === 'auto') chrome.storage.local.remove('kx_lang');
    else chrome.storage.local.set({ kx_lang: _langChoice });
  } catch (_) { /* storage unavailable */ }
}

/** Re-render every text in the popup in the current language. */
function refreshTexts() {
  applyI18n();
  renderLangHint();
  renderAuthStatus();
  if (_lastAddressState !== undefined) renderAddressPending(_lastAddressState);
  renderResearchQuota();
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const L = window.__KX_LANG;
  if (L && L.ready) await L.ready;
  applyI18n();
  await loadLangChoice();
  const langSel = $('langSelect');
  if (langSel) langSel.addEventListener('change', onLangSelect);
  if (L && L.onChange) L.onChange(refreshTexts);

  try {
    const manifest = chrome.runtime.getManifest();
    $('versionLabel').textContent = 'v' + manifest.version;
  } catch (_) {}

  await checkAuth();
  loadSettings();
  setupListeners();
  checkPendingTracking();
  checkPendingAddresses();
  renderResearchQuota();
});

/**
 * Research usage ("Bugün: X / Y araştırma") from the last research answer the background
 * worker saw (`quota` on success, the 429 research-limit body when blocked). A stored
 * state from before the last 00:00 Istanbul reset counts as 0 used and not blocked.
 */
async function renderResearchQuota() {
  try {
    const stored = await new Promise((r) => chrome.storage.local.get('kx_research_quota', r));
    const q = stored && stored.kx_research_quota;
    if (!q || typeof q.limit !== 'number') return;
    const expired = q.resetAt && Date.parse(q.resetAt) <= Date.now();
    $('researchCard').style.display = '';
    if (q.limit > 0) {
      $('researchUsage').textContent = t('researchUsage', expired ? 0 : Math.min(q.used, q.limit), q.limit);
    } else {
      $('researchUsage').style.display = 'none';
    }
    const box = $('researchLimit');
    if (q.reason && !expired && window.__KX_LIMIT) {
      box.style.display = '';
      window.__KX_LIMIT.render(box, {
        error: 'research_limit', reason: q.reason, used: q.used, limit: q.limit, resetAt: q.resetAt, upgradeUrl: q.upgradeUrl,
      }, { surface: 'popup' });
    } else {
      box.style.display = 'none';
      box.textContent = '';
    }
  } catch (_) {
    // Silent fail — card stays hidden
  }
}

// Auth check
async function checkAuth() {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });

    _authState = response?.authenticated ? 'connected' : 'disconnected';
    renderAuthStatus();

    if (response?.authenticated) {
      const stored = await new Promise(r => chrome.storage.local.get('kx_user', r));
      if (stored?.kx_user?.email) {
        $('userEmail').textContent = stored.kx_user.email;
        $('userRow').style.display = '';
      }
    }
  } catch (err) {
    _authState = 'error';
    renderAuthStatus();
  }
}

let _authState = null; // 'connected' | 'disconnected' | 'error' | null (still checking)

function renderAuthStatus() {
  const badge = $('authBadge');
  const status = $('authStatus');
  if (!_authState) {
    status.textContent = t('checking');
    return;
  }
  badge.className = 'auth-badge ' + (_authState === 'connected' ? 'connected' : 'disconnected');
  status.textContent = t(_authState);
  status.className = 'status-badge ' + (_authState === 'connected' ? 'connected' : 'disconnected');
}

// Load settings
function loadSettings() {
  chrome.storage.local.get('kx_overlays_enabled', (result) => {
    $('toggleOverlays').checked = result.kx_overlays_enabled !== false;
  });
}

// Check pending tracking count
async function checkPendingTracking() {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'fetchPendingTracking' }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });

    if (response?.success && response.count > 0) {
      $('trackingCard').style.display = '';
      $('pendingCount').textContent = String(response.count);
      $('pendingCount').style.background = '#ff9800';
      $('pendingCount').style.color = '#fff';
      $('pendingCount').style.padding = '2px 8px';
      $('pendingCount').style.borderRadius = '10px';
      $('pendingCount').style.fontSize = '12px';
      $('pendingCount').style.fontWeight = '600';
    }
  } catch (_) {
    // Silent fail — tracking card stays hidden
  }
}

// Missing-address queue (v9.6.0): count + "open next order" (the scrape-on-visit fills it)
let _nextAddressUrl = null;
let _lastAddressState; // undefined until the card was shown once

function renderAddressPending(state) {
  _lastAddressState = state;
  $('addressCard').style.display = '';
  if (!state || !state.count) {
    $('addressPendingLabel').textContent = t('addressesComplete');
    $('addressPendingCount').textContent = '✓';
    $('addressPendingCount').style.background = '#4caf50';
    $('addressPendingCount').style.color = '#fff';
    $('addressPendingCount').style.padding = '2px 8px';
    $('addressPendingCount').style.borderRadius = '10px';
    $('openNextAddress').style.display = 'none';
    _nextAddressUrl = null;
    return;
  }
  $('openNextAddress').style.display = '';
  $('addressPendingLabel').textContent = t('addressPending', state.count);
  $('addressPendingCount').textContent = String(state.count);
  $('addressPendingCount').style.background = '#f44336';
  $('addressPendingCount').style.color = '#fff';
  $('addressPendingCount').style.padding = '2px 8px';
  $('addressPendingCount').style.borderRadius = '10px';
  $('addressPendingCount').style.fontSize = '12px';
  $('addressPendingCount').style.fontWeight = '600';
  _nextAddressUrl = state.next && /^https:\/\/www\.etsy\.com\//.test(state.next.orderUrl) ? state.next.orderUrl : null;
  $('openNextAddress').disabled = !_nextAddressUrl;
}

async function checkPendingAddresses() {
  try {
    const cached = await new Promise((r) => chrome.storage.local.get('kx_address_pending', r));
    if (cached && cached.kx_address_pending) renderAddressPending(cached.kx_address_pending);
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'fetchAddressPending' }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });
    if (response && response.success) renderAddressPending(response);
  } catch (_) {
    // Silent fail — card stays as last known
  }
}

// Setup listeners
function setupListeners() {
  $('openNextAddress').addEventListener('click', () => {
    if (_nextAddressUrl) chrome.tabs.create({ url: _nextAddressUrl });
  });

  // Bulk: run the full import on the open Etsy orders list; anywhere else,
  // open the list (the content script imports it automatically on load).
  $('importAllAddresses').addEventListener('click', async () => {
    const btn = $('importAllAddresses');
    const out = $('importAllResult');
    const ORDERS_URL = 'https://www.etsy.com/your/orders/sold';
    btn.disabled = true;
    out.textContent = t('importing');
    const tabs = await new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, r));
    const tab = tabs && tabs[0];
    const onOrders = tab && /^https:\/\/www\.etsy\.com\/(your\/orders|your\/account\/your-shop\/orders|shop-manager\/.*orders)/.test(tab.url || '');
    if (!onOrders) {
      chrome.tabs.create({ url: ORDERS_URL });
      out.textContent = t('openingOrders');
      btn.disabled = false;
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: 'fullImport' }, (resp) => {
      btn.disabled = false;
      if (chrome.runtime.lastError || !resp) {
        chrome.tabs.update(tab.id, { url: ORDERS_URL });
        out.textContent = t('openingOrders');
        return;
      }
      out.textContent = resp.status === 'completed' ? t('importSent', resp.sent || 0) : (resp.error || '');
      setTimeout(checkPendingAddresses, 1500);
    });
  });

  $('toggleOverlays').addEventListener('change', (e) => {
    chrome.storage.local.set({ kx_overlays_enabled: e.target.checked });
  });

  $('clearCacheBtn').addEventListener('click', async () => {
    const keys = await new Promise(r => chrome.storage.local.get(null, r));
    const cacheKeys = Object.keys(keys).filter(k => k.startsWith('kx_cache_'));
    if (cacheKeys.length > 0) {
      await new Promise(r => chrome.storage.local.remove(cacheKeys, r));
    }
    $('clearCacheBtn').textContent = t('cleared');
    setTimeout(() => { $('clearCacheBtn').textContent = t('clear'); }, 1500);
  });
}

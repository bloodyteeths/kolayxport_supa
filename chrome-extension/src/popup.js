/**
 * KolayXport Extension Popup v8.0 — Minimal, i18n
 */

const $ = (id) => document.getElementById(id);

const _lang = (() => {
  try { return chrome.i18n.getUILanguage().startsWith('tr') ? 'tr' : 'en'; }
  catch { return 'en'; }
})();

const _t = {
  tr: {
    status: 'Durum', checking: 'Kontrol...', connected: 'Bağlı',
    disconnected: 'Bağlı Değil', error: 'Hata', user: 'Kullanıcı',
    overlayTitle: 'Overlay', allOverlays: 'Tüm overlay\'ler',
    cacheTitle: 'Önbellek', researchData: 'Araştırma verileri',
    clear: 'Temizle', cleared: 'Temizlendi!',
    openApp: 'KolayXport\'u Aç', help: 'Yardım',
    trackingTitle: 'Kargo Takip', pendingTracking: 'Bekleyen takip no',
    goToEtsyOrders: 'Etsy Siparişlerine Git',
    addressTitle: 'Eksik adresler', openNextOrder: 'Sıradaki siparişi aç',
    addressPending: (n) => `${n} siparişte adres eksik`,
  },
  en: {
    status: 'Status', checking: 'Checking...', connected: 'Connected',
    disconnected: 'Not Connected', error: 'Error', user: 'User',
    overlayTitle: 'Overlay', allOverlays: 'All overlays',
    cacheTitle: 'Cache', researchData: 'Research data',
    clear: 'Clear', cleared: 'Cleared!',
    openApp: 'Open KolayXport', help: 'Help',
    trackingTitle: 'Tracking Push', pendingTracking: 'Pending tracking',
    goToEtsyOrders: 'Go to Etsy Orders',
    addressTitle: 'Missing addresses', openNextOrder: 'Open next order',
    addressPending: (n) => `${n} ${n === 1 ? 'order is' : 'orders are'} missing an address`,
  },
};

function t(key, ...args) {
  const v = _t[_lang]?.[key] || _t.en[key] || key;
  return typeof v === 'function' ? v(...args) : v;
}

// Apply i18n to all elements with data-i18n attribute
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key);
    if (text) el.textContent = text;
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();

  try {
    const manifest = chrome.runtime.getManifest();
    $('versionLabel').textContent = 'v' + manifest.version;
  } catch (_) {}

  await checkAuth();
  loadSettings();
  setupListeners();
  checkPendingTracking();
  checkPendingAddresses();
});

// Auth check
async function checkAuth() {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });

    const badge = $('authBadge');
    const status = $('authStatus');

    if (response?.authenticated) {
      badge.className = 'auth-badge connected';
      status.textContent = t('connected');
      status.className = 'status-badge connected';

      const stored = await new Promise(r => chrome.storage.local.get('kx_user', r));
      if (stored?.kx_user?.email) {
        $('userEmail').textContent = stored.kx_user.email;
        $('userRow').style.display = '';
      }
    } else {
      badge.className = 'auth-badge disconnected';
      status.textContent = t('disconnected');
      status.className = 'status-badge disconnected';
    }
  } catch (err) {
    $('authBadge').className = 'auth-badge disconnected';
    $('authStatus').textContent = t('error');
    $('authStatus').className = 'status-badge disconnected';
  }
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

function renderAddressPending(state) {
  if (!state || !state.count) {
    $('addressCard').style.display = 'none';
    return;
  }
  $('addressCard').style.display = '';
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

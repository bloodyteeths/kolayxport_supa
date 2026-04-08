/**
 * KolayXport Extension Popup v7.1 — Minimal
 */

const $ = (id) => document.getElementById(id);

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Set version
  try {
    const manifest = chrome.runtime.getManifest();
    $('versionLabel').textContent = 'v' + manifest.version;
  } catch (_) {}

  await checkAuth();
  loadSettings();
  setupListeners();
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
      status.textContent = 'Bağlı';
      status.className = 'status-badge connected';

      // Show user email if available
      const stored = await new Promise(r => chrome.storage.local.get('kx_user', r));
      if (stored?.kx_user?.email) {
        $('userEmail').textContent = stored.kx_user.email;
        $('userRow').style.display = '';
      }
    } else {
      badge.className = 'auth-badge disconnected';
      status.textContent = 'Bağlı Değil';
      status.className = 'status-badge disconnected';
    }
  } catch (err) {
    $('authBadge').className = 'auth-badge disconnected';
    $('authStatus').textContent = 'Hata';
    $('authStatus').className = 'status-badge disconnected';
  }
}

// Load settings
function loadSettings() {
  chrome.storage.local.get('kx_overlays_enabled', (result) => {
    $('toggleOverlays').checked = result.kx_overlays_enabled !== false;
  });
}

// Setup listeners
function setupListeners() {
  // Overlay toggle
  $('toggleOverlays').addEventListener('change', (e) => {
    chrome.storage.local.set({ kx_overlays_enabled: e.target.checked });
  });

  // Clear cache
  $('clearCacheBtn').addEventListener('click', async () => {
    const keys = await new Promise(r => chrome.storage.local.get(null, r));
    const cacheKeys = Object.keys(keys).filter(k => k.startsWith('kx_cache_'));
    if (cacheKeys.length > 0) {
      await new Promise(r => chrome.storage.local.remove(cacheKeys, r));
    }
    $('clearCacheBtn').textContent = 'Temizlendi!';
    setTimeout(() => { $('clearCacheBtn').textContent = 'Temizle'; }, 1500);
  });
}

/**
 * KolayXport Extension Popup v7.0
 * Marketplace toggle (Etsy | eBay) + 4 tabs: Research, Tracker, Orders, Settings
 */

const $ = (id) => document.getElementById(id);

let isAuthenticated = false;
let currentTab = null;
let activeMarketplace = 'etsy';

// ---------------------------------------------------------------------------
// Marketplace Toggle
// ---------------------------------------------------------------------------
document.querySelectorAll('.mp-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.mp-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeMarketplace = chip.dataset.mp;

    const etsyPanel = $('etsy-research-panel');
    const ebayPanel = $('ebay-research-panel');
    if (etsyPanel && ebayPanel) {
      if (activeMarketplace === 'ebay') {
        etsyPanel.classList.add('hidden');
        ebayPanel.classList.remove('hidden');
        checkEbayCurrentPage();
      } else {
        etsyPanel.classList.remove('hidden');
        ebayPanel.classList.add('hidden');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tab Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  await checkCurrentTab();
  await loadSyncStats();
  await loadSettings();
  setupEventListeners();
  autoDetectMarketplace();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function checkAuthStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });
    isAuthenticated = response.authenticated;

    const badge = $('authBadge');
    if (badge) badge.className = 'auth-badge ' + (isAuthenticated ? 'connected' : 'disconnected');

    const status = $('authStatus');
    if (status) {
      status.textContent = isAuthenticated ? 'Bağlı' : 'Bağlantı Yok';
      status.className = 'status-badge ' + (isAuthenticated ? 'connected' : 'disconnected');
    }

    const settingsStatus = $('settingsAuthStatus');
    if (settingsStatus) {
      settingsStatus.textContent = isAuthenticated ? 'Bağlı' : 'Bağlantı Yok';
      settingsStatus.className = 'status-badge ' + (isAuthenticated ? 'connected' : 'disconnected');
    }

    const planEl = $('settingsPlan');
    if (planEl) planEl.textContent = isAuthenticated ? 'Starter' : 'Ücretsiz';

    const msg = $('authMessage');
    if (msg) msg.textContent = isAuthenticated
      ? 'KolayXport hesabınıza bağlısınız.'
      : 'Lütfen kolayxport.com\'a giriş yapın.';

    updateButtonStates();
  } catch (error) {
    console.error('Auth check failed:', error);
  }
}

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    updateButtonStates();
  } catch (error) {
    console.error('Tab check failed:', error);
  }
}

function updateButtonStates() {
  const isOnOrders = currentTab?.url?.includes('etsy.com/your/orders') ||
    currentTab?.url?.includes('shop-manager');

  const syncBtn = $('syncNowBtn');
  const importBtn = $('fullImportBtn');
  if (syncBtn) syncBtn.disabled = !isAuthenticated || !isOnOrders;
  if (importBtn) importBtn.disabled = !isAuthenticated || !isOnOrders;
}

// ---------------------------------------------------------------------------
// Sync Stats (preserved from v5)
// ---------------------------------------------------------------------------
async function loadSyncStats() {
  try {
    const result = await chrome.storage.local.get(['syncStats', 'kx_synced_orders']);
    const stats = result.syncStats || {};
    const syncedOrders = result.kx_synced_orders || [];

    const totalEl = $('totalSynced');
    if (totalEl) totalEl.textContent = stats.totalSynced || syncedOrders.length;

    const lastEl = $('lastSync');
    if (lastEl && stats.lastSyncTime) {
      const d = new Date(stats.lastSyncTime);
      if (!isNaN(d.getTime())) lastEl.textContent = formatRelativeTime(d);
    }

    if (currentTab?.id) {
      try {
        const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' });
        const pendingEl = $('pendingSync');
        if (pendingEl && response?.pendingCount !== undefined) {
          pendingEl.textContent = response.pendingCount;
        }
      } catch { /* content script may not be loaded */ }
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function formatRelativeTime(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins}dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}sa önce`;
  return `${Math.floor(hours / 24)}g önce`;
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------
function setupEventListeners() {
  // Orders tab
  $('syncNowBtn')?.addEventListener('click', handleSyncNow);
  $('openEtsyBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.etsy.com/your/orders/sold' });
  });
  $('fullImportBtn')?.addEventListener('click', handleFullImport);
  $('refreshAuthBtn')?.addEventListener('click', async () => {
    const btn = $('refreshAuthBtn');
    btn.disabled = true;
    await checkAuthStatus();
    btn.disabled = false;
  });

  // Research tab (Etsy)
  $('researchBtn')?.addEventListener('click', handleResearch);
  $('researchQuery')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleResearch();
  });

  // Research tab (eBay)
  $('ebayResearchBtn')?.addEventListener('click', handleEbayResearch);
  $('ebayResearchQuery')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEbayResearch();
  });
  $('ebayTrackBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://kolayxport.com/app/ebay-research' });
  });

  // Settings tab
  $('clearCacheBtn')?.addEventListener('click', handleClearCache);
  ['toggleSearch', 'toggleListing', 'toggleShop', 'toggleEbaySearch', 'toggleEbayListing'].forEach(id => {
    $(id)?.addEventListener('change', saveSettings);
  });
}

// ---------------------------------------------------------------------------
// Sync Handlers (preserved from v5)
// ---------------------------------------------------------------------------
async function handleSyncNow() {
  const btn = $('syncNowBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Senkronlanıyor...';

  try {
    if (currentTab?.id) {
      try {
        await chrome.tabs.sendMessage(currentTab.id, { action: 'scrapeNow' });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          files: ['src/content.js']
        });
        await new Promise(r => setTimeout(r, 1000));
        await chrome.tabs.sendMessage(currentTab.id, { action: 'scrapeNow' });
      }
    }
    btn.textContent = '✅ Senkron başlatıldı';
    setTimeout(() => { btn.textContent = '🔄 Şimdi Senkronla'; btn.disabled = false; }, 2000);
    setTimeout(loadSyncStats, 3000);
  } catch (error) {
    btn.textContent = '❌ Hata';
    console.error('Sync error:', error);
    setTimeout(() => { btn.textContent = '🔄 Şimdi Senkronla'; btn.disabled = false; }, 2000);
  }
}

async function handleFullImport() {
  const btn = $('fullImportBtn');
  btn.disabled = true;
  btn.textContent = '⏳ İçe aktarılıyor...';

  try {
    if (currentTab?.id) {
      await chrome.tabs.sendMessage(currentTab.id, { action: 'fullImport' });
      btn.textContent = '✅ İçe aktarım başlatıldı';
    }
  } catch (error) {
    btn.textContent = '❌ Hata';
    console.error('Import error:', error);
  }
  setTimeout(() => { btn.textContent = '📥 Tüm İçe Aktar'; btn.disabled = false; }, 3000);
}

// ---------------------------------------------------------------------------
// Research Tab
// ---------------------------------------------------------------------------
async function handleResearch() {
  const query = $('researchQuery').value.trim();
  if (!query) return;

  $('researchLoading').classList.remove('hidden');
  $('researchResults').classList.add('hidden');

  try {
    const data = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'kx_research', action: 'search_enrich', params: { query, listingIds: [] } },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.error) reject(new Error(response.error));
          else resolve(response);
        }
      );
    });

    if (data?.summary) {
      const s = data.summary;
      $('researchQueryLabel').textContent = `"${query}" Sonuçları`;
      $('rTotalResults').textContent = fmtNum(s.totalResults);
      $('rAvgPrice').textContent = '$' + (s.avgPrice || 0).toFixed(2);
      $('rPriceRange').textContent = '$' + (s.minPrice || 0).toFixed(0) + ' - $' + (s.maxPrice || 0).toFixed(0);
      $('rAvgFav').textContent = fmtNum(s.avgFavorites);
      $('rShops').textContent = s.uniqueShops;

      const compEl = $('rCompetition');
      compEl.textContent = s.competition === 'low' ? 'Düşük' : s.competition === 'medium' ? 'Orta' : 'Yüksek';
      compEl.className = 'stat-mini-value comp-' + s.competition;

      $('researchResults').classList.remove('hidden');
    }
  } catch (error) {
    console.error('Research error:', error);
  }

  $('researchLoading').classList.add('hidden');
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ---------------------------------------------------------------------------
// eBay Research Tab
// ---------------------------------------------------------------------------
async function handleEbayResearch() {
  const query = $('ebayResearchQuery').value.trim();
  if (!query) return;

  $('ebayResearchLoading').classList.remove('hidden');
  $('ebayResearchResults').classList.add('hidden');

  try {
    const data = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'kx_ebay_research', action: 'search_enrich', params: { query, marketplace: 'EBAY_US' } },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else if (response?.error) reject(new Error(response.error));
          else resolve(response);
        }
      );
    });

    const s = data?.summary || data || {};
    if (s.totalResults || s.total || s.avgPrice || s.avg_price) {
      $('ebayResearchQueryLabel').textContent = `"${query}" Sonuclari`;
      $('erTotalResults').textContent = fmtNum(s.totalResults || s.total || 0);
      $('erAvgPrice').textContent = '$' + (s.avgPrice || s.avg_price || 0).toFixed(2);
      $('erPriceRange').textContent = '$' + (s.minPrice || s.min_price || 0).toFixed(0) + ' - $' + (s.maxPrice || s.max_price || 0).toFixed(0);
      $('erSellers').textContent = s.uniqueSellers || s.uniqueShops || s.unique_sellers || 0;

      const sellers = s.uniqueSellers || s.uniqueShops || s.unique_sellers || 0;
      const comp = s.competition || (sellers < 20 ? 'low' : sellers < 100 ? 'medium' : 'high');
      const compEl = $('erCompetition');
      compEl.textContent = comp === 'low' ? 'Dusuk' : comp === 'medium' ? 'Orta' : 'Yuksek';
      compEl.className = 'stat-mini-value comp-' + comp;

      $('ebayResearchResults').classList.remove('hidden');
    }
  } catch (error) {
    console.error('eBay research error:', error);
  }

  $('ebayResearchLoading').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Auto-detect marketplace from current tab
// ---------------------------------------------------------------------------
function autoDetectMarketplace() {
  if (!currentTab?.url) return;
  const url = currentTab.url;

  if (url.includes('ebay.com') || url.includes('ebay.co.uk') || url.includes('ebay.de') ||
      url.includes('ebay.fr') || url.includes('ebay.it') || url.includes('ebay.es') ||
      url.includes('ebay.com.au')) {
    // Auto-switch to eBay tab
    document.querySelectorAll('.mp-chip').forEach(c => c.classList.remove('active'));
    const ebayChip = document.querySelector('.mp-chip[data-mp="ebay"]');
    if (ebayChip) ebayChip.classList.add('active');
    activeMarketplace = 'ebay';

    const etsyPanel = $('etsy-research-panel');
    const ebayPanel = $('ebay-research-panel');
    if (etsyPanel) etsyPanel.classList.add('hidden');
    if (ebayPanel) ebayPanel.classList.remove('hidden');

    checkEbayCurrentPage();
  }
}

// ---------------------------------------------------------------------------
// eBay current page info
// ---------------------------------------------------------------------------
async function checkEbayCurrentPage() {
  if (!currentTab?.url || !currentTab.url.includes('/itm/')) return;

  const ebayAuthStatus = $('ebayAuthStatus');
  if (ebayAuthStatus) {
    ebayAuthStatus.textContent = isAuthenticated ? 'Bagli' : 'Baglanti Yok';
    ebayAuthStatus.className = 'status-badge ' + (isAuthenticated ? 'connected' : 'disconnected');
  }

  try {
    // Extract item info from the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => {
        const titleEl = document.querySelector('h1.x-item-title__mainTitle') ||
                        document.querySelector('#itemTitle') ||
                        document.querySelector('h1[data-testid="x-item-title"]');
        const priceEl = document.querySelector('.x-price-primary span') ||
                        document.querySelector('#prcIsum') ||
                        document.querySelector('.x-bin-price__content span');
        return {
          title: titleEl ? titleEl.textContent.trim() : '',
          price: priceEl ? priceEl.textContent.trim() : '',
        };
      }
    });

    const pageInfo = results?.[0]?.result;
    if (pageInfo && (pageInfo.title || pageInfo.price)) {
      const currentPageEl = $('ebayCurrentPage');
      if (currentPageEl) currentPageEl.classList.remove('hidden');

      const titleEl = $('ebayPageTitle');
      if (titleEl) titleEl.textContent = pageInfo.title || 'Baslik bulunamadi';

      const priceEl = $('ebayPagePrice');
      if (priceEl) priceEl.textContent = pageInfo.price ? `Fiyat: ${pageInfo.price}` : '';

      const trackBtn = $('ebayTrackBtn');
      if (trackBtn) trackBtn.classList.remove('hidden');
    }
  } catch (err) {
    console.log('Could not read eBay page info:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------
async function loadSettings() {
  const result = await chrome.storage.local.get('kx_settings');
  const s = result.kx_settings || { search: true, listing: true, shop: true, ebaySearch: true, ebayListing: true };
  const se = $('toggleSearch'); if (se) se.checked = s.search !== false;
  const le = $('toggleListing'); if (le) le.checked = s.listing !== false;
  const sh = $('toggleShop'); if (sh) sh.checked = s.shop !== false;
  const es = $('toggleEbaySearch'); if (es) es.checked = s.ebaySearch !== false;
  const el = $('toggleEbayListing'); if (el) el.checked = s.ebayListing !== false;
}

async function saveSettings() {
  await chrome.storage.local.set({
    kx_settings: {
      search: $('toggleSearch')?.checked ?? true,
      listing: $('toggleListing')?.checked ?? true,
      shop: $('toggleShop')?.checked ?? true,
      ebaySearch: $('toggleEbaySearch')?.checked ?? true,
      ebayListing: $('toggleEbayListing')?.checked ?? true,
    }
  });
}

async function handleClearCache() {
  const btn = $('clearCacheBtn');
  btn.disabled = true;
  btn.textContent = 'Temizleniyor...';

  try {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith('kx_cache_'));
    if (cacheKeys.length > 0) await chrome.storage.local.remove(cacheKeys);
    await chrome.storage.local.remove('kx_cache_index');
    btn.textContent = '✅ Temizlendi';
  } catch {
    btn.textContent = '❌ Hata';
  }
  setTimeout(() => { btn.textContent = 'Temizle'; btn.disabled = false; }, 2000);
}

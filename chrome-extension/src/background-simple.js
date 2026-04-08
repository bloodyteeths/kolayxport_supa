/**
 * Kolayxport Etsy Order Sync - Background Service Worker
 * Auth strategy: kolayxport.js content script fetches JWT from /api/auth/extension
 * (same-origin, includes httpOnly cookies) and pushes it here via authTokenFromPage.
 */

// Configuration
const KOLAYXPORT_DOMAIN = 'kolayxport.com';
const API_BASE = 'https://kolayxport.com';
const BADGE_COLORS = {
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
  default: '#2196F3'
};

// State management
let authToken = null;
let syncStats = {
  totalSynced: 0,
  lastSyncTime: null,
  errors: 0
};

function getApiBase() {
  return API_BASE;
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.default });
  chrome.action.setBadgeText({ text: '' });

  await checkAuthentication();

  chrome.contextMenus.create({
    id: 'syncNow',
    title: 'Sync Etsy Orders Now',
    contexts: ['action']
  });
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(request, sender, sendResponse) {
  // --- Research API handler ---
  if (request.type === 'kx_research') {
    try {
      if (!authToken) await checkAuthentication();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
        headers['X-Extension-Auth'] = authToken;
        headers['X-Extension-Version'] = chrome.runtime.getManifest().version;
      }

      const response = await fetch(`${getApiBase()}/api/ext/research`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: request.action, ...request.params }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'API error' }));
        sendResponse({ error: err.error || `HTTP ${response.status}` });
        return;
      }

      sendResponse(await response.json());
    } catch (err) {
      sendResponse({ error: err.message || 'Research API error' });
    }
    return;
  }

  // --- eBay Research API handler ---
  if (request.type === 'kx_ebay_research') {
    try {
      if (!authToken) await checkAuthentication();

      const stored = await chrome.storage.local.get(['kx_user', 'kx_api_key']);
      const userId = stored.kx_user?.id || '';
      const apiKey = stored.kx_api_key || '6d8a3ea6c932f48f65f6a4c0f71ee47395fd9fc77d0fbf6b46956f48129199e1';

      const headers = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
        headers['X-Extension-Auth'] = authToken;
        headers['X-Extension-Version'] = chrome.runtime.getManifest().version;
      }
      headers['x-api-key'] = apiKey;

      const params = request.params || {};
      let url = '';

      switch (request.action) {
        case 'search_enrich':
          url = `${getApiBase()}/api/clawd/ebay-research?action=product_database&q=${encodeURIComponent(params.query || '')}&user_id=${encodeURIComponent(userId)}&limit=50`;
          break;
        case 'listing_enrich':
          url = `${getApiBase()}/api/clawd/ebay?action=get_item_details&legacy_item_id=${encodeURIComponent(params.itemId || '')}&user_id=${encodeURIComponent(userId)}`;
          break;
        case 'seo_analyze':
          url = `${getApiBase()}/api/clawd/ebay?action=analyze_seo&q=${encodeURIComponent(params.query || '')}&my_title=${encodeURIComponent(params.title || '')}&user_id=${encodeURIComponent(userId)}`;
          break;
        case 'niche_analyze':
          url = `${getApiBase()}/api/clawd/ebay-research?action=niche_analyze&q=${encodeURIComponent(params.query || '')}&user_id=${encodeURIComponent(userId)}`;
          break;
        default:
          sendResponse({ error: `Unknown eBay action: ${request.action}` });
          return;
      }

      const response = await fetch(url, { method: 'GET', headers });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'eBay API error' }));
        sendResponse({ error: err.error || `HTTP ${response.status}` });
        return;
      }

      sendResponse(await response.json());
    } catch (err) {
      sendResponse({ error: err.message || 'eBay Research API error' });
    }
    return;
  }

  switch (request.action) {
    case 'authTokenFromPage':
      // Token pushed from kolayxport.js content script (same-origin fetch)
      if (request.token) {
        console.log('Received auth token from content script');
        authToken = request.token;
        updateBadge('authenticated');
        if (request.user) {
          chrome.storage.local.set({
            'kx_user': request.user,
            'kx_last_auth_check': Date.now()
          });
        }
      }
      sendResponse({ success: true });
      break;

    case 'contentScriptReady':
      // Content script loaded on kolayxport.com – ask it for token if needed
      if (!authToken && sender.tab?.id) {
        try {
          chrome.tabs.sendMessage(sender.tab.id, { action: 'getAuthToken' }, (response) => {
            if (response?.success && response.token) {
              authToken = response.token;
              updateBadge('authenticated');
              console.log('Got auth token after content script ready');
            }
          });
        } catch (e) {}
      }
      sendResponse({ success: true });
      break;

    case 'getCookies':
      const cookies = await getCookies(request.domain);
      sendResponse(cookies);
      break;

    case 'syncComplete':
      handleSyncComplete(request);
      sendResponse({ success: true });
      break;

    case 'getAuthStatus':
      if (!authToken) await checkAuthentication();
      sendResponse({
        authenticated: !!authToken,
        token: authToken
      });
      break;

    case 'syncOrders':
      try {
        console.log('Background: Syncing orders to Kolayxport API');
        const { orders, source, timestamp } = request;

        if (!authToken) {
          sendResponse({ success: false, error: 'Not authenticated' });
          return;
        }

        const response = await fetch('https://kolayxport.com/api/integrations/etsy/addresses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'X-Extension-Auth': authToken,
            'X-Extension-Version': chrome.runtime.getManifest().version
          },
          body: JSON.stringify({ orders, source, timestamp })
        });

        if (response.ok) {
          const result = await response.json();
          console.log('Background: Sync successful', result);
          sendResponse({ success: true, result });
        } else {
          const errorText = await response.text();
          console.error('Background: Sync failed', response.status, errorText);
          sendResponse({ success: false, error: `Server error ${response.status}: ${errorText}` });
        }
      } catch (error) {
        console.error('Background: Sync error', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }
}

// Authentication check – asks kolayxport.js content script to fetch JWT via same-origin API
async function checkAuthentication() {
  try {
    console.log('Checking authentication...');

    // 1. If we already have a cached token that's fresh, reuse it
    const stored = await chrome.storage.local.get(['kx_last_auth_check']);
    if (authToken && stored.kx_last_auth_check && (Date.now() - stored.kx_last_auth_check < 5 * 60 * 1000)) {
      console.log('Using cached auth token (less than 5 min old)');
      updateBadge('authenticated');
      return;
    }

    // 2. Find an open Kolayxport tab and ask its content script to fetch a token
    const tabs = await chrome.tabs.query({ url: ['https://kolayxport.com/*', 'https://www.kolayxport.com/*'] });
    console.log(`Found ${tabs.length} Kolayxport tab(s)`);

    for (const tab of tabs) {
      if (!tab.id || tab.status !== 'complete') continue;
      if (tab.url && (tab.url.includes('/login') || tab.url.includes('/auth/'))) continue;

      try {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
          chrome.tabs.sendMessage(tab.id, { action: 'getAuthToken' }, (resp) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(resp);
            }
          });
        });

        if (response?.success && response.token) {
          console.log('Got auth token from content script');
          authToken = response.token;
          updateBadge('authenticated');
          chrome.storage.local.set({ 'kx_last_auth_check': Date.now() });
          return;
        }
      } catch (e) {
        console.log(`Tab ${tab.id} message failed:`, e.message);
      }
    }

    // 3. No open tab – check if NextAuth session cookie exists
    try {
      const allCookies = await chrome.cookies.getAll({ domain: 'kolayxport.com' });
      const sessionCookie = allCookies.find(c =>
        c.name === 'next-auth.session-token' ||
        c.name === '__Secure-next-auth.session-token'
      );

      if (sessionCookie) {
        console.log('NextAuth session cookie found but no open tab to exchange for JWT');
        updateBadge('warning');
        return;
      }
    } catch (e) {
      console.warn('Cookie check failed:', e);
    }

    // 4. No auth found
    console.log('No authentication found');
    authToken = null;
    updateBadge('unauthenticated');

  } catch (error) {
    console.error('Auth check failed:', error);
    authToken = null;
    updateBadge('error');
  }
}

async function getCookies(domain) {
  try {
    const allCookies = await chrome.cookies.getAll({ domain });
    const cookieObj = {};
    allCookies.forEach(cookie => { cookieObj[cookie.name] = cookie.value; });
    if (authToken) cookieObj.kxAuthToken = authToken;
    return cookieObj;
  } catch (error) {
    console.error('Failed to get cookies:', error);
    return {};
  }
}

// Sync handling
function handleSyncComplete(data) {
  syncStats.totalSynced += data.count;
  syncStats.lastSyncTime = new Date();
  syncStats.errors = 0;
  updateBadge('success', syncStats.totalSynced.toString());
  chrome.storage.local.set({ syncStats });
}

// Badge management
function updateBadge(status, text = '') {
  let color = BADGE_COLORS.default;
  let badgeText = text;

  switch (status) {
    case 'authenticated':
      color = BADGE_COLORS.success;
      badgeText = badgeText || '';
      break;
    case 'unauthenticated':
      color = BADGE_COLORS.warning;
      badgeText = badgeText || '?';
      break;
    case 'warning':
      color = BADGE_COLORS.warning;
      badgeText = badgeText || '!';
      break;
    case 'success':
      color = BADGE_COLORS.success;
      break;
    case 'error':
      color = BADGE_COLORS.error;
      break;
  }

  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text: badgeText });
}

// Context menu handling
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'syncNow') {
    const tabs = await chrome.tabs.query({
      url: [
        'https://www.etsy.com/your/orders/*',
        'https://www.etsy.com/your/shops/*/orders*'
      ]
    });

    if (tabs.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeNow' });
      } catch (error) {
        console.error('Failed to send sync message:', error);
      }
    }
  }
});

// Global error handling
self.addEventListener('error', (event) => {
  console.error('Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

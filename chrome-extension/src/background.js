/**
 * Kolayxport Etsy Order Sync - Background Service Worker
 * Handles authentication, cookie access, and extension lifecycle
 */

// Configuration
const KOLAYXPORT_DOMAIN = 'app.kolayxport.com';
const AUTH_CHECK_INTERVAL = 60000; // Check auth every minute
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

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Open welcome page on first install
    chrome.tabs.create({
      url: 'https://app.kolayxport.com/help/chrome-extension'
    });
  }
  
  // Initialize badge
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.default });
  chrome.action.setBadgeText({ text: '' });
  
  // Check authentication
  await checkAuthentication();
  
  // Set up periodic auth check
  chrome.alarms.create('authCheck', { periodInMinutes: 1 });
  
  // Create context menus
  chrome.contextMenus.create({
    id: 'syncNow',
    title: 'Sync Etsy Orders Now',
    contexts: ['action']
  });
  
  chrome.contextMenus.create({
    id: 'fullImport',
    title: 'Import All Etsy Orders',
    contexts: ['action']
  });
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'authCheck') {
    await checkAuthentication();
  }
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(request, sender, sendResponse) {
  switch (request.action) {
    case 'getCookies':
      const cookies = await getCookies(request.domain);
      sendResponse(cookies);
      break;
      
    case 'syncComplete':
      handleSyncComplete(request);
      sendResponse({ success: true });
      break;
      
    case 'syncError':
      handleSyncError(request);
      sendResponse({ success: true });
      break;
      
    case 'importComplete':
      handleImportComplete(request);
      sendResponse({ success: true });
      break;
      
    case 'getAuthStatus':
      sendResponse({ 
        authenticated: !!authToken,
        token: authToken 
      });
      break;
      
    case 'openTab':
      chrome.tabs.create({ url: request.url });
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
}

// Authentication management
async function checkAuthentication() {
  try {
    // Check for Kolayxport session cookie
    const cookies = await chrome.cookies.getAll({
      domain: KOLAYXPORT_DOMAIN
    });
    
    // Look for Supabase auth tokens or NextAuth tokens
    const authCookie = cookies.find(cookie => 
      cookie.name.includes('sb-access-token') ||
      cookie.name.includes('sb-refresh-token') ||
      cookie.name === 'next-auth.session-token' ||
      cookie.name === '__Secure-next-auth.session-token' ||
      cookie.name === 'supabase-auth-token'
    );
    
    if (authCookie) {
      authToken = authCookie.value;
      updateBadge('authenticated');
    } else {
      // Try to get token from Kolayxport tab
      const token = await getTokenFromKolayxportTab();
      if (token) {
        authToken = token;
        updateBadge('authenticated');
      } else {
        authToken = null;
        updateBadge('unauthenticated');
      }
    }
  } catch (error) {
    console.error('Auth check failed:', error);
    authToken = null;
    updateBadge('error');
  }
}

async function getTokenFromKolayxportTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: `https://${KOLAYXPORT_DOMAIN}/*`
    });
    
    if (tabs.length === 0) return null;
    
    // Execute script to get token from localStorage/sessionStorage
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        // Look for Supabase auth token in localStorage
        const keys = Object.keys(localStorage);
        for (const key of keys) {
          if (key.includes('sb-') && key.includes('access-token')) {
            return localStorage.getItem(key);
          }
        }
        
        // Fallback to other possible token locations
        return localStorage.getItem('supabase.auth.token') ||
               localStorage.getItem('authToken') ||
               sessionStorage.getItem('supabase.auth.token') ||
               sessionStorage.getItem('sb-access-token');
      }
    });
    
    return results[0]?.result || null;
  } catch (error) {
    console.error('Failed to get token from tab:', error);
    return null;
  }
}

async function getCookies(domain) {
  try {
    const cookies = await chrome.cookies.getAll({ domain });
    const cookieObj = {};
    
    // Convert to object format
    cookies.forEach(cookie => {
      cookieObj[cookie.name] = cookie.value;
    });
    
    // Also check for auth token
    if (authToken) {
      cookieObj.kxAuthToken = authToken;
    }
    
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
  
  // Update badge with total count
  updateBadge('success', syncStats.totalSynced.toString());
  
  // Save stats
  chrome.storage.local.set({ syncStats });
  
  // Show notification for large syncs
  if (data.count >= 10) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon-128.png',
      title: 'Kolayxport Sync Complete',
      message: `Successfully synced ${data.count} Etsy orders`,
      priority: 1
    });
  }
}

function handleSyncError(data) {
  syncStats.errors++;
  
  updateBadge('error', '!');
  
  // Show error notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icons/icon-128.png',
    title: 'Kolayxport Sync Error',
    message: data.error || 'Failed to sync orders. Please check your connection.',
    priority: 2
  });
}

function handleImportComplete(data) {
  updateBadge('success', data.totalOrders.toString());
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icons/icon-128.png',
    title: 'Kolayxport Import Complete',
    message: `Successfully imported ${data.totalOrders} orders from Etsy`,
    priority: 1
  });
}

// Badge management
function updateBadge(status, text = '') {
  let color = BADGE_COLORS.default;
  let badgeText = text;
  
  switch (status) {
    case 'authenticated':
      color = BADGE_COLORS.success;
      badgeText = badgeText || '';
      break;
    case 'unauthenticated':
      color = BADGE_COLORS.warning;
      badgeText = badgeText || '?';
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

// Context menu click handling

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'syncNow') {
    // Send message to content script
    const tabs = await chrome.tabs.query({
      url: 'https://www.etsy.com/your/orders/*'
    });
    
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeNow' });
    } else {
      // Open Etsy orders page
      chrome.tabs.create({
        url: 'https://www.etsy.com/your/orders/sold'
      });
    }
  } else if (info.menuItemId === 'fullImport') {
    const tabs = await chrome.tabs.query({
      url: 'https://www.etsy.com/your/orders/*'
    });
    
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fullImport' });
    }
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // If on Etsy orders page, trigger sync
  if (tab.url && tab.url.includes('etsy.com/your/orders')) {
    chrome.tabs.sendMessage(tab.id, { action: 'scrapeNow' });
  }
});

// Web request handling for enhanced authentication
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Add auth header if we have a token
    if (authToken && details.url.includes(KOLAYXPORT_DOMAIN)) {
      const headers = details.requestHeaders || [];
      headers.push({
        name: 'X-Extension-Auth',
        value: authToken
      });
      return { requestHeaders: headers };
    }
  },
  { urls: [`https://${KOLAYXPORT_DOMAIN}/*`] },
  ['requestHeaders', 'extraHeaders']
);

// Global error handling
self.addEventListener('error', (event) => {
  console.error('Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});
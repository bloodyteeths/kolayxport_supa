/**
 * Kolayxport Etsy Order Sync - Simple Background Service Worker
 * Simplified version to avoid service worker registration issues
 */

// Configuration
const KOLAYXPORT_DOMAIN = 'kolayxport.com';
const KOLAYXPORT_APP_URL = 'https://kolayxport.com/app';
const API_BASE = 'https://kolayxport.com';

function getApiBase() {
  return API_BASE;
}
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
  // Initialize badge
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.default });
  chrome.action.setBadgeText({ text: '' });
  
  // Check authentication
  await checkAuthentication();
  
  // Create context menus
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
      if (!authToken) {
        await checkAuthentication();
      }
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
        headers['X-Extension-Auth'] = authToken;
        headers['X-Extension-Version'] = chrome.runtime.getManifest().version;
      }

      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/api/ext/research`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ action: request.action, ...request.params }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'API error' }));
        sendResponse({ error: err.error || `HTTP ${response.status}` });
        return;
      }

      const data = await response.json();
      sendResponse(data);
    } catch (err) {
      sendResponse({ error: err.message || 'Research API error' });
    }
    return;
  }

  // --- eBay Research API handler ---
  if (request.type === 'kx_ebay_research') {
    try {
      if (!authToken) {
        await checkAuthentication();
      }

      // Get user ID and API key from storage
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

      const apiBase = getApiBase();
      const action = request.action;
      const params = request.params || {};
      let url = '';

      switch (action) {
        case 'search_enrich':
          url = `${apiBase}/api/clawd/ebay-research?action=product_database&q=${encodeURIComponent(params.query || '')}&user_id=${encodeURIComponent(userId)}&limit=50`;
          break;
        case 'listing_enrich':
          url = `${apiBase}/api/clawd/ebay?action=get_item_details&legacy_item_id=${encodeURIComponent(params.itemId || '')}&user_id=${encodeURIComponent(userId)}`;
          break;
        case 'seo_analyze':
          url = `${apiBase}/api/clawd/ebay?action=analyze_seo&q=${encodeURIComponent(params.query || '')}&my_title=${encodeURIComponent(params.title || '')}&user_id=${encodeURIComponent(userId)}`;
          break;
        case 'niche_analyze':
          url = `${apiBase}/api/clawd/ebay-research?action=niche_analyze&q=${encodeURIComponent(params.query || '')}&user_id=${encodeURIComponent(userId)}`;
          break;
        default:
          sendResponse({ error: `Unknown eBay action: ${action}` });
          return;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'eBay API error' }));
        sendResponse({ error: err.error || `HTTP ${response.status}` });
        return;
      }

      const data = await response.json();
      sendResponse(data);
    } catch (err) {
      sendResponse({ error: err.message || 'eBay Research API error' });
    }
    return;
  }

  switch (request.action) {
    case 'getCookies':
      const cookies = await getCookies(request.domain);
      sendResponse(cookies);
      break;
      
    case 'syncComplete':
      handleSyncComplete(request);
      sendResponse({ success: true });
      break;
      
    case 'getAuthStatus':
      await checkAuthentication(); // Refresh auth status
      sendResponse({ 
        authenticated: !!authToken,
        token: authToken 
      });
      break;
      
    case 'syncOrders':
      // Handle the API call from background script to avoid CORS
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
          credentials: 'include',
          body: JSON.stringify({ orders, source, timestamp })
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('Background: Sync successful', result);
          sendResponse({ success: true, result });
        } else {
          const errorText = await response.text();
          console.error('Background: Sync failed', response.status, errorText);
          sendResponse({ 
            success: false, 
            error: `Server error ${response.status}: ${errorText}` 
          });
        }
      } catch (error) {
        console.error('Background: Sync error', error);
        sendResponse({ 
          success: false, 
          error: error.message 
        });
      }
      break;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
}

// Enhanced authentication check using dedicated API endpoint
async function checkAuthentication() {
  try {
    console.log('Checking authentication using Kolayxport API...');
    
    // Try the new auth endpoint first (most reliable)
    try {
      const response = await fetch('https://kolayxport.com/api/auth/extension', {
        method: 'GET',
        credentials: 'include', // Include httpOnly cookies
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Kolayxport Chrome Extension'
        }
      });
      
      if (response.ok) {
        const authData = await response.json();
        console.log('Auth endpoint response:', { authenticated: authData.authenticated, hasToken: !!authData.token });
        
        if (authData.authenticated && authData.token) {
          console.log('SUCCESS: Authenticated via API endpoint');
          authToken = authData.token;
          updateBadge('authenticated');
          
          // Store user info for later use
          chrome.storage.local.set({
            'kx_user': authData.user,
            'kx_auth_expires': authData.expires_at,
            'kx_last_auth_check': Date.now()
          });
          
          return;
        } else {
          console.log('Auth endpoint says not authenticated:', authData.message);
        }
      } else {
        console.log(`Auth endpoint returned ${response.status}:`, await response.text());
      }
    } catch (apiError) {
      console.warn('Auth API endpoint failed:', apiError.message);
    }
    
    // Fallback: Try cookies from multiple domain variations
    console.log('Falling back to cookie-based authentication...');
    const domainVariations = ['kolayxport.com', '.kolayxport.com'];
    let authCookie = null;
    
    for (const domain of domainVariations) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        console.log(`Cookies for ${domain}:`, cookies.map(c => c.name));
        
        // Look for Supabase auth cookies
        authCookie = cookies.find(cookie => 
          cookie.name.startsWith('sb-') ||
          cookie.name.includes('auth-token') ||
          cookie.name.includes('session')
        );
        
        if (authCookie) {
          console.log(`Found auth cookie: ${authCookie.name} on domain: ${domain}`);
          authToken = authCookie.value;
          updateBadge('authenticated');
          return;
        }
      } catch (cookieError) {
        console.warn(`Failed to get cookies for ${domain}:`, cookieError);
      }
    }
    
    // Try localStorage from Kolayxport tabs - FIXED for path-based app 
    try {
      const tabQueries = [
        `https://kolayxport.com/*`,
        `https://kolayxport.com/app*`,
        `https://www.kolayxport.com/*`
      ];
      
      let allTabs = [];
      for (const query of tabQueries) {
        try {
          const tabs = await chrome.tabs.query({ url: query });
          console.log(`Query ${query} found ${tabs.length} tabs`);
          allTabs = allTabs.concat(tabs);
        } catch (e) {
          console.log(`Query failed for ${query}:`, e.message);
        }
      }
      
      console.log(`Found ${allTabs.length} Kolayxport tabs`);
      
      if (allTabs.length > 0) {
        // Try the first available tab
        const tab = allTabs[0];
        console.log(`Checking auth in tab: ${tab.url}`);
        
        try {
          console.log(`Attempting script injection into tab ${tab.id}: ${tab.url}`);
          
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              console.log('=== KOLAYXPORT.COM/APP AUTH DEBUG ===');
              console.log('Current URL:', window.location.href);
              console.log('Domain:', window.location.hostname);
              console.log('Path:', window.location.pathname);
              console.log('Is /app path:', window.location.pathname.startsWith('/app'));
              
              // Check localStorage
              const keys = Object.keys(localStorage);
              console.log('LocalStorage keys count:', keys.length);
              console.log('LocalStorage keys:', keys);
              
              // Check sessionStorage too
              const sessionKeys = Object.keys(sessionStorage);
              console.log('SessionStorage keys count:', sessionKeys.length);
              console.log('SessionStorage keys:', sessionKeys);
              
              // Check for Supabase client in window
              console.log('Window.supabase exists:', !!window.supabase);
              console.log('Window.__NEXT_DATA__ exists:', !!window.__NEXT_DATA__);
              
              // Look for any auth-related keys
              const allKeys = [...keys, ...sessionKeys];
              const authKeys = allKeys.filter(key => 
                key.includes('sb-') || 
                key.includes('supabase') || 
                key.includes('auth') ||
                key.includes('session') ||
                key.includes('token')
              );
              
              console.log('Auth-related keys found:', authKeys);
              
              // Try localStorage first
              for (const key of keys) {
                if (key.startsWith('sb-') && key.includes('auth-token')) {
                  const value = localStorage.getItem(key);
                  console.log(`Found Supabase key: ${key}`);
                  
                  try {
                    const parsed = JSON.parse(value);
                    console.log('Parsed structure:', Object.keys(parsed));
                    if (parsed.access_token) {
                      console.log('SUCCESS: Found access_token!');
                      return {
                        token: parsed.access_token,
                        source: 'localStorage',
                        key: key
                      };
                    }
                  } catch (e) {
                    console.log('Parse failed for key:', key);
                  }
                }
              }
              
              // Try sessionStorage
              for (const key of sessionKeys) {
                if (key.includes('sb-') || key.includes('supabase')) {
                  const value = sessionStorage.getItem(key);
                  console.log(`Found session key: ${key}`);
                  
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed.access_token) {
                      console.log('SUCCESS: Found access_token in sessionStorage!');
                      return {
                        token: parsed.access_token,
                        source: 'sessionStorage', 
                        key: key
                      };
                    }
                  } catch (e) {
                    console.log('Session parse failed for key:', key);
                  }
                }
              }
              
              // Try window.supabase if available
              if (window.supabase && window.supabase.auth) {
                try {
                  // Check if there's a current session
                  console.log('Trying window.supabase.auth...');
                  // Note: We can't use await here, but we can try to access current session
                  const authState = window.supabase.auth;
                  console.log('Auth state available:', !!authState);
                } catch (e) {
                  console.log('Window supabase check failed:', e);
                }
              }
              
              console.log('=== NO AUTH TOKEN FOUND ===');
              return null;
            }
          });
          
          console.log('Script injection completed, results:', results);
          const result = results[0]?.result;
          if (result && result.token) {
            console.log(`Found token from ${result.source}: ${result.key}`);
            authToken = result.token;
            updateBadge('authenticated');
            return;
          } else {
            console.log('Script injection returned null, trying message approach...');
          }
          
        } catch (injectionError) {
          console.error('Script injection failed:', injectionError);
          console.log('This could be due to CSP restrictions on the Kolayxport site');
        }
        
        // Always try the message approach as fallback when script injection fails or returns null
        try {
          console.log('Trying message-based approach to kolayxport.js content script...');
          console.log('Waiting 2 seconds for content script to load...');
          
          // Wait a bit for content script to load
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Message timeout - content script may not be loaded'));
            }, 5000);
            
            chrome.tabs.sendMessage(tab.id, { action: 'getAuthToken' }, (response) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                console.log('Chrome runtime error:', chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          });
          
          if (response && response.success && response.token) {
            console.log('SUCCESS: Got token via message approach:', response);
            authToken = response.token;
            updateBadge('authenticated');
            return;
          } else {
            console.log('Message approach returned no token:', response);
          }
        } catch (messageError) {
          console.error('Message approach failed:', messageError.message);
          console.log('This usually means the kolayxport.js content script is not loaded on the page');
        }
      }
    } catch (tabError) {
      console.warn('Tab injection failed:', tabError);
    }
    
    // If we get here, no authentication was found
    console.log('No authentication found via any method');
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
    const cookies = await chrome.cookies.getAll({ domain });
    const cookieObj = {};
    
    cookies.forEach(cookie => {
      cookieObj[cookie.name] = cookie.value;
    });
    
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
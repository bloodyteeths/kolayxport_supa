/**
 * Kolayxport Etsy Order Sync - Background Service Worker
 * Handles authentication, cookie access, and extension lifecycle
 */

// Configuration
const KOLAYXPORT_DOMAIN = 'kolayxport.com';
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
      url: 'https://kolayxport.com/help/chrome-extension'
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

// Message handling with sender validation
const allowedOrigins = ['https://www.etsy.com', 'https://etsy.com'];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Allow messages from the extension itself
  if (sender.id !== chrome.runtime.id) {
    return; // Ignore messages from other extensions
  }

  // For content script messages (sender.url present), validate the origin
  if (sender.url && !allowedOrigins.some(origin => sender.url.startsWith(origin))) {
    // Also allow messages from our own app domain
    if (!sender.url.startsWith(`https://${KOLAYXPORT_DOMAIN}`)) {
      return; // Ignore messages from unauthorized origins
    }
  }

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
    console.log('Checking authentication...');
    
    // Check for cookies first (more reliable than tab injection)
    const domainVariations = [
      'kolayxport.com',
      'kolayxport.com',
      '.kolayxport.com'
    ];
    
    let authCookie = null;
    for (const domain of domainVariations) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        console.log(`Checking cookies for domain: ${domain}`, cookies.map(c => c.name));
        
        // Look for various Supabase auth patterns
        authCookie = cookies.find(cookie => 
          cookie.name.includes('sb-access-token') ||
          cookie.name.includes('sb-refresh-token') ||
          cookie.name === 'supabase-auth-token' ||
          cookie.name.startsWith('sb-') ||
          cookie.name === 'next-auth.session-token' ||
          cookie.name === '__Secure-next-auth.session-token'
        );
        
        if (authCookie) {
          console.log(`Found auth cookie: ${authCookie.name} on domain: ${domain}`);
          break;
        }
      } catch (cookieError) {
        console.warn(`Failed to check cookies for domain ${domain}:`, cookieError);
        continue;
      }
    }
    
    if (authCookie) {
      authToken = authCookie.value;
      updateBadge('authenticated');
      return;
    }
    
    // Fallback: Try to get token from active Kolayxport tabs (if cookies not found)
    console.log('No auth cookies found, trying tab injection...');
    try {
      const token = await getTokenFromKolayxportTab();
      if (token) {
        console.log('Found auth token from active tab');
        authToken = token;
        updateBadge('authenticated');
        return;
      }
    } catch (tabError) {
      console.warn('Tab injection failed:', tabError);
      // Continue to unauthenticated state instead of throwing error
    }
    
    // Final fallback: just check if we have an active Kolayxport session (simple presence check)
    try {
      const tabs = await chrome.tabs.query({
        url: [`https://${KOLAYXPORT_DOMAIN}/*`, `https://kolayxport.com/*`]
      });
      
      if (tabs.length > 0) {
        // Check if any tab seems to be authenticated (simple URL pattern check)
        const authenticatedTab = tabs.find(tab => 
          tab.url && 
          (tab.url.includes('/app/') || tab.url.includes('/dashboard') || tab.url.includes('/labels') || tab.url.includes('/settings')) &&
          !tab.url.includes('/login') && 
          !tab.url.includes('/auth')
        );
        
        if (authenticatedTab) {
          console.log('Found authenticated session based on URL patterns');
          authToken = 'session-detected'; // Placeholder token indicating authenticated
          updateBadge('authenticated');
          return;
        }
      }
    } catch (finalError) {
      console.warn('Final fallback check failed:', finalError);
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

async function getTokenFromKolayxportTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: [`https://${KOLAYXPORT_DOMAIN}/*`, `https://kolayxport.com/*`]
    });
    
    if (tabs.length === 0) {
      console.log('No Kolayxport tabs found');
      return null;
    }
    
    console.log(`Found ${tabs.length} Kolayxport tabs`);
    
    // Try each tab until we find one that works
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      
      // Skip if tab is not ready
      if (!tab.id || tab.status !== 'complete') {
        console.log(`Skipping tab ${tab.id} - status: ${tab.status}`);
        continue;
      }
      
      // Check if tab URL is safe to inject into
      if (tab.url.includes('chrome://') || tab.url.includes('chrome-extension://')) {
        console.log(`Skipping system tab: ${tab.url}`);
        continue;
      }
      
      try {
        console.log(`Attempting to inject script into tab ${tab.id}: ${tab.url}`);
        
        // Execute script to get token from localStorage/sessionStorage and window globals
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try {
              // Simplified debugging to avoid service worker issues
              const keys = Object.keys(localStorage);
              console.log('=== AUTH DEBUG START ===');
              console.log('LocalStorage keys:', keys);
              
              // Find auth-related keys
              const authKeys = keys.filter(key => 
                key.includes('sb-') || 
                key.includes('supabase') || 
                key.includes('auth')
              );
              
              console.log('Auth-related keys:', authKeys);
              
              // Log sample of each auth key (first 50 chars)
              authKeys.forEach(key => {
                const value = localStorage.getItem(key);
                if (value) {
                  console.log(`${key}: ${value.substring(0, 50)}...`);
                }
              });
              
              // First try all sb- keys that might contain auth tokens
              for (const key of keys) {
                if (key.startsWith('sb-') && key.includes('auth-token')) {
                  const value = localStorage.getItem(key);
                  console.log(`Found Supabase token key: ${key}`);
                  
                  try {
                    // Parse the session data
                    const sessionData = JSON.parse(value);
                    console.log('Session data structure:', Object.keys(sessionData));
                    if (sessionData.access_token) {
                      console.log('Found access_token in session data');
                      return sessionData.access_token;
                    }
                  } catch (parseError) {
                    console.error('Failed to parse session data:', parseError);
                    // Continue to next key
                  }
                }
              }
              
              // Try specific Supabase patterns based on your project
              const possibleAuthKeys = [
                'sb-zkcuvvzmtknzztjjwshx-auth-token',
                'supabase.auth.token',
                'sb-auth-token'
              ];
              
              for (const key of possibleAuthKeys) {
                const value = localStorage.getItem(key);
                if (value) {
                  console.log(`Found potential auth key: ${key}`);
                  try {
                    const parsed = JSON.parse(value);
                    if (parsed.access_token) {
                      console.log('Found access_token in potential auth key');
                      return parsed.access_token;
                    }
                  } catch {
                    console.log('Could not parse potential auth key');
                  }
                }
              }
              
              // Try to get token from window globals
              if (typeof window !== 'undefined') {
                // Check for Supabase client
                if (window.supabase) {
                  try {
                    // Note: getSession() might be async, but we can't use await in this context
                    const session = window.supabase.auth.getSession();
                    console.log('Window supabase session:', session);
                    // If it's a promise, we can't wait for it here
                    if (session && typeof session.then === 'function') {
                      console.log('Session is a promise, cannot await in this context');
                    } else if (session && session.data && session.data.session) {
                      console.log('Found session from window.supabase');
                      return session.data.session.access_token;
                    }
                  } catch (e) {
                    console.log('Could not get session from window.supabase:', e.message);
                  }
                }
                
                // Check for other auth globals
                const authGlobals = ['__NEXT_DATA__', '_supabaseClient', 'supabaseClient'];
                for (const global of authGlobals) {
                  if (window[global]) {
                    console.log(`Found global: ${global}`, typeof window[global]);
                  }
                }
              }
              
              // Fallback: look for any auth-related data
              const supabaseKey = keys.find(key => 
                key.includes('supabase') || 
                key.includes('sb-')
              );
              
              if (supabaseKey) {
                const session = localStorage.getItem(supabaseKey);
                console.log(`Found auth-related key: ${supabaseKey}, length: ${session?.length}`);
                
                try {
                  const parsed = JSON.parse(session);
                  console.log('Parsed structure:', Object.keys(parsed));
                  // Look for various token fields
                  const token = parsed.access_token || parsed.token || parsed.accessToken;
                  if (token) {
                    console.log('Found token in parsed data');
                    return token;
                  }
                } catch {
                  // If not JSON, check if it's a direct token string
                  if (session && session.length > 20) {
                    console.log('Returning raw session value');
                    return session;
                  }
                }
              }
              
              console.log('=== AUTH DEBUG END ===');
              console.log('No authentication tokens found in storage');
              return null;
            } catch (error) {
              console.error('Error extracting auth token:', error);
              return null;
            }
          }
        });
        
        const token = results[0]?.result;
        if (token) {
          console.log('Successfully extracted token from tab');
          return token;
        }
        
        console.log(`No token found in tab ${tab.id}`);
      } catch (tabError) {
        console.warn(`Failed to inject script into tab ${tab.id}:`, tabError.message);
        // Continue to next tab instead of giving up
        continue;
      }
    }
    
    console.log('No valid tokens found in any Kolayxport tabs');
    return null;
  } catch (error) {
    console.error('Failed to get token from tabs:', error);
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
  console.log('📋 Context menu clicked:', info.menuItemId);
  
  if (info.menuItemId === 'syncNow') {
    // Send message to content script
    const tabs = await chrome.tabs.query({
      url: [
        'https://www.etsy.com/your/orders/*',
        'https://www.etsy.com/your/shops/*/orders*',
        'https://www.etsy.com/shop-manager/*orders*'
      ]
    });
    
    console.log(`Found ${tabs.length} Etsy order tabs`);
    
    if (tabs.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'scrapeNow' });
        console.log('✅ Sync message sent successfully');
      } catch (error) {
        console.error('❌ Failed to send sync message:', error);
      }
    } else {
      // Open Etsy orders page
      chrome.tabs.create({
        url: 'https://www.etsy.com/your/orders/sold'
      });
    }
  } else if (info.menuItemId === 'fullImport') {
    const tabs = await chrome.tabs.query({
      url: [
        'https://www.etsy.com/your/orders/*',
        'https://www.etsy.com/your/shops/*/orders*',
        'https://www.etsy.com/shop-manager/*orders*'
      ]
    });
    
    if (tabs.length > 0) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { action: 'fullImport' });
        console.log('✅ Full import message sent successfully');
      } catch (error) {
        console.error('❌ Failed to send import message:', error);
      }
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

// Web request handling removed to fix service worker registration issues
// Authentication will be handled via cookies and Authorization headers in content script

// Global error handling
self.addEventListener('error', (event) => {
  console.error('Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});
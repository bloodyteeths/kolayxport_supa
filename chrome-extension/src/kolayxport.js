/**
 * Content script for Kolayxport pages to help with authentication
 */

console.log('Kolayxport content script loaded on:', window.location.href);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Kolayxport content script received message:', request);
  
  if (request.action === 'getAuthToken') {
    try {
      console.log('=== KOLAYXPORT AUTH TOKEN SEARCH ===');
      console.log('Current URL:', window.location.href);
      console.log('Path:', window.location.pathname);
      
      // Check localStorage
      const keys = Object.keys(localStorage);
      console.log('LocalStorage keys count:', keys.length);
      console.log('LocalStorage keys:', keys);
      
      // Check sessionStorage  
      const sessionKeys = Object.keys(sessionStorage);
      console.log('SessionStorage keys count:', sessionKeys.length);
      console.log('SessionStorage keys:', sessionKeys);
      
      // Log all Supabase-related keys with their values (first 50 chars)
      const allKeys = [...keys, ...sessionKeys];
      const supabaseKeys = allKeys.filter(key => 
        key.includes('sb-') || key.includes('supabase') || key.includes('auth')
      );
      console.log('Found Supabase-related keys:', supabaseKeys);
      
      supabaseKeys.forEach(key => {
        try {
          const value = localStorage.getItem(key) || sessionStorage.getItem(key);
          if (value) {
            console.log(`${key}: ${value.substring(0, 100)}...`);
            // Try to parse and show structure
            if (value.startsWith('{')) {
              try {
                const parsed = JSON.parse(value);
                console.log(`${key} structure:`, Object.keys(parsed));
              } catch (e) {
                console.log(`${key} is not valid JSON`);
              }
            }
          }
        } catch (e) {
          console.log(`Error reading ${key}:`, e.message);
        }
      });
      
      // Look for Supabase auth tokens
      for (const key of keys) {
        if (key.startsWith('sb-') && key.includes('auth-token')) {
          const value = localStorage.getItem(key);
          console.log(`Found Supabase key: ${key}`);
          
          try {
            const parsed = JSON.parse(value);
            console.log('Token structure:', Object.keys(parsed));
            if (parsed.access_token) {
              console.log('SUCCESS: Found access_token in localStorage!');
              sendResponse({
                success: true,
                token: parsed.access_token,
                source: 'localStorage',
                key: key
              });
              return;
            }
          } catch (e) {
            console.log('Parse failed for key:', key, e);
          }
        }
      }
      
      // Try sessionStorage too
      for (const key of sessionKeys) {
        if (key.includes('sb-') || key.includes('supabase')) {
          const value = sessionStorage.getItem(key);
          console.log(`Found session key: ${key}`);
          
          try {
            const parsed = JSON.parse(value);
            if (parsed.access_token) {
              console.log('SUCCESS: Found access_token in sessionStorage!');
              sendResponse({
                success: true,
                token: parsed.access_token,
                source: 'sessionStorage',
                key: key
              });
              return;
            }
          } catch (e) {
            console.log('Session parse failed for key:', key, e);
          }
        }
      }
      
      // Check for window.supabase and other globals
      console.log('=== CHECKING WINDOW GLOBALS ===');
      console.log('window.supabase exists:', !!window.supabase);
      console.log('window.__SUPABASE_CLIENT__ exists:', !!window.__SUPABASE_CLIENT__);
      console.log('window._supabaseClient exists:', !!window._supabaseClient);
      console.log('window.__NEXT_DATA__ exists:', !!window.__NEXT_DATA__);
      
      // Try to access Next.js props if available
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
        console.log('Next.js data available:', Object.keys(window.__NEXT_DATA__.props));
      }
      
      // Check for React DevTools or context
      if (window.React) {
        console.log('React is available');
      }
      
      // Look for any auth-related globals
      const authGlobals = Object.keys(window).filter(key => 
        key.toLowerCase().includes('auth') || 
        key.toLowerCase().includes('supabase') ||
        key.toLowerCase().includes('session')
      );
      console.log('Auth-related window globals:', authGlobals);
      
      if (window.supabase) {
        console.log('Window.supabase exists, trying to get session...');
        try {
          // Try to access the auth object
          if (window.supabase.auth) {
            console.log('window.supabase.auth is available');
            // Try to get current session synchronously if possible
            const authClient = window.supabase.auth;
            console.log('Auth client methods:', Object.getOwnPropertyNames(authClient));
          }
        } catch (e) {
          console.log('Error accessing window.supabase.auth:', e.message);
        }
      }
      
      console.log('No auth token found');
      sendResponse({ success: false, error: 'No auth token found' });
      
    } catch (error) {
      console.error('Error getting auth token:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  return true; // Keep message channel open
});

// Also try to automatically detect and store auth info
function detectAuthInfo() {
  const keys = Object.keys(localStorage);
  const authKeys = keys.filter(key => 
    key.includes('sb-') || 
    key.includes('supabase') || 
    key.includes('auth')
  );
  
  if (authKeys.length > 0) {
    console.log('Kolayxport auth keys detected:', authKeys);
    // Store a flag that auth is available
    chrome.storage.local.set({ 'kolayxport_auth_available': true });
  }
}

// Run detection on load
detectAuthInfo();

// Run detection when storage changes
window.addEventListener('storage', detectAuthInfo);
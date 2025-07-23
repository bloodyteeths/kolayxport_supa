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
      
      // Log ALL sessionStorage keys to see what's there
      sessionKeys.forEach(key => {
        const value = sessionStorage.getItem(key);
        if (value) {
          console.log(`sessionStorage[${key}]: ${value.substring(0, 100)}...`);
        }
      });
      
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
      
      // Check document.cookie directly (might be httpOnly but worth trying)
      console.log('=== CHECKING COOKIES ===');
      console.log('document.cookie:', document.cookie);
      
      // Parse cookies manually
      const cookies = document.cookie.split(';').reduce((acc, cookie) => {
        const [key, ...val] = cookie.trim().split('=');
        if (key) {
          acc[key] = decodeURIComponent(val.join('='));
        }
        return acc;
      }, {});
      console.log('Parsed cookies:', Object.keys(cookies));
      
      // Look for auth-related cookies
      const authCookies = Object.keys(cookies).filter(key => 
        key.includes('sb-') || key.includes('supabase') || key.includes('auth') || key.includes('session')
      );
      console.log('Auth-related cookies:', authCookies);
      
      // Try to access cookies that might contain tokens
      for (const cookieName of authCookies) {
        const cookieValue = cookies[cookieName];
        console.log(`Cookie ${cookieName}: ${cookieValue?.substring(0, 100)}...`);
        
        // Try to parse as JSON
        if (cookieValue && cookieValue.startsWith('{')) {
          try {
            const parsed = JSON.parse(cookieValue);
            console.log(`Cookie ${cookieName} structure:`, Object.keys(parsed));
            if (parsed.access_token) {
              console.log('SUCCESS: Found access_token in cookie!');
              sendResponse({
                success: true,
                token: parsed.access_token,
                source: 'cookie',
                key: cookieName
              });
              return;
            }
          } catch (e) {
            console.log(`Cookie ${cookieName} is not JSON`);
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
        
        // Check if there's session data in Next.js props
        if (window.__NEXT_DATA__.props.pageProps) {
          console.log('PageProps available:', Object.keys(window.__NEXT_DATA__.props.pageProps));
          const pageProps = window.__NEXT_DATA__.props.pageProps;
          
          // Look for session or auth data in props
          const authProps = Object.keys(pageProps).filter(key => 
            key.toLowerCase().includes('session') || 
            key.toLowerCase().includes('auth') ||
            key.toLowerCase().includes('user')
          );
          console.log('Auth-related pageProps:', authProps);
          
          for (const prop of authProps) {
            console.log(`PageProp ${prop}:`, pageProps[prop]);
          }
        }
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
      
      // Try to access React Fiber for context (advanced technique)
      try {
        const reactRoot = document.querySelector('#__next');
        if (reactRoot && reactRoot._reactInternalFiber) {
          console.log('React Fiber available, trying to access context...');
          // This is complex and might not work, but let's try
        }
      } catch (e) {
        console.log('Could not access React Fiber');
      }
      
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

// Signal that this content script is ready
console.log('Kolayxport content script ready for messages');
chrome.runtime.sendMessage({ action: 'contentScriptReady', url: window.location.href }).catch(() => {
  // Ignore errors - background script might not be ready
});

// Run detection on load
detectAuthInfo();

// Run detection when storage changes
window.addEventListener('storage', detectAuthInfo);
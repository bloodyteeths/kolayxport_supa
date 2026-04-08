/**
 * Content script for Kolayxport pages – handles NextAuth-based authentication.
 * Runs on kolayxport.com/* and can access httpOnly cookies via same-origin fetch.
 */

console.log('[KX] Content script loaded on:', window.location.href);

// On load, immediately fetch a JWT token from the extension auth endpoint
async function fetchAuthToken() {
  try {
    console.log('[KX] Fetching auth token from /api/auth/extension...');
    const response = await fetch('/api/auth/extension', {
      method: 'GET',
      credentials: 'include', // sends httpOnly cookies (same-origin)
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.log('[KX] Auth endpoint returned', response.status);
      return null;
    }

    const data = await response.json();
    console.log('[KX] Auth response:', { authenticated: data.authenticated, hasToken: !!data.token });

    if (data.authenticated && data.token) {
      // Send token to background service worker
      chrome.runtime.sendMessage({
        action: 'authTokenFromPage',
        token: data.token,
        user: data.user
      }).catch(() => {});
      console.log('[KX] Auth token sent to background');
      return data.token;
    }

    return null;
  } catch (error) {
    console.error('[KX] Failed to fetch auth token:', error);
    return null;
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAuthToken') {
    // Background is asking us to fetch a token (we can access cookies)
    fetchAuthToken().then(token => {
      if (token) {
        sendResponse({ success: true, token, source: 'nextauth-api' });
      } else {
        sendResponse({ success: false, error: 'Not authenticated on Kolayxport' });
      }
    });
    return true; // Keep channel open for async response
  }
});

// Signal ready and immediately try to get auth token
console.log('[KX] Content script ready');
chrome.runtime.sendMessage({ action: 'contentScriptReady', url: window.location.href }).catch(() => {});

// Fetch token on page load
fetchAuthToken();

// Re-fetch token when page gains focus (user might have just logged in)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchAuthToken();
  }
});

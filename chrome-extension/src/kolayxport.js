/**
 * Content script for Kolayxport pages – handles NextAuth-based authentication.
 * Runs on kolayxport.com/* and can access httpOnly cookies via same-origin fetch.
 */

console.log('[KX] Content script loaded on:', window.location.href);

// Safe wrapper for chrome.runtime.sendMessage — handles "context invalidated"
function safeSendMessage(msg) {
  try {
    if (!chrome.runtime?.id) {
      console.warn('[KX] Extension context invalidated, cannot send message');
      return Promise.resolve(null);
    }
    return chrome.runtime.sendMessage(msg).catch(function(e) {
      console.warn('[KX] sendMessage failed:', e.message);
      return null;
    });
  } catch (e) {
    console.warn('[KX] sendMessage error:', e.message);
    return Promise.resolve(null);
  }
}

// On load, immediately fetch a JWT token from the extension auth endpoint
async function fetchAuthToken() {
  try {
    console.log('[KX] Fetching auth token from /api/auth/extension...');
    var response = await fetch('/api/auth/extension', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.log('[KX] Auth endpoint returned', response.status);
      return null;
    }

    var data = await response.json();
    console.log('[KX] Auth response:', { authenticated: data.authenticated, hasToken: !!data.token });

    if (data.authenticated && data.token) {
      await safeSendMessage({
        action: 'authTokenFromPage',
        token: data.token,
        user: data.user
      });
      console.log('[KX] Auth token sent to background');
      return data.token;
    }

    return null;
  } catch (error) {
    console.error('[KX] Failed to fetch auth token:', error.message || error);
    return null;
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'getAuthToken') {
    fetchAuthToken().then(function(token) {
      if (token) {
        sendResponse({ success: true, token: token, source: 'nextauth-api' });
      } else {
        sendResponse({ success: false, error: 'Not authenticated on Kolayxport' });
      }
    });
    return true;
  }
});

// Signal ready and immediately try to get auth token
console.log('[KX] Content script ready');
safeSendMessage({ action: 'contentScriptReady', url: window.location.href });

// Fetch token on page load
fetchAuthToken();

// Re-fetch token when page gains focus (user might have just logged in)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    fetchAuthToken();
  }
});

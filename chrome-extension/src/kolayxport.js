/**
 * Content script for Kolayxport pages – handles NextAuth-based authentication.
 * Runs on kolayxport.com/* and can access httpOnly cookies via same-origin fetch.
 */


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

// The app's UI language on this browser (lib/stores/useLocaleStore.ts), or null.
function pageLocale() {
  try {
    var v = window.localStorage.getItem('kolayxport_locale');
    return v === 'tr' || v === 'en' ? v : null;
  } catch (_) {
    return null;
  }
}

// Fetch a token from the extension auth endpoint (same-origin, carries the session cookie)
// and hand it to the background worker. Resolves to { token, expiresIn, expiresAt, user } or null.
// user.locale = the account language (server), else the app's UI language on this browser.
async function fetchAuthToken() {
  try {
    var response = await fetch('/api/auth/extension', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) return null;

    var data = await response.json();
    if (data.authenticated && data.token) {
      var locale = (data.user && data.user.locale) || data.locale || pageLocale();
      var user = data.user
        ? { email: data.user.email || null, name: data.user.name || null, locale: locale || null }
        : null;
      await safeSendMessage({
        action: 'authTokenFromPage',
        token: data.token,
        expiresIn: data.expiresIn,
        expiresAt: data.expiresAt,
        user: user
      });
      return { token: data.token, expiresIn: data.expiresIn, expiresAt: data.expiresAt, user: user };
    }
    return null;
  } catch (error) {
    console.warn('[KX] Failed to fetch auth token');
    return null;
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'getAuthToken') {
    fetchAuthToken().then(function(result) {
      if (result) {
        sendResponse({ success: true, token: result.token, expiresIn: result.expiresIn, expiresAt: result.expiresAt, user: result.user });
      } else {
        sendResponse({ success: false, error: 'Not authenticated on Kolayxport' });
      }
    });
    return true;
  }
});

// Signal ready and immediately try to get auth token
safeSendMessage({ action: 'contentScriptReady', url: window.location.href });

// Fetch token on page load
fetchAuthToken();

// Re-fetch token when page gains focus (user might have just logged in)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    fetchAuthToken();
  }
});

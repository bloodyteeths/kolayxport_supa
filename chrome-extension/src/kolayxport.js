/**
 * Content script for Kolayxport pages – handles NextAuth-based authentication.
 * Runs on kolayxport.com/* and can access httpOnly cookies via same-origin fetch.
 */


// Safe wrapper for chrome.runtime.sendMessage. After the extension is reloaded or updated, tabs that were
// already open keep running this old script with no extension behind it ("context invalidated"). That is
// expected, so it stops quietly instead of logging: Chrome lists every console warning as an extension error.
var kxContextGone = false;
function contextAlive() {
  try { return !kxContextGone && !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
}
function retire() {
  kxContextGone = true;
  document.removeEventListener('visibilitychange', onVisible);
}
function safeSendMessage(msg) {
  if (!contextAlive()) { retire(); return Promise.resolve(null); }
  try {
    return chrome.runtime.sendMessage(msg).catch(function () {
      if (!contextAlive()) retire();
      return null;
    });
  } catch (_) {
    retire();
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
  if (!contextAlive()) return null;
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
    // Network hiccup or signed out: the next visit or focus retries.
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
function onVisible() {
  if (document.visibilityState === 'visible' && contextAlive()) fetchAuthToken();
}
document.addEventListener('visibilitychange', onVisible);

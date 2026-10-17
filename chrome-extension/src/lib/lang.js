/**
 * KolayXport — the extension's one language resolver (overlays, limit card, popup).
 *
 * Order:
 *   1. the user's explicit choice in the popup: chrome.storage.local `kx_lang` ('tr' | 'en');
 *   2. the KolayXport account language: `kx_account_lang`, stored by the background worker
 *      from /api/auth/extension (`locale`);
 *   3. 'tr' (our users are Turkish sellers). navigator.language / Chrome's UI language are
 *      deliberately NOT used.
 *
 * Storage is async, so `ready` resolves once the stored values were read; overlays await it
 * before their first render (no flash of the wrong language). `get()` is 'tr' until then.
 * `onChange(cb)` fires when either key changes and the resolved language differs, so open
 * overlays can re-render live.
 */
(function () {
  'use strict';

  var KEYS = ['kx_lang', 'kx_account_lang'];
  var DEFAULT = 'tr';

  function normalize(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim().toLowerCase().slice(0, 2);
    return s === 'tr' || s === 'en' ? s : null;
  }

  /** Pure: the language for a storage snapshot { kx_lang, kx_account_lang }. */
  function resolve(stored) {
    var s = stored || {};
    return normalize(s.kx_lang) || normalize(s.kx_account_lang) || DEFAULT;
  }

  var current = DEFAULT;
  var listeners = [];

  function storage() {
    try {
      return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
    } catch (_) {
      return null;
    }
  }

  function read(cb) {
    var st = storage();
    if (!st) { cb({}); return; }
    var done = false;
    var finish = function (r) { if (done) return; done = true; cb(r || {}); };
    // Never hold an overlay back for long if storage does not answer.
    var timer = setTimeout(function () { finish({}); }, 1500);
    try {
      var p = st.get(KEYS, function (r) {
        try { void (chrome.runtime && chrome.runtime.lastError); } catch (_) { /* ignore */ }
        clearTimeout(timer);
        finish(r);
      });
      if (p && typeof p.then === 'function') p.then(function (r) { clearTimeout(timer); finish(r); }, function () { /* callback path */ });
    } catch (_) {
      clearTimeout(timer);
      finish({});
    }
  }

  var ready = new Promise(function (res) {
    read(function (r) {
      current = resolve(r);
      res(current);
    });
  });

  function setCurrent(next) {
    if (next === current) return;
    current = next;
    listeners.slice().forEach(function (cb) {
      try { cb(next); } catch (_) { /* one bad listener must not stop the rest */ }
    });
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area && area !== 'local') return;
        if (!changes || !(('kx_lang' in changes) || ('kx_account_lang' in changes))) return;
        ready.then(function () { read(function (r) { setCurrent(resolve(r)); }); });
      });
    }
  } catch (_) { /* no live updates; a page refresh applies the change */ }

  var api = {
    KEYS: KEYS,
    DEFAULT: DEFAULT,
    normalize: normalize,
    resolve: resolve,
    ready: ready,
    get: function () { return current; },
    /** Intl locale for numbers, money and dates in the resolved language. */
    locale: function () { return current === 'en' ? 'en-US' : 'tr-TR'; },
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
  };
  if (typeof window !== 'undefined') window.__KX_LANG = api;
})();

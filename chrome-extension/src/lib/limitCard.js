/**
 * KolayXport — research limit card (Etsy / eBay / Amazon overlays + popup).
 *
 * When /api/ext/* or the extension's /api/clawd/* research calls answer
 *   429 { error: 'research_limit', reason: 'user_daily' | 'global_brake' | 'signed_out',
 *         limit, used, resetAt, upgradeUrl }
 * the background worker forwards that body as `response.limit`, and every overlay
 * replaces its numbers with this one card. DOM-built, inline styles only (works in the
 * page DOM and inside shadow roots), text via textContent only.
 *
 * Also gives every research message a page-view id (sent as X-KX-Page-View), so the
 * several API calls of one page view count as one lookup on the server.
 */
(function () {
  'use strict';

  var UPGRADE_URL = 'https://kolayxport.com/plan';
  // Brand text font (lib/ui.js registers it); system UI fonts until then. Never a serif.
  var FONT = "'KX Instrument','Instrument Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  var SIGNUP_URL = 'https://kolayxport.com/login?utm_source=extension&utm_medium=limit';
  var REASONS = { user_daily: 1, global_brake: 1, signed_out: 1 };

  // Language: lib/lang.js (stored choice → account language → 'tr'), read at render time.
  function lang() {
    try {
      var L = typeof window !== 'undefined' && window.__KX_LANG;
      return (L && L.get()) || 'tr';
    } catch (_) {
      return 'tr';
    }
  }

  var COPY = {
    tr: {
      userTitle: 'Günlük araştırma hakkınız doldu',
      userSub: "Yarın 00:00'da yenilenir.",
      upgrade: 'Planınızı yükseltin',
      signedOutTitle: 'KolayXport hesabınıza giriş yapın',
      signedOutSub: 'Araştırma verileri KolayXport hesabınızla görünür. Giriş yaptıktan sonra bu sayfayı yenileyin.',
      trial: 'Giriş yap',
      brakeTitle: 'Yoğunluk nedeniyle şu an yalnızca önbellekteki veriler gösteriliyor, birazdan tekrar deneyin',
      usage: 'Bugün: {used} / {limit} araştırma',
    },
    en: {
      userTitle: 'Daily research limit reached',
      userSub: 'Resets at 00:00 tomorrow.',
      upgrade: 'Upgrade plan',
      signedOutTitle: 'Sign in to your KolayXport account',
      signedOutSub: 'Research data is shown with your KolayXport account. Refresh this page after signing in.',
      trial: 'Sign in',
      brakeTitle: 'High demand: only cached data is shown right now, please try again shortly',
      usage: 'Today: {used} / {limit} lookups',
    },
  };

  function t(key, vars) {
    var l = lang();
    var s = (COPY[l] && COPY[l][key]) || COPY.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }

  /** The 429 limit payload inside a background response / error, or null. */
  function fromResponse(resp) {
    if (!resp || typeof resp !== 'object') return null;
    var body = resp.limit && typeof resp.limit === 'object' ? resp.limit : resp;
    if (body.error !== 'research_limit' || !REASONS[body.reason]) return null;
    return body;
  }

  function fromError(err) {
    return (err && err.limitInfo) || null;
  }

  function signedOutInfo() {
    return { error: 'research_limit', reason: 'signed_out', limit: 0, used: 0, resetAt: null, upgradeUrl: SIGNUP_URL };
  }

  function safeUrl(info) {
    var u = info && typeof info.upgradeUrl === 'string' ? info.upgradeUrl : '';
    if (/^https:\/\/(www\.)?kolayxport\.com\//.test(u)) return u;
    return info && info.reason === 'signed_out' ? SIGNUP_URL : UPGRADE_URL;
  }

  function openUrl(url) {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) { chrome.tabs.create({ url: url }); return; }
    } catch (_) { /* content scripts have no chrome.tabs */ }
    window.open(url, '_blank', 'noopener');
  }

  function track(info, surface) {
    try {
      chrome.runtime.sendMessage({
        type: 'kx_telemetry_event',
        event: 'research_upgrade_click',
        reason: info && info.reason,
        surface: surface,
      }, function () { void (chrome.runtime && chrome.runtime.lastError); });
    } catch (_) { /* best effort */ }
  }

  function node(doc, tag, text, style) {
    var n = doc.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (style) n.style.cssText = style;
    return n;
  }

  /**
   * The card element. `opts.surface` names the overlay for telemetry
   * (etsy_search, etsy_listing, etsy_shop, ebay_search, ebay_listing, amazon_search, amazon_listing, popup).
   */
  function buildCard(info, opts) {
    opts = opts || {};
    var doc = opts.document || document;
    var reason = (info && info.reason) || 'user_daily';
    var card = node(doc, 'div', null,
      'all:initial;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-sizing:border-box;width:100%;' +
      'background:#fff;color:#0B1220;border:1px solid rgba(11,18,32,.12);border-left:4px solid #2F5BFF;border-radius:12px;' +
      'padding:10px 14px;font:13px/1.45 ' + FONT + ';');
    card.className = 'kx-limit-card';
    card.setAttribute('data-kx-limit', reason);
    card.setAttribute('role', 'status');

    var UI = typeof window !== 'undefined' && window.__KX_UI;
    if (UI && UI.mark) {
      var m = UI.mark(doc, false);
      m.style.cssText = 'display:inline-flex;flex:0 0 auto;width:22px;height:20px;line-height:0;';
      card.appendChild(m);
    } else {
      card.appendChild(node(doc, 'span', 'KX',
        'font-size:10px;font-weight:800;background:#0B1220;color:#fff;padding:2px 6px;border-radius:4px;'));
    }

    var text = node(doc, 'div', null, 'display:flex;flex-direction:column;flex:1 1 220px;min-width:0;');
    var title;
    var sub = null;
    var button = null;
    if (reason === 'global_brake') {
      title = t('brakeTitle');
    } else if (reason === 'signed_out') {
      title = t('signedOutTitle');
      sub = t('signedOutSub');
      button = t('trial');
    } else {
      title = t('userTitle');
      sub = t('userSub');
      if (info && Number(info.limit) > 0) sub += ' ' + t('usage', { used: Math.min(Number(info.used) || 0, Number(info.limit)), limit: info.limit });
      // upgradeUrl: null = no upgrade offer (Shopify-connected accounts): neutral "resets tomorrow" only.
      button = info && info.upgradeUrl === null ? null : t('upgrade');
    }
    var titleEl = node(doc, 'span', title, 'font-weight:700;color:#0B1220;');
    titleEl.className = 'kx-limit-title';
    text.appendChild(titleEl);
    if (sub) {
      var subEl = node(doc, 'span', sub, 'font-size:12px;color:#3A465A;');
      subEl.className = 'kx-limit-sub';
      text.appendChild(subEl);
    }
    card.appendChild(text);

    if (button) {
      var btn = node(doc, 'button', button,
        'all:initial;cursor:pointer;font:600 12px ' + FONT + ';' +
        'color:#fff;background:#2F5BFF;padding:7px 14px;border-radius:999px;');
      btn.className = 'kx-limit-upgrade';
      btn.type = 'button';
      // all:initial drops the browser focus ring: draw our own for keyboard users.
      btn.addEventListener('focus', function () { btn.style.outline = '2px solid #0B1220'; btn.style.outlineOffset = '2px'; });
      btn.addEventListener('blur', function () { btn.style.outline = 'none'; });
      var url = safeUrl(info);
      btn.addEventListener('click', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        track(info, opts.surface || 'unknown');
        openUrl(url);
      });
      card.appendChild(btn);
    }
    return card;
  }

  /** Replace `container`'s content with the card. */
  function render(container, info, opts) {
    if (!container) return null;
    var card = buildCard(info, Object.assign({ document: container.ownerDocument || document }, opts || {}));
    container.textContent = '';
    // Lets a dark top bar (lib/ui.js) drop its own background behind the white card.
    try { container.setAttribute('data-kx-limited', (info && info.reason) || 'user_daily'); } catch (_) { /* ignore */ }
    container.appendChild(card);
    return card;
  }

  // Page-view id: one per URL, so all research calls of a page view share it.
  var pv = { href: null, id: null };
  function pageViewId() {
    var href = '';
    try { href = location.href; } catch (_) { /* popup */ }
    if (pv.href !== href || !pv.id) {
      var rnd = '';
      try {
        var a = new Uint8Array(12);
        crypto.getRandomValues(a);
        for (var i = 0; i < a.length; i++) rnd += ('0' + a[i].toString(16)).slice(-2);
      } catch (_) {
        rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      }
      pv = { href: href, id: 'pv' + rnd };
    }
    return pv.id;
  }

  /** Error for a failed background response, carrying the limit payload (err.limitInfo) and HTTP status. */
  function toError(response) {
    var err = new Error((response && response.error) || 'error');
    err.status = response && response.status;
    var info = fromResponse(response);
    if (info) err.limitInfo = info;
    return err;
  }

  var api = {
    fromResponse: fromResponse,
    fromError: fromError,
    signedOutInfo: signedOutInfo,
    buildCard: buildCard,
    render: render,
    pageViewId: pageViewId,
    toError: toError,
    t: t,
    get lang() { return lang(); },
    UPGRADE_URL: UPGRADE_URL,
    SIGNUP_URL: SIGNUP_URL,
  };
  if (typeof window !== 'undefined') window.__KX_LIMIT = api;
})();

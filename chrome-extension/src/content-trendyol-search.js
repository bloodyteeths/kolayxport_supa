/**
 * KolayXport Research — Trendyol search page reader.
 *
 * Trendyol blocks servers (403) on search and category pages, so KolayXport never fetches them. When the seller
 * opens a Trendyol search in their own browser, this script reads the data the page already holds
 * (`window["__single-search-result__PROPS"]`, embedded as a <script> tag): total results and, per product, price,
 * brand, seller, rating, favorites, Trendyol's own order badge and the sponsored flag. It shows a small summary panel
 * and, on "Analyse in KolayXport" (automatically when KolayXport opened the tab with `kx=1`), posts the snapshot to
 * /api/research/snapshot via the background worker. Read-only on Trendyol: it never clicks, types or changes anything.
 */
(function () {
  'use strict';

  var PROPS_PREFIX = 'window["__single-search-result__PROPS"]=';
  var lang = window.__KX_LANG;
  var T = {
    tr: {
      title: 'KolayXport', products: '{n} ürün okundu', total: 'Trendyol\'da {n} sonuç', median: 'Ortanca fiyat {p}',
      cta: 'KolayXport\'ta analiz et', sending: 'Gönderiliyor…', sent: 'Analiz KolayXport\'a gönderildi ✓', open: 'KolayXport\'ta aç',
      signin: 'KolayXport\'a giriş yapın (eklenti simgesi)', failed: 'Gönderilemedi, tekrar deneyin', none: 'Bu sayfada okunacak ürün bulunamadı',
    },
    en: {
      title: 'KolayXport', products: '{n} products read', total: '{n} results on Trendyol', median: 'Median price {p}',
      cta: 'Analyse in KolayXport', sending: 'Sending…', sent: 'Sent to KolayXport ✓', open: 'Open in KolayXport',
      signin: 'Sign in to KolayXport (extension icon)', failed: 'Could not send, try again', none: 'No products to read on this page',
    },
  };
  function t(key, params) {
    var l = (lang && lang.get && lang.get()) || 'tr';
    var s = (T[l] || T.tr)[key] || key;
    Object.keys(params || {}).forEach(function (k) { s = s.replace('{' + k + '}', params[k]); });
    return s;
  }

  /** Pure: the search PROPS object from the page's script tags, or null. */
  function readProps(doc) {
    var scripts = doc.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var txt = scripts[i].textContent || '';
      var at = txt.indexOf(PROPS_PREFIX);
      if (at === -1) continue;
      var json = txt.slice(at + PROPS_PREFIX.length).trim().replace(/;\s*$/, '');
      try { return JSON.parse(json); } catch (_) { return null; }
    }
    return null;
  }

  function socialValue(list, key) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return String(list[i].value);
    return null;
  }

  /** Pure: snapshot payload from PROPS (shape of /api/research/snapshot). */
  function toSnapshot(props, query) {
    var data = props && props.data;
    var products = (data && Array.isArray(data.products)) ? data.products : [];
    var items = products.slice(0, 120).map(function (p) {
      var price = p.price && typeof p.price.current === 'number' ? p.price.current
        : (p.singlePrice && typeof p.singlePrice.salePriceNumeric === 'number' ? p.singlePrice.salePriceNumeric : null);
      var url = typeof p.url === 'string' ? p.url : null;
      return {
        id: String(p.id || p.contentId || ''),
        title: p.name || '',
        url: url ? (url.indexOf('http') === 0 ? url : 'https://www.trendyol.com' + url) : null,
        thumbUrl: p.image || (Array.isArray(p.images) ? p.images[0] : null) || null,
        price: price,
        brand: p.brand || null,
        sellerId: p.merchantId != null ? String(p.merchantId) : null,
        favorites: socialValue(p.socialProof, 'favoriteCount'),
        orderBadge: socialValue(p.socialProof, 'orderCount'),
        rating: p.ratingScore && typeof p.ratingScore.averageRating === 'number' ? p.ratingScore.averageRating : null,
        ratingCount: p.ratingScore && typeof p.ratingScore.totalCount === 'number' ? p.ratingScore.totalCount : null,
        sponsored: p.cardType === 'ADS' || !!(p.advert && p.advert.advertId),
        category: p.category && p.category.name ? p.category.name : null,
      };
    }).filter(function (i) { return i.id; });
    return { mkt: 'trendyol', query: query, total: data && typeof data.total === 'number' ? data.total : null, items: items };
  }

  function median(nums) {
    var a = nums.filter(function (n) { return typeof n === 'number' && n > 0; }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function queryOf() {
    var u = new URL(window.location.href);
    return (u.searchParams.get('q') || '').trim();
  }

  var panel = null;
  function render(state) {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'kx-trendyol-panel';
      panel.setAttribute('style', [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000', 'width:280px', 'max-width:calc(100vw - 32px)',
        'background:#fff', 'border:1px solid #E2E8F0', 'border-radius:12px', 'box-shadow:0 8px 24px rgba(15,23,42,.18)',
        'font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif', 'color:#0F172A', 'padding:12px 14px',
      ].join(';'));
      document.body.appendChild(panel);
    }
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
    var html = '<div style="font-weight:700;margin-bottom:6px">' + esc(t('title')) + '</div>';
    (state.lines || []).forEach(function (l) { html += '<div>' + esc(l) + '</div>'; });
    if (state.note) html += '<div style="margin-top:6px;color:' + (state.ok ? '#15803D' : '#B45309') + '">' + esc(state.note) + '</div>';
    if (state.button) html += '<button id="kx-ty-cta" style="margin-top:10px;width:100%;height:36px;border:0;border-radius:8px;background:#2563EB;color:#fff;font-weight:600;cursor:pointer">' + esc(state.button) + '</button>';
    panel.innerHTML = html;
    var btn = panel.querySelector('#kx-ty-cta');
    if (btn && state.onClick) btn.addEventListener('click', state.onClick);
  }

  function send(snapshot, lines) {
    render({ lines: lines, note: t('sending') });
    try {
      chrome.runtime.sendMessage({ type: 'kx_market_snapshot', params: snapshot }, function (res) {
        if (chrome.runtime.lastError || !res) return render({ lines: lines, note: t('failed'), button: t('cta'), onClick: function () { send(snapshot, lines); } });
        if (res.error) {
          var note = res.status === 401 ? t('signin') : t('failed');
          return render({ lines: lines, note: note, button: t('cta'), onClick: function () { send(snapshot, lines); } });
        }
        var href = 'https://kolayxport.com' + (res.href || ('/app/research/products?mkt=trendyol&q=' + encodeURIComponent(snapshot.query)));
        render({ lines: lines, ok: true, note: t('sent'), button: t('open'), onClick: function () { window.open(href, '_blank'); } });
      });
    } catch (_) {
      render({ lines: lines, note: t('failed') });
    }
  }

  var lastKey = '';
  function run() {
    var q = queryOf();
    if (!q) return;
    var props = readProps(document);
    if (!props) return;
    // Results swapped in place for another query keep the old embedded data: never send it under the new query.
    var rawQ = props.data && props.data.query;
    var propsQuery = typeof rawQ === 'string' ? rawQ : (rawQ && typeof rawQ.q === 'string' ? rawQ.q : null);
    propsQuery = propsQuery ? propsQuery.trim().toLowerCase() : null;
    if (propsQuery && propsQuery !== q.toLowerCase()) return;
    var snapshot = toSnapshot(props, q);
    var key = q + '|' + snapshot.items.length;
    if (key === lastKey) return;
    lastKey = key;
    if (snapshot.items.length < 5) return render({ lines: [], note: t('none') });
    var organic = snapshot.items.filter(function (i) { return !i.sponsored; });
    var med = median(organic.map(function (i) { return i.price; }));
    var fmt = new Intl.NumberFormat((lang && lang.locale && lang.locale()) || 'tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
    var lines = [t('products', { n: snapshot.items.length })];
    if (snapshot.total != null) lines.push(t('total', { n: new Intl.NumberFormat('tr-TR').format(snapshot.total) }));
    if (med != null) lines.push(t('median', { p: fmt.format(med) }));
    var auto = new URL(window.location.href).searchParams.get('kx') === '1';
    if (auto) return send(snapshot, lines);
    render({ lines: lines, button: t('cta'), onClick: function () { send(snapshot, lines); } });
  }

  function start() {
    run();
    // Trendyol changes results in place (filters, sort, new query) without a full page load.
    var last = window.location.href;
    setInterval(function () {
      if (window.location.href !== last) { last = window.location.href; lastKey = ''; setTimeout(run, 1200); }
    }, 1000);
  }

  window.__kxTrendyol = { readProps: readProps, toSnapshot: toSnapshot };
  if (lang && lang.ready) lang.ready.then(start); else start();
})();

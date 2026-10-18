/**
 * KolayXport Research — Trendyol & Hepsiburada overlays.
 *
 * Registered at runtime (background-simple.js) only after the seller enabled these marketplaces in the popup and
 * agreed to share what their pages show. On a search / category page: a summary bar + a line under every product
 * card. On a product page: a panel with sales per day, revenue per day, rating growth, baskets, favorites, 24 h
 * views, the buybox (every seller and price) and the keywords the product ranks for. On a store page: the store's
 * sales and revenue per day over the products KolayXport has seen.
 *
 * Data: lib/marketReader.js reads the page; the reading goes to /api/market/observe (shared, anonymous) when
 * sharing is on; numbers over time come from /api/market/read (give-to-get). Sales follow lib/market/sales.ts on
 * the server: rating growth is measured; sales and revenue are estimates (rating growth × orders per rating
 * calibrated from connected stores) and say so. Read-only on the marketplace; everything is DOM-built and data
 * only ever goes into textContent.
 */
(function () {
  'use strict';

  if (window.__kxMarketOverlay) return;
  window.__kxMarketOverlay = true;

  var R = window.__kxMarketReader;
  var U = window.__KX_UI;
  var L = window.__KX_LANG;
  if (!R || !U) return;

  var MKT = /(^|\.)hepsiburada\.com$/.test(location.hostname) ? 'hepsiburada' : 'trendyol';
  var MKT_NAME = MKT === 'hepsiburada' ? 'Hepsiburada' : 'Trendyol';

  var COPY = {
    tr: {
      results: 'Sonuç', typical: 'Tipik fiyat', range: 'Fiyat aralığı', ads: 'Reklam', top5: 'İlk 5 satıcı payı',
      pageSales: 'Sayfa satışı/gün', pageRevenue: 'Sayfa cirosu/gün', measuredOf: '{n}/{m} ürün ölçüldü',
      perDay: '{n} satış/gün', revDay: '{v}/gün', ratingsMonth: '+{n} değerlendirme/ay', firstSeen: 'Ölçülüyor: satış hızı birkaç saat/gün içinde',
      orders: '{n} sipariş', lifetimeLine: '~{n} toplam satış', fav: '♥ {n}', analyse: 'KolayXport’ta analiz et', storeTitle: '{name} mağazası',
      salesDay: 'Satış/gün', revenueDay: 'Ciro/gün', ratingGrowth: 'Değerlendirme artışı', baskets: 'Sepette', favorites: 'Favori',
      views24: 'Görüntülenme (24 saat)', sellers: 'Satıcı sayısı', lifetime: 'Toplam satış', priceChange: 'Fiyat değişimi',
      buybox: 'Satıcılar ve fiyatlar', buyboxHolder: 'Buybox', buyboxOpen: 'Tüm satıcıları görmek için “Tüm satıcıları göster”e tıklayın.',
      keywords: 'Sıralandığı aramalar', rank: '{n}. sıra', noKeywords: 'Henüz bu ürünün çıktığı bir arama okunmadı.',
      productsSeen: 'Görülen ürün', totalRatings: 'Toplam değerlendirme', score: 'Mağaza puanı', followers: 'Takipçi',
      gated: 'Topluluk verisi için eklentide paylaşımı açın.', signin: 'KolayXport’a giriş yapın (eklenti simgesi).',
      noCalibration: 'Satış tahmini, bağlı mağazaların gerçek siparişleriyle kalibre edilince görünür. Şimdilik ölçülen değerlendirme hızı.',
      plainSales: 'Tahmini günlük satış: son 60 gündeki değerlendirme artışı × bağlı KolayXport mağazalarının gerçek siparişlerinden hesaplanan sipariş/değerlendirme oranı.',
      plainRevenue: 'Tahmini günlük satış × bugünkü fiyat.',
      plainRatings: 'Ölçülen: ürünün herkese açık değerlendirme sayısının KolayXport okumaları arasındaki artışı.',
      plainOnPage: 'Bu sayfanın kendisinde gösterilen bilgiler.',
      plainPageSales: 'Bu sayfadaki ürünlerin tahmini günlük satışlarının toplamı (ölçülen ürünler).',
      srcPage: '{mkt} sayfası', srcCrowd: 'KolayXport topluluk okumaları', srcCal: '{src} kalibrasyonu ({n} değerlendirme)',
    },
    en: {
      results: 'Results', typical: 'Typical price', range: 'Price range', ads: 'Ads', top5: 'Top-5 seller share',
      pageSales: 'Page sales/day', pageRevenue: 'Page revenue/day', measuredOf: '{n}/{m} products measured',
      perDay: '{n} sales/day', revDay: '{v}/day', ratingsMonth: '+{n} ratings/month', firstSeen: 'Measuring: sales speed within hours/days',
      orders: '{n} orders', lifetimeLine: '~{n} sales in total', fav: '♥ {n}', analyse: 'Analyse in KolayXport', storeTitle: '{name} store',
      salesDay: 'Sales/day', revenueDay: 'Revenue/day', ratingGrowth: 'Rating growth', baskets: 'In baskets', favorites: 'Favorites',
      views24: 'Views (24 h)', sellers: 'Sellers', lifetime: 'Lifetime sales', priceChange: 'Price change',
      buybox: 'Sellers and prices', buyboxHolder: 'Buybox', buyboxOpen: 'Click “Show all sellers” to read every seller.',
      keywords: 'Searches it ranks for', rank: '#{n}', noKeywords: 'No search this product shows up in has been read yet.',
      productsSeen: 'Products seen', totalRatings: 'Total ratings', score: 'Store score', followers: 'Followers',
      gated: 'Turn on sharing in the extension for community data.', signin: 'Sign in to KolayXport (extension icon).',
      noCalibration: 'Sales estimates appear once calibrated with connected stores’ real orders. For now: measured rating speed.',
      plainSales: 'Estimated sales per day: rating growth over the last 60 days × orders per rating, calibrated from connected KolayXport stores’ real orders.',
      plainRevenue: 'Estimated sales per day × today’s price.',
      plainRatings: 'Measured: growth of the product’s public rating count between KolayXport readings.',
      plainOnPage: 'Shown on this page itself.',
      plainPageSales: 'Sum of the estimated daily sales of the products on this page (measured ones).',
      srcPage: '{mkt} page', srcCrowd: 'KolayXport community readings', srcCal: '{src} calibration ({n} ratings)',
    },
  };
  function lang() { return (L && L.get && L.get()) || 'tr'; }
  function t(k, p) {
    var s = (COPY[lang()] || COPY.tr)[k] || COPY.tr[k] || k;
    Object.keys(p || {}).forEach(function (x) { s = s.split('{' + x + '}').join(String(p[x])); });
    return s;
  }
  function loc() { return lang() === 'en' ? 'en-US' : 'tr-TR'; }
  function num(n, d) { return n == null ? '—' : new Intl.NumberFormat(loc(), { maximumFractionDigits: d == null ? 0 : d }).format(n); }
  function tl(n) { return n == null ? '—' : new Intl.NumberFormat(loc(), { style: 'currency', currency: 'TRY', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(n); }
  function short(n) { return n == null ? '—' : new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(n); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function median(a) { var s = a.filter(function (x) { return x != null && x > 0; }).sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : null; }
  function pct(a, p) { var s = a.filter(function (x) { return x != null && x > 0; }).sort(function (x, y) { return x - y; }); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; }
  var SRC_PAGE = function () { return t('srcPage', { mkt: MKT_NAME }); };

  function send(type, params) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: type, params: params }, function (res) {
          if (chrome.runtime.lastError) return resolve({ error: 'runtime' });
          resolve(res || { error: 'empty' });
        });
      } catch (_) { resolve({ error: 'runtime' }); }
    });
  }
  function shareOn() {
    return new Promise(function (resolve) {
      try { chrome.storage.local.get(['kx_market_share', 'kx_overlays_enabled'], function (r) { resolve({ share: r.kx_market_share !== false, overlays: r.kx_overlays_enabled !== false }); }); }
      catch (_) { resolve({ share: false, overlays: true }); }
    });
  }

  U.ensureStyles(document);
  // Buybox and keyword rows in the product panel (scoped under .kx-ui like lib/ui.js).
  if (!document.getElementById('kx-mkt-css')) {
    var css = el('style');
    css.id = 'kx-mkt-css';
    css.textContent = [
      '.kx-ui .kx-panel-sub { margin: 10px 0 4px; font-size: 11px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--kx-ink-soft); }',
      '.kx-ui .kx-offers { display: grid; gap: 2px; }',
      '.kx-ui .kx-offer { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 18px; }',
      '.kx-ui .kx-offer-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.kx-ui .kx-offer-price { flex: 0 0 auto; font-weight: 700; font-variant-numeric: tabular-nums; }',
      '.kx-ui .kx-offer .kx-tag, .kx-ui.kx-strip .kx-tag { display: inline-block; padding: 0 5px; border-radius: 4px; background: rgba(11,18,32,.07); font-size: 10px; font-weight: 700; line-height: 15px; }',
      '.kx-ui.kx-strip.kx-mkt-strip { margin-top: 4px; }',
    ].join('\n');
    (document.head || document.documentElement).appendChild(css);
  }

  // ---------------------------------------------------------------------------
  // Card lines (search, category and store grids)
  // ---------------------------------------------------------------------------
  function cardLine(item, card, gated) {
    var parts = [];
    var s = card && card.sales;
    if (!gated && s && s.salesPerDay != null) {
      parts.push(t('perDay', { n: num(s.salesPerDay, s.salesPerDay < 10 ? 1 : 0) }));
      if (s.revenuePerDay != null) parts.push(t('revDay', { v: tl(s.revenuePerDay) }));
    } else if (!gated && s && s.ratingsPer30d != null) {
      parts.push(t('ratingsMonth', { n: num(s.ratingsPer30d, 1) }));
    } else if (!gated && s && s.lifetimeSales != null) {
      // Not enough readings for a speed yet: the estimated total (ratings × orders per rating) is still a number.
      parts.push(t('lifetimeLine', { n: short(s.lifetimeSales) }));
    } else if (!gated && card) {
      parts.push(t('firstSeen'));
    }
    var fav = typeof item.favorites === 'number' ? item.favorites : R.compact(item.favorites);
    if (fav != null) parts.push(t('fav', { n: short(fav) }));
    if (item.orderBadge) parts.push(t('orders', { n: item.orderBadge }));
    return parts;
  }

  function cardAnchors() {
    if (MKT === 'trendyol') return document.querySelectorAll('a.product-card, a[data-testid="product-card"]');
    // Hepsiburada cards have several links (image, name): one per card, the card link.
    var links = document.querySelectorAll('a[class*="productCardLink"]');
    return links.length ? links : document.querySelectorAll('li[class*="productListContent"] article a[href*="-pm-"], li[class*="productListContent"] article a[href*="-p-"]');
  }
  function idOfAnchor(a) {
    var href = a.getAttribute('href') || '';
    var m = MKT === 'trendyol' ? href.match(/-p-(\d+)/) : href.match(/-p(?:m)?-([A-Za-z0-9]+)(?:[?#]|$)/);
    return m ? m[1] : null;
  }

  function renderStrips(items, cards, gated) {
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; if (i.altId) byId[i.altId] = i; });
    var cById = {};
    (cards || []).forEach(function (c) { cById[c.id] = c; });
    var seenCard = {};
    var anchors = cardAnchors();
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var id = idOfAnchor(a);
      if (!id || !byId[id]) continue;
      var item = byId[id];
      if (seenCard[item.id]) continue;
      seenCard[item.id] = 1;
      id = item.id;
      var row = a.querySelector('.kx-mkt-strip');
      if (!row) { row = el('div', 'kx-mkt-strip'); a.appendChild(row); }
      U.strip(row);
      row.lang = lang();
      row.textContent = '';
      row.appendChild(U.mark(document, false));
      var parts = cardLine(byId[id], cById[id], gated);
      parts.forEach(function (p, n) {
        if (n) row.appendChild(el('span', 'kx-sep', '·'));
        row.appendChild(el('span', n === 0 ? 'kx-strong' : null, p));
      });
      if (byId[id].sponsored) row.appendChild(el('span', 'kx-tag', t('ads')));
    }
  }

  function calNote(cal) {
    return cal ? t('srcCal', { src: cal.source, n: num(cal.n) }) : t('noCalibration');
  }

  // ---------------------------------------------------------------------------
  // Search / category page
  // ---------------------------------------------------------------------------
  function barHost() {
    var id = 'kx-mkt-bar';
    var bar = document.getElementById(id);
    if (bar) return bar;
    var firstCard = cardAnchors()[0];
    var list = firstCard && (firstCard.closest('[class*="search-result-content"], [class*="productList"], ul, [data-testid="product-list"]') || firstCard.parentElement);
    if (!list || !list.parentElement) return null;
    bar = el('div', 'kx-stats-bar');
    bar.id = id;
    list.parentElement.insertBefore(bar, list);
    return bar;
  }

  function renderSearch(obs, read) {
    var bar = barHost();
    var items = obs.items;
    var organic = items.filter(function (i) { return !i.sponsored; });
    var prices = organic.map(function (i) { return i.price; });
    var ads = items.length - organic.length;
    var sellers = {};
    organic.forEach(function (i) { if (i.sellerId) sellers[i.sellerId] = (sellers[i.sellerId] || 0) + 1; });
    var counts = Object.keys(sellers).map(function (k) { return sellers[k]; }).sort(function (a, b) { return b - a; });
    var top5 = organic.length >= 10 ? counts.slice(0, 5).reduce(function (s, v) { return s + v; }, 0) / organic.length : null;
    var gated = !read || read.gated || read.error;
    var cards = read && read.cards || [];
    var measured = cards.filter(function (c) { return c.sales && c.sales.salesPerDay != null; });
    var salesSum = measured.length ? measured.reduce(function (s, c) { return s + c.sales.salesPerDay; }, 0) : null;
    var revSum = measured.length ? measured.reduce(function (s, c) { return s + (c.sales.revenuePerDay || 0); }, 0) : null;
    var cal = cards.length && cards[0].sales ? cards[0].sales.calibration : null;

    if (bar) {
      var chip = function (o) { return U.chip(document, o); };
      var chips = [
        chip({ key: 'total', label: t('results'), value: obs.total != null ? num(obs.total) : '—', info: { plain: t('plainOnPage'), source: SRC_PAGE(), confidence: 'exact' } }),
        chip({ key: 'price', label: t('typical'), value: tl(median(prices)), info: { plain: t('plainOnPage'), source: SRC_PAGE(), confidence: prices.length >= 10 ? 'high' : 'medium' } }),
        chip({ key: 'range', label: t('range'), value: prices.length ? tl(pct(prices, 0.25)) + ' – ' + tl(pct(prices, 0.75)) : '—' }),
        chip({ key: 'sales', label: t('pageSales'), est: true, value: gated ? '—' : salesSum != null ? num(salesSum, 1) : '—',
          info: { plain: t('plainPageSales'), formula: t('measuredOf', { n: measured.length, m: organic.length }) + '. ' + calNote(cal), source: [SRC_PAGE(), t('srcCrowd')], confidence: measured.length >= 10 ? 'medium' : 'low' } }),
        chip({ key: 'revenue', label: t('pageRevenue'), est: true, value: gated || revSum == null ? '—' : tl(revSum), info: { plain: t('plainRevenue'), source: t('srcCrowd'), confidence: 'low' } }),
      ];
      var more = [
        chip({ key: 'ads', label: t('ads'), value: ads + '/' + items.length }),
        chip({ key: 'top5', label: t('top5'), value: top5 != null ? Math.round(top5 * 100) + '%' : '—' }),
        U.note(document, t('measuredOf', { n: measured.length, m: organic.length })),
        U.note(document, gated ? (read && read.status === 401 ? t('signin') : t('gated')) : calNote(cal)),
      ];
      var q = obs.query || '';
      U.topBar(bar, {
        title: q ? '“' + q + '”' : MKT_NAME,
        chips: chips,
        more: more,
        state: 'full',
        link: { href: 'https://kolayxport.com/app/research/products?mkt=' + MKT + (q ? '&q=' + encodeURIComponent(q) : ''), text: t('analyse') },
      });
    }
    renderStrips(items, cards, gated);
  }

  // ---------------------------------------------------------------------------
  // Product page
  // ---------------------------------------------------------------------------
  function panelHost() {
    var id = 'kx-mkt-panel';
    var p = document.getElementById(id);
    if (p) return p;
    p = el('div');
    p.id = id;
    var h1 = document.querySelector('h1');
    var anchor = h1 && (h1.closest('[class*="product-detail"], [class*="product-info"], [class*="productDetail"], section') || h1.parentElement);
    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(p, anchor.nextSibling);
    else { p.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;width:340px;max-width:calc(100vw - 32px)'; document.body.appendChild(p); }
    return p;
  }

  function renderProduct(obs, read) {
    var host = panelHost();
    var p = obs.product;
    var gated = !read || read.gated || read.error;
    var s = !gated && read && read.sales;
    var cal = s ? s.calibration : null;
    var body = U.panel(host, { title: 'KolayXport · ' + MKT_NAME });
    var grid = el('div', 'kx-metrics-grid');
    var m = function (o) { grid.appendChild(U.metric(document, o)); };
    m({ key: 'sales', label: t('salesDay'), est: true, value: s && s.salesPerDay != null ? num(s.salesPerDay, s.salesPerDay < 10 ? 1 : 0) : '—', info: { plain: t('plainSales'), formula: calNote(cal), source: t('srcCrowd'), confidence: cal && cal.n >= 200 ? 'medium' : 'low' } });
    m({ key: 'revenue', label: t('revenueDay'), est: true, value: s && s.revenuePerDay != null ? tl(s.revenuePerDay) : '—', info: { plain: t('plainRevenue'), source: t('srcCrowd'), confidence: 'low' } });
    m({ key: 'ratings', label: t('ratingGrowth'), value: s && s.ratingsPer30d != null ? t('ratingsMonth', { n: num(s.ratingsPer30d, 1) }) : (gated ? '—' : t('firstSeen')), info: { plain: t('plainRatings'), source: t('srcCrowd'), confidence: s && s.spanDays >= 14 ? 'high' : 'medium' } });
    if (s && s.lifetimeSales != null) m({ key: 'lifetime', label: t('lifetime'), est: true, value: num(s.lifetimeSales), info: { plain: t('plainSales'), formula: calNote(cal), source: t('srcCrowd'), confidence: 'low' } });
    if (p.basketCount != null) m({ key: 'baskets', label: t('baskets'), value: short(p.basketCount), info: { plain: t('plainOnPage'), source: SRC_PAGE(), confidence: 'exact' } });
    if (p.favorites != null) m({ key: 'favorites', label: t('favorites'), value: short(p.favorites), info: { plain: t('plainOnPage'), source: SRC_PAGE(), confidence: 'exact' } });
    if (p.viewCount != null) m({ key: 'views', label: t('views24'), value: short(p.viewCount), info: { plain: t('plainOnPage'), source: SRC_PAGE(), confidence: 'exact' } });
    if (p.otherSellerCount != null) m({ key: 'sellers', label: t('sellers'), value: num(p.otherSellerCount + 1) });
    if (read && read.priceChange != null) m({ key: 'price', label: t('priceChange'), value: (read.priceChange > 0 ? '+' : '') + Math.round(read.priceChange * 100) + '%' });
    body.appendChild(grid);

    // Buybox: this page's offers (all of them once the seller opened "Tüm satıcıları göster").
    var offers = (p.offers || []).slice();
    if (offers.length) {
      body.appendChild(el('div', 'kx-panel-sub', t('buybox')));
      var list = el('div', 'kx-offers');
      offers.sort(function (a, b) { return (a.price || 1e12) - (b.price || 1e12); }).slice(0, 8).forEach(function (o) {
        var row = el('div', 'kx-offer');
        row.appendChild(el('span', 'kx-offer-name', (o.name || o.sellerId) + (o.score != null ? ' · ' + num(o.score, 1) : '')));
        row.appendChild(el('span', 'kx-offer-price', tl(o.price)));
        if (o.buybox) row.appendChild(el('span', 'kx-tag', t('buyboxHolder')));
        list.appendChild(row);
      });
      body.appendChild(list);
      if (p.otherSellerCount && offers.length <= 1) body.appendChild(U.note(document, t('buyboxOpen')));
    }

    if (!gated && read && Array.isArray(read.keywords)) {
      body.appendChild(el('div', 'kx-panel-sub', t('keywords')));
      if (!read.keywords.length) body.appendChild(U.note(document, t('noKeywords')));
      read.keywords.slice(0, 6).forEach(function (k) {
        var row = el('div', 'kx-offer');
        row.appendChild(el('span', 'kx-offer-name', k.query));
        row.appendChild(el('span', 'kx-offer-price', t('rank', { n: k.rank })));
        body.appendChild(row);
      });
    }
    body.appendChild(U.note(document, gated ? (read && read.status === 401 ? t('signin') : t('gated')) : calNote(cal)));
  }

  // ---------------------------------------------------------------------------
  // Store page
  // ---------------------------------------------------------------------------
  function renderStore(obs, read) {
    var bar = barHost();
    var st = obs.store || {};
    var gated = !read || read.gated || read.error;
    var r = !gated ? read : null;
    if (bar) {
      var chip = function (o) { return U.chip(document, o); };
      U.topBar(bar, {
        title: t('storeTitle', { name: st.name || (r && r.seller && r.seller.name) || '' }),
        chips: [
          chip({ key: 'sales', label: t('salesDay'), est: true, value: r && r.salesPerDay != null ? num(r.salesPerDay, 1) : '—', info: { plain: t('plainSales'), source: t('srcCrowd'), confidence: 'low' } }),
          chip({ key: 'revenue', label: t('revenueDay'), est: true, value: r && r.revenuePerDay != null ? tl(r.revenuePerDay) : '—', info: { plain: t('plainRevenue'), source: t('srcCrowd'), confidence: 'low' } }),
          chip({ key: 'score', label: t('score'), value: st.score != null ? num(st.score, 1) : '—' }),
          chip({ key: 'followers', label: t('followers'), value: st.followers || '—' }),
          chip({ key: 'seen', label: t('productsSeen'), value: r ? num(r.productsSeen) + (st.productCount ? '/' + num(st.productCount) : '') : (st.productCount ? num(st.productCount) : '—') }),
        ],
        more: [
          chip({ key: 'ratings', label: t('ratingGrowth'), value: r && r.ratingsPer30d != null ? t('ratingsMonth', { n: num(r.ratingsPer30d, 1) }) : '—' }),
          chip({ key: 'total', label: t('totalRatings'), value: r && r.totalRatings != null ? num(r.totalRatings) : '—' }),
          U.note(document, gated ? (read && read.status === 401 ? t('signin') : t('gated')) : t('plainSales')),
        ],
        state: 'full',
      });
    }
    renderStrips(obs.items || [], null, true);
  }

  // ---------------------------------------------------------------------------
  // Flow: read the page → share (when on) → ask for the numbers over time → render
  // ---------------------------------------------------------------------------
  var lastKey = '';
  var busy = false;

  function readPage() {
    var type = MKT === 'trendyol' ? R.trendyolPageType(location.href) : R.hepsiburadaPageType(location.href);
    if (!type) return null;
    if (MKT === 'trendyol') {
      if (type === 'search') return R.trendyolSearch(document, location.href);
      if (type === 'store') return R.trendyolStore(document, location.href);
      return R.trendyolProduct(document, location.href, socialTexts);
    }
    if (type === 'search') return R.hepsiburadaSearch(document, location.href);
    if (type === 'product') return R.hepsiburadaProduct(document, location.href);
    return null;
  }

  // Trendyol's social-proof line rotates (baskets → favorites → 24 h views): collect what it shows for a while.
  var socialTexts = [];
  function watchSocialProof(ms) {
    return new Promise(function (resolve) {
      var end = Date.now() + ms;
      (function tick() {
        var nodes = document.querySelectorAll('[class*="social-proof"]');
        for (var i = 0; i < nodes.length; i++) {
          var tx = String(nodes[i].innerText || nodes[i].textContent || '').trim();
          if (tx && socialTexts.indexOf(tx) === -1) socialTexts.push(tx);
        }
        if (Date.now() >= end) return resolve();
        setTimeout(tick, 600);
      })();
    });
  }

  async function run(force) {
    if (busy) return;
    var prefs = await shareOn();
    if (!prefs.overlays) return;
    var type = MKT === 'trendyol' ? R.trendyolPageType(location.href) : R.hepsiburadaPageType(location.href);
    if (!type) return;
    busy = true;
    try {
      if (type === 'product' && MKT === 'trendyol') { socialTexts = []; await watchSocialProof(9000); }
      var obs = readPage();
      if (!obs) return;
      var count = obs.items ? obs.items.length : obs.product ? (obs.product.offers || []).length : 0;
      var key = location.href + '|' + count;
      if (!force && key === lastKey) return;
      lastKey = key;

      if (prefs.share && (obs.items ? obs.items.length >= 5 : obs.product || obs.store)) {
        await send('kx_market_observe', obs);
        // A product page also tells us about its store (score, followers).
        if (obs.pageType === 'product' && obs.store) await send('kx_market_observe', { mkt: obs.mkt, pageType: 'store', parserVersion: obs.parserVersion, store: obs.store });
      }
      if (obs.pageType === 'search') {
        var ids = obs.items.map(function (i) { return i.id; });
        renderSearch(obs, ids.length ? await send('kx_market_read', { mkt: MKT, kind: 'cards', ids: ids }) : null);
      } else if (obs.pageType === 'product') {
        renderProduct(obs.product ? obs : { product: {} }, await send('kx_market_read', { mkt: MKT, kind: 'product', id: obs.product.id }));
      } else if (obs.pageType === 'store') {
        var read = await send('kx_market_read', { mkt: MKT, kind: 'seller', sellerId: obs.store.sellerId });
        renderStore(obs, read);
        var sIds = (obs.items || []).map(function (i) { return i.id; });
        if (sIds.length) {
          var cards = await send('kx_market_read', { mkt: MKT, kind: 'cards', ids: sIds });
          renderStrips(obs.items, cards && cards.cards, !cards || cards.gated || cards.error);
        }
      }
    } finally {
      busy = false;
    }
  }

  function start() {
    run(false);
    // Single-page navigation, infinite scroll, the "all sellers" modal: re-read when the page changes.
    var lastHref = location.href;
    var lastCards = cardAnchors().length;
    var lastOffers = document.querySelectorAll('[class*="other-merchant-item-box"]').length;
    setInterval(function () {
      var href = location.href;
      var cards = cardAnchors().length;
      var offers = document.querySelectorAll('[class*="other-merchant-item-box"]').length;
      if (href !== lastHref || cards >= lastCards + 12 || offers > lastOffers) {
        var navigated = href !== lastHref;
        lastHref = href; lastCards = cards; lastOffers = offers;
        if (navigated) { var b = document.getElementById('kx-mkt-bar'); if (b) b.remove(); var p = document.getElementById('kx-mkt-panel'); if (p) p.remove(); }
        setTimeout(function () { run(navigated); }, 1200);
      }
    }, 1500);
  }

  if (L && L.ready) L.ready.then(start); else start();
})();

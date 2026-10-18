/**
 * KolayXport Research — Etsy Listing Page
 *
 * Shows listing stats with an honest split between MEASURED numbers (real deltas
 * of Etsy's shop sold counter between snapshots) and ESTIMATES (this shop's real
 * sales-per-review ratio x this listing's recent review velocity). Every number
 * shows its inputs, confidence and data age. Real on-page Etsy signals ("N bought
 * in the last 24 hours", "In N carts", Bestseller) are shown as-is.
 * Server: POST /api/ext/listing-stats (via background worker).
 *
 * Progressive: the panel renders at once with the page's own signals (price, "bought in 24h",
 * carts, Bestseller) and placeholders. Two requests run in parallel — `phase: 'core'` (listing
 * facts: favourites, views, tags, age; one Etsy call) and the full stats (sales estimate, shop,
 * SEO) — and fill the same slots in place.
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) return;
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  // ---------------------------------------------------------------------------
  // Real signals Etsy renders on the listing page (EN + TR UI)
  // ---------------------------------------------------------------------------
  function parseIntLoose(s) {
    if (s === null || s === undefined) return null;
    const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function readJsonLdProduct() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const json = JSON.parse(script.textContent || 'null');
        const items = Array.isArray(json) ? json : (json && json['@graph']) ? json['@graph'] : [json];
        for (const it of items) {
          if (it && (it['@type'] === 'Product' || (Array.isArray(it['@type']) && it['@type'].includes('Product')))) return it;
        }
      } catch (_) { /* ignore malformed blocks */ }
    }
    return null;
  }

  function scrapePageSignals() {
    const signals = {};
    // Displayed price (sale price when the listing is on sale) beats JSON-LD; the server
    // uses it for revenue because the Etsy API price is the pre-discount list price.
    const S = window.__KX_SHARED;
    const priceRegion = document.querySelector('[data-buy-box-region="price"], [data-appears-component-name="price"], [data-selector="price-only"]');
    const shown = priceRegion && S && S.readCardPrice ? S.readCardPrice(priceRegion) : null;
    const product = readJsonLdProduct();
    const offer = product ? (Array.isArray(product.offers) ? product.offers[0] : product.offers) : null;
    const ldCurrency = offer && typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : null;
    if (shown && shown.amount > 0) {
      signals.pagePrice = shown.amount;
      signals.pageCurrency = shown.currency || ldCurrency;
    } else if (offer) {
      const price = Number(offer.price ?? offer.lowPrice);
      if (Number.isFinite(price) && price > 0) signals.pagePrice = price;
      if (ldCurrency) signals.pageCurrency = ldCurrency;
    }

    // Prefer the buy box text; fall back to the whole page (bounded).
    const buyBox = document.querySelector('[data-buy-box-region], #listing-page-cart, [data-selector="listing-page-buy-box"]');
    const boxText = (buyBox?.closest('div[class]')?.innerText || buyBox?.innerText || '').slice(0, 20000);
    const pageText = (document.body.innerText || '').slice(0, 60000);
    const text = boxText + '\n' + pageText;

    let m =
      text.match(/(\d[\d,.]*)\+?\s+(?:people|person)\s+bought\s+this\s+in\s+the\s+(?:last|past)\s+24\s+hours/i) ||
      text.match(/son\s+24\s+saatte\s+(\d[\d,.]*)\+?\s+kişi/i);
    if (m) signals.boughtLast24h = parseIntLoose(m[1]);

    m = text.match(/\bin\s+(\d[\d,.]*)(\+?)\s+(?:other\s+people'?s\s+)?carts?\b/i) ||
        text.match(/(\d[\d,.]*)(\+?)\s+(?:kişinin\s+)?sepet(?:inde|te)\b/i);
    if (m) {
      signals.inCarts = parseIntLoose(m[1]);
      signals.inCartsPlus = m[2] === '+';
    }

    m = text.match(/\bonly\s+(\d[\d,.]*)\s+left\b/i) || text.match(/(?:sadece|yalnızca)\s+(\d[\d,.]*)\s+(?:adet|tane)/i);
    if (m) signals.onlyLeft = parseIntLoose(m[1]);

    m = boxText.match(/(\d[\d,.]*)\s+sales\b/i) || boxText.match(/(\d[\d,.]*)\s+satış\b/i);
    if (m) signals.shopSalesOnPage = parseIntLoose(m[1]);

    m = text.match(/(?:reviews?\s+for\s+this\s+item|item\s+reviews)\s*\(?\s*(\d[\d,.]*)/i) ||
        text.match(/(?:bu\s+ürün\s+için\s+yorumlar|ürün\s+yorumları)\s*\(?\s*(\d[\d,.]*)/i);
    if (m) signals.itemReviewsOnPage = parseIntLoose(m[1]);

    signals.isBestseller = /\bbestseller\b|\bçok\s+satan\b/i.test(boxText || pageText.slice(0, 8000));
    signals.isStarSeller = /\bstar\s+seller\b|\byıldız\s+satıcı\b/i.test(boxText || pageText.slice(0, 8000));

    // Shop id the page carries (data-shop-id on the shop/follow widgets). Lets the server start
    // the shop calls in parallel with the listing call; it verifies against the listing's shop_id.
    const shopEl = document.querySelector('[data-shop-id]');
    const shopId = shopEl && shopEl.getAttribute('data-shop-id');
    if (shopId && /^\d{1,15}$/.test(shopId)) signals.shopIdHint = shopId;
    return signals;
  }

  function init() {
    const S = window.__KX_SHARED;
    const C = window.__KX_CACHE;
    let _currentListingId = null;

    S.isOverlayEnabled().then(enabled => {
      if (!enabled) return;
      if (S.getPageType() === 'listing') {
        S.injectInlineCSS();
        processListingPage();
      }
      S.onUrlChange(() => {
        if (S.getPageType() !== 'listing') return;
        const newId = S.SELECTORS.listingId();
        if (newId !== _currentListingId) {
          const old = document.getElementById('kx-listing-stats');
          if (old) old.remove();
          _currentListingId = null;
        }
        S.injectInlineCSS();
        setTimeout(processListingPage, 500);
      });
      // Language changed in the popup: rebuild the panel (cached data, same page view).
      S.onLangChange(() => {
        if (S.getPageType() !== 'listing') return;
        const old = document.getElementById('kx-listing-stats');
        if (old) old.remove();
        processListingPage();
      });
    });

    async function processListingPage(retries = 0) {
      const listingId = S.SELECTORS.listingId();
      if (!listingId) return;
      if (document.getElementById('kx-listing-stats')) return;

      const anchor = findInsertionPoint();
      if (!anchor) {
        if (retries < 10) setTimeout(() => processListingPage(retries + 1), 800);
        return;
      }

      _currentListingId = listingId;
      S.perfStart('etsy_listing');
      const statsBar = document.createElement('div');
      statsBar.id = 'kx-listing-stats';
      statsBar.className = 'kx-stats-bar';
      statsBar.lang = S.lang; // uppercase labels need lang="tr" for İ
      anchor.insertAdjacentElement('afterend', statsBar);

      // Page signals: instant, and always the live ones from this render (not a cached copy).
      const page = scrapePageSignals();
      const ui = { collapsed: false };
      const isCurrent = () => S.SELECTORS.listingId() === listingId && statsBar.isConnected;
      renderStatsBar(statsBar, null, page, ui, 'loading');
      S.perf('etsy_listing', 'first_paint');

      const key = `lstats:${listingId}`;
      let local = null;
      try { local = C.get ? await C.get(key) : null; } catch (_) { local = null; }

      let full = null;
      let failed = false;
      // Fast core answer (listing facts) alongside the full one, unless the full one is cached locally.
      if (!local) {
        S.listingStatsCall(listingId, page, 'core').then(core => {
          if (!core || full || failed || !isCurrent()) return;
          // An older server, or the full answer already in the shared cache: it IS the full answer.
          renderStatsBar(statsBar, core, page, ui, core.sales ? 'full' : 'core');
          S.perf('etsy_listing', 'core');
        }, () => { /* the full request reports errors */ });
      }

      try {
        const data = await C.getOrFetch(key, 'lstats', () => S.listingStatsCall(listingId, page));
        if (!isCurrent()) return; // navigated away
        if (!data) { statsBar.remove(); return; }
        full = data;
        renderStatsBar(statsBar, data, page, ui, 'full');
        S.perf('etsy_listing', 'full');
      } catch (err) {
        failed = true;
        if (!isCurrent()) return;
        // Daily research limit / busy / signed out (401 → sign-up card): one card instead of the numbers.
        if (S.showLimitCard(statsBar, err, 'etsy_listing', true)) return;
        statsBar.textContent = '';
        const msg = err && err.status === 401 ? S.t('signInRequired') : (err && err.message) || S.t('loadFailed');
        statsBar.appendChild(header(msg));
      }
    }

    function findInsertionPoint() {
      const selectors = [
        '[data-buy-box-region="price"]',
        '[data-appears-component-name="price"]',
        '[data-buy-box-region="title"]',
        '#listing-page-cart',
        '[data-selector="listing-page-buy-box"]',
        '.listing-page-title-component',
        '[data-listing-page-region="title"]',
        '[data-component="listing-page-title"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      for (const h1 of document.querySelectorAll('h1')) {
        if (h1.closest('header') || h1.closest('nav')) continue;
        return h1.parentElement;
      }
      return null;
    }

    // ---- DOM helpers (no innerHTML with data) ----
    function node(tag, cls, text, style) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined && text !== null) n.textContent = String(text);
      if (style) n.style.cssText = style;
      return n;
    }

    function header(text, extra) {
      const h = node('div', 'kx-stats-header');
      h.appendChild(node('span', 'kx-stats-logo', 'KX'));
      if (text) h.appendChild(node('span', null, text));
      if (extra) extra.forEach(e => h.appendChild(e));
      return h;
    }

    function metric(label, value, color, title) {
      const m = node('span', 'kx-metric');
      if (title) m.title = title;
      m.appendChild(node('span', 'kx-metric-label', label));
      m.appendChild(node('span', null, value, `font-weight:700;${color ? 'color:' + color + ';' : ''}`));
      return m;
    }

    function fmtSales(n) {
      if (n === null || n === undefined) return '—';
      return S.formatSales(n);
    }

    function fmtMoney(amount, currency) {
      if (amount === null || amount === undefined) return '—';
      const cur = currency || 'USD';
      try {
        return new Intl.NumberFormat(S.locale(), { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(amount);
      } catch (_) {
        return cur + ' ' + S.formatNum(amount);
      }
    }

    function fmtAge(iso) {
      const ms = Date.now() - Date.parse(iso);
      if (!Number.isFinite(ms) || ms < 60 * 1000) return S.t('justNow');
      if (ms < 3600 * 1000) return Math.round(ms / 60000) + ' ' + S.t('minutes');
      if (ms < 48 * 3600 * 1000) return Math.round(ms / 3600000) + ' ' + S.t('hours');
      return Math.round(ms / 86400000) + ' ' + S.t('days');
    }

    function fmtDate(iso) {
      try { return new Date(iso).toLocaleDateString(S.locale()); } catch (_) { return iso; }
    }

    function signed(n) {
      if (n === null || n === undefined) return '—';
      return (n > 0 ? '+' : '') + n;
    }

    /** Placeholder sales block: same boxes and line heights as the real one. */
    function salesSkeleton() {
      const box = node('div', 'kx-sales');
      const top = node('div', 'kx-sales-top');
      const v = node('span', 'kx-sales-value');
      v.appendChild(S.skel(true));
      top.appendChild(v);
      top.appendChild(S.skel());
      box.appendChild(top);
      const how = node('div', 'kx-sales-how');
      how.appendChild(S.skel('x'));
      box.appendChild(how);
      box.appendChild(node('div', 'kx-sales-meta', S.t('loading')));
      return box;
    }

    function renderSalesBlock(data) {
      const sales = data.sales || {};
      const box = node('div', 'kx-sales');
      const top = node('div', 'kx-sales-top');

      const kind = sales.kind || 'insufficient';
      const badgeCls = kind === 'measured' ? 'kx-badge kx-badge-measured' : kind === 'estimated' ? 'kx-badge kx-badge-estimated' : 'kx-badge kx-badge-none';
      const badgeText = kind === 'measured' ? S.t('badgeMeasured') : kind === 'estimated' ? S.t('badgeEstimated') : S.t('badgeInsufficient');

      if (sales.monthlySales !== null && sales.monthlySales !== undefined) {
        top.appendChild(node('span', 'kx-sales-value', (kind === 'estimated' ? '~' : '') + fmtSales(sales.monthlySales) + ' ' + S.t('salesPerMonth')));
      } else if (sales.monthlySalesUpperBound !== null && sales.monthlySalesUpperBound !== undefined) {
        top.appendChild(node('span', 'kx-sales-value', S.t('lessThan') + ' ' + fmtSales(sales.monthlySalesUpperBound) + ' ' + S.t('salesPerMonth')));
      }
      top.appendChild(node('span', badgeCls, badgeText));
      if (sales.confidence) {
        const c = sales.confidence === 'high' ? 'confHigh' : sales.confidence === 'medium' ? 'confMedium' : 'confLow';
        top.appendChild(node('span', 'kx-badge kx-badge-conf', S.t(c)));
      }
      if (sales.monthlyRevenue !== null && sales.monthlyRevenue !== undefined) {
        const rev = node('span', 'kx-sales-rev', '≈ ' + fmtMoney(sales.monthlyRevenue, sales.currency) + ' ' + S.t('revenueApprox'));
        if (sales.priceUsed) {
          const p = S.formatMoney(sales.priceUsed, sales.currency, 2);
          rev.title = (sales.priceSource === 'page' ? S.t('revTipPage', { sales: fmtSales(sales.monthlySales), price: p })
            : S.t('revTipList', { sales: fmtSales(sales.monthlySales), price: p }));
          rev.textContent += ' · ' + (sales.priceSource === 'page' ? S.t('revenueFromPage', { price: p }) : S.t('revenueFromList', { price: p }));
        }
        top.appendChild(rev);
      }
      box.appendChild(top);

      // How it was computed — the actual inputs
      const i = sales.inputs || {};
      let how = '';
      if (kind === 'measured') {
        how = S.t(i.shareSource === 'lifetime_reviews' ? 'howMeasuredLifetime' : 'howMeasured', {
          delta: S.formatNum(i.shopSoldDelta), days: i.spanDays, perDay: i.shopSoldPerDay,
          share: i.share, mine: i.shareListingReviews, total: i.shareShopReviews, window: Math.round(i.shareWindowDays || 0),
        });
      } else if (kind === 'estimated') {
        how = S.t(sales.monthlySales !== null && sales.monthlySales !== undefined ? 'howEstimated' : 'howEstimatedNone', {
          recent: i.recentListingReviews, window: i.windowDays, ratio: i.salesPerReview,
          sold: S.formatNum(i.shopSold), reviews: S.formatNum(i.shopReviewCount),
          upper: fmtSales(sales.monthlySalesUpperBound),
        });
      } else {
        how = S.t('howInsufficient');
      }
      box.appendChild(node('div', 'kx-sales-how', how));

      // Shop velocity measured but couldn't attribute — still a real number worth showing
      if (kind !== 'measured' && data.shopVelocity && data.shopVelocity.kind === 'measured') {
        const v = data.shopVelocity;
        box.appendChild(node('div', 'kx-sales-how',
          S.t('howShopOnly', { delta: S.formatNum(v.delta), days: v.spanDays, perDay: v.soldPerDay })));
      }

      // Data age + tracking status
      const meta = [];
      if (data.fetchedAt) meta.push(S.t('updatedAgo', { age: fmtAge(data.fetchedAt) }));
      if (data.tracking && data.tracking.firstSnapshotAt) {
        meta.push(S.t('trackingSince', { date: fmtDate(data.tracking.firstSnapshotAt), count: data.tracking.snapshotCount }));
      }
      if (kind !== 'measured' && (!data.shopVelocity || data.shopVelocity.kind !== 'measured')) meta.push(S.t('measuredAfter'));
      box.appendChild(node('div', 'kx-sales-meta', meta.join(' · ')));
      return box;
    }

    /**
     * One renderer for every stage. `stage`: 'loading' (no API data yet: page values +
     * placeholders), 'core' (listing facts; sales / shop / SEO still loading), 'full'.
     * Slots keep their place and size from stage to stage, so values fill in without a jump.
     */
    function renderStatsBar(el, data, page, ui, stage) {
      const d = data || {};
      const L = d.listing || {};
      const shop = d.shop;
      const hasFull = stage === 'full';
      const hasListing = !!data && !!d.listing;
      el.textContent = '';
      el.lang = S.lang;
      el.dataset.kxState = stage;

      const collapseBtn = node('button', 'kx-collapse-btn', ui.collapsed ? '▼' : '▲');
      collapseBtn.type = 'button';
      el.appendChild(header(null, [collapseBtn]));

      const body = node('div');
      if (ui.collapsed) body.style.display = 'none';
      body.appendChild(hasFull ? renderSalesBlock(d) : salesSkeleton());

      // Real Etsy page signals (what Etsy itself shows to shoppers right now)
      const signals = [];
      if (page.boughtLast24h) signals.push(S.t('bought24h', { n: S.formatNum(page.boughtLast24h) }));
      if (page.inCarts) signals.push(S.t('inCarts', { n: S.formatNum(page.inCarts) + (page.inCartsPlus ? '+' : '') }));
      if (page.isBestseller) signals.push(S.t('bestsellerBadge'));
      if (page.isStarSeller) signals.push(S.t('starSeller'));
      if (signals.length) {
        const row = node('div', 'kx-stats-row', null, 'margin-bottom:6px;font-size:11px;font-weight:700;');
        signals.forEach((s, idx) => {
          if (idx) row.appendChild(node('span', 'kx-sep', '·'));
          row.appendChild(node('span', 'kx-signal', s));
        });
        row.appendChild(node('span', 'kx-sep', '·'));
        row.appendChild(node('span', null, S.t('sourcePage'), 'color:#999;font-weight:500;'));
        body.appendChild(row);
      }

      // Facts (Etsy API) — no formulas here. A placeholder while a value is still loading.
      const grid = node('div', 'kx-metrics-grid');
      const later = (label) => metricSkel(label);
      // Price shown on the page (instant); the API list price only when the page has none.
      if (page.pagePrice) grid.appendChild(metric(S.t('price'), S.formatMoney(page.pagePrice, page.pageCurrency, 2), null, S.t('sourcePage')));
      else if (hasListing && L.price) grid.appendChild(metric(S.t('price'), S.formatMoney(L.price, L.currency, 2), null, S.t('sourceApi')));
      if (hasFull) {
        const seo = d.seoScore?.total ?? 0;
        grid.appendChild(metric('SEO', seo + '/100', seo >= 70 ? '#4caf50' : seo >= 40 ? '#ff9800' : '#f44336'));
        if (L.reviewCount !== null && L.reviewCount !== undefined) grid.appendChild(metric(S.t('itemReviews'), S.formatNum(L.reviewCount), null, S.t('itemReviewsTip')));
      } else {
        grid.appendChild(later('SEO'));
        grid.appendChild(later(S.t('itemReviews')));
      }
      if (hasListing) {
        if (L.favorites !== null && L.favorites !== undefined) grid.appendChild(metric(S.t('favorites'), S.formatNum(L.favorites)));
        if (L.views) grid.appendChild(metric(S.t('views'), S.formatNum(L.views)));
        if (L.ageDays !== null && L.ageDays !== undefined) {
          grid.appendChild(metric(S.t('age'), L.ageDays >= 60 ? Math.round(L.ageDays / 30) + ' ' + S.t('months') : L.ageDays + ' ' + S.t('days')));
        }
        if (L.quantity) {
          // Seller-entered quantity, frequently a placeholder — never presented as real stock.
          grid.appendChild(metric(S.t('qtySeller'), String(L.quantity), L.quantity <= 3 ? '#c62828' : null, S.t('qtyTip')));
        }
        const tagCount = L.tagCount || 0;
        grid.appendChild(metric(S.t('tags'), tagCount + '/13', tagCount >= 13 ? '#2e7d32' : tagCount >= 10 ? '#e65100' : '#c62828'));
      } else {
        grid.appendChild(later(S.t('favorites')));
        grid.appendChild(later(S.t('age')));
        grid.appendChild(later(S.t('tags')));
      }
      if (hasFull) {
        if (shop) {
          if (shop.soldCount !== null && shop.soldCount !== undefined) grid.appendChild(metric(S.t('shopSalesLifetime'), S.formatNum(shop.soldCount)));
          if (shop.salesPerReview) grid.appendChild(metric(S.t('salesPerReview'), S.formatDec(shop.salesPerReview)));
          if (shop.rating) grid.appendChild(metric(S.t('rating'), Number(shop.rating).toLocaleString(S.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '★'));
        }
      } else {
        grid.appendChild(later(S.t('shopSalesLifetime')));
        grid.appendChild(later(S.t('rating')));
      }
      body.appendChild(grid);

      // Measured listing deltas between snapshots
      const dl = hasFull ? d.listingDeltas : null;
      if (dl && (dl.favorites !== null || dl.reviews !== null)) {
        body.appendChild(node('div', 'kx-sales-meta',
          S.t('listingDeltas', { days: dl.spanDays, favs: signed(dl.favorites), reviews: signed(dl.reviews) }) + ' (' + S.t('sourceApi') + ')',
          'margin-top:6px;'));
      }

      if (hasListing && Array.isArray(L.tags) && L.tags.length) {
        const tags = node('div', null, null, 'margin-top:6px;');
        L.tags.forEach(tg => tags.appendChild(node('span', 'kx-tag-pill', tg)));
        body.appendChild(tags);
      }

      el.appendChild(body);
      collapseBtn.addEventListener('click', () => {
        ui.collapsed = !ui.collapsed;
        body.style.display = ui.collapsed ? 'none' : '';
        collapseBtn.textContent = ui.collapsed ? '▼' : '▲';
      });
    }

    function metricSkel(label) {
      const m = node('span', 'kx-metric');
      m.appendChild(node('span', 'kx-metric-label', label));
      const v = node('span', null, null, 'font-weight:700;');
      v.appendChild(S.skel());
      m.appendChild(v);
      return m;
    }
  }
})();

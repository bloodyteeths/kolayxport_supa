/**
 * KolayXport Research — Shop Page Overlay
 * Sticky header bar: measured/estimated shop sales, real shop facts, most-reviewed listings
 * + per-listing measured/estimated rows on the shop's listing grid (DOM-built)
 *
 * Progressive: the bar renders at once (shop name, the sales count the page prints) with
 * placeholders, and the shop stats (shop_enrich) and the grid rows (listings_batch) are
 * requested in parallel, each filling its slots as it returns.
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) return;
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_SHARED;
    const C = window.__KX_CACHE;

    S.isOverlayEnabled().then(enabled => {
      if (!enabled) return;
      if (S.getPageType() === 'shop') {
        S.injectInlineCSS();
        processShopPage();
      }
      S.onUrlChange(() => {
        if (S.getPageType() === 'shop') {
          S.injectInlineCSS();
          setTimeout(processShopPage, 500);
        }
      });
      // Language changed in the popup: re-render (cached data, same page view).
      S.onLangChange(() => {
        if (S.getPageType() === 'shop') processShopPage();
      });
    });

    let runToken = 0;

    async function processShopPage() {
      const shopName = S.SELECTORS.shopName();
      if (!shopName) return;
      const myRun = ++runToken;
      const isCurrent = () => myRun === runToken && S.SELECTORS.shopName() === shopName;
      S.perfStart('etsy_shop');

      const shadow = S.createOverlayContainer('kx-shop-overlay', 'top');
      let bar = shadow.querySelector('.kx-shop-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-shop-bar';
        shadow.appendChild(bar);
      }
      bar.lang = S.lang;
      // Instant: the shop name and the sales count Etsy prints on the shop page ("5,678 Sales").
      const salesText = S.findShortPageText(/^(\d[\d.,]*)\s+(?:sales|satış)$/i);
      const M = window.__KX_MATH;
      const pageSales = salesText && M && M.parseCount ? M.parseCount(salesText[1]) : null;
      let displayName = shopName;
      try { displayName = decodeURIComponent(shopName); } catch (_) { /* keep raw */ }
      renderSkeletonBar(bar, displayName, pageSales);
      S.perf('etsy_shop', 'first_paint');

      let limited = false;
      const showLimit = (err) => {
        if (limited || !isCurrent()) return limited;
        // Daily research limit / busy / signed out: one card instead of the numbers.
        limited = S.showLimitCard(bar, err, 'etsy_shop');
        if (limited) S.clearSkeletonRows();
        return limited;
      };

      const shopTask = C.getOrFetch(`shop2:${shopName.toLowerCase()}`, 'lstats', () => S.apiCall('shop_enrich', { shopId: shopName }))
        .then(data => {
          if (!isCurrent() || limited) return;
          if (!data?.shop) { bar.textContent = ''; return; }
          renderShopBar(bar, data);
          S.perf('etsy_shop', 'shop');
        }, err => {
          if (showLimit(err) || !isCurrent()) return;
          setMessage(bar, '⚠ ' + ((err && err.message) || S.t('loadFailed')), 0.7);
        });

      // Per-listing rows on the shop grid, in parallel with the bar (all one shop → one shop fetch
      // server-side). Cards compare against the median of the prices shown on this shop page.
      const page = S.collectPageCards();
      const ids = page.ids.slice(0, 96);
      const cardsTask = !ids.length ? Promise.resolve()
        : S.loadCardStats(ids, { display: page.display, market: S.pageMarket(page.display, {}) }, isCurrent, null, 'etsy_shop_cards')
          .catch(err => { showLimit(err); }); // best-effort, but a research-limit answer replaces the bar

      await Promise.all([shopTask, cardsTask]);
      if (isCurrent() && !limited) S.perf('etsy_shop', 'full');
    }

    /** Same slots as renderShopBar, with placeholders for what only the API knows. */
    function renderSkeletonBar(bar, shopName, pageSales) {
      bar.textContent = '';
      bar.dataset.kxState = 'partial';
      const title = S.el('div', null, null, 'display:flex;align-items:center;gap:4px;font-weight:700;');
      title.appendChild(S.el('span', null, 'KX', 'font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;'));
      title.appendChild(S.el('span', null, shopName || ''));
      bar.appendChild(title);
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      const slot = (label, value, wide) => {
        const w = S.el('div', 'kx-bar-item');
        w.appendChild(S.el('span', 'kx-bar-label', label));
        const v = S.el('span', 'kx-bar-value');
        if (value !== null && value !== undefined) v.textContent = value; else v.appendChild(S.skel(wide));
        w.appendChild(v);
        return w;
      };
      bar.appendChild(slot(S.t('salesMo'), null, true));
      bar.appendChild(slot(S.t('revenueMo')));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(slot(S.t('topSales'), pageSales !== null && pageSales !== undefined ? S.formatNum(pageSales) : null));
      bar.appendChild(slot(S.t('rating')));
      bar.appendChild(slot(S.t('reviews')));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(slot(S.t('activeListings')));
      bar.appendChild(slot(S.t('medianListPriceShop'), null, true));
    }

    function setMessage(bar, text, opacity) {
      bar.textContent = '';
      bar.appendChild(S.el('span', null, text, 'opacity:' + opacity));
    }

    function item(label, value, valueStyle, title) {
      const wrap = S.el('div', 'kx-bar-item');
      if (title) wrap.title = title;
      wrap.appendChild(S.el('span', 'kx-bar-label', label));
      wrap.appendChild(S.el('span', 'kx-bar-value', value, valueStyle));
      return wrap;
    }

    function badge(kind, confidence) {
      const styles = {
        measured: 'background:#e8f5e9;color:#1b5e20;',
        estimated: 'background:#fff3e0;color:#e65100;',
        insufficient: 'background:#eee;color:#666;',
      };
      let label = kind === 'measured' ? S.t('badgeMeasured') : kind === 'estimated' ? S.t('badgeEstimated') : S.t('badgeInsufficient');
      if (confidence && kind !== 'insufficient') label += ' · ' + S.confShort(confidence);
      return S.el('span', null, label,
        (styles[kind] || styles.insufficient) + 'font-size:9px;font-weight:800;text-transform:uppercase;padding:1px 6px;border-radius:8px;margin-left:4px;');
    }

    function renderShopBar(bar, data) {
      const { shop, sales, avgPrice, topListings, lowStockCount } = data;
      const cur = shop.currency || 'USD';
      const i = sales?.inputs || {};
      const how = sales?.kind === 'measured'
        ? S.t('shopHowMeasured', { delta: S.formatNum(i.shopSoldDelta), days: i.spanDays, avg: S.formatMoney(i.avgPrice, cur, 2) })
        : sales?.kind === 'estimated'
          ? S.t('shopHowEstimated', { recent: i.recentShopReviews, window: i.windowDays, ratio: i.salesPerReview, avg: S.formatMoney(i.avgPrice, cur, 2) })
          : S.t('howInsufficient');
      const conf = sales?.confidence ? ' · ' + S.t(sales.confidence === 'high' ? 'confHigh' : sales.confidence === 'medium' ? 'confMedium' : 'confLow') : '';

      bar.textContent = '';
      bar.dataset.kxState = 'full';
      const title = S.el('div', null, null, 'display:flex;align-items:center;gap:4px;font-weight:700;');
      title.appendChild(S.el('span', null, 'KX', 'font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;'));
      title.appendChild(S.el('span', null, shop.shop_name || ''));
      bar.appendChild(title);
      bar.appendChild(S.el('div', 'kx-bar-divider'));

      const salesItem = S.el('div', 'kx-bar-item');
      salesItem.title = how + conf;
      salesItem.appendChild(S.el('span', 'kx-bar-label', S.t('salesMo')));
      const val = sales?.monthlySales !== null && sales?.monthlySales !== undefined
        ? (sales.kind === 'estimated' ? '~' : '') + S.formatSales(sales.monthlySales)
        : '—';
      salesItem.appendChild(S.el('span', 'kx-bar-value', val, 'font-size:15px;'));
      salesItem.appendChild(badge(sales?.kind || 'insufficient', sales?.confidence));
      bar.appendChild(salesItem);
      if (sales?.monthlyRevenue) {
        bar.appendChild(item(S.t('revenueMo'), '≈' + S.formatMoney(sales.monthlyRevenue, cur), 'color:#a5d6a7;', how));
      }
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      if (shop.num_sales !== null && shop.num_sales !== undefined) bar.appendChild(item(S.t('topSales'), S.formatNum(shop.num_sales)));
      bar.appendChild(item(S.t('rating'), shop.rating ? Number(shop.rating).toLocaleString(S.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ★' : S.t('notAvailable')));
      if (shop.review_count !== null && shop.review_count !== undefined) bar.appendChild(item(S.t('reviews'), S.formatNum(shop.review_count)));
      if (shop.salesPerReview) bar.appendChild(item(S.t('salesPerReview'), S.formatDec(shop.salesPerReview)));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      if (shop.listing_count !== null && shop.listing_count !== undefined) bar.appendChild(item(S.t('activeListings'), S.formatNum(shop.listing_count)));
      if (avgPrice) bar.appendChild(item(S.t('medianListPriceShop'), S.formatMoney(avgPrice, cur, 2), null, S.t('priceTipShop')));
      if (shop.shopAgeYears !== null && shop.shopAgeYears !== undefined) bar.appendChild(item(S.t('shopAge'), shop.shopAgeYears + ' ' + S.t('years')));
      if (lowStockCount > 0) bar.appendChild(item(S.t('lowStockItems'), String(lowStockCount), 'color:#ffcdd2;'));

      if (Array.isArray(topListings) && topListings.length) {
        bar.appendChild(S.el('div', 'kx-bar-divider'));
        const top = S.el('div', 'kx-bar-item', null, 'flex-direction:column;align-items:flex-start;max-width:320px;');
        top.appendChild(S.el('span', 'kx-bar-label', S.t('topRecent')));
        topListings.slice(0, 3).forEach(l => {
          const a = S.el('a', null, null, 'color:#fff;font-size:11px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;display:block;');
          a.href = 'https://www.etsy.com/listing/' + encodeURIComponent(l.listing_id);
          a.textContent = (l.title ? l.title.slice(0, 50) : '#' + l.listing_id) + ' (' + l.recentReviews + ' ★)';
          top.appendChild(a);
        });
        bar.appendChild(top);
      }

      const right = S.el('div', null, null, 'margin-left:auto;');
      const link = S.el('a', 'kx-btn kx-btn-sm', S.t('fullAnalysis'), 'background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;');
      link.href = S.API_BASE + '/app/research/shops?mkt=etsy&q=' + encodeURIComponent(shop.shop_name || '');
      link.target = '_blank';
      link.rel = 'noopener';
      right.appendChild(link);
      bar.appendChild(right);
    }
  }
})();

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
          if (!data?.shop) { bar.textContent = ''; bar.className = 'kx-shop-bar'; return; }
          renderShopBar(bar, data);
          S.perf('etsy_shop', 'shop');
        }, err => {
          if (showLimit(err) || !isCurrent()) return;
          setMessage(bar, '⚠ ' + ((err && err.message) || S.t('loadFailed')));
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

    const chip = (o) => S.UI.chip(document, o);
    const shopLink = (name) => ({ href: S.API_BASE + '/app/research/shops?mkt=etsy&q=' + encodeURIComponent(name || ''), text: S.t('fullAnalysis') });

    /** Same slots as renderShopBar, with placeholders for what only the API knows. */
    function renderSkeletonBar(bar, shopName, pageSales) {
      const sk = (wide) => S.skel(wide);
      S.UI.topBar(bar, {
        title: shopName || '',
        state: 'partial',
        chips: [
          chip({ key: 'sales', label: S.t('salesMo'), value: sk(true) }),
          chip({ key: 'revenue', label: S.t('revenueMo'), value: sk() }),
          chip({ key: 'total', label: S.t('topSales'), value: pageSales !== null && pageSales !== undefined ? S.formatNum(pageSales) : sk() }),
          chip({ key: 'rating', label: S.t('rating'), value: sk() }),
          chip({ key: 'price', label: S.t('medianListPriceShop'), value: sk(true) }),
        ],
        more: [
          chip({ key: 'reviews', label: S.t('reviews'), value: sk() }),
          chip({ key: 'listings', label: S.t('activeListings'), value: sk() }),
        ],
        link: shopLink(shopName),
      });
    }

    function setMessage(bar, text) {
      S.UI.barMessage(bar, text);
    }

    function renderShopBar(bar, data) {
      const U = S.UI;
      const { shop, sales, avgPrice, topListings, lowStockCount } = data;
      const cur = shop.currency || 'USD';
      const i = sales?.inputs || {};
      const how = sales?.kind === 'measured'
        ? S.t('shopHowMeasured', { delta: S.formatNum(i.shopSoldDelta), days: i.spanDays, avg: S.formatMoney(i.avgPrice, cur, 2) })
        : sales?.kind === 'estimated'
          ? S.t('shopHowEstimated', { recent: i.recentShopReviews, window: i.windowDays, ratio: i.salesPerReview, avg: S.formatMoney(i.avgPrice, cur, 2) })
          : S.t('howInsufficient');
      const plain = sales?.kind === 'measured' ? S.t('plainShopSalesMeasured') : sales?.kind === 'estimated' ? S.t('plainShopSalesEstimated') : S.t('plainSalesNone');
      const kind = sales?.kind || 'insufficient';
      const src = kind === 'measured' ? ['etsyApi', 'kx'] : ['etsyApi'];

      const chips = [];
      const more = [];
      const salesVal = sales?.monthlySales !== null && sales?.monthlySales !== undefined
        ? (kind === 'estimated' ? '≈' : '') + S.formatSales(sales.monthlySales)
        : '—';
      chips.push(chip({ key: 'sales', label: S.t('salesMo'), value: [salesVal, U.conf(document, kind, sales?.confidence)],
        info: { plain, formula: how, source: src, confidence: sales?.confidence || null } }));
      if (sales?.monthlyRevenue) {
        chips.push(chip({ key: 'revenue', label: S.t('revenueMo'), value: '≈' + S.formatMoney(sales.monthlyRevenue, cur),
          info: { plain: S.t('plainShopRevenue'), formula: how, source: src, confidence: sales.confidence === 'high' ? 'medium' : 'low' } }));
      }
      if (shop.num_sales !== null && shop.num_sales !== undefined) chips.push(chip({ key: 'total', label: S.t('topSales'), value: S.formatNum(shop.num_sales) }));
      chips.push(chip({ key: 'rating', label: S.t('rating'), value: shop.rating ? Number(shop.rating).toLocaleString(S.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ★' : S.t('notAvailable') }));
      if (avgPrice) {
        chips.push(chip({ key: 'price', label: S.t('medianListPriceShop'), value: S.formatMoney(avgPrice, cur, 2),
          info: { plain: S.t('plainShopPrice'), formula: S.t('priceTipShop'), source: ['etsyApi'], confidence: 'medium' } }));
      }

      if (shop.review_count !== null && shop.review_count !== undefined) more.push(chip({ key: 'reviews', label: S.t('reviews'), value: S.formatNum(shop.review_count) }));
      if (shop.salesPerReview) {
        more.push(chip({ key: 'spr', label: S.t('salesPerReview'), value: S.formatDec(shop.salesPerReview),
          info: { plain: S.t('plainSalesPerReview'), source: ['etsyApi'], confidence: 'high' } }));
      }
      if (shop.listing_count !== null && shop.listing_count !== undefined) more.push(chip({ key: 'listings', label: S.t('activeListings'), value: S.formatNum(shop.listing_count) }));
      if (shop.shopAgeYears !== null && shop.shopAgeYears !== undefined) more.push(chip({ key: 'age', label: S.t('shopAge'), value: shop.shopAgeYears + ' ' + S.t('years') }));
      if (lowStockCount > 0) more.push(chip({ key: 'lowstock', label: S.t('lowStockItems'), value: String(lowStockCount), tone: 'red' }));

      if (Array.isArray(topListings) && topListings.length) {
        const top = U.note(document, null);
        top.appendChild(S.el('div', null, S.t('topListingsLabel'), 'font-weight:600;color:#fff;margin-bottom:2px;'));
        topListings.slice(0, 3).forEach(l => {
          const a = S.el('a', null, null, 'color:#8FA8FF;text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;');
          a.href = 'https://www.etsy.com/listing/' + encodeURIComponent(l.listing_id);
          a.textContent = (l.title ? l.title.slice(0, 70) : '#' + l.listing_id) + ' (' + l.recentReviews + ' ★)';
          top.appendChild(a);
        });
        more.push(top);
      }

      U.topBar(bar, { title: shop.shop_name || '', state: 'full', chips, more, link: shopLink(shop.shop_name) });
    }
  }
})();

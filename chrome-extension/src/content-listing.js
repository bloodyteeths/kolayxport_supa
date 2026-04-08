/**
 * KolayXport Research — Etsy Listing Page
 * Auto-injects inline stats bar below listing title/price area
 */

(function () {
  'use strict';

  console.log('[KX-listing] script loaded, shared:', !!window.__KX_SHARED, 'cache:', !!window.__KX_CACHE);

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) { console.log('[KX-listing] gave up waiting for shared after 50 attempts'); return; }
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

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
        if (S.getPageType() === 'listing') {
          // Remove stale stats bar from previous listing
          const newId = S.SELECTORS.listingId();
          if (newId !== _currentListingId) {
            const old = document.getElementById('kx-listing-stats');
            if (old) old.remove();
            _currentListingId = null;
          }
          S.injectInlineCSS();
          setTimeout(processListingPage, 500);
        }
      });
    });

    async function processListingPage(retries = 0) {
      const listingId = S.SELECTORS.listingId();
      if (retries === 0) console.log('[KX-listing] start, id:', listingId, 'path:', location.pathname);
      if (!listingId) return;

      if (document.getElementById('kx-listing-stats')) return;

      const anchor = findInsertionPoint();
      if (!anchor) {
        if (retries < 10) {
          if (retries % 3 === 0) console.log('[KX-listing] waiting for DOM, retry', retries);
          setTimeout(() => processListingPage(retries + 1), 800);
        } else {
          console.log('[KX-listing] gave up finding insertion point');
        }
        return;
      }
      console.log('[KX-listing] found anchor:', anchor.tagName, anchor.className?.substring(0, 40));

      _currentListingId = listingId;
      const statsBar = document.createElement('div');
      statsBar.id = 'kx-listing-stats';
      statsBar.className = 'kx-stats-bar';
      statsBar.innerHTML = `
        <div class="kx-stats-header">
          <span class="kx-stats-logo">KX</span>
          <span>${S.t('loading')}</span>
        </div>
      `;
      anchor.insertAdjacentElement('afterend', statsBar);

      try {
        const data = await C.getOrFetch(
          `listing:${listingId}`,
          'listing',
          () => S.apiCall('listing_enrich', { listingId })
        );

        if (!data) {
          statsBar.remove();
          return;
        }

        // Best seller check via search (optional)
        let bestSellerInfo = null;
        try {
          const title = document.querySelector('h1')?.textContent?.trim() || '';
          const searchWords = title.split(/\s+/).slice(0, 4).join(' ');
          if (searchWords.length > 3) {
            const searchData = await C.getOrFetch(
              `search:${searchWords}`,
              'search',
              () => S.apiCall('search_enrich', { query: searchWords })
            );
            if (searchData?.listingBadges) {
              const ranks = S.computeBestSellerRanks(searchData.listingBadges);
              bestSellerInfo = ranks[listingId];
            }
          }
        } catch (_) {}

        renderStatsBar(statsBar, data, bestSellerInfo);
      } catch (err) {
        statsBar.innerHTML = `
          <div class="kx-stats-header">
            <span class="kx-stats-logo">KX</span>
            <span>${err.message || S.t('loadFailed')}</span>
          </div>
        `;
      }
    }

    function findInsertionPoint() {
      // Try specific buy box selectors first
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

      // Fallback: find the listing title text on the right side (buy box area)
      // Etsy puts the title in the buy box, not as a standalone h1
      const allH1s = document.querySelectorAll('h1');
      for (const h1 of allH1s) {
        // Skip h1s in the header/nav area
        if (h1.closest('header') || h1.closest('nav')) continue;
        return h1.parentElement;
      }

      // Last resort: find "Add to cart" button and go up to its container
      const addToCart = document.querySelector('button[data-selector="add-to-cart"]') ||
                        document.querySelector('[data-selector="add-to-cart-button"]') ||
                        Array.from(document.querySelectorAll('button')).find(b =>
                          b.textContent.trim().match(/^Add to cart$|^Sepete ekle$/i)
                        );
      if (addToCart) {
        // Walk up to find a good container
        let container = addToCart.parentElement;
        for (let i = 0; i < 5 && container; i++) {
          if (container.offsetWidth > 300) return container;
          container = container.parentElement;
        }
      }

      return null;
    }

    function renderStatsBar(el, data, bestSeller) {
      const { listing, velocity, seoScore, shop } = data;
      const seo = seoScore?.total || 0;
      const seoColor = S.scoreClass(seo);
      const seoPct = Math.min(seo, 100);
      const seoFillColor = seo >= 70 ? '#4caf50' : seo >= 40 ? '#ff9800' : '#f44336';

      const est = velocity?.estMonthlySales || 0;
      const revenue = velocity?.estMonthlyRevenue || 0;
      const estTotal = velocity?.estTotalSales || 0;
      const demand = velocity?.demandScore || 'low';
      const favs = listing?.favorites || 0;
      const views = listing?.views || 0;
      const reviews = listing?.reviewCount || 0;
      const age = velocity?.ageMonths || 0;
      const tagCount = listing?.tagCount || 0;
      const quantity = listing?.quantity || 0;
      const lowStock = velocity?.lowStock || false;

      const dl = S.demandLabel(demand);
      const demandText = demand === 'hot' ? 'Hot' : demand === 'good' ? 'Good' : demand === 'moderate' ? 'Moderate' : 'Low';
      const demandColor = demand === 'hot' ? '#c62828' : demand === 'good' ? '#2e7d32' : demand === 'moderate' ? '#e65100' : '#888';

      // Build clean metric boxes
      const metrics = [];
      metrics.push(`<span class="kx-metric"><span class="kx-metric-label">SEO</span><span style="color:${seoFillColor};font-weight:700;">${seo}/100</span></span>`);
      if (est > 0) metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Est. Sales</span><span style="color:#2e7d32;font-weight:700;">~${est}/mo</span></span>`);
      if (revenue > 0) metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Est. Revenue</span><span style="color:#1565c0;font-weight:700;">$${S.formatNum(revenue)}/mo</span></span>`);
      metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Demand</span><span style="color:${demandColor};font-weight:700;">${demandText}</span></span>`);
      if (reviews > 0) metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Reviews</span><span style="font-weight:700;">${S.formatNum(reviews)}</span></span>`);
      metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Favs</span><span style="font-weight:700;">${S.formatNum(favs)}</span></span>`);
      metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Views</span><span style="font-weight:700;">${S.formatNum(views)}</span></span>`);
      metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Age</span><span>${age} mo</span></span>`);

      if (quantity > 0) {
        const stockColor = quantity <= 3 ? '#c62828' : quantity <= 10 ? '#e65100' : '#444';
        metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Stock</span><span style="color:${stockColor};font-weight:700;">${quantity}</span></span>`);
      }

      const tagColor = tagCount >= 13 ? '#2e7d32' : tagCount >= 10 ? '#e65100' : '#c62828';
      metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Tags</span><span style="color:${tagColor};font-weight:700;">${tagCount}/13</span></span>`);

      if (bestSeller?.isBestSeller) {
        metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Rank</span><span style="color:#b8860b;font-weight:700;">Top ${bestSeller.percentile}%</span></span>`);
      }

      if (shop) {
        metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Shop Sales</span><span style="font-weight:700;">${S.formatNum(shop.num_sales || 0)}</span></span>`);
        if (shop.rating) metrics.push(`<span class="kx-metric"><span class="kx-metric-label">Rating</span><span style="font-weight:700;">${shop.rating.toFixed(1)}★</span></span>`);
      }

      let tagsHtml = '';
      if (listing?.tags && listing.tags.length > 0) {
        tagsHtml = `<div data-kx-details style="margin-top:6px;">${listing.tags.map(t => `<span class="kx-tag-pill">${t}</span>`).join('')}</div>`;
      }

      el.innerHTML = `
        <div class="kx-stats-header">
          <span class="kx-stats-logo">KX</span>
          ${lowStock ? `<span style="color:#c62828;font-weight:700;font-size:11px;">LOW STOCK</span>` : ''}
          <button class="kx-collapse-btn" data-kx-collapse>▲</button>
        </div>
        <div class="kx-metrics-grid">${metrics.join('')}</div>
        ${tagsHtml}
      `;

      const collapseBtn = el.querySelector('[data-kx-collapse]');
      if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
          const grid = el.querySelector('.kx-metrics-grid');
          const detailEls = el.querySelectorAll('[data-kx-details]');
          const isHidden = grid?.style.display === 'none';

          if (grid) grid.style.display = isHidden ? '' : 'none';
          detailEls.forEach(d => d.style.display = isHidden ? '' : 'none');
          collapseBtn.textContent = isHidden ? '▲' : '▼';
        });
      }
    }
  }
})();

/**
 * KolayXport Research — Shop Page Overlay
 * Sticky header bar: revenue estimate, best sellers, shop metrics
 * + per-listing data rows on the shop's listing grid
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
    });

    async function processShopPage() {
      const shopName = S.SELECTORS.shopName();
      if (!shopName) return;

      const shadow = S.createOverlayContainer('kx-shop-overlay', 'top');

      let bar = shadow.querySelector('.kx-shop-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-shop-bar';
        shadow.appendChild(bar);
      }
      bar.innerHTML = `<span style="opacity:0.8">${S.t('shopAnalysisLoading')}</span>`;

      try {
        const shopId = await resolveShopId(shopName);
        if (!shopId) {
          bar.innerHTML = `<span style="opacity:0.7">${S.t('shopIdNotFound')}</span>`;
          return;
        }

        const data = await C.getOrFetch(
          `shop:${shopId}`,
          'shop',
          () => S.apiCall('shop_enrich', { shopId })
        );

        if (!data?.shop) { bar.innerHTML = ''; return; }
        renderShopBar(bar, data, S);

        // Inject per-listing data rows
        setTimeout(() => injectListingDataRows(S, C), 500);
      } catch (err) {
        bar.innerHTML = `<span style="opacity:0.7">⚠ ${err.message || S.t('loadFailed')}</span>`;
      }
    }

    async function resolveShopId(shopName) {
      return shopName;
    }

    function extractListingIds() {
      const ids = [];
      document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
        const match = link.href.match(/\/listing\/(\d+)/);
        if (match && !ids.includes(match[1])) ids.push(match[1]);
      });
      return ids;
    }

    async function injectListingDataRows(S, C) {
      const listingIds = extractListingIds();
      if (listingIds.length === 0) return;

      // Use search_enrich with the shop name as query to get batch data
      const shopName = S.SELECTORS.shopName();
      try {
        const data = await C.getOrFetch(
          `shop_listings:${shopName}`,
          'search',
          () => S.apiCall('search_enrich', { query: shopName, listingIds: listingIds.slice(0, 48) })
        );

        if (!data) return;

        const badges = data.listingBadges || {};
        const avgPrice = data.summary?.avgPrice || 0;
        if (Object.keys(badges).length === 0) return;

        const ranks = S.computeBestSellerRanks(badges);
        const links = document.querySelectorAll('a[href*="/listing/"]');
        const processed = new Set();

        links.forEach(link => {
          const match = link.href.match(/\/listing\/(\d+)/);
          if (!match || processed.has(match[1])) return;
          processed.add(match[1]);

          const id = match[1];
          const badge = badges[id];
          if (!badge) return;

          const card = link.closest('[data-listing-id]') || link.closest('.v2-listing-card') || link.closest('.listing-link') || link.parentElement;
          if (!card || card.querySelector('.kx-data-row')) return;

          const rank = ranks[id];
          const est = badge.estMonthlySales || 0;
          const revenue = badge.estMonthlyRevenue || 0;
          const demand = badge.demandScore || 'low';
          const priceDiff = S.priceVsAvg(badge.price, avgPrice);

          const parts = [];

          if (rank?.isBestSeller) {
            parts.push(`<span class="kx-best">★ Top ${rank.percentile}%</span>`);
            parts.push('<span class="kx-sep">·</span>');
          }

          parts.push(`<span class="${S.salesColor(est)}">~${est}${S.t('perMonth')}</span>`);

          if (revenue > 0) {
            parts.push('<span class="kx-sep">·</span>');
            parts.push(`<span class="kx-green" style="font-weight:700;">$${S.formatNum(Math.round(revenue))}${S.t('perMonth')}</span>`);
          }

          parts.push('<span class="kx-sep">·</span>');
          parts.push(`<span>♥ ${S.formatNum(badge.favorites || 0)}</span>`);

          const dl = S.demandLabel(demand);
          parts.push('<span class="kx-sep">·</span>');
          parts.push(`<span class="${dl.cssClass}">${dl.text}</span>`);

          if (badge.conversionRate > 0) {
            const crClass = badge.conversionRate >= 5 ? 'kx-green' : badge.conversionRate >= 2 ? 'kx-orange' : 'kx-red';
            parts.push('<span class="kx-sep">·</span>');
            parts.push(`<span class="${crClass}">${badge.conversionRate}% ${S.t('convRate')}</span>`);
          }

          if (badge.lowStock) {
            parts.push('<span class="kx-sep">·</span>');
            parts.push(`<span class="kx-red" style="font-weight:700;">${S.t('lowStock')}</span>`);
          }

          if (priceDiff) {
            parts.push('<span class="kx-sep">·</span>');
            parts.push(`<span class="${priceDiff.cssClass}">${priceDiff.text}</span>`);
          }

          const row = document.createElement('div');
          row.className = 'kx-data-row';
          row.innerHTML = parts.join('');
          card.appendChild(row);
        });
      } catch (_) {}
    }

    function renderShopBar(bar, data, S) {
      const { shop, revenue, avgPrice, bestSellers } = data;

      const estRevenue = revenue?.estMonthlyRevenue || 0;
      const estSales = revenue?.estMonthlySales || 0;
      const hotListings = revenue?.hotListings || 0;
      const lowStockCount = revenue?.lowStockCount || 0;
      const avgConv = revenue?.avgConversionRate || 0;

      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;font-weight:700;">
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">KX</span>
          ${shop.shop_name}
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('estShopRevenue')}</span>
          <span class="kx-bar-value" style="color:#4caf50;font-size:15px;">$${S.formatNum(estRevenue)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('estShopSales')}</span>
          <span class="kx-bar-value">${S.formatNum(Math.round(estSales))}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('topSales')}</span>
          <span class="kx-bar-value">${S.formatNum(shop.num_sales)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('rating')}</span>
          <span class="kx-bar-value">${shop.rating ? shop.rating.toFixed(1) + ' ★' : 'N/A'}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('reviews')}</span>
          <span class="kx-bar-value">${S.formatNum(shop.review_count)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('activeListings')}</span>
          <span class="kx-bar-value">${shop.listing_count}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('avgPrice')}</span>
          <span class="kx-bar-value">${S.formatPrice(avgPrice)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('shopAge')}</span>
          <span class="kx-bar-value">${shop.shopAgeYears || '?'} ${S.t('years')}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('hotListings')}</span>
          <span class="kx-bar-value" style="color:#c62828;">${hotListings}</span>
        </div>
        ${lowStockCount > 0 ? `
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('lowStockItems')}</span>
          <span class="kx-bar-value" style="color:#c62828;">${lowStockCount}</span>
        </div>
        ` : ''}
        ${avgConv > 0 ? `
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('avgConversion')}</span>
          <span class="kx-bar-value">${avgConv}%</span>
        </div>
        ` : ''}
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('bestSellers')}</span>
          <span class="kx-bar-value" style="font-size:11px;">${bestSellers.slice(0, 3).map(b =>
            `$${S.formatNum(Math.round(b.estMonthlyRevenue || b.price))}${S.t('perMonth')}`
          ).join(', ')}</span>
        </div>
        <div style="margin-left:auto;">
          <a href="${S.API_BASE}/app/etsy-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            ${S.t('fullAnalysis')}
          </a>
        </div>
      `;
    }
  }
})();

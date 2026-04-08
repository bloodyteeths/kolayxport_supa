/**
 * KolayXport Research — Shop Page Overlay
 * Sticky header bar: revenue estimate, best sellers, shop metrics
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

    if (S.getPageType() !== 'shop') return;

    S.isOverlayEnabled().then(enabled => {
      if (!enabled) return;
      processShopPage();
      S.onUrlChange(() => {
        if (S.getPageType() === 'shop') setTimeout(processShopPage, 500);
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
      } catch (err) {
        bar.innerHTML = `<span style="opacity:0.7">⚠ ${err.message || S.t('loadFailed')}</span>`;
      }
    }

    async function resolveShopId(shopName) {
      return shopName;
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

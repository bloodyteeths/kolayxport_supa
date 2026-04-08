/**
 * KolayXport Research — eBay Listing Page
 * Auto-injects inline stats bar below item title area
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_EBAY_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) return;
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_EBAY_SHARED;
    const C = window.__KX_CACHE;

    if (S.getPageType() !== 'listing') return;

    S.isOverlayEnabled().then(enabled => {
      if (!enabled) return;
      S.injectInlineCSS();
      processListingPage();
      S.onUrlChange(() => {
        if (S.getPageType() === 'listing') setTimeout(processListingPage, 500);
      });
    });

    async function processListingPage() {
      const itemId = S.SELECTORS.itemId();
      if (!itemId) return;

      if (document.getElementById('kx-ebay-listing-stats')) return;

      const anchor = findInsertionPoint();
      if (!anchor) return;

      const statsBar = document.createElement('div');
      statsBar.id = 'kx-ebay-listing-stats';
      statsBar.className = 'kx-stats-bar';
      statsBar.innerHTML = `
        <div class="kx-stats-header">
          <span class="kx-stats-logo">KX</span>
          <span>${S.t('loading')}</span>
        </div>
      `;
      anchor.insertAdjacentElement('afterend', statsBar);

      const title = S.SELECTORS.itemTitle();

      try {
        const [itemData, seoData] = await Promise.all([
          C.getOrFetch(
            `ebay_listing:${itemId}`,
            'listing',
            () => S.apiCall('listing_enrich', { itemId })
          ).catch(() => null),
          title ? C.getOrFetch(
            `ebay_seo:${itemId}`,
            'listing',
            () => S.apiCall('seo_analyze', { query: title.split(' ').slice(0, 5).join(' '), title })
          ).catch(() => null) : null,
        ]);

        if (!itemData && !seoData) {
          statsBar.remove();
          return;
        }

        // Best seller check
        let bestSellerInfo = null;
        try {
          const searchWords = (title || '').split(/\s+/).slice(0, 4).join(' ');
          if (searchWords.length > 3) {
            const searchData = await C.getOrFetch(
              `ebay_search:${searchWords}`,
              'search',
              () => S.apiCall('search_enrich', { query: searchWords, marketplace: 'EBAY_US' })
            );
            if (searchData?.listingBadges) {
              const ranks = S.computeBestSellerRanks(searchData.listingBadges);
              bestSellerInfo = ranks[itemId];
            }
          }
        } catch (_) {}

        renderStatsBar(statsBar, itemData, seoData, bestSellerInfo);
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
      return document.querySelector('.x-item-title') ||
             document.querySelector('h1.x-item-title__mainTitle')?.parentElement ||
             document.querySelector('#itemTitle')?.parentElement ||
             document.querySelector('h1[data-testid="x-item-title"]')?.parentElement ||
             document.querySelector('#mainContent h1')?.parentElement ||
             null;
    }

    function renderStatsBar(el, itemData, seoData, bestSeller) {
      const item = itemData?.item || itemData || {};
      const seo = seoData?.seo || seoData || {};
      const market = itemData?.market || seoData?.market || {};
      const seller = item.seller || itemData?.seller || {};

      const seoScore = seo.total || seo.score || 0;
      const seoColor = S.scoreClass(seoScore);
      const seoPct = Math.min(seoScore, 100);
      const seoFillColor = seoScore >= 70 ? '#4caf50' : seoScore >= 40 ? '#ff9800' : '#f44336';

      const itemPrice = item.price || item.currentPrice || 0;
      const avgPrice = market.avgPrice || market.avg_price || 0;
      const competitorCount = market.competitorCount || market.competitors || market.uniqueSellers || 0;

      const seller_ = seller;
      const sellerRating = seller_.positivePercent || seller_.positive_feedback || 0;
      const sellerItems = seller_.itemCount || seller_.num_items || 0;

      // Header
      let headerParts = `<span class="kx-stats-logo">KX</span>`;

      if (seoScore > 0) {
        headerParts += `
          <span class="kx-seo-bar">
            ${S.t('seo')}:
            <span class="kx-seo-track"><span class="kx-seo-fill" style="width:${seoPct}%;background:${seoFillColor};"></span></span>
            <span class="${seoColor}" style="font-weight:700;">${seoScore}/100</span>
          </span>
        `;
      }

      if (itemPrice && avgPrice) {
        const priceDiff = S.priceVsAvg(itemPrice, avgPrice);
        if (priceDiff) {
          headerParts += `<span>${S.t('price')}: <span class="${priceDiff.cssClass}">${priceDiff.text}</span></span>`;
        }
      }

      if (bestSeller?.isBestSeller) {
        headerParts += `<span class="kx-best">★ Top ${bestSeller.percentile}%</span>`;
      }

      headerParts += `<button class="kx-collapse-btn" data-kx-collapse>▲</button>`;

      // Stats line
      const statParts = [];

      if (competitorCount) {
        const compLevel = competitorCount < 20 ? S.t('compLow') : competitorCount < 100 ? S.t('compMed') : S.t('compHigh');
        const compClass = competitorCount < 20 ? 'kx-green' : competitorCount < 100 ? 'kx-orange' : 'kx-red';
        statParts.push(`<span>${S.t('competition')}: <span class="${compClass}">${compLevel}</span> (${competitorCount} ${S.t('sellers')})</span>`);
      }

      if (sellerRating) {
        if (statParts.length > 0) statParts.push('<span class="kx-sep">·</span>');
        statParts.push(`<span>${sellerRating}% ${S.t('positive')}</span>`);
      }
      if (sellerItems) {
        statParts.push('<span class="kx-sep">·</span>');
        statParts.push(`<span>${S.formatNum(sellerItems)} ${S.t('products')}</span>`);
      }

      // SEO tips
      let tipsHtml = '';
      if (seo.tips && seo.tips.length > 0) {
        tipsHtml = `<div data-kx-details style="margin-top:4px;font-size:11px;color:#666;">
          ${seo.tips.slice(0, 3).map(tip => `<div>• ${tip}</div>`).join('')}
        </div>`;
      }

      el.innerHTML = `
        <div class="kx-stats-header">${headerParts}</div>
        ${statParts.length > 0 ? `<div class="kx-stats-row" data-kx-details>${statParts.join('')}</div>` : ''}
        ${tipsHtml}
      `;

      const collapseBtn = el.querySelector('[data-kx-collapse]');
      if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
          const detailEls = el.querySelectorAll('[data-kx-details]');
          const isHidden = detailEls[0]?.style.display === 'none';
          detailEls.forEach(d => d.style.display = isHidden ? '' : 'none');
          collapseBtn.textContent = isHidden ? '▲' : '▼';
        });
      }
    }
  }
})();

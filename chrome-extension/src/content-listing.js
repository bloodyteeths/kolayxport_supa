/**
 * KolayXport Research — Etsy Listing Page
 * Auto-injects inline stats bar below listing title/price area
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
      const listingId = S.SELECTORS.listingId();
      if (!listingId) return;

      if (document.getElementById('kx-listing-stats')) return;

      const anchor = findInsertionPoint();
      if (!anchor) return;

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
      return document.querySelector('[data-buy-box-region="price"]') ||
             document.querySelector('.wt-mb-xs-2') ||
             document.querySelector('.listing-page-title-component') ||
             document.querySelector('h1')?.parentElement ||
             null;
    }

    function renderStatsBar(el, data, bestSeller) {
      const { listing, velocity, seoScore, shop } = data;
      const seo = seoScore?.total || 0;
      const seoColor = S.scoreClass(seo);
      const seoPct = Math.min(seo, 100);
      const seoFillColor = seo >= 70 ? '#4caf50' : seo >= 40 ? '#ff9800' : '#f44336';

      const est = velocity?.estMonthlySales || 0;
      const favs = listing?.favorites || 0;
      const views = listing?.views || 0;
      const age = velocity?.ageMonths || 0;
      const tagCount = listing?.tagCount || 0;

      // Header line
      let headerParts = `<span class="kx-stats-logo">KX</span>`;
      headerParts += `
        <span class="kx-seo-bar">
          ${S.t('seo')}:
          <span class="kx-seo-track"><span class="kx-seo-fill" style="width:${seoPct}%;background:${seoFillColor};"></span></span>
          <span class="${seoColor}" style="font-weight:700;">${seo}/100</span>
        </span>
      `;

      if (bestSeller?.isBestSeller) {
        headerParts += `<span class="kx-best">★ ${S.t('bestSeller')} · Top ${bestSeller.percentile}%</span>`;
      }

      headerParts += `<button class="kx-collapse-btn" data-kx-collapse>▲</button>`;

      // Stats line
      const statParts = [];
      statParts.push(`<span class="${S.salesColor(est)}">~${est}${S.t('perMonth')} ${S.t('sales')}</span>`);
      statParts.push('<span class="kx-sep">·</span>');
      statParts.push(`<span>♥ ${S.formatNum(favs)}</span>`);
      statParts.push('<span class="kx-sep">·</span>');
      statParts.push(`<span>${S.formatNum(views)} ${S.t('views')}</span>`);
      statParts.push('<span class="kx-sep">·</span>');
      statParts.push(`<span>${age} ${S.t('months')}</span>`);

      // Tag line
      let tagLine = '';
      if (tagCount > 0) {
        const tagColor = tagCount >= 13 ? 'kx-green' : tagCount >= 10 ? 'kx-orange' : 'kx-red';
        tagLine = `<span class="${tagColor}">${S.t('tags')}: ${tagCount}/13</span>`;
        if (tagCount < 13) tagLine += ` <span class="kx-red">(${13 - tagCount} ${S.t('missing')})</span>`;
      }

      // Shop line
      let shopLine = '';
      if (shop) {
        shopLine = `<span>${S.t('shop')}: ${S.formatNum(shop.num_sales || 0)} ${S.t('sales')}</span>`;
        if (shop.rating) shopLine += ` <span class="kx-sep">·</span> <span>${shop.rating.toFixed(1)}★</span>`;
      }

      let details = '';
      if (tagLine || shopLine) {
        details = `<div class="kx-stats-row" data-kx-details>${tagLine}${tagLine && shopLine ? ' <span class="kx-sep">·</span> ' : ''}${shopLine}</div>`;
      }

      let tagsHtml = '';
      if (listing?.tags && listing.tags.length > 0) {
        tagsHtml = `<div data-kx-details style="margin-top:4px;">${listing.tags.map(t => `<span class="kx-tag-pill">${t}</span>`).join('')}</div>`;
      }

      el.innerHTML = `
        <div class="kx-stats-header">${headerParts}</div>
        <div class="kx-stats-row">${statParts.join('')}</div>
        ${details}
        ${tagsHtml}
      `;

      const collapseBtn = el.querySelector('[data-kx-collapse]');
      if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
          const detailEls = el.querySelectorAll('[data-kx-details]');
          const statsRow = el.querySelector('.kx-stats-row');
          const isHidden = statsRow.style.display === 'none';

          statsRow.style.display = isHidden ? '' : 'none';
          detailEls.forEach(d => d.style.display = isHidden ? '' : 'none');
          collapseBtn.textContent = isHidden ? '▲' : '▼';
        });
      }
    }
  }
})();

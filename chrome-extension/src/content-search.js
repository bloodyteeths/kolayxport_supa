/**
 * KolayXport Research — Etsy Search Results
 * Injects: summary bar (sticky) + inline data row below each listing card
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

    if (S.getPageType() !== 'search') return;

    S.isOverlayEnabled().then(enabled => {
      if (!enabled) return;
      S.injectInlineCSS();
      processSearchPage();
      S.onUrlChange(() => {
        if (S.getPageType() === 'search') setTimeout(processSearchPage, 500);
      });
    });

    async function processSearchPage() {
      const query = S.SELECTORS.searchQuery();
      if (!query) return;

      const shadow = S.createOverlayContainer('kx-search-overlay', 'top');

      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.innerHTML = `<span style="opacity:0.8">${S.t('loading')}</span>`;

      const listingIds = extractListingIds();

      try {
        const data = await C.getOrFetch(
          `search:${query}`,
          'search',
          () => S.apiCall('search_enrich', { query, listingIds: listingIds.slice(0, 48) })
        );

        if (!data?.summary) return;
        renderSummaryBar(shadow, bar, data.summary, query);
        if (data.listingBadges) {
          injectDataRows(data.listingBadges, data.summary.avgPrice);
        }
      } catch (err) {
        bar.innerHTML = `<span style="opacity:0.7">${err.message || S.t('loadFailed')}</span>`;
      }
    }

    function extractListingIds() {
      const ids = [];
      document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
        const match = link.href.match(/\/listing\/(\d+)/);
        if (match && !ids.includes(match[1])) ids.push(match[1]);
      });
      return ids;
    }

    function renderSummaryBar(shadow, bar, summary, query) {
      const compColor = S.competitionColor(summary.competition);
      const compLabel = summary.competition === 'low' ? S.t('compLow') : summary.competition === 'medium' ? S.t('compMed') : S.t('compHigh');

      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;font-weight:700;">
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">KX</span>
          "${query}"
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('result')}</span>
          <span class="kx-bar-value">${S.formatNum(summary.totalResults)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('avgPrice')}</span>
          <span class="kx-bar-value">${S.formatPrice(summary.avgPrice)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('range')}</span>
          <span class="kx-bar-value" style="font-size:12px">${S.formatPrice(summary.minPrice)} - ${S.formatPrice(summary.maxPrice)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('avgFav')}</span>
          <span class="kx-bar-value">${S.formatNum(summary.avgFavorites)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('shops')}</span>
          <span class="kx-bar-value">${summary.uniqueShops}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('competition')}</span>
          <span class="kx-bar-value" style="color:${compColor}">${compLabel}</span>
        </div>
        <div style="margin-left:auto;">
          <a href="${S.API_BASE}/app/etsy-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            ${S.t('fullAnalysis')}
          </a>
        </div>
      `;
    }

    function injectDataRows(badges, avgPrice) {
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

        const card = link.closest('[data-listing-id]') || link.closest('.v2-listing-card') || link.parentElement;
        if (!card || card.querySelector('.kx-data-row')) return;

        const rank = ranks[id];
        const priceDiff = S.priceVsAvg(badge.price, avgPrice);
        const est = badge.estMonthlySales || 0;

        const parts = [];

        if (rank?.isBestSeller) {
          parts.push(`<span class="kx-best">★ Top ${rank.percentile}%</span>`);
          parts.push('<span class="kx-sep">·</span>');
        }

        parts.push(`<span class="${S.salesColor(est)}">~${est}${S.t('perMonth')}</span>`);
        parts.push('<span class="kx-sep">·</span>');
        parts.push(`<span>♥ ${S.formatNum(badge.favorites || 0)}</span>`);

        if (priceDiff) {
          parts.push('<span class="kx-sep">·</span>');
          parts.push(`<span class="${priceDiff.cssClass}">${priceDiff.text}</span>`);
        }

        const row = document.createElement('div');
        row.className = 'kx-data-row';
        row.innerHTML = parts.join('');
        card.appendChild(row);
      });
    }
  }
})();

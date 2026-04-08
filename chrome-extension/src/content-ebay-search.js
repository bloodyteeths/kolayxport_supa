/**
 * KolayXport Research — eBay Search Results
 * Injects: summary bar (sticky) + inline data row below each listing card
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

      const shadow = S.createOverlayContainer('kx-ebay-search-overlay', 'top');

      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.innerHTML = `<span style="opacity:0.8">${S.t('loading')}</span>`;

      const itemIds = extractItemIds();

      try {
        const data = await C.getOrFetch(
          `ebay_search:${query}`,
          'search',
          () => S.apiCall('search_enrich', { query, marketplace: 'EBAY_US', itemIds: itemIds.slice(0, 48) })
        );

        if (!data) {
          bar.innerHTML = `<span style="opacity:0.7">${S.t('loadFailed')}</span>`;
          return;
        }

        const summary = data.summary || data;
        renderSummaryBar(shadow, bar, summary, query);

        if (data.listingBadges) {
          injectDataRows(data.listingBadges, summary);
        } else if (summary.avgPrice) {
          injectPriceRows(summary);
        }
      } catch (err) {
        bar.innerHTML = `<span style="opacity:0.7">${err.message || S.t('loadFailed')}</span>`;
      }
    }

    function extractItemIds() {
      const ids = [];
      document.querySelectorAll('a[href*="/itm/"]').forEach(link => {
        const match = link.href.match(/\/itm\/(?:[^/]*\/)?(\d{8,})/);
        if (match && !ids.includes(match[1])) ids.push(match[1]);
      });
      return ids;
    }

    function renderSummaryBar(shadow, bar, summary, query) {
      const totalResults = summary.totalResults || summary.total || 0;
      const avgPrice = summary.avgPrice || summary.avg_price || 0;
      const minPrice = summary.minPrice || summary.min_price || 0;
      const maxPrice = summary.maxPrice || summary.max_price || 0;
      const uniqueSellers = summary.uniqueSellers || summary.uniqueShops || summary.unique_sellers || 0;

      let competition = summary.competition || 'medium';
      if (!summary.competition && uniqueSellers) {
        competition = uniqueSellers < 20 ? 'low' : uniqueSellers < 100 ? 'medium' : 'high';
      }

      const compColor = S.competitionColor(competition);
      const compLabel = competition === 'low' ? S.t('compLow') : competition === 'medium' ? S.t('compMed') : S.t('compHigh');

      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;font-weight:700;">
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">KX</span>
          "${query}"
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('result')}</span>
          <span class="kx-bar-value">${S.formatNum(totalResults)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('avgPrice')}</span>
          <span class="kx-bar-value">${S.formatPrice(avgPrice)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('range')}</span>
          <span class="kx-bar-value" style="font-size:12px">${S.formatPrice(minPrice)} - ${S.formatPrice(maxPrice)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('sellers')}</span>
          <span class="kx-bar-value">${uniqueSellers}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${S.t('competition')}</span>
          <span class="kx-bar-value" style="color:${compColor}">${compLabel}</span>
        </div>
        <div style="margin-left:auto;">
          <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            ${S.t('fullAnalysis')}
          </a>
        </div>
      `;
    }

    function injectDataRows(badges, summary) {
      const ranks = S.computeBestSellerRanks(badges);
      const avgPrice = summary.avgPrice || summary.avg_price || 0;
      const cards = document.querySelectorAll('.s-item');
      const processed = new Set();

      cards.forEach(card => {
        const link = card.querySelector('a[href*="/itm/"]');
        if (!link) return;

        const match = link.href.match(/\/itm\/(?:[^/]*\/)?(\d{8,})/);
        if (!match || processed.has(match[1])) return;
        processed.add(match[1]);

        const id = match[1];
        const badge = badges[id];
        if (!badge) return;
        if (card.querySelector('.kx-data-row')) return;

        const rank = ranks[id];
        const est = badge.estMonthlySales || badge.soldQuantity || 0;
        const priceDiff = S.priceVsAvg(badge.price, avgPrice);

        const parts = [];

        if (rank?.isBestSeller) {
          parts.push(`<span class="kx-best">★ Top ${rank.percentile}%</span>`);
          parts.push('<span class="kx-sep">·</span>');
        }

        parts.push(`<span class="${S.salesColor(est)}">~${est}${S.t('perMonth')}</span>`);

        if (badge.price) {
          parts.push('<span class="kx-sep">·</span>');
          parts.push(`<span>${S.formatPrice(badge.price)}</span>`);
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
    }

    function injectPriceRows(summary) {
      const avgPrice = summary.avgPrice || summary.avg_price || 0;
      if (!avgPrice) return;

      const cards = document.querySelectorAll('.s-item');
      const processed = new Set();

      cards.forEach(card => {
        const link = card.querySelector('a[href*="/itm/"]');
        if (!link) return;

        const match = link.href.match(/\/itm\/(?:[^/]*\/)?(\d{8,})/);
        if (!match || processed.has(match[1])) return;
        processed.add(match[1]);
        if (card.querySelector('.kx-data-row')) return;

        const priceEl = card.querySelector('.s-item__price');
        if (!priceEl) return;

        const priceText = priceEl.textContent.replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (!price || isNaN(price)) return;

        const priceDiff = S.priceVsAvg(price, avgPrice);
        if (!priceDiff) return;

        const row = document.createElement('div');
        row.className = 'kx-data-row';
        row.innerHTML = `<span class="${priceDiff.cssClass}">${priceDiff.text}</span>`;
        card.appendChild(row);
      });
    }
  }
})();

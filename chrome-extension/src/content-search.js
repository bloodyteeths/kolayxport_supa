/**
 * KolayXport Research — Etsy Search Results
 * Summary bar (market facts from the Etsy API) + a row under each listing card with
 * MEASURED or ESTIMATED monthly sales (see lib/etsy/listingStats.ts on the server).
 * Everything is DOM-built; listing/shop data only ever goes into textContent.
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
    let runToken = 0;

    S.isOverlayEnabled().then(enabled => {
      if (!enabled) return;
      if (S.getPageType() === 'search') {
        S.injectInlineCSS();
        processSearchPage();
      }
      S.onUrlChange(() => {
        if (S.getPageType() === 'search') {
          S.injectInlineCSS();
          setTimeout(processSearchPage, 500);
        }
      });
    });

    async function processSearchPage() {
      const query = S.SELECTORS.searchQuery();
      if (!query) return;
      const myRun = ++runToken;
      const isCurrent = () => myRun === runToken && S.SELECTORS.searchQuery() === query;

      const shadow = S.createOverlayContainer('kx-search-overlay', 'top');
      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.textContent = '';
      bar.appendChild(S.el('span', null, S.t('loading'), 'opacity:0.8'));

      let summary = null;
      try {
        const data = await C.getOrFetch(`search2:${query}`, 'search', () => S.apiCall('search_enrich', { query }));
        if (!isCurrent()) return;
        summary = data?.summary || null;
        if (summary) renderSummaryBar(bar, summary, query);
      } catch (err) {
        bar.textContent = '';
        bar.appendChild(S.el('span', null, (err && err.message) || S.t('loadFailed'), 'opacity:0.7'));
      }

      try {
        const ids = S.pageListingIds().slice(0, 96);
        if (ids.length) {
          await S.loadCardStats(ids, summary ? { price: summary.avgPrice, currency: summary.currency } : null, isCurrent);
        }
      } catch (_) { /* per-card rows are best-effort */ }
    }

    function item(label, value, valueStyle) {
      const wrap = S.el('div', 'kx-bar-item');
      wrap.appendChild(S.el('span', 'kx-bar-label', label));
      wrap.appendChild(S.el('span', 'kx-bar-value', value, valueStyle));
      return wrap;
    }

    function renderSummaryBar(bar, summary, query) {
      const compColor = S.competitionColor(summary.competition);
      const compLabel = summary.competition === 'low' ? S.t('compLow') : summary.competition === 'medium' ? S.t('compMed') : S.t('compHigh');
      const money = (n) => summary.currency ? S.formatMoney(n, summary.currency) : S.formatPrice(n);

      bar.textContent = '';
      const title = S.el('div', null, null, 'display:flex;align-items:center;gap:4px;font-weight:700;');
      title.appendChild(S.el('span', null, 'KX', 'font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;'));
      title.appendChild(S.el('span', null, '"' + query + '"'));
      bar.appendChild(title);
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(item(S.t('result'), S.formatNum(summary.totalResults)));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(item(S.t('avgPrice'), money(summary.avgPrice)));
      bar.appendChild(item(S.t('range'), money(summary.minPrice) + ' - ' + money(summary.maxPrice), 'font-size:12px'));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(item(S.t('avgFav'), S.formatNum(summary.avgFavorites)));
      bar.appendChild(item(S.t('shops'), String(summary.uniqueShops)));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(item(S.t('competition'), compLabel, 'color:' + compColor));

      const right = S.el('div', null, null, 'margin-left:auto;');
      const link = S.el('a', 'kx-btn kx-btn-sm', S.t('fullAnalysis'), 'background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;');
      link.href = S.API_BASE + '/app/etsy-research';
      link.target = '_blank';
      link.rel = 'noopener';
      right.appendChild(link);
      bar.appendChild(right);
    }
  }
})();

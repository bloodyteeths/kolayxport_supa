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

      // What the shopper sees on this page (displayed/sale prices, ads flagged) — read now,
      // before the API answers, so the bar and the per-card comparisons share one basis.
      const page = S.collectPageCards();
      const ctx = { display: page.display, market: S.pageMarket(page.display, {}) };

      let summary = null;
      try {
        const data = await C.getOrFetch(`search3:${query}`, 'search', () => S.apiCall('search_enrich', { query }));
        if (!isCurrent()) return;
        summary = data?.summary || null;
        if (summary) renderSummaryBar(bar, summary, query, ctx.market);
      } catch (err) {
        // Daily research limit / busy / signed out: one card instead of the numbers.
        if (S.showLimitCard(bar, err, 'etsy_search')) return;
        bar.textContent = '';
        bar.appendChild(S.el('span', null, (err && err.message) || S.t('loadFailed'), 'opacity:0.7'));
      }

      let limited = false;
      try {
        const ids = page.ids.slice(0, 96);
        if (ids.length) {
          await S.loadCardStats(ids, ctx, isCurrent, (_all, c) => {
            if (summary && isCurrent() && !limited) renderSummaryBar(bar, summary, query, c.market);
          });
        }
      } catch (err) {
        // Per-card rows are best-effort, but a research-limit answer replaces the bar.
        if (isCurrent()) limited = S.showLimitCard(bar, err, 'etsy_search');
      }
    }

    function item(label, value, valueStyle, title) {
      const wrap = S.el('div', 'kx-bar-item');
      if (title) wrap.title = title;
      wrap.appendChild(S.el('span', 'kx-bar-label', label));
      wrap.appendChild(S.el('span', 'kx-bar-value', value, valueStyle));
      return wrap;
    }

    /**
     * Results = Etsy API count. Price/favourites prefer the cards on this page (what the
     * shopper sees: sale prices, ads excluded, >= 5 cards); otherwise the Etsy API sample,
     * labelled as LIST prices. Range = P25–P75 ("typical"); raw min–max only in the tooltip.
     */
    function renderSummaryBar(bar, summary, query, market) {
      const compColor = S.competitionColor(summary.competition);
      const compLabel = summary.competition === 'low' ? S.t('compLow') : summary.competition === 'medium' ? S.t('compMed') : S.t('compHigh');
      const apiCur = summary.currency || 'USD';
      const apiMedian = summary.medianPrice ?? summary.avgPrice;
      const usePage = !!(market && market.price && market.price.n >= 5);
      const cur = usePage ? market.currency : apiCur;
      const money = (n) => S.formatMoney(n, cur, 2);

      bar.textContent = '';
      const title = S.el('div', null, null, 'display:flex;align-items:center;gap:4px;font-weight:700;');
      title.appendChild(S.el('span', null, 'KX', 'font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;'));
      title.appendChild(S.el('span', null, '"' + query + '"'));
      bar.appendChild(title);
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(item(S.t('result'), S.formatNum(summary.totalResults), null, S.t('sourceApi')));
      bar.appendChild(S.el('div', 'kx-bar-divider'));

      if (usePage) {
        const p = market.price;
        const tip = S.t('priceTipPage', {
          n: p.n, rawMin: money(p.rawMin), rawMax: money(p.rawMax),
          apiMedian: apiMedian ? S.formatMoney(apiMedian, apiCur, 2) : '—',
        });
        bar.appendChild(item(S.t('medianPrice'), money(p.median), null, tip));
        bar.appendChild(item(S.t('typicalRange'), money(p.p25) + ' – ' + money(p.p75), 'font-size:12px', tip));
      } else {
        const tip = S.t('priceTipApi', {
          n: summary.used ?? summary.sampled ?? 0,
          rawMin: money(summary.rawMinPrice ?? summary.minPrice), rawMax: money(summary.rawMaxPrice ?? summary.maxPrice),
        });
        bar.appendChild(item(S.t('medianListPrice'), money(apiMedian), null, tip));
        if (summary.p25Price != null && summary.p75Price != null) {
          bar.appendChild(item(S.t('typicalRange'), money(summary.p25Price) + ' – ' + money(summary.p75Price), 'font-size:12px', tip));
        }
      }
      bar.appendChild(S.el('div', 'kx-bar-divider'));

      if (market && market.favoritesN >= 5) {
        bar.appendChild(item(S.t('medianFav'), S.formatNum(market.favoritesMedian), null, S.t('favTipPage', { n: market.favoritesN })));
      } else {
        const fav = summary.medianFavorites ?? summary.avgFavorites;
        bar.appendChild(item(S.t('medianFav'), S.formatNum(fav), null, S.t('favTipApi', { n: summary.used ?? summary.sampled ?? 0 })));
      }
      const shopsTip = S.t('shopsTip', { n: summary.used ?? summary.sampled ?? 100 });
      bar.appendChild(item(S.t('shopsTop100'), String(summary.uniqueShops), null, shopsTip));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      bar.appendChild(item(S.t('competition'), compLabel, 'color:' + compColor, shopsTip));

      const right = S.el('div', null, null, 'margin-left:auto;');
      const link = S.el('a', 'kx-btn kx-btn-sm', S.t('fullAnalysis'), 'background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;');
      link.href = S.API_BASE + '/app/research/keywords?mkt=etsy&q=' + encodeURIComponent(query || '');
      link.target = '_blank';
      link.rel = 'noopener';
      right.appendChild(link);
      bar.appendChild(right);
    }
  }
})();

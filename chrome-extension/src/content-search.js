/**
 * KolayXport Research — Etsy Search Results
 * Summary bar (market facts from the Etsy API) + a row under each listing card with
 * MEASURED or ESTIMATED monthly sales (see lib/etsy/listingStats.ts on the server).
 * Everything is DOM-built; listing/shop data only ever goes into textContent.
 *
 * Progressive: the bar and a placeholder row per card render at once from what the page
 * shows (result count, displayed prices → median / P25–P75, ads, price vs median). The
 * market summary (search_enrich) and the per-card stats (listings_batch) are requested in
 * parallel and fill their slots in place as each answer arrives.
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
      // Language changed in the popup: re-render bar + card rows (cached data, same page view).
      S.onLangChange(() => {
        if (S.getPageType() === 'search') processSearchPage();
      });
    });

    async function processSearchPage() {
      const query = S.SELECTORS.searchQuery();
      if (!query) return;
      const myRun = ++runToken;
      const isCurrent = () => myRun === runToken && S.SELECTORS.searchQuery() === query;
      S.perfStart('etsy_search');

      const shadow = S.createOverlayContainer('kx-search-overlay', 'top');
      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.lang = S.lang;

      // What the shopper sees on this page (displayed/sale prices, ads flagged) — read now,
      // before the API answers, so the bar and the per-card comparisons share one basis.
      const page = S.collectPageCards();
      const ctx = { display: page.display, market: S.pageMarket(page.display, {}) };
      const view = { query, pageCount: S.readPageResultCount(), summary: null, summaryState: 'loading', market: ctx.market };
      renderSummaryBar(bar, view);
      S.perf('etsy_search', 'first_paint', { cards: page.ids.length, pagePrices: ctx.market && ctx.market.price ? ctx.market.price.n : 0 });

      let limited = false;
      const showLimit = (err) => {
        if (limited || !isCurrent()) return limited;
        // Daily research limit / busy / signed out: one card instead of the numbers.
        limited = S.showLimitCard(bar, err, 'etsy_search');
        if (limited) S.clearSkeletonRows();
        return limited;
      };

      // Summary and per-card stats in parallel; each fills its own slots.
      const summaryTask = C.getOrFetch(`search3:${query}`, 'search', () => S.apiCall('search_enrich', { query }))
        .then(data => {
          if (!isCurrent() || limited) return;
          view.summary = (data && data.summary) || null;
          view.summaryState = view.summary ? 'ok' : 'error';
          renderSummaryBar(bar, view);
          S.perf('etsy_search', 'summary');
        }, err => {
          if (showLimit(err) || !isCurrent()) return;
          view.summaryState = 'error';
          view.error = (err && err.message) || S.t('loadFailed');
          renderSummaryBar(bar, view);
        });

      const ids = page.ids.slice(0, 96);
      const cardsTask = !ids.length ? Promise.resolve() : S.loadCardStats(ids, ctx, isCurrent, (_all, c) => {
        if (!isCurrent() || limited) return;
        view.market = c.market;
        renderSummaryBar(bar, view);
      }, 'etsy_search_cards').catch(err => {
        // Per-card rows are best-effort, but a research-limit answer replaces the bar.
        showLimit(err);
      });

      await Promise.all([summaryTask, cardsTask]);
      if (isCurrent() && !limited) S.perf('etsy_search', 'full');
    }

    function item(label, value, valueStyle, title) {
      const wrap = S.el('div', 'kx-bar-item');
      if (title) wrap.title = title;
      wrap.appendChild(S.el('span', 'kx-bar-label', label));
      if (value && typeof value === 'object' && value.nodeType === 1) {
        const v = S.el('span', 'kx-bar-value', null, valueStyle);
        v.appendChild(value);
        wrap.appendChild(v);
      } else {
        wrap.appendChild(S.el('span', 'kx-bar-value', value, valueStyle));
      }
      return wrap;
    }

    /**
     * Results = the count Etsy prints on the page when readable (API count in the tooltip),
     * else the Etsy API count. Price/favourites prefer the cards on this page (what the
     * shopper sees: sale prices, ads excluded, >= 5 cards); otherwise the Etsy API sample,
     * labelled as LIST prices. Range = P25–P75 ("typical"); raw min–max only in the tooltip.
     * view.summaryState: 'loading' → placeholders where only the API can answer; 'error' → '—'.
     */
    function renderSummaryBar(bar, view) {
      const { summary, market, query, pageCount } = view;
      const loading = view.summaryState === 'loading';
      const pending = (wide) => (loading ? S.skel(wide) : '—');
      const apiCur = (summary && summary.currency) || 'USD';
      const apiMedian = summary ? (summary.medianPrice ?? summary.avgPrice) : null;
      const usePage = !!(market && market.price && market.price.n >= 5);
      const cur = usePage ? market.currency : apiCur;
      const money = (n) => S.formatMoney(n, cur, 2);

      bar.textContent = '';
      bar.lang = S.lang;
      bar.dataset.kxState = loading ? 'partial' : 'full';
      const title = S.el('div', null, null, 'display:flex;align-items:center;gap:4px;font-weight:700;');
      title.appendChild(S.el('span', null, 'KX', 'font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;'));
      title.appendChild(S.el('span', null, '"' + query + '"'));
      bar.appendChild(title);
      bar.appendChild(S.el('div', 'kx-bar-divider'));

      if (pageCount !== null && pageCount !== undefined) {
        bar.appendChild(item(S.t('result'), S.formatNum(pageCount), null,
          S.t('resultTipPage', { api: summary ? S.formatNum(summary.totalResults) : '…' })));
      } else {
        bar.appendChild(item(S.t('result'), summary ? S.formatNum(summary.totalResults) : pending(), null, S.t('sourceApi')));
      }
      bar.appendChild(S.el('div', 'kx-bar-divider'));

      if (usePage) {
        const p = market.price;
        const tip = S.t('priceTipPage', {
          n: p.n, rawMin: money(p.rawMin), rawMax: money(p.rawMax),
          apiMedian: apiMedian ? S.formatMoney(apiMedian, apiCur, 2) : '—',
        });
        bar.appendChild(item(S.t('medianPrice'), money(p.median), null, tip));
        bar.appendChild(item(S.t('typicalRange'), money(p.p25) + ' – ' + money(p.p75), 'font-size:12px', tip));
      } else if (summary) {
        const tip = S.t('priceTipApi', {
          n: summary.used ?? summary.sampled ?? 0,
          rawMin: money(summary.rawMinPrice ?? summary.minPrice), rawMax: money(summary.rawMaxPrice ?? summary.maxPrice),
        });
        bar.appendChild(item(S.t('medianListPrice'), money(apiMedian), null, tip));
        if (summary.p25Price != null && summary.p75Price != null) {
          bar.appendChild(item(S.t('typicalRange'), money(summary.p25Price) + ' – ' + money(summary.p75Price), 'font-size:12px', tip));
        }
      } else {
        bar.appendChild(item(S.t('medianPrice'), pending()));
        bar.appendChild(item(S.t('typicalRange'), pending(true), 'font-size:12px'));
      }
      bar.appendChild(S.el('div', 'kx-bar-divider'));

      if (market && market.favoritesN >= 5) {
        bar.appendChild(item(S.t('medianFav'), S.formatNum(market.favoritesMedian), null, S.t('favTipPage', { n: market.favoritesN })));
      } else if (summary) {
        const fav = summary.medianFavorites ?? summary.avgFavorites;
        bar.appendChild(item(S.t('medianFav'), S.formatNum(fav), null, S.t('favTipApi', { n: summary.used ?? summary.sampled ?? 0 })));
      } else {
        bar.appendChild(item(S.t('medianFav'), pending()));
      }
      const shopsTip = S.t('shopsTip', { n: (summary && (summary.used ?? summary.sampled)) ?? 100 });
      bar.appendChild(item(S.t('shopsTop100'), summary ? String(summary.uniqueShops) : pending(), null, shopsTip));
      bar.appendChild(S.el('div', 'kx-bar-divider'));
      if (summary) {
        const compLabel = summary.competition === 'low' ? S.t('compLow') : summary.competition === 'medium' ? S.t('compMed') : S.t('compHigh');
        bar.appendChild(item(S.t('competition'), compLabel, 'color:' + S.competitionColor(summary.competition), shopsTip));
      } else {
        bar.appendChild(item(S.t('competition'), pending(), null, shopsTip));
      }
      if (market && market.ads > 0) {
        bar.appendChild(S.el('div', 'kx-bar-divider'));
        bar.appendChild(item(S.t('adsOnPage'), String(market.ads), null, S.t('adsTip', { n: market.cards + market.ads })));
      }

      const right = S.el('div', null, null, 'margin-left:auto;display:flex;align-items:center;gap:8px;');
      if (view.summaryState === 'error' && view.error) right.appendChild(S.el('span', 'kx-bar-label', view.error));
      const link = S.el('a', 'kx-btn kx-btn-sm', S.t('fullAnalysis'), 'background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;');
      link.href = S.API_BASE + '/app/research/keywords?mkt=etsy&q=' + encodeURIComponent(query || '');
      link.target = '_blank';
      link.rel = 'noopener';
      right.appendChild(link);
      bar.appendChild(right);
    }
  }
})();

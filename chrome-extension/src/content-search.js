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

    /**
     * Results = the count Etsy prints on the page when readable (API count in the "i"),
     * else the Etsy API count. Price/favourites prefer the cards on this page (what the
     * shopper sees: sale prices, ads excluded, >= 5 cards); otherwise the Etsy API sample,
     * labelled as LIST prices. "Most prices" = P25–P75; raw min–max only in the "i".
     * view.summaryState: 'loading' → placeholders where only the API can answer; 'error' → '—'.
     * Compact row: results, typical price, most prices, typical favourites, competition.
     * "More": different shops, ads, source + sample sizes.
     */
    function renderSummaryBar(bar, view) {
      const U = S.UI;
      const { summary, market, query, pageCount } = view;
      const loading = view.summaryState === 'loading';
      const pending = (wide) => (loading ? S.skel(wide) : '—');
      const apiCur = (summary && summary.currency) || 'USD';
      const apiMedian = summary ? (summary.medianPrice ?? summary.avgPrice) : null;
      const usePage = !!(market && market.price && market.price.n >= 5);
      const cur = usePage ? market.currency : apiCur;
      const money = (n) => S.formatMoney(n, cur, 2);
      const apiN = summary ? (summary.used ?? summary.sampled ?? 0) : null;
      const chip = (o) => U.chip(document, o);
      const chips = [];
      const more = [];

      // Results
      if (pageCount !== null && pageCount !== undefined) {
        chips.push(chip({ key: 'results', label: S.t('result'), value: S.formatNum(pageCount), info: {
          plain: S.t('plainResults'), formula: S.t('resultTipPage', { api: summary ? S.formatNum(summary.totalResults) : '…' }),
          source: ['etsyPage'], confidence: 'exact' } }));
      } else {
        chips.push(chip({ key: 'results', label: S.t('result'), value: summary ? S.formatNum(summary.totalResults) : pending(),
          info: { plain: S.t('plainResults'), source: ['etsyApi'], confidence: 'exact' } }));
      }

      // Typical price + most prices
      if (usePage) {
        const p = market.price;
        const tip = S.t('priceTipPage', {
          n: p.n, rawMin: money(p.rawMin), rawMax: money(p.rawMax),
          apiMedian: apiMedian ? S.formatMoney(apiMedian, apiCur, 2) : '—',
        });
        const confidence = p.n >= 10 ? 'high' : 'medium';
        chips.push(chip({ key: 'price', label: S.t('medianPrice'), value: money(p.median),
          info: { plain: S.t('plainTypicalPrice'), formula: tip, source: ['etsyPage'], confidence } }));
        chips.push(chip({ key: 'range', label: S.t('typicalRange'), value: money(p.p25) + ' – ' + money(p.p75),
          info: { plain: S.t('plainRange'), formula: S.t('formulaRange') + ' ' + tip, source: ['etsyPage'], confidence } }));
      } else if (summary) {
        const tip = S.t('priceTipApi', {
          n: apiN,
          rawMin: money(summary.rawMinPrice ?? summary.minPrice), rawMax: money(summary.rawMaxPrice ?? summary.maxPrice),
        });
        chips.push(chip({ key: 'price', label: S.t('medianListPrice'), value: money(apiMedian),
          info: { plain: S.t('plainTypicalPrice'), formula: tip, source: ['etsyApi'], confidence: 'medium' } }));
        if (summary.p25Price != null && summary.p75Price != null) {
          chips.push(chip({ key: 'range', label: S.t('typicalRange'), value: money(summary.p25Price) + ' – ' + money(summary.p75Price),
            info: { plain: S.t('plainRange'), formula: S.t('formulaRange') + ' ' + tip, source: ['etsyApi'], confidence: 'medium' } }));
        }
      } else {
        chips.push(chip({ key: 'price', label: S.t('medianPrice'), value: pending() }));
        chips.push(chip({ key: 'range', label: S.t('typicalRange'), value: pending(true) }));
      }

      // Typical favourites
      if (market && market.favoritesN >= 5) {
        chips.push(chip({ key: 'favorites', label: S.t('medianFav'), value: S.formatNum(market.favoritesMedian),
          info: { plain: S.t('plainFav'), formula: S.t('favTipPage', { n: market.favoritesN }), source: ['etsyApi', 'etsyPage'], confidence: market.favoritesN >= 10 ? 'high' : 'medium' } }));
      } else if (summary) {
        const fav = summary.medianFavorites ?? summary.avgFavorites;
        chips.push(chip({ key: 'favorites', label: S.t('medianFav'), value: S.formatNum(fav),
          info: { plain: S.t('plainFav'), formula: S.t('favTipApi', { n: apiN }), source: ['etsyApi'], confidence: 'medium' } }));
      } else {
        chips.push(chip({ key: 'favorites', label: S.t('medianFav'), value: pending() }));
      }

      // Competition (words + colour)
      const shopsTip = S.t('shopsTip', { n: apiN ?? 100 });
      const compConf = apiN >= 50 ? 'medium' : 'low';
      if (summary) {
        const compLabel = summary.competition === 'low' ? S.t('compLow') : summary.competition === 'medium' ? S.t('compMed') : S.t('compHigh');
        chips.push(chip({ key: 'competition', label: S.t('competition'), value: U.pill(document, compLabel, U.competitionTone(summary.competition)),
          info: { plain: S.t('plainCompetition'), formula: shopsTip, source: ['etsyApi'], confidence: compConf } }));
      } else {
        chips.push(chip({ key: 'competition', label: S.t('competition'), value: pending() }));
      }

      // "More" row
      more.push(chip({ key: 'shops', label: S.t('shopsTop100'), value: summary ? String(summary.uniqueShops) : pending(),
        info: { plain: S.t('plainShops'), formula: shopsTip, source: ['etsyApi'], confidence: 'exact' } }));
      if (market && market.ads > 0) {
        more.push(chip({ key: 'ads', label: S.t('adsOnPage'), value: String(market.ads),
          info: { plain: S.t('plainAds'), formula: S.t('adsTip', { n: market.cards + market.ads }), source: ['etsyPage'], confidence: 'medium' } }));
      }
      if (view.summaryState === 'error' && view.error) more.push(S.el('span', 'kx-err', view.error));
      more.push(U.note(document, S.t('etsySourceNote', { page: market ? market.cards + market.ads : 0, api: summary ? apiN : '…' })));

      const verdict = summary ? U.verdict(summary.competition) : null;
      U.topBar(bar, {
        title: '"' + query + '"',
        verdict: verdict || (loading ? S.skel(true) : null),
        chips,
        more,
        state: loading ? 'partial' : 'full',
        link: { href: S.API_BASE + '/app/research/keywords?mkt=etsy&q=' + encodeURIComponent(query || ''), text: S.t('fullAnalysis') },
      });
    }
  }
})();

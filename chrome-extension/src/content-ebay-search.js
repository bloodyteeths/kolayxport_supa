/**
 * KolayXport Research — eBay Search Results
 * Injects: summary bar + inline data row below each listing card.
 *
 * Where each number comes from (see lib/ebayMath.js buildSearchSummary):
 * - Results: the count eBay prints on the page ("9,500+ results"); the Browse
 *   API total only when the page heading is missing.
 * - Median / typical price, sellers, sold depth: KolayXport API → eBay Browse API
 *   (best-match top 50, same marketplace). Falls back to parsing the cards on
 *   the page when the API is unavailable or the page has filters (sold items,
 *   price range, condition, sort...) that the API call does not apply.
 * - Competition: computeCompetition() over the four inputs above.
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_EBAY_SHARED && window.__KX_CACHE && window.__KX_EBAY_MATH) { cb(); return; }
    if (attempts > 50) return;
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_EBAY_SHARED;
    const C = window.__KX_CACHE;
    const M = window.__KX_EBAY_MATH;
    const esc = S.escape;

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
      // Language changed in the popup: re-render bar + rows (cached API answer).
      S.onLangChange(() => {
        if (S.getPageType() === 'search') processSearchPage();
      });
    });

    async function processSearchPage() {
      const query = S.SELECTORS.searchQuery();
      if (!query) return;
      const mkt = S.getMarketplace();

      const shadow = S.createOverlayContainer('kx-ebay-search-overlay', 'top');

      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.innerHTML = `<span style="opacity:0.8">${esc(S.t('loading'))}</span>`;

      const page = M.parseSearchPage(document, { currency: mkt.currency });
      const refinements = M.pageRefinements(location.search);

      // API is skipped when the page is filtered: its sample would not match the cards.
      let api = null;
      let apiError = null;
      if (!refinements.length) {
        try {
          api = await C.getOrFetch(
            `ebay_search:v2:${mkt.id}:${query.toLowerCase()}`,
            'search',
            () => S.apiCall('search_enrich', { query, marketplace: mkt.id })
          );
        } catch (err) {
          apiError = err;
        }
      }

      // Daily research limit / busy: one card instead of the numbers.
      if (apiError && S.showLimitCard(bar, apiError, 'ebay_search')) return;

      const summary = M.buildSearchSummary({ api, page, refinements });
      if (!summary.items.length && !summary.resultCount) {
        bar.innerHTML = `<span style="opacity:0.7">${esc((apiError && apiError.message) || S.t('loadFailed'))}</span>`;
        return;
      }

      renderSummaryBar(bar, summary, query);
      injectDataRows(summary, page);
    }

    function renderSummaryBar(bar, summary, query) {
      const p = summary.price;
      let priceHtml;
      let rangeHtml;
      if (!p || p.quality === 'insufficient' || p.median == null) {
        priceHtml = esc(S.t('notEnough'));
        rangeHtml = '—';
      } else if (p.quality === 'implausible') {
        priceHtml = esc(S.t('unusual'));
        rangeHtml = `${esc(S.formatPrice(p.p25, p.currency))} – ${esc(S.formatPrice(p.p75, p.currency))}`;
      } else {
        priceHtml = esc(S.formatPrice(p.median, p.currency));
        rangeHtml = `${esc(S.formatPrice(p.p25, p.currency))} – ${esc(S.formatPrice(p.p75, p.currency))}`;
      }

      const sel = summary.sellers;
      const sellersHtml = sel.known >= 5
        ? `${sel.distinct} <span class="kx-bar-label">${esc(S.t('distinctOf', { n: sel.known }))}</span>`
        : '—';

      const sold = summary.sold;
      const soldHtml = sold.known >= 5
        ? esc(S.t('withSales', { k: sold.withSales, n: sold.known }))
        : '—';

      const comp = summary.competition;
      const factorKey = { results: 'factorResults', sold: 'factorSold', sellers: 'factorSellers', price: 'factorPrice' };
      const compTitle = comp.score == null ? '' :
        S.t('compScore', { score: comp.score }) + ' · ' +
        comp.used.map(k => `${factorKey[k] ? S.t(factorKey[k]) : k} ${Math.round(comp.factors[k] * 100)}`).join(', ');

      const sampled = summary.source === 'api' && p && p.sampled ? p.sampled : summary.items.length;
      const sourceText = summary.source === 'api'
        ? S.t('srcApi', { n: sampled })
        : S.t('srcPage', { n: summary.items.length });

      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;font-weight:700;">
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">KX</span>
          "${esc(query)}"
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${esc(S.t('result'))}</span>
          <span class="kx-bar-value">${esc(S.formatCount(summary.resultCount))}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${esc(S.t('avgPrice'))}</span>
          <span class="kx-bar-value">${priceHtml}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${esc(S.t('range'))}</span>
          <span class="kx-bar-value" style="font-size:12px">${rangeHtml}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${esc(S.t('sellers'))}</span>
          <span class="kx-bar-value">${sellersHtml}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">${esc(S.t('soldDepth'))}</span>
          <span class="kx-bar-value" style="font-size:12px">${soldHtml}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item" title="${esc(compTitle)}">
          <span class="kx-bar-label">${esc(S.t('competition'))} (${esc(S.t('estTag'))})</span>
          <span class="kx-bar-value" style="color:${S.competitionColor(comp.level)}">${esc(S.competitionLabel(comp.level))}</span>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span class="kx-bar-label">${esc(sourceText)}</span>
          <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            ${esc(S.t('fullAnalysis'))}
          </a>
        </div>
      `;
    }

    function injectDataRows(summary, page) {
      const p = summary.price;
      const median = p && p.quality !== 'insufficient' && p.quality !== 'implausible' ? p.median : null;
      const medianCurrency = p ? p.currency : null;
      const ranks = M.bestSellerRanks(summary.items);
      const byId = {};
      for (const it of summary.items) if (it.id) byId[it.id] = it;

      for (const card of page.items) {
        if (!card.el) continue;
        // Re-render (e.g. language change) replaces our old row instead of stacking a second one.
        const oldRow = card.el.querySelector('.kx-data-row');
        if (oldRow) oldRow.remove();
        const it = byId[card.id] || card;
        const parts = [];
        const rank = ranks[card.id];

        if (rank && rank.isBestSeller) {
          parts.push(`<span class="kx-best">★ ${esc(S.t('topBySold', { p: rank.percentile }))}</span>`);
        }

        const soldCount = Number.isFinite(it.soldCount) ? it.soldCount : card.soldCount;
        if (Number.isFinite(soldCount)) {
          const plus = it.soldCount === soldCount ? it.soldPlus : card.soldPlus;
          parts.push(`<span>${esc(S.formatInt(soldCount))}${plus ? '+' : ''} ${esc(S.t('sold'))}</span>`);
          const perMo = M.estMonthlySales(soldCount, it.createdAt);
          if (perMo != null) {
            parts.push(`<span class="${S.salesColor(perMo)}">≈${esc(S.formatInt(perMo))}${esc(S.t('perMonth'))} (${esc(S.t('estTag'))})</span>`);
          }
        }

        // Compare the card's own price with the median, same currency only, single prices only.
        const price = card.price != null ? card.price : it.price;
        const cur = card.price != null ? card.currency : it.currency;
        const isRange = card.priceMax != null && card.price != null && card.priceMax !== card.price;
        if (median && price && !isRange && (!medianCurrency || !cur || cur === medianCurrency)) {
          const diff = S.priceVsMedian(price, median);
          if (diff) parts.push(`<span class="${diff.cssClass}">${esc(diff.text)}</span>`);
        }

        if (!parts.length) continue;
        const row = document.createElement('div');
        row.className = 'kx-data-row';
        row.innerHTML = parts.join('<span class="kx-sep">·</span>');
        card.el.appendChild(row);
      }
    }
  }
})();

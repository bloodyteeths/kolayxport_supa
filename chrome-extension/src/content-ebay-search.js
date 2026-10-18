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
 *
 * Progressive: the bar and the card rows render at once from the page (result count, displayed
 * prices, "N sold" on cards, sellers); the API answer then replaces them in place. The server
 * looks sold quantities up only for the cards in the first viewport (ENRICH_VISIBLE) and answers
 * within ~4 s; cards whose lookup was still running show a placeholder and are re-polled
 * (a free shared-cache hit on the server).
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
    /** Sold-quantity lookups the server makes per search: about the first viewport of cards. */
    const ENRICH_VISIBLE = 8;
    const REPOLL_MS = 2500;
    const REPOLL_ROUNDS = 2;
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
      // Language changed in the popup: re-render bar + rows (cached API answer).
      S.onLangChange(() => {
        if (S.getPageType() === 'search') processSearchPage();
      });
    });

    /** Ids of the cards in (or just below) the first viewport, page order, at most `n`. */
    function firstViewportIds(page, n) {
      const h = window.innerHeight || 800;
      const out = [];
      for (const card of page.items) {
        if (!card.id || !card.el || out.length >= n) continue;
        const r = card.el.getBoundingClientRect ? card.el.getBoundingClientRect() : null;
        if (r && r.top > h * 1.2) continue;
        out.push(String(card.id));
      }
      return out;
    }

    async function processSearchPage() {
      const query = S.SELECTORS.searchQuery();
      if (!query) return;
      const mkt = S.getMarketplace();
      const myRun = ++runToken;
      const isCurrent = () => myRun === runToken && S.SELECTORS.searchQuery() === query;
      S.perfStart('ebay_search');

      const shadow = S.createOverlayContainer('kx-ebay-search-overlay', 'top');

      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }

      const page = M.parseSearchPage(document, { currency: mkt.currency });
      const refinements = M.pageRefinements(location.search);
      // API is skipped when the page is filtered: its sample would not match the cards.
      const callApi = !refinements.length;
      const enrichIds = callApi ? firstViewportIds(page, ENRICH_VISIBLE) : [];

      // Instant: everything the page itself shows.
      const state = { loading: callApi, pending: new Set(enrichIds) };
      const pageSummary = M.buildSearchSummary({ api: null, page, refinements });
      if (pageSummary.items.length || pageSummary.resultCount) {
        renderSummaryBar(bar, pageSummary, query, state);
        injectDataRows(pageSummary, page, state);
      } else if (callApi) {
        bar.innerHTML = `<span style="opacity:0.8">${esc(S.t('loading'))}</span>`;
      } else {
        bar.innerHTML = `<span style="opacity:0.7">${esc(S.t('loadFailed'))}</span>`;
        return;
      }
      S.perf('ebay_search', 'first_paint', { cards: page.items.length });
      if (!callApi) return;

      const key = `ebay_search:v2:${mkt.id}:${query.toLowerCase()}`;
      const params = { query, marketplace: mkt.id, enrichIds };
      let api = null;
      let apiError = null;
      try {
        api = await C.getOrFetch(key, 'search', () => S.apiCall('search_enrich', params));
      } catch (err) {
        apiError = err;
      }
      if (!isCurrent()) return;

      // Daily research limit / busy: one card instead of the numbers.
      if (apiError && S.showLimitCard(bar, apiError, 'ebay_search')) {
        stripRowPlaceholders();
        return;
      }

      const apply = (data, final) => {
        const summary = M.buildSearchSummary({ api: data, page, refinements });
        const pendingIds = data && Array.isArray(data.pendingIds) ? data.pendingIds.map(String) : [];
        state.loading = false;
        state.pending = final ? new Set() : new Set(pendingIds);
        if (!summary.items.length && !summary.resultCount) {
          bar.innerHTML = `<span style="opacity:0.7">${esc((apiError && apiError.message) || S.t('loadFailed'))}</span>`;
          return pendingIds;
        }
        renderSummaryBar(bar, summary, query, state);
        injectDataRows(summary, page, state);
        return pendingIds;
      };

      let pendingIds = apply(api, false);
      S.perf('ebay_search', 'api', { pending: pendingIds.length });

      // Sold lookups the server had not finished within its time box: re-poll (shared-cache hit).
      for (let round = 0; round < REPOLL_ROUNDS && pendingIds.length && api; round++) {
        await new Promise(r => setTimeout(r, REPOLL_MS));
        if (!isCurrent()) return;
        let fresh = null;
        try { fresh = await S.apiCall('search_enrich', params); } catch (_) { fresh = null; }
        if (!isCurrent()) return;
        if (!fresh || !Array.isArray(fresh.items)) break;
        api = fresh;
        try { if (C.set) C.set(key, fresh, 'search'); } catch (_) { /* best effort */ }
        pendingIds = apply(api, false);
      }
      if (pendingIds.length) apply(api, true); // give up: unknown, not a placeholder forever
      S.perf('ebay_search', 'full', { pending: pendingIds.length });
    }

    function stripRowPlaceholders() {
      document.querySelectorAll('.kx-data-row [data-kx-skel]').forEach(n => {
        const row = n.closest('.kx-data-row');
        n.remove();
        if (row && !row.textContent.replace(/[·\s]/g, '')) row.remove();
      });
    }

    /** state.loading: the API has not answered yet → placeholders where the page has no answer. */
    function renderSummaryBar(bar, summary, query, state) {
      const loading = !!(state && state.loading);
      const p = summary.price;
      let priceHtml;
      let rangeHtml;
      if (!p || p.quality === 'insufficient' || p.median == null) {
        priceHtml = loading ? S.skel() : esc(S.t('notEnough'));
        rangeHtml = loading ? S.skel(true) : '—';
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
        : loading ? S.skel(true) : '—';

      const sold = summary.sold;
      const soldHtml = sold.known >= 5
        ? esc(S.t('withSales', { k: sold.withSales, n: sold.known }))
        : loading ? S.skel(true) : '—';

      const comp = summary.competition;
      const factorKey = { results: 'factorResults', sold: 'factorSold', sellers: 'factorSellers', price: 'factorPrice' };
      const compTitle = comp.score == null ? '' :
        S.t('compScore', { score: comp.score }) + ' · ' +
        comp.used.map(k => `${factorKey[k] ? S.t(factorKey[k]) : k} ${Math.round(comp.factors[k] * 100)}`).join(', ');

      const sampled = summary.source === 'api' && p && p.sampled ? p.sampled : summary.items.length;
      const sourceText = summary.source === 'api'
        ? S.t('srcApi', { n: sampled })
        : S.t('srcPage', { n: summary.items.length });
      const compHtml = loading && comp.level === 'unknown' ? S.skel() : esc(S.competitionLabel(comp.level));
      bar.dataset.kxState = loading ? 'partial' : 'full';

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
          <span class="kx-bar-value" style="color:${S.competitionColor(comp.level)}">${compHtml}</span>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span class="kx-bar-label">${loading ? S.skel(true) : esc(sourceText)}</span>
          <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            ${esc(S.t('fullAnalysis'))}
          </a>
        </div>
      `;
    }

    /** state.pending: card ids whose sold count the API is still looking up (placeholder in the sold slot). */
    function injectDataRows(summary, page, state) {
      const pendingSold = (state && state.pending) || new Set();
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
        if (!Number.isFinite(soldCount) && pendingSold.has(String(card.id))) {
          parts.push(S.skel(true));
        } else if (Number.isFinite(soldCount)) {
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

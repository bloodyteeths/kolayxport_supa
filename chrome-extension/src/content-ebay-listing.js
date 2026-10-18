/**
 * KolayXport Research — eBay Listing Page
 * Auto-injects inline stats bar below item title area
 *
 * Progressive: renders at once from the page (sold count, price) with placeholders; the item
 * details, the title SEO analysis and the best-seller search run in parallel and each fills
 * its slots as it returns.
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
      if (S.getPageType() === 'listing') {
        S.injectInlineCSS();
        processListingPage();
      }
      S.onUrlChange(() => {
        if (S.getPageType() === 'listing') {
          S.injectInlineCSS();
          setTimeout(processListingPage, 500);
        }
      });
      // Language changed in the popup: rebuild the panel (cached API answers).
      S.onLangChange(() => {
        if (S.getPageType() !== 'listing') return;
        const old = document.getElementById('kx-ebay-listing-stats');
        if (old) old.remove();
        processListingPage();
      });
    });

    async function processListingPage(retries = 0) {
      const itemId = S.SELECTORS.itemId();
      if (!itemId) return;

      if (document.getElementById('kx-ebay-listing-stats')) return;

      const anchor = findInsertionPoint();
      if (!anchor) {
        if (retries < 5) {
          setTimeout(() => processListingPage(retries + 1), 500);
        }
        return;
      }

      S.perfStart('ebay_listing');
      const statsBar = document.createElement('div');
      statsBar.id = 'kx-ebay-listing-stats';
      statsBar.className = 'kx-stats-bar';
      anchor.insertAdjacentElement('afterend', statsBar);

      const title = S.SELECTORS.itemTitle();
      const mkt = S.getMarketplace();
      const pageData = M.parseListingPage(document, { currency: mkt.currency });
      const isCurrent = () => S.SELECTORS.itemId() === itemId && statsBar.isConnected;

      // Instant: page sold count / price, placeholders for the API slots.
      const st = {
        item: null, seo: null, best: null, ui: { collapsed: false },
        loading: { item: true, seo: !!title, best: false },
      };
      const searchWords = (title || '').split(/\s+/).slice(0, 4).join(' ');
      st.loading.best = searchWords.length > 3;
      const paint = () => { if (isCurrent() && !limited) renderStatsBar(statsBar, st, pageData); };
      let limited = false;
      paint();
      S.perf('ebay_listing', 'first_paint');

      let limitErr = null;
      const keepLimit = (e) => {
        if (!limitErr && e && e.limitInfo) limitErr = e;
        // Daily research limit / busy: one card instead of the numbers.
        if (limitErr && !limited && isCurrent() && S.showLimitCard(statsBar, limitErr, 'ebay_listing')) limited = true;
        return null;
      };

      const itemTask = C.getOrFetch(
        `ebay_listing:v2:${mkt.id}:${itemId}`,
        'listing',
        () => S.apiCall('listing_enrich', { itemId, marketplace: mkt.id })
      ).catch(keepLimit).then(d => { st.item = d; st.loading.item = false; paint(); S.perf('ebay_listing', 'item'); });

      const seoTask = !title ? Promise.resolve() : C.getOrFetch(
        `ebay_seo:v2:${mkt.id}:${itemId}`,
        'listing',
        () => S.apiCall('seo_analyze', { query: title.split(/\s+/).slice(0, 5).join(' '), title, marketplace: mkt.id })
      ).catch(keepLimit).then(d => { st.seo = d; st.loading.seo = false; paint(); S.perf('ebay_listing', 'seo'); });

      // Best seller check: rank by eBay sold estimate among best-match results for the first
      // 4 title words (only the enriched results carry a sold estimate). Parallel with the rest.
      const bestTask = !st.loading.best ? Promise.resolve() : C.getOrFetch(
        `ebay_search:v2:${mkt.id}:${searchWords.toLowerCase()}`,
        'search',
        () => S.apiCall('search_enrich', { query: searchWords, marketplace: mkt.id })
      ).then(searchData => {
        if (searchData && Array.isArray(searchData.items)) {
          const ranks = M.bestSellerRanks(searchData.items.map(M.normalizeApiItem).filter(Boolean));
          st.best = ranks[itemId] || null;
        }
      }, () => {}).then(() => { st.loading.best = false; paint(); });

      await Promise.all([itemTask, seoTask, bestTask]);
      if (!isCurrent() || limited) return;
      if (!st.item && !st.seo && pageData.soldCount == null) {
        statsBar.remove();
        return;
      }
      S.perf('ebay_listing', 'full');
    }

    function findInsertionPoint() {
      return document.querySelector('.x-item-title') ||
             document.querySelector('h1.x-item-title__mainTitle')?.parentElement ||
             document.querySelector('#itemTitle')?.parentElement ||
             document.querySelector('h1[data-testid="x-item-title"]')?.parentElement ||
             document.querySelector('#mainContent h1')?.parentElement ||
             null;
    }

    /** Render server SEO recommendations ({ key, params }) as text. */
    function tipText(rec) {
      if (!rec) return '';
      if (typeof rec === 'string') return rec;
      const map = { titleShorterThanCompetitors: 'tipShorter', fewTopKeywords: 'tipFewKeywords', topKeywords: 'tipTopKeywords' };
      return map[rec.key] ? S.t(map[rec.key], rec.params || {}) : '';
    }

    /** One renderer for every stage; st.loading.{item,seo,best} → placeholders in those slots. */
    function renderStatsBar(el, st, pageData) {
      const bestSeller = st.best;
      const loading = st.loading;
      el.dataset.kxState = loading.item || loading.seo || loading.best ? 'partial' : 'full';
      // get_item_details returns the raw Browse API item.
      const item = st.item || {};
      const seo = st.seo || {};
      const seller = item.seller || {};

      // seoScore = share of the 20 most common competitor title keywords found in this title.
      const seoScore = Number.isFinite(seo.seoScore) ? seo.seoScore : null;
      const seoColor = S.scoreClass(seoScore || 0);
      const seoPct = Math.min(seoScore || 0, 100);
      const seoFillColor = seoScore >= 70 ? '#4caf50' : seoScore >= 40 ? '#ff9800' : '#f44336';

      // Browse API price is { value: "25.99", currency: "USD" }.
      const itemPrice = item.price ? parseFloat(item.price.value) : (pageData && pageData.price);
      const itemCurrency = item.price ? item.price.currency : (pageData && pageData.currency);
      const ps = seo.priceStats || null;
      const median = ps && ps.quality !== 'insufficient' && ps.quality !== 'implausible' && (!itemCurrency || ps.currency === itemCurrency) ? ps.median : null;

      const avail = (item.estimatedAvailabilities || [])[0] || {};
      const apiSold = Number.isFinite(avail.estimatedSoldQuantity) ? avail.estimatedSoldQuantity : null;
      const apiRemaining = Number.isFinite(avail.estimatedRemainingQuantity) ? avail.estimatedRemainingQuantity : null;
      const soldCount = apiSold != null ? apiSold : (pageData ? pageData.soldCount : null);
      const soldPlus = apiSold == null && pageData ? pageData.soldPlus : false;

      const sellerPct = seller.feedbackPercentage != null ? parseFloat(seller.feedbackPercentage) : null;
      const sellerScore = Number.isFinite(seller.feedbackScore) ? seller.feedbackScore : null;

      // Header
      let headerParts = `<span class="kx-stats-logo">KX</span>`;

      if (seoScore == null && loading.seo) {
        headerParts += `<span class="kx-seo-bar">${esc(S.t('seo'))}: ${S.skel(true)}</span>`;
      }
      if (seoScore != null) {
        headerParts += `
          <span class="kx-seo-bar" title="${esc(S.t('titleCoverage'))}">
            ${esc(S.t('seo'))}:
            <span class="kx-seo-track"><span class="kx-seo-fill" style="width:${seoPct}%;background:${seoFillColor};"></span></span>
            <span class="${seoColor}" style="font-weight:700;">${seoScore}/100</span>
          </span>
        `;
      }

      if (itemPrice && median) {
        const priceDiff = S.priceVsMedian(itemPrice, median);
        if (priceDiff) {
          headerParts += `<span>${esc(S.t('price'))}: <span class="${priceDiff.cssClass}">${esc(priceDiff.text)}</span> (${esc(S.formatPrice(median, ps.currency))})</span>`;
        }
      }

      if (bestSeller && bestSeller.isBestSeller) {
        headerParts += `<span class="kx-best">★ ${esc(S.t('topBySold', { p: bestSeller.percentile }))}</span>`;
      }

      if (loading.best) headerParts += S.skel();

      headerParts += `<button class="kx-collapse-btn" data-kx-collapse>${st.ui.collapsed ? '▼' : '▲'}</button>`;

      // Stats line
      const statParts = [];

      if (soldCount != null) {
        let txt = `${S.formatInt(soldCount)}${soldPlus ? '+' : ''} ${S.t('sold')}`;
        const perMo = M.estMonthlySales(soldCount, item.itemCreationDate);
        if (perMo != null) txt += ` · ≈${S.formatInt(perMo)}${S.t('perMonth')} (${S.t('estTag')})`;
        statParts.push(`<span>${esc(txt)}</span>`);
        const st = M.sellThrough(apiSold, apiRemaining);
        if (st != null) {
          statParts.push(`<span>${esc(S.t('sellThrough'))}: ${esc(S.t('pct', { n: Math.round(st * 100) }))} (${esc(S.formatInt(apiRemaining))} ${esc(S.t('available'))}, ${esc(S.t('estTag'))})</span>`);
        }
      }

      if (soldCount == null && loading.item) statParts.push(S.skel(true));

      if (loading.seo) {
        statParts.push(`<span>${esc(S.t('competition'))} (${esc(S.t('estTag'))}): ${S.skel(true)}</span>`);
      } else if (Number.isFinite(seo.totalCompetitors) && seo.totalCompetitors > 0) {
        const comp = M.computeCompetition({ resultCount: seo.totalCompetitors, price: ps });
        const compClass = comp.level === 'low' ? 'kx-green' : comp.level === 'medium' ? 'kx-orange' : comp.level === 'high' ? 'kx-red' : '';
        statParts.push(`<span>${esc(S.t('competition'))} (${esc(S.t('estTag'))}): <span class="${compClass}">${esc(S.competitionLabel(comp.level))}</span> (${esc(S.formatInt(seo.totalCompetitors))} ${esc(S.t('competingListings'))})</span>`);
      }

      if (loading.item) {
        statParts.push(S.skel(true));
      } else if (sellerPct != null && Number.isFinite(sellerPct)) {
        statParts.push(`<span>${esc(seller.username || '')} ${esc(S.t('pct', { n: sellerPct.toLocaleString(S.locale(), { maximumFractionDigits: 1 }) }))} ${esc(S.t('positive'))}${sellerScore != null ? ` (${esc(S.formatInt(sellerScore))} ${esc(S.t('feedback'))})` : ''}</span>`);
      }

      // SEO tips
      let tipsHtml = '';
      const tips = (seo.recommendations || []).map(tipText).filter(Boolean);
      if (tips.length > 0) {
        tipsHtml = `<div data-kx-details style="margin-top:4px;font-size:11px;color:#666;">
          ${tips.slice(0, 3).map(tip => `<div>• ${esc(tip)}</div>`).join('')}
        </div>`;
      }

      el.innerHTML = `
        <div class="kx-stats-header">${headerParts}</div>
        ${statParts.length > 0 ? `<div class="kx-stats-row" data-kx-details>${statParts.join('<span class="kx-sep">·</span>')}</div>` : ''}
        ${tipsHtml}
      `;

      const detailEls = el.querySelectorAll('[data-kx-details]');
      if (st.ui.collapsed) detailEls.forEach(d => { d.style.display = 'none'; });
      const collapseBtn = el.querySelector('[data-kx-collapse]');
      if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
          st.ui.collapsed = !st.ui.collapsed;
          el.querySelectorAll('[data-kx-details]').forEach(d => { d.style.display = st.ui.collapsed ? 'none' : ''; });
          collapseBtn.textContent = st.ui.collapsed ? '▼' : '▲';
        });
      }
    }
  }
})();

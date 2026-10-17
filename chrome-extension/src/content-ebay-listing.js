/**
 * KolayXport Research — eBay Listing Page
 * Auto-injects inline stats bar below item title area
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

      const statsBar = document.createElement('div');
      statsBar.id = 'kx-ebay-listing-stats';
      statsBar.className = 'kx-stats-bar';
      statsBar.innerHTML = `
        <div class="kx-stats-header">
          <span class="kx-stats-logo">KX</span>
          <span>${esc(S.t('loading'))}</span>
        </div>
      `;
      anchor.insertAdjacentElement('afterend', statsBar);

      const title = S.SELECTORS.itemTitle();
      const mkt = S.getMarketplace();
      const pageData = M.parseListingPage(document, { currency: mkt.currency });

      try {
        let limitErr = null;
        const keepLimit = (e) => { if (!limitErr && e && e.limitInfo) limitErr = e; return null; };
        const [itemData, seoData] = await Promise.all([
          C.getOrFetch(
            `ebay_listing:v2:${mkt.id}:${itemId}`,
            'listing',
            () => S.apiCall('listing_enrich', { itemId, marketplace: mkt.id })
          ).catch(keepLimit),
          title ? C.getOrFetch(
            `ebay_seo:v2:${mkt.id}:${itemId}`,
            'listing',
            () => S.apiCall('seo_analyze', { query: title.split(/\s+/).slice(0, 5).join(' '), title, marketplace: mkt.id })
          ).catch(keepLimit) : null,
        ]);

        // Daily research limit / busy: one card instead of the numbers.
        if (limitErr && S.showLimitCard(statsBar, limitErr, 'ebay_listing')) return;

        if (!itemData && !seoData && pageData.soldCount == null) {
          statsBar.remove();
          return;
        }

        // Best seller check: rank by eBay sold estimate among best-match results
        // for the first 4 title words (only the first 20 results carry a sold estimate).
        let bestSellerInfo = null;
        try {
          const searchWords = (title || '').split(/\s+/).slice(0, 4).join(' ');
          if (searchWords.length > 3) {
            const searchData = await C.getOrFetch(
              `ebay_search:v2:${mkt.id}:${searchWords.toLowerCase()}`,
              'search',
              () => S.apiCall('search_enrich', { query: searchWords, marketplace: mkt.id })
            );
            if (searchData && Array.isArray(searchData.items)) {
              const ranks = M.bestSellerRanks(searchData.items.map(M.normalizeApiItem).filter(Boolean));
              bestSellerInfo = ranks[itemId] || null;
            }
          }
        } catch (_) {}

        renderStatsBar(statsBar, itemData, seoData, bestSellerInfo, pageData);
      } catch (err) {
        statsBar.innerHTML = `
          <div class="kx-stats-header">
            <span class="kx-stats-logo">KX</span>
            <span>${esc(err.message || S.t('loadFailed'))}</span>
          </div>
        `;
      }
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

    function renderStatsBar(el, itemData, seoData, bestSeller, pageData) {
      // get_item_details returns the raw Browse API item.
      const item = itemData || {};
      const seo = seoData || {};
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

      headerParts += `<button class="kx-collapse-btn" data-kx-collapse>▲</button>`;

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

      if (Number.isFinite(seo.totalCompetitors) && seo.totalCompetitors > 0) {
        const comp = M.computeCompetition({ resultCount: seo.totalCompetitors, price: ps });
        const compClass = comp.level === 'low' ? 'kx-green' : comp.level === 'medium' ? 'kx-orange' : comp.level === 'high' ? 'kx-red' : '';
        statParts.push(`<span>${esc(S.t('competition'))} (${esc(S.t('estTag'))}): <span class="${compClass}">${esc(S.competitionLabel(comp.level))}</span> (${esc(S.formatInt(seo.totalCompetitors))} ${esc(S.t('competingListings'))})</span>`);
      }

      if (sellerPct != null && Number.isFinite(sellerPct)) {
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

      const collapseBtn = el.querySelector('[data-kx-collapse]');
      if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
          const detailEls = el.querySelectorAll('[data-kx-details]');
          const isHidden = detailEls[0]?.style.display === 'none';
          detailEls.forEach(d => d.style.display = isHidden ? '' : 'none');
          collapseBtn.textContent = isHidden ? '▲' : '▼';
        });
      }
    }
  }
})();

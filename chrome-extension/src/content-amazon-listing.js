/**
 * KolayXport Research — Amazon Listing Page Overlay
 *
 * Sales: Amazon's own "X+ bought in past month" when shown (a floor), else a
 * BSR-model estimate labelled as such. BSR comes from the page, or from the
 * official Amazon SP-API (via the KolayXport server) when the page has none.
 */

(function () {
  'use strict';

  const shared = window.__kxAmzShared;
  if (!shared || !shared.math) { console.warn('[KX] Amazon shared not loaded'); return; }

  const M = shared.math;
  const esc = M.escapeHtml;
  const {
    injectAmazonCSS, extractAsinFromUrl, extractBsrInfo, extractPriceFromPage,
    extractReviewCount, extractRating, extractBoughtFromPage, requestSpApiSignals,
    detectAmazonMarketplace, observeUrlChanges, KX_AMZ_PREFIX,
  } = shared;
  const t = shared.t;
  const money = shared.formatMoney;
  const compact = shared.formatCompact;
  const int = shared.formatInt;

  // Nothing renders until the language is known (lib/lang.js): no flash of the wrong language.
  let langReady = false;
  let currentAsin = null;
  let spForAsin = { asin: null, data: null };
  let spLimit = { asin: null, resp: null }; // 429 research-limit answer for this ASIN

  function isProductPage() {
    return !!extractAsinFromUrl() || !!document.getElementById('dp-container');
  }

  // Referral fee only: 15% is the most common Amazon referral rate (categories
  // range ~8–17%). FBA fees depend on size/weight and are NOT estimated here.
  function estimateReferral(price) {
    if (!price) return null;
    const fee = Math.max(0.30, price * 0.15);
    return { fee, net: price - fee };
  }

  function stat(value, label, cls, tip) {
    return `<div title="${esc(tip || '')}">
      <div style="font-size:18px;font-weight:800" class="${cls || ''}">${value}</div>
      <div style="font-size:10px;color:#999">${label}</div>
    </div>`;
  }

  function render(asin) {
    const marketplace = detectAmazonMarketplace();
    const sp = spForAsin.asin === asin ? spForAsin.data : null;

    const domBsr = extractBsrInfo();
    const bsr = domBsr || (sp && sp.bsr ? { rank: sp.bsr, category: sp.bsrCategory, sub: [], fromApi: true } : null);
    const priceObj = extractPriceFromPage(marketplace) ||
      (sp && sp.buyBoxPrice ? { value: sp.buyBoxPrice, currency: sp.currency } : null);
    const price = priceObj ? priceObj.value : null;
    const currency = priceObj ? priceObj.currency : shared.KX_AMZ_DEFAULT_CURRENCY[marketplace];
    const reviewCount = extractReviewCount(marketplace);
    const rating = extractRating();
    const bought = extractBoughtFromPage(marketplace);

    const fig = M.pickSalesFigure({ bought, price, bsr: bsr && bsr.rank, bsrCategory: bsr && bsr.category, marketplace });
    // When Amazon's floor is shown, still offer the BSR model as a secondary view.
    const bsrEst = bsr ? M.estimateSalesFromBsr(bsr.rank, bsr.category, marketplace) : null;
    const referral = estimateReferral(price);

    const sidebar = document.getElementById('rightCol') || document.getElementById('desktop_buybox');
    const insertTarget = sidebar || document.querySelector('#centerCol');
    if (!insertTarget) return;
    injectAmazonCSS();

    let widget = document.getElementById(`${KX_AMZ_PREFIX}-widget`);
    if (!widget) {
      widget = document.createElement('div');
      widget.id = `${KX_AMZ_PREFIX}-widget`;
      widget.style.cssText = `
        background: #fff; border: 2px solid #FF9900; border-radius: 10px;
        padding: 14px; margin: 10px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px; color: #333; line-height: 1.6;
      `;
      if (sidebar) sidebar.insertBefore(widget, sidebar.firstChild);
      else insertTarget.appendChild(widget);
    }

    // Daily research limit / busy: one card instead of the numbers.
    if (spLimit.asin === asin && spLimit.resp && shared.showLimitCard(widget, spLimit.resp, 'amazon_listing')) return;

    let salesBlock;
    if (fig.kind === 'amazon') {
      salesBlock = `<div style="display:flex;gap:14px;margin-top:4px;flex-wrap:wrap">
          ${stat(esc(fig.label), esc(t('boughtLastMonth')), 'kx-green', t('boughtLastMonthTip'))}
          ${fig.revenueFloor ? stat('≥' + esc(money(fig.revenueFloor, currency, true)), esc(t('revFloor')), 'kx-green', t('revFloorShortTip')) : ''}
        </div>
        ${bsrEst ? `<div style="font-size:10px;color:#999;margin-top:2px">${esc(t('bsrCompare', { units: compact(bsrEst.units), low: compact(bsrEst.low), high: compact(bsrEst.high) }))}</div>` : ''}`;
    } else if (fig.kind === 'estimate') {
      salesBlock = `<div style="display:flex;gap:14px;margin-top:4px;flex-wrap:wrap">
          ${stat('~' + esc(compact(fig.units)), esc(t('estSales')), 'kx-orange', t('estSalesTip', { low: int(fig.low), high: int(fig.high) }))}
          ${fig.revenue ? stat('~' + esc(money(fig.revenue, currency, true)), esc(t('estRevenue')), 'kx-orange') : ''}
        </div>
        <div style="font-size:10px;color:#999;margin-top:2px">${esc(t('estFromBsr', { curve: fig.curve, low: compact(fig.low), high: compact(fig.high) }) + (fig.calibrated ? '' : t('curveUncalibrated')) + t('noBoughtFigure'))}</div>`;
    } else {
      salesBlock = `<div style="color:#999">${esc(t('noSalesData'))}</div>`;
    }

    const bsrLine = bsr
      ? esc(t('bsrIn', { rank: int(bsr.rank), cat: bsr.category || '—' }))
      : '';
    const subRanks = bsr && bsr.sub && bsr.sub.length
      ? bsr.sub.slice(0, 2).map((r) => esc(t('subRankIn', { rank: int(r.rank), cat: r.category }))).join(' · ')
      : '';

    widget.lang = shared.lang;
    widget.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">
        <span class="kx-amz-badge" style="font-size:11px;padding:3px 8px">KolayXport</span>
        <span style="font-weight:700;font-size:13px">${esc(t('productIntel'))}</span>
      </div>

      <div style="margin-bottom:8px">
        <div style="font-weight:600;color:#666;font-size:11px">${esc(t('sales'))}</div>
        ${salesBlock}
      </div>

      ${bsr ? `
      <div style="margin-bottom:8px;font-size:11px">
        <strong>${bsrLine}</strong>
        ${subRanks ? `<span style="color:#999"> · ${subRanks}</span>` : ''}
        ${bsr.fromApi ? `<span style="color:#999">${esc(t('officialData'))}</span>` : ''}
      </div>` : ''}

      ${(reviewCount != null || rating != null || (sp && sp.offerCountAny != null)) ? `
      <div style="display:flex;gap:8px;margin-bottom:8px;font-size:11px;flex-wrap:wrap">
        ${rating != null ? `<span>★ ${esc(shared.formatRating(rating))}</span>` : ''}
        ${reviewCount != null ? `<span class="kx-sep">|</span><span>${esc(t('ratings', { n: int(reviewCount) }))}</span>` : ''}
        ${sp && sp.offerCountAny != null ? `<span class="kx-sep">|</span><span title="${esc(t('offersTip'))}">${esc(t('offers', { n: int(sp.offerCountAny) }))}</span>` : ''}
      </div>` : ''}

      ${referral ? `
      <div style="background:#f9f9f9;border-radius:6px;padding:8px;margin-bottom:8px;font-size:11px">
        <div style="font-weight:600;color:#666;margin-bottom:2px">${esc(t('feeTitle'))}</div>
        ${esc(t('referral'))}: <strong>${esc(money(referral.fee, currency))}</strong>
        <span class="kx-sep">|</span> ${esc(t('afterReferral'))}: <strong>${esc(money(referral.net, currency))}</strong>
        <div style="color:#999;font-size:10px">${esc(t('feeNote'))}</div>
      </div>` : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="kx-ai-btn kx-btn-ai">${esc(t('aiAnalysis'))}</button>
        <button class="kx-ai-btn kx-btn-research" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)">${esc(t('marketResearch'))}</button>
      </div>

      <div style="margin-top:8px;font-size:10px;color:#bbb;text-align:center">
        ASIN: ${esc(asin)} | ${marketplace}
      </div>
    `;

    widget.querySelector('.kx-btn-ai')?.addEventListener('click', () => {
      window.open(`https://kolayxport.com/app/research/products?mkt=amazon&q=${encodeURIComponent(asin)}`, '_blank');
    });
    widget.querySelector('.kx-btn-research')?.addEventListener('click', () => {
      const q = (document.getElementById('productTitle')?.textContent || document.title.split(':')[0] || asin).trim();
      window.open('https://kolayxport.com/app/research/products?mkt=amazon&q=' + encodeURIComponent(q), '_blank');
    });
  }

  function injectListingWidget() {
    const asin = extractAsinFromUrl();
    if (!asin) return;
    const isNew = asin !== currentAsin;
    currentAsin = asin;
    render(asin);

    if (isNew) {
      requestSpApiSignals([asin], detectAmazonMarketplace()).then((resp) => {
        if (currentAsin !== asin || !resp) return;
        if (resp.reason === 'research_limit' && resp.limit) {
          spLimit = { asin, resp };
          render(asin);
          return;
        }
        if (!resp.available || !resp.items || !resp.items[asin]) return;
        spForAsin = { asin, data: resp.items[asin] };
        render(asin);
      });
    }
  }

  function processListingPage() {
    if (!langReady || !isProductPage()) return;
    injectListingWidget();
  }

  // Re-render a few times: BSR and the "bought" badge load lazily.
  shared.langReady().then(() => {
    langReady = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(processListingPage, 500));
    } else {
      setTimeout(processListingPage, 500);
    }
    setTimeout(processListingPage, 2000);
    setTimeout(processListingPage, 4000);
  });

  // Language changed in the popup: re-render the widget in place.
  shared.onLangChange(() => {
    if (langReady && currentAsin && currentAsin === extractAsinFromUrl()) render(currentAsin);
  });

  observeUrlChanges(() => {
    currentAsin = null;
    spForAsin = { asin: null, data: null };
    spLimit = { asin: null, resp: null };
    setTimeout(processListingPage, 1000);
  });
})();

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

  let currentAsin = null;
  let spForAsin = { asin: null, data: null };

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

    let salesBlock;
    if (fig.kind === 'amazon') {
      salesBlock = `<div style="display:flex;gap:14px;margin-top:4px;flex-wrap:wrap">
          ${stat(esc(fig.label), 'Bought last month (Amazon)', 'kx-green', "Amazon's own figure: a floor, not an exact count")}
          ${fig.revenueFloor ? stat('≥' + esc(M.formatMoney(fig.revenueFloor, currency, true)), 'Revenue/mo (floor)', 'kx-green', "Amazon's floor × current price") : ''}
        </div>
        ${bsrEst ? `<div style="font-size:10px;color:#999;margin-top:2px">BSR model for comparison: est. ~${M.formatCompact(bsrEst.units)}/mo (range ${M.formatCompact(bsrEst.low)}–${M.formatCompact(bsrEst.high)})</div>` : ''}`;
    } else if (fig.kind === 'estimate') {
      salesBlock = `<div style="display:flex;gap:14px;margin-top:4px;flex-wrap:wrap">
          ${stat('~' + M.formatCompact(fig.units), 'Est. sales/mo', 'kx-orange', `Range ${fig.low}–${fig.high}/mo`)}
          ${fig.revenue ? stat('~' + esc(M.formatMoney(fig.revenue, currency, true)), 'Est. revenue/mo', 'kx-orange') : ''}
        </div>
        <div style="font-size:10px;color:#999;margin-top:2px">Estimate from BSR (${esc(fig.curve)} curve), likely range ${M.formatCompact(fig.low)}–${M.formatCompact(fig.high)}/mo.${fig.calibrated ? '' : ' Curve is calibrated on amazon.com; likely overstates this marketplace.'} Amazon shows no "bought in past month" figure for this item.</div>`;
    } else {
      salesBlock = '<div style="color:#999">No sales data: no "bought in past month" figure and no Best Seller Rank on this page.</div>';
    }

    widget.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">
        <span class="kx-amz-badge" style="font-size:11px;padding:3px 8px">KolayXport</span>
        <span style="font-weight:700;font-size:13px">Product Intelligence</span>
      </div>

      <div style="margin-bottom:8px">
        <div style="font-weight:600;color:#666;font-size:11px">Sales</div>
        ${salesBlock}
      </div>

      ${bsr ? `
      <div style="margin-bottom:8px;font-size:11px">
        <strong>BSR #${bsr.rank.toLocaleString()}</strong> in ${esc(bsr.category || '—')}
        ${bsr.sub && bsr.sub.length ? `<span style="color:#999"> · ${bsr.sub.slice(0, 2).map((r) => `#${r.rank.toLocaleString()} in ${esc(r.category)}`).join(' · ')}</span>` : ''}
        ${bsr.fromApi ? '<span style="color:#999"> (official Amazon data)</span>' : ''}
      </div>` : ''}

      ${(reviewCount != null || rating != null || (sp && sp.offerCountAny != null)) ? `
      <div style="display:flex;gap:8px;margin-bottom:8px;font-size:11px;flex-wrap:wrap">
        ${rating != null ? `<span>★ ${rating.toFixed(1)}</span>` : ''}
        ${reviewCount != null ? `<span class="kx-sep">|</span><span>${reviewCount.toLocaleString()} ratings</span>` : ''}
        ${sp && sp.offerCountAny != null ? `<span class="kx-sep">|</span><span title="Competing offers on this ASIN (official Amazon API)">${sp.offerCountAny} offers</span>` : ''}
      </div>` : ''}

      ${referral ? `
      <div style="background:#f9f9f9;border-radius:6px;padding:8px;margin-bottom:8px;font-size:11px">
        <div style="font-weight:600;color:#666;margin-bottom:2px">Fee estimate (rough)</div>
        Referral ~15%: <strong>${esc(M.formatMoney(referral.fee, currency))}</strong>
        <span class="kx-sep">|</span> After referral: <strong>${esc(M.formatMoney(referral.net, currency))}</strong>
        <div style="color:#999;font-size:10px">Referral rates vary by category (about 8–17%). FBA fulfilment fees depend on size and weight and are not included.</div>
      </div>` : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="kx-ai-btn kx-btn-ai">AI Analysis</button>
        <button class="kx-ai-btn kx-btn-research" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)">Market Research</button>
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
        if (currentAsin !== asin || !resp || !resp.available || !resp.items || !resp.items[asin]) return;
        spForAsin = { asin, data: resp.items[asin] };
        render(asin);
      });
    }
  }

  function processListingPage() {
    if (!isProductPage()) return;
    injectListingWidget();
  }

  // Re-render a few times: BSR and the "bought" badge load lazily.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(processListingPage, 500));
  } else {
    setTimeout(processListingPage, 500);
  }
  setTimeout(processListingPage, 2000);
  setTimeout(processListingPage, 4000);

  observeUrlChanges(() => {
    currentAsin = null;
    spForAsin = { asin: null, data: null };
    setTimeout(processListingPage, 1000);
  });
})();

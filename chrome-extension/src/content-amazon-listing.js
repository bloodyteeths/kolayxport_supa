/**
 * KolayXport Research — Amazon Listing Page Overlay
 * Shows sales estimate, BSR history, fee calculator, AI analysis on product pages.
 */

(function () {
  'use strict';

  const shared = window.__kxAmzShared;
  if (!shared) { console.warn('[KX] Amazon shared not loaded'); return; }

  const {
    injectAmazonCSS, extractAsinFromUrl, extractBsr, extractCategory,
    extractPriceFromPage, extractReviewCount, extractRating,
    estimateMonthlySales, detectAmazonMarketplace, observeUrlChanges,
    formatNumber, salesColor, KX_AMZ_PREFIX,
  } = shared;

  let currentAsin = null;

  // ---------------------------------------------------------------------------
  // Check if we're on a product page
  // ---------------------------------------------------------------------------
  function isProductPage() {
    return !!extractAsinFromUrl() || !!document.getElementById('dp-container');
  }

  // ---------------------------------------------------------------------------
  // Fee calculation (simplified client-side)
  // ---------------------------------------------------------------------------
  function estimateFees(price) {
    if (!price) return null;
    const referralFee = Math.max(0.30, price * 0.15);
    const fbaFee = 4.75; // Standard size default
    const totalFees = referralFee + fbaFee;
    return {
      referralFee: referralFee.toFixed(2),
      fbaFee: fbaFee.toFixed(2),
      totalFees: totalFees.toFixed(2),
      netAfterFees: (price - totalFees).toFixed(2),
      feePct: ((totalFees / price) * 100).toFixed(1),
    };
  }

  // ---------------------------------------------------------------------------
  // Inject sidebar widget
  // ---------------------------------------------------------------------------
  function injectListingWidget() {
    const asin = extractAsinFromUrl();
    if (!asin || asin === currentAsin) return;
    currentAsin = asin;

    // Remove previous widget
    const existing = document.getElementById(`${KX_AMZ_PREFIX}-widget`);
    if (existing) existing.remove();

    const bsr = extractBsr();
    const price = extractPriceFromPage();
    const reviewCount = extractReviewCount();
    const rating = extractRating();
    const category = extractCategory();
    const marketplace = detectAmazonMarketplace();

    const monthlySales = bsr ? estimateMonthlySales(bsr, category) : null;
    const monthlyRevenue = monthlySales && price ? monthlySales * price : null;
    const fees = price ? estimateFees(price) : null;

    const confidence = bsr
      ? (bsr <= 5000 ? 'High' : bsr <= 50000 ? 'Medium' : 'Low')
      : 'N/A';

    // Find insertion point
    const sidebar = document.getElementById('rightCol') || document.getElementById('desktop_buybox');
    const insertTarget = sidebar || document.querySelector('#centerCol');
    if (!insertTarget) return;

    injectAmazonCSS();

    const widget = document.createElement('div');
    widget.id = `${KX_AMZ_PREFIX}-widget`;
    widget.style.cssText = `
      background: #fff; border: 2px solid #FF9900; border-radius: 10px;
      padding: 14px; margin: 10px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px; color: #333; line-height: 1.6;
    `;

    widget.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #f0f0f0">
        <span class="kx-amz-badge" style="font-size:11px;padding:3px 8px">KolayXport</span>
        <span style="font-weight:700;font-size:13px">Product Intelligence</span>
      </div>

      ${bsr ? `
      <div style="margin-bottom:8px">
        <div style="font-weight:600;color:#666;font-size:11px">BSR & Sales Estimate</div>
        <div style="display:flex;gap:12px;margin-top:4px">
          <div>
            <div style="font-size:18px;font-weight:800;color:#333">#${bsr.toLocaleString()}</div>
            <div style="font-size:10px;color:#999">Best Seller Rank</div>
          </div>
          <div>
            <div style="font-size:18px;font-weight:800" class="${salesColor(monthlySales)}">~${formatNumber(monthlySales)}</div>
            <div style="font-size:10px;color:#999">Est. Monthly Sales</div>
          </div>
          ${monthlyRevenue ? `
          <div>
            <div style="font-size:18px;font-weight:800;color:#2e7d32">$${formatNumber(Math.round(monthlyRevenue))}</div>
            <div style="font-size:10px;color:#999">Est. Monthly Revenue</div>
          </div>
          ` : ''}
        </div>
        <div style="font-size:10px;color:#999;margin-top:2px">Confidence: ${confidence}</div>
      </div>
      ` : '<div style="color:#999;margin-bottom:8px">BSR not found on this page</div>'}

      ${reviewCount != null ? `
      <div style="display:flex;gap:8px;margin-bottom:8px;font-size:11px">
        <span>★ ${rating || '?'}</span>
        <span class="kx-sep">|</span>
        <span>${formatNumber(reviewCount)} reviews</span>
        ${reviewCount < 50 ? '<span class="kx-green">(Low competition!)</span>' :
          reviewCount < 200 ? '<span class="kx-orange">(Moderate)</span>' :
          '<span class="kx-red">(High competition)</span>'}
      </div>
      ` : ''}

      ${fees ? `
      <div style="background:#f9f9f9;border-radius:6px;padding:8px;margin-bottom:8px">
        <div style="font-weight:600;color:#666;font-size:11px;margin-bottom:4px">FBA Fee Estimate</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px">
          <span>Referral: <strong>$${fees.referralFee}</strong></span>
          <span class="kx-sep">|</span>
          <span>FBA: <strong>$${fees.fbaFee}</strong></span>
          <span class="kx-sep">|</span>
          <span>Total: <strong>$${fees.totalFees}</strong> (${fees.feePct}%)</span>
        </div>
        <div style="margin-top:4px;font-weight:700;color:#2e7d32">
          Net after fees: $${fees.netAfterFees}
        </div>
      </div>
      ` : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="kx-ai-btn" onclick="window.open('https://kolayxport.com/app/amazon-research?asin=${asin}', '_blank')">
          🤖 AI Analysis
        </button>
        <button class="kx-ai-btn" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)" onclick="window.open('https://kolayxport.com/app/amazon-research?q=' + encodeURIComponent(document.title.split('-')[0]?.trim() || '${asin}'), '_blank')">
          🔍 Market Research
        </button>
      </div>

      <div style="margin-top:8px;font-size:10px;color:#bbb;text-align:center">
        ASIN: ${asin} | ${marketplace}
      </div>
    `;

    // Insert at the top of sidebar or before buy box
    if (sidebar) {
      sidebar.insertBefore(widget, sidebar.firstChild);
    } else {
      insertTarget.appendChild(widget);
    }
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------
  function processListingPage() {
    if (!isProductPage()) return;
    injectListingWidget();
  }

  // Wait for page content to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(processListingPage, 500));
  } else {
    setTimeout(processListingPage, 500);
  }

  // Also try after a delay for lazy-loaded content
  setTimeout(processListingPage, 2000);
  setTimeout(processListingPage, 4000);

  // URL change detection (Amazon SPA navigation)
  observeUrlChanges(() => {
    currentAsin = null;
    setTimeout(processListingPage, 1000);
  });
})();

/**
 * KolayXport Research — Amazon Search Results Overlay
 * Adds inline sales estimates, revenue, competition scores on search pages.
 */

(function () {
  'use strict';

  const shared = window.__kxAmzShared;
  if (!shared) { console.warn('[KX] Amazon shared not loaded'); return; }

  const { injectAmazonCSS, extractAsinFromElement, extractPrice, estimateMonthlySales,
          detectAmazonMarketplace, observeUrlChanges, formatNumber, salesColor,
          KX_AMZ_PREFIX } = shared;

  let processed = new Set();

  // ---------------------------------------------------------------------------
  // Check if we're on a search page
  // ---------------------------------------------------------------------------
  function isSearchPage() {
    return window.location.pathname.startsWith('/s') ||
           window.location.search.includes('k=') ||
           document.querySelector('.s-main-slot');
  }

  // ---------------------------------------------------------------------------
  // Inject data row into a search result card
  // ---------------------------------------------------------------------------
  function enrichSearchResult(card) {
    const asin = extractAsinFromElement(card);
    if (!asin || processed.has(asin)) return;
    processed.add(asin);

    // Extract price
    const priceEl = card.querySelector('.a-price');
    const price = extractPrice(priceEl);

    // Extract review count
    const reviewEl = card.querySelector('.a-size-small .a-link-normal, [data-csa-c-func-deps="aui-da-a-popover"] + span a');
    let reviewCount = null;
    if (reviewEl) {
      const match = (reviewEl.textContent || '').match(/([\d,]+)/);
      if (match) reviewCount = parseInt(match[1].replace(/,/g, ''), 10);
    }

    // Extract rating
    const ratingEl = card.querySelector('.a-icon-alt');
    let rating = null;
    if (ratingEl) {
      const match = (ratingEl.textContent || '').match(/([\d.]+)/);
      if (match) rating = parseFloat(match[1]);
    }

    // Extract BSR from sponsored badge or estimate from position
    // (BSR isn't available on search results, so we estimate from position)
    const position = Array.from(card.parentElement?.children || []).indexOf(card) + 1;
    const estimatedBsr = position * 500; // Rough estimate: position 1 ≈ BSR 500

    const monthlySales = estimateMonthlySales(estimatedBsr);
    const monthlyRevenue = price ? monthlySales * price : null;

    // Check if already injected
    if (card.querySelector(`.${KX_AMZ_PREFIX}-row`)) return;

    // Create data row
    const row = document.createElement('div');
    row.className = `kx-data-row ${KX_AMZ_PREFIX}-row`;
    row.innerHTML = `
      <span class="kx-amz-badge">KX</span>
      <span class="${salesColor(monthlySales)}">~${formatNumber(monthlySales)}/mo</span>
      <span class="kx-sep">|</span>
      ${monthlyRevenue ? `<span class="kx-green">$${formatNumber(Math.round(monthlyRevenue))}/mo</span><span class="kx-sep">|</span>` : ''}
      ${reviewCount != null ? `<span>${formatNumber(reviewCount)} reviews</span><span class="kx-sep">|</span>` : ''}
      ${rating ? `<span>★ ${rating}</span><span class="kx-sep">|</span>` : ''}
      <span style="color:#999">${asin}</span>
      <button class="kx-ai-btn" data-asin="${asin}" title="Analyze with KolayXport AI">🔍 AI</button>
    `;

    // Insert after the price or at the bottom
    const insertTarget = card.querySelector('.a-section.a-spacing-small') || card;
    insertTarget.appendChild(row);

    // AI button handler
    row.querySelector('.kx-ai-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetAsin = e.target.getAttribute('data-asin');
      window.open(`https://kolayxport.com/app/amazon-research?asin=${targetAsin}`, '_blank');
    });
  }

  // ---------------------------------------------------------------------------
  // Summary stats bar
  // ---------------------------------------------------------------------------
  function injectSummaryBar() {
    if (document.getElementById(`${KX_AMZ_PREFIX}-summary`)) return;

    const resultsContainer = document.querySelector('.s-main-slot');
    if (!resultsContainer) return;

    // Collect all visible cards
    const cards = resultsContainer.querySelectorAll('[data-asin]:not([data-asin=""])');
    if (cards.length < 3) return;

    const prices = [];
    const reviews = [];
    const ratings = [];

    cards.forEach(card => {
      const priceEl = card.querySelector('.a-price');
      const p = extractPrice(priceEl);
      if (p) prices.push(p);

      const revEl = card.querySelector('.a-size-small .a-link-normal');
      if (revEl) {
        const m = (revEl.textContent || '').match(/([\d,]+)/);
        if (m) reviews.push(parseInt(m[1].replace(/,/g, ''), 10));
      }

      const ratEl = card.querySelector('.a-icon-alt');
      if (ratEl) {
        const m = (ratEl.textContent || '').match(/([\d.]+)/);
        if (m) ratings.push(parseFloat(m[1]));
      }
    });

    const avgPrice = prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2) : 'N/A';
    const avgReviews = reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : 'N/A';
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 'N/A';
    const competitionLabel = typeof avgReviews === 'number' && avgReviews < 200 ? 'Low' : avgReviews < 500 ? 'Medium' : 'High';
    const compColor = competitionLabel === 'Low' ? 'kx-green' : competitionLabel === 'Medium' ? 'kx-orange' : 'kx-red';

    const bar = document.createElement('div');
    bar.id = `${KX_AMZ_PREFIX}-summary`;
    bar.className = 'kx-stats-bar';
    bar.innerHTML = `
      <div class="kx-stats-header">
        <span class="kx-stats-logo">KolayXport</span>
        Amazon Market Analysis (${cards.length} products)
      </div>
      <div class="kx-stats-row">
        <span>Avg Price: <strong>$${avgPrice}</strong></span>
        <span class="kx-sep">|</span>
        <span>Price Range: <strong>$${prices.length ? Math.min(...prices).toFixed(2) : 'N/A'} – $${prices.length ? Math.max(...prices).toFixed(2) : 'N/A'}</strong></span>
        <span class="kx-sep">|</span>
        <span>Avg Reviews: <strong>${formatNumber(avgReviews)}</strong></span>
        <span class="kx-sep">|</span>
        <span>Avg Rating: <strong>★ ${avgRating}</strong></span>
        <span class="kx-sep">|</span>
        <span>Competition: <strong class="${compColor}">${competitionLabel}</strong></span>
        <span class="kx-sep">|</span>
        <button class="kx-ai-btn" onclick="window.open('https://kolayxport.com/app/amazon-research?q=' + encodeURIComponent(new URLSearchParams(window.location.search).get('k') || ''), '_blank')">
          🤖 Deep AI Analysis
        </button>
      </div>
    `;

    resultsContainer.parentElement?.insertBefore(bar, resultsContainer);
  }

  // ---------------------------------------------------------------------------
  // Main process
  // ---------------------------------------------------------------------------
  function processSearchPage() {
    if (!isSearchPage()) return;

    injectAmazonCSS();
    injectSummaryBar();

    const cards = document.querySelectorAll('[data-asin]:not([data-asin=""])');
    cards.forEach(enrichSearchResult);
  }

  // Initial run
  setTimeout(processSearchPage, 1000);

  // Observe DOM changes (Amazon lazy-loads results)
  const observer = new MutationObserver(() => {
    if (isSearchPage()) processSearchPage();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // URL change detection
  observeUrlChanges(() => {
    processed = new Set();
    setTimeout(processSearchPage, 1000);
  });
})();

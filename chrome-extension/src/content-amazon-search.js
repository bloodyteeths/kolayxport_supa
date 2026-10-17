/**
 * KolayXport Research — Amazon Search Results Overlay
 *
 * Every number shown here is either read from the page, taken from Amazon's
 * own "X+ bought in past month" badge, or comes from the official Amazon
 * SP-API (via the KolayXport server). Model estimates are labelled "est."
 * and nothing is invented when no data exists.
 */

(function () {
  'use strict';

  const shared = window.__kxAmzShared;
  if (!shared || !shared.math) { console.warn('[KX] Amazon shared not loaded'); return; }

  const M = shared.math;
  const esc = M.escapeHtml;
  const {
    injectAmazonCSS, extractSearchCards, parseSearchCard, extractTotalResults,
    requestSpApiSignals, detectAmazonMarketplace, observeUrlChanges, KX_AMZ_PREFIX,
  } = shared;

  const SP_REASON_TEXT = {
    not_signed_in: 'sign in to KolayXport in this browser to add official Amazon data',
    not_connected: 'connect your Amazon seller account in KolayXport to add BSR and offer counts',
    marketplace_not_connected: 'your Amazon seller account is not registered in this marketplace',
    access_denied: 'Amazon has not granted the KolayXport app the catalog/pricing role yet',
    unavailable: 'Amazon API did not respond',
  };

  let spApi = null;            // server response for this page (or null)
  let spApiRequestedFor = null;
  let lastBarSignature = '';
  let timer = null;

  function isSearchPage() {
    return window.location.pathname.startsWith('/s') ||
      !!document.querySelector('[data-component-type="s-search-result"]');
  }

  function spItem(asin) {
    return (spApi && spApi.available && spApi.items && spApi.items[asin]) || null;
  }

  // ---------------------------------------------------------------------------
  // Per-card row
  // ---------------------------------------------------------------------------
  function salesHtml(data, mkt, sp) {
    const fig = M.pickSalesFigure({
      bought: data.bought,
      price: data.price,
      bsr: sp ? sp.bsr : null,
      bsrCategory: sp ? sp.bsrCategory : null,
      marketplace: mkt,
    });
    if (fig.kind === 'amazon') {
      const rev = fig.revenueFloor
        ? `<span class="kx-sep">|</span><span class="kx-green" title="Amazon's floor × current price. Real revenue is higher if more than ${esc(fig.label)} were sold.">≥${esc(M.formatMoney(fig.revenueFloor, data.currency, true))}/mo</span>`
        : '';
      return `<span class="kx-green" title="Amazon's own figure, shown on the listing: '${esc(fig.label)} bought in past month'. It is a floor, not an exact count.">Amazon: ${esc(fig.label)} bought/mo</span>${rev}`;
    }
    if (fig.kind === 'estimate') {
      const band = `${M.formatCompact(fig.low)}–${M.formatCompact(fig.high)}`;
      const cal = fig.calibrated ? '' : ' Model is calibrated on amazon.com and likely overstates this marketplace.';
      const tip = `Estimate, not measured: Best Seller Rank #${fig.bsr.toLocaleString()} in ${sp.bsrCategory || 'its category'} (official Amazon data) run through a ${fig.curve} BSR-to-sales curve. Likely range ${band}/mo.${cal}`;
      const rev = fig.revenue
        ? `<span class="kx-sep">|</span><span class="kx-orange" title="${esc(tip)}">est. ~${esc(M.formatMoney(fig.revenue, data.currency, true))}/mo</span>`
        : '';
      return `<span class="kx-orange" title="${esc(tip)}">est. ~${M.formatCompact(fig.units)}/mo</span>${rev}`;
    }
    return '<span class="kx-muted" title="Amazon shows no \'bought in past month\' badge for this item (usually under ~50/mo, not guaranteed) and no official rank data is available. We do not guess.">sales: no data</span>';
  }

  function renderCardRow(card, data, mkt) {
    const sp = spItem(data.asin);
    const sig = `${data.asin}|${sp ? 1 : 0}|${data.reviews}|${data.price}|${data.bought ? data.bought.min : ''}`;
    let row = card.querySelector(`.${KX_AMZ_PREFIX}-row`);
    if (row && row.getAttribute('data-kx-sig') === sig) return;

    const parts = [
      '<span class="kx-amz-badge">KX</span>',
      data.sponsored ? '<span class="kx-tag" title="Sponsored result (ad)">Ad</span>' : '',
      salesHtml(data, mkt, sp),
      data.reviews != null ? `<span class="kx-sep">|</span><span>${M.formatCompact(data.reviews)} ratings</span>` : '',
      data.rating != null ? `<span class="kx-sep">|</span><span>★ ${data.rating.toFixed(1)}</span>` : '',
      sp && sp.bsr ? `<span class="kx-sep">|</span><span title="Best Seller Rank from the official Amazon API">BSR #${sp.bsr.toLocaleString()}</span>` : '',
      sp && sp.offerCountAny != null ? `<span class="kx-sep">|</span><span title="Competing offers on this ASIN (official Amazon API)">${sp.offerCountAny} offers</span>` : '',
      `<span class="kx-sep">|</span><span class="kx-muted">${esc(data.asin)}</span>`,
      `<button class="kx-ai-btn" data-asin="${esc(data.asin)}" title="Analyze with KolayXport AI">AI</button>`,
    ];

    if (!row) {
      row = document.createElement('div');
      row.className = `kx-data-row ${KX_AMZ_PREFIX}-row`;
      const insertTarget = card.querySelector('.a-section.a-spacing-small') || card;
      insertTarget.appendChild(row);
    }
    row.setAttribute('data-kx-sig', sig);
    row.innerHTML = parts.join('');
    row.querySelector('.kx-ai-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://kolayxport.com/app/research/products?mkt=amazon&q=${encodeURIComponent(data.asin)}`, '_blank');
    });
  }

  // ---------------------------------------------------------------------------
  // Summary bar
  // ---------------------------------------------------------------------------
  function renderSummaryBar(parsed) {
    const resultsContainer = document.querySelector('.s-main-slot') ||
      document.querySelector('[data-component-type="s-search-result"]')?.parentElement;
    if (!resultsContainer) return;

    const total = extractTotalResults();
    const sig = `${parsed.length}|${spApi ? (spApi.available ? 'y' : 'n') : '-'}|${total ? total.total : ''}`;
    const existing = document.getElementById(`${KX_AMZ_PREFIX}-summary`);
    if (existing && sig === lastBarSignature) return;
    lastBarSignature = sig;

    const organic = parsed.filter((p) => !p.sponsored);
    const sponsoredCount = parsed.length - organic.length;

    // Unique ASINs for price/rating stats (the same ASIN can appear as ad + organic).
    const seen = new Set();
    const unique = parsed.filter((p) => (seen.has(p.asin) ? false : (seen.add(p.asin), true)));
    const prices = unique.map((p) => p.price).filter((v) => v != null);
    const ratings = unique.map((p) => p.rating).filter((v) => v != null);
    const currency = (unique.find((p) => p.price != null) || {}).currency || null;

    // No rating and no count = a product with zero reviews; rating but an
    // unreadable count = unknown (excluded rather than guessed).
    const organicReviews = organic
      .map((p) => (p.reviews != null ? p.reviews : (p.rating == null ? 0 : null)))
      .filter((v) => v != null);
    const offerCounts = organic.map((p) => spItem(p.asin)).filter(Boolean)
      .map((sp) => sp.offerCountAny).filter((v) => v != null);

    const comp = M.computeCompetition({
      totalResults: total ? total.total : null,
      organicReviewCounts: organicReviews,
      sponsoredCount,
      cardCount: parsed.length,
      offerCounts,
    });
    const s = comp.signals;
    const compColor = comp.level === 'Low' ? 'kx-green' : comp.level === 'Medium' ? 'kx-orange' : comp.level === 'High' ? 'kx-red' : 'kx-muted';
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    const compTip = [
      `Score ${comp.score ?? '—'}/100 (High ≥ ${M.COMPETITION_CONFIG.high}, Medium ≥ ${M.COMPETITION_CONFIG.medium}).`,
      `Results: ${total ? (total.isLowerBound ? 'over ' : '') + total.total.toLocaleString() : 'unknown'}.`,
      `Median ratings (organic, this page): ${s.pageMedianReviews ?? '—'}; top-10 median: ${s.top10MedianReviews ?? '—'}.`,
      `Organic results with 1K+ ratings: ${pct(s.shareOver1kReviews)}. Ads on page: ${pct(s.sponsoredShare)}.`,
      s.medianOfferCount != null ? `Median competing offers (Amazon API): ${s.medianOfferCount}.` : '',
      comp.reasons.length ? `Note: ${comp.reasons.join('; ')}.` : '',
    ].filter(Boolean).join(' ');

    const withBadge = unique.filter((p) => p.bought);
    const boughtFloor = withBadge.reduce((sum, p) => sum + p.bought.min, 0);

    let sourceNote = 'Source: this page';
    if (spApi && spApi.available) {
      const n = Object.keys(spApi.items || {}).length;
      sourceNote += ` + official Amazon data (SP-API) for ${n} product${n === 1 ? '' : 's'}`;
    } else if (spApi && !spApi.available) {
      sourceNote += ` · Official Amazon data off: ${esc(SP_REASON_TEXT[spApi.reason] || SP_REASON_TEXT.unavailable)}`;
    }

    const bar = existing || document.createElement('div');
    bar.id = `${KX_AMZ_PREFIX}-summary`;
    bar.className = 'kx-stats-bar';
    bar.innerHTML = `
      <div class="kx-stats-header">
        <span class="kx-stats-logo">KolayXport</span>
        Amazon Market Snapshot · ${parsed.length} results on this page${total ? ` (of ${total.isLowerBound ? 'over ' : ''}${total.total.toLocaleString()})` : ''}
      </div>
      <div class="kx-stats-row">
        <span>Median price: <strong>${esc(M.formatMoney(M.median(prices), currency))}</strong></span>
        <span class="kx-sep">|</span>
        <span>Range: <strong>${prices.length ? esc(M.formatMoney(Math.min(...prices), currency)) + ' – ' + esc(M.formatMoney(Math.max(...prices), currency)) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span title="Median rating count of organic (non-ad) results on this page">Median ratings: <strong>${s.pageMedianReviews != null ? M.formatCompact(s.pageMedianReviews) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span title="Median rating count of the first 10 organic results">Top-10 median: <strong>${s.top10MedianReviews != null ? M.formatCompact(s.top10MedianReviews) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span>Avg rating: <strong>${ratings.length ? '★ ' + M.mean(ratings).toFixed(1) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span>Ads: <strong>${sponsoredCount}/${parsed.length}</strong></span>
        <span class="kx-sep">|</span>
        <span title="${esc(compTip)}">Competition: <strong class="${compColor}">${comp.level}</strong></span>
        <span class="kx-sep">|</span>
        <button class="kx-ai-btn kx-deep-ai">Deep AI Analysis</button>
      </div>
      <div class="kx-stats-note">
        ${withBadge.length
          ? `Amazon "bought in past month": ${withBadge.length} of ${unique.length} products show it, together at least ${M.formatCompact(boughtFloor)} units/mo (Amazon's floors, not estimates).`
          : 'No product on this page shows Amazon\'s "bought in past month" figure.'}
        · ${sourceNote}
      </div>
    `;
    bar.querySelector('.kx-deep-ai')?.addEventListener('click', () => {
      const q = new URLSearchParams(window.location.search).get('k') || '';
      window.open('https://kolayxport.com/app/research/keywords?mkt=amazon&q=' + encodeURIComponent(q), '_blank');
    });
    if (!existing) resultsContainer.parentElement?.insertBefore(bar, resultsContainer);
  }

  // ---------------------------------------------------------------------------
  // Main process
  // ---------------------------------------------------------------------------
  function maybeRequestSpApi(parsed, mkt) {
    const key = window.location.href;
    if (spApiRequestedFor === key) return;
    const asins = [];
    for (const p of parsed) {
      if (!p.sponsored && !asins.includes(p.asin)) asins.push(p.asin);
      if (asins.length >= 20) break;
    }
    if (asins.length < 3) return;
    spApiRequestedFor = key;
    requestSpApiSignals(asins, mkt).then((resp) => {
      if (spApiRequestedFor !== key) return; // navigated away
      spApi = resp || { available: false, reason: 'unavailable' };
      schedule(0);
    });
  }

  function processSearchPage() {
    if (!isSearchPage()) return;
    const cards = extractSearchCards();
    if (cards.length < 3) return;

    injectAmazonCSS();
    const mkt = detectAmazonMarketplace();
    const parsed = [];
    cards.forEach((card) => {
      const data = parseSearchCard(card, mkt);
      if (!data.asin) return;
      parsed.push(data);
      renderCardRow(card, data, mkt);
    });
    renderSummaryBar(parsed);
    maybeRequestSpApi(parsed, mkt);
  }

  // Throttled: a pending run is not pushed back by further mutations
  // (Amazon mutates constantly; a pure debounce could starve).
  function schedule(delay) {
    if (delay == null && timer) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; processSearchPage(); }, delay == null ? 500 : delay);
  }

  // Initial run
  schedule(1000);

  // Amazon lazy-loads results; re-run (debounced). Our own rows/bar only
  // re-render when their data signature changes, so this does not loop.
  const observer = new MutationObserver(() => {
    if (isSearchPage()) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  observeUrlChanges(() => {
    spApi = null;
    spApiRequestedFor = null;
    lastBarSignature = '';
    document.getElementById(`${KX_AMZ_PREFIX}-summary`)?.remove();
    schedule(1000);
  });
})();

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
  const t = shared.t;
  const money = shared.formatMoney;
  const compact = shared.formatCompact;
  const int = shared.formatInt;

  const SP_REASONS = { not_signed_in: 1, not_connected: 1, marketplace_not_connected: 1, access_denied: 1, unavailable: 1 };
  const spReasonText = (r) => t('reason_' + (SP_REASONS[r] ? r : 'unavailable'));

  // Nothing renders until the language is known (lib/lang.js): no flash of the wrong language.
  let langReady = false;

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
        ? `<span class="kx-sep">|</span><span class="kx-green" title="${esc(t('revFloorTip', { label: fig.label }))}">≥${esc(money(fig.revenueFloor, data.currency, true))}${esc(t('perMonth'))}</span>`
        : '';
      return `<span class="kx-green" title="${esc(t('amazonFigTip', { label: fig.label }))}">${esc(t('amazonFig', { label: fig.label }))}</span>${rev}`;
    }
    if (fig.kind === 'estimate') {
      const band = `${compact(fig.low)}–${compact(fig.high)}`;
      const cal = fig.calibrated ? '' : t('uncalibrated');
      const tip = t('estTip', { bsr: int(fig.bsr), cat: sp.bsrCategory || t('itsCategory'), curve: fig.curve, band }) + cal;
      const rev = fig.revenue
        ? `<span class="kx-sep">|</span><span class="kx-orange" title="${esc(tip)}">${esc(t('estRev', { money: money(fig.revenue, data.currency, true) }))}</span>`
        : '';
      return `<span class="kx-orange" title="${esc(tip)}">${esc(t('estUnits', { n: compact(fig.units) }))}</span>${rev}`;
    }
    return `<span class="kx-muted" title="${esc(t('noSalesTip'))}">${esc(t('noSales'))}</span>`;
  }

  function renderCardRow(card, data, mkt) {
    const sp = spItem(data.asin);
    const sig = `${shared.lang}|${data.asin}|${sp ? 1 : 0}|${data.reviews}|${data.price}|${data.bought ? data.bought.min : ''}`;
    let row = card.querySelector(`.${KX_AMZ_PREFIX}-row`);
    if (row && row.getAttribute('data-kx-sig') === sig) return;

    const parts = [
      '<span class="kx-amz-badge">KX</span>',
      data.sponsored ? `<span class="kx-tag" title="${esc(t('adTip'))}">${esc(t('ad'))}</span>` : '',
      salesHtml(data, mkt, sp),
      data.reviews != null ? `<span class="kx-sep">|</span><span>${esc(t('ratings', { n: compact(data.reviews) }))}</span>` : '',
      data.rating != null ? `<span class="kx-sep">|</span><span>★ ${esc(shared.formatRating(data.rating))}</span>` : '',
      sp && sp.bsr ? `<span class="kx-sep">|</span><span title="${esc(t('bsrTip'))}">BSR #${esc(int(sp.bsr))}</span>` : '',
      sp && sp.offerCountAny != null ? `<span class="kx-sep">|</span><span title="${esc(t('offersTip'))}">${esc(t('offers', { n: int(sp.offerCountAny) }))}</span>` : '',
      `<span class="kx-sep">|</span><span class="kx-muted">${esc(data.asin)}</span>`,
      `<button class="kx-ai-btn" data-asin="${esc(data.asin)}" title="${esc(t('aiTip'))}">AI</button>`,
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
    const sig = `${shared.lang}|${parsed.length}|${spApi ? (spApi.available ? 'y' : 'n') : '-'}|${total ? total.total : ''}`;
    const existing = document.getElementById(`${KX_AMZ_PREFIX}-summary`);
    if (existing && sig === lastBarSignature) return;
    lastBarSignature = sig;

    // Daily research limit / busy: one card instead of the numbers.
    if (spApi && spApi.reason === 'research_limit' && spApi.limit) {
      const card = existing || document.createElement('div');
      card.id = `${KX_AMZ_PREFIX}-summary`;
      card.className = 'kx-stats-bar';
      shared.showLimitCard(card, spApi, 'amazon_search');
      if (!existing) resultsContainer.parentElement?.insertBefore(card, resultsContainer);
      return;
    }

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
    const pct = (v) => (v == null ? '—' : (shared.lang === 'tr' ? `%${Math.round(v * 100)}` : `${Math.round(v * 100)}%`));
    const totalText = total ? (total.isLowerBound ? t('overN', { n: int(total.total) }) : int(total.total)) : null;
    const compTip = [
      t('compTipScore', { score: comp.score ?? '—', high: M.COMPETITION_CONFIG.high, medium: M.COMPETITION_CONFIG.medium }),
      t('compTipResults', { results: totalText || t('unknown') }),
      t('compTipMedians', { page: s.pageMedianReviews != null ? int(s.pageMedianReviews) : '—', top10: s.top10MedianReviews != null ? int(s.top10MedianReviews) : '—' }),
      t('compTipShares', { big: pct(s.shareOver1kReviews), ads: pct(s.sponsoredShare) }),
      s.medianOfferCount != null ? t('compTipOffers', { n: int(s.medianOfferCount) }) : '',
      comp.reasons.length ? t('compTipNote', { reasons: comp.reasons.map(shared.reasonText).join('; ') }) : '',
    ].filter(Boolean).join(' ');

    const withBadge = unique.filter((p) => p.bought);
    const boughtFloor = withBadge.reduce((sum, p) => sum + p.bought.min, 0);

    let sourceNote = t('sourcePage');
    if (spApi && spApi.available) {
      const n = Object.keys(spApi.items || {}).length;
      sourceNote += t(n === 1 ? 'sourceSpOne' : 'sourceSp', { n });
    } else if (spApi && !spApi.available) {
      sourceNote += t('sourceOff', { reason: spReasonText(spApi.reason) });
    }

    const bar = existing || document.createElement('div');
    bar.id = `${KX_AMZ_PREFIX}-summary`;
    bar.className = 'kx-stats-bar';
    const snapshot = t('snapshot', {
      organic: parsed.length - sponsoredCount,
      ads: sponsoredCount,
      adWord: t(sponsoredCount === 1 ? 'adWordOne' : 'adWordMany'),
      total: totalText ? t('snapshotTotal', { total: totalText }) : '',
    });
    bar.lang = shared.lang;
    bar.innerHTML = `
      <div class="kx-stats-header">
        <span class="kx-stats-logo">KolayXport</span>
        ${esc(snapshot)}
      </div>
      <div class="kx-stats-row">
        <span>${esc(t('medianPrice'))}: <strong>${esc(money(M.median(prices), currency))}</strong></span>
        <span class="kx-sep">|</span>
        <span>${esc(t('range'))}: <strong>${prices.length ? esc(money(Math.min(...prices), currency)) + ' – ' + esc(money(Math.max(...prices), currency)) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span title="${esc(t('medianRatingsTip'))}">${esc(t('medianRatings'))}: <strong>${s.pageMedianReviews != null ? esc(compact(s.pageMedianReviews)) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span title="${esc(t('top10MedianTip'))}">${esc(t('top10Median'))}: <strong>${s.top10MedianReviews != null ? esc(compact(s.top10MedianReviews)) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span>${esc(t('avgRating'))}: <strong>${ratings.length ? '★ ' + esc(shared.formatRating(M.mean(ratings))) : '—'}</strong></span>
        <span class="kx-sep">|</span>
        <span>${esc(t('ads'))}: <strong>${sponsoredCount}/${parsed.length}</strong></span>
        <span class="kx-sep">|</span>
        <span title="${esc(compTip)}">${esc(t('competition'))}: <strong class="${compColor}">${esc(shared.compLabel(comp.level))}</strong></span>
        <span class="kx-sep">|</span>
        <button class="kx-ai-btn kx-deep-ai">${esc(t('deepAi'))}</button>
      </div>
      <div class="kx-stats-note">
        ${esc(withBadge.length
          ? t('boughtNote', { k: withBadge.length, n: unique.length, units: compact(boughtFloor) })
          : t('boughtNone'))}
        · ${esc(sourceNote)}
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
    if (!langReady || !isSearchPage()) return;
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

  // Initial run, once the language is known.
  shared.langReady().then(() => {
    langReady = true;
    schedule(1000);
  });

  // Language changed in the popup: rows and bar carry the language in their signature,
  // so the next run re-renders them in place.
  shared.onLangChange(() => schedule(0));

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

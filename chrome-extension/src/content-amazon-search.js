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
  // Per-card strip (same component as Etsy / eBay). At most three figures on its face:
  // sales, revenue, ratings. Rating, BSR, offers and the ASIN are in the "i".
  // ---------------------------------------------------------------------------
  function salesParts(data, mkt, sp) {
    const fig = M.pickSalesFigure({
      bought: data.bought,
      price: data.price,
      bsr: sp ? sp.bsr : null,
      bsrCategory: sp ? sp.bsrCategory : null,
      marketplace: mkt,
    });
    if (fig.kind === 'amazon') {
      const html = [`<span class="kx-green kx-strong">${esc(t('amazonFig', { label: fig.label }))}</span>`];
      if (fig.revenueFloor) html.push(`<span>≥${esc(money(fig.revenueFloor, data.currency, true))}${esc(t('perMonth'))}</span>`);
      const formula = [t('amazonFigTip', { label: fig.label }), fig.revenueFloor ? t('revFloorTip', { label: fig.label }) : ''].filter(Boolean).join(' ');
      return { html, plain: t('plainAmazonFig'), formula, source: ['amazonFigure', 'amazonPage'], confidence: 'high' };
    }
    if (fig.kind === 'estimate') {
      const band = `${compact(fig.low)}–${compact(fig.high)}`;
      const cal = fig.calibrated ? '' : t('uncalibrated');
      const tip = t('estTip', { bsr: int(fig.bsr), cat: sp.bsrCategory || t('itsCategory'), curve: fig.curve, band }) + cal;
      const html = [`<span class="kx-strong">${esc(t('estUnits', { n: compact(fig.units) }))}</span> <span class="kx-est" data-kx-est="1">${esc(t('est'))}</span>`];
      if (fig.revenue) html.push(`<span>${esc(t('estRev', { money: money(fig.revenue, data.currency, true) }))}</span>`);
      return { html, plain: t('plainEstimate'), formula: tip, source: ['amazonApi', 'model'], confidence: 'low' };
    }
    return { html: [`<span class="kx-muted">${esc(t('noSales'))}</span>`], plain: t('plainNoSales'), formula: t('noSalesTip'), source: ['amazonPage'], confidence: null };
  }

  function renderCardRow(card, data, mkt) {
    const U = shared.UI;
    const sp = spItem(data.asin);
    const sig = `${shared.lang}|${data.asin}|${sp ? 1 : 0}|${data.reviews}|${data.price}|${data.bought ? data.bought.min : ''}`;
    let row = card.querySelector(`.${KX_AMZ_PREFIX}-row`);
    if (row && row.getAttribute('data-kx-sig') === sig) return;

    const sales = salesParts(data, mkt, sp);
    const items = sales.html.slice(0, 2);
    if (data.reviews != null) items.push(`<span>${esc(t('ratings', { n: compact(data.reviews) }))}</span>`);
    const notes = [sales.formula];
    if (data.reviews != null) notes.push(t('cardRatingsNote', { n: int(data.reviews) }));
    if (data.rating != null) notes.push(t('cardRatingNote', { r: shared.formatRating(data.rating) }));
    if (sp && sp.bsr) notes.push(t('cardBsrNote', { n: int(sp.bsr) }));
    if (sp && sp.offerCountAny != null) notes.push(t('cardOffersNote', { n: int(sp.offerCountAny) }));
    notes.push(t('cardAsinNote', { asin: data.asin }));

    const html = U.markHtml(false) +
      (data.sponsored ? `<span class="kx-tag" title="${esc(t('adTip'))}">${esc(t('ad'))}</span>` : '') +
      items.slice(0, 3).join('<span class="kx-sep">·</span>') +
      U.infoHtml({ label: t('sales'), plain: sales.plain, formula: notes.filter(Boolean).join(' '), source: sales.source, confidence: sales.confidence }) +
      `<button type="button" class="kx-ai-btn" data-asin="${esc(data.asin)}" title="${esc(t('aiTip'))}">AI</button>`;

    if (!row) {
      row = document.createElement('div');
      row.className = `kx-data-row ${KX_AMZ_PREFIX}-row`;
      const insertTarget = card.querySelector('.a-section.a-spacing-small') || card;
      insertTarget.appendChild(row);
    }
    U.strip(row);
    row.lang = shared.lang;
    row.setAttribute('data-kx-sig', sig);
    row.innerHTML = html;
    row.querySelector('.kx-ai-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://kolayxport.com/app/research/products?mkt=amazon&q=${encodeURIComponent(data.asin)}`, '_blank');
    });
  }

  // ---------------------------------------------------------------------------
  // Summary bar: the same ink top bar as Etsy / eBay.
  // Compact: on this page, typical price, price range, typical review count, competition.
  // "More": top-10 review count, average rating, ads, snapshot, "bought" note, source note.
  // ---------------------------------------------------------------------------
  function renderSummaryBar(parsed) {
    const U = shared.UI;
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
      card.className = 'kx-stats-bar kx-ui kx-topbar';
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
    const pageSrc = ['amazonPage'];
    if (spApi && spApi.available) {
      const n = Object.keys(spApi.items || {}).length;
      sourceNote += t(n === 1 ? 'sourceSpOne' : 'sourceSp', { n });
    } else if (spApi && !spApi.available) {
      sourceNote += t('sourceOff', { reason: spReasonText(spApi.reason) });
    }
    const snapshot = t('snapshot', {
      organic: parsed.length - sponsoredCount,
      ads: sponsoredCount,
      adWord: t(sponsoredCount === 1 ? 'adWordOne' : 'adWordMany'),
      total: totalText ? t('snapshotTotal', { total: totalText }) : '',
    });
    const nConf = organic.length >= 15 ? 'high' : organic.length >= 6 ? 'medium' : 'low';

    const bar = existing || document.createElement('div');
    bar.id = `${KX_AMZ_PREFIX}-summary`;
    bar.className = 'kx-stats-bar';
    const chip = (o) => U.chip(document, o);
    const lvl = String(comp.level || '').toLowerCase();
    const chips = [
      chip({ key: 'onpage', label: t('onPage'), value: t('onPageVal', { organic: parsed.length - sponsoredCount, ads: sponsoredCount, adWord: t(sponsoredCount === 1 ? 'adWordOne' : 'adWordMany') }),
        info: { plain: t('plainOnPage'), formula: snapshot, source: pageSrc, confidence: 'exact' } }),
      chip({ key: 'price', label: t('medianPrice'), value: money(M.median(prices), currency),
        info: prices.length ? { plain: t('plainTypicalPrice'), source: pageSrc, confidence: prices.length >= 10 ? 'high' : 'medium' } : null }),
      chip({ key: 'range', label: t('range'), value: prices.length ? money(Math.min(...prices), currency) + ' – ' + money(Math.max(...prices), currency) : '—',
        info: prices.length ? { plain: t('plainRange'), source: pageSrc, confidence: 'exact' } : null }),
      chip({ key: 'reviews', label: t('medianRatings'), value: s.pageMedianReviews != null ? compact(s.pageMedianReviews) : '—',
        info: { plain: t('plainReviews'), formula: t('medianRatingsTip'), source: pageSrc, confidence: nConf } }),
      chip({ key: 'competition', label: t('competition'), value: U.pill(document, shared.compLabel(comp.level), U.competitionTone(lvl)),
        info: { plain: t('plainCompetition'), formula: compTip, source: spApi && spApi.available ? ['amazonPage', 'amazonApi'] : pageSrc, confidence: nConf === 'high' ? 'medium' : 'low' } }),
    ];
    const more = [
      chip({ key: 'top10', label: t('top10Median'), value: s.top10MedianReviews != null ? compact(s.top10MedianReviews) : '—',
        info: { plain: t('plainTop10'), formula: t('top10MedianTip'), source: pageSrc, confidence: nConf } }),
      chip({ key: 'rating', label: t('avgRating'), value: ratings.length ? '★ ' + shared.formatRating(M.mean(ratings)) : '—',
        info: ratings.length ? { plain: t('plainRating'), source: pageSrc, confidence: 'exact' } : null }),
      chip({ key: 'ads', label: t('ads'), value: `${sponsoredCount}/${parsed.length}`,
        info: { plain: t('plainAds'), source: pageSrc, confidence: 'exact' } }),
      U.note(document, snapshot),
      U.note(document, withBadge.length
        ? t('boughtNote', { k: withBadge.length, n: unique.length, units: compact(boughtFloor) })
        : t('boughtNone')),
      U.note(document, sourceNote),
    ];
    // Only a positive demand signal: a missing "bought" badge does not mean no sales.
    const share = unique.length >= 5 ? withBadge.length / unique.length : 0;
    const demand = share >= 0.5 ? share : null;
    const q = new URLSearchParams(window.location.search).get('k') || '';
    U.topBar(bar, {
      title: q ? '"' + q + '"' : 'Amazon',
      verdict: U.verdict(lvl, demand),
      chips,
      more,
      state: 'full',
      link: { href: 'https://kolayxport.com/app/research/keywords?mkt=amazon&q=' + encodeURIComponent(q), text: t('deepAi') },
    });
    bar.querySelector('.kx-cta')?.classList.add('kx-deep-ai');
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
      perfMark('sp_api');
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
    if (!firstPaintMarked) { firstPaintMarked = true; perfMark('first_paint', { cards: parsed.length }); }
    maybeRequestSpApi(parsed, mkt);
  }

  // Debug timing marks (lib/perf.js; only with localStorage kx_debug).
  let firstPaintMarked = false;
  function perfMark(label, extra) {
    const P = window.__KX_PERF;
    if (P) P.mark('amazon_search', label, extra);
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
    schedule(250);
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
    firstPaintMarked = false;
    const P = window.__KX_PERF;
    if (P) P.start('amazon_search');
    document.getElementById(`${KX_AMZ_PREFIX}-summary`)?.remove();
    schedule(1000);
  });
})();

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

  function render(asin) {
    const U = shared.UI;
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
      if (sidebar) sidebar.insertBefore(widget, sidebar.firstChild);
      else insertTarget.appendChild(widget);
    }

    // Daily research limit / busy: one card instead of the numbers.
    if (spLimit.asin === asin && spLimit.resp && shared.showLimitCard(widget, spLimit.resp, 'amazon_listing')) return;

    const body = U.panel(widget, { title: t('productIntel') });
    const metric = (o) => U.metric(document, o);
    const div = (cls, text) => {
      const n = document.createElement('div');
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const bsrSrc = bsr && bsr.fromApi ? ['amazonApi', 'model'] : ['amazonPage', 'model'];

    // Sales
    const sales = div('kx-sales');
    sales.appendChild(div('kx-section-label', t('sales')));
    if (fig.kind === 'amazon') {
      const grid = div('kx-metrics-grid kx-wide');
      grid.appendChild(metric({ key: 'bought', label: t('boughtLastMonth'), value: fig.label, tone: 'green',
        info: { plain: t('plainAmazonFig'), formula: t('boughtLastMonthTip'), source: ['amazonFigure'], confidence: 'high' } }));
      if (fig.revenueFloor) {
        grid.appendChild(metric({ key: 'revenue', label: t('revFloor'), value: '≥' + money(fig.revenueFloor, currency, true), tone: 'green',
          info: { plain: t('plainRevFloor'), formula: t('revFloorShortTip'), source: ['amazonFigure', 'amazonPage'], confidence: 'high' } }));
      }
      sales.appendChild(grid);
      if (bsrEst) sales.appendChild(div('kx-sales-meta', t('bsrCompare', { units: compact(bsrEst.units), low: compact(bsrEst.low), high: compact(bsrEst.high) })));
    } else if (fig.kind === 'estimate') {
      const grid = div('kx-metrics-grid kx-wide');
      const formula = t('estFromBsr', { curve: fig.curve, low: compact(fig.low), high: compact(fig.high) }) + (fig.calibrated ? '' : t('curveUncalibrated'));
      grid.appendChild(metric({ key: 'units', label: t('estSales'), value: '≈' + compact(fig.units), est: true,
        info: { plain: t('plainEstimate'), formula: formula + ' ' + t('estSalesTip', { low: int(fig.low), high: int(fig.high) }), source: bsrSrc, confidence: 'low' } }));
      if (fig.revenue) {
        grid.appendChild(metric({ key: 'revenue', label: t('estRevenue'), value: '≈' + money(fig.revenue, currency, true), est: true,
          info: { plain: t('plainEstRev'), formula, source: bsrSrc.concat('amazonPage'), confidence: 'low' } }));
      }
      sales.appendChild(grid);
      sales.appendChild(div('kx-sales-meta', t('estFromBsr', { curve: fig.curve, low: compact(fig.low), high: compact(fig.high) }) + (fig.calibrated ? '' : t('curveUncalibrated')) + t('noBoughtFigure')));
    } else {
      sales.appendChild(div('kx-sales-plain', t('noSalesData')));
    }
    body.appendChild(sales);

    // Best Seller Rank
    if (bsr) {
      const row = div('kx-stats-row');
      const strong = document.createElement('strong');
      strong.textContent = t('bsrIn', { rank: int(bsr.rank), cat: bsr.category || '—' });
      row.appendChild(strong);
      if (bsr.sub && bsr.sub.length) {
        row.appendChild(div('kx-muted', ' · ' + bsr.sub.slice(0, 2).map((r) => t('subRankIn', { rank: int(r.rank), cat: r.category })).join(' · ')));
      }
      if (bsr.fromApi) row.appendChild(div('kx-muted', t('officialData')));
      body.appendChild(row);
    }

    // Rating, ratings, offers
    if (reviewCount != null || rating != null || (sp && sp.offerCountAny != null)) {
      const row = div('kx-stats-row');
      const parts = [];
      if (rating != null) parts.push('★ ' + shared.formatRating(rating));
      if (reviewCount != null) parts.push(t('ratings', { n: int(reviewCount) }));
      parts.forEach((p, i) => {
        if (i) row.appendChild(div('kx-sep', '|'));
        row.appendChild(div(null, p));
      });
      if (sp && sp.offerCountAny != null) {
        if (parts.length) row.appendChild(div('kx-sep', '|'));
        const o = div(null, t('offers', { n: int(sp.offerCountAny) }));
        o.title = t('offersTip');
        row.appendChild(o);
      }
      Array.prototype.forEach.call(row.children, (c) => { c.style.display = 'inline'; });
      body.appendChild(row);
    }

    // Referral fee (rough)
    if (referral) {
      const box = div('kx-box');
      const head = div('kx-section-label', t('feeTitle'));
      head.appendChild(U.info(document, { label: t('feeTitle'), plain: t('plainFee'), formula: t('feeNote'), source: ['amazonPage'], confidence: 'low' }));
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.style.gap = '4px';
      box.appendChild(head);
      const line = div(null);
      line.appendChild(document.createTextNode(t('referral') + ': '));
      const fee = document.createElement('strong');
      fee.textContent = money(referral.fee, currency);
      line.appendChild(fee);
      line.appendChild(document.createTextNode(' '));
      const sep = document.createElement('span');
      sep.className = 'kx-sep';
      sep.textContent = '|';
      line.appendChild(sep);
      line.appendChild(document.createTextNode(' ' + t('afterReferral') + ': '));
      const net = document.createElement('strong');
      net.textContent = money(referral.net, currency);
      line.appendChild(net);
      box.appendChild(line);
      box.appendChild(div('kx-sales-meta', t('feeNote')));
      body.appendChild(box);
    }

    // Actions
    const actions = div('kx-actions');
    const ai = document.createElement('button');
    ai.type = 'button';
    ai.className = 'kx-cta kx-btn-ai';
    ai.textContent = t('aiAnalysis');
    const research = document.createElement('button');
    research.type = 'button';
    research.className = 'kx-btn-ghost kx-btn-research';
    research.textContent = t('marketResearch');
    actions.appendChild(ai);
    actions.appendChild(research);
    body.appendChild(actions);
    body.appendChild(div('kx-foot', 'ASIN: ' + asin + ' | ' + marketplace));

    ai.addEventListener('click', () => {
      window.open(`https://kolayxport.com/app/research/products?mkt=amazon&q=${encodeURIComponent(asin)}`, '_blank');
    });
    research.addEventListener('click', () => {
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
    const P = window.__KX_PERF;
    if (isNew && P) P.mark('amazon_listing', 'first_paint', { asin });

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
        if (P) P.mark('amazon_listing', 'sp_api');
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
      document.addEventListener('DOMContentLoaded', () => setTimeout(processListingPage, 150));
    } else {
      setTimeout(processListingPage, 150);
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

/**
 * KolayXport Research — eBay Search Results Overlay
 * Injects: summary bar (sticky) + per-listing badges + X-Ray button
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_EBAY_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) { console.warn('[KX eBay Search] Shared module not loaded'); return; }
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_EBAY_SHARED;
    const C = window.__KX_CACHE;

    if (S.getPageType() !== 'search') return;

    processSearchPage();
    S.onUrlChange((url) => {
      if (S.getPageType() === 'search') {
        setTimeout(processSearchPage, 500);
      }
    });

    async function processSearchPage() {
      const query = S.SELECTORS.searchQuery();
      if (!query) return;

      const shadow = S.createOverlayContainer('kx-ebay-search-overlay', 'top');

      // Show loading
      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.innerHTML = '<span style="opacity:0.8">KolayXport eBay Arastirma yukleniyor...</span>';

      // Extract item IDs from page
      const itemIds = extractItemIds();

      try {
        const data = await C.getOrFetch(
          `ebay_search:${query}`,
          'search',
          () => S.apiCall('search_enrich', { query, marketplace: 'EBAY_US', itemIds: itemIds.slice(0, 48) })
        );

        if (!data) {
          bar.innerHTML = '<span style="opacity:0.7">Veri bulunamadi</span>';
          return;
        }

        // Support both { summary } wrapper and flat response
        const summary = data.summary || data;
        renderSummaryBar(shadow, bar, summary, query);

        if (data.listingBadges) {
          injectListingBadges(data.listingBadges, summary);
        } else if (summary.avgPrice) {
          // Generate badges from page prices vs average
          injectPriceBadges(summary);
        }
      } catch (err) {
        bar.innerHTML = `<span style="opacity:0.7">⚠ ${err.message || 'Veri yuklenemedi'}</span>`;
        console.error('[KX eBay Search]', err);
      }
    }

    function extractItemIds() {
      const ids = [];
      const links = document.querySelectorAll('a[href*="/itm/"]');
      links.forEach(link => {
        const match = link.href.match(/\/itm\/(?:[^/]*\/)?(\d{8,})/);
        if (match && !ids.includes(match[1])) ids.push(match[1]);
      });
      return ids;
    }

    function renderSummaryBar(shadow, bar, summary, query) {
      const totalResults = summary.totalResults || summary.total || 0;
      const avgPrice = summary.avgPrice || summary.avg_price || 0;
      const minPrice = summary.minPrice || summary.min_price || 0;
      const maxPrice = summary.maxPrice || summary.max_price || 0;
      const uniqueSellers = summary.uniqueSellers || summary.uniqueShops || summary.unique_sellers || 0;

      // Determine competition level
      let competition = summary.competition || 'medium';
      if (!summary.competition && uniqueSellers) {
        competition = uniqueSellers < 20 ? 'low' : uniqueSellers < 100 ? 'medium' : 'high';
      }

      const compColor = competition === 'low' ? '#4caf50' : competition === 'medium' ? '#ff9800' : '#f44336';
      const compLabel = competition === 'low' ? 'Dusuk' : competition === 'medium' ? 'Orta' : 'Yuksek';

      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;font-weight:700;">
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">KX</span>
          "${query}"
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Sonuc</span>
          <span class="kx-bar-value">${S.formatNum(totalResults)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Ort. Fiyat</span>
          <span class="kx-bar-value">${S.formatPrice(avgPrice)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Aralik</span>
          <span class="kx-bar-value" style="font-size:12px">${S.formatPrice(minPrice)} - ${S.formatPrice(maxPrice)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Satici</span>
          <span class="kx-bar-value">${uniqueSellers}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Rekabet</span>
          <span class="kx-bar-value" style="color:${compColor}">${compLabel}</span>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;">
          <button class="kx-btn kx-btn-sm" id="kx-ebay-xray-btn" style="background:rgba(255,255,255,0.2);">X-Ray</button>
          <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            Tam Analiz →
          </a>
        </div>
      `;

      const xrayBtn = shadow.getElementById('kx-ebay-xray-btn');
      if (xrayBtn) {
        xrayBtn.addEventListener('click', () => showXRay(shadow, summary, query));
      }
    }

    function injectListingBadges(badges, summary) {
      const cards = document.querySelectorAll('.s-item');
      const processed = new Set();

      cards.forEach(card => {
        const link = card.querySelector('a[href*="/itm/"]');
        if (!link) return;

        const match = link.href.match(/\/itm\/(?:[^/]*\/)?(\d{8,})/);
        if (!match || processed.has(match[1])) return;
        processed.add(match[1]);

        const badge = badges[match[1]];
        if (!badge) return;

        if (card.querySelector('.kx-ebay-badge')) return;

        card.style.position = 'relative';
        const badgeEl = document.createElement('div');
        badgeEl.className = 'kx-ebay-badge';
        badgeEl.style.cssText = `
          position: absolute; top: 4px; left: 4px; z-index: 100;
          background: rgba(0,0,0,0.82); color: #fff; padding: 3px 7px;
          border-radius: 4px; font-size: 10px; font-weight: 600;
          display: flex; align-items: center; gap: 4px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          backdrop-filter: blur(4px); pointer-events: none;
        `;

        const salesColor = (badge.estMonthlySales || 0) >= 5 ? '#4caf50' : (badge.estMonthlySales || 0) >= 1 ? '#ff9800' : '#f44336';
        badgeEl.innerHTML = `
          <span style="color:${salesColor}">~${badge.estMonthlySales || 0}/ay</span>
          ${badge.price ? `<span style="opacity:0.5">|</span><span>${S.formatPrice(badge.price)}</span>` : ''}
        `;
        card.appendChild(badgeEl);
      });
    }

    function injectPriceBadges(summary) {
      const avgPrice = summary.avgPrice || summary.avg_price || 0;
      if (!avgPrice) return;

      const cards = document.querySelectorAll('.s-item');
      const processed = new Set();

      cards.forEach(card => {
        const link = card.querySelector('a[href*="/itm/"]');
        if (!link) return;

        const match = link.href.match(/\/itm\/(?:[^/]*\/)?(\d{8,})/);
        if (!match || processed.has(match[1])) return;
        processed.add(match[1]);

        if (card.querySelector('.kx-ebay-badge')) return;

        // Try to extract price from the card
        const priceEl = card.querySelector('.s-item__price');
        if (!priceEl) return;

        const priceText = priceEl.textContent.replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        if (!price || isNaN(price)) return;

        card.style.position = 'relative';
        const badgeEl = document.createElement('div');
        badgeEl.className = 'kx-ebay-badge';
        badgeEl.style.cssText = `
          position: absolute; top: 4px; left: 4px; z-index: 100;
          background: rgba(0,0,0,0.82); color: #fff; padding: 3px 7px;
          border-radius: 4px; font-size: 10px; font-weight: 600;
          display: flex; align-items: center; gap: 4px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          backdrop-filter: blur(4px); pointer-events: none;
        `;

        const priceDiff = ((price - avgPrice) / avgPrice * 100).toFixed(0);
        const priceColor = price <= avgPrice ? '#4caf50' : '#f44336';
        const priceSign = price <= avgPrice ? '' : '+';
        badgeEl.innerHTML = `<span style="color:${priceColor}">${priceSign}${priceDiff}% ort.</span>`;
        card.appendChild(badgeEl);
      });
    }

    function showXRay(shadow, summary, query) {
      let xray = shadow.getElementById('kx-ebay-xray-panel');
      if (xray) { xray.remove(); return; }

      const totalResults = summary.totalResults || summary.total || 0;
      const avgPrice = summary.avgPrice || summary.avg_price || 0;
      const minPrice = summary.minPrice || summary.min_price || 0;
      const maxPrice = summary.maxPrice || summary.max_price || 0;
      const medianPrice = summary.medianPrice || summary.median_price || 0;
      const uniqueSellers = summary.uniqueSellers || summary.uniqueShops || summary.unique_sellers || 0;

      let competition = summary.competition || 'medium';
      if (!summary.competition && uniqueSellers) {
        competition = uniqueSellers < 20 ? 'low' : uniqueSellers < 100 ? 'medium' : 'high';
      }
      const compLabel = competition === 'low' ? 'Dusuk' : competition === 'medium' ? 'Orta' : 'Yuksek';

      xray = document.createElement('div');
      xray.id = 'kx-ebay-xray-panel';
      xray.className = 'kx-panel';
      xray.innerHTML = `
        <div class="kx-panel-header">
          <span style="font-weight:700;">X-Ray: "${query}"</span>
          <button class="kx-btn kx-btn-sm" id="kx-ebay-xray-close" style="background:rgba(255,255,255,0.2);">✕</button>
        </div>
        <div class="kx-panel-body">
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Pazar Ozeti</div>
            <div class="kx-metric"><span class="kx-metric-label">Toplam Sonuc</span><span class="kx-metric-value">${S.formatNum(totalResults)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Ortalama Fiyat</span><span class="kx-metric-value">${S.formatPrice(avgPrice)}</span></div>
            ${medianPrice ? `<div class="kx-metric"><span class="kx-metric-label">Medyan Fiyat</span><span class="kx-metric-value">${S.formatPrice(medianPrice)}</span></div>` : ''}
            <div class="kx-metric"><span class="kx-metric-label">Fiyat Araligi</span><span class="kx-metric-value">${S.formatPrice(minPrice)} - ${S.formatPrice(maxPrice)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Benzersiz Satici</span><span class="kx-metric-value">${uniqueSellers}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Rekabet</span><span class="kx-metric-value">${compLabel}</span></div>
          </div>
          <div class="kx-panel-section" style="display:flex;flex-direction:column;gap:6px;">
            <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn" style="width:100%;justify-content:center;text-decoration:none;">
              KolayXport'ta Tam Analiz →
            </a>
          </div>
        </div>
      `;
      shadow.appendChild(xray);

      shadow.getElementById('kx-ebay-xray-close').addEventListener('click', () => xray.remove());
    }
  }
})();

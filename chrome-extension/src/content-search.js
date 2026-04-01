/**
 * KolayXport Research — Search Results Overlay
 * Injects: summary bar (sticky) + per-listing badges + X-Ray button
 */

(function () {
  'use strict';

  // Wait for shared module
  function waitForShared(cb, attempts = 0) {
    if (window.__KX_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) { console.warn('[KX Search] Shared module not loaded'); return; }
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_SHARED;
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

      const shadow = S.createOverlayContainer('kx-search-overlay', 'top');

      // Show loading
      let bar = shadow.querySelector('.kx-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'kx-bar';
        shadow.appendChild(bar);
      }
      bar.innerHTML = '<span style="opacity:0.8">KolayXport Araştırma yükleniyor...</span>';

      // Extract listing IDs from the page
      const listingIds = extractListingIds();

      try {
        const data = await C.getOrFetch(
          `search:${query}`,
          'search',
          () => S.apiCall('search_enrich', { query, listingIds: listingIds.slice(0, 48) })
        );

        if (!data?.summary) return;
        renderSummaryBar(shadow, bar, data.summary, query);
        if (data.listingBadges) {
          injectListingBadges(data.listingBadges);
        }
      } catch (err) {
        bar.innerHTML = `<span style="opacity:0.7">⚠ ${err.message || 'Veri yüklenemedi'}</span>`;
        console.error('[KX Search]', err);
      }
    }

    function extractListingIds() {
      const ids = [];
      const links = document.querySelectorAll('a[href*="/listing/"]');
      links.forEach(link => {
        const match = link.href.match(/\/listing\/(\d+)/);
        if (match && !ids.includes(match[1])) ids.push(match[1]);
      });
      return ids;
    }

    function renderSummaryBar(shadow, bar, summary, query) {
      const compColor = summary.competition === 'low' ? '#4caf50' : summary.competition === 'medium' ? '#ff9800' : '#f44336';
      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;font-weight:700;">
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;">KX</span>
          "${query}"
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Sonuç</span>
          <span class="kx-bar-value">${S.formatNum(summary.totalResults)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Ort. Fiyat</span>
          <span class="kx-bar-value">${S.formatPrice(summary.avgPrice)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Aralık</span>
          <span class="kx-bar-value" style="font-size:12px">${S.formatPrice(summary.minPrice)} - ${S.formatPrice(summary.maxPrice)}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Ort. Fav</span>
          <span class="kx-bar-value">${S.formatNum(summary.avgFavorites)}</span>
        </div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Mağaza</span>
          <span class="kx-bar-value">${summary.uniqueShops}</span>
        </div>
        <div class="kx-bar-divider"></div>
        <div class="kx-bar-item">
          <span class="kx-bar-label">Rekabet</span>
          <span class="kx-bar-value" style="color:${compColor}">${summary.competition === 'low' ? 'Düşük' : summary.competition === 'medium' ? 'Orta' : 'Yüksek'}</span>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px;">
          <button class="kx-btn kx-btn-sm" id="kx-xray-btn" style="background:rgba(255,255,255,0.2);">X-Ray</button>
          <a href="${S.API_BASE}/app/etsy-research" target="_blank" class="kx-btn kx-btn-sm" style="background:rgba(255,255,255,0.2);text-decoration:none;color:#fff;">
            Tam Analiz →
          </a>
        </div>
      `;

      // X-Ray button
      const xrayBtn = shadow.getElementById('kx-xray-btn');
      if (xrayBtn) {
        xrayBtn.addEventListener('click', () => showXRay(shadow, summary, query));
      }
    }

    function injectListingBadges(badges) {
      const links = document.querySelectorAll('a[href*="/listing/"]');
      const processed = new Set();

      links.forEach(link => {
        const match = link.href.match(/\/listing\/(\d+)/);
        if (!match || processed.has(match[1])) return;
        processed.add(match[1]);

        const badge = badges[match[1]];
        if (!badge) return;

        // Find the card container
        const card = link.closest('[data-listing-id]') || link.closest('.v2-listing-card') || link.parentElement;
        if (!card || card.querySelector('.kx-listing-badge')) return;

        card.style.position = 'relative';
        const badgeEl = document.createElement('div');
        badgeEl.className = 'kx-listing-badge';
        badgeEl.style.cssText = `
          position: absolute; top: 4px; left: 4px; z-index: 100;
          background: rgba(0,0,0,0.82); color: #fff; padding: 3px 7px;
          border-radius: 4px; font-size: 10px; font-weight: 600;
          display: flex; align-items: center; gap: 4px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          backdrop-filter: blur(4px); pointer-events: none;
        `;

        const salesColor = badge.estMonthlySales >= 5 ? '#4caf50' : badge.estMonthlySales >= 1 ? '#ff9800' : '#f44336';
        badgeEl.innerHTML = `
          <span style="color:${salesColor}">~${badge.estMonthlySales}/ay</span>
          <span style="opacity:0.5">|</span>
          <span>♥ ${S.formatNum(badge.favorites)}</span>
        `;
        card.appendChild(badgeEl);
      });
    }

    function showXRay(shadow, summary, query) {
      let xray = shadow.getElementById('kx-xray-panel');
      if (xray) { xray.remove(); return; }

      xray = document.createElement('div');
      xray.id = 'kx-xray-panel';
      xray.className = 'kx-panel';
      xray.innerHTML = `
        <div class="kx-panel-header">
          <span style="font-weight:700;">X-Ray: "${query}"</span>
          <button class="kx-btn kx-btn-sm" id="kx-xray-close" style="background:rgba(255,255,255,0.2);">✕</button>
        </div>
        <div class="kx-panel-body">
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Pazar Özeti</div>
            <div class="kx-metric"><span class="kx-metric-label">Toplam Sonuç</span><span class="kx-metric-value">${S.formatNum(summary.totalResults)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Ortalama Fiyat</span><span class="kx-metric-value">${S.formatPrice(summary.avgPrice)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Fiyat Aralığı</span><span class="kx-metric-value">${S.formatPrice(summary.minPrice)} - ${S.formatPrice(summary.maxPrice)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Ort. Favori</span><span class="kx-metric-value">${S.formatNum(summary.avgFavorites)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Ort. Görüntülenme</span><span class="kx-metric-value">${S.formatNum(summary.avgViews)}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Benzersiz Mağaza</span><span class="kx-metric-value">${summary.uniqueShops}</span></div>
            <div class="kx-metric"><span class="kx-metric-label">Rekabet</span><span class="kx-metric-value">${summary.competition === 'low' ? '🟢 Düşük' : summary.competition === 'medium' ? '🟡 Orta' : '🔴 Yüksek'}</span></div>
          </div>
          <div class="kx-panel-section">
            <a href="${S.API_BASE}/app/etsy-research" target="_blank" class="kx-btn" style="width:100%;justify-content:center;text-decoration:none;">
              KolayXport'ta Tam Analiz →
            </a>
          </div>
        </div>
      `;
      shadow.appendChild(xray);

      shadow.getElementById('kx-xray-close').addEventListener('click', () => xray.remove());
    }
  }
})();

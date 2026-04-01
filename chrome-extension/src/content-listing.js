/**
 * KolayXport Research — Listing Page Overlay
 * Collapsible right panel: SEO score, tags, velocity, price positioning
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) return;
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_SHARED;
    const C = window.__KX_CACHE;

    if (S.getPageType() !== 'listing') return;

    processListingPage();
    S.onUrlChange(() => {
      if (S.getPageType() === 'listing') setTimeout(processListingPage, 500);
    });

    let panelVisible = false;

    async function processListingPage() {
      const listingId = S.SELECTORS.listingId();
      if (!listingId) return;

      // Create toggle button
      const shadow = S.createOverlayContainer('kx-listing-overlay', 'fixed');

      let toggle = shadow.querySelector('.kx-toggle');
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.className = 'kx-toggle';
        toggle.textContent = 'KX Analiz';
        toggle.addEventListener('click', () => togglePanel(shadow, listingId));
        shadow.appendChild(toggle);
      }
    }

    async function togglePanel(shadow, listingId) {
      let panel = shadow.querySelector('.kx-panel');
      if (panel) {
        panel.remove();
        panelVisible = false;
        return;
      }

      panelVisible = true;
      panel = document.createElement('div');
      panel.className = 'kx-panel';
      panel.innerHTML = '<div class="kx-loading">Yükleniyor...</div>';
      shadow.appendChild(panel);

      try {
        const data = await C.getOrFetch(
          `listing:${listingId}`,
          'listing',
          () => S.apiCall('listing_enrich', { listingId })
        );

        if (!data) { panel.innerHTML = '<div class="kx-loading">Veri bulunamadı</div>'; return; }
        renderPanel(panel, data);
      } catch (err) {
        panel.innerHTML = `<div class="kx-loading">⚠ ${err.message}</div>`;
      }
    }

    function renderPanel(panel, data) {
      const { listing, velocity, seoScore, shop } = data;
      const sClass = S.scoreClass(seoScore?.total || 0);

      panel.innerHTML = `
        <div class="kx-panel-header">
          <span style="font-weight:700;font-size:13px;">KolayXport Analiz</span>
          <button class="kx-btn kx-btn-sm kx-panel-close" style="background:rgba(255,255,255,0.2);">✕</button>
        </div>
        <div class="kx-panel-body">
          <!-- SEO Score -->
          <div class="kx-panel-section" style="text-align:center;">
            <div class="kx-score-ring ${sClass}" style="margin:0 auto 8px;">
              ${seoScore?.total || 0}
            </div>
            <div style="font-weight:700;font-size:14px;">SEO Skoru</div>
          </div>

          <div class="kx-panel-section">
            <div class="kx-panel-section-title">SEO Detayları</div>
            ${renderScoreBar('Başlık', seoScore?.title || 0, 25)}
            ${renderScoreBar('Tagler', seoScore?.tags || 0, 25)}
            ${renderScoreBar('Açıklama', seoScore?.description || 0, 25)}
            ${renderScoreBar('Görseller', seoScore?.images || 0, 25)}
          </div>

          <!-- Velocity -->
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Satış Tahmini</div>
            <div class="kx-metric">
              <span class="kx-metric-label">Aylık Satış</span>
              <span class="kx-metric-value" style="color:${velocity?.estMonthlySales >= 5 ? '#4caf50' : '#ff9800'}">
                ~${velocity?.estMonthlySales || 0}/ay
              </span>
            </div>
            <div class="kx-metric">
              <span class="kx-metric-label">Listing Yaşı</span>
              <span class="kx-metric-value">${velocity?.ageMonths || 0} ay</span>
            </div>
            <div class="kx-metric">
              <span class="kx-metric-label">Favori</span>
              <span class="kx-metric-value">${S.formatNum(listing?.favorites || 0)}</span>
            </div>
            <div class="kx-metric">
              <span class="kx-metric-label">Görüntülenme</span>
              <span class="kx-metric-value">${S.formatNum(listing?.views || 0)}</span>
            </div>
          </div>

          <!-- Tags -->
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Tagler (${listing?.tagCount || 0}/13)</div>
            <div style="display:flex;flex-wrap:wrap;gap:3px;">
              ${(listing?.tags || []).map(t =>
                `<span class="kx-tag">${t}</span>`
              ).join('')}
            </div>
            ${(listing?.tagCount || 0) < 13 ? `<div style="color:#f44336;font-size:11px;margin-top:4px;">⚠ ${13 - (listing?.tagCount || 0)} tag eksik!</div>` : ''}
          </div>

          <!-- Shop -->
          ${shop ? `
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Mağaza</div>
            <div class="kx-metric">
              <span class="kx-metric-label">${shop.shop_name}</span>
              <span class="kx-metric-value">${S.formatNum(shop.num_sales)} satış</span>
            </div>
            <div class="kx-metric">
              <span class="kx-metric-label">Puan</span>
              <span class="kx-metric-value">${shop.rating ? shop.rating.toFixed(1) + ' ★' : 'N/A'}</span>
            </div>
          </div>` : ''}

          <!-- Actions -->
          <div class="kx-panel-section" style="text-align:center;">
            <a href="${S.API_BASE}/app/etsy-research" target="_blank" class="kx-btn" style="width:100%;justify-content:center;text-decoration:none;">
              Tam Analiz →
            </a>
          </div>
        </div>
      `;

      panel.querySelector('.kx-panel-close').addEventListener('click', () => {
        panel.remove();
      });
    }

    function renderScoreBar(label, value, max) {
      const pct = (value / max) * 100;
      const color = pct >= 70 ? '#4caf50' : pct >= 40 ? '#ff9800' : '#f44336';
      return `
        <div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
            <span>${label}</span>
            <span style="font-weight:700;color:${color}">${value}/${max}</span>
          </div>
          <div class="kx-progress">
            <div class="kx-progress-fill" style="width:${pct}%;background:${color};"></div>
          </div>
        </div>
      `;
    }
  }
})();

/**
 * KolayXport Research — eBay Listing Page Overlay
 * Collapsible right panel: SEO score, market position, competition, seller info
 */

(function () {
  'use strict';

  function waitForShared(cb, attempts = 0) {
    if (window.__KX_EBAY_SHARED && window.__KX_CACHE) { cb(); return; }
    if (attempts > 50) return;
    setTimeout(() => waitForShared(cb, attempts + 1), 100);
  }

  waitForShared(init);

  function init() {
    const S = window.__KX_EBAY_SHARED;
    const C = window.__KX_CACHE;

    if (S.getPageType() !== 'listing') return;

    processListingPage();
    S.onUrlChange(() => {
      if (S.getPageType() === 'listing') setTimeout(processListingPage, 500);
    });

    let panelVisible = false;

    async function processListingPage() {
      const itemId = S.SELECTORS.itemId();
      if (!itemId) return;

      const shadow = S.createOverlayContainer('kx-ebay-listing-overlay', 'fixed');

      let toggle = shadow.querySelector('.kx-toggle');
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.className = 'kx-toggle';
        toggle.textContent = 'KX Analiz';
        toggle.addEventListener('click', () => togglePanel(shadow, itemId));
        shadow.appendChild(toggle);
      }
    }

    async function togglePanel(shadow, itemId) {
      let panel = shadow.querySelector('.kx-panel');
      if (panel) {
        panel.remove();
        panelVisible = false;
        return;
      }

      panelVisible = true;
      panel = document.createElement('div');
      panel.className = 'kx-panel';
      panel.innerHTML = '<div class="kx-loading">Yukleniyor...</div>';
      shadow.appendChild(panel);

      const title = S.SELECTORS.itemTitle();

      try {
        // Fetch item details and SEO analysis in parallel
        const [itemData, seoData] = await Promise.all([
          C.getOrFetch(
            `ebay_listing:${itemId}`,
            'listing',
            () => S.apiCall('listing_enrich', { itemId })
          ).catch(() => null),
          title ? C.getOrFetch(
            `ebay_seo:${itemId}`,
            'listing',
            () => S.apiCall('seo_analyze', { query: title.split(' ').slice(0, 5).join(' '), title })
          ).catch(() => null) : null,
        ]);

        if (!itemData && !seoData) {
          panel.innerHTML = '<div class="kx-loading">Veri bulunamadi</div>';
          return;
        }

        renderPanel(panel, itemData, seoData, title, itemId);
      } catch (err) {
        panel.innerHTML = `<div class="kx-loading">⚠ ${err.message}</div>`;
      }
    }

    function renderPanel(panel, itemData, seoData, title, itemId) {
      // Extract data with fallbacks
      const item = itemData?.item || itemData || {};
      const seo = seoData?.seo || seoData || {};
      const market = itemData?.market || seoData?.market || {};
      const seller = item.seller || itemData?.seller || {};

      const seoScore = seo.total || seo.score || 0;
      const sClass = S.scoreClass(seoScore);

      const itemPrice = item.price || item.currentPrice || 0;
      const avgPrice = market.avgPrice || market.avg_price || 0;
      const medianPrice = market.medianPrice || market.median_price || 0;
      const competitorCount = market.competitorCount || market.competitors || market.uniqueSellers || 0;

      const sellerName = seller.username || seller.seller_name || '';
      const sellerFeedback = seller.feedbackScore || seller.feedback_score || 0;
      const sellerItems = seller.itemCount || seller.num_items || 0;
      const sellerRating = seller.positivePercent || seller.positive_feedback || 0;

      panel.innerHTML = `
        <div class="kx-panel-header">
          <span style="font-weight:700;font-size:13px;">KolayXport eBay Analiz</span>
          <button class="kx-btn kx-btn-sm kx-panel-close" style="background:rgba(255,255,255,0.2);">✕</button>
        </div>
        <div class="kx-panel-body">
          <!-- SEO Score -->
          <div class="kx-panel-section" style="text-align:center;">
            <div class="kx-score-ring ${sClass}" style="margin:0 auto 8px;">
              ${seoScore}
            </div>
            <div style="font-weight:700;font-size:14px;">SEO Skoru</div>
          </div>

          ${seo.title_score !== undefined || seo.titleScore !== undefined ? `
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">SEO Detaylari</div>
            ${renderScoreBar('Baslik', seo.title_score || seo.titleScore || 0, 30)}
            ${renderScoreBar('Spesifikler', seo.specifics_score || seo.specificsScore || 0, 25)}
            ${renderScoreBar('Gorseller', seo.image_score || seo.imageScore || 0, 20)}
            ${renderScoreBar('Aciklama', seo.description_score || seo.descriptionScore || 0, 15)}
            ${renderScoreBar('Fiyat', seo.price_score || seo.priceScore || 0, 10)}
          </div>
          ` : ''}

          <!-- Market Position -->
          ${avgPrice || medianPrice ? `
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Pazar Konumu</div>
            ${itemPrice ? `<div class="kx-metric"><span class="kx-metric-label">Urun Fiyati</span><span class="kx-metric-value">${S.formatPrice(itemPrice)}</span></div>` : ''}
            ${avgPrice ? `<div class="kx-metric"><span class="kx-metric-label">Pazar Ortalamasi</span><span class="kx-metric-value">${S.formatPrice(avgPrice)}</span></div>` : ''}
            ${medianPrice ? `<div class="kx-metric"><span class="kx-metric-label">Medyan Fiyat</span><span class="kx-metric-value">${S.formatPrice(medianPrice)}</span></div>` : ''}
            ${itemPrice && avgPrice ? `
            <div class="kx-metric">
              <span class="kx-metric-label">Fark</span>
              <span class="kx-metric-value" style="color:${itemPrice <= avgPrice ? '#4caf50' : '#f44336'}">
                ${itemPrice <= avgPrice ? '' : '+'}${((itemPrice - avgPrice) / avgPrice * 100).toFixed(1)}%
              </span>
            </div>` : ''}
          </div>` : ''}

          <!-- Competition -->
          ${competitorCount ? `
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Rekabet</div>
            <div class="kx-metric">
              <span class="kx-metric-label">Benzer Satici Sayisi</span>
              <span class="kx-metric-value">${competitorCount}</span>
            </div>
            <div class="kx-metric">
              <span class="kx-metric-label">Rekabet Duzeyi</span>
              <span class="kx-metric-value" style="color:${competitorCount < 20 ? '#4caf50' : competitorCount < 100 ? '#ff9800' : '#f44336'}">
                ${competitorCount < 20 ? 'Dusuk' : competitorCount < 100 ? 'Orta' : 'Yuksek'}
              </span>
            </div>
          </div>` : ''}

          <!-- Seller Info -->
          ${sellerName || sellerFeedback ? `
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">Satici Bilgisi</div>
            ${sellerName ? `<div class="kx-metric"><span class="kx-metric-label">Satici</span><span class="kx-metric-value">${sellerName}</span></div>` : ''}
            ${sellerFeedback ? `<div class="kx-metric"><span class="kx-metric-label">Geri Bildirim</span><span class="kx-metric-value">${S.formatNum(sellerFeedback)}</span></div>` : ''}
            ${sellerRating ? `<div class="kx-metric"><span class="kx-metric-label">Olumlu Oran</span><span class="kx-metric-value">${sellerRating}%</span></div>` : ''}
            ${sellerItems ? `<div class="kx-metric"><span class="kx-metric-label">Urun Sayisi</span><span class="kx-metric-value">${S.formatNum(sellerItems)}</span></div>` : ''}
          </div>` : ''}

          <!-- SEO Tips -->
          ${seo.tips && seo.tips.length > 0 ? `
          <div class="kx-panel-section">
            <div class="kx-panel-section-title">SEO Onerileri</div>
            ${seo.tips.map(tip => `<div style="font-size:11px;padding:3px 0;color:#555;">• ${tip}</div>`).join('')}
          </div>` : ''}

          <!-- Actions -->
          <div class="kx-panel-section" style="display:flex;flex-direction:column;gap:6px;">
            <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn" style="width:100%;justify-content:center;text-decoration:none;">
              AI ile Optimize Et →
            </a>
            <a href="${S.API_BASE}/app/ebay-research" target="_blank" class="kx-btn kx-btn-outline" style="width:100%;justify-content:center;text-decoration:none;">
              Urunu Takip Et
            </a>
          </div>
        </div>
      `;

      panel.querySelector('.kx-panel-close').addEventListener('click', () => {
        panel.remove();
        panelVisible = false;
      });
    }

    function renderScoreBar(label, value, max) {
      const pct = max > 0 ? (value / max) * 100 : 0;
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

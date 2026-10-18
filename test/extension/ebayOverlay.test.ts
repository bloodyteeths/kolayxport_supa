// End-to-end render of the eBay search + listing overlays in jsdom: real content
// scripts, stubbed chrome.* and API responses (fixtures, never the network).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
const fixture = (f: string) => readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

type ApiHandler = (action: string, params: Record<string, unknown>) => unknown;

/** `lang`: the popup choice stored as kx_lang; null = nothing stored (→ Turkish). */
function boot(url: string, html: string, onApi: ApiHandler, lang: 'tr' | 'en' | null = 'en') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window as unknown as Record<string, unknown> & { eval: (s: string) => unknown };
  const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  w.chrome = {
    i18n: { getUILanguage: () => 'en-US' }, // ignored: the resolver never reads the browser language
    storage: { local: { get: (_k: unknown, cb: (r: object) => void) => cb(lang ? { kx_lang: lang } : {}) } },
    runtime: {
      lastError: undefined,
      sendMessage: (msg: { action: string; params: Record<string, unknown> }, cb: (r: unknown) => void) => {
        calls.push({ action: msg.action, params: msg.params });
        setTimeout(() => cb(onApi(msg.action, msg.params)), 0);
      },
    },
  };
  w.__KX_CACHE = { getOrFetch: (_k: string, _t: string, fetcher: () => Promise<unknown>) => fetcher() };
  w.eval(src('lib/lang.js'));
  w.eval(src('lib/ui.js'));
  w.eval(src('lib/ebayMath.js'));
  w.eval(src('content-ebay-shared.js'));
  return { dom, calls, run: (f: string) => w.eval(src(f)) };
}

async function waitFor<T>(fn: () => T | null | undefined, ms = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Bar text once the API answer is in (the page-only first paint is data-kx-state="partial"). */
const barText = (dom: JSDOM) => {
  const host = dom.window.document.getElementById('kx-ebay-search-overlay');
  const bar = host?.shadowRoot?.querySelector('.kx-bar') as HTMLElement | null | undefined;
  if (!bar || bar.dataset.kxState !== 'full') return '';
  const t = (bar.textContent || '').replace(/\s+/g, ' ').trim();
  return t.includes('loading') || t.includes('yükleniyor') ? '' : t;
};

describe('eBay search overlay (new markup + API fixture)', () => {
  it('shows real numbers instead of $0.00 / 0 sellers / 9.0K', async () => {
    const api = JSON.parse(fixture('ebay-product-database.json'));
    const { dom, calls, run } = boot('https://www.ebay.com/sch/i.html?_nkw=turkish+cotton+towel', fixture('ebay-search-new.html'), () => api);
    run('content-ebay-search.js');
    const text = await waitFor(() => barText(dom));

    expect(calls[0]).toMatchObject({ action: 'search_enrich', params: { query: 'turkish cotton towel', marketplace: 'EBAY_US' } });
    expect(text).toContain('Results9,500+');
    expect(text).toContain('Typical price$25.99');
    expect(text).toContain('Most prices$18.00 – $31.50');
    expect(text).toContain('Different sellers4 of 5 listings');
    expect(text).toContain('Listings with sales');
    expect(text).toContain('Source: eBay API, top 5 best-match listings');
    expect(text).toMatch(/Competition ?est\.(Low|Medium|High)/);
    expect(text).toMatch(/(High|Medium|Low) competition: /); // one-line verdict
    expect(text).not.toContain('$0.00');

    const rows = Array.from(dom.window.document.querySelectorAll('.kx-data-row')).map((r) => (r.textContent || '').replace(/\s+/g, ' '));
    // Card 1: 120 sold (API), listed 2026-04-18 → est/mo; $25.99 = median
    expect(rows[0]).toContain('120 sold');
    expect(rows[0]).toMatch(/≈[\d.,]+ sales\/mo est\./);
    expect(rows[0]).toContain('at the typical price');
    // Card 2 is a price range → no vs-typical badge
    expect(rows[1]).not.toContain('typical price');
    // Ghost card got nothing
    const ghost = dom.window.document.querySelector('li[data-listingid="123456"] .kx-data-row');
    expect(ghost).toBeNull();
  });

  it('falls back to page numbers when the API errors, and escapes the query', async () => {
    const { dom, run } = boot('https://www.ebay.com/sch/i.html?_nkw=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', fixture('ebay-search-new.html'), () => ({ error: 'NOT_AUTHENTICATED' }));
    run('content-ebay-search.js');
    const text = await waitFor(() => barText(dom));
    expect(text).toContain('Source: 5 listings on this page');
    expect(text).toContain('Typical price$25.99');
    const host = dom.window.document.getElementById('kx-ebay-search-overlay');
    expect(host?.shadowRoot?.querySelector('img')).toBeNull();
  });

  it('ebay.de: EBAY_DE marketplace, English number format', async () => {
    const { dom, calls, run } = boot('https://www.ebay.de/sch/i.html?_nkw=handtuch&LH_BIN=1', fixture('ebay-search-de.html'), () => ({}));
    run('content-ebay-search.js');
    const text = await waitFor(() => barText(dom));
    expect(calls).toHaveLength(0); // filtered page → no API call
    expect(text).toContain('Results9,500+'); // numbers follow the overlay language (English here), not the marketplace
    expect(text).toContain('not enough data'); // 3 cards < 5
  });
});

describe('eBay listing overlay', () => {
  it('maps Browse API item + analyze_seo fields', async () => {
    const item = {
      itemId: 'v1|256789012345|0', title: 'Turkish Cotton Bath Towel Set of 4',
      price: { value: '31.50', currency: 'USD' },
      seller: { username: 'towelhaus', feedbackPercentage: '99.6', feedbackScore: 5210 },
      itemCreationDate: '2026-04-18T10:00:00.000Z',
      estimatedAvailabilities: [{ estimatedSoldQuantity: 120, estimatedRemainingQuantity: 30 }],
    };
    const seo = {
      totalCompetitors: 9012, seoScore: 65,
      priceStats: { n: 40, median: 25.99, p25: 18, p75: 31.5, currency: 'USD', quality: 'ok' },
      recommendations: [{ key: 'fewTopKeywords', params: { count: 3 } }],
    };
    const html = '<div id="mainContent"><div class="x-item-title"><h1 class="x-item-title__mainTitle"><span>Turkish Cotton Bath Towel Set of 4</span></h1></div></div>';
    const { dom, run } = boot('https://www.ebay.com/itm/256789012345', html, (action) =>
      action === 'listing_enrich' ? item : action === 'seo_analyze' ? seo : { items: [] });
    run('content-ebay-listing.js');
    const el = await waitFor(() => {
      const e = dom.window.document.getElementById('kx-ebay-listing-stats');
      return e && e.dataset.kxState === 'full' ? e : null;
    });
    const text = (el.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('SEO: 65/100');
    expect(text).toContain('Price: 21% above typical price ($25.99)');
    expect(text).toContain('120 sold');
    expect(text).toContain('Share of stock sold: 80% (30 available, est.)');
    expect(text).toContain('towelhaus 99.6% positive (5,210 feedback)');
    expect(text).toContain('9,012 similar listings');
    expect(text).toContain('Title contains only 3 of the 20 most common keywords.');
  });
});

describe('eBay overlays in Turkish (default, nothing stored)', () => {
  it('search bar + card rows: Turkish labels, tr-TR numbers, marketplace currency kept', async () => {
    const api = JSON.parse(fixture('ebay-product-database.json'));
    const { dom, run } = boot('https://www.ebay.com/sch/i.html?_nkw=turkish+cotton+towel', fixture('ebay-search-new.html'), () => api, null);
    run('content-ebay-search.js');
    const text = await waitFor(() => barText(dom));
    expect(text).toContain('Sonuç9.500+');
    expect(text).toContain('Tipik fiyat$25,99');
    expect(text).toContain('Fiyatların çoğu$18,00 – $31,50');
    expect(text).toContain('Farklı satıcı4 / 5 ilan');
    expect(text).toContain('Satış yapan ilan'); // in the "Daha fazla" row
    expect(text).toContain('Kaynak: eBay API, en iyi eşleşen 5 ilan');
    expect(text).toMatch(/Rekabet ?tahmini(Düşük|Orta|Yüksek)/);
    expect(text).toContain('Tam analiz');
    expect(text).not.toMatch(/Results|Median|Sellers|Competition/);

    const rows = Array.from(dom.window.document.querySelectorAll('.kx-data-row')).map((r) => (r.textContent || '').replace(/\s+/g, ' '));
    expect(rows[0]).toContain('120 satıldı');
    expect(rows[0]).toMatch(/≈[\d.,]+ satış\/ay tahmini/);
    expect(rows[0]).toContain('tipik fiyatta');
  });

  it('item panel in Turkish', async () => {
    const item = {
      price: { value: '31.50', currency: 'USD' },
      seller: { username: 'towelhaus', feedbackPercentage: '99.6', feedbackScore: 5210 },
      itemCreationDate: '2026-04-18T10:00:00.000Z',
      estimatedAvailabilities: [{ estimatedSoldQuantity: 120, estimatedRemainingQuantity: 30 }],
    };
    const seo = {
      totalCompetitors: 9012, seoScore: 65,
      priceStats: { n: 40, median: 25.99, p25: 18, p75: 31.5, currency: 'USD', quality: 'ok' },
      recommendations: [{ key: 'fewTopKeywords', params: { count: 3 } }],
    };
    const html = '<div id="mainContent"><div class="x-item-title"><h1 class="x-item-title__mainTitle"><span>Turkish Cotton Bath Towel Set of 4</span></h1></div></div>';
    const { dom, run } = boot('https://www.ebay.com/itm/256789012345', html, (action) =>
      action === 'listing_enrich' ? item : action === 'seo_analyze' ? seo : { items: [] }, null);
    run('content-ebay-listing.js');
    const el = await waitFor(() => {
      const e = dom.window.document.getElementById('kx-ebay-listing-stats');
      return e && e.dataset.kxState === 'full' ? e : null;
    });
    const text = (el.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Fiyat: tipik fiyattan %21 pahalı ($25,99)');
    expect(text).toContain('120 satıldı');
    expect(text).toContain('Stoğun satılan kısmı: %80 (30 mevcut, tahmini)');
    expect(text).toContain('towelhaus %99,6 olumlu (5.210 değerlendirme)');
    expect(text).toContain('9.012 benzer ilan');
    expect(text).toContain('Başlık en sık 20 anahtar kelimeden yalnızca 3 tanesini içeriyor.');
    expect(text).not.toMatch(/sold|positive|similar listings/);
  });
});

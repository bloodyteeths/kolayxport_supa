// The shared research UI (chrome-extension/src/lib/ui.js, "Blade" brand): every overlay on
// Etsy, eBay and Amazon renders with it (kx-ui root, the mark), the injected CSS never falls
// back to a serif, the "More" row and panel collapse persist in chrome.storage.local, and the
// "i" explanation renders in Turkish and English. Real content scripts in jsdom, stubbed chrome.*.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
const fixture = (f: string) => readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

type Msg = { type?: string; action?: string; params?: Record<string, any> };
const doms: JSDOM[] = [];
afterEach(() => { doms.length = 0; });

function boot(url: string, html: string, scripts: string[], onMsg: (m: Msg) => unknown, stored: Record<string, unknown> = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  doms.push(dom);
  const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
  const sets: Array<Record<string, unknown>> = [];
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  w.chrome = {
    storage: {
      local: {
        get: (k: string | string[], cb: (r: object) => void) => {
          const out: Record<string, unknown> = {};
          for (const key of ([] as string[]).concat(k)) if (key in stored) out[key] = stored[key];
          setTimeout(() => cb(out), 1);
        },
        set: (o: Record<string, unknown>) => { sets.push(o); Object.assign(stored, o); },
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { lastError: undefined, sendMessage: (m: Msg, cb?: (r: unknown) => void) => setTimeout(() => cb && cb(onMsg(m)), 0) },
  };
  w.open = () => null;
  w.__KX_CACHE = { getOrFetch: (_k: string, _t: string, f: () => Promise<unknown>) => f() };
  for (const s of scripts) w.eval(src(s));
  return { w, doc: w.document as Document, sets, stored };
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 15));
  }
}
const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

const ETSY = ['lib/lang.js', 'lib/ui.js', 'lib/limitCard.js', 'lib/etsyMath.js', 'content-shared.js'];
const EBAY = ['lib/lang.js', 'lib/ui.js', 'lib/limitCard.js', 'lib/ebayMath.js', 'content-ebay-shared.js'];
const AMZ = ['lib/lang.js', 'lib/ui.js', 'lib/limitCard.js', 'lib/amazonMath.js', 'content-amazon-shared.js'];

const etsyCard = (id: number, price: string) =>
  `<div data-listing-id="${id}" class="v2-listing-card"><a href="https://www.etsy.com/listing/${id}/x">Linen dress ${id}</a>` +
  `<p><span class="currency-symbol">$</span><span class="currency-value">${price}</span></p></div>`;
const ETSY_SEARCH = '<div><span>1,234 results</span></div>' + ['10.00', '20.00', '30.00', '40.00', '50.00', '60.00'].map((p, i) => etsyCard(201 + i, p)).join('');
const etsySearchApi = (m: Msg) => {
  if (m.action === 'search_enrich') return { summary: { totalResults: 5000, medianPrice: 29.99, currency: 'USD', uniqueShops: 60, medianFavorites: 1500, competition: 'high', used: 80 } };
  if (m.action === 'listings_batch') {
    const listings: Record<string, unknown> = {};
    (m.params!.listingIds as string[]).forEach((id) => {
      listings[id] = { listingId: id, favorites: 2500, shopId: 1, quantity: 10, sales: { kind: 'estimated', monthlySales: 4.5, confidence: 'medium', inputs: { recentListingReviews: 3, windowDays: 90, salesPerReview: 2.5 } } };
    });
    return { listings, pendingIds: [] };
  }
  return null;
};
const etsyListingApi = (m: Msg) => (m.type === 'kx_listing_stats'
  ? {
      fetchedAt: new Date().toISOString(),
      listing: { reviewCount: 1234, favorites: 5600, tagCount: 13, tags: ['linen dress'], ageDays: 120, quantity: 999 },
      shop: { soldCount: 15000, salesPerReview: 2.5, rating: 4.9 },
      sales: { kind: 'estimated', monthlySales: 4.5, confidence: 'medium', monthlyRevenue: 135, currency: 'USD', priceUsed: 29.99, priceSource: 'page', inputs: { recentListingReviews: 3, windowDays: 90, salesPerReview: 2.5, shopSold: 15000, shopReviewCount: 6000 } },
      seoScore: { total: 72 },
    }
  : null);
const etsyShopApi = () => ({
  shop: { shop_name: 'LinenHaus', currency: 'USD', num_sales: 15000, rating: 4.9, review_count: 6000, listing_count: 120, salesPerReview: 2.5, shopAgeYears: 6 },
  sales: { kind: 'measured', monthlySales: 120, monthlyRevenue: 3600, confidence: 'high', inputs: { shopSoldDelta: 40, spanDays: 10, avgPrice: 29.99 } },
  avgPrice: 29.99, topListings: [], lowStockCount: 0,
});
const EBAY_ITEM_HTML = '<div id="mainContent"><div class="x-item-title"><h1 class="x-item-title__mainTitle"><span>Turkish Cotton Bath Towel Set of 4</span></h1></div></div>';
const ebayItemApi = (m: Msg) => (m.action === 'listing_enrich'
  ? { price: { value: '31.50', currency: 'USD' }, seller: { username: 'towelhaus', feedbackPercentage: '99.6', feedbackScore: 5210 }, itemCreationDate: '2026-04-18T10:00:00.000Z', estimatedAvailabilities: [{ estimatedSoldQuantity: 120, estimatedRemainingQuantity: 30 }] }
  : m.action === 'seo_analyze'
    ? { totalCompetitors: 9012, seoScore: 65, priceStats: { n: 40, median: 25.99, p25: 18, p75: 31.5, currency: 'USD', quality: 'ok' }, recommendations: [] }
    : { items: [] });

/** Every style text the UI injected: page <head> and the overlay shadow roots. */
function injectedCss(doc: Document): string {
  const parts: string[] = [];
  doc.querySelectorAll('style').forEach((s) => parts.push(s.textContent || ''));
  doc.querySelectorAll('[id^="kx-"]').forEach((h) => h.shadowRoot?.querySelectorAll('style').forEach((s) => parts.push(s.textContent || '')));
  return parts.join('\n');
}

/** font-family declarations and --kx-font* tokens, with var() references resolved away. */
function fontStacks(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/(?:font-family|--kx-font(?:-display)?)\s*:\s*([^;}]+)/g)) {
    const v = m[1].trim();
    if (/^var\(|^inherit$/.test(v)) continue;
    out.push(v);
  }
  return out;
}
const SERIF = /(?<!sans-)\bserif\b|Times|Georgia/i;

// ---------------------------------------------------------------------------
describe('every overlay renders with the shared UI', () => {
  it('Etsy search: ink top bar in the shadow root (kx-ui, mark, chips, verdict) + card strips', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH, [...ETSY, 'content-search.js'], etsySearchApi);
    const bar = await waitFor(() => {
      const b = doc.getElementById('kx-search-overlay')?.shadowRoot?.querySelector('.kx-bar') as HTMLElement | null;
      return b && b.dataset.kxState === 'full' && b;
    });
    expect(bar.classList.contains('kx-ui')).toBe(true);
    expect(bar.classList.contains('kx-topbar')).toBe(true);
    expect(bar.querySelector('[data-kx-mark="dark"] svg')).not.toBeNull();
    expect(bar.querySelectorAll('.kx-topbar-main .kx-chip').length).toBeLessThanOrEqual(5);
    expect(bar.querySelector('[data-kx-verdict="high"]')!.textContent).toContain('Rekabet yüksek');
    expect(bar.querySelector('.kx-cta')!.textContent).toBe('Tam analiz');
    const row = await waitFor(() => doc.querySelector('[data-listing-id="201"] .kx-data-row:not([data-kx-skeleton])') as HTMLElement | null);
    expect(row.classList.contains('kx-ui')).toBe(true);
    expect(row.classList.contains('kx-strip')).toBe(true);
    expect(row.querySelector('[data-kx-mark="light"] svg')).not.toBeNull();
    expect(row.querySelector('.kx-info')).not.toBeNull();
    expect(doc.getElementById('kx-ui-css')).not.toBeNull(); // page CSS for strips, once
  });

  it('Etsy listing panel and shop bar', async () => {
    const a = boot('https://www.etsy.com/listing/1234567/linen', '<div data-buy-box-region="price"><p>$29.99</p></div>', [...ETSY, 'content-listing.js'], etsyListingApi);
    const panel = await waitFor(() => {
      const e = a.doc.getElementById('kx-listing-stats');
      return e && e.dataset.kxState === 'full' && e;
    });
    expect(panel.classList.contains('kx-ui')).toBe(true);
    expect(panel.classList.contains('kx-panel')).toBe(true);
    expect(panel.querySelector('.kx-panel-head [data-kx-mark] svg')).not.toBeNull();
    expect(panel.querySelector('.kx-caret')!.getAttribute('aria-expanded')).toBe('true');

    const b = boot('https://www.etsy.com/shop/LinenHaus', '', [...ETSY, 'content-shop.js'], etsyShopApi);
    const bar = await waitFor(() => {
      const e = b.doc.getElementById('kx-shop-overlay')?.shadowRoot?.querySelector('.kx-shop-bar') as HTMLElement | null;
      return e && e.dataset.kxState === 'full' && e;
    });
    expect(bar.classList.contains('kx-ui')).toBe(true);
    expect(bar.querySelector('[data-kx-mark="dark"]')).not.toBeNull();
  });

  it('eBay search bar, card strips and item panel', async () => {
    const api = JSON.parse(fixture('ebay-product-database.json'));
    const a = boot('https://www.ebay.com/sch/i.html?_nkw=turkish+cotton+towel', fixture('ebay-search-new.html'), [...EBAY, 'content-ebay-search.js'], () => api);
    const bar = await waitFor(() => {
      const e = a.doc.getElementById('kx-ebay-search-overlay')?.shadowRoot?.querySelector('.kx-bar') as HTMLElement | null;
      return e && e.dataset.kxState === 'full' && e;
    });
    expect(bar.classList.contains('kx-ui')).toBe(true);
    expect(bar.querySelector('[data-kx-mark="dark"]')).not.toBeNull();
    const row = a.doc.querySelector('.kx-data-row') as HTMLElement;
    expect(row.classList.contains('kx-strip')).toBe(true);
    expect(row.querySelector('[data-kx-mark="light"]')).not.toBeNull();

    const b = boot('https://www.ebay.com/itm/256789012345', EBAY_ITEM_HTML, [...EBAY, 'content-ebay-listing.js'], ebayItemApi);
    const panel = await waitFor(() => {
      const e = b.doc.getElementById('kx-ebay-listing-stats');
      return e && e.dataset.kxState === 'full' && e;
    });
    expect(panel.classList.contains('kx-ui')).toBe(true);
    expect(panel.classList.contains('kx-panel')).toBe(true);
    expect(panel.querySelector('[data-kx-mark]')).not.toBeNull();
  });

  it('Amazon search: the same ink top bar and strips (no beige box); product panel', async () => {
    const a = boot('https://www.amazon.com/s?k=turkish+towel', fixture('amazon-search-us.html'), [...AMZ, 'content-amazon-search.js'],
      () => ({ available: false, reason: 'not_connected' }));
    const bar = await waitFor(() => a.doc.getElementById('kx-amz-research-summary'));
    expect(bar.classList.contains('kx-ui')).toBe(true);
    expect(bar.classList.contains('kx-topbar')).toBe(true);
    expect(bar.querySelector('[data-kx-mark="dark"]')).not.toBeNull();
    expect(bar.querySelectorAll('.kx-topbar-main .kx-chip')).toHaveLength(5);
    expect(norm(bar.querySelector('.kx-cta')!.textContent)).toBe('Detaylı AI Analizi');
    const row = a.doc.querySelector('[data-asin="B0ORGANIC1"] .kx-amz-research-row') as HTMLElement;
    expect(row.classList.contains('kx-strip')).toBe(true);
    expect(row.querySelector('[data-kx-mark="light"]')).not.toBeNull();
    expect(a.doc.querySelector('.kx-amz-badge')).toBeNull();

    const b = boot('https://www.amazon.com/Turkish-Towel/dp/B0ORGANIC1', fixture('amazon-product-us.html'), [...AMZ, 'content-amazon-listing.js'],
      () => ({ available: false, reason: 'not_connected' }));
    const widget = await waitFor(() => b.doc.getElementById('kx-amz-research-widget'));
    expect(widget.classList.contains('kx-panel')).toBe(true);
    expect(widget.querySelector('[data-kx-mark]')).not.toBeNull();
    expect(widget.getAttribute('style') || '').not.toMatch(/FF9900|beige|#fff8e1/i);
  });
});

// ---------------------------------------------------------------------------
describe('no serif anywhere', () => {
  it('every font stack the overlays inject is sans-serif with a system fallback, and .kx-ui sets the font itself', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH, [...ETSY, 'content-search.js'], etsySearchApi);
    await waitFor(() => doc.getElementById('kx-search-overlay')?.shadowRoot?.querySelector('.kx-chip'));
    await waitFor(() => doc.getElementById('kx-ui-css'));
    const css = injectedCss(doc);
    const stacks = fontStacks(css);
    expect(stacks.length).toBeGreaterThan(0);
    for (const s of stacks) {
      expect(s).not.toMatch(SERIF);
      expect(s).toMatch(/system-ui/);
      expect(s).toMatch(/sans-serif$/);
    }
    // The host is `all: initial` (font = the browser default serif); the root sets the font.
    expect(css).toMatch(/\.kx-ui, \.kx-tip \{[^}]*font-family: var\(--kx-font\)/);
  });

  it('popup CSS and the limit card are sans-serif too', () => {
    for (const s of fontStacks(src('popup.css'))) expect(s).not.toMatch(SERIF);
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window as any;
    w.eval(src('lib/lang.js'));
    w.eval(src('lib/ui.js'));
    w.eval(src('lib/limitCard.js'));
    const card = w.__KX_LIMIT.buildCard({ error: 'research_limit', reason: 'user_daily', limit: 150, used: 150, upgradeUrl: 'https://kolayxport.com/plan' });
    const styles = [card, ...card.querySelectorAll('*')].map((n: HTMLElement) => n.getAttribute('style') || '').join(';');
    expect(styles).not.toMatch(SERIF);
    expect(styles).not.toMatch(/764ba2|667eea/); // the old purple is gone
  });
});

// ---------------------------------------------------------------------------
describe('compact by default, "More" expands; state persists', () => {
  it('the second row is hidden by default; the toggle opens it and stores kx_ui_more', async () => {
    const { doc, sets } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH, [...ETSY, 'content-search.js'], etsySearchApi);
    const bar = await waitFor(() => {
      const b = doc.getElementById('kx-search-overlay')?.shadowRoot?.querySelector('.kx-bar') as HTMLElement | null;
      return b && b.dataset.kxState === 'full' && b;
    });
    const more = bar.querySelector('[data-kx-more]') as HTMLElement;
    const btn = bar.querySelector('[data-kx-more-toggle]') as HTMLButtonElement;
    expect(more.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(norm(btn.textContent)).toContain('Daha fazla');
    // Its numbers are in the DOM already (no layout jump, readable once opened).
    expect(norm(more.textContent)).toContain('Farklı mağaza60');
    btn.click();
    expect(more.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(norm(btn.textContent)).toContain('Daha az');
    expect(sets).toContainEqual({ kx_ui_more: true });
  });

  it('a stored expanded state opens the row on the next page; panel collapse is stored too', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH, [...ETSY, 'content-search.js'], etsySearchApi, { kx_ui_more: true });
    const bar = await waitFor(() => {
      const b = doc.getElementById('kx-search-overlay')?.shadowRoot?.querySelector('.kx-bar') as HTMLElement | null;
      return b && b.dataset.kxState === 'full' && b;
    });
    await waitFor(() => (bar.querySelector('[data-kx-more]') as HTMLElement).hidden === false);

    const p = boot('https://www.etsy.com/listing/1234567/linen', '<div data-buy-box-region="price"><p>$29.99</p></div>', [...ETSY, 'content-listing.js'], etsyListingApi);
    const panel = await waitFor(() => {
      const e = p.doc.getElementById('kx-listing-stats');
      return e && e.dataset.kxState === 'full' && e;
    });
    const caret = panel.querySelector('.kx-caret') as HTMLButtonElement;
    caret.click();
    expect(panel.hasAttribute('data-kx-collapsed')).toBe(true);
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    expect(p.sets).toContainEqual({ kx_ui_panel_collapsed: true });

    const q = boot('https://www.etsy.com/listing/1234567/linen', '<div data-buy-box-region="price"><p>$29.99</p></div>', [...ETSY, 'content-listing.js'], etsyListingApi, { kx_ui_panel_collapsed: true });
    const panel2 = await waitFor(() => {
      const e = q.doc.getElementById('kx-listing-stats');
      return e && e.dataset.kxState === 'full' && e;
    });
    await waitFor(() => panel2.hasAttribute('data-kx-collapsed'));
  });
});

// ---------------------------------------------------------------------------
describe('"Nasıl hesaplandı?" — the "i" explanation', () => {
  const tipText = (doc: Document) => {
    const box = doc.getElementById('kx-ui-tip')?.shadowRoot?.getElementById('kx-tip-box') as HTMLElement | null;
    return box && !box.hidden ? norm(box.textContent) : '';
  };

  it('Turkish: click shows plain words, the formula, the source and the confidence; Escape closes', async () => {
    const { doc, w } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH, [...ETSY, 'content-search.js'], etsySearchApi);
    const bar = await waitFor(() => {
      const b = doc.getElementById('kx-search-overlay')?.shadowRoot?.querySelector('.kx-bar') as HTMLElement | null;
      return b && b.dataset.kxState === 'full' && b;
    });
    const info = bar.querySelector('[data-kx-chip="price"] .kx-info') as HTMLButtonElement;
    expect(info.textContent).toBe(''); // the "i" is drawn by CSS: no stray text in the numbers
    expect(info.getAttribute('aria-label')).toBe('Nasıl hesaplandı: Tipik fiyat');
    info.click();
    const t = await waitFor(() => tipText(doc));
    expect(t).toContain('Nasıl hesaplandı?');
    expect(t).toContain('Ortadaki fiyat: ilanların yarısı daha ucuz');
    expect(t).toContain('Hesap: Bu sayfadaki 6 ilanın');
    expect(t).toContain('Kaynak: bu Etsy sayfası');
    expect(t).toContain('Güven: orta');
    expect(info.getAttribute('aria-expanded')).toBe('true');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tipText(doc)).toBe('');

    // Keyboard focus opens it too.
    const range = bar.querySelector('[data-kx-chip="range"] .kx-info') as HTMLButtonElement;
    range.dispatchEvent(new w.FocusEvent('focusin', { bubbles: true, composed: true }));
    expect(await waitFor(() => tipText(doc))).toContain('P25–P75');
  });

  it('English, and on a card strip inside a listing link (no navigation)', async () => {
    const { doc, w } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH, [...ETSY, 'content-search.js'], etsySearchApi, { kx_lang: 'en' });
    const row = await waitFor(() => doc.querySelector('[data-listing-id="201"] .kx-data-row:not([data-kx-skeleton])') as HTMLElement | null);
    const info = row.querySelector('.kx-info') as HTMLButtonElement;
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    info.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const t = await waitFor(() => tipText(doc));
    expect(t).toContain('How is this calculated?');
    expect(t).toContain("This listing's recent reviews multiplied by the shop's sales per review");
    expect(t).toContain('Formula: Estimate: 3 reviews in the last 90 days');
    expect(t).toContain('Source: Etsy API');
    expect(t).toContain('Confidence: medium');
  });

  it('eBay and Amazon numbers carry an "i" as well', async () => {
    const b = boot('https://www.ebay.com/itm/256789012345', EBAY_ITEM_HTML, [...EBAY, 'content-ebay-listing.js'], ebayItemApi, { kx_lang: 'en' });
    const panel = await waitFor(() => {
      const e = b.doc.getElementById('kx-ebay-listing-stats');
      return e && e.dataset.kxState === 'full' && e;
    });
    const infos = Array.from(panel.querySelectorAll('.kx-info')) as HTMLElement[];
    expect(infos.length).toBeGreaterThanOrEqual(3);
    expect(infos.map((i) => i.dataset.kxSource).join('|')).toContain('eBay API');

    const a = boot('https://www.amazon.com/s?k=turkish+towel', fixture('amazon-search-us.html'), [...AMZ, 'content-amazon-search.js'],
      () => ({ available: false, reason: 'not_connected' }), { kx_lang: 'tr' });
    const bar = await waitFor(() => a.doc.getElementById('kx-amz-research-summary'));
    (bar.querySelector('[data-kx-chip="competition"] .kx-info') as HTMLButtonElement).click();
    const tip = await waitFor(() => tipText(a.doc));
    expect(tip).toContain('Nasıl hesaplandı?');
    expect(tip).toContain('0–100 skor');
    expect(tip).toContain('Kaynak: bu Amazon sayfası');
    const strip = a.doc.querySelector('[data-asin="B0ORGANIC1"] .kx-amz-research-row .kx-info') as HTMLElement;
    expect(strip.dataset.kxSource).toBe("Amazon'un kendi rakamı + bu Amazon sayfası");
  });
});

// ---------------------------------------------------------------------------
describe('plain-language helpers', () => {
  const ui = (lang: 'tr' | 'en') => {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window as any;
    w.chrome = { storage: { local: { get: (_k: unknown, cb: (r: object) => void) => cb({ kx_lang: lang }) } } };
    w.eval(src('lib/lang.js'));
    w.eval(src('lib/ui.js'));
    return w.__KX_UI;
  };

  it('Turkish number suffixes ("17 ilandan 11\'i")', () => {
    const U = ui('tr');
    expect([1, 2, 3, 6, 9, 10, 11, 20, 40, 60, 100, 1000].map((n) => n + U.trOf(n)))
      .toEqual(["1'i", "2'si", "3'ü", "6'sı", "9'u", "10'u", "11'i", "20'si", "40'ı", "60'ı", "100'ü", "1000'i"]);
  });

  it('verdict restates the competition level honestly, never promises sales', async () => {
    const U = ui('tr');
    await new Promise((r) => setTimeout(r, 5));
    expect(U.verdict('high').text).toBe('Rekabet yüksek: yeni bir ürün için zorlu bir pazar');
    expect(U.verdict('low', 0.7).text).toBe('Rekabet düşük: girmek için iyi bir fırsat olabilir; ilanların çoğu satış yapıyor');
    expect(U.verdict('unknown')).toBeNull();
    const E = ui('en');
    await new Promise((r) => setTimeout(r, 5));
    expect(E.verdict('medium').text).toBe('Medium competition: room for a strong listing');
    for (const l of ['low', 'medium', 'high']) expect(E.verdict(l).text).not.toMatch(/guarantee|will sell|sales of/i);
    expect(E.vsTypical(-30).text).toBe('30% below typical price');
    expect(U.vsTypical(12).text).toBe('tipik fiyattan %12 pahalı');
  });
});

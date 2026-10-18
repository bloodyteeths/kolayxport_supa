// Progressive rendering: every research overlay paints page-derived values at once, with
// placeholders where only the API can answer, BEFORE any API call resolves (deferred
// promises), sends its independent API calls in parallel, then fills the same slots in place.
// Real content scripts in jsdom, stubbed chrome.* (never the network).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
const fixture = (f: string) => readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

type Msg = { type?: string; action?: string; params?: Record<string, any>; pv?: string };

interface Deferred { promise: Promise<unknown>; resolve: (v: unknown) => void }
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * Boot real content scripts. Every API message gets a deferred answer, keyed by `keyOf(msg)`;
 * the test resolves them one by one. `onLate` answers messages without a pending deferred.
 */
function boot(url: string, html: string, scripts: string[], keyOf: (m: Msg) => string, opts: { lang?: string; debug?: boolean; onLate?: (m: Msg) => unknown } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
  const calls: Msg[] = [];
  const pending = new Map<string, Deferred[]>();
  const answer = (key: string) => {
    const list = pending.get(key) || [];
    if (!list.length) list.push(deferred());
    pending.set(key, list);
    return list[0];
  };
  if (opts.debug) w.localStorage.setItem('kx_debug', '1');
  // jsdom has no layout, so no innerText: the page-signal scraper reads it (textContent is close enough here).
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });
  w.chrome = {
    storage: { local: { get: (_k: unknown, cb: (r: object) => void) => setTimeout(() => cb({ kx_lang: opts.lang || 'en' }), 1) } },
    runtime: {
      lastError: undefined,
      sendMessage: (msg: Msg, cb: (r: unknown) => void) => {
        calls.push(msg);
        const key = keyOf(msg);
        const late = opts.onLate && (pending.get(key) || []).length === 0 && calls.filter((c) => keyOf(c) === key).length > 1;
        if (late) { setTimeout(() => cb(opts.onLate!(msg)), 0); return; }
        answer(key).promise.then((r) => cb(r));
      },
    },
  };
  w.__KX_CACHE = { getOrFetch: (_k: string, _t: string, fetcher: () => Promise<unknown>) => fetcher() };
  for (const s of scripts) w.eval(src(s));
  return {
    w,
    doc: w.document as Document,
    calls,
    resolve: (key: string, value: unknown) => {
      const d = answer(key);
      d.resolve(value);
      pending.set(key, (pending.get(key) || []).slice(1));
    },
  };
}

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
const shadowBar = (doc: Document, id: string, sel: string) => doc.getElementById(id)?.shadowRoot?.querySelector(sel) as HTMLElement | null;
const ETSY = ['lib/lang.js', 'lib/ui.js', 'lib/perf.js', 'lib/limitCard.js', 'lib/etsyMath.js', 'content-shared.js'];
const EBAY = ['lib/lang.js', 'lib/ui.js', 'lib/perf.js', 'lib/ebayMath.js', 'content-ebay-shared.js'];

// ---------------------------------------------------------------------------
// Etsy search
// ---------------------------------------------------------------------------
const etsyCard = (id: number, price: string, ad = false) =>
  `<div data-listing-id="${id}" class="v2-listing-card"><a href="https://www.etsy.com/listing/${id}/x">Linen dress ${id}</a>` +
  (ad ? '<p>Ad by Etsy seller</p>' : '') +
  `<p><span class="currency-symbol">$</span><span class="currency-value">${price}</span></p></div>`;
const ETSY_SEARCH_HTML = '<div><span>1,234 results</span></div>' +
  [['10.00'], ['20.00'], ['30.00'], ['40.00'], ['50.00'], ['60.00']].map(([p], i) => etsyCard(201 + i, p)).join('') +
  etsyCard(299, '100.00', true);

const etsyKey = (m: Msg) => (m.type === 'kx_listing_stats' ? 'lstats:' + (m.params?.phase || 'full') : String(m.action));

describe('Etsy search: page values first, API in parallel', () => {
  it('renders result count, median / P25–P75 of displayed prices, ads and per-card placeholders before any API answer', async () => {
    const { doc, calls, resolve } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH_HTML, [...ETSY, 'content-search.js'], etsyKey);
    const bar = await waitFor(() => shadowBar(doc, 'kx-search-overlay', '.kx-bar'));
    await waitFor(() => doc.querySelectorAll('.kx-data-row').length === 7);

    // Instant (no API answered yet).
    expect(bar.dataset.kxState).toBe('partial');
    const t = norm(bar.textContent);
    expect(t).toContain('Results1.2K'); // what Etsy prints on the page
    expect(t).toContain('Typical price$35.00'); // 6 organic cards, the ad excluded
    expect(t).toContain('Most prices$22.50 – $47.50');
    expect(t).toContain('Ads on page1');
    expect(bar.querySelectorAll('.kx-skel').length).toBeGreaterThanOrEqual(3); // fav, shops, competition
    const row = doc.querySelector('[data-listing-id="201"] .kx-data-row') as HTMLElement;
    expect(row.dataset.kxSkeleton).toBe('1');
    expect(row.querySelectorAll('.kx-skel').length).toBeGreaterThan(0);
    expect(norm(row.textContent)).toContain('71% below typical price'); // page-only, instant
    // Summary and card stats were requested together (parallel), neither has answered.
    expect(calls.map((c) => c.action).sort()).toEqual(['listings_batch', 'search_enrich']);

    // Card stats arrive first: rows fill in place, the bar still waits for the summary.
    const ids = calls.find((c) => c.action === 'listings_batch')!.params!.listingIds as string[];
    const listings = Object.fromEntries(ids.map((id) => [id, {
      listingId: id, favorites: 100, shopId: Number(id), quantity: 10,
      sales: { kind: 'estimated', monthlySales: 4.5, confidence: 'medium', inputs: { recentListingReviews: 3, windowDays: 90, salesPerReview: 2.5 } },
    }]));
    resolve('listings_batch', { listings, pendingIds: [] });
    await waitFor(() => !doc.querySelector('.kx-data-row[data-kx-skeleton]'));
    expect(norm(doc.querySelector('[data-listing-id="201"] .kx-data-row')!.textContent)).toContain('≈4.5 sales/mo');
    expect(doc.querySelectorAll('[data-listing-id="201"] .kx-data-row')).toHaveLength(1);
    expect(shadowBar(doc, 'kx-search-overlay', '.kx-bar')!.dataset.kxState).toBe('partial');

    // Summary arrives: placeholders replaced in the same slots.
    resolve('search_enrich', { summary: { totalResults: 5000, medianPrice: 29.99, currency: 'USD', uniqueShops: 40, medianFavorites: 1500, competition: 'medium', used: 80 } });
    const full = await waitFor(() => {
      const b = shadowBar(doc, 'kx-search-overlay', '.kx-bar');
      return b && b.dataset.kxState === 'full' && b;
    });
    expect(full.querySelectorAll('.kx-skel')).toHaveLength(0);
    const ft = norm(full.textContent);
    expect(ft).toContain('Different shops40');
    expect(ft).toContain('CompetitionMedium');
    expect(ft).toContain('Medium competition: room for a strong listing');
    expect(ft).toContain('Results1.2K');
    expect(ft).toContain('Typical favorites100'); // page cards' API favourites (>= 5)
  });

  it('Turkish first paint, perf marks behind kx_debug', async () => {
    const { doc, w } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH_HTML, [...ETSY, 'content-search.js'], etsyKey, { lang: 'tr', debug: true });
    const bar = await waitFor(() => shadowBar(doc, 'kx-search-overlay', '.kx-bar'));
    await waitFor(() => w.__KX_PERF.log.some((e: any) => e.label === 'first_paint'));
    const t = norm(bar.textContent);
    expect(t).toContain('Sonuç1,2K');
    expect(t).toContain('Tipik fiyat$35,00');
    expect(t).toContain('Reklamlı ilan1');
    expect(t).not.toMatch(/Results|Median|Competition/);
    expect(w.__KX_PERF.log.map((e: any) => `${e.surface}:${e.label}`)).toEqual(expect.arrayContaining(['etsy_search:start', 'etsy_search:first_paint']));
  });

  it('no perf log without kx_debug', async () => {
    const { doc, w } = boot('https://www.etsy.com/search?q=linen+dress', ETSY_SEARCH_HTML, [...ETSY, 'content-search.js'], etsyKey);
    await waitFor(() => shadowBar(doc, 'kx-search-overlay', '.kx-bar'));
    expect(w.__KX_PERF.log).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Etsy listing panel
// ---------------------------------------------------------------------------
const LISTING_HTML = '<div data-buy-box-region="price"><p><span class="currency-symbol">$</span><span class="currency-value">29.99</span></p> <p>In 20+ carts</p></div>' +
  '<div data-shop-id="555123">shop</div>';

const fullListing = {
  listingId: '1234567', fetchedAt: new Date().toISOString(),
  listing: { reviewCount: 1234, favorites: 5600, views: 800, tagCount: 13, tags: ['linen dress'], ageDays: 120, quantity: 999 },
  shop: { soldCount: 15000, salesPerReview: 2.5, rating: 4.9 },
  sales: {
    kind: 'estimated', monthlySales: 4.5, confidence: 'medium', monthlyRevenue: 135, currency: 'USD', priceUsed: 29.99, priceSource: 'page',
    inputs: { recentListingReviews: 3, windowDays: 90, salesPerReview: 2.5, shopSold: 15000, shopReviewCount: 6000 },
  },
  seoScore: { total: 72 },
};

describe('Etsy listing panel: page signals first, core then full', () => {
  it('paints price + carts + placeholders instantly, sends core and full together, fills core facts then sales', async () => {
    const { doc, calls, resolve } = boot('https://www.etsy.com/listing/1234567/linen', LISTING_HTML, [...ETSY, 'content-listing.js'], etsyKey);
    const el = await waitFor(() => doc.getElementById('kx-listing-stats'));
    await waitFor(() => calls.length === 2);

    expect(el.dataset.kxState).toBe('loading');
    const t = norm(el.textContent);
    expect(t).toContain('Price$29.99');
    expect(t).toContain('In carts: 20+');
    expect(el.querySelectorAll('.kx-skel').length).toBeGreaterThanOrEqual(5);
    // Core and full requested in parallel; the page's shop id rides along.
    expect(calls.map((c) => c.params?.phase || 'full').sort()).toEqual(['core', 'full']);
    expect(calls[0].params!.page.shopIdHint).toBe('555123');

    resolve('lstats:core', { listingId: '1234567', phase: 'core', listing: { favorites: 5600, views: 800, tagCount: 13, tags: ['linen dress'], ageDays: 120, quantity: 999 } });
    await waitFor(() => el.dataset.kxState === 'core');
    const tc = norm(el.textContent);
    expect(tc).toContain('Favorites5.6K');
    expect(tc).toContain('Views800');
    expect(tc).toContain('Tags13/13');
    expect(tc).toContain('linen dress');
    expect(tc).not.toContain('sales/mo');
    expect(el.querySelector('.kx-sales .kx-skel')).not.toBeNull(); // sales slot still loading

    resolve('lstats:full', fullListing);
    await waitFor(() => el.dataset.kxState === 'full');
    const tf = norm(el.textContent);
    expect(tf).toContain('≈4.5 sales/mo');
    expect(tf).toContain('SEO72/100');
    expect(tf).toContain('Listing reviews1.2K');
    expect(tf).toContain('Shop total sales15.0K');
    expect(el.querySelectorAll('.kx-skel')).toHaveLength(0);
    expect(doc.querySelectorAll('#kx-listing-stats')).toHaveLength(1);
  });

  it('full before core: the late core answer never overwrites the full panel', async () => {
    const { doc, resolve, calls } = boot('https://www.etsy.com/listing/1234567/linen', LISTING_HTML, [...ETSY, 'content-listing.js'], etsyKey);
    const el = await waitFor(() => doc.getElementById('kx-listing-stats'));
    await waitFor(() => calls.length === 2);
    resolve('lstats:full', fullListing);
    await waitFor(() => el.dataset.kxState === 'full');
    resolve('lstats:core', { listingId: '1234567', phase: 'core', listing: { favorites: 1 } });
    await new Promise((r) => setTimeout(r, 30));
    expect(el.dataset.kxState).toBe('full');
    expect(norm(el.textContent)).toContain('Favorites5.6K');
  });
});

// ---------------------------------------------------------------------------
// Etsy shop bar
// ---------------------------------------------------------------------------
describe('Etsy shop bar: name + page sales first, shop stats and grid rows in parallel', () => {
  it('renders before the API answers, then fills', async () => {
    const html = '<div><span>5,678 Sales</span></div>' + [301, 302].map((id) => etsyCard(id, '25.00')).join('');
    const { doc, calls, resolve } = boot('https://www.etsy.com/shop/LinenHaus', html, [...ETSY, 'content-shop.js'], etsyKey);
    const bar = await waitFor(() => shadowBar(doc, 'kx-shop-overlay', '.kx-shop-bar'));
    await waitFor(() => calls.length === 2);
    expect(bar.dataset.kxState).toBe('partial');
    const t = norm(bar.textContent);
    expect(t).toContain('LinenHaus');
    expect(t).toContain('Total sales5.7K');
    expect(bar.querySelectorAll('.kx-skel').length).toBeGreaterThanOrEqual(4);
    expect(calls.map((c) => c.action).sort()).toEqual(['listings_batch', 'shop_enrich']);
    expect(doc.querySelectorAll('.kx-data-row[data-kx-skeleton]')).toHaveLength(2);

    resolve('shop_enrich', {
      shop: { shop_name: 'LinenHaus', currency: 'USD', num_sales: 15000, rating: 4.9, review_count: 6000, listing_count: 120, salesPerReview: 2.5, shopAgeYears: 6 },
      sales: { kind: 'measured', monthlySales: 120, monthlyRevenue: 3600, confidence: 'high', inputs: { shopSoldDelta: 40, spanDays: 10, avgPrice: 29.99 } },
      avgPrice: 29.99, topListings: [], lowStockCount: 0,
    });
    await waitFor(() => bar.dataset.kxState === 'full');
    expect(norm(bar.textContent)).toContain('measured, high confidence');
    expect(norm(bar.textContent)).toContain('Total sales15.0K');
    resolve('listings_batch', { listings: { 301: { listingId: '301', favorites: 9, sales: { kind: 'insufficient' } }, 302: { listingId: '302', favorites: 9, sales: { kind: 'insufficient' } } }, pendingIds: [] });
    await waitFor(() => doc.querySelectorAll('.kx-data-row[data-kx-skeleton]').length === 0 && doc.querySelectorAll('.kx-data-row').length === 2);
  });
});

// ---------------------------------------------------------------------------
// eBay search
// ---------------------------------------------------------------------------
describe('eBay search: page values first, sold lookups for the first viewport only', () => {
  it('paints the page summary + "N sold" rows instantly, asks for <= 8 viewport ids, fills, then re-polls pending sold counts', async () => {
    const api = JSON.parse(fixture('ebay-product-database.json'));
    const later = { ...api, items: api.items.map((i: any) => (i.legacyItemId === '256789012347' ? { ...i, enriched: true, estimatedSoldQuantity: 7 } : i)), pendingIds: [] };
    const { doc, calls, resolve } = boot('https://www.ebay.com/sch/i.html?_nkw=turkish+cotton+towel', fixture('ebay-search-new.html'), EBAY.concat('content-ebay-search.js'),
      (m) => String(m.action), { onLate: () => later });
    const bar = await waitFor(() => shadowBar(doc, 'kx-ebay-search-overlay', '.kx-bar'));
    await waitFor(() => calls.length === 1);

    expect(bar.dataset.kxState).toBe('partial');
    expect(norm(bar.textContent)).toContain('Results9,500+');
    expect(bar.querySelectorAll('.kx-skel').length).toBeGreaterThan(0);
    const rowOf = (id: string) => doc.querySelector(`li[data-listingid="${id}"] .kx-data-row`);
    expect(norm(rowOf('256789012345')!.textContent)).toContain('65+ sold'); // the card's own text, instant
    expect(rowOf('256789012347')!.querySelector('.kx-skel')).not.toBeNull(); // sold count pending
    const enrichIds = calls[0].params!.enrichIds as string[];
    expect(enrichIds.length).toBeGreaterThan(0);
    expect(enrichIds.length).toBeLessThanOrEqual(8);
    expect(enrichIds).toContain('256789012347');

    // Server time box hit: 347 still pending → placeholder stays, everything else fills.
    resolve('search_enrich', { ...api, pendingIds: ['256789012347'] });
    await waitFor(() => bar.dataset.kxState === 'full');
    expect(norm(bar.textContent)).toContain('Source: eBay API, top 5 best-match listings');
    expect(norm(rowOf('256789012345')!.textContent)).toContain('120 sold');
    expect(rowOf('256789012347')!.querySelector('.kx-skel')).not.toBeNull();

    // Re-poll (~2.5 s later) fills it.
    await waitFor(() => norm(rowOf('256789012347')?.textContent).includes('7 sold'), 6000);
    expect(calls).toHaveLength(2);
    expect(rowOf('256789012347')!.querySelector('.kx-skel')).toBeNull();
  }, 10000);
});

// ---------------------------------------------------------------------------
// eBay item panel
// ---------------------------------------------------------------------------
describe('eBay item panel: page sold count first, three calls in parallel', () => {
  it('fills SEO / item / best-seller slots independently', async () => {
    const html = '<div id="mainContent"><div class="x-item-title"><h1 class="x-item-title__mainTitle"><span>Turkish Cotton Bath Towel Set of 4</span></h1></div>' +
      '<div class="x-quantity__availability">More than 10 available · 1,234 sold</div></div>';
    const { doc, calls, resolve } = boot('https://www.ebay.com/itm/256789012345', html, EBAY.concat('content-ebay-listing.js'), (m) => String(m.action));
    const el = await waitFor(() => doc.getElementById('kx-ebay-listing-stats'));
    await waitFor(() => calls.length === 3);
    expect(calls.map((c) => c.action).sort()).toEqual(['listing_enrich', 'search_enrich', 'seo_analyze']);
    expect(el.dataset.kxState).toBe('partial');
    expect(norm(el.textContent)).toContain('1,234 sold');
    expect(el.querySelectorAll('.kx-skel').length).toBeGreaterThanOrEqual(3);

    resolve('seo_analyze', { totalCompetitors: 9012, seoScore: 65, priceStats: { n: 40, median: 25.99, p25: 18, p75: 31.5, currency: 'USD', quality: 'ok' }, recommendations: [] });
    await waitFor(() => norm(el.textContent).includes('SEO: 65/100'));
    expect(el.dataset.kxState).toBe('partial');
    resolve('listing_enrich', {
      price: { value: '31.50', currency: 'USD' }, seller: { username: 'towelhaus', feedbackPercentage: '99.6', feedbackScore: 5210 },
      itemCreationDate: '2026-04-18T10:00:00.000Z', estimatedAvailabilities: [{ estimatedSoldQuantity: 120, estimatedRemainingQuantity: 30 }],
    });
    await waitFor(() => norm(el.textContent).includes('towelhaus'));
    resolve('search_enrich', { items: [] });
    await waitFor(() => el.dataset.kxState === 'full');
    expect(el.querySelectorAll('.kx-skel')).toHaveLength(0);
    expect(norm(el.textContent)).toContain('120 sold');
  });
});

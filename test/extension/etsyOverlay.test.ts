// Etsy search bar + card rows, listing panel and shop bar rendered in jsdom in both
// languages: Turkish by default (nothing stored), English when kx_lang = 'en', and a live
// switch from the popup. Real content scripts, stubbed chrome.* (never the network).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');

type Msg = { type?: string; action?: string; params?: Record<string, unknown> };
const doms: JSDOM[] = [];
afterEach(() => { doms.length = 0; });

function boot(url: string, html: string, scripts: string[], onMsg: (m: Msg) => unknown, stored: Record<string, unknown> = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  doms.push(dom);
  const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
  const listeners: Array<(c: Record<string, unknown>, area: string) => void> = [];
  const calls: Msg[] = [];
  w.chrome = {
    i18n: { getUILanguage: () => 'en-US' }, // must be ignored
    storage: {
      local: {
        get: (k: string | string[], cb: (r: object) => void) => {
          const out: Record<string, unknown> = {};
          for (const key of ([] as string[]).concat(k)) if (key in stored) out[key] = stored[key];
          setTimeout(() => cb(out), 5); // async, like Chrome
        },
      },
      onChanged: { addListener: (l: (c: Record<string, unknown>, area: string) => void) => listeners.push(l) },
    },
    runtime: {
      lastError: undefined,
      sendMessage: (msg: Msg, cb?: (r: unknown) => void) => {
        calls.push(msg);
        setTimeout(() => cb && cb(onMsg(msg)), 0);
      },
    },
  };
  w.__KX_CACHE = { getOrFetch: (_k: string, _t: string, fetcher: () => Promise<unknown>) => fetcher() };
  for (const s of ['lib/lang.js', 'lib/limitCard.js', 'lib/etsyMath.js', 'content-shared.js', ...scripts]) w.eval(src(s));
  const setLang = (v: string | null) => {
    if (v === null) delete stored.kx_lang; else stored.kx_lang = v;
    listeners.forEach((l) => l({ kx_lang: { newValue: v } }, 'local'));
  };
  return { doc: w.document as Document, calls, setLang };
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
const shadowText = (doc: Document, id: string, sel: string) => norm(doc.getElementById(id)?.shadowRoot?.querySelector(sel)?.textContent);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SEARCH_HTML = [1, 2, 3].map((i) =>
  `<div data-listing-id="10${i}" class="v2-listing-card"><a href="https://www.etsy.com/listing/10${i}/x">Linen dress ${i}</a></div>`).join('');

const searchApi = (m: Msg) => {
  if (m.type !== 'kx_research') return null;
  if (m.action === 'search_enrich') {
    return { summary: { totalResults: 1234, medianPrice: 29.99, p25Price: 20, p75Price: 45.5, currency: 'USD', uniqueShops: 40, medianFavorites: 1500, competition: 'medium', used: 80 } };
  }
  if (m.action === 'listings_batch') {
    const ids = (m.params?.listingIds as string[]) || [];
    const listings: Record<string, unknown> = {};
    ids.forEach((id) => {
      listings[id] = {
        listingId: id, favorites: 2500, shopId: 1, quantity: 10,
        sales: { kind: 'estimated', monthlySales: 4.5, confidence: 'medium', inputs: { recentListingReviews: 3, windowDays: 90, salesPerReview: 2.5 } },
      };
    });
    return { listings, pendingIds: [] };
  }
  return null;
};

const listingApi = (m: Msg) => (m.type === 'kx_listing_stats'
  ? {
      fetchedAt: new Date().toISOString(),
      listing: { reviewCount: 1234, favorites: 5600, tagCount: 13, tags: ['linen dress'], ageDays: 120, quantity: 999 },
      shop: { soldCount: 15000, salesPerReview: 2.5, rating: 4.9 },
      sales: {
        kind: 'estimated', monthlySales: 4.5, confidence: 'medium', monthlyRevenue: 135, currency: 'USD', priceUsed: 29.99, priceSource: 'page',
        inputs: { recentListingReviews: 3, windowDays: 90, salesPerReview: 2.5, shopSold: 15000, shopReviewCount: 6000 },
      },
      seoScore: { total: 72 },
    }
  : null);

const shopApi = (m: Msg) => (m.type === 'kx_research' && m.action === 'shop_enrich'
  ? {
      shop: { shop_name: 'LinenHaus', currency: 'USD', num_sales: 15000, rating: 4.9, review_count: 6000, listing_count: 120, salesPerReview: 2.5, shopAgeYears: 6 },
      sales: { kind: 'measured', monthlySales: 120, monthlyRevenue: 3600, confidence: 'high', inputs: { shopSoldDelta: 40, spanDays: 10, avgPrice: 29.99 } },
      avgPrice: 29.99,
      topListings: [],
      lowStockCount: 0,
    }
  : null);

const LISTING_HTML = '<div data-buy-box-region="price"><p>$29.99</p></div>';

// ---------------------------------------------------------------------------
describe('Etsy search bar + card rows', () => {
  it('Turkish by default (nothing stored, Chrome UI in English)', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', SEARCH_HTML, ['content-search.js'], searchApi);
    const text = await waitFor(() => {
      const t = shadowText(doc, 'kx-search-overlay', '.kx-bar');
      return t.includes('Sonuç') && t;
    });
    expect(text).toContain('Sonuç1,2K');
    expect(text).toContain('Medyan Liste Fiyatı$29,99');
    expect(text).toContain('Medyan Favori1,5K');
    expect(text).toContain('Mağaza (ilk 100)40');
    expect(text).toContain('RekabetOrta');
    expect(text).toContain('Tam Analiz');
    expect(text).not.toMatch(/Results|Median|Competition|loading/);

    const row = await waitFor(() => doc.querySelector('.kx-data-row'));
    expect(norm(row.textContent)).toContain('~4,5/ay');
    expect(norm(row.textContent)).toContain('Tahmini · orta güven');
    expect(norm(row.textContent)).toContain('♥ 2,5K');
    expect(row.getAttribute('lang')).toBe('tr');
    expect((row as HTMLElement).title).toContain('Tahmini: son 90 günde 3 yorum');
  });

  it('English when kx_lang = en', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', SEARCH_HTML, ['content-search.js'], searchApi, { kx_lang: 'en' });
    const text = await waitFor(() => {
      const t = shadowText(doc, 'kx-search-overlay', '.kx-bar');
      return t.includes('Results') && t;
    });
    expect(text).toContain('Results1.2K');
    expect(text).toContain('Median List Price$29.99');
    expect(text).toContain('CompetitionMedium');
    const row = await waitFor(() => doc.querySelector('.kx-data-row'));
    expect(norm(row.textContent)).toContain('~4.5/mo');
    expect(norm(row.textContent)).toContain('Estimate · medium conf.');
  });

  it('account language English is used when there is no explicit choice; explicit Turkish wins over it', async () => {
    const a = boot('https://www.etsy.com/search?q=linen+dress', SEARCH_HTML, ['content-search.js'], searchApi, { kx_account_lang: 'en' });
    await waitFor(() => shadowText(a.doc, 'kx-search-overlay', '.kx-bar').includes('Results'));
    const b = boot('https://www.etsy.com/search?q=linen+dress', SEARCH_HTML, ['content-search.js'], searchApi, { kx_account_lang: 'en', kx_lang: 'tr' });
    await waitFor(() => shadowText(b.doc, 'kx-search-overlay', '.kx-bar').includes('Sonuç'));
  });

  it('never shows the wrong language first: the loading text is already Turkish', async () => {
    const { doc } = boot('https://www.etsy.com/search?q=linen+dress', SEARCH_HTML, ['content-search.js'], () => new Promise(() => {}) as unknown);
    const text = await waitFor(() => shadowText(doc, 'kx-search-overlay', '.kx-bar'));
    expect(text).toBe('KolayXport yükleniyor...');
  });

  it('re-renders live when the popup switches the language', async () => {
    const { doc, setLang } = boot('https://www.etsy.com/search?q=linen+dress', SEARCH_HTML, ['content-search.js'], searchApi);
    await waitFor(() => shadowText(doc, 'kx-search-overlay', '.kx-bar').includes('Sonuç'));
    await waitFor(() => norm(doc.querySelector('.kx-data-row')?.textContent).includes('/ay'));
    setLang('en');
    await waitFor(() => shadowText(doc, 'kx-search-overlay', '.kx-bar').includes('Results'));
    await waitFor(() => norm(doc.querySelector('.kx-data-row')?.textContent).includes('/mo'));
    expect(doc.querySelectorAll('[data-listing-id="101"] .kx-data-row')).toHaveLength(1); // replaced, not stacked
  });
});

describe('Etsy listing panel', () => {
  it('Turkish by default', async () => {
    const { doc } = boot('https://www.etsy.com/listing/1234567/linen', LISTING_HTML, ['content-listing.js'], listingApi);
    const el = await waitFor(() => {
      const e = doc.getElementById('kx-listing-stats');
      return e && norm(e.textContent).includes('satış/ay') && e;
    });
    const t = norm(el.textContent);
    expect(t).toContain('~4,5 satış/ay');
    expect(t).toContain('Tahmini');
    expect(t).toContain('Güven: orta');
    expect(t).toContain('gelir/ay (tahmini)');
    expect(t).toContain('Bu ilan son 90 günde 3 yorum aldı');
    expect(t).toContain('İlan Yorumu');
    expect(t).toContain('1,2K');
    expect(t).toContain('Favori');
    expect(t).toContain('Adet (satıcı)');
    expect(t).toContain('Etiketler');
    expect(t).toContain('Mağaza Satışı');
    expect(t).toContain('Satış/Yorum2,5');
    expect(t).toContain('4,9★');
    expect(el.getAttribute('lang')).toBe('tr');
    expect(t).not.toMatch(/sales\/mo|Estimate|Item Reviews|Favorites/);
  });

  it('English when kx_lang = en', async () => {
    const { doc } = boot('https://www.etsy.com/listing/1234567/linen', LISTING_HTML, ['content-listing.js'], listingApi, { kx_lang: 'en' });
    const el = await waitFor(() => {
      const e = doc.getElementById('kx-listing-stats');
      return e && norm(e.textContent).includes('sales/mo') && e;
    });
    const t = norm(el.textContent);
    expect(t).toContain('~4.5 sales/mo');
    expect(t).toContain('Confidence: medium');
    expect(t).toContain('Item Reviews');
    expect(t).toContain('Sales/Review2.5');
  });
});

describe('Etsy shop bar', () => {
  it('Turkish by default', async () => {
    const { doc } = boot('https://www.etsy.com/shop/LinenHaus', '', ['content-shop.js'], shopApi);
    const t = await waitFor(() => {
      const s = shadowText(doc, 'kx-shop-overlay', '.kx-shop-bar');
      return s.includes('LinenHaus') && s;
    });
    expect(t).toContain('Satış/ay');
    expect(t).toContain('Ölçüldü · yüksek güven');
    expect(t).toContain('Gelir/ay≈$3.600');
    expect(t).toContain('Toplam Satış15,0K');
    expect(t).toContain('Puan4,9 ★');
    expect(t).toContain('Aktif İlan120');
    expect(t).toContain('Medyan Liste Fiyatı$29,99');
    expect(t).toContain('Mağaza Yaşı6 yıl');
    expect(t).not.toMatch(/Sales\/mo|Rating|Active Listings/);
  });

  it('English when kx_lang = en', async () => {
    const { doc } = boot('https://www.etsy.com/shop/LinenHaus', '', ['content-shop.js'], shopApi, { kx_lang: 'en' });
    const t = await waitFor(() => {
      const s = shadowText(doc, 'kx-shop-overlay', '.kx-shop-bar');
      return s.includes('LinenHaus') && s;
    });
    expect(t).toContain('Sales/mo');
    expect(t).toContain('Measured · high conf.');
    expect(t).toContain('Total Sales15.0K');
    expect(t).toContain('Rating4.9 ★');
    expect(t).toContain('Shop Age6 yr');
  });
});

// Trendyol / Hepsiburada readers + overlays in jsdom. Fixtures mirror the live page structures read on 2026-10-18
// (Trendyol search PROPS, product JSON-LD + social-proof line + "Ürünün Diğer Satıcıları" boxes, store header PROPS;
// Hepsiburada reduxStore productState). Stubbed chrome.runtime: never the network.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const R = require('../../chrome-extension/src/lib/marketReader.js');
const root = path.join(__dirname, '../../chrome-extension/src');
const src = (f: string) => readFileSync(path.join(root, f), 'utf8');

const doms: JSDOM[] = [];
afterEach(() => { doms.length = 0; });
const docOf = (url: string, html: string) => { const d = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url }); doms.push(d); return d.window.document; };

const tyProduct = (i: number, over: Record<string, unknown> = {}) => ({
  id: 1173797433 + i, name: `Ahşap Takı Kutusu ${i}`, url: `/marka/urun-${i}-p-${1173797433 + i}`, image: 'https://cdn.dsmcdn.com/a.jpg',
  price: { current: 1000 + i * 10 }, brand: 'MAKRİ HOME', merchantId: 955748 + (i % 4),
  socialProof: [{ key: 'favoriteCount', value: '15K' }, ...(i === 0 ? [{ key: 'orderCount', value: '100+' }] : [])],
  ratingScore: { averageRating: 4.4, totalCount: 185 + i }, category: { id: 4831, name: 'Makyaj & Takı Organizeri' },
  cardType: i % 3 === 0 ? 'ADS' : 'DEFAULT', ...over,
});
const searchHtml = (n = 12, q = 'ahşap takı kutusu') => {
  const props = { data: { query: { q }, total: 5109, products: Array.from({ length: n }, (_, i) => tyProduct(i)) } };
  const cards = Array.from({ length: n }, (_, i) => `<a class="product-card" href="/marka/urun-${i}-p-${1173797433 + i}"><img alt="Ahşap Takı Kutusu ${i}"><span>4.4 (${185 + i})</span><span>${1000 + i * 10} TL</span></a>`).join('');
  return `<script>window["__single-search-result__PROPS"]=${JSON.stringify(props)};</script><div class="web-search-result-content"><div class="search-result-content">${cards}</div></div>`;
};

const productHtml = (withSellers = true) => `
  <script type="application/ld+json">${JSON.stringify({ '@type': 'ProductGroup', name: 'Philips OneBlade QP2824/10', brand: { name: 'Philips' }, image: ['https://cdn.dsmcdn.com/p.jpg'], offers: { '@type': 'Offer', price: '1614.00', priceCurrency: 'TRY' }, aggregateRating: { ratingValue: 4.5, ratingCount: 6638, reviewCount: 2684 } })}</script>
  <script>window["__envoy_side-other-seller__PROPS"]={"hasOtherMerchant":true,"otherMerchantCount":87};</script>
  <h1>Philips OneBlade QP2824/10</h1>
  <div class="social-proof-social-proof">1,4B kişinin sepetinde, tükenmeden al!</div>
  <div class="seller"><a href="/magaza/kolaysepet-m-106320">Kolaysepet</a> <span>9.6</span> <span>65,7B Takipçi</span></div>
  ${withSellers ? `
  <a class="_box other-merchant-item-box" href="/philips/x-p-699645115?merchantId=624588">VATAN BİLGİSAYAR 8.7\nKargo Bedava\n1.619 TL\nÜrüne Git</a>
  <a class="_box other-merchant-item-box" href="/philips/x-p-699645115?merchantId=1212462">İRM TEKNOLOJİ 9.4\n2.199 TL 1.775 TL\nÜrüne Git</a>` : ''}`;

describe('Trendyol page types', () => {
  it('routes search, category, product and store URLs', () => {
    expect(R.trendyolPageType('https://www.trendyol.com/sr?q=kolye')).toBe('search');
    expect(R.trendyolPageType('https://www.trendyol.com/taki-kutusu-x-c104038')).toBe('search');
    expect(R.trendyolPageType('https://www.trendyol.com/philips/x-p-699645115')).toBe('product');
    expect(R.trendyolPageType('https://www.trendyol.com/magaza/kolaysepet-m-106320')).toBe('store');
    expect(R.trendyolPageType('https://www.trendyol.com/sepet')).toBeNull();
    expect(R.trendyolPageType('https://evil.example/sr?q=x')).toBeNull();
  });
});

describe('Trendyol readers', () => {
  it('search: PROPS products, ads, badges; no duplicate DOM cards', () => {
    const doc = docOf('https://www.trendyol.com/sr?q=ah%C5%9Fap%20tak%C4%B1%20kutusu', searchHtml());
    const s = R.trendyolSearch(doc, doc.location.href);
    expect(s).toMatchObject({ mkt: 'trendyol', pageType: 'search', query: 'ahşap takı kutusu', total: 5109, page: 1 });
    expect(s.items).toHaveLength(12);
    expect(s.items[0]).toMatchObject({ id: '1173797433', price: 1000, sellerId: '955748', favorites: '15K', orderBadge: '100+', sponsored: true, categoryId: '4831' });
    expect(s.items[0].url).toBe('https://www.trendyol.com/marka/urun-0-p-1173797433');
  });

  it('search: data left from another query is never sent under the new one', () => {
    const doc = docOf('https://www.trendyol.com/sr?q=kolye', searchHtml(12, 'ahşap takı kutusu'));
    const s = R.trendyolSearch(doc, doc.location.href);
    expect(s.total).toBeNull();
    // Only the DOM cards remain (read as cards, ids/titles/prices/ratings).
    expect(s.items[0]).toMatchObject({ id: '1173797433', title: 'Ahşap Takı Kutusu 0', price: 1000, rating: 4.4, ratingCount: 185 });
  });

  it('category page: keyed by the category id from the URL', () => {
    const doc = docOf('https://www.trendyol.com/taki-kutusu-x-c104038?pi=2', searchHtml());
    expect(R.trendyolSearch(doc, doc.location.href)).toMatchObject({ query: null, categoryId: 'c104038', page: 2 });
  });

  it('product: JSON-LD, buybox holder with score/followers, all other sellers with prices', () => {
    const doc = docOf('https://www.trendyol.com/philips/x-p-699645115', productHtml());
    const p = R.trendyolProduct(doc, doc.location.href, ['1,4B kişinin sepetinde, tükenmeden al!', 'Sevilen ürün! 14,9B kişi favoriledi!', 'Popüler ürün! Son 24 saatte 2,3B kişi görüntüledi!']);
    expect(p.product).toMatchObject({
      id: '699645115', title: 'Philips OneBlade QP2824/10', brand: 'Philips', price: 1614, rating: 4.5, ratingCount: 6638, reviewCount: 2684,
      basketCount: 1400, favorites: 14900, viewCount: 2300, sellerId: '106320', sellerName: 'Kolaysepet', sellerScore: 9.6, otherSellerCount: 87,
    });
    expect(p.product.offers).toEqual([
      { sellerId: '106320', name: 'Kolaysepet', price: 1614, score: 9.6, buybox: true },
      { sellerId: '624588', name: 'VATAN BİLGİSAYAR', price: 1619, score: 8.7 },
      { sellerId: '1212462', name: 'İRM TEKNOLOJİ', price: 1775, score: 9.4 },
    ]);
    expect(p.store).toEqual({ sellerId: '106320', name: 'Kolaysepet', score: 9.6, followers: '65,7B' });
  });

  it('social proof: "sold" line becomes an order badge', () => {
    expect(R.trendyolSocialProof(['Son 3 günde 100+ ürün satıldı!']).orderBadge).toBe('100+');
    expect(R.trendyolSocialProof([]).basketCount).toBeNull();
  });

  it('store: header PROPS (name, score, product count), followers from text, grid cards', () => {
    const header = { data: { store: { meta: { seller: { id: 106320, name: 'Kolaysepet', productCount: 306, score: 9.6 } } } } };
    const cards = Array.from({ length: 3 }, (_, i) => `<a class="product-card" href="/x/y-p-${699645115 + i}"><img alt="Ürün ${i}">4.5 (6633) 1.614 TL</a>`).join('');
    const doc = docOf('https://www.trendyol.com/magaza/kolaysepet-m-106320', `<script>window["__ss-header__PROPS"]=${JSON.stringify(header)};</script><div>Kolaysepet 9.6 Satıcı Profili 65,7B Takipçi</div>${cards}`);
    const s = R.trendyolStore(doc, doc.location.href);
    expect(s.store).toEqual({ sellerId: '106320', name: 'Kolaysepet', score: 9.6, productCount: 306, followers: '65,7B' });
    expect(s.items).toHaveLength(3);
    expect(s.items[0]).toMatchObject({ id: '699645115', price: 1614, rating: 4.5, ratingCount: 6633, sellerId: '106320' });
  });
});

describe('Hepsiburada readers', () => {
  it('routes and reads a product page (reduxStore): price, reviews, merchant, other listings', () => {
    expect(R.hepsiburadaPageType('https://www.hepsiburada.com/x-p-HBCV0000777WJ6')).toBe('product');
    expect(R.hepsiburadaPageType('https://www.hepsiburada.com/ara?q=tak%C4%B1')).toBe('search');
    const state = { productState: { product: {
      sku: 'HBCV0000777WJ6', name: 'Chakra Marta Bambu Nevresim', brand: 'Chakra', prices: [{ value: 2351.77 }],
      reviews: { customerReviewScore: 5, customerReviewCount: 6 }, merchant: { id: 'e750130c', name: 'Hepsiburada', lifetimeRating: 9.4 },
      listings: [{ merchantId: 'm2', merchantName: 'Ev Tekstil', prices: [{ value: 2299 }], merchantRating: 9.1 }], hasMoreListings: false,
    } } };
    const doc = docOf('https://www.hepsiburada.com/x-p-HBCV0000777WJ6', `<script id="reduxStore" type="mime/invalid">${JSON.stringify(state)}</script>`);
    const p = R.hepsiburadaProduct(doc, doc.location.href);
    expect(p.product).toMatchObject({ id: 'HBCV0000777WJ6', price: 2351.77, rating: 5, ratingCount: 6, sellerId: 'e750130c', sellerName: 'Hepsiburada', otherSellerCount: 1 });
    expect(p.product.offers.map((o: { sellerId: string; price: number }) => [o.sellerId, o.price])).toEqual([['e750130c', 2351.77], ['m2', 2299]]);
  });
});

describe('Hepsiburada search (window.MORIA.PRODUCTLIST state)', () => {
  it('reads total, page and products; product id from cards, variant sku as alias; promoted = ad', () => {
    const products = Array.from({ length: 6 }, (_, i) => ({
      productId: `HBC00006${i}VEAV`, brand: 'Ospina', customerReviewCount: 4 + i, customerReviewScore: 5,
      mainCategory: { id: 60004982, name: 'Takı Kutusu' },
      variantList: [{ sku: `HBCV00006${i}VEAW`, name: `Ospina Takı Kutusu ${i}`, url: `/ospina-taki-kutusu-pm-HBC00006${i}VEAV`, isPromoted: i === 2,
        images: [{ link: 'https://productimages.hepsiburada.net/s/1/{size}/a.jpg' }],
        listing: { priceInfo: { price: 1599 + i, originalPrice: 1699 }, merchantName: 'TEKNOMARİNE', merchantId: '8cfa6b0f-1' } }],
    }));
    const state = { data: { products, totalProductCount: 5283, currentPage: 1, pageSize: 36 } };
    const script = `window.MORIA = window.MORIA || {};\n  window.MORIA.PRODUCTLIST = Object.assign(window.MORIA.PRODUCTLIST || {}, {\n    'abc': {\n      'STATE': ${JSON.stringify(state)}\n    }\n  });`;
    const doc = docOf('https://www.hepsiburada.com/ara?q=ah%C5%9Fap+tak%C4%B1+kutusu', `<script>${script}</script>`);
    const s = R.hepsiburadaSearch(doc, doc.location.href);
    expect(s).toMatchObject({ mkt: 'hepsiburada', query: 'ahşap takı kutusu', total: 5283, page: 1 });
    expect(s.items).toHaveLength(6);
    expect(s.items[0]).toMatchObject({ id: 'HBC000060VEAV', altId: 'HBCV000060VEAW', price: 1599, sellerId: '8cfa6b0f-1', ratingCount: 4, rating: 5, sponsored: false, categoryId: '60004982' });
    expect(s.items[2].sponsored).toBe(true);
    expect(s.items[0].thumbUrl).toContain('/300/');
  });
});

describe('Trendyol overlay (content-market.js)', () => {
  function boot(url: string, html: string, onMsg: (m: { type: string; params: any }) => unknown) {
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
    doms.push(dom);
    const w = dom.window as unknown as Record<string, any> & { eval: (s: string) => unknown };
    const calls: Array<{ type: string; params: any }> = [];
    w.chrome = {
      storage: { local: { get: (_k: unknown, cb: (r: object) => void) => cb({ kx_lang: 'tr' }) } },
      runtime: { lastError: undefined, sendMessage: (msg: { type: string; params: any }, cb: (r: unknown) => void) => { calls.push(msg); setTimeout(() => cb(onMsg(msg)), 0); } },
    };
    w.eval(src('lib/lang.js'));
    w.eval(src('lib/ui.js'));
    w.eval(src('lib/marketReader.js'));
    w.eval(src('content-market.js'));
    return { w, calls, doc: dom.window.document };
  }
  const waitFor = async <T,>(fn: () => T | null | undefined | false, ms = 4000): Promise<T> => {
    const start = Date.now();
    for (;;) { const v = fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)); }
  };

  it('search page: shares the page, then shows sales/day and revenue/day per card from the crowd read', async () => {
    const { calls, doc } = boot('https://www.trendyol.com/sr?q=ah%C5%9Fap%20tak%C4%B1%20kutusu', searchHtml(), (m) => {
      if (m.type === 'kx_market_observe') return { ok: true };
      if (m.type === 'kx_market_read') return { cards: m.params.ids.map((id: string, i: number) => ({ id, known: true, readings: 3, priceChange: null, sales: { salesPerDay: i === 1 ? 12 : null, revenuePerDay: i === 1 ? 12120 : null, ratingsPer30d: 30, calibration: { ordersPerRating: 12, n: 120, source: '2 mağaza', computedAt: '' } } })) };
      return null;
    });
    await waitFor(() => doc.querySelectorAll('.kx-mkt-strip').length === 12);
    const observe = calls.find((c) => c.type === 'kx_market_observe')!;
    expect(observe.params).toMatchObject({ mkt: 'trendyol', pageType: 'search', query: 'ahşap takı kutusu', total: 5109 });
    const strips = [...doc.querySelectorAll('.kx-mkt-strip')].map((s) => s.textContent);
    expect(strips[1]).toContain('12 satış/gün');
    expect(strips[1]).toMatch(/12\.120|12,120/);
    expect(strips[2]).toContain('+30 değerlendirme/ay');
    const bar = doc.getElementById('kx-mkt-bar')!;
    expect(bar.textContent).toContain('5.109');
    expect(bar.textContent).toContain('Sayfa satışı/gün');
  });

  it('gated (sharing off for 30 days): only what the page says, and why', async () => {
    const { doc } = boot('https://www.trendyol.com/sr?q=ah%C5%9Fap%20tak%C4%B1%20kutusu', searchHtml(), (m) => (m.type === 'kx_market_read' ? { gated: true } : { ok: true }));
    await waitFor(() => doc.querySelectorAll('.kx-mkt-strip').length === 12);
    const strip = doc.querySelector('.kx-mkt-strip')!.textContent!;
    expect(strip).toContain('♥');
    expect(strip).not.toContain('satış/gün');
    expect(doc.getElementById('kx-mkt-bar')!.textContent).toContain('paylaşımı açın');
  });
});

/**
 * KolayXport — Trendyol / Hepsiburada page readers (pure: a Document + URL in, plain objects out).
 *
 * They read only what the page already holds for the person viewing it: the data the marketplace embeds for its
 * own rendering (Trendyol `window["__…__PROPS"]` script tags and schema.org JSON-LD, Hepsiburada's `reduxStore`
 * script) and the visible text (Trendyol's rotating "N kişinin sepetinde / favoriledi / Son 24 saatte N kişi
 * görüntüledi", the "Ürünün Diğer Satıcıları" sellers when the person opened them). They never click, scroll,
 * fetch or change anything. Output shapes match POST /api/market/observe (lib/market/ingest.ts on the server).
 *
 * Loaded as a content script (window.__kxMarketReader) and as CommonJS in tests (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.__kxMarketReader = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var VERSION = 'mr-1';

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  /** "1,4B" → 1400, "14,9B" → 14900, "3K" → 3000, "2,3 B" → 2300, "1.2M" → 1200000, "100+" → 100. */
  function compact(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    var m = raw.replace(/\s+/g, '').match(/^(\d+(?:[.,]\d+)?)([KkBbMm])?\+?$/);
    if (!m) return null;
    var base = Number(m[1].replace(',', '.'));
    var mult = m[2] ? ({ k: 1e3, b: 1e3, m: 1e6 })[m[2].toLowerCase()] : 1;
    return Number.isFinite(base) ? Math.round(base * mult) : null;
  }

  /** Turkish price text "1.619 TL" / "2.351,77 TL" → 1619 / 2351.77. */
  function tlPrice(text) {
    if (typeof text !== 'string') return null;
    var all = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*TL/g);
    if (!all || !all.length) return null;
    var last = all[all.length - 1].replace(/\s*TL$/, '');
    var n = Number(last.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function scriptJson(doc, prefix) {
    var scripts = doc.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var txt = scripts[i].textContent || '';
      var at = txt.indexOf(prefix);
      if (at === -1) continue;
      var json = txt.slice(at + prefix.length).trim().replace(/;\s*$/, '');
      try { return JSON.parse(json); } catch (_) { return null; }
    }
    return null;
  }

  function trendyolProps(doc, name) {
    return scriptJson(doc, 'window["' + name + '"]=');
  }

  function jsonLd(doc) {
    var out = [];
    var nodes = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length; i++) {
      try {
        var j = JSON.parse(nodes[i].textContent || '');
        if (Array.isArray(j)) out = out.concat(j); else out.push(j);
      } catch (_) { /* ignore */ }
    }
    return out;
  }

  function first(v) { return Array.isArray(v) ? v[0] : v; }
  function text(el) { return el ? String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function absUrl(href, base) {
    if (!href) return null;
    try { return new URL(href, base).toString(); } catch (_) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Trendyol
  // ---------------------------------------------------------------------------
  var TY_BASE = 'https://www.trendyol.com';

  /** 'search' | 'product' | 'store' | null for a Trendyol URL. Category/brand listing pages are 'search'. */
  function trendyolPageType(url) {
    var u;
    try { u = new URL(url); } catch (_) { return null; }
    if (!/(^|\.)trendyol\.com$/.test(u.hostname)) return null;
    if (/\/magaza\/[^/]*-m-\d+/.test(u.pathname)) return 'store';
    if (/-p-\d+/.test(u.pathname)) return 'product';
    if (u.pathname === '/sr' || /-x-[cbg]\d+/.test(u.pathname) || /^\/(butik|kategori)\//.test(u.pathname)) return 'search';
    return null;
  }

  function socialValue(list, key) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return String(list[i].value);
    return null;
  }

  /** One product card's DOM (search results past the first page, store grids): id, title, price, rating. */
  function trendyolDomCard(a, base) {
    var href = a.getAttribute('href') || '';
    var m = href.match(/-p-(\d+)/);
    if (!m) return null;
    var t = text(a);
    var img = a.querySelector('img');
    var r = t.match(/(\d[.,]\d)\s*\((\d[\d.]*)\)/);
    return {
      id: m[1],
      title: (img && img.getAttribute('alt')) || a.getAttribute('title') || '',
      url: absUrl(href.split('?')[0], base),
      thumbUrl: img ? img.getAttribute('src') : null,
      price: tlPrice(t),
      rating: r ? Number(r[1].replace(',', '.')) : null,
      ratingCount: r ? Number(r[2].replace(/\./g, '')) : null,
      sponsored: /Reklam|Sponsorlu/i.test(t),
    };
  }

  /** Search / category / brand page → observe payload (pageType 'search'). */
  function trendyolSearch(doc, url) {
    var props = trendyolProps(doc, '__single-search-result__PROPS');
    var u = new URL(url);
    var q = (u.searchParams.get('q') || '').trim();
    var data = props && props.data;
    // Results swapped in place for another query keep the old embedded data: never send it under the new query.
    var rawQ = data && data.query;
    var pq = typeof rawQ === 'string' ? rawQ : rawQ && typeof rawQ.q === 'string' ? rawQ.q : null;
    if (q && pq && pq.trim().toLowerCase() !== q.toLowerCase()) data = null;

    var items = [];
    var seen = {};
    var products = data && Array.isArray(data.products) ? data.products : [];
    products.forEach(function (p) {
      var id = String(p.id || p.contentId || '');
      if (!id || seen[id]) return;
      seen[id] = 1;
      var price = p.price && typeof p.price.current === 'number' ? p.price.current
        : p.singlePrice && typeof p.singlePrice.salePriceNumeric === 'number' ? p.singlePrice.salePriceNumeric : null;
      items.push({
        id: id,
        title: p.name || '',
        url: typeof p.url === 'string' ? absUrl(p.url, TY_BASE) : null,
        thumbUrl: p.image || (Array.isArray(p.images) ? p.images[0] : null) || null,
        price: price,
        brand: p.brand || null,
        sellerId: p.merchantId != null ? String(p.merchantId) : null,
        favorites: socialValue(p.socialProof, 'favoriteCount'),
        orderBadge: socialValue(p.socialProof, 'orderCount'),
        rating: p.ratingScore && typeof p.ratingScore.averageRating === 'number' ? p.ratingScore.averageRating : null,
        ratingCount: p.ratingScore && typeof p.ratingScore.totalCount === 'number' ? p.ratingScore.totalCount : null,
        sponsored: p.cardType === 'ADS' || !!(p.advert && p.advert.advertId),
        category: p.category && p.category.name ? p.category.name : null,
        categoryId: p.category && p.category.id != null ? String(p.category.id) : null,
      });
    });
    // Infinite scroll: cards loaded after the first page exist only in the DOM.
    var cards = doc.querySelectorAll('a.product-card, a[data-testid="product-card"]');
    for (var i = 0; i < cards.length && items.length < 120; i++) {
      var c = trendyolDomCard(cards[i], TY_BASE);
      if (c && !seen[c.id]) { seen[c.id] = 1; items.push(c); }
    }
    var cm = u.pathname.match(/-x-([cbg]\d+)/);
    // Category best-seller pages: /sr?wc=<category id>&sst=BEST_SELLER (no query); store lists: /sr?mid=<seller>.
    var wc = (u.searchParams.get('wc') || '').match(/^\d+/);
    var mid = (u.searchParams.get('mid') || '').match(/^\d+/);
    return {
      mkt: 'trendyol', pageType: 'search', parserVersion: VERSION,
      query: q || null,
      categoryId: q ? null : wc ? 'c' + wc[0] : mid ? 'm' + mid[0] : (cm ? cm[1] : u.pathname.slice(0, 30)),
      page: Math.max(1, Number(u.searchParams.get('pi')) || 1),
      total: data && typeof data.total === 'number' ? data.total : null,
      items: items,
    };
  }

  /** Values from Trendyol's rotating social-proof line, given every text it showed while the page was open. */
  function trendyolSocialProof(texts) {
    var all = (texts || []).join(' | ');
    var grab = function (re) { var m = all.match(re); return m ? compact(m[1]) : null; };
    var sold = all.match(/Son\s+(\d+)\s+(?:günde|saatte)[^|]*?(\d[\d.,]*\s*[BbKkMm]?\+?)\s*(?:ürün|adet)?\s*sat(?:ıldı|ın aldı)/i);
    return {
      basketCount: grab(/(\d[\d.,]*\s*[BbKkMm]?)\s*kişinin sepetinde/i),
      favorites: grab(/(\d[\d.,]*\s*[BbKkMm]?)\s*kişi favoriledi/i),
      viewCount: grab(/Son 24 saatte\s*(\d[\d.,]*\s*[BbKkMm]?)\s*kişi görüntüledi/i),
      orderBadge: sold ? sold[2].replace(/\s+/g, '') : null,
    };
  }

  /** Product page → observe payload (pageType 'product'). `socialTexts`: what the rotating line showed. */
  function trendyolProduct(doc, url, socialTexts) {
    var m = new URL(url).pathname.match(/-p-(\d+)/);
    if (!m) return null;
    var ld = jsonLd(doc).filter(function (x) { return x && (x['@type'] === 'Product' || x['@type'] === 'ProductGroup'); })[0] || {};
    var offer = first(ld.offers) || {};
    var rating = ld.aggregateRating || {};
    var brand = ld.brand && (ld.brand.name || ld.brand);
    var sp = trendyolSocialProof(socialTexts);

    // Buybox holder: the first store link on the page and its score/followers line ("Kolaysepet 9.6 65,7B Takipçi").
    var sellerA = doc.querySelector('a[href*="/magaza/"][href*="-m-"]') || doc.querySelector('a[href*="-m-"]');
    var sellerId = null, sellerName = null, sellerScore = null, followers = null;
    if (sellerA) {
      var sm = (sellerA.getAttribute('href') || '').match(/-m-(\d+)/);
      sellerId = sm ? sm[1] : null;
      sellerName = text(sellerA) || null;
      var box = sellerA;
      for (var i = 0; i < 6 && box && !/Takipçi/.test(text(box)); i++) box = box.parentElement;
      var bt = text(box);
      var sc = bt.match(/(\d{1,2}(?:[.,]\d)?)\s+(\d[\d.,]*\s*[BbKkMm]?)\s*Takipçi/);
      if (sc) { sellerScore = Number(sc[1].replace(',', '.')); followers = sc[2]; }
    }
    var other = trendyolProps(doc, '__envoy_side-other-seller__PROPS');
    var price = offer.price != null ? Number(offer.price) : (offer.lowPrice != null ? Number(offer.lowPrice) : null);
    var offers = [];
    if (sellerId) offers.push({ sellerId: sellerId, name: sellerName, price: price, score: sellerScore, buybox: true });
    var boxes = doc.querySelectorAll('[class*="other-merchant-item-box"]');
    for (var j = 0; j < boxes.length && offers.length < 50; j++) {
      var link = boxes[j].querySelector('a[href*="merchantId="]') || (boxes[j].matches && boxes[j].matches('a[href*="merchantId="]') ? boxes[j] : null);
      var href = link ? link.getAttribute('href') : '';
      var mid = (href.match(/merchantId=(\d+)/) || [])[1];
      if (!mid || offers.some(function (o) { return o.sellerId === mid; })) continue;
      var lines = String(boxes[j].innerText || boxes[j].textContent || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      var score = null;
      var name = lines[0] || null;
      var nm = (name || '').match(/^(.*?)\s+(\d{1,2}(?:[.,]\d)?)$/);
      if (nm) { name = nm[1]; score = Number(nm[2].replace(',', '.')); }
      else if (lines[1] && /^\d{1,2}(?:[.,]\d)?$/.test(lines[1])) score = Number(lines[1].replace(',', '.'));
      offers.push({ sellerId: mid, name: name, price: tlPrice(text(boxes[j])), score: score });
    }
    return {
      mkt: 'trendyol', pageType: 'product', parserVersion: VERSION,
      product: {
        id: m[1],
        title: ld.name || (doc.querySelector('h1') ? text(doc.querySelector('h1')) : ''),
        brand: typeof brand === 'string' ? brand : null,
        url: url.split('?')[0],
        imageUrl: first(ld.image) || null,
        price: price,
        rating: rating.ratingValue != null ? Number(rating.ratingValue) : null,
        ratingCount: rating.ratingCount != null ? Number(rating.ratingCount) : null,
        reviewCount: rating.reviewCount != null ? Number(rating.reviewCount) : null,
        favorites: sp.favorites,
        basketCount: sp.basketCount,
        viewCount: sp.viewCount,
        orderBadge: sp.orderBadge,
        sellerId: sellerId,
        sellerName: sellerName,
        sellerScore: sellerScore,
        otherSellerCount: other && typeof other.otherMerchantCount === 'number' ? other.otherMerchantCount : null,
        offers: offers,
      },
      store: sellerId ? { sellerId: sellerId, name: sellerName, score: sellerScore, followers: followers } : null,
    };
  }

  /** Store page → observe payload (pageType 'store'): header facts + the product grid. */
  function trendyolStore(doc, url) {
    var m = new URL(url).pathname.match(/-m-(\d+)/);
    if (!m) return null;
    var h = trendyolProps(doc, '__ss-header__PROPS');
    var seller = h && h.data && h.data.store && h.data.store.meta && h.data.store.meta.seller;
    var bodyText = text(doc.body).slice(0, 3000);
    var f = bodyText.match(/(\d[\d.,]*\s*[BbKkMm]?)\s*Takipçi/);
    var items = [];
    var seen = {};
    var cards = doc.querySelectorAll('a.product-card, a[data-testid="product-card"], a[href*="-p-"]');
    for (var i = 0; i < cards.length && items.length < 120; i++) {
      var c = trendyolDomCard(cards[i], TY_BASE);
      if (c && !seen[c.id] && c.title) { seen[c.id] = 1; c.sellerId = m[1]; items.push(c); }
    }
    return {
      mkt: 'trendyol', pageType: 'store', parserVersion: VERSION,
      store: {
        sellerId: m[1],
        name: (seller && seller.name) || null,
        score: seller && typeof seller.score === 'number' ? seller.score : null,
        productCount: seller && typeof seller.productCount === 'number' ? seller.productCount : null,
        followers: f ? f[1].replace(/\s+/g, '') : null,
      },
      items: items,
    };
  }

  // ---------------------------------------------------------------------------
  // Hepsiburada (reduxStore script)
  // ---------------------------------------------------------------------------
  var HB_BASE = 'https://www.hepsiburada.com';

  function hbRedux(doc) {
    var el = doc.getElementById('reduxStore');
    if (!el) return null;
    try { return JSON.parse(el.textContent || ''); } catch (_) { return null; }
  }

  function hepsiburadaPageType(url) {
    var u;
    try { u = new URL(url); } catch (_) { return null; }
    if (!/(^|\.)hepsiburada\.com$/.test(u.hostname)) return null;
    if (/^\/magaza\//.test(u.pathname)) return 'store';
    if (/-p(m)?-[A-Za-z0-9]+$/.test(u.pathname)) return 'product';
    if (u.pathname === '/ara' || /-c-\d+$/.test(u.pathname)) return 'search';
    return null;
  }

  function hbPrice(p) {
    var pr = first(p && p.prices);
    if (pr && typeof pr.value === 'number') return pr.value;
    if (p && typeof p.price === 'number') return p.price;
    if (p && p.price && typeof p.price.value === 'number') return p.price.value;
    return null;
  }

  /** Product page: product, buybox holder (merchant) and the other listings (sellers) when embedded. */
  function hepsiburadaProduct(doc, url) {
    var R = hbRedux(doc);
    var p = R && R.productState && R.productState.product;
    if (!p || !(p.productId || p.sku)) return null;
    var reviews = p.reviews || {};
    var merchant = p.merchant || {};
    var offers = [];
    if (merchant.id || p.merchantId) {
      offers.push({ sellerId: String(merchant.id || p.merchantId), name: merchant.name || p.merchantName || null, price: hbPrice(p), score: (merchant.lifetimeRating > 0 ? merchant.lifetimeRating : null), buybox: true });
    }
    var listings = Array.isArray(p.listings) ? p.listings : Array.isArray(R.productState.allListings) ? R.productState.allListings : [];
    listings.forEach(function (l) {
      var id = l && (l.merchantId || (l.merchant && l.merchant.id));
      if (!id || offers.some(function (o) { return o.sellerId === String(id); })) return;
      offers.push({
        sellerId: String(id),
        name: l.merchantName || (l.merchant && l.merchant.name) || null,
        price: hbPrice(l),
        score: typeof l.merchantRating === 'number' ? l.merchantRating : (l.merchant && typeof l.merchant.lifetimeRating === 'number' ? l.merchant.lifetimeRating : null),
      });
    });
    var media = first(p.media);
    return {
      mkt: 'hepsiburada', pageType: 'product', parserVersion: VERSION,
      product: {
        id: String(p.productId || p.sku),
        title: p.name || '',
        brand: p.brand || null,
        url: url.split('?')[0],
        imageUrl: media && typeof media.url === 'string' ? media.url.replace('{size}', '500') : null,
        price: hbPrice(p),
        rating: typeof reviews.customerReviewScore === 'number' ? reviews.customerReviewScore : null,
        ratingCount: typeof reviews.customerReviewCount === 'number' ? reviews.customerReviewCount : null,
        reviewCount: null,
        sellerId: merchant.id || p.merchantId ? String(merchant.id || p.merchantId) : null,
        sellerName: merchant.name || p.merchantName || null,
        sellerScore: (merchant.lifetimeRating > 0 ? merchant.lifetimeRating : null),
        otherSellerCount: listings.length ? listings.length : (p.hasMoreListings === false ? 0 : null),
        offers: offers,
      },
      store: merchant.id ? { sellerId: String(merchant.id), name: merchant.name || null, score: (merchant.lifetimeRating > 0 ? merchant.lifetimeRating : null), followers: null } : null,
    };
  }

  /** The JSON object starting at the first "{" after `from` (string-aware brace matching). */
  function balancedJson(s, from) {
    var i = s.indexOf('{', from);
    if (i < 0) return null;
    var depth = 0, inStr = false, esc = false;
    for (var j = i; j < s.length; j++) {
      var c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; } } }
    }
    return null;
  }

  /** Hepsiburada search state: `window.MORIA.PRODUCTLIST = Object.assign(…, { '<id>': { 'STATE': {json} } })`. */
  function hbProductList(doc) {
    var scripts = doc.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var txt = scripts[i].textContent || '';
      if (txt.indexOf('window.MORIA.PRODUCTLIST') === -1) continue;
      var at = txt.indexOf("'STATE':");
      if (at === -1) at = txt.indexOf('"STATE":');
      var o = at === -1 ? null : balancedJson(txt, at);
      if (o && o.data && Array.isArray(o.data.products)) return o.data;
    }
    return null;
  }

  /** Search / category page (MORIA.PRODUCTLIST state, read 2026-10-18). */
  function hepsiburadaSearch(doc, url) {
    var D = hbProductList(doc);
    var u = new URL(url);
    var q = (u.searchParams.get('q') || '').trim();
    var items = [];
    var seen = {};
    (D ? D.products : []).forEach(function (p) {
      var v = first(p && p.variantList) || {};
      // Cards link the product id (…-pm-HBC…); a product page URL may carry the variant sku (…-p-HBCV…).
      var sku = p.productId || v.sku;
      if (!sku || seen[sku]) return;
      seen[sku] = 1;
      var l = v.listing || {};
      var pi = l.priceInfo || {};
      var img = first(v.images);
      var link = img && typeof img === 'object' ? img.link : typeof img === 'string' ? img : null;
      items.push({
        id: String(sku),
        altId: v.sku && v.sku !== sku ? String(v.sku) : null,
        title: v.name || '',
        url: v.url ? absUrl(v.url, HB_BASE) : null,
        thumbUrl: link ? String(link).replace('{size}', '300') : null,
        price: typeof pi.price === 'number' ? pi.price : null,
        brand: p.brand || null,
        sellerId: l.merchantId ? String(l.merchantId) : (v.merchantId ? String(v.merchantId) : null),
        rating: typeof p.customerReviewScore === 'number' ? p.customerReviewScore : null,
        ratingCount: typeof p.customerReviewCount === 'number' ? p.customerReviewCount : null,
        sponsored: !!(v.isPromoted || (v.adInfo && Object.keys(v.adInfo).length)),
        category: p.mainCategory && p.mainCategory.name ? p.mainCategory.name : null,
        categoryId: p.mainCategory && p.mainCategory.id != null ? String(p.mainCategory.id) : null,
      });
    });
    var cm = u.pathname.match(/-c-(\d+)$/);
    return {
      mkt: 'hepsiburada', pageType: 'search', parserVersion: VERSION,
      query: q || null,
      categoryId: q ? null : (cm ? 'c' + cm[1] : u.pathname.slice(0, 30)),
      page: D && typeof D.currentPage === 'number' ? D.currentPage : Math.max(1, Number(u.searchParams.get('sayfa')) || 1),
      total: D && typeof D.totalProductCount === 'number' ? D.totalProductCount : null,
      items: items,
    };
  }

  return {
    VERSION: VERSION,
    compact: compact,
    tlPrice: tlPrice,
    trendyolPageType: trendyolPageType,
    trendyolSearch: trendyolSearch,
    trendyolProduct: trendyolProduct,
    trendyolStore: trendyolStore,
    trendyolSocialProof: trendyolSocialProof,
    hepsiburadaPageType: hepsiburadaPageType,
    hepsiburadaProduct: hepsiburadaProduct,
    hepsiburadaSearch: hepsiburadaSearch,
  };
});

/**
 * KolayXport Research — pure math for the Etsy overlays (no DOM, no chrome.*).
 *
 * Loaded as a content script before content-shared.js (window.__KX_MATH) and
 * required directly by the vitest suite under test/extension/.
 *
 * Rules:
 * - Prices: the price DISPLAYED on etsy.com (sale price, viewer currency) beats the
 *   Etsy API price, which is the pre-discount list price.
 * - Revenue = displayed monthly sales x displayed price, so the two on-screen numbers
 *   multiply out.
 * - Market price = median + P25-P75 of the organic (non-ad) cards on the page; raw
 *   min-max is only ever shown labelled as raw.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.__KX_MATH = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SYMBOLS = [
    ['US$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['AU$', 'AUD'], ['A$', 'AUD'], ['NZ$', 'NZD'],
    ['HK$', 'HKD'], ['MX$', 'MXN'], ['R$', 'BRL'], ['S$', 'SGD'],
    ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['₺', 'TRY'], ['TL', 'TRY'], ['¥', 'JPY'], ['₹', 'INR'],
    ['zł', 'PLN'], ['kr', 'SEK'], ['CHF', 'CHF'], ['₪', 'ILS'],
  ];
  const ISO = /\b(USD|EUR|GBP|CAD|AUD|NZD|TRY|JPY|INR|PLN|SEK|NOK|DKK|CHF|HKD|MXN|BRL|SGD|ILS)\b/;

  /** '$' -> 'USD', 'CA$' -> 'CAD', '€' -> 'EUR'; null when unknown. */
  function currencyFromSymbol(sym) {
    const s = String(sym || '').trim();
    if (!s) return null;
    const iso = s.toUpperCase().match(ISO);
    if (iso) return iso[1];
    for (const [k, v] of SYMBOLS) if (s === k) return v;
    for (const [k, v] of SYMBOLS) if (s.includes(k)) return v;
    return null;
  }

  /** "1,234.56" / "1.234,56" / "12,50" / "14.27" -> number. */
  function parseAmount(raw) {
    let s = String(raw || '').replace(/[^\d.,]/g, '');
    if (!s || !/\d/.test(s)) return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      // The later separator is the decimal one.
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      // "12,50" decimal vs "1,234" thousands: two digits after the comma -> decimal.
      s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (lastDot >= 0 && /\.\d{3}$/.test(s) && (s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Parse a displayed price string such as "$14.27", "$14.27+", "US$ 14.27",
   * "CA$20.00", "€12,50", "1.234,56 TL". Returns { amount, currency|null } or null.
   */
  function parseDisplayedPrice(text) {
    const s = String(text || '').replace(/ /g, ' ').trim();
    const m = s.match(/(\d[\d.,]*)/);
    if (!m) return null;
    const amount = parseAmount(m[1]);
    if (amount === null) return null;
    const before = s.slice(0, m.index).trim().split(/\s+/).pop() || '';
    const after = s.slice(m.index + m[1].length).trim().split(/\s+/)[0] || '';
    const currency = currencyFromSymbol(before) || currencyFromSymbol(after.replace(/\+$/, ''));
    return { amount, currency };
  }

  /**
   * Pick the shopper-facing price from a card's visible text: "Sale Price $14.27" beats
   * "Original Price $28.54"; otherwise the first price that is not labelled original.
   */
  function pickCardPriceFromText(text) {
    const s = String(text || '').replace(/ /g, ' ');
    const CODES = 'USD|EUR|GBP|CAD|AUD|NZD|TRY|JPY|INR|PLN|SEK|NOK|DKK|CHF|HKD|MXN|BRL|SGD|ILS';
    const PRICE = '((?:[A-Z]{1,2}\\$|[$€£₺¥₹]|(?:' + CODES + ')\\b)?\\s?\\d[\\d.,]*(?:\\s?(?:TL|' + CODES + ')\\b)?)';
    const sale = s.match(new RegExp('(?:Sale\\s+Price|İndirimli\\s+fiyat)\\s*:?\\s*' + PRICE, 'i'));
    if (sale) {
      const p = parseDisplayedPrice(sale[1]);
      if (p) return p;
    }
    const re = new RegExp(PRICE, 'g');
    let m;
    while ((m = re.exec(s))) {
      if (!new RegExp('[$€£₺¥₹]|\\bTL\\b|\\b(?:' + CODES + ')\\b').test(m[1])) continue; // bare numbers (rating, count) are not prices
      const head = s.slice(Math.max(0, m.index - 24), m.index);
      if (/(original\s+price|orijinal\s+fiyat|was)\s*:?\s*$/i.test(head)) continue;
      const p = parseDisplayedPrice(m[1]);
      if (p) return p;
    }
    return null;
  }

  /** Linear-interpolated quantile on a sorted array (numpy default). */
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function round2(v) { return v === null || v === undefined ? null : Math.round(v * 100) / 100; }

  /**
   * Median, P25-P75, Tukey-trimmed min/max (Q1-1.5*IQR .. Q3+3*IQR, same fences as
   * lib/research/stats.ts) and the raw min/max. Values <= 0 or non-finite are dropped.
   */
  function summarize(values) {
    const s = (values || []).map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!s.length) return { n: 0, median: null, p25: null, p75: null, min: null, max: null, rawMin: null, rawMax: null, trimmed: 0 };
    let kept = s;
    if (s.length >= 5) {
      const q1 = quantile(s, 0.25);
      const q3 = quantile(s, 0.75);
      const iqr = q3 - q1;
      kept = s.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 3 * iqr);
    }
    return {
      n: s.length,
      median: round2(quantile(s, 0.5)),
      p25: round2(quantile(s, 0.25)),
      p75: round2(quantile(s, 0.75)),
      min: round2(kept[0]),
      max: round2(kept[kept.length - 1]),
      rawMin: round2(s[0]),
      rawMax: round2(s[s.length - 1]),
      trimmed: s.length - kept.length,
    };
  }

  /**
   * Market summary from the cards on the page.
   * cards: [{ price, currency, favorites, shopId, isAd }]. Ads are excluded. Only cards in the
   * dominant currency are used for prices (never mix currencies).
   */
  function pageMarketSummary(cards) {
    const organic = (cards || []).filter(c => c && !c.isAd);
    const byCur = {};
    organic.forEach(c => {
      if (c.price > 0) {
        const k = c.currency || '?';
        byCur[k] = (byCur[k] || 0) + 1;
      }
    });
    const currency = Object.keys(byCur).sort((a, b) => byCur[b] - byCur[a])[0] || null;
    const prices = organic.filter(c => c.price > 0 && (c.currency || '?') === currency).map(c => c.price);
    const price = summarize(prices);
    const favs = organic.map(c => c.favorites).filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0).map(Number).sort((a, b) => a - b);
    const shops = new Set(organic.map(c => c.shopId).filter(Boolean));
    return {
      cards: organic.length,
      ads: (cards || []).length - organic.length,
      currency: currency === '?' ? null : currency,
      price,
      favoritesMedian: favs.length ? Math.round(quantile(favs, 0.5)) : null,
      favoritesN: favs.length,
      shops: shops.size,
    };
  }

  /**
   * "+73% vs median" for one card. Same currency only. Returns
   * { pct, text } or null when not comparable.
   */
  function priceVsMedian(price, median, priceCurrency, medianCurrency) {
    if (!(price > 0) || !(median > 0)) return null;
    if (priceCurrency && medianCurrency && priceCurrency !== medianCurrency) return null;
    const pct = Math.round(((price - median) / median) * 100);
    return { pct, text: (pct > 0 ? '+' : pct < 0 ? '−' : '±') + Math.abs(pct) + '%' };
  }

  /** The sales figure as displayed: >= 10 -> whole number, otherwise one decimal. */
  function shownSales(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
    n = Number(n);
    return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  }

  /** Revenue = shown sales x unit price (whole currency units). */
  function revenue(monthlySales, unitPrice) {
    const s = shownSales(monthlySales);
    if (s === null || !(unitPrice > 0)) return null;
    return Math.round(s * unitPrice);
  }

  /**
   * Revenue for a card. Uses the price displayed on the card (sale price, page currency)
   * when known; otherwise the API list price. Never an upper bound.
   * Returns { amount, currency, unitPrice, source: 'page'|'list_price' } or null.
   */
  function cardRevenue(stats, displayed) {
    const sales = (stats && stats.sales) || {};
    if (sales.monthlySales === null || sales.monthlySales === undefined) return null;
    if (displayed && displayed.amount > 0 && displayed.currency) {
      return { amount: revenue(sales.monthlySales, displayed.amount), currency: displayed.currency, unitPrice: displayed.amount, source: 'page' };
    }
    if (stats.price > 0) {
      return { amount: revenue(sales.monthlySales, stats.price), currency: stats.currency || null, unitPrice: stats.price, source: 'list_price' };
    }
    return null;
  }

  /**
   * Seller-set quantity is often a placeholder (999, 3951...). Only tiny values carry
   * a signal ("low stock"); everything else is "set by seller".
   */
  function quantitySignal(q) {
    const n = Number(q);
    if (q === null || q === undefined || !Number.isFinite(n) || n <= 0) return null;
    return n <= 3 ? 'low' : 'seller_set';
  }

  return {
    currencyFromSymbol, parseAmount, parseDisplayedPrice, pickCardPriceFromText,
    quantile, summarize, pageMarketSummary, priceVsMedian,
    shownSales, revenue, cardRevenue, quantitySignal,
  };
});

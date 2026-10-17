/**
 * KolayXport Research — eBay parsing + market math (pure functions).
 *
 * Loaded as a content script before content-ebay-shared.js (attaches
 * window.__KX_EBAY_MATH) and required by unit tests (module.exports).
 * Nothing here touches chrome.* or the network.
 *
 * Data sources, in order of preference:
 *   1. KolayXport API (/api/clawd/ebay-research?action=product_database) — eBay
 *      Browse API item_summary/search, best-match order, same marketplace as the
 *      page. Gives prices, seller usernames, creation dates and (for the first 20
 *      items) eBay's estimatedSoldQuantity.
 *   2. The search page DOM — new `li.s-card` markup (2025+) and old `li.s-item`.
 *      Used for the result count (what eBay shows the user), "65+ sold" depth, and
 *      as the full fallback when the API is unavailable or the page has filters
 *      the API call does not replicate.
 */
(function (root) {
  'use strict';

  // -------------------------------------------------------------------------
  // Marketplace
  // -------------------------------------------------------------------------
  const MARKETPLACES = {
    'www.ebay.com': { id: 'EBAY_US', currency: 'USD', locale: 'en-US' },
    'www.ebay.co.uk': { id: 'EBAY_GB', currency: 'GBP', locale: 'en-GB' },
    'www.ebay.de': { id: 'EBAY_DE', currency: 'EUR', locale: 'de-DE' },
    'www.ebay.fr': { id: 'EBAY_FR', currency: 'EUR', locale: 'fr-FR' },
    'www.ebay.it': { id: 'EBAY_IT', currency: 'EUR', locale: 'it-IT' },
    'www.ebay.es': { id: 'EBAY_ES', currency: 'EUR', locale: 'es-ES' },
    'www.ebay.com.au': { id: 'EBAY_AU', currency: 'AUD', locale: 'en-AU' },
  };

  function marketplaceForHost(host) {
    const h = String(host || '').toLowerCase();
    return MARKETPLACES[h] || MARKETPLACES['www.' + h.replace(/^www\./, '')] || MARKETPLACES['www.ebay.com'];
  }

  /**
   * URL refinements the API call does not replicate. When any is present the
   * page shows a different population than Browse API best-match, so the bar
   * uses page (DOM) numbers instead.
   */
  const REFINEMENT_PARAMS = ['LH_Sold', 'LH_Complete', '_udlo', '_udhi', 'LH_ItemCondition', 'LH_BIN', 'LH_Auction',
    'LH_BO', 'LH_FS', 'LH_PrefLoc', 'LH_LocatedIn', '_sop', '_sacat'];

  function pageRefinements(search) {
    const params = new URLSearchParams(search || '');
    return REFINEMENT_PARAMS.filter((p) => {
      const v = params.get(p);
      if (v == null || v === '') return false;
      if (p === '_sop' && v === '12') return false; // 12 = Best Match (default)
      if (p === '_sacat' && v === '0') return false; // 0 = All categories
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Number / price parsing
  // -------------------------------------------------------------------------

  /**
   * Parse one localized number token: "1,234.56", "1.234,56", "12,99", "1 234",
   * "9,500", "9.500". The last of '.'/',' is the decimal separator when both
   * appear; a lone separator followed by exactly 3 digits is a thousands mark.
   */
  function parseLocaleNumber(token) {
    if (token == null) return NaN;
    let s = String(token).replace(/[\s  ']/g, '');
    if (!/\d/.test(s)) return NaN;
    s = s.replace(/[^\d.,]/g, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastDot >= 0 || lastComma >= 0) {
      const sep = lastDot >= 0 ? '.' : ',';
      const parts = s.split(sep);
      const tail = parts[parts.length - 1];
      if (parts.length > 2 || tail.length === 3) s = parts.join(''); // thousands
      else s = parts.join('.'); // decimal
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /** "1.2K" → 1200, "3M" → 3000000, "65" → 65. */
  function parseCompactNumber(token) {
    const m = String(token || '').trim().match(/^([\d.,\s ]+)\s*([KkMm])?/);
    if (!m) return NaN;
    const base = parseLocaleNumber(m[1]);
    if (!Number.isFinite(base)) return NaN;
    if (!m[2]) return base;
    // In "1.2K" the separator is always decimal.
    const dec = parseFloat(m[1].replace(',', '.').replace(/[\s ]/g, ''));
    return Math.round(dec * (m[2].toLowerCase() === 'k' ? 1e3 : 1e6));
  }

  const CURRENCY_PATTERNS = [
    [/\bUS\s*\$/i, 'USD'],
    [/\bAU\s*\$/i, 'AUD'],
    [/\bC\s*\$/i, 'CAD'],
    [/\bCA\s*\$/i, 'CAD'],
    [/\bUSD\b/i, 'USD'],
    [/\bEUR\b|€/i, 'EUR'],
    [/\bGBP\b|£/i, 'GBP'],
    [/\bAUD\b/i, 'AUD'],
    [/\bCAD\b/i, 'CAD'],
    [/\bCHF\b/i, 'CHF'],
    [/\bTRY\b|₺/i, 'TRY'],
    [/\$/, null], // bare $ → marketplace default (USD on ebay.com, AUD on ebay.com.au)
  ];

  function detectCurrency(text, fallback) {
    for (const [re, code] of CURRENCY_PATTERNS) {
      if (re.test(text)) return code || (fallback === 'AUD' || fallback === 'CAD' ? fallback : 'USD');
    }
    return fallback || null;
  }

  const SHIPPING_RE = /shipping|postage|delivery|versand|lieferung|livraison|spedizione|env[ií]o|frais de port|\bp&p\b/i;
  const RANGE_SPLIT_RE = /\s+(?:to|bis|à|a|-|–)\s+/i;
  const NUM_TOKEN_RE = /\d[\d.,\s  ]*\d|\d/g;

  /**
   * Parse a price string into { min, max, currency } or null.
   * Handles "$25.99", "US $25.99", "$12.99 to $24.99", "EUR 12,99", "EUR 1.234,56",
   * "12,99 €", "£8.50", "AU $19.95". Shipping text ("+$5.99 shipping",
   * "Free delivery") returns null so it is never read as a price.
   */
  function parsePrice(text, defaultCurrency) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    if (/^\+/.test(raw) || SHIPPING_RE.test(raw)) return null;
    const currency = detectCurrency(raw, defaultCurrency);
    const parts = raw.split(RANGE_SPLIT_RE).filter(Boolean);
    const values = [];
    for (const part of parts.slice(0, 2)) {
      const tokens = part.match(NUM_TOKEN_RE);
      if (!tokens) continue;
      const n = parseLocaleNumber(tokens[0].trim());
      if (Number.isFinite(n) && n > 0) values.push(n);
    }
    if (!values.length) return null;
    return { min: Math.min(...values), max: Math.max(...values), currency: currency || defaultCurrency || null };
  }

  /** "9,500+ results for x" / "Über 9.500 Ergebnisse" / "9 500+ résultats" → { count, plus }. */
  function parseResultCount(text) {
    const s = String(text || '').replace(/\s+/g, ' ');
    const m = s.match(/(\d{1,3}(?:[.,\s  ]\d{3})+|\d+)\s*(\+)?/);
    if (!m) return null;
    const count = parseInt(m[1].replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(count)) return null;
    const plus = !!m[2] || /(?:^|\s)(über|over|more than|plus de|oltre|más de)\s/i.test(s);
    return { count, plus };
  }

  const SOLD_RE = /(\d[\d.,\s ]*\s*[KkMm]?)\s*(\+)?\s*(?:sold|verkauft|vendus?|venduti|vendidos)\b/i;

  /** "65+ sold" → { count: 65, plus: true }; "1.2K sold" → 1200; "1,234 verkauft" → 1234. */
  function parseSoldText(text) {
    const m = String(text || '').match(SOLD_RE);
    if (!m) return null;
    const count = /[KkMm]\s*$/.test(m[1].trim()) ? parseCompactNumber(m[1]) : parseLocaleNumber(m[1].trim());
    if (!Number.isFinite(count)) return null;
    return { count: Math.round(count), plus: !!m[2] };
  }

  /**
   * Seller rows. New: "towelco 99.6% positive (5.2K)". Old: "towelco (1,234) 99.5%".
   * Returns { username, positivePct, feedbackCount } or null.
   */
  function parseSellerText(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    // New markup always says "positive" (de "positive Bewertungen", fr "positives", it "positivi", es "positivos").
    let m = /positi/i.test(s) && s.match(/^(\S+)\s+(\d{1,3}(?:[.,]\d)?)\s*%[^(]*(?:\(([\d.,]+\s*[KkMm]?)\))?/);
    if (m && !/^\d/.test(m[1])) {
      return { username: m[1], positivePct: parseFloat(m[2].replace(',', '.')), feedbackCount: m[3] ? parseCompactNumber(m[3]) : null };
    }
    m = s.match(/^(\S+)\s*\(([\d.,]+\s*[KkMm]?)\)\s*(\d{1,3}(?:[.,]\d)?)\s*%/);
    if (m) {
      return { username: m[1], positivePct: parseFloat(m[3].replace(',', '.')), feedbackCount: parseCompactNumber(m[2]) };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // DOM extraction (works on any Document / Element: jsdom in tests)
  // -------------------------------------------------------------------------

  function itemIdFromHref(href) {
    const m = String(href || '').match(/\/itm\/(?:[^/?#]*\/)?(\d{9,})/);
    return m ? m[1] : null;
  }

  function cleanTitle(t) {
    return String(t || '')
      .replace(/Opens in a new window or tab/gi, '')
      .replace(/^\s*(New Listing|Neues Angebot|Nouvelle annonce|Nuova inserzione|Nuevo anuncio)\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Cards in either markup, deduped, without nested matches. */
  function findSearchCards(doc) {
    const scoped = doc.querySelectorAll('ul.srp-results > li.s-card, ul.srp-results > li.s-item');
    const list = scoped.length ? Array.from(scoped) : Array.from(doc.querySelectorAll('li.s-card, li.s-item, div.s-card'));
    return list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
  }

  /**
   * Text with a space between text nodes: eBay's new markup puts seller name
   * and "99.6% positive" in adjacent <span>s with no whitespace between them,
   * so plain textContent would read "towelco99.6% positive".
   */
  function textOf(el) {
    if (!el) return '';
    const parts = [];
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) parts.push(c.nodeValue);
        else if (c.nodeType === 1 && c.tagName !== 'SCRIPT' && c.tagName !== 'STYLE') walk(c);
      }
    })(el);
    return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,%)])/g, '$1').replace(/([($])\s+/g, '$1').trim();
  }

  function isStrikethrough(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cls = String(n.className || '');
      if (/strikethrough|STRIKETHROUGH|s-item__trending-price|s-card__price--original/.test(cls)) return true;
      if (n.tagName === 'S' || n.tagName === 'DEL' || n.tagName === 'STRIKE') return true;
      if (/\bs-card\b|\bs-item\b/.test(cls)) break;
    }
    return false;
  }

  /** Parse one search card. Returns null for the ghost "Shop on eBay" card and cards without an item link. */
  function parseSearchCard(card, defaultCurrency) {
    const link = card.querySelector('a[href*="/itm/"]');
    const id = card.getAttribute('data-listingid') || (link && itemIdFromHref(link.getAttribute('href') || link.href));
    const titleEl = card.querySelector('.s-card__title, .s-item__title');
    const title = cleanTitle(textOf(titleEl));
    if (!id || id === '123456' || /^shop on ebay$/i.test(title)) return null;

    // Price: every price element that is not a strikethrough "was" price.
    const priceEls = Array.from(card.querySelectorAll('.s-card__price, .s-item__price')).filter((el) => !isStrikethrough(el));
    // Nested .s-card__price inside .s-card__price: use outermost only.
    const outer = priceEls.filter((el) => !priceEls.some((o) => o !== el && o.contains(el)));
    let price = null;
    if (outer.length) {
      const joined = outer.map(textOf).join(' to ');
      price = parsePrice(joined, defaultCurrency);
    }

    // Attribute rows (new) / misc spans (old) for sold, seller, sponsored.
    const rows = Array.from(card.querySelectorAll(
      '.s-card__attribute-row, .s-item__hotness, .s-item__quantitySold, .s-item__additionalItemHotness, .s-item__seller-info-text, .s-item__seller-info, .s-item__detail'
    ));
    let sold = null;
    let seller = null;
    for (const row of rows) {
      const t = textOf(row);
      if (!sold) sold = parseSoldText(t);
      if (!seller && !SHIPPING_RE.test(t) && /%/.test(t)) seller = parseSellerText(t);
    }
    if (!seller) {
      const sEl = card.querySelector('.s-item__seller-info-text, .s-card__seller-info');
      if (sEl) seller = parseSellerText(textOf(sEl));
    }

    // "Sponsored" label (old markup obfuscates it into single letters, so test with spaces removed).
    const nonTitle = textOf(card).replace(title, '').replace(/\s+/g, '');
    const sponsored = /sponsored|gesponsert|sponsoris|sponsorizzat|patrocinad/i.test(nonTitle);

    return {
      id: String(id),
      title,
      price: price ? price.min : null,
      priceMax: price ? price.max : null,
      currency: price ? price.currency : null,
      soldCount: sold ? sold.count : null,
      soldPlus: sold ? sold.plus : false,
      seller: seller ? seller.username : null,
      sellerPositivePct: seller ? seller.positivePct : null,
      sponsored,
      el: card,
    };
  }

  function parseSearchPage(doc, opts) {
    const defaultCurrency = (opts && opts.currency) || 'USD';
    const countEl = doc.querySelector('.srp-controls__count-heading, h1.srp-controls__count-heading, .srp-controls__count');
    const resultCount = countEl ? parseResultCount(textOf(countEl)) : null;
    const seen = new Set();
    const items = [];
    for (const card of findSearchCards(doc)) {
      const parsed = parseSearchCard(card, defaultCurrency);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      items.push(parsed);
    }
    return { resultCount, items };
  }

  /** Listing page: "More than 10 available · 1,234 sold". */
  function parseListingPage(doc, opts) {
    const defaultCurrency = (opts && opts.currency) || 'USD';
    const qtyText = textOf(doc.querySelector('#qtyAvailability, .x-quantity__availability, #qtySubTxt'));
    const sold = parseSoldText(qtyText) || parseSoldText(textOf(doc.querySelector('.x-quantity__sold, #why2buy')));
    const priceEl = doc.querySelector('.x-price-primary, #prcIsum, [itemprop="price"]');
    const price = priceEl ? parsePrice(textOf(priceEl) || priceEl.getAttribute('content'), defaultCurrency) : null;
    return { soldCount: sold ? sold.count : null, soldPlus: sold ? sold.plus : false, price: price ? price.min : null, currency: price ? price.currency : null };
  }

  // -------------------------------------------------------------------------
  // API item normalisation (Browse API item_summary)
  // -------------------------------------------------------------------------

  /** Normalise one Browse API item_summary (as returned by product_database). */
  function normalizeApiItem(it) {
    if (!it || typeof it !== 'object') return null;
    const priceObj = it.price || {};
    const price = parseFloat(priceObj.value);
    const legacyId = it.legacyItemId || (String(it.itemId || '').match(/\|(\d+)\|/) || [])[1] || null;
    const sold = it.enriched === true && Number.isFinite(Number(it.estimatedSoldQuantity)) ? Number(it.estimatedSoldQuantity) : null;
    const remaining = it.enriched === true && Number.isFinite(Number(it.estimatedRemainingQuantity)) ? Number(it.estimatedRemainingQuantity) : null;
    return {
      id: legacyId ? String(legacyId) : null,
      title: it.title || '',
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: priceObj.currency || null,
      seller: (it.seller && it.seller.username) || null,
      sellerPositivePct: it.seller && it.seller.feedbackPercentage != null ? parseFloat(it.seller.feedbackPercentage) : null,
      soldCount: sold,
      remainingCount: remaining,
      createdAt: it.itemCreationDate || null,
      endsAt: it.itemEndDate || null,
      buyingOptions: it.buyingOptions || [],
    };
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

  /**
   * Robust price summary, same rules as lib/research/stats.ts (server):
   * majority currency only, median + P25–P75, Tukey-trimmed min/max, no mean.
   * n < 5 → quality 'insufficient'; n < 20 → 'small'.
   */
  function priceSummary(items) {
    const counts = {};
    for (const it of items) if (it && it.price > 0 && it.currency) counts[it.currency] = (counts[it.currency] || 0) + 1;
    const currency = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
    const values = items.filter((it) => it && it.price > 0 && (!currency || it.currency === currency)).map((it) => it.price).sort((a, b) => a - b);
    let kept = values;
    if (values.length >= 5) {
      const q1 = quantile(values, 0.25);
      const q3 = quantile(values, 0.75);
      const iqr = q3 - q1;
      kept = values.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 3 * iqr);
    }
    const n = kept.length;
    return {
      n,
      sampled: items.length,
      excludedOtherCurrency: items.filter((it) => it && it.price > 0 && currency && it.currency !== currency).length,
      currency,
      median: r2(quantile(kept, 0.5)),
      p25: r2(quantile(kept, 0.25)),
      p75: r2(quantile(kept, 0.75)),
      min: n ? r2(kept[0]) : null,
      max: n ? r2(kept[n - 1]) : null,
      quality: n < 5 ? 'insufficient' : n < 20 ? 'small' : 'ok',
    };
  }

  /** Distinct sellers among items that expose a seller. */
  function sellerStats(items) {
    const withSeller = items.filter((it) => it && it.seller);
    const counts = {};
    for (const it of withSeller) {
      const k = String(it.seller).toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    }
    const sorted = Object.values(counts).sort((a, b) => b - a);
    const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
    return {
      known: withSeller.length,
      distinct: sorted.length,
      top3Share: withSeller.length ? top3 / withSeller.length : null,
    };
  }

  /** Sold depth among items with a known sold count (API estimate or "N sold" on the card). */
  function soldStats(items) {
    const counts = items.map((it) => it && it.soldCount).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
    return {
      known: counts.length,
      withSales: counts.filter((v) => v > 0).length,
      median: quantile(counts, 0.5),
      p75: quantile(counts, 0.75),
      total: counts.reduce((a, b) => a + b, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Competition
  // -------------------------------------------------------------------------

  /**
   * Competition for a newcomer, 0–100, from four real inputs. Each factor is
   * mapped to 0..1 (1 = more competition), then weighted. Missing inputs are
   * dropped and the remaining weights re-normalised. At least two factors,
   * one of them the result count, are required; otherwise level = 'unknown'.
   *
   *   results  (w .35): f = clamp((log10(R) − 2) / 3)        100 → 0, 1k → .33, 10k → .67, ≥100k → 1
   *   sold     (w .25): f = clamp(log10(1 + P75 sold) / 2)   P75 of sold counts among top results:
   *                                                         0 → 0, 9 → .5, ≥99 → 1 (entrenched incumbents)
   *                     needs ≥ 5 items with a known sold count.
   *   sellers  (w .20): f = clamp((distinct/known − .3) / .6) share of distinct sellers in top results:
   *                                                         ≤ 30% → 0, ≥ 90% → 1 (crowded field)
   *                     needs ≥ 10 items with a known seller.
   *   price    (w .20): d = (P75 − P25) / median; f = clamp((1 − d) / .8)
   *                                                         d ≥ 1 → 0 (room to differentiate),
   *                                                         d ≤ .2 → 1 (commodity, price war)
   *                     needs price quality 'ok' or 'small' (n ≥ 5).
   *
   *   score < 40 → low, 40–64 → medium, ≥ 65 → high.
   */
  const COMPETITION_WEIGHTS = { results: 0.35, sold: 0.25, sellers: 0.2, price: 0.2 };
  const COMPETITION_THRESHOLDS = { medium: 40, high: 65 };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function computeCompetition(input) {
    const { resultCount, sold, sellers, price } = input || {};
    const factors = {};
    if (Number.isFinite(resultCount) && resultCount >= 0) {
      factors.results = clamp01((Math.log10(Math.max(resultCount, 1)) - 2) / 3);
    }
    if (sold && sold.known >= 5 && Number.isFinite(sold.p75)) {
      factors.sold = clamp01(Math.log10(1 + sold.p75) / 2);
    }
    if (sellers && sellers.known >= 10) {
      factors.sellers = clamp01((sellers.distinct / sellers.known - 0.3) / 0.6);
    }
    if (price && price.n >= 5 && price.median > 0 && price.p25 != null && price.p75 != null) {
      const d = (price.p75 - price.p25) / price.median;
      factors.price = clamp01((1 - d) / 0.8);
    }
    const keys = Object.keys(factors);
    if (factors.results == null || keys.length < 2) {
      return { level: 'unknown', score: null, factors, used: keys };
    }
    const wSum = keys.reduce((a, k) => a + COMPETITION_WEIGHTS[k], 0);
    const score = Math.round((100 * keys.reduce((a, k) => a + COMPETITION_WEIGHTS[k] * factors[k], 0)) / wSum);
    const level = score >= COMPETITION_THRESHOLDS.high ? 'high' : score >= COMPETITION_THRESHOLDS.medium ? 'medium' : 'low';
    return { level, score, factors, used: keys };
  }

  // -------------------------------------------------------------------------
  // Per-item
  // -------------------------------------------------------------------------

  /**
   * Estimated monthly sales = lifetime sold / listing age in months. Only when
   * the sold count and creation date are both known and the listing is at least
   * 14 days old (younger listings extrapolate wildly). Always labelled "est.".
   */
  function estMonthlySales(soldCount, createdAt, now) {
    if (!Number.isFinite(soldCount) || soldCount < 0 || !createdAt) return null;
    const created = Date.parse(createdAt);
    if (!Number.isFinite(created)) return null;
    const days = ((now != null ? now : Date.now()) - created) / 86400000;
    if (days < 14) return null;
    return Math.round((soldCount / (days / 30.44)) * 10) / 10;
  }

  /** Sell-through of one listing's stock = sold / (sold + remaining). */
  function sellThrough(sold, remaining) {
    if (!Number.isFinite(sold) || !Number.isFinite(remaining) || sold + remaining <= 0) return null;
    return sold / (sold + remaining);
  }

  /** Price vs market median, rounded percent; null without both numbers. */
  function pctVsMedian(price, median) {
    if (!(price > 0) || !(median > 0)) return null;
    return Math.round(((price - median) / median) * 100);
  }

  /**
   * Rank items by sold count among those with a known count > 0. "Top X%" is
   * the item's percentile within that set; isBestSeller = top 10%.
   */
  function bestSellerRanks(items) {
    const ranked = items.filter((it) => it && it.id && Number.isFinite(it.soldCount) && it.soldCount > 0)
      .sort((a, b) => b.soldCount - a.soldCount);
    const total = ranked.length;
    const out = {};
    ranked.forEach((it, i) => {
      const percentile = Math.max(1, Math.round(((i + 1) / total) * 100));
      out[it.id] = { rank: i + 1, total, percentile, isBestSeller: total >= 5 && percentile <= 10 };
    });
    return out;
  }

  // -------------------------------------------------------------------------
  // Summary assembly
  // -------------------------------------------------------------------------

  /**
   * Merge API response (product_database) and page parse into the numbers the
   * bar shows. API is preferred for prices/sellers/sold estimates; the page is
   * preferred for the result count (that is the number eBay shows) and for
   * everything when the page has refinements the API call ignores.
   */
  function buildSearchSummary({ api, page, refinements }) {
    const apiItems = api && Array.isArray(api.items) ? api.items.map(normalizeApiItem).filter(Boolean) : [];
    const pageItems = (page && page.items) || [];
    const useApi = apiItems.length > 0 && !(refinements && refinements.length);
    const pageById = {};
    for (const it of pageItems) pageById[it.id] = it;

    // Items: API items, with sold counts backfilled from the page card when the
    // API did not enrich that item; page items otherwise.
    const items = useApi
      ? apiItems.map((it) => {
        const p = it.id ? pageById[it.id] : null;
        if (it.soldCount == null && p && p.soldCount != null) return { ...it, soldCount: p.soldCount, soldPlus: p.soldPlus, soldSource: 'page' };
        return { ...it, soldSource: it.soldCount != null ? 'api' : null };
      })
      : pageItems.map((it) => ({ ...it, soldSource: it.soldCount != null ? 'page' : null }));

    let price;
    const apiStats = api && api.priceStats;
    if (useApi && apiStats && apiStats.n > 0) {
      price = { n: apiStats.n, sampled: apiStats.sampled, currency: apiStats.currency, median: apiStats.median, p25: apiStats.p25,
        p75: apiStats.p75, min: apiStats.min, max: apiStats.max, quality: apiStats.quality };
    } else {
      price = priceSummary(items);
    }

    const resultCount = page && page.resultCount ? page.resultCount
      : (api && Number.isFinite(api.total) ? { count: api.total, plus: false } : null);
    const sellers = sellerStats(items);
    const sold = soldStats(items);
    const competition = computeCompetition({ resultCount: resultCount ? resultCount.count : null, sold, sellers, price });

    return {
      source: useApi ? 'api' : 'page',
      resultCount,
      resultCountSource: page && page.resultCount ? 'page' : resultCount ? 'api' : null,
      apiTotal: api && Number.isFinite(api.total) ? api.total : null,
      price,
      sellers,
      sold,
      competition,
      items,
    };
  }

  const api = {
    MARKETPLACES,
    marketplaceForHost,
    pageRefinements,
    parseLocaleNumber,
    parseCompactNumber,
    detectCurrency,
    parsePrice,
    parseResultCount,
    parseSoldText,
    parseSellerText,
    itemIdFromHref,
    findSearchCards,
    parseSearchCard,
    parseSearchPage,
    parseListingPage,
    normalizeApiItem,
    priceSummary,
    sellerStats,
    soldStats,
    computeCompetition,
    COMPETITION_WEIGHTS,
    COMPETITION_THRESHOLDS,
    estMonthlySales,
    sellThrough,
    pctVsMedian,
    bestSellerRanks,
    buildSearchSummary,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__KX_EBAY_MATH = api;
})(typeof window !== 'undefined' ? window : null);

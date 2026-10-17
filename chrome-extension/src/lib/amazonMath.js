/**
 * KolayXport Research — Amazon pure parsing & formula helpers.
 *
 * No DOM access here: every function takes plain strings/numbers so it can be
 * unit-tested (test/extension/amazonMath.test.ts) and reused by the content
 * scripts. Loaded as a classic content script (attaches window.__kxAmzMath)
 * and as CommonJS in tests (module.exports).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.__kxAmzMath = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Number parsing (locale aware)
  // -------------------------------------------------------------------------

  // Thin / no-break spaces Amazon uses as thousands separators (fr, some de).
  const NB_SPACES = /[\u00a0\u202f\u2009]/g;

  // A number with thousands groups ("15,234", "1.234,56", "3 000") OR a plain
  // number with an optional single decimal part ("4.4", "12,99", "1.2").
  // Followed by an optional magnitude suffix.
  const NUMBER_RE = /(\d{1,3}(?:[,.'\u00a0\u202f\u2009]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)(?:\s*(k|m|mio\.?|tsd\.?|mn|b(?![a-z]))(?![a-z]))?/i;

  const SUFFIX = { k: 1e3, tsd: 1e3, m: 1e6, mio: 1e6, mn: 1e6 };

  /**
   * Parse the first number in `raw`.
   * - "15,234" / "15.234" / "15 234" → 15234 (3-digit groups = thousands)
   * - "1.234,56" / "1,234.56"        → 1234.56 (last differing separator = decimal)
   * - "12,99" / "4.4"                → 12.99 / 4.4 (1–2 trailing digits = decimal)
   * - "1.2K" / "1,2K" / "5K+"        → 1200 / 1200 / 5000
   * - "1B+" on amazon.com.tr (bin)   → 1000 (only when opts.marketplace === 'TR')
   */
  function parseLocaleNumber(raw, opts) {
    if (raw == null) return null;
    const o = opts || {};
    const text = String(raw).replace(NB_SPACES, '\u00a0');
    const m = text.match(NUMBER_RE);
    if (!m) return null;
    let token = m[1];
    let suffix = (m[2] || '').toLowerCase().replace('.', '');
    if (suffix === 'b') {
      // Turkish "B" = bin (thousand). Elsewhere a "B" after a count is not a
      // magnitude we expect (no product has billions of reviews) — ignore it.
      suffix = o.marketplace === 'TR' ? 'bin' : '';
    }
    const mult = suffix === 'bin' ? 1e3 : (SUFFIX[suffix] || 1);

    let value;
    const groupMatch = token.match(/^(\d{1,3})((?:[,.'\u00a0\u202f\u2009]\d{3})+)(?:([.,])(\d{1,2}))?$/);
    if (groupMatch) {
      const groups = groupMatch[2].replace(/[^\d]/g, '');
      const intPart = groupMatch[1] + groups;
      const firstSep = groupMatch[2][0];
      const decSep = groupMatch[3];
      if (decSep && decSep !== firstSep) {
        value = parseFloat(intPart + '.' + groupMatch[4]);
      } else if (decSep && decSep === firstSep) {
        // "1,234,56" is not a real format; treat trailing group as decimals.
        value = parseFloat(intPart + '.' + groupMatch[4]);
      } else if (mult > 1 && groupMatch[2].length === 4) {
        // "1.234K" is not a real format either, but "1,5K" is handled below;
        // a single 3-digit group + suffix → decimal ("1.500K" ≈ 1.5K).
        value = parseFloat(groupMatch[1] + '.' + groups);
      } else {
        value = parseInt(intPart, 10);
      }
    } else {
      // Plain "123", "4.4", "12,99", "1.2"
      value = parseFloat(token.replace(',', '.'));
    }
    if (!isFinite(value)) return null;
    return value * mult;
  }

  /** Integer count: reviews, ratings, results, units. */
  function parseCount(raw, opts) {
    const v = parseLocaleNumber(raw, opts);
    return v == null ? null : Math.round(v);
  }

  const CURRENCY_SYMBOLS = [
    ['US$', 'USD'], ['$', 'USD'], ['€', 'EUR'], ['EUR', 'EUR'], ['£', 'GBP'], ['GBP', 'GBP'],
    ['₺', 'TRY'], ['TL', 'TRY'], ['TRY', 'TRY'], ['USD', 'USD'],
  ];

  /** "$1,234.56" / "1.234,56 €" / "£12.99" / "₺1.299,90" → { value, currency } */
  function parsePrice(raw, fallbackCurrency) {
    if (raw == null) return null;
    const text = String(raw).trim();
    if (!text) return null;
    const value = parseLocaleNumber(text);
    if (value == null || value <= 0) return null;
    let currency = fallbackCurrency || null;
    for (const [sym, code] of CURRENCY_SYMBOLS) {
      if (text.includes(sym)) { currency = code; break; }
    }
    return { value: Math.round(value * 100) / 100, currency };
  }

  /**
   * Star rating 0–5.
   * "4.4 out of 5 stars", "4,4 von 5 Sternen", "5 üzerinden 4,4 yıldız", "4.4".
   */
  function parseRating(raw) {
    if (raw == null) return null;
    const text = String(raw);
    const tr = text.match(/5\s*üzerinden\s*(\d(?:[.,]\d)?)/i);
    const any = tr || text.match(/(\d(?:[.,]\d)?)\s*(?:out of|von|sur|su|de|of)\s*5/i) || text.match(/(\d[.,]\d)/) || text.match(/^\s*(\d)\s*$/);
    if (!any) return null;
    const v = parseFloat(any[1].replace(',', '.'));
    return v >= 0 && v <= 5 ? v : null;
  }

  const BOUGHT_RE = /(bought in (?:the )?past month|im letzten monat|geçen ay|le mois dernier|el mes pasado|nel mese scorso)/i;

  /**
   * Amazon's own demand signal: "5K+ bought in past month",
   * "Über 1000 Mal im letzten Monat gekauft", "Geçen ay 1B+ kez satın alındı".
   * Returns { min, label } — `min` is a floor ("5K+" = at least 5,000).
   */
  function parseBoughtPastMonth(raw, opts) {
    if (raw == null) return null;
    const text = String(raw).replace(/\s+/g, ' ').trim();
    if (!BOUGHT_RE.test(text)) return null;
    const min = parseCount(text, opts);
    if (min == null || min <= 0) return null;
    const lm = text.match(/(\d[\d.,]*(?:\s*(?:k|m|b|tsd\.?)(?![a-z]))?\+?)/i);
    let label = lm ? lm[1].replace(/\s+/g, '') : String(min);
    if (!label.endsWith('+')) label += '+'; // every tier is a floor ("Über 1000 Mal" = 1000+)
    return { min, label };
  }

  /**
   * Result count from the search info bar:
   *   "1-48 of over 3,000 results for "turkish towel""  → { total: 3000, isLowerBound: true }
   *   "1-16 of 216 results for"                         → { total: 216,  isLowerBound: false }
   *   "1-48 von mehr als 3.000 Ergebnissen oder Vorschlägen für"
   *   "3.000 üzeri sonuç arasından 1-48 arası gösteriliyor"
   */
  function parseTotalResults(raw) {
    if (raw == null) return null;
    let text = String(raw).replace(/\s+/g, ' ');
    // Drop the quoted query (it may contain digits: "iphone 15").
    text = text.split(/["“”„«»]/)[0];
    // Drop the "1-48" page range.
    text = text.replace(/\d[\d.,]*\s*[-–]\s*\d[\d.,]*/, ' ');
    const total = parseCount(text);
    if (total == null || total <= 0) return null;
    const isLowerBound = /\b(over|more than|mehr als|über|plus de|oltre|más de|üzeri)\b|üzeri|über/i.test(text);
    return { total, isLowerBound };
  }

  // -------------------------------------------------------------------------
  // Stats helpers
  // -------------------------------------------------------------------------

  function median(values) {
    const a = (values || []).filter((v) => typeof v === 'number' && isFinite(v)).sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function mean(values) {
    const a = (values || []).filter((v) => typeof v === 'number' && isFinite(v));
    if (!a.length) return null;
    return a.reduce((s, v) => s + v, 0) / a.length;
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  /** Map value onto 0..1 on a log10 scale between lo and hi. */
  function logScale(value, lo, hi) {
    if (value == null || !isFinite(value)) return null;
    const v = Math.log10(Math.max(1, value));
    return clamp01((v - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)));
  }

  function linScale(value, lo, hi) {
    if (value == null || !isFinite(value)) return null;
    return clamp01((value - lo) / (hi - lo));
  }

  // -------------------------------------------------------------------------
  // Competition model
  // -------------------------------------------------------------------------

  /**
   * Thresholds (documented; tuned so a saturated category like "turkish towel"
   * on amazon.com reads High and a genuine long-tail niche reads Low).
   *
   * Each signal is mapped to 0..1, then combined with these weights:
   *   volume       15%  total results, log scale: 300 → 0, 50,000 → 1
   *                     (Amazon's "over 3,000" is a floor, so it scores ≥0.45)
   *   pageMedian   20%  median reviews of organic results on the page,
   *                     log scale: 50 → 0, 2,000 → 1
   *   top10Median  25%  median reviews of the first 10 organic results,
   *                     log scale: 100 → 0, 5,000 → 1
   *   share1k      25%  share of organic results with >1,000 reviews,
   *                     linear: 0% → 0, 40% → 1
   *   sponsored    15%  share of result cards that are ads,
   *                     linear: 5% → 0, 35% → 1 (ad saturation)
   *   offers       10%  (only when SP-API data is present) median number of
   *                     competing offers per ASIN, log scale: 1 → 0, 15 → 1
   * Weights of missing signals are dropped and the rest renormalised.
   *
   * Level: score ≥ 55 → High, ≥ 30 → Medium, else Low.
   * This matches the common Amazon seller rule of thumb: top-10 results under
   * ~200 ratings = enterable, a few hundred = moderate, 1,000+ = entrenched.
   * Incumbent floors (a newcomer cannot outrank deep review moats no matter
   * what the other signals say):
   *   top-10 median ≥ 1,000 reviews or ≥ 30% of listings over 1,000 → High
   *   top-10 median ≥ 300 reviews                                    → ≥ Medium
   * Fewer than 5 organic results with a review count → Unknown.
   */
  const COMPETITION_CONFIG = {
    weights: { volume: 0.15, pageMedian: 0.20, top10Median: 0.25, share1k: 0.25, sponsored: 0.15, offers: 0.10 },
    volume: [300, 50000],
    pageMedian: [50, 2000],
    top10Median: [100, 5000],
    share1k: [0, 0.4],
    sponsored: [0.05, 0.35],
    offers: [1, 15],
    high: 55,
    medium: 30,
    floorHighTop10Median: 1000,
    floorHighShare1k: 0.3,
    floorMediumTop10Median: 300,
    minOrganicWithReviews: 5,
  };

  /**
   * @param {object} input
   * @param {number|null} input.totalResults
   * @param {number[]} input.organicReviewCounts  organic results in page order (0 for "no reviews")
   * @param {number} input.sponsoredCount
   * @param {number} input.cardCount              all result cards (organic + sponsored)
   * @param {number[]} [input.offerCounts]        SP-API competing offers per ASIN (optional)
   */
  function computeCompetition(input) {
    const c = COMPETITION_CONFIG;
    const reviews = (input.organicReviewCounts || []).filter((v) => typeof v === 'number' && isFinite(v) && v >= 0);
    const top10 = reviews.slice(0, 10);
    const pageMedian = median(reviews);
    const top10Median = median(top10);
    const share1k = reviews.length ? reviews.filter((r) => r > 1000).length / reviews.length : null;
    const sponsoredShare = input.cardCount > 0 ? (input.sponsoredCount || 0) / input.cardCount : null;
    const offerMedian = median(input.offerCounts || []);

    const signals = {
      totalResults: input.totalResults ?? null,
      pageMedianReviews: pageMedian,
      top10MedianReviews: top10Median,
      shareOver1kReviews: share1k,
      sponsoredShare,
      medianOfferCount: offerMedian,
      organicWithReviews: reviews.length,
    };

    if (reviews.length < c.minOrganicWithReviews) {
      return { level: 'Unknown', score: null, signals, reasons: ['not enough organic results with review counts'] };
    }

    const parts = {
      volume: input.totalResults ? logScale(input.totalResults, c.volume[0], c.volume[1]) : null,
      pageMedian: logScale(pageMedian, c.pageMedian[0], c.pageMedian[1]),
      top10Median: logScale(top10Median, c.top10Median[0], c.top10Median[1]),
      share1k: linScale(share1k, c.share1k[0], c.share1k[1]),
      sponsored: linScale(sponsoredShare, c.sponsored[0], c.sponsored[1]),
      offers: offerMedian != null ? logScale(offerMedian, c.offers[0], c.offers[1]) : null,
    };
    let wSum = 0;
    let acc = 0;
    for (const key of Object.keys(parts)) {
      if (parts[key] == null) continue;
      wSum += c.weights[key];
      acc += c.weights[key] * parts[key];
    }
    const score = Math.round((wSum ? acc / wSum : 0) * 100);

    let level = score >= c.high ? 'High' : score >= c.medium ? 'Medium' : 'Low';
    const reasons = [];
    if (top10Median >= c.floorHighTop10Median || share1k >= c.floorHighShare1k) {
      if (level !== 'High') reasons.push('deep review moat among top results');
      level = 'High';
    } else if (top10Median >= c.floorMediumTop10Median && level === 'Low') {
      level = 'Medium';
      reasons.push('top results already have hundreds of reviews');
    }
    return { level, score, signals, parts, reasons };
  }

  // -------------------------------------------------------------------------
  // Sales estimation (BSR model) — always an ESTIMATE, never measured
  // -------------------------------------------------------------------------

  // Mirrors lib/amazon/salesEstimator.ts CATEGORY_CURVES (amazon.com calibration).
  // monthlyUnits = base * bsr^-exponent
  const CATEGORY_CURVES = [
    { name: 'Books', match: /books|bücher|kitap/i, base: 10000, exponent: 0.63 },
    { name: 'Home & Kitchen', match: /home & kitchen|küche|haushalt|kitchen|ev ve mutfak|home/i, base: 8000, exponent: 0.60 },
    { name: 'Clothing', match: /clothing|fashion|bekleidung|giyim/i, base: 8000, exponent: 0.60 },
    { name: 'Toys & Games', match: /toys|spielzeug|oyuncak/i, base: 7000, exponent: 0.60 },
    { name: 'Sports', match: /sport/i, base: 6000, exponent: 0.58 },
    { name: 'Health', match: /health|drogerie|sağlık/i, base: 6000, exponent: 0.58 },
    { name: 'Beauty', match: /beauty|kosmetik|güzellik/i, base: 6000, exponent: 0.58 },
    { name: 'Grocery', match: /grocery|lebensmittel|gıda/i, base: 6000, exponent: 0.58 },
    { name: 'Electronics', match: /electronics|elektronik/i, base: 5000, exponent: 0.57 },
    { name: 'Pet Supplies', match: /pet|haustier|evcil/i, base: 5000, exponent: 0.57 },
    { name: 'Baby', match: /baby|bebek/i, base: 5000, exponent: 0.57 },
    { name: 'Garden', match: /garden|garten|bahçe|patio/i, base: 5000, exponent: 0.57 },
    { name: 'Tools', match: /tools|baumarkt|home improvement|yapı market/i, base: 5000, exponent: 0.57 },
    { name: 'Automotive', match: /automotive|auto|otomotiv/i, base: 4000, exponent: 0.55 },
    { name: 'Office', match: /office|bürobedarf|ofis/i, base: 4000, exponent: 0.55 },
    { name: 'Arts & Crafts', match: /arts|crafts|basteln|sanat/i, base: 4000, exponent: 0.55 },
    { name: 'Handmade', match: /handmade|handgemacht/i, base: 2000, exponent: 0.50 },
  ];
  const DEFAULT_CURVE = { name: 'General', base: 5000, exponent: 0.57 };

  function curveFor(categoryName) {
    if (!categoryName) return DEFAULT_CURVE;
    for (const c of CATEGORY_CURVES) if (c.match.test(categoryName)) return c;
    return DEFAULT_CURVE;
  }

  /** Round to `sig` significant figures (no fake precision: 1,437 → 1,400). */
  function roundSig(n, sig) {
    if (!n || !isFinite(n)) return 0;
    const s = sig || 2;
    return Number(Number(n).toPrecision(s));
  }

  /**
   * BSR → monthly units. Returns a rounded point estimate plus a 0.5×–2× band
   * (power-law BSR curves are typically off by about that much).
   * `calibrated` is false outside amazon.com: the curves were fitted on US data
   * and overstate smaller marketplaces.
   */
  function estimateSalesFromBsr(bsr, categoryName, marketplace) {
    if (!bsr || bsr < 1) return null;
    const curve = curveFor(categoryName);
    const raw = curve.base * Math.pow(bsr, -curve.exponent);
    const units = Math.max(1, roundSig(raw, 2));
    return {
      units,
      low: Math.max(1, roundSig(raw * 0.5, 2)),
      high: Math.max(1, roundSig(raw * 2, 2)),
      curve: curve.name,
      bsr,
      calibrated: !marketplace || marketplace === 'US',
      kind: 'estimate',
    };
  }

  /**
   * Pick the sales figure to show for one product, in order of trust:
   *  1. Amazon's own "X+ bought in past month" (a floor, labelled as Amazon's)
   *  2. BSR-model estimate (labelled "est.")
   *  3. nothing — we do not invent a number
   */
  function pickSalesFigure(input) {
    const price = input.price && input.price > 0 ? input.price : null;
    if (input.bought && input.bought.min > 0) {
      return {
        kind: 'amazon',
        units: input.bought.min,
        label: input.bought.label,
        revenueFloor: price ? roundSig(input.bought.min * price, 2) : null,
      };
    }
    if (input.bsr) {
      const est = estimateSalesFromBsr(input.bsr, input.bsrCategory, input.marketplace);
      if (est) {
        return Object.assign({}, est, {
          revenue: price ? roundSig(est.units * price, 2) : null,
        });
      }
    }
    return { kind: 'none' };
  }

  /**
   * Best Seller Rank lines from a product page:
   *   "#1,234 in Home & Kitchen (See Top 100 in Home & Kitchen) #5 in Bath Towels"
   *   "Nr. 1.234 in Küche, Haushalt & Wohnen (Siehe Top 100 ...) Nr. 5 in Badetücher"
   * Returns [{ rank, category }] in page order (first = top-level category).
   */
  function parseBsrText(raw) {
    if (!raw) return [];
    const text = String(raw).replace(/\s+/g, ' ').replace(/\([^)]*\)/g, ' ');
    const out = [];
    const re = /(?:#|Nr\.\s*|nº\s*|n°\s*)(\d[\d.,\u00a0]*)\s+(?:in|en|dans)\s+([^#]+?)(?=\s*(?:#|Nr\.|nº|n°|$))/gi;
    let m;
    while ((m = re.exec(text))) {
      const rank = parseCount(m[1]);
      const category = m[2].replace(/\s+/g, ' ').trim();
      if (rank && category) out.push({ rank, category });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  const CURRENCY_PREFIX = { USD: '$', GBP: '£', EUR: '€', TRY: '₺' };

  function formatCompact(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    // Truncate like Amazon does ("3,251 ratings" → "3.2K"), so our numbers match the page and a "≥" floor
    // never rounds up past what Amazon actually reported.
    const cut = (v, d) => { const f = 10 ** d; return String(Math.trunc(v * f) / f); };
    if (a >= 1e6) return cut(n / 1e6, a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return cut(n / 1e3, a >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(n));
  }

  function formatMoney(value, currency, compact) {
    if (value == null || !isFinite(value)) return '—';
    const sym = CURRENCY_PREFIX[currency] || (currency ? currency + ' ' : '');
    return sym + (compact ? formatCompact(value) : value.toFixed(2));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    parseLocaleNumber,
    parseCount,
    parsePrice,
    parseRating,
    parseBoughtPastMonth,
    parseTotalResults,
    parseBsrText,
    median,
    mean,
    computeCompetition,
    COMPETITION_CONFIG,
    estimateSalesFromBsr,
    pickSalesFigure,
    curveFor,
    roundSig,
    formatCompact,
    formatMoney,
    escapeHtml,
  };
});

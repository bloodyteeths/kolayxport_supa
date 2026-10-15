/**
 * Research statistics: honest price and number summaries (RESEARCH_REDESIGN §5 R0, §6.3).
 *
 * Rules enforced here, so no research surface has to remember them:
 * - No arithmetic means of prices. Median and P25–P75 only.
 * - Mixed currencies are converted with an FX table or excluded (and counted).
 * - Outliers are trimmed with Tukey fences (Q1 − 1.5·IQR, Q3 + 3·IQR) before min/max.
 * - Unit prices outside plausibility bounds are excluded; an unusual median is flagged.
 * - Minimum sample: n < 5 → "not enough data"; n < 20 → range only ("small sample").
 *
 * Pure module: safe in API routes, stores and components.
 */

export const MIN_SAMPLE = 5;
export const SMALL_SAMPLE = 20;

/** Plausibility bounds for unit prices, expressed in USD (§6.3 #3). */
export const USD_BOUNDS = {
  physical: { min: 0.5, max: 2000, flagMedianAbove: 500 },
  digital: { min: 0.2, max: 2000, flagMedianAbove: 500 },
} as const;

export type ProductKind = keyof typeof USD_BOUNDS;

export interface PriceBounds {
  min: number;
  max: number;
  /** A median above this is shown as "unusual price range" instead of a number. */
  flagMedianAbove?: number;
}

export interface PricePoint {
  amount: number | string | null | undefined;
  currency?: string | null;
}

/**
 * FX table: multiplier that converts 1 unit of the key currency into the
 * target currency. The target currency itself is implicitly 1.
 */
export type FxTable = Record<string, number>;

export type SampleQuality = 'ok' | 'small' | 'insufficient' | 'implausible';

export interface RobustStats {
  /** Values kept after trimming. */
  n: number;
  /** Values received (finite, > 0). */
  total: number;
  /** Values removed by the Tukey fences. */
  trimmed: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

export interface PriceSummary extends RobustStats {
  currency: string;
  /** Items passed in, before any exclusion. */
  sampled: number;
  excludedNoFx: number;
  excludedImplausible: number;
  quality: SampleQuality;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function normCurrency(c: string | null | undefined): string {
  const u = String(c || '').trim().toUpperCase();
  return u === 'TL' ? 'TRY' : u;
}

function toNumber(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** Linear-interpolated quantile (same definition as numpy's default) on a sorted array. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return quantile(s, 0.5);
}

/**
 * Tukey trim with asymmetric fences (prices are right-skewed):
 * keep Q1 − 1.5·IQR ≤ v ≤ Q3 + 3·IQR. Samples under MIN_SAMPLE are not trimmed.
 */
export function tukeyTrim(values: number[]): { kept: number[]; trimmed: number } {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length < MIN_SAMPLE) return { kept: s, trimmed: 0 };
  const q1 = quantile(s, 0.25)!;
  const q3 = quantile(s, 0.75)!;
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 3 * iqr;
  const kept = s.filter((v) => v >= lo && v <= hi);
  return { kept, trimmed: s.length - kept.length };
}

/** Median, P25/P75, trimmed min/max and counts. Non-finite and ≤ 0 values are ignored. */
export function robustStats(values: number[], opts: { trim?: boolean } = {}): RobustStats {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  const { kept, trimmed } = opts.trim === false
    ? { kept: [...clean].sort((a, b) => a - b), trimmed: 0 }
    : tukeyTrim(clean);
  const r = (v: number | null) => (v == null ? null : round2(v));
  return {
    n: kept.length,
    total: clean.length,
    trimmed,
    median: r(quantile(kept, 0.5)),
    p25: r(quantile(kept, 0.25)),
    p75: r(quantile(kept, 0.75)),
    min: kept.length ? r(kept[0]) : null,
    max: kept.length ? r(kept[kept.length - 1]) : null,
  };
}

/**
 * Convert prices to one currency. Items whose currency is unknown to the FX
 * table are excluded and counted, never summed in their own currency.
 * An item without a currency is assumed to already be in the target currency.
 */
export function normalizePrices(
  items: PricePoint[],
  targetCurrency: string,
  fx: FxTable = {},
): { values: number[]; excludedNoFx: number } {
  const target = normCurrency(targetCurrency);
  const table: FxTable = {};
  for (const [k, v] of Object.entries(fx)) table[normCurrency(k)] = v;
  const values: number[] = [];
  let excludedNoFx = 0;
  for (const it of items) {
    const amount = toNumber(it?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const cur = normCurrency(it.currency) || target;
    if (cur === target) { values.push(amount); continue; }
    const rate = table[cur];
    if (rate && Number.isFinite(rate) && rate > 0) values.push(amount * rate);
    else excludedNoFx++;
  }
  return { values, excludedNoFx };
}

/**
 * Plausibility bounds for a display currency. USD bounds apply as-is to USD;
 * for any other currency they are converted with `usdToTarget` when given,
 * otherwise no bounds are applied (we never guess an FX rate).
 */
export function boundsFor(currency: string, kind: ProductKind = 'physical', usdToTarget?: number | null): PriceBounds | null {
  const b = USD_BOUNDS[kind];
  if (normCurrency(currency) === 'USD') return { ...b };
  if (usdToTarget && Number.isFinite(usdToTarget) && usdToTarget > 0) {
    return { min: b.min * usdToTarget, max: b.max * usdToTarget, flagMedianAbove: b.flagMedianAbove * usdToTarget };
  }
  return null;
}

/** True when a unit price lies inside the bounds (or no bounds are known). */
export function isPlausible(price: number, bounds: PriceBounds | null): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!bounds) return true;
  return price >= bounds.min && price <= bounds.max;
}

export function sampleQuality(n: number): Exclude<SampleQuality, 'implausible'> {
  if (n < MIN_SAMPLE) return 'insufficient';
  if (n < SMALL_SAMPLE) return 'small';
  return 'ok';
}

/**
 * The one function research endpoints call for any price aggregate:
 * FX-normalize → plausibility filter → Tukey trim → median/P25/P75 + quality.
 */
export function summarizePrices(
  items: PricePoint[],
  opts: { currency: string; fx?: FxTable; kind?: ProductKind; bounds?: PriceBounds | null; usdToTarget?: number | null },
): PriceSummary {
  const currency = normCurrency(opts.currency) || 'USD';
  const { values, excludedNoFx } = normalizePrices(items, currency, opts.fx);
  const bounds = opts.bounds !== undefined ? opts.bounds : boundsFor(currency, opts.kind, opts.usdToTarget);
  const plausible = values.filter((v) => isPlausible(v, bounds));
  const stats = robustStats(plausible);
  let quality: SampleQuality = sampleQuality(stats.n);
  if (quality !== 'insufficient' && bounds?.flagMedianAbove != null && stats.median != null && stats.median > bounds.flagMedianAbove) {
    quality = 'implausible';
  }
  return {
    ...stats,
    currency,
    sampled: items.length,
    excludedNoFx,
    excludedImplausible: values.length - plausible.length,
    quality,
  };
}

/** Convenience: summary of plain numbers already in `currency`. */
export function summarizeAmounts(amounts: number[], currency: string, opts: { kind?: ProductKind; bounds?: PriceBounds | null } = {}): PriceSummary {
  return summarizePrices(amounts.map((amount) => ({ amount, currency })), { currency, ...opts });
}

/** Median of a small per-entity group (shop, brand, seller); null when empty. */
export function groupMedian(values: number[]): number | null {
  const m = median(values.filter((v) => Number.isFinite(v) && v > 0));
  return m == null ? null : round2(m);
}

/**
 * Build an FX table (currency → multiplier into `target`) from a converter
 * such as `convertCurrency` in lib/finance/fx.ts. Currencies the converter
 * cannot price are left out, so `normalizePrices` excludes them.
 */
export async function buildFxTable(
  currencies: Iterable<string | null | undefined>,
  target: string,
  convert: (amount: number, from: string, to: string) => Promise<number | null>,
): Promise<FxTable> {
  const t = normCurrency(target);
  const unique = Array.from(new Set(Array.from(currencies, (c) => normCurrency(c)).filter((c) => c && c !== t)));
  const table: FxTable = {};
  await Promise.all(unique.map(async (c) => {
    try {
      const r = await convert(1, c, t);
      if (r != null && Number.isFinite(r) && r > 0) table[c] = r;
    } catch { /* excluded */ }
  }));
  return table;
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function formatMoney(value: number | null | undefined, currency: string, locale = 'en-US'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: normCurrency(currency) || 'USD', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

export interface PriceDisplay {
  /** Headline value: the median, or "—" when it must not be shown. */
  value: string;
  /** "P25–P75" band, or null when not available. */
  band: string | null;
  n: number;
  quality: SampleQuality;
  /** Number of items excluded (no FX / implausible / trimmed). */
  excluded: number;
}

/**
 * Turn a summary into display strings. Callers add the localized reason via
 * i18n keys `research.stats.*` keyed on `quality`.
 * - insufficient: value "—", no band
 * - small: value "—", band only (range only, §6.3 #4)
 * - implausible: value "—", no band
 * - ok: median + band
 */
export function priceDisplay(s: Partial<PriceSummary> | null | undefined, locale = 'en-US', currencyOverride?: string): PriceDisplay {
  const currency = currencyOverride || s?.currency || 'USD';
  const n = s?.n ?? 0;
  const quality: SampleQuality = (s?.quality as SampleQuality) || sampleQuality(n);
  const excluded = (s?.excludedNoFx ?? 0) + (s?.excludedImplausible ?? 0) + (s?.trimmed ?? 0);
  const band = s?.p25 != null && s?.p75 != null
    ? `${formatMoney(s.p25, currency, locale)}–${formatMoney(s.p75, currency, locale)}`
    : null;
  if (!s || quality === 'insufficient' || quality === 'implausible' || s.median == null) {
    return { value: '—', band: null, n, quality, excluded };
  }
  if (quality === 'small') return { value: '—', band, n, quality, excluded };
  return { value: formatMoney(s.median, currency, locale), band, n, quality, excluded };
}

// ─── Text ────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™',
  deg: '°', times: '×', middot: '·', bull: '•', euro: '€', pound: '£', yen: '¥', cent: '¢',
  frac12: '½', frac14: '¼', frac34: '¾', eacute: 'é', egrave: 'è', uuml: 'ü', ouml: 'ö', ccedil: 'ç',
};

/**
 * Decode HTML entities found in marketplace text (Etsy/eBay titles return
 * `&#39;`, `&quot;`, `&amp;amp;`). Decodes up to twice to handle double-escaping.
 * Display-only: never write the result back as HTML.
 * TODO(M1): replace with lib/text/decodeEntities.ts once it lands.
 */
export function decodeEntities(input: string | null | undefined): string {
  if (input == null) return '';
  let s = String(input);
  for (let pass = 0; pass < 2 && s.includes('&'); pass++) {
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ent: string) => {
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      const v = NAMED_ENTITIES[ent.toLowerCase()];
      return v ?? m;
    });
  }
  return s;
}

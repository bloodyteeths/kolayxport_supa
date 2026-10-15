// lib/listingScore/trendyol.ts: Trendyol product health (DESIGN_SYSTEM §3.10).
// Port of the 10 factors of the legacy `calculateTrendyolHealth` (pages/app/trendyol-urunler.tsx L181).
// The point weights are kept as impacts (sum 100); the legacy partial points become pass / warn / fail.
// No letter grades: the score is the 0–100 number (DS §3.10).
import type { Check, ScoreResult } from './types';
import { finalizeScore } from './types';
import { FIX, NA, check, jsonArrayLength, naCheck, toNumber } from './shared';

export interface TrendyolScoreInput {
  title?: string | null;
  brandName?: string | null;
  categoryName?: string | null;
  imageCount?: number | null;
  /** Description as text/HTML. undefined → `na`; null/'' counts as empty. */
  description?: string | null;
  /** Number of filled category attributes. null/undefined → `na`. */
  attributeCount?: number | null;
  listPrice?: number | null;
  salePrice?: number | null;
  quantity?: number | null;
  approved?: boolean | null;
  rejected?: boolean | null;
  blacklisted?: boolean | null;
  dimensionalWeight?: number | null;
}

export const TRENDYOL_IMPACT = {
  title_length: 15,
  title_brand: 5,
  title_category: 5,
  photos_count: 20,
  description: 15,
  attributes: 15,
  price_sanity: 10,
  stock: 5,
  not_rejected: 5,
  dimensional_weight: 5,
} as const;

export type TrendyolCheckId = keyof typeof TRENDYOL_IMPACT;

const K = 'listingScore.trendyol';
export const TRENDYOL_TITLE_MIN = 80;
export const TRENDYOL_TITLE_MAX = 150;

export function trendyolChecks(input: TrendyolScoreInput): Check[] {
  const I = TRENDYOL_IMPACT;
  const checks: Check[] = [];
  const title = typeof input.title === 'string' ? input.title.trim() : null;
  const titleLower = (title ?? '').toLocaleLowerCase('tr');

  // Title length: legacy 80–150 → 15, ≥ 60 → 10, ≥ 40 → 5, else 0.
  if (title === null) {
    checks.push(naCheck('title_length', I.title_length, `${K}.titleLength.ok`, `${NA}.noData`, { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  } else {
    const len = title.length;
    const status = len >= TRENDYOL_TITLE_MIN && len <= TRENDYOL_TITLE_MAX ? 'pass' : len >= 40 ? 'warn' : 'fail';
    checks.push(check('title_length', I.title_length, status,
      len > TRENDYOL_TITLE_MAX ? `${K}.titleLength.long` : status === 'pass' ? `${K}.titleLength.ok` : `${K}.titleLength.short`,
      { length: len, min: TRENDYOL_TITLE_MIN, max: TRENDYOL_TITLE_MAX },
      { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  }

  const brand = typeof input.brandName === 'string' ? input.brandName.trim() : '';
  if (title === null || !brand) {
    checks.push(naCheck('title_brand', I.title_brand, `${K}.titleBrand.pass`, title === null ? `${NA}.noData` : `${NA}.noBrand`, { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  } else {
    const has = titleLower.includes(brand.toLocaleLowerCase('tr'));
    checks.push(check('title_brand', I.title_brand, has ? 'pass' : 'fail',
      has ? `${K}.titleBrand.pass` : `${K}.titleBrand.missing`, { brand },
      { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  }

  const catWords = typeof input.categoryName === 'string'
    ? input.categoryName.toLocaleLowerCase('tr').split(/\s+/).filter((w) => w.length > 2)
    : [];
  if (title === null || catWords.length === 0) {
    checks.push(naCheck('title_category', I.title_category, `${K}.titleCategory.pass`, title === null ? `${NA}.noData` : `${NA}.noCategory`, { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  } else {
    const has = catWords.some((w) => titleLower.includes(w));
    checks.push(check('title_category', I.title_category, has ? 'pass' : 'fail',
      has ? `${K}.titleCategory.pass` : `${K}.titleCategory.missing`, { category: input.categoryName ?? '' },
      { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  }

  // Photos: legacy min(count × 4, 20) → ≥ 5 pass, 3–4 warn, < 3 fail.
  if (typeof input.imageCount !== 'number') {
    checks.push(naCheck('photos_count', I.photos_count, `${K}.photosCount.pass`, `${NA}.noData`, { label: `${FIX}.addPhotos`, field: 'photos' }));
  } else {
    const n = input.imageCount;
    const status = n >= 5 ? 'pass' : n >= 3 ? 'warn' : 'fail';
    checks.push(check('photos_count', I.photos_count, status,
      status === 'pass' ? `${K}.photosCount.pass` : `${K}.photosCount.low`,
      { count: n, missing: Math.max(0, 5 - n) },
      { label: `${FIX}.addPhotos`, field: 'photos' }));
  }

  // Description: legacy ≥ 300 chars 15, ≥ 200 10, ≥ 100 5.
  if (input.description === undefined) {
    checks.push(naCheck('description', I.description, `${K}.description.pass`, `${NA}.noData`, { label: `${FIX}.writeDescription`, action: 'ai_description' }));
  } else {
    const len = (input.description ?? '').length;
    const status = len >= 300 ? 'pass' : len >= 100 ? 'warn' : 'fail';
    checks.push(check('description', I.description, status,
      status === 'pass' ? `${K}.description.pass` : `${K}.description.short`,
      { length: len, min: 300 },
      { label: `${FIX}.writeDescription`, action: 'ai_description' }));
  }

  // Attributes: legacy ≥ 5 → 15, ≥ 3 → 12, ≥ 1 → 8.
  if (typeof input.attributeCount !== 'number') {
    checks.push(naCheck('attributes', I.attributes, `${K}.attributes.pass`, `${NA}.noData`, { label: `${FIX}.fillDetails`, field: 'attributes' }));
  } else {
    const n = input.attributeCount;
    const status = n >= 5 ? 'pass' : n >= 1 ? 'warn' : 'fail';
    checks.push(check('attributes', I.attributes, status,
      status === 'pass' ? `${K}.attributes.pass` : `${K}.attributes.low`,
      { count: n, min: 5 },
      { label: `${FIX}.fillDetails`, field: 'attributes' }));
  }

  // Price: legacy list > sale > 0 → 10 (discount shown), list = sale → 5, else 0.
  const lp = typeof input.listPrice === 'number' ? input.listPrice : null;
  const sp = typeof input.salePrice === 'number' ? input.salePrice : null;
  if (lp === null && sp === null) {
    checks.push(naCheck('price_sanity', I.price_sanity, `${K}.priceSanity.pass`, `${NA}.noData`, { label: `${FIX}.editPrice`, field: 'price' }));
  } else {
    const s = sp ?? 0;
    const l = lp ?? 0;
    const status = s > 0 && l > s ? 'pass' : s > 0 && l === s ? 'warn' : 'fail';
    checks.push(check('price_sanity', I.price_sanity, status,
      status === 'pass' ? `${K}.priceSanity.pass` : status === 'warn' ? `${K}.priceSanity.noDiscount` : `${K}.priceSanity.invalid`,
      undefined,
      { label: `${FIX}.editPrice`, field: 'price' }));
  }

  if (typeof input.quantity !== 'number') {
    checks.push(naCheck('stock', I.stock, `${K}.stock.pass`, `${NA}.noData`, { label: `${FIX}.addStock`, field: 'quantity' }));
  } else {
    const ok = input.quantity > 0;
    checks.push(check('stock', I.stock, ok ? 'pass' : 'fail',
      ok ? `${K}.stock.pass` : `${K}.stock.out`, undefined,
      { label: `${FIX}.addStock`, field: 'quantity' }));
  }

  if (typeof input.approved !== 'boolean') {
    checks.push(naCheck('not_rejected', I.not_rejected, `${K}.approval.pass`, `${NA}.noData`, { label: `${FIX}.seeRejectReasons`, field: 'status' }));
  } else {
    const refused = input.rejected === true || input.blacklisted === true;
    const status = !refused && input.approved ? 'pass' : 'fail';
    checks.push(check('not_rejected', I.not_rejected, status,
      refused ? `${K}.approval.rejected` : input.approved ? `${K}.approval.pass` : `${K}.approval.pending`,
      undefined,
      { label: `${FIX}.seeRejectReasons`, field: 'status' }));
  }

  if (input.dimensionalWeight === undefined) {
    checks.push(naCheck('dimensional_weight', I.dimensional_weight, `${K}.dimWeight.pass`, `${NA}.noData`, { label: `${FIX}.setPackage`, field: 'dimensionalWeight' }));
  } else {
    const ok = typeof input.dimensionalWeight === 'number' && input.dimensionalWeight > 0;
    checks.push(check('dimensional_weight', I.dimensional_weight, ok ? 'pass' : 'fail',
      ok ? `${K}.dimWeight.pass` : `${K}.dimWeight.missing`, undefined,
      { label: `${FIX}.setPackage`, field: 'dimensionalWeight' }));
  }

  return checks;
}

export function scoreTrendyolProduct(input: TrendyolScoreInput): ScoreResult {
  return finalizeScore(trendyolChecks(input));
}

/** The `TrendyolProduct` cache columns the scorer reads. */
export interface TrendyolCacheRow {
  title: string;
  brandName: string | null;
  categoryName: string | null;
  description: string | null;
  images: unknown;
  imageCount: number;
  attributes: unknown;
  listPrice: unknown;
  salePrice: unknown;
  quantity: number;
  approved: boolean;
  rejected: boolean;
  blacklisted: boolean;
  dimensionalWeight: number | null;
}

/** Cache row → scorer input (same inputs the legacy calculator read from the API row). */
export function trendyolInputFromCache(row: TrendyolCacheRow): TrendyolScoreInput {
  const imgs = jsonArrayLength(row.images);
  return {
    title: row.title,
    brandName: row.brandName,
    categoryName: row.categoryName,
    description: row.description ?? '',
    imageCount: Math.max(row.imageCount || 0, imgs ?? 0),
    attributeCount: jsonArrayLength(row.attributes) ?? 0,
    listPrice: toNumber(row.listPrice),
    salePrice: toNumber(row.salePrice),
    quantity: row.quantity,
    approved: row.approved,
    rejected: row.rejected,
    blacklisted: row.blacklisted,
    dimensionalWeight: row.dimensionalWeight,
  };
}

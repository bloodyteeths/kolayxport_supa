// lib/listingScore/ebay.ts: eBay listing health (DESIGN_SYSTEM §3.10, listing-editor §4.4 "eBay checks").
// Pure function over a listing view (cache row or draft-merged view). Impacts sum to 100.
// A check whose input is missing (undefined/null) is `na` and leaves the denominator.
import type { Check, ScoreResult } from './types';
import { finalizeScore } from './types';
import { FIX, NA, check, naCheck, toNumber, wordCount } from './shared';

export interface EbayScoreInput {
  title?: string | null;
  description?: string | null;
  /** Photo count. Omit when the source has no image data → `na`. */
  imageCount?: number | null;
  /** Item specifics as cached (`EbayListing.aspects`): name → values. */
  aspects?: Record<string, string[] | string> | null;
  /** Required aspects of the category; null/undefined → `na` (category metadata not loaded). */
  aspectsRequired?: { required: number; filled: number } | null;
  /** Recommended aspects of the category; null/undefined → `na`. */
  aspectsRecommended?: { recommended: number; filled: number } | null;
  /** eBay ConditionEnum (`NEW`, `USED_EXCELLENT`, …). */
  condition?: string | null;
  conditionDescription?: string | null;
  /** `isLeaf` unknown (undefined) counts as leaf: the cache does not store the tree. */
  category?: { id: string | null; isLeaf?: boolean | null } | null;
  policies?: { fulfillment: boolean; payment: boolean; return: boolean } | null;
  package?: { hasWeight: boolean; hasDimensions: boolean } | null;
  price?: number | null;
  market?: { p25: number; p75: number } | null;
}

export const EBAY_IMPACT = {
  photos_count: 14,
  title_length: 12,
  title_keywords: 6,
  aspects_required: 16,
  aspects_recommended: 10,
  condition: 8,
  description: 10,
  category: 6,
  policies: 8,
  package: 6,
  price_market: 4,
} as const;

export type EbayCheckId = keyof typeof EBAY_IMPACT;

const K = 'listingScore.ebay';
export const EBAY_TITLE_MAX = 80;
export const EBAY_TITLE_MIN = 60;
const PHOTOS_GOOD = 8;
const PHOTOS_MIN = 4;
const DESC_WORDS = 100;
const DESC_WORDS_WARN = 40;
const KEYWORD_ASPECTS = ['brand', 'type'];
const EMPTY_ASPECT_VALUES = new Set(['', 'unbranded', 'does not apply', 'n/a', 'na', 'none']);

function aspectValues(aspects: Record<string, string[] | string>, name: string): string[] {
  const key = Object.keys(aspects).find((k) => k.trim().toLowerCase() === name);
  if (!key) return [];
  const raw = aspects[key];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => !EMPTY_ASPECT_VALUES.has(v.toLowerCase()));
}

/** Brand/type words from the aspects that the title should carry (first value of each). */
export function ebayTitleKeywords(aspects: Record<string, string[] | string>): string[] {
  const out: string[] = [];
  for (const name of KEYWORD_ASPECTS) {
    const v = aspectValues(aspects, name)[0];
    if (v) out.push(v);
  }
  return out;
}

/** eBay numeric conditionIds → ConditionEnum (legacy Browse imports may store the id). */
const CONDITION_ID_ENUM: Record<string, string> = {
  '1000': 'NEW',
  '1500': 'NEW_OTHER',
  '1750': 'NEW_WITH_DEFECTS',
  '2000': 'CERTIFIED_REFURBISHED',
  '2010': 'EXCELLENT_REFURBISHED',
  '2020': 'VERY_GOOD_REFURBISHED',
  '2030': 'GOOD_REFURBISHED',
  '2500': 'SELLER_REFURBISHED',
  '2750': 'LIKE_NEW',
  '2990': 'PRE_OWNED_EXCELLENT',
  '3000': 'USED_EXCELLENT',
  '3010': 'PRE_OWNED_FAIR',
  '4000': 'USED_VERY_GOOD',
  '5000': 'USED_GOOD',
  '6000': 'USED_ACCEPTABLE',
  '7000': 'FOR_PARTS_OR_NOT_WORKING',
};

/**
 * ConditionEnum, numeric conditionId or display text ('Like New', 'New other (see details)')
 * → an upper-snake ConditionEnum-like token ('' when empty).
 */
export function normalizeEbayCondition(condition: string): string {
  const raw = (condition ?? '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) {
    const known = CONDITION_ID_ENUM[raw];
    if (known) return known;
    const n = Number(raw);
    if (n < 2000) return 'NEW_OTHER';
    if (n < 2750) return 'SELLER_REFURBISHED';
    if (n < 2990) return 'LIKE_NEW';
    return 'USED';
  }
  return raw
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isUsedCondition(condition: string): boolean {
  const c = normalizeEbayCondition(condition);
  if (c === '') return false;
  if (c.startsWith('NEW') || c.startsWith('BRAND_NEW') || c === 'LIKE_NEW' || c === 'OPEN_BOX') return false;
  return !c.includes('REFURBISHED');
}

export function ebayChecks(input: EbayScoreInput): Check[] {
  const checks: Check[] = [];
  const I = EBAY_IMPACT;
  const title = typeof input.title === 'string' ? input.title.trim() : null;

  // Photos
  if (typeof input.imageCount !== 'number') {
    checks.push(naCheck('photos_count', I.photos_count, `${K}.photosCount.pass`, `${NA}.noData`, { label: `${FIX}.addPhotos`, field: 'photos' }));
  } else {
    const n = input.imageCount;
    const status = n >= PHOTOS_GOOD ? 'pass' : n >= PHOTOS_MIN ? 'warn' : 'fail';
    checks.push(check('photos_count', I.photos_count, status,
      status === 'pass' ? `${K}.photosCount.pass` : `${K}.photosCount.low`,
      { count: n, missing: Math.max(0, PHOTOS_GOOD - n) },
      { label: `${FIX}.addPhotos`, field: 'photos' }));
  }

  // Title
  if (title === null) {
    checks.push(naCheck('title_length', I.title_length, `${K}.titleLength.ok`, `${NA}.noData`, { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  } else {
    const len = title.length;
    const status = len > EBAY_TITLE_MAX ? 'fail' : len >= EBAY_TITLE_MIN ? 'pass' : len >= 40 ? 'warn' : 'fail';
    checks.push(check('title_length', I.title_length, status,
      len > EBAY_TITLE_MAX ? `${K}.titleLength.long` : len >= EBAY_TITLE_MIN ? `${K}.titleLength.ok` : `${K}.titleLength.short`,
      { length: len, max: EBAY_TITLE_MAX, min: EBAY_TITLE_MIN },
      { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  }

  const keywords = input.aspects && typeof input.aspects === 'object' ? ebayTitleKeywords(input.aspects) : null;
  if (title === null || !title) {
    checks.push(naCheck('title_keywords', I.title_keywords, `${K}.titleKeywords.pass`, `${NA}.noData`, { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  } else if (!keywords || keywords.length === 0) {
    checks.push(naCheck('title_keywords', I.title_keywords, `${K}.titleKeywords.pass`, `${NA}.noAspects`, { label: `${FIX}.fillDetails`, field: 'aspects' }));
  } else {
    const lower = title.toLowerCase();
    const missing = keywords.filter((k) => !lower.includes(k.toLowerCase()));
    const status = missing.length === 0 ? 'pass' : missing.length < keywords.length ? 'warn' : 'fail';
    checks.push(check('title_keywords', I.title_keywords, status,
      status === 'pass' ? `${K}.titleKeywords.pass` : `${K}.titleKeywords.missing`,
      { count: missing.length, words: missing.join(', ') },
      { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
  }

  // Item specifics
  if (!input.aspectsRequired) {
    checks.push(naCheck('aspects_required', I.aspects_required, `${K}.aspectsRequired.pass`, `${NA}.noTaxonomy`, { label: `${FIX}.fillDetails`, field: 'aspects' }));
  } else {
    const missing = Math.max(0, input.aspectsRequired.required - input.aspectsRequired.filled);
    checks.push(check('aspects_required', I.aspects_required, missing === 0 ? 'pass' : 'fail',
      missing === 0 ? `${K}.aspectsRequired.pass` : `${K}.aspectsRequired.missing`,
      { count: missing },
      { label: `${FIX}.fillDetails`, field: 'aspects' }));
  }

  if (!input.aspectsRecommended || input.aspectsRecommended.recommended <= 0) {
    checks.push(naCheck('aspects_recommended', I.aspects_recommended, `${K}.aspectsRecommended.pass`, `${NA}.noTaxonomy`, { label: `${FIX}.fillDetails`, field: 'aspects' }));
  } else {
    const { recommended, filled } = input.aspectsRecommended;
    const ratio = Math.min(1, filled / recommended);
    const status = ratio >= 0.7 ? 'pass' : ratio >= 0.4 ? 'warn' : 'fail';
    checks.push(check('aspects_recommended', I.aspects_recommended, status,
      status === 'pass' ? `${K}.aspectsRecommended.pass` : `${K}.aspectsRecommended.low`,
      { filled: Math.min(filled, recommended), total: recommended },
      { label: `${FIX}.fillDetails`, field: 'aspects' }));
  }

  // Condition
  if (input.condition === undefined) {
    checks.push(naCheck('condition', I.condition, `${K}.condition.pass`, `${NA}.noData`, { label: `${FIX}.setCondition`, field: 'condition' }));
  } else {
    const c = (input.condition ?? '').trim();
    const used = c !== '' && isUsedCondition(c);
    const hasNote = typeof input.conditionDescription === 'string' && input.conditionDescription.trim() !== '';
    const status = c === '' ? 'fail' : used && !hasNote ? 'warn' : 'pass';
    checks.push(check('condition', I.condition, status,
      c === '' ? `${K}.condition.missing` : status === 'warn' ? `${K}.condition.noNote` : `${K}.condition.pass`,
      undefined,
      { label: `${FIX}.setCondition`, field: status === 'warn' ? 'conditionDescription' : 'condition' }));
  }

  // Description
  if (typeof input.description !== 'string') {
    checks.push(naCheck('description', I.description, `${K}.description.pass`, `${NA}.noData`, { label: `${FIX}.writeDescription`, action: 'ai_description' }));
  } else {
    const words = wordCount(input.description);
    const status = words >= DESC_WORDS ? 'pass' : words >= DESC_WORDS_WARN ? 'warn' : 'fail';
    checks.push(check('description', I.description, status,
      status === 'pass' ? `${K}.description.pass` : `${K}.description.short`,
      { words, min: DESC_WORDS },
      { label: `${FIX}.writeDescription`, action: 'ai_description' }));
  }

  // Category
  if (input.category === undefined) {
    checks.push(naCheck('category', I.category, `${K}.category.pass`, `${NA}.noData`, { label: `${FIX}.pickCategory`, field: 'category' }));
  } else {
    const id = input.category?.id ? String(input.category.id).trim() : '';
    const status = !id ? 'fail' : input.category?.isLeaf === false ? 'fail' : 'pass';
    checks.push(check('category', I.category, status,
      !id ? `${K}.category.missing` : status === 'fail' ? `${K}.category.notLeaf` : `${K}.category.pass`,
      undefined,
      { label: `${FIX}.pickCategory`, field: 'category' }));
  }

  // Policies
  if (!input.policies) {
    checks.push(naCheck('policies', I.policies, `${K}.policies.pass`, `${NA}.noData`, { label: `${FIX}.setPolicies`, field: 'policies' }));
  } else {
    const p = input.policies;
    const set = Number(p.fulfillment) + Number(p.payment) + Number(p.return);
    const status = set === 3 ? 'pass' : set > 0 ? 'warn' : 'fail';
    checks.push(check('policies', I.policies, status,
      status === 'pass' ? `${K}.policies.pass` : `${K}.policies.missing`,
      { count: 3 - set },
      { label: `${FIX}.setPolicies`, field: 'policies' }));
  }

  // Package
  if (!input.package) {
    checks.push(naCheck('package', I.package, `${K}.package.pass`, `${NA}.noData`, { label: `${FIX}.setPackage`, field: 'package' }));
  } else {
    const set = Number(input.package.hasWeight) + Number(input.package.hasDimensions);
    const status = set === 2 ? 'pass' : set === 1 ? 'warn' : 'fail';
    checks.push(check('package', I.package, status,
      status === 'pass' ? `${K}.package.pass` : !input.package.hasWeight ? `${K}.package.noWeight` : `${K}.package.noDimensions`,
      undefined,
      { label: `${FIX}.setPackage`, field: 'package' }));
  }

  // Market price
  if (!input.market || typeof input.price !== 'number' || !Number.isFinite(input.price)) {
    checks.push(naCheck('price_market', I.price_market, `${K}.priceMarket.pass`, `${NA}.noResearch`, { label: `${FIX}.checkPrice`, action: 'check_price' }));
  } else {
    const inside = input.price >= input.market.p25 && input.price <= input.market.p75;
    checks.push(check('price_market', I.price_market, inside ? 'pass' : 'warn',
      inside ? `${K}.priceMarket.pass` : `${K}.priceMarket.outside`,
      undefined,
      { label: `${FIX}.checkPrice`, action: 'check_price' }));
  }

  return checks;
}

export function scoreEbayListing(input: EbayScoreInput): ScoreResult {
  return finalizeScore(ebayChecks(input));
}

/** The `EbayListing` cache columns the scorer reads. */
export interface EbayCacheRow {
  title: string;
  description: string;
  imageCount: number;
  imageUrls: string[];
  aspects: unknown;
  condition: string;
  conditionDescription: string | null;
  categoryId: string | null;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  weightValue: number | null;
  lengthValue: number | null;
  widthValue: number | null;
  heightValue: number | null;
  priceValue: string;
  /** Legacy (Trading API) listings: policies and package are not cached → `na`. */
  isLegacy: boolean;
}

function positive(v: number | null): boolean {
  return typeof v === 'number' && v > 0;
}

/**
 * Cache row → scorer input. Required/recommended aspects need category metadata the cache does not keep,
 * so they stay `na`; the category's leaf flag is unknown (counts as leaf). Legacy listings keep policies and
 * package `na` because the legacy import does not read them.
 */
export function ebayInputFromCache(row: EbayCacheRow): EbayScoreInput {
  const aspects = row.aspects && typeof row.aspects === 'object' && !Array.isArray(row.aspects)
    ? (row.aspects as Record<string, string[] | string>)
    : {};
  return {
    title: row.title,
    description: row.description,
    imageCount: Math.max(row.imageCount || 0, Array.isArray(row.imageUrls) ? row.imageUrls.length : 0),
    aspects,
    condition: row.condition,
    conditionDescription: row.conditionDescription,
    category: { id: row.categoryId },
    policies: row.isLegacy ? null : {
      fulfillment: !!row.fulfillmentPolicyId,
      payment: !!row.paymentPolicyId,
      return: !!row.returnPolicyId,
    },
    package: row.isLegacy ? null : {
      hasWeight: positive(row.weightValue),
      hasDimensions: positive(row.lengthValue) && positive(row.widthValue) && positive(row.heightValue),
    },
    price: toNumber(row.priceValue),
  };
}

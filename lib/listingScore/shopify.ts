// lib/listingScore/shopify.ts: Shopify product health (DESIGN_SYSTEM §3.10). New in M5 (Shopify had no score).
// Checks: title length, description, photos (≥ 3), SEO title, SEO description, tags. Impacts sum to 100.
// Shopify falls back to the product title / description when the SEO fields are empty, so an empty SEO field
// is a `warn`, never a `fail`.
import type { Check, ScoreResult } from './types';
import { finalizeScore } from './types';
import { FIX, NA, check, naCheck, textLength } from './shared';

export interface ShopifyScoreInput {
  title?: string | null;
  /** body_html. undefined → `na`; null/'' counts as empty. */
  description?: string | null;
  imageCount?: number | null;
  /** undefined → `na` (not known); null/'' → empty (Shopify uses the product title). */
  seoTitle?: string | null;
  /** undefined → `na`; null/'' → empty (Shopify uses the description excerpt). */
  seoDescription?: string | null;
  tags?: string[] | null;
}

export const SHOPIFY_IMPACT = {
  title_length: 15,
  description: 20,
  photos_count: 25,
  seo_title: 10,
  seo_description: 15,
  tags_count: 15,
} as const;

export type ShopifyCheckId = keyof typeof SHOPIFY_IMPACT;

const K = 'listingScore.shopify';
export const SHOPIFY_TITLE_MIN = 20;
export const SHOPIFY_TITLE_MAX = 70;
const DESC_GOOD = 300;
const DESC_MIN = 100;
const PHOTOS_GOOD = 3;
const SEO_TITLE_MAX = 70;
const SEO_DESC_MIN = 50;
const SEO_DESC_MAX = 160;
const TAGS_GOOD = 3;

export function shopifyChecks(input: ShopifyScoreInput): Check[] {
  const I = SHOPIFY_IMPACT;
  const checks: Check[] = [];

  const title = typeof input.title === 'string' ? input.title.trim() : null;
  if (title === null) {
    checks.push(naCheck('title_length', I.title_length, `${K}.titleLength.ok`, `${NA}.noData`, { label: `${FIX}.editTitle`, field: 'title' }));
  } else {
    const len = title.length;
    const status = len > SHOPIFY_TITLE_MAX ? 'warn' : len >= SHOPIFY_TITLE_MIN ? 'pass' : len >= 10 ? 'warn' : 'fail';
    checks.push(check('title_length', I.title_length, status,
      len > SHOPIFY_TITLE_MAX ? `${K}.titleLength.long` : status === 'pass' ? `${K}.titleLength.ok` : `${K}.titleLength.short`,
      { length: len, min: SHOPIFY_TITLE_MIN, max: SHOPIFY_TITLE_MAX },
      { label: `${FIX}.editTitle`, field: 'title' }));
  }

  if (input.description === undefined) {
    checks.push(naCheck('description', I.description, `${K}.description.pass`, `${NA}.noData`, { label: `${FIX}.editDescription`, field: 'description' }));
  } else {
    const len = textLength(input.description ?? '');
    const status = len >= DESC_GOOD ? 'pass' : len >= DESC_MIN ? 'warn' : 'fail';
    checks.push(check('description', I.description, status,
      status === 'pass' ? `${K}.description.pass` : `${K}.description.short`,
      { length: len, min: DESC_GOOD },
      { label: `${FIX}.editDescription`, field: 'description' }));
  }

  if (typeof input.imageCount !== 'number') {
    checks.push(naCheck('photos_count', I.photos_count, `${K}.photosCount.pass`, `${NA}.noData`, { label: `${FIX}.addPhotos`, field: 'photos' }));
  } else {
    const n = input.imageCount;
    const status = n >= PHOTOS_GOOD ? 'pass' : n >= 1 ? 'warn' : 'fail';
    checks.push(check('photos_count', I.photos_count, status,
      status === 'pass' ? `${K}.photosCount.pass` : `${K}.photosCount.low`,
      { count: n, missing: Math.max(0, PHOTOS_GOOD - n) },
      { label: `${FIX}.addPhotos`, field: 'photos' }));
  }

  if (input.seoTitle === undefined) {
    checks.push(naCheck('seo_title', I.seo_title, `${K}.seoTitle.pass`, `${NA}.noData`, { label: `${FIX}.writeSeoTitle`, field: 'seoTitle' }));
  } else {
    const v = (input.seoTitle ?? '').trim();
    const status = v && v.length <= SEO_TITLE_MAX ? 'pass' : 'warn';
    checks.push(check('seo_title', I.seo_title, status,
      !v ? `${K}.seoTitle.missing` : status === 'pass' ? `${K}.seoTitle.pass` : `${K}.seoTitle.long`,
      { length: v.length, max: SEO_TITLE_MAX },
      { label: `${FIX}.writeSeoTitle`, field: 'seoTitle' }));
  }

  if (input.seoDescription === undefined) {
    checks.push(naCheck('seo_description', I.seo_description, `${K}.seoDescription.pass`, `${NA}.noData`, { label: `${FIX}.writeSeoDescription`, field: 'seoDescription' }));
  } else {
    const v = (input.seoDescription ?? '').trim();
    const status = v.length >= SEO_DESC_MIN && v.length <= SEO_DESC_MAX ? 'pass' : 'warn';
    checks.push(check('seo_description', I.seo_description, status,
      !v ? `${K}.seoDescription.missing` : status === 'pass' ? `${K}.seoDescription.pass` : `${K}.seoDescription.length`,
      { length: v.length, min: SEO_DESC_MIN, max: SEO_DESC_MAX },
      { label: `${FIX}.writeSeoDescription`, field: 'seoDescription' }));
  }

  const tags = Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string' && t.trim()) : null;
  if (tags === null) {
    checks.push(naCheck('tags_count', I.tags_count, `${K}.tagsCount.pass`, `${NA}.noData`, { label: `${FIX}.addTags`, field: 'tags' }));
  } else {
    const n = tags.length;
    const status = n >= TAGS_GOOD ? 'pass' : n >= 1 ? 'warn' : 'fail';
    checks.push(check('tags_count', I.tags_count, status,
      status === 'pass' ? `${K}.tagsCount.pass` : `${K}.tagsCount.low`,
      { count: n, min: TAGS_GOOD },
      { label: `${FIX}.addTags`, field: 'tags' }));
  }

  return checks;
}

export function scoreShopifyProduct(input: ShopifyScoreInput): ScoreResult {
  return finalizeScore(shopifyChecks(input));
}

/** The `ShopifyProduct` cache columns the scorer reads. */
export interface ShopifyCacheRow {
  title: string;
  description: string | null;
  images: unknown;
  imageCount: number;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
}

/**
 * Cache row → scorer input. The product sync reads REST products, which do not return the SEO metafields,
 * so an empty cached SEO field means "unknown" (`na`), not "empty". A value saved through KolayXport is scored.
 */
export function shopifyInputFromCache(row: ShopifyCacheRow): ShopifyScoreInput {
  const imgs = Array.isArray(row.images) ? row.images.length : 0;
  return {
    title: row.title,
    description: row.description ?? '',
    imageCount: Math.max(row.imageCount || 0, imgs),
    seoTitle: row.seoTitle ? row.seoTitle : undefined,
    seoDescription: row.seoDescription ? row.seoDescription : undefined,
    tags: row.tags,
  };
}

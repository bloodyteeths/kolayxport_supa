// lib/listingScore/wix.ts: Wix product health (DESIGN_SYSTEM §3.10).
// Port of the legacy `calculateHealth` (pages/app/wix-urunler.tsx L127): four factors of 25 points
// (photos, title, description, collections). The legacy proportional points become pass / warn / fail.
// Collections: one seller collection passes (the built-in "All Products" collection is not counted).
// Title: Wix caps product names at 80 characters, so the legacy 140-char scale is replaced by 40–80.
import type { Check, ScoreResult } from './types';
import { finalizeScore } from './types';
import { FIX, NA, check, jsonArrayLength, naCheck, textLength } from './shared';

export interface WixScoreInput {
  title?: string | null;
  /** Description (HTML allowed). undefined → `na`; null/'' counts as empty. */
  description?: string | null;
  imageCount?: number | null;
  /** Number of seller collections the product is in (without Wix's built-in "All Products"). null/undefined → `na`. */
  collectionCount?: number | null;
}

export const WIX_IMPACT = {
  photos_count: 25,
  title_length: 25,
  description: 25,
  collections: 25,
} as const;

export type WixCheckId = keyof typeof WIX_IMPACT;

const K = 'listingScore.wix';
export const WIX_TITLE_MIN = 40;
export const WIX_TITLE_MAX = 80;
const PHOTOS_GOOD = 10;
const PHOTOS_MIN = 5;
const DESC_GOOD = 500;
const DESC_MIN = 200;

export function wixChecks(input: WixScoreInput): Check[] {
  const I = WIX_IMPACT;
  const checks: Check[] = [];

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

  const title = typeof input.title === 'string' ? input.title.trim() : null;
  if (title === null) {
    checks.push(naCheck('title_length', I.title_length, `${K}.titleLength.ok`, `${NA}.noData`, { label: `${FIX}.editTitle`, field: 'title' }));
  } else {
    const len = title.length;
    const status = len > WIX_TITLE_MAX ? 'warn' : len >= WIX_TITLE_MIN ? 'pass' : len >= 20 ? 'warn' : 'fail';
    checks.push(check('title_length', I.title_length, status,
      len > WIX_TITLE_MAX ? `${K}.titleLength.long` : status === 'pass' ? `${K}.titleLength.ok` : `${K}.titleLength.short`,
      { length: len, min: WIX_TITLE_MIN, max: WIX_TITLE_MAX },
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

  if (typeof input.collectionCount !== 'number') {
    checks.push(naCheck('collections', I.collections, `${K}.collections.pass`, `${NA}.noData`, { label: `${FIX}.addToCollection`, field: 'collections' }));
  } else {
    const n = input.collectionCount;
    const status = n >= 1 ? 'pass' : 'fail';
    checks.push(check('collections', I.collections, status,
      status === 'pass' ? `${K}.collections.pass` : `${K}.collections.none`,
      { count: n },
      { label: `${FIX}.addToCollection`, field: 'collections' }));
  }

  return checks;
}

export function scoreWixProduct(input: WixScoreInput): ScoreResult {
  return finalizeScore(wixChecks(input));
}

/** The `WixProduct` cache columns the scorer reads. */
export interface WixCacheRow {
  title: string;
  description: string | null;
  images: unknown;
  imageCount: number;
  collectionIds: unknown;
}

/** Wix's built-in "All Products" collection: every product is in it, so it never counts. */
export const WIX_ALL_PRODUCTS_COLLECTION = '00000000-000000-000000-000000000001';

function sellerCollectionCount(v: unknown): number {
  if (!Array.isArray(v)) return 0;
  return v.filter((id) => typeof id === 'string' && id && id !== WIX_ALL_PRODUCTS_COLLECTION).length;
}

export function wixInputFromCache(row: WixCacheRow): WixScoreInput {
  return {
    title: row.title,
    description: row.description ?? '',
    imageCount: Math.max(row.imageCount || 0, jsonArrayLength(row.images) ?? 0),
    collectionCount: sellerCollectionCount(row.collectionIds),
  };
}

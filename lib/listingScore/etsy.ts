// lib/listingScore/etsy.ts: Etsy listing health (DESIGN_SYSTEM §3.10, listing-editor §4.4).
// Pure function over a listing view (cache row or draft-merged view). Impacts sum to 100.
// A check whose input is missing (undefined/null) is `na` and leaves the denominator.
// Reuses the founder's title/tag rules from lib/etsy/seoRules.ts (import only).
import {
  TITLE_MAX,
  TITLE_MIN,
  TAG_MAX_COUNT,
  checkTitle,
  checkTags,
  contentWords,
  stemWord,
} from '@/lib/etsy/seoRules';
import type { Check, ScoreResult } from './types';
import { finalizeScore } from './types';

export interface EtsyScoreInput {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  /** Photos in order. Omit (undefined) when the source has no image data → photo checks are `na`. */
  images?: Array<{ alt?: string | null }> | null;
  /** Alternative to `images` when only counts are cached. */
  imageCount?: number | null;
  imagesMissingAlt?: number | null;
  hasVideo?: boolean | null;
  materials?: string[] | null;
  /** Required taxonomy properties; null/undefined → `na` (no taxonomy loaded). */
  attributes?: { required: number; filled: number } | null;
  /** null/undefined → `na`. */
  shipping?: { hasProfile: boolean; hasProcessing: boolean; hasWeight: boolean } | null;
  price?: number | null;
  /** Market band from research (p25–p75). null/undefined → `na` ("no research data"). */
  market?: { p25: number; p75: number } | null;
}

export const ETSY_IMPACT = {
  photos_count: 14,
  photos_alt: 6,
  video: 4,
  title_length: 12,
  title_format: 6,
  tags_count: 12,
  tags_quality: 8,
  description: 10,
  attributes: 10,
  materials: 3,
  shipping_ready: 8,
  price_market: 7,
} as const;

export type EtsyCheckId = keyof typeof ETSY_IMPACT;

const K = 'listingScore.etsy';
const FIX = 'listingScore.fix';
const NA = 'listingScore.na';

const PHOTOS_GOOD = 10;
const PHOTOS_MIN = 5;
const DESC_WORDS = 160;
const DESC_LEAD = 160;

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
}

function wordCount(s: string): number {
  return stripHtml(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** True when the description's first 160 chars mention the title's lead phrase (≥ 2 of its words, stemmed). */
export function leadMentionsTitle(title: string, description: string): boolean {
  const lead = (title.split(',')[0] || '').trim();
  const leadWords = Array.from(new Set(contentWords(lead).map(stemWord))).filter(Boolean);
  if (leadWords.length === 0) return false;
  const head = new Set(contentWords(stripHtml(description).slice(0, DESC_LEAD)).map(stemWord));
  const hits = leadWords.filter((w) => head.has(w)).length;
  return hits >= Math.min(2, leadWords.length);
}

const na = (id: EtsyCheckId, label: string, naReason: string, fix?: Check['fix']): Check => ({
  id, label, status: 'na', impact: ETSY_IMPACT[id], naReason, fix,
});

export function etsyChecks(input: EtsyScoreInput): Check[] {
  const checks: Check[] = [];
  const title = typeof input.title === 'string' ? input.title.trim() : null;
  const tags = Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string' && t.trim()) : null;

  // Photos
  const photoCount = Array.isArray(input.images)
    ? input.images.length
    : typeof input.imageCount === 'number' ? input.imageCount : null;
  if (photoCount === null) {
    checks.push(na('photos_count', `${K}.photosCount.pass`, `${NA}.noData`, { label: `${FIX}.addPhotos`, field: 'photos' }));
  } else {
    const status = photoCount >= PHOTOS_GOOD ? 'pass' : photoCount >= PHOTOS_MIN ? 'warn' : 'fail';
    checks.push({
      id: 'photos_count',
      label: status === 'pass' ? `${K}.photosCount.pass` : `${K}.photosCount.low`,
      params: { count: photoCount, missing: Math.max(0, PHOTOS_GOOD - photoCount) },
      status,
      impact: ETSY_IMPACT.photos_count,
      fix: { label: `${FIX}.addPhotos`, field: 'photos' },
    });
  }

  const missingAlt = Array.isArray(input.images)
    ? input.images.filter((i) => !i || !(typeof i.alt === 'string' && i.alt.trim())).length
    : typeof input.imagesMissingAlt === 'number' ? input.imagesMissingAlt : null;
  if (photoCount === null || missingAlt === null) {
    checks.push(na('photos_alt', `${K}.photosAlt.pass`, `${NA}.noData`, { label: `${FIX}.writeAltText`, action: 'ai_alt_text' }));
  } else if (photoCount === 0) {
    checks.push(na('photos_alt', `${K}.photosAlt.pass`, `${NA}.noPhotos`, { label: `${FIX}.writeAltText`, action: 'ai_alt_text' }));
  } else {
    checks.push({
      id: 'photos_alt',
      label: missingAlt === 0 ? `${K}.photosAlt.pass` : `${K}.photosAlt.missing`,
      params: { count: missingAlt },
      status: missingAlt === 0 ? 'pass' : 'fail',
      impact: ETSY_IMPACT.photos_alt,
      fix: { label: `${FIX}.writeAltText`, action: 'ai_alt_text' },
    });
  }

  if (typeof input.hasVideo !== 'boolean') {
    checks.push(na('video', `${K}.video.pass`, `${NA}.noData`, { label: `${FIX}.addVideo`, field: 'video' }));
  } else {
    checks.push({
      id: 'video',
      label: input.hasVideo ? `${K}.video.pass` : `${K}.video.missing`,
      status: input.hasVideo ? 'pass' : 'warn',
      impact: ETSY_IMPACT.video,
      fix: { label: `${FIX}.addVideo`, field: 'video' },
    });
  }

  // Title
  if (title === null) {
    checks.push(na('title_length', `${K}.titleLength.ok`, `${NA}.noData`, { label: `${FIX}.suggestTitles`, action: 'ai_title' }));
    checks.push(na('title_format', `${K}.titleFormat.pass`, `${NA}.noData`, { label: `${FIX}.fixTitleFormat`, action: 'normalize_title' }));
  } else {
    const len = title.length;
    const status = len > TITLE_MAX ? 'fail' : len >= TITLE_MIN ? 'pass' : len >= 70 ? 'warn' : 'fail';
    checks.push({
      id: 'title_length',
      label: len > TITLE_MAX ? `${K}.titleLength.long` : len >= TITLE_MIN ? `${K}.titleLength.ok` : `${K}.titleLength.short`,
      params: { length: len, max: TITLE_MAX, min: TITLE_MIN },
      status,
      impact: ETSY_IMPACT.title_length,
      fix: { label: `${FIX}.suggestTitles`, action: 'ai_title' },
    });
    if (!title) {
      checks.push(na('title_format', `${K}.titleFormat.pass`, `${NA}.noData`, { label: `${FIX}.fixTitleFormat`, action: 'normalize_title' }));
    } else {
      const issues = checkTitle(title).issues.filter((i) => i !== 'empty' && i !== 'too_short' && i !== 'too_long');
      checks.push({
        id: 'title_format',
        label: issues.length === 0 ? `${K}.titleFormat.pass` : `${K}.titleFormat.issues`,
        params: { count: issues.length },
        status: issues.length === 0 ? 'pass' : issues.length === 1 ? 'warn' : 'fail',
        impact: ETSY_IMPACT.title_format,
        fix: { label: `${FIX}.fixTitleFormat`, action: 'normalize_title' },
      });
    }
  }

  // Tags
  if (tags === null) {
    checks.push(na('tags_count', `${K}.tagsCount`, `${NA}.noData`, { label: `${FIX}.getTagIdeas`, action: 'ai_tags' }));
    checks.push(na('tags_quality', `${K}.tagsQuality.pass`, `${NA}.noData`, { label: `${FIX}.showWeakTags`, field: 'tags' }));
  } else {
    const n = tags.length;
    checks.push({
      id: 'tags_count',
      label: `${K}.tagsCount`,
      params: { count: n, max: TAG_MAX_COUNT },
      status: n >= TAG_MAX_COUNT ? 'pass' : n >= 10 ? 'warn' : 'fail',
      impact: ETSY_IMPACT.tags_count,
      fix: { label: `${FIX}.getTagIdeas`, action: 'ai_tags' },
    });
    if (n === 0) {
      checks.push(na('tags_quality', `${K}.tagsQuality.pass`, `${NA}.noTags`, { label: `${FIX}.showWeakTags`, field: 'tags' }));
    } else {
      const tc = checkTags(tags, title ?? '');
      const weak = new Set<string>([
        ...tc.overlapping.map((o) => o.tag),
        ...tc.singleWord,
        ...tc.tooLong,
        ...tc.duplicates.map((d) => d[1]),
      ]).size;
      checks.push({
        id: 'tags_quality',
        label: weak === 0 ? `${K}.tagsQuality.pass` : `${K}.tagsQuality.weak`,
        params: { count: weak },
        status: weak === 0 ? 'pass' : weak <= 2 ? 'warn' : 'fail',
        impact: ETSY_IMPACT.tags_quality,
        fix: { label: `${FIX}.showWeakTags`, field: 'tags' },
      });
    }
  }

  // Description
  if (typeof input.description !== 'string') {
    checks.push(na('description', `${K}.description.pass`, `${NA}.noData`, { label: `${FIX}.writeDescription`, action: 'ai_description' }));
  } else {
    const words = wordCount(input.description);
    const longEnough = words >= DESC_WORDS;
    const leads = !!title && leadMentionsTitle(title, input.description);
    const passes = Number(longEnough) + Number(leads);
    checks.push({
      id: 'description',
      label: passes === 2 ? `${K}.description.pass` : !longEnough ? `${K}.description.short` : `${K}.description.noKeyword`,
      params: { words, min: DESC_WORDS },
      status: passes === 2 ? 'pass' : passes === 1 ? 'warn' : 'fail',
      impact: ETSY_IMPACT.description,
      fix: { label: `${FIX}.writeDescription`, action: 'ai_description' },
    });
  }

  // Category attributes
  if (!input.attributes) {
    checks.push(na('attributes', `${K}.attributes.pass`, `${NA}.noTaxonomy`, { label: `${FIX}.fillDetails`, field: 'details' }));
  } else {
    const missing = Math.max(0, input.attributes.required - input.attributes.filled);
    checks.push({
      id: 'attributes',
      label: missing === 0 ? `${K}.attributes.pass` : `${K}.attributes.missing`,
      params: { count: missing },
      status: missing === 0 ? 'pass' : 'fail',
      impact: ETSY_IMPACT.attributes,
      fix: { label: `${FIX}.fillDetails`, field: 'details' },
    });
  }

  if (!Array.isArray(input.materials)) {
    checks.push(na('materials', `${K}.materials.pass`, `${NA}.noData`, { label: `${FIX}.addMaterials`, field: 'materials' }));
  } else {
    const has = input.materials.some((m) => typeof m === 'string' && m.trim());
    checks.push({
      id: 'materials',
      label: has ? `${K}.materials.pass` : `${K}.materials.missing`,
      status: has ? 'pass' : 'warn',
      impact: ETSY_IMPACT.materials,
      fix: { label: `${FIX}.addMaterials`, field: 'materials' },
    });
  }

  if (!input.shipping) {
    checks.push(na('shipping_ready', `${K}.shipping.pass`, `${NA}.noData`, { label: `${FIX}.setUpShipping`, field: 'shipping' }));
  } else {
    const s = input.shipping;
    const status = !s.hasProfile ? 'fail' : !s.hasProcessing || !s.hasWeight ? 'warn' : 'pass';
    checks.push({
      id: 'shipping_ready',
      label: !s.hasProfile
        ? `${K}.shipping.noProfile`
        : !s.hasWeight ? `${K}.shipping.noWeight` : !s.hasProcessing ? `${K}.shipping.noProcessing` : `${K}.shipping.pass`,
      status,
      impact: ETSY_IMPACT.shipping_ready,
      fix: { label: `${FIX}.setUpShipping`, field: !s.hasProfile ? 'shipping' : !s.hasWeight ? 'weight' : 'processing' },
    });
  }

  if (!input.market || typeof input.price !== 'number' || !Number.isFinite(input.price)) {
    checks.push(na('price_market', `${K}.priceMarket.pass`, `${NA}.noResearch`, { label: `${FIX}.checkPrice`, action: 'check_price' }));
  } else {
    const inside = input.price >= input.market.p25 && input.price <= input.market.p75;
    checks.push({
      id: 'price_market',
      label: inside ? `${K}.priceMarket.pass` : `${K}.priceMarket.outside`,
      status: inside ? 'pass' : 'warn',
      impact: ETSY_IMPACT.price_market,
      fix: { label: `${FIX}.checkPrice`, action: 'check_price' },
    });
  }

  return checks;
}

/** Etsy listing health. Same result for the grid (sent state), the editor (draft view) and Listing doctor. */
export function scoreEtsyListing(input: EtsyScoreInput): ScoreResult {
  return finalizeScore(etsyChecks(input));
}

/**
 * The `EtsyListing` cache columns the scorer reads (structural, no Prisma import so the client can use it).
 * Select exactly these fields (`ETSY_CACHE_SELECT` in `lib/listings/refreshHealth.ts`).
 */
export interface EtsyCacheRow {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  priceAmount: number;
  priceDivisor: number;
  imageCount: number;
  hasVideo: boolean;
  shippingProfileId: bigint | string | number | null;
  processingMin: number | null;
  itemWeight: number | null;
}

/**
 * Maps a cache row to the scorer input. What the cache cannot know stays `undefined` → `na`:
 * alt text (no per-image data cached), required category attributes (no taxonomy properties cached)
 * and the market band (research only). Processing time now lives on the shipping profile on Etsy, so a
 * listing with a profile counts as having processing set even when the legacy `processing_min` is empty.
 */
export function etsyInputFromCache(row: EtsyCacheRow): EtsyScoreInput {
  const hasProfile = row.shippingProfileId !== null && row.shippingProfileId !== undefined && String(row.shippingProfileId) !== '';
  const divisor = row.priceDivisor > 0 ? row.priceDivisor : 100;
  return {
    title: row.title,
    description: row.description,
    tags: row.tags,
    materials: row.materials,
    imageCount: row.imageCount,
    hasVideo: row.hasVideo,
    shipping: {
      hasProfile,
      hasProcessing: row.processingMin !== null || hasProfile,
      hasWeight: typeof row.itemWeight === 'number' && row.itemWeight > 0,
    },
    price: row.priceAmount / divisor,
  };
}

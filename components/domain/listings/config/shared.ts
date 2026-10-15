// components/domain/listings/config/shared.ts — building blocks the five configs share (listings-grid §3, §5).
// Data only: option lists, filter definitions and the scheduled-send switch. No React, no marketplace branching.
import type { ListingStatusKey } from '@/lib/ds/status';
import type { HealthFilterKey } from '@/lib/listings/types';
import type { ListingFilterConfig } from './types';

/** Status filter options, as the marketplace can actually reach them (§3 status map). */
export function statusFilter(keys: ListingStatusKey[]): ListingFilterConfig {
  return {
    key: 'status',
    labelKey: 'listings.filter.status',
    type: 'multiselect',
    pinned: true,
    options: keys.map((k) => ({ value: k, labelKey: `status.listing.${k}` })),
  };
}

const HEALTH_LABEL: Record<HealthFilterKey, string> = {
  lt50: 'listings.health.lt50',
  '50-74': 'listings.health.fair',
  '75-89': 'listings.health.good',
  gte90: 'listings.health.great',
  missing_photos: 'listings.health.missingPhotos',
  missing_tags: 'listings.health.missingTags',
  no_video: 'listings.health.noVideo',
  short_title: 'listings.health.shortTitle',
};

/** Health filter (§5): the four bands plus the check-based options the marketplace supports. */
export function healthFilter(checks: Array<'missing_photos' | 'missing_tags' | 'no_video' | 'short_title'>): ListingFilterConfig {
  const keys: HealthFilterKey[] = ['lt50', '50-74', '75-89', 'gte90', ...checks];
  return {
    key: 'health',
    labelKey: 'listings.filter.health',
    type: 'select',
    pinned: true,
    options: keys.map((k) => ({ value: k, labelKey: HEALTH_LABEL[k] })),
  };
}

export const PHOTOS_FILTER: ListingFilterConfig = {
  key: 'photos',
  labelKey: 'listings.filter.photos',
  type: 'select',
  options: [
    { value: 'lt5', labelKey: 'listings.photos.lt5' },
    { value: '5-9', labelKey: 'listings.photos.5to9' },
    { value: 'gte10', labelKey: 'listings.photos.10plus' },
  ],
};

export const STOCK_FILTER: ListingFilterConfig = {
  key: 'stock',
  labelKey: 'listings.filter.stock',
  type: 'select',
  options: [
    { value: 'in', labelKey: 'listings.stock.in' },
    { value: 'out', labelKey: 'listings.stock.out' },
  ],
};

export const PRICE_FILTER: ListingFilterConfig = {
  key: 'price',
  labelKey: 'listings.filter.price',
  type: 'range',
  unit: 'currency',
};

export function booleanFilter(key: 'hasVideo' | 'personalizable' | 'visible', labelKey: string): ListingFilterConfig {
  return { key, labelKey, type: 'boolean' };
}

/**
 * Scheduled sends need `scheduledSendAt` on the draft tables (BUILD_PLAN BR-1a, migration
 * 20261015130000_listings_grid) and the `send-scheduled-drafts` cron (BR-8, lib/scheduler/jobs.ts). Both ship
 * with this build, so "Schedule send…" is on by default. Set NEXT_PUBLIC_KX_SCHEDULED_SENDS=0 at build time
 * to hide it (kill switch only).
 */
export const SCHEDULED_SENDS_ENABLED = process.env.NEXT_PUBLIC_KX_SCHEDULED_SENDS !== '0';

/** Etsy activity page (BUILD_PLAN §7 item 6: Etsy listings PageHeader ⋯ "Activity"). */
export const ETSY_ACTIVITY_ROUTE = '/app/etsy-aktivite';

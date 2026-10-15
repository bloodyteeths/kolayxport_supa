// components/domain/bulk/BulkBanner.tsx — the ONE banner slot of the bulk page (bulk-grid §2, §3.3, §8; M7-C).
// Priority (highest first): usage limit (C6) · reconnect · paste result · listings that couldn't be saved ·
// invalid edits · conflicts. The choice is pure (`pickBulkBanner`, unit-tested); the component renders it.
import * as React from 'react';
import Box from '@mui/material/Box';
import { Banner, type Tone } from '@/components/ds/feedback/Banner';
import type { ActionSpec } from '@/components/ds/types/actions';
import { CONNECT_HREF, MARKETPLACE_NAME } from '@/components/domain/listings/config';
import type { ListingsT } from '@/components/domain/listings/columns';
import type { ListingMarketplace } from '@/lib/listings/types';

/** What one paste did (bulk-grid §3.3). `skipped` / `overflow` come from BulkGrid when it reports them. */
export type PasteSummary = {
  rows: number;
  cols: number;
  /** Valid cells that entered the staging queue. */
  edits: number;
  invalid: number;
  /** Per-row read-only cells (variations, stock-managed) skipped. */
  skipped: number;
  /** Rows beyond the page (no cross-page paste in v1). */
  overflow: number;
  /** Listings the paste touched (for "Saved · 200 listings, 597 edits not sent"). */
  listings: number;
};

export type BulkBannerInput = {
  marketplace: ListingMarketplace;
  limitHit: boolean;
  /** Stripe upsell allowed (shopify_free never sees "See plans"). */
  stripeUpsell: boolean;
  needsReauth: boolean;
  paste: PasteSummary | null;
  saving: { done: number; total: number } | null;
  /** Listings whose staging failed on the server (not the usage limit). */
  failedListings: number;
  /** Local invalid cells and the first reason. */
  invalid: { count: number; reason: string | null };
  conflicts: number;
};

export type BulkBannerSpec = {
  id: 'limit' | 'reconnect' | 'paste' | 'failed' | 'invalid' | 'conflict';
  tone: Tone;
  title: string;
  detail?: string;
  action?: ActionSpec;
};

export type BulkBannerHandlers = { onShowInvalid?: () => void; onShowFailed?: () => void; onShowConflicts?: () => void };

export function pickBulkBanner(input: BulkBannerInput, t: ListingsT, handlers: BulkBannerHandlers = {}): BulkBannerSpec | null {
  const mp = MARKETPLACE_NAME[input.marketplace];
  if (input.limitHit) {
    return {
      id: 'limit',
      tone: 'warning',
      title: t('listings.error.usageLimit'),
      action: input.stripeUpsell ? { id: 'seePlans', label: t('listings.error.seePlans'), href: `/fiyatlandirma?from=bulk-${input.marketplace}` } : undefined,
    };
  }
  if (input.needsReauth) {
    return {
      id: 'reconnect',
      tone: 'warning',
      title: t('listings.banner.reconnect', { marketplace: mp }),
      action: { id: 'reconnect', label: t('listings.banner.reconnectCta', { marketplace: mp }), href: CONNECT_HREF },
    };
  }
  const showInvalid: ActionSpec | undefined = handlers.onShowInvalid ? { id: 'showInvalid', label: t('bulk.invalid.show'), onClick: handlers.onShowInvalid } : undefined;
  if (input.paste) {
    const p = input.paste;
    const parts: string[] = [];
    if (input.saving) parts.push(t('bulk.meta.saving', { done: input.saving.done, total: input.saving.total }));
    else parts.push(t('bulk.paste.saved', { listings: p.listings, edits: p.edits }));
    if (p.overflow > 0) parts.push(t('bulk.paste.overflow', { count: p.overflow }));
    return {
      id: 'paste',
      tone: p.invalid > 0 ? 'warning' : input.saving ? 'info' : 'success',
      title: t('bulk.paste.result', { rows: p.rows, cols: p.cols, edits: p.edits, invalid: p.invalid, skipped: p.skipped }),
      detail: parts.join(' · '),
      action: p.invalid > 0 ? showInvalid : undefined,
    };
  }
  if (input.failedListings > 0) {
    return {
      id: 'failed',
      tone: 'danger',
      title: t('bulk.stageFailed.banner', { count: input.failedListings }),
      action: handlers.onShowFailed ? { id: 'showFailed', label: t('bulk.invalid.show'), onClick: handlers.onShowFailed } : undefined,
    };
  }
  if (input.invalid.count > 0) {
    return {
      id: 'invalid',
      tone: 'warning',
      title: t('bulk.invalid.banner', { count: input.invalid.count, reason: input.invalid.reason ?? '' }),
      action: showInvalid,
    };
  }
  if (input.conflicts > 0) {
    return {
      id: 'conflict',
      tone: 'warning',
      title: t('bulk.conflict.banner', { count: input.conflicts, on: t('listings.mp.on', { marketplace: input.marketplace }) }),
      action: handlers.onShowConflicts ? { id: 'showConflicts', label: t('bulk.invalid.show'), onClick: handlers.onShowConflicts } : undefined,
    };
  }
  return null;
}

export type BulkBannerProps = { spec: BulkBannerSpec | null };

export function BulkBanner({ spec }: BulkBannerProps) {
  if (!spec) return null;
  return (
    <Box sx={{ mb: '8px' }} role={spec.id === 'paste' ? 'status' : undefined} aria-live={spec.id === 'paste' ? 'polite' : undefined}>
      <Banner
        tone={spec.tone}
        title={spec.title}
        action={spec.action}
        data-testid={`bulk-banner-${spec.id}`}
      >
        {spec.detail ? <span data-testid="bulk-banner-detail">{spec.detail}</span> : null}
      </Banner>
    </Box>
  );
}

export default BulkBanner;

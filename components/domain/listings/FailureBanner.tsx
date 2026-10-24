// components/domain/listings/FailureBanner.tsx — listings-grid §2/§6.2: at most one danger Banner, only when
// failed + conflict > 0: "3 listings weren't sent to Etsy. Fix them and send again." [Show them] → send_failed view.
import * as React from 'react';
import Box from '@mui/material/Box';
import { Banner } from '@/components/ds/feedback/Banner';
import type { ListingMarketplace, ListingsSyncCounts } from '@/lib/listings/types';
import type { ListingsT } from './columns';

export type FailureBannerProps = {
  marketplace: ListingMarketplace;
  sync: Pick<ListingsSyncCounts, 'failed' | 'conflict'> | null | undefined;
  /** Opens the `send_failed` view. Omitted while that view is already open. */
  onShow?: () => void;
  t: ListingsT;
  'data-testid'?: string;
};

export function FailureBanner({ marketplace, sync, onShow, t, ...rest }: FailureBannerProps) {
  const failed = sync?.failed ?? 0;
  const conflicts = sync?.conflict ?? 0;
  const count = failed + conflicts;
  if (count <= 0) return null;
  // One line that says what to do and one action that opens the filtered view. A conflict is not the seller's
  // error (the listing changed on the marketplace after their edit): it says so and asks which version to keep, in
  // a warning tone; real failures keep "Fix them and send again". Both together: both sentences.
  const to = t('listings.mp.to', { marketplace });
  const conflictText = conflicts > 0 ? t('listings.banner.conflictChoose', { count: conflicts, on: t('listings.mp.on', { marketplace }) }) : '';
  const title = failed > 0 ? [t('listings.banner.failedFix', { count: failed, to }), conflictText].filter(Boolean).join(' ') : conflictText;
  return (
    <Box sx={{ mb: '8px' }}>
      <Banner
        tone={failed > 0 ? 'danger' : 'warning'}
        title={title}
        action={onShow ? { id: 'showFailed', label: t('listings.banner.showThem'), onClick: onShow } : undefined}
        data-testid={rest['data-testid'] ?? 'listings-failure-banner'}
      />
    </Box>
  );
}

export default FailureBanner;

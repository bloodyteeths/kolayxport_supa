// components/domain/listings/FailureBanner.tsx — listings-grid §2/§6.2: at most one danger Banner, only when
// failed + conflict > 0: "2 listings couldn't be sent. 1 changed on Etsy since your draft." [Show them].
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
  if (failed + conflicts <= 0) return null;
  const title = t('listings.banner.failed', {
    failed,
    conflicts,
    on: t('listings.mp.on', { marketplace }),
  }).trim();
  return (
    <Box sx={{ mb: '8px' }}>
      <Banner
        tone="danger"
        title={title}
        action={onShow ? { id: 'showFailed', label: t('listings.banner.showThem'), onClick: onShow } : undefined}
        data-testid={rest['data-testid'] ?? 'listings-failure-banner'}
      />
    </Box>
  );
}

export default FailureBanner;

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
  // One line that says what to do ("5 listings weren't sent. Fix them and send again.") and one action that opens
  // the filtered view. Conflicts are counted in: they are fixed in the same view ("Review differences").
  const title = t('listings.banner.failedFix', { count, to: t('listings.mp.to', { marketplace }) });
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

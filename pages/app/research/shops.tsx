// /app/research/shops — Shop tracker (research.md §8, R3-B). Behind the `research` flag (lib/ds/uiFlags.ts, DS §7.1.5),
// gated with R1-C's `useResearchRouteGate` (pending until the viewer's `?ui=` override is resolved, so an opted-in
// viewer is never bounced to the legacy page and back): on → ShopTracker (it renders ResearchLayout itself, so the
// header primary "Watch a shop" can follow the quota); off → forwards to the legacy competitor tool (Etsy "Shop
// intel" tab / eBay seller tracker); off but the build default is on → a link instead of a redirect.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import { useResearchRouteGate } from '@/components/domain/research/ResearchLayout';
import { ShopTracker } from '@/components/domain/research/shops/ShopTracker';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { icons } from '@/lib/ds/icons';

/** Legacy home of this tool per marketplace (verified against the legacy route files' tab unions). */
export function legacyShopsHref(mkt: string | undefined): string {
  if (mkt === 'ebay') return '/app/ebay-research?sub=seller_tracker';
  if (mkt === 'amazon') return '/app/amazon-research';
  return '/app/etsy-research?tab=shopIntel';
}

function ShopTrackerPage() {
  return <ShopTracker />;
}

const ShopTrackerWithAuth = withAuth(ShopTrackerPage);

export default function ResearchShopsRoute() {
  const t = useTranslations('research');
  const router = useRouter();
  const { state } = useResearchRouteGate();
  const q = router?.query?.mkt;
  const legacy = legacyShopsHref(Array.isArray(q) ? q[0] : q);
  React.useEffect(() => {
    if (state === 'off-redirect' && router?.isReady) void router.replace(legacy);
  }, [state, router, legacy]);
  if (state === 'on') return <ShopTrackerWithAuth />;
  if (state === 'off-link') {
    return (
      <Box sx={{ p: '24px' }}>
        <EmptyState
          kind="first-use"
          icon={icons.research}
          title={t('legacy.title')}
          action={{ id: 'legacy', label: t('legacy.open'), href: legacy }}
          data-testid="research-legacy-link"
        />
      </Box>
    );
  }
  return null;
}

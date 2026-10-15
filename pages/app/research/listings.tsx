// /app/research/listings — Listing doctor (research.md §7, R1-D). Behind the `research` flag (lib/ds/uiFlags.ts,
// DS §7.1.5), gated with R1-C's `useResearchRouteGate` (pending until the viewer's `?ui=` override is resolved, so
// an opted-in viewer is never bounced to the legacy page and back): on → ResearchLayout + ListingDoctor; off →
// forwards to the legacy tool (Etsy "Listing grader" / eBay "Listing optimizer"); off but the build default is on
// → a link instead of a redirect (the legacy page would redirect back to the hub).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import { ResearchLayout, useResearchMkt, useResearchRouteGate } from '@/components/domain/research/ResearchLayout';
import { ListingDoctor } from '@/components/domain/research/listings/ListingDoctor';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { icons } from '@/lib/ds/icons';

/** Legacy home of this tool per marketplace (verified against the legacy route files' tab unions). */
export function legacyDoctorHref(mkt: string | undefined): string {
  return mkt === 'ebay' ? '/app/ebay-research?sub=listing_optimizer' : '/app/etsy-research?tab=grader';
}

function ListingDoctorPage() {
  const market = useResearchMkt('listings');
  return (
    <ResearchLayout tab="listings" market={market}>
      <ListingDoctor mkt={market.mkt} onMktChange={market.setMkt} />
    </ResearchLayout>
  );
}

const ListingDoctorWithAuth = withAuth(ListingDoctorPage);

export default function ResearchListingsRoute() {
  const t = useTranslations('research');
  const router = useRouter();
  const { state } = useResearchRouteGate();
  const q = router?.query?.mkt;
  const legacy = legacyDoctorHref(Array.isArray(q) ? q[0] : q);
  React.useEffect(() => {
    if (state === 'off-redirect' && router?.isReady) void router.replace(legacy);
  }, [state, router, legacy]);
  if (state === 'on') return <ListingDoctorWithAuth />;
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

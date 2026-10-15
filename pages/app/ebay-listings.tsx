// /app/ebay-listings — eBay listings: the shared listings grid (components/domain/listings/ListingsPage.tsx,
// configured by config/ebay.ts; DS §7.1.5, listings-grid §13–§14 G7).
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import { editorHandoffHref, hasListingsHandoff } from '@/lib/listings/legacyHandoff';

function EbayListings() {
  return <ListingsPage marketplace="ebay" />;
}

const EbayListingsWithAuth = withAuth(EbayListings);

export default function EbayListingsRoute() {
  const router = useRouter();
  // Research/cross-list hand-offs (`?prefill=session`, `?crosslist=`) on old links go to the editor's create route
  // (lib/listings/legacyHandoff.ts). Wait for the query so the grid never mounts first.
  const editorTarget = router.isReady ? editorHandoffHref('ebay', router.query) : null;
  useEffect(() => {
    if (editorTarget) void router.replace(editorTarget);
  }, [editorTarget, router]);
  if (!router.isReady) return null;
  // A hand-off with no editor target (unknown or wrong-direction cross-list value) just shows the grid.
  if (editorTarget && hasListingsHandoff(router.query)) return null;
  return <EbayListingsWithAuth />;
}

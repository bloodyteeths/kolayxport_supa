// /app/ebay-listings — eBay listings. Flag `listings-ebay` (lib/ds/uiFlags.ts, DS §7.1.5, listings-grid §13–§14 G7): the shared
// listings grid (components/domain/listings/ListingsPage.tsx, configured by config/ebay.ts) or the legacy page,
// moved unchanged to components/legacy/listings/EbayListingsLegacy.tsx (deleted one release after the flag flips, G8).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import EbayListingsLegacy from '@/components/legacy/listings/EbayListingsLegacy';
import { useRef } from 'react';
import { useRouter } from 'next/router';
import { useUiFlag } from '@/lib/ds/uiFlags';
import { needsLegacyListingsPage } from '@/lib/listings/legacyHandoff';

function EbayListingsV2() {
  return <ListingsPage marketplace="ebay" />;
}

const EbayListingsV2WithAuth = withAuth(EbayListingsV2);

export default function EbayListingsRoute() {
  const v2 = useUiFlag('listings-ebay');
  const router = useRouter();
  // Research/cross-list hand-offs (`?prefill=session`, `?crosslist=`) open the legacy creator until the M6 editor
  // ships (lib/listings/legacyHandoff.ts). Wait for the query on the flag-on path so the grid never mounts first.
  // Latched: the legacy page drops the param once it has opened the creator, which must not swap the page under it.
  const handoff = useRef(false);
  if (router.isReady && needsLegacyListingsPage(router.query)) handoff.current = true;
  if (v2 && !router.isReady) return null;
  const legacy = !v2 || handoff.current;
  // The legacy default export is already wrapped in withAuth (+ its own layout / RequireConnection).
  return legacy ? <EbayListingsLegacy /> : <EbayListingsV2WithAuth />;
}

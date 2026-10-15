// /app/ebay-listings — eBay listings. Flag `listings-ebay` (lib/ds/uiFlags.ts, DS §7.1.5, listings-grid §13–§14 G7): the shared
// listings grid (components/domain/listings/ListingsPage.tsx, configured by config/ebay.ts) or the legacy page,
// moved unchanged to components/legacy/listings/EbayListingsLegacy.tsx (deleted one release after the flag flips, G8).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import EbayListingsLegacy from '@/components/legacy/listings/EbayListingsLegacy';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useUiFlag } from '@/lib/ds/uiFlags';
import { editorHandoffHref, needsLegacyListingsPage } from '@/lib/listings/legacyHandoff';

function EbayListingsV2() {
  return <ListingsPage marketplace="ebay" />;
}

const EbayListingsV2WithAuth = withAuth(EbayListingsV2);

export default function EbayListingsRoute() {
  const v2 = useUiFlag('listings-ebay');
  const editorOn = useUiFlag('editor-ebay');
  const router = useRouter();
  // `useUiFlag` applies the `?ui=` override in an effect; hold hand-offs until it has run so the legacy page never
  // consumes a prefill that belongs to the editor.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const editorTarget = router.isReady && editorOn ? editorHandoffHref('ebay', router.query) : null;
  useEffect(() => {
    if (mounted && editorTarget) void router.replace(editorTarget);
  }, [mounted, editorTarget, router]);
  // Research/cross-list hand-offs (`?prefill=session`, `?crosslist=`) go to the M6 editor's create route while its
  // flag is on, else open the legacy creator (lib/listings/legacyHandoff.ts). Wait for the query on the flag-on path
  // so the grid never mounts first.
  // Latched: the legacy page drops the param once it has opened the creator, which must not swap the page under it.
  const handoff = useRef(false);
  const pendingHandoff = router.isReady && needsLegacyListingsPage(router.query);
  if (pendingHandoff && (!mounted || editorTarget)) return null;
  if (pendingHandoff) handoff.current = true;
  if (v2 && !router.isReady) return null;
  const legacy = !v2 || handoff.current;
  // The legacy default export is already wrapped in withAuth (+ its own layout / RequireConnection).
  return legacy ? <EbayListingsLegacy /> : <EbayListingsV2WithAuth />;
}

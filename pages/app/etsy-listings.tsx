// /app/etsy-listings — Etsy listings. Flag `listings-etsy` (lib/ds/uiFlags.ts, DS §7.1.5, listings-grid §13–§14 G7): the shared
// listings grid (components/domain/listings/ListingsPage.tsx, configured by config/etsy.ts) or the legacy page,
// moved unchanged to components/legacy/listings/EtsyListingsLegacy.tsx (deleted one release after the flag flips, G8).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';
import EtsyListingsLegacy from '@/components/legacy/listings/EtsyListingsLegacy';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useUiFlag } from '@/lib/ds/uiFlags';
import { editorHandoffHref, needsLegacyListingsPage } from '@/lib/listings/legacyHandoff';

function EtsyListingsV2() {
  return <ListingsPage marketplace="etsy" />;
}

const EtsyListingsV2WithAuth = withAuth(EtsyListingsV2);

export default function EtsyListingsRoute() {
  const v2 = useUiFlag('listings-etsy');
  const editorOn = useUiFlag('editor-etsy');
  const router = useRouter();
  // `useUiFlag` applies the `?ui=` override in an effect; hold hand-offs until it has run so the legacy page never
  // consumes a prefill that belongs to the editor.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const editorTarget = router.isReady && editorOn ? editorHandoffHref('etsy', router.query) : null;
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
  return legacy ? <EtsyListingsLegacy /> : <EtsyListingsV2WithAuth />;
}

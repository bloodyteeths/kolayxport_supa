// /app/etsy-listings/photos?ids=<id,id…>&tab=photos|video&shop=<shopId>&back=<path> — M7-E PhotoStudio
// (pro-gating §4.1).
// Etsy only in v1. "← Back" returns to the caller (`?back=`, same-app `/app/…` paths only) or the listings list.
import * as React from 'react';
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import { listHref } from '@/lib/listingEditor/editorNav';
import { PhotoStudioPage } from '@/components/domain/photo-studio/PhotoStudioPage';
import { parseStudioIds, parseStudioTab, safeBackHref, type StudioTab } from '@/components/domain/photo-studio/studioModel';

function EtsyPhotoStudioRoute() {
  const router = useRouter();
  const q = router.query;
  const shopId = typeof q.shop === 'string' && /^\d{1,20}$/.test(q.shop) ? q.shop : null;
  const fallbackBack = listHref('etsy', shopId);

  const ids = React.useMemo(() => parseStudioIds(q.ids), [q.ids]);
  const tab = parseStudioTab(q.tab);
  const backHref = safeBackHref(q.back) ?? fallbackBack;
  const onTabChange = React.useCallback((next: StudioTab) => {
    void router.replace({ pathname: router.pathname, query: { ...router.query, tab: next } }, undefined, { shallow: true });
  }, [router]);

  if (!router.isReady) return null;
  return <PhotoStudioPage shopId={shopId} ids={ids} tab={tab} onTabChange={onTabChange} backHref={backHref} />;
}

export default withAuth(EtsyPhotoStudioRoute);

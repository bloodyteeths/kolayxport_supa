// /app — Overview. Flag `overview` (lib/ds/uiFlags.ts, overview §8 G6): the new action-queue Overview
// (components/domain/overview/OverviewPage.tsx) or the legacy landing page, moved verbatim to
// components/legacy/LegacyOverview.js (deleted one release after the flag is default-on).
// Home stays /app/analytics. next.config.js redirects plain /app → /app/analytics (Stripe's success_url
// `/app?session_id=…` included), EXCEPT when a `?ui=` query is present: `/app?ui=overview` is the reachable
// preview of the flag-gated Overview (M8 integrator decision; Overview is not a nav destination).
// The session_id toast below runs only once /app renders.
// No JSX here: the route stays `.js` (overview §8 file list) and Vitest parses `.js` without the JSX transform.
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import OverviewPage from '@/components/domain/overview/OverviewPage';
import LegacyOverview from '@/components/legacy/LegacyOverview';
import { useToast } from '@/components/ds/feedback/toast';
import { useUiFlag } from '@/lib/ds/uiFlags';

const OverviewPageWithAuth = withAuth(OverviewPage);

function OverviewRoute() {
  const router = useRouter();
  const t = useTranslations('overview');
  const toast = useToast();
  const shownFor = useRef(null);
  const sessionId = router.query.session_id;

  // Stripe checkout return: confirm once per session id (double renders and re-mounts do not repeat it).
  useEffect(() => {
    if (!sessionId || shownFor.current === sessionId) return;
    shownFor.current = sessionId;
    toast.success(t('subscriptionActivated'));
  }, [sessionId, t, toast]);

  return React.createElement(OverviewPageWithAuth);
}

export default function AppIndexRoute() {
  const v2 = useUiFlag('overview');
  // LegacyOverview keeps its own AppLayout, auth handling and session_id toast (unchanged).
  return React.createElement(v2 ? OverviewRoute : LegacyOverview);
}

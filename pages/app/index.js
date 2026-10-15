// /app — Overview: the action-queue Overview (components/domain/overview/OverviewPage.tsx, overview §8 G6).
// Home stays /app/analytics. next.config.js redirects plain /app → /app/analytics (`/app?session_id=…`
// included), EXCEPT when a `?ui=` query is present: `/app?ui=overview` is the reachable Overview
// (M8 integrator decision; Overview is not a nav destination).
// The session_id toast below runs only once /app renders.
// No JSX here: the route stays `.js` (overview §8 file list) and Vitest parses `.js` without the JSX transform.
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import OverviewPage from '@/components/domain/overview/OverviewPage';
import { useToast } from '@/components/ds/feedback/toast';

const OverviewPageWithAuth = withAuth(OverviewPage);

export default function OverviewRoute() {
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

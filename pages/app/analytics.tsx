// /app/analytics — Home. Founder decision (BUILD_PLAN M9, "analytics is Home"): Home stays this route and, with the
// `reports` flag on (lib/ds/uiFlags.ts, finance-analytics §0.3 adapted), Home *is* the Reports overview: the Sales
// report inside the shared Reports frame (tabs Sales · Profit · Payouts · Transactions). The Sales tab links here
// (`REPORT_TAB_PATH.sales = HOME_HREF`); `/app/reports` renders the same report so older links keep working.
// Flag off: the legacy analytics page, moved unchanged to components/legacy/reports/LegacyAnalyticsPage.tsx (deleted
// one release after the flag flips, finance-analytics §8).
import * as React from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import withAuth from '@/components/withAuth';
import LegacyAnalyticsPage from '@/components/legacy/reports/LegacyAnalyticsPage';
import { SalesReport } from '@/components/domain/reports/sales/SalesReport';
import { useUiFlag } from '@/lib/ds/uiFlags';

/**
 * Home on the new UI. Keeps the legacy page's one Home duty that is not a report: back from Stripe checkout
 * (`?session_id`, sent here by pages/_app.tsx) confirm activation once, then drop the id from the URL.
 */
function ReportsHome() {
  const router = useRouter();
  const tDash = useTranslations('dashboard');
  const sessionId = router.query.session_id;
  React.useEffect(() => {
    if (!router.isReady || !sessionId) return;
    toast.success(tDash('subscriptionActivated'), { id: 'stripe-session-activated' });
    const { session_id: _sid, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
  }, [router.isReady, sessionId]);
  return <SalesReport />;
}

const ReportsHomeWithAuth = withAuth(ReportsHome);

export default function AnalyticsRoute() {
  const v2 = useUiFlag('reports');
  // The legacy page does its own auth redirect (useAuth + loginUrlFor), unchanged.
  return v2 ? <ReportsHomeWithAuth /> : <LegacyAnalyticsPage />;
}

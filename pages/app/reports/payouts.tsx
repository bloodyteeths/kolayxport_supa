// /app/reports/payouts — Reports › Payouts (finance-analytics §0.3, §2.3; M9 Group E).
// Flag `reports` (lib/ds/uiFlags.ts): on → the new tab; off → `ReportsRouteGate` replaces the route with the legacy
// `/app/financials`, keeping the query, so links never break. Pro gating (`financials`) is drawn by `ReportsPage`.
import withAuth from '@/components/withAuth';
import { ReportsRouteGate } from '@/components/domain/reports/ReportsPage';
import { PayoutsReport } from '@/components/domain/reports/payouts/PayoutsReport';

function PayoutsRoute() {
  return (
    <ReportsRouteGate tab="payouts">
      <PayoutsReport />
    </ReportsRouteGate>
  );
}

export default withAuth(PayoutsRoute);

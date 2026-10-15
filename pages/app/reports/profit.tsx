// /app/reports/profit — Reports › Profit (finance-analytics §0.3, §2.2; M9 Group D).
// Flag `reports` (lib/ds/uiFlags.ts): on → the new tab; off → `ReportsRouteGate` replaces the route with the legacy
// `/app/financials`, keeping the query, so links never break. Pro gating (`financials`) is drawn by `ReportsPage`.
import withAuth from '@/components/withAuth';
import { ReportsRouteGate } from '@/components/domain/reports/ReportsPage';
import { ProfitReport } from '@/components/domain/reports/profit/ProfitReport';

function ProfitRoute() {
  return (
    <ReportsRouteGate tab="profit">
      <ProfitReport />
    </ReportsRouteGate>
  );
}

export default withAuth(ProfitRoute);

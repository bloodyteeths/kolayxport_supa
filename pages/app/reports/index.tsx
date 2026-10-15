// /app/reports — Reports › Sales (finance-analytics §0.3, §2.1; M9 Group C).
// Flag `reports` (lib/ds/uiFlags.ts): on → the Sales report; off → `ReportsRouteGate` replaces the route with the legacy
// Home (`/app/analytics`), keeping the query, so links never break.
// Founder decision "analytics is Home": Home stays `/app/analytics` and is this same Sales report while the flag is on
// (the integrator's `pages/app/analytics.tsx` renders `SalesReport` there); the Sales tab links Home.
import withAuth from '@/components/withAuth';
import { ReportsRouteGate } from '@/components/domain/reports/ReportsPage';
import { SalesReport } from '@/components/domain/reports/sales/SalesReport';

function ReportsSalesRoute() {
  return (
    <ReportsRouteGate tab="sales">
      <SalesReport />
    </ReportsRouteGate>
  );
}

export default withAuth(ReportsSalesRoute);

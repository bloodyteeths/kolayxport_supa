// /app/reports/transactions — Reports › Transactions (finance-analytics §0.3, §2.3; M9 Group E).
// Flag `reports` (lib/ds/uiFlags.ts): on → the new tab; off → `ReportsRouteGate` replaces the route with the legacy
// `/app/financials`, keeping the query, so links never break. Pro gating (`financials`) is drawn by `ReportsPage`.
import withAuth from '@/components/withAuth';
import { ReportsRouteGate } from '@/components/domain/reports/ReportsPage';
import { TransactionsReport } from '@/components/domain/reports/transactions/TransactionsReport';

function TransactionsRoute() {
  return (
    <ReportsRouteGate tab="transactions">
      <TransactionsReport />
    </ReportsRouteGate>
  );
}

export default withAuth(TransactionsRoute);

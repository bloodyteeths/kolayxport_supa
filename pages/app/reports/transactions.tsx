// /app/reports/transactions — Reports › Transactions (finance-analytics §0.3, §2.3; M9 Group E).
// Pro gating (`financials`) is drawn by `ReportsPage`.
import withAuth from '@/components/withAuth';
import { TransactionsReport } from '@/components/domain/reports/transactions/TransactionsReport';

function TransactionsRoute() {
  return <TransactionsReport />;
}

export default withAuth(TransactionsRoute);

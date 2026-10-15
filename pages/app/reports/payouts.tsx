// /app/reports/payouts — Reports › Payouts (finance-analytics §0.3, §2.3; M9 Group E).
// Pro gating (`financials`) is drawn by `ReportsPage`.
import withAuth from '@/components/withAuth';
import { PayoutsReport } from '@/components/domain/reports/payouts/PayoutsReport';

function PayoutsRoute() {
  return <PayoutsReport />;
}

export default withAuth(PayoutsRoute);

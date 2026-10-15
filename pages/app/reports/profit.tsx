// /app/reports/profit — Reports › Profit (finance-analytics §0.3, §2.2; M9 Group D).
// Pro gating (`financials`) is drawn by `ReportsPage`.
import withAuth from '@/components/withAuth';
import { ProfitReport } from '@/components/domain/reports/profit/ProfitReport';

function ProfitRoute() {
  return <ProfitReport />;
}

export default withAuth(ProfitRoute);

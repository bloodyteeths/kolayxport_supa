// /app/reports — Reports › Sales (finance-analytics §0.3, §2.1; M9 Group C).
// Founder decision "analytics is Home": Home stays `/app/analytics` and is this same Sales report (pages/app/analytics.tsx
// renders `SalesReport` there); the Sales tab links Home.
import withAuth from '@/components/withAuth';
import { SalesReport } from '@/components/domain/reports/sales/SalesReport';

function ReportsSalesRoute() {
  return <SalesReport />;
}

export default withAuth(ReportsSalesRoute);

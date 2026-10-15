// /app/analytics — Home. Founder decision (BUILD_PLAN M9, "analytics is Home"): Home stays this route and Home *is*
// the Reports overview: the Sales report inside the shared Reports frame (tabs Sales · Profit · Payouts ·
// Transactions). The Sales tab links here (`REPORT_TAB_PATH.sales = HOME_HREF`); `/app/reports` renders the same
// report so older links keep working. Stripe checkout returns to Settings → Billing (lib/billing/checkoutUrls.ts).
import * as React from 'react';
import withAuth from '@/components/withAuth';
import { SalesReport } from '@/components/domain/reports/sales/SalesReport';

function ReportsHome() {
  return <SalesReport />;
}

export default withAuth(ReportsHome);

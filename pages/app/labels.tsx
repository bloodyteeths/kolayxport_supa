// /app/labels — Orders. Flag `orders` (lib/ds/uiFlags.ts, DS §7.1.5, orders §1.1): the new list
// (components/domain/orders/OrdersPage.tsx) or the legacy labels page, moved unchanged to
// components/legacy/LegacyLabelsPage.tsx (export menu, private notes, packing slips / pick list, ETGB,
// live highlight, lifecycle badges, cancelled-order dialog all stay there). Deleted one release after the flip.
import withAuth from '@/components/withAuth';
import OrdersPage from '@/components/domain/orders/OrdersPage';
import LegacyLabelsPage from '@/components/legacy/LegacyLabelsPage';
import { useUiFlag } from '@/lib/ds/uiFlags';

const OrdersPageWithAuth = withAuth(OrdersPage);

export default function LabelsRoute() {
  const v2 = useUiFlag('orders');
  // LegacyLabelsPage is already wrapped in withAuth + AppLayout (unchanged default export).
  return v2 ? <OrdersPageWithAuth /> : <LegacyLabelsPage />;
}

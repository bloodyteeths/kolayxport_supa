// /app/labels — Orders (components/domain/orders/OrdersPage.tsx, orders §1.1).
import withAuth from '@/components/withAuth';
import OrdersPage from '@/components/domain/orders/OrdersPage';

export default withAuth(OrdersPage);

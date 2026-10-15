// /app/trendyol-urunler — Trendyol listings: the shared listings grid (components/domain/listings/ListingsPage.tsx,
// configured by config/trendyol.ts; DS §7.1.5, listings-grid §13–§14 G7).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';

function TrendyolListings() {
  return <ListingsPage marketplace="trendyol" />;
}

export default withAuth(TrendyolListings);

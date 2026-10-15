// /app/wix-urunler — Wix listings: the shared listings grid (components/domain/listings/ListingsPage.tsx,
// configured by config/wix.ts; DS §7.1.5, listings-grid §13–§14 G7).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';

function WixListings() {
  return <ListingsPage marketplace="wix" />;
}

export default withAuth(WixListings);

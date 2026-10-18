// /app/hepsiburada-urunler — Hepsiburada listings: the shared listings grid (components/domain/listings/ListingsPage.tsx,
// configured by config/hepsiburada.ts).
import withAuth from '@/components/withAuth';
import ListingsPage from '@/components/domain/listings/ListingsPage';

function HepsiburadaListings() {
  return <ListingsPage marketplace="hepsiburada" />;
}

export default withAuth(HepsiburadaListings);

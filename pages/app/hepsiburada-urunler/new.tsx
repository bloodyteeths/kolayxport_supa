// /app/hepsiburada-urunler/new — create a Hepsiburada product (catalog import or fast listing).
import withAuth from '@/components/withAuth';
import HepsiburadaCreatePage from '@/components/domain/hepsiburada/HepsiburadaCreatePage';

function HepsiburadaNewProduct() {
  return <HepsiburadaCreatePage />;
}

export default withAuth(HepsiburadaNewProduct);

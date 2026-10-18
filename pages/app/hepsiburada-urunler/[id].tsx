// /app/hepsiburada-urunler/[id] — one Hepsiburada listing (id = hbSku): price, stock, dispatch time staged as a draft.
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import HepsiburadaListingPage from '@/components/domain/hepsiburada/HepsiburadaListingPage';

function HepsiburadaListing() {
  const router = useRouter();
  const raw = router.query.id;
  const id = typeof raw === 'string' ? raw : '';
  if (!router.isReady || !id) return null;
  return <HepsiburadaListingPage hbSku={id} />;
}

export default withAuth(HepsiburadaListing);

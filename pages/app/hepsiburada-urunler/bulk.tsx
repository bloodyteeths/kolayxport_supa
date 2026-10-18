// /app/hepsiburada-urunler/bulk — Hepsiburada bulk editor (price and stock). Every edit stages a draft; nothing goes
// live until "Send N changes to Hepsiburada".
import withAuth from '@/components/withAuth';
import { BulkEditRoute } from '@/components/domain/bulk/BulkEditPage';

function HepsiburadaBulkEditPage() {
  return <BulkEditRoute marketplace="hepsiburada" />;
}

export default withAuth(HepsiburadaBulkEditPage);

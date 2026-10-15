// /app/wix-urunler/bulk — Wix bulk editor (bulk-grid.md, M7-C). Behind the `bulk` flag; off → back to the list.
// Every edit stages a draft; nothing goes live until "Send N changes to Wix".
import withAuth from '@/components/withAuth';
import { BulkEditRoute } from '@/components/domain/bulk/BulkEditPage';

function WixBulkEditPage() {
  return <BulkEditRoute marketplace="wix" />;
}

export default withAuth(WixBulkEditPage);

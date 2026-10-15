// /app/ebay-listings/bulk — eBay bulk editor (bulk-grid.md, M7-C). Behind the `bulk` flag; off → back to the list.
// Every edit stages a draft; nothing goes live until "Send N changes to eBay".
import withAuth from '@/components/withAuth';
import { BulkEditRoute } from '@/components/domain/bulk/BulkEditPage';

function EbayBulkEditPage() {
  return <BulkEditRoute marketplace="ebay" />;
}

export default withAuth(EbayBulkEditPage);

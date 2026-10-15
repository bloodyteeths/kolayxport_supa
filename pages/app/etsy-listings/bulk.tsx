// /app/etsy-listings/bulk — Etsy bulk editor (bulk-grid.md, M7-C). Behind the `bulk` flag; off → back to the list.
// Every edit stages a draft; nothing goes live until "Send N changes to Etsy".
import withAuth from '@/components/withAuth';
import { BulkEditRoute } from '@/components/domain/bulk/BulkEditPage';

function EtsyBulkEditPage() {
  return <BulkEditRoute marketplace="etsy" />;
}

export default withAuth(EtsyBulkEditPage);

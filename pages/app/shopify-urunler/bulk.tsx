// /app/shopify-urunler/bulk — Shopify bulk editor (bulk-grid.md, M7-C). Behind the `bulk` flag; off → back to the list.
// Every edit stages a draft; nothing goes live until "Send N changes to Shopify".
import withAuth from '@/components/withAuth';
import { BulkEditRoute } from '@/components/domain/bulk/BulkEditPage';

function ShopifyBulkEditPage() {
  return <BulkEditRoute marketplace="shopify" />;
}

export default withAuth(ShopifyBulkEditPage);

// /app/trendyol-urunler/bulk — Trendyol bulk editor (bulk-grid.md, M7-C). Behind the `bulk` flag; off → back to the list.
// Every edit stages a draft; nothing goes live until "Send N changes to Trendyol".
import withAuth from '@/components/withAuth';
import { BulkEditRoute } from '@/components/domain/bulk/BulkEditPage';

function TrendyolBulkEditPage() {
  return <BulkEditRoute marketplace="trendyol" />;
}

export default withAuth(TrendyolBulkEditPage);

// /app/trendyol-urunler/new — create a Trendyol product in the same workspace as edit (marketplace-editors §5; M6b-C).
// Bootstraps: blank · `?draft=<id>` (resume a staged new product) · `?copy=<id>` (copy a Trendyol product) ·
// `?crosslist=etsy:<listingId>|ebay:<sku>`. The first save stages a CatalogDraft with `externalId = new:<id>` and a
// queued `create`; nothing is created on Trendyol until "Send". Behind `editor-trendyol`.
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function NewTrendyolProductPage() {
  return <CatalogEditorRoute marketplace="trendyol" mode="create" />;
}

export default withAuth(NewTrendyolProductPage);

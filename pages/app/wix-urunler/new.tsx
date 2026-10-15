// /app/wix-urunler/new — create a Wix product in the same workspace as edit (marketplace-editors §5; M6b-C).
// Bootstraps: blank · `?draft=<id>` (resume a staged new product) · `?copy=<id>` (copy a Wix product) ·
// `?crosslist=etsy:<listingId>|ebay:<sku>`. The first save stages a CatalogDraft with `externalId = new:<id>` and a
// queued `create`; nothing is created on Wix until "Send".
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function NewWixProductPage() {
  return <CatalogEditorRoute marketplace="wix" mode="create" />;
}

export default withAuth(NewWixProductPage);

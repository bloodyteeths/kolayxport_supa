// /app/shopify-urunler/new — create a Shopify product in the same workspace as edit (marketplace-editors §5; M6b-C).
// Bootstraps: blank · `?draft=<id>` (resume a staged new product) · `?copy=<id>` (copy a Shopify product) ·
// `?crosslist=etsy:<listingId>|ebay:<sku>`. The first save stages a CatalogDraft with `externalId = new:<id>` and a
// queued `create`; nothing is created on Shopify until "Send".
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function NewShopifyProductPage() {
  return <CatalogEditorRoute marketplace="shopify" mode="create" />;
}

export default withAuth(NewShopifyProductPage);

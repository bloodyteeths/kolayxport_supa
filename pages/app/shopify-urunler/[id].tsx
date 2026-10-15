// /app/shopify-urunler/[id] — the full-page Shopify product editor (marketplace-editors §2; M6b-C). Behind the
// `editor-shopify` flag (lib/ds/uiFlags.ts): with it off the route goes back to the list. Every edit stages into the
// product's CatalogDraft; nothing reaches Shopify until the footer's "Send changes".
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function ShopifyProductEditorPage() {
  return <CatalogEditorRoute marketplace="shopify" mode="edit" />;
}

export default withAuth(ShopifyProductEditorPage);

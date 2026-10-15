// /app/trendyol-urunler/[id] — the full-page Trendyol product editor (marketplace-editors §2; M6b-C). Behind the
// `editor-trendyol` flag (lib/ds/uiFlags.ts): with it off the route goes back to the list. Every edit stages into the
// product's CatalogDraft; nothing reaches Trendyol until the footer's "Send changes".
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function TrendyolProductEditorPage() {
  return <CatalogEditorRoute marketplace="trendyol" mode="edit" />;
}

export default withAuth(TrendyolProductEditorPage);

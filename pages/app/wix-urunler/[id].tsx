// /app/wix-urunler/[id] — the full-page Wix product editor (marketplace-editors §2; M6b-C).
// Every edit stages into the product's CatalogDraft; nothing reaches Wix until the footer's "Send changes".
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function WixProductEditorPage() {
  return <CatalogEditorRoute marketplace="wix" mode="edit" />;
}

export default withAuth(WixProductEditorPage);

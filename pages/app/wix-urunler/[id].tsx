// /app/wix-urunler/[id] — the full-page Wix product editor (marketplace-editors §2; M6b-C). Behind the
// `editor-wix` flag (lib/ds/uiFlags.ts): with it off the route goes back to the list. Every edit stages into the
// product's CatalogDraft; nothing reaches Wix until the footer's "Send changes".
import withAuth from '@/components/withAuth';
import { CatalogEditorRoute } from '@/components/domain/listing-editor/CatalogEditorRoute';

function WixProductEditorPage() {
  return <CatalogEditorRoute marketplace="wix" mode="edit" />;
}

export default withAuth(WixProductEditorPage);

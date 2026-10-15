// /app/ebay-listings/[sku] — the full-page eBay listing editor (listing-editor §1, M6 Group F).
// Every edit stages into the SKU's EbayListingDraft (adapters/ebay.ts); nothing reaches eBay without the footer's
// "Send changes to eBay", and a conflict only clears through Review differences (no force).
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import { ListingEditor } from '@/components/domain/listing-editor/ListingEditor';
import {
  EBAY_EDITOR_SHOP, ebayAdapter, ebayBackHref, parseSkuParam, type EbayEditorFields,
} from '@/components/domain/listing-editor/adapters/ebay';
import { EBAY_SECTIONS, ebayHealth, ebayPreviewModel } from '@/components/domain/listing-editor/sections/EbayFieldSections';
import { editorHref, listHref } from '@/lib/listingEditor/editorNav';

function EbayListingEditorPage() {
  const router = useRouter();
  const sku = parseSkuParam(router.query.sku);
  const invalid = router.isReady && !sku;

  useEffect(() => {
    if (!router.isReady) return;
    if (invalid) void router.replace(listHref('ebay', null));
  }, [invalid, router]);

  if (!router.isReady || !sku) return null;
  return (
    <ListingEditor<EbayEditorFields>
      key={sku}
      marketplace="ebay"
      adapter={ebayAdapter}
      shopId={EBAY_EDITOR_SHOP}
      mode="edit"
      listingId={sku}
      backHref={ebayBackHref()}
      sections={EBAY_SECTIONS}
      sectionProps={{}}
      health={ebayHealth}
      preview={ebayPreviewModel}
      onCreated={(id) => void router.replace(editorHref('ebay', id))}
    />
  );
}

export default withAuth(EbayListingEditorPage);

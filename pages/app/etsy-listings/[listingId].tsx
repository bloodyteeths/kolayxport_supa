// /app/etsy-listings/[listingId] — the full-page Etsy listing editor (listing-editor §1, M6 Group A).
// A negative id is a staged new listing that is not on Etsy yet: it opens the same workspace in create mode.
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import { ListingEditor, EtsyEditorGate, editorBackHref } from '@/components/domain/listing-editor/ListingEditor';
import { etsyAdapter } from '@/components/domain/listing-editor/adapters/etsy';
import { editorHref, newListingHref } from '@/lib/listingEditor/editorNav';

function EtsyListingEditorPage() {
  const router = useRouter();
  const raw = router.query.listingId;
  const listingId = typeof raw === 'string' && /^-?\d{1,20}$/.test(raw) ? raw : null;
  const invalid = router.isReady && !listingId;
  useEffect(() => {
    // Not a listing id: back to the list.
    if (invalid) void router.replace('/app/etsy-listings');
  }, [invalid, router]);
  if (!router.isReady || !listingId) return null;
  const local = listingId.startsWith('-');
  return (
    <EtsyEditorGate>
      {(shop) => (
        <ListingEditor
          key={`${shop.shopId}:${listingId}`}
          marketplace="etsy"
          adapter={etsyAdapter}
          shopId={shop.shopId}
          shopName={shop.shopName}
          mode={local ? 'create' : 'edit'}
          listingId={listingId}
          backHref={editorBackHref(shop.shopId)}
          onDraftCreated={(draft) => {
            if (local) return;
            void router.replace(newListingHref('etsy', shop.shopId, { draft: draft.id }), undefined, { shallow: true });
          }}
          onCreated={(id) => void router.replace(editorHref('etsy', id, shop.shopId))}
        />
      )}
    </EtsyEditorGate>
  );
}

export default withAuth(EtsyListingEditorPage);

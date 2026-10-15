// /app/etsy-listings/new — create a listing in the same workspace as edit (listing-editor §1, §3.2, M6 Group A).
// Bootstraps: blank · `?draft=<id>` (resume a staged new listing) · `?copy=<listingId>` (copy an Etsy listing,
// photos staged by URL) · `?prefill=session` (research hand-off, `consumeListingPrefill`). The first save creates
// the DB draft at a negative local listing id and the URL becomes `?draft=<id>` (shallow, so a reload resumes);
// the first successful send replaces it with `/app/etsy-listings/<realId>`. Behind the `editor-etsy` flag.
import { useRef } from 'react';
import { useRouter } from 'next/router';
import withAuth from '@/components/withAuth';
import { ListingEditor, EtsyEditorGate, editorBackHref } from '@/components/domain/listing-editor/ListingEditor';
import { copyFromPrefill, etsyAdapter } from '@/components/domain/listing-editor/adapters/etsy';
import { consumeListingPrefill } from '@/components/etsy/research/shared/listingPrefill';
import { editorHref, newListingHref } from '@/lib/listingEditor/editorNav';
import type { CopySourceData } from '@/lib/listingEditor/types';

interface Bootstrap {
  draftId: string | null;
  copyFromId: string | null;
  copy: CopySourceData | null;
}

function NewEtsyListingPage() {
  const router = useRouter();
  // Latched on the first ready query: later shallow URL updates (`?draft=`) must not restart the workspace.
  const boot = useRef<Bootstrap | null>(null);
  if (!router.isReady) return null;
  if (!boot.current) {
    const q = router.query;
    const draftId = typeof q.draft === 'string' && /^[\w-]{1,64}$/.test(q.draft) ? q.draft : null;
    const copyFromId = !draftId && typeof q.copy === 'string' && /^\d{1,20}$/.test(q.copy) ? q.copy : null;
    let copy: CopySourceData | null = null;
    if (!draftId && !copyFromId && q.prefill === 'session') {
      const prefill = consumeListingPrefill('etsy');
      copy = prefill ? copyFromPrefill(prefill) : null;
    }
    boot.current = { draftId, copyFromId, copy };
  }
  const b = boot.current;
  return (
    <EtsyEditorGate>
      {(shop) => (
        <ListingEditor
          key={shop.shopId}
          marketplace="etsy"
          adapter={etsyAdapter}
          shopId={shop.shopId}
          shopName={shop.shopName}
          mode="create"
          listingId={null}
          draftId={b.draftId}
          copyFromId={b.copyFromId}
          copy={b.copy}
          backHref={editorBackHref(shop.shopId)}
          onDraftCreated={(draft) =>
            void router.replace(newListingHref('etsy', shop.shopId, { draft: draft.id }), undefined, { shallow: true })
          }
          onCreated={(id) => void router.replace(editorHref('etsy', id, shop.shopId))}
        />
      )}
    </EtsyEditorGate>
  );
}

export default withAuth(NewEtsyListingPage);

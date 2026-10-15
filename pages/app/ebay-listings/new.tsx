// /app/ebay-listings/new — create an eBay listing in the same workspace as edit (listing-editor §1, M6 Group F).
// Bootstraps: blank · `?draft=<id>` (resume a staged new listing) · `?copy=<sku>` (copy an eBay listing) ·
// `?crosslist=etsy:<listingId>` (Etsy "Copy to eBay") · `?prefill=session` (research hand-off).
// F1: the first save creates an EbayListingDraft at a local SKU with a queued `create`; the URL becomes
// `?draft=<id>` (shallow, so a reload resumes). Nothing reaches eBay until "List on eBay" / "Save on eBay as
// unpublished"; the first successful send replaces the URL with `/app/ebay-listings/<sku>`.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import { useToast } from '@/components/ds/feedback/toast';
import { ListingEditor } from '@/components/domain/listing-editor/ListingEditor';
import {
  EBAY_EDITOR_SHOP,
  ebayAdapter,
  ebayBackHref,
  ebayCopyFromPrefill,
  loadEtsyCrosslistSource,
  parseEbayCreateQuery,
  type EbayCreateBootstrap,
  type EbayEditorFields,
} from '@/components/domain/listing-editor/adapters/ebay';
import { EBAY_SECTIONS, ebayHealth, ebayPreviewModel } from '@/components/domain/listing-editor/sections/EbayFieldSections';
import { consumeListingPrefill } from '@/lib/listings/listingPrefill';
import { editorHref, newListingHref } from '@/lib/listingEditor/editorNav';
import type { CopySourceData } from '@/lib/listingEditor/types';

interface Boot extends EbayCreateBootstrap {
  copy: CopySourceData | null;
}

function NewEbayListingPage() {
  const router = useRouter();
  const t = useTranslations('listingEditor');
  const toast = useToast();
  // Latched on the first ready query: later shallow URL updates (`?draft=`) must not restart the workspace.
  const boot = useRef<Boot | null>(null);
  if (router.isReady && !boot.current) {
    const parsed = parseEbayCreateQuery(router.query);
    let copy: CopySourceData | null = null;
    if (parsed.prefill) {
      const prefill = consumeListingPrefill('ebay');
      copy = prefill ? ebayCopyFromPrefill(prefill) : null;
    }
    boot.current = { ...parsed, copy };
  }
  const b = boot.current;
  // Cross-list source loads before the workspace mounts (the engine reads `copy` once).
  const [cross, setCross] = useState<{ status: 'idle' | 'loading' | 'done'; copy: CopySourceData | null }>({ status: 'idle', copy: null });

  useEffect(() => {
    if (!b?.crosslistEtsyId || cross.status !== 'idle') return;
    setCross({ status: 'loading', copy: null });
    loadEtsyCrosslistSource(b.crosslistEtsyId)
      .then((copy) => {
        if (!copy) toast.error(t('state.crosslistFailed'));
        setCross({ status: 'done', copy });
      })
      .catch(() => {
        toast.error(t('state.crosslistFailed'));
        setCross({ status: 'done', copy: null });
      });
  }, [b, cross.status, toast, t]);

  if (!router.isReady || !b) return null;
  if (b.crosslistEtsyId && cross.status !== 'done') return null;
  const copy = b.copy ?? cross.copy;
  return (
    <ListingEditor<EbayEditorFields>
      marketplace="ebay"
      adapter={ebayAdapter}
      shopId={EBAY_EDITOR_SHOP}
      mode="create"
      listingId={null}
      draftId={b.draftId}
      copyFromId={b.copyFromId}
      copy={copy}
      backHref={ebayBackHref()}
      sections={EBAY_SECTIONS}
      sectionProps={{}}
      health={ebayHealth}
      preview={ebayPreviewModel}
      onDraftCreated={(draft) => void router.replace(newListingHref('ebay', null, { draft: draft.id }), undefined, { shallow: true })}
      onCreated={(sku) => void router.replace(editorHref('ebay', sku))}
    />
  );
}

export default withAuth(NewEbayListingPage);

// /app/etsy-listings/new — create a listing in the same workspace as edit (listing-editor §1, §3.2, M6 Group A).
// Bootstraps: blank · `?draft=<id>` (resume a staged new listing) · `?copy=<listingId>` (copy an Etsy listing,
// photos staged by URL) · `?prefill=session` (research hand-off, `consumeListingPrefill`) · `?crosslist=ebay:<sku>`
// (eBay "Copy to Etsy": the eBay listing is read before the workspace mounts; its price is kept only when the eBay
// currency is the shop's). The first save creates the DB draft at a negative local listing id and the URL becomes
// `?draft=<id>` (shallow, so a reload resumes); the first successful send replaces it with
// `/app/etsy-listings/<realId>`.
import * as React from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import withAuth from '@/components/withAuth';
import { useToast } from '@/components/ds/feedback/toast';
import { ListingEditor, EtsyEditorGate, editorBackHref } from '@/components/domain/listing-editor/ListingEditor';
import { copyFromPrefill, etsyAdapter } from '@/components/domain/listing-editor/adapters/etsy';
import {
  fitEbayCopyToShop,
  loadEbayCrosslistForEtsy,
  loadEtsyShopCurrency,
  parseEtsyCreateQuery,
} from '@/components/domain/listing-editor/crosslistEbayToEtsy';
import { consumeListingPrefill } from '@/lib/listings/listingPrefill';
import { editorHref, newListingHref } from '@/lib/listingEditor/editorNav';
import type { CopySourceData } from '@/lib/listingEditor/types';

interface Bootstrap {
  draftId: string | null;
  copyFromId: string | null;
  copy: CopySourceData | null;
  /** eBay SKU of a `crosslist=ebay:<sku>` hand-off (loaded per shop before the workspace mounts). */
  crosslistEbaySku: string | null;
}

type ShopProps = { shop: { shopId: string; shopName: string | null }; boot: Bootstrap };

function EtsyCreateWorkspace({ shop, boot, copy }: ShopProps & { copy: CopySourceData | null }) {
  const router = useRouter();
  return (
    <ListingEditor
      key={shop.shopId}
      marketplace="etsy"
      adapter={etsyAdapter}
      shopId={shop.shopId}
      shopName={shop.shopName}
      mode="create"
      listingId={null}
      draftId={boot.draftId}
      copyFromId={boot.copyFromId}
      copy={copy}
      backHref={editorBackHref(shop.shopId)}
      onDraftCreated={(draft) => void router.replace(newListingHref('etsy', shop.shopId, { draft: draft.id }), undefined, { shallow: true })}
      onCreated={(id) => void router.replace(editorHref('etsy', id, shop.shopId))}
    />
  );
}

/** eBay → Etsy: load the eBay listing and the shop currency, then mount the workspace once (the engine reads `copy` once). */
function EtsyCrosslistWorkspace({ shop, boot, sku }: ShopProps & { sku: string }) {
  const t = useTranslations('listingEditor');
  const toast = useToast();
  const [state, setState] = React.useState<{ done: boolean; copy: CopySourceData | null }>({ done: false, copy: null });
  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([loadEbayCrosslistForEtsy(sku).catch(() => null), loadEtsyShopCurrency(shop.shopId)]).then(([src, shopCurrency]) => {
      if (cancelled) return;
      if (!src) {
        toast.error(t('state.crosslistEbayFailed'));
        setState({ done: true, copy: null });
        return;
      }
      const fitted = fitEbayCopyToShop(src.copy, src.currency, shopCurrency);
      if (fitted.priceCleared && shopCurrency) toast.info(t('catalog.crosslistPriceCleared', { currency: shopCurrency }));
      setState({ done: true, copy: fitted.copy });
    });
    return () => {
      cancelled = true;
    };
  }, [sku, shop.shopId, toast, t]);
  if (!state.done) return null;
  return <EtsyCreateWorkspace shop={shop} boot={boot} copy={state.copy} />;
}

function NewEtsyListingPage() {
  const router = useRouter();
  // Latched on the first ready query: later shallow URL updates (`?draft=`) must not restart the workspace.
  const boot = React.useRef<Bootstrap | null>(null);
  if (!router.isReady) return null;
  if (!boot.current) {
    const parsed = parseEtsyCreateQuery(router.query);
    let copy: CopySourceData | null = null;
    if (parsed.prefill) {
      const prefill = consumeListingPrefill('etsy');
      copy = prefill ? copyFromPrefill(prefill) : null;
    }
    boot.current = { draftId: parsed.draftId, copyFromId: parsed.copyFromId, crosslistEbaySku: parsed.crosslistEbaySku, copy };
  }
  const b = boot.current;
  const sku = b.crosslistEbaySku;
  return (
    // A cross-list from eBay does not know the Etsy shop: with several shops and no `?shop`, the first one is used.
    <EtsyEditorGate firstShopFallback={Boolean(sku)}>
      {(shop) => (sku ? <EtsyCrosslistWorkspace key={shop.shopId} shop={shop} boot={b} sku={sku} /> : <EtsyCreateWorkspace shop={shop} boot={b} copy={b.copy} />)}
    </EtsyEditorGate>
  );
}

export default withAuth(NewEtsyListingPage);

// /app/etsy-listings/new — create a listing in the same workspace as edit (listing-editor §1, §3.2, M6 Group A).
// Bootstraps: blank · `?draft=<id>` (resume a staged new listing) · `?copy=<listingId>` (copy an Etsy listing,
// photos staged by URL) · `?prefill=session` (research hand-off, `consumeListingPrefill`) · `?crosslist=ebay:<sku>`
// (eBay "Copy to Etsy": the eBay listing is read before the workspace mounts; its price is kept only when the eBay
// currency is the shop's) · `?crosslist=trendyol:<barcode>` (Trendyol "Copy to Etsy", same rules; TRY price kept only
// for a TRY shop). The first save creates the DB draft at a negative local listing id and the URL becomes
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
import { loadTrendyolCrosslistForEtsy } from '@/components/domain/listing-editor/crosslistTrendyolToEtsy';
import { consumeListingPrefill } from '@/lib/listings/listingPrefill';
import { editorHref, newListingHref } from '@/lib/listingEditor/editorNav';
import type { CopySourceData } from '@/lib/listingEditor/types';

interface Bootstrap {
  draftId: string | null;
  copyFromId: string | null;
  copy: CopySourceData | null;
  /** `crosslist=ebay:<sku>` / `crosslist=trendyol:<barcode>` hand-off (loaded per shop before the workspace mounts). */
  crosslist: { from: 'ebay' | 'trendyol'; id: string } | null;
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

/** eBay / Trendyol → Etsy: load the source and the shop currency, then mount the workspace once (the engine reads `copy` once). */
function EtsyCrosslistWorkspace({ shop, boot, source }: ShopProps & { source: { from: 'ebay' | 'trendyol'; id: string } }) {
  const t = useTranslations('listingEditor');
  const toast = useToast();
  const [state, setState] = React.useState<{ done: boolean; copy: CopySourceData | null }>({ done: false, copy: null });
  React.useEffect(() => {
    let cancelled = false;
    const load = source.from === 'trendyol' ? loadTrendyolCrosslistForEtsy(source.id) : loadEbayCrosslistForEtsy(source.id);
    void Promise.all([load.catch(() => null), loadEtsyShopCurrency(shop.shopId)]).then(([src, shopCurrency]) => {
      if (cancelled) return;
      if (!src) {
        toast.error(t(source.from === 'trendyol' ? 'state.crosslistTrendyolFailed' : 'state.crosslistEbayFailed'));
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
  }, [source.from, source.id, shop.shopId, toast, t]);
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
    const crosslist = parsed.crosslistEbaySku
      ? { from: 'ebay' as const, id: parsed.crosslistEbaySku }
      : parsed.crosslistTrendyolBarcode
        ? { from: 'trendyol' as const, id: parsed.crosslistTrendyolBarcode }
        : null;
    boot.current = { draftId: parsed.draftId, copyFromId: parsed.copyFromId, crosslist, copy };
  }
  const b = boot.current;
  const source = b.crosslist;
  return (
    // A cross-list does not know the Etsy shop: with several shops and no `?shop`, the first one is used.
    <EtsyEditorGate firstShopFallback={Boolean(source)}>
      {(shop) => (source ? <EtsyCrosslistWorkspace key={shop.shopId} shop={shop} boot={b} source={source} /> : <EtsyCreateWorkspace shop={shop} boot={b} copy={b.copy} />)}
    </EtsyEditorGate>
  );
}

export default withAuth(NewEtsyListingPage);

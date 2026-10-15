// components/domain/listing-editor/CatalogEditorRoute.tsx — the Trendyol / Wix / Shopify editor and creator routes
// (marketplace-editors §2, §5; M6b-C). `pages/app/{trendyol,wix,shopify}-urunler/{[id],new}.tsx` render this.
//
// - Store: Wix `?site=`, Shopify `?shop=` (Trendyol has one supplier per account). Resolved through the grid API
//   (`GET /api/listings`), which also answers "not connected" (→ ConnectState).
// - The workspace is the shared `ListingEditor` with the marketplace's adapter (adapters/{trendyol,wix,shopify}.ts)
//   and its section components (M6b-D + CatalogBasicSections). Staged drafts never go live without the footer's
//   explicit Send; a conflict only clears through Review differences; a queued delete needs the type-to-confirm.
// - Start faster: the M6b-D card opens `CatalogCopyPicker`; a pick reloads the creator with `?copy=` / `?crosslist=`.
//   A cross-list price is only pre-filled when its currency is the store's (no silent $25 → ₺25).
// - A create Send whose new id is not numeric (Wix GUID, alphanumeric Trendyol barcode) is moved to the edit route
//   here (the engine only does it for numeric ids), so the create workspace can never stage a second create.
import * as React from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Page } from '@/components/ds/page/Page';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { useToast } from '@/components/ds/feedback/toast';
import { scoreListing, type ShopifyScoreInput, type TrendyolScoreInput, type WixScoreInput } from '@/lib/listingScore';
import type { ScoreResult } from '@/lib/listingScore/types';
import { editorHref, listHref, newListingHref } from '@/lib/listingEditor/editorNav';
import type { CopySourceData, DraftRow, EditorMode, FieldMap, ListingView } from '@/lib/listingEditor/types';
import { ListingEditor, type ListingEditorProps, type SectionComponents } from './ListingEditor';
import type { ListingHealth } from './RailHealth';
import type { ListingEditorAdapter } from './adapters/types';
import { catalogBackHref, CATALOG_DISPLAY_NAME, type CatalogMarketplace } from './adapters/catalog';
import { CatalogCopyPicker, copyPickQuery, type CopyPick } from './CatalogCopyPicker';
import { createStartCardSlot } from './sections/CreateStartCard';
import { fillCredits } from './useListingAI';
import { trendyolAdapter, trendyolScoreInput, type TrendyolEditorFields } from './adapters/trendyol';
import { wixAdapter, wixScoreInput, type WixEditorFields } from './adapters/wix';
import { shopifyAdapter, shopifyScoreInput, type ShopifyEditorFields } from './adapters/shopify';
import { loadEbayCopySource, loadEtsyCrosslistSource } from './adapters/ebay';
import { CATALOG_SECTIONS, CatalogCopyContext } from './catalogSectionMap';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The frame, typed for the catalog marketplaces
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The frame takes the catalog marketplaces directly (integrator frame delta, M6b): brand names, create primary
 * "Send to {marketplace}", store param in ‹ › / Copy links, no preview or profiles for these three, catalog Review
 * differences through `/api/catalog-drafts/:id/{diff,resolve}`, scheduling through `scheduleDraftSend`.
 */
export type CatalogEditorProps<F extends FieldMap> = Omit<ListingEditorProps<F>, 'marketplace'> & { marketplace: CatalogMarketplace };
const CatalogListingEditor = ListingEditor as <F extends FieldMap>(props: CatalogEditorProps<F>) => React.ReactElement;

const ADAPTERS: { [M in CatalogMarketplace]: ListingEditorAdapter<FieldMap> } = {
  trendyol: trendyolAdapter as unknown as ListingEditorAdapter<FieldMap>,
  wix: wixAdapter as unknown as ListingEditorAdapter<FieldMap>,
  shopify: shopifyAdapter as unknown as ListingEditorAdapter<FieldMap>,
};


/** The store query param per marketplace (lib/listingEditor/editorNav.ts STORE_PARAM). */
const STORE_PARAM: Record<CatalogMarketplace, string | null> = { trendyol: null, wix: 'site', shopify: 'shop' };

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Route params (pure, tested)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ID_RE: Record<CatalogMarketplace, RegExp> = {
  // Barcode (stock code when the product has none).
  trendyol: /^[A-Za-z0-9._-]{1,64}$/,
  // Wix product GUID.
  wix: /^[A-Za-z0-9-]{1,64}$/,
  // Shopify numeric product id.
  shopify: /^\d{1,20}$/,
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `[id]` route param → product id, or null when it is not one. */
export function parseCatalogId(marketplace: CatalogMarketplace, raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v && ID_RE[marketplace].test(v) ? v : null;
}

export interface CatalogCreateBootstrap {
  draftId: string | null;
  copyFromId: string | null;
  /** `etsy:<listingId>` / `ebay:<sku>` (Trendyol "Copy an Etsy or eBay listing"). */
  crosslist: { from: 'etsy' | 'ebay'; id: string } | null;
}

export function parseCatalogCreateQuery(marketplace: CatalogMarketplace, q: Record<string, string | string[] | undefined>): CatalogCreateBootstrap {
  const draft = one(q.draft);
  const draftId = typeof draft === 'string' && /^[\w-]{1,64}$/.test(draft) ? draft : null;
  const copyFromId = !draftId ? parseCatalogId(marketplace, one(q.copy)) : null;
  const cross = one(q.crosslist);
  let crosslist: CatalogCreateBootstrap['crosslist'] = null;
  if (!draftId && !copyFromId && typeof cross === 'string') {
    const etsy = /^etsy:(\d{1,20})$/.exec(cross);
    const ebay = /^ebay:([^\u0000-\u001f]{1,50})$/.exec(cross);
    if (etsy) crosslist = { from: 'etsy', id: etsy[1] };
    else if (ebay) crosslist = { from: 'ebay', id: ebay[1].trim() };
  }
  return { draftId, copyFromId, crosslist };
}

/** Latch key of the copy params: a new `?copy=` / `?crosslist=` restarts the creator; `?draft=` alone never does. */
export function copyBootKey(q: Record<string, string | string[] | undefined>): string {
  return `${one(q.copy) ?? ''}|${one(q.crosslist) ?? ''}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Cross-list currency (Etsy / eBay → the store's currency)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure: a cross-list copy keeps its price only when the source currency is known and is the store's; otherwise the
 * price is left blank (the create's price check then asks the seller for one). No conversion.
 */
export function fitCopyToStore(
  copy: CopySourceData | null,
  sourceCurrency: string | null,
  storeCurrency: string | null,
): { copy: CopySourceData | null; priceCleared: boolean } {
  if (!copy || typeof copy.price !== 'number') return { copy, priceCleared: false };
  const same = Boolean(sourceCurrency && storeCurrency && sourceCurrency.trim().toUpperCase() === storeCurrency.trim().toUpperCase());
  if (same) return { copy, priceCleared: false };
  const { price: _drop, ...rest } = copy;
  return { copy: rest as CopySourceData, priceCleared: true };
}

/** The source listing's currency: eBay copy carries it; Etsy is read from its grid row. Null = unknown. */
async function crosslistCurrency(from: 'etsy' | 'ebay', id: string, copy: CopySourceData | null): Promise<string | null> {
  if (from === 'ebay') {
    const c = (copy as { ebay?: { currency?: unknown } } | null)?.ebay?.currency;
    return typeof c === 'string' && c ? c : null;
  }
  try {
    const qs = new URLSearchParams({ marketplace: 'etsy', ids: id });
    const res = await fetch(`/api/listings?${qs.toString()}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = (await res.json()) as { rows?: Array<{ id?: unknown; price?: { currency?: unknown } | null }> };
    const row = (body.rows ?? []).find((r) => r && String(r.id) === id);
    const c = row?.price?.currency;
    return typeof c === 'string' && c ? c : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Health (lib/listingScore/{trendyol,wix,shopify}.ts over the editor view; same rules as RailHealth)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type CatalogScoreInput = TrendyolScoreInput | WixScoreInput | ShopifyScoreInput;

function scoreInputFor(marketplace: CatalogMarketplace, view: ListingView<FieldMap>, fields: FieldMap, useFacts: boolean): CatalogScoreInput {
  const facts = useFacts ? view.facts : {};
  if (marketplace === 'trendyol') return trendyolScoreInput(fields as TrendyolEditorFields, facts, view.meta.raw);
  if (marketplace === 'wix') return wixScoreInput(fields as WixEditorFields, facts);
  return shopifyScoreInput(fields as ShopifyEditorFields, facts);
}

function scoreOf(marketplace: CatalogMarketplace, input: CatalogScoreInput): ScoreResult {
  if (marketplace === 'trendyol') return scoreListing(input as TrendyolScoreInput, 'trendyol');
  if (marketplace === 'wix') return scoreListing(input as WixScoreInput, 'wix');
  return scoreListing(input as ShopifyScoreInput, 'shopify');
}

/** No title and no photo yet: no score ("Add a photo and a title to get a score"). */
function lacksBasis(input: CatalogScoreInput): boolean {
  const hasTitle = typeof input.title === 'string' && input.title.trim() !== '';
  return !hasTitle && !(typeof input.imageCount === 'number' && input.imageCount > 0);
}

/** Pure: the rail's health for a catalog listing (draft view vs the last sent values). */
export function computeCatalogHealth(
  marketplace: CatalogMarketplace,
  view: ListingView<FieldMap>,
  remote: FieldMap | null,
): ListingHealth {
  const input = scoreInputFor(marketplace, view, view.fields, true);
  const result = scoreOf(marketplace, input);
  const sentInput = remote ? scoreInputFor(marketplace, view, remote, false) : null;
  const sentResult = sentInput ? scoreOf(marketplace, sentInput) : null;
  const draftScore = result.checksUsed > 0 && !lacksBasis(input) ? result.score : null;
  const sentScore = sentResult && sentInput && sentResult.checksUsed > 0 && !lacksBasis(sentInput) ? sentResult.score : null;
  if (sentScore === null) return { result, sentResult, score: draftScore, afterScore: null };
  return { result, sentResult, score: sentScore, afterScore: draftScore !== null && draftScore !== sentScore ? draftScore : null };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Store resolution + connect state
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogStore {
  id: string;
  name: string | null;
  currency: string | null;
}

type StoreState =
  | { status: 'loading' }
  | { status: 'ready'; store: CatalogStore }
  | { status: 'not_connected' }
  | { status: 'error' };

/** Resolves the store through the grid API (`?ids=` keeps the body to one row). */
export function useCatalogStore(marketplace: CatalogMarketplace, storeParam: string | null, enabled: boolean, productId: string | null): StoreState & { retry: () => void } {
  const [state, setState] = React.useState<StoreState>({ status: 'loading' });
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    const qs = new URLSearchParams({ marketplace, ids: productId || '-' });
    if (storeParam) qs.set('store', storeParam);
    fetch(`/api/listings?${qs.toString()}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string; store?: { id?: unknown; name?: unknown; currency?: unknown } };
        if (cancelled) return;
        if (res.status === 404 && body?.error === 'not_connected') return setState({ status: 'not_connected' });
        if (!res.ok || !body?.store) return setState({ status: 'error' });
        const s = body.store;
        setState({
          status: 'ready',
          store: {
            id: String(s.id ?? ''),
            name: typeof s.name === 'string' && s.name ? s.name : null,
            currency: typeof s.currency === 'string' && s.currency ? s.currency : null,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [marketplace, storeParam, enabled, productId, nonce]);
  const retry = React.useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The route
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogEditorRouteProps {
  marketplace: CatalogMarketplace;
  mode: EditorMode;
}

export function CatalogEditorRoute({ marketplace, mode }: CatalogEditorRouteProps) {
  const t = useTranslations('listingEditor');
  const router = useRouter();
  const toast = useToast();
  const param = STORE_PARAM[marketplace];
  const storeParam = param ? (one(router.query[param]) ?? null) : null;
  const name = CATALOG_DISPLAY_NAME[marketplace];

  const id = mode === 'edit' ? parseCatalogId(marketplace, router.query.id) : null;
  const invalid = router.isReady && mode === 'edit' && !id;

  // Latched on the first ready query: later shallow URL updates (`?draft=`) must not restart the workspace; a new
  // copy pick (`?copy=` / `?crosslist=`) does.
  const boot = React.useRef<CatalogCreateBootstrap | null>(null);
  const bootKey = React.useRef<string | null>(null);
  if (mode === 'create' && router.isReady) {
    const key = copyBootKey(router.query);
    if (!boot.current || (key !== '|' && key !== bootKey.current)) {
      boot.current = parseCatalogCreateQuery(marketplace, router.query);
      bootKey.current = key;
    }
  }
  const b = boot.current;
  const crossKey = b?.crosslist ? `${b.crosslist.from}:${b.crosslist.id}` : null;
  const [picker, setPicker] = React.useState(false);

  React.useEffect(() => {
    if (!router.isReady) return;
    if (invalid) void router.replace(listHref(marketplace, storeParam));
  }, [invalid, router, marketplace, storeParam]);

  const store = useCatalogStore(marketplace, storeParam, router.isReady && !invalid, id);

  // Cross-list source (Etsy / eBay) loads before the workspace mounts (the engine reads `copy` once).
  const [cross, setCross] = React.useState<{ key: string | null; status: 'idle' | 'loading' | 'done'; copy: CopySourceData | null; currency: string | null }>({
    key: null,
    status: 'idle',
    copy: null,
    currency: null,
  });
  React.useEffect(() => {
    const source = b?.crosslist;
    if (!source || !crossKey || cross.key === crossKey) return;
    setCross({ key: crossKey, status: 'loading', copy: null, currency: null });
    const load = source.from === 'etsy' ? loadEtsyCrosslistSource(source.id) : loadEbayCopySource({ shopId: 'ebay', listingId: source.id });
    load
      .then(async (copy) => {
        if (!copy) toast.error(t('catalog.crosslistFailed'));
        const currency = copy ? await crosslistCurrency(source.from, source.id, copy) : null;
        setCross({ key: crossKey, status: 'done', copy: copy ? { ...copy, source: source.from } : null, currency });
      })
      .catch(() => {
        toast.error(t('catalog.crosslistFailed'));
        setCross({ key: crossKey, status: 'done', copy: null, currency: null });
      });
  }, [b, crossKey, cross.key, toast, t]);

  const storeCurrency = store.status === 'ready' ? store.store.currency : null;
  const fitted = React.useMemo(() => fitCopyToStore(cross.copy, cross.currency, storeCurrency), [cross.copy, cross.currency, storeCurrency]);
  const priceNotice = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (cross.status !== 'done' || store.status !== 'ready' || !fitted.priceCleared || priceNotice.current === cross.key) return;
    priceNotice.current = cross.key;
    toast.info(t('catalog.crosslistPriceCleared', { currency: storeCurrency || '' }));
  }, [cross.status, cross.key, store.status, fitted.priceCleared, storeCurrency, toast, t]);

  // Navigation after a create (route's own target; also used for ids the engine does not move, see the header).
  const createdNav = React.useRef<(createdId: string) => void>(() => undefined);
  const adapter = React.useMemo<ListingEditorAdapter<FieldMap>>(() => {
    const base = ADAPTERS[marketplace];
    if (mode !== 'create') return base;
    return {
      ...base,
      async send(draft, opts) {
        const result = await base.send(draft, opts);
        const created = result.listingId;
        // The engine calls onCreated for numeric ids only; every other real id moves to the edit route here.
        if (created && !result.deleted && !created.startsWith('-') && !(Number(created) > 0)) createdNav.current(created);
        return result;
      },
    };
  }, [marketplace, mode]);

  const health = React.useCallback(
    (view: ListingView<FieldMap>, remote: FieldMap | null) => computeCatalogHealth(marketplace, view, remote),
    [marketplace],
  );

  if (!router.isReady || invalid) return null;
  const pageTitle = mode === 'create' ? t('common.newProduct') : t('page.editTitle');
  if (store.status === 'not_connected') {
    return (
      <Page title={pageTitle} width="detail" backHref={listHref(marketplace, null)}>
        <ConnectState
          brand={marketplace}
          title={t('catalog.connectTitle', { marketplace })}
          body={t('catalog.connectBody')}
          connectHref="/ayarlar?tab=connections"
        />
      </Page>
    );
  }
  if (store.status === 'error') {
    return (
      <Page title={pageTitle} width="detail" backHref={listHref(marketplace, storeParam)}>
        <ErrorState variant="page" title={t('catalog.storeFailed', { marketplace: name })} onRetry={store.retry} />
      </Page>
    );
  }
  if (store.status !== 'ready') return null;
  if (mode === 'create' && crossKey && (cross.key !== crossKey || cross.status !== 'done')) return null;

  const storeId = store.store.id;
  // Links carry the store param only where the marketplace has several stores.
  const linkStore = param ? storeId : null;
  const goCreated = (createdId: string) => void router.replace(editorHref(marketplace, createdId, linkStore));
  createdNav.current = goCreated;
  const onPick = (pick: CopyPick) => {
    setPicker(false);
    void router.replace(newListingHref(marketplace, linkStore, copyPickQuery(marketplace, pick)));
  };
  const startFaster =
    mode === 'create'
      ? createStartCardSlot({
          marketplace,
          onCopy: () => setPicker(true),
          // Trendyol: the cross-list copy writes a Turkish title + description (AI proposals, M6b-E fillListing).
          credits: marketplace === 'trendyol' ? fillCredits('trendyol') : undefined,
        })
      : () => null;
  const common = {
    marketplace,
    adapter,
    shopId: storeId,
    shopName: store.store.name,
    backHref: catalogBackHref(marketplace, linkStore),
    sections: CATALOG_SECTIONS[marketplace] as SectionComponents,
    // Trendyol AI reaches its sections through their own `useListingAI('trendyol')` (catalogSectionMap).
    sectionProps: {},
    health,
    slots: { startFaster },
    onCreated: goCreated,
  };

  if (mode === 'edit' && id) {
    return (
      <CatalogListingEditor<FieldMap>
        key={`${storeId}:${id}`}
        {...common}
        mode="edit"
        listingId={id}
      />
    );
  }
  return (
    <CatalogCopyContext.Provider value={{ translateCopy: marketplace === 'trendyol' && Boolean(crossKey) && !b?.draftId }}>
      <CatalogListingEditor<FieldMap>
        key={`${storeId}:new:${b?.copyFromId ?? ''}:${crossKey ?? ''}`}
        {...common}
        mode="create"
        listingId={null}
        draftId={b?.draftId ?? null}
        copyFromId={b?.copyFromId ?? null}
        copy={fitted.copy}
        onDraftCreated={(draft: DraftRow) =>
          void router.replace(newListingHref(marketplace, linkStore, { draft: draft.id }), undefined, { shallow: true })
        }
      />
      <CatalogCopyPicker open={picker} marketplace={marketplace} storeId={linkStore} onClose={() => setPicker(false)} onPick={onPick} />
    </CatalogCopyContext.Provider>
  );
}

export default CatalogEditorRoute;

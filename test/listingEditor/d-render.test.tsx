// @vitest-environment jsdom
// Group D (listing-editor §10) render tests, EN + TR with strict i18n (a missing key throws):
//  - embedded sub-editors: no own save button, DS chrome, staging only through stage(), server-draft overlay,
//    eBay variants staged as drafts (never written to eBay), entity-decoded text;
//  - sections inside a fake editor context: collapsed summary from the staged draft, facts for the frame,
//    registration with the autosave engine, mobile full-height sheet, item-specifics AI proposals that only fill.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import type { DraftSection, ListingFacts } from '@/lib/listingEditor/types';
import { setViewport } from '../ds/m1e-helpers';
import { withD, type Locale } from './d-messages';

const stageEtsyDraft = vi.fn(async (_input: unknown) => ({ id: 'd1' }));
const fetchEtsyDrafts = vi.fn(async (_shop: string, _listing?: string | number): Promise<unknown[]> => []);
vi.mock('@/lib/etsy/draftClient', () => ({
  stageEtsyDraft: (i: unknown) => stageEtsyDraft(i),
  fetchEtsyDrafts: (s: string, l?: string | number) => fetchEtsyDrafts(s, l),
}));
const stageEbayDraft = vi.fn(async (_input: unknown) => ({ id: 'e1' }));
const fetchEbayDrafts = vi.fn(async (_sku?: string): Promise<unknown[]> => []);
vi.mock('@/lib/ebay/draftClient', () => ({
  stageEbayDraft: (i: unknown) => stageEbayDraft(i),
  fetchEbayDrafts: (s?: string) => fetchEbayDrafts(s),
}));
vi.mock('@/components/stock/useStockManaged', () => ({
  useStockManaged: () => ({ managed: false, live: false, variants: [], get: () => undefined }),
}));

import PersonalizationEditor, { type PersonalizationEditorHandle } from '@/components/etsy/PersonalizationEditor';
import EtsyVariationEditor, { type VariationEditorHandle } from '@/components/etsy/VariationEditor';
import EbayVariationEditor, { type EbayVariationEditorHandle } from '@/components/ebay/VariationEditor';
import ItemSpecificsEditor from '@/components/ebay/ItemSpecificsEditor';
import ConditionSelector from '@/components/ebay/ConditionSelector';
import { VariationsSection } from '@/components/domain/listing-editor/sections/VariationsSection';
import { PersonalizationSection } from '@/components/domain/listing-editor/sections/PersonalizationSection';
import { SpecificsSection, type SpecificsAi } from '@/components/domain/listing-editor/sections/SpecificsSection';
import { encodeAspects } from '@/components/domain/listing-editor/adapters/ebay';

// ── harness ──────────────────────────────────────────────────────────────────────────────────────────────

function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={withD(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </NextIntlClientProvider>
  );
}

function renderD(ui: React.ReactElement, locale: Locale = 'en', ctx?: ListingEditorContextValue) {
  return render(
    <Providers locale={locale}>
      {ctx ? <ListingEditorContext.Provider value={ctx}>{ui}</ListingEditorContext.Provider> : ui}
    </Providers>,
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const action = u.searchParams.get('action') ?? '';
    const sku = u.searchParams.get('sku') ?? '';
    const key = `${action}:${sku}`;
    if (key in routes) {
      const v = routes[key];
      return v instanceof Response ? v : json(v);
    }
    if (action in routes) {
      const v = routes[action];
      return v instanceof Response ? v : json(v);
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

interface Harness {
  setField: ReturnType<typeof vi.fn>;
  reportFacts: ReturnType<typeof vi.fn>;
  notifyChange: ReturnType<typeof vi.fn>;
  reloadDraft: ReturnType<typeof vi.fn>;
  registered: DraftSection[];
}

function makeCtx(over: {
  marketplace?: 'etsy' | 'ebay';
  mode?: 'edit' | 'create';
  listingId?: string | null;
  fields?: Record<string, unknown>;
  remote?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  draft?: Record<string, unknown> | null;
  facts?: ListingFacts;
  draftCheckFailed?: boolean;
} = {}): { value: ListingEditorContextValue; h: Harness } {
  const h: Harness = { setField: vi.fn(), reportFacts: vi.fn(), notifyChange: vi.fn(), reloadDraft: vi.fn(async () => null), registered: [] };
  const marketplace = over.marketplace ?? 'etsy';
  const mode = over.mode ?? 'edit';
  const listingId = over.listingId === undefined ? '1488' : over.listingId;
  const value = {
    marketplace,
    marketplaceName: marketplace === 'etsy' ? 'Etsy' : 'eBay',
    mode,
    ctx: { shopId: 's1', listingId },
    view: { marketplace, mode, fields: over.fields ?? { taxonomy_id: 3 }, meta: { id: listingId, currency: 'USD', images: [], ...over.meta }, facts: over.facts ?? {} },
    remote: over.remote === undefined ? (over.fields ?? null) : over.remote,
    draft: over.draft ?? null,
    draftCheckFailed: over.draftCheckFailed ?? false,
    issues: [],
    readOnly: false,
    setField: h.setField,
    reportFacts: h.reportFacts,
    notifyChange: h.notifyChange,
    reloadDraft: h.reloadDraft,
    register: (s: DraftSection) => { h.registered.push(s); return () => { h.registered = h.registered.filter((x) => x !== s); }; },
  } as unknown as ListingEditorContextValue;
  return { value, h };
}

const offering = (amount: number, quantity: number, enabled = true) => ({ offering_id: 1, price: { amount, divisor: 100, currency_code: 'USD' }, quantity, is_enabled: enabled });
const etsyProducts = [
  { product_id: 11, sku: '', property_values: [{ property_id: 200, property_name: 'Color', values: ['Pink'], scale_id: null }], offerings: [offering(5400, 3)] },
  { product_id: 12, sku: '', property_values: [{ property_id: 200, property_name: 'Color', values: ['Mom&#39;s Blue'], scale_id: null }], offerings: [offering(6900, 2)] },
];

beforeEach(() => {
  setViewport('desktop');
  stageEtsyDraft.mockClear();
  fetchEtsyDrafts.mockReset();
  fetchEtsyDrafts.mockImplementation(async () => []);
  stageEbayDraft.mockClear();
  fetchEbayDrafts.mockReset();
  fetchEbayDrafts.mockImplementation(async () => []);
  mockFetch({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── PersonalizationEditor (embedded) ─────────────────────────────────────────────────────────────────────

const legacyOff = { is_personalizable: false, personalization_is_required: false, personalization_instructions: '', personalization_char_count_max: 0 };

describe.each<Locale>(['en', 'tr'])('PersonalizationEditor embedded (%s)', (locale) => {
  it('has no own save button and stages the legacy payload only through stage()', async () => {
    const ref = React.createRef<PersonalizationEditorHandle>();
    const onChange = vi.fn();
    renderD(<PersonalizationEditor ref={ref} embedded listingId="1488" shopId="s1" questions={[]} legacy={legacyOff} onChange={onChange} />, locale);
    expect(screen.getByTestId('personalization-editor-embedded')).toBeTruthy();
    expect(screen.queryByText(locale === 'en' ? 'Save' : 'Kaydet')).toBeNull();
    expect(ref.current!.isDirty()).toBe(false);

    fireEvent.click(screen.getByRole('switch'));
    const q = screen.getByTestId('personalization-question-1');
    const input = within(q).getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Name to embroider' } });
    expect(ref.current!.isDirty()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(stageEtsyDraft).not.toHaveBeenCalled();

    await act(async () => { await ref.current!.stage(); });
    expect(stageEtsyDraft).toHaveBeenCalledTimes(1);
    expect(stageEtsyDraft.mock.calls[0][0]).toEqual({
      shopId: 's1',
      listingId: '1488',
      personalization: { personalization_questions: [{ question_type: 'text_input', question_text: 'Name to embroider', required: false, max_allowed_characters: 256 }] },
    });
    expect(ref.current!.isDirty()).toBe(false);
    await act(async () => { await ref.current!.stage(); });
    expect(stageEtsyDraft).toHaveBeenCalledTimes(1);
  });

  it('overlays the staged draft (remove) over live questions and decodes entities', () => {
    const live = [{ question_type: 'text_input' as const, question_text: 'Baby&#39;s name', required: true, max_allowed_characters: 20 }];
    const { unmount } = renderD(
      <PersonalizationEditor embedded listingId="1" shopId="s1" questions={live} legacy={legacyOff} draftPatch={{ remove: true }} />,
      locale,
    );
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
    unmount();
    renderD(<PersonalizationEditor embedded listingId="1" shopId="s1" questions={live} legacy={legacyOff} />, locale);
    expect((within(screen.getByTestId('personalization-question-1')).getAllByRole('textbox')[0] as HTMLInputElement).value).toBe("Baby's name");
    expect(document.body.textContent).not.toContain('&#39;');
  });
});

// ── Etsy VariationEditor (embedded) ──────────────────────────────────────────────────────────────────────

function etsyRoutes(extra: Record<string, unknown> = {}) {
  return mockFetch({
    get_listing_inventory: { products: etsyProducts, price_on_property: [200] },
    get_variation_images: { results: [] },
    get_listing_images: { images: [] },
    get_taxonomy_properties: { results: [] },
    ...extra,
  });
}

describe.each<Locale>(['en', 'tr'])('Etsy VariationEditor embedded (%s)', (locale) => {
  it('DS tabs without the dead Processing tab, no own save button, decoded values', async () => {
    etsyRoutes();
    renderD(<EtsyVariationEditor embedded listingId="1488" shopId="s1" />, locale);
    await screen.findByTestId('variation-editor-embedded');
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toHaveLength(6);
    expect(document.body.textContent).toContain("Mom's Blue");
    expect(document.body.textContent).not.toContain('&#39;');
    // No legacy "Save to Etsy" bar.
    expect(screen.queryAllByRole('button').some((b) => /Etsy/.test(b.textContent ?? ''))).toBe(false);
  });

  it('loads the pending draft first (overlay), stages inventory with the restock marker, then is clean', async () => {
    etsyRoutes();
    const staged = [{ ...etsyProducts[0], offerings: [offering(5400, 9)], kx_loaded_quantity: 3 }, etsyProducts[1]];
    fetchEtsyDrafts.mockImplementation(async () => [{ id: 'd1', status: 'draft', inventoryPatch: { products: staged, price_on_property: [200] } }]);
    const ref = React.createRef<VariationEditorHandle>();
    const onSummary = vi.fn();
    renderD(<EtsyVariationEditor ref={ref} embedded listingId="1488" shopId="s1" onSummaryChange={onSummary} />, locale);
    await screen.findByTestId('variation-editor-embedded');
    await waitFor(() => expect(onSummary).toHaveBeenCalled());
    expect(onSummary.mock.calls.at(-1)![0]).toMatchObject({ variations: 1, combinations: 2, totalQuantity: 11 });
    expect(ref.current!.isDirty()).toBe(false);

    // Visibility tab → turn the first variation off.
    fireEvent.click(screen.getAllByRole('tab')[4]);
    const boxes = document.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(boxes[0]);
    expect(ref.current!.isDirty()).toBe(true);
    await act(async () => { await ref.current!.stage(); });
    expect(stageEtsyDraft).toHaveBeenCalledTimes(1);
    const body = stageEtsyDraft.mock.calls[0][0] as { inventory: { products: Array<{ kx_loaded_quantity?: number; offerings: Array<{ is_enabled: boolean }> }> } };
    expect(body.inventory.products[0].offerings[0].is_enabled).toBe(false);
    expect(body.inventory.products[0].kx_loaded_quantity).toBe(3);
    expect('variationImages' in (body as object)).toBe(false);
    expect(ref.current!.isDirty()).toBe(false);
    expect(ref.current!.validate()).toEqual([]);
  });

  it('a failed draft check blocks editing instead of overwriting an unseen draft', async () => {
    etsyRoutes();
    fetchEtsyDrafts.mockImplementation(async () => { throw new Error('HTTP 500'); });
    const ref = React.createRef<VariationEditorHandle>();
    renderD(<EtsyVariationEditor ref={ref} embedded listingId="1488" shopId="s1" />, locale);
    await screen.findByTestId('variation-editor-error');
    expect(ref.current!.isDirty()).toBe(false);
    await act(async () => { await ref.current!.stage(); });
    expect(stageEtsyDraft).not.toHaveBeenCalled();
  });

  it('decodes entities on load: a price-only edit stages a payload with no entity in it', async () => {
    etsyRoutes();
    const ref = React.createRef<VariationEditorHandle>();
    renderD(<EtsyVariationEditor ref={ref} embedded listingId="1488" shopId="s1" />, locale);
    await screen.findByTestId('variation-editor-embedded');
    expect(ref.current!.isDirty()).toBe(false);
    // Visibility tab → turn a variation off (no value edited).
    fireEvent.click(screen.getAllByRole('tab')[4]);
    fireEvent.click(document.querySelectorAll('input[type="checkbox"]')[0]);
    await act(async () => { await ref.current!.stage(); });
    expect(stageEtsyDraft).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(stageEtsyDraft.mock.calls[0][0]);
    expect(sent).not.toContain('&#');
    expect(sent).toContain("Mom's Blue");
    // Restock marker still matched the (encoded) live product.
    const body = stageEtsyDraft.mock.calls[0][0] as { inventory: { products: Array<{ kx_loaded_quantity?: number }> } };
    expect(body.inventory.products.map((p) => p.kx_loaded_quantity)).toEqual([3, 2]);
  });
});

// ── eBay VariationEditor (embedded) ──────────────────────────────────────────────────────────────────────

describe.each<Locale>(['en', 'tr'])('eBay VariationEditor embedded (%s)', (locale) => {
  it('default embedded mode is read-only: live values, no draft overlay, nothing staged (Send cannot carry variant drafts yet)', async () => {
    mockFetch({
      'get_inventory_item_group:PARENT': { variantSKUs: ['V1'] },
      'listing:V1': { product: { title: 'Blanket Pink' }, offers: [{ offerId: 'o1', status: 'PUBLISHED', pricingSummary: { price: { value: '10.00', currency: 'USD' } } }], availability: { shipToLocationAvailability: { quantity: 4 } } },
    });
    fetchEbayDrafts.mockImplementation(async () => [{ sku: 'V1', status: 'draft', inventoryPatch: { availability: { shipToLocationAvailability: { quantity: 7 } } } }]);
    const ref = React.createRef<EbayVariationEditorHandle>();
    renderD(<EbayVariationEditor ref={ref} embedded sku="PARENT" userId="" />, locale);
    await screen.findByTestId('ebay-variations-embedded');
    expect(fetchEbayDrafts).not.toHaveBeenCalled();
    const v1 = screen.getByTestId('ebay-variant-V1');
    const inputs = within(v1).getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs.slice(-1)[0].value).toBe('4');
    expect(inputs.every((i) => i.disabled)).toBe(true);
    expect(screen.getByTestId('ebay-variations-hint').textContent).toBe(
      locale === 'en' ? "Price and stock per variation can't be sent from here yet. Change them on eBay" : "Varyasyon başına fiyat ve stok henüz buradan gönderilemiyor. eBay'de değiştirin",
    );
    expect(ref.current!.isDirty()).toBe(false);
    await act(async () => { await ref.current!.stage(); });
    expect(stageEbayDraft).not.toHaveBeenCalled();
  });

  it('stages each changed variant as its own draft and never writes to eBay (opt-in)', async () => {
    const fetchFn = mockFetch({
      'get_inventory_item_group:PARENT': { variantSKUs: ['V1', 'V2'] },
      'listing:V1': { product: { title: 'Blanket Pink' }, offers: [{ offerId: 'o1', status: 'PUBLISHED', pricingSummary: { price: { value: '10.00', currency: 'USD' } } }], availability: { shipToLocationAvailability: { quantity: 4 } } },
      'listing:V2': { product: { title: 'Blanket Blue' }, offers: [{ offerId: 'o2', status: 'PUBLISHED', pricingSummary: { price: { value: '12.00', currency: 'USD' } } }], availability: { shipToLocationAvailability: { quantity: 1 } } },
    });
    fetchEbayDrafts.mockImplementation(async () => [{ sku: 'V2', status: 'draft', inventoryPatch: { availability: { shipToLocationAvailability: { quantity: 7 } } } }]);
    const ref = React.createRef<EbayVariationEditorHandle>();
    renderD(<EbayVariationEditor ref={ref} embedded stageVariantDrafts sku="PARENT" userId="" />, locale);
    await screen.findByTestId('ebay-variations-embedded');
    // Overlay: V2 shows the staged quantity.
    const v2 = screen.getByTestId('ebay-variant-V2');
    expect((within(v2).getAllByRole('textbox').slice(-1)[0] as HTMLInputElement).value).toBe('7');
    expect(ref.current!.relatedDraftSkus()).toEqual(['V2']);

    const v1 = screen.getByTestId('ebay-variant-V1');
    const qty = within(v1).getAllByRole('textbox').slice(-1)[0] as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '6' } });
    fireEvent.blur(qty);
    expect(ref.current!.isDirty()).toBe(true);
    await act(async () => { await ref.current!.stage(); });
    expect(stageEbayDraft).toHaveBeenCalledWith({
      sku: 'V1', offerId: 'o1', inventoryFields: { availability: { shipToLocationAvailability: { quantity: 6 } } }, offerFields: undefined,
    });
    expect(ref.current!.isDirty()).toBe(false);
    expect(ref.current!.relatedDraftSkus().sort()).toEqual(['V1', 'V2']);
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes('update_inventory_item'))).toBe(false);
  });

  it('shows the empty state when the listing has no variation group', async () => {
    mockFetch({ 'get_inventory_item_group:SOLO': new Response('{}', { status: 404 }) });
    renderD(<EbayVariationEditor embedded sku="SOLO" userId="" />, locale);
    expect(await screen.findByTestId('ebay-variations-empty')).toBeTruthy();
  });
});

// ── ItemSpecificsEditor / ConditionSelector (embedded) ───────────────────────────────────────────────────

describe.each<Locale>(['en', 'tr'])('eBay specifics + condition embedded (%s)', (locale) => {
  it('groups required, recommended and own specifics and writes through onChange', () => {
    const onChange = vi.fn();
    renderD(
      <ItemSpecificsEditor
        embedded
        aspects={{ Brand: ['Acme'], Gift: ['Yes'] }}
        requiredAspects={[{ localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } }]}
        recommendedAspects={[{ localizedAspectName: 'Color', aspectConstraint: { aspectRequired: false, aspectMode: 'SELECTION_ONLY', aspectValues: [{ localizedValue: 'Pink' }] } }]}
        onChange={onChange}
      />,
      locale,
    );
    expect(screen.getByTestId('item-specifics-count').textContent).toBe(locale === 'en' ? '2 of 3 filled' : '3 özellikten 2 tanesi dolu');
    const brand = within(screen.getByTestId('aspect-Brand')).getByRole('textbox') as HTMLInputElement;
    expect(brand.value).toBe('Acme');
    fireEvent.change(brand, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ Gift: ['Yes'] });
  });

  it('condition: switching to New clears the description', () => {
    const onChange = vi.fn();
    renderD(<ConditionSelector embedded condition="USED_EXCELLENT" conditionDescription="Light wear" onChange={onChange} />, locale);
    expect(screen.getByTestId('condition-selector-embedded')).toBeTruthy();
    const area = screen.getAllByRole('textbox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: 'Light wear on the lid' } });
    expect(onChange).toHaveBeenLastCalledWith('USED_EXCELLENT', 'Light wear on the lid');
  });
});

// ── Sections in the editor context ───────────────────────────────────────────────────────────────────────

describe.each<Locale>(['en', 'tr'])('VariationsSection (%s)', (locale) => {
  it('edit mode starts collapsed with the staged summary, reports the price range, registers, expands in place', async () => {
    const fetchFn = etsyRoutes();
    const { value, h } = makeCtx({ draft: { id: 'd1', status: 'draft', inventoryPatch: { products: etsyProducts } } });
    renderD(<VariationsSection id="variations" />, locale, value);
    const row = await screen.findByTestId('le-variations-summary');
    expect(row.textContent).toContain(locale === 'en' ? '1 variation · 2 combinations' : '1 varyasyon · 2 kombinasyon');
    // Collapsed summary came from the draft: no inventory request yet.
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes('get_listing_inventory'))).toBe(false);
    expect(h.reportFacts).toHaveBeenCalledWith({ variations: { count: 1, combinations: 2, priceRange: { min: 54, max: 69 } } });
    expect(h.registered.map((s) => s.id)).toEqual(['variations']);
    expect(h.registered[0].isDirty()).toBe(false);

    fireEvent.click(within(row).getByRole('button'));
    expect(await screen.findByTestId('variation-editor-embedded')).toBeTruthy();
  });

  it('mobile: the editor opens in a full-height sheet with Cancel / Done', async () => {
    setViewport('mobile');
    etsyRoutes();
    const { value } = makeCtx({ draft: { id: 'd1', status: 'draft', inventoryPatch: { products: etsyProducts } } });
    renderD(<VariationsSection id="variations" />, locale, value);
    fireEvent.click(within(await screen.findByTestId('le-variations-summary')).getByRole('button'));
    const sheet = await screen.findByTestId('le-variations-sheet');
    expect(within(sheet).getByText(locale === 'en' ? 'Done' : 'Tamam')).toBeTruthy();
    expect(within(sheet).getByText(locale === 'en' ? 'Cancel' : 'İptal')).toBeTruthy();
  });

  it('mobile: edits in the open sheet stay out of autosave, and Cancel drops them without staging', async () => {
    setViewport('mobile');
    etsyRoutes();
    const { value, h } = makeCtx();
    renderD(<VariationsSection id="variations" />, locale, value);
    fireEvent.click(within(await screen.findByTestId('le-variations-summary')).getByRole('button'));
    const sheet = await screen.findByTestId('le-variations-sheet');
    await within(sheet).findByTestId('variation-editor-embedded');
    fireEvent.click(within(sheet).getAllByRole('tab')[4]);
    fireEvent.click(sheet.querySelectorAll('input[type="checkbox"]')[0]);
    // Held: the engine sees a clean section, so its 1.5s autosave stages nothing, and no change is announced.
    const section = h.registered.find((s) => s.id === 'variations')!;
    expect(section.isDirty()).toBe(false);
    expect(h.notifyChange).not.toHaveBeenCalled();
    await act(async () => { await section.stage(); });
    expect(stageEtsyDraft).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByText(locale === 'en' ? 'Cancel' : 'İptal'));
    await waitFor(() => expect(h.notifyChange).toHaveBeenCalled());
    expect(section.isDirty()).toBe(false);
    expect(stageEtsyDraft).not.toHaveBeenCalled();
  });

  it('mobile: Done stages the sheet edits and releases the hold', async () => {
    setViewport('mobile');
    etsyRoutes();
    const { value, h } = makeCtx();
    renderD(<VariationsSection id="variations" />, locale, value);
    fireEvent.click(within(await screen.findByTestId('le-variations-summary')).getByRole('button'));
    const sheet = await screen.findByTestId('le-variations-sheet');
    await within(sheet).findByTestId('variation-editor-embedded');
    fireEvent.click(within(sheet).getAllByRole('tab')[4]);
    fireEvent.click(sheet.querySelectorAll('input[type="checkbox"]')[0]);
    expect(h.registered.find((s) => s.id === 'variations')!.isDirty()).toBe(false);
    fireEvent.click(within(sheet).getByText(locale === 'en' ? 'Done' : 'Tamam'));
    await waitFor(() => expect(stageEtsyDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.notifyChange).toHaveBeenCalled());
    expect(h.reloadDraft).toHaveBeenCalled();
  });

  it('discard (engine reset) remounts the editor from the live inventory instead of the discarded draft', async () => {
    etsyRoutes();
    const staged = [{ ...etsyProducts[0], offerings: [offering(5400, 9)] }];
    fetchEtsyDrafts.mockImplementation(async () => [{ id: 'd1', status: 'draft', inventoryPatch: { products: staged } }]);
    const { value, h } = makeCtx({ draft: { id: 'd1', status: 'draft', inventoryPatch: { products: staged } } });
    renderD(<VariationsSection id="variations" />, locale, value);
    fireEvent.click(within(await screen.findByTestId('le-variations-summary')).getByRole('button'));
    await screen.findByTestId('variation-editor-embedded');
    await waitFor(() => expect(h.reportFacts).toHaveBeenLastCalledWith({ variations: expect.objectContaining({ combinations: 1 }) }));

    // The engine deleted the draft, then resets every section.
    fetchEtsyDrafts.mockImplementation(async () => []);
    const section = h.registered.find((s) => s.id === 'variations')!;
    act(() => { section.reset?.(); });
    await waitFor(() => expect(h.reportFacts).toHaveBeenLastCalledWith({ variations: expect.objectContaining({ combinations: 2 }) }));
    expect(h.registered.find((s) => s.id === 'variations')!.isDirty()).toBe(false);
    expect(stageEtsyDraft).not.toHaveBeenCalled();
  });

  it('eBay: variations are view-only (no staging that Send would not carry)', async () => {
    mockFetch({ 'get_inventory_item_group:SKU1': { variantSKUs: ['V1', 'V2'] } });
    const { value, h } = makeCtx({ marketplace: 'ebay', listingId: 'SKU1' });
    renderD(<VariationsSection id="variations" />, locale, value);
    const row = await screen.findByTestId('le-variations-summary');
    await waitFor(() => expect(row.textContent).toContain(locale === 'en' ? '2 variations' : '2 varyasyon'));
    expect(within(row).getByRole('button').textContent).toBe(locale === 'en' ? 'View' : 'Görüntüle');
    const section = h.registered.find((s) => s.id === 'variations')!;
    expect(section.isDirty()).toBe(false);
    expect(section.changes?.()).toEqual([]);
  });

  it('blank create has nothing to stage into yet', () => {
    const { value } = makeCtx({ mode: 'create', listingId: null });
    renderD(<VariationsSection id="variations" />, locale, value);
    expect(screen.getByTestId('le-section-variations').textContent).toContain(locale === 'en' ? 'once this new listing is saved' : 'yeni ilan kaydedildikten sonra');
  });
});

describe.each<Locale>(['en', 'tr'])('PersonalizationSection (%s)', (locale) => {
  it('collapsed "On · Required · 1 question", fact reported, registered', () => {
    const { value, h } = makeCtx({
      meta: { personalization: { is_personalizable: true, personalization_questions: [{ question_type: 'text_input', question_text: 'Name', required: true, max_allowed_characters: 20 }] } },
    });
    renderD(<PersonalizationSection id="personalization" />, locale, value);
    expect(screen.getByTestId('le-personalization-summary').textContent).toContain(locale === 'en' ? 'On · Required · 1 question' : 'Açık · Zorunlu · 1 soru');
    expect(h.reportFacts).toHaveBeenCalledWith({ personalization: { enabled: true, required: true, questions: 1 } });
    expect(h.registered.map((s) => s.id)).toEqual(['personalization']);
  });

  it('a failed draft check blocks the editor until Retry (never stages over an unseen draft)', async () => {
    const { value, h } = makeCtx({
      draftCheckFailed: true,
      meta: { personalization: { is_personalizable: false, personalization_questions: [] } },
    });
    renderD(<PersonalizationSection id="personalization" />, locale, value);
    const err = screen.getByTestId('le-personalization-draft-check-failed');
    expect(err.textContent).toContain(locale === 'en' ? "Couldn't check for unsent personalization changes" : 'Gönderilmemiş kişiselleştirme değişiklikleri kontrol edilemedi');
    expect(screen.queryByRole('switch')).toBeNull();
    const section = h.registered.find((s) => s.id === 'personalization')!;
    expect(section.isDirty()).toBe(false);
    await act(async () => { await section.stage(); });
    expect(stageEtsyDraft).not.toHaveBeenCalled();
    fireEvent.click(within(err).getByRole('button'));
    await waitFor(() => expect(h.reloadDraft).toHaveBeenCalled());
  });

  it('discard (engine reset) remounts from the live questions, not the discarded staged patch', () => {
    const live = { personalization: { is_personalizable: false, personalization_questions: [] } };
    const staged = { personalization_questions: [{ question_type: 'text_input', question_text: 'Name', required: false, max_allowed_characters: 20 }] };
    const { value, h } = makeCtx({ meta: live, draft: { id: 'd1', status: 'draft', personalizationPatch: staged } });
    const { rerender } = renderD(<PersonalizationSection id="personalization" />, locale, value);
    // Desktop: "On · …" collapsed row; open it.
    fireEvent.click(within(screen.getByTestId('le-personalization-summary')).getByRole('button'));
    expect((screen.getAllByRole('switch')[0] as HTMLInputElement).checked).toBe(true);
    // Engine: draft deleted, every section reset, draft cleared in the same tick.
    const section = h.registered.find((s) => s.id === 'personalization')!;
    act(() => {
      section.reset?.();
      rerender(
        <Providers locale={locale}>
          <ListingEditorContext.Provider value={{ ...value, draft: null } as ListingEditorContextValue}>
            <PersonalizationSection id="personalization" />
          </ListingEditorContext.Provider>
        </Providers>,
      );
    });
    expect((screen.getAllByRole('switch')[0] as HTMLInputElement).checked).toBe(false);
    expect(h.registered.find((s) => s.id === 'personalization')!.isDirty()).toBe(false);
  });

  it('off: the switch shows inline (no summary row)', () => {
    const { value } = makeCtx({ meta: { personalization: { is_personalizable: false, personalization_questions: [] } } });
    renderD(<PersonalizationSection id="personalization" />, locale, value);
    expect(screen.queryByTestId('le-personalization-summary')).toBeNull();
    expect(screen.getByRole('switch')).toBeTruthy();
  });
});

describe.each<Locale>(['en', 'tr'])('SpecificsSection (%s)', (locale) => {
  const ebayFields = (aspects: Record<string, string[]>, categoryId = '123') => ({ aspects: encodeAspects(aspects), categoryId });

  it('asks for a category first', () => {
    const { value } = makeCtx({ marketplace: 'ebay', listingId: 'SKU1', fields: ebayFields({}, '') });
    renderD(<SpecificsSection id="specifics" />, locale, value);
    expect(screen.getByTestId('specifics-no-category')).toBeTruthy();
  });

  it('loads aspects for the category and AI proposals only fill on Use', async () => {
    mockFetch({
      item_aspects: { aspects: [
        { localizedAspectName: 'Brand', aspectConstraint: { aspectRequired: true, aspectMode: 'FREE_TEXT' } },
        { localizedAspectName: 'Color', aspectConstraint: { aspectRequired: false, aspectMode: 'FREE_TEXT' } },
      ] },
    });
    const { value, h } = makeCtx({ marketplace: 'ebay', listingId: 'SKU1', fields: ebayFields({ Brand: ['Acme'] }) });
    const ai: SpecificsAi = { run: vi.fn(), loading: false, proposals: { Brand: ['Acme'], Color: ['Pink'], Junk: ['x'.repeat(80)] }, dismiss: vi.fn() };
    renderD(<SpecificsSection id="specifics" ai={ai} />, locale, value);
    await screen.findByTestId('item-specifics-embedded');
    expect(h.reportFacts).toHaveBeenCalledWith({ attributes: { required: 1, filled: 1 } });
    const proposals = screen.getByTestId('specifics-proposals');
    // Brand is already Acme, Junk is over 65 characters: only Color is proposed.
    expect(within(proposals).queryByTestId('specifics-proposal-Brand')).toBeNull();
    expect(within(proposals).queryByTestId('specifics-proposal-Junk')).toBeNull();
    expect(h.setField).not.toHaveBeenCalled();
    const color = within(proposals).getByTestId('specifics-proposal-Color');
    fireEvent.click(within(color).getByText(locale === 'en' ? 'Use' : 'Kullan'));
    expect(h.setField).toHaveBeenCalledWith('aspects', encodeAspects({ Brand: ['Acme'], Color: ['Pink'] }));
  });
});

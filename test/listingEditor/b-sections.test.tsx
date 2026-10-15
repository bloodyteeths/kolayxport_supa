// @vitest-environment jsdom
// Group B (listing-editor §10) render tests: the Etsy field sections inside a fake editor context, EN + TR,
// strict i18n (a missing key throws). Covers entity decoding, dirty/revert, AI proposals that only fill the
// field, tag rules, price band "Use", variations read-only, category details staging through the engine
// registration (drawer payload), and staged create actions surviving a reload.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import type { DraftRow, DraftSection, EtsyEditorFields, FieldIssue, ListingFacts } from '@/lib/listingEditor/types';
import { withB, type Locale } from './b-messages';
import trMessages from '@/messages/tr.json';

const trFormField = (trMessages as unknown as { ds: { inputs: { formField: Record<string, string> } } }).ds.inputs.formField;

const stageEtsyDraft = vi.fn(async (_input: unknown) => ({ id: 'd1' }));
vi.mock('@/lib/etsy/draftClient', () => ({ stageEtsyDraft: (i: unknown) => stageEtsyDraft(i) }));
vi.mock('@/components/stock/useStockManaged', () => ({
  useStockManaged: () => ({ managed: false, live: false, variants: [], get: () => undefined }),
}));

import { TitleSection } from '@/components/domain/listing-editor/sections/TitleSection';
import { TagsSection } from '@/components/domain/listing-editor/sections/TagsSection';
import { PriceSection, marketBandFromResponse, marketQueryFromTitle } from '@/components/domain/listing-editor/sections/PriceSection';
import { DetailsSection } from '@/components/domain/listing-editor/sections/DetailsSection';
import { ShippingSection } from '@/components/domain/listing-editor/sections/ShippingSection';
import { __resetTaxonomyCache } from '@/components/domain/listing-editor/sections/etsyShared';

const baseFields: EtsyEditorFields = {
  title: 'Mom&#39;s Personalized Baby Blanket, Custom Name Blanket',
  description: 'Wrap your little one&#39;s world.',
  tags: ['name blanket', 'blanket gift', 'newborn gift'],
  materials: ['cotton'],
  price: '69.99',
  quantity: 4,
  who_made: 'i_did',
  when_made: 'made_to_order',
  is_supply: false,
  taxonomy_id: 3,
  shop_section_id: '',
  shipping_profile_id: 11,
  return_policy_id: '',
  processing_min: '',
  processing_max: '',
  readiness_state_id: '',
  item_weight: '',
  item_weight_unit: 'g',
  item_length: '',
  item_width: '',
  item_height: '',
  item_dimensions_unit: 'cm',
};

interface Harness {
  setField: ReturnType<typeof vi.fn>;
  revert: ReturnType<typeof vi.fn>;
  stageActions: ReturnType<typeof vi.fn>;
  reportFacts: ReturnType<typeof vi.fn>;
  notifyChange: ReturnType<typeof vi.fn>;
  registered: DraftSection[];
}

function makeCtx(over: {
  fields?: Partial<EtsyEditorFields>;
  dirty?: string[];
  issues?: FieldIssue[];
  facts?: ListingFacts;
  draft?: Partial<DraftRow> | null;
  readOnly?: boolean;
} = {}): { value: ListingEditorContextValue; h: Harness } {
  const h: Harness = {
    setField: vi.fn(),
    revert: vi.fn(),
    stageActions: vi.fn(async () => ({ id: 'd1' })),
    reportFacts: vi.fn(),
    notifyChange: vi.fn(),
    registered: [],
  };
  const fields = { ...baseFields, ...over.fields };
  const value = {
    marketplace: 'etsy',
    mode: 'edit',
    ctx: { shopId: 's1', listingId: '1488' },
    view: { marketplace: 'etsy', mode: 'edit', fields, meta: { id: '1488', currency: 'USD', images: [] }, facts: over.facts ?? {} },
    remote: baseFields,
    draft: over.draft === undefined ? null : over.draft,
    issues: over.issues ?? [],
    defaultsApplied: [],
    readOnly: Boolean(over.readOnly),
    setField: h.setField,
    revert: h.revert,
    isFieldDirty: (k: string) => (over.dirty ?? []).includes(k),
    register: (s: DraftSection) => { h.registered.push(s); return () => { h.registered = h.registered.filter((x) => x !== s); }; },
    stageActions: h.stageActions,
    saveNow: vi.fn(async () => true),
    reportFacts: h.reportFacts,
    notifyChange: h.notifyChange,
  } as unknown as ListingEditorContextValue;
  return { value, h };
}

function renderIn(ui: React.ReactElement, ctx: ListingEditorContextValue, locale: Locale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={withB(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <ListingEditorContext.Provider value={ctx}>{ui}</ListingEditorContext.Provider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const action = new URL(url, 'http://x').searchParams.get('action') ?? '';
    if (action in routes) return json(routes[action]);
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  stageEtsyDraft.mockClear();
  __resetTaxonomyCache();
  mockFetch({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each<Locale>(['en', 'tr'])('TitleSection (%s)', (locale) => {
  it('shows decoded text, never raw entities, and stages decoded edits', () => {
    const { value, h } = makeCtx({ dirty: ['title'] });
    renderIn(<TitleSection />, value, locale);
    const input = screen.getByTestId('le-title-input').querySelector('textarea:not([aria-hidden])') as HTMLTextAreaElement;
    expect(input.value).toBe("Mom's Personalized Baby Blanket, Custom Name Blanket");
    expect(document.body.textContent).not.toContain('&#39;');
    fireEvent.change(input, { target: { value: "Mom's Baby Blanket" } });
    expect(h.setField).toHaveBeenCalledWith('title', "Mom's Baby Blanket");
    // "blanket" repeats in 2 tags.
    expect(screen.getByText(locale === 'en' ? '"blanket" repeats in 2 tags' : '"blanket" 2 etikette tekrar ediyor')).toBeTruthy();
    // Dirty marker + revert.
    const revertText = locale === 'en' ? 'Revert' : (trFormField.revert as string);
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === revertText) as HTMLElement);
    expect(h.revert).toHaveBeenCalledWith(['title']);
  });

  it('AI proposal fills the field only on Use (nothing sent)', () => {
    const { value, h } = makeCtx();
    const dismiss = vi.fn();
    renderIn(<TitleSection aiTitle={{ run: vi.fn(), loading: false, value: 'Personalized Baby Blanket, Custom Name Swaddle', dismiss }} />, value, locale);
    expect(h.setField).not.toHaveBeenCalled();
    const card = screen.getByTestId('le-title-suggestion');
    fireEvent.click(within(card).getAllByRole('button').slice(-1)[0]);
    expect(h.setField).toHaveBeenCalledWith('title', 'Personalized Baby Blanket, Custom Name Swaddle');
    expect(dismiss).toHaveBeenCalled();
  });
});

describe.each<Locale>(['en', 'tr'])('TagsSection (%s)', (locale) => {
  it('counts tags, rejects a too-long tag and flags nothing as sent', () => {
    const { value, h } = makeCtx();
    renderIn(<TagsSection />, value, locale);
    expect(screen.getAllByText('3 / 13').length).toBeGreaterThan(0);
    const input = screen.getByTestId('le-tags-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'personalized baby blanket' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.setField).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'swaddle wrap' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.setField).toHaveBeenCalledWith('tags', ['name blanket', 'blanket gift', 'newborn gift', 'swaddle wrap']);
  });

  it('adds AI tag ideas up to the free slots', () => {
    const { value, h } = makeCtx();
    const dismiss = vi.fn();
    renderIn(<TagsSection aiTags={{ run: vi.fn(), loading: false, value: ['crib quilt', 'nursery decor'], dismiss }} />, value, locale);
    fireEvent.click(screen.getByText(locale === 'en' ? 'Add all that fit' : 'Sığanların hepsini ekle', { exact: false }));
    expect(h.setField).toHaveBeenCalledWith('tags', ['name blanket', 'blanket gift', 'newborn gift', 'crib quilt', 'nursery decor']);
    expect(dismiss).toHaveBeenCalled();
  });
});

describe('TagsSection explorer link', () => {
  it('links the Keyword explorer now that R2 shipped the route', () => {
    const { value } = makeCtx();
    renderIn(<TagsSection />, value);
    expect(document.querySelector('a[href*="/app/research/keywords"]')).not.toBeNull();
  });
});

describe('PriceSection', () => {
  it('builds the market query and band (median/p25/p75, never avg)', () => {
    expect(marketQueryFromTitle('Personalized Baby Blanket, Custom Name')).toBe('Personalized Baby Blanket');
    const band = marketBandFromResponse({ priceStats: { p25: 38, median: 49, p75: 62, n: 48, avg: 999, currency: 'USD', excludedNoFx: 1, excludedImplausible: 2 }, fetchedAt: '2026-10-15T10:00:00Z' }, 'baby blanket');
    expect(band).toMatchObject({ p25: 38, median: 49, p75: 62, n: 48, currency: 'USD', excluded: 3 });
    expect(marketBandFromResponse({ priceStats: null }, 'x')).toBeNull();
  });

  it.each<Locale>(['en', 'tr'])('"Use" the median sets the price (%s)', (locale) => {
    const { value, h } = makeCtx();
    renderIn(<PriceSection market={{ p25: 38, median: 49, p75: 62, n: 48, currency: 'USD', query: 'baby blanket', fetchedAt: new Date() }} />, value, locale);
    fireEvent.click(screen.getByText(/49/, { selector: 'button, button *' }));
    expect(h.setField).toHaveBeenCalledWith('price', '49');
    expect(h.reportFacts).toHaveBeenCalledWith({ market: { p25: 38, p75: 62, median: 49, n: 48 } });
  });

  it('with variations, price and quantity are a read-only summary', () => {
    const { value } = makeCtx({ facts: { variations: { count: 2, combinations: 14, priceRange: { min: 54, max: 79 } } } });
    renderIn(<PriceSection />, value);
    expect(screen.queryByTestId('le-price-input')).toBeNull();
    expect(screen.getByText(/set in Variations/)).toBeTruthy();
  });

  it('shows the field error from the engine issues', () => {
    const { value } = makeCtx({ issues: [{ field: 'price', section: 'price', severity: 'block_sync', key: 'etsy.validation.pricePositive' }] });
    renderIn(<PriceSection />, value);
    expect(screen.getByRole('alert').textContent?.length).toBeGreaterThan(3);
  });
});

describe('DetailsSection', () => {
  it('overlays the staged category details and stages changes through the engine (drawer payload)', async () => {
    mockFetch({
      taxonomy: { categories: [{ id: 3, name: 'Blankets' }] },
      get_taxonomy_properties: { results: [{ property_id: 200, display_name: 'Primary color', is_required: true, possible_values: [{ value_id: 1, name: 'Pink' }, { value_id: 2, name: 'Blue' }] }] },
      get_listing_properties: { results: [{ property_id: 200, values: ['Pink'], value_ids: [1] }] },
      get_shop_sections: { shop_sections: [{ shop_section_id: 7, title: 'Blankets' }] },
    });
    const { value, h } = makeCtx({ draft: { id: 'd1', queuedActions: [], taxonomyPatch: { properties: [{ property_id: 200, values: ['Blue'], value_ids: [2] }] } } });
    renderIn(<DetailsSection />, value);
    await waitFor(() => expect(screen.getByText('Blue')).toBeTruthy());
    expect(h.reportFacts).toHaveBeenCalledWith({ attributes: { required: 1, filled: 1 } });
    const reg = h.registered.find((r) => r.key === 'details:categoryDetails');
    expect(reg).toBeTruthy();
    // The staged value is already in the draft: nothing new to stage.
    expect(reg!.isDirty()).toBe(false);
    await act(async () => { await reg!.stage(); });
    expect(stageEtsyDraft).not.toHaveBeenCalled();
    // Removing the value makes the section dirty; stage() sends the drawer payload (full diff vs Etsy).
    fireEvent.click(screen.getByRole('button', { name: 'Remove Blue' }));
    expect(reg!.isDirty()).toBe(true);
    await act(async () => { await reg!.stage(); });
    expect(stageEtsyDraft).toHaveBeenCalledWith({
      shopId: 's1',
      listingId: '1488',
      taxonomy: { properties: [expect.objectContaining({ property_id: 200, values: [], value_ids: [] })] },
    });
    expect(reg!.isDirty()).toBe(false);
  });

  const detailRoutes = (listing: unknown[] = [{ property_id: 200, values: ['Pink'], value_ids: [1] }]) => ({
    taxonomy: { categories: [{ id: 3, name: 'Blankets' }, { id: 4, name: 'Pillows' }] },
    get_taxonomy_properties: { results: [{ property_id: 200, display_name: 'Primary color', is_required: true, possible_values: [{ value_id: 1, name: 'Pink' }, { value_id: 2, name: 'Blue' }] }] },
    get_listing_properties: { results: listing },
    get_shop_sections: { shop_sections: [] },
  });

  it('a category-detail edit notifies the engine (autosave + leave-page guards)', async () => {
    mockFetch(detailRoutes());
    const { value, h } = makeCtx();
    renderIn(<DetailsSection />, value);
    await waitFor(() => expect(screen.getByText('Pink')).toBeTruthy());
    h.notifyChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pink' }));
    expect(h.notifyChange).toHaveBeenCalled();
    expect(h.registered.find((r) => r.key === 'details:categoryDetails')!.isDirty()).toBe(true);
  });

  it('reset after Discard goes back to the Etsy values with nothing staged', async () => {
    mockFetch(detailRoutes());
    const { value, h } = makeCtx({ draft: { id: 'd1', queuedActions: [], taxonomyPatch: { properties: [{ property_id: 200, values: ['Blue'], value_ids: [2] }] } } });
    renderIn(<DetailsSection />, value);
    await waitFor(() => expect(screen.getByText('Blue')).toBeTruthy());
    const reg = h.registered.find((r) => r.key === 'details:categoryDetails')!;
    act(() => { reg.reset!(); });
    await waitFor(() => expect(screen.getByText('Pink')).toBeTruthy());
    expect(screen.queryByText('Blue')).toBeNull();
    expect(reg.isDirty()).toBe(false);
    await act(async () => { await reg.stage(); });
    expect(stageEtsyDraft).not.toHaveBeenCalled();
  });

  it('changing the category and back restores the hidden details', async () => {
    const fetchFn = mockFetch(detailRoutes());
    fetchFn.mockImplementation(async (url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      const action = q.get('action') ?? '';
      if (action === 'get_taxonomy_properties' && q.get('taxonomy_id') === '4') return json({ results: [] });
      const routes = detailRoutes() as Record<string, unknown>;
      return action in routes ? json(routes[action]) : json({}, 404);
    });
    const { value } = makeCtx();
    const view = renderIn(<DetailsSection />, value);
    await waitFor(() => expect(screen.getByText('Pink')).toBeTruthy());
    const rerenderWith = (taxonomy_id: number) => {
      const next = { ...value, view: { ...value.view, fields: { ...value.view.fields, taxonomy_id } } } as ListingEditorContextValue;
      view.rerender(
        <NextIntlClientProvider locale="en" messages={withB('en') as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
          <ThemeProvider theme={theme}>
            <ListingEditorContext.Provider value={next}><DetailsSection /></ListingEditorContext.Provider>
          </ThemeProvider>
        </NextIntlClientProvider>,
      );
    };
    rerenderWith(4);
    await waitFor(() => expect(screen.queryByText('Pink')).toBeNull());
    rerenderWith(3);
    await waitFor(() => expect(screen.getByText('Pink')).toBeTruthy());
  });

  it('re-reads Etsy values after Send so the baseline is current', async () => {
    let listing: unknown[] = [{ property_id: 200, values: ['Pink'], value_ids: [1] }];
    const fetchFn = mockFetch(detailRoutes());
    fetchFn.mockImplementation(async (url: string) => {
      const action = new URL(url, 'http://x').searchParams.get('action') ?? '';
      const routes = detailRoutes(listing) as Record<string, unknown>;
      return action in routes ? json(routes[action]) : json({}, 404);
    });
    const { value, h } = makeCtx({ draft: { id: 'd1', queuedActions: [], taxonomyPatch: { properties: [{ property_id: 200, values: ['Blue'], value_ids: [2] }] } } });
    const view = renderIn(<DetailsSection />, value);
    await waitFor(() => expect(screen.getByText('Blue')).toBeTruthy());
    expect(screen.getByTestId('le-category-details').getAttribute('data-dirty')).toBe('true');
    // Send: Etsy now has Blue, the draft is gone, remote refreshed.
    listing = [{ property_id: 200, values: ['Blue'], value_ids: [2] }];
    const sent = { ...value, draft: null, remote: { ...baseFields } } as ListingEditorContextValue;
    view.rerender(
      <NextIntlClientProvider locale="en" messages={withB('en') as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
        <ThemeProvider theme={theme}>
          <ListingEditorContext.Provider value={sent}><DetailsSection /></ListingEditorContext.Provider>
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('le-category-details').getAttribute('data-dirty')).toBeNull());
    expect(h.registered.find((r) => r.key === 'details:categoryDetails')!.isDirty()).toBe(false);
  });

  it('keeps the category combobox and shows a load error with Retry for details', async () => {
    mockFetch({ taxonomy: { categories: [{ id: 3, name: 'Blankets' }] } });
    const { value } = makeCtx();
    renderIn(<DetailsSection />, value, 'tr');
    await waitFor(() => expect(screen.getByText('Kategori detayları yüklenemedi')).toBeTruthy());
  });
});

describe('ShippingSection', () => {
  it('lists staged (pending) shipping profiles from the draft and stages a new return policy as a queued action', async () => {
    mockFetch({
      get_shipping_profiles: { shipping_profiles: [{ shipping_profile_id: 11, title: 'US free' }] },
      get_return_policies: { return_policies: [] },
      get_readiness_states: { readiness_states: [] },
    });
    const { value, h } = makeCtx({
      fields: { shipping_profile_id: -5 },
      draft: { id: 'd1', queuedActions: [{ type: 'create_shipping_profile', tempId: -5, payload: { title: 'EU 3 days' } }] },
    });
    renderIn(<ShippingSection />, value);
    await waitFor(() => expect(screen.getByText('EU 3 days · created when you send')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New return policy/ }));
    const dialog = await screen.findByTestId('le-new-return-policy-modal');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add return policy' }));
    await waitFor(() => expect(h.stageActions).toHaveBeenCalled());
    const [[actions]] = h.stageActions.mock.calls as unknown as [[Array<{ type: string; tempId: number; payload: unknown }>]];
    expect(actions[0].type).toBe('create_return_policy');
    expect(actions[0].tempId).toBeLessThan(0);
    expect(actions[0].payload).toEqual({ accepts_returns: true, accepts_exchanges: true, return_deadline: 30 });
    // Action and the temp-id field go in one request (no orphan create on Etsy if a later save is blocked).
    expect(h.stageActions.mock.calls[0][1]).toEqual({ return_policy_id: actions[0].tempId });
    expect(h.setField).not.toHaveBeenCalledWith('return_policy_id', expect.anything());
  });
});

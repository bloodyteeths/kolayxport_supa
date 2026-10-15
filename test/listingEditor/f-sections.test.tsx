// @vitest-environment jsdom
// Group F render tests: the eBay sections (EbayPoliciesSection, EbayTitleSection, EbayPriceSection,
// EbayDetailsSection) inside a fake editor context, EN + TR with strict i18n (a missing key throws).
// They only call setField / revert: nothing is staged or sent from a section.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import type { FieldIssue } from '@/lib/listingEditor/types';
import { blankEbayFields, decodeCreateVariations, encodeAspects, encodeCreateVariations, type EbayEditorFields } from '@/components/domain/listing-editor/adapters/ebay';
import { EbayCreateVariations } from '@/components/domain/listing-editor/sections/EbayCreateVariations';
import { fireEvent } from '@testing-library/react';
import { EbayPoliciesSection, parsePolicies } from '@/components/domain/listing-editor/sections/EbayPoliciesSection';
import {
  EbayDetailsSection,
  EbayPriceSection,
  EbayTitleSection,
  ebayPreviewModel,
  htmlToText,
  parseCategorySuggestions,
} from '@/components/domain/listing-editor/sections/EbayFieldSections';
import { flatKeys, withF } from './f-messages';

type Locale = 'en' | 'tr';

const fields: EbayEditorFields = {
  ...blankEbayFields(),
  title: "Mom's Wooden Keepsake Box",
  description: '<p>Hand made oak box</p>',
  images: ['https://i/1.jpg'],
  aspects: encodeAspects({ Brand: ['Belle'], Material: ['Oak'] }),
  price: '24.99',
  quantity: 3,
  categoryId: '1234',
  fulfillmentPolicyId: 'F1',
  returnPolicyId: 'R-gone',
  paymentPolicyId: 'P1',
  weight: 1.2,
};

function makeCtx(over: { dirty?: string[]; issues?: FieldIssue[]; readOnly?: boolean; mode?: 'edit' | 'create'; fields?: Partial<EbayEditorFields> } = {}) {
  const setField = vi.fn();
  const viewFields = { ...fields, ...(over.fields ?? {}) };
  const revert = vi.fn();
  const value = {
    marketplace: 'ebay',
    mode: over.mode ?? 'edit',
    ctx: { shopId: 'ebay', listingId: 'BOX-1' },
    view: { marketplace: 'ebay', mode: over.mode ?? 'edit', fields: viewFields, meta: { id: 'BOX-1', currency: 'USD', images: [] }, facts: {} },
    remote: fields,
    draft: null,
    issues: over.issues ?? [],
    defaultsApplied: ['paymentPolicyId'],
    readOnly: Boolean(over.readOnly),
    setField,
    revert,
    isFieldDirty: (k: string) => (over.dirty ?? []).includes(k),
    register: () => () => undefined,
    stageActions: vi.fn(),
    saveNow: vi.fn(async () => true),
    reportFacts: vi.fn(),
    notifyChange: vi.fn(),
  } as unknown as ListingEditorContextValue;
  return { value, setField, revert };
}

function renderIn(ui: React.ReactElement, ctx: ListingEditorContextValue, locale: Locale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={withF(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <ListingEditorContext.Provider value={ctx}>{ui}</ListingEditorContext.Provider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url.includes('fulfillment_policies')) return json({ fulfillmentPolicies: [{ policyId: 'F1', name: 'US Free 3-5 days' }] });
    if (url.includes('return_policies')) return json({}, 500);
    if (url.includes('payment_policies')) return json({ paymentPolicies: [{ paymentPolicyId: 'P1', name: 'Managed payments' }] });
    if (url.includes('item_conditions')) return json({ itemConditions: [] });
    if (url.includes('store_categories')) return json({ categories: ['Boxes'] });
    return json({});
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe.each<Locale>(['en', 'tr'])('eBay sections render (%s)', (locale) => {
  it('policies: lists load per kind, a failed list keeps the current value and offers Retry', async () => {
    const { value } = makeCtx({ dirty: ['fulfillmentPolicyId'] });
    renderIn(<EbayPoliciesSection />, value, locale);
    expect(screen.getByTestId('le-section-shipping')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('button', { name: locale === 'en' ? 'Retry' : 'Tekrar dene' }).length).toBe(1));
    expect(screen.getByText(locale === 'en' ? "Couldn't load your profiles" : 'Profilleriniz yüklenemedi')).toBeTruthy();
    expect(screen.getByText(locale === 'en' ? 'From your last listing' : 'Son ilanınızdan')).toBeTruthy();
  });

  it('title, price and details render with eBay limits', async () => {
    const { value } = makeCtx({ issues: [{ field: 'categoryId', section: 'details', severity: 'block_sync', key: 'ebay.validation.categoryRequired' }] });
    renderIn(<><EbayTitleSection /><EbayPriceSection /><EbayDetailsSection /></>, value, locale);
    expect(screen.getByDisplayValue("Mom's Wooden Keepsake Box")).toBeTruthy();
    expect(screen.getByText(`${fields.title.length} / 80`, { exact: false })).toBeTruthy();
    expect(screen.getByText(locale === 'en' ? 'Choose a category' : 'Bir kategori seçin')).toBeTruthy();
    expect((screen.getByDisplayValue('BOX-1') as HTMLInputElement).readOnly).toBe(true);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('store_categories'), expect.anything()));
  });
});

describe.each<Locale>(['en', 'tr'])('eBay create-only fields (%s)', (locale) => {
  it("SKU is the seller's own in create mode (blank = generated), read-only when editing", () => {
    const { value, setField } = makeCtx({ mode: 'create' });
    renderIn(<EbayPriceSection />, value, locale);
    const input = screen.getByPlaceholderText('BOX-1') as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: 'BB PINK' } });
    expect(setField).toHaveBeenCalledWith('sku', 'BBPINK');
  });

  it('new-listing variations: options → combination rows with SKU / price / quantity, written as one field', () => {
    const { value, setField } = makeCtx({ mode: 'create' });
    const { unmount } = renderIn(<EbayCreateVariations />, value, locale);
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add option' : 'Seçenek ekle' }));
    fireEvent.change(screen.getByPlaceholderText(locale === 'en' ? 'e.g. Color' : 'ör. Renk'), { target: { value: 'Color' } });
    unmount();

    const stored = encodeCreateVariations({
      specifications: [{ name: 'Color', values: ['Pink', 'Blue'] }],
      variants: [
        { sku: 'BOX-1-PINK', combination: { Color: 'Pink' }, quantity: 2, price: '20.00' },
        { sku: 'BOX-1-BLUE', combination: { Color: 'Blue' }, quantity: 1, price: null },
      ],
    });
    const c2 = makeCtx({ mode: 'create', fields: { createVariations: stored } });
    renderIn(<EbayCreateVariations />, c2.value, locale);
    expect(screen.getAllByTestId('le-ebay-variant-row')).toHaveLength(2);
    expect(screen.getByText(locale === 'en' ? '2 combinations' : '2 kombinasyon')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('BOX-1-BLUE'), { target: { value: 'MY-BLUE' } });
    const [key, written] = c2.setField.mock.calls.at(-1)!;
    expect(key).toBe('createVariations');
    expect(decodeCreateVariations(written)!.variants[1].sku).toBe('MY-BLUE');
    expect(setField).not.toHaveBeenCalledWith('createVariations', expect.stringContaining('Color'));
  });
});

describe('eBay section helpers', () => {
  it('parsePolicies normalises ids and names', () => {
    expect(parsePolicies('return', { returnPolicies: [{ returnPolicyId: 'R1', name: ' 30 days ' }, { name: 'no id' }] })).toEqual([
      { policyId: 'R1', name: '30 days', description: undefined },
    ]);
    expect(parsePolicies('payment', null)).toEqual([]);
  });

  it('parseCategorySuggestions keeps the path as the description', () => {
    expect(parseCategorySuggestions({
      categorySuggestions: [
        { category: { categoryId: '1', categoryName: 'Boxes' }, categoryTreeNodeAncestors: [{ categoryName: 'Storage' }, { categoryName: 'Home' }] },
        { category: { categoryName: 'no id' } },
      ],
    })).toEqual([{ value: '1', label: 'Boxes', description: 'Home › Storage' }]);
  });

  it('preview model: decoded aspects as specifics, deletes removed, free shipping never guessed', () => {
    const view = {
      marketplace: 'ebay' as const,
      mode: 'edit' as const,
      fields,
      meta: { id: 'BOX-1', state: 'active', url: null, updatedAt: null, views: 0, favorites: 0, currency: 'USD', images: [] },
      facts: { images: [{ id: 'a', src: 'https://i/1.jpg', alt: '' }, { id: 'b', src: 'https://i/2.jpg', alt: '', staged: 'delete' as const }] },
    };
    const m = ebayPreviewModel(view, null);
    expect(m.images).toEqual([{ url: 'https://i/1.jpg', alt: '' }]);
    expect(m.specifics).toEqual([{ name: 'Brand', value: 'Belle' }, { name: 'Material', value: 'Oak' }]);
    expect(m).toMatchObject({ price: 24.99, condition: 'New', freeShipping: null });
    expect(htmlToText('<p>a</p><p>b <b>c</b></p>')).toBe('a\n b c');
  });

  it('every F key has EN and TR text with real Turkish characters and no ASCII-Turkish', () => {
    const rows = flatKeys();
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) {
      expect(r.en, r.key).toBeTruthy();
      expect(r.tr, r.key).toBeTruthy();
      expect(r.tr).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
    }
  });
});

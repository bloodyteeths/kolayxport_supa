// @vitest-environment jsdom
// M6b-D render tests: the Trendyol / Wix / Shopify sections inside a fake editor context, EN + TR with strict i18n
// (a missing key throws). Sections only call setField / setFields / revert: nothing is staged or sent from here.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import type { DraftSection, FieldMap } from '@/lib/listingEditor/types';
import { TrendyolAttributesSection } from '@/components/domain/listing-editor/sections/TrendyolAttributesSection';
import { TrendyolPriceSection } from '@/components/domain/listing-editor/sections/TrendyolPriceSection';
import {
  TrendyolDetailsSection, TrendyolShippingSection, TrendyolStatusBanner, TrendyolVariantsSection,
} from '@/components/domain/listing-editor/sections/TrendyolDetailsSection';
import { WixPriceSection } from '@/components/domain/listing-editor/sections/WixPriceSection';
import { WixDetailsSection, WixVariantsSection } from '@/components/domain/listing-editor/sections/WixDetailsSection';
import { WixPersonalizationSection } from '@/components/domain/listing-editor/sections/WixPersonalizationSection';
import { ShopifyDetailsSection, ShopifyOrgSection } from '@/components/domain/listing-editor/sections/ShopifyOrgSection';
import { ShopifyPriceSection, ShopifyShippingSection, ShopifyVariantsSection } from '@/components/domain/listing-editor/sections/ShopifyVariantsSection';
import { ShopifySeoSection } from '@/components/domain/listing-editor/sections/ShopifySeoSection';
import { CreateStartCard, createStartCardSlot } from '@/components/domain/listing-editor/sections/CreateStartCard';
import { fieldAnchorId } from '@/lib/listingEditor/sections';
import { withM6bD, type Locale } from './m6bd-messages';

interface CtxOpts {
  marketplace: 'trendyol' | 'wix' | 'shopify';
  fields: FieldMap;
  raw?: Record<string, unknown>;
  mode?: 'edit' | 'create';
  readOnly?: boolean;
  dirty?: string[];
  currency?: string;
}

function makeCtx(o: CtxOpts) {
  const setField = vi.fn();
  const setFields = vi.fn();
  const revert = vi.fn();
  const reportFacts = vi.fn();
  const sections: DraftSection[] = [];
  const value = {
    marketplace: o.marketplace,
    mode: o.mode ?? 'edit',
    ctx: { shopId: 'store-1', listingId: o.mode === 'create' ? null : 'P-1' },
    view: { marketplace: o.marketplace, mode: o.mode ?? 'edit', fields: o.fields, meta: { id: 'P-1', currency: o.currency ?? null, images: [], raw: o.raw ?? {}, url: null }, facts: {} },
    remote: o.fields,
    draft: null,
    changes: [],
    issues: [],
    defaultsApplied: [],
    readOnly: Boolean(o.readOnly),
    setField,
    setFields,
    revert,
    isFieldDirty: (k: string) => (o.dirty ?? []).includes(k),
    register: (s: DraftSection) => {
      sections.push(s);
      return () => undefined;
    },
    stageActions: vi.fn(),
    saveNow: vi.fn(async () => true),
    reportFacts,
    notifyChange: vi.fn(),
  } as unknown as ListingEditorContextValue;
  return { value, setField, setFields, revert, reportFacts, sections };
}

function renderIn(ui: React.ReactElement, ctx: ListingEditorContextValue, locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={withM6bD(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
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
    if (url.includes('category_attributes')) {
      return json({
        categoryAttributes: [
          { allowCustom: true, attribute: { id: 2, name: 'Boyut' }, attributeValues: [], required: true },
          { allowCustom: false, attribute: { id: 3, name: 'Materyal' }, attributeValues: [{ id: 31, name: 'Ahşap' }], required: true },
          { allowCustom: false, attribute: { id: 1, name: 'Renk' }, attributeValues: [{ id: 11, name: 'Naturel' }], required: false },
        ],
      });
    }
    if (url.includes('cargo_companies')) return json([{ id: 7, name: 'Trendyol Express' }]);
    if (url.includes('action=addresses')) return json({ supplierAddresses: [{ id: 1, addressType: 'Shipment', fullAddress: 'İstanbul depo', isDefault: true }, { id: 2, addressType: 'Returning', fullAddress: 'Ankara iade' }] });
    if (url.includes('/api/wix/collections')) return json({ collections: [{ id: 'c1', name: 'Baby' }, { id: 'c2', name: 'Gifts' }] });
    if (url.includes('action=categories')) {
      return json({ categories: [{ id: 1, name: 'Ev & Yaşam', subCategories: [{ id: 5, name: 'Dekorasyon', subCategories: [{ id: 99, name: 'Dekorasyon Kutuları', subCategories: [] }] }] }] });
    }
    if (url.includes('action=list') && url.includes('barcode=')) return json({ content: [] });
    if (url.includes('action=locations')) return json({ locations: [{ id: 1, name: 'Main', active: true }, { id: 2, name: 'Depot', active: true }] });
    return json({});
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const T = (locale: Locale, en: string, tr: string) => (locale === 'en' ? en : tr);

describe.each<Locale>(['en', 'tr'])('Trendyol sections (%s)', (locale) => {
  const raw = {
    barcode: '8691234567890', productMainId: 'AK-001', brandName: 'Belle Couture', categoryId: 99, categoryName: 'Dekorasyon Kutuları',
    cargoCompanyId: 7, currencyType: 'TRY', rejected: true, approved: false, rejectReasons: [{ rejectReason: 'Görsel kalitesi yetersiz' }],
    attributes: [{ attributeId: 3, attributeValueId: 31, attributeValue: 'Ahşap' }],
    siblings: [{ barcode: '8691234567891', attributes: [{ attributeName: 'Beden', attributeValue: 'L' }], quantity: 3 }],
  };
  const fields: FieldMap = {
    title: 'Kutu', price: 749, listPrice: 899, vatRate: 20, quantity: 42, stockCode: 'AK-001', dimensionalWeight: 2,
    attributes: JSON.stringify([{ attributeId: 3, attributeValueId: 31 }]),
  };

  it('attributes: required first, missing count, validation, facts', async () => {
    const c = makeCtx({ marketplace: 'trendyol', fields, raw });
    renderIn(<TrendyolAttributesSection />, c.value, locale);
    await waitFor(() => expect(screen.getAllByText(T(locale, '1 required attribute missing', '1 zorunlu özellik eksik')).length).toBeGreaterThan(0));
    expect(screen.getByText('Boyut')).toBeTruthy();
    expect(screen.queryByText('Renk')).toBeNull();
    fireEvent.click(screen.getByTestId('le-trendyol-optional-toggle'));
    expect(screen.getByText('Renk')).toBeTruthy();
    const v = c.sections.find((s) => s.key === 'attributes:required');
    // Edit without content changes: a price / stock send doesn't touch attributes, so it only warns.
    expect(v?.validate?.()).toEqual([expect.objectContaining({ field: 'attributes', severity: 'warn', params: { count: 1 } })]);
    expect(c.reportFacts).toHaveBeenLastCalledWith({ attributes: { required: 2, filled: 1 } });
    fireEvent.change(screen.getByLabelText(/Boyut/), { target: { value: '20x15 cm' } });
    expect(JSON.parse(c.setField.mock.calls.at(-1)?.[1] as string)).toEqual([
      { attributeId: 2, customAttributeValue: '20x15 cm' },
      { attributeId: 3, attributeValueId: 31 },
    ]);
  });

  it('attributes: a content edit blocks Send while required attributes are missing; custom text keeps its spaces', async () => {
    const c = makeCtx({ marketplace: 'trendyol', fields, raw, dirty: ['title'] });
    renderIn(<TrendyolAttributesSection />, c.value, locale);
    await waitFor(() => expect(screen.getByText('Boyut')).toBeTruthy());
    const v = c.sections.find((s) => s.key === 'attributes:required');
    expect(v?.validate?.()).toEqual([expect.objectContaining({ severity: 'block_sync' })]);
    const input = screen.getByLabelText(/Boyut/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ahşap ' } });
    expect(input.value).toBe('Ahşap ');
    fireEvent.change(input, { target: { value: 'Ahşap K' } });
    expect(input.value).toBe('Ahşap K');
    expect(JSON.parse(c.setField.mock.calls.at(-1)?.[1] as string)).toContainEqual({ attributeId: 2, customAttributeValue: 'Ahşap K' });
  });

  it('price & stock: discount caption, margin estimate with the category rate, VAT select', async () => {
    const c = makeCtx({ marketplace: 'trendyol', fields, raw, currency: 'TRY' });
    renderIn(<TrendyolPriceSection />, c.value, locale);
    // Edit mode only has the leaf name: the path (and so the group) comes from the category tree by id.
    await waitFor(() => expect(screen.getByTestId('le-trendyol-margin').textContent).toContain('Ev & Yaşam'));
    const margin = screen.getByTestId('le-trendyol-margin').textContent ?? '';
    expect(margin).toContain(T(locale, 'off on Trendyol', 'indirim'));
    expect(margin).toContain('489');
    expect(screen.getByDisplayValue('AK-001')).toBeTruthy();
  });

  it('list below sale blocks Send with an inline error', () => {
    const c = makeCtx({ marketplace: 'trendyol', fields: { ...fields, listPrice: 500 }, raw });
    renderIn(<TrendyolPriceSection />, c.value, locale);
    expect(screen.getByText(T(locale, "List price can't be lower than the sale price", 'Liste fiyatı satış fiyatından düşük olamaz'))).toBeTruthy();
    expect(c.sections[0].validate?.()).toEqual([expect.objectContaining({ field: 'listPrice', key: 'listingEditor.trendyol.listBelowSale' })]);
  });

  it('variants: an unloaded sibling list is not shown as "no other colors or sizes"', () => {
    const { siblings: _omit, ...noSiblings } = raw;
    void _omit;
    const c = makeCtx({ marketplace: 'trendyol', fields, raw: noSiblings });
    renderIn(<TrendyolVariantsSection />, c.value, locale);
    expect(screen.getByTestId('le-trendyol-siblings-unknown').textContent).toContain('AK-001');
    expect(screen.queryByText(T(locale, 'This product has no other colors or sizes', 'Bu ürünün başka renk veya bedeni yok'))).toBeNull();
  });

  it('edit details are fixed; variants link to siblings; rejected banner decodes reasons', async () => {
    const c = makeCtx({ marketplace: 'trendyol', fields, raw });
    renderIn(<><TrendyolStatusBanner raw={raw} /><TrendyolDetailsSection /><TrendyolShippingSection /><TrendyolVariantsSection /></>, c.value, locale);
    expect(screen.getByTestId('le-trendyol-status-banner').textContent).toContain('Görsel kalitesi yetersiz');
    expect((screen.getByDisplayValue('Belle Couture') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getAllByText(T(locale, "Can't be changed after the product is created", 'Ürün oluşturulduktan sonra değiştirilemez')).length).toBeGreaterThan(1);
    await waitFor(() => expect(screen.getByDisplayValue('Trendyol Express')).toBeTruthy());
    expect(screen.getByText(T(locale, '2 products in this product group', 'Bu ürün grubunda 2 ürün'))).toBeTruthy();
    fireEvent.click(screen.getByTestId('le-trendyol-siblings-toggle'));
    expect(screen.getByText('Beden: L')).toBeTruthy();
  });

  it('create: category & brand pickers, barcode generator, default addresses preselected', async () => {
    const c = makeCtx({ marketplace: 'trendyol', fields: { stockCode: 'AK-9', barcode: '' }, mode: 'create' });
    renderIn(<><TrendyolDetailsSection /><TrendyolShippingSection /></>, c.value, locale);
    expect(screen.getByText(T(locale, 'Category & brand', 'Kategori ve marka'))).toBeTruthy();
    fireEvent.click(screen.getByTestId('le-trendyol-generate-barcode'));
    await waitFor(() => expect(c.setField).toHaveBeenCalledWith('barcode', expect.stringMatching(/^2\d{12}$/)));
    expect((screen.getByLabelText(new RegExp(T(locale, 'Product main ID', 'Ana ürün kodu'))) as HTMLInputElement).placeholder).toBe('AK-9');
    await waitFor(() => expect(c.setFields).toHaveBeenCalledWith({ shipmentAddressId: 1, returningAddressId: 2 }));
  });
});

describe.each<Locale>(['en', 'tr'])('Wix sections (%s)', (locale) => {
  const fields: FieldMap = {
    price: 39, discountType: 'AMOUNT', discountValue: 5, trackInventory: true, quantity: 12, sku: 'WX-12', weight: 0.4,
    collectionIds: ['c1'], ribbon: 'New', visible: true, customTextFields: JSON.stringify([{ title: 'Name to engrave', maxLength: 20, mandatory: true }]),
  };
  it('price: customer pays after discount; stock is one autosave (no separate Save)', () => {
    const c = makeCtx({ marketplace: 'wix', fields, currency: 'USD' });
    renderIn(<WixPriceSection />, c.value, locale);
    expect(screen.getByTestId('le-wix-customer-pays').textContent).toContain('34');
    expect(screen.queryByRole('button', { name: /save|kaydet/i })).toBeNull();
    // An amount is not a percent: switching the kind clears the value instead of carrying "5" over.
    fireEvent.click(screen.getByRole('radio', { name: T(locale, 'Percent', 'Yüzde') }));
    expect(c.setFields).toHaveBeenCalledWith({ discountType: 'NONE', discountValue: '' });
  });
  it('multi-variant product: price is read-only (the adapter never stages it)', () => {
    const c = makeCtx({ marketplace: 'wix', fields: { ...fields, variantCount: 3 } });
    renderIn(<WixPriceSection />, c.value, locale);
    expect((document.getElementById(fieldAnchorId('price')) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(T(locale, 'Price is set per option in Wix', "Fiyat Wix'te seçenek bazında ayarlanır"))).toBeTruthy();
  });
  it('untracked stock shows In stock instead of quantity', () => {
    const c = makeCtx({ marketplace: 'wix', fields: { ...fields, trackInventory: false, inStock: true } });
    renderIn(<WixPriceSection />, c.value, locale);
    expect(screen.getByLabelText(T(locale, 'In stock', 'Stokta'))).toBeTruthy();
    expect(screen.queryByDisplayValue('12')).toBeNull();
  });
  it('details: collections load by name; variants summary; personalization', async () => {
    const c = makeCtx({ marketplace: 'wix', fields, raw: { options: [{ name: 'Size', choices: [1, 2, 3] }], editUrl: 'https://manage.wix.com/x' } });
    renderIn(<><WixDetailsSection /><WixVariantsSection /><WixPersonalizationSection /></>, c.value, locale);
    await waitFor(() => expect(screen.getByText('Baby')).toBeTruthy());
    expect(screen.getByText('Size (3)', { exact: false })).toBeTruthy();
    expect(screen.getByText(T(locale, 'Edit options in Wix', "Seçenekleri Wix'te düzenle"))).toBeTruthy();
    expect(screen.getByDisplayValue('Name to engrave')).toBeTruthy();
    fireEvent.click(screen.getByTestId('le-wix-add-text-field'));
    expect(JSON.parse(c.setField.mock.calls.at(-1)?.[1] as string)).toHaveLength(2);
  });
});

describe.each<Locale>(['en', 'tr'])('Shopify sections (%s)', (locale) => {
  const variants = [
    { id: 11, option1: 'Pink', option2: 'S', price: '39.00', compare_at_price: '49.00', inventory_quantity: 8, sku: 'BB-P-S', inventory_management: 'shopify' },
    { id: 12, option1: 'Blue', option2: 'S', price: '39.00', inventory_quantity: 2, sku: 'BB-B-S', inventory_management: 'shopify' },
  ];
  const fields: FieldMap = {
    title: 'Baby blanket', description: '<p>Soft</p>', tags: ['baby gift'], vendor: 'Belle', productType: 'Blanket', status: 'active',
    seoTitle: '', seoDescription: '', variants: '[]', price: 39, compareAtPrice: '', quantity: 8, sku: 'BB', weight: 0.5, weightUnit: 'kg',
  };
  it('tags & organization, details, SEO with fallbacks', () => {
    const c = makeCtx({ marketplace: 'shopify', fields, raw: { collections: ['Baby'] } });
    renderIn(<><ShopifyOrgSection vendors={['Acme']} /><ShopifyDetailsSection /><ShopifySeoSection /></>, c.value, locale);
    expect(screen.getByText('baby gift')).toBeTruthy();
    expect(screen.getByDisplayValue('Belle')).toBeTruthy();
    expect(screen.getByText('Baby')).toBeTruthy();
    expect((screen.getByLabelText(new RegExp(T(locale, 'Page title', 'Sayfa başlığı'))) as HTMLInputElement).placeholder).toBe('Baby blanket');
    expect(screen.getByText(T(locale, 'Empty fields use the product title and description', 'Boş alanlarda ürün başlığı ve açıklaması kullanılır'))).toBeTruthy();
  });
  it('multi-variant: price moves to the variant table; multi-location quantity is read-only', async () => {
    const c = makeCtx({ marketplace: 'shopify', fields, raw: { variants, shopDomain: 'belle.myshopify.com', locationCount: 2 }, currency: 'USD' });
    renderIn(<><ShopifyPriceSection /><ShopifyVariantsSection /><ShopifyShippingSection /></>, c.value, locale);
    expect(screen.getByText(T(locale, 'Price and quantity are set in Variations', 'Fiyat ve adet Varyasyonlarda ayarlanır'), { exact: false })).toBeTruthy();
    expect(screen.getByText('Pink / S')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(T(locale, 'This shop keeps stock in 2 locations. Change quantities in Shopify', "Bu mağaza stoku 2 konumda tutuyor. Adetleri Shopify'da değiştirin")).length).toBeGreaterThan(0));
    expect(screen.getByText(T(locale, 'Weight is set per variant in Shopify', "Ağırlık Shopify'da varyant bazında ayarlanır"))).toBeTruthy();
  });
  it('single variant: price, compare-at, weight unit', () => {
    const c = makeCtx({ marketplace: 'shopify', fields, raw: { variants: [variants[0]] }, currency: 'USD', mode: 'create' });
    renderIn(<><ShopifyPriceSection /><ShopifyShippingSection /><ShopifyDetailsSection /></>, c.value, locale);
    expect(screen.getByText(T(locale, 'Add options in Shopify after creating', "Seçenekleri oluşturduktan sonra Shopify'da ekleyin"))).toBeTruthy();
    expect(screen.getByDisplayValue('BB')).toBeTruthy();
  });
});

describe.each<Locale>(['en', 'tr'])('CreateStartCard (%s)', (locale) => {
  it('Trendyol copy card calls onCopy; slot hides after the first edit', () => {
    const onCopy = vi.fn();
    const c = makeCtx({ marketplace: 'trendyol', fields: {}, mode: 'create' });
    renderIn(<CreateStartCard marketplace="trendyol" onCopy={onCopy} credits={2} />, c.value, locale);
    fireEvent.click(screen.getByRole('button', { name: T(locale, 'Copy an Etsy or eBay listing…', 'Bir Etsy veya eBay ilanını kopyala…') }));
    expect(onCopy).toHaveBeenCalled();
    cleanup();
    const slot = createStartCardSlot({ marketplace: 'wix', onCopy });
    const { container } = renderIn(<>{slot({ editor: { mode: 'create', changes: [{}], draft: null } })}</>, c.value, locale);
    expect(container.textContent).toBe('');
  });
});

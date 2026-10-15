// M6b-D pure helpers: form-value codecs, Trendyol attributes / categories / commission / barcode / status,
// Wix discount + options, Shopify variant edits, i18n coverage of the section files.
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  decodeAttributes, decodeTextFields, decodeVariantEdits, encodeAttributes, encodeTextFields, encodeVariantEdits, toNum,
} from '@/components/domain/listing-editor/sections/marketplaceSectionShared';
import {
  missingRequired, parseCategoryAttributes, proposalApplied, requiredMissingSeverity, setAttributeValue,
} from '@/components/domain/listing-editor/sections/TrendyolAttributesSection';
import { trendyolCommissionFor, trendyolDiscountRatio, trendyolNetEstimate } from '@/components/domain/listing-editor/sections/TrendyolPriceSection';
import {
  barcodeInUse, decodeRejectReasons, ean13CheckDigit, flattenTrendyolCategories, generateBarcode, parseAddresses, parseBrands, parseSiblings,
  searchTrendyolCategories, trendyolListingStatus,
} from '@/components/domain/listing-editor/sections/TrendyolDetailsSection';
import { WIX_MAX_PERCENT, wixCustomerPays, wixDiscountValue, wixHasVariants, wixManagesVariants } from '@/components/domain/listing-editor/sections/WixPriceSection';
import { WIX_ALL_PRODUCTS_COLLECTION, parseWixCollections, wixDashboardUrl, wixOptionSummary } from '@/components/domain/listing-editor/sections/WixDetailsSection';
import { untitledTextFields } from '@/components/domain/listing-editor/sections/WixPersonalizationSection';
import {
  applyVariantEdit, parseShopifyLocations, parseShopifyVariants, shopifyAdminUrl, shopifyLocationCount, viewVariant,
} from '@/components/domain/listing-editor/sections/ShopifyVariantsSection';
import { normalizeShopifyTag, optionList, shopifyCollectionNames } from '@/components/domain/listing-editor/sections/ShopifyOrgSection';
import { seoFallbackDescription } from '@/components/domain/listing-editor/sections/ShopifySeoSection';
import { showCreateStartCard } from '@/components/domain/listing-editor/sections/CreateStartCard';
import { m6bdKeys, withM6bD } from './m6bd-messages';

describe('form value codecs', () => {
  it('attributes round-trip sorted, accept the cache shape and drop junk', () => {
    const enc = encodeAttributes([{ attributeId: 9, customAttributeValue: ' 20x15 ' }, { attributeId: 2, attributeValueId: 7 }]);
    expect(JSON.parse(enc)).toEqual([{ attributeId: 2, attributeValueId: 7 }, { attributeId: 9, customAttributeValue: '20x15' }]);
    expect(decodeAttributes(enc)).toHaveLength(2);
    expect(decodeAttributes([{ attributeId: 3, attributeValue: 'Naturel', attributeName: 'Renk' }])).toEqual([{ attributeId: 3, customAttributeValue: 'Naturel' }]);
    expect(decodeAttributes('not json')).toEqual([]);
    expect(decodeAttributes(null)).toEqual([]);
  });
  it('text fields and variant edits round-trip; an untouched table encodes as []', () => {
    const tf = encodeTextFields([{ title: 'Name', maxLength: 20, mandatory: true }]);
    expect(decodeTextFields(tf)).toEqual([{ title: 'Name', maxLength: 20, mandatory: true }]);
    expect(encodeVariantEdits([])).toBe('[]');
    expect(encodeVariantEdits([{ id: '1', expectedQuantity: 3 }])).toBe('[]');
    const ve = encodeVariantEdits([{ id: '2', price: 10 }, { id: '1', compareAtPrice: null }]);
    expect(decodeVariantEdits(ve)).toEqual([{ id: '1', compareAtPrice: null }, { id: '2', price: 10 }]);
  });
  it('toNum accepts Turkish decimal commas', () => {
    expect(toNum('12,50')).toBe(12.5);
    expect(toNum('')).toBeNull();
  });
});

describe('Trendyol', () => {
  const attrs = {
    categoryAttributes: [
      { allowCustom: false, attribute: { id: 1, name: 'Renk' }, attributeValues: [{ id: 11, name: 'Naturel' }], required: false, varianter: true },
      { allowCustom: true, attribute: { id: 2, name: 'Boyut' }, attributeValues: [], required: true },
      { allowCustom: false, attribute: { id: 3, name: 'Materyal' }, attributeValues: [{ id: 31, name: 'Ahşap' }], required: true },
      { attribute: {} },
    ],
  };
  it('parses category attributes required first and counts missing ones', () => {
    const defs = parseCategoryAttributes(attrs);
    expect(defs.map((d) => d.id)).toEqual([2, 3, 1]);
    expect(missingRequired(defs, [{ attributeId: 3, attributeValueId: 31 }]).map((d) => d.id)).toEqual([2]);
    let list = setAttributeValue([], 2, { customAttributeValue: '20x15 cm' });
    list = setAttributeValue(list, 3, { attributeValueId: 31 });
    expect(missingRequired(defs, list)).toEqual([]);
    expect(setAttributeValue(list, 2, { customAttributeValue: '  ' }).map((a) => a.attributeId)).toEqual([3]);
    expect(setAttributeValue(list, 3, null).map((a) => a.attributeId)).toEqual([2]);
  });
  it('commission by category keyword, falling back to Diğer', () => {
    expect(trendyolCommissionFor('Ev & Yaşam › Dekorasyon › Kutular')).toMatchObject({ group: 'Ev & Yaşam', rate: 18, known: true });
    expect(trendyolCommissionFor('Anne & Bebek › Bebek Odası')).toMatchObject({ group: 'Bebek', rate: 15 });
    expect(trendyolCommissionFor('Takı › Kolye')).toMatchObject({ group: 'Takı & Aksesuar', rate: 20 });
    expect(trendyolCommissionFor(null)).toMatchObject({ group: 'Diğer', known: false });
  });
  it('commission: the root category decides; a leaf name alone only matches unambiguous words', () => {
    expect(trendyolCommissionFor('Ev & Yaşam › Dekorasyon › Takı Kutusu')).toMatchObject({ group: 'Ev & Yaşam', rate: 18, known: true });
    expect(trendyolCommissionFor('Ev & Yaşam › Dekorasyon › Duvar Saati')).toMatchObject({ group: 'Ev & Yaşam', known: true });
    expect(trendyolCommissionFor('Ev & Yaşam › Banyo › Havlu')).toMatchObject({ group: 'Ev & Yaşam' });
    expect(trendyolCommissionFor('Ev & Yaşam › Mutfak › Tencere')).toMatchObject({ group: 'Mutfak', rate: 17 });
    expect(trendyolCommissionFor('Ev & Yaşam › Ev Tekstili › Nevresim')).toMatchObject({ group: 'Tekstil', rate: 20 });
    expect(trendyolCommissionFor('Saat & Aksesuar › Kolye')).toMatchObject({ group: 'Takı & Aksesuar' });
    expect(trendyolCommissionFor('Kitap & Kırtasiye & Hobi › Defter')).toMatchObject({ group: 'Kitap' });
    expect(trendyolCommissionFor('Saklama Kutusu')).toMatchObject({ group: 'Diğer', known: false });
    expect(trendyolCommissionFor('Takı Kutusu')).toMatchObject({ known: false });
    expect(trendyolCommissionFor('Gümüş Kolye')).toMatchObject({ group: 'Takı & Aksesuar', known: true });
  });
  it('required-attribute severity: blocks create and content edits, warns on price / stock-only edits', () => {
    expect(requiredMissingSeverity('create', false)).toBe('block_sync');
    expect(requiredMissingSeverity('edit', true)).toBe('block_sync');
    expect(requiredMissingSeverity('edit', false)).toBe('warn');
  });
  it('an accepted AI proposal counts as applied', () => {
    const staged = [{ attributeId: 2, attributeValueId: 7 }, { attributeId: 4, customAttributeValue: 'Ahşap Kutu' }];
    expect(proposalApplied(staged, { attributeId: 2, attributeValueId: 7 })).toBe(true);
    expect(proposalApplied(staged, { attributeId: 2, attributeValueId: 8 })).toBe(false);
    expect(proposalApplied(staged, { attributeId: 4, customAttributeValue: 'Ahşap Kutu' })).toBe(true);
    expect(proposalApplied(staged, { attributeId: 5, attributeValueId: 1 })).toBe(false);
  });
  it('barcode in use / Wix discount cap / variants / dashboard link / Shopify locations', () => {
    expect(barcodeInUse({ content: [{ barcode: '2000000000001' }] }, '2000000000001')).toBe(true);
    expect(barcodeInUse({ content: [{ barcode: '2000000000002' }] }, '2000000000001')).toBe(false);
    expect(barcodeInUse(null, '2000000000001')).toBe(false);
    expect(wixDiscountValue('PERCENT', 150)).toBe(WIX_MAX_PERCENT);
    expect(wixDiscountValue('PERCENT', 12.34)).toBe(12.3);
    expect(wixDiscountValue('AMOUNT', 150)).toBe(150);
    expect(wixDiscountValue('AMOUNT', 0)).toBeNull();
    expect(wixHasVariants({ variantCount: 3 }, {})).toBe(true);
    expect(wixHasVariants({ variantCount: 1 }, { variants: [{}, {}] })).toBe(false);
    expect(wixHasVariants({}, { variants: [{}, {}] })).toBe(true);
    expect(wixDashboardUrl({ wixSiteId: 'abc-1', wixProductId: 'p-9' })).toBe('https://manage.wix.com/dashboard/abc-1/store/products/product/p-9');
    expect(wixDashboardUrl({ wixProductId: 'p-9' })).toBeNull();
    expect(wixDashboardUrl({ editUrl: 'https://shop.example.com/product/x' })).toBeNull();
    expect(shopifyLocationCount({ locationCount: 1 }, { locationCount: 3 })).toBe(3);
    expect(shopifyLocationCount({ locationCount: 2 }, {})).toBe(2);
    expect(shopifyLocationCount({}, {})).toBe(0);
  });
  it('net estimate takes commission on the gross price and the VAT inside it', () => {
    // 749 − 18% (134.82) − VAT 20% inside (124.83) = 489.35
    expect(trendyolNetEstimate(749, 18, 20)).toBe(489.35);
    expect(trendyolNetEstimate(100, 10, 0)).toBe(90);
    expect(trendyolNetEstimate(null, 18, 20)).toBeNull();
    expect(trendyolDiscountRatio(899, 749)).toBeCloseTo(0.1669, 3);
    expect(trendyolDiscountRatio(700, 749)).toBeNull();
  });
  it('categories flatten to leaves with paths; search matches every word', () => {
    const leaves = flattenTrendyolCategories({
      categories: [{ id: 1, name: 'Ev & Yaşam', subCategories: [{ id: 2, name: 'Dekorasyon', subCategories: [{ id: 3, name: 'Saklama Kutuları', subCategories: [] }] }] }],
    });
    expect(leaves).toEqual([{ id: 3, name: 'Saklama Kutuları', path: 'Ev & Yaşam › Dekorasyon › Saklama Kutuları' }]);
    expect(searchTrendyolCategories(leaves, 'dekor kutu')).toHaveLength(1);
    expect(searchTrendyolCategories(leaves, 'mutfak')).toHaveLength(0);
  });
  it('generates valid restricted-circulation EAN-13 barcodes', () => {
    const b = generateBarcode(() => 0.5);
    expect(b).toMatch(/^2\d{12}$/);
    expect(Number(b[12])).toBe(ean13CheckDigit(b.slice(0, 12)));
    expect(ean13CheckDigit('400638133393')).toBe(1);
  });
  it('brands, addresses, siblings, reject reasons and status parse defensively', () => {
    expect(parseBrands([{ id: 5, name: 'Belle' }, { id: 0 }])).toEqual([{ id: 5, name: 'Belle' }]);
    expect(parseBrands({ brands: [{ id: 6, name: 'X' }] })).toHaveLength(1);
    const addr = parseAddresses({ supplierAddresses: [{ id: 1, addressType: 'Shipment', fullAddress: 'İstanbul', isDefault: true }, { id: 2, addressType: 'Returning', city: 'Ankara' }] });
    expect(addr.map((a) => a.type)).toEqual(['shipment', 'returning']);
    expect(addr[1].label).toBe('Ankara');
    const sib = parseSiblings([{ barcode: 'A' }, { barcode: 'B', attributes: [{ attributeName: 'Beden', attributeValue: 'M' }], images: [{ url: 'https://x/1.jpg' }], quantity: 4 }], 'A');
    expect(sib).toEqual([{ barcode: 'B', title: undefined, image: 'https://x/1.jpg', attributes: [{ name: 'Beden', value: 'M' }], quantity: 4 }]);
    expect(decodeRejectReasons([{ rejectReason: 'Görsel', rejectReasonDetail: '<b>Görsel kalitesi</b> yetersiz' }, 'Görsel: Görsel kalitesi yetersiz'])).toEqual(['Görsel: Görsel kalitesi yetersiz']);
    expect(trendyolListingStatus({ archived: true, rejected: true })).toBe('archived');
    expect(trendyolListingStatus({ approved: false })).toBe('in_review');
    expect(trendyolListingStatus({ approved: true, onSale: true })).toBe('on_sale');
    expect(trendyolListingStatus(null)).toBeNull();
  });
});

describe('Wix', () => {
  it('customer price after an amount or percent discount, never below 0', () => {
    expect(wixCustomerPays(39, 'AMOUNT', 5)).toBe(34);
    expect(wixCustomerPays(40, 'PERCENT', 25)).toBe(30);
    expect(wixCustomerPays(10, 'AMOUNT', 50)).toBe(0);
    expect(wixCustomerPays(10, 'NONE', 5)).toBe(10);
    expect(wixCustomerPays(null, 'AMOUNT', 5)).toBeNull();
  });
  it('collections drop "All Products"; options summarise; managed variants detected', () => {
    expect(parseWixCollections({ collections: [{ id: WIX_ALL_PRODUCTS_COLLECTION, name: 'All' }, { id: 'c1', name: 'Baby' }] })).toEqual([{ id: 'c1', name: 'Baby' }]);
    expect(wixOptionSummary({ options: [{ name: 'Size', choices: [1, 2, 3] }, { name: 'Color', choices: [1, 2] }] })).toEqual({
      options: [{ name: 'Size', count: 3 }, { name: 'Color', count: 2 }],
      combinations: 6,
    });
    expect(wixManagesVariants({ manageVariants: true })).toBe(true);
    expect(wixManagesVariants({ variants: [{}] })).toBe(false);
    expect(untitledTextFields([{ title: 'A', maxLength: 1, mandatory: false }, { title: ' ', maxLength: 1, mandatory: false }])).toEqual([1]);
  });
});

describe('Shopify', () => {
  const rows = parseShopifyVariants([
    { id: 11, option1: 'Pink', option2: 'S', price: '39.00', compare_at_price: '49.00', inventory_quantity: 8, sku: 'BB-P-S', inventory_management: 'shopify' },
    { id: 12, title: 'Blue', price: '39.00', compare_at_price: null, inventory_quantity: 2, inventory_management: null },
  ]);
  it('parses REST variants', () => {
    expect(rows[0]).toEqual({ id: '11', label: 'Pink / S', price: 39, compareAtPrice: 49, quantity: 8, sku: 'BB-P-S', tracked: true });
    expect(rows[1].tracked).toBe(false);
  });
  it('variant edits keep expectedQuantity and drop values equal to Shopify', () => {
    let edits = applyVariantEdit([], rows[0], 'quantity', 5);
    expect(edits).toEqual([{ id: '11', inventoryQuantity: 5, expectedQuantity: 8 }]);
    edits = applyVariantEdit(edits, rows[0], 'price', 35);
    expect(viewVariant(rows[0], edits[0])).toMatchObject({ price: 35, quantity: 5 });
    edits = applyVariantEdit(edits, rows[0], 'quantity', 8);
    expect(edits).toEqual([{ id: '11', price: 35 }]);
    edits = applyVariantEdit(edits, rows[0], 'compareAtPrice', null);
    expect(edits[0].compareAtPrice).toBeNull();
    edits = applyVariantEdit(edits, rows[0], 'price', 39);
    edits = applyVariantEdit(edits, rows[0], 'compareAtPrice', 49);
    expect(edits).toEqual([]);
  });
  it('locations, admin URL, tags, option lists, collections, SEO fallback', () => {
    expect(parseShopifyLocations({ locations: [{ id: 1, name: 'Main', active: true }, { id: 2, name: 'Old', active: false }] })).toEqual([{ id: '1', name: 'Main' }]);
    expect(shopifyAdminUrl({ shopDomain: 'belle.myshopify.com' }, '123')).toBe('https://belle.myshopify.com/admin/products/123');
    expect(shopifyAdminUrl({}, '123')).toBeNull();
    expect(normalizeShopifyTag('  baby,  gift ')).toBe('baby gift');
    expect(optionList(['Belle', 'belle', null, 'Acme'], 'Zed').map((o) => o.value)).toEqual(['Acme', 'Belle', 'Zed']);
    expect(shopifyCollectionNames({ collections: ['Baby', { title: 'Gifts' }, {}] })).toEqual(['Baby', 'Gifts']);
    expect(seoFallbackDescription('<p>Soft&nbsp;blanket</p>')).toBe('Soft blanket');
  });
});

describe('CreateStartCard', () => {
  it('shows only on an untouched create workspace', () => {
    expect(showCreateStartCard({ mode: 'create', changeCount: 0, draft: null })).toBe(true);
    expect(showCreateStartCard({ mode: 'create', changeCount: 1, draft: null })).toBe(false);
    expect(showCreateStartCard({ mode: 'create', changeCount: 0, draft: { id: 'd' } })).toBe(false);
    expect(showCreateStartCard({ mode: 'edit', changeCount: 0, draft: null })).toBe(false);
  });
});

describe('i18n coverage', () => {
  const dir = path.resolve(__dirname, '../../components/domain/listing-editor/sections');
  const files = [
    'TrendyolAttributesSection.tsx', 'TrendyolPriceSection.tsx', 'TrendyolDetailsSection.tsx', 'WixPriceSection.tsx', 'WixDetailsSection.tsx',
    'WixPersonalizationSection.tsx', 'ShopifyOrgSection.tsx', 'ShopifyVariantsSection.tsx', 'ShopifySeoSection.tsx', 'CreateStartCard.tsx',
    'marketplaceSectionShared.tsx',
  ];
  const used = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(`listingEditor.${m[1]}`);
    for (const m of src.matchAll(/'(listingEditor\.[a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\? '([a-z]+\.[a-zA-Z0-9_.]+)' : '([a-z]+\.[a-zA-Z0-9_.]+)'/g)) {
      used.add(`listingEditor.${m[1]}`);
      used.add(`listingEditor.${m[2]}`);
    }
  }
  const lookup = (tree: unknown, key: string) => key.split('.').reduce<unknown>((a, p) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[p] : undefined), tree);
  it.each(['en', 'tr'] as const)('every key the sections use resolves (%s)', (locale) => {
    const msgs = withM6bD(locale);
    const missing = [...used].filter((k) => typeof lookup(msgs, k) !== 'string');
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });
  it('EN and TR define the same M6b-D keys', () => {
    const flat = (t: unknown, p = ''): string[] =>
      Object.entries(t as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : flat(v, `${p}${k}.`)));
    expect(flat(m6bdKeys.tr).sort()).toEqual(flat(m6bdKeys.en).sort());
  });
});

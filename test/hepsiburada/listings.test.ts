import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));

import { listingStatus } from '@/lib/ds/status';
import type { SchemaCaps, StoreContext } from '@/lib/listings/query';
import { hepsiburadaAdapter } from '@/lib/listings/adapters/hepsiburada';
import { toListingRow } from '@/lib/hepsiburada/listingSync';
import { interpretUpload } from '@/lib/hepsiburada/uploads';
import { inventoryRow, draftOutcomes, hepsiburadaRemoteValues } from '@/lib/catalogDrafts/executors/hepsiburada';
import { validateFieldPatch, ALLOWED_FIELDS } from '@/lib/catalogDrafts/schemas';
import { STAGEABLE_FIELDS } from '@/lib/listings/csvImport';
import { buildImportItem, toUploadItem } from '@/pages/api/hepsiburada/products';
import { toCategoryOption } from '@/pages/api/hepsiburada/metadata';
import { attributesToAsk, parseImageUrls } from '@/components/domain/hepsiburada/HepsiburadaCreatePage';
import { effectiveValues, stagePatch } from '@/components/domain/hepsiburada/HepsiburadaListingPage';
import { LISTINGS_CONFIGS } from '@/components/domain/listings/config';
import { BULK_CONFIGS } from '@/components/domain/bulk/config';
import { matches } from '../listings/g1-fakeDb';

const NO_CAPS: SchemaCaps = { health: false, skus: false, offeringSkus: false, scheduledSendAt: false, drafts: true } as SchemaCaps;
const ctx = { userId: 'u1', store: { id: 'm1', name: 'Hepsiburada', currency: 'TRY', lastPulledAt: null }, stores: [], storeWhere: {}, meta: {} } as unknown as StoreContext;

const row = (over: Record<string, unknown> = {}) => ({
  hbSku: 'HBC00001', merchantSku: 'MS-1', barcode: '869000', title: 'Ahşap Kutu &amp; Kapak', brand: 'Belle', categoryId: 12,
  categoryName: 'Kutular', price: '149.90', availableStock: 5, dispatchTime: 2, thumbnailUrl: 'https://img/1.jpg', images: ['a', 'b'],
  isSalable: true, isSuspended: false, isLocked: false, isFrozen: false, isFulfilledByHB: false, deactivationReasons: [],
  syncedAt: new Date('2026-10-18T10:00:00Z'), createdAt: new Date('2026-10-01T10:00:00Z'), ...over,
});

describe('hepsiburada listing status', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{}, 'active'],
    [{ availableStock: 0 }, 'sold_out'],
    [{ availableStock: 0, isSalable: false }, 'sold_out'],
    [{ isSalable: false }, 'inactive'],
    [{ isSuspended: true }, 'inactive'],
    [{ isLocked: true, availableStock: 0 }, 'inactive'],
    [{ isFrozen: true }, 'inactive'],
  ];
  it.each(cases)('%o → %s, and statusWhere matches exactly that key', (over, expected) => {
    const r = row(over);
    expect(listingStatus(r as any, 'hepsiburada')).toBe(expected);
    for (const key of hepsiburadaAdapter.statusKeys) {
      const w = hepsiburadaAdapter.statusWhere(key);
      expect({ key, hit: !!w && matches(r as any, w) }).toEqual({ key, hit: key === expected });
    }
  });
});

describe('hepsiburadaAdapter.toRow', () => {
  it('maps the cache row', () => {
    const r = hepsiburadaAdapter.toRow(row() as any, ctx, NO_CAPS);
    expect(r.id).toBe('HBC00001');
    expect(r.title).toBe('Ahşap Kutu & Kapak');
    expect(r.metaLine).toEqual(['HBC00001', 'MS-1']);
    expect(r.price).toEqual({ amount: 149.9, currency: 'TRY' });
    expect(r.qty).toBe(5);
    expect(r.editable).toEqual({ price: true, qty: true });
    expect(r.extra.photos).toBe(2);
    expect(r.externalUrl).toContain('HBC00001');
  });
  it('fulfilled-by-HB rows keep stock read-only; deactivation reasons become the status note', () => {
    const r = hepsiburadaAdapter.toRow(row({ isFulfilledByHB: true, isSuspended: true, deactivationReasons: ['Fiyat hatası'] }) as any, ctx, NO_CAPS);
    expect(r.editable.qty).toBe(false);
    expect(r.status).toBe('inactive');
    expect(r.statusNote).toBe('Fiyat hatası');
  });
});

describe('toListingRow', () => {
  it('joins a listing with its catalog product', () => {
    const r = toListingRow(
      { hepsiburadaSku: 'HB1', merchantSku: 'M1', price: 10, availableStock: 3, dispatchTime: 1, cargoCompany1: 'Yurtiçi', isSalable: true, isFulfilledByHB: false },
      { hbSku: 'HB1', productName: 'Kutu', brand: 'B', images: ['https://a', ''], barcode: '86', categoryId: 5, categoryName: 'C' },
    );
    expect(r).toMatchObject({ hbSku: 'HB1', merchantSku: 'M1', title: 'Kutu', images: ['https://a'], price: 10, availableStock: 3, cargoCompanies: ['Yurtiçi'], barcode: '86' });
  });
  it('falls back to the pricing final price and tolerates a missing product', () => {
    const r = toListingRow({ hepsiburadaSku: 'HB2', pricings: [{ finalPrice: 99 }] } as any);
    expect(r.price).toBe(99);
    expect(r.title).toBeNull();
    expect(r.availableStock).toBe(0);
  });
});

describe('interpretUpload', () => {
  it('pending until done; per-row errors and price validations become failed skus', () => {
    expect(interpretUpload({ status: 'Ready' }).state).toBe('pending');
    const done = interpretUpload({ status: 'Done', errors: [{ hepsiburadaSku: 'A', errorMessage: 'bad' }], priceValidations: [{ merchantSku: 'B', minPrice: 1, maxPrice: 2 }] });
    expect(done).toEqual({ state: 'done', failedSkus: { A: 'bad', B: 'price outside allowed range 1–2' } });
    expect(interpretUpload({ status: 'Failed', errors: [{ message: 'x' }] })).toEqual({ state: 'failed', error: 'x' });
  });
});

describe('catalog draft executor (pure parts)', () => {
  const draft = (fieldPatch: Record<string, unknown>) => ({ id: 'd1', externalId: 'HB1', fieldPatch } as any);
  const remote = (over: Record<string, unknown> = {}) => {
    const live = { hepsiburadaSku: 'HB1', merchantSku: 'M1', price: 100, availableStock: 4, dispatchTime: 2, maximumPurchasableQuantity: 3, isFulfilledByHB: false, ...over };
    return { exists: true, updatedAt: null, values: hepsiburadaRemoteValues(live), raw: live };
  };

  it('builds a FULL inventory row: live ⊕ patch', () => {
    expect(inventoryRow(draft({ price: 120 }), remote())).toEqual({ hepsiburadaSku: 'HB1', merchantSku: 'M1', price: 120, availableStock: 4, dispatchTime: 2, maximumPurchasableQuantity: 3 });
    expect(inventoryRow(draft({ quantity: 0, dispatchTime: 1 }), remote())).toMatchObject({ price: 100, availableStock: 0, dispatchTime: 1 });
  });
  it('refuses a stock change on fulfilled-by-HB listings', () => {
    expect(() => inventoryRow(draft({ quantity: 1 }), remote({ isFulfilledByHB: true }))).toThrow();
    expect(inventoryRow(draft({ price: 50 }), remote({ isFulfilledByHB: true })).price).toBe(50);
  });
  it('maps upload outcomes per draft', () => {
    const rows = new Map([['HB1', { hepsiburadaSku: 'HB1', merchantSku: 'M1', price: 120, availableStock: 4 }]]);
    const d = [draft({ price: 120 })];
    expect(draftOutcomes({ state: 'pending' }, d, rows).get('d1')).toEqual({ kind: 'pending' });
    expect(draftOutcomes({ state: 'done', failedSkus: {} }, d, rows).get('d1')).toEqual({ kind: 'synced', applied: { price: 120, quantity: 4 } });
    expect(draftOutcomes({ state: 'done', failedSkus: { M1: 'nope' } }, d, rows).get('d1')).toMatchObject({ kind: 'failed', errorParams: { reason: 'nope' } });
    expect(draftOutcomes({ state: 'failed', error: 'down' }, d, rows).get('d1')).toMatchObject({ kind: 'failed' });
  });
  it('validates staged HB fields and aliases', () => {
    expect(validateFieldPatch('hepsiburada', { availableStock: 3, dispatchTime: 2, maximumPurchasableQuantity: 5, price: '9.5' }).set)
      .toEqual({ quantity: 3, dispatchTime: 2, maxPurchasableQuantity: 5, price: 9.5 });
    expect(() => validateFieldPatch('hepsiburada', { title: 'x' })).toThrow();
    expect(() => validateFieldPatch('hepsiburada', { dispatchTime: 99 })).toThrow();
  });
  it('grid/CSV stageable fields stay a subset of the draft fields', () => {
    for (const f of STAGEABLE_FIELDS.hepsiburada) expect(ALLOWED_FIELDS.hepsiburada).toContain(f);
  });
});

describe('products API pure helpers', () => {
  it('builds the HB import item', () => {
    const out = buildImportItem('m1', {
      categoryId: 12, merchantSku: 'MS-1', title: 'Kutu', description: '<p>x</p>', brand: 'Belle', vatRate: 20, warrantyMonths: 24,
      images: ['https://a/1.jpg', 'http://insecure', 'https://a/2.jpg'], price: 99.9, stock: 3, attributes: { renk: 'Kahve', UrunAdi: 'ignored' },
    });
    expect('item' in out).toBe(true);
    const item = (out as any).item;
    expect(item).toMatchObject({ categoryId: 12, merchant: 'm1' });
    expect(item.attributes).toMatchObject({ merchantSku: 'MS-1', VaryantGroupID: 'MS-1', UrunAdi: 'Kutu', Marka: 'Belle', tax_vat_rate: '20', Image1: 'https://a/1.jpg', Image2: 'https://a/2.jpg', renk: 'Kahve', price: '99.9', stock: '3' });
    expect(item.attributes.Image3).toBeUndefined();
  });
  it('lists every invalid creator field', () => {
    expect(buildImportItem('m1', { vatRate: 7 })).toEqual({ errors: ['categoryId', 'merchantSku', 'title', 'description', 'brand', 'vatRate', 'images'] });
  });
  it('update items need an hbSku and a value', () => {
    expect(toUploadItem({ hbSku: 'A', price: '10.555', stock: 2.7 })).toEqual({ hepsiburadaSku: 'A', price: 10.56, availableStock: 2 });
    expect(toUploadItem({ hbSku: 'A' })).toBeNull();
    expect(toUploadItem({ price: 1 })).toBeNull();
  });
  it('category option keeps the path', () => {
    expect(toCategoryOption({ categoryId: 5, displayName: 'Kutu', paths: ['Ev', 'Kutu'] })).toEqual({ id: 5, name: 'Kutu', path: 'Ev › Kutu' });
    expect(toCategoryOption({ categoryId: 0 })).toBeNull();
  });
});

describe('creator / listing page pure helpers', () => {
  it('asks only for non-base attributes, mandatory first', () => {
    const list = attributesToAsk({
      baseAttributes: [{ id: 'merchantSku', name: 'SKU', mandatory: true }, { id: 'Garanti_Tipi', name: 'Garanti tipi', mandatory: false }],
      attributes: [{ id: 'renk', name: 'Renk', mandatory: true, type: 'enum' }],
      variantAttributes: [{ id: 'renk', name: 'Renk', mandatory: true }],
    });
    expect(list.map((a) => a.id)).toEqual(['renk', 'Garanti_Tipi']);
  });
  it('parses up to 5 https image links', () => {
    expect(parseImageUrls('https://a\nhttp://b, https://c\n\nftp://d')).toEqual(['https://a', 'https://c']);
  });
  it('stages only changed values and drops reverted ones', () => {
    const live = effectiveValues({ price: 10, availableStock: 2, dispatchTime: 1, maximumPurchasableQuantity: null }, null);
    expect(effectiveValues({ price: 10, availableStock: 2, dispatchTime: 1, maximumPurchasableQuantity: null }, { fieldPatch: { price: 12 } }).price).toBe(12);
    expect(stagePatch(live, { ...live, price: 12 })).toEqual({ price: 12, quantity: null, dispatchTime: null });
  });
});

describe('registries', () => {
  it('hepsiburada has a listings and a bulk config', () => {
    expect(LISTINGS_CONFIGS.hepsiburada.route).toBe('/app/hepsiburada-urunler');
    expect(LISTINGS_CONFIGS.hepsiburada.editorHref('HB 1', null)).toBe('/app/hepsiburada-urunler/HB%201');
    expect(BULK_CONFIGS.hepsiburada.fields).toEqual(['price', 'qty']);
  });
});

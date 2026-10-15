import { describe, expect, it, vi } from 'vitest';
import {
  applyListingRows,
  buildImportPlan,
  STAGEABLE_FIELDS,
  unguardCell,
  detectMapping,
  importTemplateCsv,
  parseCSVLine,
  parseCsv,
  parseMoney,
  parseQty,
  parseTags,
  readListingsCsv,
  setMapping,
  stageableFields,
  type CurrentListing,
} from '@/lib/listings/csvImport';
import { computeFindReplace } from '@/components/domain/listings/tools/FindReplacePanel';
import { exportColumns, toCsv } from '@/lib/listings/csv';
import type { ListingRow } from '@/lib/listings/types';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/stock/settings', () => ({ channelEnabled: vi.fn(), getStockSettings: vi.fn(), isStockSyncActive: vi.fn() }));

describe('parseCSVLine (ported from etsy-listings.tsx)', () => {
  it('splits on commas and honours quotes and escaped quotes', () => {
    expect(parseCSVLine('a,"b,c","say ""hi""",')).toEqual(['a', 'b,c', 'say "hi"', '']);
  });
  it('supports another delimiter', () => {
    expect(parseCSVLine('a;"b;c";d', ';')).toEqual(['a', 'b;c', 'd']);
  });
});

describe('parseCsv', () => {
  it('strips the BOM, handles CRLF, quoted newlines and blank lines', () => {
    const text = '﻿listing_id,title,description\r\n1,"Baby, blanket","line one\nline two"\r\n\r\n2,Bib,x\r\n';
    const csv = parseCsv(text);
    expect(csv.headers).toEqual(['listing_id', 'title', 'description']);
    expect(csv.rows).toEqual([
      ['1', 'Baby, blanket', 'line one\nline two'],
      ['2', 'Bib', 'x'],
    ]);
    expect(csv.lines).toEqual([2, 4]);
  });
  it('detects semicolon files (Excel TR)', () => {
    const csv = parseCsv('id;fiyat;stok\n10;12,50;3\n');
    expect(csv.delimiter).toBe(';');
    expect(csv.rows[0]).toEqual(['10', '12,50', '3']);
  });
  it('returns nothing for an empty file', () => {
    expect(parseCsv('  \n').headers).toEqual([]);
  });
});

describe('value parsers', () => {
  it('parseMoney reads dot and comma decimals and thousands', () => {
    expect(parseMoney('12.50')).toBe(12.5);
    expect(parseMoney('12,50')).toBe(12.5);
    expect(parseMoney('$1,234.50')).toBe(1234.5);
    expect(parseMoney('1.234,50 ₺')).toBe(1234.5);
    expect(parseMoney('1,234')).toBe(1234);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
  it('parseQty accepts whole numbers only', () => {
    expect(parseQty('12')).toBe(12);
    expect(parseQty('12.0')).toBe(12);
    expect(parseQty('12.5')).toBeNull();
    expect(parseQty('x')).toBeNull();
  });
  it('parseTags prefers |, de-duplicates case-insensitively', () => {
    expect(parseTags('baby gift| Baby Gift |nursery decor')).toEqual(['baby gift', 'nursery decor']);
    expect(parseTags('a, b ,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('mapping', () => {
  it('detects the id column per marketplace and the editable fields (incl. Turkish headers)', () => {
    const fields = stageableFields('etsy');
    expect(detectMapping(['listing_id', 'Başlık', 'Fiyat', 'Stok', 'Etiketler', 'sku'], 'etsy', fields)).toEqual(['id', 'title', 'price', 'quantity', 'tags', null]);
    expect(detectMapping(['SKU', 'Title', 'price'], 'ebay', stageableFields('ebay'))).toEqual(['id', 'title', 'price']);
    expect(detectMapping(['barcode', 'tags'], 'trendyol', stageableFields('trendyol'))).toEqual(['id', null]);
  });
  it('setMapping keeps each field on one column', () => {
    expect(setMapping(['id', 'title', null], 2, 'title')).toEqual(['id', null, 'title']);
    expect(setMapping(['id', 'title'], 1, null)).toEqual(['id', null]);
  });
  it('offers description only on opt-in and tags only where they exist', () => {
    expect(stageableFields('etsy')).toEqual(['title', 'price', 'quantity', 'tags']);
    expect(stageableFields('etsy', { description: true })).toContain('description');
    expect(stageableFields('wix', { description: true })).toEqual(['title', 'price', 'quantity']);
    expect(stageableFields('shopify')).toContain('tags');
  });
});

describe('readListingsCsv (export format)', () => {
  it('reads id, title, price, quantity, tags and variations', () => {
    const map = readListingsCsv('﻿id,title,price,currency,quantity,status,sku,tags,health,url,has_variations\n1,Blanket,40.00,USD,3,active,BB,a|b,80,https://x,false\n2,Bib,10,USD,,active,,,,,true\n');
    expect(map.get('1')).toMatchObject({ title: 'Blanket', price: 40, quantity: 3, tags: ['a', 'b'], hasVariations: false });
    expect(map.get('2')).toMatchObject({ quantity: null, tags: [], hasVariations: true });
  });
});

describe('buildImportPlan', () => {
  const current = new Map<string, CurrentListing>([
    ['1', { id: '1', title: 'Pink Baby Blanket', price: 40, quantity: 3, tags: ['baby'], description: null, hasVariations: false }],
    ['2', { id: '2', title: 'Bib', price: 10, quantity: 5, tags: [], description: null, hasVariations: true }],
    ['3', { id: '3', title: 'Same', price: 12, quantity: 1, tags: ['x'], description: null, hasVariations: false }],
    ['4', { id: '4', title: 'Four', price: 12, quantity: 1, tags: [], description: null, hasVariations: false }],
    ['5', { id: '5', title: 'Five', price: 12, quantity: 1, tags: [], description: null, hasVariations: false }],
  ]);
  const csv = parseCsv(
    [
      'listing_id,title,price,quantity,tags',
      '1,Pink Baby Blanket,44.5,3,baby|gift', // price + tags change
      '2,,12,,', // variations: price is read-only
      '3,Same,12,1,x', // unchanged
      '9,Ghost,1,1,', // not found
      '1,,abc,,', // duplicate row
      `4,${'T'.repeat(141)},,,`, // title over 140
      '5,,,1000,', // qty over Etsy max
      ',,5,,', // no id: skipped
    ].join('\n'),
  );
  const plan = buildImportPlan({ csv, mapping: detectMapping(csv.headers, 'etsy', stageableFields('etsy')), current, marketplace: 'etsy', fields: stageableFields('etsy') });

  it('classifies every row with an id', () => {
    expect(plan.rows.map((r) => [r.id, r.kind])).toEqual([
      ['1', 'change'],
      ['2', 'invalid'],
      ['3', 'unchanged'],
      ['9', 'not_found'],
      ['1', 'invalid'],
      ['4', 'invalid'],
      ['5', 'invalid'],
    ]);
    expect(plan.summary).toEqual({ rows: 8, change: 1, unchanged: 1, missing: 1, invalid: 4 });
  });
  it('builds the stage patch from changed cells only (qty → StagePatch.qty)', () => {
    expect(plan.rows[0].patch).toEqual({ price: 44.5, tags: ['baby', 'gift'] });
    expect(plan.rows[0].changed).toEqual(['price', 'tags']);
  });
  it('gives i18n keys for every invalid cell', () => {
    expect(plan.rows[1].issues).toEqual([{ field: 'price', key: 'cell.variationsReadOnly' }]);
    expect(plan.rows[4].issues[0].key).toBe('csv.duplicateRow');
    expect(plan.rows[5].issues).toEqual([{ field: 'title', key: 'fr.overLimit', params: { max: 140 } }]);
    expect(plan.rows[6].issues).toEqual([{ field: 'quantity', key: 'validate.qtyInvalid', params: { min: 0, max: 999 } }]);
  });
  it('flags a price under the marketplace minimum', () => {
    const c = parseCsv('listing_id,price\n3,0.10\n');
    const p = buildImportPlan({ csv: c, mapping: ['id', 'price'], current, marketplace: 'etsy', fields: stageableFields('etsy') });
    expect(p.rows[0].issues).toEqual([{ field: 'price', key: 'validate.priceMin', params: { marketplace: 'etsy', min: 0.2 } }]);
  });
});

describe('importTemplateCsv', () => {
  it('writes a BOM and the marketplace id column', () => {
    expect(importTemplateCsv('etsy')).toBe('﻿listing_id,title,price,quantity,tags\r\n');
    expect(importTemplateCsv('trendyol')).toBe('﻿barcode,price,quantity\r\n');
  });
});

describe('CSV-injection guard round-trip', () => {
  it('strips one guard apostrophe and keeps any other apostrophe', () => {
    expect(unguardCell("'-Sale-")).toBe('-Sale-');
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(unguardCell("'tis the season")).toBe("'tis the season");
    expect(unguardCell("''-x")).toBe("''-x");
  });
  it('export → readListingsCsv → Find & replace never stages a stray apostrophe', () => {
    const text = toCsv(exportColumns([], true), [
      { id: '1', title: '-Sale- Pink Blanket', price: 40, currency: 'USD', quantity: 3, status: 'active', sku: '', tags: '+gift, pink', health: 80, url: '', description: '- soft cotton\n- pink' },
    ]);
    expect(text).toContain("'-Sale- Pink Blanket");
    const cur = readListingsCsv(text).get('1')!;
    expect(cur.title).toBe('-Sale- Pink Blanket');
    expect(cur.tags).toEqual(['+gift', 'pink']);
    expect(cur.description).toBe('- soft cotton\n- pink');
    const fr = computeFindReplace([cur], { field: 'title', find: 'Pink', replace: 'Rose', matchCase: false }, 'etsy');
    expect(fr.stageable[0].patch).toEqual({ title: '-Sale- Rose Blanket' });
    // Re-importing the untouched export changes nothing.
    const csv = parseCsv(text);
    const plan = buildImportPlan({ csv, mapping: detectMapping(csv.headers, 'etsy', stageableFields('etsy')), current: readListingsCsv(text), marketplace: 'etsy', fields: stageableFields('etsy') });
    expect(plan.summary.change).toBe(0);
  });
});

describe('per-marketplace stageable fields', () => {
  it('mirrors the CatalogDraft ALLOWED_FIELDS for Trendyol, Wix and Shopify', async () => {
    const { ALLOWED_FIELDS } = await import('@/lib/catalogDrafts/service');
    for (const mp of ['trendyol', 'wix', 'shopify'] as const) {
      for (const f of STAGEABLE_FIELDS[mp]) expect(ALLOWED_FIELDS[mp]).toContain(f);
    }
  });
  it('never puts a title in a Trendyol import plan', () => {
    const fields = stageableFields('trendyol');
    expect(fields).toEqual(['price', 'quantity']);
    const csv = parseCsv('barcode,title,price\nB1,New Title,55\n');
    const current = new Map<string, CurrentListing>([['B1', { id: 'B1', title: 'Old', price: 50, quantity: 1, tags: null, description: null, hasVariations: false }]]);
    const plan = buildImportPlan({ csv, mapping: detectMapping(csv.headers, 'trendyol', fields), current, marketplace: 'trendyol', fields });
    expect(plan.rows[0].patch).toEqual({ price: 55 });
  });
});

const listingRow = (id: string, over: Partial<ListingRow> = {}): Pick<ListingRow, 'id' | 'editable' | 'sync'> => ({
  id,
  editable: { price: true, qty: true },
  sync: null,
  ...over,
});

describe('drafts and editability (applyListingRows)', () => {
  const base = () =>
    new Map<string, CurrentListing>([
      ['1', { id: '1', title: 'Pink Blanket', price: 40, quantity: 3, tags: ['pink'], description: null, hasVariations: false }],
      ['2', { id: '2', title: 'Variation Bib', price: 10, quantity: 5, tags: [], description: null, hasVariations: false }],
    ]);

  it('does not stage price/qty for an Etsy listing whose editability is unknown or that has variations', () => {
    const csv = parseCsv('listing_id,price,quantity\n2,12,6\n');
    const fields = stageableFields('etsy');
    const unknown = buildImportPlan({ csv, mapping: ['id', 'price', 'quantity'], current: base(), marketplace: 'etsy', fields, requireEditable: true });
    expect(unknown.rows[0].kind).toBe('invalid');
    expect(unknown.rows[0].issues.map((i) => i.key)).toEqual(['csv.editableUnknown', 'csv.editableUnknown']);
    const withRows = applyListingRows(base(), [listingRow('2', { editable: { price: false, qty: false, reason: 'variations' } })]);
    const plan = buildImportPlan({ csv, mapping: ['id', 'price', 'quantity'], current: withRows, marketplace: 'etsy', fields, requireEditable: true });
    expect(plan.rows[0].patch).toEqual({});
    expect(plan.rows[0].issues).toEqual([
      { field: 'price', key: 'cell.variationsReadOnly' },
      { field: 'quantity', key: 'cell.variationsReadOnly' },
    ]);
  });

  it('diffs against the unsent draft value and warns when a change replaces it', () => {
    const sync = { draftId: 'd1', status: 'pending' as const, changedFields: ['title', 'tags'], draft: { title: 'Rose Blanket' }, queuedDelete: false, scheduledSendAt: null, syncedAt: null };
    const cur = applyListingRows(base(), [listingRow('1', { sync })]);
    expect(cur.get('1')).toMatchObject({ title: 'Rose Blanket', draft: { status: 'pending', fields: ['title', 'tags'], overlaid: ['title'] } });
    const fields = stageableFields('etsy');
    const same = buildImportPlan({ csv: parseCsv('listing_id,title\n1,Rose Blanket\n'), mapping: ['id', 'title'], current: cur, marketplace: 'etsy', fields, requireEditable: true });
    expect(same.rows[0].kind).toBe('unchanged');
    const changed = buildImportPlan({ csv: parseCsv('listing_id,title,tags\n1,Pink Blanket,pink|gift\n'), mapping: ['id', 'title', 'tags'], current: cur, marketplace: 'etsy', fields, requireEditable: true });
    expect(changed.rows[0].kind).toBe('change');
    expect(changed.rows[0].warnings.map((w) => w.field)).toEqual(['title', 'tags']);
    // Find & replace works from the draft title and refuses to overwrite unsent tags it cannot read.
    const list = Array.from(cur.values());
    expect(computeFindReplace(list, { field: 'title', find: 'Rose', replace: 'Red', matchCase: false }, 'etsy').stageable[0].patch).toEqual({ title: 'Red Blanket' });
    const tags = computeFindReplace(list, { field: 'tags', find: 'pink', replace: 'rose', matchCase: false }, 'etsy');
    expect(tags.changes[0].flag).toBe('unsentChange');
    expect(tags.stageable).toEqual([]);
  });

  it('blocks a change to a draft that is being sent', () => {
    const sync = { draftId: 'd1', status: 'syncing' as const, changedFields: ['price'], draft: { price: 41 }, queuedDelete: false, scheduledSendAt: null, syncedAt: null };
    const cur = applyListingRows(base(), [listingRow('1', { sync })]);
    const plan = buildImportPlan({ csv: parseCsv('listing_id,price\n1,44\n'), mapping: ['id', 'price'], current: cur, marketplace: 'etsy', fields: stageableFields('etsy'), requireEditable: true });
    expect(plan.rows[0].issues.map((i) => i.key)).toEqual(['csv.sending']);
    expect(computeFindReplace(Array.from(cur.values()), { field: 'title', find: 'Pink', replace: 'Rose', matchCase: false }, 'etsy').changes[0].flag).toBe('sending');
  });
});

describe('Find & replace tag separators', () => {
  it('flags a replacement that would put a separator inside a tag', () => {
    const l: CurrentListing = { id: '1', title: 'x', price: 1, quantity: 1, tags: ['pink gift'], description: null, hasVariations: false };
    for (const sep of [',', '|', ';']) {
      const r = computeFindReplace([l], { field: 'tags', find: 'pink', replace: `rose${sep} pink`, matchCase: false }, 'etsy');
      expect(r.changes[0].flag).toBe('tagSeparator');
      expect(r.stageable).toEqual([]);
    }
  });
});

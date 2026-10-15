// M9 Group D: product cost wrappers (lib/reports/productCosts.ts) — the "Paste a list" parser (tabs / semicolons,
// header row, locale decimals, skip reasons), the bulk payload honouring the chosen currency (B15), and the unit
// cost upsert (barcode → upsert_by_barcode with the dashboard currency; SKU-only → find + PUT or create; neither →
// refused). `listCosts` reads the API's `costs` field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CostCurrencyConflictError, MissingProductCodeError, bulkCreateCosts, costListToItems, failedCodesFrom, listAllCosts,
  listCosts, parseCostList, parseCostNumber, shippingNeedsReentry, splitShippingConflicts, upsertCost,
  type ProductCostEntry,
} from '@/lib/reports/productCosts';
import { remainingListText } from '@/components/domain/reports/profit/ProductCostsPanel';

interface Call { url: string; method: string; body: Record<string, unknown> | null }
let calls: Call[] = [];
function mockFetch(handler: (c: Call) => { status?: number; body: unknown }) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const c: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}
afterEach(() => vi.restoreAllMocks());

const cost = (over: Record<string, unknown> = {}) => ({
  id: 'c1', marketplace: 'etsy', barcode: 'BB-01', sku: null, marketplaceId: null, productName: 'Blanket',
  costAmount: '11.5', costCurrency: 'USD', shippingCost: null, notes: null, ...over,
});

describe('parseCostNumber', () => {
  it.each([
    ['11,50', 11.5], ['11.50', 11.5], ['1.109,30', 1109.3], ['1,109.30', 1109.3], ['₺12', 12], ['$ 4.2', 4.2], ['12 TL', 12],
  ])('%s → %s', (raw, n) => expect(parseCostNumber(raw)).toBe(n));
  it.each(['', 'abc', '-3', '1.2.3x'])('%s → null', (raw) => expect(parseCostNumber(raw)).toBeNull());
});

describe('parseCostList', () => {
  it('reads a spreadsheet paste (tabs), skips the header and blank lines, lists skipped rows with reasons', () => {
    const text = 'Barcode\tName\tCost\tShipping\nBB-01\tBlanket\t11,50\t2\n\n\tNo code\t5\nNN-G\tNecklace\tabc\nWKB\t\t14';
    const p = parseCostList(text);
    expect(p.valid).toEqual([
      { line: 2, code: 'BB-01', productName: 'Blanket', costAmount: 11.5, shippingCost: 2 },
      { line: 6, code: 'WKB', productName: 'WKB', costAmount: 14, shippingCost: null },
    ]);
    expect(p.invalid).toEqual([{ line: 4, reason: 'noCode' }, { line: 5, reason: 'badCost' }]);
  });

  it('semicolon separated keeps decimal commas; a first data row is not mistaken for a header', () => {
    const p = parseCostList('BB-01;Blanket;11,50;0,75');
    expect(p.valid[0]).toMatchObject({ costAmount: 11.5, shippingCost: 0.75 });
    expect(p.invalid).toEqual([]);
  });

  it('bulk items carry the list currency (B15: never a hard-coded TRY) and the code as barcode only (a saved SKU is kept)', () => {
    const items = costListToItems(parseCostList('BB-01,Blanket,11.5').valid, 'USD');
    expect(items).toEqual([{ productName: 'Blanket', barcode: 'BB-01', costAmount: 11.5, costCurrency: 'USD', shippingCost: null }]);
    expect('sku' in items[0]).toBe(false);
  });

  it('remainingListText keeps only the lines whose code was not saved, in order', () => {
    const text = 'Barcode\tName\tCost\nBB-01\tBlanket\t11\nNN-G\tNecklace\t4\nWKB\tBox\t14';
    const rows = parseCostList(text).valid;
    expect(remainingListText(text, rows, new Set(['NN-G', 'WKB']))).toBe('NN-G\tNecklace\t4\nWKB\tBox\t14');
  });
});

const entry = (over: Partial<ProductCostEntry> = {}): ProductCostEntry => ({
  id: 'c1', marketplace: 'etsy', barcode: 'BB-01', sku: null, marketplaceId: null, productName: 'Blanket',
  costAmount: 10, costCurrency: 'TRY', shippingCost: 50, notes: null, ...over,
});

describe('currency change over a saved shipping cost', () => {
  it('shippingNeedsReentry: only a currency change over non-zero shipping with no new shipping value', () => {
    expect(shippingNeedsReentry(entry(), 'USD')).toBe(true);
    expect(shippingNeedsReentry(entry(), 'USD', null)).toBe(true);
    expect(shippingNeedsReentry(entry(), 'USD', 2)).toBe(false); // re-entered in USD
    expect(shippingNeedsReentry(entry(), 'TRY')).toBe(false); // same currency: the number keeps its meaning
    expect(shippingNeedsReentry(entry({ shippingCost: null }), 'USD')).toBe(false);
    expect(shippingNeedsReentry(entry({ shippingCost: 0 }), 'USD')).toBe(false);
    expect(shippingNeedsReentry(null, 'USD')).toBe(false);
  });

  it('splitShippingConflicts holds back list rows that would re-read a TRY shipping as USD', () => {
    const items = costListToItems(parseCostList('BB-01;Blanket;11\nNN-G;Necklace;4\nWKB;Box;14;1').valid, 'USD');
    const saved = [entry(), entry({ id: 'c2', barcode: 'WKB' }), entry({ id: 'c3', barcode: 'NN-G', costCurrency: 'USD' })];
    const { ok, conflicts } = splitShippingConflicts(items, saved);
    expect(conflicts.map((x) => x.item.barcode)).toEqual(['BB-01']);
    expect(ok.map((x) => x.barcode)).toEqual(['NN-G', 'WKB']); // same currency; shipping re-entered
  });

  it('failedCodesFrom maps the bulk endpoint errors back to codes', () => {
    const r = failedCodesFrom(['Error for BB-01: boom', 'Missing required fields for item: NN-G', 'Error for unknown: x'], ['BB-0', 'BB-01', 'NN-G']);
    expect([...r.codes].sort()).toEqual(['BB-01', 'NN-G']);
    expect(r.unmatched).toBe(1);
  });
});

describe('fetch wrappers', () => {
  it('listAllCosts pages through every saved cost', async () => {
    mockFetch((c) => {
      const page = Number(new URL(c.url, 'http://x').searchParams.get('page'));
      return { body: { costs: [cost({ id: `p${page}` })], totalPages: 3 } };
    });
    const all = await listAllCosts('etsy');
    expect(all.map((c) => c.id)).toEqual(['p0', 'p1', 'p2']);
    expect(calls).toHaveLength(3);
  });

  it('listCosts reads `costs` and normalises Decimal strings', async () => {
    mockFetch(() => ({ body: { costs: [cost()], total: 1 } }));
    const list = await listCosts('etsy');
    expect(list[0]).toMatchObject({ id: 'c1', costAmount: 11.5, costCurrency: 'USD' });
    expect(calls[0].url).toContain('marketplace=etsy');
  });

  it('bulkCreateCosts splits into 500-item requests and sums the results', async () => {
    mockFetch((c) => ({ body: { created: (c.body?.items as unknown[]).length, updated: 0, errors: [], total: (c.body?.items as unknown[]).length } }));
    const items = Array.from({ length: 620 }, (_, i) => ({ productName: `P${i}`, barcode: `B${i}`, costAmount: 1, costCurrency: 'EUR' }));
    const res = await bulkCreateCosts('etsy', items);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({ action: 'bulk', marketplace: 'etsy' });
    expect((calls[1].body?.items as unknown[]).length).toBe(120);
    expect(res).toEqual({ created: 620, updated: 0, errors: [], total: 620 });
  });
});

describe('upsertCost', () => {
  it('barcode row with no saved cost → upsert_by_barcode with the dashboard currency', async () => {
    mockFetch((c) => ({ body: c.method === 'GET' ? { costs: [] } : cost({ costAmount: 9, costCurrency: 'USD' }) }));
    const saved = await upsertCost('etsy', { barcode: 'BB-01', sku: null, productName: 'Blanket' }, 9, 'USD');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1]).toMatchObject({ method: 'POST', body: { action: 'upsert_by_barcode', marketplace: 'etsy', barcode: 'BB-01', costAmount: 9, costCurrency: 'USD' } });
    expect(saved?.costAmount).toBe(9);
  });

  it('saved cost in another currency with no shipping: one PUT with amount and currency together', async () => {
    mockFetch((c) => ({ body: c.method === 'GET' ? { costs: [cost({ id: 'x', barcode: 'BB-012' }), cost({ costCurrency: 'TRY' })] } : cost({ costCurrency: 'USD' }) }));
    const saved = await upsertCost('etsy', { barcode: 'BB-01', sku: null, productName: 'Blanket' }, 11.5, 'USD');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls[1].body).toEqual({ id: 'c1', costAmount: 11.5, costCurrency: 'USD' });
    expect(saved?.costCurrency).toBe('USD');
  });

  it('a TRY cost with shipping edited from a USD dashboard is refused: nothing is written', async () => {
    mockFetch(() => ({ body: { costs: [cost({ costCurrency: 'TRY', shippingCost: '40' })] } }));
    const err = await upsertCost('etsy', { barcode: 'BB-01', sku: null, productName: 'Blanket' }, 11.5, 'USD').catch((e) => e);
    expect(err).toBeInstanceOf(CostCurrencyConflictError);
    expect((err as CostCurrencyConflictError).saved).toMatchObject({ costCurrency: 'TRY', shippingCost: 40 });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('same currency with shipping: amount PUT, shipping untouched', async () => {
    mockFetch((c) => ({ body: c.method === 'GET' ? { costs: [cost({ shippingCost: '2' })] } : cost() }));
    await upsertCost('etsy', { barcode: 'BB-01', sku: null, productName: 'Blanket' }, 12, 'USD');
    expect(calls[1].body).toEqual({ id: 'c1', costAmount: 12, costCurrency: 'USD' });
  });

  it('SKU-only row: updates the exact SKU match, else creates one', async () => {
    mockFetch((c) => ({ body: c.method === 'GET' ? { costs: [cost({ id: 'x', barcode: null, sku: 'SKU-ONLY-2' }), cost({ id: 's1', barcode: null, sku: 'SKU-ONLY' })] } : cost({ id: 's1', sku: 'SKU-ONLY' }) }));
    await upsertCost('etsy', { barcode: null, sku: 'SKU-ONLY', productName: 'Bib' }, 3, 'USD');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT']);
    expect(calls[1].body).toEqual({ id: 's1', costAmount: 3, costCurrency: 'USD' });

    mockFetch((c) => ({ status: c.method === 'POST' ? 201 : 200, body: c.method === 'GET' ? { costs: [] } : cost({ id: 'n1', sku: 'NEW' }) }));
    await upsertCost('etsy', { barcode: null, sku: 'NEW', productName: 'New' }, 4, 'EUR');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[1].body).toMatchObject({ marketplace: 'etsy', sku: 'NEW', costAmount: 4, costCurrency: 'EUR' });
  });

  it('no barcode and no SKU → refused, nothing sent', async () => {
    mockFetch(() => ({ body: {} }));
    await expect(upsertCost('etsy', { barcode: null, sku: null, productName: 'X' }, 1, 'USD')).rejects.toBeInstanceOf(MissingProductCodeError);
    expect(calls).toHaveLength(0);
  });

  it('a failed save rejects (the cell shows the error)', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'boom' } }));
    await expect(upsertCost('etsy', { barcode: 'BB-01', sku: null, productName: 'B' }, 1, 'USD')).rejects.toMatchObject({ status: 500 });
  });
});

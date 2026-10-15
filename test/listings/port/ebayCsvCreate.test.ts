// eBay CSV import "Create new listings": each row is planned as a staged create draft (never a live write).
import { describe, expect, it, vi } from 'vitest';
import { parseCsv } from '@/lib/listings/csvImport';
import {
  buildEbayCreatePlan,
  detectEbayCreateMapping,
  localSkusFor,
  parseEbayCondition,
  setEbayCreateMapping,
  stageEbayCreateRow,
} from '@/components/domain/listings/tools/ebayCsvCreate';

const CSV = [
  'sku,title,price,quantity,condition,description',
  'LAMP-1,Brass Lamp,24.99,3,new,Soft light',
  'LAMP-2,Glass Lamp,,1,used,',
  'DUP-1,Dup,5,1,,',
  'DUP-1,Dup again,5,1,,',
  'OLD-9,Exists,5,1,,',
  ',No Sku,5,1,,',
  'BAD SKU!,Bad,5,1,,',
  'LAMP-3,,5,1,,',
  'LAMP-4,Lamp,abc,1,shiny,',
].join('\n');

describe('ebayCsvCreate', () => {
  it('detects and remaps columns', () => {
    const m = detectEbayCreateMapping(['Custom label (SKU)', 'Title', 'Fiyat', 'Qty', 'Condition', 'Description', 'Other']);
    expect(m).toEqual(['sku', 'title', 'price', 'quantity', 'condition', 'description', null]);
    expect(setEbayCreateMapping(m, 6, 'title')).toEqual(['sku', null, 'price', 'quantity', 'condition', 'description', 'title']);
  });

  it('parses conditions', () => {
    expect(parseEbayCondition('New')).toBe('NEW');
    expect(parseEbayCondition('used good')).toBe('USED_GOOD');
    expect(parseEbayCondition('3000')).toBe('USED_EXCELLENT');
    expect(parseEbayCondition('')).toBe('');
    expect(parseEbayCondition('shiny')).toBeNull();
  });

  it('plans ready / incomplete / invalid rows', () => {
    const csv = parseCsv(CSV);
    const plan = buildEbayCreatePlan({
      csv,
      mapping: detectEbayCreateMapping(csv.headers),
      existingSkus: new Set(['OLD-9']),
      defaults: { fulfillmentPolicyId: 'F', returnPolicyId: 'R', paymentPolicyId: 'P' },
    });
    const by = (line: number) => plan.rows.find((r) => r.line === line)!;
    // Row 2: complete apart from photos and category → staged, finish in the editor.
    expect(by(2).kind).toBe('incomplete');
    expect(by(2).fields).toMatchObject({ sku: 'LAMP-1', title: 'Brass Lamp', price: '24.99', quantity: 3, condition: 'NEW', description: '<p>Soft light</p>', fulfillmentPolicyId: 'F' });
    expect(by(2).missing.map((m) => m.key)).toEqual(expect.arrayContaining(['ebay.validation.photosRequired', 'ebay.validation.categoryRequired']));
    expect(by(2).missing.map((m) => m.key)).not.toContain('ebay.validation.fulfillmentPolicyRequired');
    expect(by(3).missing.map((m) => m.key)).toEqual(expect.arrayContaining(['ebay.validation.priceRequired', 'ebay.validation.descriptionRequired']));
    expect(by(2).issues).toEqual([]);
    // duplicate SKU in the file: both copies invalid
    expect(by(4).issues.map((i) => i.key)).toEqual(['csv.create.skuDuplicate']);
    expect(by(5).issues.map((i) => i.key)).toEqual(['csv.create.skuDuplicate']);
    expect(by(6).issues.map((i) => i.key)).toEqual(['csv.create.skuExists']);
    expect(by(7).issues.map((i) => i.key)).toEqual(['csv.create.skuMissing']);
    expect(by(8).issues.map((i) => i.key)).toEqual(['ebay.validation.skuInvalid']);
    expect(by(9).issues.map((i) => i.key)).toEqual(['ebay.validation.titleRequired']);
    expect(by(10).issues.map((i) => i.key)).toEqual(['ebay.validation.priceInvalid', 'csv.create.conditionInvalid']);
    expect(plan.summary).toEqual({ rows: 9, ready: 0, incomplete: 2, invalid: 7 });
  });

  it('local SKUs are unique per run', () => {
    expect(localSkusFor(3, 'KX-ABC')).toEqual(['KX-ABC-1', 'KX-ABC-2', 'KX-ABC-3']);
    expect(new Set(localSkusFor(5)).size).toBe(5);
  });

  it('stages a row as an eBay create draft with the seller SKU in the queued create (no live call)', async () => {
    const csv = parseCsv(CSV);
    const plan = buildEbayCreatePlan({ csv, mapping: detectEbayCreateMapping(csv.headers), existingSkus: new Set() });
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ url: String(url), method: String(init?.method ?? 'GET'), body });
      return new Response(JSON.stringify({ draft: { id: 'd1', sku: body.sku, status: 'draft', queuedActions: body.queuedActions ?? [] } }), { status: 200 });
    });
    try {
      await stageEbayCreateRow(plan.rows[0], 'KX-T-1');
    } finally {
      spy.mockRestore();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/ebay-drafts');
    expect(calls[0].body).toMatchObject({ sku: 'KX-T-1', queuedActions: [{ type: 'create', publish: true, sku: 'LAMP-1' }] });
    expect((calls[0].body.inventoryFields as { product: { title: string } }).product.title).toBe('Brass Lamp');
  });
});

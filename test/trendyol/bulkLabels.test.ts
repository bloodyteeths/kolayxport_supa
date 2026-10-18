import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks (API handler tests) ─────────────────────────────────────────────────────────────────────────
const findMany = vi.fn();
const findFirst = vi.fn();
const updateMany = vi.fn();
const orderUpdate = vi.fn();
const userFindUnique = vi.fn();
const authUser = vi.fn();
const client = {
  getAddresses: vi.fn(),
  getCommonLabel: vi.fn(),
  createCommonLabel: vi.fn(),
  updatePackageStatus: vi.fn(),
};
vi.mock('@/lib/prisma', () => ({
  default: {
    order: {
      findMany: (...a: any[]) => findMany(...a),
      findFirst: (...a: any[]) => findFirst(...a),
      updateMany: (...a: any[]) => updateMany(...a),
      update: (...a: any[]) => orderUpdate(...a),
    },
    user: { findUnique: (...a: any[]) => userFindUnique(...a) },
    credential: { findUnique: async () => ({ trendyolSupplierId: '1', trendyolApiKey: 'k', trendyolApiSecret: 's' }) },
    shipperProfile: { findUnique: async () => ({ shipperName: 'Belle Couture', shipperStreet1: 'Sokak 1', shipperCity: 'İstanbul' }) },
  },
}));
vi.mock('@/lib/auth', () => ({ getAuthUser: (...a: any[]) => authUser(...a) }));
vi.mock('@/lib/config', () => ({ isTrendyolEnabled: () => true }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/integrations/trendyolApiClient', () => ({ createTrendyolClient: () => client }));

import {
  BULK_LABELS_MAX,
  concatZpl,
  countsFromHeaders,
  countsToHeaders,
  isBulkLabelEligible,
  isUnshippedPackageStatus,
  packageStatusOf,
  planBulkLabels,
  type BulkLabelOrder,
} from '@/lib/trendyol/bulkLabels';
import bulkHandler from '@/pages/api/trendyol/cargo-bulk';
import singleHandler from '@/pages/api/trendyol/cargo';
import { bulkLabelsSummary } from '@/components/domain/orders/TrendyolBulkLabels';
import { toOrderRows } from '@/lib/orders/toOrderRows';
import { trendyolCargo, NOW } from '../orders/g1-fixtures';

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────
let seq = 0;
function order(over: Partial<BulkLabelOrder> & { raw?: Record<string, any> } = {}): BulkLabelOrder & { orderNumber: string } {
  const n = ++seq;
  const { raw, ...rest } = over;
  return {
    id: `o${n}`,
    orderNumber: `TY${n}`,
    marketplace: 'Trendyol',
    externalStatus: 'Created',
    cargoLabelPrintedAt: null,
    rawData: {
      status: 'Created',
      cargoTrackingNumber: `72800${n}`,
      cargoProviderName: 'Trendyol Express Marketplace',
      whoPays: 1,
      shipmentPackageId: 900 + n,
      lines: [{ lineId: 100 + n, quantity: 1, productName: 'Ahşap Kutu' }],
      shipmentAddress: { fullName: 'Ayşe Yılmaz', address1: 'Cadde 5', district: 'Kadıköy', city: 'İstanbul' },
      ...raw,
    },
    ...rest,
  };
}

describe('bulk label eligibility (pure)', () => {
  it('unshipped = Created / Picking / Invoiced only', () => {
    for (const s of ['Created', 'Picking', 'Invoiced', 'created']) expect(isUnshippedPackageStatus(s)).toBe(true);
    for (const s of ['Shipped', 'Delivered', 'Cancelled', 'UnDelivered', 'Returned', 'UnSupplied', 'UnPacked', 'AWAITING_FULFILLMENT', '', null]) {
      expect(isUnshippedPackageStatus(s as any)).toBe(false);
    }
  });

  it('package status = externalStatus, falling back to rawData.status (not shipmentPackageStatus first)', () => {
    expect(packageStatusOf({ externalStatus: 'Picking', rawData: { status: 'Created' } })).toBe('Picking');
    expect(packageStatusOf({ externalStatus: null, rawData: { status: 'Invoiced', shipmentPackageStatus: 'ReadyToShip' } })).toBe('Invoiced');
    expect(packageStatusOf({ externalStatus: '', rawData: null })).toBeNull();
  });

  it('Trendyol ∧ not printed ∧ unshipped', () => {
    expect(isBulkLabelEligible(order())).toBe(true);
    expect(isBulkLabelEligible(order({ marketplace: 'trendyol' }))).toBe(true);
    expect(isBulkLabelEligible(order({ marketplace: 'Hepsiburada' }))).toBe(false);
    expect(isBulkLabelEligible(order({ cargoLabelPrintedAt: new Date() }))).toBe(false);
    expect(isBulkLabelEligible(order({ externalStatus: 'Shipped' }))).toBe(false);
    expect(isBulkLabelEligible(order({ externalStatus: 'Cancelled' }))).toBe(false);
    expect(isBulkLabelEligible(order({ externalStatus: null, raw: { status: 'Delivered' } }))).toBe(false);
    expect(isBulkLabelEligible(order({ externalStatus: null, raw: { status: 'Picking' } }))).toBe(true);
  });

  it('plan: counts orders without a cargo number, caps at max, reports the remainder', () => {
    const rows = [order(), order({ raw: { cargoTrackingNumber: null } }), order(), order({ externalStatus: 'Shipped' }), order()];
    const plan = planBulkLabels(rows, 'pdf', 2);
    expect(plan.include.map((p) => p.order.id)).toEqual([rows[0].id, rows[2].id]);
    expect(plan).toMatchObject({ eligible: 3, skippedNoCargoNumber: 1, skippedNotCommonLabel: 0, remaining: 1 });
  });

  it('plan zpl: carriers without a common label are skipped and never take a slot', () => {
    const rows = [order({ raw: { cargoProviderName: 'Yurtiçi Kargo' } }), order({ raw: { whoPays: 2 } }), order(), order({ raw: { cargoProviderName: 'Aras Kargo' } })];
    const plan = planBulkLabels(rows, 'zpl', 1);
    expect(plan.include.map((p) => p.order.id)).toEqual([rows[2].id]);
    expect(plan).toMatchObject({ eligible: 4, skippedNotCommonLabel: 2, remaining: 1 });
    // PDF prints every carrier.
    expect(planBulkLabels(rows, 'pdf').include).toHaveLength(4);
  });

  it('ZPL concatenation keeps every document, drops empties, ends with a newline', () => {
    expect(concatZpl(['^XA^FO1^XZ\n', '', '  ^XA^FO2^XZ'])).toBe('^XA^FO1^XZ\n^XA^FO2^XZ\n');
  });

  it('counts round-trip through the response headers', () => {
    const c = { printed: 18, skippedNoCargoNumber: 2, skippedNotCommonLabel: 0, skippedFailed: 1, commonLabelNotAllowed: true, remaining: 40 };
    const h = countsToHeaders(c);
    expect(countsFromHeaders((k) => h[k] ?? null)).toEqual(c);
  });

  it('toast summary text', () => {
    const t = (k: string, v?: Record<string, any>) => `${k}:${v?.count}`;
    expect(bulkLabelsSummary(t, { printed: 18, skippedNoCargoNumber: 2, skippedNotCommonLabel: 0, skippedFailed: 0, commonLabelNotAllowed: false, remaining: 40 })).toBe(
      'done:18; skippedNoCargo:2. remaining:40',
    );
  });
});

// ── API ───────────────────────────────────────────────────────────────────────────────────────────────
function call(handler: any, req: { method: string; query?: Record<string, string>; body?: any }) {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.send = (b: any) => { res.body = b; return res; };
  return Promise.resolve(handler({ headers: {}, query: {}, ...req } as any, res)).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockResolvedValue({ id: 'u1' });
  updateMany.mockImplementation(async (a: any) => ({ count: a.where.id.in.length }));
  userFindUnique.mockResolvedValue({ shippingSettings: { trendyolAutoPicking: false } });
  client.getAddresses.mockRejectedValue(new Error('offline'));
  client.getCommonLabel.mockImplementation(async (cargo: string) => ({ data: [{ label: `^XA^FD${cargo}^XZ` }] }));
});

describe('GET /api/trendyol/cargo-bulk (count)', () => {
  it('counts eligible orders with a cargo number and those without, for this user only', async () => {
    findMany.mockResolvedValue([order(), order(), order({ raw: { cargoTrackingNumber: '' } }), order({ externalStatus: 'Shipped' })]);
    const res = await call(bulkHandler, { method: 'GET' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ eligible: 2, skippedNoCargoNumber: 1 });
    const where = findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    expect(where.cargoLabelPrintedAt).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('401 without a session', async () => {
    authUser.mockResolvedValue(null);
    expect((await call(bulkHandler, { method: 'GET' })).statusCode).toBe(401);
  });
});

describe('POST /api/trendyol/cargo-bulk', () => {
  it('pdf: one multi-page PDF, marks exactly the included orders (scoped to the user), counts in headers', async () => {
    const rows = [order(), order({ raw: { cargoTrackingNumber: null } }), order()];
    findMany.mockResolvedValue(rows);
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'pdf' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    const pdf = Buffer.from(res.body).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect((pdf.match(/\/Type \/Page\b/g) || []).length).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: { in: [rows[0].id, rows[2].id] }, userId: 'u1', cargoLabelPrintedAt: null });
    expect(updateMany.mock.calls[0][0].data.cargoLabelPrintedAt).toBeInstanceOf(Date);
    expect(res.headers['X-Labels-Printed']).toBe('2');
    expect(res.headers['X-Labels-Skipped-No-Cargo-Number']).toBe('1');
    expect(res.headers['X-Labels-Remaining']).toBe('0');
    expect(client.updatePackageStatus).not.toHaveBeenCalled(); // auto Picking off
  });

  it('enforces the 100 cap and reports the remainder', async () => {
    const rows = Array.from({ length: BULK_LABELS_MAX + 40 }, () => order());
    findMany.mockResolvedValue(rows);
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'pdf' } });
    expect(res.statusCode).toBe(200);
    expect(updateMany.mock.calls[0][0].where.id.in).toEqual(rows.slice(0, BULK_LABELS_MAX).map((r) => r.id));
    expect(res.headers['X-Labels-Printed']).toBe(String(BULK_LABELS_MAX));
    expect(res.headers['X-Labels-Remaining']).toBe('40');
  });

  it('zpl: concatenates common labels, skips non-common carriers and failures, marks only the printed ones', async () => {
    const rows = [order(), order({ raw: { cargoProviderName: 'Yurtiçi Kargo' } }), order(), order()];
    findMany.mockResolvedValue(rows);
    const failing = (rows[2].rawData as any).cargoTrackingNumber;
    client.getCommonLabel.mockImplementation(async (cargo: string) => {
      if (cargo === failing) throw Object.assign(new Error('boom'), { status: 500 });
      return { data: [{ label: `^XA^FD${cargo}^XZ` }] };
    });
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'zpl' } });
    expect(res.statusCode).toBe(200);
    const text = Buffer.from(res.body).toString('utf8');
    expect(text).toBe(`^XA^FD${(rows[0].rawData as any).cargoTrackingNumber}^XZ\n^XA^FD${(rows[3].rawData as any).cargoTrackingNumber}^XZ\n`);
    expect(updateMany.mock.calls[0][0].where.id.in).toEqual([rows[0].id, rows[3].id]);
    expect(res.headers['X-Labels-Printed']).toBe('2');
    expect(res.headers['X-Labels-Skipped-Not-Common-Label']).toBe('1');
    expect(res.headers['X-Labels-Skipped-Failed']).toBe('1');
  });

  it('zpl: store not enabled for the common label → 409, nothing marked', async () => {
    findMany.mockResolvedValue([order(), order()]);
    client.getCommonLabel.mockRejectedValue({ status: 400, body: { error: { errors: [{ type: 'COMMON_LABEL_NOT_ALLOWED', title: 'yetki yok' }] } } });
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'zpl' } });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('common_label_not_allowed');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('nothing eligible → 409 nothing_to_print, nothing marked', async () => {
    findMany.mockResolvedValue([order({ cargoLabelPrintedAt: new Date() }), order({ externalStatus: 'Delivered' })]);
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'pdf' } });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('nothing_to_print');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('auto Picking (opted in) reports Picking per Created order, like the single label', async () => {
    userFindUnique.mockResolvedValue({ shippingSettings: { trendyolAutoPicking: true } });
    const rows = [order(), order({ externalStatus: 'Invoiced', raw: { status: 'Invoiced' } })];
    findMany.mockResolvedValue(rows);
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'pdf' } });
    expect(res.statusCode).toBe(200);
    expect(client.updatePackageStatus).toHaveBeenCalledTimes(1);
    expect(client.updatePackageStatus.mock.calls[0][2]).toBe('Picking');
    expect(orderUpdate.mock.calls[0][0].where).toEqual({ id: rows[0].id });
  });

  it("deliver 'link': JSON counts + a download URL for the same orders; the GET rebuild marks nothing", async () => {
    const rows = [order(), order()];
    findMany.mockResolvedValue(rows);
    const res = await call(bulkHandler, { method: 'POST', body: { format: 'pdf', deliver: 'link' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.counts.printed).toBe(2);
    const url = new URL(res.body.downloadUrl, 'http://x');
    expect(url.searchParams.get('ids')).toBe(`${rows[0].id},${rows[1].id}`);
    updateMany.mockClear();
    findMany.mockResolvedValue([rows[1], rows[0]]);
    const file = await call(bulkHandler, { method: 'GET', query: Object.fromEntries(url.searchParams) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['Content-Type']).toBe('application/pdf');
    expect(findMany.mock.calls.at(-1)![0].where.userId).toBe('u1');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('single label GET /api/trendyol/cargo?action=label', () => {
  it('sets cargoLabelPrintedAt when still empty (own order only)', async () => {
    const o = order();
    findFirst.mockResolvedValue(o);
    const res = await call(singleHandler, { method: 'GET', query: { action: 'label', orderId: o.id, format: 'pdf' } });
    expect(res.statusCode).toBe(200);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: { in: [o.id] }, userId: 'u1', cargoLabelPrintedAt: null });
  });

  it('zpl too; a failing mark never fails the label', async () => {
    const o = order();
    findFirst.mockResolvedValue(o);
    updateMany.mockRejectedValueOnce(new Error('db down'));
    const res = await call(singleHandler, { method: 'GET', query: { action: 'label', orderId: o.id, format: 'zpl' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('^XA');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('order rows expose the printed time', () => {
  it('row.trendyol.labelPrintedAt comes from Order.cargoLabelPrintedAt', () => {
    expect(toOrderRows([trendyolCargo], { now: NOW })[0].trendyol?.labelPrintedAt).toBeNull();
    const [row] = toOrderRows([{ ...trendyolCargo, cargoLabelPrintedAt: '2026-10-18T09:30:00.000Z' }], { now: NOW });
    expect(row.trendyol?.labelPrintedAt).toBe('2026-10-18T09:30:00.000Z');
  });
});

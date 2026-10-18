// Hepsiburada finance (lib/hepsiburada/finance.ts): record mapping, sign convention, windows, classification,
// and the range sync's upserts / cursor / auth handling against a mocked client + Prisma.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tx: new Map<string, any>(),
  cursor: null as any,
  load: vi.fn(),
  blocked: vi.fn(async () => false),
  authOk: vi.fn(async () => undefined),
  authFail: vi.fn(async () => ({})),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    financialTransaction: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const k = where.userId_marketplace_externalId.externalId;
        h.tx.set(k, h.tx.has(k) ? { ...h.tx.get(k), ...update } : create);
        return h.tx.get(k);
      }),
    },
    financialSyncCursor: {
      upsert: vi.fn(async ({ create, update }: any) => {
        h.cursor = h.cursor ? { ...h.cursor, ...update } : create;
        return h.cursor;
      }),
      findUnique: vi.fn(async () => h.cursor),
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/hepsiburada/server', () => ({ loadHepsiburadaClient: h.load }));
vi.mock('@/lib/integrations/authFailures', () => ({
  isAuthFailure: (e: any) => e?.status === 401 || e?.status === 403,
  isConnectionBlocked: h.blocked,
  recordAuthSuccess: h.authOk,
  recordAuthFailure: h.authFail,
}));

import {
  mapHbFinanceItem,
  financeWindows,
  syncHepsiburadaFinanceRange,
  syncHepsiburadaFinanceForUser,
  HB_FINANCE_BACKFILL_MS,
} from '@/lib/hepsiburada/finance';
import { classifyTransactionType } from '@/lib/finance/classifyTransaction';

// Shape recorded from a live /transactions response (taha-kanar/hepsiburada-sdk openapi/verification.json).
const SALE = {
  id: 'tx-1', transactionType: 'EInvoiceSales', status: 'WillBePaid', sku: 'HBV0000ABC', packageNumber: 'P1',
  orderNumber: '4000001', invoiceNumber: 'INV1', orderItemNumber: 'L1', quantity: 2,
  amount: { value: 1200, currencyCode: 'TRY' }, taxAmount: { value: 200, currencyCode: 'TRY' }, netAmount: { value: 1000, currencyCode: 'TRY' },
  orderDate: '2026-10-01T10:00:00', invoiceDate: '2026-10-02T09:00:00', dueDate: '2026-10-20T00:00:00', paymentDate: null,
  invoiceExplanation: null, merchantId: 'm', isInvoice: true, isIncome: true, transactionTypeCategory: 'Sales', productName: 'Ahşap kutu',
};
const COMMISSION = { ...SALE, id: 'tx-2', transactionType: 'Commission', amount: { value: 180, currencyCode: 'TRY' }, isIncome: false };
const COMMISSION_REFUND = { ...SALE, id: 'tx-3', transactionType: 'CommissionRefund', amount: { value: 30, currencyCode: 'TRY' }, isIncome: true };
const CARGO = { ...SALE, id: 'tx-4', transactionType: 'ShipmentCostSharingExpense', amount: { value: 45.5, currencyCode: 'TRY' }, isIncome: false };
const PAYMENT = { ...SALE, id: 'tx-5', transactionType: 'Payment', status: 'Paid', amount: { value: 900, currencyCode: 'TRY' }, isIncome: false, paymentDate: '2026-10-21T00:00:00' };
const TOTAL = { ...PAYMENT, id: 'tx-6', transactionType: 'TotalPayment' };

describe('mapHbFinanceItem', () => {
  it('maps a sale: signed by isIncome, invoiceDate as Turkey time, sku as barcode', () => {
    const row = mapHbFinanceItem(SALE as any)!;
    expect(row).toMatchObject({
      externalId: 'tx-1', transactionType: 'EInvoiceSales', orderNumber: '4000001', barcode: 'HBV0000ABC',
      productName: 'Ahşap kutu', quantity: 2, amount: 1200, currency: 'TRY', pending: true, commission: null,
    });
    expect(row.transactionDate.toISOString()).toBe('2026-10-02T06:00:00.000Z');
  });

  it('expenses are negative, refunds of expenses positive', () => {
    expect(mapHbFinanceItem(COMMISSION as any)!.amount).toBe(-180);
    expect(mapHbFinanceItem(COMMISSION_REFUND as any)!.amount).toBe(30);
    expect(mapHbFinanceItem(CARGO as any)!.amount).toBe(-45.5);
    // isIncome missing: HB's own sign is kept
    expect(mapHbFinanceItem({ ...CARGO, isIncome: undefined, amount: { value: -12 } } as any)!.amount).toBe(-12);
  });

  it('skips TotalPayment (aggregate of Payment rows) and non-numeric amounts', () => {
    expect(mapHbFinanceItem(TOTAL as any)).toBeNull();
    expect(mapHbFinanceItem({ ...SALE, amount: { value: 'x' } } as any)).toBeNull();
  });

  it('builds a stable externalId when HB sends no id', () => {
    const a = mapHbFinanceItem({ ...SALE, id: undefined } as any)!;
    const b = mapHbFinanceItem({ ...SALE, id: undefined } as any)!;
    expect(a.externalId).toBe(b.externalId);
    expect(a.externalId).toContain('EInvoiceSales_4000001_L1_INV1');
  });
});

describe('Hepsiburada transaction categories', () => {
  it.each([
    ['EInvoiceSales', 'revenue'],
    ['BnplOrder', 'revenue'],
    ['Return', 'return'],
    ['EInvoiceSalesRefund', 'return'],
    ['Commission', 'commission'],
    ['CommissionRefund', 'commission'],
    ['CommissionInvoiceRefund', 'commission_invoice'],
    ['ShipmentCostSharingExpense', 'shipping'],
    ['CargoCostRefund', 'fees'],
    ['CargoCompensationIncome', 'fees'],
    ['PaymentServiceCostReflection', 'fees'],
    ['Stoppage', 'fees'],
    ['MarketingExpense', 'adspend'],
    ['CampaignDiscount', 'discount'],
    ['CampaignDiscountRefund', 'discount'],
    ['Payment', 'disbursement'],
    ['VAT', 'passthrough'],
  ])('%s → %s', (type, cat) => {
    expect(classifyTransactionType(type)).toBe(cat);
  });

  it('leaves other marketplaces untouched', () => {
    expect(classifyTransactionType('Sale')).toBe('revenue');
    expect(classifyTransactionType('Satış')).toBe('revenue');
    expect(classifyTransactionType('EtsyFee')).toBe('commission');
    expect(classifyTransactionType('Disbursement')).toBe('disbursement');
    expect(classifyTransactionType('ShippingLabel')).toBe('shipping');
  });
});

describe('financeWindows', () => {
  it('splits into ≤7-day windows covering the range', () => {
    const DAY = 86_400_000;
    const w = financeWindows(0, 20 * DAY);
    expect(w).toHaveLength(3);
    expect(w[0]).toEqual({ start: new Date(0), end: new Date(7 * DAY) });
    expect(w[2].end).toEqual(new Date(20 * DAY));
  });
});

describe('syncHepsiburadaFinanceRange', () => {
  const listTransactions = vi.fn();
  beforeEach(() => {
    h.tx.clear();
    h.cursor = null;
    listTransactions.mockReset();
    h.authFail.mockClear();
    h.load.mockResolvedValue({ ok: true, merchantId: 'm', client: { listTransactions } });
  });

  it('pages each window, upserts rows, records cursor + pending payout', async () => {
    const DAY = 86_400_000;
    listTransactions.mockImplementation(async ({ offset }: any) =>
      offset === 0 ? { count: 6, items: [SALE, COMMISSION, COMMISSION_REFUND, CARGO, PAYMENT, TOTAL] } : { count: 6, items: [] },
    );
    const out = await syncHepsiburadaFinanceRange('u1', 0, 7 * DAY);
    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(listTransactions.mock.calls[0][0]).toMatchObject({ offset: 0, recordStart: new Date(0), recordEnd: new Date(7 * DAY) });
    expect(out.upserted).toBe(5); // TotalPayment skipped
    expect(h.tx.get('tx-5')).toMatchObject({ marketplace: 'hepsiburada', transactionType: 'Payment', amount: -900 });
    // pending = WillBePaid non-payout rows: 1200 - 180 + 30 - 45.5
    expect(out.pendingPayout).toBe(1004.5);
    expect(h.cursor).toMatchObject({ marketplace: 'hepsiburada', lastSyncedTo: new Date(7 * DAY), currentBalance: 1004.5, balanceCurrency: 'TRY' });
  });

  it('not connected → {status: 400} (the "normal" state for finance handlers)', async () => {
    h.load.mockResolvedValue({ ok: false, reason: 'not_connected' });
    await expect(syncHepsiburadaFinanceRange('u1', 0, 1000)).rejects.toMatchObject({ status: 400 });
  });

  it('auth failure is recorded and surfaces as 401', async () => {
    listTransactions.mockRejectedValue({ status: 401, body: {}, endpoint: 'finance', message: 'x' });
    await expect(syncHepsiburadaFinanceRange('u1', 0, 1000)).rejects.toMatchObject({ status: 401 });
    expect(h.authFail).toHaveBeenCalledWith('u1', 'hepsiburada', 'm', expect.anything());
  });

  it('daily job: first run backfills 90 days, later runs resume from the cursor minus overlap; disabled = skipped', async () => {
    listTransactions.mockResolvedValue({ count: 0, items: [] });
    const now = 200 * 86_400_000;
    await syncHepsiburadaFinanceForUser('u1', now);
    expect(listTransactions.mock.calls[0][0].recordStart).toEqual(new Date(now - HB_FINANCE_BACKFILL_MS));
    listTransactions.mockClear();
    h.cursor = { lastSyncedTo: new Date(now) };
    await syncHepsiburadaFinanceForUser('u1', now + 86_400_000);
    expect(listTransactions.mock.calls[0][0].recordStart).toEqual(new Date(now - 3 * 86_400_000));
    h.load.mockResolvedValue({ ok: false, reason: 'disabled' });
    await expect(syncHepsiburadaFinanceForUser('u1', now)).resolves.toMatchObject({ skipped: expect.any(String) });
  });
});

import { describe, expect, it } from 'vitest';
import { isEtsyReceiptCancelledOrRefunded, mapEtsyReceiptFinance } from '@/lib/etsy/receiptFinance';

const money = (amount: number) => ({ amount, divisor: 100, currency_code: 'USD' });

describe('mapEtsyReceiptFinance', () => {
  it('maps a completed receipt to a Sale net of sales tax', () => {
    const m = mapEtsyReceiptFinance({ status: 'Completed', grandtotal: money(5_500), total_tax_cost: money(500) });
    expect(m).toEqual({ transactionType: 'Sale', amount: 50, currency: 'USD', status: 'completed', cancelledOrRefunded: false });
  });

  it.each(['canceled', 'Cancelled', 'Fully Refunded', 'refunded', 'returned'])(
    '%s stays a gross Sale (the ledger refund_gross nets it; no double count)',
    (status) => {
      const m = mapEtsyReceiptFinance({ status, grandtotal: money(2_000), total_tax_cost: money(0) });
      expect(m.transactionType).toBe('Sale');
      expect(m.amount).toBe(20);
      expect(m.cancelledOrRefunded).toBe(true);
    },
  );

  it('partially refunded is a Sale and not flagged as cancelled', () => {
    const m = mapEtsyReceiptFinance({ status: 'Partially Refunded', grandtotal: money(3_000) });
    expect(m.transactionType).toBe('Sale');
    expect(m.amount).toBe(30);
    expect(m.cancelledOrRefunded).toBe(false);
  });

  it('is_refunded flags the receipt', () => {
    expect(isEtsyReceiptCancelledOrRefunded({ status: 'paid', is_refunded: true })).toBe(true);
  });

  it('tolerates missing money objects', () => {
    const m = mapEtsyReceiptFinance({ status: 'paid' });
    expect(m.amount).toBe(0);
    expect(m.currency).toBe('USD');
  });
});

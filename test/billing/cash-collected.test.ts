import { describe, expect, it } from 'vitest';
import { formatMoney, netCollected } from '@/lib/billing/cashCollected';

describe('netCollected', () => {
  it('sums succeeded charges minus refunds, per currency; ignores failed', () => {
    expect(netCollected([
      { paid: true, status: 'succeeded', amount: 990000, amount_refunded: 0, currency: 'try' },
      { paid: true, status: 'succeeded', amount: 1799400, amount_refunded: 1799400, currency: 'try' },
      { paid: true, status: 'succeeded', amount: 5000, amount_refunded: 1000, currency: 'usd' },
      { paid: false, status: 'failed', amount: 990000, amount_refunded: 0, currency: 'try' },
    ])).toEqual({ try: 990000, usd: 4000 });
  });
  it('formats; zero is "0"', () => {
    expect(formatMoney({ try: 990000 })).toBe('9.900 TRY');
    expect(formatMoney({})).toBe('0');
  });
});

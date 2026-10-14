/**
 * Etsy receipt -> FinancialTransaction mapping (owner W1). Pure.
 *
 * How the financial dashboard aggregates Etsy (pages/api/finance/dashboard.ts):
 *   - receipt rows (this mapping)          -> 'Sale'   -> revenue  (+amount)
 *   - ledger 'refund_gross' / 'refund' ... -> 'Refund' -> returns  (+|amount|)
 *   - a 'Return' row would ALSO count in returns.
 *
 * Etsy's ledger is the authoritative record of money refunded to buyers: every
 * cancellation / full refund / partial refund posts a negative refund_gross
 * entry (prod check 2026-10-15: 148 'Refund' ledger rows vs 71 canceled +
 * 6 fully-refunded + 23 partially-refunded receipts; ledger rows carry no
 * receipt link). Therefore:
 *
 *   - A cancelled / fully refunded receipt stays a 'Sale' at its gross amount;
 *     the ledger refund nets it to zero. Mapping it to 'Return' (negative or
 *     zero) would subtract the refund twice (Return + ledger Refund) or drop
 *     the revenue the ledger refund offsets — either way a double count.
 *   - The old branch "status refunded|returned -> Return with -amount" was dead
 *     (Etsy v3 never returns those statuses; 0 Return rows exist) and would
 *     have double counted; it is removed. A partially refunded receipt is a
 *     'Sale' too.
 *
 * Amount = grandtotal minus total_tax_cost (marketplace-facilitator sales tax
 * is never the seller's money).
 */

export type EtsyMoney = { amount: number; divisor: number; currency_code?: string } | null | undefined;

export function etsyMoneyValue(m: EtsyMoney): number {
  if (!m || typeof m.amount !== 'number') return 0;
  return m.amount / (m.divisor || 100);
}

export const ETSY_CANCELLED_STATUSES = new Set(['canceled', 'cancelled', 'fully refunded', 'refunded', 'returned']);

export function etsyReceiptStatus(receipt: any): string {
  return String(receipt?.status || '').trim().toLowerCase();
}

/** Cancelled or fully refunded (the ledger carries the refund). */
export function isEtsyReceiptCancelledOrRefunded(receipt: any): boolean {
  return ETSY_CANCELLED_STATUSES.has(etsyReceiptStatus(receipt)) || receipt?.is_refunded === true;
}

export function mapEtsyReceiptFinance(receipt: any): {
  transactionType: 'Sale';
  amount: number;
  currency: string;
  status: string;
  cancelledOrRefunded: boolean;
} {
  const taxCost = etsyMoneyValue(receipt?.total_tax_cost);
  const gross = etsyMoneyValue(receipt?.grandtotal);
  const amount = Math.round((gross - taxCost) * 100) / 100;
  return {
    transactionType: 'Sale',
    amount,
    currency: receipt?.grandtotal?.currency_code || 'USD',
    status: etsyReceiptStatus(receipt),
    cancelledOrRefunded: isEtsyReceiptCancelledOrRefunded(receipt),
  };
}

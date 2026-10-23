// lib/tools/trendyolProfit.ts — Trendyol per-order profit (public calculator, /araclar/trendyol-komisyon-ve-kar-hesaplama).
// Rules checked on real KolayXport settlement data (Trendyol finance API, Oct 2026):
//   commission       = sale price (KDV included) × category rate; the commission invoice includes 20% KDV
//                      (790 TL × 18.2% = 143.78 TL, matches to the kuruş)
//   platform fee     = 10.99 TL + 20% KDV = 13.19 TL per package (seen as the per-package unit on fee invoices)
//   e-commerce stopaj = 1% of the KDV-excluded sale (an advance on income tax, offset later: "mahsup edilebilir")
//   cargo            = the seller's contracted desi price, KDV included (input)
// KDV: output KDV on the sale minus input KDV on product cost, commission, cargo and platform fee.
export const TRENDYOL_RULES_CHECKED_ON = '2026-10-23';
export const TRENDYOL_TR = { platformFeeTry: 13.19, feeVatRate: 0.2, stopajRate: 0.01 } as const;

export interface TrendyolInput {
  /** What the buyer pays, KDV included. */
  salePriceTry: number;
  /** Category commission, percent (e.g. 18.5). */
  commissionPct: number;
  /** Product KDV rate, percent (20, 10 or 1). */
  vatPct: number;
  /** Product purchase/production cost, KDV included. */
  productCostTry: number;
  /** Cargo per package, KDV included. */
  cargoTry: number;
  /** Platform service fee per package, KDV included (default 13.19). */
  platformFeeTry?: number;
}

export interface TrendyolResult {
  commission: number;
  platformFee: number;
  cargo: number;
  stopaj: number;
  /** What Trendyol pays out for this order. */
  payout: number;
  outputVat: number;
  inputVat: number;
  netVat: number;
  /** Payout − product cost − net KDV (stopaj counted as a cost; it is offset against income tax later). */
  profit: number;
  marginPct: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pos = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
const pct = (n: unknown, max = 100) => Math.min(max, pos(n)) / 100;

export function trendyolProfit(i: TrendyolInput): TrendyolResult {
  const price = pos(i.salePriceTry);
  const vat = pct(i.vatPct, 50);
  const commission = price * pct(i.commissionPct);
  const platformFee = i.platformFeeTry === undefined ? TRENDYOL_TR.platformFeeTry : pos(i.platformFeeTry);
  const cargo = pos(i.cargoTry);
  const cost = pos(i.productCostTry);
  const exVat = price / (1 + vat);
  const stopaj = exVat * TRENDYOL_TR.stopajRate;
  const payout = price - commission - platformFee - cargo - stopaj;
  const feeVat = (x: number) => x - x / (1 + TRENDYOL_TR.feeVatRate);
  const outputVat = price - exVat;
  const inputVat = cost - cost / (1 + vat) + feeVat(commission) + feeVat(cargo) + feeVat(platformFee);
  const netVat = outputVat - inputVat;
  const profit = payout - cost - netVat;
  return {
    commission: r2(commission), platformFee: r2(platformFee), cargo: r2(cargo), stopaj: r2(stopaj), payout: r2(payout),
    outputVat: r2(outputVat), inputVat: r2(inputVat), netVat: r2(netVat), profit: r2(profit),
    marginPct: price > 0 ? Math.round((profit / price) * 1000) / 10 : 0,
  };
}

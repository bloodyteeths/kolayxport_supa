// lib/tools/etsyFees.ts — Etsy seller fees for a shop whose bank account is in Türkiye (public calculator,
// /araclar/etsy-komisyon-hesaplama). Rates checked on Etsy Help on 2026-10-23:
//   transaction fee      6.5% of the order total (item + shipping + gift wrap)          [Fees & Taxes]
//   payment processing   6.5% of the total sale price incl. shipping and sales tax + 14 TRY per order [Payment Processing Fees, Türkiye]
//   regulatory operating 1.67% of item + shipping + gift wrap                          [Regulatory Operating Fee, Türkiye]
//   listing fee          0.20 USD per listing (renewed on each sale)
//   offsite ads          15% (12% for shops over 10k USD/yr) of the order total, max 100 USD — only for ad-driven sales
//   VAT on seller fees   Etsy charges Turkish VAT (KDV, 20%) on these fees unless the seller gave Etsy a VAT ID
// Everything is in USD except the 14 TRY processing fee, converted with the rate passed in.
export const ETSY_FEES_CHECKED_ON = '2026-10-23';
export const ETSY_TR = {
  transactionRate: 0.065,
  processingRate: 0.065,
  processingFixedTry: 14,
  regulatoryRate: 0.0167,
  listingUsd: 0.2,
  vatRate: 0.2,
  offsiteAdsCapUsd: 100,
} as const;

export interface EtsyFeeInput {
  itemUsd: number;
  shippingUsd: number;
  /** US sales tax etc. that Etsy collects from the buyer (processing fee is charged on it too). */
  buyerTaxUsd?: number;
  usdTry: number;
  /** null = no offsite ad; 0.15 or 0.12 when the sale came from an Etsy offsite ad. */
  offsiteAdsRate?: 0.15 | 0.12 | null;
  /** The seller entered a VAT ID at Etsy, so no KDV on fees. */
  hasVatId?: boolean;
  /** Seller's own costs in TRY (product + their shipping label). */
  productCostTry?: number;
  shippingCostTry?: number;
}

export interface EtsyFeeResult {
  revenueUsd: number;
  fees: { listing: number; transaction: number; processing: number; regulatory: number; offsiteAds: number; vat: number };
  totalFeesUsd: number;
  netUsd: number;
  netTry: number;
  profitTry: number | null;
  marginPct: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pos = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

export function etsyFees(input: EtsyFeeInput): EtsyFeeResult {
  const item = pos(input.itemUsd);
  const ship = pos(input.shippingUsd);
  const tax = pos(input.buyerTaxUsd);
  const usdTry = pos(input.usdTry) || 1;
  const orderTotal = item + ship;
  const listing = ETSY_TR.listingUsd;
  const transaction = orderTotal * ETSY_TR.transactionRate;
  const processing = (orderTotal + tax) * ETSY_TR.processingRate + ETSY_TR.processingFixedTry / usdTry;
  const regulatory = orderTotal * ETSY_TR.regulatoryRate;
  const offsiteAds = input.offsiteAdsRate ? Math.min(orderTotal * input.offsiteAdsRate, ETSY_TR.offsiteAdsCapUsd) : 0;
  const beforeVat = listing + transaction + processing + regulatory + offsiteAds;
  const vat = input.hasVatId ? 0 : beforeVat * ETSY_TR.vatRate;
  const totalFeesUsd = beforeVat + vat;
  const netUsd = orderTotal - totalFeesUsd;
  const netTry = netUsd * usdTry;
  const costs = pos(input.productCostTry) + pos(input.shippingCostTry);
  const hasCosts = input.productCostTry !== undefined || input.shippingCostTry !== undefined;
  const profitTry = hasCosts ? netTry - costs : null;
  const revenueTry = orderTotal * usdTry;
  return {
    revenueUsd: r2(orderTotal),
    fees: { listing: r2(listing), transaction: r2(transaction), processing: r2(processing), regulatory: r2(regulatory), offsiteAds: r2(offsiteAds), vat: r2(vat) },
    totalFeesUsd: r2(totalFeesUsd),
    netUsd: r2(netUsd),
    netTry: r2(netTry),
    profitTry: profitTry === null ? null : r2(profitTry),
    marginPct: profitTry === null || revenueTry <= 0 ? null : Math.round((profitTry / revenueTry) * 1000) / 10,
  };
}

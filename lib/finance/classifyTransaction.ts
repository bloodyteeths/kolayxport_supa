/**
 * Ledger row → financial category (finance-analytics §6.2). Moved verbatim out of
 * `pages/api/finance/dashboard.ts` (M9 group B) so the dashboard, the settlements
 * `category` field/filter and the Transactions UI share one rule.
 *
 * Pure, client- and server-safe. The rules are order-sensitive: more specific
 * patterns come first. Raw types are Trendyol (Turkish), Etsy ledger, eBay and
 * Amazon spellings, all stored as-is in `FinancialTransaction.transactionType`.
 */

export const TRANSACTION_CATEGORIES = [
  'revenue',
  'commission',
  'shipping',
  'return',
  'discount',
  'adspend',
  'fees',
  'commission_invoice',
  'disbursement',
  'passthrough',
  'other',
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export function isTransactionCategory(v: unknown): v is TransactionCategory {
  return typeof v === 'string' && (TRANSACTION_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Hepsiburada accounting record types (`/transactions` `transactionType`, PascalCase English) whose category the
 * generic substring rules below get wrong. Exact match, checked first. Hepsiburada amounts are stored signed by
 * `isIncome` (income +, expense −), so the sign-aware buckets (commission, fees, discount) handle refunds.
 * Cargo refunds / compensation are credits, so they go to `fees` (sign-aware) rather than `shipping` (which
 * counts |amount| as a cost). `Return` / `Commission` / `Stoppage` already classify correctly and are not listed.
 */
export const HEPSIBURADA_TYPE_CATEGORY: Readonly<Record<string, TransactionCategory>> = {
  // Sales
  EInvoiceSales: 'revenue',
  EInvoiceSalesRefund: 'return',
  BnplOrder: 'revenue',
  RevenueIncome: 'revenue',
  RevenueExpense: 'return',
  BnplRefund: 'return',
  PriceDifferenceRefund: 'fees',
  PriceDifferenceExpense: 'fees',
  // Commission
  CommissionRefund: 'commission',
  CommissionCorrection: 'commission',
  OverseasCommissionRefund: 'commission',
  CommissionInvoiceRefund: 'commission_invoice',
  // Payment processing / platform fees (sign-aware)
  PaymentServiceCostReflection: 'fees',
  PaymentServiceCostReflectionRefund: 'fees',
  ProcessingFeeExpense: 'fees',
  ProcessingFeeExpenseRefund: 'fees',
  BnplProcessingFee: 'fees',
  BnplProcessingFeeRefund: 'fees',
  DeliveryProcessingFee: 'fees',
  DeliveryProcessingFeeRefund: 'fees',
  ReturnDeliveryProcessingFee: 'fees',
  ReturnProcessingFeeExpense: 'fees',
  InternationalOperationFee: 'fees',
  InternationalOperationFeeRefund: 'fees',
  HepsiGlobalTransferExpense: 'fees',
  HepsiGlobalTransferIncome: 'fees',
  LineItemTransferExpense: 'fees',
  LineItemTransferIncome: 'fees',
  LateInterestExpense: 'fees',
  SfsInterest: 'fees',
  StudioExpense: 'fees',
  FaturaLab: 'fees',
  FigoPara: 'fees',
  RefusedInvoiceExpense: 'fees',
  RefusedInvoiceExpenseRefund: 'fees',
  InvoiceReversalExpense: 'fees',
  InvoiceReversalIncome: 'fees',
  ProductsReportedByService: 'fees',
  MpOutletProductExpense: 'fees',
  MpScrapExpense: 'fees',
  MpScrapIncome: 'fees',
  MpCompensationIncome: 'fees',
  RoadAssistanceExpense: 'fees',
  RoadAssistanceExpenseRefund: 'fees',
  TransportExpense: 'fees',
  TransportExpenseRefund: 'fees',
  CustomerSatisfaction: 'fees',
  CustomerSatisfactionRefund: 'fees',
  InboundCustomerSatisfaction: 'fees',
  InboundCustomerSatisfactionRefund: 'fees',
  OutboundCustomerSatisfaction: 'fees',
  OutboundCustomerSatisfactionRefund: 'fees',
  BalanceCorrection: 'fees',
  Chargeout: 'fees',
  GoldLaborStoppage: 'fees',
  GoldLaborStoppageRefund: 'fees',
  StoppageRefund: 'fees',
  // Shipping costs (expense) vs cargo credits (sign-aware fees)
  ShipmentCostSharingExpense: 'shipping',
  DropShipmentCostSharingExpense: 'shipping',
  ReturnShipmentCostSharingExpense: 'shipping',
  OneClickReturnShipmentCostSharingExpense: 'shipping',
  CargoMargin: 'shipping',
  ShipmentCostSharingIncome: 'fees',
  DropShipmentCostSharingIncome: 'fees',
  CargoCostRefund: 'fees',
  CargoCompensationIncome: 'fees',
  CargoCompensationIncomeRefund: 'fees',
  CargoCompensationExpenseRefund: 'fees',
  CargoCompensationSellerSatisfactionIncome: 'fees',
  CargoLimitExcessCompensationIncome: 'fees',
  // Marketing / ads
  MarketingExpense: 'adspend',
  MarketingExpenseRefund: 'adspend',
  AdSharingExpense: 'adspend',
  AdSharingExpenseRefund: 'adspend',
  FacebookAdExpense: 'adspend',
  SponsorshipFee: 'adspend',
  AdBalanceTopUpFromAllowance: 'adspend',
  AdBalanceTopUpFromAllowanceRefund: 'adspend',
  MarketingSupportParticipation: 'discount',
  MarketingSupportParticipationRefund: 'discount',
  CampaignDiscount: 'discount',
  CampaignDiscountRefund: 'discount',
  HepsiGlobalCampaignDiscount: 'discount',
  // Bank payouts / pass-through
  Payment: 'disbursement',
  TotalPayment: 'disbursement',
  Deposit: 'disbursement',
  VAT: 'passthrough',
};

/**
 * Classify a raw marketplace transaction type into a financial category.
 */
export function classifyTransactionType(type: string): TransactionCategory {
  // Normalize: strip diacritics so Turkish İ→i, ş→s, etc. work with plain includes()
  const t = (type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Also check original for exact Turkish matches
  const orig = (type || '').trim();

  const hb = Object.prototype.hasOwnProperty.call(HEPSIBURADA_TYPE_CATEGORY, orig) ? HEPSIBURADA_TYPE_CATEGORY[orig] : undefined;
  if (hb) return hb;

  // Order matters — more specific patterns first

  // Trendyol otherfinancials deduction invoices & withholdings (Turkish labels
  // from the Cari Hesap Ekstresi). Must precede the generic komisyon/kargo
  // rules below.
  // Weekly commission invoice — commissions are already counted per-sale;
  // counting the invoice too would double them.
  if (t.includes('komisyon') && t.includes('fatura')) return 'commission_invoice';
  if (t.includes('stopaj') || t.includes('stoppage')) return 'fees'; // E-ticaret Stopajı
  if (t.includes('reklam')) return 'adspend'; // Reklam Bedeli
  if (t.includes('hizmet')) return 'fees'; // Platform / Uluslararası Hizmet Bedeli
  // Kusurlu Ürün / Yanlış Ürün / Tedarik Edememe / Erken Ödeme Kesinti / Fatura Kontör
  if (t.includes('kusurlu') || t.includes('yanl') || t.includes('tedarik') || t.includes('kesinti') || t.includes('kontor')) return 'fees';

  // Etsy real ledger types (from settlements Phase 4). EtsyFee amounts are
  // SIGNED (charge<0, refund>0) — the 'commission' switch case handles the
  // sign. Disbursements are bank transfers (excluded from P&L). SellerCredit
  // is a positive revenue adjustment handled by the default case.
  if (t === 'etsyfee') return 'commission';
  if (t === 'disbursement' || t.includes('disburse')) return 'disbursement';
  if (t === 'salestax') return 'passthrough'; // remitted tax — excluded from P&L entirely
  if (t === 'sellercredit') return 'other';

  if (t.includes('sale') || orig === 'Satış' || t.includes('satis')) return 'revenue';
  if (t.includes('shipping') || t.includes('cargo') || t.includes('kargo')) return 'shipping';
  if (t.includes('commission') || t.includes('komisyon') || t.includes('service')) return 'commission';
  // Discount cancel (İndirim İptal / DiscountCancel) reverses an earlier
  // discount (it follows a return). It's a discount-bucket credit, NOT a sale —
  // as 'revenue' it counted as an extra order and picked up full COGS/shipping.
  if (orig === 'İndirim İptal' || t.includes('discountcancel') || (t.includes('indirim') && t.includes('iptal'))) return 'discount';
  // Returns (İade / Return / Refund)
  if (orig.startsWith('İade') || t.includes('return') || t.includes('iade') || t.includes('refund')) return 'return';
  // Discounts/coupons (İndirim / Kupon)
  if (orig.startsWith('İndirim') || t.includes('discount') || t.includes('indirim') || t.includes('coupon') || t.includes('kupon')) return 'discount';
  // Provision (weight/deci adjustments) — treat as shipping adjustment
  if (t.includes('provision')) return 'shipping';
  if (t.includes('adspend') || t.includes('promoted') || t.includes('offsite ads') || t.includes('etsy ads')) return 'adspend';
  // eBay-specific types
  if (t.includes('shippinglabel')) return 'shipping';
  if (t.includes('credit')) return 'revenue'; // eBay credits = revenue adjustment
  // eBay store subscription / insertion / regulatory / dispute fees
  // (NON_SALE_CHARGE OTHER_FEES). These are real selling costs — count them as
  // commission so they reduce net profit (they were silently ignored before).
  if (t.includes('storefee')) return 'commission';
  if (t.includes('sellerrevenue') || t.includes('manualrefund')) return 'other';
  // Amazon-specific types
  if (t.includes('productcharges') || t.includes('productcharge')) return 'revenue';
  if (t.includes('referralfee') || t.includes('amazoncommission')) return 'commission';
  // FBA storage / removal / disposal / return-processing are inventory costs,
  // not shipping — they land in the fees bucket (Platform Fees card).
  if (t.includes('fbastorage') || t.includes('fbainventoryfee')) return 'fees';
  if (t.includes('fbafee') || t.includes('fulfillmentfee') || t.includes('fbainbound')) return 'shipping';
  if (t.includes('refundcommission') || t.includes('amazonrefund')) return 'return';
  if (t.includes('sponsoredproduct') || t.includes('sponsoredbrand') || t.includes('sponsoreddisplay') || t.includes('amazonadspend')) return 'adspend';
  if (t.includes('amazoncoupon') || t.includes('amazondiscount')) return 'discount';
  // Amazon misc events (service fees w/o a reason, adjustments, chargebacks).
  // Sign-aware via the 'fees' bucket: negative = real cost, positive = credit —
  // so they affect net profit correctly instead of being silently dropped.
  if (t.includes('amazonother')) return 'fees';
  return 'other';
}

/** The raw types in `types` whose category is `category` (for the settlements `category` filter). */
export function rawTypesForCategory(types: Iterable<string>, category: TransactionCategory): string[] {
  const out: string[] = [];
  for (const t of types) if (classifyTransactionType(t) === category) out.push(t);
  return out;
}

/* eslint-disable */
/**
 * Muhasebe Entegrasyonu — generated from openapi/finance.json. Do not edit.
 *
 * Source: muhasebe-entegrasyonu v1.0, refreshed with `npm run specs:fetch`.
 * Corrections belong in openapi/overlays/, not here.
 */

/**
 * Kayıt Bazlı Muhasebe Servisi
 *
 * `GET /transactions/merchantid/{merchantId}`
 */
export interface GetTransactionsQuery {
  Offset: number;
  Limit: number;
  OrderNumber?: string;
  PackageNumber?: string;
  ReferenceDocument?: string;
  /**
   * Transaction type filter. Leave it empty for all types. Or provide one or more types as a comma-separated string.  **Allowed values:** `AdBalanceTopUpFromAllowanceRefund`, `OutboundCustomerSatisfaction`, `GoldLaborStoppage`, `Return`, `AdSharingExpenseRefund`, `CommissionRefund`, `SfsInterest`, `InboundCustomerSatisfaction`, `LateInterestExpense`, `ProductsReportedByService`, `PaymentServiceCostReflection`, `VAT`, `CommissionCorrection`, `MarketingExpense`, `ProcessingFeeExpenseRefund`, `MpCompensationIncome`, `CargoLimitExcessCompensationIncome`, `MarketingExpenseRefund`, `StudioExpense`, `ShipmentCostSharingExpense`, `RefusedInvoiceExpense`, `RevenueExpense`, `ProcessingFeeExpense`, `OverseasCommissionRefund`, `Chargeout`, `InternationalOperationFee`, `HepsiGlobalTransferExpense`, `OutboundCustomerSatisfactionRefund`, `BnplProcessingFeeRefund`, `CargoCompensationSellerSatisfactionIncome`, `ReturnProcessingFeeExpense`, `MarketingSupportParticipationRefund`, `BnplOrder`, `DropShipmentCostSharingExpense`, `MpScrapIncome`, `ReturnDeliveryProcessingFee`, `Commission`, `Deposit`, `Stoppage`, `LineItemTransferExpense`, `SponsorshipFee`, `CustomerSatisfaction`, `CargoCompensationIncomeRefund`, `GoldLaborStoppageRefund`, `MarketingSupportParticipation`, `EInvoiceSalesRefund`, `TransportExpense`, `AdSharingExpense`, `FacebookAdExpense`, `CampaignDiscount`, `EInvoiceSales`, `PaymentServiceCostReflectionRefund`, `ShipmentCostSharingIncome`, `RoadAssistanceExpenseRefund`, `DropShipmentCostSharingIncome`, `AdBalanceTopUpFromAllowance`, `OneClickReturnShipmentCostSharingExpense`, `RoadAssistanceExpense`, `RevenueIncome`, `BnplProcessingFee`, `LineItemTransferIncome`, `InvoiceReversalIncome`, `CommissionInvoiceRefund`, `StoppageRefund`, `FigoPara`, `CargoCompensationExpenseRefund`, `BalanceCorrection`, `BnplRefund`, `ReturnShipmentCostSharingExpense`, `HepsiGlobalCampaignDiscount`, `FaturaLab`, `Payment`, `CargoCostRefund`, `InternationalOperationFeeRefund`, `DeliveryProcessingFee`, `CustomerSatisfactionRefund`, `HepsiGlobalTransferIncome`, `InvoiceReversalExpense`, `MpScrapExpense`, `TransportExpenseRefund`, `CampaignDiscountRefund`, `CargoMargin`, `RefusedInvoiceExpenseRefund`, `TotalPayment`, `DeliveryProcessingFeeRefund`, `PriceDifferenceRefund`, `CargoCompensationIncome`, `PriceDifferenceExpense`, `MpOutletProductExpense`, `InboundCustomerSatisfactionRefund`
   */
  TransactionTypes?: string;
  /**
   * Status filter. Leave it empty for all statuses. Or provide one or more types as a comma-separated string.  **Allowed values:** `Paid`, `WillBePaid`
   */
  Status?: string;
  Sku?: string;
  /** Prioritize OrderDate over other date filters, for better response times */
  OrderDateStart?: string;
  /** Prioritize OrderDate over other date filters, for better response times */
  OrderDateEnd?: string;
  DueDateStart?: string;
  DueDateEnd?: string;
  RecordDateStart?: string;
  RecordDateEnd?: string;
  PaymentDateStart?: string;
  PaymentDateEnd?: string;
}

export interface GetTransactionsParams {
  merchantId: string;
}

export type GetTransactionsResponse = {
  count?: number;
  items?: {
  id?: string;
  transactionType?: string;
  status?: string;
  sku?: string;
  packageNumber?: string;
  orderNumber?: string;
  invoiceNumber?: string;
  orderItemNumber?: string;
  quantity?: number;
  amount?: {
  value?: number;
  currencyCode?: string;
};
  taxAmount?: {
  value?: number;
  currencyCode?: string;
};
  netAmount?: {
  value?: number;
  currencyCode?: string;
};
  orderDate?: string;
  invoiceDate?: string;
  dueDate?: string;
  paymentDate?: string;
  invoiceExplanation?: string;
  merchantId?: string;
  isInvoice?: boolean;
  isIncome?: boolean;
  transactionTypeCategory?: string;
  productName?: string;
}[];
};

/**
 * Performans Servisi
 *
 * `GET /orders/merchantid/{merchantId}`
 */
export interface GetOrdersQuery {
  Limit: number;
  Offset: number;
  DueDateStart?: string;
  DueDateEnd?: string;
  OrderDateStart?: string;
  OrderDateEnd?: string;
  OrderNumber?: string;
  Sku?: string;
}

export interface GetOrdersParams {
  merchantId: string;
}

export type GetOrdersResponse = {
  totalCount?: number;
  items?: {
  orderNumber?: string;
  merchantId?: string;
  orderDate?: string;
  sku?: string;
  productName?: string;
  invoiceDate?: string;
  dueDate?: string;
  allowanceAmount?: {
  value?: number;
  currencyCode?: string;
};
  quantity?: number;
  unitAmount?: {
  value?: number;
  currencyCode?: string;
};
  income?: {
  totalAmount?: {
  value?: number;
  currencyCode?: string;
};
  items?: {
  transactionType?: string;
  amount?: {
  value?: number;
  currencyCode?: string;
};
}[];
};
  expense?: {
  totalAmount?: {
  value?: number;
  currencyCode?: string;
};
  items?: {
  transactionType?: string;
  amount?: {
  value?: number;
  currencyCode?: string;
};
}[];
};
}[];
};

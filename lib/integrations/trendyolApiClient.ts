/**
 * Multi-tenant Trendyol Seller API client.
 * Uses per-user credentials from the Credential table (not env vars).
 * Rate-limited to respect Trendyol's 50 req/10s limit.
 */

import { logger } from '../logger';

const TRENDYOL_API_BASE = 'https://apigw.trendyol.com/integration';

export interface TrendyolCredentials {
  supplierId: string;
  apiKey: string;
  apiSecret: string;
}

interface PaginatedResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

// Simple rate limiter: track last request time, enforce min gap
let lastRequestTime = 0;
const MIN_GAP_MS = 220; // ~4.5 req/s = well under 50/10s limit

async function rateLimitedDelay() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export class TrendyolApiClient {
  private auth: string;
  private supplierId: string;

  constructor(creds: TrendyolCredentials) {
    this.supplierId = creds.supplierId;
    this.auth = 'Basic ' + Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64');
  }

  private async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: any
  ): Promise<T> {
    await rateLimitedDelay();

    const url = `${TRENDYOL_API_BASE}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': this.auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': `${this.supplierId} - SelfIntegration`,
      },
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    logger.info(`TrendyolApiClient ${method} ${endpoint}`);

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorBody: any;
      try { errorBody = JSON.parse(errorText); } catch { errorBody = { rawError: errorText }; }
      logger.error('TrendyolApiClient error', new Error(`${response.status}`), { endpoint, status: response.status });
      throw { status: response.status, body: errorBody, endpoint };
    }

    const text = await response.text();
    if (!text) return { success: true } as T;
    try { return JSON.parse(text); } catch { return { rawResponse: text } as T; }
  }

  private qs(params: Record<string, string | number | boolean | undefined>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    );
    if (entries.length === 0) return '';
    return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  }

  // ================================================================
  // PRODUCTS
  // ================================================================

  async getProducts(params: {
    page?: number;
    size?: number;
    barcode?: string;
    stockCode?: string;
    approved?: boolean;
    onSale?: boolean;
    rejected?: boolean;
    blacklisted?: boolean;
    brandId?: number;
  } = {}): Promise<PaginatedResponse<any>> {
    const qs = this.qs({
      page: params.page ?? 0,
      size: params.size ?? 50,
      barcode: params.barcode,
      stockCode: params.stockCode,
      approved: params.approved,
      onSale: params.onSale,
      rejected: params.rejected,
      blacklisted: params.blacklisted,
      brandId: params.brandId,
    });
    return this.request('GET', `/product/sellers/${this.supplierId}/products${qs}`);
  }

  async getAllProducts(onProgress?: (page: number, total: number) => void): Promise<any[]> {
    const allProducts: any[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const data = await this.getProducts({ page, size: 200 });
      allProducts.push(...(data.content || []));
      totalPages = data.totalPages || 1;
      page++;
      if (onProgress) onProgress(page, totalPages);
    }

    return allProducts;
  }

  async createProducts(items: any[]): Promise<any> {
    return this.request('POST', `/product/sellers/${this.supplierId}/products`, { items });
  }

  async updateProducts(items: any[]): Promise<any> {
    return this.request('PUT', `/product/sellers/${this.supplierId}/products`, { items });
  }

  async updatePriceAndInventory(items: any[]): Promise<any> {
    return this.request('PUT', `/inventory/sellers/${this.supplierId}/products/price-and-inventory`, { items });
  }

  async archiveProducts(items: Array<{ barcode: string }>): Promise<any> {
    return this.request('PUT', `/product/sellers/${this.supplierId}/products/archive`, { items });
  }

  async getBatchStatus(batchRequestId: string): Promise<any> {
    return this.request('GET', `/product/sellers/${this.supplierId}/products/batch-requests/${batchRequestId}`);
  }

  // ================================================================
  // CATEGORIES & BRANDS
  // ================================================================

  async getCategories(): Promise<any> {
    return this.request('GET', '/product/product-categories');
  }

  async getCategoryAttributes(categoryId: number): Promise<any> {
    return this.request('GET', `/product/product-categories/${categoryId}/attributes`);
  }

  async searchBrands(name: string, page = 0, size = 20): Promise<any> {
    const qs = this.qs({ name, page, size });
    return this.request('GET', `/product/brands${qs}`);
  }

  // ================================================================
  // ORDERS
  // ================================================================

  async getOrders(params: {
    status?: string;
    startDate?: number;
    endDate?: number;
    page?: number;
    size?: number;
    orderNumber?: string;
  } = {}): Promise<PaginatedResponse<any>> {
    const qs = this.qs({
      page: params.page ?? 0,
      size: params.size ?? 50,
      status: params.status,
      startDate: params.startDate,
      endDate: params.endDate,
      orderNumber: params.orderNumber,
    });
    return this.request('GET', `/order/sellers/${this.supplierId}/orders${qs}`);
  }

  // ================================================================
  // SHIPMENT
  // ================================================================

  async updateTracking(shipmentPackageId: string, body: any): Promise<any> {
    return this.request('PUT', `/order/sellers/${this.supplierId}/shipment-packages/${shipmentPackageId}`, body);
  }

  async getShippingLabel(trackingNumber: string): Promise<any> {
    return this.request('GET', `/order/sellers/${this.supplierId}/common-label/query?id=${encodeURIComponent(trackingNumber)}`);
  }

  // ================================================================
  // INVOICE
  // ================================================================

  async sendInvoice(body: any): Promise<any> {
    return this.request('POST', `/order/sellers/${this.supplierId}/invoice-links`, body);
  }

  async deleteInvoice(invoiceLinkId: string): Promise<any> {
    return this.request('DELETE', `/order/sellers/${this.supplierId}/invoice-links/${invoiceLinkId}`);
  }

  // ================================================================
  // CLAIMS / RETURNS
  // ================================================================

  async getClaims(params: {
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    size?: number;
  } = {}): Promise<PaginatedResponse<any>> {
    const qs = this.qs({
      page: params.page ?? 0,
      size: params.size ?? 50,
      ...params,
    });
    return this.request('GET', `/order/sellers/${this.supplierId}/claims${qs}`);
  }

  async approveClaim(claimId: string, body?: any): Promise<any> {
    return this.request('PUT', `/order/sellers/${this.supplierId}/claims/${claimId}/approve`, body);
  }

  // ================================================================
  // Q&A
  // ================================================================

  async getQuestions(params: {
    status?: string;
    page?: number;
    size?: number;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<PaginatedResponse<any>> {
    const qs = this.qs({
      page: params.page ?? 0,
      size: params.size ?? 50,
      ...params,
    });
    return this.request('GET', `/qna/sellers/${this.supplierId}/questions/filter${qs}`);
  }

  async answerQuestion(questionId: string, text: string): Promise<any> {
    return this.request('POST', `/qna/sellers/${this.supplierId}/questions/${questionId}/answers`, { text });
  }

  // ================================================================
  // FINANCE / SETTLEMENTS
  // ================================================================

  async getSettlements(params: {
    startDate?: number;
    endDate?: number;
    page?: number;
    size?: number;
    transactionType?: string;
  } = {}): Promise<any> {
    const qs = this.qs({
      page: params.page ?? 0,
      size: params.size ?? 50,
      ...params,
    });
    return this.request('GET', `/finance/sellers/${this.supplierId}/settlements${qs}`);
  }

  // ================================================================
  // SUPPLIER INFO
  // ================================================================

  async getAddresses(): Promise<any> {
    return this.request('GET', `/sellers/${this.supplierId}/addresses`);
  }

  async getCargoCompanies(): Promise<any> {
    return this.request('GET', '/shipment/cargo-companies');
  }
}

/**
 * Create a TrendyolApiClient from user credentials in the Credential table.
 */
export function createTrendyolClient(credential: {
  trendyolSupplierId?: string | null;
  trendyolApiKey?: string | null;
  trendyolApiSecret?: string | null;
}): TrendyolApiClient {
  if (!credential.trendyolSupplierId || !credential.trendyolApiKey || !credential.trendyolApiSecret) {
    throw new Error('Trendyol credentials not configured. Please add your API Key, API Secret, and Supplier ID in Settings.');
  }

  return new TrendyolApiClient({
    supplierId: credential.trendyolSupplierId,
    apiKey: credential.trendyolApiKey,
    apiSecret: credential.trendyolApiSecret,
  });
}

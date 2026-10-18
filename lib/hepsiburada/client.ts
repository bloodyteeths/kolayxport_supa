/**
 * Multi-tenant Hepsiburada Marketplace API client.
 *
 * Auth (every service): `Authorization: Basic base64(merchantId:servisAnahtarı)` + `User-Agent: <integrator name>`.
 * The User-Agent is a credential: it must be exactly the integrator username HB registered for KolayXport
 * (`HEPSIBURADA_INTEGRATOR_NAME`); decorated variants ("<id> - SelfIntegration", "name/1.0") answer 401.
 * The merchant creates the servis anahtarı per integrator in HB panel → Entegratör bilgileri.
 * The Q&A service also wants the merchant id in a `merchantId` header.
 *
 * Errors are thrown as `{ status, body, endpoint, message }` so `isAuthFailure` (lib/integrations/authFailures.ts)
 * and the API routes can read the status. 429/5xx are retried with backoff.
 *
 * Endpoint shapes come from HB's published OpenAPI documents (types in ./generated, see its README).
 */
import { logger } from '@/lib/logger';
import { decryptIfNeeded } from '@/lib/crypto/credentials';
import { hbDate } from './date';
import type * as order from './generated/order';
import type * as listing from './generated/listing';
import type * as finance from './generated/finance';
import type * as question from './generated/question';
import type * as claim from './generated/claim-list';
import type * as catalog from './generated/catalog';

export type HbService =
  | 'order' | 'listing' | 'catalog' | 'productUpdate' | 'question' | 'finance' | 'shipping' | 'testOrder' | 'testClaim';

const PROD_HOSTS: Record<HbService, string | null> = {
  order: 'https://oms-external.hepsiburada.com',
  listing: 'https://listing-external.hepsiburada.com',
  catalog: 'https://mpop.hepsiburada.com/product',
  productUpdate: 'https://mpop.hepsiburada.com/ticket-api',
  question: 'https://api-asktoseller-merchant.hepsiburada.com',
  finance: 'https://mpfinance-external.hepsiburada.com',
  shipping: 'https://shipping-external.hepsiburada.com',
  testOrder: null,
  testClaim: null,
};

const SIT_HOSTS: Record<HbService, string> = {
  order: 'https://oms-external-sit.hepsiburada.com',
  listing: 'https://listing-external-sit.hepsiburada.com',
  catalog: 'https://mpop-sit.hepsiburada.com/product',
  productUpdate: 'https://mpop-sit.hepsiburada.com/ticket-api',
  question: 'https://api-asktoseller-merchant-sit.hepsiburada.com',
  finance: 'https://mpfinance-external-sit.hepsiburada.com',
  shipping: 'https://shipping-external-sit.hepsiburada.com',
  testOrder: 'https://oms-stub-external-sit.hepsiburada.com',
  testClaim: 'https://claim-stub-external-sit.hepsiburada.com',
};

export type HbEnvironment = 'prod' | 'sit';

export function hbEnvironment(): HbEnvironment {
  return process.env.HEPSIBURADA_ENV === 'sit' ? 'sit' : 'prod';
}

export function hbIntegratorName(): string {
  return (process.env.HEPSIBURADA_INTEGRATOR_NAME || '').trim();
}

export function hbHost(service: HbService, env: HbEnvironment = hbEnvironment()): string {
  const host = env === 'sit' ? SIT_HOSTS[service] : PROD_HOSTS[service];
  if (!host) throw new Error(`Hepsiburada ${service} exists only on SIT`);
  return host;
}

export interface HepsiburadaCredentials {
  merchantId: string;
  /** Servis anahtarı the merchant generated for our integrator. */
  serviceKey: string;
  /** Overrides HEPSIBURADA_INTEGRATOR_NAME (tests). */
  integratorName?: string;
  env?: HbEnvironment;
}

export interface HbError {
  status: number;
  body: any;
  endpoint: string;
  message: string;
}

export function isHbError(err: unknown): err is HbError {
  return !!err && typeof err === 'object' && typeof (err as any).status === 'number' && 'endpoint' in (err as any);
}

/** Short human message out of HB's varied error bodies. */
export function hbErrorMessage(err: unknown): string {
  if (isHbError(err)) {
    const b = err.body;
    const detail =
      (typeof b === 'string' && b) ||
      b?.message || b?.Message || b?.error_description || b?.title || b?.detail ||
      (Array.isArray(b?.errors) && b.errors.map((e: any) => e?.message || e?.Message || e).join('; ')) ||
      b?.rawError || '';
    return `Hepsiburada API ${err.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`;
  }
  return (err as any)?.message || String(err);
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestSpec {
  service: HbService;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Query;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Return the raw Response (binary label PDFs). */
  raw?: boolean;
}

const RETRIES = 3;
const MIN_GAP_MS = 120;
let lastRequestAt = 0;

async function pace() {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  lastRequestAt = Math.max(Date.now(), lastRequestAt + MIN_GAP_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function qs(params: Query = {}): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

const enc = encodeURIComponent;

export class HepsiburadaClient {
  readonly merchantId: string;
  readonly env: HbEnvironment;
  private readonly auth: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: HepsiburadaCredentials, fetchImpl: typeof fetch = fetch) {
    if (!creds.merchantId || !creds.serviceKey) throw new Error('Hepsiburada credentials missing');
    this.merchantId = creds.merchantId.trim();
    this.env = creds.env ?? hbEnvironment();
    this.userAgent = (creds.integratorName ?? hbIntegratorName()).trim();
    if (!this.userAgent) throw new Error('HEPSIBURADA_INTEGRATOR_NAME is not configured');
    this.auth = 'Basic ' + Buffer.from(`${this.merchantId}:${creds.serviceKey.trim()}`).toString('base64');
    this.fetchImpl = fetchImpl;
  }

  /** Exposed for tests. */
  headersFor(spec: Pick<RequestSpec, 'service' | 'headers' | 'form'>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: this.auth,
      'User-Agent': this.userAgent,
      Accept: 'application/json',
      ...(spec.form ? {} : { 'Content-Type': 'application/json' }),
      ...(spec.service === 'question' ? { merchantId: this.merchantId } : {}),
      ...(spec.headers || {}),
    };
    return h;
  }

  async request<T = any>(spec: RequestSpec): Promise<T> {
    const endpoint = `${spec.path}${qs(spec.query)}`;
    const url = `${hbHost(spec.service, this.env)}${endpoint}`;
    const init: RequestInit = {
      method: spec.method,
      headers: this.headersFor(spec),
      body: spec.form ?? (spec.body !== undefined ? JSON.stringify(spec.body) : undefined),
    };

    for (let attempt = 0; ; attempt++) {
      await pace();
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err: any) {
        if (attempt < RETRIES) { await backoff(attempt); continue; }
        throw { status: 0, body: { rawError: err?.message || String(err) }, endpoint, message: `Hepsiburada network error: ${err?.message || err}` } as HbError;
      }
      if (res.ok) {
        if (spec.raw) return res as unknown as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < RETRIES) {
        const reset = Number(res.headers.get('retry-after') || res.headers.get('x-ratelimit-reset'));
        await backoff(attempt, Number.isFinite(reset) && reset > 0 && reset < 60 ? reset * 1000 : undefined);
        continue;
      }
      const text = await res.text().catch(() => '');
      let body: any;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { rawError: text.slice(0, 1000) }; }
      const error: HbError = { status: res.status, body, endpoint: `${spec.service} ${spec.method} ${spec.path}`, message: '' };
      error.message = hbErrorMessage(error);
      logger.warn('HepsiburadaClient error', { endpoint: error.endpoint, status: res.status });
      throw error;
    }
  }

  private get mid() { return enc(this.merchantId); }

  // ================================================================ ORDERS (OMS)

  /** Open (paid, not yet packed) order lines. `limit` is required by HB, max 100. */
  listOrders(p: { begin?: Date; end?: Date; offset?: number; limit?: number } = {}) {
    return this.request<order.GetOrdersResponse>({
      service: 'order', method: 'GET', path: `/orders/merchantid/${this.mid}`,
      query: {
        begindate: p.begin ? hbDate(p.begin) : undefined,
        enddate: p.end ? hbDate(p.end) : undefined,
        offset: p.offset ?? 0,
        limit: Math.min(p.limit ?? 100, 100),
      },
    });
  }

  /** Cancelled lines. HB rejects the date filter on this endpoint, so it pages only. */
  listCancelledOrders(p: { offset?: number; limit?: number } = {}) {
    return this.request<order.GetOrdersCancelledResponse>({
      service: 'order', method: 'GET', path: `/orders/merchantid/${this.mid}/cancelled`,
      query: { offset: p.offset ?? 0, limit: Math.min(p.limit ?? 100, 100) },
    });
  }

  getOrder(orderNumber: string) {
    return this.request<order.GetOrdersByOrdernumberResponse>({
      service: 'order', method: 'GET', path: `/orders/merchantid/${this.mid}/ordernumber/${enc(orderNumber)}`,
    });
  }

  /** Packages ready to ship. Capital `Offset`; limit max 10. `timespan` = hours back. */
  listPackages(p: { offset?: number; limit?: number; timespan?: number } = {}) {
    return this.request<order.GetPackagesResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}`,
      query: { Offset: p.offset ?? 0, limit: Math.min(p.limit ?? 10, 10), timespan: p.timespan },
    });
  }

  listShippedPackages(p: { offset?: number; limit?: number } = {}) {
    return this.request<order.GetPackagesShippedResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}/shipped`,
      query: { offset: p.offset ?? 0, limit: Math.min(p.limit ?? 100, 100) },
    });
  }

  listDeliveredPackages(p: { offset?: number; limit?: number } = {}) {
    return this.request<order.GetPackagesDeliveredResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}/delivered`,
      query: { offset: p.offset ?? 0, limit: Math.min(p.limit ?? 100, 100) },
    });
  }

  listUndeliveredPackages(p: { offset?: number; limit?: number } = {}) {
    return this.request<order.GetPackagesUndeliveredResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}/undelivered`,
      query: { offset: p.offset ?? 0, limit: Math.min(p.limit ?? 100, 100) },
    });
  }

  getPackage(packageNumber: string) {
    return this.request<order.GetPackagesByPackagenumberResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}`,
    });
  }

  /** Lines that can go into the same package as `lineItemId`. */
  packageableWith(lineItemId: string) {
    return this.request<order.GetLineitemsPackageablewithResponse>({
      service: 'order', method: 'GET', path: `/lineitems/merchantid/${this.mid}/packageablewith/lineitemid/${enc(lineItemId)}`,
    });
  }

  createPackage(body: order.CreatePackageRequest) {
    return this.request<order.PostPackagesResponse>({
      service: 'order', method: 'POST', path: `/packages/merchantid/${this.mid}`, body,
    });
  }

  unpack(packageNumber: string) {
    return this.request<string>({
      service: 'order', method: 'POST', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/unpack`,
    });
  }

  /** HB's mutual cargo label ("ortak barkod"). `data[]` holds base64 documents. */
  getLabel(packageNumber: string, format: 'PDF' | 'ZPL' = 'PDF') {
    return this.request<order.GetPackagesLabelsResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/labels`,
      query: { format },
    });
  }

  addInvoice(packageNumber: string, body: order.AddInvoiceOfPackageRequest) {
    return this.request<string>({
      service: 'order', method: 'PUT', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/invoice`, body,
    });
  }

  /** Own-cargo shipments only: tell HB the package left. */
  markInTransit(packageNumber: string, body: order.ExternalInfoRequest) {
    return this.request<string>({
      service: 'order', method: 'POST', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/intransit`, body,
    });
  }

  markDelivered(packageNumber: string, body: order.ExternalDeliverRequest) {
    return this.request<string>({
      service: 'order', method: 'POST', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/deliver`, body,
    });
  }

  markUndelivered(packageNumber: string, body: order.ExternalUnDeliverRequest) {
    return this.request<string>({
      service: 'order', method: 'POST', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/undeliver`, body,
    });
  }

  cancelLine(lineItemId: string, reasonId: number) {
    return this.request<string>({
      service: 'order', method: 'POST', path: `/lineitems/merchantid/${this.mid}/id/${enc(lineItemId)}/cancelbymerchant`,
      body: { reasonId },
    });
  }

  changeableCargoCompanies(packageNumber: string) {
    return this.request<order.GetPackagesChangablecargocompaniesResponse>({
      service: 'order', method: 'GET', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/changablecargocompanies`,
    });
  }

  changeCargoCompany(packageNumber: string, cargoCompanyShortName: string) {
    return this.request<string>({
      service: 'order', method: 'PUT', path: `/packages/merchantid/${this.mid}/packagenumber/${enc(packageNumber)}/changecargocompany`,
      body: { CargoCompanyShortName: cargoCompanyShortName } satisfies order.ChangeLineCargoCompanyRequest,
    });
  }

  // ================================================================ CLAIMS (OMS)

  listClaims(p: { begin?: Date; end?: Date; offset?: number; limit?: number } = {}) {
    return this.request<claim.GetClaimsResponse>({
      service: 'order', method: 'GET', path: `/claims/merchantId/${this.mid}`,
      query: {
        beginDate: p.begin ? hbDate(p.begin) : undefined,
        endDate: p.end ? hbDate(p.end) : undefined,
        offset: p.offset ?? 0,
        limit: Math.min(p.limit ?? 50, 100),
      },
    });
  }

  listClaimsByStatus(status: string, p: { offset?: number; limit?: number } = {}) {
    return this.request<claim.GetClaimsByStatusResponse>({
      service: 'order', method: 'GET', path: `/claims/merchantId/${this.mid}/status/${enc(status)}`,
      query: { offset: p.offset ?? 0, limit: Math.min(p.limit ?? 50, 100) },
    });
  }

  acceptClaim(claimNumber: string, body: claim.PostClaimsAcceptBody = {} as any) {
    return this.request<string>({ service: 'order', method: 'POST', path: `/claims/number/${enc(claimNumber)}/accept`, body });
  }

  rejectClaim(claimNumber: string, body: claim.PostClaimsRejectBody) {
    return this.request<string>({ service: 'order', method: 'POST', path: `/claims/number/${enc(claimNumber)}/reject`, body });
  }

  // ================================================================ LISTINGS

  listListings(p: { offset?: number; limit?: number; hbSkuList?: string[]; merchantSkuList?: string[] } = {}) {
    return this.request<listing.GetListingsResponse>({
      service: 'listing', method: 'GET', path: `/listings/merchantid/${this.mid}`,
      query: {
        offset: p.offset ?? 0,
        limit: Math.min(p.limit ?? 100, 1000),
        hbSkuList: p.hbSkuList?.join(','),
        merchantSkuList: p.merchantSkuList?.join(','),
      },
    });
  }

  /** Async: returns `{ id }`; poll `getUpload(kind, id)`. Max ~1000 rows per call. */
  uploadInventory(rows: listing.PostListingsInventoryUploadsBody) {
    return this.request<{ id: string }>({ service: 'listing', method: 'POST', path: `/listings/merchantid/${this.mid}/inventory-uploads`, body: rows });
  }

  uploadStock(rows: listing.PostListingsStockUploadsBody) {
    return this.request<{ id: string }>({ service: 'listing', method: 'POST', path: `/listings/merchantid/${this.mid}/stock-uploads`, body: rows });
  }

  uploadPrice(rows: listing.PostListingsPriceUploadsBody) {
    return this.request<{ id: string }>({ service: 'listing', method: 'POST', path: `/listings/merchantid/${this.mid}/price-uploads`, body: rows });
  }

  getUpload(kind: HbUploadKind, id: string) {
    return this.request<HbUploadStatus>({
      service: 'listing', method: 'GET', path: `/listings/merchantid/${this.mid}/${kind}-uploads/id/${enc(id)}`,
    });
  }

  activateListing(hbSku: string) {
    return this.request<unknown>({ service: 'listing', method: 'POST', path: `/listings/merchantid/${this.mid}/sku/${enc(hbSku)}/activate` });
  }

  deactivateListing(hbSku: string) {
    return this.request<unknown>({ service: 'listing', method: 'POST', path: `/listings/merchantid/${this.mid}/sku/${enc(hbSku)}/deactivate` });
  }

  // ================================================================ CATALOG

  /** Page is 0-based. */
  listCategories(p: { page?: number; size?: number; leaf?: boolean } = {}) {
    return this.request<catalog.GetCategoriesGetAllCategoriesResponse>({
      service: 'catalog', method: 'GET', path: '/api/categories/get-all-categories',
      query: { leaf: p.leaf ?? true, status: 'ACTIVE', available: true, version: 1, page: p.page ?? 0, size: p.size ?? 2000 },
    });
  }

  categoryAttributes(categoryId: number) {
    return this.request<any>({ service: 'catalog', method: 'GET', path: `/api/categories/${categoryId}/attributes`, query: { version: 1 } });
  }

  attributeValues(categoryId: number, attributeId: string, p: { page?: number; size?: number } = {}) {
    return this.request<any>({
      service: 'catalog', method: 'GET', path: `/api/categories/${categoryId}/attribute/${enc(attributeId)}/values`,
      query: { version: 1, page: p.page ?? 0, size: p.size ?? 1000 },
    });
  }

  /** Product import (create). `items` is HB's import document; sent as a JSON file in multipart field `file`. */
  importProducts(items: unknown[]) {
    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(items)], { type: 'application/json' }), 'integrator.json');
    return this.request<any>({ service: 'catalog', method: 'POST', path: '/api/products/import', query: { version: 1 }, form });
  }

  importStatus(trackingId: string, p: { page?: number; size?: number } = {}) {
    return this.request<catalog.GetProductsStatusResponse>({
      service: 'catalog', method: 'GET', path: `/api/products/status/${enc(trackingId)}`,
      query: { version: 1, page: p.page ?? 0, size: p.size ?? 100 },
    });
  }

  /** Products already in HB's catalog: list by barcode, no matching step. */
  fastListing(rows: catalog.PostProductsFastlistingBody) {
    return this.request<any>({ service: 'catalog', method: 'POST', path: '/api/products/fastlisting', body: rows });
  }

  productsByStatus(productStatus: catalog.GetProductsProductsByMerchantAndStatusQuery['productStatus'], p: { page?: number; size?: number } = {}) {
    return this.request<catalog.GetProductsProductsByMerchantAndStatusResponse>({
      service: 'catalog', method: 'GET', path: '/api/products/products-by-merchant-and-status',
      query: { merchantId: this.merchantId, productStatus, version: 1, page: p.page ?? 0, size: p.size ?? 100 },
    });
  }

  allProducts(p: { page?: number; size?: number; barcode?: string; merchantSku?: string } = {}) {
    return this.request<any>({
      service: 'catalog', method: 'GET', path: `/api/products/all-products-of-merchant/${this.mid}`,
      query: { page: p.page ?? 0, size: p.size ?? 100, barcode: p.barcode, merchantSku: p.merchantSku },
    });
  }

  /** Content update for an existing product (ticket API). Same multipart JSON-file shape as import. */
  updateProducts(items: unknown[]) {
    const form = new FormData();
    form.append('file', new Blob([JSON.stringify(items)], { type: 'application/json' }), 'integrator-ticket-upload.json');
    return this.request<any>({ service: 'productUpdate', method: 'POST', path: '/api/integrator/import', query: { version: 1 }, form });
  }

  updateStatus(trackingId: string) {
    return this.request<any>({ service: 'productUpdate', method: 'GET', path: `/api/integrator/status/${enc(trackingId)}`, query: { version: 1 } });
  }

  productByHbSku(hbSku: string) {
    return this.request<any>({ service: 'productUpdate', method: 'GET', path: `/api/integrator/merchant/${this.mid}/hbSku/${enc(hbSku)}`, query: { version: 1 } });
  }

  // ================================================================ Q&A (Satıcıya Sor)

  /** Page is 1-based. */
  listQuestions(p: { status?: string; page?: number; size?: number; minCreatedAt?: string; maxCreatedAt?: string } = {}) {
    return this.request<question.GetIssuesResponse>({
      service: 'question', method: 'GET', path: '/api/v1.0/issues',
      query: { status: p.status, page: p.page ?? 1, size: p.size ?? 25, minCreatedAt: p.minCreatedAt, maxCreatedAt: p.maxCreatedAt },
    });
  }

  questionCounts() {
    return this.request<question.GetIssuesCountResponse>({ service: 'question', method: 'GET', path: '/api/v1.0/issues/count' });
  }

  getQuestion(number: string | number) {
    return this.request<question.GetIssuesByNumberResponse>({ service: 'question', method: 'GET', path: `/api/v1.0/issues/${enc(String(number))}` });
  }

  answerQuestion(number: string | number, answer: string) {
    const form = new FormData();
    form.append('Answer', answer);
    return this.request<string>({ service: 'question', method: 'POST', path: `/api/v1.0/issues/${enc(String(number))}/answer`, form });
  }

  // ================================================================ FINANCE

  /** Production requires one identifier or one complete date pair. Dates here are ISO-8601. */
  listTransactions(p: { offset?: number; limit?: number; recordStart?: Date; recordEnd?: Date; status?: 'Paid' | 'WillBePaid'; orderNumber?: string; transactionTypes?: string }) {
    return this.request<finance.GetTransactionsResponse>({
      service: 'finance', method: 'GET', path: `/transactions/merchantid/${this.mid}`,
      query: {
        Offset: p.offset ?? 0,
        Limit: Math.min(p.limit ?? 100, 500),
        RecordDateStart: p.recordStart?.toISOString(),
        RecordDateEnd: p.recordEnd?.toISOString(),
        Status: p.status,
        OrderNumber: p.orderNumber,
        TransactionTypes: p.transactionTypes,
      },
    });
  }

  // ================================================================ SIT-only test helpers

  createTestOrder(body: unknown) {
    return this.request<string>({ service: 'testOrder', method: 'POST', path: `/orders/merchantId/${this.mid}`, body });
  }

  createTestClaim(body: unknown) {
    return this.request<string>({ service: 'testClaim', method: 'POST', path: `/claims/merchant/${this.mid}/create`, body });
  }

  createTestQuestion(body: unknown) {
    return this.request<unknown>({ service: 'question', method: 'POST', path: '/api/v1.0/issues', body });
  }
}

export type HbUploadKind = 'inventory' | 'stock' | 'price';

export interface HbUploadStatus {
  id?: string;
  status?: string; // 'Ready' (queued) … 'Done'
  createdAt?: string;
  total?: number;
  errors?: Array<{ hepsiburadaSku?: string; merchantSku?: string; errorMessage?: string; message?: string; [k: string]: any }>;
  priceValidations?: any[];
  [k: string]: any;
}

async function backoff(attempt: number, hintMs?: number) {
  const ms = hintMs ?? Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
  await new Promise((r) => setTimeout(r, ms));
}

/** Credential row (raw from Prisma) → client, decrypting the servis anahtarı. null when not connected. */
export function createHepsiburadaClient(credential: {
  hepsiburadaMerchantId?: string | null;
  hepsiburadaApiKey?: string | null;
} | null | undefined): HepsiburadaClient | null {
  const merchantId = credential?.hepsiburadaMerchantId?.trim();
  const serviceKey = decryptIfNeeded(credential?.hepsiburadaApiKey ?? null)?.trim();
  if (!merchantId || !serviceKey || !hbIntegratorName()) return null;
  return new HepsiburadaClient({ merchantId, serviceKey });
}

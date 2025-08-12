import fetch from 'node-fetch';
import { logger } from '../logger';

export interface ParasutCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  companyId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export interface ParasutContact {
  id?: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
  tax_number?: string;
  tax_office?: string;
  country?: string;
}

export interface ParasutInvoiceItem {
  product_id?: number;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  description: string;
  unit?: string;
}

export interface ParasutInvoiceData {
  contact: ParasutContact;
  items: ParasutInvoiceItem[];
  invoice_series?: string;
  invoice_id?: string;
  issue_date?: string;
  due_date?: string;
  currency?: string;
  exchange_rate?: number;
  withholding_rate?: number;
  fatura_no?: string;
}

export interface ParasutInvoiceResponse {
  id: number;
  invoice_no: string;
  invoice_series: string;
  issue_date: string;
  due_date: string;
  remaining_amount: number;
  remaining_amount_in_trl: number;
  payment_status: string;
  created_at: string;
  updated_at: string;
  contact_id: number;
  details_count: number;
  currency: string;
  exchange_rate: number;
  withholding_rate: number;
  vat_withholding_rate: number;
  invoice_discount_type: string;
  invoice_discount: number;
  billing_address: string;
  billing_phone: string;
  billing_fax: string;
  tax_office: string;
  tax_number: string;
  country: string;
  city: string;
  district: string;
  is_abroad: boolean;
  order_no: string;
  order_date: string;
  shipment_addres: string;
  shipment_included: boolean;
  cash_sale: boolean;
  payment_type: string;
  is_digital_invoice: boolean;
  pdf_url?: string;
  ubl_url?: string;
}

/**
 * Paraşüt API client for e-Invoice generation
 * Implements OAuth 2.0 for Paraşüt v4 API
 */
export class ParasutClient {
  private credentials: ParasutCredentials;
  private baseUrl: string;
  private apiVersion: string;

  constructor(credentials: ParasutCredentials) {
    this.credentials = credentials;
    // Allow overriding base URL and API version via environment for staging/sandbox
    this.baseUrl = process.env.PARASUT_BASE_URL || 'https://api.parasut.com';
    this.apiVersion = process.env.PARASUT_API_VERSION || 'v4';
  }

  /**
   * Authenticate with Paraşüt OAuth 2.0
   */
  async authenticate(): Promise<boolean> {
    try {
      logger.info('Authenticating with Paraşüt API', {
        companyId: this.credentials.companyId,
        clientId: this.credentials.clientId
      });

      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          username: this.credentials.username,
          password: this.credentials.password,
          grant_type: 'password',
          redirect_uri: process.env.PARASUT_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob'
        })
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('Paraşüt authentication failed', undefined, {
          status: response.status,
          errorMessage: error
        });
        return false;
      }

      const tokenData = await response.json() as any;
      
      this.credentials.accessToken = tokenData.access_token;
      this.credentials.refreshToken = tokenData.refresh_token;
      this.credentials.tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

      logger.info('Paraşüt authentication successful', {
        expiresAt: this.credentials.tokenExpiresAt
      });

      return true;
    } catch (error) {
      logger.error('Paraşüt authentication error', 
        error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<boolean> {
    if (!this.credentials.refreshToken) {
      return await this.authenticate();
    }

    try {
      const response = await fetch(`${this.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          refresh_token: this.credentials.refreshToken,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) {
        logger.warn('Token refresh failed, re-authenticating');
        return await this.authenticate();
      }

      const tokenData = await response.json() as any;
      
      this.credentials.accessToken = tokenData.access_token;
      this.credentials.refreshToken = tokenData.refresh_token;
      this.credentials.tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

      return true;
    } catch (error) {
      logger.error('Token refresh error', 
        error instanceof Error ? error : new Error(String(error)));
      return await this.authenticate();
    }
  }

  /**
   * Check if access token is valid and refresh if needed
   */
  async ensureValidToken(): Promise<boolean> {
    if (!this.credentials.accessToken) {
      return await this.authenticate();
    }

    if (this.credentials.tokenExpiresAt && this.credentials.tokenExpiresAt < new Date()) {
      return await this.refreshAccessToken();
    }

    return true;
  }

  /**
   * Create Sales Invoice (item_type must be 'invoice')
   */
  async createSalesInvoice(invoiceData: ParasutInvoiceData): Promise<{
    pdfUrl?: string;
    ublUrl?: string;
    invoiceId: number;
    invoiceNo: string;
  }> {
    await this.ensureValidToken();

    try {
      logger.info('Creating Paraşüt invoice', {
        contactName: invoiceData.contact.name,
        itemCount: invoiceData.items.length,
        sampleItem: invoiceData.items[0]?.description,
        companyId: this.credentials.companyId
      });

      // First, create or get contact
      const contact = await this.createOrGetContact(invoiceData.contact);

      // Prepare invoice payload per Paraşüt API (sales invoice)
      const invoicePayload = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            description: `Invoice for ${invoiceData.contact.name}`,
            issue_date: invoiceData.issue_date || new Date().toISOString().split('T')[0],
            due_date: invoiceData.due_date,
            invoice_series: invoiceData.invoice_series || 'A',
            // Use modern TRY currency code
            currency: 'TRY',
            withholding_rate: invoiceData.withholding_rate || 0,
            fatura_no: invoiceData.fatura_no,
          },
          relationships: {
            contact: { data: { type: 'contacts', id: contact.id.toString() } },
            details: {
              data: invoiceData.items.map((item) => ({
                type: 'sales_invoice_details',
                attributes: {
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  vat_rate: item.vat_rate,
                  description: item.description,
                  ...(item.unit ? { unit: item.unit } : {})
                },
                ...(item.product_id
                  ? { relationships: { product: { data: { type: 'products', id: String(item.product_id) } } } }
                  : {})
              }))
            }
          }
        }
      };

      const response = await fetch(
        `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invoicePayload)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorJson: any = undefined;
        try { errorJson = JSON.parse(errorText); } catch {}
        logger.error('Invoice creation failed', undefined, {
          status: response.status,
          errorMessage: errorJson?.errors || errorText,
          companyId: this.credentials.companyId
        });
        throw new Error(`Invoice creation failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as any;
      const invoice = result.data;

      logger.info('Invoice created successfully', {
        invoiceId: invoice.id,
        invoiceNo: invoice.attributes.invoice_no,
        companyId: this.credentials.companyId
      });

      // For pure sales invoice we may not have e-document yet
      const pdfUrl = await this.getInvoicePdfUrl(invoice.id); // May be undefined until e-document created
      const ublUrl = await this.getInvoiceUblUrl(invoice.id);

      return {
        pdfUrl,
        ublUrl,
        invoiceId: invoice.id,
        invoiceNo: invoice.attributes.invoice_no
      };

    } catch (error) {
      logger.error('Paraşüt invoice creation failed', 
        error instanceof Error ? error : new Error(String(error)), {
          companyId: this.credentials.companyId
        });
      throw error;
    }
  }

  /** Create Sales Invoice header only (no details) */
  async createSalesInvoiceHeader(params: {
    issue_date: string;
    description?: string;
    currency?: 'TRY' | 'TRL' | 'USD' | 'EUR' | 'GBP';
    cash_sale?: boolean;
    payment_date?: string;
    payment_description?: string;
    shipment_included?: boolean;
    contactId: string;
  }): Promise<{ id: number }> {
    await this.ensureValidToken();
    const payload = {
      data: {
        type: 'sales_invoices',
        attributes: {
          item_type: 'invoice',
          issue_date: params.issue_date,
          ...(params.description ? { description: params.description } : {}),
          ...(params.currency ? { currency: params.currency } : {}),
          ...(params.cash_sale !== undefined ? { cash_sale: params.cash_sale } : {}),
          ...(params.payment_date ? { payment_date: params.payment_date } : {}),
          ...(params.payment_description ? { payment_description: params.payment_description } : {}),
          ...(params.shipment_included !== undefined ? { shipment_included: params.shipment_included } : {}),
        },
        relationships: {
          contact: { data: { type: 'contacts', id: params.contactId } }
        }
      }
    };
    logger.debug?.('parasut.createSalesInvoiceHeader.payload', payload);
    const res = await fetch(`${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) {
      logger.error('parasut.createSalesInvoiceHeader.failed', undefined, { status: res.status, body: text });
      throw new Error(`createSalesInvoiceHeader failed: ${res.status} - ${text}`);
    }
    const json = JSON.parse(text);
    const id = Number(json?.data?.id);
    logger.info('parasut.header.created', { invoiceId: id, issue_date: params.issue_date, contactId: params.contactId });
    return { id };
  }

  /** Create Sales Invoice with details using JSON:API compound create (included + temp-id) */
  async createSalesInvoiceWithDetails(args: {
    contactId: string;
    issueDate: string;
    description?: string;
    currency?: 'USD' | 'EUR' | 'GBP'; // omit for TL
    details: Array<{ name: string; description?: string; quantity: number; unit_price: number; vat_rate: number; discount_type?: 'percentage'|'amount'; discount_value?: number; productId?: string }>
  }): Promise<{ id: number; invoice_no?: string }> {
    await this.ensureValidToken();
    const asNumber = (v: any) => (typeof v === 'number' ? v : Number(v));
    const defaultProductId = process.env.PARASUT_DEFAULT_PRODUCT_ID?.trim();
    const payloadMode = (process.env.PARASUT_INVOICE_PAYLOAD_MODE || 'inline').toLowerCase(); // 'inline' | 'included' | 'attributes'

    const buildPayload = (forceProductId?: string) => {
      const included = args.details.map((d, idx) => {
        const tempId = `d${idx + 1}`;
        const item: any = {
          type: 'sales_invoice_details',
          'temp-id': tempId,
          attributes: {
            // Some tenants require only description; still include name for traceability
            name: String(d.name).slice(0, 120),
            ...(d.description ? { description: String(d.description).slice(0, 240) } : {}),
            quantity: asNumber(d.quantity) || 1,
            unit_price: asNumber(d.unit_price),
            vat_rate: asNumber(d.vat_rate),
            ...(d.discount_type ? { discount_type: d.discount_type } : {}),
            ...(d.discount_value != null ? { discount_value: asNumber(d.discount_value) } : {})
          }
        };
        const pid = forceProductId || d.productId;
        if (pid) {
          item.relationships = { product: { data: { type: 'products', id: String(pid) } } };
        }
        return item;
      });
      const detailsRel = {
        data: included.map((inc: any) => ({ type: 'sales_invoice_details', 'temp-id': inc['temp-id'], method: 'create' }))
      };
      const payload: any = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            issue_date: args.issueDate,
            ...(args.description ? { description: args.description } : {}),
            ...(args.currency ? { currency: args.currency } : {})
          },
          relationships: {
            contact: { data: { type: 'contacts', id: String(args.contactId) } },
            details: detailsRel
          }
        },
        included
      };
      return payload;
    };

    const buildAttributesPayload = (forceProductId?: string) => {
      const attrsDetails = args.details.map(d => {
        // Free-text detail; some tenants accept product_id inline, others ignore in attributes mode
        const item: any = {
          quantity: asNumber(d.quantity) || 1,
          unit_price: asNumber(d.unit_price),
          vat_rate: asNumber(d.vat_rate),
          description: String(d.description || d.name).slice(0, 240)
        };
        const pid = forceProductId || d.productId;
        if (pid) item.product_id = String(pid);
        return item;
      });
      const payload: any = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            issue_date: args.issueDate,
            ...(args.description ? { description: args.description } : {}),
            ...(args.currency ? { currency: args.currency } : {}),
            details_attributes: attrsDetails
          },
          relationships: {
            contact: { data: { type: 'contacts', id: String(args.contactId) } }
          }
        }
      };
      return payload;
    };

    const buildInlineRelPayload = (forceProductId?: string) => {
      const relDetails = args.details.map(d => {
        const item: any = {
          type: 'sales_invoice_details',
          attributes: {
            // Paraşüt tenants often require description only
            description: String(d.description || d.name).slice(0, 240),
            quantity: asNumber(d.quantity) || 1,
            unit_price: asNumber(d.unit_price),
            vat_rate: asNumber(d.vat_rate)
          }
        };
        const pid = forceProductId || d.productId;
        if (pid) {
          item.relationships = {
            product: { data: { type: 'products', id: String(pid) } }
          };
        }
        return item;
      });
      const payload: any = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            issue_date: args.issueDate,
            ...(args.description ? { description: args.description } : {}),
            ...(args.currency ? { currency: args.currency } : {})
          },
          relationships: {
            contact: { data: { type: 'contacts', id: String(args.contactId) } },
            details: { data: relDetails }
          }
        }
      };
      return payload;
    };

    const attempt = async (forceProductId?: string, withCurrency: boolean = true) => {
      const usingAttributesMode = payloadMode === 'attributes';
      const usingInlineMode = payloadMode === 'inline';
      const payload = usingInlineMode
        ? buildInlineRelPayload(forceProductId)
        : usingAttributesMode
          ? buildAttributesPayload(forceProductId)
          : buildPayload(forceProductId);
      if (!withCurrency) delete (payload.data.attributes as any).currency;
      const detailStats = {
        total: args.details.length,
        withProduct: args.details.filter(d => (forceProductId || d.productId)).length,
        mode: usingInlineMode ? 'inline' : (usingAttributesMode ? 'attributes' : 'included'),
        withCurrency
      };
      logger.debug?.('parasut.createSalesInvoiceWithDetails.payload', payload);
      logger.debug?.('parasut.createSalesInvoiceWithDetails.detailStats', detailStats);
      const res = await fetch(`${this.baseUrl}/v4/${this.credentials.companyId}/sales_invoices`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.credentials.accessToken}`,
          'Content-Type': 'application/vnd.api+json',
          'Accept': 'application/vnd.api+json'
        },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (!res.ok) {
        let parsed: any = undefined;
        try { parsed = JSON.parse(text); } catch {}
        logger.error('parasut.createSalesInvoiceWithDetails.failed', undefined, { status: res.status, body: text, parsedErrors: parsed?.errors, mode: usingInlineMode ? 'inline' : (usingAttributesMode ? 'attributes' : 'included') });
        const lacksProduct = /Ürün\/hizmet doldurulmalı/i.test(text);
        const currencyErr = /Döviz tipi/i.test(text);
        if (currencyErr && withCurrency) {
          // Retry once without currency (TL default)
          return attempt(forceProductId, false);
        }
        if (lacksProduct && defaultProductId && !forceProductId) {
          logger.warn('parasut.retry.withDefaultProduct', { defaultProductId });
          return attempt(defaultProductId, withCurrency);
        }
        // If error persists, hint payload mode switches for diagnostics
        if (lacksProduct) {
          if (!usingInlineMode) logger.warn('parasut.hint.switchInlineMode', { suggestion: 'Set PARASUT_INVOICE_PAYLOAD_MODE=inline' });
          if (!usingAttributesMode) logger.warn('parasut.hint.switchAttributesMode', { suggestion: 'Set PARASUT_INVOICE_PAYLOAD_MODE=attributes' });
        }
        throw new Error(`createSalesInvoiceWithDetails failed: ${res.status} - ${text}`);
      }
      const json = JSON.parse(text);
      const id = Number(json?.data?.id);
      const invoice_no = json?.data?.attributes?.invoice_no || json?.data?.attributes?.no;
      logger.info('parasut.invoice.created', { invoiceId: id, detailCount: args.details.length, contactId: args.contactId, withCurrency });
      return { id, invoice_no };
    };

    // Start with currency if provided (USD/EUR/GBP). For TL, args.currency should be undefined.
    return await attempt(undefined, args.currency != null);
  }

  /**
   * Find a product by code (SKU) or name
   */
  async findProduct(params: { code?: string; name?: string }): Promise<{ id: number; name: string; code?: string } | null> {
    await this.ensureValidToken();
    const base = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/products`;
    const queries: string[] = [];
    if (params.code) queries.push(`filter[code]=${encodeURIComponent(params.code)}`);
    if (params.name && !params.code) queries.push(`filter[name]=${encodeURIComponent(params.name)}`);
    const url = queries.length ? `${base}?${queries.join('&')}` : `${base}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      logger.warn('parasut.findProduct.failed', { status: res.status, body: text });
      return null;
    }
    const json = await res.json() as any;
    const first = Array.isArray(json?.data) ? json.data[0] : undefined;
    if (!first) return null;
    return { id: Number(first.id), name: first?.attributes?.name, code: first?.attributes?.code };
  }

  /**
   * Create a product (service) to be used on invoice lines
   */
  async createProduct(params: { name: string; code?: string; vat_rate?: number; unit?: string }): Promise<{ id: number }> {
    await this.ensureValidToken();
    const payload = {
      data: {
        type: 'products',
        attributes: {
          name: params.name.slice(0, 240),
          ...(params.code ? { code: params.code.slice(0, 60) } : {}),
          vat_rate: typeof params.vat_rate === 'number' ? params.vat_rate : 0,
          unit: params.unit || 'Adet'
        }
      }
    };
    logger.debug?.('parasut.createProduct.payload', payload);
    const res = await fetch(`${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/products`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) {
      logger.error('parasut.createProduct.failed', undefined, { status: res.status, body: text });
      throw new Error(`createProduct failed: ${res.status} - ${text}`);
    }
    const json = JSON.parse(text);
    const id = Number(json?.data?.id);
    logger.info('parasut.product.created', { id, code: params.code, name: params.name });
    return { id };
  }

  /**
   * Ensure a product exists; try by code, then name; create if missing.
   */
  async ensureProductId(params: { code?: string; name: string; vat_rate?: number; unit?: string }): Promise<number> {
    // Try by code first
    if (params.code) {
      const byCode = await this.findProduct({ code: params.code });
      if (byCode?.id) return byCode.id;
    }
    // Then by name
    const byName = await this.findProduct({ name: params.name });
    if (byName?.id) return byName.id;
    // Create
    const created = await this.createProduct({ name: params.name, code: params.code, vat_rate: params.vat_rate, unit: params.unit });
    return created.id;
  }

  /** Lookup e-invoice inboxes by VKN/TCKN */
  async listEInvoiceInboxesByTaxNumber(taxNumber: string): Promise<any[]> {
    await this.ensureValidToken();
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_invoice_inboxes?tax_number=${encodeURIComponent(taxNumber)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`listEInvoiceInboxes failed: ${res.status} - ${text}`);
    }
    const json = await res.json() as any;
    return Array.isArray(json?.data) ? json.data : [];
  }

  /** Create e-invoice for a sales invoice; returns job id */
  async createEInvoice(params: { salesInvoiceId: number; to: string; scenario: 'basic' | 'commercial'; note?: string }): Promise<string> {
    await this.ensureValidToken();
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_invoices`;
    const payload = {
      data: {
        type: 'e_invoices',
        attributes: { to: params.to, scenario: params.scenario, ...(params.note ? { note: params.note } : {}) },
        relationships: { invoice: { data: { type: 'sales_invoices', id: String(params.salesInvoiceId) } } }
      }
    };
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createEInvoice failed: ${res.status} - ${text}`);
    }
    const json = await res.json() as any;
    return json?.data?.attributes?.trackable_job_id || json?.data?.id || '';
  }

  /** Create e-archive for a sales invoice; returns job id */
  async createEArchive(params: { salesInvoiceId: number; note?: string; internetSale?: { url?: string; payment_type?: string; payment_platform?: string; payment_date?: string } }): Promise<string> {
    await this.ensureValidToken();
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_archives`;
    const payload = {
      data: {
        type: 'e_archives',
        attributes: {
          ...(params.note ? { note: params.note } : {}),
          ...(params.internetSale ? { internet_sale: params.internetSale } : {})
        },
        relationships: { sales_invoice: { data: { type: 'sales_invoices', id: String(params.salesInvoiceId) } } }
      }
    };
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createEArchive failed: ${res.status} - ${text}`);
    }
    const json = await res.json() as any;
    return json?.data?.attributes?.trackable_job_id || json?.data?.id || '';
  }

  /** Track a job until finished/failed and return resource info when available */
  async trackJob(jobId: string, timeoutMs: number = 60000): Promise<{ status: 'finished' | 'failed'; resourceType?: string; resourceId?: number }> {
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/trackable_jobs/${jobId}`;
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < timeoutMs) {
      attempt++;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`trackJob failed: ${res.status} - ${text}`);
      }
      const json = await res.json() as any;
      const status = json?.data?.attributes?.status;
      const relData = json?.data?.relationships?.resource?.data;
      const resourceType = relData?.type;
      const resourceId = relData?.id ? Number(relData.id) : undefined;
      if (status && status !== 'running') {
        if (status === 'failed') {
          const errMsg = json?.data?.attributes?.error || 'unknown job error';
          throw new Error(`Paraşüt job failed: ${errMsg}`);
        }
        return { status: 'finished', resourceType, resourceId };
      }
      await new Promise(r => setTimeout(r, Math.min(1000 + attempt * 250, 3000)));
    }
    throw new Error('Paraşüt job timeout');
  }

  /** Show a sales invoice, including active e-document relation */
  async showSalesInvoice(id: number): Promise<any> {
    await this.ensureValidToken();
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices/${id}?include=active_e_document`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`showSalesInvoice failed: ${res.status} - ${text}`);
    }
    return await res.json();
  }

  async showEInvoicePDF(eInvoiceId: number): Promise<string | undefined> {
    await this.ensureValidToken();
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_invoices/${eInvoiceId}/pdf`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
    if (!res.ok) return undefined;
    const json = await res.json() as any;
    return json?.data?.attributes?.url;
  }

  async showEArchivePDF(eArchiveId: number): Promise<string | undefined> {
    await this.ensureValidToken();
    const url = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_archives/${eArchiveId}/pdf`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
    if (!res.ok) return undefined;
    const json = await res.json() as any;
    return json?.data?.attributes?.url;
  }

  /** Try listing e-archives by sales invoice id using likely filter keys */
  async findEArchiveForInvoice(salesInvoiceId: number): Promise<number | undefined> {
    await this.ensureValidToken();
    const base = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_archives`;
    const tryUrls = [
      `${base}?filter[invoice_id]=${encodeURIComponent(String(salesInvoiceId))}`,
      `${base}?filter[sales_invoice_id]=${encodeURIComponent(String(salesInvoiceId))}`
    ];
    for (const url of tryUrls) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
      if (!res.ok) continue;
      const json = await res.json() as any;
      const first = Array.isArray(json?.data) ? json.data[0] : undefined;
      if (first?.id) return Number(first.id);
    }
    return undefined;
  }

  /** Try listing e-invoices by sales invoice id using likely filter keys */
  async findEInvoiceForInvoice(salesInvoiceId: number): Promise<number | undefined> {
    await this.ensureValidToken();
    const base = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/e_invoices`;
    const tryUrls = [
      `${base}?filter[invoice_id]=${encodeURIComponent(String(salesInvoiceId))}`,
      `${base}?filter[sales_invoice_id]=${encodeURIComponent(String(salesInvoiceId))}`
    ];
    for (const url of tryUrls) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.credentials.accessToken}` } });
      if (!res.ok) continue;
      const json = await res.json() as any;
      const first = Array.isArray(json?.data) ? json.data[0] : undefined;
      if (first?.id) return Number(first.id);
    }
    return undefined;
  }

  /** Public: Get Sales Invoice PDF URL (falls back if active e-doc linkage not yet present) */
  async showSalesInvoicePDF(invoiceId: number): Promise<string | undefined> {
    await this.ensureValidToken();
    const endpoint = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices/${invoiceId}/pdf`;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (response.ok) {
          const result = await response.json() as any;
          const url = result.data?.attributes?.url;
          if (url) return url;
          logger.debug('Sales invoice PDF URL not ready yet', { invoiceId, attempt });
        } else {
          const text = await response.text();
          logger.debug('Sales invoice PDF response not ok', { invoiceId, status: response.status, body: text, attempt });
        }
      } catch (error) {
        logger.warn('Failed to get Sales invoice PDF URL', { invoiceId, error: error instanceof Error ? error.message : String(error), attempt });
      }
      await new Promise(r => setTimeout(r, attempt * 600));
    }
    logger.warn('Sales invoice PDF URL unavailable after retries', { invoiceId });
    return undefined;
  }

  /**
   * Create or get existing contact
   */
  async createOrGetContact(contactData: ParasutContact): Promise<ParasutContact & { id: number }> {
    // For simplicity, always create new contact
    // In production, you might want to search for existing contacts first
    
    const contactPayload = {
      data: {
        type: 'contacts',
        attributes: {
          // Sandbox requires a valid account_type; use 'customer' or 'person' as supported values
          account_type: 'customer',
          name: contactData.name,
          email: contactData.email,
          phone: contactData.phone,
          address: contactData.address,
          city: contactData.city,
          district: contactData.district,
          tax_number: contactData.tax_number,
          tax_office: contactData.tax_office,
          country: contactData.country || 'Türkiye'
        }
      }
    };

    const response = await fetch(
      `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/contacts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contactPayload)
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Contact creation failed: ${response.status} - ${error}`);
    }

    const result = await response.json() as any;
    return { ...contactData, id: result.data.id };
  }

  /**
   * Get invoice PDF URL
   */
  private async getInvoicePdfUrl(invoiceId: number): Promise<string | undefined> {
    const endpoint = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices/${invoiceId}/pdf`;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (response.ok) {
          const result = await response.json() as any;
          const url = result.data?.attributes?.url;
          if (url) return url;
          logger.debug('PDF URL not ready yet', { invoiceId, attempt });
        } else {
          const text = await response.text();
          logger.debug('PDF URL response not ok', { invoiceId, status: response.status, body: text, attempt });
        }
      } catch (error) {
        logger.warn('Failed to get PDF URL', { invoiceId, error: error instanceof Error ? error.message : String(error), attempt });
      }
      await new Promise(r => setTimeout(r, attempt * 600));
    }
    logger.warn('PDF URL unavailable after retries', { invoiceId });
    return undefined;
  }

  /**
   * Get invoice UBL URL
   */
  private async getInvoiceUblUrl(invoiceId: number): Promise<string | undefined> {
    const endpoint = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices/${invoiceId}/ubl`;
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (response.ok) {
          const result = await response.json() as any;
          const url = result.data?.attributes?.url;
          if (url) return url;
          logger.debug('UBL URL not ready yet', { invoiceId, attempt });
        } else {
          const text = await response.text();
          logger.debug('UBL URL response not ok', { invoiceId, status: response.status, body: text, attempt });
        }
      } catch (error) {
        logger.warn('Failed to get UBL URL', { invoiceId, error: error instanceof Error ? error.message : String(error), attempt });
      }
      await new Promise(r => setTimeout(r, attempt * 600));
    }
    logger.warn('UBL URL unavailable after retries', { invoiceId });
    return undefined;
  }
}
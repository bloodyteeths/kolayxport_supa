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
   * Create invoice in Paraşüt
   */
  async createInvoice(invoiceData: ParasutInvoiceData): Promise<{
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
        companyId: this.credentials.companyId
      });

      // First, create or get contact
      const contact = await this.createOrGetContact(invoiceData.contact);

      // Prepare invoice payload using inline details_attributes per Paraşüt API
      const invoicePayload = {
        data: {
          type: 'sales_invoices',
          attributes: {
            item_type: 'invoice',
            description: `Invoice for ${invoiceData.contact.name}`,
            issue_date: invoiceData.issue_date || new Date().toISOString().split('T')[0],
            due_date: invoiceData.due_date,
            invoice_series: invoiceData.invoice_series || 'A',
            // Paraşüt expects TRL code in many endpoints; use TRL
            currency: 'TRL',
            withholding_rate: invoiceData.withholding_rate || 0,
            fatura_no: invoiceData.fatura_no,
            details_attributes: invoiceData.items.map((item) => ({
              quantity: item.quantity,
              unit_price: item.unit_price,
              vat_rate: item.vat_rate,
              description: item.description,
              unit: item.unit || 'Adet',
              ...(item.product_id ? { product_id: item.product_id } : {})
            })),
          },
          relationships: {
            contact: {
              data: {
                type: 'contacts',
                id: contact.id.toString()
              }
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
        const error = await response.text();
        logger.error('Invoice creation failed', undefined, {
          status: response.status,
          errorMessage: error,
          companyId: this.credentials.companyId
        });
        throw new Error(`Invoice creation failed: ${response.status} - ${error}`);
      }

      const result = await response.json() as any;
      const invoice = result.data;

      logger.info('Invoice created successfully', {
        invoiceId: invoice.id,
        invoiceNo: invoice.attributes.invoice_no,
        companyId: this.credentials.companyId
      });

      // Get PDF and UBL URLs if available
      const pdfUrl = await this.getInvoicePdfUrl(invoice.id);
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

  /**
   * Create or get existing contact
   */
  private async createOrGetContact(contactData: ParasutContact): Promise<ParasutContact & { id: number }> {
    // For simplicity, always create new contact
    // In production, you might want to search for existing contacts first
    
    const contactPayload = {
      data: {
        type: 'contacts',
        attributes: {
          // Paraşüt requires account_type; default to 'customer' for sales invoices
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (response.ok) {
          const result = await response.json() as any;
          const url = result.data?.attributes?.url;
          if (url) return url;
        }
      } catch (error) {
        logger.warn('Failed to get PDF URL', { invoiceId, error, attempt });
      }
      await new Promise(r => setTimeout(r, 800));
    }
    return undefined;
  }

  /**
   * Get invoice UBL URL
   */
  private async getInvoiceUblUrl(invoiceId: number): Promise<string | undefined> {
    const endpoint = `${this.baseUrl}/${this.apiVersion}/${this.credentials.companyId}/sales_invoices/${invoiceId}/ubl`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (response.ok) {
          const result = await response.json() as any;
          const url = result.data?.attributes?.url;
          if (url) return url;
        }
      } catch (error) {
        logger.warn('Failed to get UBL URL', { invoiceId, error, attempt });
      }
      await new Promise(r => setTimeout(r, 800));
    }
    return undefined;
  }
}
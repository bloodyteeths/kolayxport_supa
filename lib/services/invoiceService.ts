import { ParasutClient, ParasutInvoiceData, ParasutCredentials } from '../integrations/parasutClient';
import { Order, OrderItem } from '@prisma/client';
import { logger } from '../logger';
import prisma from '../prisma';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

export interface InvoiceResult {
  pdfUrl?: string;
  ublUrl?: string;
  invoiceId: number;
  invoiceNo: string;
  localPdfPath?: string;
}

export interface InvoiceGenerationResult {
  success: boolean;
  invoices: (InvoiceResult & { orderId: string })[];
  attachments: { filename: string; path: string; contentType: string }[];
  errorMessage?: string;
}

export class InvoiceService {
  /**
   * Generate invoices for multiple orders
   */
  async generateInvoicesForOrders(
    orders: (Order & { items: OrderItem[] })[],
    userId: string
  ): Promise<InvoiceGenerationResult> {
    try {
      logger.info('Starting invoice generation', {
        userId,
        orderCount: orders.length
      });

      // Get user's Paraşüt credentials
      const credentials = await this.getParasutCredentials(userId);
      if (!credentials) {
        throw new Error('Paraşüt credentials not configured. Please set up Paraşüt integration.');
      }

      const parasutClient = new ParasutClient(credentials);
      
      // Authenticate with Paraşüt
      const authenticated = await parasutClient.authenticate();
      if (!authenticated) {
        throw new Error('Failed to authenticate with Paraşüt API');
      }

      const invoices: (InvoiceResult & { orderId: string })[] = [];
      const attachments: { filename: string; path: string; contentType: string }[] = [];

      // Generate invoice for each order
      for (const order of orders) {
        try {
          const invoiceData = await this.orderToParasutInvoiceConverted(order);
          const result = await parasutClient.createInvoice(invoiceData);
          logger.info('Invoice create result', { orderId: order.id, invoiceId: result.invoiceId, hasPdf: !!result.pdfUrl, hasUbl: !!result.ublUrl });
          
          // Download PDF if available
          let localPdfPath: string | undefined;
          const tracking = order.trackingNumber || '';
          if (result.pdfUrl) {
            localPdfPath = await this.downloadInvoicePdf(result.pdfUrl, tracking ? tracking : result.invoiceNo);
            if (localPdfPath) {
              attachments.push({
                filename: `invoice-${tracking ? tracking : result.invoiceNo}.pdf`,
                path: localPdfPath,
                contentType: 'application/pdf'
              });
              logger.info('Attached invoice PDF', { orderId: order.id, path: localPdfPath });
            }
          }
          // Also include UBL XML if available (common for e-invoice workflows)
          if (result.ublUrl) {
            const ublPath = await this.downloadInvoicePdf(result.ublUrl, tracking ? `${tracking}.ubl` : `${result.invoiceNo}.ubl`);
            if (ublPath) {
              attachments.push({
                filename: `invoice-${tracking ? tracking : result.invoiceNo}.xml`,
                path: ublPath,
                contentType: 'application/xml'
              });
              logger.info('Attached invoice UBL', { orderId: order.id, path: ublPath });
            }
          }

          invoices.push({
            ...result,
            orderId: order.id,
            localPdfPath
          });

          logger.info('Invoice generated for order', {
            orderId: order.id,
            invoiceId: result.invoiceId,
            invoiceNo: result.invoiceNo
          });

        } catch (error) {
          logger.error('Failed to generate invoice for order', 
            error instanceof Error ? error : new Error(String(error)), {
              orderId: order.id
            });
          
          // Continue with other orders even if one fails
          continue;
        }
      }

      return {
        success: invoices.length > 0,
        invoices,
        attachments,
        errorMessage: invoices.length === 0 ? 'No invoices were generated successfully' : undefined
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Invoice generation failed', undefined, {
        errorMessage,
        userId,
        orderCount: orders.length
      });

      return {
        success: false,
        invoices: [],
        attachments: [],
        errorMessage
      };
    }
  }

  // Convert invoice amounts to TRY using daily FX rate on order date
  private async orderToParasutInvoiceConverted(order: Order & { items: OrderItem[] }): Promise<ParasutInvoiceData> {
    const base = this.orderToParasutInvoice(order);
    const sourceCurrency = (order.currency || 'TRY').toUpperCase();
    const orderDate = (order.createdAt || new Date()).toISOString().split('T')[0];

    if (sourceCurrency === 'TRY') {
      return { ...base, currency: 'TRY', issue_date: orderDate };
    }

    const rate = await this.fetchFxRate(orderDate, sourceCurrency, 'TRY');
    const itemsTRY = (base.items || []).map((i) => ({
      ...i,
      unit_price: Math.round((Number(i.unit_price) * rate + Number.EPSILON) * 100) / 100,
    }));

    return {
      ...base,
      currency: 'TRY',
      exchange_rate: undefined,
      items: itemsTRY,
      issue_date: orderDate,
    };
  }

  private async fetchFxRate(dateISO: string, from: string, to: string): Promise<number> {
    try {
      const res = await fetch(
        `https://api.exchangerate.host/${dateISO}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`
      );
      if (!res.ok) throw new Error(`fx ${res.status}`);
      const json = (await res.json()) as any;
      const rate = Number(json?.rates?.[to]);
      if (!isFinite(rate) || rate <= 0) throw new Error('bad rate');
      return rate;
    } catch {
      return 1; // conservative fallback
    }
  }
  /**
   * Get user's Paraşüt credentials
   */
  private async getParasutCredentials(userId: string): Promise<ParasutCredentials | null> {
    try {
      const credential = await prisma.credential.findFirst({
        where: {
          userId
        },
        select: {
          parasutClientId: true,
          parasutClientSecret: true,
          parasutUsername: true,
          parasutPassword: true,
          parasutCompanyId: true
        }
      });

      if (!credential || !credential.parasutClientId || !credential.parasutClientSecret || 
          !credential.parasutUsername || !credential.parasutPassword || !credential.parasutCompanyId) {
        return null;
      }

      return {
        clientId: credential.parasutClientId,
        clientSecret: credential.parasutClientSecret,
        username: credential.parasutUsername,
        password: credential.parasutPassword,
        companyId: credential.parasutCompanyId
      };

    } catch (error) {
      logger.error('Failed to get Paraşüt credentials', 
        error instanceof Error ? error : new Error(String(error)), {
          userId
        });
      return null;
    }
  }

  /**
   * Convert order to Paraşüt invoice format
   */
  private orderToParasutInvoice(order: Order & { items: OrderItem[] }): ParasutInvoiceData {
    const shippingAddr = order.shippingAddress as any;
    
    // Extract contact information
    const contact = {
      name: order.customerName || shippingAddr?.name || 'Unknown Customer',
      email: shippingAddr?.email,
      phone: shippingAddr?.phone,
      address: this.formatAddress(shippingAddr),
      city: shippingAddr?.city,
      district: shippingAddr?.state || shippingAddr?.province,
      country: shippingAddr?.country_code === 'US' ? 'Amerika Birleşik Devletleri' : 
               shippingAddr?.country_code === 'DE' ? 'Almanya' :
               shippingAddr?.country_code === 'FR' ? 'Fransa' :
               shippingAddr?.country_code === 'UK' ? 'İngiltere' :
               shippingAddr?.country || 'Diğer'
    };

    // Convert order items to invoice items with robust value calculation
    const hasItems = Array.isArray(order.items) && order.items.length > 0;
    const totalQty = hasItems ? order.items.reduce((acc, it) => acc + (it.quantity || 1), 0) : 1;
    const orderTotal = Number(order.totalPrice || 0);
    const items = hasItems
      ? order.items.map((item) => {
          const qty = item.quantity || 1;
          // Handle Prisma Decimal gracefully
          const toNum = (v: any): number => {
            try { if (v && typeof v === 'object' && typeof (v as any).toNumber === 'function') return (v as any).toNumber(); } catch {}
            const n = Number(v); return Number.isFinite(n) ? n : 0;
          };
          let unit = toNum(item.unitPrice || 0);
          if (!unit || unit <= 0) {
            const itemTotal = toNum(item.totalPrice || 0);
            if (itemTotal && itemTotal > 0) {
              unit = itemTotal / qty;
            } else if (orderTotal && orderTotal > 0 && totalQty > 0) {
              // Pro-rate order total across items by quantity
              unit = (orderTotal / totalQty);
            }
          }
          return {
            quantity: qty,
            unit_price: Math.round((unit + Number.EPSILON) * 100) / 100,
            vat_rate: 0,
            description: item.productName || item.sku || 'Product',
            unit: 'Adet'
          };
        })
      : [{
          quantity: 1,
          unit_price: Math.round((orderTotal + Number.EPSILON) * 100) / 100,
          vat_rate: 0,
          description: order.commodityDesc || 'Product',
          unit: 'Adet'
        }];

    return {
      contact,
      items,
      invoice_series: 'EXP', // Export series
      issue_date: new Date().toISOString().split('T')[0],
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days
      currency: order.currency || 'USD',
      exchange_rate: order.currency === 'TRY' ? 1 : undefined,
      fatura_no: `EXP-${order.orderNumber}`
    };
  }

  /**
   * Format shipping address
   */
  private formatAddress(shippingAddr: any): string {
    if (!shippingAddr) return '';
    
    const parts = [
      shippingAddr.first_line || shippingAddr.address1,
      shippingAddr.second_line || shippingAddr.address2,
      shippingAddr.third_line
    ].filter(Boolean);
    
    return parts.join(', ');
  }

  /**
   * Download invoice PDF from URL
   */
  private async downloadInvoicePdf(pdfUrl: string, invoiceNo: string): Promise<string | undefined> {
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        throw new Error(`Failed to download PDF: ${response.status}`);
      }

      const buffer = await response.buffer();
      const fileName = `invoice-${invoiceNo}-${Date.now()}.pdf`;
      const filePath = path.join('/tmp', fileName);

      fs.writeFileSync(filePath, buffer);

      logger.info('Invoice PDF downloaded', {
        invoiceNo,
        filePath,
        fileSize: buffer.length
      });

      return filePath;

    } catch (error) {
      logger.error('Failed to download invoice PDF', 
        error instanceof Error ? error : new Error(String(error)), {
          pdfUrl,
          invoiceNo
        });
      return undefined;
    }
  }

  /**
   * Clean up downloaded invoice files
   */
  cleanupInvoiceFiles(filePaths: string[]): void {
    filePaths.forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.debug('Cleaned up invoice file', { filePath });
        }
      } catch (error) {
        logger.warn('Failed to cleanup invoice file', {
          error: error instanceof Error ? error.message : String(error),
          filePath
        });
      }
    });
  }
}
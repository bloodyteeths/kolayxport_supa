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
          // Build details from items
          const toNum = (v: any): number => { try { if (v && typeof v === 'object' && typeof (v as any).toNumber === 'function') return (v as any).toNumber(); } catch {}; const n = Number(v); return Number.isFinite(n) ? n : 0; };
          const raw: any = (order as any).rawData || {};
          const rawLineItems: any[] = Array.isArray(raw?.line_items) ? raw.line_items : [];
          const items = order.items && order.items.length > 0 ? order.items : [];
          const totalQty = items.reduce((acc, it) => acc + (it.quantity || 1), 0) || 1;
          const orderTotal = toNum(order.totalPrice || 0);
          const details: Array<{ name: string; description?: string; quantity: number; unit_price: number; vat_rate: number; sku?: string }> = [];
          for (const it of items) {
            const qty = (toNum(it.quantity) || 1);
            let unit = toNum(it.unitPrice);
            if (!unit || unit <= 0) {
              const itTotal = toNum(it.totalPrice);
              if (itTotal > 0) unit = itTotal / qty; else if (orderTotal > 0) unit = orderTotal / totalQty; else if (rawLineItems.length > 0) {
                const match = rawLineItems.find((li: any) => (li?.sku && it.sku && String(li.sku) === String(it.sku)) || (li?.id && it.marketplaceKey && String(li.id) === String(it.marketplaceKey)) || (li?.object_id && it.uniqueLineKey && String(it.uniqueLineKey) === String(li.object_id))) || rawLineItems[0];
                const liTotal = toNum(match?.total_price) || (toNum(match?.price) * (toNum(match?.quantity) || 1));
                if (liTotal > 0) unit = liTotal / qty;
              }
            }
            const name = (it.productName || it.sku || rawLineItems.find((li: any) => li?.sku === it.sku)?.title || 'Item').toString().slice(0, 240);
            if (unit > 0) details.push({ name, description: name, quantity: qty, unit_price: Math.round((unit + Number.EPSILON) * 100) / 100, vat_rate: 0, sku: it.sku || undefined });
            else logger.warn('parasut.detail.skipped', { reason: 'unit_price<=0', rawLineSnapshot: { name, qty, unit } });
          }
          if (details.length === 0) {
            if (orderTotal > 0) details.push({ name: 'Custom Item', description: 'Custom Item', quantity: 1, unit_price: Math.round((orderTotal + Number.EPSILON) * 100) / 100, vat_rate: 0 });
            else throw new Error(`No non-zero priced items for order ${order.id}. Check mapping of unit_price/total.`);
          }
          // Create invoice with details via compound create
          const contactCreated = await parasutClient.createOrGetContact(invoiceData.contact);

          // Ensure product existence per line (cache per request)
          const productIdCache = new Map<string, number>();
          const ensureProductIdFor = async (detail: { name: string; sku?: string }): Promise<number | undefined> => {
            const key = detail.sku || detail.name;
            if (productIdCache.has(key)) return productIdCache.get(key);
            try {
              const id = await parasutClient.ensureProductId({ code: detail.sku, name: detail.name, vat_rate: 0, unit: 'Adet' });
              productIdCache.set(key, id);
              return id;
            } catch (e) {
              logger.warn('ensureProductId.failed', { key, error: e instanceof Error ? e.message : String(e) });
              return undefined;
            }
          };

          const detailsWithProducts = [] as Array<{ name: string; description?: string; quantity: number; unit_price: number; vat_rate: number; productId?: string }>;
          for (const d of details) {
            const pid = await ensureProductIdFor(d);
            detailsWithProducts.push({ ...d, productId: pid ? String(pid) : undefined });
          }

          logger.debug('parasut.invoice.details.summary', {
            detailCount: details.length,
            nonZeroLines: details.filter(d => d.unit_price > 0 && d.quantity > 0).length,
            names: details.slice(0, 5).map(d => d.name)
          });

          const created = await parasutClient.createSalesInvoiceWithDetails({
            contactId: String(contactCreated.id),
            issueDate: invoiceData.issue_date || new Date().toISOString().split('T')[0],
            description: `Invoice for ${contactCreated.name}`,
            // For TL omit currency; for FX send USD/EUR/GBP only
            currency: undefined,
            details: detailsWithProducts.map(d => ({
              name: d.name || 'Item',
              description: d.description || d.name,
              quantity: d.quantity,
              unit_price: d.unit_price,
              vat_rate: d.vat_rate,
              productId: d.productId
            }))
          });
          const result = { invoiceId: created.id, invoiceNo: created.invoice_no || 'N/A', pdfUrl: undefined as string | undefined, ublUrl: undefined as string | undefined };
          logger.info('parasut.invoice.created', { invoiceId: result.invoiceId, contactId: contactCreated.id, detailCount: details.length });
          
          // Decide e-invoice vs e-archive
          const taxNumber = (order as any)?.buyer?.tax_number || (order as any)?.tax_number || undefined;
          let jobId: string | undefined;
          if (taxNumber) {
            try {
              const inboxes = await parasutClient.listEInvoiceInboxesByTaxNumber(taxNumber);
              if (Array.isArray(inboxes) && inboxes.length > 0) {
                const to = inboxes[0]?.attributes?.e_invoice_address || inboxes[0]?.attributes?.identifier;
                if (to) {
                  jobId = await parasutClient.createEInvoice({ salesInvoiceId: result.invoiceId, to, scenario: 'basic' });
                  logger.info('parasut.edoc.started', { orderId: order.id, invoiceId: result.invoiceId, kind: 'e_invoice', jobId });
                }
              }
            } catch (e) {
              logger.warn('E-invoice inbox lookup failed; falling back to e-archive', { orderId: order.id, error: e instanceof Error ? e.message : String(e) });
            }
          }
          if (!jobId) {
            jobId = await parasutClient.createEArchive({ salesInvoiceId: result.invoiceId });
            logger.info('parasut.edoc.started', { orderId: order.id, invoiceId: result.invoiceId, kind: 'e_archive', jobId });
          }

          // Poll job until finished
          let jobResourceType: string | undefined;
          let jobResourceId: number | undefined;
          try {
            const job = await parasutClient.trackJob(jobId);
            jobResourceType = job.resourceType;
            jobResourceId = job.resourceId;
            logger.info('parasut.edoc.completed', { orderId: order.id, invoiceId: result.invoiceId, jobId, status: job.status, resourceType: job.resourceType, resourceId: job.resourceId });
          } catch (e) {
            logger.error('Paraşüt job failed', e instanceof Error ? e : new Error(String(e)), { orderId: order.id, jobId });
            // Continue, but we may not get a PDF URL
          }

          // Read active e-document and get PDF URL
          let pdfUrl = result.pdfUrl;
          try {
            // First try directly from job resource if available
            if (!pdfUrl && jobResourceType && jobResourceId) {
              if (jobResourceType === 'e_archives') {
                pdfUrl = await parasutClient.showEArchivePDF(jobResourceId);
              } else if (jobResourceType === 'e_invoices') {
                pdfUrl = await parasutClient.showEInvoicePDF(jobResourceId);
              }
            }
            if (pdfUrl) {
              logger.debug('parasut.edoc.pdf.fromJob', { orderId: order.id, invoiceId: result.invoiceId, jobResourceType, jobResourceId });
            }
            
            const shown = await parasutClient.showSalesInvoice(result.invoiceId);
            let eDocType: string | undefined;
            let eDocId: string | undefined;
            const rel = shown?.data?.relationships?.active_e_document?.data;
            if (rel?.type && rel?.id) {
              eDocType = String(rel.type);
              eDocId = String(rel.id);
            } else {
              const activeInc = Array.isArray(shown?.included) ? shown.included.find((inc: any) => inc?.type === 'e_invoices' || inc?.type === 'e_archives') : undefined;
              if (activeInc) {
                eDocType = String(activeInc.type);
                eDocId = String(activeInc.id);
              }
            }
            logger.debug('parasut.edoc.active', { orderId: order.id, invoiceId: result.invoiceId, eDocType, eDocId });
            if (eDocType === 'e_invoices' && eDocId) pdfUrl = await parasutClient.showEInvoicePDF(Number(eDocId));
            if (eDocType === 'e_archives' && eDocId) pdfUrl = await parasutClient.showEArchivePDF(Number(eDocId));
            // If relationship not ready or missing, try find by invoice id
            if (!pdfUrl) {
              logger.debug('parasut.edoc.lookup.eArchiveByInvoice', { invoiceId: result.invoiceId });
              const eArchiveId = await parasutClient.findEArchiveForInvoice(result.invoiceId);
              if (eArchiveId) {
                logger.debug('parasut.edoc.lookup.eArchiveByInvoice.found', { invoiceId: result.invoiceId, eArchiveId });
                pdfUrl = await parasutClient.showEArchivePDF(eArchiveId);
              }
            }
            if (!pdfUrl) {
              // Fallback to sales invoice PDF endpoint in case active link is not yet populated
              pdfUrl = await parasutClient.showSalesInvoicePDF(result.invoiceId);
            }
          } catch (e) {
            logger.warn('Failed to resolve active e-document PDF', { orderId: order.id, error: e instanceof Error ? e.message : String(e) });
          }
          
          // Download PDF if available
          let localPdfPath: string | undefined;
          const tracking = order.trackingNumber || '';
          if (pdfUrl) {
            localPdfPath = await this.downloadInvoicePdf(pdfUrl, tracking ? tracking : result.invoiceNo);
            if (localPdfPath) {
              attachments.push({
                filename: `invoice-${tracking ? tracking : result.invoiceNo}.pdf`,
                path: localPdfPath,
                contentType: 'application/pdf'
              });
              logger.info('Attached invoice PDF', { orderId: order.id, path: localPdfPath });
            }
          }
          // Note: UBL retrieval path differs for e-docs; omitted in sandbox unless required

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
      // Fetch full record to avoid type issues with select on older Prisma client typings during build
      const credential = await prisma.credential.findFirst({
        where: { userId }
      });

      const c: any = credential as any;
      if (!c || !c.parasutClientId || !c.parasutClientSecret || 
          !c.parasutUsername || !c.parasutPassword || !c.parasutCompanyId) {
        return null;
      }

      return {
        clientId: c.parasutClientId,
        clientSecret: c.parasutClientSecret,
        username: c.parasutUsername,
        password: c.parasutPassword,
        companyId: c.parasutCompanyId
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
    const raw: any = (order as any).rawData || {};
    const rawLineItems: any[] = Array.isArray(raw?.line_items) ? raw.line_items : [];
    
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
            } else if (rawLineItems.length > 0) {
              // Try match raw marketplace item for pricing
              const match = rawLineItems.find((li: any) => {
                return (li?.sku && item.sku && String(li.sku) === String(item.sku)) ||
                       (li?.id && item.marketplaceKey && String(li.id) === String(item.marketplaceKey)) ||
                       (li?.object_id && item.uniqueLineKey && String(li.object_id) === String(item.uniqueLineKey));
              }) || rawLineItems[0];
              const liTotal = toNum(match?.total_price) || (toNum(match?.price) * (toNum(match?.quantity) || 1));
              if (liTotal && qty > 0) unit = liTotal / qty;
            }
          }
          const desc = (item.productName || item.sku || rawLineItems.find((li: any) => li?.sku === item.sku)?.title || 'Product').toString().trim() || 'Product';
          return {
            quantity: qty,
            unit_price: Math.round((unit + Number.EPSILON) * 100) / 100,
            vat_rate: 0,
            description: desc,
          unit: 'Adet'
          };
        })
      : [{
          quantity: 1,
          unit_price: Math.round((orderTotal + Number.EPSILON) * 100) / 100,
          vat_rate: 0,
          description: (order.commodityDesc || rawLineItems?.[0]?.title || 'Product'),
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
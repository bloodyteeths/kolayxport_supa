import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { Order, OrderItem } from '@prisma/client';
import { logger } from '../logger';

export interface EtgbOrderData {
  trackingNumber: string;
  packageCount: number;
  grossWeight: number;
  sender: string;
  senderTaxOffice: string;
  recipient: string;
  originCountry: string;
  tradeCountry: string;
  previousCountry: string;
  deliveryMethod: string;
  commercialDescription: string;
  gtipNo: string;
  completionMethod: string;
  completionMethodDescription: string;
  currency: string;
  rate: number;
  value: number;
  commercialInvoiceNo: string;
  commercialInvoiceDate: string;
}

export interface OrderBatch {
  orders: (Order & { items: OrderItem[] })[];
  batchId: string;
  userId: string;
}

export class EtgbExcelService {
  private readonly templateHeaders = [
    'TAKIP NUMARASI',
    'KAP ADEDI', 
    'BRÜT KG',
    'GÖNDEREN',
    'GÖNDEREN V.D.',
    'ALICI',
    'MENŞEI ÜLKE',
    'TİCARET ÜLKE',
    'ÖNCEKİ ÜLKE',
    'TESLİM ŞEKLİ',
    'TİCARİ TANIM',
    'GTIP NO',
    'TAMAMLAYICI YÖNTEM',
    'TAMAMLAYICI AÇIKLAMA',
    'DÖVİZ',
    'KUR',
    'DEĞER',
    'TİCARİ FATURA NO',
    'TİCARİ FATURA TARİHİ'
  ];

  /**
   * Convert order batch to ETGB Excel format
   */
  async generateExcel(orderBatch: OrderBatch): Promise<{
    filePath: string;
    fileName: string;
    fileHash: string;
    buffer: Buffer;
  }> {
    try {
      logger.info('Generating ETGB Excel', {
        batchId: orderBatch.batchId,
        orderCount: orderBatch.orders.length,
        userId: orderBatch.userId
      });

      // Convert orders to ETGB format
      const etgbData = this.convertOrdersToEtgbFormat(orderBatch.orders);

      // Create workbook
      const workbook = XLSX.utils.book_new();
      
      // Create worksheet with headers
      const wsData = [this.templateHeaders, ...etgbData.map(order => this.orderToRow(order))];
      const worksheet = XLSX.utils.aoa_to_sheet(wsData);

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ETGB Export');

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Generate file hash
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `etgb-export-${orderBatch.batchId}-${timestamp}.xlsx`;
      const filePath = `/tmp/${fileName}`;

      // Write file to temp directory
      const fs = require('fs');
      fs.writeFileSync(filePath, buffer);

      logger.info('ETGB Excel generated successfully', {
        fileName,
        fileHash,
        fileSizeBytes: buffer.length,
        recordCount: etgbData.length
      });

      return {
        filePath,
        fileName,
        fileHash,
        buffer
      };

    } catch (error) {
      logger.error('Failed to generate ETGB Excel', 
        error instanceof Error ? error : new Error(String(error)), {
          batchId: orderBatch.batchId,
          userId: orderBatch.userId
        });
      throw error;
    }
  }

  /**
   * Convert orders to ETGB data format
   */
  private convertOrdersToEtgbFormat(orders: (Order & { items: OrderItem[] })[]): EtgbOrderData[] {
    return orders.flatMap(order => {
      // Handle orders without items
      if (!order.items || order.items.length === 0) {
        return [this.orderToEtgbData(order, null)];
      }

      // Create one row per item
      return order.items.map(item => this.orderToEtgbData(order, item));
    });
  }

  /**
   * Convert single order to ETGB format
   */
  private orderToEtgbData(order: Order, item: OrderItem | null): EtgbOrderData {
    const shippingAddr = order.shippingAddress as any;
    const raw: any = (order as any).rawData || {};
    const rawLineItems: any[] = Array.isArray(raw?.line_items) ? raw.line_items : [];
    // Determine tracking number: prefer order.trackingNumber else latest created shipment tracking
    let tracking = order.trackingNumber || '';
    try {
      const anyOrder = order as any;
      if (!tracking && Array.isArray(anyOrder.shipments) && anyOrder.shipments.length > 0) {
        const createdShipments = anyOrder.shipments.filter((s: any) => s?.status === 'created');
        if (createdShipments.length > 0) {
          // pick the latest by createdAt
          createdShipments.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          tracking = createdShipments[0]?.trackingNumber || '';
        }
      }
    } catch {}

    // Helper to coerce Prisma Decimal or number-like into number
    const parseMoney = (v: any): number => {
      try {
        if (v && typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
        if (typeof v === 'string') {
          let s = v.trim();
          // remove currency symbols and spaces
          s = s.replace(/[\s₺$€£]/g, '');
          // handle thousand/decimal separators (TR: "," decimal)
          if (s.includes(',') && !s.includes('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
          } else if (s.includes(',') && s.includes('.')) {
            // Assume last separator is decimal; remove others
            const lastComma = s.lastIndexOf(',');
            const lastDot = s.lastIndexOf('.');
            if (lastComma > lastDot) {
              s = s.replace(/\./g, '').replace(',', '.');
            } else {
              s = s.replace(/,/g, '');
            }
          } else {
            // just digits and dots
          }
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : 0;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      } catch { return 0; }
    };

    // Determine declared value per row (per item preferred)
    let declaredValue: number = 0;
    try {
      if (item) {
        const qty = parseMoney((item as any)?.quantity ?? 1) || 1;
        let unit = parseMoney((item as any)?.unitPrice ?? 0);
        if (!unit || unit <= 0) {
          const itemTotal = parseMoney((item as any)?.totalPrice ?? 0);
          if (itemTotal > 0) unit = itemTotal / qty;
        }
        if (!unit || unit <= 0) {
          // Try raw marketplace line matching
          if (rawLineItems.length > 0) {
            const match = rawLineItems.find((li: any) => (li?.sku && (item as any)?.sku && String(li.sku) === String((item as any).sku)) || (li?.id && (item as any)?.marketplaceKey && String(li.id) === String((item as any).marketplaceKey)) || (li?.object_id && (item as any)?.uniqueLineKey && String(li.object_id) === String((item as any).uniqueLineKey))) || rawLineItems[0];
            const liTotal = parseMoney(match?.total_price) || (parseMoney(match?.price) * (parseMoney(match?.quantity) || 1));
            if (liTotal > 0) unit = liTotal / qty;
          }
        }
        const calc = qty * (unit || 0);
        if (calc > 0) declaredValue = Number(calc.toFixed(2));
        // Final fallback: allocate from order total if still zero
        if (declaredValue === 0) {
          const orderTotal = parseMoney((order as any).totalPrice ?? raw?.total_price ?? 0);
          const itemsCount = Array.isArray((order as any).items) && (order as any).items.length > 0 ? (order as any).items.length : 1;
          if (orderTotal > 0 && itemsCount > 0) {
            declaredValue = Number((orderTotal / itemsCount).toFixed(2));
          }
        }
      } else {
        // Order-level row: use order total
        const orderTotal = parseMoney((order as any).totalPrice ?? raw?.total_price ?? 0);
        if (orderTotal > 0) declaredValue = Number(orderTotal.toFixed(2));
      }
    } catch {}

    const row: EtgbOrderData = {
      trackingNumber: tracking,
      packageCount: 1,
      grossWeight: (item ? (order.weightKg || 0.5) : 0.5),
      sender: 'TAMSAR TEKSTİL',
      senderTaxOffice: '8180721000',
      recipient: order.customerName || shippingAddr?.name || '',
      originCountry: order.countryOfMfg || 'TÜRKİYE',
      tradeCountry: shippingAddr?.country_code || 'ABD',
      previousCountry: shippingAddr?.country_code || 'ABD',
      deliveryMethod: 'FOB',
      commercialDescription: item?.productName || order.commodityDesc || 'Textile Product',
      gtipNo: order.harmonizedCode || '6204439506',
      completionMethod: 'addon',
      completionMethodDescription: 'addon',
      currency: order.currency || 'USD',
      rate: 1,
      value: declaredValue,
      commercialInvoiceNo: `INV${order.orderNumber}`,
      commercialInvoiceDate: order.createdAt.toISOString().split('T')[0]
    };
    logger.debug?.('ETGB row computed', { orderId: (order as any).id, tracking: row.trackingNumber, value: row.value });
    return row;
  }

  /**
   * Convert ETGB data to Excel row
   */
  private orderToRow(data: EtgbOrderData): (string | number)[] {
    return [
      data.trackingNumber,
      data.packageCount,
      data.grossWeight,
      data.sender,
      data.senderTaxOffice,
      data.recipient,
      data.originCountry,
      data.tradeCountry,
      data.previousCountry,
      data.deliveryMethod,
      data.commercialDescription,
      data.gtipNo,
      data.completionMethod,
      data.completionMethodDescription,
      data.currency,
      data.rate,
      data.value,
      data.commercialInvoiceNo,
      data.commercialInvoiceDate
    ];
  }
}
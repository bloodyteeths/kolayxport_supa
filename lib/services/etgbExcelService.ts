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

    // Determine declared value: prefer shipment.customsValue, then item.totalPrice, then order.totalPrice
    let declaredValue: number = Number(item?.totalPrice || order.totalPrice || 0);
    try {
      const anyOrder = order as any;
      if (Array.isArray(anyOrder.shipments) && anyOrder.shipments.length > 0) {
        const createdShipments = anyOrder.shipments.filter((s: any) => s?.status === 'created');
        if (createdShipments.length > 0) {
          // pick the latest by createdAt
          createdShipments.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const s = createdShipments[0];
          if (s?.customsValue) declaredValue = Number(s.customsValue);
        }
      }
    } catch {}

    return {
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
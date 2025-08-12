import { EtgbExcelService, OrderBatch } from './etgbExcelService';
import { EtgbMailerService, EtgbEmailData } from './etgbMailerService';
import { InvoiceService } from './invoiceService';
import { logger } from '../logger';
import prisma from '../prisma';
import { Order, OrderItem } from '@prisma/client';

export interface EtgbProcessResult {
  success: boolean;
  batchId: string;
  excelFile: {
    fileName: string;
    filePath: string;
    fileHash: string;
  };
  emailResult: {
    messageId: string;
    recipientEmail: string;
    status: 'sent' | 'failed';
    errorMessage?: string;
  };
  errorMessage?: string;
}

export class EtgbService {
  private excelService: EtgbExcelService;
  private mailerService: EtgbMailerService;
  private invoiceService: InvoiceService;

  constructor() {
    this.excelService = new EtgbExcelService();
    this.mailerService = new EtgbMailerService();
    this.invoiceService = new InvoiceService();
  }

  /**
   * Process order batch: generate Excel and send email
   */
  async processOrderBatch(
    orders: (Order & { items: OrderItem[] })[],
    userId: string,
    recipientEmail?: string
  ): Promise<EtgbProcessResult> {
    const batchId = this.generateBatchId();
    
    try {
      logger.info('Starting ETGB process', {
        batchId,
        userId,
        orderCount: orders.length,
        recipientEmail
      });

      // Create order batch
      const orderBatch: OrderBatch = {
        orders,
        batchId,
        userId
      };

      // Generate Excel file
      const excelResult = await this.excelService.generateExcel(orderBatch);

      // Get recipient email from user settings if not provided
      let targetEmail = recipientEmail;
      if (!targetEmail) {
        targetEmail = await this.mailerService.getUserEmailConfig(userId) || undefined;
      }

      if (!targetEmail) {
        throw new Error('No recipient email configured. Please set ETGB recipient email in settings.');
      }

      // Get user info for CC
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true }
      });

      // Prepare email data
      const emailData: EtgbEmailData = {
        recipientEmail: targetEmail,
        ccEmails: user?.email ? [user.email] : [],
        batchId,
        userId,
        orderCount: orders.length,
        attachments: [
          {
            filename: excelResult.fileName,
            path: excelResult.filePath,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }
        ]
      };

      // Generate invoices with Paraşüt
      const invoiceResult = await this.invoiceService.generateInvoicesForOrders(orders, userId);
      if (invoiceResult.success && invoiceResult.attachments.length > 0) {
        emailData.attachments.push(...invoiceResult.attachments);
        logger.info('Added invoice attachments to ETGB email', {
          batchId,
          invoiceCount: invoiceResult.invoices.length,
          attachmentCount: invoiceResult.attachments.length
        });
      }

      // Send email
      const emailResult = await this.mailerService.sendEtgbEmail(emailData);

      // Log the operation (simplified since we're not adding the database model yet)
      logger.info('ETGB process completed', {
        batchId,
        success: emailResult.status === 'sent',
        fileName: excelResult.fileName,
        fileHash: excelResult.fileHash,
        messageId: emailResult.messageId,
        recipientEmail: targetEmail
      });

      // Clean up temp files
      this.cleanupTempFile(excelResult.filePath);
      if (invoiceResult?.attachments) {
        this.invoiceService.cleanupInvoiceFiles(invoiceResult.attachments.map(att => att.path));
      }

      return {
        success: emailResult.status === 'sent',
        batchId,
        excelFile: {
          fileName: excelResult.fileName,
          filePath: excelResult.filePath,
          fileHash: excelResult.fileHash
        },
        emailResult,
        errorMessage: emailResult.errorMessage
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('ETGB process failed', undefined, {
        errorMessage,
        batchId,
        userId,
        orderCount: orders.length
      });

      return {
        success: false,
        batchId,
        excelFile: {
          fileName: '',
          filePath: '',
          fileHash: ''
        },
        emailResult: {
          messageId: '',
          recipientEmail: recipientEmail || '',
          status: 'failed',
          errorMessage
        },
        errorMessage
      };
    }
  }

  /**
   * Process orders by order IDs
   */
  async processOrdersByIds(orderIds: string[], userId: string, recipientEmail?: string): Promise<EtgbProcessResult> {
    try {
      // Fetch orders with items
      const orders = await prisma.order.findMany({
        where: {
          id: { in: orderIds },
          userId
        },
        include: {
          items: true,
          shipments: true
        }
      });

      if (orders.length === 0) {
        throw new Error('No orders found for the provided IDs');
      }

      return await this.processOrderBatch(orders, userId, recipientEmail);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Failed to fetch orders for ETGB processing', undefined, {
        errorMessage,
        orderIds,
        userId
      });

      throw error;
    }
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `ETGB-${timestamp}-${random}`;
  }

  /**
   * Clean up temporary files
   */
  private cleanupTempFile(filePath: string): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug('Cleaned up temp file', { filePath });
      }
    } catch (error) {
      logger.warn('Failed to cleanup temp file', {
        error: error instanceof Error ? error.message : String(error),
        filePath
      });
    }
  }
}
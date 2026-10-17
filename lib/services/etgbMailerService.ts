import nodemailer from 'nodemailer';
import { logger } from '../logger';
import prisma from '../prisma';
import { renderEmailHtml } from '@/lib/email/layout';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface EtgbEmailData {
  recipientEmail: string;
  ccEmails?: string[];
  batchId: string;
  userId: string;
  orderCount: number;
  attachments: {
    filename: string;
    path: string;
    contentType: string;
  }[];
}

export interface EtgbEmailResult {
  messageId: string;
  recipientEmail: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
}

export class EtgbMailerService {
  private transporter: nodemailer.Transporter;
  private defaultConfig: SmtpConfig;

  constructor() {
    // System SMTP configuration - following pattern of other integrations
    this.defaultConfig = {
      host: process.env.ETGB_SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.ETGB_SMTP_PORT || '587'),
      secure: process.env.ETGB_SMTP_SECURE === 'true',
      auth: {
        user: process.env.ETGB_SMTP_USER || '',
        pass: process.env.ETGB_SMTP_PASS || ''
      }
    };

    // If SMTP auth is missing, log a clear warning
    if (!this.defaultConfig.auth.user || !this.defaultConfig.auth.pass) {
      logger.warn('ETGB SMTP credentials are missing. Set ETGB_SMTP_USER and ETGB_SMTP_PASS to enable email sending.');
    }

    this.transporter = nodemailer.createTransport(this.defaultConfig);
  }

  /**
   * Get user's email configuration from settings
   */
  async getUserEmailConfig(userId: string): Promise<string | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { shippingSettings: true }
      });

      const settings = user?.shippingSettings as any;
      return settings?.etgbRecipientEmail || null;
    } catch (error) {
      logger.error('Failed to get user email config', 
        error instanceof Error ? error : new Error(String(error)), {
          userId
        });
      return null;
    }
  }

  /**
   * Send ETGB email with Excel attachment and invoices
   */
  async sendEtgbEmail(emailData: EtgbEmailData): Promise<EtgbEmailResult> {
    try {
      logger.info('Sending ETGB email', {
        recipientEmail: emailData.recipientEmail,
        batchId: emailData.batchId,
        userId: emailData.userId,
        orderCount: emailData.orderCount,
        attachmentCount: emailData.attachments.length
      });

      // Compose email
      const mailOptions = {
        from: this.defaultConfig.auth.user,
        to: emailData.recipientEmail,
        cc: emailData.ccEmails?.join(', '),
        subject: `ETGB Export - Batch ${emailData.batchId} (${emailData.orderCount} orders)`,
        html: this.generateEmailTemplate(emailData),
        attachments: emailData.attachments
      };

      // Send email
      const info = await this.transporter.sendMail(mailOptions);

      logger.info('ETGB email sent successfully', {
        messageId: info.messageId,
        recipientEmail: emailData.recipientEmail,
        batchId: emailData.batchId
      });

      return {
        messageId: info.messageId,
        recipientEmail: emailData.recipientEmail,
        status: 'sent'
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Failed to send ETGB email', undefined, {
        errorMessage,
        recipientEmail: emailData.recipientEmail,
        batchId: emailData.batchId,
        userId: emailData.userId
      });

      return {
        messageId: '',
        recipientEmail: emailData.recipientEmail,
        status: 'failed',
        errorMessage
      };
    }
  }

  /**
   * Generate HTML email template
   */
  private generateEmailTemplate(emailData: EtgbEmailData): string {
    const files = emailData.attachments.map((att) => `• ${att.filename}`).join('\n');
    return renderEmailHtml({
      title: 'ETGB dosyanız hazır',
      preheader: `${emailData.orderCount} sipariş · ${emailData.batchId}`,
      text: `Merhaba,

ETGB dosyanız hazırlandı ve bu e-postanın ekinde.

Parti: ${emailData.batchId}
Sipariş sayısı: ${emailData.orderCount}
Oluşturulma: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}

Ekler:
${files}

Bu e-posta KolayXport tarafından otomatik gönderildi. Sorunuz olursa bu e-postayı yanıtlayabilirsiniz.`,
    });
  }

  /**
   * Test email configuration
   */
  async testEmailConfig(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.error('SMTP configuration test failed', 
        error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Update SMTP configuration
   */
  updateSmtpConfig(config: Partial<SmtpConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    this.transporter = nodemailer.createTransport(this.defaultConfig);
  }
}
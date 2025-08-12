import nodemailer from 'nodemailer';
import { logger } from '../logger';
import prisma from '../prisma';

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
    const attachmentList = emailData.attachments
      .map(att => `<li>${att.filename}</li>`)
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ETGB Export</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .details { background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .attachments { margin-top: 20px; }
          .footer { background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>ETGB Export Hazır</h1>
        </div>
        
        <div class="content">
          <p>Merhaba,</p>
          
          <p>ETGB export dosyanız hazırlandı ve ekte gönderilmektedir.</p>
          
          <div class="details">
            <h3>Export Detayları:</h3>
            <ul>
              <li><strong>Batch ID:</strong> ${emailData.batchId}</li>
              <li><strong>Sipariş Sayısı:</strong> ${emailData.orderCount}</li>
              <li><strong>Oluşturulma Tarihi:</strong> ${new Date().toLocaleString('tr-TR')}</li>
            </ul>
          </div>
          
          <div class="attachments">
            <h3>Ekler:</h3>
            <ul>
              ${attachmentList}
            </ul>
          </div>
          
          <p>Herhangi bir sorunuz olursa lütfen bizimle iletişime geçin.</p>
          
          <p>İyi çalışmalar dileriz.</p>
        </div>
        
        <div class="footer">
          <p>Bu email KolayXport sistemi tarafından otomatik olarak gönderilmiştir.</p>
          <p>Generated at: ${new Date().toISOString()}</p>
        </div>
      </body>
      </html>
    `;
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
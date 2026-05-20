import nodemailer from 'nodemailer';
import { rateLimit } from '@/lib/middleware/rateLimit';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (!rateLimit(60_000, 3)(req, res)) return;

    const { name, email, subject, message } = req.body;

    // Basic validation (can be more robust)
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Tüm alanlar zorunludur.' });
    }

    // Sanitize name and email to prevent email header injection
    // Strip CR, LF, angle brackets that could inject additional headers
    const safeName = name.replace(/[\r\n<>]/g, '');
    const safeEmail = email.replace(/[\r\n<>]/g, '');
    const safeSubject = subject.replace(/[\r\n]/g, '');

    // Configure Nodemailer transporter
    // IMPORTANT: For Gmail, you'll likely need to enable "Less secure app access"
    // or use an App Password if 2FA is enabled.
    // For production, consider a dedicated email service like SendGrid, Mailgun, or AWS SES.
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER, // Your Gmail address from .env.local
        pass: process.env.GMAIL_APP_PASSWORD, // Your Gmail App Password from .env.local
      },
    });

    const mailOptions = {
      from: `"${safeName}" <${safeEmail}>`, // Sender address (shows name and their email)
      replyTo: safeEmail, // So you can reply directly to the user
      to: 'destek@kolayxport.com', // Your receiving email address
      subject: `Yeni İletişim Formu Mesajı: ${safeSubject}`,
      text: `Gönderen Adı: ${safeName}\nGönderen E-posta: ${safeEmail}\n\nMesaj:\n${message}`,
      html: `<p><strong>Gönderen Adı:</strong> ${safeName}</p>
             <p><strong>Gönderen E-posta:</strong> ${safeEmail}</p>
             <hr>
             <p><strong>Mesaj:</strong></p>
             <p>${message.replace(/\n/g, '<br>')}</p>`,
    };

    try {
      await transporter.sendMail(mailOptions);
      return res.status(200).json({ success: true, message: 'Mesaj başarıyla gönderildi.' });
    } catch (error) {
      console.error('Error sending email:', error);
      return res.status(500).json({ error: 'Mesaj gönderilirken bir hata oluştu.', details: error.message });
    }
  } else {
    // Handle any other HTTP method
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
} 
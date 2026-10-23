import { logAuthEvent } from '@/lib/admin/events';
import { renderEmailHtml } from '@/lib/email/layout';

/**
 * Outbound transactional email via Postmark HTTP API.
 *
 * - Uses POSTMARK_SERVER_TOKEN + POSTMARK_FROM_EMAIL.
 * - Never logs the request body or the destination address in full; the address is
 *   masked (first 2 chars + ***@domain) so the admin cockpit can see *that* a send
 *   happened without leaking buyer-style PII.
 * - Every email also gets the branded HTML version (lib/email/layout.ts) unless `htmlBody` is given.
 * - Failures don't throw; they return `{ sent:false, reason }` so the surrounding
 *   no-enumeration flows can still return their generic success response to the user.
 */

export interface SendEmailArgs {
  to: string;
  subject: string;
  textBody: string;
  /** Defaults to the branded HTML rendering of textBody. */
  htmlBody?: string;
  /** Where replies go (e.g. the support inbox). */
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

export function maskEmail(email: string): string {
  if (typeof email !== 'string' || !email.includes('@')) return '[masked]';
  const [local, domain] = email.split('@');
  if (!domain || !local) return '[masked]';
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!token || !from) {
    logAuthEvent('warn', {
      message: 'Email send skipped: NEEDS_SMTP_CONFIG',
      operation: 'email.config_missing',
      details: { to: maskEmail(args.to), subject: args.subject },
    });
    return { sent: false, reason: 'NEEDS_SMTP_CONFIG' };
  }

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: from,
        To: args.to,
        Subject: args.subject,
        TextBody: args.textBody,
        HtmlBody: args.htmlBody || renderEmailHtml({ text: args.textBody }),
        MessageStream: 'outbound',
        ...(args.replyTo ? { ReplyTo: args.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const errBody = (await res.text().catch(() => '')).slice(0, 200);
      logAuthEvent('error', {
        message: 'Postmark send failed',
        operation: 'email.postmark_failed',
        details: { status: res.status, to: maskEmail(args.to), reason: errBody },
      });
      return { sent: false, reason: `postmark_${res.status}` };
    }

    logAuthEvent('info', {
      message: 'Email sent',
      operation: 'email.sent',
      details: { to: maskEmail(args.to), subject: args.subject },
    });
    return { sent: true };
  } catch (err) {
    logAuthEvent('error', {
      message: 'Postmark send threw',
      operation: 'email.postmark_threw',
      details: { to: maskEmail(args.to) },
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { sent: false, reason: 'postmark_throw' };
  }
}

// Auth templates: Turkish first, English below (we don't know the locale before sign-in).

export interface EmailBody {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function verificationEmailBody(verifyUrl: string): EmailBody {
  const textBody =
`KolayXport hesabınızı etkinleştirmek için e-posta adresinizi doğrulayın:

${verifyUrl}

Bu bağlantı 24 saat geçerlidir. KolayXport'a siz kaydolmadıysanız bu e-postayı yok sayabilirsiniz.

---

Confirm your KolayXport email with the link above. It expires in 24 hours. If you didn't sign up, ignore this email.`;
  return {
    subject: 'KolayXport — e-posta adresinizi doğrulayın / confirm your email',
    textBody,
    htmlBody: renderEmailHtml({
      text: textBody,
      title: 'E-posta adresinizi doğrulayın',
      action: { url: verifyUrl, label: 'E-postamı doğrula' },
      preheader: 'Hesabınızı etkinleştirmek için tek tık kaldı.',
    }),
  };
}

export function passwordResetEmailBody(resetUrl: string): EmailBody {
  const textBody =
`KolayXport hesabınız için şifre sıfırlama istendi. Yeni şifrenizi belirlemek için:

${resetUrl}

Bu bağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmedi.

---

A password reset was requested for your KolayXport account. Use the link above to set a new password; it expires in 1 hour. If you didn't request this, ignore this email — your password is unchanged.`;
  return {
    subject: 'KolayXport — şifrenizi sıfırlayın / reset your password',
    textBody,
    htmlBody: renderEmailHtml({
      text: textBody,
      title: 'Şifrenizi sıfırlayın',
      action: { url: resetUrl, label: 'Yeni şifre belirle' },
      preheader: 'Bağlantı 1 saat geçerlidir.',
    }),
  };
}

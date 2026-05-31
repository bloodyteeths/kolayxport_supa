import { logAuthEvent } from '@/lib/admin/events';

/**
 * Outbound transactional email via Postmark HTTP API.
 *
 * - Uses POSTMARK_SERVER_TOKEN + POSTMARK_FROM_EMAIL.
 * - Never logs the request body or the destination address in full; the address is
 *   masked (first 2 chars + ***@domain) so the admin cockpit can see *that* a send
 *   happened without leaking buyer-style PII.
 * - Failures don't throw; they return `{ sent:false, reason }` so the surrounding
 *   no-enumeration flows can still return their generic success response to the user.
 */

export interface SendEmailArgs {
  to: string;
  subject: string;
  textBody: string;
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
        MessageStream: 'outbound',
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

// Templates kept inline + plaintext-only for now. HTML can come later.

export function verificationEmailBody(verifyUrl: string): { subject: string; textBody: string } {
  return {
    subject: 'KolayXport — confirm your email',
    textBody:
`Confirm your KolayXport email by opening the link below:

${verifyUrl}

This link expires in 24 hours. If you didn't sign up for KolayXport, ignore this email.

— KolayXport`,
  };
}

export function passwordResetEmailBody(resetUrl: string): { subject: string; textBody: string } {
  return {
    subject: 'KolayXport — reset your password',
    textBody:
`A password reset was requested for your KolayXport account. Open the link below to set a new password:

${resetUrl}

This link expires in 1 hour. If you didn't request this, ignore this email — your password is unchanged.

— KolayXport`,
  };
}

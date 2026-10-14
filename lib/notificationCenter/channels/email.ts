/**
 * Email channel via Postmark (lib/auth/email.ts sendEmail) — owner W5.
 * Subject/body come from render.ts in NotificationSettings.locale (bilingual
 * TR + EN when unknown). Never logs the address (sendEmail masks it).
 */
import { sendEmail } from '@/lib/auth/email';
import { renderDigestEmail, renderNotificationEmail } from '../render';
import type { ChannelRecipient, ChannelSendResult, NotificationChannel } from './types';

function hasAddress(r: ChannelRecipient): boolean {
  return typeof r.email === 'string' && r.email.includes('@');
}

async function deliver(to: string, subject: string, textBody: string): Promise<ChannelSendResult> {
  try {
    const res = await sendEmail({ to, subject, textBody });
    if (res.sent) return { ok: true };
    // Missing Postmark config will not fix itself between retries.
    const permanent = res.reason === 'NEEDS_SMTP_CONFIG' || res.reason === 'postmark_422';
    return { ok: false, permanent, error: res.reason || 'send_failed' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'send_threw' };
  }
}

export const emailChannel: NotificationChannel = {
  name: 'email',
  isConfigured: (r) => hasAddress(r) && r.settings.emailEnabled !== false,
  async send(r, n) {
    if (!hasAddress(r)) return { ok: false, permanent: true, error: 'no_email' };
    const { subject, textBody } = renderNotificationEmail(n, r.settings.locale);
    return deliver(r.email as string, subject, textBody);
  },
  async sendDigest(r, items, opts) {
    if (!hasAddress(r)) return { ok: false, permanent: true, error: 'no_email' };
    if (!items.length) return { ok: true };
    const { subject, textBody } = renderDigestEmail(items, r.settings.locale, opts);
    return deliver(r.email as string, subject, textBody);
  },
};

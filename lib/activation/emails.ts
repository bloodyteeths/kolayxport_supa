// lib/activation/emails.ts — onboarding reminders for signups who haven't connected a store yet.
//
//   day1  ≥ 24 h after signup  "your account is ready, connect your store" (link: Settings → Connections)
//   day4  ≥ 96 h after signup  "can we help?" (how-to page + destek@ address)
//
// Activation (turkey-gameplan §4.1) = a store connected within 7 days, so the window ends at 7 days and nothing goes
// out once any marketplace is connected or an order exists. Plain service information about the account the user
// just opened: no prices, plans or offers. Bilingual TR + EN in one email, like the verification email.
//
// Skipped: unverified emails, admins, reviewer accounts, Shopify-billed accounts (the Shopify app has its own
// onboarding), *.test addresses, and users who turned emails off (NotificationSettings.emailEnabled = false).
// ACTIVATION_EMAILS=on sends; anything else is a dry run that only logs who would get which step.
import prisma from '@/lib/prisma';
import { maskEmail, sendEmail, type EmailBody } from '@/lib/auth/email';
import { renderEmailHtml } from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { MARKETPLACE_PROVIDERS, getConnectionStatus } from '@/lib/integrations/connectionStatus';
import { reviewAccountEmails } from '@/lib/partners/acquisition';

export type ActivationStep = 'day1' | 'day4';

const HOUR = 3600_000;
const STEP_AFTER_HOURS: Record<ActivationStep, number> = { day1: 24, day4: 96 };
const WINDOW_HOURS = 7 * 24;
const MAX_PER_RUN = 50;
const SUPPORT = 'destek@kolayxport.com';

export function activationEmailsEnabled(): boolean {
  // Exactly 'on'. Unset, 'ON', 'true', '1' or anything else is a dry run that sends nothing.
  return process.env.ACTIVATION_EMAILS === 'on';
}

/** Pure: which step is due for a user, given signup time and the steps already sent. */
export function dueStep(createdAt: Date, sent: ReadonlySet<string>, now: Date): ActivationStep | null {
  const ageH = (now.getTime() - createdAt.getTime()) / HOUR;
  if (ageH >= WINDOW_HOURS) return null;
  if (ageH >= STEP_AFTER_HOURS.day4 && !sent.has('day4')) return 'day4';
  // A user first seen after 96 h gets only the day-4 mail, never both in one run.
  if (ageH >= STEP_AFTER_HOURS.day1 && ageH < STEP_AFTER_HOURS.day4 && !sent.has('day1')) return 'day1';
  return null;
}

/** Pure: accounts that never get these reminders. */
export function isSkippedAccount(u: { email: string | null; role: string | null; billingProvider: string | null; subscriptionPlan: string | null }): boolean {
  const email = (u.email || '').toLowerCase();
  return (
    !email ||
    email.endsWith('.test') ||
    u.role === 'admin' ||
    reviewAccountEmails().has(email) ||
    u.billingProvider === 'shopify' ||
    u.billingProvider === 'shopify_free' ||
    u.subscriptionPlan === 'shopify_free'
  );
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'https://kolayxport.com').replace(/\/$/, '');
}

export function activationEmailBody(step: ActivationStep, name?: string | null): EmailBody {
  const base = baseUrl();
  const connectUrl = `${base}/ayarlar?tab=connections`;
  const helpUrl = `${base}/app/nasil-kullanirim`;
  const prefsUrl = `${base}/app/bildirimler?tab=preferences`;
  const first = (name || '').trim().split(/\s+/)[0];
  const hello = first ? `Merhaba ${first},` : 'Merhaba,';
  const helloEn = first ? `Hi ${first},` : 'Hi,';
  const footer = `Bu e-postaları almak istemiyorsanız: ${prefsUrl}\nTo stop these emails: same link.`;

  if (step === 'day1') {
    const textBody =
`${hello}

KolayXport hesabınız hazır. Başlamak için tek adım kaldı: mağazanızı bağlayın. Etsy, eBay, Amazon, Shopify, Trendyol veya Wix; bağlantı yaklaşık 2 dakika sürer.

${connectUrl}

Bağladığınızda siparişleriniz tek ekranda toplanır; FedEx, UPS ve DHL eCommerce etiketlerini oradan oluşturursunuz.

Takıldığınız bir yer olursa ${SUPPORT} adresine yazın, yardımcı olalım.

---

${helloEn} Your KolayXport account is ready. One step left: connect your store (Etsy, eBay, Amazon, Shopify, Trendyol or Wix, about 2 minutes) with the link above. Your orders then show up in one place, and you create FedEx, UPS and DHL eCommerce labels from there. Stuck? Write to ${SUPPORT}.

${footer}`;
    return {
      subject: 'KolayXport — mağazanızı bağlayın / connect your store',
      textBody,
      htmlBody: renderEmailHtml({
        text: textBody,
        title: 'Mağazanızı bağlayın',
        action: { url: connectUrl, label: 'Mağazamı bağla' },
        preheader: 'Hesabınız hazır; tek adım kaldı.',
      }),
    };
  }

  const textBody =
`${hello}

Birkaç gün önce KolayXport'a kaydoldunuz ama henüz bir mağaza bağlamadınız. Bir şey mi takıldı?

Adım adım anlatım burada:

${helpUrl}

Mağazanızı bağlamak için: ${connectUrl}

Sorunuzu ${SUPPORT} adresine yazabilirsiniz; ekibimiz size dönüş yapar.

---

${helloEn} You signed up for KolayXport a few days ago but haven't connected a store yet. Did something get in the way? The step-by-step guide is at the link above, and you can connect your store here: ${connectUrl}. Write to ${SUPPORT} with any question and our team will get back to you.

${footer}`;
  return {
    subject: 'KolayXport — yardımcı olalım mı? / can we help?',
    textBody,
    htmlBody: renderEmailHtml({
      text: textBody,
      title: 'Yardımcı olalım mı?',
      action: { url: helpUrl, label: 'Adım adım anlatım' },
      preheader: 'Mağazanızı bağlamak için kısa rehber.',
    }),
  };
}

async function hasStore(userId: string): Promise<boolean> {
  const order = await prisma.order.findFirst({ where: { userId }, select: { id: true } });
  if (order) return true;
  const status = await getConnectionStatus(userId);
  return MARKETPLACE_PROVIDERS.some((p) => status.connections[p]?.connected);
}

export interface ActivationRunResult {
  dryRun: boolean;
  candidates: number;
  sent: number;
  wouldSend: number;
  skippedConnected: number;
  failed: number;
  /** True when the run sent nothing because it is outside Mon–Fri 09:00–17:30 Turkey time. */
  outsideWorkingHours?: boolean;
}

/**
 * Founder rule (2026-10-22): "Dont email people outside of working hours for marketing." Sends only Mon–Fri
 * 09:00–17:30 Turkey time (UTC+3 all year, no DST). The daily 09:15 Istanbul run is inside; a weekend run sends
 * nothing and Monday's run picks the users up (dueStep still finds them inside the 7-day window).
 */
export function inWorkingHours(now: Date): boolean {
  const tr = new Date(now.getTime() + 3 * 3600_000); // Europe/Istanbul is fixed UTC+3
  const day = tr.getUTCDay(); // 0 Sun … 6 Sat
  const minutes = tr.getUTCHours() * 60 + tr.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes < 17 * 60 + 30;
}

export async function runActivationEmails(now: Date = new Date()): Promise<ActivationRunResult> {
  const dryRun = !activationEmailsEnabled();
  if (!dryRun && !inWorkingHours(now)) {
    return { dryRun, candidates: 0, sent: 0, wouldSend: 0, skippedConnected: 0, failed: 0, outsideWorkingHours: true };
  }
  const users = await prisma.user.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - WINDOW_HOURS * HOUR), lte: new Date(now.getTime() - STEP_AFTER_HOURS.day1 * HOUR) },
      emailVerified: { not: null },
    },
    select: {
      id: true, email: true, name: true, role: true, createdAt: true, billingProvider: true, subscriptionPlan: true,
      notificationSettings: { select: { emailEnabled: true } },
      activationEmails: { select: { step: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });

  const out: ActivationRunResult = { dryRun, candidates: 0, sent: 0, wouldSend: 0, skippedConnected: 0, failed: 0 };
  for (const u of users) {
    if (out.sent + out.wouldSend >= MAX_PER_RUN) break;
    if (isSkippedAccount(u) || u.notificationSettings?.emailEnabled === false) continue;
    const step = dueStep(u.createdAt, new Set(u.activationEmails.map((e) => e.step)), now);
    if (!step) continue;
    out.candidates++;
    try {
      if (await hasStore(u.id)) {
        out.skippedConnected++;
        continue;
      }
      if (dryRun) {
        out.wouldSend++;
        logger.event('system', 'info', 'activation email (dry run)', { step, to: maskEmail(u.email!) }, { userId: u.id, operation: 'activation.email_dry_run' });
        continue;
      }
      // Claim the step first, so a crash or a parallel run can never send it twice.
      const claimed = await prisma.activationEmail.create({ data: { userId: u.id, step } }).then(() => true, () => false);
      if (!claimed) continue;
      const res = await sendEmail({ to: u.email!, ...activationEmailBody(step, u.name) });
      if (res.sent) {
        out.sent++;
        logger.event('system', 'info', 'activation email sent', { step, to: maskEmail(u.email!) }, { userId: u.id, operation: 'activation.email_sent' });
      } else {
        out.failed++;
        await prisma.activationEmail.deleteMany({ where: { userId: u.id, step } }); // retry on the next run
        logger.event('system', 'warn', 'activation email not sent', { step, reason: res.reason }, { userId: u.id, operation: 'activation.email_failed' });
      }
    } catch (e) {
      out.failed++;
      logger.event('system', 'warn', 'activation email error', { step, error: (e as Error).message?.slice(0, 200) }, { userId: u.id, operation: 'activation.email_failed' });
    }
  }
  return out;
}

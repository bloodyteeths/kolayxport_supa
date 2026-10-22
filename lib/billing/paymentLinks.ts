// lib/billing/paymentLinks.ts — KolayXport sales through Stripe Payment Links (1:1 sales, 2026-10-22).
// A payment link creates a NEW Stripe customer that no KolayXport user points at, so before the normal
// checkout.session.completed handling runs, linkPaymentLinkCustomer attaches that customer to the buyer's account:
//   - exact (case-insensitive) match of the email typed at checkout to a user with a VERIFIED email;
//   - only when that user has no Stripe customer yet (never overwrites another customer → alert, linked by hand).
// Then the existing webhook flow activates the plan exactly as for an in-app checkout.
// notifyPaymentLinkSale emails the sales alert (SALES_ALERT_EMAIL, default kolayxport@gmail.com) for every
// KolayXport payment-link sale: product, amount, buyer email, account match. Never throws into the webhook.
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { sendEmail } from '@/lib/auth/email';

export type LinkResult =
  | { status: 'not_payment_link' }
  | { status: 'already_linked'; userId: string }
  | { status: 'linked'; userId: string }
  | { status: 'conflict'; userId: string }
  | { status: 'no_match' };

/** Pure: may this user receive the payment link's customer? */
export function canLink(user: { emailVerified: Date | null; stripeCustomerId: string | null } | null, customerId: string): 'link' | 'already' | 'conflict' | 'no_match' {
  if (!user || !user.emailVerified) return 'no_match';
  if (user.stripeCustomerId === customerId) return 'already';
  if (user.stripeCustomerId) return 'conflict';
  return 'link';
}

export async function linkPaymentLinkCustomer(session: Stripe.Checkout.Session): Promise<LinkResult> {
  if (!session.payment_link) return { status: 'not_payment_link' };
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId) return { status: 'no_match' };
  const owner = await prisma.user.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } });
  if (owner) return { status: 'already_linked', userId: owner.id };
  const email = (session.customer_details?.email || '').trim().toLowerCase();
  if (!email) return { status: 'no_match' };
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, emailVerified: true, stripeCustomerId: true },
  });
  const decision = canLink(user, customerId);
  if (decision === 'no_match' || !user) return { status: 'no_match' };
  if (decision === 'already') return { status: 'already_linked', userId: user.id };
  if (decision === 'conflict') return { status: 'conflict', userId: user.id };
  // Guarded: only while still unset, so a parallel event can't overwrite a customer set meanwhile.
  const r = await prisma.user.updateMany({ where: { id: user.id, stripeCustomerId: null }, data: { stripeCustomerId: customerId } });
  return r.count === 1 ? { status: 'linked', userId: user.id } : { status: 'conflict', userId: user.id };
}

function money(minor: number | null | undefined, currency: string | null | undefined): string {
  const v = (minor ?? 0) / 100;
  return `${v.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${(currency || '').toUpperCase()}`;
}

/** Pure: alert text for a sale. */
export function saleAlertText(args: { products: string[]; amount: string; email: string | null; link: LinkResult; sessionId: string }): { subject: string; text: string } {
  const match =
    args.link.status === 'linked' || args.link.status === 'already_linked'
      ? 'KolayXport hesabıyla eşleşti; plan otomatik güncellenir.'
      : args.link.status === 'conflict'
        ? 'DİKKAT: bu e-postanın hesabında başka bir Stripe müşterisi var. Hesabı elle bağlayın.'
        : 'DİKKAT: bu e-postayla doğrulanmış KolayXport hesabı yok. Alıcıyla iletişime geçip hesabı elle bağlayın.';
  return {
    subject: `KolayXport satış: ${args.products.join(', ')} — ${args.amount}`,
    text: `Yeni ödeme (Stripe ödeme bağlantısı)

Ürün: ${args.products.join(', ')}
Tutar: ${args.amount}
Alıcı e-postası: ${args.email ?? '-'}
Hesap: ${match}
Stripe oturumu: ${args.sessionId}

Kurulum Hizmeti ise alıcıyla aynı gün iletişime geçin.`,
  };
}

export async function notifyPaymentLinkSale(session: Stripe.Checkout.Session, link: LinkResult): Promise<void> {
  try {
    if (!session.payment_link) return;
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 20, expand: ['data.price'] });
    const ours = items.data.filter((li) => (li.price?.lookup_key || '').startsWith('kx_v2_') || li.price?.metadata?.business === 'kolayxport');
    if (!ours.length) return; // another business on the same Stripe account
    const products = ours.map((li) => li.description || li.price?.lookup_key || 'ürün');
    const { subject, text } = saleAlertText({ products, amount: money(session.amount_total, session.currency), email: session.customer_details?.email ?? null, link, sessionId: session.id });
    const to = (process.env.SALES_ALERT_EMAIL || 'kolayxport@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);
    for (const addr of to) await sendEmail({ to: addr, subject, textBody: text });
    logger.event('billing', 'info', 'payment link sale', { products, link: link.status }, { operation: 'stripe.payment_link_sale', userId: 'userId' in link ? link.userId : undefined });
  } catch (e) {
    logger.warn('payment link sale alert failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

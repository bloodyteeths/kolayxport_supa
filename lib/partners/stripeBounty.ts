// lib/partners/stripeBounty.ts — Stripe → partner bounty adapter (docs/gtm/referral-spec.md §2.4, §3). Called from
// pages/api/stripe/webhook.ts inside its own try/catch. Basil API: invoice lines carry the price under
// pricing.price_details, taxes under total_taxes, and a charge reaches its invoice through InvoicePayments.
import type Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { planFromPriceId, priceIdOfLine } from '@/lib/billing/stripeAccountServer';
import { v2ItemFromPriceId } from '@/lib/billing/stripeV2';
import { partnerAllowedFor, recordAcquisition } from './acquisition';
import { onPaymentRefunded, onPaymentSucceeded, type RefundedResult, type SucceededResult } from './bounty';

/** KDV on a basil invoice (total_taxes), with pre-basil fallbacks; null when Stripe reports none. */
export function invoiceTaxMinor(invoice: Stripe.Invoice): number | null {
  const basil = (invoice as { total_taxes?: Array<{ amount?: number }> | null }).total_taxes;
  if (Array.isArray(basil) && basil.length) return basil.reduce((s, t) => s + (t.amount ?? 0), 0);
  const legacy = invoice as unknown as { total_tax_amounts?: Array<{ amount?: number }>; tax?: number | null };
  if (Array.isArray(legacy.total_tax_amounts) && legacy.total_tax_amounts.length) return legacy.total_tax_amounts.reduce((s, t) => s + (t.amount ?? 0), 0);
  if (typeof legacy.tax === 'number' && legacy.tax > 0) return legacy.tax;
  return null;
}

/** The plan line of an invoice (a KolayXport plan price). Modules, credit packs and unknown prices return null. */
export async function planOfInvoice(invoice: Stripe.Invoice): Promise<{ plan: string; interval: 'month' | 'year' } | null> {
  for (const line of invoice.lines?.data ?? []) {
    if ((line.amount ?? 0) <= 0) continue; // proration credits
    const priceId = priceIdOfLine(line);
    const hit = planFromPriceId(priceId);
    if (hit) return hit;
    try {
      const v2 = await v2ItemFromPriceId(priceId);
      if (v2?.kind === 'plan') return { plan: v2.key, interval: v2.interval };
    } catch {
      /* price lookup unavailable: treat as not a plan line */
    }
  }
  return null;
}

export async function bountyFromStripeInvoice(invoice: Stripe.Invoice, userId: string): Promise<SucceededResult | { status: 'skipped'; reason: string }> {
  if (!invoice.id || (invoice.amount_paid ?? 0) <= 0) return { status: 'skipped', reason: 'nothing paid' };
  const plan = await planOfInvoice(invoice);
  if (!plan) return { status: 'skipped', reason: 'not a plan payment' };
  const paidSec = invoice.status_transitions?.paid_at || invoice.created;
  return onPaymentSucceeded({
    userId,
    provider: 'stripe',
    objectId: invoice.id,
    paidAt: new Date(paidSec * 1000),
    currency: invoice.currency,
    grossMinor: invoice.amount_paid,
    taxMinor: invoiceTaxMinor(invoice),
    planKey: plan.plan,
    interval: plan.interval,
  });
}

async function invoiceIdOfCharge(charge: Stripe.Charge): Promise<string | null> {
  const legacy = (charge as unknown as { invoice?: string | { id: string } | null }).invoice;
  if (typeof legacy === 'string') return legacy;
  if (legacy && typeof legacy === 'object') return legacy.id;
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return null;
  const list = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: pi }, limit: 1 });
  const inv = list.data[0]?.invoice;
  return typeof inv === 'string' ? inv : inv?.id ?? null;
}

export async function bountyFromStripeRefund(charge: Stripe.Charge): Promise<RefundedResult | { status: 'skipped'; reason: string }> {
  const invoiceId = await invoiceIdOfCharge(charge);
  if (!invoiceId) return { status: 'skipped', reason: 'charge has no invoice' };
  return onPaymentRefunded({ provider: 'stripe', objectId: invoiceId, refundedMinor: charge.amount_refunded ?? 0, totalMinor: charge.amount ?? 0 });
}

/** Attach a promo-code partner to a customer that no link attributed (first touch wins). */
async function attributePromoIds(promoIds: string[], userId: string): Promise<'attributed' | 'kept' | 'none'> {
  if (!promoIds.length) return 'none';
  const partner = await prisma.partner.findFirst({ where: { stripePromotionCode: { in: promoIds }, status: 'active' }, select: { id: true, code: true } });
  if (!partner) return 'none';
  const existing = await prisma.userAcquisition.findUnique({ where: { userId }, select: { partnerId: true, refCode: true } });
  if (!existing) {
    const r = await recordAcquisition(userId, { body: { ref: partner.code }, via: 'promo' });
    return r.status === 'created' && r.partnerId ? 'attributed' : 'none';
  }
  if (existing.partnerId) return 'kept';
  // Row exists without a partner (organic, or an excluded code): fill it only when the customer is eligible.
  if (!(await partnerAllowedFor(userId, partner.id))) return 'none';
  await prisma.userAcquisition.update({ where: { userId }, data: { partnerId: partner.id, refCode: existing.refCode ?? partner.code } });
  return 'attributed';
}

const promoIdOf = (pc: unknown): string | undefined =>
  typeof pc === 'string' ? pc : pc && typeof pc === 'object' && typeof (pc as { id?: unknown }).id === 'string' ? (pc as { id: string }).id : undefined;

/**
 * §2.4 at checkout (checkout.session.completed). The live KolayXport webhook endpoint is not subscribed to that event
 * today, so attributePromoInvoice below is what actually runs; this stays for when it is.
 */
export async function attributePromoCheckout(session: Stripe.Checkout.Session, userId: string): Promise<'attributed' | 'kept' | 'none'> {
  let promoIds = (session.discounts ?? []).map((d) => promoIdOf(d.promotion_code)).filter((v): v is string => !!v);
  if (!promoIds.length && (session.total_details?.amount_discount ?? 0) > 0) {
    const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['total_details.breakdown.discounts.discount.promotion_code'] });
    promoIds = (full.total_details?.breakdown?.discounts ?? [])
      .map((d) => promoIdOf((d.discount as unknown as { promotion_code?: unknown }).promotion_code))
      .filter((v): v is string => !!v);
  }
  return attributePromoIds(promoIds, userId);
}

/** §2.4 from the paid invoice (invoice.payment_succeeded): runs before the bounty so a promo customer earns it. */
export async function attributePromoInvoice(invoice: Stripe.Invoice, userId: string): Promise<'attributed' | 'kept' | 'none'> {
  const raw = invoice.discounts ?? [];
  if (!raw.length) return 'none';
  let discounts = raw;
  if (raw.some((d) => typeof d === 'string') && invoice.id) {
    const full = await stripe.invoices.retrieve(invoice.id, { expand: ['discounts'] });
    discounts = full.discounts ?? [];
  }
  const promoIds = discounts
    .map((d) => (typeof d === 'object' && d && 'promotion_code' in d ? promoIdOf((d as { promotion_code?: unknown }).promotion_code) : undefined))
    .filter((v): v is string => !!v);
  return attributePromoIds(promoIds, userId);
}

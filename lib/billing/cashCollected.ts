// lib/billing/cashCollected.ts — KolayXport cash collected on the shared Stripe account (Tamsar, Inc. also bills
// other businesses there, so every charge must be proven KolayXport's):
//   - the charge's customer is a KolayXport user's stripeCustomerId, or
//   - the charge (payment intent) carries metadata business=kolayxport (payment links set it), or
//   - the charge pays an invoice whose subscription carries metadata business=kolayxport.
// Collected = succeeded charges minus refunded amounts, per currency (minor units). Read-only.
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import prisma from '@/lib/prisma';

export type Money = Record<string, number>;

/** Pure: net collected per currency from charges already proven KolayXport's. */
export function netCollected(charges: Array<Pick<Stripe.Charge, 'paid' | 'status' | 'amount' | 'amount_refunded' | 'currency'>>): Money {
  const out: Money = {};
  for (const c of charges) {
    if (!c.paid || c.status !== 'succeeded') continue;
    const cur = c.currency.toLowerCase();
    out[cur] = (out[cur] ?? 0) + c.amount - (c.amount_refunded ?? 0);
  }
  return out;
}

async function isKolayxportCharge(c: Stripe.Charge, customers: Set<string>): Promise<boolean> {
  const cust = typeof c.customer === 'string' ? c.customer : c.customer?.id;
  if (cust && customers.has(cust)) return true;
  if (c.metadata?.business === 'kolayxport') return true;
  const pi = c.payment_intent && typeof c.payment_intent !== 'string' ? c.payment_intent : null;
  if (pi?.metadata?.business === 'kolayxport') return true;
  // Subscription from a payment link whose buyer isn't linked to a user yet.
  if (cust) {
    const subs = await stripe.subscriptions.list({ customer: cust, status: 'all', limit: 5 });
    if (subs.data.some((s) => s.metadata?.business === 'kolayxport')) return true;
  }
  return false;
}

export async function cashCollected(from: Date, to: Date): Promise<{ net: Money; charges: number }> {
  const users = await prisma.user.findMany({ where: { stripeCustomerId: { not: null } }, select: { stripeCustomerId: true } });
  const customers = new Set(users.map((u) => u.stripeCustomerId!));
  const ours: Stripe.Charge[] = [];
  for await (const c of stripe.charges.list({ created: { gte: Math.floor(from.getTime() / 1000), lt: Math.floor(to.getTime() / 1000) }, limit: 100, expand: ['data.payment_intent'] })) {
    if (await isKolayxportCharge(c, customers)) ours.push(c);
  }
  return { net: netCollected(ours), charges: ours.length };
}

export function formatMoney(m: Money): string {
  const parts = Object.entries(m).filter(([, v]) => v);
  return parts.length ? parts.map(([c, v]) => `${(v / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ${c.toUpperCase()}`).join(' + ') : '0';
}

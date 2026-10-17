// lib/billing/aiCreditsPurchase.ts — buying AI kredisi packs (SERVER ONLY).
//  - Stripe (every non-Shopify account): one-time Checkout (mode 'payment', inline price, invoice). Credits are
//    added by the webhook (checkout.session.completed) and, so the seller sees them at once, by the return page
//    calling /api/ai/credits/confirm. Both go through grantPack(ref = session id): added exactly once.
//  - Shopify billing (Shopify-billed accounts, App Store rule 1.2.1): appPurchaseOneTimeCreate in USD on the
//    seller's shop; Shopify redirects back with charge_id, the purchase is read back from Shopify and must be ACTIVE.
import type Stripe from 'stripe';
import prisma from '@/lib/prisma';
import { stripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { getValidAccessToken } from '@/lib/integrations/shopifyClient';
import { CREDIT_PACKS, creditPack, type CreditPack } from './aiCredits';
import { grantPack } from './aiCreditsServer';
import { appBaseUrl } from './stripeAccountServer';
import type { Currency } from './types';

const SHOPIFY_API_VERSION = '2024-10';

/** A same-site path to come back to (never an absolute URL: no open redirect). */
export function safeReturnPath(v: unknown, fallback = '/app/video-studio'): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/(?!\/)[\w\-./?=&%#:]*$/.test(s) ? s : fallback;
}

function withQuery(path: string, q: string): string {
  const [base, hash] = path.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}${q}${hash ? `#${hash}` : ''}`;
}

async function ensureStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, stripeCustomerId: true } });
  if (!user) throw new Error('user not found');
  if (user.stripeCustomerId) {
    try {
      const c = await stripe.customers.retrieve(user.stripeCustomerId);
      if (!(c as Stripe.DeletedCustomer).deleted) return user.stripeCustomerId;
    } catch { /* other Stripe mode: create a new one */ }
  }
  const customer = await stripe.customers.create({ email: user.email ?? undefined, name: user.name ?? undefined, metadata: { userId: user.id } });
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export async function stripeCreditCheckout(userId: string, pack: CreditPack, currency: Currency, returnPath: string, origin: string | undefined, locale: string): Promise<string> {
  const customer = await ensureStripeCustomer(userId);
  const base = appBaseUrl(origin);
  const amount = pack.price[currency];
  const name = locale === 'tr' ? `KolayXport AI kredisi — ${pack.credits.toLocaleString('tr-TR')}` : `KolayXport AI credits — ${pack.credits.toLocaleString('en-US')}`;
  const metadata = { kind: 'ai_credits', userId, packId: pack.id, credits: String(pack.credits) };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: Math.round(amount * 100),
        product_data: { name, description: locale === 'tr' ? 'AI görsel ve video üretimi. Süresi dolmaz.' : 'AI image and video generation. Never expires.' },
      },
    }],
    metadata,
    payment_intent_data: { metadata },
    invoice_creation: { enabled: true, invoice_data: { metadata } },
    allow_promotion_codes: true,
    locale: locale === 'tr' ? 'tr' : 'en',
    success_url: `${base}${withQuery(returnPath, 'credits=success&session_id={CHECKOUT_SESSION_ID}')}`,
    cancel_url: `${base}${withQuery(returnPath, 'credits=cancel')}`,
  });
  if (!session.url) throw new Error('Stripe returned no checkout url');
  return session.url;
}

/** Adds the credits of a paid credit-pack Checkout session (webhook + return page). Owner-checked. */
export async function fulfilStripeCreditSession(session: Stripe.Checkout.Session, expectUserId?: string): Promise<{ ok: boolean; credits: number; added: boolean }> {
  const md = session.metadata ?? {};
  if (session.mode !== 'payment' || md.kind !== 'ai_credits') return { ok: false, credits: 0, added: false };
  if (expectUserId && md.userId !== expectUserId) return { ok: false, credits: 0, added: false };
  if (session.payment_status !== 'paid') return { ok: false, credits: 0, added: false };
  const pack = creditPack(md.packId);
  const credits = pack?.credits ?? 0;
  const userId = String(md.userId || '');
  if (!pack || !userId) return { ok: false, credits: 0, added: false };
  // The customer on the session must be this user's Stripe customer (a misrouted event never credits anyone).
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
  if (!user || (session.customer && user.stripeCustomerId && user.stripeCustomerId !== session.customer)) {
    logger.warn('AI credits: checkout customer mismatch', { sessionId: session.id });
    return { ok: false, credits: 0, added: false };
  }
  const added = await grantPack(userId, credits, session.id, { feature: pack.id, note: `stripe ${session.currency?.toUpperCase()} ${(session.amount_total ?? 0) / 100}` });
  return { ok: true, credits, added };
}

// ── Shopify billing ──────────────────────────────────────────────────────────────────────────────

async function shopifyGraphql(shopDomain: string, token: string, query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || j?.errors) throw new Error(`Shopify GraphQL ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  return j.data;
}

const purchaseName = (pack: CreditPack) => `KolayXport AI credits ${pack.credits} (${pack.id})`;

export async function shopifyCreditCheckout(userId: string, pack: CreditPack, returnPath: string, origin: string | undefined): Promise<string> {
  const shop = await prisma.shopifyShop.findFirst({ where: { userId, isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!shop) throw new Error('no active Shopify shop');
  const token = await getValidAccessToken(shop.id);
  // Development stores (and the App Store reviewer's store) can only take test charges.
  const info = await shopifyGraphql(shop.shopDomain, token, '{ shop { plan { partnerDevelopment } } }').catch(() => null);
  const test = process.env.SHOPIFY_BILLING_TEST === '1' || Boolean(info?.shop?.plan?.partnerDevelopment);
  const returnUrl = `${appBaseUrl(origin)}/api/ai/credits/shopify-return?${new URLSearchParams({ shop: shop.id, back: returnPath })}`;
  const data = await shopifyGraphql(shop.shopDomain, token, `
    mutation($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean) {
      appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
        confirmationUrl
        userErrors { field message }
      }
    }`, { name: purchaseName(pack), price: { amount: pack.price.USD, currencyCode: 'USD' }, returnUrl, test });
  const out = data?.appPurchaseOneTimeCreate;
  if (!out?.confirmationUrl) throw new Error(`Shopify purchase refused: ${JSON.stringify(out?.userErrors ?? null).slice(0, 300)}`);
  return String(out.confirmationUrl);
}

/** After Shopify's approval page: reads the purchase back and adds its credits once (owner = the shop's user). */
export async function fulfilShopifyPurchase(userId: string, shopId: string, chargeId: string): Promise<{ ok: boolean; credits: number; added: boolean }> {
  const shop = await prisma.shopifyShop.findFirst({ where: { id: shopId, userId } });
  if (!shop || !/^\d+$/.test(chargeId)) return { ok: false, credits: 0, added: false };
  const token = await getValidAccessToken(shop.id);
  const data = await shopifyGraphql(shop.shopDomain, token, `
    query($id: ID!) { node(id: $id) { ... on AppPurchaseOneTime { id name status test price { amount currencyCode } } } }`,
  { id: `gid://shopify/AppPurchaseOneTime/${chargeId}` });
  const p = data?.node;
  if (!p || p.status !== 'ACTIVE') return { ok: false, credits: 0, added: false };
  // The pack comes from Shopify's own record of the purchase (name + price), never from the return URL.
  const pack = CREDIT_PACKS.find((x) => purchaseName(x) === p.name && Number(p.price?.amount) === x.price.USD);
  if (!pack) return { ok: false, credits: 0, added: false };
  const added = await grantPack(userId, pack.credits, `shopify:${p.id}`, { feature: pack.id, note: `shopify USD ${p.price?.amount}${p.test ? ' test' : ''}` });
  return { ok: true, credits: pack.credits, added };
}

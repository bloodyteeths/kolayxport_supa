// lib/partners/stripeGlobalPayouts.ts — Stripe Global Payouts (v2 API) for partner bounties, sent from Tamsar, Inc.'s
// US Stripe account (docs/gtm/referral-spec.md §4.3). Recipients are v2 Accounts with the recipient configuration;
// partners enter their own bank details on a Stripe-hosted Account Link, so no IBAN ever reaches us.
//
// Env (all required to enable; otherwise the payout run falls back to a CSV + manual "mark paid"):
//  - STRIPE_PAYOUTS_KEY: a RESTRICTED live key (rk_live_...) of the Tamsar, Inc. account. Stripe rejects full-access
//    sk_live keys on these APIs. Permissions: Recipient Configuration write, Money Management Financial Accounts read,
//    Payout Methods write, Outbound Payments write.
//  - STRIPE_PAYOUTS_FINANCIAL_ACCOUNT: the fa_... financial account to pay from.
//  - STRIPE_PAYOUTS_VERSION (optional): Stripe-Version header, default below.
// Cross-border payouts (US sender → Turkish recipient in TRY) may need Stripe's early-access approval.

const API = 'https://api.stripe.com';
const DEFAULT_VERSION = '2026-09-30.preview';

export function stripePayoutsConfigured(): boolean {
  return Boolean(process.env.STRIPE_PAYOUTS_KEY && process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT);
}

export class StripePayoutsError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const key = process.env.STRIPE_PAYOUTS_KEY;
  if (!key) throw new StripePayoutsError('STRIPE_PAYOUTS_KEY is not set', 0);
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': process.env.STRIPE_PAYOUTS_VERSION || DEFAULT_VERSION,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
  if (!r.ok) throw new StripePayoutsError(json.error?.message || `Stripe ${r.status}`, r.status, json.error?.code);
  return json;
}

/** Creates the partner's recipient Account (Turkey; local bank + wire capabilities). Returns its id. */
export async function createRecipient(p: { email: string; name: string; entityType?: 'individual' | 'company'; partnerId: string }): Promise<string> {
  const acct = await call<{ id: string }>('POST', '/v2/core/accounts', {
    contact_email: p.email,
    display_name: p.name.slice(0, 100),
    identity: { country: 'tr', entity_type: p.entityType ?? 'individual' },
    configuration: { recipient: { capabilities: { bank_accounts: { local: { requested: true }, wire: { requested: true } } } } },
    metadata: { kolayxport_partner_id: p.partnerId },
    include: ['configuration.recipient', 'requirements'],
  }, { 'Idempotency-Key': `kx-partner-recipient-${p.partnerId}` });
  return acct.id;
}

/** Single-use (10 min) Stripe-hosted form where the partner enters / updates bank details and tax form. */
export async function onboardingLink(recipientId: string, kind: 'account_onboarding' | 'account_update', returnUrl: string, refreshUrl: string): Promise<string> {
  const link = await call<{ url: string }>('POST', '/v2/core/account_links', {
    account: recipientId,
    use_case: { type: kind, [kind]: { return_url: returnUrl, refresh_url: refreshUrl } },
  });
  return link.url;
}

type Capability = { status?: string } | null | undefined;

/** Ready when a bank capability is active and Stripe needs nothing more. */
export async function recipientReady(recipientId: string): Promise<boolean> {
  const acct = await call<{
    configuration?: { recipient?: { capabilities?: { bank_accounts?: { local?: Capability; wire?: Capability } } } };
  }>('GET', `/v2/core/accounts/${encodeURIComponent(recipientId)}?include[0]=configuration.recipient`);
  const bank = acct.configuration?.recipient?.capabilities?.bank_accounts;
  return bank?.local?.status === 'active' || bank?.wire?.status === 'active';
}

/** Sends one outbound payment. The idempotency key (our PartnerPayout id) makes a retried request safe. */
export async function sendOutboundPayment(p: { recipientId: string; amountMinor: number; currency: string; payoutId: string; description: string }): Promise<{ id: string; status: string }> {
  if (!(p.amountMinor > 0)) throw new StripePayoutsError('Payout amount must be positive', 0);
  const out = await call<{ id: string; status: string }>('POST', '/v2/money_management/outbound_payments', {
    from: { financial_account: process.env.STRIPE_PAYOUTS_FINANCIAL_ACCOUNT, currency: p.currency.toLowerCase() },
    to: { recipient: p.recipientId },
    amount: { value: p.amountMinor, currency: p.currency.toLowerCase() },
    description: p.description.slice(0, 200),
    metadata: { kolayxport_payout_id: p.payoutId },
  }, { 'Idempotency-Key': `kx-partner-payout-${p.payoutId}` });
  return { id: out.id, status: out.status };
}

// lib/partners/payouts.ts — monthly partner payout run (docs/gtm/referral-spec.md §4.1, §4.3).
// Dry run by default: lists what each partner would get, writes nothing, calls nothing. With confirm:
//  - Stripe Global Payouts configured: one outbound payment per partner and currency; on success the included rows
//    are `paid`, on failure they stay `payable` and the payout row keeps the error.
//  - Not configured: payout rows are created as `manual` and a CSV is returned; an admin marks them paid with the
//    bank reference (markManualPayoutPaid).
// Reversals (negative rows) net against the same partner + currency; a non-positive sum is carried, never sent.
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { promoteDueBounties } from './bounty';
import { recipientReady, sendOutboundPayment, stripePayoutsConfigured } from './stripeGlobalPayouts';

export type PayoutProvider = 'stripe_global' | 'manual';

export interface PayoutLine {
  partnerId: string;
  code: string;
  name: string;
  currency: string;
  amountMinor: number;
  rowIds: string[];
  /** missing_bank_details | non_positive | null when it will be paid */
  skip: 'missing_bank_details' | 'non_positive' | null;
}

export interface PayoutRunResult {
  dryRun: boolean;
  provider: PayoutProvider;
  period: string;
  lines: PayoutLine[];
  results?: Array<{ partnerId: string; currency: string; payoutId: string; status: string; error?: string }>;
  csv?: string;
}

type DueRow = { id: string; partnerId: string; currency: string; commissionMinor: number };

/** Pure grouping (unit-tested): partner + currency → summed lines. */
export function groupPayable(rows: DueRow[], partners: Map<string, { code: string; name: string; ready: boolean }>, needsRecipient: boolean): PayoutLine[] {
  const by = new Map<string, PayoutLine>();
  for (const r of rows) {
    const p = partners.get(r.partnerId);
    if (!p) continue;
    const key = `${r.partnerId}|${r.currency}`;
    const line = by.get(key) ?? { partnerId: r.partnerId, code: p.code, name: p.name, currency: r.currency, amountMinor: 0, rowIds: [], skip: null };
    line.amountMinor += r.commissionMinor;
    line.rowIds.push(r.id);
    by.set(key, line);
  }
  for (const line of by.values()) {
    if (line.amountMinor <= 0) line.skip = 'non_positive';
    else if (needsRecipient && !partners.get(line.partnerId)!.ready) line.skip = 'missing_bank_details';
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code) || a.currency.localeCompare(b.currency));
}

export function payoutCsv(lines: PayoutLine[], period: string): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [
    'period,code,name,currency,amount,bounties,status',
    ...lines.map((l) => [period, l.code, l.name, l.currency.toUpperCase(), (l.amountMinor / 100).toFixed(2), l.rowIds.length, l.skip ?? 'to_pay'].map(esc).join(',')),
  ].join('\n') + '\n';
}

export async function runPayouts(opts: { period?: string | null; confirm?: boolean; now?: Date }): Promise<PayoutRunResult> {
  const now = opts.now ?? new Date();
  const period = opts.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.period) ? opts.period : now.toISOString().slice(0, 7);
  const provider: PayoutProvider = stripePayoutsConfigured() ? 'stripe_global' : 'manual';
  const dryRun = !opts.confirm;

  // Dry run must not write: treat pending rows past their hold as payable without promoting them.
  if (!dryRun) await promoteDueBounties(now);
  const rows = await prisma.partnerCommission.findMany({
    where: {
      payoutId: null,
      OR: [{ status: 'payable' }, { status: 'pending', payableAt: { lte: now } }],
    },
    select: { id: true, partnerId: true, currency: true, commissionMinor: true },
  });
  const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
  const partnerRows = await prisma.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, code: true, name: true, stripeRecipientId: true } });
  const partners = new Map<string, { code: string; name: string; ready: boolean; recipientId: string | null }>();
  for (const p of partnerRows) {
    let ready = false;
    if (provider === 'stripe_global' && p.stripeRecipientId) {
      try {
        ready = await recipientReady(p.stripeRecipientId);
      } catch (e) {
        logger.warn('Partner recipient check failed', { partnerId: p.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    partners.set(p.id, { code: p.code, name: p.name, ready, recipientId: p.stripeRecipientId });
  }
  const lines = groupPayable(rows, partners, provider === 'stripe_global');
  if (dryRun) return { dryRun, provider, period, lines, csv: payoutCsv(lines, period) };

  const results: NonNullable<PayoutRunResult['results']> = [];
  for (const line of lines) {
    if (line.skip) continue;
    const payout = await prisma.partnerPayout.create({
      data: { partnerId: line.partnerId, period, amountMinor: line.amountMinor, currency: line.currency, provider, status: 'created' },
    });
    if (provider === 'manual') {
      await prisma.partnerCommission.updateMany({ where: { id: { in: line.rowIds }, payoutId: null }, data: { payoutId: payout.id } });
      results.push({ partnerId: line.partnerId, currency: line.currency, payoutId: payout.id, status: 'created' });
      continue;
    }
    try {
      const sent = await sendOutboundPayment({
        recipientId: partners.get(line.partnerId)!.recipientId!,
        amountMinor: line.amountMinor,
        currency: line.currency,
        payoutId: payout.id,
        description: `KolayXport partner ${line.code} ${period}`,
      });
      await prisma.$transaction([
        prisma.partnerPayout.update({ where: { id: payout.id }, data: { externalId: sent.id, status: 'sent', paidAt: now } }),
        prisma.partnerCommission.updateMany({ where: { id: { in: line.rowIds } }, data: { status: 'paid', payoutId: payout.id } }),
      ]);
      results.push({ partnerId: line.partnerId, currency: line.currency, payoutId: payout.id, status: 'sent' });
    } catch (e) {
      const error = e instanceof Error ? e.message.slice(0, 500) : String(e);
      await prisma.partnerPayout.update({ where: { id: payout.id }, data: { status: 'failed', error } });
      logger.warn('Partner payout failed', { partnerId: line.partnerId, payoutId: payout.id, error });
      results.push({ partnerId: line.partnerId, currency: line.currency, payoutId: payout.id, status: 'failed', error });
    }
  }
  return { dryRun, provider, period, lines, results, csv: payoutCsv(lines, period) };
}

/** Manual (bank transfer) payout: the admin enters the bank reference; the payout and its rows become paid. */
export async function markManualPayoutPaid(payoutId: string, reference: string, now = new Date()): Promise<'paid' | 'not_found' | 'not_manual'> {
  const payout = await prisma.partnerPayout.findUnique({ where: { id: payoutId }, select: { id: true, provider: true, status: true } });
  if (!payout) return 'not_found';
  if (payout.provider !== 'manual' || payout.status === 'paid') return 'not_manual';
  await prisma.$transaction([
    prisma.partnerPayout.update({ where: { id: payoutId }, data: { status: 'paid', paidAt: now, reference: reference.slice(0, 200), externalId: reference.slice(0, 200) } }),
    prisma.partnerCommission.updateMany({ where: { payoutId }, data: { status: 'paid' } }),
  ]);
  return 'paid';
}

/**
 * GET /api/stripe/billing-history?limit=5..100&starting_after=<invoiceId>
 *
 * Settings › Plan & billing invoices (settings-billing-pricing §2.3 A1, §9.6).
 *   200 { invoices: InvoiceDto[], hasMore: boolean, nextCursor: string | null }
 *       (InvoiceDto: lib/billing/stripeAccountServer.ts). Every status except Stripe `draft` is listed, so a
 *       past-due user sees the open invoice. `nextCursor` is the last Stripe id *scanned* (drafts included),
 *       so the next page never re-reads skipped drafts and a draft-only run still pages forward.
 *       No Stripe customer yet → { invoices: [], hasMore: false, nextCursor: null }.
 *
 *   Legacy caller (flag-off /faturalar → FaturalarLegacy, sends neither `limit` nor `starting_after`): the
 *   pre-A1 contract is kept — `paid` invoices only (its status chip only translates `paid`), up to 20, and
 *   a human `error` string on 500 (it renders `error` verbatim) with the machine `code` beside it.
 *   400 { error: 'invalid_cursor' }   `starting_after` is not a Stripe invoice id (`in_…`)
 *   401 { error: 'Not authenticated' }
 *   403 { error: 'shopify_free' }     free Shopify tier: no Stripe surface (App Store rule 1.2.1)
 *   405 { error: 'Method not allowed' }
 *   500 { error: 'billing_history_failed' }   never raw Stripe text
 *       legacy caller: { error: 'Failed to fetch billing history', code: 'billing_history_failed' }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { stripe } from '@/lib/stripe';
import {
  formatInvoice,
  LISTED_INVOICE_STATUSES,
  loadStripeAccount,
  parseInvoiceCursor,
  parseInvoiceLimit,
  type InvoiceDto,
} from '@/lib/billing/stripeAccountServer';

/** Extra Stripe pages fetched when drafts thin out a page (bounded). */
const MAX_FETCHES = 3;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authUser = await getAuthUser(req, res);
  if (!authUser) return res.status(401).json({ error: 'Not authenticated' });
  res.setHeader('Cache-Control', 'private, no-store');

  const legacy = req.query.limit === undefined && req.query.starting_after === undefined;
  const limit = parseInvoiceLimit(req.query.limit);
  const parsedCursor = parseInvoiceCursor(req.query.starting_after);
  if (parsedCursor === false) return res.status(400).json({ error: 'invalid_cursor' });
  let cursor = parsedCursor;

  try {
    const account = await loadStripeAccount(authUser.id);
    if (account?.shopifyFree) return res.status(403).json({ error: 'shopify_free' });
    if (!account?.customerId) return res.status(200).json({ invoices: [], hasMore: false, nextCursor: null });

    if (legacy) {
      const page = await stripe.invoices.list({ customer: account.customerId, limit, status: 'paid' });
      return res.status(200).json({ invoices: page.data.map(formatInvoice), hasMore: page.has_more, nextCursor: null });
    }

    const invoices: InvoiceDto[] = [];
    let hasMore = false;
    for (let i = 0; i < MAX_FETCHES && invoices.length < limit; i++) {
      const page = await stripe.invoices.list({
        customer: account.customerId,
        limit: limit - invoices.length,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      for (const inv of page.data) {
        if (inv.status && LISTED_INVOICE_STATUSES.has(inv.status)) invoices.push(formatInvoice(inv));
      }
      hasMore = page.has_more;
      const last = page.data[page.data.length - 1];
      if (last?.id) cursor = last.id;
      if (!hasMore || !last?.id) break;
    }
    if (hasMore && !cursor) hasMore = false; // nothing to page from

    return res.status(200).json({ invoices, hasMore, nextCursor: hasMore ? cursor ?? null : null });
  } catch (error) {
    console.error('[billing-history] failed:', error instanceof Error ? error.message : String(error));
    if (legacy) return res.status(500).json({ error: 'Failed to fetch billing history', code: 'billing_history_failed' });
    return res.status(500).json({ error: 'billing_history_failed' });
  }
}

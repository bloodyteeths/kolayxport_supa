import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { runCronGuard } from '@/lib/cron/idempotency';
import { EtsyClient } from '@/lib/integrations/etsyClient';
import { decryptIfNeeded } from '@/lib/crypto/credentials';

// Read-only reconciliation of the Etsy dashboard against the real Etsy API.
// Runs in-process so DEK-encrypted tokens decrypt. No writes.
//   curl -X POST 'http://localhost:3000/api/admin/verify-etsy-finance?start=2026-07-31&end=2026-08-24' -H 'Authorization: Bearer $CRON_SECRET'
const money = (m: any) => (m && typeof m.amount === 'number' ? m.amount / m.divisor : 0);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await runCronGuard(req, res, { jobName: 'verify-etsy-finance', intervalMinutes: 1 });
  if (!guard.ok) return;

  const startStr = String(req.query.start);
  const endStr = String(req.query.end);
  const startMs = new Date(`${startStr}T00:00:00Z`).getTime();
  const endMs = new Date(`${endStr}T23:59:59Z`).getTime();
  const minCreated = Math.floor(startMs / 1000);
  const maxCreated = Math.floor(endMs / 1000);

  const shop = await prisma.etsyShop.findFirst({ where: { isActive: true, isDefault: true } })
    || await prisma.etsyShop.findFirst({ where: { isActive: true } });
  if (!shop?.accessToken) return res.status(400).json({ error: 'no active etsy shop' });

  const client = new EtsyClient({
    accessToken: decryptIfNeeded(shop.accessToken) as string,
    refreshToken: (decryptIfNeeded(shop.refreshToken) as string | null) || undefined,
    shopId: shop.shopId,
    tokenExpiresAt: shop.tokenExpiresAt || undefined,
  }, async () => {});

  const receipts: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const d = await client.getReceipts({ min_created: minCreated, max_created: maxCreated, limit: 100, offset });
    const r = d.results || []; receipts.push(...r); if (r.length < 100) break;
  }
  let grandtotal = 0, subtotal = 0, shipping = 0, tax = 0, discount = 0, saleCount = 0, refundedReceiptCount = 0, refundedGrand = 0;
  for (const r of receipts) {
    const g = money(r.grandtotal), status = (r.status || '').toLowerCase();
    if (status === 'refunded' || status === 'returned') { refundedReceiptCount++; refundedGrand += g; }
    else { saleCount++; grandtotal += g; subtotal += money(r.subtotal); shipping += money(r.total_shipping_cost); tax += money(r.total_tax_cost); discount += money(r.discount_amt); }
  }

  // NOTE: getShopPayments (GET /shops/{id}/payments) requires payment_ids and
  // 400s without them — the finance sync's fee fetch has been silently failing.
  // Capture the error rather than crash the audit.
  let paymentsError: string | null = null;
  const payments: any[] = [];
  try {
    for (let offset = 0; ; offset += 100) {
      const d = await client.getShopPayments({ min_created: minCreated, max_created: maxCreated, limit: 100, offset });
      const r = d.results || []; payments.push(...r); if (r.length < 100) break;
    }
  } catch (err: any) { paymentsError = err?.message?.slice(0, 200) || 'failed'; }
  let payGross = 0, payFees = 0, payNet = 0;
  for (const p of payments) { payGross += money(p.amount_gross); payFees += money(p.amount_fees); payNet += money(p.amount_net); }

  const ledger: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const d = await client.getLedgerEntries({ min_created: minCreated, max_created: maxCreated, limit: 100, offset });
    const r = d.results || []; ledger.push(...r); if (r.length < 100) break;
  }
  const byType: Record<string, { n: number; amt: number }> = {};
  let ledgerNet = 0;
  for (const e of ledger) {
    const t = e.ledger_type || 'unknown';
    const amt = typeof e.amount === 'object' ? money(e.amount) : (Number(e.amount) || 0) / 100;
    (byType[t] ||= { n: 0, amt: 0 }); byType[t].n++; byType[t].amt += amt; ledgerNet += amt;
  }
  for (const t of Object.keys(byType)) byType[t].amt = Math.round(byType[t].amt * 100) / 100;

  const dbRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "transactionType" t, COUNT(*)::int n, ROUND(SUM(amount)::numeric,2)::float amt, ROUND(SUM(COALESCE(commission,0))::numeric,2)::float comm
     FROM "FinancialTransaction" WHERE "userId"=$1 AND marketplace='etsy' AND "transactionDate" >= $2 AND "transactionDate" <= $3 GROUP BY 1 ORDER BY 3 DESC`,
    shop.userId, new Date(startMs), new Date(endMs),
  );

  const round = (n: number) => Math.round(n * 100) / 100;
  return res.status(200).json({
    shop: shop.shopName, range: [startStr, endStr],
    receipts: { saleCount, grandtotal: round(grandtotal), subtotal: round(subtotal), shipping: round(shipping), salesTax: round(tax), discount: round(discount), refundedReceiptCount, refundedGrand: round(refundedGrand) },
    payments: { count: payments.length, gross: round(payGross), fees: round(payFees), net: round(payNet), error: paymentsError },
    ledger: { byType, net: round(ledgerNet), count: ledger.length },
    db: dbRows,
  });
}

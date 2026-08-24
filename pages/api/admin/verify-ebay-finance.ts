import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { runCronGuard } from '@/lib/cron/idempotency';
import { getUserAccessToken } from '@/lib/integrations/ebayClient';

// Read-only reconciliation of the eBay dashboard against the real eBay Finances
// API. Breaks down transactions (incl. salesTax), payouts, and funds summary vs
// what the DB stores. Runs in-process (DEK tokens). No writes.
//   curl -X POST '.../api/admin/verify-ebay-finance?userId=<id>&start=2026-07-25&end=2026-08-24' -H 'Authorization: Bearer $CRON_SECRET'
const BASE = 'https://apiz.ebay.com';
const amt = (m: any) => (m && m.value ? parseFloat(m.value) || 0 : 0);

async function ebayGet(endpoint: string, token: string) {
  const res = await fetch(`${BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 204) return null; // funds summary returns 204 when empty
  if (!res.ok) throw new Error(`eBay ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await runCronGuard(req, res, { jobName: 'verify-ebay-finance', intervalMinutes: 1 });
  if (!guard.ok) return;

  const userId = String(req.query.userId || '');
  if (!userId) {
    const cur = await prisma.financialSyncCursor.findFirst({ where: { marketplace: 'ebay' }, select: { userId: true } });
    if (!cur) return res.status(400).json({ error: 'userId required (no ebay cursor found)' });
  }
  const uid = userId || (await prisma.financialSyncCursor.findFirst({ where: { marketplace: 'ebay' }, select: { userId: true } }))!.userId;
  const startStr = String(req.query.start);
  const endStr = String(req.query.end);
  const startMs = new Date(`${startStr}T00:00:00Z`).getTime();
  const endMs = new Date(`${endStr}T23:59:59Z`).getTime();

  const token = await getUserAccessToken(uid);

  // ---- Transactions (chunk <=88 days; eBay caps at 90) ----
  const WINDOW = 88 * 86400_000;
  const txByType: Record<string, { n: number; amt: number }> = {};
  const feeByType: Record<string, { n: number; amt: number }> = {};
  let saleGross = 0, saleSalesTax = 0, saleFees = 0, saleCount = 0, saleAmountField = 0;
  let refundGross = 0, refundSalesTax = 0, refundCount = 0;
  for (let ws = startMs; ws < endMs; ws += WINDOW) {
    const we = Math.min(ws + WINDOW, endMs);
    const filter = `transactionDate:[${new Date(ws).toISOString()}..${new Date(we).toISOString()}]`;
    let offset = 0;
    while (true) {
      const data = await ebayGet(`/sell/finances/v1/transaction?filter=${encodeURIComponent(filter)}&limit=1000&offset=${offset}`, token);
      const txs = Array.isArray(data?.transactions) ? data.transactions : [];
      for (const tx of txs) {
        const ty = tx.transactionType || 'UNKNOWN';
        (txByType[ty] ||= { n: 0, amt: 0 }); txByType[ty].n++; txByType[ty].amt += amt(tx.amount);
        if (ty === 'SALE') {
          saleCount++;
          saleGross += amt(tx.totalFeeBasisAmount);
          saleSalesTax += amt(tx.salesTax);
          saleFees += amt(tx.totalFeeAmount);
          saleAmountField += amt(tx.amount);
          for (const li of tx.orderLineItems || []) for (const f of li.marketplaceFees || []) {
            const ft = f.feeType || 'UNKNOWN';
            (feeByType[ft] ||= { n: 0, amt: 0 }); feeByType[ft].n++; feeByType[ft].amt += amt(f.amount);
          }
        } else if (ty === 'REFUND') {
          refundCount++; refundGross += amt(tx.amount); refundSalesTax += amt(tx.salesTax);
        } else if (ty === 'NON_SALE_CHARGE') {
          const ft = tx.feeType || 'NON_SALE_CHARGE';
          (feeByType[ft] ||= { n: 0, amt: 0 }); feeByType[ft].n++; feeByType[ft].amt += amt(tx.amount);
        }
      }
      if (txs.length < 1000) break;
      offset += 1000;
    }
  }

  // ---- Payouts (banked) ----
  let payouts: any = { error: null, items: [] as any[], total: 0 };
  try {
    const pf = `payoutDate:[${new Date(startMs).toISOString()}..${new Date(endMs).toISOString()}]`;
    const pd = await ebayGet(`/sell/finances/v1/payout?filter=${encodeURIComponent(pf)}&limit=200`, token);
    const items = Array.isArray(pd?.payouts) ? pd.payouts : [];
    payouts = {
      error: null,
      count: items.length,
      total: Math.round(items.reduce((s: number, p: any) => s + amt(p.amount), 0) * 100) / 100,
      items: items.map((p: any) => ({ date: (p.payoutDate || '').slice(0, 10), amount: amt(p.amount), status: p.payoutStatus, txCount: p.transactionCount })),
    };
  } catch (e: any) { payouts = { error: e.message?.slice(0, 160) }; }

  // ---- Funds summary (current balance / held) ----
  let funds: any = null;
  try {
    const fd = await ebayGet('/sell/finances/v1/seller_funds_summary', token);
    funds = fd ? {
      available: amt(fd.availableFunds), onHold: amt(fd.fundsOnHold), processing: amt(fd.processingFunds), total: amt(fd.totalFunds),
    } : { available: 0, onHold: 0, processing: 0, total: 0, note: '204 no content' };
  } catch (e: any) { funds = { error: e.message?.slice(0, 160) }; }

  // ---- DB rows ----
  const dbRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "transactionType" t, COUNT(*)::int n, ROUND(SUM(amount)::numeric,2)::float amt, ROUND(SUM(COALESCE(commission,0))::numeric,2)::float comm
     FROM "FinancialTransaction" WHERE "userId"=$1 AND marketplace='ebay' AND "transactionDate" >= $2 AND "transactionDate" <= $3 GROUP BY 1 ORDER BY 3 DESC`,
    uid, new Date(startMs), new Date(endMs),
  );

  const r = (n: number) => Math.round(n * 100) / 100;
  return res.status(200).json({
    range: [startStr, endStr],
    transactions: {
      byType: Object.fromEntries(Object.entries(txByType).map(([k, v]) => [k, { n: v.n, amt: r(v.amt) }])),
      sale: { count: saleCount, feeBasisGross: r(saleGross), salesTax: r(saleSalesTax), grossExTax: r(saleGross - saleSalesTax), totalFees: r(saleFees), amountFieldSum: r(saleAmountField) },
      refund: { count: refundCount, gross: r(refundGross), salesTax: r(refundSalesTax) },
      feeByType: Object.fromEntries(Object.entries(feeByType).map(([k, v]) => [k, { n: v.n, amt: r(v.amt) }])),
    },
    payouts,
    funds,
    db: dbRows,
  });
}

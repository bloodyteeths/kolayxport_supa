import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/lib/prisma';
import { runCronGuard } from '@/lib/cron/idempotency';

// Read-only reconciliation of the Amazon dashboard against SP-API Finances v0.
// Breaks down ShipmentEvent charges/fees/tax-withheld, tallies ads, lists
// settlement groups (payouts), and compares to DB. No writes.
//   curl -X POST '.../api/admin/verify-amazon-finance?userId=<id>&start=2026-05-25&end=2026-08-24' -H 'Authorization: Bearer $CRON_SECRET'
const num = (m: any) => (m && (m.CurrencyAmount ?? m.Amount) != null ? parseFloat(String(m.CurrencyAmount ?? m.Amount)) : 0);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const guard = await runCronGuard(req, res, { jobName: 'verify-amazon-finance', intervalMinutes: 1 });
  if (!guard.ok) return;

  const uid = String(req.query.userId || '') || (await prisma.financialSyncCursor.findFirst({ where: { marketplace: 'amazon' }, select: { userId: true } }))?.userId;
  if (!uid) return res.status(400).json({ error: 'userId required (no amazon cursor)' });
  const startMs = new Date(`${req.query.start}T00:00:00Z`).getTime();
  const endMs = Math.min(new Date(`${req.query.end}T23:59:59Z`).getTime(), Date.now() - 3 * 60_000);

  const cred: any = await prisma.credential.findUnique({ where: { userId: uid } });
  if (!cred?.amazonRefreshToken) return res.status(400).json({ error: 'amazon not connected' });
  const region = (cred.amazonRegion || 'eu') as any;
  const { getValidToken, callSpApiWithRetry } = await import('@/lib/integrations/amazonClient');
  const token = await getValidToken(cred);
  if (!token) return res.status(400).json({ error: 'amazon token expired' });

  // ---- Financial events (chunk <=180 days) ----
  const WINDOW = 175 * 86400_000;
  const chargeByType: Record<string, { n: number; amt: number }> = {};
  const feeByType: Record<string, { n: number; amt: number }> = {};
  const withheldByType: Record<string, { n: number; amt: number }> = {};
  const svcFeeByReason: Record<string, { n: number; amt: number }> = {};
  const eventCounts: Record<string, number> = {};
  let adsTotal = 0, adsCount = 0;
  for (let ws = startMs; ws < endMs; ws += WINDOW) {
    const we = Math.min(ws + WINDOW, endMs);
    let nextToken: string | null = null;
    let pages = 0;
    do {
      const qs = nextToken ? `NextToken=${encodeURIComponent(nextToken)}`
        : `PostedAfter=${encodeURIComponent(new Date(ws).toISOString())}&PostedBefore=${encodeURIComponent(new Date(we).toISOString())}&MaxResultsPerPage=100`;
      const data: any = await callSpApiWithRetry(`/finances/v0/financialEvents?${qs}`, token, region);
      const ev = data?.payload?.FinancialEvents || {};
      for (const k of Object.keys(ev)) if (Array.isArray(ev[k])) eventCounts[k] = (eventCounts[k] || 0) + ev[k].length;
      for (const se of ev.ShipmentEventList || []) {
        for (const item of se.ShipmentItemList || []) {
          for (const c of item.ItemChargeList || []) {
            const t = c.ChargeType || '?'; (chargeByType[t] ||= { n: 0, amt: 0 }); chargeByType[t].n++; chargeByType[t].amt += num(c.ChargeAmount);
          }
          for (const f of item.ItemFeeList || []) {
            const t = f.FeeType || '?'; (feeByType[t] ||= { n: 0, amt: 0 }); feeByType[t].n++; feeByType[t].amt += num(f.FeeAmount);
          }
          for (const w of item.ItemTaxWithheldList || []) {
            for (const c of w.TaxesWithheld || []) {
              const t = c.ChargeType || '?'; (withheldByType[t] ||= { n: 0, amt: 0 }); withheldByType[t].n++; withheldByType[t].amt += num(c.ChargeAmount);
            }
          }
        }
      }
      for (const sf of ev.ServiceFeeEventList || []) {
        const reason = sf.FeeReason || sf.FeeDescription || '?';
        for (const f of sf.FeeList || []) { (svcFeeByReason[reason] ||= { n: 0, amt: 0 }); svcFeeByReason[reason].n++; svcFeeByReason[reason].amt += num(f.FeeAmount); }
      }
      for (const pa of ev.ProductAdsPaymentEventList || []) { const a = Math.abs(num({ CurrencyAmount: pa.transactionValue ?? pa.TransactionValue })); if (a) { adsTotal += a; adsCount++; } }
      nextToken = data?.payload?.NextToken || null;
      pages++;
    } while (nextToken && pages < 100);
  }

  // ---- Settlement groups (payouts) ----
  let groups: any = { error: null, items: [] as any[] };
  try {
    const gStart = new Date(Math.max(startMs, Date.now() - 175 * 86400_000)).toISOString();
    const gEnd = new Date(Date.now() - 3 * 60_000).toISOString();
    const gd: any = await callSpApiWithRetry(
      `/finances/v0/financialEventGroups?FinancialEventGroupStartedAfter=${encodeURIComponent(gStart)}&FinancialEventGroupStartedBefore=${encodeURIComponent(gEnd)}&MaxResultsPerPage=100`,
      token, region,
    );
    const list = gd?.payload?.FinancialEventGroupList || [];
    groups = {
      error: null,
      count: list.length,
      closedTotal: Math.round(list.filter((g: any) => g.ProcessingStatus === 'Closed').reduce((s: number, g: any) => s + num(g.ConvertedTotal || g.OriginalTotal), 0) * 100) / 100,
      items: list.map((g: any) => ({
        status: g.ProcessingStatus, transferStatus: g.FundTransferStatus,
        total: num(g.ConvertedTotal || g.OriginalTotal), currency: (g.ConvertedTotal || g.OriginalTotal)?.CurrencyCode,
        transferDate: (g.FundTransferDate || '').slice(0, 10), start: (g.FinancialEventGroupStart || '').slice(0, 10),
      })),
    };
  } catch (e: any) { groups = { error: e.message?.slice(0, 200) }; }

  // Probe the 2024-06-19 transactions endpoint for DEFERRED funds (the bulk of
  // the real Seller Central balance, which financialEventGroups misses).
  let deferred: any = { error: null };
  try {
    const byStatus: Record<string, { n: number; amt: number }> = {};
    let nextToken: string | null = null;
    let pages = 0;
    const after = new Date(Date.now() - 45 * 86400_000).toISOString();
    do {
      const qs = nextToken ? `nextToken=${encodeURIComponent(nextToken)}` : `postedAfter=${encodeURIComponent(after)}`;
      const data: any = await callSpApiWithRetry(`/finances/2024-06-19/transactions?${qs}`, token, region);
      const txs = data?.transactions || data?.payload?.transactions || [];
      for (const tx of txs) {
        const st = tx.transactionStatus || tx.status || '?';
        const a = num(tx.totalAmount || tx.netAmount);
        (byStatus[st] ||= { n: 0, amt: 0 }); byStatus[st].n++; byStatus[st].amt += a;
      }
      nextToken = data?.nextToken || data?.payload?.nextToken || null;
      pages++;
    } while (nextToken && pages < 30);
    deferred = { byStatus: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, { n: v.n, amt: Math.round(v.amt * 100) / 100 }])) };
  } catch (e: any) { deferred = { error: e.message?.slice(0, 200) }; }

  const dbRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "transactionType" t, COUNT(*)::int n, ROUND(SUM(amount)::numeric,2)::float amt, ROUND(SUM(COALESCE(commission,0))::numeric,2)::float comm
     FROM "FinancialTransaction" WHERE "userId"=$1 AND marketplace='amazon' AND "transactionDate" >= $2 AND "transactionDate" <= $3 GROUP BY 1 ORDER BY 3 DESC`,
    uid, new Date(startMs), new Date(endMs),
  );

  const r = (o: Record<string, { n: number; amt: number }>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { n: v.n, amt: Math.round(v.amt * 100) / 100 }]));
  return res.status(200).json({
    range: [req.query.start, req.query.end], eventCounts,
    charges: r(chargeByType), fees: r(feeByType), taxWithheld: r(withheldByType), serviceFees: r(svcFeeByReason),
    ads: { total: Math.round(adsTotal * 100) / 100, count: adsCount },
    payoutGroups: groups,
    deferredProbe: deferred,
    db: dbRows,
  });
}

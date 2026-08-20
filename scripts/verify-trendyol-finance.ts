/**
 * Read-only reconciliation: pull raw Trendyol finance data from the API for a
 * given supplier + date range and print per-type debt/credit aggregates in the
 * same shape as the Cari Hesap Ekstresi Excel, so the two can be compared
 * line by line. Makes NO writes to the DB and NO mutations on Trendyol.
 *
 * Usage (on the server, repo root):
 *   set -a; source .env; set +a
 *   npx tsx scripts/verify-trendyol-finance.ts 875021 2026-07-20 2026-08-20
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_BASE = 'https://apigw.trendyol.com/integration';

const SETTLEMENT_TYPES = ['Sale', 'Return', 'Discount', 'DiscountCancel', 'Coupon', 'CouponCancel', 'CommissionPositive', 'CommissionNegative', 'ManualRefund', 'ManualRefundCancel', 'ProvisionPositive', 'ProvisionNegative'];
const OTHER_TYPES = ['DeductionInvoices', 'Stoppage', 'PaymentOrder', 'CommercialInvoice', 'ReturnInvoice', 'CashAdvance', 'WireTransfer', 'IncomingTransfer'];

async function fetchAll(auth: string, supplierId: string, endpoint: 'settlements' | 'otherfinancials', txType: string, startMs: number, endMs: number) {
  const items: any[] = [];
  // Trendyol caps ranges at 15 days — walk in 14-day windows
  for (let ws = startMs; ws < endMs; ws += 14 * 86400_000) {
    const we = Math.min(ws + 14 * 86400_000, endMs);
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ startDate: String(ws), endDate: String(we), transactionType: txType, page: String(page), size: '500' });
      const res = await fetch(`${API_BASE}/finance/che/sellers/${supplierId}/${endpoint}?${qs}`, {
        headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': `${supplierId} - SelfIntegration` },
      });
      if (!res.ok) { if (page === 0) console.error(`  [${endpoint}/${txType}] HTTP ${res.status}`); break; }
      const data = await res.json().catch(() => null);
      const content = Array.isArray(data?.content) ? data.content : [];
      items.push(...content);
      if (page >= (data?.totalPages || 0) - 1) break;
    }
  }
  return items;
}

async function main() {
  const [supplierId, startStr, endStr] = process.argv.slice(2);
  if (!supplierId || !startStr || !endStr) throw new Error('args: <supplierId> <start YYYY-MM-DD> <end YYYY-MM-DD>');

  const cred = await prisma.credential.findFirst({ where: { trendyolSupplierId: supplierId }, select: { trendyolApiKey: true, trendyolApiSecret: true } });
  if (!cred?.trendyolApiKey || !cred?.trendyolApiSecret) throw new Error('credentials not found for supplier ' + supplierId);
  const auth = 'Basic ' + Buffer.from(`${cred.trendyolApiKey}:${cred.trendyolApiSecret}`).toString('base64');

  const startMs = new Date(`${startStr}T00:00:00+03:00`).getTime();
  const endMs = new Date(`${endStr}T23:59:59+03:00`).getTime();

  // type label -> [count, debt, credit]
  const agg = new Map<string, [number, number, number]>();
  const bump = (label: string, debt: number, credit: number) => {
    const cur = agg.get(label) || [0, 0, 0];
    cur[0] += 1; cur[1] += debt; cur[2] += credit;
    agg.set(label, cur);
  };

  for (const t of SETTLEMENT_TYPES) {
    const items = await fetchAll(auth, supplierId, 'settlements', t, startMs, endMs);
    for (const it of items) bump(`settlements/${t}`, Number(it.debt || 0), Number(it.credit || 0));
  }
  for (const t of OTHER_TYPES) {
    const items = await fetchAll(auth, supplierId, 'otherfinancials', t, startMs, endMs);
    // otherfinancials rows carry their own display label in transactionType
    for (const it of items) bump(`other/${t}${it.transactionType && it.transactionType !== t ? `:${it.transactionType}` : ''}`, Number(it.debt || 0), Number(it.credit || 0));
  }

  let td = 0, tc = 0, n = 0;
  console.log(`\n${'source/type'.padEnd(52)} ${'count'.padStart(5)} ${'debt'.padStart(14)} ${'credit'.padStart(14)}`);
  for (const [label, [count, debt, credit]] of [...agg.entries()].sort((a, b) => (b[1][1] + b[1][2]) - (a[1][1] + a[1][2]))) {
    console.log(`${label.padEnd(52)} ${String(count).padStart(5)} ${debt.toFixed(2).padStart(14)} ${credit.toFixed(2).padStart(14)}`);
    td += debt; tc += credit; n += count;
  }
  console.log(`${'TOTAL'.padEnd(52)} ${String(n).padStart(5)} ${td.toFixed(2).padStart(14)} ${tc.toFixed(2).padStart(14)}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

/**
 * Read-only reconciliation for the Etsy financial dashboard. Pulls raw data
 * from the real Etsy API (receipts, payments, ledger) for a date range and
 * prints the money breakdown the dashboard is built from, plus the ledger —
 * Etsy's authoritative account of what actually hit the seller's balance.
 *
 * Makes NO writes. Must run inside the app env (Etsy tokens are DEK-encrypted).
 *
 *   set -a; source .env; set +a
 *   npx tsx scripts/verify-etsy-finance.ts 2026-07-31 2026-08-24
 */
import { PrismaClient } from '@prisma/client';
import { EtsyClient } from '@/lib/integrations/etsyClient';
import { decryptIfNeeded } from '@/lib/crypto/credentials';

const prisma = new PrismaClient();
const money = (m: any) => (m && typeof m.amount === 'number' ? m.amount / m.divisor : 0);

async function main() {
  const [startStr, endStr] = process.argv.slice(2);
  const startMs = new Date(`${startStr}T00:00:00Z`).getTime();
  const endMs = new Date(`${endStr}T23:59:59Z`).getTime();
  const minCreated = Math.floor(startMs / 1000);
  const maxCreated = Math.floor(endMs / 1000);

  const shop = await prisma.etsyShop.findFirst({ where: { isActive: true, isDefault: true } })
    || await prisma.etsyShop.findFirst({ where: { isActive: true } });
  if (!shop?.accessToken) throw new Error('no active etsy shop');
  console.log(`Shop: ${shop.shopName} (${shop.shopId})  range ${startStr}..${endStr}\n`);

  const client = new EtsyClient({
    accessToken: decryptIfNeeded(shop.accessToken) as string,
    refreshToken: (decryptIfNeeded(shop.refreshToken) as string | null) || undefined,
    shopId: shop.shopId,
    tokenExpiresAt: shop.tokenExpiresAt || undefined,
  }, async () => {});

  // ---- Receipts ----
  const receipts: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const d = await client.getReceipts({ min_created: minCreated, max_created: maxCreated, limit: 100, offset });
    const r = d.results || [];
    receipts.push(...r);
    if (r.length < 100) break;
  }

  let grandtotal = 0, subtotal = 0, shipping = 0, tax = 0, discount = 0;
  let saleCount = 0, refundedReceiptCount = 0, refundedGrand = 0;
  for (const r of receipts) {
    const g = money(r.grandtotal), s = money(r.subtotal), sh = money(r.total_shipping_cost), tx = money(r.total_tax_cost), dc = money(r.discount_amt);
    const status = (r.status || '').toLowerCase();
    if (status === 'refunded' || status === 'returned') { refundedReceiptCount++; refundedGrand += g; }
    else { saleCount++; grandtotal += g; subtotal += s; shipping += sh; tax += tx; discount += dc; }
  }

  // ---- Payments ----
  const payments: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const d = await client.getShopPayments({ min_created: minCreated, max_created: maxCreated, limit: 100, offset });
    const r = d.results || [];
    payments.push(...r);
    if (r.length < 100) break;
  }
  let payGross = 0, payFees = 0, payNet = 0, payRefunds = 0;
  for (const p of payments) {
    payGross += money(p.amount_gross);
    payFees += money(p.amount_fees);
    payNet += money(p.amount_net);
    payRefunds += money(p.amount_net_refunded || { amount: 0, divisor: 100 });
  }

  // ---- Ledger (authoritative) ----
  const ledger: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const d = await client.getLedgerEntries({ min_created: minCreated, max_created: maxCreated, limit: 100, offset });
    const r = d.results || [];
    ledger.push(...r);
    if (r.length < 100) break;
  }
  const byType = new Map<string, { n: number; amt: number }>();
  let ledgerNet = 0;
  for (const e of ledger) {
    const t = e.ledger_type || 'unknown';
    const amt = typeof e.amount === 'object' ? money(e.amount) : (Number(e.amount) || 0) / 100;
    const cur = byType.get(t) || { n: 0, amt: 0 };
    cur.n++; cur.amt += amt; byType.set(t, cur);
    ledgerNet += amt;
  }

  const f = (n: number) => n.toFixed(2).padStart(11);
  console.log('=== RECEIPTS (non-refunded) — what "Gross Revenue" is built from ===');
  console.log(`  count ${saleCount}`);
  console.log(`  grandtotal   ${f(grandtotal)}   <- dashboard Gross Revenue basis`);
  console.log(`    subtotal   ${f(subtotal)}   (items only)`);
  console.log(`    shipping   ${f(shipping)}   (buyer-paid)`);
  console.log(`    sales tax  ${f(tax)}   (Etsy remits — NOT seller revenue)`);
  console.log(`    discount   ${f(discount)}`);
  console.log(`  refunded receipts: ${refundedReceiptCount}, grandtotal ${f(refundedGrand)}\n`);

  console.log('=== PAYMENTS — fee basis ===');
  console.log(`  count ${payments.length}`);
  console.log(`  gross ${f(payGross)}   fees ${f(payFees)}   net ${f(payNet)}   refunded ${f(payRefunds)}\n`);

  console.log('=== LEDGER (authoritative account activity) ===');
  for (const [t, { n, amt }] of [...byType.entries()].sort((a, b) => Math.abs(b[1].amt) - Math.abs(a[1].amt))) {
    console.log(`  ${t.padEnd(34)} ${String(n).padStart(4)}  ${f(amt)}`);
  }
  console.log(`  ${'NET LEDGER'.padEnd(34)} ${String(ledger.length).padStart(4)}  ${f(ledgerNet)}\n`);

  console.log('=== DB (what dashboard reads) ===');
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "transactionType" t, COUNT(*) n, ROUND(SUM(amount)::numeric,2) amt, ROUND(SUM(COALESCE(commission,0))::numeric,2) comm
     FROM "FinancialTransaction" WHERE "userId"=$1 AND marketplace='etsy'
     AND "transactionDate" >= $2 AND "transactionDate" <= $3 GROUP BY 1 ORDER BY 3 DESC`,
    shop.userId, new Date(startMs), new Date(endMs),
  );
  for (const r of rows) console.log(`  ${String(r.t).padEnd(12)} ${String(r.n).padStart(4)}  amt ${f(Number(r.amt))}  comm ${f(Number(r.comm))}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message || e); process.exit(1); });

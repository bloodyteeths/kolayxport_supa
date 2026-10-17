/**
 * One-off backfill: Trendyol order dates were stored 3 hours late (Trendyol sends Turkey local time as if it
 * were UTC; see trendyolOrderDateIso in lib/mappers/trendyol.ts). Recomputes uiOrderDate from the stored raw
 * Trendyol payload, so it is idempotent: rows that are already right are left alone.
 *
 *   npx tsx scripts/fix-trendyol-order-dates.ts           # dry run: counts + samples, writes nothing
 *   npx tsx scripts/fix-trendyol-order-dates.ts --apply   # update
 */
import { PrismaClient } from '@prisma/client';
import { trendyolOrderDateIso } from '../lib/mappers/trendyol';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const orders = await prisma.order.findMany({
    where: { marketplace: { equals: 'Trendyol', mode: 'insensitive' } },
    select: { id: true, orderNumber: true, uiOrderDate: true, rawData: true },
  });
  const fixes: { id: string; orderNumber: string | null; from: Date | null; to: Date }[] = [];
  for (const o of orders) {
    const raw = o.rawData as { orderDate?: unknown } | null;
    const iso = trendyolOrderDateIso(raw?.orderDate);
    if (!iso) continue;
    const to = new Date(iso);
    if (o.uiOrderDate && o.uiOrderDate.getTime() === to.getTime()) continue;
    fixes.push({ id: o.id, orderNumber: o.orderNumber, from: o.uiOrderDate, to });
  }
  console.log(`${orders.length} Trendyol orders, ${fixes.length} with a wrong date`);
  for (const f of fixes.slice(0, 5)) console.log(`  #${f.orderNumber}: ${f.from?.toISOString() ?? '—'} → ${f.to.toISOString()}`);
  if (!APPLY) { console.log('Dry run. Re-run with --apply to update.'); return; }
  let done = 0;
  for (const f of fixes) {
    await prisma.order.update({ where: { id: f.id }, data: { uiOrderDate: f.to } });
    done += 1;
  }
  console.log(`Updated ${done} orders.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

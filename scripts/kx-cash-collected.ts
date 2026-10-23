// npx tsx scripts/kx-cash-collected.ts — one line: KolayXport cash collected today (Istanbul day) and 30-day-to-date.
import { cashCollected, formatMoney } from '../lib/billing/cashCollected';

(async () => {
  const now = new Date();
  const tr = new Date(now.getTime() + 3 * 3600_000);
  const startTodayUtc = new Date(Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate()) - 3 * 3600_000);
  const [today, last30] = await Promise.all([
    cashCollected(startTodayUtc, now),
    cashCollected(new Date(now.getTime() - 30 * 86_400_000), now),
  ]);
  console.log(`KX_CASH today=${formatMoney(today.net)} (${today.charges} charges) | 30d=${formatMoney(last30.net)} (${last30.charges} charges)`);
  process.exit(0);
})().catch((e) => { console.error('KX_CASH_ERROR', e instanceof Error ? e.message : e); process.exit(1); });

// scripts/loadtest/etsy-bulk-sim.ts — measured throughput of the Etsy bulk send against a SIMULATED Etsy.
// Uses the real budget code (lib/etsy/rateBudget: token bucket 100/s, P4 Bulk daily gate + per-shop cap) and the
// same pool shape as pages/api/etsy-drafts/bulk-sync.ts (BULK_CONCURRENCY in flight, 3 calls per draft).
// Etsy latency is simulated from a measured sample (24 Oct 2026, read calls from the VPS: 260–330 ms, median
// 270 ms); write calls are assumed 1.5× slower. Nothing talks to Etsy.
// Run: DATABASE_URL=<local throwaway db> npx tsx scripts/loadtest/etsy-bulk-sim.ts [drafts=2000] [concurrency=8]
import { acquireEtsyCall, recordEtsyCall, canSpend, EtsyPriority, BULK_CALLS_PER_DRAFT, __resetEtsyBudget } from '../../lib/etsy/rateBudget';

const N = Number(process.argv[2] || 2000);
const CONCURRENCY = Number(process.argv[3] || 8);
const READ_MS = [260, 270, 270, 280, 300, 330];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lat = (write: boolean) => READ_MS[Math.floor(Math.random() * READ_MS.length)] * (write ? 1.5 : 1);

async function etsyCall(shopId: string, write: boolean) {
  await acquireEtsyCall(EtsyPriority.Bulk);
  recordEtsyCall(shopId, EtsyPriority.Bulk);
  await sleep(lat(write));
}

async function sendDraft(shopId: string) {
  await etsyCall(shopId, false); // fetch listing + inventory (conflict check)
  await etsyCall(shopId, false); // inventory
  await etsyCall(shopId, true);  // update
}

(async () => {
  __resetEtsyBudget();
  const shopId = 'sim-shop';
  let next = 0, sent = 0, deferred = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (let i = next++; i < N; i = next++) {
      if (!canSpend(shopId, EtsyPriority.Bulk, BULK_CALLS_PER_DRAFT).ok) { deferred++; continue; }
      await sendDraft(shopId);
      sent++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const s = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ drafts: N, concurrency: CONCURRENCY, sent, deferred, seconds: Math.round(s), draftsPerMinute: Math.round((sent / s) * 60), callsPerSecond: Math.round((sent * 3) / s * 10) / 10 }));
  process.exit(0);
})();

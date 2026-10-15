/**
 * Backfill listing health (listings-grid §9.3, BR-1a columns) for every cached listing.
 *
 * Reads only the DB caches (EtsyListing, EbayListing, TrendyolProduct, WixProduct, ShopifyProduct),
 * scores each row with lib/listingScore and writes healthScore / healthChecksUsed / healthChecksTotal /
 * healthFails. Never calls a marketplace and never touches drafts.
 *
 * Safe by design:
 *  - Dry run by default: prints per-store counts and band distribution, writes nothing.
 *  - With --commit, writes only when the BR-1a columns exist (otherwise reports "columns_missing").
 *  - Idempotent: re-running recomputes the same values.
 *
 * Usage:
 *   npx tsx scripts/backfill-listing-health.ts                       # dry run, all marketplaces
 *   npx tsx scripts/backfill-listing-health.ts --marketplace=etsy    # one marketplace
 *   npx tsx scripts/backfill-listing-health.ts --commit              # write
 */
import { PrismaClient } from '@prisma/client';
import { LISTING_SCORE_MARKETPLACES, type ListingScoreMarketplace } from '../lib/listingScore';
import { listHealthStores, refreshHealth, type HealthDb } from '../lib/listings/refreshHealth';

function parseArgs(argv: string[]): { commit: boolean; marketplaces: ListingScoreMarketplace[] } {
  const commit = argv.includes('--commit');
  const mpArg = argv.find((a) => a.startsWith('--marketplace='));
  const wanted = mpArg ? mpArg.slice('--marketplace='.length).split(',').map((s) => s.trim()) : null;
  const marketplaces = LISTING_SCORE_MARKETPLACES.filter((m) => !wanted || wanted.includes(m));
  if (wanted && marketplaces.length !== wanted.length) {
    throw new Error(`Unknown marketplace in ${mpArg}. Use: ${LISTING_SCORE_MARKETPLACES.join(', ')}`);
  }
  return { commit, marketplaces };
}

async function main(): Promise<void> {
  const { commit, marketplaces } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const db = prisma as unknown as HealthDb;
  let failures = 0;
  try {
    console.log(commit ? 'Mode: COMMIT (writing health columns)' : 'Mode: dry run (pass --commit to write)');
    for (const marketplace of marketplaces) {
      const stores = await listHealthStores(marketplace, db);
      console.log(`\n[${marketplace}] ${stores.length} store(s)`);
      for (const scope of stores) {
        const r = await refreshHealth(marketplace, scope, { db, dryRun: !commit });
        const b = r.bands;
        console.log(
          `  ${scope.storeId}: scored ${r.scored}, written ${r.written}, unscored ${r.unscored}` +
            ` | needs work ${b.needs_work} · fair ${b.fair} · good ${b.good} · great ${b.great}` +
            (r.skipped ? ` | skipped: ${r.skipped}` : '') +
            (r.error ? ` | ERROR: ${r.error}` : ''),
        );
        if (r.error) failures += 1;
        if (r.skipped === 'columns_missing') {
          console.log('  The health columns are not migrated yet (BR-1a). Stopping.');
          return;
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

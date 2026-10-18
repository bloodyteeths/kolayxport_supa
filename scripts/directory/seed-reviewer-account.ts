/* eslint-disable no-console */
/**
 * ONE reviewer account for the Claude Connectors Directory (Anthropic) and the ChatGPT plugin directory (OpenAI),
 * filled with made-up demo data, so the reviewers can log in and use the MCP connector (/api/mcp, lib/mcp/*).
 * Founder approved creating it on production.
 *
 * ── Run ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *   Local throwaway DB (host localhost / 127.0.0.1 / ::1 and database not "kolayxport"):
 *     DATABASE_URL=postgresql://postgres@localhost:5544/kx_gtm_preview REVIEWER_EMAIL=review@kolayxport.test \
 *       REVIEWER_SECRET_OUT=/somewhere/outside/the/repo/reviewer.txt npx tsx scripts/directory/seed-reviewer-account.ts [--dry-run]
 *   Production (from /home/deploy/kolayxport; DATABASE_URL comes from its .env):
 *     REVIEWER_EMAIL=… CONFIRM=seed-reviewer-<REVIEWER_EMAIL> npx tsx scripts/directory/seed-reviewer-account.ts --production --dry-run
 *     REVIEWER_EMAIL=… CONFIRM=seed-reviewer-<REVIEWER_EMAIL> REVIEWER_SECRET_OUT=/home/deploy/reviewer-secret.txt \
 *       npx tsx scripts/directory/seed-reviewer-account.ts --production
 *   Flags: --dry-run (plan only, writes nothing), --remove (delete the account and everything it owns),
 *          --rotate-password (new password for an existing reviewer), --production (non-local database).
 *
 * ── Guards (scripts/directory/reviewerGuards.ts, unit-tested) ─────────────────────────────────────────────────
 *   - REVIEWER_EMAIL must be set; any database that is not a local throwaway one needs --production AND
 *     CONFIRM=seed-reviewer-<REVIEWER_EMAIL>. Production's Postgres is on localhost too, so database "kolayxport" (or
 *     NODE_ENV=production) always counts as production. The URL is picked like lib/prisma.ts does (DIRECT_URL,
 *     DATABASE_URL_NOPREP, DATABASE_URL), so the account lands in the database the app reads.
 *   - REVIEWER_SECRET_OUT must be outside the app directory; the password is written there (mode 600), never printed.
 *   - An existing account with that e-mail is touched only if it is a seeded reviewer: name "KolayXport Review",
 *     no Stripe / Shopify / Google link, no OAuth accounts, no marketplace credentials, and every Etsy shop, order,
 *     eBay SKU and Trendyol barcode it owns is in the reserved ranges. Otherwise the script refuses.
 *   - Before writing, every reserved id is checked against OTHER users' rows; any hit aborts (nothing written).
 *   - Every delete is scoped to rows owned by the reviewer (userId, or a foreign-key child of an owned row), and it
 *     all runs in one transaction. Re-running refreshes only the reviewer's seeded data (AI connections, credits and
 *     logs survive a refresh; --remove deletes those too).
 *
 * ── The account ──────────────────────────────────────────────────────────────────────────────────────────────
 *   User "KolayXport Review", e-mail verified (credentials login throws EMAIL_NOT_VERIFIED while
 *   User.emailVerified is null: lib/auth/credentials.ts), bcrypt(12) password, onboardingStep 99, sender profile set.
 *   Plan: enterprise / active (lib/billing/entitlementCore: every feature on; lib/billing/planLimits: 10,000 AI
 *   credits a month, enough for many 15-credit images; no Stripe customer, no upsell). Not Shopify-connected (no
 *   ShopifyShop row, billingProvider null): lib/billing/requireFeature would otherwise turn it into shopify_free.
 *
 * ── Data (scripts/directory/reviewerData.ts; ids in reserved ranges, buyers obviously fictional) ───────────────
 *   Etsy shop "KXReviewDemoShop" with 25 listings (tags, prices, stock incl. 0–2 left), 12 eBay listings, 13 Trendyol
 *   products, 50 orders over 60 days (Etsy 22 with full receipt rawData: discount_amt, total_shipping_cost,
 *   total_tax_cost, total_vat_cost, gift_wrap_price; eBay 14 with pricingSummary; Trendyol 14 with discounts; open,
 *   late, shipped, delivered, cancelled; 10 countries), Etsy addresses as the browser extension stores them
 *   (EtsyAddress), finance rows as the finance sync stores them (receipt sales, Etsy ledger fees / ads / sales tax /
 *   refunds / disbursements, eBay sales + payouts, Trendyol sales) with balances (FinancialSyncCursor), product
 *   costs, and staged drafts (an Etsy title + tags change, an eBay price + stock change, a Trendyol price change).
 *
 * ── Why no cron or sync picks this account up (audited 2026-10-18) ─────────────────────────────────────────────
 *   No marketplace or carrier token exists anywhere for this user:
 *   - Credential holds ONLY trendyolSupplierId=KXREVIEW (Trendyol listings and catalog drafts are filed under the
 *     supplier id). Trendyol order / stock / finance sync need key + secret + supplier id, so they skip it; eBay
 *     (needs ebayAccessToken), Amazon, Wix, Shopify, Hepsiburada, Veeqo, Shippo, carriers: nothing set. The
 *     sync-orders cron still iterates the user (any Credential row) and records an empty SyncOperation.
 *   - EtsyShop is isActive (the MCP tools read Etsy listings through active shops) with accessToken '' (empty: the
 *     token helper throws locally before any request to Etsy, so staging falls back to the cached listing),
 *     refreshToken null (finance sync needs one: quiet 400; no refresh POST can ever happen, so no reauth flag or
 *     e-mail) and tokenExpiresAt 2099. lastOrderPollAt / lastWebhookAt in 2099 make etsy-orders-incremental skip
 *     the shop; lastListingSyncAt in 2099 stops the listings page auto-pull. The nightly etsy-listings-reconcile and
 *     etsy-orders-reconcile still select the shop and stop at the missing token (a warn log line, no HTTP call).
 *     Every Etsy order's listing id exists in EtsyListing, so etsy-listing-cache-backfill has nothing to fetch.
 *   - NotificationSettings.emailEnabled=false: the order-dispatch-alerts job raises in-app reminders for the open
 *     demo orders, but no e-mail is ever sent to the reviewer address.
 *   - No StockSettings / StockLink / StockPush (stock jobs), no ResearchWatch / EbayTrackedProduct /
 *     RankTrackedKeyword / SeoExperiment (research jobs), no draft has scheduledSendAt (send-scheduled-drafts), no
 *     CatalogDraft is 'syncing'. FinancialSyncCursor rows make sync-financials try every 6 h and the dashboard
 *     auto-refresh after 3 h; without credentials both end in a silent 400.
 *   - Dashboard "connected" markers: Etsy shows connected (active EtsyShop). eBay and Trendyol pages show "Connect"
 *     (no tokens) but the MCP tools read their listings from the database. eBay staging needs an open draft or an
 *     eBay token, so every eBay listing gets an open draft (empty base patch except the one demo change).
 *
 * ── Known limits ─────────────────────────────────────────────────────────────────────────────────────────────
 *   - purge-pii (if enabled in production) nulls names / addresses / rawData of orders older than 90 days and
 *     deletes EtsyAddress rows older than 90 days: re-run the seed to re-anchor the dates to today.
 *   - Live calls from the dashboard (refresh buttons, opening the Etsy listing editor, Send to marketplace) fail
 *     with "not connected" errors. The MCP tools only read the database and stage drafts.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { checkGuards } from './reviewerGuards';
import { runReviewerSeed } from './reviewerSeed';

async function main() {
  // Production: /home/deploy/kolayxport/.env (never .env.local). A variable already set in the shell wins.
  const envFile = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, override: false });

  const guard = checkGuards({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() });
  if (!guard.ok) {
    console.error(`[reviewer] REFUSING to run: ${guard.reason}`);
    process.exit(2);
  }
  const appUrl = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://kolayxport.com').replace(/\/+$/, '');
  console.log(`[reviewer] mode=${guard.mode}${guard.dryRun ? ' (dry run)' : ''} db=${guard.dbHost}/${guard.dbName} (from ${guard.dbVar})${guard.local ? ' (local)' : ' (PRODUCTION)'} email=${guard.email}`);

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: guard.dbUrl } } });
  try {
    await runReviewerSeed(prisma, {
      mode: guard.mode,
      dryRun: guard.dryRun,
      rotatePassword: guard.rotatePassword,
      email: guard.email,
      secretOut: guard.secretOut,
      // Product photos are the static demo renders shipped in public/demo (served by the app itself).
      imageBase: appUrl,
      appUrl,
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`[reviewer] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

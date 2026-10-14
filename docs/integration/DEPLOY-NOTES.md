# Deploy notes: Etsy backbone, live orders, stock sync, listing intel, notifications (W0–W6)

Target: Hetzner VPS `46.224.169.225`, `/home/deploy/kolayxport`, systemd `kolayxport.service`, nginx 1.24 in front. The deploy runs from a push to `main`: the "Deploy to Hetzner" workflow calls `scripts/deploy/hetzner-deploy.sh`, which runs `prisma migrate deploy`, builds into `.next-new` with `DISABLE_PWA=1`, swaps `.next` atomically and restarts.

## 0. Before you push

- **Integrator checks** (working tree, 2026-10-15):
  - `npx tsc --noEmit -p .`: 0 errors.
  - `npx vitest run`: 617 of 620 tests pass. The 2 failing tests and 2 suites that fail to load are pre-existing.
  - `npx next build --webpack`: success.
  - `npx prisma validate`: OK.
- **i18n is merged** into `messages/en.json` and `messages/tr.json`. The change is strictly additive: 7 new namespaces, `notifications.types.*`, and `etsy.draftSync.stockOverrideFailed`. If the UI session pushes an older copy of these files, the new pages show raw keys. Re-run `npx tsx scripts/i18n/merge-fragments.ts --check`; it must report "+0" leaves once merged, or re-merge.
- **Visible on day one, before the UI session lands its part** (`docs/integration/etsy-webhook-ui.md`):
  - **Label routes** return 409 `ORDER_CANCELLED` or `ORDER_SHIPPED_EXTERNALLY` for cancelled orders and orders shipped elsewhere. The drawers show the raw code and have no override until checklist item 4 lands.
  - **Instant emails** go out by default through Postmark: cancelled-after-label, overdue and due-today dispatch, stock push failed, listing deleted or deactivated, reconnect needed. New orders and plain cancellations are in-app only. Stock-out goes into the daily digest.
  - **Live order events** are published, but the chime and toast only appear after `LiveAppMount` is mounted in `pages/_app.tsx` (checklist item 1). SWR pages refresh live once it is mounted.
- **Stock sync ships OFF.** Every user is `enabled=false, dryRun=true`, and nothing writes stock to any marketplace until the seller runs the wizard, reviews the dry run and presses Go Live.

## 1. Migrations (applied by `prisma migrate deploy` in the deploy script)

Production is at `20261015090000_notifications` (checked read-only on 2026-10-15). These 5 new migrations sort after it.

| Migration | What |
|---|---|
| `20261015100000_etsy_event_backbone` | New columns on `WebhookEvent`, `EtsyShop` and `EtsyDraftSyncAttempt`. New tables `EtsyApiUsage`, `EtsyApiQuota`, `JobRun`. |
| `20261015100100_notification_center_v2` | New columns on `Notification` (`badge` defaults to true). New tables `NotificationDelivery`, `NotificationPreference`, `NotificationSettings`. |
| `20261015100200_order_lifecycle` | New columns on `Order`, `OrderItem`, `Shipment` and `TrackingSubmission`. New table `OrderEffect`. |
| `20261015100300_etsy_listing_intel` | New columns on `EtsyListing`. New tables `EtsyListingOffering`, `EtsyListingVersion`, `EtsyListingDailyStat`, `SeoExperiment`. |
| `20261015100400_stock_sync` | New tables `StockSettings`, `StockItem`, `StockLink`, `StockLedger`, `StockPush`, `StockObservation`, `StockSnapshot`. |

All five are additive: only `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE ... ADD COLUMN` (nullable or defaulted). There is no DROP, RENAME, type change or NOT-NULL-without-default. The combined SQL matches `prisma migrate diff` from HEAD's schema to the working schema statement for statement.

Check after the deploy:

```bash
ssh deploy@46.224.169.225 'cd /home/deploy/kolayxport && npx prisma migrate status'
```

## 2. Env vars and kill switches

No new env var is required. Everything below is optional. Set it in a systemd drop-in, or in `/home/deploy/kolayxport/.env`, then restart with `sudo systemctl restart kolayxport` (no `.service` suffix, because the sudoers rule matches it exactly).

| Var | Default | Effect |
|---|---|---|
| `KX_DISABLE_INPROCESS_JOBS=1` | unset (jobs ON in prod) | Master kill switch for the in-process scheduler (15 s tick), the Etsy webhook worker loop, the stock push kick and the notification dispatcher kick. Webhook ingest still kicks one worker pass per event. The GitHub cron (`*/2` webhook sweeper, `7,22,37,52` `run-job?due=1`, `*/15` sync-orders) keeps working. |
| `ETSY_WEBHOOK_WORKER=0` | unset | Turns off only the 5 s webhook worker loop; the scheduler keeps running. |
| `KX_INPROCESS_JOBS=1` | unset | Forces the jobs on outside production. Never set it on a dev machine whose `.env.local` points at prod. |
| `ETSY_DAILY_LIMIT` | 100000 | Fallback Etsy daily quota, used until the `x-limit-per-day` header has been seen. |
| `STOCK_SYNC_GLOBAL_DISABLE=1` | unset | Stock sync off for everyone: hooks do nothing and the push worker skips. |
| `STOCK_WIX_WRITE_VERIFIED=1` | unset | Allows Wix stock writes. Set it only after manually verifying them on a test product. |
| `KX_LIVE_TRANSPORT=local` | `pg` | Live events stay in-process (no Postgres LISTEN/NOTIFY). This is safe on a single instance, but publishes from scripts or cron routes in another process are then not delivered. |
| `TELEGRAM_BOT_TOKEN` | unset | Telegram channel. It does nothing until a chat-linking flow exists. |
| `POSTMARK_SERVER_TOKEN` / `POSTMARK_FROM_EMAIL` | already set | Notification emails. Unset them to stop all email; the deliveries are then marked failed (`NEEDS_SMTP_CONFIG`, no retry), and the in-app bell keeps working. Note that the same sender is used for auth emails (verification, password reset). |

`NEXTAUTH_SECRET` (existing) also signs the stock Go Live confirmation tokens. `lib/prisma.ts` is unchanged, and production `DIRECT_URL == DATABASE_URL`. The live bus uses one extra Postgres connection (`application_name='kx-live-listen'`); production has `max_connections=100` with about 15 in use.

## 3. Post-deploy one-off scripts (W4): dry run first, always

Run these on the VPS as `deploy`. They read the `.env` in the current directory and never `.env.local`. Each one prints the target DB host, then counts only, never PII. Writing requires `--apply`, `KX_ALLOW_PROD_WRITE=1` and a `--db-host` that matches the host the dry run printed.

```bash
ssh deploy@46.224.169.225
cd /home/deploy/kolayxport

# 1) Dry runs: read the "target host" line and the counts
npx tsx scripts/backfill-order-source-and-refs.ts
npx tsx scripts/normalize-legacy-order-statuses.ts
npx tsx scripts/close-stale-tracking-submissions.ts
npx tsx scripts/backfill-order-hashes.ts            # optional; writers fill NULL hashes lazily

# 2) Apply, in this order, once the dry-run counts look sane (HOST = the host printed above)
KX_ALLOW_PROD_WRITE=1 npx tsx scripts/backfill-order-source-and-refs.ts --apply --db-host=HOST
KX_ALLOW_PROD_WRITE=1 npx tsx scripts/normalize-legacy-order-statuses.ts --apply --db-host=HOST
KX_ALLOW_PROD_WRITE=1 npx tsx scripts/close-stale-tracking-submissions.ts --apply --db-host=HOST
# optional, safe at any time (does not re-arm alerts for old orders):
KX_ALLOW_PROD_WRITE=1 npx tsx scripts/backfill-order-hashes.ts --apply --db-host=HOST
```

All of them accept `--user=<id>` and `--limit=N`, so you can try one user first.

- **`backfill-order-source-and-refs`** fills `OrderItem.listingRef` and `variantRef`. Without it, old Etsy lines count as "unmatched" in stock sync and in the listing sales stats.
- **No backfill is needed for listing intel or stock.** The first nightly reconcile (02:30 UTC) writes one hidden baseline version per listing. Expect the first run to be slower than usual.

## 4. Verify after deploy

1. **Health and boot logs:**
   ```bash
   curl -fsS https://kolayxport.com/api/health
   ssh root@46.224.169.225 'journalctl -u kolayxport.service --since "10 minutes ago" --no-pager | grep -E "instrumentation|scheduler.started|kx-live|live.bus" | tail -20'
   ```
   You should see "In-process scheduler scheduled to start", then `scheduler.started`. A `CronLock` unique-constraint error is benign.
2. **Admin cockpit:** `/admin/monitoring` → "Etsy event backbone" card. The worker should show as running, the last pass a few seconds ago, and jobs should gain "Last success". `/api/cron/process-etsy-webhooks` should answer `skipped: worker_healthy`.
3. **Webhook queue (read-only):**
   ```sql
   SELECT status, count(*) FROM "WebhookEvent" WHERE provider='etsy' AND "createdAt" > now() - interval '1 hour' GROUP BY 1;
   SELECT "jobName", status, max("finishedAt") FROM "JobRun" GROUP BY 1,2 ORDER BY 1;
   SELECT * FROM "EtsyApiQuota" ORDER BY day DESC LIMIT 3;
   ```
4. **SSE stream with a session cookie.** Copy `__Secure-next-auth.session-token` from the browser's devtools (Application → Cookies). Keep it out of shell history, for example with `read -rs C`:
   ```bash
   read -rs C   # paste the cookie value, press Enter
   curl -sN -H "Cookie: __Secure-next-auth.session-token=$C" https://kolayxport.com/api/live/stream
   ```
   - **Expected:** response headers `text/event-stream`, `no-cache, no-transform` and `X-Accel-Buffering: no`. The body starts with `retry: 5000`, then a hello frame (`sync.status`, which carries `userKey` and `serverTime`), then `: ping` every 20 s.
   - **Without the cookie** the stream returns 401.
   - **Buffering check:** if nothing arrives for more than 20 s, nginx is buffering. Add the dedicated location from W6 "Ops notes". With nginx 1.24, write `listen 443 ssl http2;`, not `http2 on;`.
5. **End-to-end chime test:**
   - Keep `/app/labels` open in a signed-in tab and click once on the page; browsers block audio until then.
   - On the server, run the `pg_notify(...)` one-liner from W6 "Ops notes" with your user id. That tab and the curl stream should both receive `order.new`.
   - Then place, or wait for, a real Etsy order. It should appear within seconds without Sync. Check that `WebhookEvent` shows `done` and that the `Order` row has `source` set.
6. **Notifications:** `GET /api/notifications` still returns `{items, unreadCount}`. `/app/bildirimler` loads, and the Preferences tab saves.

## 5. Rollback plan

Every migration is additive, so the old code runs fine on the new schema. **A rollback never touches the database.** Do not drop the new tables or columns.

1. **Soft: behaviour off without a deploy.**
   - Set `KX_DISABLE_INPROCESS_JOBS=1`, and/or `STOCK_SYNC_GLOBAL_DISABLE=1`, and/or `KX_LIVE_TRANSPORT=local`, then run `sudo systemctl restart kolayxport`.
   - The GitHub crons keep orders and webhooks moving.
   - To stop notification email only, set every user's notification email preference off. Unsetting `POSTMARK_*` also stops auth emails.
2. **Hard: code rollback.**
   - Run `git revert <merge commit>` on `main` and push. The deploy workflow rebuilds and swaps `.next` atomically.
   - `prisma migrate deploy` is a no-op, because the migrations stay recorded and the old code ignores the extra columns and tables.
   - If the build itself is broken on the server, the previous `.next` stays live, because the swap only happens after a successful build.
3. **After a hard rollback:**
   - Webhook rows parked as `blocked_reauth` or `coalesced` are statuses the old processor does not pick up. Requeue them with `UPDATE "WebhookEvent" SET status='received', "nextAttemptAt"=now() WHERE provider='etsy' AND status IN ('blocked_reauth');`. This is a write, so it needs a deliberate decision.
   - `coalesced` rows were merged into a winner and need nothing.
4. **Stock sync per user:**
   - Users who went live can restore the 7-day Go Live snapshot from `/app/stok-senkron`. Restoring also turns sync off.
   - Otherwise `STOCK_SYNC_GLOBAL_DISABLE=1` stops every push immediately.

## 6. Not in this deploy / founder actions

- **Chrome extension 9.6.0** (`chrome-extension/manifest.json`) is built but **not published** (A1).
- **Before any seller leaves the stock dry run**, verify on a test listing:
  - that `is_enabled:false` keeps the quantity;
  - that shared-quantity PUTs are accepted;
  - whether Etsy restocks on cancel.

  See `docs/integration/parts/W2-stock-sync.md` §7.
- **Amazon and Hepsiburada stock** are "coming soon" stubs. **Wix stock writes** are gated by `STOCK_WIX_WRITE_VERIFIED`.
- **Finance (W1 T15):** receipts stay as Sale net of tax and refunds come only from the ledger. This deliberately deviates from the spec to avoid double-subtracting about $10.5k in refunds. To switch to the spec's version, change one line in `lib/etsy/receiptFinance.ts`.

# W1-etsy-backbone — integration notes

W1 did not edit any presentation file owned by the UI session. `pages/admin/monitoring.tsx` is a W1-owned file per the spec (it is not under `pages/app/*`), so the new admin card is mounted there directly.

## 1. What landed

| Area | Files |
|---|---|
| Etsy HTTP + rate budget | `lib/etsy/http.ts`, `lib/etsy/rateBudget.ts` |
| Token refresh (DB lease) | `lib/etsy/etsyToken.ts`, `lib/integrations/etsyClient.ts` |
| Webhook queue | `lib/etsy/webhooks/{events,worker,processor,queueOps,legacyListingHandler}.ts`, `pages/api/webhooks/etsy.ts`, `pages/api/cron/process-etsy-webhooks.ts` |
| Scheduler | `lib/scheduler/{index,runs,jobs,coreJobs}.ts`, `pages/api/cron/run-job.ts`, `instrumentation-node.ts`, `.github/workflows/cron-jobs.yml` |
| Draft sync safety | `lib/etsy/draftService.ts`, `lib/etsy/inventoryMerge.ts` |
| Raw fetch → etsyFetch | `pages/api/ext/research.ts`, `pages/api/cron/track-ranks.ts`, `lib/etsy/listingStats.ts`, `pages/api/clawd/etsy-video-upload.ts` |
| EtsyClient priorities | `pages/api/finance/settlements.ts`, `pages/api/admin/backfill-etsy-tracking.ts`, `pages/api/admin/verify-etsy-finance.ts` (Reconcile), `pages/api/tracking/etsy.ts` (Critical) |
| Finance mapping | `lib/etsy/receiptFinance.ts` (used by settlements) |
| Admin cockpit | `lib/admin/monitoring.ts`, `pages/api/admin/monitoring/etsy-webhooks.ts` (new), `components/etsy-ops/EtsyBackboneCard.tsx` (new), `pages/admin/monitoring.tsx` |
| Process-wide state | `lib/processState.ts` (globalThis singletons shared by the API and instrumentation bundles) |
| i18n | `messages/fragments/etsyOps.{en,tr}.json` |

## 2. Runtime switches (A4)

The in-process scheduler (15 s tick) and the Etsy webhook worker loop (5 s) are **on by default in production**. They start from `instrumentation-node.ts` 10 s after boot, once the credential key has loaded.

| Env | Effect |
|---|---|
| (none) | `NODE_ENV=production`: scheduler and worker run. |
| `KX_DISABLE_INPROCESS_JOBS=1` | Kill switch for both. The ingest kick still runs one worker pass per stored webhook. GitHub cron keeps sweeping. |
| `ETSY_WEBHOOK_WORKER=0` | Turns off only the 5 s worker loop. The scheduler, the ingest kick and the `etsy-webhook-sweep` job still run. |
| `KX_INPROCESS_JOBS=1` | Forces the jobs on outside production. A local `next dev` stays off by default, because `.env.local` can point at prod. |
| `ETSY_DAILY_LIMIT` | Optional fallback daily limit used before Etsy's `x-limit-per-day` header has been seen. The default is 100000. |

They never start during `next build` (`NEXT_PHASE`) or in the edge runtime. `lib/prisma.ts` is unchanged (A4: in prod `DIRECT_URL == DATABASE_URL`, so the pool is not forced to 1).

The safety nets stay in place:

- **Webhook sweeper.** The `*/2` GitHub sweeper still calls `/api/cron/process-etsy-webhooks`. That endpoint returns `{skipped:'worker_healthy'}` while the in-process loop is healthy; `?force=1` overrides it.
- **Scheduler fallback.** A new GitHub `run-due` job on `7,22,37,52 * * * *` calls `/api/cron/run-job?due=1`. JobRun claims are atomic, so it never double-runs a bucket the in-process scheduler already ran.

## 3. Contracts for the other workstreams

### W4 (orders)

- The worker calls `handleEtsyOrderEvent({...ctx, receiptId})` for every `receipt:` resource, and for every event whose types include `order.*` or `reconcile.order`.
- `ctx.eventTypes` is the **union** of the coalesced rows, so `paid+shipped` arrives as one call with both types.
- The handler runs under `withEtsyBudget({ priority: Critical, deferOn429: true })`. Nested contexts now **inherit** (shop, user, deferOn429), and Critical is **sticky**: neither a nested `withEtsyBudget({ priority: Webhook })` nor an explicit `etsyFetch(..., { priority: Webhook })` can downgrade a Critical chain (`mergeEtsyPriority` in `lib/etsy/rateBudget.ts`). So order fetches inside the worker are never subject to the per-shop P1+P2 cap or the 85% gate, and a 429/5xx defers instead of sleeping.
- Still, **pass `EtsyPriority.Critical` explicitly** for the new-order receipt GET in `handleEtsyOrderEvent` (see Cross-workstream issues), so the call is P0 even if it is ever invoked outside the worker.
- `handleEtsyOrderEvent` / `upsertEtsyReceipt` publish the live order event themselves (`publishOrderEvent`, `lib/orders/etsyLifecycle.ts`); the worker does not publish order events.
- Throwing behaviour:
  - Throw `EtsyDeferError` to re-queue without consuming an attempt.
  - An error with `code === 'ETSY_REAUTH_REQUIRED'` parks the event in `blocked_reauth`.
  - Any other error retries with backoff `30s, 2m, 10m, 30m, 2h, 6h…`, and after 10 attempts the event becomes `failed` and `notifyAdmins(webhookBacklog)` fires.
- Construct `EtsyClient` with `{ ..., userId, priority: EtsyPriority.Critical }`. `EtsyPriority` is re-exported from `lib/integrations/etsyClient.ts`. The `onTokenRefresh` callback is now ignored, because tokens are persisted by `lib/etsy/etsyToken.ts`.
- The `etsy-orders-incremental`, `etsy-orders-reconcile`, `order-effects-drain` and other jobs in `lib/orders/jobs.ts` are picked up automatically by `lib/scheduler/jobs.ts`.
- For the sync-orders gate use `getLastSuccessfulRun('etsy-orders-incremental')` from `lib/scheduler/runs.ts`.
- Remaining raw Etsy fetches in W4 files that should move to `etsyFetch`: `pages/api/orders/[orderId]/submit-tracking.ts` (lines ~171, ~811, ~857, ~1034).

### W3 (listings)

- **Dispatch.** Listing, inventory and `reconcile.changed` events go to `handleEtsyListingEvent`. While that handler answered the W0 stub note `stub:…`, the worker fell back to `lib/etsy/webhooks/legacyListingHandler.ts`, which is today's behaviour. W3's real handler is now in the tree, so the fallback is dead. Delete `legacyListingHandler.ts` and the `stub:` branch in `worker.ts` `dispatch()` once W3 is merged.
- **`draftService.refreshListingCache`** now delegates to `refreshListingFull` with `source:'draft_sync'`, `draftId` and `syncAttemptId`, and stores `remoteUpdatedTimestamp` and `etsyListingId` on the `EtsyDraftSyncAttempt`.
  - A re-entrancy guard falls back to `legacyRefreshListingCache` when `refreshListingFull` calls back into `refreshListingCache` (the W0 stub did this).
  - W3 code must not call `refreshListingCache` from inside `refreshListingFull`.
- **Callback (`pages/api/integrations/etsy/callback.ts`, W3 T9).** On reconnect, set `needsReauth=false, needsReauthAt=null` and call `requeueBlockedEtsyEvents(shopId)`.
  - Backup: `getEtsyAccessToken` and the worker treat a shop as unblocked once its stored token was **issued** after `needsReauthAt` (estimated `tokenExpiresAt − 1 h > needsReauthAt`, i.e. a reconnect wrote a fresh token). They then clear the flag and requeue by themselves. On `invalid_grant` the token code also sets `tokenExpiresAt = needsReauthAt`, so a dead-but-unexpired token can never look like a reconnect, and a flagged shop never gets its old access token back (`ETSY_REAUTH_REQUIRED` until reconnect).
  - The callback still does its own raw `fetch` to `users/me` and `users/{id}/shops`; those can move to `etsyFetch`. The OAuth code exchange POST is the allowed exception.
- **Synthetic events.** Use `enqueueSyntheticEtsyEvent({ shopId, userId, resourceKey: 'listing:<id>', eventType: 'reconcile.changed', priority: 2 })`.
- **Remaining raw fetches in `pages/api/clawd/etsy.ts`.** The upload fetches near lines 2111, 2394, 2501 and 3118 should use `etsyFetch`. The CDN downloads can stay as they are.

### W2 (stock)

- **Draft inventory sync.** `syncDraft` now runs the inventory step inside `withListingInventoryLock(String(listingId))`:
  1. A fresh `GET /listings/{id}/inventory`.
  2. Quantities the user did not change take the fresh remote value. "Did not change" = draft qty equals the product's `kx_loaded_quantity` (the quantity the editor loaded, see Cross-workstream issues) or, for products without that marker, the base-snapshot qty. See `lib/etsy/inventoryMerge.ts`. If the fresh GET fails and the draft can be merged (base inventory or markers present), the attempt fails and the draft is kept — stale quantities are never PUT.
  3. `applyStockToEtsyDraftInventory({ userId, shopId, listingId, actorUserId, products, userChangedVariantKeys })`.
  4. Sanitize, then PUT.
- **`userChangedVariantKeys`** holds the **unfolded** `etsyVariantKeys(pairsFromEtsyProduct(product)).variantKey` of the products passed to the hook (`reportedVariantKey` in `inventoryMerge.ts`) — identical to W2's `productVariantKey(product)`. Property 508 is folded to 513 only internally for base/draft/fresh matching. `kx_loaded_quantity` is stripped from the products before the hook sees them.
- **If the hook throws.** When `isListingStockManaged(...)` is true (or itself throws), the sync fails with `EtsyDraftError('STOCK_OVERRIDE_FAILED', key 'draftSync.stockOverrideFailed', 409)` and the draft is kept. Otherwise it logs and continues.
- **Attempt result.** The `EtsyDraftSyncAttempt.result` gains `stockOverrides` and `freshQuantities`.
- **Base inventory.** Draft base snapshots now come from `GET /listings/{id}?includes=Inventory`, falling back to the plain listing on a 400. Older drafts without `baseSnapshot.inventory` keep today's "write what was staged" behaviour.
- **Stock pushes.** They must take the same `withListingInventoryLock` and use `etsyFetch` / `callEtsyAPI` from `lib/etsy/http.ts` (priority `Critical` for decreases is reasonable).

### W5 (notifications)

The worker and the `etsy-queue-health` job call `notifyAdmins` with these fields:

```ts
{
  type: 'webhookBacklog',
  severity: 'warning' | 'error',
  titleKey: 'types.webhookBacklog',
  params: { due, failed, oldestMinutes },
  link: '/admin/monitoring',
  dedupeKey: 'webhookBacklog:<YYYY-MM-DDTHH>',
  onlyIfNew: true,
}
```

Your existing `notificationCenter.types.webhookBacklog` string fits; the params are available if you want to show them.

The token code calls `notify(reauthRequired)` exactly as before. It also calls `publishLive(userId, { type: 'connection', kind: 'reauth_required', provider: 'etsy', accountId: shopId })`.

### W6 (live)

Nothing to do. W1 only publishes the `connection/reauth_required` event above. Order live events come from W4.

## 4. i18n

`messages/fragments/etsyOps.{en,tr}.json` holds the namespace `etsyOps` (common, backbone, status), used by `components/etsy-ops/EtsyBackboneCard.tsx`. The keys are identical in en and tr.

**One leaf must be placed under the existing `etsy` namespace.** The UI resolves `EtsyDraftError.key` relative to `etsy`:

| Fragment key | Place at |
|---|---|
| `etsyOps.draftSync.stockOverrideFailed` | `etsy.draftSync.stockOverrideFailed` (keep or drop the `etsyOps` copy) |

Until the fragments are merged, the admin card shows raw keys. Only admins see it.

## 5. Admin cockpit

- **`GET /api/admin/monitoring/etsy-webhooks`** (admin) returns:
  - `depthByStatus` (received, processing, blocked_reauth, coalesced, failed, done, ignored);
  - `oldestDueAgeMs`, `lastReceivedAt`, `backlogByShop` (top 20), `failed24h`, `recentFailed`;
  - `budget` (the `getBudgetSnapshot()` result), `worker` (loop status, last pass, in-flight, totals) and `jobs` (every registered job: last success, running, last failure and error).
- **`POST {action:'replay', ids?:string[], shopId?:string}`** moves `failed` rows back to `received` with attempts 0, and records `etsy_webhooks.replay` in AdminAuditLog.
- **`getIntegrationHealth().etsyWebhooks`** (the existing card) carries the same extended fields. The needs-attention queue now flags due events older than 10 min and parked `blocked_reauth` events.
- **`EtsyBackboneCard`** is mounted full-width on `/admin/monitoring`. It is mobile-first: stacked rows and expandable lists, no tables.

## 6. Finance mapping (T15): deviation from the spec, with evidence

The spec asked for canceled / fully refunded receipts to become `'Return'` with 0 net. I did **not** do that, because it would double count:

- **How the dashboard aggregates.** `pages/api/finance/dashboard.ts` counts receipt `Sale` rows as revenue and ledger `Refund` rows (`refund_gross`, …) as returns. A `Return` row would also count as a return.
- **What production holds (read-only query, 2026-10-15).**
  - 148 ledger `Refund` rows; they carry no receipt link.
  - 71 `canceled`, 6 `fully refunded` and 23 `partially refunded` receipts, all stored as `Sale`.
  - 0 `Return` rows.
- **Why "Return with 0 net" double counts.** The ledger refund for a cancelled order already offsets its sale. Dropping the sale revenue would push net profit down by the refund a second time, about $10.5k historically.
- **What shipped instead.**
  - Every receipt is a `Sale` net of sales tax. Refunds come only from the ledger.
  - The dead `refunded|returned → Return(-amount)` branch is removed. It would have double counted, and Etsy v3 never returns those statuses.
  - Historical totals do not change.
- **Follow-up for the dashboard owner.** If cancelled orders should not count in `orderCount`, the dashboard can exclude `Sale` rows whose `rawData.status` is canceled or fully refunded (`isEtsyReceiptCancelledOrRefunded` in `lib/etsy/receiptFinance.ts`).

## 7. Other deviations

- **Process-wide state on `globalThis`.** Next compiles instrumentation and API routes against separate webpack runtimes. All W1 per-process state now lives on `globalThis` under `Symbol.for('kolayxport.processState.<name>')` (`lib/processState.ts`): the inventory lock table, the rate budget (counters, remote quota, pending deltas, token bucket, ALS instance), the webhook worker state, the scheduler's running-job registry, memo and shutdown controller, the scheduler tick state, and the legacy credential locks. Draft syncs (API bundle) and stock pushes (scheduler/instrumentation bundle) therefore share one inventory lock per listing, and `/admin/monitoring` sees the real worker/scheduler status. Other workstreams with process-wide state should use `processState()` too.
- **Scheduler timeouts.** A job that runs past its timeout is recorded as failed in JobRun, but stays registered as running in this process until its body actually returns, so it is never started a second time while the first body is still running.

- **T6 (`PRISMA_CONNECTION_LIMIT`) skipped.** A4 says to leave `lib/prisma.ts` alone.
- **T10 flags inverted per A4.** The jobs are on by default, with a kill switch instead of an opt-in flag.
- **The worker is continuous, not pass-bound.** Each pass claims only up to free capacity (6 global, 2 per shop) and returns; each finished event kicks the next pass. A slow handler, such as the W0 order stub's `syncAllOrders`, never holds back a new order event.
- **Kick timing.** An order webhook kicks after 500 ms. Listing events kick after 3 s, so `listing.updated` and `inventory.updated` coalesce. An earlier kick replaces a later one.
- **Credential-only (legacy) shops.** Their token refresh uses an in-process per-shop mutex and a re-read instead of the advisory-lock transaction, so no network I/O runs inside a DB transaction.
- **Dedupe.** `notifyOutOfStock` (legacy fallback only) now dedupes on `note` as well as `errorMessage`. Worker notes go to `WebhookEvent.note`, and `errorMessage` holds only errors.
- **No DB-backed tests.** `test/db/*` and docker were not built, per the hard rules. The claim SQL, JobRun `ON CONFLICT` and the token lease are covered by mocked unit tests only. Run real-Postgres checks before relying on them under concurrency.

## 8. Rollout checklist (after merge + deploy)

1. In `journalctl -u kolayxport`, look for `[instrumentation] In-process scheduler scheduled to start` and then the `scheduler.started` log event.
2. On `/admin/monitoring`, the Etsy event backbone card should show the loop "running", a last pass within seconds, and jobs gaining "Last success".
3. Confirm `/api/cron/process-etsy-webhooks` answers `skipped: worker_healthy`, and `/api/cron/run-job?due=1` returns statuses.
4. Watch `EtsyApiQuota` fill with Etsy's headers after the first calls: `SELECT * FROM "EtsyApiQuota" ORDER BY day DESC LIMIT 3;`.
5. To roll back the behaviour without a deploy, set `KX_DISABLE_INPROCESS_JOBS=1` in a systemd drop-in and restart. The ingest kick and the GitHub sweeper keep the queue moving.

## Cross-workstream issues

### W4 — `lib/orders/etsyLifecycle.ts` (not a W1 file)

- `handleEtsyOrderEvent` (~line 373) calls `fetchEtsyReceiptRaw(userId, shopId, String(receiptId), EtsyPriority.Webhook)`. Change it to `EtsyPriority.Critical` (and consider making `Critical` the default of `fetchEtsyReceiptRaw`). W1 already neutralises the downgrade inside the worker (Critical is sticky in `withEtsyBudget` / `etsyFetch`), but outside a Critical context a P1 call is subject to the per-shop cap and the 85% gate, which defer to 00:05 UTC the next day — new orders would stop appearing live (A2).

### UI session — `components/etsy/VariationEditor.tsx` (presentation file, not edited)

The draft sync now honours an optional per-product field **`kx_loaded_quantity`** in the staged inventory patch: the quantity the seller started from for that variant. With it, the sync can tell "seller restocked back to the old value" apart from "seller did not touch this variant" (without it, the first case is resolved to the fresh, lower Etsy quantity — oversell-safe but it drops the restock). The field is stripped before the Etsy PUT and before the stock hook.

In `fetchInventory` (~line 730) keep the live inventory response (`data`) and the pending draft (`pendingDraft`) around (e.g. in refs). In the save handler, right before `stageEtsyDraft(...)` (~line 1340), stamp each product of `productsToSave`:

```ts
// Match products by variant tuple (property_id + values), not product_id.
const tupleKey = (p: any) => JSON.stringify(
  (p.property_values || [])
    .map((pv: any) => [Number(pv.property_id) === 508 ? 513 : Number(pv.property_id), (pv.values || []).map((v: any) => String(v).trim().toLowerCase())])
    .sort((a: any, b: any) => a[0] - b[0]),
);
const liveByKey = new Map((liveInventoryRef.current?.products || []).filter((p: any) => !p.is_deleted).map((p: any) => [tupleKey(p), p]));
const stagedByKey = new Map((pendingDraftRef.current?.inventoryPatch?.products || []).map((p: any) => [tupleKey(p), p]));
const originalByKey = new Map(originalProducts.map((p: any) => [tupleKey(p), p]));
const stamped = productsToSave.map((p: any) => {
  const k = tupleKey(p);
  const staged = stagedByKey.get(k);
  // 1) Carry over a marker from an earlier staging unchanged (never overwrite it).
  if (staged && staged.kx_loaded_quantity !== undefined && staged.kx_loaded_quantity !== null) {
    return { ...p, kx_loaded_quantity: staged.kx_loaded_quantity };
  }
  // 2) No pending draft: the editor showed the live Etsy quantity -> that is the starting point.
  if (!pendingDraftRef.current) {
    const live = liveByKey.get(k);
    const q = live?.offerings?.find((o: any) => !o.is_deleted)?.quantity;
    return q === undefined || q === null ? p : { ...p, kx_loaded_quantity: Number(q) };
  }
  // 3) Legacy pending draft without markers: only stamp variants the seller edited in this
  //    session, with the value shown before the edit; untouched ones fall back to the base snapshot.
  const orig = originalByKey.get(k);
  const before = orig?.offerings?.[0]?.quantity;
  const now = p.offerings?.[0]?.quantity;
  return before !== undefined && Number(before) !== Number(now) ? { ...p, kx_loaded_quantity: Number(before) } : p;
});
await stageEtsyDraft({ shopId, listingId, inventory: { products: stamped, price_on_property, quantity_on_property, sku_on_property } });
```

Also make sure `sanitizeProducts` (used when loading a pending draft) does not drop `kx_loaded_quantity`, so rule 1 can carry it over. New variations (no live match) get no marker and keep the staged quantity, as today. No i18n strings are involved.


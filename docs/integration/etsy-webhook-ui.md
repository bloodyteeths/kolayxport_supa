# Etsy webhook backbone, live orders, stock sync, listing intel, notifications — UI integration

**Audience:** the UI rebuild session (`mybaby-sync-product-03`), which owns the presentation files: `pages/app/*` (existing), `pages/_app.tsx`, `pages/ayarlar.tsx`, `components/**` (existing), `lib/hooks/*`, `messages/en.json`, `messages/tr.json` and the theme files.

The backend workstreams W0–W6 did not edit any of those files, except for the i18n merge described below. Every change those files need is written up in the per-workstream sections that follow, with the file, location, exact snippet, props and i18n keys. This file joins `docs/integration/parts/*.md` (W0 to W6) together. Each section is unchanged from its source file.

**Already done by the integrator (no action):**
- **i18n merged.** `messages/en.json` and `messages/tr.json` gained 7 new top-level namespaces: `etsyOps`, `listingHistory`, `liveOrders`, `notificationCenter`, `orderPipeline`, `seoExperiments` and `stockSync`.
  - New notification type texts were added under `notifications.types.*`.
  - One extra key, `etsy.draftSync.stockOverrideFailed`, was added.
  - No existing key was changed. Rebase or merge your copy of both files, and do not overwrite them with an older version.
- **New pages** already exist and only need nav entries: `/app/stok-senkron` (W2), `/app/etsy-aktivite` (W3) and `/app/bildirimler` (W5).
- **New components** live in their own directories: `components/live`, `components/orders-live`, `components/stock`, `components/etsy-history`, `components/etsy-seo`, `components/notification-center` and `components/etsy-ops`.

## Ordered checklist

Do the REQUIRED items first. Items 1 and 2 make the founder's acceptance test pass: a new Etsy order chimes and appears without a refresh. Item 4 unblocks labels for cancelled orders, which are blocked from the moment the backend deploys.

1. **REQUIRED. `pages/_app.tsx`:** mount `<LiveAppMount ordersPath="/app/labels" />` once, right after `<Toaster/>`. See W6 §1. Do **not** mount the provider in AppLayout.
2. **REQUIRED. `components/AppLayout.js`:** put `<LiveSoundToggle/>` immediately before `<NotificationBell/>`. See W6 §1.
3. **REQUIRED. `pages/app/etsy-listings.tsx`:** add live refresh with no manual sync, using the DB-only refetch (W3 §2b and W6 §3). Never call `fetchListings()` or `listings_with_images` from a live event.
4. **REQUIRED. Label drawers and the labels page:**
   - `UPSLabelDrawer.tsx` and `MngLabelDrawer.tsx`: on HTTP 409 `ORDER_CANCELLED` or `ORDER_SHIPPED_EXTERNALLY`, open `CancelledOrderLabelDialog`, and on confirm retry with `forceCancelled: true` (W4 §2a and §2b).
   - `pages/app/labels.tsx`: the same handling for FedEx (W4 §2c).
5. **REQUIRED. `components/NotificationBell.tsx` and `lib/hooks/useNotifications.ts`:**
   - Swap the bell list for `NotificationPanel` (W5 §2).
   - Send the `X-KX-Locale` header (W5 §3).
   - Do not play a sound on `notification.raised` for orders, because the chime comes from W6 (W5 §9).
   - Note that `unreadCount` now counts only rows with `badge=true`.
6. **REQUIRED. Nav and Cmd+K entries in `components/AppLayout.js`:**
   - `/app/stok-senkron` (`stockSync.pageTitle`; W2 §1a)
   - `/app/etsy-aktivite` (W3 §3)
   - `/app/bildirimler` (`nav.notifications`; W5 §4)
7. **RECOMMENDED. `components/etsy/VariationEditor.tsx`:**
   - Show the managed-quantity chip for variants that stock sync manages, and skip them in bulk quantity apply (W2 §1b).
   - Stamp `kx_loaded_quantity` before `stageEtsyDraft` (W1 "Cross-workstream issues"), so a restock back to the old value is not lost.
8. **RECOMMENDED. `components/etsy/ListingEditorDrawer.tsx`:**
   - Add a History tab with `ListingHistoryPanel`, and use `applyRestoredDraft` on restore (W3 §1).
   - Also overlay a server draft's `fieldPatch` when the drawer opens (W3 §10). This is a pre-existing data-loss bug.
9. **RECOMMENDED. `pages/app/labels.tsx`:**
   - Add `useOrderLifecycleFlags` and `OrderLifecycleBadges` next to the ship-by chip (W4 §2c).
   - Highlight `?highlight=<orderId>` and add the "New" chip for live arrivals (W6 §2).
   - Any "label exists" check must treat `labelStatus === 'voided'` as no label (W4 §8).
10. **RECOMMENDED. `pages/app/index.js`:** mount `DispatchHealthCard` (W4 §2d).
11. **OPTIONAL. `pages/app/etsy-listings.tsx`:** add the freshness chip next to "Sync from Etsy" (W3 §2a) and a warning toast for `data.partial` (W3 §2d).
12. **OPTIONAL. `pages/ayarlar.tsx`:** add a link to `/app/bildirimler?tab=preferences` (W5 §5).

Verification after your changes:
- Open `/app/labels` in two tabs and click once anywhere in one of them.
- Run the `pg_notify` smoke test from W6 "Ops notes". You should hear one chime and see one toast, and both tabs should refresh.

---


<!-- source: docs/integration/parts/W0-contracts.md -->

## W0-contracts — schema, migrations, contract stubs

No presentation file needs to change for W0. This file records what W0 landed so the integrator and the other workstreams agree on it.

### Conventions for every workstream

- **Presentation changes**: write them to `docs/integration/parts/<workstream>.md` (file, location, exact JSX/code, props, i18n keys). Do not edit presentation files yourself.
- **i18n**: put strings in `messages/fragments/<namespace>.en.json` and `<namespace>.tr.json`. Each fragment is a JSON object whose single top-level key is the namespace, e.g. `{ "stockSync": { ... } }`. The allowed new namespaces are `liveOrders`, `stockSync`, `listingHistory`, `seoExperiments`, `orderPipeline`, `etsyOps` and `notificationCenter`. The integrator merges each one as a new top-level key of `messages/en.json` and `messages/tr.json`.
- **New notification types**: texts go in `messages/fragments/notificationCenter.*.json` under `notificationCenter.types.<type>`. The integrator places them at `notifications.types.<type>`, because `titleKey` resolves under the `notifications` namespace. Emitters use `titleKey: 'types.<type>'`.

### Migrations (additive only; generated with `prisma migrate diff`, no DB touched)

| Migration | Contents |
|---|---|
| `20261015100000_etsy_event_backbone` | `WebhookEvent` gets eventTypes, priority, processingStartedAt, heartbeatAt, firstReceivedAt, note, deferrals and 2 indexes. `EtsyShop` gets poll/reconcile cursors, needsReauth/needsReauthAt and tokenRefreshLeaseUntil. `EtsyDraftSyncAttempt` gets remoteUpdatedTimestamp, etsyListingId and an index. New tables: `EtsyApiUsage`, `EtsyApiQuota`, `JobRun`. |
| `20261015100100_notification_center_v2` | `Notification` gets entityType, entityId, badge (default true), raiseCount and 2 indexes. New tables: `NotificationDelivery`, `NotificationPreference`, `NotificationSettings`. |
| `20261015100200_order_lifecycle` | `Order` gets source, cancelledAt, deliveredAt, shipByAt, shippedLate, returnWindowEndsAt, orderHash, itemsHash, lastEventAt, lastRemoteCheckAt and 4 indexes. `OrderItem` gets listingRef, variantRef, variantValueKey and an index. `Shipment` gets voidedAt, voidError, voidMethod. `TrackingSubmission` gets closedReason, closedAt. New table: `OrderEffect`. |
| `20261015100300_etsy_listing_intel` | `EtsyListing` gets hasVariations, quantityOnProperty, inventorySyncedAt, contentHash, lastWebhookAt, lastRefreshAt, stateChangedAt. New tables: `EtsyListingOffering`, `EtsyListingVersion`, `EtsyListingDailyStat`, `SeoExperiment`. |
| `20261015100400_stock_sync` | New tables: `StockSettings` (enabled=false, dryRun=true by default), `StockItem`, `StockLink`, `StockLedger`, `StockPush`, `StockObservation`, `StockSnapshot`. |

The timestamps differ from the spec's `20261015090x00`, because `20261015090000_notifications` already exists and is applied in production. No FK constraints are emitted (`relationMode = "prisma"`).

### Contract modules (final signatures; bodies are safe no-ops until the owner lands)

| File | Owner | W0 behaviour |
|---|---|---|
| `lib/etsy/http.ts` | W1 | `etsyFetch(url, init?, opts?)` and `callEtsyAPI` delegate to draftService. `etsyAuthHeaders` is real. `recordEtsyResponse` is a no-op. |
| `lib/etsy/rateBudget.ts` | W1 | `EtsyPriority` enum. `withEtsyBudget` runs fn, `canSpend` returns ok, `currentEtsyPriority` returns Interactive, `getBudgetSnapshot` returns empty. |
| `lib/etsy/inventoryLock.ts` | W1 | Fully working keyed mutex (60 s wait cap, throws `EtsyDeferError('lock_busy')`). |
| `lib/etsy/webhooks/types.ts` | W1 | Full: `EtsyEventContext`, `HandlerOutcome`, `EtsyDeferError`, `EtsyRateLimitedError`, `isEtsyDeferError`. |
| `lib/etsy/webhooks/queueOps.ts` | W1 | `requeueBlockedEtsyEvents` returns 0. `enqueueSyntheticEtsyEvent` is a no-op. |
| `lib/scheduler/{types,runs,jobs}.ts` | W1 | `ScheduledJob` type. `getLastSuccessfulRun` returns null, `runDueJobs` returns [], `allJobs` concatenates the 4 empty arrays. |
| `lib/etsy/variantKey.ts` | W3 | Full: `etsyVariantKeys`, `etsyQuantityKey`, `pairsFromEtsyProduct`, `sha1Hex` (pure JS, isomorphic). |
| `lib/etsy/listingCache.ts` | W3 | `refreshListingFull` calls `refreshListingCache` (404 returns deleted:true). `handleEtsyListingEvent` returns ignored. `ensureListingsCached` returns 0. `reconcileShopListings` throws `not_implemented`. |
| `lib/etsy/listingJobs.ts` | W3 | `listingJobs = []` |
| `lib/stock/types.ts` | W2 | Full types. |
| `lib/stock/normalize.ts` | W2 | Full: `normalizeSku`, `foldSkuLoose`. |
| `lib/stock/hooks.ts` | W2 | All disabled no-ops. `applyStockToEtsyDraftInventory` returns products unchanged. |
| `lib/stock/jobs.ts` | W2 | `stockJobs = []` |
| `lib/orders/etsyLifecycle.ts` | W4 | `handleEtsyOrderEvent` mirrors today's processor `handleOrder`. The other three functions throw `not_implemented`. |
| `lib/orders/labelGuard.ts` | W4 | `assertOrderLabelable` returns `{ ok: true }`. |
| `lib/orders/jobs.ts` | W4 | `orderJobs = []` |
| `lib/notificationCenter/jobs.ts` | W5 | `notificationJobs = []` |
| `lib/notifications.ts` | W5 | Widened: 17 new `NotificationType` literals; `NotifyInput.entity` / `badge` / `escalateOn` (accepted, ignored); `notifyAdmins(input)`. |
| `lib/live/types.ts` | W6 | Final `LiveEvent` union and `LiveEnvelope`; isomorphic. |
| `lib/live/publish.ts` | W6 | `publishLive` is a no-op. `publishOrderEvent` builds the final event via `buildOrderLiveEvent`. Neither ever throws. |

### Live events (W6) — how emitters call them

```ts
import { publishLive, publishOrderEvent } from '@/lib/live/publish';
publishOrderEvent(userId, orderRow, 'new');            // after the order row commits (W4)
publishLive(userId, { type: 'notification', action: 'raised', notification: item }); // in notify() (W5)
publishLive(userId, { type: 'listing', kind: 'deactivated', marketplace: 'etsy', shopId, listingId: String(id) }); // W3
publishLive(userId, { type: 'stock', kind: 'changed', stockItemId, sku, onHand });  // W2
```

The SSE transport (W6) must send the headers `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`, plus a heartbeat comment every `LIVE_HEARTBEAT_MS` (20 s).

---

<!-- source: docs/integration/parts/W1-etsy-backbone.md -->

## W1-etsy-backbone — integration notes

W1 did not edit any presentation file owned by the UI session. `pages/admin/monitoring.tsx` is a W1-owned file per the spec (it is not under `pages/app/*`), so the new admin card is mounted there directly.

### 1. What landed

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

### 2. Runtime switches (A4)

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

### 3. Contracts for the other workstreams

#### W4 (orders)

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

#### W3 (listings)

- **Dispatch.** Listing, inventory and `reconcile.changed` events go to `handleEtsyListingEvent`. While that handler answered the W0 stub note `stub:…`, the worker fell back to `lib/etsy/webhooks/legacyListingHandler.ts`, which is today's behaviour. W3's real handler is now in the tree, so the fallback is dead. Delete `legacyListingHandler.ts` and the `stub:` branch in `worker.ts` `dispatch()` once W3 is merged.
- **`draftService.refreshListingCache`** now delegates to `refreshListingFull` with `source:'draft_sync'`, `draftId` and `syncAttemptId`, and stores `remoteUpdatedTimestamp` and `etsyListingId` on the `EtsyDraftSyncAttempt`.
  - A re-entrancy guard falls back to `legacyRefreshListingCache` when `refreshListingFull` calls back into `refreshListingCache` (the W0 stub did this).
  - W3 code must not call `refreshListingCache` from inside `refreshListingFull`.
- **Callback (`pages/api/integrations/etsy/callback.ts`, W3 T9).** On reconnect, set `needsReauth=false, needsReauthAt=null` and call `requeueBlockedEtsyEvents(shopId)`.
  - Backup: `getEtsyAccessToken` and the worker treat a shop as unblocked once its stored token was **issued** after `needsReauthAt` (estimated `tokenExpiresAt − 1 h > needsReauthAt`, i.e. a reconnect wrote a fresh token). They then clear the flag and requeue by themselves. On `invalid_grant` the token code also sets `tokenExpiresAt = needsReauthAt`, so a dead-but-unexpired token can never look like a reconnect, and a flagged shop never gets its old access token back (`ETSY_REAUTH_REQUIRED` until reconnect).
  - The callback still does its own raw `fetch` to `users/me` and `users/{id}/shops`; those can move to `etsyFetch`. The OAuth code exchange POST is the allowed exception.
- **Synthetic events.** Use `enqueueSyntheticEtsyEvent({ shopId, userId, resourceKey: 'listing:<id>', eventType: 'reconcile.changed', priority: 2 })`.
- **Remaining raw fetches in `pages/api/clawd/etsy.ts`.** The upload fetches near lines 2111, 2394, 2501 and 3118 should use `etsyFetch`. The CDN downloads can stay as they are.

#### W2 (stock)

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

#### W5 (notifications)

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

#### W6 (live)

Nothing to do. W1 only publishes the `connection/reauth_required` event above. Order live events come from W4.

### 4. i18n

`messages/fragments/etsyOps.{en,tr}.json` holds the namespace `etsyOps` (common, backbone, status), used by `components/etsy-ops/EtsyBackboneCard.tsx`. The keys are identical in en and tr.

**One leaf must be placed under the existing `etsy` namespace.** The UI resolves `EtsyDraftError.key` relative to `etsy`:

| Fragment key | Place at |
|---|---|
| `etsyOps.draftSync.stockOverrideFailed` | `etsy.draftSync.stockOverrideFailed` (keep or drop the `etsyOps` copy) |

Until the fragments are merged, the admin card shows raw keys. Only admins see it.

### 5. Admin cockpit

- **`GET /api/admin/monitoring/etsy-webhooks`** (admin) returns:
  - `depthByStatus` (received, processing, blocked_reauth, coalesced, failed, done, ignored);
  - `oldestDueAgeMs`, `lastReceivedAt`, `backlogByShop` (top 20), `failed24h`, `recentFailed`;
  - `budget` (the `getBudgetSnapshot()` result), `worker` (loop status, last pass, in-flight, totals) and `jobs` (every registered job: last success, running, last failure and error).
- **`POST {action:'replay', ids?:string[], shopId?:string}`** moves `failed` rows back to `received` with attempts 0, and records `etsy_webhooks.replay` in AdminAuditLog.
- **`getIntegrationHealth().etsyWebhooks`** (the existing card) carries the same extended fields. The needs-attention queue now flags due events older than 10 min and parked `blocked_reauth` events.
- **`EtsyBackboneCard`** is mounted full-width on `/admin/monitoring`. It is mobile-first: stacked rows and expandable lists, no tables.

### 6. Finance mapping (T15): deviation from the spec, with evidence

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

### 7. Other deviations

- **Process-wide state on `globalThis`.** Next compiles instrumentation and API routes against separate webpack runtimes. All W1 per-process state now lives on `globalThis` under `Symbol.for('kolayxport.processState.<name>')` (`lib/processState.ts`): the inventory lock table, the rate budget (counters, remote quota, pending deltas, token bucket, ALS instance), the webhook worker state, the scheduler's running-job registry, memo and shutdown controller, the scheduler tick state, and the legacy credential locks. Draft syncs (API bundle) and stock pushes (scheduler/instrumentation bundle) therefore share one inventory lock per listing, and `/admin/monitoring` sees the real worker/scheduler status. Other workstreams with process-wide state should use `processState()` too.
- **Scheduler timeouts.** A job that runs past its timeout is recorded as failed in JobRun, but stays registered as running in this process until its body actually returns, so it is never started a second time while the first body is still running.

- **T6 (`PRISMA_CONNECTION_LIMIT`) skipped.** A4 says to leave `lib/prisma.ts` alone.
- **T10 flags inverted per A4.** The jobs are on by default, with a kill switch instead of an opt-in flag.
- **The worker is continuous, not pass-bound.** Each pass claims only up to free capacity (6 global, 2 per shop) and returns; each finished event kicks the next pass. A slow handler, such as the W0 order stub's `syncAllOrders`, never holds back a new order event.
- **Kick timing.** An order webhook kicks after 500 ms. Listing events kick after 3 s, so `listing.updated` and `inventory.updated` coalesce. An earlier kick replaces a later one.
- **Credential-only (legacy) shops.** Their token refresh uses an in-process per-shop mutex and a re-read instead of the advisory-lock transaction, so no network I/O runs inside a DB transaction.
- **Dedupe.** `notifyOutOfStock` (legacy fallback only) now dedupes on `note` as well as `errorMessage`. Worker notes go to `WebhookEvent.note`, and `errorMessage` holds only errors.
- **No DB-backed tests.** `test/db/*` and docker were not built, per the hard rules. The claim SQL, JobRun `ON CONFLICT` and the token lease are covered by mocked unit tests only. Run real-Postgres checks before relying on them under concurrency.

### 8. Rollout checklist (after merge + deploy)

1. In `journalctl -u kolayxport`, look for `[instrumentation] In-process scheduler scheduled to start` and then the `scheduler.started` log event.
2. On `/admin/monitoring`, the Etsy event backbone card should show the loop "running", a last pass within seconds, and jobs gaining "Last success".
3. Confirm `/api/cron/process-etsy-webhooks` answers `skipped: worker_healthy`, and `/api/cron/run-job?due=1` returns statuses.
4. Watch `EtsyApiQuota` fill with Etsy's headers after the first calls: `SELECT * FROM "EtsyApiQuota" ORDER BY day DESC LIMIT 3;`.
5. To roll back the behaviour without a deploy, set `KX_DISABLE_INPROCESS_JOBS=1` in a systemd drop-in and restart. The ingest kick and the GitHub sweeper keep the queue moving.

### Cross-workstream issues

#### W4 — `lib/orders/etsyLifecycle.ts` (not a W1 file)

- `handleEtsyOrderEvent` (~line 373) calls `fetchEtsyReceiptRaw(userId, shopId, String(receiptId), EtsyPriority.Webhook)`. Change it to `EtsyPriority.Critical` (and consider making `Critical` the default of `fetchEtsyReceiptRaw`). W1 already neutralises the downgrade inside the worker (Critical is sticky in `withEtsyBudget` / `etsyFetch`), but outside a Critical context a P1 call is subject to the per-shop cap and the 85% gate, which defer to 00:05 UTC the next day — new orders would stop appearing live (A2).

#### UI session — `components/etsy/VariationEditor.tsx` (presentation file, not edited)

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


---

<!-- source: docs/integration/parts/W2-stock-sync.md -->

## W2-stock-sync — integration notes

Cross-marketplace oversell prevention: a canonical per-SKU hub (`StockItem`) with an idempotent ledger, expected-state tracking per marketplace listing (`StockLink`), and read-before-write pushes (`StockPush`) to Etsy, Trendyol, Shopify and eBay. Wix writes are behind a verification flag. Amazon and Hepsiburada are "coming soon" stubs.

### Safety model (founder decision A1)

| State | `StockSettings` | Marketplace writes | What happens |
|---|---|---|---|
| Never set up | no row | none | Every hook is a no-op: one cached lookup (30 s). |
| Off | `enabled=false` | none | Items, links and history are kept. |
| Dry run | `enabled=true, dryRun=true` | **none** | Sales and cancels move the hub. The push worker records `dry_run` rows (what *would* be sent) and never calls an adapter. The Etsy draft hook returns products unchanged. |
| Live | `enabled=true, dryRun=false` | yes | Reached only through `PUT /api/stock/settings {dryRun:false, confirmToken}`. The token comes from `POST /api/stock/preview?live=1`, lasts 15 min and is an HMAC over the plan. A typed word is required when the plan deactivates listings or disables variations. A `StockSnapshot` (kept 7 days) is taken first. |

Global kill switch: `STOCK_SYNC_GLOBAL_DISABLE=1` turns everything off for all users. Nothing writes stock to any marketplace before Go Live.

---

### 1. Presentation changes for the UI session (do not edit; fold in)

#### 1a. Nav entry — `components/AppLayout.js`

In the regrouped nav, put the entry in the same group as the Etsy/marketplace product pages:

```js
{ href: '/app/stok-senkron', labelKey: 'stockSync.pageTitle', icon: Inventory2RoundedIcon /* or lucide <Boxes /> */ }
```

- **Label:** use `useTranslations('stockSync')` → `t('pageTitle')` (TR "Stok Senkronu", EN "Stock Sync").
- **Alternative label:** if nav labels must stay under the `nav` namespace, add `nav.stockSync` with the same two strings.
- **Icon:** `import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'`.
- **Cmd+K:** add the same entry to `components/CommandPalette.tsx` routes, if that file has a route list.

#### 1b. Managed quantities in `components/etsy/VariationEditor.tsx` (A7: integration note instead of an edit)

Goal: variants that stock sync manages show a read-only quantity with the chip "Stok senkronu yönetiyor (7)". Variants it does not manage behave exactly as today. When stock sync is off, nothing changes.

1. Imports, at the top:

   ```tsx
   import { useStockManaged } from '@/components/stock/useStockManaged';
   import StockManagedQtyChip from '@/components/stock/StockManagedQtyChip';
   import { etsyVariantKeys, pairsFromEtsyProduct } from '@/lib/etsy/variantKey';
   ```

2. Inside `VariationEditorInner({ listingId, shopId, ... })`, next to the other hooks (around line 504):

   ```tsx
   const stockManaged = useStockManaged(listingId, shopId);
   /** Managed info for a product row, or undefined. '*' (shared qty) and '' (single product) are handled inside get(). */
   const managedFor = useCallback(
     (product: Product) => (stockManaged.managed ? stockManaged.get(etsyVariantKeys(pairsFromEtsyProduct(product)).variantKey) : undefined),
     [stockManaged],
   );
   ```

3. Per-variant quantity input (the `TextField` with `onChange={(e) => updateField(globalIdx, 'quantity', e.target.value)}`, around line 1909). Replace it with:

   ```tsx
   {(() => {
     const m = managedFor(product);
     return m && stockManaged.live ? (
       <StockManagedQtyChip qty={m.canonical} live />
     ) : (
       <>
         <TextField
           size="small" type="number"
           value={o.quantity}
           onChange={(e) => updateField(globalIdx, 'quantity', e.target.value)}
           inputProps={{ min: 0 }}
           sx={{ width: { xs: '100%', sm: 90 } }}
         />
         {m && <StockManagedQtyChip qty={m.canonical} live={false} />}
       </>
     );
   })()}
   ```

4. Summary chip in the product list (the `Chip label={o.quantity === 0 ? t('outOfStock') : ...}` around line 1661). When `managedFor(product)` returns something, render `<StockManagedQtyChip qty={managedFor(product)!.canonical} live={stockManaged.live} />` instead.

5. Bulk quantity apply (`quantityAction` / `quantityValue`, around line 894). When `stockManaged.live`, skip products for which `managedFor(p)` is set, so a bulk "set 5" never stages managed variants.

6. **Single-product listings.** `ListingEditorDrawer.tsx` has the simple quantity field. Use the same hook with `stockManaged.get('')` and render the chip instead of the field when `managed && live`.

**Why it is safe even without this UI change.** If the seller still edits a managed variant, the server-side draft hook (W1 calls it) records the new number as a manual stock adjustment (`note: 'etsy_editor'`) and then writes the hub target. The editor stays a valid way to set stock, and the chip only makes this visible.

The chip strings are `stockSync.managed.chip`, `stockSync.managed.tooltip` and `stockSync.managed.dryRunTooltip`. The tooltip popper uses z-index 1600, so it works inside the listing drawer.

#### 1c. Nothing else on existing pages

- **Bell:** new notifications reach the bell through W5's `notify()`. The page and the editor revalidate on live events through W6 (`useLiveRevalidate(['stock.changed','stock.alert'], …)`).
- **Live provider:** `components/live/LiveEventsProvider` must be mounted in AppLayout (W6's note). Without it the page still works, but it only refreshes on actions.

---

### 2. New page and components (owned by W2, already in the tree)

- **`pages/app/stok-senkron.tsx`:** `withAuth` + `AppLayout`. It contains the settings and status card, the dry-run report, the product list and four dialogs (wizard, Go Live, timeline, adjust). The list shows expandable cards below md and a plain MUI `Table` (no DataGrid) at md and up. It refreshes live on `stock.changed` / `stock.alert`.
- **`components/stock/*`:**
  - `StockSetupWizard`: channels → matches → unmatched → seed policy → start dry run and preview.
  - `StockSettingsCard`
  - `StockItemCard`
  - `StockItemTable`
  - `StockLinkList`: per-channel rows, plus the pause / resume / accept / unlink / settings menu.
  - `SkuMappingDialog`
  - `StockPreviewPanel`
  - `GoLiveDialog`
  - `StockTimeline`: the "Bu sayı neden?" history, with one-tap adopt of remote increases.
  - `StockAdjustDialog`
  - `StockManagedQtyChip`
  - `useStockManaged`
  - `stockClient`
  - `labels`
- **Z-index:** dialogs use 1500–1550; menus, selects and tooltips use 1600.
- **Toasts:** none per page; everything goes through `notify` from `lib/notify`.

**Wizard order deviates from the spec.** The spec puts the preview before "enable dry run". Before seeding, unseeded items have `onHand=0`, so a preview at that point would be misleading. The last step therefore enables the dry run first, which seeds from fresh remote reads and records baselines, and then shows the preview. Nothing is written to a marketplace in either order.

---

### 3. i18n

- **Files:** `messages/fragments/stockSync.en.json` and `stockSync.tr.json`, one new top-level namespace `stockSync`, 254 keys. EN and TR keys match exactly.
- **Notification texts:** the four stock notification types already have strings in W5's `messages/fragments/notificationCenter.*.json` → `notifications.types.*`. W2 emits:

| type | titleKey | severity | params | dedupeKey | link |
|---|---|---|---|---|---|
| `stockOutOfStock` | `types.stockOutOfStock` | warning | `{ sku }` | `stock:oos:<stockItemId>` (resolved when back > 0) | `/app/stok-senkron` |
| `stockPushFailed` | `types.stockPushFailed` | error | `{ sku, channel }` | `stock:pushfail:<linkId>:<6h bucket>` | `/app/stok-senkron` |
| `stockDrift` | `types.stockDrift` | warning | `{ count, sku }`, `escalateOn:'count'` | `stock:drift:<YYYY-MM-DD>` | `/app/stok-senkron` |
| `stockUnmatchedSale` | `types.stockUnmatchedSale` | info | `{ count, skus }`, `escalateOn:'count'` | `stock:unmatched:<YYYY-MM-DD>` | `/app/stok-senkron` |

`channel` is the raw channel id (`etsy`, `trendyol`, …). If the bell should show a brand name, W5 can map it, or the strings can use it as-is.

---

### 4. Live events (W6 `publishLive`, all after commit, never throw)

| Event | When | W6 names |
|---|---|---|
| `{type:'stock', kind:'changed', stockItemId, sku, onHand}` | any hub change (sale, cancel, manual, seed, remote drop) | `stock.changed` |
| `{type:'stock', kind:'out_of_stock', …}` | onHand crosses to ≤ 0 | `stock.alert`, `stock.changed` |
| `{type:'stock', kind:'push_applied', stockItemId, linkId, channel}` | a marketplace write landed | `stock.changed` |
| `{type:'stock', kind:'push_failed', …}` | push gave up | `stock.alert` |
| `{type:'stock', kind:'drift', …}` | remote ≠ target (observation increase or hourly reconcile) | `stock.alert` |
| `{type:'stock', kind:'unmatched_sale'}` | order lines that resolve to no item | `stock.alert` |
| `{type:'stock', kind:'settings_changed'}` | settings saved / enabled / Go Live | `stock.changed` |

---

### 5. Hooks other workstreams call (`lib/stock/hooks.ts`, signatures unchanged from W0)

Each hook is a fast no-op while stock sync is off, and all of them swallow errors except `applyStockToEtsyDraftInventory`. Heavy modules are loaded lazily, which keeps the adapters out of `draftService`'s import graph and avoids an import cycle.

- **W3, after `refreshListingFull` returns offerings:**
  - Call `observeEtsyOfferings({ userId, shopId, listingId, listingState, remoteUpdatedTs, offerings, source, eventId })`.
  - `offerings[].quantity` must be the offering quantity, and `isEnabled` must be set (the effective quantity is 0 when disabled).
  - If the result has `deferMs`, re-queue the listing event for `now + deferMs`. This happens when one of our pushes is in flight, or when the in-process inventory lock was busy for 5 s.
  - **Do not call it while holding `withListingInventoryLock` for the same listing**, except with `source:'draft_sync'`, which skips the lock.
  - For version attribution, call `findOwnStockWrite(shopId, listingId, remoteUpdatedTs)` → `{ pushId } | null` (`kolayxport_stock`).
- **W4, orders:**
  - Call `applyOrderToStock(orderId, { source: 'etsy_webhook' | 'etsy_poll' | 'order_scan' | 'manual', sourceEventId })` after the order row commits, for example from the `OrderEffect` `stock_apply:<itemsHash>:<statusClass>`. It is idempotent per `(orderKey, stockItem)`, so a retry is harmless.
  - For Etsy lines, populate `OrderItem.listingRef = String(listing_id)` and `OrderItem.variantRef = etsyVariantKeys(pairs).variantKey`. Here `pairs` are the transaction's `variations` mapped to `{propertyId: property_id, valueId: value_id, value: formatted_value}`. Exclude personalization entries (null `value_id`, or a property not in the listing inventory). Use `variantRef = ''` for listings without variations. `variantValueKey` is optional.
  - Without `listingRef`/`variantRef`, Etsy lines (which carry no SKU) fall into the unmatched-sale rollup.
  - Non-Etsy order syncs (Trendyol, eBay, Shopify, Wix, Amazon) are covered by the `stock-scan-orders` job every 5 minutes. Calling `applyOrderToStock` right after their upsert makes the decrement immediate (optional).
- **W1:**
  - **Draft sync, before the inventory PUT:** call `const r = await applyStockToEtsyDraftInventory({ userId, shopId, listingId, actorUserId, products, userChangedVariantKeys })`, then PUT `r.products`.
    - `userChangedVariantKeys` is the set of variantKeys whose quantity the draft changed versus its base snapshot.
    - If the call throws, fail the sync with `etsy.draftSync.stockOverrideFailed`; never PUT stale quantities over managed variants.
    - It writes echo marker pushes (`externalRef:'draft_sync'`, status `in_flight`) so the post-sync observation is not counted as an external drop. Their ids come back as `r.echoPushIds`; settle them after the PUT (see "Cross-workstream issues" below).
    - Unless the user is LIVE **and** the Etsy channel is switched on, it returns the products unchanged.
    - When the hub has nothing to sell on the listing (`r.outOfStock === true`), it leaves the quantities alone (Etsy rejects an active listing with nothing purchasable) and queues a lower-only stock push that deactivates the listing after the draft releases the inventory lock.
  - **Shop ownership:** when `EtsyShop.userId` changes (OAuth callback re-link), call `onEtsyShopOwnershipChanged(shopId, newUserId)`. The disconnect path in `pages/api/integrations/etsy/shops.ts` already calls it with `null` (W2 edit).
  - **Scheduler:** `stockJobs` from `lib/stock/jobs.ts`:
    - `stock-push-worker`, every 1 min
    - `stock-scan-orders`, every 5 min
    - `stock-reconcile`, every 60 min
    - `stock-observation-purge`, daily at 04:30 UTC
    - Each job is a no-op when no user has stock sync enabled.
    - Engine commits also kick the worker in-process (750 ms debounce). The kick respects `KX_DISABLE_INPROCESS_JOBS=1`.

---

### 6. API (all session-auth, user-scoped; every id and account ref is checked for ownership)

| Route | Methods | Notes |
|---|---|---|
| `/api/stock/settings` | GET, PUT | PUT forms: options patch; `{enabled:true, manualQty?}` (seed + dry run); `{enabled:false}`; `{dryRun:false, confirmToken, typedConfirm?}` (Go Live); `{dryRun:true}` |
| `/api/stock/items` | GET, PATCH | list with links and targets; PATCH `safetyBuffer`/`tracking`/`status`/`title` |
| `/api/stock/items/[id]/timeline` | GET | plain-language entries (i18n key + params) |
| `/api/stock/candidates` | GET | channels, match groups, unmatched, loose and title suggestions, 30-day coverage (local caches only) |
| `/api/stock/links` | POST | `confirm`, `link`, `accept`, `unlink`, `pause`, `resume`, `adopt_remote`, `set_units`, `set_buffer`, `set_max` |
| `/api/stock/preview` | GET, POST `?live=1` | plan; live = fresh reads (≤ 50 links) + confirm token |
| `/api/stock/adjust` | POST | manual set/delta; first count seeds a `needs_review` item |
| `/api/stock/ledger` | GET | cursor pagination |
| `/api/stock/pushes` | GET, POST | list / `?report=dry_run`; `retry`, `retry_failed` |
| `/api/stock/restore` | GET, POST | snapshot info; restore + disable (typed word) |
| `/api/stock/etsy-managed` | GET | `{managed, live, variants:[{variantKey, canonical, stockItemId, sku}]}` |
| `/api/stock/generate-skus` | POST | proposals; `apply:true` stages Etsy drafts via `upsertDraftPatch` (never writes Etsy) |

---

### 7. Env / ops

| Variable | Default | Meaning |
|---|---|---|
| `STOCK_SYNC_GLOBAL_DISABLE` | unset | `1` = stock sync off for everyone (hooks no-op, worker skips) |
| `STOCK_WIX_WRITE_VERIFIED` | unset | `1` = enable Wix writes. Set only after manually verifying `PATCH /stores/v2/inventoryItems/product/{id}` on a test product of a Catalog V1 site. |
| `KX_DISABLE_INPROCESS_JOBS` | unset | `1` = no in-process push kick (the scheduler / cron still run the worker) |
| `NEXTAUTH_SECRET` | (existing) | HMAC key for Go Live confirm tokens |

- **Database timezone:** raw SQL uses `now()` against `timestamp(3)` columns. Prod Postgres `TimeZone` is `Etc/UTC` (verified read-only), which is what Prisma assumes.
- **Before any user leaves dry run**, verify these on a test listing; they are unverified Etsy behaviours:
  1. `PUT /listings/{id}/inventory` with an offering `is_enabled:false` keeps its quantity.
  2. Shared-quantity listings accept the same quantity on all products.
  3. Whether Etsy itself restocks on cancel. A positive delta is only alerted, never adopted, so this is safe either way.

---

### 8. Known gaps / deviations

- **No DB-backed test suite.** Per instructions, `test/db/*` was not created. The engine idempotency rules run against an in-memory Prisma fake in `test/stock/engine.test.ts` instead.
- **Trendyol order key:** it is the shipment package id (`rawData.id`), not `orderNumber`. One `orderNumber` can be split into several package rows; production has 5 such orders.
- **Shared pools and partial `quantity_on_property`:** when several links control products in one Etsy quantity group, the minimum target wins (oversell-safe).
- **Unmatched-sale rollup:** the count is kept per process and resets on restart. The notification still re-raises only when the count grows.
- **eBay:** one account per user (`accountRef='default'`). Legacy (non-Inventory-API) listings are `unsupported`.
- **Shopify:** uses Admin GraphQL `inventorySetQuantities` with `compareQuantity` on API 2024-10. When the client's API version is bumped to 2026-04+, rename the field to `changeFromQuantity`.

---

### 9. Review fixes (2026-10-15) and cross-workstream issues

#### What changed inside W2 (no action needed elsewhere)

- **Etsy deactivate / reactivate:** a stock deactivation now flags every active link on the listing (`deactivatedByStock`, `lastSeenRemoteQty=0`). Reactivation first brings every managed sibling link's rows to its current hub target (lower-only; 0 = disabled), PUTs that, then PATCHes `state=active`. If any sibling would leave the listing (deactivate mode / nothing purchasable), the listing stays inactive. Pure planner: `planListingPush` in `lib/stock/adapters/etsy.ts`.
- **Quantity groups:** pushes widen per-variant changes to their `quantity_on_property` group (`expandChangesToQuantityGroups`, minimum wins). Candidates stay one per offering so order lines (full variantKey) still attribute to a link.
- **Worker:** the single-run guard, kick timer and settings cache live in `processState` (shared by the API-route and instrumentation bundles). A running worker heartbeats its claimed rows (`updatedAt`, every 60 s) and stale detection needs both `claimedAt` and `updatedAt` older than 5 min. Unknown pushes that cannot be read back rotate and go back to pending after 15 min (fresh read-before-write push) instead of blocking the link for 24 h.
- **Seller-disabled Etsy variation** (disabled with stock left, not by our push) is no longer counted as a sale: the link is paused with reason `variation_disabled` (no ledger movement) and resumes automatically, re-baselined, when the variation is enabled again (plus a lower-only push). New observation kind `variation_disabled`.
- **eBay:** only `EbayNotConnectedError` or a refresh rejected with `invalid_grant`/400/401 pauses links (`account_changed`); network / 5xx during token refresh are retried.
- **Aggregator copies** (Veeqo/Shippo) are skipped only when a direct Order row already moved stock for that orderKey; otherwise they apply but can never reduce a recorded sale (`applySaleDesired({ noReduce })`).
- **Order scan:** a sale apply that throws marks the order failed (`ApplyOrderToStockResult.failed`); the scan cursor stops before it and retries it next scan (given up and logged after 5 failures).
- **Go Live:** the plan hash now covers every managed link's target and zero-stock effect, the zero-stock action and the channel switch (not remote reads). Go Live recomputes it and returns `plan_changed` (400) on mismatch; the typed word is required if either the token or the fresh plan needs it; tokens are single-use. `GoLiveDialog` reloads the preview on `plan_changed`.
- **Push reasons:** item PATCH only enqueues when it re-activates the item (`manual`) or changes the safety buffer (`adjust` if lowered, `reconcile` if raised); title-only edits push nothing. Link `set_units`/`set_buffer`/`set_max` use `adjust` only when the edit can raise the target. Retry keeps the failed push's own reason.
- **i18n added (stockSync fragments):** `link.reasons.variation_disabled`, `errors.plan_changed`.

#### Cross-workstream issues

- **W1 / W3 — `lib/etsy/draftService.ts` (draft sync inventory PUT, around the `applyStockToEtsyDraftInventory` call):** settle the echo markers after the PUT. Keep the result of the hook and wrap the PUT:
  ```ts
  import { applyStockToEtsyDraftInventory, isListingStockManaged, settleEtsyDraftStockEcho } from '@/lib/stock/hooks';
  // ...
  let stockEchoIds: string[] = [];
  // inside the existing try, after `const stock = await applyStockToEtsyDraftInventory({...})`:
  stockEchoIds = stock.echoPushIds;
  // ...
  try {
    results.push(await callEtsyAPI(`/listings/${syncedListingId}/inventory?max_variations_supported=3`, accessToken, { method: 'PUT', body: JSON.stringify(payload) }));
    await settleEtsyDraftStockEcho(stockEchoIds, true);
  } catch (err) {
    await settleEtsyDraftStockEcho(stockEchoIds, false);
    throw err;
  }
  ```
  `settleEtsyDraftStockEcho` never throws. Without this change nothing breaks: an unsettled marker goes `unknown` after ~5 min and the push worker verifies it by a fresh read (applied if Etsy shows the target, otherwise a real push replaces it). Draft markers do not block the post-sync observation or the worker's claim.
- **W3 — observation callers:** `observeEtsyOfferings` may now pause a link (`variation_disabled`) and resume it later; no caller change needed, but `offerings[].isEnabled` and the raw `quantity` must both be passed exactly as Etsy reports them (a disabled offering keeps its quantity).
- **W6 — `lib/live/types.ts`:** stock links paused by an observation publish `{ type:'stock', kind:'changed', linkId, stockItemId }` (no new kind added, since that file is W6's). If W6 wants a dedicated `link_paused` kind, add it to `LiveStockEvent['kind']` and W2 will switch to it.

---

<!-- source: docs/integration/parts/W3-listing-intel.md -->

## W3 listing intel: integration notes

W3 adds:

- a listing cache that webhooks keep fresh, with a timestamp guard on writes
- an offering cache keyed by variantKey
- change history with attribution, plus undo, which only creates a draft
- alerts when a listing is deactivated, expires or is deleted
- SEO cohort experiments
- a new page, `/app/etsy-aktivite`

All backend code and the new page and components are done. The other session needs to make the presentation changes in sections 1 to 4 below.

### 0. What the integrator merges

| Fragment | Merge as |
|---|---|
| `messages/fragments/listingHistory.{en,tr}.json` | new top-level `listingHistory` |
| `messages/fragments/seoExperiments.{en,tr}.json` | new top-level `seoExperiments` |

The en and tr key sets are identical: 113 keys in `listingHistory` and 46 in `seoExperiments`.

Notification texts for the types W3 emits already exist in W5's `notificationCenter.types.*`. Section 5 lists the params W3 sends with each type.

### 1. `components/etsy/ListingEditorDrawer.tsx`: History tab

**Imports** (top of file):

```tsx
import HistoryIcon from '@mui/icons-material/History';
import ListingHistoryPanel from '@/components/etsy-history/ListingHistoryPanel';
```

**Inside the component**, next to the existing `const t = useTranslations(...)`:

```tsx
const tHistory = useTranslations('listingHistory');
```

**`editorTabs`** (around line 1720): add a tab as the last entry, after `actions`:

```tsx
{ id: 'history', label: tHistory('editorTab'), icon: <HistoryIcon fontSize="small" /> },
```

**Content area**: add this block next to the other `activeTab === ...` blocks, for example right after the `activeTab === 'actions'` block (around line 3069):

```tsx
{activeTab === 'history' && listingId && (
  <Box sx={{ p: { xs: 2, md: 2.5 } }}>
    <ListingHistoryPanel
      shopId={shopId}
      listingId={listingId}
      onRestored={applyRestoredDraft}
    />
  </Box>
)}
```

**Why `refreshDraftState()` alone is not enough.** `refreshDraftState` (line ~1556) only refreshes `draftId`, `draftStatus`, `draftLastError` and `draftQueuedDelete`. It never loads the server draft's `fieldPatch` into the editor's `fields`. The drawer's Save **always stages with `replaceFields: true`**, built from its own diff of `fields` against the Etsy original (`handleSave`, lines ~1179 and ~1257). `lib/etsy/draftService.ts` then sets `fieldPatch = params.fields`. So unless the restored values are put into `fields`, the next Save (even with no edits) wipes the restored title, tags and description. The restore must therefore overlay the restored patch onto the editor.

**Add, inside the component, after `refreshDraftState` is defined (line ~1575):**

```tsx
// Restored fieldPatch keys the editor has no input for (e.g. taxonomy_id).
// handleSave re-sends them so replaceFields does not drop them.
const restoredExtraFieldsRef = useRef<Record<string, any>>({});

const applyRestoredDraft = useCallback(async (draft: any) => {
  await refreshDraftState();
  const base = fieldsRef.current;
  if (!base || !listingId) return;
  const patch: Record<string, any> =
    draft && draft.fieldPatch && typeof draft.fieldPatch === 'object' ? draft.fieldPatch : {};
  const next: EditableFields = { ...base, tags: [...base.tags], materials: [...base.materials] };
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k in next) (next as any)[k] = Array.isArray(v) ? [...v] : v;
    else extra[k] = v;
  }
  restoredExtraFieldsRef.current = extra;
  setFields(next);
  clearDraft(listingId);          // the DB draft is now the source, not the device copy
  markStaged(listingId, next);    // "same as the DB draft" for the status label / close confirm
  setSaveTarget('draft');
  setAutoSaveStatus('saved');
  setLastSavedAt(new Date());
  onSaved();                      // parent refreshes its pending-draft badges
}, [refreshDraftState, listingId, onSaved]);
```

The `fieldPatch` keys written by the restore are snake_case and match `EditableFields` one to one (`title`, `description`, `tags`, `materials`, `who_made`, `when_made`, `is_supply`, `shop_section_id`, `shipping_profile_id`, `return_policy_id`, `processing_min`, `processing_max`, `item_weight`, `item_weight_unit`, `item_length`, `item_width`, `item_height`, `item_dimensions_unit`). Only `taxonomy_id` has no editor input; it goes to `restoredExtraFieldsRef`.

**In `handleSave`:**

- In the "no changes" branch (line ~1179), change `fields: {}` to `fields: { ...restoredExtraFieldsRef.current }`.
- Right before `if (Object.keys(payload).length === 0) {` (line ~1250), add:

  ```tsx
  for (const [k, v] of Object.entries(restoredExtraFieldsRef.current)) {
    if (payload[k] === undefined) payload[k] = v;
  }
  ```

**In `fetchListing`** (line ~601), add `restoredExtraFieldsRef.current = {};` before `setLoading(true)`, so the extras never leak to another listing.

How the panel behaves:

- It loads `GET /api/etsy/listings/:id/versions` and refreshes itself on live `listing.changed` and `listing.removed` events for that listing.
- Its "Restore as draft" confirmation is its own MUI Dialog with `zIndex: 1550`, so it opens above the drawer.
- Restore calls `POST .../versions/:versionId/restore`. That only stages a draft through `upsertDraftPatch` (a merge, not a replace). The response is `{ draft, restoredKeys, unrestorable, nothingToRestore }`. The panel calls `onRestored(draft)` only when `draft` is not null. Nothing is written to Etsy.
- Restored image reorder/alt-text operations go to `EtsyDraftMedia`, which `replaceFields` does not touch.

W2's `StockManagedQtyChip` next to the quantity field is mounted per W2's notes (`docs/integration/parts/W2-*.md`); W3 does not mount it.

### 2. `pages/app/etsy-listings.tsx`

#### 2a. Freshness chip next to "Sync from Etsy" (around line 2887)

**Import:**

```tsx
import CacheFreshnessChip from '@/components/etsy-history/CacheFreshnessChip';
```

**Where:** directly after the `</Tooltip>` that wraps the Sync button. On desktop it replaces the hand-made `lastSync` caption; on mobile it shows the chip only.

```tsx
{selectedShopId && <CacheFreshnessChip shopId={selectedShopId} />}
```

The chip uses this wording, and never the word "webhook":

- "Etsy canlı bağlı · son değişiklik 2 dk önce" when Etsy push notifications were seen in the last 24 h
- "Gecikmeli · günde bir kontrol · son kontrol …" otherwise, because listings without push are re-checked by the nightly reconcile, not every 15 min

#### 2b. Live refresh with no manual sync (founder requirement A2)

**Rule: a live event must never call `fetchListings()`.** `fetchListings` (line ~1399) first returns the in-memory `listingsCacheRef` entry when it is under 5 min old, so a live event would do nothing for 5 min. Otherwise it pages `action=listings_with_images`, which is a LIVE Etsy call per 100 listings (`clawd/etsy.ts` ~2948). On every `listing.changed` (every sale, every bulk sync), in every open tab, that would re-read the whole catalog from Etsy. The DB cache is already webhook-fresh, so live events refetch from the DB, exactly like the existing post-sync path inside `syncListings` (lines ~1512–1531).

**Imports:**

```tsx
import { useLiveEvent } from '@/components/live/useLiveEvent';
```

**Add after `fetchPendingDrafts` is defined and before the `useEffect` that calls `fetchListings().then(() => fetchStatusCounts())` (line ~1586):**

```tsx
// DB-only refetch (no Etsy call): same steps as syncListings after a sync.
const refetchListingsFromDb = useCallback(async () => {
  if (!selectedShopId) return;
  const shopId = selectedShopId;
  const state = statusFilter || 'active';
  Object.keys(listingsCacheRef.current).forEach((key) => {
    if (key.startsWith(shopId)) delete listingsCacheRef.current[key];
  });
  statusCountsCacheRef.current[shopId] = {};
  try {
    const r = await fetch(`/api/clawd/etsy?action=cached_listings&shop_id=${shopId}&state=${state}`);
    if (r.ok) {
      const d = await r.json();
      const rows: EtsyListingRow[] = (d.listings || []).map(mapListing);
      setListings(rows);
      setTotalCount(d.count || rows.length);
      setListingsLoadedFor(shopId);
      if (d.stateCounts) statusCountsCacheRef.current[shopId] = d.stateCounts;
      setStatusCountsVersion((v) => v + 1);
      listingsCacheRef.current[`${shopId}:${state}`] = { listings: rows, total: d.count || rows.length, ts: Date.now() };
      if (d.lastSyncAt) setLastSyncAt(d.lastSyncAt);
    }
  } catch {
    /* the next live event or the reconnect revalidate retries */
  }
  await fetchPendingDrafts();
}, [selectedShopId, statusFilter, fetchPendingDrafts]);

// Coalesce bursts (a bulk sync emits one event per listing): at most one
// DB refetch per 2 s, trailing.
const liveRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const refetchFromDbRef = useRef(refetchListingsFromDb);
refetchFromDbRef.current = refetchListingsFromDb;
useEffect(() => () => { if (liveRefetchTimerRef.current) clearTimeout(liveRefetchTimerRef.current); }, []);

useLiveEvent(
  ['listing.changed', 'listing.removed', 'sync.progress', 'sync.finished', 'sync.status'],
  (ev) => {
    if (ev.type === 'sync') {
      if (ev.kind === 'status') {
        // only after a reconnect / while polling (events may have been missed)
        if (ev.phase !== 'reconnected' && ev.phase !== 'polling') return;
      } else if (ev.scope !== 'listings:etsy') {
        return; // order syncs etc.
      }
    } else if ('shopId' in ev && ev.shopId && String(ev.shopId) !== selectedShopId) {
      return; // another shop's listing / draft
    }
    if (syncing) return; // the manual Sync handler refetches itself when done
    if (liveRefetchTimerRef.current) return;
    liveRefetchTimerRef.current = setTimeout(() => {
      liveRefetchTimerRef.current = null;
      void refetchFromDbRef.current();
    }, 2000);
  },
);
```

Notes:

- `listing.changed` also covers `draft.*` (W6 aliases `draft` to `listing.changed`), so draft status badges update too. That is why the callback also calls `fetchPendingDrafts()`.
- `sync.progress` / `sync.finished` with `scope: 'listings:etsy'` come from the reconcile (first import after connect, nightly, manual sync). The reconcile writes rows without per-row listing events, so these are what fill an empty listings tab right after a first Etsy connect, with no refresh. `sync.progress` is throttled server-side to one per 3 s and is only sent when rows were written.
- The `ev.phase` field exists on `sync.status` events (see `lib/live/types.ts`). If TypeScript narrows awkwardly, cast: `(ev as any).phase`.
- There is no `invalidateShopListingsCache()` in the page. An earlier draft of this note referenced it; ignore that.

#### 2c. Sidebar counts (optional, deferred in the spec)

`listing_count` is now served from a DB `groupBy(state)` and makes zero Etsy calls. Only a shop that was never imported falls back to one live call. The 4 requests can be replaced with the `stateCounts` that `cached_listings` already returns. There is no API change either way.

#### 2d. `sync_listings` response

On success (HTTP 200) the shape is `{ success, partial, synced, changed, fetched, errors: number, removed, lastSyncAt }`.

- `synced` keeps its old meaning: listings fetched from Etsy and confirmed in the DB (changed plus unchanged). `changed` is the number of rows actually written. The existing `t('syncSuccess', { count: data.synced })` toast stays correct.
- Hard failures are now non-2xx, so the existing `if (!res.ok)` branch shows `syncFailed` with `errData.error`:

  | Status | `code` | When |
  |---|---|---|
  | 409 | `ETSY_REAUTH` | the shop needs reconnecting |
  | 404 | `ETSY_SHOP_NOT_FOUND` | shop missing or inactive |
  | 503 | `ETSY_RATE_LIMITED` | budget stop / abort / defer before anything was fetched |
  | 502 | `ETSY_SYNC_FAILED` | every page failed |

  Optional polish: map `code === 'ETSY_REAUTH'` to the existing reconnect wording instead of the English `error` text.
- A partial run that still fetched listings answers 200 with `partial: true`. Optional: when `data.partial`, show `toast(...)` (warning) instead of `toast.success`.
- It runs the shared reconcile and deletes nothing on doubt: each unseen listing is re-checked with a GET, and only a 404 leads to a deletion.
- `lastSyncAt` only moves on full success. On a partial run it returns the previous value.

### 3. Navigation: `components/AppLayout.js`

In the `listings` group (around line 136), add an entry after `etsy-listings`:

```js
{ href: '/app/etsy-aktivite', icon: Activity, label: tLH('navLabel'), requires: 'etsy', listings: true },
```

You also need:

- `import { Activity } from 'lucide-react'`
- `const tLH = useTranslations('listingHistory');`

You can instead add `nav.etsyActivity` ("Etsy activity" / "Etsy aktivite") to `messages/*.json` and use `t('etsyActivity')`.

`CommandPalette` builds its destinations from the nav, so nothing else is needed there.

**Deep link:** `/app/etsy-aktivite?tab=seo` opens the SEO tab. The `seoExperimentReady` notification links there.

### 4. New page and components (already created; no action needed)

- `pages/app/etsy-aktivite.tsx`
  - pill tabs for Changes and SEO experiments
  - an attribution filter (Changed on Etsy / Synced from KolayXport / Stock sync / Found in a check)
  - a shop selector when there are several shops
  - the freshness chip
  - expandable mobile cards
  - live prepend of new changes on `listing.changed`, `listing.removed` and `sync.finished`, plus a reconnect revalidate
- `components/etsy-history/`: `ListingHistoryPanel`, `VersionDiffView`, `ActivityFeedCard`, `AttributionChip`, `CacheFreshnessChip`, `types.ts`
- `components/etsy-seo/`: `SeoExperimentList`, `SeoExperimentCard`, `types.ts`

### 5. Notification types emitted by W3 (W5 registry / templates)

All rows use `titleKey: 'types.<type>'` and `entity: { type: 'etsyListing', id: '<shopId>:<listingId>' }`.

| type | severity | dedupeKey | params | link | notes |
|---|---|---|---|---|---|
| `listingDeactivated` | error | `listing:deactivated:<shop>:<listing>:<YYYY-MM-DD>` | `title`, `listingId` | `/app/etsy-listings` | Only for active→inactive that is external, or a transition found by the nightly reconcile, with no order for that listing in the last 30 min. Resolved automatically when the listing becomes active again. |
| `listingExpired` | warning | `listing:expired:<shop>:<listing>` | `title`, `listingId` | `/app/etsy-listings` | Digest candidate. Resolved on re-activation. |
| `listingDeleted` | error | `listing:deleted:<shop>:<listing>` | `title`, `listingId` | `/app/etsy-aktivite` | Suppressed when KolayXport deleted the listing in the last 10 min, through a draft `delete` or clawd `delete_listing`. |
| `listingChangedExternally` | info, `badge: false` | `listing:changed:<shop>:<listing>` | `title`, `listingId`, `fields` | `/app/etsy-aktivite` | Emitted only when the listing has an open draft. |
| `stockOutOfStock` | warning | `stock:oos:<shop>:<listing>:<6h bucket>` | `sku` (the SKUs at qty 0, or the title when there are none), `title`, `listingId` | `/app/etsy-listings` | Only for `inventory.out_of_stock` events on listings that stock sync does not manage. It replaces the old processor out-of-stock email; email delivery now goes through W5's channel. |
| `seoExperimentReady` | info | `seo:ready:<ISO-week Monday>` | `count`, `title` (one listing) | `/app/etsy-aktivite?tab=seo` | Weekly rollup with `escalateOn: 'count'`. W5's template uses `{title}`. A plural `{count}` form would read better for rollups. |

### 6. Live events published

Every event has `marketplace: 'etsy'` plus `shopId` and `listingId` as strings, `title`, `state`, `attribution` and `versionId`.

| Event | When |
|---|---|
| `listing.created` | A listing first appears through a webhook. |
| `listing.updated` | Any non-stale refresh, including our own draft sync and manual refreshes. |
| `listing.deactivated`, `listing.expired` | Those state transitions. |
| `listing.changed_externally` | External content changes, when the listing has an open draft. |
| `listing.deleted` | A 404 or `listing.deleted`. |

W6 aliases the first five to `listing.changed` and `listing.deleted` to `listing.removed`.

The reconcile publishes `sync.started`, throttled `sync.progress` (one per 3 s at most, only when rows were written, `processed` = listings seen so far) and finally `sync.finished` or `sync.failed`, all with `scope: 'listings:etsy'`. It does not publish per-row listing events (except `listing.deactivated` / `listing.expired` when it raises those alerts, and `listing.deleted` on a confirmed 404); open pages refetch from the DB on the `sync.*` events (section 2b).

### 7. Cross-workstream notes

#### W1 (event backbone)

- `handleEtsyListingEvent` is real now: it never returns `stub:`. The `legacyListingHandler.ts` fallback and the old `checkDraftConflicts`/`markOpenDraftsConflict` copies in `processor.ts` can be deleted. The replacements are in `lib/etsy/draftConflicts.ts`.
- It throws `EtsyDeferError` for two reasons:
  - `min_interval`: on a webhook refresh less than 30 s after the last one, with retryAfter = the rest of the 30 s;
  - `lock_busy`: when W2's `observeEtsyOfferings` returns `deferMs`.
- Event types are handled as follows:

  | Event types | Handling |
  |---|---|
  | `listing.deleted` in the union | Removal path, no Etsy call. |
  | `listing.created`, `listing.updated`, `reconcile.changed`, or content changes | Draft conflict check. |
  | Only `inventory.*` with no content change (a sale) | Does not conflict drafts (same rule as the old processor). |

- `reconcileShopListings` uses `enqueueSyntheticEtsyEvent({ resourceKey: 'listing:<id>', eventType: 'reconcile.changed', priority: 2 })`. The worker must route `reconcile.changed` to the listing handler. `parseResourceKey` already does this via `listing:`.
- In `clawd/etsy.ts`, `callEtsyAPI` passes `{ retries: 0, timeoutMs: 120000 }` for non-GET requests and the default options for GET requests. Raw multipart uploads keep plain `fetch` (they must not be retried) and call `recordEtsyResponse(res, currentEtsyPriority(), shopId)`.

#### W2 (stock)

- `observeEtsyOfferings` is called in three cases:

  | Case | `source` | `listingState` | `offerings` |
  |---|---|---|---|
  | (a) every non-stale webhook refresh | `'webhook'` | listing state | the listing's offerings |
  | (b) `refreshListingFull(source: 'draft_sync')`, i.e. our own draft PUT, for echo detection | `'draft_sync'` | listing state | the listing's offerings |
  | (c) on removal by a webhook / the worker's 404 path | `'webhook'` | `'removed'` | `[]` |

- The reconcile (nightly / manual / initial) never calls `observeEtsyOfferings`. When its deletion check gets a 404 it removes the cache rows, tombstones, conflicts drafts and alerts, then enqueues a synthetic `reconcile.changed` event for `listing:<id>`; the worker's 404 path then observes `'removed'` (case c).
- `EtsyOfferingObservation.variantKey` is the full `etsyVariantKeys` key. The listing's `quantity_on_property` is cached on `EtsyListing.quantityOnProperty`, so derive `etsyQuantityKey` from that for shared-quantity listings.
- `update_listing_inventory` returns `409 { code: 'STOCK_SYNC_MANAGED', key: 'listingHistory.errors.stockSyncManaged' }` when `isListingStockManaged` is true. `copy_listing` is not blocked, because it writes a new draft listing. Its inventory PUT runs under the new listing's inventory lock.
- `onEtsyShopOwnershipChanged` is called from the callback when the shop's previous `EtsyShop.userId` differs. `EtsyShop.shopId` is globally unique and the upsert is keyed by `userId_shopId`, so a cross-user reconnect fails the EtsyShop save today. The hook is therefore effectively dormant until ownership transfer is supported.

#### W4 (orders)

These use `OrderItem.listingRef`, falling back to `rawData.transactions[].listing_id` until the backfill runs:

- daily sales stats
- the "order in the last 30 min" deactivation check
- the 30-min `etsy-listing-cache-backfill` job

On reconnect, the callback runs `runEtsyOrderIncremental(shopId, { reason: 'reconnect' })` fire-and-forget. Today it throws `not_implemented`, which is caught and logged.

#### W5

Section 5 lists the params W3 sends.

### 8. Jobs (`lib/etsy/listingJobs.ts`, registered by `lib/scheduler/jobs.ts`)

| Job | Schedule (UTC) | What |
|---|---|---|
| `etsy-listings-reconcile` | daily 02:30 | Shops one after another, oldest reconcile first. Skips needsReauth. Stops on `canSpend(P2)`. Never observes stock. |
| `etsy-listing-stats-sales` | daily 01:15 | Yesterday's units, orders and revenue per listing. Falls back to cached totals when the reconcile did not run. |
| `etsy-seo-evaluate` | daily 04:00 | Evaluates due experiments and sends the weekly rollup notification. |
| `etsy-listing-version-retention` | daily 04:20 | Keeps 180 d, then one version per listing per ISO week. Tombstones are kept. |
| `etsy-listing-cache-backfill` | every 30 min | Caches listing ids from the last 3 days of orders that are missing from the cache (max 20 per shop per run, with a 24 h negative memo). |

### 9. Ops notes

- **First run:** the first reconcile, or the first webhook per listing, writes one silent baseline version per listing. These have `changedKeys = []` and are hidden in the UI. Each holds a full snapshot of roughly 2–15 KB. Real history starts after that.
- **Callback:** after OAuth, the callback clears `needsReauth`, requeues `blocked_reauth` events and starts a listing reconcile in the background; the redirect never waits on it.
  - Mode `initial` (silent: no alerts, no SEO cohorts, attribution `unknown`) only when the shop was never imported (`lastListingSyncAt` null and no cached rows) or its owner changed.
  - Any other reconnect runs with `nightly` semantics, so transitions missed during the reauth gap (deactivated, expired, deleted) still alert.
  - When parked events were requeued, the reconcile waits (polling every 5 s, at most 3 min) until no `listing:*` webhook event of the shop is `received`/`processing`. The webhooks therefore keep their `external` attribution and alert context, and the reconcile only picks up what no webhook covered.

### 10. Cross-workstream issues

- **ListingEditorDrawer (presentation session):** independent of restore, the drawer never loads a server draft's `fieldPatch` into `fields`. When a listing has a DB draft but no localStorage copy (other device, cleared storage, or a draft staged by the bulk editor), opening the drawer shows the Etsy values, and any Save (`replaceFields: true`) overwrites the DB draft's fields with the drawer's diff. The `applyRestoredDraft` overlay in section 1 can be reused on open: after `fetchListing()` and `refreshDraftState()`, overlay `drafts[0].fieldPatch` the same way when the draft status is `draft`, `failed` or `conflict`.
- **etsy-listings page (presentation session):** the `syncListings` success toast ignores `data.partial`; see section 2d for the optional warning toast.

---

<!-- source: docs/integration/parts/W4-order-pipeline.md -->

## W4 — Order pipeline: integration notes

W4 owns the order write paths, the label guard, the effect outbox, dispatch alerts, the tracking/address queues and the Chrome extension v9.6.0. Nothing was committed, built or deployed.

The A3 item-cascade fix (commit 35a73ee) is kept and generalised. `lib/orders/itemUpsert.ts` is now the only OrderItem writer for every marketplace. The same delete-and-recreate bug also existed in `lib/sync/trendyol.ts`, `wix.ts` and `shopify.ts` (`items: { deleteMany: {}, create }`). Those three files also nulled `trackingNumber`, `shippingLabelUrl`, `labelStatus` and `shippedAt` on every sync. Both bugs are fixed through `lib/orders/marketplaceOrderWrite.ts`.

---

### 1. Live new-order events (A2): who publishes what

Every order write path calls `publishOrderEvent(userId, order, kind)` after its commit. `kind` comes from `liveKindForOrderWrite` in `lib/orders/orderStatus.ts`:

| Situation | kind |
|---|---|
| A brand-new order that is open and was placed within the last 24 h (the client plays the order sound) | `new` |
| A new row that is old or already shipped/cancelled (backfill, reconcile) | `updated` (silent insert) |
| The status moved into a different class | `cancelled` / `shipped` / `delivered` |
| Other field, item or address changes | `updated` |
| The incoming data is identical to the stored row (hash match) | nothing is published |

| Write path | File | Latency |
|---|---|---|
| Etsy webhook (`order.paid`, `.shipped`, `.canceled`, `.delivered`, …) | `handleEtsyOrderEvent` → `upsertEtsyReceipt` (`lib/orders/etsyLifecycle.ts`) | Seconds. One receipt GET, no 30-day sync. |
| Etsy incremental poll / nightly reconcile / manual Sync button / label-guard re-check | `runEtsyOrderIncremental` / `reconcileEtsyOrders` → `upsertEtsyReceipt` | 15 min while webhooks are unhealthy; otherwise hourly |
| Veeqo / Shippo / Amazon / eBay | `syncAllOrders` batch writer (`lib/orderSync.ts`) → `publishOrderWrites` | Cron, every 15 min |
| Trendyol / Wix / Shopify | `upsertMarketplaceOrder` (`lib/sync/*.ts`) → `publishOrderWrites` | Cron, every 15 min. Trendyol is every 3 min for users with live Trendyol stock (`trendyol-orders-fast`). |
| Label created (all 4 routes) | `publishLabelCreated` (`lib/orders/labelEvents.ts`) | Immediate: `shipment.created` and `order.label_created` |
| Tracking submitted | `pages/api/orders/[orderId]/submit-tracking.ts` | Immediate: `shipment.tracking_submitted` and `order.shipped`/`updated` |
| Void / manual cancel | `pages/api/shipments/[shipmentId]/void.ts` | Immediate: `shipment.voided` / `shipment.void_requested` |

`publishOrderWrites` sends at most 20 `new` and 50 other events per sync pass. Past those caps it sends one `{ type: 'invalidate', keys: ['/api/orders'] }`, and it always ends with one `{ type: 'sync', kind: 'finished', scope }`. A first-time import of hundreds of orders therefore never floods the open tabs.

Not covered (not W4 files):
- `pages/api/orders/manual.ts` and `labelSync.ts`: these are user-initiated, and the UI already refetches.
- `pages/api/integrations/etsy/addresses.ts`: the extension's address fill. **Suggested for its owner:** call `publishOrderEvent(userId, updatedRow, 'updated')` after the `order.update` at about line 210, so a scraped address appears live.

---

### 2. Presentation changes for the other session (do NOT edit from W4)

The new components live in `components/orders-live/`:
- `CancelledOrderLabelDialog.tsx`: the default export, plus `isLabelGuardResponse(status, body)`.
- `OrderLifecycleBadges.tsx`: props `{ orderId, flags, onChanged?, compact? }`.
- `useOrderLifecycleFlags.ts`: `useOrderLifecycleFlags(orderIds)` returns `{ flags, mutate, isLoading, error }`. It revalidates itself on live `order` and `shipment` events.
- `DispatchHealthCard.tsx`: props `{ days?: number }`.

All of them use `useTranslations('orderPipeline')`. They are mobile-first and need no DataGrid. The dialog uses z-index 1550, so it renders above the drawers.

#### 2a. `components/UPSLabelDrawer.tsx`

The label routes now answer **HTTP 409** `{ success:false, code:'ORDER_CANCELLED'|'ORDER_SHIPPED_EXTERNALLY', messageKey, error }` for a cancelled order, or for one shipped outside KolayXport. If the user confirms, the client retries with `forceCancelled: true` in the body.

```tsx
// imports
import CancelledOrderLabelDialog, { isLabelGuardResponse, type LabelGuardCode } from '@/components/orders-live/CancelledOrderLabelDialog';

// state (next to `const [error, setError] = ...`, ~line 555)
const [guardCode, setGuardCode] = useState<LabelGuardCode | null>(null);
const forceRef = useRef(false);

// in handleSubmit: add `forceCancelled: forceRef.current || undefined,` to the JSON body
// (next to `orderId: order?.orderId,`), then directly after `const data = await res.json();` (~line 734):
if (isLabelGuardResponse(res.status, data)) {
  setGuardCode(data.code);
  setSaving(false);
  return;
}
// and reset at the very top of a successful run: `forceRef.current = false;` after setSuccess(true)

// JSX, as the last child inside <Drawer> … </Drawer>:
<CancelledOrderLabelDialog
  open={!!guardCode}
  code={guardCode}
  orderNumber={order?.orderNumber}
  busy={saving}
  onClose={() => setGuardCode(null)}
  onConfirm={() => {
    forceRef.current = true;
    setGuardCode(null);
    // re-submit the same form
    handleSubmit({ preventDefault() {} } as unknown as React.FormEvent);
  }}
/>
```

#### 2b. `components/MngLabelDrawer.tsx`

This uses the same pattern. The body gets `forceCancelled: forceRef.current || undefined`. After `const data = await res.json();` (~line 152), add:

```tsx
if (isLabelGuardResponse(res.status, data)) { setGuardCode(data.code); return; }
```

The dialog's `onConfirm` sets `forceRef.current = true`, closes the dialog, and calls `handleSubmit()` again.

#### 2c. `pages/app/labels.tsx`

1. **FedEx guard.** This is in `handleGenerateLabel` (~line 2328). Add `forceCancelled: forceFedexRef.current || undefined` to `bodyForGenerateLabel`. Before the generic `if (!labelResponse.ok)` block, add:

   ```tsx
   if (labelResponse.status === 409) {
     const body = await labelResponse.clone().json().catch(() => null);
     if (isLabelGuardResponse(409, body)) {
       toast.dismiss(toastLabelId);
       setFedexGuard({ code: body.code, row: rowForLabel });
       return;
     }
   }
   ```

   Render this once in the page:

   ```tsx
   <CancelledOrderLabelDialog
     open={!!fedexGuard}
     code={fedexGuard?.code ?? null}
     orderNumber={fedexGuard?.row?.orderNumber}
     onClose={() => setFedexGuard(null)}
     onConfirm={() => { const row = fedexGuard!.row; forceFedexRef.current = true; setFedexGuard(null); handleGenerateLabel(row).finally(() => { forceFedexRef.current = false; }); }}
   />
   ```

   The new state is `const [fedexGuard, setFedexGuard] = useState<{ code: LabelGuardCode; row: LabelRow } | null>(null); const forceFedexRef = useRef(false);`.

2. **Lifecycle badges.** Build a stable id list from the visible rows. Use the joined string, never the array, as the dependency:

   ```tsx
   const visibleOrderIds = useMemo(() => pageRows.map((r) => r.orderId).filter(Boolean), [pageRowsIdKey]); // pageRowsIdKey = pageRows.map(r => r.orderId).join(',')
   const { flags: lifecycleFlags, mutate: refreshLifecycle } = useOrderLifecycleFlags(visibleOrderIds);
   ```

   Render the badges next to the ship-by chip:
   - Mobile expandable card: `<OrderLifecycleBadges orderId={row.orderId} flags={lifecycleFlags[row.orderId]} onChanged={() => { refreshLifecycle(); mutate(); }} />`. This shows the void and "Manuel iptal ettim" actions.
   - Desktop row: the same with `compact`. The actions then appear only in the detail drawer: render the non-compact version there.

   The badges already revalidate on live `order` and `shipment` events.

3. **No other change is needed for live orders.** W6's `LiveAppMount` and `useLiveRevalidate(['order'], '/api/orders')` cover inserts and the sound. W4 only guarantees the events.

#### 2d. `pages/app/index.js` (dashboard)

Mount the card in the existing card grid, with `import DispatchHealthCard from '@/components/orders-live/DispatchHealthCard';`. Show it only when the user has an Etsy connection, using the same condition as the other Etsy widgets:

```jsx
<Grid item xs={12} md={6}><DispatchHealthCard /></Grid>
```

#### 2e. Nav / settings

None. The dispatch alerts and the order notifications go through the existing bell and W5's page.

---

### 3. i18n

- **New namespace `orderPipeline`.** It is in `messages/fragments/orderPipeline.{en,tr}.json`, with 43 keys and identical key sets in both languages. Server `messageKey` values are full paths:
  - `orderPipeline.labelGuard.cancelled`
  - `orderPipeline.labelGuard.shippedExternally`
  - `orderPipeline.void.manualRequired`
  - `orderPipeline.void.failed`
- **Notification types.** W5's `notificationCenter.types` fragment already has texts for every type W4 emits. These are the params W4 actually sends, so richer texts are possible (suggestions for W5 / the integrator):

| type | severity / badge | params | dedupeKey |
|---|---|---|---|
| `orderNew` | info, `badge:false` (activity feed) | `orderNumber, total, currency, itemCount, marketplace` | `order:new:<orderId>` |
| `orderCanceled` | warning | `orderNumber, marketplace` | `order:cancelled:<orderId>` |
| `orderCanceledAfterLabel` | **error** | `orderNumber, carrier, tracking, labelCost?, labelCostCurrency?` | `order:cancelled_after_label:<orderId>` (resolved by void/confirm) |
| `orderShippedExternal` | info, `badge:false` | `orderNumber, tracking` | `order:shipped_external:<orderId>` |
| `dispatchDueTomorrow` | info | `count, labelNotPushed, orderNumbers` (top 5, comma-joined) | `dispatch:due_tomorrow:<localDate>` |
| `dispatchDueToday` | warning | same | `dispatch:due_today:<localDate>` |
| `dispatchOverdue` | error, `escalateOn:'count'` | same | `dispatch:overdue:<localDate>` |
| `orderSyncFailed` (existing) | warning | `provider: 'Etsy'` | `ordersync:etsy` (after 3 consecutive poll failures) |

  Suggested TR text for `dispatchOverdue` with `labelNotPushed`:

  ```
  {count} siparişin kargolama tarihi geçti{labelNotPushed, plural, =0 {} other {; # etiket hazır, takip numarası Etsy'de değil}}
  ```

---

### 4. Other workstreams

**W1 (processor):**
- Route every `order.*` webhook group to `handleEtsyOrderEvent({ ...ctx, receiptId })`, using `receiptIdFromPayload`.
- It does one receipt GET at `EtsyPriority.Webhook` and writes via `upsertEtsyReceipt`. Any order event type is accepted.
- It returns `{ outcome: 'ignored', note: 'receipt not found' }` on 404.
- It sets `EtsyShop.lastWebhookAt`, which the incremental job uses to decide that webhooks are healthy.
- Errors propagate, so `EtsyDeferError` from `etsyFetch` reaches the worker unchanged.
- **The processor's private `handleOrder` and its `syncAllOrders` fallback can be deleted.** `fetchSingleEtsyReceipt` is still exported for compatibility.

**W1 (scheduler):** `orderJobs` registers the five jobs listed in `lib/orders/jobs.ts`. The cron route `pages/api/cron/sync-orders.ts` excludes `etsy-api` only while `getLastSuccessfulRun('etsy-orders-incremental')` is under 30 minutes old.

**W2 (stock):**
- The `stock_apply:<itemsHash16>:<open|cancelled>` effect calls `applyOrderToStock(orderId, { source: 'etsy_webhook'|'etsy_poll'|'order_scan', sourceEventId })`. It runs once per (order, items, open/cancelled) state, so a cancellation produces a second, `:cancelled` row (the restock).
- `OrderItem.listingRef` / `variantRef` / `variantValueKey` are written for Etsy lines. `variantRef` is `etsyVariantKeys` over the transaction variations that **have a value_id**, which excludes buyer personalization text.
- The cron calls `scanOrdersForStock({ userId })` after each user's syncs.
- `trendyol-orders-fast` uses `listUsersWithLiveStockChannel('trendyol')`.

**W3:** missing listing ids from receipts go fire-and-forget to `ensureListingsCached(shopId, ids, { max: 20 })`. The live `getListingFirstImage` fallback was removed.

**W5:** W4 passes `badge`, `entity` and `escalateOn` to `notify()`. For the overdue rollup, W4 also compares `params.count` with the stored row itself: it re-raises only when the count rises and otherwise uses `onlyIfNew`. This works before and after W5's `escalateOn` lands.

---

### 5. API added or changed (all behind existing auth)

- **`POST /api/shipments/[shipmentId]/void`** takes `{ action: 'carrier' | 'confirm_manual' }`.
  - MNG is cancelled through `cancelMngShipment` and becomes `voided` (`carrier_api`).
  - UPS and FedEx become `void_requested` with `code: MANUAL_VOID_REQUIRED` and `carrierPortalUrl`.
  - `confirm_manual` sets `voided` (`manual`).
  - `shipmentId = order:<orderId>` handles FedEx labels that live on the order row. `confirm_manual` there sets `Order.labelStatus = 'voided'` and marks the order's open `LabelJob` rows `voided` (`shippingLabelUrl` is kept for the record). Lifecycle flags, the label guard, dispatch and the effect drain treat `labelStatus 'voided'` as "no active label" (`hasLegacyOrderLabel` in `lib/orders/orderStatus.ts`), so the cancelled-after-label badge clears. It also publishes a live `shipment.voided` + order `updated` event.
  - Every successful path resolves the `orderCanceledAfterLabel` alert.
  - `DELETE /api/shipments/[id]/delete` is unchanged.
- **`GET|POST /api/orders/lifecycle-flags`** takes `ids` (max 200) and returns `{ flags: { [orderId]: OrderLifecycleFlags } }`.
- **`GET /api/orders/dispatch-health?days=90`** returns `DispatchHealth`.
- **`GET /api/integrations/etsy/address-pending`** uses extension auth and returns `{ pending: [{ orderId, receiptId, orderUrl }], count }`. It returns ids only.
- **`GET /api/integrations/etsy/tracking-pending`** keeps the same response shape.
  - Cancelled orders and numbers already present on the Etsy receipt are now excluded. `SHIPPED` is still included.
  - It accepts an optional `?cursor=<lastSubmissionId>`.
- **The four label routes** call the guard after auth and before any carrier call. `labels/ups.ts` and `labels/mng.ts` now also check that the order belongs to the caller (404 otherwise). Before this, both wrote to or read the order by id alone.

---

### 6. Ops / rollout

1. **Scripts.** All four are dry-run by default and print counts only:
   - `scripts/backfill-order-source-and-refs.ts`
   - `scripts/backfill-order-hashes.ts`
   - `scripts/close-stale-tracking-submissions.ts`
   - `scripts/normalize-legacy-order-statuses.ts`

   Writing requires `KX_ALLOW_PROD_WRITE=1 npx tsx scripts/<name>.ts --apply --db-host=<host of DATABASE_URL>`. The scripts never load `.env.local`. The suggested order is source/refs, then statuses, then tracking. `backfill-order-hashes` is **optional** (writers compute NULL hashes lazily) and safe at any time: "historical / quiet" is keyed on "the order has no `OrderEffect` row yet" (`quietForExistingWrite` in `lib/orders/orderEffects.ts`), **not** on `orderHash IS NULL`, so filling hashes does not re-arm cancel / new-order / shipped alerts for old orders.
2. **No flag is needed for the pipeline.** The jobs run under W1's in-process scheduler; the kill switch is `KX_DISABLE_INPROCESS_JOBS=1`. The GitHub cron stays as the safety net.
3. **Chrome extension.** `chrome-extension/manifest.json` is now **9.6.0**. It adds the `alarms` permission, which shows no install warning. It was **built but not published** (A1).
4. **What changes visibly after deploy:**
   - Cancelled orders and orders shipped outside KolayXport get a 409 from the label routes. Until 2a, 2b and 2c are integrated, the drawers show the code string (`ORDER_CANCELLED`) as their error, and there is no override.
   - Unchanged orders are no longer rewritten on every sync.
   - The first sync after deploy computes NULL hashes from the stored rows and rewrites no items.
   - **Alerts on pre-W4 orders.** An order with no `OrderEffect` row is quiet on its first W4 write only when its stored state class already equals the incoming one (the seller has seen it), or, for Etsy, when the receipt's `updated_timestamp` is older than 48 h. A real open -> cancelled / shipped transition on an old Amazon/eBay/Veeqo/Shippo/Trendyol/Wix/Shopify/Etsy order still raises its alert.
   - **Etsy unchanged receipts are not rewritten.** When order hash, items hash, status, address, name and every derived field match, `upsertEtsyReceipt` skips the row update and the effect insert; it only refreshes `lastRemoteCheckAt` (raw SQL, older than 5 min, or `lastEventAt` too for a webhook) without bumping `Order.updatedAt`. The nightly 90-day reconcile therefore does not wake W2's `updatedAt`-paged stock scan for every Etsy order.
   - **One failing receipt cannot stall Etsy polling.** `runEtsyOrderIncremental` isolates each receipt. A failure is logged as `orders.etsy.receipt_failed` (system event) and holds the persisted cursor at that receipt's timestamp for up to 3 consecutive runs. After that it is logged as `orders.etsy.receipt_skipped` and the cursor moves on; the nightly reconcile and webhooks still retry it. The manual Sync reports each failed receipt in `errors` as `etsy:<shopId>:<receiptId>`.
   - **Etsy shop resolution.** Etsy receipts have no `shop_id` (0 of 457 prod receipts carry one). `upsertEtsyReceipt` now stores the shop under `rawData._kxShopId`. The label guard's live re-check and the return-window lookup resolve the shop from `_kxShopId`, then from `Order.marketplace === EtsyShop.shopName`. If neither matches, the label guard tries each active shop (up to 3) and the return policy uses the 30-day fallback. See `lib/orders/etsyShopResolve.ts`.

### 7. Known deviations from the spec

- Components live in `components/orders-live/` instead of `components/orders/` (A7).
- The close-stale script sets `submitted` (`matched_remote`) when the receipt shows the **same** number, and `submitted_external` only for a different number. This matches the live `close_tracking_shipped` effect.
- `Order.lastEventAt` is also set by a poll that observes a status change, not only by webhooks. The `ORDER_SHIPPED_EXTERNALLY` guard and badge therefore work even while webhooks are down.
- The spec's DB tests (`test/db/*`) were not written; the brief said to skip them. They are covered by mocked unit tests: `test/orders/etsyLifecycle.test.ts`, `itemUpsert.test.ts` and `safeDbAndMarketplaceWrite.test.ts`.

### 8. Cross-workstream issues

- **W2 (stock):** `scanOrdersForStock` pages on `Order.updatedAt`. W4 writers no longer bump `updatedAt` for unchanged orders. Only the Etsy unchanged path writes `lastRemoteCheckAt`/`lastEventAt`, and it does so through raw SQL. A W2 scan that needs "touched by a poll" must therefore use `lastRemoteCheckAt`, not `updatedAt`.
- **Presentation (labels page / `OrderLifecycleBadges`):** no change is required. After `confirm_manual` on `order:<id>`, `/api/orders/lifecycle-flags` returns `cancelledAfterLabel: false` and `voidTargetId: null`, and a live order `updated` event is published, so an SWR revalidate on that event clears the badge. Any existing UI check of the form `labelStatus === 'created' || shippingLabelUrl` that decides whether to show "label exists" should also exclude `labelStatus === 'voided'`.

---

<!-- source: docs/integration/parts/W5-notifications.md -->

## W5-notifications — integration notes

W5 delivers the notification backend and a new page at `/app/bildirimler`. The backend covers the registry, preferences, the outbox/dispatcher, the digest, retention, live events and the APIs. The UI session owns the presentation files listed below, and W5 does not edit them. Each section here describes an exact change for that session to make.

### 1. What landed (no action needed)

| Area | Files |
|---|---|
| Core `notify()` / `resolve()` / feed (contract kept) | `lib/notifications.ts` |
| Registry (isomorphic) | `lib/notificationCenter/registry.ts`, `params.ts`, `time.ts` |
| Preferences | `lib/notificationCenter/preferences.ts`, `preferencesService.ts` |
| Outbox / dispatcher / digest / retention | `lib/notificationCenter/outbox.ts`, `dispatcher.ts`, `digest.ts`, `retention.ts`, `jobs.ts` |
| Channels | `lib/notificationCenter/channels/{types,inApp,email,telegram,index}.ts` |
| Server render (email) | `lib/notificationCenter/render.ts` |
| APIs | `pages/api/notifications/index.ts` (extended), `activity.ts` (new), `preferences.ts` (new); `read.ts` is unchanged |
| Page + UI | `pages/app/bildirimler.tsx`, `components/notification-center/*` |
| i18n | `messages/fragments/notificationCenter.{en,tr}.json`, `scripts/i18n/merge-fragments.ts` (+ `mergeFragmentsCore.ts`) |
| Tests | `test/lib/notifications.test.ts` (rewritten), `test/notifications/{preferences,dispatcher}.test.ts`, `test/i18n/mergeFragments.test.ts` |

#### API contracts

- **`GET /api/notifications`**: the existing call (`?limit=20`) still returns `{ items, unreadCount }`. Two fields are additive: `nextCursor`, and new per-item fields `badge`, `entityType`, `entityId` and `resolvedAt`.
  - Optional query parameters: `feed=badge|activity|all` (default `badge`, the bell), `cursor`, `group=orders|dispatch|listings|stock|account|system`, `unread=1` and `includeResolved=1`.
  - **`unreadCount` now counts only `badge=true`, unread, unresolved rows.**
  - Optional header `X-KX-Locale: tr|en`. The server stores it as `NotificationSettings.locale` at most once per hour, so emails go out in the UI language.
- **`POST /api/notifications/read`**: unchanged (`{ ids?: string[], all?: boolean }` returns `{ ok: true }`). It now also publishes a live `notification.read` event, so the other tabs update.
- **`GET /api/notifications/activity`** (new): returns `{ items, unreadCount, nextCursor }` for the `badge=false` rows, including resolved ones.
- **`GET|PUT /api/notifications/preferences`** (new): see the header comment in `pages/api/notifications/preferences.ts`. Admin-only types are hidden from, and rejected for, non-admin users.

#### Behaviour

- **Registry.** `lib/notificationCenter/registry.ts` is the single source of the per-type defaults. It follows spec W5 T1 (changing a default is a founder decision, not a code default):

  | Type(s) | In-app | Email |
  |---|---|---|
  | `orderCanceledAfterLabel`, `dispatchOverdue`, `dispatchDueToday`, `stockPushFailed`, `listingDeleted`, `listingDeactivated`, `reauthRequired` | on | instant |
  | `dispatchDueTomorrow`, `listingExpired`, `stockOutOfStock`, `seoExperimentReady` | on | daily digest |
  | `orderCanceled`, `orderSyncFailed`, `stockDrift`, `stockUnmatchedSale`, `draftSyncFailed`, `draftConflict`, `usageNearLimit`, `usageLimitReached` | on | off |
  | `orderNew`, `orderShippedExternal`, `listingChangedExternally` | activity feed only (no badge; `listingChangedExternally` is also in-app off) | off |
  | `webhookBacklog` | admin only | instant |

  New orders do not raise the bell badge: the chime and the live row on the orders page come from W6's `order` live event; the `orderNew` row shows in the Activity feed.

  There are three presets:
  - **critical** (*Sadece kritik*): error-severity types only.
  - **recommended** (*Önerilen*): the defaults in the table above.
  - **all** (*Hepsi*): every type.
- **Preference resolution.** The first match wins:
  1. the user's row for the type
  2. the user's `'*'` row
  3. the preset
  4. the registry default

  A type whose in-app setting is off is still written, with `badge=false`, so it shows in the Activity feed.
- **Emitter `badge` option.** `NotifyInput.badge` defaults to true. An explicit `badge:false` always makes the row activity-only. `badge:true` cannot override a registry activity type or an in-app preference that is off.
- **Raise rules.** Every raise (a create or a re-raise) does three things:
  - inserts a `NotificationDelivery` row per enabled channel, with status `pending`, or `digest` when the email mode is digest. Older open deliveries (`pending`/`held`/`digest`) of the same notification and channel are marked `skipped` (`superseded`), so there is at most one open delivery per notification and channel. An instant channel is not re-queued if the same notification was sent (or is being sent) on it within the last 6 h (`REEMAIL_COOLDOWN_MS`), unless the raise escalated (`escalateOn` param rose, or severity went up). Losing a concurrent create race for the same dedupeKey only refreshes params (no second delivery or live event);
  - triggers the dispatcher in-process. The trigger is debounced by 1.5 s and is off when `KX_DISABLE_INPROCESS_JOBS=1`;
  - publishes a live event:
    - badge rows publish `{type:'notification', action:'raised', notification, unreadCount}`, which the W6 client maps to the names `notification.new` and `notification.changed`;
    - activity rows publish `{type:'invalidate', keys:['/api/notifications/activity']}`.
- **Resolving.** `resolve()` and `resolveByPrefix()` mark open deliveries `skipped` and publish `notification.resolved`.
- **Dispatcher.**
  - Quiet hours default to 23:00–08:00 in the user's timezone (default `Europe/Istanbul`). They hold non-error emails; errors are always sent immediately.
  - Failed sends are retried after 1 min, 5 min, 30 min and 2 h, then marked `failed`.
  - When Postmark is not configured, the delivery is marked `skipped`.
  - If the user reads the notification before a held email goes out, the email is skipped.
- **Digest.** At most one email per user per local day, at `digestHour` (default 08:00). If `digestHour` falls inside quiet hours, the digest goes out at the first non-quiet moment after it (e.g. digestHour 23 with quiet 23–08 sends at 08:00). It lists the digest items plus the unread badge items from the last 24 h. Candidate users are picked with a distinct query, so one user's backlog cannot starve others.
- **Scheduled jobs.** These are registered through `lib/scheduler/jobs.ts`, so W1's runner and cron fallback pick them up:

  | Job | Schedule | Purpose |
  |---|---|---|
  | `notifications-dispatch` | every 1 min | send due deliveries |
  | `notifications-digest` | every 15 min | daily digest |
  | `notifications-retention` | daily at 04:40 UTC | delete read or resolved rows older than 90 d, unread rows older than 180 d, and terminal deliveries older than 30 d. Unresolved rows of state-bearing types (`reauthRequired`, read by `getOpenReauthFlags` / connectionStatus) are never deleted by age |

- **Telegram.** The channel exists behind the `NotificationChannel` interface but sends nothing in this build. It needs both `TELEGRAM_BOT_TOKEN` and a linked chat id, and there is no linking flow yet. The preferences screen shows it as "Yakında" (coming soon).

Production (read-only check on 2026-10-15): `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` are set, `TELEGRAM_BOT_TOKEN` is not set, there is 1 admin and there are 7 users, and the `Notification` table is empty. **Once deployed, instant emails for the types listed above go to users' account email addresses by default.**

---

### 2. `components/NotificationBell.tsx` (UI session)

Goal: show the new types correctly, desktop Popover 380 px, mobile full-height Drawer (z-index 1500), Today/Earlier, severity dot, "Tümünü gör" link, settings gear.

Replace the local `titleFor` / `REQUIRED_PARAMS` / `list` JSX with the W5 panel:

```tsx
import NotificationPanel from '@/components/notification-center/NotificationPanel';
// ...inside the component (keep useNotifications, router, isMobile, anchorEl, close):
const panel = (
  <NotificationPanel
    items={items}
    unreadCount={unreadCount}
    isLoading={isLoading}
    locale={locale}
    fullHeight={isMobile}
    onItemClick={(item) => {
      if (!item.readAt) void markRead([item.id]);
      close();
      if (item.link) router.push(item.link);
    }}
    onMarkAllRead={() => void markAllRead()}
    onNavigate={close}
  />
);
```

Mobile drawer (replaces the bottom sheet):

```tsx
<Drawer
  anchor="right"
  open={open}
  onClose={close}
  sx={{ zIndex: 1500 }}
  PaperProps={{ sx: { width: '100%', maxWidth: '100vw', height: '100%', pt: 'env(safe-area-inset-top, 0px)' } }}
>
  {panel}
</Drawer>
```

Desktop: keep the existing `<Popover>`. Put `{panel}` inside it; the panel is already 380 px wide (`sm:w-[380px]`).

`NotificationPanel` renders titles with `useNotificationText`. That hook uses `notifications.<titleKey>` and falls back to `notificationCenter.<titleKey>`, applies the same required-parameter fallback as today, and covers the new types. Remove the bell's `kinds.*` rewrite of the `kind` param. The usage messages already `select` on the raw `kind` value, so the rewrite made them fall through to `other`.

Badge semantics are unchanged: the bell shows `unreadCount` from the API, which now counts only `badge=true` rows.

### 3. `lib/hooks/useNotifications.ts` (UI session)

1. **Send the UI locale** so emails are rendered in it:
   ```ts
   import useLocaleStore from '@/lib/stores/useLocaleStore';
   const fetcher = async (url: string) => {
     const locale = useLocaleStore.getState().locale || 'tr';
     const res = await fetch(`${url}?limit=${LIMIT}`, { credentials: 'same-origin', headers: { 'X-KX-Locale': locale } });
     ...
   };
   ```
2. **Live updates (W6).**
   - `lib/live/names.ts` maps the `notification.raised`, `read` and `resolved` events to `notification.changed`. Inside the hook, add:
     ```ts
     import { useLiveRevalidate } from '@/components/live/useLiveEvent';
     useLiveRevalidate(['notification.*'], NOTIFICATIONS_KEY, { enabled });
     ```
   - Optionally, apply `event.unreadCount` and `event.notification` optimistically through `mutate(prev => ...)` before revalidating.
   - When the stream is live, relax `refreshInterval` from 60 s to 120 s.
3. Optionally, extend `NotificationItem` with `badge?: boolean; resolvedAt?: string | null; entityType?: string | null; entityId?: string | null;`. Everything is additive, and `normalizeNotifications` may ignore these fields.

### 4. `components/AppLayout.js` (UI session): nav entry

In `buildNavGroups` → group `id: 'account'` (bottom), add before Settings:

```js
{ href: '/app/bildirimler', icon: Bell, label: t('notifications') },
```

`Bell` is not imported in AppLayout yet: add it to the existing `lucide-react` import list (around line 39). The `nav.notifications` key already exists in both EN and TR, so it needs no new i18n key. The Cmd+K palette picks up nav entries automatically.

Optional: add an `unreadBadge: true` flag that shows `useNotifications().unreadCount` next to the nav entry, using the same pattern as `messageBadge`.

### 5. `pages/ayarlar.tsx` (UI session): optional link only

The preferences live on `/app/bildirimler?tab=preferences`, not in ayarlar (per A8). If a pointer is wanted, add a row to the Account tab:

```tsx
<Link href="/app/bildirimler?tab=preferences" className="...">{t('notificationCenter.prefs.title')}</Link>
```

That would need `useTranslations()` without a namespace, or `useTranslations('notificationCenter')` with `t('prefs.title')`.

### 6. i18n (integrator)

- The fragments are `messages/fragments/notificationCenter.{en,tr}.json`, with the single top-level key `notificationCenter`.
- **Relocation:** move `notificationCenter.types.*` to `notifications.types.*`. The `titleKey` values (`'types.orderNew'`) resolve under the `notifications` namespace.
  - `scripts/i18n/merge-fragments.ts` already performs this move through `RELOCATIONS` in `mergeFragmentsCore.ts`.
  - Everything else stays in the new top-level `notificationCenter` namespace: `typeLabels`, `groups`, `severity`, `page`, `panel`, `prefs` and `email`.
- Commands:
  ```bash
  npx tsx scripts/i18n/merge-fragments.ts --check          # validate all fragments (exit 1 lists conflicts / en-tr mismatches)
  npx tsx scripts/i18n/merge-fragments.ts                  # write messages/en.json + tr.json (key order kept, new keys appended)
  npx tsx scripts/i18n/merge-fragments.ts --out /tmp/i18n  # dry write to a scratch dir
  ```
  `--check` passed on 2026-10-15 with the notificationCenter and liveOrders fragments: +133 leaves in each locale.
- Before the merge, the server renderer reads the fragment from disk, so emails are correct on day one. The client UI (page and panel) falls back from `notifications.types.*` to `notificationCenter.types.*`. Other `notificationCenter.*` UI strings render only after the merge, so the merge must ship with this page.

### 7. Emitter contract (W1–W4): new notification types

Use `titleKey: 'types.<type>'`, take dedupe keys from `notificationKeys.*` in `lib/notifications.ts`, and send at least the **required params**. If a required param is missing, the generic fallback line is shown instead (`lib/notificationCenter/params.ts`).

| type | severity | dedupeKey | required params (optional) | escalateOn | link |
|---|---|---|---|---|---|
| orderNew | info | `notificationKeys.order(id,'new')` | orderNumber (total, currency, itemCount, lastUnit) | – | `/app/labels?highlight=<id>` |
| orderCanceled | warning | `order(id,'canceled')` | orderNumber | – | `/app/labels` |
| orderCanceledAfterLabel | error | `order(id,'canceledAfterLabel')` | orderNumber (carrier, tracking, labelCost) | – | label/void page |
| orderShippedExternal | info | `order(id,'shippedExternal')` | orderNumber | – | `/app/labels` |
| dispatchOverdue / DueToday / DueTomorrow | warning / warning / info | `dispatch('overdue'\|'today'\|'tomorrow', localDate)` | count (labelNotPushed, orderNumbers) | `count` | `/app/labels` |
| listingDeactivated / Expired / Deleted | error / warning / error | `listing(listingId, kind, day?)` | title | – | `/app/etsy-listings` |
| listingChangedExternally | info | `listing(listingId,'changed', day)` | title | – | `/app/etsy-listings` |
| stockOutOfStock | warning | `stockOut(stockItemId)` | sku | – | `/app/stok-senkron` |
| stockPushFailed | error | `stockPush(linkId, window)` | sku, channel | – | `/app/stok-senkron` |
| stockDrift | warning | `stockDrift(localDate)` | count | `count` | `/app/stok-senkron` |
| stockUnmatchedSale | warning | `stockUnmatched(localDate)` | count (skus) | `count` | `/app/stok-senkron` |
| seoExperimentReady | info | `seoExperiment(id)` | title | – | experiment page |
| webhookBacklog (via `notifyAdmins`) | error | `webhookBacklog(hourBucket)` | – (count, oldestMinutes) | – | admin cockpit |

Pass `entity: { type: 'order'|'listing'|'stockItem'|..., id }` where it applies; it is stored as `entityType` and `entityId`. A rollup that should alert again only when it grows must pass `escalateOn: 'count'`; otherwise every call re-raises. To clear a row, call `resolve(userId, key)` with the same key, for example when an order is labelled or a listing is reactivated.

### 8. Env / ops

- `POSTMARK_SERVER_TOKEN` and `POSTMARK_FROM_EMAIL` are already set in production.
- `KX_DISABLE_INPROCESS_JOBS=1` is the kill switch for the in-process dispatcher trigger. The scheduled jobs still run through W1's scheduler and the cron fallback.
- `TELEGRAM_BOT_TOKEN` is optional, and Telegram stays inert without a linking flow.
- `relationMode="prisma"`: retention deletes deliveries explicitly before it deletes notifications.

### 9. Cross-workstream issues (found in the W5 review; owners must act)

W5 now limits emails on its side: a raise supersedes the older open deliveries, and there is a 6 h re-email cooldown unless the raise escalated. The emitters below still re-raise on every call, which bumps the bell and publishes a live event each time. Each owner should add the flag shown:

- **`lib/etsy/etsyToken.ts` (legacy-Credential path, owner of etsyToken).** It calls `raiseReauth` on every `InvalidGrantError`, so it fires on every token fetch. Pass `onlyIfNew: true` in that `notify()` call. A resolved row still re-raises, so a fresh incident after a reconnect is not lost.
- **`lib/orderSync.ts` `notifyOrderSyncFailed` (owner of orderSync).** It runs on every failed provider fetch (cron every 15 min) without `onlyIfNew`. Pass `onlyIfNew: true`. `resolve(ordersync:<provider>)` on success already re-arms it.
- **`lib/integrations/connectionStatus.ts` (owner of connectionStatus).** It treats an Etsy shop as needing reauth only when an unresolved `reauthRequired` notification exists, and its `etsyShops` select ignores `EtsyShop.needsReauth`. W5 retention now never deletes unresolved `reauthRequired` rows. Still, also read `EtsyShop.needsReauth` (or `isShopReauthBlocked`) so the connections page does not depend on a notification row. A parked shop never raises that row again.
- **UI session (`components/NotificationBell.tsx`, orders page).** `orderNew` is an activity-feed row (`badge=false`, spec W5 T1), so new orders do not raise the bell's unread count. The new-order chime and the live row come from W6's `order` live event. The bell gets `{type:'invalidate', keys:['/api/notifications/activity']}` for each order, so do not play a sound on `notification.raised` for orders.
- **Emitters passing `badge:false` (W4 `lib/orders/orderEffects.ts`).** This is now honoured for every type, not only unknown ones.

---

<!-- source: docs/integration/parts/W6-live.md -->

## W6-live — real-time events, new-order sound

The goal: a new order makes a sound and shows up in every open tab within seconds. Nobody presses Sync or reloads the page.

### What W6 landed (no presentation file edited)

| File | What it is |
|---|---|
| `lib/live/types.ts` | `LiveEvent` union, `LiveEnvelope`. Additive changes to the W0 contract: `sync.kind` gains `'status'` with `phase`/`serverTime`/`transport`; `LiveEnvelope.name?`; `LiveOrderSummary.thumbnail?`; `LiveOrderInput.thumbnail?` and `items[].image?` |
| `lib/live/names.ts` | Event names and aliases (isomorphic), `LIVE_SWR_PREFIXES` |
| `lib/live/bus.ts` | Postgres `NOTIFY kx_live` / `LISTEN` fan-out. It keeps one dedicated `pg` client per process, reconnects with backoff, runs a ping watchdog, delivers locally while not listening, truncates payloads to 7900 bytes, and keeps a per-user replay buffer |
| `lib/live/publish.ts` | `publishLive`, `publishOrderEvent`, `buildOrderLiveEvent`, **new** `publishNewOrders` (batch helper), **new** `LIVE_ORDER_SELECT` |
| `lib/live/sse.ts` | SSE framing and headers (pure) |
| `pages/api/live/stream.ts` | The authenticated SSE endpoint |
| `components/live/LiveEventsProvider.tsx` | The single browser consumer: stream, cross-tab relay, toasts, sound, title badge, SWR revalidation, polling fallback |
| `components/live/LiveAppMount.tsx` | The mount point: wraps the provider with `useSession()` + route gating (`/app/*` only) and the user id. Mounted once in `_app.tsx` |
| `components/live/useLiveEvent.ts` | `useLiveEvent`, `useLiveRevalidate`, `useLiveStatus`, `useRecentLiveOrders`, `useHighlightParam`, `revalidateSwrPrefix` |
| `components/live/orderSound.ts` | Web Audio chime. Settings in localStorage `kx_order_sound_muted` / `kx_order_sound_volume` |
| `components/live/LiveSoundToggle.tsx` | Header button for sound on/off with a live-status dot |
| `components/live/liveStore.ts` | Module stores for status, recent orders and the per-user resume state (lastEventId, seen ids, unseen count), plus the window-event helper |
| `messages/fragments/liveOrders.{en,tr}.json` | Strings under the `liveOrders` namespace |
| `test/live/bus.test.ts`, `test/live/stream.test.ts` | Unit tests, plus an HTTP test of the SSE handler |

`package.json` is unchanged: `pg@^8.16.0` and `@types/pg` are already dependencies. Next 16 externalises `pg` on the server by default.

### How it flows

```
publishLive(userId, event)                       (any process: Next server, in-process worker, tsx script, cron route)
  └─ NOTIFY kx_live {userId, envelope}  (Prisma, pooled connection; payload ≤ 7900 B)
       └─ LISTEN kx_live  (Next server: 1 dedicated pg connection, application_name kx-live-listen)
            └─ bus registry → GET /api/live/stream (SSE)  → leader tab's EventSource
                                                          └─ BroadcastChannel('kx-live:<userKey>') → that user's other tabs
                 every tab: window CustomEvent('kx:live') + SWR revalidate + toast/sound (order.new)
```

- **Delivery rule.** While the process is LISTENing, the bus sends each event only through NOTIFY, and LISTEN echoes it back. This gives one delivery path, no duplicates, and works across processes. While LISTEN is reconnecting, the bus also delivers in-process right away. With `KX_LIVE_TRANSPORT=local`, or when there is no DB URL, delivery is in-process only.
- **One stream per browser and account.** Production nginx speaks HTTP/1.1 (`listen 443 ssl;`, no http2), so a browser allows only 6 connections per origin. One SSE per tab would starve the page's API calls after a few tabs. Tabs therefore elect a leader with the Web Locks API (`kx-live-leader:<userKey>`), and only the leader holds the EventSource. If Web Locks or BroadcastChannel is missing, each tab opens its own stream.
- **Account isolation.** `userKey = liveUserKey(session.user.id)` (lib/live/names.ts) scopes the channel and lock names, so another account's tabs never share a leader or a relay. The server's hello frame (sent first, before any replay) carries the stream user's `userKey`; the client consumes nothing until it matches, and drops/reopens a foreign stream. The server also re-checks the session every ~5 min and closes the stream on sign-out or account switch.
- **Sound.** Audio unlock is per document, so the chime goes to whichever tab can play: the focused tab at once, a visible unfocused tab after ~80 ms, hidden armed tabs after 350-800 ms (staggered). The first to play posts a claim on the channel and the rest stand down. Leadership plays no role. If no tab has been clicked since load, nothing can play (browser policy); `LiveSoundToggle` shows "click to enable" in that state.
- **Missed events.**
  - Every event has an `id:`. On a native reconnect the browser sends `Last-Event-ID`; a manual reopen sends `?lastEventId=`. The server replays from a per-user buffer (last 50 events / 5 min).
  - After any reconnect, the client also dispatches a synthetic `sync.status` with phase `reconnected` and revalidates orders and notifications.
  - If the stream is down for more than 60 s, the client dispatches `sync.status` with phase `polling` every 60 s and revalidates.
- **SSE details (A5).**
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` (`no-transform` stops Next's `compress: true` gzip from buffering the stream), `X-Accel-Buffering: no`, and `retry: 5000`.
  - A `: ping` comment every 20 s. Every third ping is also a `sync.status` heartbeat data frame, so the client can detect a half-open connection: it reopens after 75 s without data.
  - Limits: 10 streams per user (the oldest is evicted), 5000 streams per process, connections rotated every ~30 min (with `retry: 250` and replay), and slow consumers above 1 MB of buffered data are dropped.
  - The bus unsubscribes on `req close`, `res close` and `res error`; the HTTP test checks that the subscriber count returns to 0.
- **Wire format.** Frames are unnamed (`data:` only, so every frame arrives as an EventSource `message`). The canonical name travels inside the JSON as `envelope.name`. Named SSE events would silently drop any name the client had not registered.

#### Event names (what `useLiveEvent` / `useLiveRevalidate` accept)

The canonical name is `${type}.${kind|action}`. Each event also answers to `type`, `type.*` and `*`. The aliases in the table below let the names from the task brief work as written.

| Name you can subscribe to | Fires on |
|---|---|
| `order.new` | the importer published `order.new` |
| `order.updated` | `order.updated`, **and every `shipment.*`** |
| `order.canceled` / `order.cancelled` | order cancelled |
| `order.shipped`, `order.delivered`, `order.label_created` | as named |
| `notification.new` | `notification.raised` |
| `notification.changed` | raised, read or resolved |
| `listing.changed` | listing created, updated, deactivated, expired or changed_externally, **and every `draft.*`** |
| `listing.removed` | listing deleted |
| `stock.changed` | changed, push_applied, settings_changed, out_of_stock |
| `stock.alert` | out_of_stock, drift, unmatched_sale, push_failed |
| `sync.status` | client-side only: phase `reconnected` or `polling` (hello and heartbeat are not dispatched) |
| `sync.finished` | a sync run finished (`newOrders` / `updatedOrders`) |
| `invalidate` | generic: `keys[]` are SWR key prefixes |

**Automatic revalidation (no page code needed).** For every event, the provider revalidates the SWR keys that start with the prefixes below. It throttles per prefix with a 1 s leading + trailing window: the first event refetches at once, and any further events inside the window cause exactly one more refetch when it ends (so back-to-back orders both show up).

| Event type | SWR prefixes revalidated |
|---|---|
| `order` | `/api/orders` |
| `shipment` | `/api/orders`, `/api/shipments` |
| `notification` | `/api/notifications` |
| `stock` | `/api/stock` |
| `connection` | `/api/integrations/status` |
| `invalidate` | each key in `keys` |
| `sync.finished` with new orders | `/api/orders` |

Because of this, `useOrders` (orders/labels page), `useNotifications` (NotificationBell) and `useConnections` refresh live with **no edits**. Pages that fetch without SWR (the Etsy listings page) use `useLiveRevalidate` with their own refetch function; see section 3.

---

### Presentation changes for the UI session

#### 1. `pages/_app.tsx` — mount the live provider ONCE (REQUIRED) and `components/AppLayout.js` — the sound toggle (REQUIRED)

**Why `_app.tsx` and not AppLayout:** AppLayout is rendered inside each page (`<AppLayout title=…>` in labels.tsx, etsy-listings.tsx, financials.tsx, …; only two pages use `getLayout`), so React unmounts it on every client-side navigation. A provider there would drop the stream and its Web Lock (leadership jumps to another, possibly never-clicked tab) on every click. `LiveAppMount` is safe in `_app.tsx`: it opens the stream only when `useSession()` is `authenticated` **and** the route is under `/app`, so public and marketing pages never open one.

`pages/_app.tsx` — add the import next to the other component imports:

```tsx
import LiveAppMount from '@/components/live/LiveAppMount';
```

and render it once, right after `<Toaster position="top-center" />` (it must be inside `SessionProvider`, `NextIntlClientProvider` and `ThemeProvider`, which it is there):

```tsx
        <Component {...pageProps} />
        <Toaster position="top-center" />
        {/* Live events: SSE stream, new-order chime + toast, live SWR refresh. Signed-in /app/* only. */}
        <LiveAppMount ordersPath="/app/labels" />
        <LimitReachedDialog />
```

Props: `ordersPath?: string` (default `/app/labels`), `pathPrefixes?: string[]` (default `['/app']`; add `'/admin'` if admins should get live events there). Do **not** also mount `LiveEventsProvider` in AppLayout. If you ever mount `LiveEventsProvider` directly, pass `userId={session.user.id}`: it scopes the cross-tab channel/lock and the hello check.

`components/AppLayout.js` — the sound toggle only. Add the import next to `import NotificationBell from './NotificationBell';` (line ~51):

```js
import LiveSoundToggle from './live/LiveSoundToggle';
```

Put the toggle immediately **before** the bell (line ~828), so the sound control and the bell sit together:

```jsx
              <LiveSoundToggle
                sx={{ width: 44, height: 44, borderRadius: '8px', '&:hover': { bgcolor: 'rgb(248 250 252)' } }}
              />
              <NotificationBell enabled={Boolean(session)} />
```

- **Size.** The 44×44 size and the hover colour match the neighbouring `w-11 h-11 … hover:bg-slate-50 rounded-lg` buttons. The toggle stays visible on phones, because sound is the main point of this feature.
- **Props.** `LiveSoundToggle` takes `size?: 'small' | 'medium'` and `sx?`. It only reads module stores, so remounting it with the page is fine.
- **Title.** The provider prefixes `document.title` with `(N) ` while new orders are unseen, and it re-applies the prefix when `<Head>` changes the title. Nothing else is needed for this.
- **Remounts are still safe.** If the provider does unmount (leaving `/app`, sign-out), it flushes a pending new-order batch (chime + toast) instead of dropping it, and a remount for the same user reconnects with `?lastEventId=` so the server replays what was published in between (buffer: last 50 events / 5 min).

#### 2. `pages/app/labels.tsx` — highlight the order opened from the toast, and mark live arrivals (RECOMMENDED)

The list already refreshes by itself through the automatic `/api/orders` revalidation. The `highlight` query param already survives the page's filter↔URL sync, because non-filter keys are preserved at line ~1683.

Add the import:

```tsx
import { useHighlightParam, useRecentLiveOrders } from '@/components/live/useLiveEvent';
```

Inside the component, after `orderGroups` is defined (line ~1810), add:

```tsx
  // Live: ?highlight=<orderId> from the new-order toast; recently arrived orders get a "New" chip.
  const { highlightId, clear: clearHighlight } = useHighlightParam();
  const recentLiveOrders = useRecentLiveOrders();
  useEffect(() => {
    if (!highlightId) return;
    if (!orderGroups.some((g) => g.orderId === highlightId)) return;
    setExpandedCardId(highlightId);
    requestAnimationFrame(() => {
      document.getElementById(`order-card-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [highlightId, orderGroups]);
```

On the card `<Paper key={group.orderId} …>` (line ~2662), add the `id` and a temporary ring:

```tsx
                <Paper
                  key={group.orderId}
                  id={`order-card-${group.orderId}`}
                  elevation={isExpanded ? 3 : 1}
                  onClick={highlightId === group.orderId ? clearHighlight : undefined}
                  sx={{
                    border: '1px solid',
                    borderColor: highlightId === group.orderId ? 'success.main' : isExpanded ? 'primary.light' : 'divider',
                    boxShadow: highlightId === group.orderId ? (theme) => `0 0 0 3px ${theme.palette.success.light}` : undefined,
                    transition: 'box-shadow 300ms ease, border-color 300ms ease',
                    borderRadius: 1.5,
                    overflow: 'hidden',
                  }}
                >
```

In the card header, next to the order number, add a small chip for orders that arrived live in the last 15 min:

```tsx
{recentLiveOrders.has(group.orderId) && (
  <Chip size="small" color="success" label={tLive('badge.new')} sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />
)}
```

The chip needs `const tLive = useTranslations('liveOrders');` and the key `liveOrders.badge.new`, which is already in the fragment: EN "New", TR "Yeni". If the desktop table view uses different row markup, apply the same `id`, ring and chip there.

- **Optional.** Remove the 120 s `refreshInterval` that `useOrders(…, 'labelsPage')` passes, or raise it to 300 s (it lives in `lib/hooks/useOrders.ts:126`). Live events plus the reconnect and polling fallback make it redundant, but it is harmless to keep.
- **Optional.** The manual "Sync" button can stay. It now matters only for marketplaces whose importers do not publish (see the emitter checklist below).

#### 3. `pages/app/etsy-listings.tsx` — live refresh without SWR (REQUIRED for live listings)

This page loads with `fetchListings()` / `fetchPendingDrafts()`, so automatic SWR revalidation does not reach it. Add the import:

```tsx
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
```

After `fetchPendingDrafts`, `fetchListings` and `fetchStatusCounts` are declared (around line ~1600), add:

```tsx
  // Live: Etsy webhooks / stock pushes / draft syncs refresh the grid without a manual Sync.
  useLiveRevalidate(
    ['listing.changed', 'listing.removed', 'stock.changed'],
    () => Promise.all([fetchListings().then(() => fetchStatusCounts()), fetchPendingDrafts()]),
    { throttleMs: 3000 },
  );
```

Because `listing.changed` also matches every `draft.*` event, staged-draft status (syncing, synced, failed, conflict) updates live too. The handler is held in a ref, so an inline function does not cause a re-subscribe. The throttle is leading plus trailing, so a burst of webhook events costs at most 2 fetches per 3 s.

**Caution.** If `fetchListings()` toggles a full-page loading state, use a "silent" variant (no spinner, keep the current rows) for this call. Otherwise every webhook makes the grid flash.

#### 4. `components/NotificationBell.tsx` / `lib/hooks/useNotifications.ts` — nothing required

`/api/notifications` is revalidated automatically on every `notification.*` event, which means immediately after `notify()` once W5 publishes; global `mutate` bypasses `dedupingInterval`. One optional change: lower `refreshInterval` from 60 s to 300 s in `useNotifications`, since the reconnect and polling fallback covers outages.

#### 5. Other pages (optional, same pattern)

| Page | Snippet |
|---|---|
| Any SWR page | `useLiveRevalidate([...names], '/api/<prefix>')` |
| Any custom-fetch page | `useLiveRevalidate([...names], refetchFn)` |
| Stock page (`pages/app/stok-senkron.tsx`, W2) | `useLiveRevalidate(['stock'], '/api/stock')` is redundant, because `/api/stock` is automatic; use `useLiveEvent(['stock.alert'], …)` for inline banners |
| Etsy activity (`pages/app/etsy-aktivite.tsx`, W3) | `useLiveRevalidate(['listing'], '/api/etsy/activity')` |
| Show connection state anywhere | `const { status } = useLiveStatus();` returns `'live' \| 'connecting' \| 'offline' \| 'polling' \| 'idle'` |

---

### i18n (`messages/fragments/liveOrders.{en,tr}.json`, namespace `liveOrders`)

| Key | Used by |
|---|---|
| `toast.newOrder`, `toast.newOrderFrom` ({marketplace}), `toast.newOrders` ({count}, plural), `toast.items` ({count}, plural), `toast.cancelled` ({orderNumber}), `toast.cancelledHint`, `toast.open`, `toast.close` | `LiveEventsProvider` toasts |
| `sound.on`, `sound.muted`, `sound.needsClick`, `sound.clickToMute`, `sound.clickToEnable` | `LiveSoundToggle` tooltip / aria-label |
| `status.live`, `status.connecting`, `status.offline`, `status.polling` | `LiveSoundToggle` tooltip |
| `badge.new` | labels page "New" chip (section 2) |

Merge each fragment as a new top-level `liveOrders` key. Until it is merged, next-intl shows the key paths.

---

### Emitter checklist (backend workstreams; nothing here is a presentation file)

All publish calls are fire-and-forget, never throw, and must run **after** the DB write commits. Import them with:

```ts
import { publishLive, publishOrderEvent, publishNewOrders, LIVE_ORDER_SELECT } from '@/lib/live/publish';
```

#### W4 (orders): required for the founder's acceptance test

- **`lib/orders/etsyLifecycle.ts` → `upsertEtsyReceipt`.** This covers webhook `order.paid`, the poll, reconcile and the manual button. After the transaction commits:

  ```ts
  const row = await prisma.order.findUnique({ where: { id: orderId }, select: LIVE_ORDER_SELECT });
  if (row) {
    if (created) publishOrderEvent(userId, row, 'new');                 // chime + toast + live row
    else if (statusChangedTo === 'cancelled') publishOrderEvent(userId, row, 'cancelled');
    else if (statusChangedTo === 'shipped') publishOrderEvent(userId, row, 'shipped');
    else if (statusChangedTo === 'delivered') publishOrderEvent(userId, row, 'delivered');
    else if (changed) publishOrderEvent(userId, row, 'updated');
  }
  ```

  For a bulk catch-up (the first poll after connect, or a backfill), use `publishNewOrders(userId, rows, { scope: 'etsy' })` instead of a loop. It announces only orders dated within 72 h, at most the 10 newest individually, and the rest as one `sync.finished { newOrders }`, so a 500-order first import does not chime 500 times. The client also refuses to chime for orders older than 72 h.
- **Until W4 lands, the W0 stub `handleEtsyOrderEvent` path.** After `syncEtsyOrders` creates the order, add `publishOrderEvent(userId, createdRow, 'new')` there; `createdRow` comes from `findFirst(... select: LIVE_ORDER_SELECT)` at `lib/orders/etsyLifecycle.ts:66`.
- **`lib/orderSync.ts` batch writer** (Trendyol, eBay, Shopify, Wix, Amazon, Veeqo, Shippo). After the `ordersToCreate` transaction (line ~1566), add:

  ```ts
  const createdRows = await prisma.order.findMany({
    where: { userId, marketplaceKey: { in: ordersToCreate.map((o) => o.marketplaceKey) } },
    select: LIVE_ORDER_SELECT,
  });
  publishNewOrders(userId, createdRows, { scope: String(marketplace || 'orders') });
  ```

  At the end of a run with `ordersUpdated > 0`, publish once instead of per order: `publishLive(userId, { type: 'sync', kind: 'finished', scope, newOrders: 0, updatedOrders: ordersUpdated })`.
- **Label routes** (`generate-label.ts`, `labels/ups.ts`, `labels/mng.ts`, `shipments/[id]/void.ts`, `submit-tracking.ts`). Publish `publishLive(userId, { type: 'shipment', kind: 'created' | 'voided' | 'tracking_submitted' | 'failed', orderId, shipmentId, carrier, trackingNumber })`. The orders page in other tabs then refreshes, because `shipment.*` is aliased to `order.updated` and revalidates `/api/orders`.
- **Manual order creation** (`pages/api/orders/manual*`, if present): publish `publishOrderEvent(userId, row, 'new')`.

#### W5 (notifications) — per A8

In `notify()`, after the upsert creates or re-raises a **badge** notification, call `publishLive(userId, { type: 'notification', action: 'raised', notification: toNotificationItem(row), unreadCount })`. The `notification` value has the same shape as the GET items, and `unreadCount` is optional. Mark-read should publish `{ type: 'notification', action: 'read', ids, all }`, and `resolve()` should publish `{ type: 'notification', action: 'resolved', dedupeKeys }`. The bell then refreshes in every tab and device.

#### W3 (listings)

- After the refresh/upsert in `handleEtsyListingEvent` / `refreshListingFull`, publish `publishLive(userId, { type: 'listing', kind, marketplace: 'etsy', shopId: String(shopId), listingId: String(listingId), title, state, attribution, versionId })`. `kind` is `deleted` for a 404.
- The draft sync executor should publish `{ type: 'draft', kind: 'syncing' | 'synced' | 'failed' | 'conflict', marketplace: 'etsy', draftId, listingId }`. W1/W3 own `draftService.ts`.
- Reconcile jobs should publish at most one `{ type: 'invalidate', keys: ['live:listing'] }` per shop per run, never one event per listing.

#### W2 (stock)

After ledger writes, publish `{ type: 'stock', kind: 'changed', stockItemId, sku, onHand }`. Alerts use `kind: 'out_of_stock' | 'drift' | 'unmatched_sale' | 'push_failed'`, push results use `push_applied`, and the setup wizard and Go Live use `settings_changed`.

#### W1 (backbone)

- Nothing is required. `publishLive` works from the in-process worker; the bus state is a `globalThis` singleton, so separate Next bundles share one LISTEN connection.
- The admin monitoring cockpit can show `liveBusStatus()` from `lib/live/bus.ts`: transport, listenerState, subscriber count, and published/delivered/notifyErrors/reconnects counters.

---

### Ops notes (not code, for the integrator / founder)

- **No new env vars are required.** The transport is `pg` whenever `DIRECT_URL`/`DATABASE_URL` is set. `KX_LIVE_TRANSPORT=local` is a kill switch that keeps delivery in-process only; that still works because production is a single process.
- **DB cost.** One extra Postgres connection per server process (`application_name='kx-live-listen'`). Production has `max_connections=100` with ~15 in use.
- **nginx (recommended, not required).** The SSE response headers already disable buffering, and `proxy_read_timeout 300s` is well above the 20 s heartbeat. Two optional hardening steps for `/etc/nginx/sites-enabled/kolayxport`:

  ```nginx
  # lifts the 6-connections-per-origin HTTP/1.1 limit for users with many tabs
  listen 443 ssl;  http2 on;          # nginx ≥ 1.25.1  (older: `listen 443 ssl http2;`)

  location = /api/live/stream {
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 1h;
  }
  ```

- **Smoke test after deploy.**
  1. Run `curl -N -H "Cookie: <session cookie>" https://kolayxport.com/api/live/stream`. It should print `retry: 5000`, then a `sync.status` hello, then `: ping` every 20 s.
  2. On the server, run `psql "$DATABASE_URL" -c "SELECT pg_notify('kx_live', json_build_object('userId','<id>','envelope',json_build_object('id','t1','v',1,'ts',(extract(epoch from now())*1000)::bigint,'name','order.new','event',json_build_object('type','order','kind','new','order',json_build_object('id','x','marketplace','etsy','orderNumber','TEST','totalPrice',1,'currency','USD'))))::text)"`. An open, clicked-once tab should chime and show the toast.

---

### Cross-workstream issues

- None open from the W6-live review. The mount location changed from `components/AppLayout.js` to `pages/_app.tsx` (section 1); the UI session must not mount the provider in AppLayout as an earlier draft of this note said. `LiveSoundToggle` still goes in AppLayout.

---

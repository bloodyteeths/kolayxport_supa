# W0-contracts — schema, migrations, contract stubs

No presentation file needs to change for W0. This file records what W0 landed so the integrator and the other workstreams agree on it.

## Conventions for every workstream

- **Presentation changes**: write them to `docs/integration/parts/<workstream>.md` (file, location, exact JSX/code, props, i18n keys). Do not edit presentation files yourself.
- **i18n**: put strings in `messages/fragments/<namespace>.en.json` and `<namespace>.tr.json`. Each fragment is a JSON object whose single top-level key is the namespace, e.g. `{ "stockSync": { ... } }`. The allowed new namespaces are `liveOrders`, `stockSync`, `listingHistory`, `seoExperiments`, `orderPipeline`, `etsyOps` and `notificationCenter`. The integrator merges each one as a new top-level key of `messages/en.json` and `messages/tr.json`.
- **New notification types**: texts go in `messages/fragments/notificationCenter.*.json` under `notificationCenter.types.<type>`. The integrator places them at `notifications.types.<type>`, because `titleKey` resolves under the `notifications` namespace. Emitters use `titleKey: 'types.<type>'`.

## Migrations (additive only; generated with `prisma migrate diff`, no DB touched)

| Migration | Contents |
|---|---|
| `20261015100000_etsy_event_backbone` | `WebhookEvent` gets eventTypes, priority, processingStartedAt, heartbeatAt, firstReceivedAt, note, deferrals and 2 indexes. `EtsyShop` gets poll/reconcile cursors, needsReauth/needsReauthAt and tokenRefreshLeaseUntil. `EtsyDraftSyncAttempt` gets remoteUpdatedTimestamp, etsyListingId and an index. New tables: `EtsyApiUsage`, `EtsyApiQuota`, `JobRun`. |
| `20261015100100_notification_center_v2` | `Notification` gets entityType, entityId, badge (default true), raiseCount and 2 indexes. New tables: `NotificationDelivery`, `NotificationPreference`, `NotificationSettings`. |
| `20261015100200_order_lifecycle` | `Order` gets source, cancelledAt, deliveredAt, shipByAt, shippedLate, returnWindowEndsAt, orderHash, itemsHash, lastEventAt, lastRemoteCheckAt and 4 indexes. `OrderItem` gets listingRef, variantRef, variantValueKey and an index. `Shipment` gets voidedAt, voidError, voidMethod. `TrackingSubmission` gets closedReason, closedAt. New table: `OrderEffect`. |
| `20261015100300_etsy_listing_intel` | `EtsyListing` gets hasVariations, quantityOnProperty, inventorySyncedAt, contentHash, lastWebhookAt, lastRefreshAt, stateChangedAt. New tables: `EtsyListingOffering`, `EtsyListingVersion`, `EtsyListingDailyStat`, `SeoExperiment`. |
| `20261015100400_stock_sync` | New tables: `StockSettings` (enabled=false, dryRun=true by default), `StockItem`, `StockLink`, `StockLedger`, `StockPush`, `StockObservation`, `StockSnapshot`. |

The timestamps differ from the spec's `20261015090x00`, because `20261015090000_notifications` already exists and is applied in production. No FK constraints are emitted (`relationMode = "prisma"`).

## Contract modules (final signatures; bodies are safe no-ops until the owner lands)

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

## Live events (W6) — how emitters call them

```ts
import { publishLive, publishOrderEvent } from '@/lib/live/publish';
publishOrderEvent(userId, orderRow, 'new');            // after the order row commits (W4)
publishLive(userId, { type: 'notification', action: 'raised', notification: item }); // in notify() (W5)
publishLive(userId, { type: 'listing', kind: 'deactivated', marketplace: 'etsy', shopId, listingId: String(id) }); // W3
publishLive(userId, { type: 'stock', kind: 'changed', stockItemId, sku, onHand });  // W2
```

The SSE transport (W6) must send the headers `Content-Type: text/event-stream`, `Cache-Control: no-cache` and `X-Accel-Buffering: no`, plus a heartbeat comment every `LIVE_HEARTBEAT_MS` (20 s).

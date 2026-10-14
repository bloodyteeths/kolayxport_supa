# W4 — Order pipeline: integration notes

W4 owns the order write paths, the label guard, the effect outbox, dispatch alerts, the tracking/address queues and the Chrome extension v9.6.0. Nothing was committed, built or deployed.

The A3 item-cascade fix (commit 35a73ee) is kept and generalised. `lib/orders/itemUpsert.ts` is now the only OrderItem writer for every marketplace. The same delete-and-recreate bug also existed in `lib/sync/trendyol.ts`, `wix.ts` and `shopify.ts` (`items: { deleteMany: {}, create }`). Those three files also nulled `trackingNumber`, `shippingLabelUrl`, `labelStatus` and `shippedAt` on every sync. Both bugs are fixed through `lib/orders/marketplaceOrderWrite.ts`.

---

## 1. Live new-order events (A2): who publishes what

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

## 2. Presentation changes for the other session (do NOT edit from W4)

The new components live in `components/orders-live/`:
- `CancelledOrderLabelDialog.tsx`: the default export, plus `isLabelGuardResponse(status, body)`.
- `OrderLifecycleBadges.tsx`: props `{ orderId, flags, onChanged?, compact? }`.
- `useOrderLifecycleFlags.ts`: `useOrderLifecycleFlags(orderIds)` returns `{ flags, mutate, isLoading, error }`. It revalidates itself on live `order` and `shipment` events.
- `DispatchHealthCard.tsx`: props `{ days?: number }`.

All of them use `useTranslations('orderPipeline')`. They are mobile-first and need no DataGrid. The dialog uses z-index 1550, so it renders above the drawers.

### 2a. `components/UPSLabelDrawer.tsx`

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

### 2b. `components/MngLabelDrawer.tsx`

This uses the same pattern. The body gets `forceCancelled: forceRef.current || undefined`. After `const data = await res.json();` (~line 152), add:

```tsx
if (isLabelGuardResponse(res.status, data)) { setGuardCode(data.code); return; }
```

The dialog's `onConfirm` sets `forceRef.current = true`, closes the dialog, and calls `handleSubmit()` again.

### 2c. `pages/app/labels.tsx`

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

### 2d. `pages/app/index.js` (dashboard)

Mount the card in the existing card grid, with `import DispatchHealthCard from '@/components/orders-live/DispatchHealthCard';`. Show it only when the user has an Etsy connection, using the same condition as the other Etsy widgets:

```jsx
<Grid item xs={12} md={6}><DispatchHealthCard /></Grid>
```

### 2e. Nav / settings

None. The dispatch alerts and the order notifications go through the existing bell and W5's page.

---

## 3. i18n

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

## 4. Other workstreams

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

## 5. API added or changed (all behind existing auth)

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

## 6. Ops / rollout

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

## 7. Known deviations from the spec

- Components live in `components/orders-live/` instead of `components/orders/` (A7).
- The close-stale script sets `submitted` (`matched_remote`) when the receipt shows the **same** number, and `submitted_external` only for a different number. This matches the live `close_tracking_shipped` effect.
- `Order.lastEventAt` is also set by a poll that observes a status change, not only by webhooks. The `ORDER_SHIPPED_EXTERNALLY` guard and badge therefore work even while webhooks are down.
- The spec's DB tests (`test/db/*`) were not written; the brief said to skip them. They are covered by mocked unit tests: `test/orders/etsyLifecycle.test.ts`, `itemUpsert.test.ts` and `safeDbAndMarketplaceWrite.test.ts`.

## 8. Cross-workstream issues

- **W2 (stock):** `scanOrdersForStock` pages on `Order.updatedAt`. W4 writers no longer bump `updatedAt` for unchanged orders. Only the Etsy unchanged path writes `lastRemoteCheckAt`/`lastEventAt`, and it does so through raw SQL. A W2 scan that needs "touched by a poll" must therefore use `lastRemoteCheckAt`, not `updatedAt`.
- **Presentation (labels page / `OrderLifecycleBadges`):** no change is required. After `confirm_manual` on `order:<id>`, `/api/orders/lifecycle-flags` returns `cancelledAfterLabel: false` and `voidTargetId: null`, and a live order `updated` event is published, so an SWR revalidate on that event clears the badge. Any existing UI check of the form `labelStatus === 'created' || shippingLabelUrl` that decides whether to show "label exists" should also exclude `labelStatus === 'voided'`.

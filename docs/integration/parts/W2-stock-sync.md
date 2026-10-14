# W2-stock-sync — integration notes

Cross-marketplace oversell prevention: a canonical per-SKU hub (`StockItem`) with an idempotent ledger, expected-state tracking per marketplace listing (`StockLink`), and read-before-write pushes (`StockPush`) to Etsy, Trendyol, Shopify and eBay. Wix writes are behind a verification flag. Amazon and Hepsiburada are "coming soon" stubs.

## Safety model (founder decision A1)

| State | `StockSettings` | Marketplace writes | What happens |
|---|---|---|---|
| Never set up | no row | none | Every hook is a no-op: one cached lookup (30 s). |
| Off | `enabled=false` | none | Items, links and history are kept. |
| Dry run | `enabled=true, dryRun=true` | **none** | Sales and cancels move the hub. The push worker records `dry_run` rows (what *would* be sent) and never calls an adapter. The Etsy draft hook returns products unchanged. |
| Live | `enabled=true, dryRun=false` | yes | Reached only through `PUT /api/stock/settings {dryRun:false, confirmToken}`. The token comes from `POST /api/stock/preview?live=1`, lasts 15 min and is an HMAC over the plan. A typed word is required when the plan deactivates listings or disables variations. A `StockSnapshot` (kept 7 days) is taken first. |

Global kill switch: `STOCK_SYNC_GLOBAL_DISABLE=1` turns everything off for all users. Nothing writes stock to any marketplace before Go Live.

---

## 1. Presentation changes for the UI session (do not edit; fold in)

### 1a. Nav entry — `components/AppLayout.js`

In the regrouped nav, put the entry in the same group as the Etsy/marketplace product pages:

```js
{ href: '/app/stok-senkron', labelKey: 'stockSync.pageTitle', icon: Inventory2RoundedIcon /* or lucide <Boxes /> */ }
```

- **Label:** use `useTranslations('stockSync')` → `t('pageTitle')` (TR "Stok Senkronu", EN "Stock Sync").
- **Alternative label:** if nav labels must stay under the `nav` namespace, add `nav.stockSync` with the same two strings.
- **Icon:** `import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'`.
- **Cmd+K:** add the same entry to `components/CommandPalette.tsx` routes, if that file has a route list.

### 1b. Managed quantities in `components/etsy/VariationEditor.tsx` (A7: integration note instead of an edit)

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

### 1c. Nothing else on existing pages

- **Bell:** new notifications reach the bell through W5's `notify()`. The page and the editor revalidate on live events through W6 (`useLiveRevalidate(['stock.changed','stock.alert'], …)`).
- **Live provider:** `components/live/LiveEventsProvider` must be mounted in AppLayout (W6's note). Without it the page still works, but it only refreshes on actions.

---

## 2. New page and components (owned by W2, already in the tree)

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

## 3. i18n

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

## 4. Live events (W6 `publishLive`, all after commit, never throw)

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

## 5. Hooks other workstreams call (`lib/stock/hooks.ts`, signatures unchanged from W0)

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

## 6. API (all session-auth, user-scoped; every id and account ref is checked for ownership)

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

## 7. Env / ops

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

## 8. Known gaps / deviations

- **No DB-backed test suite.** Per instructions, `test/db/*` was not created. The engine idempotency rules run against an in-memory Prisma fake in `test/stock/engine.test.ts` instead.
- **Trendyol order key:** it is the shipment package id (`rawData.id`), not `orderNumber`. One `orderNumber` can be split into several package rows; production has 5 such orders.
- **Shared pools and partial `quantity_on_property`:** when several links control products in one Etsy quantity group, the minimum target wins (oversell-safe).
- **Unmatched-sale rollup:** the count is kept per process and resets on restart. The notification still re-raises only when the count grows.
- **eBay:** one account per user (`accountRef='default'`). Legacy (non-Inventory-API) listings are `unsupported`.
- **Shopify:** uses Admin GraphQL `inventorySetQuantities` with `compareQuantity` on API 2024-10. When the client's API version is bumped to 2026-04+, rename the field to `changeFromQuantity`.

---

## 9. Review fixes (2026-10-15) and cross-workstream issues

### What changed inside W2 (no action needed elsewhere)

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

### Cross-workstream issues

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

# Overview (home) redesign: review of the plan and corrected spec

**Bottom line:** most of the plan's code claims hold up against the `kx-ux-phase0` checkout at `92087ba`. The serious problems are elsewhere:
- Plan usage only covers "near limit"; a fully blocked account would never show up.
- `getUsageSnapshot` would copy the wrong Shopify-free rule.
- `recoverStaleSyncingDrafts` already works user-wide, so the extra variant isn't needed.
- "Tracking not pushed" and "overdue" both undercount.
- `recent[].marketplaceKey` clashes with an existing `Order` column of the same name.
- Using Amazon, eBay or Wix logos because "we are authorised by each channel" is a legal assumption I could not confirm.

I edited nothing and did not touch the DB or prod.

## A. Plan claims that checked out

- `pages/app/index.js` is 391 lines and contains `SETTINGS_KEY` (:32), `ORDERS_PROBE_KEY` (`/api/orders?limit=1&page=1`, :36), 6 gradient `QuickActionCard` tiles, a sync step linking to `/app/labels`, the `allFeaturesFree` banner linking to `/ozellikler`, and the `session_id` toast. All as the plan says.
- **Dead "failed" label filter:**
  - `labelStatus==='failed'` filters on `o."labelStatus"='failed'` (`pages/api/orders/index.ts:334-335`).
  - Nothing ever writes `'failed'`. The only `labelStatus` write is `'created'` in `pages/api/orders/[orderId]/generate-label.ts:563`.
  - FedEx failures go to `LabelJob{status:'failed'}` (:628-634).
  - UPS (`pages/api/labels/ups.ts:227`) and MNG (`pages/api/labels/mng.ts:161`) write nothing on failure.
  - The labels page sends `labelStatus=failed` (`pages/app/labels.tsx:1731-1732`).
  - Fix 3 matters even more than the plan says: the page decides "failed" on the client from `labelJobStatus` (labels.tsx:1393), so the server filter and the badge disagree.
- **`/api/analytics`:** `dateRange=day` runs from today 00:00 to 23:59. The previous period is the window of equal length before it, which means all of yesterday. It uses server-local `new Date(y,m,d)`. There is no status filter, so cancelled and refunded orders count. Revenue is in TRY only, and it does a full findMany plus 12-month queries.
- **Usage limits:** `plans` is at `lib/middleware/withUsageLimiter.ts:17`, trial limits `{orderSync:50,label:10}` are inline in `checkUsage`, `NEAR_LIMIT_RATIO=0.8`, and the counter reset is lazy and writes to the DB inside `checkUsage`.
- **Drafts:** `GET /api/etsy-drafts` returns 400 without `shop_id` (`pages/api/etsy-drafts/index.ts:15`).
- **Messages:** `/api/messages?action=counts` is fetched through `useMessageCountStore`. AppLayout polls it every 180 s, and only while Wix or Trendyol is connected (AppLayout.js:296-304).
- **Connections:** `useConnections` exposes `needsReauth[]`, `connections[p].reason` (5 reasons, `lib/integrations/connectionStatus.ts:62-67`), `extension.detected`, `has()` and `anyMarketplace`. `fedex`, `ups` and `mng` are valid `ConnectionProvider`s (:29-31, :432-441).
- **Notifications:** `useNotifications` has `type` and `link` (link sanitised), and `listNotifications` already hides resolved rows. `orderSyncFailed` is a real type.
- **Schema:** `OrderItem.quantity` (schema:197) and `OrderItem.shipBy` (:203) exist. `TrackingSubmission.etsySubmitStatus` exists, and `needs_manual` is used in `tracking-pending.ts:36`.
- **Etsy matching:** `STATUS_FILTER_GROUPS` is exported at `pages/api/orders/index.ts:31`. The unpaid exclusion is at :160 and the unlabeled SQL at :383-396. `tracking-pending.ts:33-43` matches Etsy by `marketplace` containing "etsy" or by shop names.
- **Labels deep links:** `sort=shipBy`, `status=onaylandi`, `label=unlabeled|labeled|failed`, `from=all` and `qt=all` are all valid. The default window is 30 days (`DEFAULT_WINDOW_DAYS`, labels.tsx:1429). A search ignores dates.
- **Settings and FX:**
  - `/ayarlar` tabs are `connections, billing, apiKeys, senderProfile, syncAdvanced`.
  - `ConnectEmptyState` has `KEY_BASED` at :15, but it is not exported.
  - `localeConfig` sets `defaultCurrency` to TRY or USD.
  - The FX rates are TRY-per-unit with `rates.USD` = TRY per USD, so TRY→USD = `try / rates.USD` is correct.
- **Logo files:** `/public/logos` has `etsy.svg, amazon.svg, trendyol.png, hepsiburada.png, shopify.jpg`, and also `n11.png` and `woocommerce.svg`, which the plan didn't list. There is no eBay or Wix logo; `pages/entegrasyonlar.js:27,30` set `logo: null`.

## B. Errors and corrections

1. **Drafts recovery is wrong.** `recoverStaleSyncingDrafts(userId, shopId?)` in `lib/etsy/draftService.ts:1336` already takes `shopId` as optional, so calling it with just `userId` covers every shop. No new variant is needed. eBay has no list-level recovery, only an inline 10-minute check inside its sync (`lib/ebay/draftService.ts:304`). The summary must count eBay `syncing` rows with `updatedAt` older than 10 minutes as `failed`, read-only, or they show as "syncing" forever.
2. **The Shopify-free rule is copied from the wrong place.**
   - `/api/user/settings` treats an account as free when `billingProvider==='shopify_free'` OR it has an active Shopify shop.
   - The plan says `subscriptionPlan`, which is a different field.
   - Enforcement (`checkUsage`) only checks `subscriptionPlan==='shopify_free'`.
   - So a user with an active Shopify shop but a different plan looks unlimited in settings but is still limited by enforcement. `getUsageSnapshot` must take its limits from the `checkUsage` logic, and use the settings rule only to hide billing CTAs (`hideBilling`).
3. **Missing usage state: blocked.** `checkUsage` refuses every sync and label when the trial has ended and the subscription isn't active (`noSubscription`), when the plan is invalid (`invalidPlan`), or when a counter is at its limit. A user in that state can do nothing, and the plan only had `nearLimit`. Add `usage.blocked` plus a reason, shown as the top error row.
4. **`tryConvertToTRY` is not module-level.** It is a closure inside the handler (`analytics/index.ts:192-206`) over `exchangeRates`. Only `fetchLiveRates` and `getExchangeRates` (:29-76) are module-level. Extracting it means a pure `convertToTRY(amount, currency, rates)` in `lib/fx.ts`. Analytics' previous period also uses `uiOrderDate` only plus `convertToTRY` (which counts unconverted orders as 0). The new KPIs must not copy that.
5. **Overdue and due-today undercount.** `/api/orders` falls back to `rawData.due_date`, `ship_by_date` or Etsy transactions when `OrderItem.shipBy` is null (index.ts:789-816). Counting `MIN(OrderItem.shipBy)` alone misses those orders. Either describe them as orders "with a known ship-by", or backfill `shipBy` in the mappers as follow-up work.
6. **Tracking not pushed undercounts.** A `TrackingSubmission` row only exists after `submit-tracking` or `/api/tracking/etsy` runs. A labeled order whose tracking was never submitted has no row. The plan's deep link (`/app/labels?label=labeled`) also doesn't filter to pending orders. Note too that `etsySubmitStatus` defaults to `'pending'` on every row, so the Etsy restriction is required, not optional.
7. **Name clash.** `Order.marketplaceKey` already exists and holds the external order key (schema:127, used by `tracking-pending.ts`). Rename the plan's `recent[].marketplaceKey` to `channel`.
8. **"Order sync failing" never fires for Etsy or eBay.** Those fetchers are deliberately not wrapped (`lib/orderSync.ts:39-46`, `:1266-1270`). The row is still worth having, but the spec must say it can't cover the two main channels. Use the existing `notifications.types.orderSyncFailed` key instead of a new one.
9. **`StatCard` can't do what the plan says "as is".** It requires an `icon`, has no `href`, no caption and no "New" state (`StatCard.tsx:3-9`). `trend={undefined}` hides the trend, but "New" needs a new `note` prop, and the whole-card link needs a `<Link>` wrapper.
10. **The sync handler can't be reused directly.** `CommandPalette.syncOrders` redirects to `/app/labels` after a sync (`components/CommandPalette.tsx:203`) and only revalidates `/api/orders*` keys. Move it into `lib/hooks/useSyncOrders.ts` with an optional `redirectTo`, and revalidate `/api/home/summary` too.
11. **A sync costs quota.** `/api/orders/sync` is wrapped with `withUsageLimiter('orderSync')` and increments usage on success (sync.ts:196, :223). A trial user has 50. The UI must make this clear. Don't auto-sync from the setup step, and show `used/limit` beside the button when a limit exists.
12. **`setup.hasCarrier` on the server is redundant.** `has('fedex'|'ups'|'mng')` already answers it from the shared connections cache. Drop the server field. Also, `extension.detected` means the extension has pushed tracking at least once (connectionStatus.ts:91), not that it is installed. Word the step "Set up the Chrome extension" and mark it done after the first push.
13. **Two i18n keys missing from the plan:**
    - `dashboard.setup.subtitle` currently says "Three quick steps…" and must change, since there can be up to 5 steps.
    - The reason keys are justified because no translations for connection reasons exist in `messages/en.json`.
14. **Day boundaries in SQL.** Prisma `DateTime` is stored as `timestamp` without time zone, in UTC. The plan's `date_trunc('day', now() AT TIME ZONE $tz)` returns local wall-clock time and compares it to UTC columns, which puts every boundary off by the UTC offset. Compute the boundaries in JS (with `Intl`, from tz) and pass UTC `Date` parameters. Also allow `UTC`, because `Intl.supportedValuesOf` can leave it out.
15. **`/api/stats` was never mentioned.** It is unused, filters on `createdAt` (sync time, not order time), and sums mixed currencies. The spec should say it was considered and rejected, and mark it for deprecation.
16. **The existing logos are wordmarks, not square icons.** They are about 80-120 x 40 px (`components/marketing/HomeContent.js:20-25`) and won't read at 20 px in a row. `MarketplaceLogo` needs square marks.
17. **Wireframe date.** 14 October 2026 is a Wednesday, not a Tuesday.
18. **Smaller things seen in passing:**
    - FedEx `generate-label.ts` is not wrapped with `withUsageLimiter`, so FedEx labels don't count against the label limit. Only UPS and MNG do.
    - In the UPS non-EDI path (ups.ts:200-213), `prisma.shipment.create({status:'created'})` runs without checking `result.success`. Check whether `createUpsShipment` throws on failure.

## C. Brand and legal (affects the logo request; I checked the official Etsy page)

- **Etsy:** I confirmed the required notice via developers.etsy.com, which cites https://www.etsy.com/legal/api#marks: *"The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc."*
  - The app's existing copy in `pages/terms.js:57`, `pages/privacy.js:131` and `components/PublicFooter.js:107` ends "…certified by Etsy." It is missing the final ", Inc.", so fix all three.
  - The TR terms (`terms-tr.js:57`) say "tescilli markası". Plain "markası" is the accurate rendering, because the source only says "trademark", not "registered trademark".
  - The notice has to appear "in a prominent position" inside the app wherever the Etsy mark appears, not only in the terms. It is in the public footer, but not inside AppLayout.
- **I could not fetch etsy.com/legal/api (403).** So I could not confirm whether Etsy lets apps use its logo, as opposed to the word "Etsy". This is unverified.
- **"Authorised by each channel" is not the same as a logo licence.** API access usually does not grant the right to use a logo; each marketplace's brand or trademark rules decide that (Amazon, eBay, Shopify, Wix, Trendyol, Hepsiburada). Until each is checked, use the plain name (a text badge) or the officially published partner-badge assets, and keep those in one config file so they can be swapped.

## D. Corrected spec (final)

### 0. Why the current page fails (`pages/app/index.js`, 391 lines)

- **No real data.** It shows a greeting, a setup checklist (or, once that is hidden, the "All features are free" banner linking to `/ozellikler`) and 6 gradient navigation tiles. There are no counts, money figures or orders.
- **The free banner contradicts selling plans.**
- **The tiles repeat navigation** that the sidebar, MobileTabBar and Cmd+K already provide.
- **The setup checklist is weak.** The sync step links to `/app/labels`. When the usage counter is 0 it probes `/api/orders?limit=1&page=1`, which returns a heavy payload. It has no carrier step and no extension step.
- **Problems in nearby code** (fixes in §1.3):
  - The failed-label filter is dead.
  - Analytics compares part of today against all of yesterday on server time, includes cancelled and refunded orders, and is too heavy for a home page.
  - Plan limits are private.
  - `/api/stats` is unused and wrong; deprecate it.

### 1. Data plan: 1 new API call

| Need | Source | Extra request? |
|---|---|---|
| Reconnect needed | `useConnections().needsReauth` + `connections[p].reason` | No, shared SWR key |
| Carrier connected | `has('fedex') \|\| has('ups') \|\| has('mng')` | No |
| Extension used | `useConnections().extension.detected` (first push done) | No |
| Unread messages | `useMessageCountStore(s=>s.counts)` → `{wix,trendyol,total}` | No, AppLayout polls it |
| Order sync failing | `useNotifications().items` where `type==='orderSyncFailed'` (unresolved only). Does not cover Etsy or eBay. | No |
| Everything else | **`GET /api/home/summary`** | **Yes, the only new call** |

#### 1.1 `GET /api/home/summary?range=today|7d|30d&tz=<IANA>&currency=TRY|USD`

- **Files:** `pages/api/home/summary.ts` (route) and `lib/home/summary.ts` (server-only logic, unit-tested).
- **Auth:** `getAuthUser`. Return 401 if there is no user, and set `Cache-Control: private, no-store`.
- **Parameters:**
  - `tz`: accept it if it is in `Intl.supportedValuesOf('timeZone')` or equals `'UTC'`; otherwise use `Europe/Istanbul`.
  - `currency`: defaults to `localeConfig.defaultCurrency`.
- **Errors:** each section has its own try/catch. A failed section returns `null` and its name goes into `errors[]`. The route never returns 500 for one bad section.
- **Day boundaries:** computed in JS for the given tz and passed as UTC `Date` parameters. No `AT TIME ZONE` against `timestamp` columns.

```ts
interface HomeSummary {
  generatedAt: string;
  range: 'today' | '7d' | '30d';
  tz: string;
  currency: 'TRY' | 'USD';
  errors: Array<'toShip'|'labels'|'tracking'|'drafts'|'usage'|'kpis'|'recent'|'setup'>;

  toShip: null | {
    count: number;               // live AND unlabeled, all time
    overdue: number;             // min known shipBy < now
    dueToday: number;            // min known shipBy within today in tz
    withoutShipBy: number;       // orders where OrderItem.shipBy is null for every item
    oldestOrderAt: string | null;
  };
  labels: null | {
    failed: number;              // distinct orders: LabelJob failed in the last 14 days AND still unlabeled
    lastError: string | null;    // most recent errorMessage, max 140 chars
  };
  tracking: null | {
    pendingPush: number;         // Etsy orders, etsySubmitStatus in (pending, needs_manual), submittedAt < now-30min
    failed: number;              // etsySubmitStatus='failed' OR status='failed'
    labeledNotSubmitted: number; // live Etsy orders that are labeled but have NO TrackingSubmission, labeled > 2h ago
  };
  drafts: null | {
    etsy: { draft: number; failed: number; conflict: number; syncing: number };
    ebay: { draft: number; failed: number; conflict: number; syncing: number }; // syncing > 10 min counted as failed
  };
  usage: null | {
    plan: string | null;         // as enforced by checkUsage ('trial' while trialing)
    status: string | null;
    hideBilling: boolean;        // settings rule: billingProvider==='shopify_free' || active ShopifyShop
    trialEndsAt: string | null;
    resetsAt: string | null;
    orderSync: { used: number; limit: number | null };   // null = unlimited
    label:     { used: number; limit: number | null };
    nearLimit: boolean;          // any used/limit >= NEAR_LIMIT_RATIO (0.8)
    blocked: null | 'trial' | 'noSubscription' | 'planLimit' | 'invalidPlan';
  };
  kpis: null | {
    orders:  { value: number; previous: number };
    revenue: { value: number; previous: number; currency: 'TRY'|'USD';
               ratesStale: boolean; unconverted: string[] };
    units:   { value: number; previous: number };
    comparison: 'yesterdaySameTime' | 'previousPeriod';
  };
  recent: null | Array<{
    id: string; orderNumber: string;
    marketplace: string;         // raw stored value
    channel: 'etsy'|'ebay'|'amazon'|'shopify'|'wix'|'trendyol'|'hepsiburada'|'other';
    customerName: string | null;
    totalPrice: number | null; currency: string | null;
    orderedAt: string;           // COALESCE(uiOrderDate, createdAt)
    shipBy: string | null;
    state: 'toShip'|'labeled'|'shipped'|'delivered'|'cancelled';
  }>;                            // 5 rows, newest first
  setup: null | {
    hasOrders: boolean;          // EXISTS Order
    senderComplete: boolean;     // shipperProfile.shipperStreet1 && shipperCity
  };
}
```

#### 1.2 Definitions

- **Live order:** `LOWER(status)` in `STATUS_FILTER_GROUPS.onaylandi`, and not in `('awaiting_payment','pending_payment')`.
  - Move `STATUS_FILTER_GROUPS` and `expandStatusFilter` to `lib/orders/statusGroups.ts`, and re-export them from `pages/api/orders/index.ts`.
- **Unlabeled:** the exact `labelFilter=unlabeled` clause (index.ts:383-396), moved into a shared `UNLABELED_SQL` constant. Reuse its inverse for `LABELED_SQL`.
- **toShip:** live AND unlabeled, with no date window. Deep links use `from=all`.
- **KPI orders:**
  - Count orders whose `COALESCE(uiOrderDate, createdAt)` falls inside the range, with tz-based boundaries.
  - Exclude the `iptal` group and unpaid statuses, in both the current and the previous period.
- **KPI revenue:**
  - Use a new `lib/fx.ts` containing `getExchangeRates()` (moved from analytics) and a pure `convertToTRY(amount, currency, rates): number|null`. Analytics imports it too.
  - USD = TRY total / `rates.USD`.
  - Orders that can't be converted are left out of both periods, and their currencies are listed in `unconverted`.
- **Comparison:**
  - `today` compares against yesterday from 00:00 to the same time of day.
  - `7d` compares against the previous 7 days, `30d` against the previous 30.
- **Units:** `SUM(OrderItem.quantity)` over the same set of orders.
- **Usage:**
  - Export a pure `getUsageSnapshot(user, {activeShopifyShops})` from `withUsageLimiter.ts`. It mirrors `checkUsage`'s branches: shopify_free plan → unlimited; trialing and not expired → trial limits; otherwise status must be active, then `plans[plan]`; `Infinity` becomes `null`.
  - If `now >= usageResetAt`, or there is no `usageResetAt`, report `used:0`. Nothing is written.
  - `blocked` gets the reason `checkUsage` would return.
  - `hideBilling` uses the settings rule.
  - `checkUsage` should call the same helper so the two can't drift.
- **Drafts:**
  - Etsy: call `recoverStaleSyncingDrafts(userId)` (no shopId needed), then `etsyListingDraft.groupBy({by:['status'], where:{userId, status:{in:['draft','failed','conflict','syncing']}}})`.
  - eBay: the same `groupBy` on `ebayListingDraft`, plus a separate count of `syncing` rows with `updatedAt` older than 10 minutes, which are moved into `failed`.
- **Tracking:**
  - `pendingPush` and `failed` come from `trackingSubmission` where `submittedBy=userId`, Etsy orders only, matched like `tracking-pending.ts:33-43` (`marketplace ILIKE '%etsy%'` or an active `EtsyShop.shopName`).
  - `labeledNotSubmitted`: live Etsy orders matching `LABELED_SQL`, with no `TrackingSubmission`, labeled more than 2 hours ago (`Shipment.createdAt` / `LabelJob.createdAt`).
- **recent.channel:** map on the server; Etsy shop names map to `etsy`, using `lib/utils/etsyDetection.ts` and the EtsyShop list.
- **recent.state:** iptal group → `cancelled`; delivered group → `delivered`; kargolandi group → `shipped`; `LABELED_SQL` → `labeled`; otherwise `toShip`.
- **Performance:** `Order` has `@@index([userId])`, `([userId, uiOrderDate])` and `([userId, createdAt])`. Run every query in one `Promise.all`, and `EXPLAIN` the toShip query against prod-sized data before shipping.

#### 1.3 Fixes this depends on

1. **Label failures, before this page ships.**
   - In `pages/api/labels/ups.ts`, write `LabelJob{status:'failed', carrier:'UPS', errorMessage}` for each of the order's OrderItems when the EDI step-1 check fails and in the outer catch. Also check `result.success` in the non-EDI path before creating the Shipment.
   - Do the same in the `pages/api/labels/mng.ts` catch, with `carrier:'MNG'`.
   - Match FedEx (generate-label.ts:625-637).
2. **Fix the dead filter.** In `pages/api/orders/index.ts:334`, replace `labelStatus='failed'` with: `EXISTS(SELECT 1 FROM "LabelJob" lj JOIN "OrderItem" oi ON oi.id=lj."orderItemId" WHERE oi."orderId"=o.id AND lj.status='failed' AND lj."updatedAt" > now()-interval '14 days') AND <UNLABELED_SQL>`. This makes `/app/labels?label=failed&from=all` list exactly the orders the home page counts.
3. **Separate follow-up, not blocking:** wrap `generate-label.ts` (FedEx) in `withUsageLimiter(handler,'label')` so FedEx labels count against the label limit.
4. **Separate follow-up, not blocking:** a labels filter `tracking=pending` so the tracking row can link to a filtered list.

### 2. Layout and sections, in order

- **Container:** `max-w-5xl space-y-4 sm:space-y-6`. White `card-premium` cards, slate text and one brand-600 accent. Colour only appears in severity dots (StatusBadge variants). The gradients are removed.
- **Summary SWR:** key `/api/home/summary?range=${range}&tz=${tz}&currency=${cur}`, with `refreshInterval 60000`, `revalidateOnFocus true`, `keepPreviousData true`, `errorRetryCount 2`.
- **Order of sections:** Header → Setup checklist (only while incomplete) → Needs attention → KPIs → Recent orders → Quick actions.

#### Desktop (≥1024px)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Good morning, Tamer                        [Today | 7 days | 30 days] │
│ Wednesday, 14 October 2026                                            │
├──────────────────────────────────────────────────────────────────────┤
│ (Setup checklist, only while incomplete)                              │
├──────────────────────────────────────────────────────────────────────┤
│ NEEDS ATTENTION (5)                                                   │
│ ● Syncs and labels paused · trial ended                 [See plans →] │
│ ● Etsy needs reconnecting · access expired              [Reconnect →] │
│ ● 2 labels failed · "FedEx: invalid postal code"        [Review →]    │
│ ● 12 orders to ship · 3 overdue · oldest 4 days         [Create labels]│
│ ● 3 listing drafts failed · 1 conflict                  [Open drafts →]│
│ ○ 5 unread messages (Trendyol 3 · Wix 2)                [Reply →]     │
├──────────────────────────────────────────────────────────────────────┤
│ TODAY · vs. yesterday at this time                                    │
│ Orders 18 ▲12%   │  Revenue ₺24.380 ▼4%   │  Units 27 ▲8%             │
├──────────────────────────────────────────────────────────────────────┤
│ RECENT ORDERS                                          [All orders →] │
│ [Etsy] #3412 · J. Smith · $48.00 · 2h ago               ● To ship     │
│ [Trendyol] #8810 · A. Yılmaz · ₺1.240 · 3h ago          ● Labeled     │
├──────────────────────────────────────────────────────────────────────┤
│ QUICK ACTIONS [⟳ Sync orders 12/50] [+ Manual order] [+ New listing] [Research] │
└──────────────────────────────────────────────────────────────────────┘
```

#### Mobile (<640px)

```
┌───────────────────────────┐
│ Good morning, Tamer       │
│ Wed, 14 Oct               │
│ [Today][7d][30d] (full-w) │
├───────────────────────────┤
│ Needs attention      (5)  │
│ ┌───────────────────────┐ │
│ │● 12 orders to ship  ⌄ │ │ expandable; first row open
│ │  3 overdue · 4d oldest│ │
│ │  [Create labels] 44px │ │
│ └───────────────────────┘ │
├───────────────────────────┤
│ Today                     │
│ ┌──────┬────────┬──────┐  │ KpiStrip, compact numbers
│ │ 18   │ ₺24.4K │ 27   │  │
│ │Orders│Revenue │Units │  │
│ │▲12%  │ ▼4%    │▲8%   │  │
│ └──────┴────────┴──────┘  │
├───────────────────────────┤
│ Recent orders             │
│ ┌───────────────────────┐ │
│ │[logo] #3412  $48   ⌄  │ │ expanded: customer, ship-by,
│ │ 2h ago · ● To ship    │ │ [Open order]
│ └───────────────────────┘ │
├───────────────────────────┤
│ [⟳ Sync] [+ Manual order] │ 2x2 grid, 44px min height
│ [+ Listing] [Research]    │
└───────────────────────────┘
(padding at the bottom for MobileTabBar)
```

#### 2.1 Header

- Keep `firstName`/`greeting` (index.js:147-149) and `formatDate` (:280).
- Title via `PageHeader`; the range control goes in its `children`.
- Range control: MUI `ToggleButtonGroup size="small"`, at least 44 px tall on mobile.
- Store the range in `localStorage` under `kx.home.range`, inside try/catch.
- The header renders immediately, with no loading state.

#### 2.2 Setup checklist

Reuse `SetupChecklist`/`SetupStep` (index.js:61-136, moved to `components/home/`) and keep the dismiss key `kx.home.setupDismissed:<uid>`.

Steps:
1. **Connect a store** (`anyMarketplace`) → `/ayarlar?tab=connections`.
2. **First order sync** (`setup.hasOrders`).
   - CTA "Sync now" calls `useSyncOrders({redirectTo:null})` on click (never automatically), then `mutate()`s the summary.
   - The note under it shows the quota a sync uses.
3. **Sender address** (`setup.senderComplete`) → `/ayarlar?tab=senderProfile`.
4. **Connect a carrier** (`has('fedex')||has('ups')||has('mng')`) → `/ayarlar?tab=apiKeys`.
5. **Only if `has('etsy')`: set up the Chrome extension** (`extension.detected`) → `/app/entegrasyonlar-ve-rehberler`.

States:
- Hidden until both connections and `setup` have loaded, so it never flashes.
- Hidden if `setup` is null.
- The subtitle uses `{total}`, the number of steps shown.

#### 2.3 Needs attention

A single card containing a list. Rows are sorted by severity; a row with a count of 0 is hidden.

| # | Row | Shown when | CTA → link | Severity |
|---|---|---|---|---|
| 0 | Account paused | `usage.blocked` | `/fiyatlandirma` (if `hideBilling`: `/support`) | error |
| 1 | Reconnect (one row per provider) | `needsReauth.length>0` | `/ayarlar?tab=apiKeys` for KEY_BASED providers (export the list from ConnectEmptyState), otherwise `connections` | error |
| 2 | Order sync failing | unresolved `orderSyncFailed` notification | sanitised `n.link` | error |
| 3 | Labels failed | `labels.failed>0` | `/app/labels?label=failed&from=all` (needs fix 1.3.2) | error |
| 4 | Orders to ship (**primary** filled button) | `toShip.count>0` | `/app/labels?label=unlabeled&status=onaylandi&sort=shipBy&from=all` | warning; info when `overdue===0` |
| 5 | Drafts (one row per marketplace) | etsy/ebay `failed+conflict>0`, or `draft>0` | `/app/etsy-listings`, `/app/ebay-listings` | warning (failed or conflict), info (draft only) |
| 6 | Tracking not sent | `pendingPush+failed+labeledNotSubmitted>0` | extension used → `/app/labels?label=labeled&mp=etsy&from=all` (until fix 1.3.4); otherwise "Set up extension" → `/app/entegrasyonlar-ve-rehberler` | warning |
| 7 | Unread messages | `counts.total>0` and Wix or Trendyol connected | `/app/mesajlar` | info |
| 8 | Plan usage | `nearLimit`, or trial ends in ≤5 days, and not `blocked` and not `hideBilling` | `/fiyatlandirma` | warning |

States:
- **Loading:** 3 skeleton rows (MUI `Skeleton`, 56 px). Rows 1, 2 and 7 come from client caches and render straight away.
- **Empty:** `EmptyState` with a new `compact` prop (one row, no `py-16`), a CheckCircle2 icon and "All caught up".
- **Error:**
  - A section named in `errors[]` renders as an `ErrorState compact onRetry={mutate}` row.
  - If the whole request fails, one `ErrorState compact` replaces the summary-driven rows, and rows 1, 2 and 7 stay.

Mobile: each row is an expandable card. Collapsed it shows the dot, title and count; expanded it shows the detail line and a full-width 44 px CTA. The first row starts expanded.

#### 2.4 KPIs

- **Desktop:** `grid-cols-3` of `StatCard` (`color="blue"`), each wrapped in `<Link href="/app/analytics">`. Add one optional prop to StatCard: `note?: string` (for "New").
- **Trend:** `(value-previous)/previous*100`. When `previous===0`, pass `trend={undefined}` and `note={t('home.kpi.new')}`.
- **Revenue:** `useLocale().formatCurrency(value, kpis.revenue.currency)`. On mobile, `Intl.NumberFormat(config.intlLocale,{notation:'compact'})`.
- **Caption:** "vs. yesterday at this time" or "vs. previous {days} days".
- **FX badge:** if `ratesStale` or `unconverted.length`, a neutral `StatusBadge` with a tooltip.
- **Loading:** 3 skeletons.
- **Empty:** show the zeros plus a muted "No orders in this period yet".
- **Error:** `ErrorState compact`.
- **Mobile:** a new `components/ui/KpiStrip.tsx`: one card with 3 columns, no icons.

#### 2.5 Recent orders (5)

- **Row content:** `MarketplaceLogo`, the number, the customer, the amount in the order's own currency, a relative time (`Intl.RelativeTimeFormat`) and a `StatusBadge`: toShip = warning, labeled = info, shipped and delivered = success, cancelled = neutral.
- **`components/ui/MarketplaceLogo.tsx`:**
  - A `channel → asset` map in one config file.
  - Square marks only; a 20 px wordmark won't read.
  - Fallback: the channel initial in a circle plus the name as `title`/`aria-label`.
  - Until each channel's brand rules are confirmed (§C), the fallback is the default for every channel without an approved asset.
- **Row link:** `/app/labels?q=<orderNumber>&qt=order&label=all&from=all`.
- **Loading:** 5 skeleton rows.
- **Empty:** if `anyMarketplace===false`, connect-style copy and a link. Otherwise "No orders yet" plus a "Sync orders" button.
- **Error:** `ErrorState compact`.
- **Mobile:** expandable cards (customer, ship-by, "Open order").

#### 2.6 Quick actions (4, last)

- **Sync orders:** `useSyncOrders({redirectTo:null})`, extracted from `CommandPalette.tsx:183-211`. It revalidates `/api/orders*` and `/api/home/summary`, shows a spinner, and displays `used/limit` when a limit exists.
- **Manual order:** `<ManualOrderButton onOrderCreated={mutate}/>`.
- **New listing:** `/app/etsy-listings` if `has('etsy')`, otherwise `/app/ebay-listings` if `has('ebay')`; hidden if neither.
- **Research:** `/app/etsy-research`.
- **Styling:** outlined MUI Buttons with lucide icons, at least 44 px tall. A row on desktop, a 2x2 grid on mobile.

#### 2.7 Removed

The `allFeaturesFree` banner, the 6 `QuickActionCard` tiles, `ORDERS_PROBE_KEY` and the page's own `SETTINGS_KEY` fetch. Keep the Stripe `session_id` toast and the auth and redirect wrappers (index.js:332-389).

### 3. Components and files

- **Reuse:** `PageHeader`, `StatCard` (+`note`), `EmptyState` (+`compact`), `ErrorState compact`, `StatusBadge`, `ConnectEmptyState` (export `KEY_BASED`), `ManualOrderButton`, `useConnections`, `useNotifications`, `useMessageCountStore`, `useLocale`.
- **New client files:**
  - `components/home/{SetupChecklist,AttentionList,AttentionRow,RecentOrders,QuickActions}.tsx`
  - `components/ui/{MarketplaceLogo,KpiStrip}.tsx`
  - `lib/hooks/{useHomeSummary,useSyncOrders}.ts`
- **New server files:**
  - `lib/home/summary.ts`
  - `pages/api/home/summary.ts`
  - `lib/orders/statusGroups.ts` (`STATUS_FILTER_GROUPS`, `UNLABELED_SQL`, `LABELED_SQL`)
  - `lib/fx.ts`
  - `getUsageSnapshot` in `withUsageLimiter.ts`, which `checkUsage` also uses
- **Fixes:** §1.3.1 (UPS and MNG `LabelJob` on failure) and §1.3.2 (failed filter).
- **Tests (Vitest), mocking Prisma:**
  - The section definitions.
  - The tz day boundaries (Istanbul and UTC, including near midnight).
  - The `yesterdaySameTime` window.
  - `limit:null` for unlimited plans.
  - Every `blocked` reason.
  - Shopify-free (`hideBilling` vs enforced limits).
  - eBay stale-syncing counted as failed.
  - Section-level `errors[]`.
  - Failed-filter SQL parity between home and labels.

### 4. i18n (new `home` namespace, en + tr)

Remove from `dashboard`: `allFeaturesFree`, `allFeaturesFreeDesc`, `exploreFeatures`, `quickAccess`, `features.*`. They are only used in `pages/app/index.js`.

Keep: `greeting.*`, `defaultUser`, `pageTitle`, `setup.*`, `subscriptionActivated`.

For the sync-failing row, reuse `notifications.types.orderSyncFailed`.

| key | en | tr |
|---|---|---|
| home.range.today | Today | Bugün |
| home.range.7d | 7 days | 7 gün |
| home.range.30d | 30 days | 30 gün |
| home.attention.title | Needs attention | İlgilenmeniz gerekenler |
| home.attention.allClear | All caught up | Her şey yolunda |
| home.attention.allClearDesc | Nothing needs your attention right now. | Şu anda ilgilenmeniz gereken bir şey yok. |
| home.attention.blocked | {reason, select, trial {Trial limit reached} planLimit {Plan limit reached} invalidPlan {Plan needs attention} other {Syncs and labels are paused}} | {reason, select, trial {Deneme limiti doldu} planLimit {Plan limiti doldu} invalidPlan {Planınızla ilgili bir sorun var} other {Senkron ve etiketler durduruldu}} |
| home.attention.blockedDesc | Order syncs and label creation are blocked until this is resolved. | Bu sorun çözülene kadar sipariş senkronu ve etiket oluşturma kapalı. |
| home.attention.blockedCta | See plans | Planları gör |
| home.attention.blockedSupportCta | Contact support | Destekle iletişime geç |
| home.attention.reauth | {provider} needs reconnecting | {provider} bağlantısı yenilenmeli |
| home.attention.reauthCta | Reconnect | Yeniden bağlan |
| home.attention.reason.token_expired_no_refresh | Access expired | Erişim süresi doldu |
| home.attention.reason.refresh_token_expired | Authorization expired | Yetki süresi doldu |
| home.attention.reason.missing_refresh_token | Authorization incomplete | Yetkilendirme eksik |
| home.attention.reason.incomplete_credentials | Credentials incomplete | Bilgiler eksik |
| home.attention.reason.reauth_required | Access was revoked | Erişim iptal edildi |
| home.attention.syncFailingCta | View | Görüntüle |
| home.attention.labelsFailed | {count, plural, one {# label failed} other {# labels failed}} | {count} etiket oluşturulamadı |
| home.attention.labelsFailedCta | Review | İncele |
| home.attention.toShip | {count, plural, one {# order to ship} other {# orders to ship}} | Kargolanacak {count} sipariş |
| home.attention.toShipDetail | {overdue} overdue · oldest {age} | {overdue} gecikmiş · en eskisi {age} |
| home.attention.toShipDueToday | {count} due today | {count} tanesi bugün kargolanmalı |
| home.attention.toShipNoDate | {count} without a ship-by date | {count} tanesinin son kargo tarihi yok |
| home.attention.toShipCta | Create labels | Etiket oluştur |
| home.attention.draftsEtsy | Etsy: {unsynced} unsynced drafts | Etsy: senkronlanmamış {unsynced} taslak |
| home.attention.draftsEbay | eBay: {unsynced} unsynced drafts | eBay: senkronlanmamış {unsynced} taslak |
| home.attention.draftsProblems | {failed} failed · {conflict} conflicts | {failed} başarısız · {conflict} çakışma |
| home.attention.draftsCta | Open drafts | Taslakları aç |
| home.attention.tracking | {count, plural, one {# tracking number not sent} other {# tracking numbers not sent}} | {count} takip numarası pazaryerine gönderilmedi |
| home.attention.trackingCta | Review | İncele |
| home.attention.trackingSetupCta | Set up extension | Eklentiyi kur |
| home.attention.messages | {count, plural, one {# unread message} other {# unread messages}} | {count} okunmamış mesaj |
| home.attention.messagesDetail | Trendyol {trendyol} · Wix {wix} | Trendyol {trendyol} · Wix {wix} |
| home.attention.messagesCta | Reply | Yanıtla |
| home.attention.usage | {kind, select, orderSync {Order syncs} other {Labels}}: {used} of {limit} used | {kind, select, orderSync {Sipariş senkronu} other {Etiket}}: {limit} hakkın {used} tanesi kullanıldı |
| home.attention.trialEnds | Trial ends in {days, plural, one {# day} other {# days}} | Deneme süresi {days} gün içinde bitiyor |
| home.attention.usageCta | See plans | Planları gör |
| home.kpi.orders | Orders | Siparişler |
| home.kpi.revenue | Revenue | Ciro |
| home.kpi.units | Units sold | Satılan adet |
| home.kpi.vsYesterday | vs. yesterday at this time | dünün aynı saatine göre |
| home.kpi.vsPrevious | vs. previous {days} days | önceki {days} güne göre |
| home.kpi.new | New | Yeni |
| home.kpi.noOrders | No orders in this period yet | Bu dönemde henüz sipariş yok |
| home.kpi.ratesStale | Exchange rates may be outdated | Döviz kurları güncel olmayabilir |
| home.kpi.unconverted | Not included: {currencies} | Dahil edilmeyen: {currencies} |
| home.recent.title | Recent orders | Son siparişler |
| home.recent.viewAll | All orders | Tüm siparişler |
| home.recent.empty | No orders yet | Henüz sipariş yok |
| home.recent.emptyDesc | Sync your stores to see orders here. | Siparişleri görmek için mağazalarınızı senkronlayın. |
| home.recent.open | Open order | Siparişi aç |
| home.recent.shipBy | Ship by {date} | Son kargo tarihi {date} |
| home.state.toShip | To ship | Kargolanacak |
| home.state.labeled | Labeled | Etiketlendi |
| home.state.shipped | Shipped | Kargolandı |
| home.state.delivered | Delivered | Teslim edildi |
| home.state.cancelled | Cancelled | İptal |
| home.actions.title | Quick actions | Hızlı işlemler |
| home.actions.sync | Sync orders | Siparişleri senkronla |
| home.actions.syncing | Syncing… | Senkronlanıyor… |
| home.actions.syncDone | Orders synced | Siparişler senkronlandı |
| home.actions.syncQuota | {used}/{limit} syncs used | {used}/{limit} senkron kullanıldı |
| home.actions.newListing | New listing | Yeni ürün |
| home.actions.research | Research | Pazar araştırması |
| home.section.error | Couldn't load this section | Bu bölüm yüklenemedi |
| dashboard.setup.subtitle (replace) | {total} quick steps to start managing orders and labels. | Sipariş ve etiket yönetimine başlamak için {total} kısa adım. |
| dashboard.setup.sync.cta (replace) | Sync now | Şimdi senkronla |
| dashboard.setup.sync.quota | Uses 1 of your order syncs. | Sipariş senkronu hakkınızdan 1 tane kullanır. |
| dashboard.setup.carrier.title | Connect a carrier | Kargo firması bağlayın |
| dashboard.setup.carrier.desc | Add FedEx, UPS or DHL eCommerce to print labels. | Etiket basmak için FedEx, UPS veya DHL eCommerce ekleyin. |
| dashboard.setup.carrier.cta | Connect | Bağla |
| dashboard.setup.extension.title | Set up the Chrome extension | Chrome eklentisini kurun |
| dashboard.setup.extension.desc | Sends tracking numbers to Etsy automatically. Done after the first push. | Takip numaralarını Etsy'ye otomatik gönderir. İlk gönderimden sonra tamamlanır. |
| dashboard.setup.extension.cta | Set up | Kur |

Relative times ("4 days", "2h ago") come from `Intl.RelativeTimeFormat(config.intlLocale)` and need no keys.

### 5. Open points for the founder

- **Logos and legal.**
  - Fix the Etsy notice so it ends "…certified by Etsy, Inc." in `pages/terms.js:57`, `pages/privacy.js:131` and `components/PublicFooter.js:107`. Use "markasıdır" in `terms-tr.js:57`.
  - Show the notice in the app (AppLayout footer or the settings Connections tab) wherever the Etsy name or logo appears.
  - For Amazon, eBay, Shopify, Wix, Trendyol and Hepsiburada, check each channel's trademark or brand guidelines before using a logo. API approval alone does not grant logo rights. Add one trademark section to the terms (EN and TR) that names every mark and says there is no endorsement. Until then `MarketplaceLogo` uses the name fallback.
- **Pricing tiers.** The usage rows read the current `plans` object and trial limits as they are. The tier redesign is separate work and will change plan names, limits and the `blocked` and upgrade copy.
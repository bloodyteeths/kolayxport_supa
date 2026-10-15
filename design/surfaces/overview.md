# Surface spec: Overview (`/app`)

Status: ready to build (milestone **M8**, flag `overview`). Design only, no app code changed.
Contract: `design/DESIGN_SYSTEM.md` (§6.5 wireframe, §1 principles, §4 components) and `design/tokens.md`. This file makes §6.5 buildable and replaces the `home` plan in `design/launch/overview.md`. That plan's data findings are kept, re-checked against `kx-ux-phase0` at `92087ba`. Where the two disagree, this file wins.

**What the page is for:** one answer to "what do I need to do right now, and is the business OK?". It is an **action queue**. It is not a nav grid, a marketing banner or a report. Analysis (ranges, charts by channel, P&L) stays in Reports and Finance.

---

## 0. What exists today, and what is wrong with it

`pages/app/index.js` (391 lines):
- greeting plus date (`h1` 700 weight, `formatDate` long);
- a 3-step `SetupChecklist` (connect, sync linking to `/app/labels`, sender) with an emerald progress bar;
- an "All features are free" gradient banner (`dashboard.allFeaturesFree`), shown once the checklist is hidden, linking to `/ozellikler`;
- 6 gradient `QuickActionCard` tiles. One of them, "Sync", links to the orders page; two duplicate the sidebar. An `uppercase` "Quick access" heading;
- its own `SETTINGS_KEY` fetch, plus an `ORDERS_PROBE_KEY` (`/api/orders?limit=1&page=1`, a heavy payload) to tell whether any order exists;
- full-page `Loader2` spinners for auth loading and redirect.

The visual audit (#12) found no data, nothing to act on, and an empty right half. It breaks P1 (no primary), P2 (gradients, uppercase, emerald), P6 (no data) and the "no marketing banners" rule.

### Corrections to `design/launch/overview.md` (checked in code)
| Launch-plan claim | Fact at `92087ba` | Effect here |
|---|---|---|
| B.18 "FedEx `generate-label.ts` is not wrapped by `withUsageLimiter`" | It **is** wrapped (`pages/api/orders/[orderId]/generate-label.ts:650`), as are `labels/ups.ts:233` and `labels/mng.ts:167` | Drop follow-up 1.3.3 |
| KPI "Revenue" with a range toggle (`ToggleButtonGroup`) | DS §6.5 has no range control. `SegmentedControl` is banned for filters | The range is fixed: revenue over 7 days against the previous 7. Ranges live in Reports |
| Recent orders list and a Quick actions button row | Neither is in §6.5. Actions belong in `PageHeader` and ⌘K (`usePageActions`) | Both cut. The useful actions become header secondaries and overflow items |
| FX tooltip "TCMB rate" (DS §6.5 example) | `fetchLiveRates` uses `api.exchangerate-api.com/v4/latest/USD` (`analytics/index.ts:31`) | The tooltip names the real source |
| "Needs reply: Etsy 2 · Wix 1" (DS §6.5 example) | `/api/messages?action=counts` returns only `{wix, trendyol, total}` (`messages/index.ts:143-184`). Etsy has no messages API | The tile shows the Trendyol and Wix split only. Wix is capped at 50 (`limit: 50`), so it shows "50+" |
| "Top listings (7 d) … 18 sold" (DS §6.5) | `OrderItem` has no listing id (only `sku`, `productName`, `productId`→`Product`, `remoteLineId`). DS already cut "Sold 30d" until listing linkage is verified | The card becomes **"Best sellers (7 days)"**, grouped by SKU (product name when SKU is empty), counting units in orders. It is Measured and makes no claim of listing identity |
| 5-step setup checklist | DS §6.5 says 3 steps: Connect a store → Sender profile → First label | 3 steps. The carrier is folded into step 3. The extension is covered by the "Tracking not sent" queue row |

Every other finding in launch §A and §B (items 1–17) still holds and is used below: the dead `labelStatus='failed'` filter, UPS and MNG writing no `LabelJob` on failure, the `getUsageSnapshot` and Shopify-free split, `blocked`, the tz day boundaries, the shipBy undercount, the `TrackingSubmission` undercount, `Order.marketplaceKey` clashing with a new field name, Etsy and eBay not covered by `orderSyncFailed`, and sync costing quota.

---

## 1. Information architecture

```
Page width="detail" (1280, centered)                 title "Overview · KolayXport"
├─ PageHeader
│    title    = greeting ("Good morning, Tamer")      title-lg
│    subtitle = "Thursday 15 Oct · All stores"        caption (DateText long weekday)
│    meta     = SyncMeta(source 'all', lastPulledAt = ordersLastSyncedAt, onPull = sync orders)
│               + "Updated 1 min ago" (summary.generatedAt)
│    primary  = "Go to orders" (toShip.count > 0)  |  "New listing" (otherwise, if a listing marketplace is connected)  |  "Connect a store" (no store)
│    secondary   = "New listing" (when it is not the primary and Etsy/eBay is connected)
│    overflow = Add manual order · Research · Reports
├─ [state A: setup incomplete] Section "Get started" (card): SetupChecklist (3 steps). Replaces the KPI row.
├─ [state B: normal] KPI row: KpiTile ×4
├─ Section "Needs your attention" (card): AttentionQueue (≤ 7 rows + "Show N more")
├─ Grid 2 columns (8 + 4 of 12):
│    Section "Orders, last 14 days" (card): Chart bar, single series
│    Section "Best sellers (7 days)" (card): DataTable compact, 5 rows
└─ Section "Stores" (plain): StoresStrip (LogoTile + name + StatusPill + "refreshed …")
```

Order of the page = order of urgency: what is broken, what is due, how it is going, what is connected.

Primary rule (P1):
- `toShip.count > 0` → **Go to orders** (`ordersHref('to_ship')`).
- otherwise, Etsy or eBay connected → **New listing** (Etsy creator first, eBay otherwise).
- otherwise, no store connected (`anyMarketplace === false`) → **Connect a store** (`/ayarlar?tab=connections`).
- while `anyMarketplace === undefined` and the summary is loading → no primary yet (the slot is reserved: 56px title row, no jump).

On mobile the primary is state-driven only: "Go to orders" goes to `StickyActionBar`. "New listing" is a creation primary, so it goes to the TopBar `+ New` (DS §3.1). "Connect a store" stays inside the checklist card.

---

## 2. Wireframes

### 2.1 Desktop 1440, normal state (sidebar 240, content 1280 centered in the remaining 1200 → fills it, 24 gutters)

```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Overview                                         [⌘K Search or jump…]          (bell) (TS)   │ TopBar 52 (breadcrumb only)
│ Overview▪├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Orders 12│ Good morning, Tamer                                       [New listing]  ⋯  [Go to orders]  │ 56 title row
│ Messages3│ Thursday 15 Oct · All stores · Orders refreshed 8 min ago ⟳ · Updated 1 min ago               │ caption + SyncMeta
│ …        │                                                                                    16          │
│          │ ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐│
│          │ │ To ship              ││ Overdue              ││ Revenue (7 days)     ││ Needs reply          ││ KpiTile ×4, gap 16
│          │ │ 12                   ││ 1                    ││ ≈ ₺86.400            ││ 3                    ││ display 28/36
│          │ │ 4 due today          ││ [a] #114-…-0098      ││ ▲ 12,4% vs prev 7 d  ││ Trendyol 2 · Wix 1   ││ caption
│          │ │ Orders · 10:42       ││ Orders · 10:42       ││ Orders · FX (?) 10:42││ Messages · 10:40     ││ source · asOf
│          │ └──────────────────────┘└──────────────────────┘└──────────────────────┘└──────────────────────┘│
│          │                                                                                    32          │
│          │ Needs your attention  7                                                                        │ Section title-md + count
│          │ ┌──────────────────────────────────────────────────────────────────────────────────────────────┐│
│          │ │ ● Paused          Order syncs and labels are paused · trial ended              [See plans]   ││ 56px rows
│          │ │ ● Reconnect needed [e] eBay · authorization expired                            [Reconnect eBay]││ (leading pill col 140)
│          │ │ ● Label failed    [E] #3891 Baby Blanket · "FedEx: invalid postal code" +1 more [Review]      ││
│          │ │ ● Overdue         [a] #114-…-0098 Name Necklace · overdue 1 day · +0 more     [Create label] ││
│          │ │ ● Changed on Etsy [E] Wooden Keepsake Box · changed on Etsy since your draft  [Review]       ││
│          │ │ ● Send failed     [E] Name Necklace Gold · "Invalid taxonomy" · +2 more       [Open]         ││
│          │ │ ● Not sent yet    [E] 7 listings with changes not sent to Etsy                [Review & send]││
│          │ │                                                          Show 2 more ▾                        ││ ghost
│          │ └──────────────────────────────────────────────────────────────────────────────────────────────┘│
│          │                                                                                    32          │
│          │ ┌ Orders, last 14 days ─────────────────────────────┐┌ Best sellers (7 days) ─────────────────────┐│
│          │ │ 142 orders · ▲ 8% vs previous 14 days             ││ [img] Personalized Baby Blanket   18 units ││ DataTable compact
│          │ │ ▁▂▃▅▃▆▇▅▆▇█▆▇█   (bar, #2563EB, one y-axis)        ││ [img] Wooden Keepsake Box         11 units ││ thumb 32 · title · units
│          │ │ 2 Oct                                  15 Oct     ││ [img] Name Necklace Gold           9 units ││
│          │ │ Orders · by order date · Europe/Istanbul          ││ Orders · grouped by SKU · 10:42            ││ SourceNote-style caption
│          │ └───────────────────────────────────────────────────┘└────────────────────────────────────────────┘│
│          │                                                                                    32          │
│          │ Stores                                                                       Manage stores →   │
│          │ [E] BelleCoutureGifts ● Connected · 2 min ago   [e] eBay ● Reconnect needed   [T] Trendyol ●…  │ wraps; 32px chips
│          │ [W] Wix ● Couldn't check                        [S] Shopify ● Connected                         │
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
```

At 900–1199 (sidebar rail 64): KPI tiles stay 4 across down to 1100, then go 2×2. The chart and best-sellers grid stack at < 1100.

### 2.2 Desktop, setup incomplete (state A: new account)

```
│ Good morning, Tamer                                                            ⋯  [Connect a store] │
│ Thursday 15 Oct                                                                                    │
│ ┌ Get started · 1 of 3 done ─────────────────────────────────────────────────────────────── ✕ ┐    │ Section card; ✕ = IconButton "Hide setup"
│ │ ▰▰▰▱▱▱▱▱▱  (accent bar, not green)                                                          │    │
│ │ ✓ Connect a store         [E] BelleCoutureGifts connected                                   │    │ done row: neutral-500 text, success check
│ │ 2 Set your sender address  Printed as the return address on every label.   [Add address]    │    │ secondary sm
│ │ 3 Create your first label  Connect FedEx, UPS or DHL eCommerce first.      [Connect a carrier]│  │ CTA switches by carrier state
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘    │
│ Needs your attention                                                                                │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────┐    │
│ │ (EmptyState first-use) No orders yet                                                         │    │
│ │ Bring in your orders from your connected stores.        [Refresh orders] Uses 1 of 50 syncs  │    │
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘    │
│ Stores  …                                                                                          │
```
- While setup is incomplete, the **KPI row, the chart and best sellers are not rendered** (they would be zeros). The queue still renders, because reconnect and paused rows matter on day 1.
- Once step 1 is done but there are no orders, the queue shows the `first-use` EmptyState "No orders yet" + **[Refresh orders]** (a secondary; glossary §3.19: pulling is "Refresh", never "Sync", never automatic) with the quota note when a limit exists.
- Dismissing (✕) hides the card permanently for this user (`kx.overview.setupDismissed:<uid>`, try/catch). State B then renders even if steps remain.

### 2.3 Mobile 390

```
┌──────────────────────────────────┐
│ Overview       ⌕   + New    ⋯   │ TopBar 48: title, ⌕, "+ New" (only if Etsy/eBay connected), ⋯ = header overflow; bell moves to More (shell-nav §4.1 slot rule, CRITIQUE C2)
├──────────────────────────────────┤
│ Good morning, Tamer              │ title-md (greeting moves into content; TopBar owns "Overview")
│ Thu 15 Oct · Refreshed 8 min ⟳   │ caption + SyncMeta (44px tap target on ⟳)
│ ┌───────────────┐┌─────────────┐ │
│ │ To ship       ││ Overdue     │ │ KpiTile 2×2, gap 8, 12 padding
│ │ 12            ││ 1           │ │
│ │ 4 due today   ││ #114-…-0098 │ │
│ └───────────────┘└─────────────┘ │
│ ┌───────────────┐┌─────────────┐ │
│ │ Revenue 7 d   ││ Needs reply │ │ compact only ≥ 100,000 (DS §3.12)
│ │ ≈ ₺86.400     ││ 3           │ │
│ │ ▲ 12,4%       ││ Trendyol 2… │ │
│ └───────────────┘└─────────────┘ │
│ Needs your attention  7          │
│ ┌──────────────────────────────┐ │
│ │ ● Paused                    ›│ │ 56px rows; whole row is the link
│ │   Syncs and labels paused    │ │ detail: 1 line, ellipsis
│ ├──────────────────────────────┤ │
│ │ ● Reconnect needed [e] eBay ›│ │
│ ├──────────────────────────────┤ │
│ │ ● Overdue  #114 Name Neckl… ›│ │
│ └──────────────────────────────┘ │
│ [ Show 4 more ]                  │ ghost, 44px
│ Orders, last 14 days             │
│ ▁▂▃▅▃▆▇▅▆▇█▆▇█  (height 120)     │
│ Best sellers (7 days)            │
│ [img] Baby Blanket      18 units │ card list (DataTable mobile roles)
│ Stores                           │
│ [E] Belle ● Connected          › │ one row per account, 48px
│ [e] eBay  ● Reconnect needed   › │
│                                  │ bottom padding = StickyActionBar + --kx-bottom-nav
├──────────────────────────────────┤
│ [        Go to orders  (12)    ] │ StickyActionBar 48, only when toShip.count > 0
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```
- The queue row's CTA is **not** shown on mobile. The row navigates to the same href as the desktop CTA (one tap, 44+ target). This follows the DS §6.5 mobile wireframe ("›").
- Header secondaries and overflow collapse into the TopBar `⋯` (DS §3.2 mobile).
- No horizontal scroll. KPI values use `compact` only at ≥ 100,000 (DS §3.12).

---

## 3. Elements, data sources and states

Two data sources. Everything not listed as a shared client cache comes from **one new call**, `GET /api/overview/summary` (§4).

| Element | Source | Field(s) | Extra request? |
|---|---|---|---|
| Greeting name | `useAuth().user` | `user_metadata.full_name` first word → email local part → none (then `overview.greeting.*NoName`) | No |
| Greeting word | client clock in `tz` | `<12` morning, `<18` afternoon, else evening (`overview.greeting.*`, replacing `dashboard.greeting.*`) | No |
| Subtitle date | `DateText` | today, weekday long + day + month short | No |
| SyncMeta | summary | `ordersLastSyncedAt` (`User.lastSyncedAt`, written by `lib/orderSync.ts:1653` and `integrations/etsy/orders.ts:265`) | — |
| SyncMeta pull | `useSyncOrders()` (new, extracted from `CommandPalette.tsx:183-211`) | POST `/api/orders/sync` (`withUsageLimiter('orderSync')`, costs 1) | on click only |
| "Updated" | summary | `generatedAt` | — |
| KPI To ship | summary | `toShip.count`, `toShip.dueToday`, `toShip.withoutShipBy` | — |
| KPI Overdue | summary | `toShip.overdue`, `toShip.firstOverdue` | — |
| KPI Revenue (7 d) | summary | `kpis.revenue7d` | — |
| KPI Needs reply | `useMessageCountStore` | `counts.{trendyol,wix,total}`, **new** `fetchedAt`, `failed` | No (AppLayout polls every 180 s, only if Wix or Trendyol is connected: `AppLayout.js:296-304`) |
| KPI 4th fallback "Orders (7 days)" | summary | `kpis.orders7d` | — (shown when neither Wix nor Trendyol is connected) |
| Queue: reconnect | `useConnections()` | `needsReauth[]`, `connections[p].reason`, `connections[p].accounts[].name` | No (shared `/api/integrations/status` key) |
| Queue: order sync failing | `useNotifications()` | unresolved `items` where `type==='orderSyncFailed'` (`link` already sanitised) | No (bell's key) |
| Queue: all other rows | summary | `usage`, `labels`, `toShip`, `drafts`, `tracking`, `listingHealth` | — |
| Queue: unread messages | — | **not a queue row**: it is KPI 4 and the sidebar counter (no duplicate) | — |
| Chart | summary | `series.days[]` | — |
| Best sellers | summary | `topSellers.items[]` | — |
| Stores | `useConnections()` | `connections[p].connected/needsReauth/reason/accounts[].{name,lastSyncAt}`; `error` → `check_failed` | No |
| Setup step 1 | `useConnections()` | `anyMarketplace`, first connected account name | No |
| Setup step 2 | summary | `setup.senderComplete` (`ShipperProfile.shipperStreet1 && shipperCity`) | — (drops the page's own `/api/user/settings` fetch) |
| Setup step 3 | summary + connections | `setup.hasLabel`; `has('fedex')||has('ups')||has('mng')` picks the CTA | — |
| Usage quota note | summary | `usage.orderSync.{used,limit}` | — |

### 3.1 KPI row (`KpiTile` ×4)

| Tile | `value` | caption under the value | `delta` | `source` · `asOf` | `href` |
|---|---|---|---|---|---|
| To ship | `Num toShip.count` | "4 due today", or "All have a ship-by date" omitted; when `withoutShipBy>0`: "3 without a ship-by date" | none | "Orders" · `generatedAt` | `ordersHref('to_ship')` |
| Overdue | `Num toShip.overdue` | `LogoTile 16` + mono order number of `firstOverdue`; "None" when 0 | none (`overdue>0` colours the value `danger-fg`; the only tone on the row besides deltas) | "Orders" · `generatedAt` | `ordersHref('overdue')` |
| Revenue (7 days) | `Money approx` (`≈` when any non-base currency was converted) | — | `{ value: (v-prev)/prev, period: t('overview.kpi.vsPrev7'), goodWhen: 'up' }`; when `previous===0` no delta and the caption reads "New" | "Orders · FX" (`TermHint`-style `(?)` tooltip: "Converted at exchangerate-api.com rates, 15 Oct 10:00. Not included: AUD (2 orders)") · `generatedAt` | `reportsHref()` (`lib/nav/links.ts`: `/app/analytics` until the `reports` flag, then `/app/reports`; CRITIQUE C3) |
| Needs reply | `Num counts.total` (`50+` if `wix>=50`) | "Trendyol 2 · Wix 1" (only connected channels) | none | "Messages" · `fetchedAt` | `/app/mesajlar` |

States:
- **Loading:** `KpiSkeleton count=4` (200 ms delay). Needs reply renders as soon as the store has `fetchedAt`.
- **Section error** (`errors` includes `toShip` or `kpis`): that tile's value is `—` with a `Tooltip` "Couldn't load · Retry" (an `IconButton` RefreshCw in the tile corner calls `mutate`). The other tiles render.
- **Messages failed** (`failed===true`, new store field): the value is `—`, the caption "Couldn't check messages". Never `0`.
- **Stale FX** (`ratesStale`): the caption gets "Rates may be out of date"; the value keeps `≈`.
- **No conversion possible** (`rates` empty): revenue renders per currency, 2 currencies max ("$4.210 · ₺86.400"), with "+1 more" in the tooltip (DS §3.12 "never summed").

### 3.2 Needs your attention (`AttentionQueue`)

One `Section variant="card"`. One row per **kind** (grouped), sorted by the order below. A kind with 0 items is not rendered. At most 7 rows are visible; the rest go behind "Show N more" (ghost, expands in place, state not persisted).

Row anatomy (desktop, 56px): `[StatusPill] [LogoTile 20 | Thumb 32] title · detail (dense, 1 line, ellipsis) … [Button secondary sm]`. The first affected item is named inline and the rest are "+N more". Row CTAs are **secondary**: the page primary stays the only primary (P1).

| # | Kind | Shown when | Pill (`domain.status`) | Title / detail | CTA → href |
|---|---|---|---|---|---|
| 1 | Account paused | `usage.blocked != null` | `subscription.expired` ("Paused", settings-billing-pricing §14; CRITIQUE C7) | "Order syncs and labels are paused" · reason (trial ended / plan limit reached / no active plan / plan needs attention) | `hideBilling` ? "Contact support" → `/support` : "See plans" → `/ayarlar?tab=billing` |
| 2 | Reconnect (1 row per provider) | `needsReauth` | `connection.needs_reconnect` | `LogoTile` + provider name · `overview.reason.<reason>` | "Reconnect {provider}" → `/ayarlar?tab=connections&provider=<p>` (settings_spec §2 drawer deep link) |
| 3 | Order sync failing | unresolved `orderSyncFailed` notification | `sync.refresh_failed` **(new, §6)** | `notifications.types.orderSyncFailed` (existing key, params from the notification) · "Etsy and eBay are not covered" is **not** shown (internal limit, see §4.3) | "View" → `n.link` |
| 4 | Labels failed | `labels.failed > 0` | `label.label_failed` | `LogoTile` + `#orderNumber` + first item name · `"<lastError ≤ 80 chars>"` · +N more | "Review" → `ordersHref('problems')` |
| 5 | Overdue | `toShip.overdue > 0` | `order.overdue` | `LogoTile` + `#orderNumber` + item · `ShipBy` phrase ("Overdue 1 day") · +N more | "Create label" → `ordersHref('order', firstOverdue.id)` with `&label=1` (v2 opens CreateLabelPanel; legacy opens the order search) |
| 6 | Changed on Etsy / eBay (1 row per marketplace) | `drafts.<mp>.conflict > 0` | `sync.conflict` | `Thumb 32` + listing title · "Changed on Etsy since your draft" · +N more | "Review" → `listingHref(mp, first.listingId)` |
| 7 | Send failed (per marketplace) | `drafts.<mp>.failed > 0` (eBay `syncing` > 10 min counts here) | `sync.sync_failed` | `Thumb` + title · `"<lastSyncError ≤ 80>"` · +N more | "Open" → `listingHref(mp, first.listingId)` |
| 8 | Tracking not sent (Etsy) | `tracking.notSent + tracking.failed > 0` | `tracking.not_sent` or `tracking.send_failed` when `failed>0` **(new, §6)** | `LogoTile etsy` + `#orderNumber` · "Labels created, tracking not sent to Etsy" · +N more | `extension.detected` ? "Review" → `ordersHref('label_created', null, 'etsy')` : "Set up extension" → `/app/entegrasyonlar-ve-rehberler` |
| 9 | Not sent yet (per marketplace) | `drafts.<mp>.draft > 0` | `sync.pending` (attention tone, its only use here) | "7 listings with changes not sent to Etsy" | "Review & send" → `listingsHref(mp, 'changes_not_sent')` |
| 10 | Listing health (Etsy) | `listingHealth.etsy.needsWork > 0` (gated, §4.2) | ScoreMeter band label "Needs work" as `StatusPill`-shaped text: **use `ScoreMeter variant="cell"` of the worst listing** in the leading column | "18 listings under 50" · worst title and score | "Open Listing doctor" → `/app/research/listings` (R1); before R1: `listingsHref('etsy','needs_work')` (M5); before M5: row hidden |
| 11 | Plan near limit / trial ending | (`usage.nearLimit` or trial ends ≤ 5 days) and not `blocked` and not `hideBilling` | `subscription.near_limit` / `subscription.trial_ending` (added to the settings `subscription` domain; CRITIQUE C7) | "Labels: 9 of 10 used" or "Trial ends in 3 days" | "See plans" → `/ayarlar?tab=billing` |

Unread messages are **not** a queue row (they are KPI 4, and the sidebar shows the counter). This avoids a second representation of the same number.

Row states:
- **Loading:** rows 2 and 3 render at once from client caches. Below them, 3 skeleton rows (56px, the pill block + 2 text bars). `useAsyncState`: at 15 s "Still loading… [Retry]", at 30 s `ErrorState inline`.
- **Done (empty):** `EmptyState kind="done"`, icon `CheckCircle2` (quiet), "All caught up", body "Nothing needs your attention right now." No action.
- **Partial:** every name in `summary.errors` that feeds the queue (`usage`, `labels`, `toShip`, `drafts`, `tracking`, `listingHealth`) adds **one** row at the bottom: `ErrorState inline` "Couldn't check {sections}" + [Try again] + Copy error ID (`summary.requestId`). The queue is never "All caught up" while a section errored; it shows "Nothing else needs attention · 1 check failed" instead.
- **Whole request failed:** client-cache rows (2, 3) stay. In place of the rest, `ErrorState inline` "Couldn't load your overview" [Try again]. If an older summary exists (SWR `keepPreviousData`), `ErrorState variant="stale"` "Showing data from 10:42 · Retry" sits above the old rows.
- **Not connected** (`anyMarketplace === false`): the queue shows only rows 1–3 and an `EmptyState kind="first-use"` "Connect a store to see what needs your attention" [Connect a store] (when the setup card is dismissed; otherwise the setup card already says this, and the queue shows "done").

### 3.3 Orders, last 14 days (`Chart type="bar"`)

- 14 bars, one per local day in `tz`, oldest left. Single series `#2563EB`, single y-axis, `format: 'number'`.
- Header line: `Num` total + delta against the previous 14 days (`series.previousTotal`), with the same delta rule as KpiTile (no delta when previous is 0).
- Caption (SourceNote-style, plain text, not a research `SourceNote`): "Orders · by order date · {tz}". Cancelled, refunded and unpaid orders are excluded (same set as the KPIs).
- Tooltip per bar: `DateText` + "12 orders".
- **Loading:** a 160px skeleton block. **Error:** `ErrorState inline`. **Empty** (all zeros): the axis is drawn plus "No orders in the last 14 days" centered; no fake bars.

### 3.4 Best sellers (7 days) (`DataTable` compact)

- Columns: `thumb` (Thumb 32, `mobile:'media'`), `name` (2 lines max, `mobile:'title'`), `units` (right, tabular, "18 units", `mobile:'trailing'`), `channel` (`LogoTile 16`, `mobile:'subtitle'`). No checkbox, no row actions, no pagination (needs the DS change in §6).
- Row click → `ordersHref('search', null, null, sku || name)`. That opens orders filtered to that product, which is the only honest target: there is no listing link.
- Caption: "Orders · grouped by SKU · units in orders, not listing sales".
- **Empty:** `EmptyState kind="no-results"` compact: "No sales in the last 7 days". **Error:** `ErrorState inline`. **Loading:** `TableSkeleton rows=5 thumb`.
- An item whose name is entity-encoded is decoded at read time with `decodeEntities` (stored data predates the ingest fix).

### 3.5 Stores (`StoresStrip`)

- One chip per connected **account** (Etsy shops are separate accounts): `LogoTile 20` + account name (or the provider name) + `StatusPill domain="connection"` + `DateText relative` of `lastSyncAt` when not null. Order: needs_reconnect first, then connected, alphabetical.
- Mapping (pure, `lib/ds/status/connections.ts`): `connected && !needsReauth` → `connected`; `needsReauth` → `needs_reconnect`; `reason==='incomplete_credentials' && !connected` → `incomplete`; `useConnections().error` with no data → `check_failed` for all ("Couldn't check", never "Not connected").
- Not-connected providers are not listed. The trailing link reads "Manage stores →" (`/ayarlar?tab=connections`), plus "+ Connect a store" when fewer than 2 are connected.
- Chip click → `/ayarlar?tab=connections&provider=<p>`.
- **Loading:** 3 chip skeletons. Carriers (FedEx, UPS, DHL eCommerce) are not shown here; the setup checklist and Settings own them.
- The Etsy trademark notice (launch §C) is an AppShell footer concern, not this page; this surface relies on it.

### 3.6 Setup checklist (`SetupChecklist`, state A)

| Step | Done when | Not-done CTA (secondary sm) |
|---|---|---|
| 1 Connect a store | `anyMarketplace === true` | "Connect a store" → `/ayarlar?tab=connections` (this is also the page primary while 0 stores) |
| 2 Set your sender address | `setup.senderComplete` | "Add address" → `/ayarlar?tab=senderProfile` |
| 3 Create your first label | `setup.hasLabel` | no carrier → "Connect a carrier" → `/ayarlar?tab=apiKeys`; carrier but no orders → "Refresh orders" (`useSyncOrders`, never automatic, note "Uses 1 of your {limit} order syncs" when `limit != null`); orders → "Create label" → `ordersHref('to_ship')` |

- Rendered only when connections **and** `summary.setup` have loaded and at least one step is open and the card is not dismissed. It never flashes in and out. `setup === null` (section error) → not rendered.
- The progress bar is an `accent-600` bar on `neutral-100` (4px). There is no green progress bar (P2).
- A done step shows a 16px `success-solid` check, neutral-500 text and **no** strike-through.

### 3.7 Interactions and keyboard

- All PageHeader actions register in ⌘K through `usePageActions` (Go to orders, New listing, Add manual order, Research, Reports, plus **Refresh orders** from SyncMeta). "Print picklist" is not offered here: `/app/print/pick-list` needs explicit `?ids=`, and printing belongs to the Orders bulk bar.
- `g o` (palette) goes to Orders. `j`/`k` move focus through queue rows, `Enter` follows the row href, `/` opens ⌘K (no list search on this page).
- Refresh orders: `loading` → SyncMeta shows "Refreshing orders…" (no toast while running). Success → toast "Orders refreshed" (4 s), then `mutate` the summary and every `/api/orders*` key. Failure → persistent error toast with "Retry". When `usage.blocked`, ⟳ is disabled with `disabledReason` "Order syncs are paused: see plans". When a limit exists, the ⟳ tooltip reads "Uses 1 of your 50 order syncs (12 used)".
- Revalidation: SWR `refreshInterval 60_000`, `revalidateOnFocus true`, `keepPreviousData true`, `errorRetryCount 2`. The poll stops while the tab is hidden (SWR default `refreshWhenHidden false`).
- Stripe return: the `session_id` toast (`index.js:330-336`) is kept, through `useToast().success`.
- Auth loading: no full-page spinner. `<Page>` renders the header skeleton and `KpiSkeleton`. Unauthenticated → `router.replace('/login')` with the same skeleton.

---

## 4. API: `GET /api/overview/summary` (the one new call)

Files: `pages/api/overview/summary.ts` (route), `lib/overview/summary.ts` (server-only, one exported function per section, unit-tested with mocked Prisma).

- Auth: `getAuthUser`. 401 without a user. `Cache-Control: private, no-store`. GET only (405 otherwise).
- Query: `tz` (accepted if in `Intl.supportedValuesOf('timeZone')` or `'UTC'`, else `Europe/Istanbul`), `currency` (`TRY`|`USD`, default `localeConfig.defaultCurrency`). The client passes the seller timezone from `useFormatters()` (DS §3.12), falling back to the browser zone.
- Every section runs inside one `Promise.all`, each with its own try/catch. A failed section returns `null` and its key goes into `errors[]`. The route never returns 500 because one section failed. `requestId` (cuid) is logged with each section error through `logger.error`, so "Copy error ID" can be traced in `SyncLog`.
- Day boundaries are computed in JS for `tz` and passed as UTC `Date` parameters. Day grouping in SQL uses `(ts AT TIME ZONE 'UTC') AT TIME ZONE $tz` (the double conversion is correct for UTC-stored `timestamp` columns; a single `AT TIME ZONE` is the launch-plan bug B.14).

```ts
type Channel = 'etsy'|'ebay'|'amazon'|'shopify'|'wix'|'trendyol'|'hepsiburada'|'other';
type SectionKey = 'toShip'|'labels'|'tracking'|'drafts'|'listingHealth'|'usage'|'kpis'|'series'|'topSellers'|'setup'|'meta';

interface OrderRef {
  id: string; orderNumber: string; channel: Channel;   // NOT "marketplaceKey" (clashes with Order.marketplaceKey)
  itemName: string | null; image: string | null;      // first OrderItem (decoded)
  shipBy: string | null;                              // MIN(OrderItem.shipBy)
}
interface DraftRef {
  draftId: string; listingId: string;                 // Etsy BigInt as string; eBay listingId ?? sku
  title: string | null; thumb: string | null; error: string | null;
}
interface DraftBucket { draft: number; failed: number; conflict: number; syncing: number;
  firstConflict: DraftRef | null; firstFailed: DraftRef | null; }

interface OverviewSummary {
  generatedAt: string; requestId: string; tz: string; currency: 'TRY'|'USD';
  errors: SectionKey[];
  ordersLastSyncedAt: string | null;                  // User.lastSyncedAt   (section 'meta')
  toShip: null | { count: number; overdue: number; dueToday: number; withoutShipBy: number;
                   oldestOrderedAt: string | null; firstOverdue: OrderRef | null };
  labels: null | { failed: number; first: (OrderRef & { error: string | null }) | null };
  tracking: null | { notSent: number; failed: number; first: OrderRef | null };      // Etsy only
  drafts: null | { etsy: DraftBucket; ebay: DraftBucket };
  listingHealth: null | { etsy: { needsWork: number; scored: number;
                   worst: { listingId: string; title: string; thumb: string | null; score: number } | null } };
  usage: null | { plan: string | null; status: string | null; hideBilling: boolean;
                  trialEndsAt: string | null; resetsAt: string | null;
                  orderSync: { used: number; limit: number | null }; label: { used: number; limit: number | null };
                  nearLimit: boolean; blocked: null | 'trial'|'noSubscription'|'planLimit'|'invalidPlan' };
  kpis: null | {
    revenue7d: { value: number | null; previous: number | null; currency: 'TRY'|'USD';
                 approx: boolean; ratesAsOf: string | null; ratesStale: boolean;
                 unconverted: { currency: string; orders: number }[];
                 perCurrency: { currency: string; value: number }[] };   // used when value is null (no rates)
    orders7d: { value: number; previous: number };
  };
  series: null | { days: { date: string /* YYYY-MM-DD in tz */; orders: number }[]; previousTotal: number };
  topSellers: null | { items: { key: string; name: string; image: string | null; units: number;
                                orders: number; channel: Channel }[] };
  setup: null | { hasOrders: boolean; senderComplete: boolean; hasLabel: boolean };
}
```

### 4.1 Section definitions (all scoped to `userId`)

- **Live order** = `LOWER(status) = ANY(STATUS_FILTER_GROUPS.onaylandi)`. Unpaid (`awaiting_payment`, `pending_payment`) is excluded by construction (`orders/index.ts:24-30`, `:160`). **Counted order** (KPIs, series, best sellers) = not in `iptal`, not unpaid, with `status IS NULL` counted (manual orders).
- **Unlabeled / labeled** = the exact clause from `orders/index.ts:321-333` (`labelStatus=not_created`) moved into `UNLABELED_SQL` in `lib/orders/views.ts` (the one shared module, created in M2 by shell-nav group B and extended by Orders G1; CRITIQUE C4); `LABELED_SQL` = its `:308-320` twin.
- **toShip** = live AND unlabeled, no date window. `shipBy` = `MIN(OrderItem.shipBy)`. `overdue` = shipBy < now; `dueToday` = shipBy in today's tz window; `withoutShipBy` = shipBy null. `shipBy` here is the **effective ship-by** (`EFFECTIVE_SHIP_BY_SQL` from `lib/orders/views.ts`: `MIN(OrderItem.shipBy)`, then the `rawData` fallbacks of `index.ts:789-816`), and `toShip` is `TO_SHIP_SQL` (it excludes FBA/MCF), so this KPI, the sidebar counter and the Orders "To ship"/"Overdue" views always match (CRITIQUE C4). `withoutShipBy` counts only orders with no date from any source. Follow-up (not blocking): backfill `OrderItem.shipBy` in the mappers.
- **labels.failed** = distinct orders with a `LabelJob.status='failed'` updated in the last 14 days AND still unlabeled. `first.error` = latest `errorMessage`, cut to 140 chars, never raw JSON (strip anything starting `{`).
- **tracking** (Etsy orders only: `marketplace ILIKE '%etsy%'` OR `marketplace` = an active `EtsyShop.shopName`, as in `integrations/etsy/tracking-pending.ts`):
  - `failed` = `TrackingSubmission` (`submittedBy=userId`) with `etsySubmitStatus='failed'` OR `status='failed'`.
  - `notSent` = (submissions with `etsySubmitStatus IN ('pending','needs_manual')` and `submittedAt < now-30 min`) + (live-or-shipped Etsy orders matching `LABELED_SQL` with **no** `TrackingSubmission`, whose newest `Shipment.createdAt`/`LabelJob.createdAt` is > 2 h ago and within 14 days).
- **drafts.etsy** = `recoverStaleSyncingDrafts(userId)` (`lib/etsy/draftService.ts:1336`, shopId optional, so all shops), then `etsyListingDraft.groupBy({ by:['status'], where:{ userId, status:{ in:['draft','failed','conflict','syncing'] } } })`. `firstConflict` and `firstFailed` = newest by `updatedAt`, joined to `EtsyListing` on `(etsyShopId, etsyListingId)` for `title` and `thumbnailUrl75x75`; `fieldPatch.title` wins over the cached title when present.
- **drafts.ebay** = the same `groupBy` on `ebayListingDraft`. `syncing` rows with `updatedAt < now-10 min` move to `failed`, read-only (eBay has no list-level recovery; `lib/ebay/draftService.ts:304`). Title from `inventoryPatch.product.title ?? baseSnapshotInventory.product.title`; thumb from `…product.imageUrls[0]`.
- **listingHealth** (gated): runs only when `lib/listingScore/etsy.ts` exists (M1). Selects active `EtsyListing` rows of the user's active shops (columns needed by the scorer only), scores each, and counts `score < 50`. It is capped at 5,000 rows; above that it returns `null` with `errors:['listingHealth']` instead of a partial count. Until M1 ships, the section is omitted from the response (not an error).
- **usage** = new pure `getUsageSnapshot(user, { activeShopifyShops })` exported from `lib/middleware/withUsageLimiter.ts`, mirroring `checkUsage`. It reads, never writes: an expired `usageResetAt` reports `used: 0`. `Infinity` → `null`. `blocked` = the `LimitReason` `checkUsage` would return for either limit type. `hideBilling` = `billingProvider==='shopify_free'` OR an active `ShopifyShop` (the `/api/user/settings` rule). `checkUsage` is refactored to call the same helper, so the two cannot drift. Note: the tier redesign (`design/launch/tiers.md`, D16) will change these rules; this section only reads them.
- **kpis.revenue7d** = per-currency `SUM(totalPrice)` of counted orders by `COALESCE(uiOrderDate, createdAt)` in [now-7 d, now) and [now-14 d, now-7 d). Converted in JS with `convertToBase(amount, currency, rates, base)` from the new `lib/fx.ts` (TRY-per-unit rates; USD = TRY / `rates.USD`). Currencies with no rate go to `unconverted` and are excluded from **both** periods. `approx` = any currency other than `base` was converted.
- **kpis.orders7d** = counts of counted orders over the same two windows.
- **series** = counted orders grouped by local day over the last 14 local days (zero-filled in JS), plus the count for the 14 days before that.
- **topSellers** = `OrderItem` joined to counted orders of the last 7 days, `GROUP BY COALESCE(NULLIF(sku,''), LOWER(productName))`, `SUM(quantity)` units, `COUNT(DISTINCT orderId)`, `MAX(NULLIF(image,''))`, the most frequent `marketplace` → channel. Top 5 by units. Items with neither SKU nor name are skipped.
- **channel** mapping: `canonicalStore()` from the shared `lib/marketplaces/canonical.ts` (created by Orders M3 G1, also used by Reports; it wraps `lib/utils/etsyDetection.ts` plus the user's `EtsyShop.shopName` list), else `other` (CRITIQUE C5).
- **setup** = `EXISTS Order`, `ShipperProfile` street1 + city, `EXISTS Shipment` OR `Order.labelStatus='created'`.

### 4.2 Performance

- Indexes used: `Order @@index([userId])`, `([userId, uiOrderDate])`, `([userId, createdAt])`, `([userId, labelStatus])`, `OrderItem([orderId])`, `LabelJob([status])`, `TrackingSubmission([submittedBy])`, `EtsyListingDraft([userId, etsyShopId])`, `EbayListingDraft([userId])`.
- The revenue, series and orders7d queries share one CTE of counted orders over 28 days.
- Budget: p95 < 400 ms for a 20k-order account. `EXPLAIN ANALYZE` the toShip and tracking queries against the production DB (read-only) before the flag goes on.
- Exchange rates: `getExchangeRates()` keeps its in-process cache (moved, not changed).

### 4.3 Server fixes this surface depends on (each its own small PR)

1. **Label failures are recorded** (blocks queue row 4): `pages/api/labels/ups.ts` writes `LabelJob{status:'failed', carrier:'UPS', errorMessage}` per OrderItem on the EDI step-1 failure and in the outer catch, and checks `result.success` before `prisma.shipment.create` in the non-EDI path (`:200-213`). `pages/api/labels/mng.ts` does the same in its catch (`carrier:'DHL eCommerce'` display, stored key `'MNG'`). This matches FedEx (`generate-label.ts:625-637`).
2. **The dead failed filter** (`orders/index.ts:334-335`): replace `labelStatus='failed'` with the `EXISTS LabelJob failed in 14 days AND <UNLABELED_SQL>` clause, shared from `lib/orders/views.ts`, so `/app/labels?label=failed&from=all` lists exactly what the queue counts. A parity test covers both.
3. **Not blocking:** the `orderSyncFailed` notification does not fire for Etsy or eBay, because those fetchers are deliberately not wrapped (`lib/orderSync.ts:39-46`, `:1266-1270`). Row 3 covers the other channels only. Track it separately.
4. **Not blocking:** an Orders filter for "tracking not sent" (v2 saved view or legacy `tracking=pending`). Until then row 8 links to the label-created view filtered to Etsy.

### 4.4 Minimal additions outside the new route

| Addition | File | Why |
|---|---|---|
| `fetchedAt: number | null`, `failed: boolean` in the store state | `lib/stores/useMessageCountStore.ts` | KPI needs `asOf`, and a failed fetch must not read as 0 (P6) |
| `useSyncOrders({ redirectTo?: string | null })` | `lib/hooks/useSyncOrders.ts` (new); `components/CommandPalette.tsx` uses it with `redirectTo: '/app/labels'` (behaviour unchanged) | One sync handler; the overview revalidates the summary instead of navigating |
| `ordersHref(view, orderId?, store?, q?)`, `listingsHref(mp, view)`, `listingHref(mp, listingId)`, `reportsHref()` | `lib/nav/links.ts` (new) | Deep links switch between the legacy query (`label=unlabeled&status=onaylandi&sort=shipBy&from=all`, `q=<n>&qt=order&label=all&from=all`, `label=failed&from=all`, `label=labeled&mp=etsy&from=all`) and the v2 `?view=` / `?open=` keys by the `orders` / `listings-*` flags in `lib/ds/uiFlags.ts`. One place to update when the flags flip |
| Legacy Etsy listings accept `?open=<etsyListingId>` to open the editor drawer | `pages/app/etsy-listings.tsx` (≈10 lines, optional) | Without it, conflict and failed rows land on the list, not the listing, until M5/M6 |
| `STATUS_FILTER_GROUPS`, `expandStatusFilter`, `LABELED_SQL`, `FAILED_LABEL_SQL` (added next to the M2/M3 `TO_SHIP_SQL`, `UNLABELED_SQL`, `OVERDUE_SQL`) | `lib/orders/views.ts` (exists from M2; **no** `statusGroups.ts`, CRITIQUE C4); re-exported from `pages/api/orders/index.ts` | Home and Orders must count the same thing |
| `getExchangeRates`, `fetchLiveRates`, `convertToBase` | `lib/fx.ts` (new); `pages/api/analytics/index.ts` imports them (its closure `tryConvertToTRY` at `:192-206` is replaced) | Shared FX with one cache |
| `getUsageSnapshot` | `lib/middleware/withUsageLimiter.ts` | See §4.1 |

`/api/stats` (`pages/api/stats.ts`): considered and rejected. It is unused (no caller in `pages`, `components` or `lib`), filters on `createdAt` (sync time) and sums mixed currencies. Delete it in this milestone.

---

## 5. i18n

New namespace `overview` (en + tr). `react/jsx-no-literals` applies. Plurals use ICU. Relative times, dates and money come from `lib/format.ts` and need no keys. Status pill labels come from `status.*` (DS §3.9) plus the additions in §6.

| key | en | tr |
|---|---|---|
| overview.pageTitle | Overview | Genel bakış |
| overview.greeting.morning | Good morning, {name} | Günaydın, {name} |
| overview.greeting.afternoon | Good afternoon, {name} | İyi günler, {name} |
| overview.greeting.evening | Good evening, {name} | İyi akşamlar, {name} |
| overview.greeting.morningNoName | Good morning | Günaydın |
| overview.greeting.afternoonNoName | Good afternoon | İyi günler |
| overview.greeting.eveningNoName | Good evening | İyi akşamlar |
| overview.subtitle.allStores | All stores | Tüm mağazalar |
| overview.meta.updated | Updated {time} | {time} güncellendi |
| overview.meta.ordersRefreshed | Orders refreshed {time} | Siparişler {time} yenilendi |
| overview.meta.ordersNeverRefreshed | Orders not refreshed yet | Siparişler henüz yenilenmedi |
| overview.meta.refreshing | Refreshing orders… | Siparişler yenileniyor… |
| overview.meta.refreshQuota | Uses 1 of your {limit} order syncs ({used} used) | {limit} sipariş senkronu hakkınızdan 1 tanesini kullanır ({used} kullanıldı) |
| overview.meta.refreshPaused | Order syncs are paused: see plans | Sipariş senkronu durduruldu: planlara göz atın |
| overview.toast.refreshed | Orders refreshed | Siparişler yenilendi |
| overview.toast.refreshFailed | Couldn't refresh orders | Siparişler yenilenemedi |
| overview.actions.goToOrders | Go to orders | Siparişlere git |
| overview.actions.newListing | New listing | Yeni ilan |
| overview.actions.connectStore | Connect a store | Mağaza bağla |
| overview.actions.addManualOrder | Add manual order | Manuel sipariş ekle |
| overview.actions.research | Research | Pazar araştırması |
| overview.actions.reports | Reports | Raporlar |
| overview.actions.refreshOrders | Refresh orders | Siparişleri yenile |
| overview.kpi.toShip | To ship | Gönderilecek |
| overview.kpi.dueToday | {count} due today | {count} tanesi bugün gönderilmeli |
| overview.kpi.withoutShipBy | {count} without a ship-by date | {count} tanesinin son gönderim tarihi yok |
| overview.kpi.overdue | Overdue | Geciken |
| overview.kpi.noneOverdue | None | Yok |
| overview.kpi.revenue7d | Revenue (7 days) | Ciro (7 gün) |
| overview.kpi.vsPrev7 | vs previous 7 days | önceki 7 güne göre |
| overview.kpi.new | New | Yeni |
| overview.kpi.fxNote | Converted at exchangerate-api.com rates, {date} | exchangerate-api.com kurlarıyla çevrildi, {date} |
| overview.kpi.fxStale | Rates may be out of date | Kurlar güncel olmayabilir |
| overview.kpi.fxExcluded | Not included: {list} | Dahil edilmedi: {list} |
| overview.kpi.fxExcludedItem | {currency} ({count, plural, one {# order} other {# orders}}) | {currency} ({count} sipariş) |
| overview.kpi.needsReply | Needs reply | Yanıt bekleyen |
| overview.kpi.messagesFailed | Couldn't check messages | Mesajlar kontrol edilemedi |
| overview.kpi.orders7d | Orders (7 days) | Siparişler (7 gün) |
| overview.kpi.sourceOrders | Orders | Siparişler |
| overview.kpi.sourceOrdersFx | Orders · FX | Siparişler · Kur |
| overview.kpi.sourceMessages | Messages | Mesajlar |
| overview.kpi.loadFailed | Couldn't load · Retry | Yüklenemedi · Tekrar dene |
| overview.attention.title | Needs your attention | İlgilenmeniz gerekenler |
| overview.attention.showMore | Show {count} more | {count} tane daha göster |
| overview.attention.showLess | Show less | Daha az göster |
| overview.attention.more | +{count} more | +{count} tane daha |
| overview.attention.doneTitle | All caught up | Her şey yolunda |
| overview.attention.doneBody | Nothing needs your attention right now. | Şu anda ilgilenmeniz gereken bir şey yok. |
| overview.attention.doneWithErrors | Nothing else needs attention · {count, plural, one {# check} other {# checks}} failed | Başka bir şey yok · {count} kontrol başarısız oldu |
| overview.attention.checkFailed | Couldn't check {sections} | {sections} kontrol edilemedi |
| overview.attention.loadFailed | Couldn't load your overview | Genel bakış yüklenemedi |
| overview.attention.notConnectedTitle | Connect a store to see what needs your attention | Neyle ilgilenmeniz gerektiğini görmek için bir mağaza bağlayın |
| overview.attention.noOrdersTitle | No orders yet | Henüz sipariş yok |
| overview.attention.noOrdersBody | Bring in your orders from your connected stores. | Bağlı mağazalarınızdaki siparişleri getirin. |
| overview.attention.refreshOrders | Refresh orders | Siparişleri yenile |
| overview.attention.paused.title | Order syncs and labels are paused | Sipariş senkronu ve etiketler durduruldu |
| overview.attention.paused.reason | {reason, select, trial {Your trial has ended} noSubscription {No active plan} planLimit {Plan limit reached} invalidPlan {Your plan needs attention} other {Plan issue}} | {reason, select, trial {Deneme süreniz bitti} noSubscription {Aktif plan yok} planLimit {Plan limitine ulaşıldı} invalidPlan {Planınızla ilgili bir sorun var} other {Plan sorunu}} |
| overview.attention.paused.cta | See plans | Planları gör |
| overview.attention.paused.supportCta | Contact support | Destekle iletişime geç |
| overview.attention.reconnect.cta | Reconnect {provider} | {provider} bağlantısını yenile |
| overview.reason.token_expired_no_refresh | Access expired | Erişim süresi doldu |
| overview.reason.refresh_token_expired | Authorization expired | Yetki süresi doldu |
| overview.reason.missing_refresh_token | Authorization incomplete | Yetkilendirme eksik |
| overview.reason.incomplete_credentials | Credentials incomplete | Bilgiler eksik |
| overview.reason.reauth_required | Access was revoked | Erişim iptal edildi |
| overview.attention.syncFailing.cta | View | Görüntüle |
| overview.attention.labelsFailed.title | {count, plural, one {# label failed} other {# labels failed}} | {count} etiket oluşturulamadı |
| overview.attention.labelsFailed.cta | Review | İncele |
| overview.attention.overdue.cta | Create label | Etiket oluştur |
| overview.attention.conflict.detail | Changed on {marketplace} since your draft | Taslağınızdan sonra {marketplace}'de değişti |
| overview.attention.conflict.cta | Review | İncele |
| overview.attention.sendFailed.cta | Open | Aç |
| overview.attention.tracking.detail | Labels created, tracking not sent to Etsy | Etiket oluşturuldu, takip numarası Etsy'ye gönderilmedi |
| overview.attention.tracking.cta | Review | İncele |
| overview.attention.tracking.setupCta | Set up extension | Eklentiyi kur |
| overview.attention.notSent.title | {count, plural, one {# listing with changes not sent to {marketplace}} other {# listings with changes not sent to {marketplace}}} | {count} ilanda {marketplace}'e gönderilmemiş değişiklik var |
| overview.attention.notSent.cta | Review & send | İncele ve gönder |
| overview.attention.health.title | {count, plural, one {# listing under 50} other {# listings under 50}} | 50'nin altında {count} ilan |
| overview.attention.health.cta | Open Listing doctor | İlan doktorunu aç |
| overview.attention.health.ctaLegacy | Show listings | İlanları göster |
| overview.attention.usage.detail | {kind, select, orderSync {Order syncs} other {Labels}}: {used} of {limit} used | {kind, select, orderSync {Sipariş senkronu} other {Etiket}}: {limit} hakkın {used} tanesi kullanıldı |
| overview.attention.trialEnds | Trial ends in {days, plural, one {# day} other {# days}} | Deneme süresi {days} gün içinde bitiyor |
| overview.attention.usage.cta | See plans | Planları gör |
| overview.chart.title | Orders, last 14 days | Siparişler, son 14 gün |
| overview.chart.total | {count, plural, one {# order} other {# orders}} | {count} sipariş |
| overview.chart.vsPrev14 | vs previous 14 days | önceki 14 güne göre |
| overview.chart.source | Orders · by order date · {tz} | Siparişler · sipariş tarihine göre · {tz} |
| overview.chart.empty | No orders in the last 14 days | Son 14 günde sipariş yok |
| overview.best.title | Best sellers (7 days) | En çok satanlar (7 gün) |
| overview.best.units | {count, plural, one {# unit} other {# units}} | {count} adet |
| overview.best.source | Orders · grouped by SKU · units in orders, not listing sales | Siparişler · SKU'ya göre · siparişteki adet, ilan satışı değil |
| overview.best.empty | No sales in the last 7 days | Son 7 günde satış yok |
| overview.best.colProduct | Product | Ürün |
| overview.best.colUnits | Units | Adet |
| overview.stores.title | Stores | Mağazalar |
| overview.stores.manage | Manage stores | Mağazaları yönet |
| overview.stores.connect | Connect a store | Mağaza bağla |
| overview.stores.refreshed | Refreshed {time} | {time} yenilendi |
| overview.setup.title | Get started | Başlayın |
| overview.setup.progress | {done} of {total} done | {total} adımdan {done} tamamlandı |
| overview.setup.hide | Hide setup | Kurulumu gizle |
| overview.setup.connect.title | Connect a store | Mağaza bağlayın |
| overview.setup.connect.desc | Link Etsy, eBay, Amazon, Shopify, Wix or Trendyol to bring in orders and listings. | Siparişleri ve ilanları getirmek için Etsy, eBay, Amazon, Shopify, Wix veya Trendyol bağlayın. |
| overview.setup.connect.doneDesc | {name} connected | {name} bağlandı |
| overview.setup.sender.title | Set your sender address | Gönderici adresinizi girin |
| overview.setup.sender.desc | Printed as the return address on every label. | Her etikette iade adresi olarak basılır. |
| overview.setup.sender.cta | Add address | Adres ekle |
| overview.setup.label.title | Create your first label | İlk etiketinizi oluşturun |
| overview.setup.label.descNoCarrier | Connect FedEx, UPS or DHL eCommerce first. | Önce FedEx, UPS veya DHL eCommerce bağlayın. |
| overview.setup.label.descNoOrders | Bring in your orders first. | Önce siparişlerinizi getirin. |
| overview.setup.label.descReady | Pick an order and create its label. | Bir sipariş seçin ve etiketini oluşturun. |
| overview.setup.label.ctaCarrier | Connect a carrier | Kargo firması bağla |
| overview.setup.label.ctaCreate | Create label | Etiket oluştur |
| overview.setup.quota | Uses 1 of your {limit} order syncs. | {limit} sipariş senkronu hakkınızdan 1 tanesini kullanır. |
| overview.subscriptionActivated | Your subscription is active | Aboneliğiniz aktif |
| overview.section.sources.toShip | orders to ship | gönderilecek siparişler |
| overview.section.sources.labels | label failures | etiket hataları |
| overview.section.sources.tracking | tracking | takip numaraları |
| overview.section.sources.drafts | listing drafts | ilan taslakları |
| overview.section.sources.listingHealth | listing health | ilan sağlığı |
| overview.section.sources.usage | plan usage | plan kullanımı |

Status vocabulary additions (`status.*`, DS §3.9 table, see §6):

| key | en | tr |
|---|---|---|
| status.tracking.not_sent | Tracking not sent | Takip gönderilmedi |
| status.tracking.send_failed | Tracking failed | Takip gönderilemedi |
| status.subscription.near_limit | Near limit | Limite yakın |
| status.subscription.trial_ending | Trial ending | Deneme bitiyor |

(`status.subscription.expired` "Paused / Durduruldu" comes from settings-billing-pricing §15.3. The `account` domain is dropped: CRITIQUE C7.)
| status.sync.refresh_failed | Refresh failed | Yenilenemedi |

Keys deleted (only `pages/app/index.js` reads the `dashboard` namespace; `grep -rn "'dashboard\.\|useTranslations('dashboard')" pages components lib` returns only that file): the whole top-level `dashboard` object in `messages/en.json` and `messages/tr.json`, which is `pageTitle, greeting, defaultUser, features, allFeaturesFree, allFeaturesFreeDesc, exploreFeatures, quickAccess, recentUpdates, updates, legacyTitle, settingsTab, integrationsTab, syncTab, subscriptionTab, scriptBackups, scriptBackupsDesc, syncScriptPlaceholder, labelScriptPlaceholder, saveLocalBackups, backupsSaved, activeMarketplaces, shippingIntegrations, scriptConnections, saveIntegrations, trialStarted, basicPlan, advancedPlan, proPlan, payWithIyzico, statusUnknown, setup, subscriptionActivated`. The kept strings move to `overview.*` above. The nested `…dashboard` object around `en.json:3200` belongs to research and is **not** touched. Delete only in the PR that flips the flag default-on plus one release (the legacy page still reads them while the flag is off).

---

## 6. Design-system additions (justified, minimal)

1. **StatusPill domain `tracking`, two keys in the settings `subscription` domain (`near_limit`, `trial_ending`; the separate `account` domain is dropped, CRITIQUE C7), and `sync.refresh_failed`.** The queue needs a fixed label for "tracking not sent", "account paused", "plan near limit / trial ending" and "order refresh failed". None exists in §3.9, and free-form pill labels are banned. Tones: `tracking.not_sent` warning, `tracking.send_failed` danger, `subscription.expired` danger (existing), `subscription.near_limit` warning, `subscription.trial_ending` warning, `sync.refresh_failed` danger. They follow the existing tone meanings. Attention (orange) stays reserved for unsent drafts. Files: `components/ds/data/StatusPill.tsx` (domain union), `lib/ds/status/tracking.ts` + the two keys in `lib/ds/status/billing.ts` (pure maps + tests), the `status.*` keys above. Orders (tracking column) and Settings (billing) will reuse them.
2. **`DataTable.pagination` becomes optional.** An embedded 5-row table (Best sellers; the Product finder top-listings card in §3.18 needs the same) has no pages. When omitted, no footer renders. One-line type change plus a render test.
3. No other new component. `AttentionQueue`, `KpiRow`, `StoresStrip` and `SetupChecklist` are **domain compositions** under `components/domain/overview/*` built only from `Section`, `StatusPill`, `LogoTile`, `Thumb`, `ScoreMeter`, `Button`, `IconButton`, `KpiTile`, `Chart`, `DataTable`, `EmptyState`, `ErrorState`, `Skeleton*`, `Tooltip`, `DateText`, `Money`, `Num`, `ShipBy`, `CopyText`, `StickyActionBar`, `Page`, `PageHeader`, `SyncMeta` (DS §4.7 rule).

---

## 7. Code to delete

| What | Where | When |
|---|---|---|
| `QuickActionCard`, `SetupStep`, `SetupChecklist`, the `allFeaturesFree` banner, the 6 gradient tiles, the `uppercase` "Quick access" heading | `pages/app/index.js` → moved verbatim to `components/legacy/LegacyOverview.js` behind the flag | Delete one release after `overview` is default-on |
| `SETTINGS_KEY` fetch and `ORDERS_PROBE_KEY` (`/api/orders?limit=1&page=1`) | same | same |
| Full-page `Loader2` auth spinners | same | same |
| `pages/api/stats.ts` | unused, wrong (createdAt, mixed currency sums) | this milestone |
| `tryConvertToTRY` closure | `pages/api/analytics/index.ts:192-206` | this milestone (replaced by `lib/fx.ts`) |
| Sync logic inside `CommandPalette.syncOrders` | `components/CommandPalette.tsx:183-211` | this milestone (calls `useSyncOrders`) |
| `dashboard.*` i18n (see §5) | `messages/{en,tr}.json` | with the legacy page |
| `labelStatus='failed'` SQL branch | `pages/api/orders/index.ts:334-335` | this milestone (fix §4.3.2) |

---

## 8. Implementation split (disjoint file groups, parallel agents)

Prerequisites: M1 primitives and M2 shell are merged (`components/ds/*`, `lib/format.ts`, `lib/ds/status/*`, `lib/ds/uiFlags.ts`, `useAsyncState`, `usePageActions`). Every group codes against the contracts in this file (the `OverviewSummary` type in §4, the key list in §5), so groups need not wait on each other. G3 owns the type file and the others import it.

| Group | Files (exclusive) | Work | Tests |
|---|---|---|---|
| **G1 Shared server helpers** | `lib/orders/views.ts` (extend; created in M2), `pages/api/orders/index.ts`, `lib/fx.ts` (new), `pages/api/analytics/index.ts`, `pages/api/stats.ts` (delete) | Move `STATUS_FILTER_GROUPS`/`expandStatusFilter`, add `UNLABELED_SQL`/`LABELED_SQL`/`FAILED_LABEL_SQL`, re-export; fix the failed filter (§4.3.2); move FX and add `convertToBase`; analytics imports it with output unchanged | `__tests__/orders/views.test.ts` (failed-filter SQL parity), `__tests__/fx.test.ts`; analytics snapshot unchanged |
| **G2 Usage + label failures** | `lib/middleware/withUsageLimiter.ts`, `pages/api/labels/ups.ts`, `pages/api/labels/mng.ts` | `getUsageSnapshot` (pure) and `checkUsage` calling it; `LabelJob failed` writes and the UPS `result.success` check (§4.3.1) | `__tests__/middleware/usageSnapshot.test.ts`: every `blocked` reason, `limit:null`, expired reset → `used:0`, `hideBilling` vs enforced limits; UPS/MNG failure writes a LabelJob (mocked Prisma) |
| **G3 Summary API** | `lib/overview/summary.ts` (new), `lib/overview/types.ts` (new, `OverviewSummary`), `pages/api/overview/summary.ts` (new) | Sections per §4.1, `Promise.all`, per-section errors, `requestId`, tz handling; `listingHealth` gated by a dynamic `import()` guard | `__tests__/overview/summary.test.ts`: tz boundaries (Istanbul and UTC, 23:30 local), 14-day zero-fill, revenue excluding unconverted from both periods, eBay stale syncing → failed, Etsy shop-name channel mapping, `errors[]` when one section throws, 401 and 405 |
| **G4 Client data + links** | `lib/hooks/useOverviewSummary.ts` (new), `lib/hooks/useSyncOrders.ts` (new), `components/CommandPalette.tsx`, `lib/stores/useMessageCountStore.ts`, `lib/nav/links.ts` (new), `pages/app/etsy-listings.tsx` (only the optional `?open=` reader) | SWR hook (key `/api/overview/summary?tz=&currency=`, options §3.7); sync hook revalidating `/api/orders*` + the summary; store `fetchedAt`/`failed`; legacy and v2 href builders | `__tests__/nav/links.test.ts` (both flag states for every queue href), `__tests__/hooks/useSyncOrders.test.ts` (redirect vs none, 429/limit error → toast key) |
| **G5 DS additions** | `components/ds/data/StatusPill.tsx`, `lib/ds/status/tracking.ts` (new), `lib/ds/status/billing.ts` (two keys; file owned by Settings, coordinate), `components/ds/data/DataTable.tsx` (optional pagination) | §6 items 1–2 | render tests for the new pills (EN/TR), DataTable without pagination renders no footer |
| **G6 Overview UI** | `components/domain/overview/OverviewPage.tsx`, `AttentionQueue.tsx`, `attentionRows.ts` (pure: summary + connections + notifications → ordered rows), `KpiRow.tsx`, `OrdersChartCard.tsx`, `BestSellersCard.tsx`, `StoresStrip.tsx`, `SetupChecklist.tsx` (all new); `pages/app/index.js` (route: `flag ? <OverviewPage/> : <LegacyOverview/>`, keeps the `session_id` toast); `components/legacy/LegacyOverview.js` (new, verbatim move) | Wireframes §2, states §3, primary rule §1, `usePageActions` registration, StickyActionBar on mobile | `__tests__/overview/attentionRows.test.ts` (ordering, grouping, hide-at-0, `hideBilling`, extension vs setup CTA, partial errors never "All caught up"), render tests for loading / done / partial / whole-error / not-connected / setup states |
| **G7 i18n** | `messages/en.json`, `messages/tr.json` | Add `overview.*` and the `status.*` additions; leave `dashboard.*` in place (the legacy page needs it) | key-parity test (every `overview.*` key exists in both files); a grep for ASCII-Turkish ("Olustur", "Gonder", "Siparis") in the new keys returns nothing |

Merge order: G1, G2, G5, G7 (independent) → G3 (imports G1 and G2) → G4 → G6. Flag `overview` stays off until the founder has checked production at 1440 and 390 in EN and TR (DS §8). The `dashboard.*` key deletion, `LegacyOverview.js` deletion and the `migrated-paths.json` entry for `components/domain/overview/**` and `pages/app/index.js` land one release after default-on.

### Definition of done (surface-specific, on top of DS §8)
- [ ] One primary per view in every state (A, B, no store, loading), including the mobile StickyActionBar rule.
- [ ] No number without source and time: every KpiTile has `source` + `asOf`; chart and best sellers carry their caption.
- [ ] Mixed currencies are never summed without `≈` and the FX tooltip; unconverted currencies are named.
- [ ] The failed-label count on Overview equals the row count of `/app/labels?label=failed&from=all` for the founder's account.
- [ ] A forced section failure (throw in `drafts`) shows the partial-error row and never "All caught up".
- [ ] Messages fetch failure shows `—`, not `0`.
- [ ] `/api/overview/summary` p95 < 400 ms on production data; `EXPLAIN` attached to the PR.

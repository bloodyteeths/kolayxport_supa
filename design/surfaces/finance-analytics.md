# Surface spec: Reports (Sales, Profit, Payouts, Transactions)

Status: design only, no app code changed. Date: 2026-10-15. Checkout: `kx-ux-phase0` at `92087ba`.
Contract: `design/DESIGN_SYSTEM.md` (DS) and `design/tokens.md`. This spec uses DS components only. §0.2 lists the four small DS amendments it needs, each with a reason. The integrator copies them into DS §3.1 / §4.4 when this surface lands (milestone **M9**).
Replaces: `pages/app/analytics.tsx` (854 lines), `pages/app/financials.tsx` (245), `components/finance/*` (1,464), `lib/stores/useFinanceStore.ts` (415, after the legacy release).

---

## 0. Decisions

### 0.1 What the seller gets (and why this beats Vela)
Vela edits listings. It does not tell a seller what they kept. Reports answers four questions, one per tab, for every connected store, in the seller's language and currency:

| Tab | Seller question | Source of truth |
|---|---|---|
| **Sales** | "How much am I selling, where, and what?" | `Order` + `OrderItem` (all stores, real time) |
| **Profit** | "What did I actually keep after fees, refunds, ads, shipping and product cost?" | `FinancialTransaction` ledger per marketplace + `ProductCost` + `Order.manualShippingCost` |
| **Payouts** | "What reached my bank, and what is still on the marketplace?" | ledger disbursements + `FinancialSyncCursor` balance |
| **Transactions** | "Show me the line items behind those numbers." | `FinancialTransaction` rows |

Every number states its source and time (P6). Converted amounts carry `≈` and name the real FX source. Missing product cost is a visible warning, not a silently inflated profit.

### 0.2 DS amendments (justified; integrator adds them to the DS)

| # | Amendment | Why the existing system can't cover it |
|---|---|---|
| A1 | **Nav (§3.1): "Reports" and "Finance" become one item, "Reports" (`BarChart3`).** The `Wallet` icon stays registered for finance concepts (Payouts tab empty state). | The task asks for one Reports area. Two pages that share a date range, a store filter and a currency rule should not each have their own date bar. One entry also means one fewer nav row for phone users. |
| A2 | **`KpiTile` gets `caption?: ReactNode`** (one line, `caption` 12/16 `neutral-500`, between value and delta). | DS §6.5 already draws a third line ("4 due today", "Etsy 2 · Wix 1"), but §4.4 props don't list it. Reports needs it for "Excludes product cost for 14 products" and "12 payouts". |
| A3 | **`Chart` series get `role?: 'primary' | 'comparison'`.** A comparison series is drawn as a 2px `neutral-400` line under the primary, is never filled, and is named "Previous period" in the legend. | Previous-period comparison is the most useful read on a trend chart. Without a rule, every implementer picks a second chart-palette hue, so the comparison looks like a different store. Gray is not a categorical hue, so it can't be confused with store identity. |
| A4 | **`Column.type: 'share'`** in `DataTable`: a 64×6 bar (track `neutral-100`, fill `accent-600`, radius 3) plus a right-aligned `Num percent`. On mobile it renders as the percent text only. | Store share and P&L "% of gross sales" are part-to-whole data. The donut is dropped (dataviz: more than 3 parts → bars), and a bar inside the table row is the honest replacement. |

No other new patterns. In particular there is **no donut, no dual axis, no colored KPI tile and no margin chip.**

### 0.3 Routes and coexistence (DS §7.1 rule 5)
- New canonical routes: `/app/reports` (Sales), `/app/reports/profit`, `/app/reports/payouts`, `/app/reports/transactions`. The title matches the nav label (fixes finding #33, "Dashboard" vs "Reports").
- Flag `reports` in `lib/ds/uiFlags.ts`.
  - **Flag on:** `pages/app/analytics.tsx` and `pages/app/financials.tsx` do a `router.replace` to `/app/reports` and `/app/reports/profit`, keeping the query string, and the nav points to `/app/reports`.
  - **Flag off:** the new routes render the legacy components so links never break.
- One release after the flag is on by default, the two old routes become `next.config` 308 redirects, and the legacy files are deleted (§8).
- `pages/app/index.js:176` (`/app/analytics` tile) is removed by M8 (Overview rebuild). Until then, the redirect covers it.

### 0.4 Code problems found while reading (all fixed by this spec)

| # | Where | Problem | Fix (§) |
|---|---|---|---|
| B1 | `api/analytics/index.ts:237-251` | `dailyStats` has `LIMIT 90` on (date × currency) rows, `ORDER BY date DESC`, and the UI plots that array as is. **The trend chart runs right to left**, and long ranges are silently truncated. There is no zero-fill, so quiet days vanish and the line lies. | §6.1 bucketed, ascending, zero-filled series |
| B2 | `api/analytics/index.ts:239-245, 630-647` | `DATE()` and `EXTRACT(HOUR)` run in the DB timezone (UTC). An Istanbul order at 01:30 counts on the previous day, and the hourly chart is shifted 3h. | `tz` param, `AT TIME ZONE` |
| B3 | `api/analytics/index.ts:389-398` | The previous period uses `uiOrderDate` only, while the current period also counts `createdAt` when `uiOrderDate` is null, and the marketplace filter differs. Deltas are biased. | same `where` for both windows |
| B4 | `api/analytics/index.ts:420-426` | Trend = `0` when the previous period is 0. The UI prints "▲ 0.0%", a fake number. | `null` → `—` + "No data in the previous period" |
| B5 | `api/analytics/index.ts:530-544` | Top products: `orders += 1` per **line item** (not quantity), grouped by display name, top 5, no image. | group by `sku ‖ productName`, sum `quantity`, return `image`, top 10 |
| B6 | `api/analytics/index.ts:681` | "Customers" = distinct `customerName`. Amazon hides names ("Amazon Customer"), so all Amazon buyers count as 1. | KPI removed; "Units sold" replaces it |
| B7 | `api/analytics/index.ts:203-206, 547-568` | `monthlyStats` ignores the date range and marketplace filter, and sums `COUNT(DISTINCT customerName)` across currency rows. | section deleted (granularity = month covers it) |
| B8 | `api/analytics/index.ts:445-466` | Stores bucketed by free-text `Order.marketplace`. Etsy shop names ("BelleCoutureGifts") show as separate "marketplaces", and the list of shop names is hard-coded in two APIs (`dashboard.ts:195`). | `lib/marketplaces/canonical.ts` (uses `EtsyShop.shopName`) |
| B9 | `analytics.tsx:120-126, 802, 835` | Money via `toLocaleString('en-US')` and a symbol map, so TR users see `$1,234`, and "TRY 1,070,860.03" appears in tiles. | `Money` only |
| B10 | `api/finance/dashboard.ts:400-410, 498-509` | `timeSeries.netProfit` leaves out ad spend, other fees and discounts, while `summary.netProfit` includes them. The chart's profit bars disagree with the tile. | buckets carry every cost line |
| B11 | `api/finance/dashboard.ts:247-256, 445` | COGS uses `ProductCost.costAmount` as is, whatever its `costCurrency`. A ₺ cost on a $ Etsy dashboard is summed as dollars. | convert with the shared `lib/fx.ts` `convertToBase` (created by Overview M8 G1; one FX module and one cache app-wide, CRITIQUE C5); when there is no rate, exclude and count |
| B12 | `api/finance/dashboard.ts:685` | The response has no `currency` (`currency.ts` guesses it) and no last-sync time, so the UI can't show freshness. | `summary.currency`, `lastSyncedAt` |
| B13 | `useFinanceStore.ts:186-192` | The default range uses `toISOString()`, the same UTC day-shift bug that `financials.tsx:18` documents and works around. | `lib/reports/dateRange.ts` (local dates in the seller's timezone) |
| B14 | `useFinanceStore.ts:393-412` | Transactions fetch errors are swallowed (`console.error`), so the table shows "No transactions" on failure. | SWR hook + `ErrorState` |
| B15 | `CostEntryDrawer.tsx` (bulk) | Bulk CSV import forces `costCurrency: 'TRY'` for every marketplace. | currency picker in "Paste a list" |
| B16 | `TransactionLog.tsx:166,205` | `toLocaleDateString('tr-TR')` hard-coded. Raw marketplace types ("Satış", "Komisyon Faturası") show in the EN UI. | `DateText`, category i18n + raw type in a tooltip |
| B17 | `ProductPnLTable.tsx:96` | CSV file name `urun-kar-zarar-…` is Turkish, and the export uses `.toFixed` on locale data. | `lib/reports/exportCsv.ts` |
| B18 | `FinancialDashboard.tsx:52-58`, `BankedPanel.tsx:9-13` | `formatCurrency` prints `₺1.1K` with an English "K" and a dot decimal in TR. Compact is used in tables. | `Money` (compact only in KPI tiles and chart axes) |

---

## 1. Information architecture

```
Reports  (nav: BarChart3, g p; `g r` is Research in shell-nav, CRITIQUE C3)
├── Sales          /app/reports                 all stores · converted to one display currency
├── Profit         /app/reports/profit          one finance marketplace at a time · its settlement currency
├── Payouts        /app/reports/payouts         same marketplace selector as Profit
└── Transactions   /app/reports/transactions    same marketplace selector as Profit
```

Shared by all four tabs (one component, `ReportsPage`):
- **`Page width="detail"`** (1280, centered). `<title>` is "Reports · KolayXport".
- **`PageHeader`**: title "Reports", `meta` = freshness for the active tab, one primary action (§4.1), and `⋯` overflow.
- **`Tabs`** (4) under the header. Each tab is a route, so Back works and links are shareable. `Tabs.onChange` uses `router.push(href, undefined, { shallow: false })` and keeps the shared query (`from`, `to`, `preset`).
- **`Toolbar`** (one row, 32px controls):
  - `DateRangeField` (shared across tabs);
  - `FilterButton` "Store";
  - tab-specific: Sales gets the "Show in" currency `Select`, and Transactions gets the "Type" `FilterButton`;
  - the right side holds the result count (Transactions only).
- **URL state** (`useUrlState`): `from`, `to` (YYYY-MM-DD in the seller's timezone), `preset`, `stores` (Sales, comma list), `mp` (Profit/Payouts/Transactions, single), `cur` (Sales), `g` (granularity override), `type` and `page` (Transactions), `q` (product table search).

**Marketplace scope rule.** Sales may combine stores because it converts to one display currency and labels the result `≈`. Profit, Payouts and Transactions show **one marketplace in its own settlement currency**. Fees, refunds and payouts are never summed across currencies (DS §3.12 "Mixed currencies: never summed"). A combined converted profit view is **deferred to v2** (§9).

---

## 2. Wireframes

Legend: `[Primary]` solid accent · `[Secondary]` outlined · `( )` ghost · `▾` menu · `ⓘ` tooltip · `⟳` pull · `≈` converted.

### 2.1 Sales, desktop 1440

```
┌──────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Reports                                                [⌘K Search or jump…]         (bell) (TS)│ TopBar 52 (breadcrumb only)
│ 240      ├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│          │      ┌──────────────────────────── detail 1280, centered ───────────────────────────────┐       │
│ Reports ●│      │ Reports                                                     ⋯   [⤓ Export CSV]  │ 56     │
│          │      │ Orders as of 10:42 ⟳ · ≈ converted at exchangerate-api.com rates, 15 Oct 10:00 ⓘ │ meta   │
│          │      │ ┌─────────┬─────────┬──────────┬──────────────┐                                  │        │
│          │      │ │ Sales ▔▔│ Profit  │ Payouts  │ Transactions │                                  │ Tabs   │
│          │      │ └─────────┴─────────┴──────────┴──────────────┘                                  │        │
│          │      │ [1 Sep – 30 Sep 2026 ▾] [Store: All ▾] [Show in: ₺ TRY ▾]                       │ Toolbar│
│          │      │                                                                                  │        │
│          │      │ ┌ Revenue ──────────┐┌ Orders ───────────┐┌ Average order ────┐┌ Units sold ─────┐│ KpiTile│
│          │      │ │ ≈ ₺1.070.860      ││ 1.284             ││ ≈ ₺834,00         ││ 1.912           ││ ×4     │
│          │      │ │ ▲ 12,4% vs prev.  ││ ▲ 8,1% vs prev.   ││ ▼ 3,2% vs prev.   ││ ▲ 6,0% vs prev. ││ neutral│
│          │      │ │ Orders · 5 stores ││ Orders · 5 stores ││ Orders · 5 stores ││ Orders · 5 st.  ││        │
│          │      │ │ as of 10:42       ││ as of 10:42       ││ as of 10:42       ││ as of 10:42     ││        │
│          │      │ └───────────────────┘└───────────────────┘└───────────────────┘└─────────────────┘│        │
│          │      │                                                                                  │        │
│          │      │ Revenue over time                  [Revenue | Orders]   [Daily | Weekly | Monthly]│ Section│
│          │      │ ┌──────────────────────────────────────────────────────────────────────────────┐ │        │
│          │      │ │ ₺60K ┤                                   ╭─╮                                 │ │ Chart  │
│          │      │ │ ₺40K ┤        ╭──╮      ╭───╮  ╭────╮ ╭──╯ ╰─╮   ╭──╮      ● ₺52.140      │ │ line   │
│          │      │ │ ₺20K ┤ ╭──────╯  ╰──────╯   ╰──╯    ╰─╯      ╰───╯  ╰──────╯               │ │ 280px  │
│          │      │ │      ┤ ┄┄ previous period (neutral-400) ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │        │
│          │      │ │   0  ┼────────────────────────────────────────────────────────────────────── │ │        │
│          │      │ │       1 Sep          8 Sep          15 Sep          22 Sep          30 Sep   │ │        │
│          │      │ │ ━ This period   ━ Previous period (1–31 Aug)                                 │ │ legend │
│          │      │ └──────────────────────────────────────────────────────────────────────────────┘ │        │
│          │      │                                                                                  │        │
│          │      │ Sales by store                                                                   │ Section│
│          │      │ ┌────────────────────────────┬────────┬───────┬───────────────────┬────────────┬──────────────┬───────────┐
│          │      │ │ Store                      │ Orders │ Units │ Revenue (original)│ Revenue (₺)│ Share        │ Avg order │
│          │      │ │ [E] BelleCoutureGifts      │    612 │   901 │ $14.820,40        │ ≈ ₺611.300 │ ▰▰▰▰▱▱ 57,1% │ ≈ ₺998,86 │
│          │      │ │     Etsy                   │        │       │                   │            │              │           │
│          │      │ │ [T] Trendyol               │    402 │   618 │ ₺281.400,00       │ ₺281.400   │ ▰▰▱▱▱▱ 26,3% │ ₺700,00   │
│          │      │ │ [e] eBay                   │    170 │   240 │ $2.910,10 · €410  │ ≈ ₺137.900 │ ▰▱▱▱▱▱ 12,9% │ ≈ ₺811,18 │
│          │      │ │ [a] Amazon                 │    100 │   153 │ $980,00           │ ≈ ₺40.260  │ ▱▱▱▱▱▱  3,8% │ ≈ ₺402,60 │
│          │      │ └────────────────────────────┴────────┴───────┴───────────────────┴────────────┴──────────────┴───────────┘
│          │      │                                                                                  │        │
│          │      │ ┌ Top products ─────────────────────────────────────┐┌ Orders by status ───────────┐│ 2-col  │
│          │      │ │ [⌕ Search product or SKU   /]                     ││ ● To ship        42      ›  ││ 8/4    │
│          │      │ │ [img] Personalized Baby Blanket… · BB-01  318 ₺…  ││ ● Shipped     1.120      ›  ││        │
│          │      │ │ [img] Name Necklace Gold · NN-G            201 ₺… ││ ● Delivered      88      ›  ││        │
│          │      │ │ [img] Wooden Keepsake Box · WKB-2          144 ₺… ││ ● Cancelled      21      ›  ││        │
│          │      │ │ … 10 rows · units · revenue (≈)                   ││ ● Refunded       13      ›  ││        │
│          │      │ └───────────────────────────────────────────────────┘└─────────────────────────────┘│        │
│          │      └──────────────────────────────────────────────────────────────────────────────────┘       │
└──────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Notes:
- **Single day range** (`from == to`, e.g. preset Today/Yesterday): the chart becomes "Orders by hour", a bar chart with a single series (accent). Previous day is the comparison series (A3), drawn as a line. The granularity control is hidden.
- Revenue (≈) tiles show **compact only at ≥ 100,000** (DS §3.12), full value in the tooltip.
- The store table row opens nothing (no SidePanel). The store name links to `/app/labels?store=<key>&from=&to=`. "Orders by status" rows link to the Orders saved view with the same range.

### 2.2 Profit, desktop 1440

```
│ Reports                                                                      ⋯  [Add product costs] │ primary is state-driven (§4.1)
│ Refreshed from Etsy 2 h ago ⟳ · Etsy payments ledger · amounts in $                                  │ SyncMeta
│ [ Sales | Profit ▔▔ | Payouts | Transactions ]                                                       │
│ [1 Sep – 30 Sep 2026 ▾] [Store: [E] Etsy ▾]                                                          │
│                                                                                                      │
│ ⚠ Product cost is missing for 14 of 32 products, so net profit is too high.     [Add product costs] │ Banner warning (one line)
│ ⓘ 9 orders aren't settled by Etsy yet. They appear here once Etsy books them, usually in 1–3 days.  │ Banner info (dismissable per range)
│                                                                                                      │
│ ┌ Net sales ────────┐┌ Fees and costs ───┐┌ Net profit ───────┐┌ Margin ───────────┐                 │ KpiTile ×4
│ │ $14.212,30        ││ $5.904,12         ││ $8.308,18         ││ %58,5             │                 │
│ │ 603 orders        ││ 41,5% of net sales││ Excludes product  ││ ▼ 2,1 pts vs prev.│                 │ caption (A2)
│ │                   ││                   ││ cost for 14 prod. ││                   │                 │
│ │ ▲ 9,8% vs prev.   ││ ▲ 4,0% vs prev. ▲ ││ ▲ 12,7% vs prev.  ││                   │                 │ costs: goodWhen 'down'
│ │ Etsy ledger·10:42 ││ Etsy ledger·10:42 ││ Etsy ledger·10:42 ││ Etsy ledger·10:42 │                 │
│ └───────────────────┘└───────────────────┘└───────────────────┘└───────────────────┘                 │
│                                                                                                      │
│ ┌ Profit and loss ───────────────────────────────┐┌ Net sales and net profit      [Daily|Weekly|Monthly]┐
│ │ Gross sales                  $14.820,40   100% ││ $3K ┤      ╭─╮         ╭──╮                      │
│ │ Refunds                       −$608,10  ▰ 4,1% ││ $2K ┤ ╭────╯ ╰───╮ ╭───╯  ╰──── net sales (accent)│
│ │ Discounts                       −$0,00     0%  ││ $1K ┤ ╰──────────╯─╯────────── net profit (teal)  │
│ │ Marketplace fees            −$2.104,22 ▰▰ 14,2%││   0 ┼──────────────────────────────────────────── │
│ │ Ads                           −$812,40  ▰ 5,5% ││     1 Sep        15 Sep          30 Sep           │
│ │ Shipping                    −$2.380,00 ▰▰ 16,1%││ ━ Net sales  ━ Net profit                         │
│ │ Other fees                       −$0,00    0%  │└───────────────────────────────────────────────────┘
│ │ Product cost ⓘ (18 of 32)     −$607,50  ▰ 4,1% │  6/12 + 6/12 columns at ≥ 1200; stacked below
│ │ ─────────────────────────────────────────────  │
│ │ Net profit                    $8.308,18  56,1% │  title-sm; success-fg when ≥ 0, danger-fg when < 0
│ └────────────────────────────────────────────────┘
│                                                                                                      │
│ Profit by product                                                     [⌕ Search product or SKU  /]   │
│ ┌──────────────────────────────────┬──────┬───────────┬─────────┬─────────┬──────────────┬──────────┬────────┐
│ │ Product                          │ Sold │ Revenue   │ Fees    │ Shipping│ Unit cost ✎  │ Profit   │ Margin │
│ │ Personalized Baby Blanket        │  118 │ $5.902,00 │ $812,10 │ $930,00 │ $11,50       │$2.802,90 │ %47,5  │
│ │ BB-01 · 1 returned               │      │           │         │         │              │          │        │
│ │ Name Necklace Gold               │   64 │ $2.111,36 │ $290,00 │ $420,00 │ —  Add cost  │$1.401,36 │ %66,4  │ ← cost missing: ghost "Add cost" in cell
│ │ Wooden Keepsake Box              │   12 │   $480,00 │  $66,00 │ $310,00 │ $14,00       │  −$64,00 │ −%13,3 │ ← danger-fg text only
│ └──────────────────────────────────┴──────┴───────────┴─────────┴─────────┴──────────────┴──────────┴────────┘
│ 1–50 of 132   Rows 50 ▾   ‹ 1 2 3 ›                                                                  │
```

### 2.3 Payouts and Transactions, desktop (bodies only; header, tabs and toolbar as in 2.2)

```
Payouts
┌ Paid to bank ─────┐┌ Balance on Etsy ──┐┌ Held by eBay ──────┐   (third tile only when heldFunds != null: eBay)
│ $9.120,00         ││ ~ $1.204,55 ⓘ     ││ $310,00            │   "~" = Estimate (P6) with the existing reserve note
│ 4 payouts         ││ Not paid out yet  ││ Not available yet  │
│ Etsy ledger·10:42 ││ as of last refresh││ as of last refresh │
└───────────────────┘└───────────────────┘└────────────────────┘
Payouts over time                      (bar, single series accent, ≤ 24px bars, value label on the tallest)
Payouts (DataTable): Date · Amount                                                     1–4 of 4

Transactions
Toolbar adds: [Type: All ▾] (options: categories with counts, e.g. "Sale (603)", "Fee (611)")   · right: 1.284 transactions
┌────────────┬──────────────┬────────────────────────────────┬─────────────────┬────────────┬──────────┐
│ Date       │ Type         │ Product                        │ Order           │ Amount     │ Fee      │
│ 14 Sep     │ Sale ⓘ       │ Personalized Baby Blanket      │ 3891204455 ⧉    │ +$49,00    │ $6,37    │  ⓘ = raw type "Sale"
│ 14 Sep     │ Fee ⓘ        │ —                              │ —               │ −$0,20     │ —        │  raw "EtsyFee"
│ 12 Sep     │ Payout ⓘ     │ —                              │ —               │ −$2.280,00 │ —        │  raw "Disbursement"
└────────────┴──────────────┴────────────────────────────────┴─────────────────┴────────────┴──────────┘
1–50 of 1.284   Rows 50 ▾   ‹ 1 2 … 26 ›
```

### 2.4 Product costs SidePanel (md 560), opened from the primary or the "Add cost" cell

```
┌──────────────────────────────────────────────────────── md 560 ┐
│ [E] Product costs                                         ⋯  ✕ │ header 56
│ Etsy · used to work out net profit                             │
├────────────────────────────────────────────────────────────────┤
│ [ One product | Paste a list ]                  SegmentedControl│
│                                                                 │
│ Product                                                         │ FormField label above
│ [ Name Necklace Gold                                   ▾ ]      │ Combobox: sold products, creatable
│ Pick a product you sold, or type a name                         │
│ Barcode or SKU                                                  │
│ [ NN-G                          ]  (prefilled from the pick)    │
│ Unit cost                         Currency                      │ natural pair
│ [ $ 11,50        ]                [ $ USD ▾ ]                   │ MoneyField + CurrencySelect (default = dashboard currency)
│ Shipping per item (optional)                                    │
│ [ $ 0,00         ]                                              │
│ Note (optional)                                                 │
│ [                                ]                              │
│ ─────────────────────────────────────────────────────────────── │
│ Saved costs                                     [⌕ Search    ]  │ SidePanelSection
│ Product                        Unit cost      Shipping          │ DataTable compact, money-edit cells
│ Personalized Baby Blanket      $11,50 ✎       $0,00 ✎           │
│ Wooden Keepsake Box            ₺480,00 ✎      —                 │ ← each cost keeps its own currency
├────────────────────────────────────────────────────────────────┤
│                                     ( Cancel )   [ Add cost ]   │ footer 64
└────────────────────────────────────────────────────────────────┘
Paste a list mode body:
  Currency [ ₺ TRY ▾ ]   (applies to every row; fixes B15)
  TextArea: "barcode or SKU, name, unit cost, shipping" (comma, semicolon or tab separated; header row auto-skipped)
  Preview: "28 rows ready · 2 rows skipped" + a 5-row DataTable preview; skipped rows listed with the reason
  Footer primary: [ Import 28 costs ]
```

### 2.5 Mobile 390 (Sales; the other tabs follow the same frame)

```
┌──────────────────────────────────┐
│ Reports                  ⌕    ⋯  │ TopBar 48 (title shown on mobile only); ⋯ = Export CSV; bell is in More (shell-nav §4.1 slot rule, CRITIQUE C2)
├──────────────────────────────────┤
│ Orders as of 10:42 ⟳             │ meta (caption, one line, truncates)
│ Sales▔  Profit  Payouts  Transa… │ Tabs: horizontal scroll strip (allowed chip-strip exception)
│ [1–30 Sep 2026 ▾] [Store: All ▾] │ 44px coarse controls; "Show in" moves into [Filters • 1]
│ [Filters]                        │
│ ┌──────────────┐┌──────────────┐ │
│ │ Revenue      ││ Orders       │ │ KpiTile 2×2, compact allowed
│ │ ≈ ₺1,07 Mn   ││ 1.284        │ │
│ │ ▲ %12,4      ││ ▲ %8,1       │ │ delta period label in the tooltip only
│ └──────────────┘└──────────────┘ │
│ ┌──────────────┐┌──────────────┐ │
│ │ Average order││ Units sold   │ │
│ │ ≈ ₺834       ││ 1.912        │ │
│ └──────────────┘└──────────────┘ │
│ Revenue over time                │
│ [Revenue | Orders]               │ granularity auto on mobile (no control)
│ ╭─╮  ╭──╮╭─╮   ●                 │ 200px, 4 x-ticks, tap = tooltip
│ ━ This period ━ Previous         │
│ Sales by store                   │ DataTable → cards
│ ┌──────────────────────────────┐ │
│ │ [E] BelleCoutureGifts  57,1% │ │ title · trailing share
│ │ Etsy · 612 orders · 901 units│ │ subtitle/meta
│ │ ≈ ₺611.300  ($14.820,40)     │ │ trailing money + original in caption
│ └──────────────────────────────┘ │
│ Top products                     │ cards: thumb 64 · title · units · ≈ revenue
│ Orders by status                 │ 48px rows with ›
├──────────────────────────────────┤
│ tab bar                          │ no StickyActionBar on Sales (no state-driven primary)
└──────────────────────────────────┘
```
Mobile Profit: the banners stack (one line each, truncating with a tooltip); KPI 2×2; the P&L statement is a `KeyValueList` (1 column) with the share bars hidden; the chart is at 200px; product rows are cards: title / "Sold 118 · Margin %47,5" / trailing profit / action "Add cost" when missing. The state-driven primary **"Add product costs"** sits in `StickyActionBar` above the tab bar when costs are missing. Tapping a card opens the full-height sheet with the unit cost `MoneyField`.

---

## 3. States (every async region has four; `useAsyncState`: skeleton after 200ms, "Still loading… Retry" at 15s, `ErrorState` at 30s)

| Region | Loading | Empty | Error | Partial / stale |
|---|---|---|---|---|
| Whole tab, first load | `KpiSkeleton count=4` + chart block 280 + `TableSkeleton rows=5` | see rows below | `ErrorState page` "Couldn't load your sales" / "Couldn't load Etsy payments" + Try again + Copy error ID | — |
| Range or filter change with data shown | keep the data, `aria-busy`, 60% opacity on changed regions, header meta "Updating…" | — | `ErrorState stale` "Showing data from 10:42 · Retry" above the KPIs, with the old data still visible (keeps today's good behaviour) | — |
| Sales, no store connected (`anyMarketplace === false`) | — | `ConnectState` replaces the body: "Connect a store to see your sales" + [Connect a store] → `/ayarlar?tab=connections` | — | while `anyMarketplace === undefined`: skeleton, never the connect screen (tri-state rule) |
| Sales, connected but 0 orders in range | — | `EmptyState no-results` "No orders in this period" · "Try a longer date range." · [Show last 90 days] | — | — |
| Sales, store filter excludes everything | — | `EmptyState no-results` + [Clear filters] | — | — |
| Sales, `unconvertedCurrencies` non-empty | — | — | — | `Banner warning`: "12 orders in CAD are left out of totals: no exchange rate." The Revenue tile caption reads "Excludes 12 orders". |
| Sales, `ratesStale` | — | — | — | `Banner warning`: "Exchange rates couldn't be updated. Using rates from 14 Oct 18:00." The ≈ tooltips show that date. |
| Sales, previous period empty | — | — | — | delta renders `—` with the tooltip "No data in the previous period" (B4) |
| Profit/Payouts/Transactions, marketplace not connected | — | `ConnectState brand=mp` "Connect Etsy to see your profit" (existing `connectToSeeFinancials` copy) | — | — |
| Profit, marketplace not supported (Wix, Shopify, Hepsiburada chosen through a deep link) | — | `EmptyState first-use` "Profit reports are available for Etsy, eBay, Amazon and Trendyol." The Store filter lists only those four. | — | — |
| Profit, never synced (no cursor, no rows) | — | `EmptyState first-use` "Get your Etsy payments" · "We read fees, refunds and payouts from Etsy. Nothing is changed on Etsy." · [Refresh from Etsy] (that empty state's one action; PageHeader primary is hidden) | sync POST fails: inline `ErrorState` "Couldn't refresh from Etsy" + Try again; toast error persists | sync running: the button shows `loading` "Refreshing from Etsy…", and the meta shows the same |
| Profit, synced but range empty | — | `EmptyState no-results` "No payments in this period" + [Show last 90 days] | — | — |
| Profit, `pendingSettlementCount > 0` | — | — | — | `Banner info` (dismissKey per mp+range) |
| Profit, `pendingCancellationCount > 0` | — | — | — | appended to the same info banner: "4 cancellations have no refund yet." |
| Profit, costs missing (`costCoverage.productsWithoutCost > 0`) | — | — | — | `Banner warning` + the Net profit tile caption + the P&L line "Product cost (18 of 32)". The primary becomes "Add product costs" (§4.1). |
| Profit, `cogsExcluded > 0` (cost currency has no FX rate) | — | — | — | the P&L line "Product cost" shows ⓘ "2 costs in GBP left out: no exchange rate" |
| Profit, data older than 12h (`lastSyncedAt`) | — | — | — | the meta reads "Refreshed from Etsy 14 h ago ⟳" in `warning-fg` (text only); there is no banner (P6: progress lives in meta) |
| Product P&L table | rows skeleton | `EmptyState no-results` "No products sold in this period" | inline `ErrorState` | search without matches: "No products match '…'" + [Clear search] |
| Payouts | as tab | `EmptyState done`-style quiet: "No payouts in this period". Balance tiles still render. | inline | Balance tile shows `—` + ⓘ when `currentBalance == null` ("Etsy hasn't reported a balance yet") |
| Transactions | `TableSkeleton rows=8` | `EmptyState no-results` "No transactions in this period" (+ [Clear filters] when Type is set) | inline `ErrorState` (fixes B14) | page change keeps the rows dimmed |
| Cost panel | `PanelSkeleton` | "No costs saved yet" (inside the Saved costs section) | save error: the field-level message if 400, else a `Banner danger` at the top of the panel + a persistent toast | sold-products Combobox load fails: plain free-text entry still works, helper "Couldn't load sold products" |
| Export CSV | button `loading` "Exporting…" (keeps its width) | disabled with `disabledReason` "Nothing to export for this period" | toast error "Couldn't export. Try again." | Transactions export > 10,000 rows: confirm "Export the first 10.000 transactions?" |

---

## 4. Interactions

### 4.1 Primary action per tab (P1: exactly one)

| Tab | Primary | Secondary (≤2) | Overflow `⋯` |
|---|---|---|---|
| Sales | **Export CSV** (`Download`) | — | Open Orders for this period |
| Profit | **Add product costs** when `productsWithoutCost > 0`, else **Export CSV** | Export CSV (only when the primary is "Add product costs") | Manage product costs · Open Transactions |
| Payouts | **Export CSV** | — | Open Transactions (Type: Payout) |
| Transactions | **Export CSV** | — | — |

- Pull is never a button. Sales meta `⟳` revalidates SWR (re-query, our DB). Profit, Payouts and Transactions meta `⟳` runs `POST /api/finance/settlements {action:'sync', marketplace, startDate, endDate}` (existing), then revalidates the dashboard and transactions keys. A toast appears only when something new arrived: "24 new transactions from Etsy". The never-synced empty state is the one place "Refresh from Etsy" appears as a button (that view's primary).
- Every header action registers through `usePageActions` (⌘K). The palette gets "Go to Reports" (`g p`; `g r` is Research, CRITIQUE C3), plus the four tabs as `goto` commands.

### 4.2 Date range
- `DateRangeField` presets: Today, Yesterday, Last 7 days, **Last 30 days (default)**, This month, Last month, Last 90 days, This year, Last year, Custom. Weeks start on Monday in TR. There is no Apply button: a preset click or the second date pick applies it.
  - Mapping to legacy params is not needed: the new UI always sends `from`/`to`.
  - **Removed presets:** "3/6/9/12 months" and "All time". All-time makes the API scan every order, and "Last year" plus custom covers the real need.
- Dates are computed in the **seller timezone** (account setting, default `Europe/Istanbul`) by `lib/reports/dateRange.ts`, as `YYYY-MM-DD` strings. `toISOString` is never used (B13).
- The comparison window is always the previous period of equal length (a single day → the previous day; This month → the same day count of last month). The delta label comes from the window, as a tooltip: "vs 1–31 Aug".
- Granularity is automatic: 1 day → hour, 2–45 days → day, 46–180 → week, more → month. The `SegmentedControl` (desktop only) can override it among the valid options (`g` in the URL).
- The range persists across tabs (shared query). The store selection is per scope (`stores` for Sales, `mp` for the rest).

### 4.3 Store filter
- **Sales:** `FilterButton multiple`. Options are the connected stores from `useConnections` plus any store key that appears in the period's data (old orders from a disconnected store still count). Each option shows a `LogoTile` + shop name. Default: All.
- **Profit/Payouts/Transactions:** `FilterButton` single. Options are Etsy, eBay, Amazon and Trendyol; unconnected ones show the `not_connected` pill inside the option and open `ConnectState` when picked. Default: the URL `mp`, else the first connected one (today's `firstConnected` logic, kept).

### 4.4 Currency
- Sales "Show in": TRY / USD / EUR. The default is the seller's base currency (TRY for a TR seller; account setting, as in DS §3.7). Every converted value uses `Money approx` (≈) and `fxNote` = "Converted from USD, EUR at exchangerate-api.com rates (15 Oct 10:00)". **The DS §3.12 example says "TCMB rate". The code uses exchangerate-api.com, so the UI must name exchangerate-api.com** (P6). If TCMB is wanted, that is a separate backend change.
- "Revenue (original)" shows per-currency totals, never summed: "$2.910,10 · €410,00".
- Profit and the other finance tabs use `summary.currency` from the API. The header meta says "amounts in $", and there is no conversion control.

### 4.5 Charts (dataviz rules applied to the DS `Chart` wrapper)
- **One y-axis, always.** Revenue and Orders are two views of one chart (`SegmentedControl`), never two axes (fixes #33). Profit's two series (net sales, net profit) share one money axis.
- **Color:**
  - single measure → `chart[0]` `#2563EB`;
  - comparison → `neutral-400` line (A3);
  - Profit second series → `chart[1]` `#0D9488`;
  - store identity is never colored in Reports (stores appear as `LogoTile` in tables, not as chart series).
  - The DS 6-slot palette fails the dataviz validator on slot 6 (`#64748B`, chroma 0.041, reads gray) and is CVD-borderline on 5↔6. Reports uses **slots 1–4 only**, which pass every check: `validate_palette.js "#2563EB,#0D9488,#D97706,#7C3AED" --mode light` → all PASS. Integrator note for the DS: slot 6 should be documented as "Other / neutral fold" rather than a categorical hue.
- **Marks:**
  - lines 2px;
  - area wash 10% under the primary line only;
  - bars ≤ 24px with a 4px rounded data end;
  - 1px solid `neutral-100` gridlines;
  - axis text `caption` `neutral-500`;
  - one direct label on the latest point (Sales) or the tallest bar (Payouts);
  - a legend when there are 2 or more series, none for 1.
- Negative profit renders below a `neutral-300` zero baseline. Values never wear the series color: tooltip text is `neutral-0` on `neutral-900` (the tooltip token), with a colored key dot.
- **Hover:** a crosshair and tooltip showing the date range of the bucket ("8–14 Sep"), the value via `Money`/`Num`, and the comparison value with its delta. Tap does the same on touch.
- **Axis formatting:** money uses compact (`fmtMoney compact`) and dates use `DateText` short. The x-axis never shows more than 8 ticks (4 on mobile).
- **Table view:** each chart has `⋯ → Show as table` (accessibility: the data is available without color). It opens a `Modal md` with a `DataTable` (bucket, value, previous).

### 4.6 Product costs (editing is local data, not a marketplace write)
- The `Unit cost` cell in "Profit by product" is `type: 'money-edit'`. `Enter`/`Tab` commits and calls `POST /api/finance/product-costs` (upsert by barcode, existing `upsertCostByBarcode` payload) with `costCurrency` = dashboard currency. After that it revalidates the dashboard and shows a toast "Cost saved". `Esc` cancels. Failure: the cell keeps its value, gets a danger outline and the tooltip "Couldn't save cost".
- **Why this does not stage a draft:** DS §3.4 staging exists because Etsy must never be written without an explicit send. A product cost is KolayXport-only data with no marketplace side effect, so staging would add a button with no purpose (P1: "A button that cannot do anything is not rendered").
- Rows without `barcode` and without `sku` render the cost cell read-only, with the tooltip "This product has no barcode or SKU, so a cost can't be saved."
- The panel's Combobox lists sold products (`GET /api/finance/product-costs?action=sold_products`). Picking one prefills Barcode/SKU and the name.

### 4.7 Keyboard
- `/` focuses the visible table's search (Top products, Profit by product).
- `j`/`k`/`Enter` work in the DataTables; `Enter` on a product row opens the cost panel at that product.
- `Esc` closes the panel; `⌘↵` runs the panel primary.
- `⌘K` → page actions. No new shortcuts.

### 4.8 Export CSV (`lib/reports/exportCsv.ts`)
- The format is machine-readable whatever the locale:
  - UTF-8 with BOM, comma separator, dot decimals, ISO dates;
  - a `currency` column on every money row;
  - headers from i18n in the UI locale.
- File name: `kolayxport-<tab>-<from>_<to>.csv` (ASCII, not translated).
- Sales exports the store table, the top products and the series. Profit exports the P&L lines and the product table. Payouts exports the payout rows. Transactions calls `GET /api/finance/settlements?format=csv` (new, §6.2) so the export is not limited to the loaded page.

---

## 5. Formatting (no exceptions)
- All money goes through `Money` (narrowSymbol, 2 decimals, locale grouping): `₺1.070.860,03` (TR) / `₺1,070,860.03` (EN). **Never "TRY 1,070,860.03"** (finding #33).
- Compact money appears **only** in `KpiTile` values ≥ 100,000 and on chart axes, with the full value in the tooltip.
- Percent: `Num percent`, at most 1 decimal: `%58,5` / `58.5%`.
- KPI deltas:
  - ▲/▼ + a signed percent;
  - `success-fg`/`danger-fg` by `goodWhen` (Fees and costs: `goodWhen: 'down'`);
  - the margin delta is in percentage points ("▼ 2,1 pts" / "▼ 2,1 puan").
- Counts: `Num`. Dates: `DateText` (`date` mode in tables; ranges via `DateRangeField` trigger format "1–30 Eyl 2026").
- Signed amounts in Transactions: `Money sign` with `success-fg` for positive and `danger-fg` for negative, **text only**. P&L cost lines are shown as negatives in `neutral-800` (not red; red is only for a negative **result**).
- No `.toFixed`, no hard-coded symbols, no `toLocaleString`. `components/finance/currency.ts` is deleted, and `summary.currency` comes from the API.

---

## 6. Data per element → API (verified in code) and minimal API additions

### 6.1 Sales (`GET /api/analytics`)

New query params (old `dateRange`/`month`/`day` keep working for the legacy page until deletion):
- `from`, `to` (YYYY-MM-DD) and `tz` (IANA, default `Europe/Istanbul`);
- `stores` (comma list of canonical store keys, optional);
- `currency` (`TRY|USD|EUR`, default `TRY`);
- `granularity` (`hour|day|week|month`, computed by the client).

| UI element | Field (existing → new) | Change |
|---|---|---|
| Revenue tile | `totalRevenue` (TRY) → `totals.revenue` in `currency` | convert with the existing rates table: `TRY / rates[currency]` |
| Revenue delta | `revenueTrend` → `totals.revenueDelta: number | null` | `null` when previous = 0 (B4); same `where` for both windows (B3) |
| Orders tile + delta | `totalOrders`, `orderTrend` → `totals.orders`, `totals.ordersDelta` | same |
| Average order tile | `averageOrderValue` → `totals.aov`, `totals.aovDelta` | the divisor stays "converted orders" (existing logic) |
| Units sold tile | **new** `totals.units`, `totals.unitsDelta` | `SUM(OrderItem.quantity)` over the same `where` |
| Tile `source` / `asOf` | **new** `generatedAt`, `storesIncluded: string[]` | — |
| Tile caption "Excludes N orders" | `unconvertedCurrencies` → `fx.excluded: { currency, orders }[]` | count orders per excluded currency |
| FX meta / ≈ tooltips / stale banner | `exchangeRates`, `ratesStale` → `fx: { source: 'exchangerate-api.com', asOf, stale, rates: { USD, EUR }, excluded }` | rename and group; keep the old fields during the legacy release |
| Trend chart | `dailyStats` → `series: { bucketStart: 'YYYY-MM-DD[THH]', orders, revenue }[]` plus `previousSeries` (same length, aligned by index) | `date_trunc(granularity, COALESCE("uiOrderDate","createdAt") AT TIME ZONE tz)`, ascending, **zero-filled with `generate_series`**, **no LIMIT** (B1, B2). Hourly replaces `hourlyBreakdown` when granularity = hour. |
| Sales by store table | `marketplaceBreakdown` → `stores: { key, marketplace: MarketplaceKey | 'manual' | 'other', shopName, orders, units, revenue, byCurrency, aov, share }[]` | bucket with `canonicalStore()` (B8); `share` = revenue share (the UI's old `percentage` was order share and was mislabeled as "%") |
| Top products | `topProducts` → `products: { key, name, sku, image, units, revenue }[]` (top 10) | group by `COALESCE(sku, productName)`, `SUM(quantity)`, `MAX(image)` (B5) |
| Orders by status | `orderStatusBreakdown` → `statuses: { raw, marketplace, count }[]` | the client maps through `lib/ds/status/orders.ts orderStatus(raw, marketplace)` into DS keys and sums per key; colors come from `StatusPill`, not the API |
| — deleted | `totalCustomers`, `monthlyStats`, `recentActivity`, `shippingStats`, `topMarketplaces[].color`, `orderStatusBreakdown[].color` | removed from the new response shape (B6, B7). The color maps in the API are deleted. |

Shared helper: **`lib/marketplaces/canonical.ts`** (created by Orders M3 G1 for the Store column; Overview and this surface import it; CRITIQUE C5)
- `canonicalStore(orderMarketplace: string, etsyShopNames: Set<string>): { key: string; marketplace: MarketplaceKey | 'manual' | 'other'; shopName: string | null }`.
- Etsy shop names come from `EtsyShop.shopName` for the user. That replaces the hard-coded `bellecouture/decorsweet/mybabybymerry/outletemporium` lists in `analytics/index.ts:434-447` and `finance/dashboard.ts:194-199`.
- It also maps legacy "Shippo"/"Veeqo" rows to `other`, labeled with their name.

### 6.2 Profit, Payouts and Transactions (`/api/finance/*`)

`GET /api/finance/dashboard`: new params `tz`, `compare=previous`. Response additions:

| UI element | Field | Change |
|---|---|---|
| Currency in meta and all `Money` | **new** `summary.currency` | trendyol → `TRY`; else `cursor.balanceCurrency`, else the most frequent `FinancialTransaction.currency` in range (B12) |
| Meta "Refreshed from Etsy 2 h ago" | **new** `lastSyncedAt` = `FinancialSyncCursor.updatedAt` | — |
| Net sales tile | `grossRevenue − returns` | unchanged (client computes it) |
| Fees and costs tile | `commissions + adSpend + shipping + otherFees + discounts + cogs` | unchanged |
| Net profit / Margin tiles | `netProfit`, `margin` | unchanged |
| Deltas | **new** `previousSummary` (same shape as `summary`, without the balance fields) when `compare=previous` | a second `buildDashboard` over the previous window (skips the cursor and disbursements) |
| Orders caption, pending banner | `totalOrderCount`, `orderCount`, `pendingSettlementCount`, `pendingCancellationCount` | unchanged |
| P&L statement | `summary.*` lines | unchanged |
| Cost coverage banner, Net profit caption, "Product cost (18 of 32)" | **new** `costCoverage: { products, productsWithCost, unitsWithoutCost }` | computed from `productMap` vs `costMap` |
| COGS FX note | **new** `cogsExcluded: { currency, products }[]` | convert `ProductCost.costAmount` and `shippingCost` from `costCurrency` to `summary.currency` via `lib/fx.ts` `convertToBase` (CRITIQUE C5); skip and count when there is no rate (B11) |
| Profit trend chart | `timeSeries[]` | buckets gain `adSpend`, `otherFees`, `discounts`; `netProfit` = the same formula as the summary (B10); tz-aware `formatPeriod`; zero-filled; ascending |
| Profit by product table | `productBreakdown[]` | add `sku` to each row (from the cost map key / tx barcode) so rows without a barcode can still save by SKU |
| Payouts tiles | `banked`, `disbursementCount`, `currentBalance`, `heldFunds` | unchanged |
| Payouts chart and table | `disbursements[]` | unchanged (dates become tz-aware) |
| Transactions "Type" filter options | `transactionTypeSummary[]` | each item gains `category` (from `classifyTransactionType`, moved to `lib/finance/classifyTransaction.ts`) |

`GET /api/finance/settlements` (transactions list): rows gain `category`; the existing `transactionType` filter is kept, and the new `category` filter matches every raw type of that category. **New** `format=csv` streams every row in range (max 50,000), with columns `date,category,type,product,order,barcode,quantity,amount,commission,currency`.

`POST /api/finance/settlements {action:'sync'}`: unchanged. `POST/PUT/GET /api/finance/product-costs`: unchanged, except that bulk create honors `costCurrency` per item (it already accepts the field; the client stopped sending a hard-coded `TRY`).

### 6.3 Client data layer (replaces `useFinanceStore` for the new UI)
- `lib/reports/useSalesReport.ts`: SWR key `['/api/analytics', from, to, tz, stores, currency, granularity]`, `keepPreviousData`.
- `lib/reports/useFinanceReport.ts`: SWR on `/api/finance/dashboard` with `compare=previous`, plus `useFinanceSync(mp)` (POST, then `mutate`).
- `lib/reports/useTransactions.ts`: SWR on settlements GET (page, size, category), with errors surfaced.
- `lib/reports/productCosts.ts`: `upsertCost`, `createCost`, `bulkCreateCosts`, `listCosts`, `listSoldProducts` (fetch wrappers lifted from the store, same payloads).
- `lib/reports/dateRange.ts`: presets, `toLocalDateStr(date, tz)`, `previousWindow`, `autoGranularity`.

---

## 7. i18n (namespace `reports`; both files; sentence case; glossary wording; real Turkish characters)

Marketplace names come from `lib/ds/marketplaces.ts` and are not translated. Turkish suffixes after a marketplace name use an ICU `select` on the marketplace key (`mp`), shown here as `{mp:abl}`:
```
{mp, select, etsy {Etsy'den} ebay {eBay'den} amazon {Amazon'dan} trendyol {Trendyol'dan} other {{name} kaynağından}}
```
The same applies to genitive `{mp:gen}`: `Etsy'nin · eBay'in · Amazon'un · Trendyol'un`.

| Key | EN | TR |
|---|---|---|
| `page.title` | Reports | Raporlar |
| `tabs.sales` | Sales | Satışlar |
| `tabs.profit` | Profit | Kâr |
| `tabs.payouts` | Payouts | Ödemeler |
| `tabs.transactions` | Transactions | İşlemler |
| `meta.ordersAsOf` | Orders as of {time} | Siparişler {time} itibarıyla |
| `meta.updating` | Updating… | Güncelleniyor… |
| `meta.refreshedFrom` | Refreshed from {name} {ago} | {mp:abl} {ago} yenilendi |
| `meta.refreshFrom` | Refresh from {name} | {mp:abl} yenile |
| `meta.refreshingFrom` | Refreshing from {name}… | {mp:abl} yenileniyor… |
| `meta.ledgerSource` | {name} payments ledger | {name} ödeme kayıtları |
| `meta.amountsIn` | Amounts in {symbol} | Tutarlar {symbol} cinsinden |
| `meta.fxNote` | ≈ converted at {source} rates, {date} | ≈ {source} kurlarıyla çevrildi, {date} |
| `actions.exportCsv` | Export CSV | CSV indir |
| `actions.exporting` | Exporting… | İndiriliyor… |
| `actions.nothingToExport` | Nothing to export for this period | Bu dönem için indirilecek veri yok |
| `actions.exportFailed` | Couldn't export. Try again. | İndirilemedi. Tekrar deneyin. |
| `actions.exportCap` | Export the first {count} transactions? | İlk {count} işlem indirilsin mi? |
| `actions.addCosts` | Add product costs | Ürün maliyeti ekle |
| `actions.manageCosts` | Manage product costs | Ürün maliyetlerini yönet |
| `actions.openOrders` | Open Orders for this period | Bu dönemin siparişlerini aç |
| `actions.openTransactions` | Open Transactions | İşlemleri aç |
| `actions.showAsTable` | Show as table | Tablo olarak göster |
| `actions.showLast90` | Show last 90 days | Son 90 günü göster |
| `actions.clearFilters` | Clear filters | Filtreleri temizle |
| `actions.clearSearch` | Clear search | Aramayı temizle |
| `toolbar.store` | Store | Mağaza |
| `toolbar.all` | All | Tümü |
| `toolbar.showIn` | Show in | Para birimi |
| `toolbar.type` | Type | Tür |
| `granularity.hour` | Hourly | Saatlik |
| `granularity.day` | Daily | Günlük |
| `granularity.week` | Weekly | Haftalık |
| `granularity.month` | Monthly | Aylık |
| `delta.vsRange` | vs {range} | {range} dönemine göre |
| `delta.noBaseline` | No data in the previous period | Önceki dönemde veri yok |
| `delta.points` | {value} pts | {value} puan |
| `chart.thisPeriod` | This period | Bu dönem |
| `chart.previousPeriod` | Previous period ({range}) | Önceki dönem ({range}) |
| `chart.previousDay` | Previous day | Önceki gün |
| `sales.kpi.revenue` | Revenue | Ciro |
| `sales.kpi.orders` | Orders | Siparişler |
| `sales.kpi.aov` | Average order | Ortalama sipariş |
| `sales.kpi.units` | Units sold | Satılan adet |
| `sales.kpi.source` | Orders · {count, plural, one {# store} other {# stores}} | Siparişler · {count} mağaza |
| `sales.kpi.excludes` | Excludes {count, plural, one {# order} other {# orders}} | {count} sipariş hariç |
| `sales.chart.revenueTitle` | Revenue over time | Zaman içinde ciro |
| `sales.chart.ordersTitle` | Orders over time | Zaman içinde siparişler |
| `sales.chart.hourlyTitle` | Orders by hour | Saate göre siparişler |
| `sales.chart.metricRevenue` | Revenue | Ciro |
| `sales.chart.metricOrders` | Orders | Siparişler |
| `sales.stores.title` | Sales by store | Mağazaya göre satışlar |
| `sales.stores.store` | Store | Mağaza |
| `sales.stores.orders` | Orders | Sipariş |
| `sales.stores.units` | Units | Adet |
| `sales.stores.revenueOriginal` | Revenue (original) | Ciro (orijinal) |
| `sales.stores.revenueConverted` | Revenue ({symbol}) | Ciro ({symbol}) |
| `sales.stores.share` | Share | Pay |
| `sales.stores.aov` | Avg order | Ort. sipariş |
| `sales.stores.manual` | Manual orders | Manuel siparişler |
| `sales.products.title` | Top products | En çok satan ürünler |
| `sales.products.search` | Search product or SKU | Ürün veya SKU ara |
| `sales.products.units` | Units | Adet |
| `sales.products.revenue` | Revenue | Ciro |
| `sales.status.title` | Orders by status | Duruma göre siparişler |
| `fx.unconverted` | {count, plural, one {# order} other {# orders}} in {currencies} left out of totals: no exchange rate. | {currencies} cinsinden {count} sipariş toplamlara dahil edilmedi: döviz kuru yok. |
| `fx.stale` | Exchange rates couldn't be updated. Using rates from {date}. | Döviz kurları güncellenemedi. {date} tarihli kurlar kullanılıyor. |
| `fx.approx` | Converted from {currencies} at {source} rates ({date}) | {currencies} tutarları {source} kurlarıyla çevrildi ({date}) |
| `profit.kpi.netSales` | Net sales | Net satış |
| `profit.kpi.costs` | Fees and costs | Kesinti ve maliyetler |
| `profit.kpi.costsShare` | {value} of net sales | Net satışın {value} kadarı |
| `profit.kpi.netProfit` | Net profit | Net kâr |
| `profit.kpi.margin` | Margin | Kâr marjı |
| `profit.kpi.orders` | {count, plural, one {# order} other {# orders}} | {count} sipariş |
| `profit.kpi.costMissing` | Excludes product cost for {count, plural, one {# product} other {# products}} | {count} ürünün maliyeti hariç |
| `profit.statement.title` | Profit and loss | Kâr ve zarar |
| `profit.statement.share` | % of gross sales | Brüt satışa oranı |
| `profit.line.gross` | Gross sales | Brüt satış |
| `profit.line.refunds` | Refunds | İadeler |
| `profit.line.discounts` | Discounts | İndirimler |
| `profit.line.fees` | Marketplace fees | Pazaryeri kesintileri |
| `profit.line.ads` | Ads | Reklam |
| `profit.line.shipping` | Shipping | Kargo |
| `profit.line.otherFees` | Other fees | Diğer kesintiler |
| `profit.line.productCost` | Product cost | Ürün maliyeti |
| `profit.line.productCostCoverage` | Product cost ({with} of {total}) | Ürün maliyeti ({total} üründen {with}) |
| `profit.line.net` | Net profit | Net kâr |
| `profit.line.cogsExcluded` | {count} costs in {currency} left out: no exchange rate | {currency} cinsinden {count} maliyet dahil edilmedi: döviz kuru yok |
| `profit.chart.title` | Net sales and net profit | Net satış ve net kâr |
| `profit.chart.netSales` | Net sales | Net satış |
| `profit.chart.netProfit` | Net profit | Net kâr |
| `profit.banner.costMissing` | Product cost is missing for {count} of {total} products, so net profit is too high. | {total} ürünün {count} tanesinde maliyet eksik, bu yüzden net kâr olduğundan yüksek görünüyor. |
| `profit.banner.pending` | {count, plural, one {# order isn't} other {# orders aren't}} settled by {name} yet. They appear here once {name} books them, usually in 1–3 days. | {count} sipariş henüz {name} tarafından hesaba geçirilmedi. Kayda geçtiğinde, genellikle 1–3 gün içinde, burada görünür. |
| `profit.banner.cancelPending` | {count, plural, one {# cancellation has} other {# cancellations have}} no refund yet. | {count} iptalin iadesi henüz kayda geçmedi. |
| `profit.products.title` | Profit by product | Ürüne göre kâr |
| `profit.products.product` | Product | Ürün |
| `profit.products.sold` | Sold | Satılan |
| `profit.products.returned` | {count} returned | {count} iade |
| `profit.products.revenue` | Revenue | Ciro |
| `profit.products.fees` | Fees | Kesinti |
| `profit.products.shipping` | Shipping | Kargo |
| `profit.products.unitCost` | Unit cost | Birim maliyet |
| `profit.products.profit` | Profit | Kâr |
| `profit.products.margin` | Margin | Marj |
| `profit.products.addCost` | Add cost | Maliyet ekle |
| `profit.products.noCode` | This product has no barcode or SKU, so a cost can't be saved. | Bu ürünün barkodu veya SKU'su yok, maliyet kaydedilemez. |
| `profit.products.costSaved` | Cost saved | Maliyet kaydedildi |
| `profit.products.costSaveFailed` | Couldn't save cost | Maliyet kaydedilemedi |
| `profit.notSupported` | Profit reports are available for Etsy, eBay, Amazon and Trendyol. | Kâr raporları Etsy, eBay, Amazon ve Trendyol için kullanılabilir. |
| `profit.connect` | Connect {name} to see your profit | Kârınızı görmek için {name} hesabınızı bağlayın |
| `profit.never.title` | Get your {name} payments | {name} ödemelerinizi alın |
| `profit.never.body` | We read fees, refunds and payouts from {name}. Nothing is changed on {name}. | Kesintileri, iadeleri ve ödemeleri {name} hesabınızdan okuruz. {name} tarafında hiçbir şey değişmez. |
| `profit.empty` | No payments in this period | Bu dönemde ödeme kaydı yok |
| `costs.title` | Product costs | Ürün maliyetleri |
| `costs.subtitle` | {name} · used to work out net profit | {name} · net kârı hesaplamak için kullanılır |
| `costs.mode.one` | One product | Tek ürün |
| `costs.mode.list` | Paste a list | Liste yapıştır |
| `costs.field.product` | Product | Ürün |
| `costs.field.productHelp` | Pick a product you sold, or type a name | Sattığınız bir ürünü seçin veya ad yazın |
| `costs.field.code` | Barcode or SKU | Barkod veya SKU |
| `costs.field.unitCost` | Unit cost | Birim maliyet |
| `costs.field.currency` | Currency | Para birimi |
| `costs.field.shipping` | Shipping per item | Ürün başına kargo |
| `costs.field.note` | Note | Not |
| `costs.field.list` | Costs | Maliyetler |
| `costs.listHelp` | One product per line: barcode or SKU, name, unit cost, shipping (optional). Paste from Excel or Google Sheets. | Her satıra bir ürün: barkod veya SKU, ad, birim maliyet, kargo (isteğe bağlı). Excel veya Google E-Tablolar'dan yapıştırabilirsiniz. |
| `costs.listPreview` | {valid} rows ready · {invalid} rows skipped | {valid} satır hazır · {invalid} satır atlandı |
| `costs.listRowInvalid` | Row {row}: {reason} | {row}. satır: {reason} |
| `costs.reason.noCode` | no barcode or SKU | barkod veya SKU yok |
| `costs.reason.badCost` | unit cost isn't a number | birim maliyet sayı değil |
| `costs.add` | Add cost | Maliyet ekle |
| `costs.import` | Import {count} costs | {count} maliyeti içe aktar |
| `costs.saved` | Saved costs | Kayıtlı maliyetler |
| `costs.none` | No costs saved yet | Henüz kayıtlı maliyet yok |
| `costs.added` | Cost added | Maliyet eklendi |
| `costs.imported` | {count} costs imported | {count} maliyet içe aktarıldı |
| `costs.failed` | Couldn't save costs | Maliyetler kaydedilemedi |
| `costs.soldLoadFailed` | Couldn't load sold products | Satılan ürünler yüklenemedi |
| `payouts.kpi.paid` | Paid to bank | Bankaya ödenen |
| `payouts.kpi.count` | {count, plural, one {# payout} other {# payouts}} | {count} ödeme |
| `payouts.kpi.balance` | Balance on {name} | {name} bakiyesi |
| `payouts.kpi.balanceHint` | Not paid out yet | Henüz ödenmedi |
| `payouts.kpi.held` | Held by {name} | {name} tarafından tutulan |
| `payouts.kpi.heldHint` | Not available yet | Henüz kullanılamaz |
| `payouts.kpi.noBalance` | {name} hasn't reported a balance yet | {name} henüz bakiye bildirmedi |
| `payouts.chart.title` | Payouts over time | Zaman içinde ödemeler |
| `payouts.table.title` | Payouts | Ödemeler |
| `payouts.table.date` | Date | Tarih |
| `payouts.table.amount` | Amount | Tutar |
| `payouts.empty` | No payouts in this period | Bu dönemde ödeme yok |
| `tx.count` | {count, plural, one {# transaction} other {# transactions}} | {count} işlem |
| `tx.date` | Date | Tarih |
| `tx.type` | Type | Tür |
| `tx.product` | Product | Ürün |
| `tx.order` | Order | Sipariş |
| `tx.amount` | Amount | Tutar |
| `tx.fee` | Fee | Kesinti |
| `tx.rawType` | {name}: {raw} | {name}: {raw} |
| `tx.cat.revenue` | Sale | Satış |
| `tx.cat.commission` | Fee | Kesinti |
| `tx.cat.commission_invoice` | Commission invoice | Komisyon faturası |
| `tx.cat.fees` | Other fee | Diğer kesinti |
| `tx.cat.adspend` | Ads | Reklam |
| `tx.cat.shipping` | Shipping | Kargo |
| `tx.cat.return` | Refund | İade |
| `tx.cat.discount` | Discount | İndirim |
| `tx.cat.disbursement` | Payout | Ödeme |
| `tx.cat.passthrough` | Sales tax | Satış vergisi |
| `tx.cat.other` | Other | Diğer |
| `tx.empty` | No transactions in this period | Bu dönemde işlem yok |
| `empty.connect.title` | Connect a store to see your sales | Satışlarınızı görmek için bir mağaza bağlayın |
| `empty.connect.body` | Orders from every store you connect show up here together. | Bağladığınız tüm mağazaların siparişleri burada bir arada görünür. |
| `empty.connect.action` | Connect a store | Mağaza bağla |
| `empty.noOrders.title` | No orders in this period | Bu dönemde sipariş yok |
| `empty.noOrders.body` | Try a longer date range. | Daha uzun bir tarih aralığı deneyin. |
| `empty.noMatch` | No stores match this filter | Bu filtreye uyan mağaza yok |
| `empty.noProducts` | No products sold in this period | Bu dönemde ürün satılmadı |
| `empty.noProductMatch` | No products match "{q}" | "{q}" ile eşleşen ürün yok |
| `error.sales` | Couldn't load your sales | Satışlarınız yüklenemedi |
| `error.profit` | Couldn't load {name} payments | {name} ödemeleri yüklenemedi |
| `error.refresh` | Couldn't refresh from {name} | {mp:abl} yenilenemedi |
| `error.transactions` | Couldn't load transactions | İşlemler yüklenemedi |
| `toast.newTransactions` | {count} new transactions from {name} | {mp:abl} {count} yeni işlem |

Moved verbatim (re-keyed, no wording change, because the meaning is accurate today): `financials.bankedReserveNote` → `reports.payouts.balanceNote.etsy`, `financials.bankedBalanceApproxNote` → `reports.payouts.balanceNote.amazon`, `financials.bankedPendingNote` → `reports.payouts.balanceNote.trendyol`.
Generic states ("Still loading…", "Try again", "Copy error ID", "Retry") come from the DS `ds.*` namespace, not `reports`.
`analytics.*` (60 keys) and `financials.*` (118 keys) are deleted with the legacy files (§8), after `grep -rn "useTranslations('analytics')\|useTranslations('financials')"` shows only legacy files (verified today: only `pages/app/analytics.tsx`, `pages/app/financials.tsx`, `components/finance/*`). `nav.financials` is deleted with A1, and `nav.reports` stays.

---

## 8. What to delete

After the `reports` flag has been on by default for one release (DS §7.1 rule 5):
- `pages/app/analytics.tsx`. **Deleted outright:**
  - the local `Card`, `EmptyState` and `KPICard` components;
  - the `Skeleton`;
  - `MARKETPLACE_COLORS`, `PALETTE`, `CURRENCY_SYMBOLS`, `fmtNative`;
  - the dual-axis Apex configs;
  - the native `<select>` range picker;
  - the inline FX rate strip;
  - the Monthly trends, Recent activity and status rainbow bars.
  
  The route file becomes a `next.config` redirect.
- `pages/app/financials.tsx` (gradient header, MUI `Tabs`, `Chip` presets, `type="date"` inputs + Apply, green gradient Sync button). The route becomes a redirect.
- `components/finance/FinancialDashboard.tsx` (10 rainbow tiles, stacked bar, cost donut, `formatCurrency` with "K").
- `components/finance/BankedPanel.tsx` (gradient tiles; replaced by Payouts KpiTiles).
- `components/finance/ProductPnLTable.tsx` (margin chips, `secondary.main` purple cost text, Turkish CSV name).
- `components/finance/TransactionLog.tsx` (`TYPE_COLORS` rainbow, `tr-TR` dates).
- `components/finance/CostEntryDrawer.tsx` (MUI Drawer + Tabs, floating labels, hard-coded `TRY` bulk currency).
- `components/finance/currency.ts`.
- `lib/stores/useFinanceStore.ts` (its only consumers are the files above).
- API cleanup in the same PR:
  - delete `marketplaceColorPalette`, `marketplaceColors`, `statusColors` and `prettyStatus`;
  - delete the legacy fields `dateRange|month|day`, `topMarketplaces`, `monthlyStats`, `recentActivity`, `shippingStats`, `totalCustomers`, `hourlyBreakdown` from `api/analytics/index.ts`;
  - delete the hard-coded Etsy shop-name list in `api/finance/dashboard.ts:195-200`.
- `pages/api/analytics/marketplace.ts`: **no UI consumer** (grep finds only comments). Delete it after checking the `x-api-key` (CLAWD) callers in the production logs (`SyncLog`) for the last 30 days.
- i18n: `analytics.*`, `financials.*`, `nav.financials`.
- Nav: the `finance` group in `AppLayout.js:161-167` (already replaced by `navConfig` in M2; A1 removes the "Financials" row there).

---

## 9. Deferred (not v1, stated so nobody builds them by accident)
- A combined multi-marketplace profit view converted to one currency (needs per-row FX at transaction date, not today's rate).
- Ad performance (Etsy has no ads API beyond ledger `prolist`; see memory `reference_etsy_ads_api_limitation`).
- "Same period last year" comparison.
- Profit per order (needs order↔transaction matching for every marketplace).
- Scheduled email reports.

---

## 10. Implementation split (disjoint file groups for parallel agents)

Prerequisites: DS **M1** components (KpiTile, Chart, DataTable, Toolbar family, DateRangeField, SidePanel, Banner, states, `lib/format.ts`, `useUrlState`, `lib/ds/status/orders.ts`) and **M2** shell. The A2–A4 amendments are built inside `components/ds/*` by **Group 0** (below) because DS files belong to the DS track.

Rules for every group:
- **Do not edit `messages/en.json` / `messages/tr.json`.** Return the keys you use as a JSON fragment (EN + TR) from §7. The integrator (Group F) merges them.
- Code against the API shapes in §6 exactly. Groups C–E mock them with fixtures in `__tests__/fixtures/reports/*.json`. Each group owns its own fixture file, named below.
- Run `npx next build --webpack` and `npm run test` before finishing.

| Group | Owns (create / edit / delete) | Depends on |
|---|---|---|
| **0: DS amendments** | `components/ds/data/KpiTile.tsx` (+`caption`), `components/ds/data/Chart.tsx` (+series `role`, comparison style, `⋯ Show as table` hook), `components/ds/data/DataTable.tsx` (+`type: 'share'`), their tests; DS doc patch text returned to the integrator | M1 |
| **A: Sales API** | `pages/api/analytics/index.ts` (new params and shape per §6.1, keeping legacy fields until §8), **new** `lib/marketplaces/canonical.ts` + `__tests__/lib/canonical.test.ts`, `__tests__/api/analytics.test.ts` (zero-fill, ascending, tz bucketing, null delta, units, top products by sku) | — |
| **B: Finance API** | `pages/api/finance/dashboard.ts` (§6.2: `currency`, `lastSyncedAt`, `previousSummary`, `costCoverage`, `cogsExcluded`, buckets, tz, `category`), `pages/api/finance/settlements.ts` (GET `category` field/filter + `format=csv`, nothing else), **new** `lib/finance/classifyTransaction.ts` (moved out of `dashboard.ts`), `pages/api/finance/product-costs.ts` (only if bulk ignores `costCurrency`; verify first), `__tests__/api/financeDashboard.test.ts` | imports `canonicalStore` from A by its fixed signature (replace the shop-name list). If A hasn't landed, keep the existing matcher and leave a `TODO(A)`. |
| **C: Shell + Sales UI** | **new** `pages/app/reports/index.tsx`, `components/domain/reports/ReportsPage.tsx` (Page, PageHeader, Tabs, Toolbar, URL state, meta, primary per tab via props), `components/domain/reports/sales/{SalesReport,SalesKpis,SalesTrendChart,StoreTable,TopProductsTable,StatusSummary}.tsx`, `lib/reports/{dateRange,useSalesReport,exportCsv}.ts`, `__tests__/fixtures/reports/sales.json`, tests for `dateRange` (TR timezone edges, previous window, granularity) and `exportCsv` | 0; A shape |
| **D: Profit UI** | **new** `pages/app/reports/profit.tsx`, `components/domain/reports/profit/{ProfitReport,ProfitKpis,ProfitStatement,ProfitTrendChart,ProductPnLTable,ProductCostsPanel}.tsx`, `lib/reports/{useFinanceReport,productCosts}.ts`, `__tests__/fixtures/reports/finance-dashboard.json` | 0; B shape; `ReportsPage` props from C (signature: `{ tab; title?; primary?: ActionSpec; secondary?: ActionSpec[]; overflow?: ActionSpec[]; meta: ReactNode; toolbarExtra?: FilterDef[]; children }`) |
| **E: Payouts + Transactions UI** | **new** `pages/app/reports/payouts.tsx`, `pages/app/reports/transactions.tsx`, `components/domain/reports/payouts/PayoutsReport.tsx`, `components/domain/reports/transactions/TransactionsReport.tsx`, `lib/reports/useTransactions.ts`, `__tests__/fixtures/reports/transactions.json` | 0; B shape; `ReportsPage` from C; `useFinanceReport` from D (signature: `useFinanceReport({ mp, from, to, tz }) → { data, state, error, mutate }`) |
| **F: Integration** | `lib/ds/uiFlags.ts` (add `reports`), `pages/app/analytics.tsx` + `pages/app/financials.tsx` (flag ⇒ `router.replace`; else render legacy, renamed to `components/legacy/reports/{LegacyAnalyticsPage,LegacyFinancialsPage}.tsx`, a pure move), `lib/nav/navConfig.ts` (A1: one "Reports" item; ⌘K tab commands), `messages/en.json` + `messages/tr.json` (merge fragments), `design/migrated-paths.json` (add `pages/app/reports/**`, `components/domain/reports/**`, `lib/reports/**`), DS doc patch (A1–A4, chart slot-6 note, the "exchangerate-api.com, not TCMB" note in §3.12). After one release: §8 deletions + `next.config` redirects. | all |

Order: 0, A and B run in parallel → C → D and E in parallel → F. C publishes the `ReportsPage` props on day 1 (above), so D and E can start against a stub.

---

## 11. Definition of done (surface-specific checks on top of DS §8)
- 4 tabs × (1440, 1024, 390) × (EN, TR) screenshots, with real data from the founder account on the flag.
- Revenue in the Sales tile for "Last 30 days, Trendyol only" equals the sum of the Orders page for the same filter (the same `where`; B3).
- The Etsy Profit tab for last month: Net profit tile = the P&L "Net profit" line = the sum of the chart buckets' `netProfit` (B10).
- An Istanbul order at 00:30 on 1 Oct appears in the 1 Oct bucket and in "This month" (B2/B13).
- The trend chart's x-axis runs oldest → newest, with zero days visible (B1).
- No `₺1.1K`, no "TRY 1,070…", no `$` on a TR-locale table without locale grouping, no "Satış" in the EN Transactions table.
- No donut, no dual axis, no colored tile, no gradient, no `uppercase` header (`analytics.tsx:680-685` had `uppercase tracking-wider`).
- Product cost entered as ₺ on the Etsy ($) dashboard changes the net profit by the converted amount, or shows the "left out: no exchange rate" note (B11).

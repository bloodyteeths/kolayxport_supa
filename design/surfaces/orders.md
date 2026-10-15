# Surface spec: Orders (`/app/labels`) + Create label + Manual order

Status: design only, binding for M3. Date: 2026-10-15. No app code changed.
Contract: `design/DESIGN_SYSTEM.md` (DS) and `design/tokens.md`. This file uses **only** DS components (§4) and patterns (§3). The few places that need something the DS does not have are listed in §0.3, each with a reason. If they are rejected, the fallback is written next to each one.
Replaces: the list UI in `pages/app/labels.tsx` (3,488 lines), `components/labels/*`, `components/UPSLabelDrawer.tsx` (1,246), `components/MngLabelDrawer.tsx` (343), the FedEx drawer inside `labels.tsx` (L3149–3280), `components/ManualOrderButton.tsx` and `components/ManualOrderForm.tsx` (734).

---

## 0. What exists today (checked in `kx-ux-phase0` @ `92087ba`)

### 0.1 Facts this spec relies on

| Fact (file:line) | Consequence |
|---|---|
| `useOrders(page, pageSize, filters, 'labelsPage')` → `GET /api/orders` with `search, searchType, startDate, endDate, marketplace[], status, labelFilter, labelStatus, sortBy, sort, page, limit` (`labels.tsx` L1724–1748, `api/orders/index.ts` L93–146) | The new page uses the same endpoint. New params are added; none are removed while the legacy page lives. |
| The API already flattens `recipientFirstName…recipientPhone`, `shipByDate`, `shippingUpgrade`, `isFBA`, `isMCF`, `shipments[]`, `trackingSubmissions[]`, `senkronData.internalNote`, `line_items[].labelJobs[]` (`index.ts` L780–905) | Most of the client-side `extractAddress` (L476–751) duplicates server work. v1 moves it to `lib/orders/toOrderRows.ts` without changing its behavior; moving it server-side is a later step (§9, A6). |
| `labelFilter=unlabeled` does **not** exclude closed or marketplace-shipped orders (comment at L1424–1428). Trendyol pre-assigns `cargoTrackingNumber` before the seller ships (L2723–2728) | This is the "Unlabeled shows shipped Amazon orders" bug. Saved views get server clauses built on normalized status (A1). |
| `/api/orders/index.ts` L778: `labelJobs` carries only `status, trackingNumber, carrier, pdfUrl`. There is no `createdAt` and no `errorMessage` | History and "Label failed: reason" need those two columns added to the item query (A2, one SQL line). |
| No carrier rate-quote code exists (`lib/fedex`, `lib/ups`, `lib/mng`: no rate calls) | The RateList ships in v1 **without prices** (DS §3.16 fallback). Live rates are API addition A7, which does not block M3. |
| Label create endpoints: FedEx = `POST /api/orders/update` → `PATCH /api/orders/:id/update-options` → `POST /api/orders/:id/generate-label` (L2224–2336). UPS = `POST /api/labels/ups` (`UPSLabelDrawer` L675). DHL eCommerce = `POST /api/labels/mng` (`MngLabelDrawer` L116) | One panel with three submit adapters (`lib/shipping/submit/{fedex,ups,dhl}.ts`). The payloads stay byte-compatible with today's. |
| FedEx uses `recipientFullName` (`lib/fedex/fedex.service.ts` L249). Server-required address fields: street1, city, postal, country (`generate-label.ts` L252) | A single "Recipient name" field is enough. The FedEx adapter splits it into first and last name only for `/api/orders/update`. |
| Tracking push: `POST /api/orders/:id/submit-tracking` routes Etsy (queued for the Chrome extension, `etsyPending: true`), eBay, Amazon, Wix, Trendyol and Veeqo (`submit-tracking.ts` L73–233) | The success state can send tracking right away and report it honestly ("Queued for the Chrome extension" for Etsy). |
| `ShipperProfile` holds sender name, phone, address, `defaultCurrencyCode` (default "USD"), `defaultWeightKg`, `defaultServiceType`, `defaultPackagingType` (schema) | The From section reads it through `GET /api/user/settings` (`shipperProfile`). Its "USD" default is the reason Add Manual Order defaulted to USD. |
| `User.shippingSettings Json` holds `etgbEnabled` and `etgbRecipientEmail`. PATCH `/api/user/settings` **replaces** `shippingSettings` as a whole (`settings.ts` L91–112) | Package presets live in `shippingSettings.packagePresets[]`, so no schema change is needed. The write must merge with the current object (A5). |
| `POST /api/orders/manual` returns a hard-coded Turkish duplicate error "Bu sipariş numarası zaten mevcut" (`manual.ts` L90) | Add `code: 'DUPLICATE_ORDER_NUMBER'` so the UI can show the i18n text (A8). |
| `DELETE /api/orders/:id/delete` deletes the KolayXport rows only. `DELETE /api/shipments/:id/delete` removes the Shipment row and does **not** void with the carrier | The confirm text says so explicitly. FedEx LabelJob labels have no delete route, so "Delete label…" is shown only when `latestLabel.shipmentId` exists. |
| `UPS_SERVICE_TYPES` (`constants/ups`) lists `'07'` and `'54'` twice under different names | The carrier catalog dedupes by code (G4). |
| Print pages exist: `/app/print/packing-slips?ids=`, `/app/print/pick-list?ids=` (max `PRINT_MAX_IDS`) | Bulk Print uses them unchanged. |
| Export: `POST /api/orders/export` (CSV/XLSX/PDF, ids or filters, max 1000) | Kept. The menu is rebuilt from DS parts. |
| Only callers of `useOrders`: `labels.tsx`, `LabelsBulkBar`, `ExportMenu` | The `'labelsPage'` transform branch in `useOrders` can be deleted with the legacy page. |

### 0.2 Today's toolbar: 13 controls (plus 2), and where each goes

| # | Control today | New home | Why |
|---|---|---|---|
| 1 | Sync (blue contained) | `SyncMeta` in PageHeader meta: "Refreshed 2 min ago ⟳" | Pull is never a button (P1). |
| 2 | Add Manual Order (blue contained, 160px) | PageHeader primary **only** when nothing is labelable, otherwise in `⋯` and ⌘K | One primary rule (§1.4). |
| 3 | ETGB (0), disabled, purple | BulkActionBar `⋯` → "Send ETGB documents", only if `etgbEnabled` | A button that can do nothing is not rendered. |
| 4 | Unlabeled search-type select ("All") | FiltersSheet → "Search in" (default All fields) | Rarely used. Default search already covers every field. |
| 5 | Search | `SearchField` 280px, `/` | — |
| 6 | Order status (Turkish raw keys) | `FilterButton` "Status" over normalized keys | One vocabulary (§3.9). |
| 7 | Store (multi) | `FilterButton` "Store" with `LogoTile` + counts | Logos (finding 8). |
| 8–9 | Start date, End date (native) | One `DateRangeField` "Order date" | Finding 5. |
| 10 | Reset | `ActiveFilterChips` "Clear all" | DS §3.3. |
| 11 | Sort select | Column-header sort (desktop); "Sort" in FiltersSheet (mobile) | — |
| 12 | ALL / UNLABELED / RECEIVED / FAILED | `SavedViews`: To ship · Overdue · Label created · Shipped · Problems · All | "Received" meant "labeled", which was misleading. |
| 13 | Compact / Detailed chips | DataTable density (44/36). "Detailed" (all cards expanded) is removed; details live in `OrderPanel` | — |
| +1 | Count text, Refresh icon | `resultCount` (right); refresh merges into the `SyncMeta` ⟳ | One pull control. |
| +2 | Floating "Export" pill | PageHeader secondary "Export ▾" + bulk bar | No floating controls. |

Result: **one row** of 32px controls: Search · Store · Status · Order date · Filters · View · Density.

### 0.3 Additions to the system (justified)

| Addition | Where | Justification | If rejected |
|---|---|---|---|
| Icons `note → StickyNote` and `rush → Zap` in `lib/ds/icons.ts` | registry | The private-note indicator and the buyer's paid shipping upgrade both need a glyph. No registry icon means either | Plain text "Note" / "Express" |
| `CreateLabelPanel` gets `onCreated(result)` in addition to the DS signature | DS §4.7 | The list must refresh and the next order must be offered after success | Panel calls `mutate` from context |
| `BulkCreateLabelsPanel` (domain composition, SidePanel lg) | `components/domain/shipping` | DS §6.1 shows "Create 12 labels" but defines no flow. Built only from SidePanel, RateList, FormField, DataTable | Single-order panels only |
| "Mark shipped" is **dropped** from the DS §6.1 bulk bar | — | No API marks an order shipped without a tracking number. P1: never render a button that cannot work | — |
| The ETGB "Include" checkbox (DS §6.4) becomes "Send ETGB document after the label is created" | Customs section | ETGB is a per-order call to `/api/etgb/process` after the fact, not a label option | — |

---

## 1. Information architecture

### 1.1 Route, flag, page

- Route stays `/app/labels`. The page title is **"Orders"** (nav says Orders, so finding 1 is resolved). Browser title: "Orders · KolayXport".
- The flag `orders` (`lib/ds/uiFlags.ts`) gives `flag ? <OrdersPage/> : <LegacyLabelsPage/>`. `LegacyLabelsPage` is today's file moved verbatim to `components/legacy/LegacyLabelsPage.tsx`.
- `<Page width="list">` (max 1600). The PageHeader title row is 56px. The Toolbar is sticky under the TopBar.

```
OrdersPage
├─ PageHeader  title "Orders" [count pill = total in view]
│    meta: SyncMeta (pull) · stores summary
│    secondary: [Export ▾]   overflow ⋯: Add manual order · Print pick list (this page) · Shortcuts
│    primary: (rule §1.4)
├─ Toolbar  Search · Store · Status · Order date · Filters · View · Density · result count
│    ActiveFilterChips row (only when filters ≠ view defaults)
│    (selection) → BulkActionBar replaces the row in place
├─ Banner zone (0–1 banner: usage limit, label created on another device, stale data)
├─ DataTable<OrderRow>  (cards < 900px)
│    pagination footer 1–50 of 142 · Rows 50 ▾ · ‹ 1 2 3 ›
├─ OrderPanel (SidePanel md 560)          ← Enter / row click, URL ?open=<id>
├─ CreateLabelPanel (SidePanel lg 720)    ← "Create label", URL ?open=<id>&panel=label
├─ BulkCreateLabelsPanel (SidePanel lg)   ← "Create N labels", URL ?panel=bulk-label
├─ ManualOrderPanel (SidePanel md)        ← "Add manual order", URL ?panel=manual
├─ AddTrackingModal (Modal sm, 3 fields)
└─ ConfirmDialogs (delete order, delete label, discard)
```

Only one SidePanel is open at a time. "Create label" from inside the OrderPanel **replaces** it with the CreateLabelPanel, and "‹ Back to order" in its header returns. Nothing stacks.

### 1.2 URL state (`useUrlState`)

| Key | Values | Default | Notes |
|---|---|---|---|
| `view` | `to_ship · overdue · label_created · shipped · problems · all` or a saved-view id | `to_ship` | Built-in views §1.3 |
| `q` | string | — | Search ignores dates (current API behavior, kept) |
| `in` | `all · customer · order · tracking · product · sku · city · phone · note` | `all` | = today's `searchType` |
| `store` | repeated, DB `Order.marketplace` value | all | Options from `/api/orders/marketplace-options` |
| `status` | repeated normalized keys (§3.9 order domain) | view default | Server maps keys → raw values (A1) |
| `from`, `to`, `preset` | ISO day / `last7 · last30 · thisMonth · …` | per view (§1.3) | `DateRangeField` |
| `sort`, `dir` | `orderedAt · shipBy · total · customer`, `asc/desc` | per view | |
| `page`, `size` | int, `50 · 100 · 250` | 1, 50 | Server pagination. `size` capped at 250 by the API |
| `density` | `standard · compact` | standard | Also kept in localStorage (try/catch) |
| `open` | `Order.id` | — | Opens OrderPanel; works even if the order is not on the page (A3) |
| `panel` | `label · bulk-label · manual` | — | |

**Legacy params** (bookmarks, notification links) are rewritten once on load: `label=unlabeled→view=to_ship`, `label=labeled→view=label_created`, `label=failed→view=problems`, `label=all→view=all`, `mp→store`, `qt→in`, `status=onaylandi→status=to_ship`, `kargolandi→shipped`, `iptal→cancelled`, `Delivered→delivered`, `sort=newest|oldest|shipBy|priceHigh|priceLow|customer→sort+dir`. This lives in a pure function `migrateLegacyOrdersQuery()` with a unit test.

### 1.3 Saved views (built-in), defined on normalized keys

| View | Server clause (A1) | Default dates | Default sort | Count shown |
|---|---|---|---|---|
| **To ship** | open status (§3.1) AND no label AND NOT FBA/MCF | none (status bounds it) | `shipBy asc`, nulls last | yes |
| **Overdue** | To ship AND effective ship-by < now() | none | `shipBy asc` | yes (danger tone in nav counter) |
| **Label created** | has label (Trendyol: only with a KolayXport Shipment or LabelJob) AND not shipped/closed | none | `orderedAt desc` | yes |
| **Shipped** | shipped / partially shipped / delivered / completed | last 30 days | `orderedAt desc` | no |
| **Problems** | label failed OR latest tracking push failed OR (To ship AND address incomplete) | none | `shipBy asc` | yes |
| **All** | everything visible today (unpaid excluded as now) | last 30 days | `orderedAt desc` | no |

- Users can "Save view" (name + current query). Stored in `localStorage` per viewer (DS SavedViews; try/catch). Server-stored views are out of scope.
- Counts come from `GET /api/orders?…&include=counts` (A1): 4 `COUNT(*)` queries reusing the same clause builders, cached 30s per user.
- **Before** making "To ship" undated the default, G1 runs the 4 counts against the production DB (memory: verify real DB data). If To ship returns more than 500 rows for any real account (legacy statuses never closed), the view gets a 90-day `from` and the reason goes in the PR.

### 1.4 The one primary (P1)

| State | Page primary | Secondaries |
|---|---|---|
| No selection, the current page has N ≥ 1 labelable rows (to_ship/overdue, no label, not FBA, address complete) | **Create N labels** → BulkCreateLabelsPanel with those N | Export ▾ |
| No selection, N = 0 | **Add manual order** | Export ▾ |
| M rows selected | BulkActionBar primary **Create M labels** (only labelable ones count; the label reads "Create 3 labels" for 5 selected with 2 not labelable, tooltip explains). The header primary demotes to secondary | Bulk: Print ▾, Export ▾, ⋯ |
| Selected rows none labelable | Bulk primary **Print ▾** (SplitButton: Labels · Packing slips · Pick list) | Export ▾, ⋯ |

Mobile: the state-driven primary (Create N labels) goes in `StickyActionBar`. "Add manual order" goes in TopBar `⋯` (not `+ New`; it is a rare action).

---

## 2. Desktop wireframes (1440)

### 2.1 List, default view "To ship"

```
┌────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [K] Kolay  │ Orders                                         [⌘K Search or jump…]                    (bell) (TS)  │ TopBar 52
│            ├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Overview   │ Orders [12]                                                        [Export ▾]   ⋯   [Create 9 labels]│ 56
│ Orders  12 │ Refreshed 2 min ago ⟳ · [E][e][a][T] 4 stores                                                       │ caption
│ Messages 3 │                                                                                                     │ 16
│ Listings   │ [⌕ Search order #, buyer, SKU, tracking…  /] [Store: All ▾] [Status: All ▾] [Order date: Any ▾]    │
│  …         │ [Filters]                                         View: [To ship 12 ▾]  [≡ Density]     12 results  │ 32px row
│            │ ┌───┬──────┬───────────────────────────────────┬──────────────┬──────────┬───────────┬───────────────┬──────┐│
│            │ │ ☐ │      │ Order                             │ Store        │    Total │ Status    │ Ship by ↑     │      ││ 36 hdr
│            │ ├───┼──────┼───────────────────────────────────┼──────────────┼──────────┼───────────┼───────────────┼──────┤│
│            │ │ ☐ │[img] │ Personalized Baby Blanket ×2      │ [E] Belle    │  $169.99 │ ● Overdue │ Overdue 1 day │      ││ 44
│            │ │   │  48  │ #3891 · Sarah Miller · US  ✎      │              │          │           │ ⚡ Express     │[⌂] ⋯ ││
│            │ │ ☐ │[img] │ Wooden Keepsake Box               │ [T] Trendyol │ ₺1.109,30│ ● To ship │ Today 22:59   │[⌂] ⋯ ││
│            │ │   │      │ #TY-88213 · Ayşe K. · TR          │              │          │           │ (warning)     │      ││
│            │ │ ☐ │[img] │ Name Necklace (+2 items)          │ [a] Amazon   │   $42.00 │ ● To ship │ Thu, Oct 16   │[⌂] ⋯ ││
│            │ │   │      │ #114-…-0098 · Name hidden (?) · US│              │          │           │               │      ││
│            │ │ ☐ │[pkg] │ Baby Name Sign                    │ [e] eBay     │   €58.00 │ ● Problem │ Fri, Oct 17   │[Fix] ⋯│
│            │ │   │      │ #12-11834 · J. Weber · DE         │              │          │ (?) postal│               │      ││
│            │ └───┴──────┴───────────────────────────────────┴──────────────┴──────────┴───────────┴───────────────┴──────┘│
│            │ 1–12 of 12                                                                  Rows 50 ▾      ‹ 1 ›       │
└────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────┘
[⌂] = row inline IconButton "Create label" (Tag), shown on hover/focus. ✎ = note indicator (StickyNote, tooltip = note).
[pkg] = Thumb placeholder glyph (never "-"). ⚡ Express = shipping upgrade line under ShipBy (neutral-700 caption).
Overdue row: one pill only. "Awaiting Fulfillment" + "Received" are gone.
```

### 2.2 View "Label created" (inline action changes)

```
│ │ ☐ │[img] │ Baby Name Sign                    │ [e] eBay     │   €58.00 │ ● Label created │ —        │[⎙] ⋯ ││
│ │   │      │ #12-11834 · UPS 1Z999AA1012… ⧉    │              │          │  Tracking sent ✓│          │      ││
```
- The meta line shows `Carrier · tracking` as `CopyText mono truncate=14`.
- The second line of the Status cell is the tracking-push result as caption text: "Tracking sent ✓" / "Queued for extension" / "Couldn't send". A failed push moves the row to **Problems**.
- Inline action = **Print label** (`Printer`) when a label URL exists, otherwise Copy tracking.

### 2.3 Selection (BulkActionBar replaces the toolbar row)

```
│ Orders [12]                                                        [Create 9 labels]  [Export ▾]   ⋯          │ header primary demoted
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐│
│ │ ☑ 5 selected    [Create 4 labels]  [Print ▾]  [Export ▾]  ⋯                                  Clear  Esc   ││ 32px, same height
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘│
  Create 4 labels: tooltip "1 order can't get a label here: Fulfilled by Amazon."
  Print ▾ (SplitButton): Labels (opens each stored label URL, ≤ 20; more → toast "Print the first 20, then the rest")
                         · Packing slips (/app/print/packing-slips?ids=) · Pick list (/app/print/pick-list?ids=)
  Export ▾: CSV · Excel · PDF → "5 selected" and "All 12 matching filters" groups (POST /api/orders/export)
  ⋯: Copy addresses (TSV) · Send ETGB documents (?) [only if etgbEnabled] · ── · (nothing destructive in bulk v1)
```

### 2.4 OrderPanel (SidePanel md 560, list stays mounted)

```
┌──────────────────────────────────────────────────────────────────── 560 ┐
│ [E] Order #3891 ⧉                      ● Overdue        ‹ ›   ⋯    ✕   │ header 56
│ Belle Couture Gifts · Ordered Oct 13, 9:12 PM · Overdue 1 day           │ caption (ShipBy danger)
├─────────────────────────────────────────────────────────────────────────┤
│ Items (2)                                               Open on Etsy ↗ │
│ [img] Personalized Baby Blanket                         $69.99 × 2      │
│  48   Pink · SKU BB-PINK ⧉                                               │
│       Personalization: "LENA – 03.10.2026" ⧉                            │
│ [img] Gift wrap                                          $5.00 × 1      │
│                                              Items $144.98 · Total $169.99│
│ ─────────────────────────────────────────────────────────────────────── │
│ Gift message                                                            │
│ "Congratulations on your little girl!" ⧉                                │
│ ─────────────────────────────────────────────────────────────────────── │
│ Ship to                                          Copy ▾   Edit          │
│ Sarah Miller ⧉                                                          │
│ 12 Oak St, Apt 4 · Austin, TX 78701 · United States (US)                │
│ +1 555 0134 ⧉ · sarah@example.com ⧉                                     │
│ ⚡ Buyer paid for Express shipping                                       │
│ ─────────────────────────────────────────────────────────────────────── │
│ Label & tracking                                                        │
│ No label yet                                         [Add tracking number]│ ghost link-style button
│ ─────────────────────────────────────────────────────────────────────── │
│ Private note                                                Saved       │
│ [ Use the pink ribbon. Customer asked for gift box.        ]  (TextArea)│
│ Only you see this. Never sent to a marketplace.                         │
│ ─────────────────────────────────────────────────────────────────────── │
│ Costs                                                                   │
│ Carrier cost  [₺ 412,50 ] [TRY ▾]    From the carrier invoice.          │
│ ─────────────────────────────────────────────────────────────────────── │
│ History                                                                 │
│ ● Oct 13, 9:12 PM  Ordered on Etsy                                      │
│ ● Oct 13, 9:20 PM  Imported into KolayXport                             │
├─────────────────────────────────────────────────────────────────────────┤
│ ⋯ More                                  [Print packing slip] [Create label]│ footer 64
└─────────────────────────────────────────────────────────────────────────┘
⋯ (header and footer, same list): Open on Etsy ↗ · Copy address (international) · Copy address (Turkish format)
   · Print packing slip · Add tracking number… · Message buyer (Amazon only) · ── · Delete label… · Delete order…
Label created: the section shows [LogoTile UPS] UPS · 1Z999AA10123456784 ⧉ · Oct 14 · Tracking sent to Etsy ✓,
   footer primary becomes [Print label], secondary [Print packing slip].
FBA/MCF: section reads "Fulfilled by Amazon. No label needed."; footer primary [Print packing slip] is removed → no primary
   (allowed: a read-only view). Add tracking is hidden.
```

### 2.5 CreateLabelPanel (SidePanel lg 720), one structure for FedEx, UPS, DHL eCommerce

```
┌──────────────────────────────────────────────────────────────────────────────────────── 720 ┐
│ ‹ Order   Create label · Order #3891                         ● Overdue           ⋯    ✕     │ 56
│ Sarah Miller · Austin TX, US · 2 items · Overdue 1 day                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ (Banner danger, only if sender incomplete) Complete your sender profile to create labels.   │
│                                                                    [Open sender profile]     │
│ From                                                                              Change ↗   │
│ Belle Couture Gifts · Tamer S. · Atatürk Cad. 12, Nilüfer, Bursa 16110 TR · +90 532 … ⧉      │
│ ──────────────────────────────────────────────────────────────────────────────────────────── │
│ Ship to                                                                           Edit       │
│ Sarah Miller · +1 555 0134 · 12 Oak St, Apt 4, Austin TX 78701 · [US] United States          │
│   (Edit expands in place:)                                                                   │
│   Recipient name   [Sarah Miller                    ]                                        │
│   Phone            [🇺🇸 +1 ▾][555 0134             ]   (PhoneInput, prefilled from order)    │
│   Email (optional) [sarah@example.com               ]                                        │
│   Country          [🇺🇸 United States (US)       ▾]   (CountrySelect, never free text)       │
│   Address line 1   [12 Oak St                                         ]                      │
│   Address line 2 (optional) [Apt 4                                    ]                      │
│   City [Austin            ]  Postal code [78701   ]                                          │
│   State / province [TX ▾] (required for US/CA, select)                                       │
│   (TR only:) District [Nilüfer] Neighbourhood (optional) [Ertuğrul]                          │
│ ──────────────────────────────────────────────────────────────────────────────────────────── │
│ Package                                                                     Presets ▾        │
│ Weight [ 0,8 ][kg]    L [30] W [20] H [8] cm  (optional for paks and envelopes)              │
│ Packaging [Your packaging ▾]                                     ☐ Save as preset…           │
│ ──────────────────────────────────────────────────────────────────────────────────────────── │
│ Carrier & service                                                        (Refresh rates ⟳)   │
│ ◉ [FedEx] International Priority      1–3 days                                               │
│ ○ [FedEx] International Economy       2–5 days                                               │
│ ○ [UPS]   UPS Saver                    1–3 days                                               │
│ ○ [UPS]   UPS Expedited                2–5 days                                               │
│ ○ [DHL]   DHL eCommerce                Turkey domestic only (?)                  (disabled)   │
│ Price shows on the carrier invoice.  (v1, no rates API; with A7 the price column appears)    │
│ ──────────────────────────────────────────────────────────────────────────────────────────── │
│ Customs  (international only)                                               2 items ▾        │
│ Personalized Baby Blanket · HS (?) [6302.10] · Qty 2 · $139.98 · Origin [TR ▾]               │
│ Gift wrap                  · HS (?) [4823.90] · Qty 1 ·   $5.00 · Origin [TR ▾]              │
│ Duties & taxes paid by  (•) Recipient (DAP)  ( ) Me (DDP)                                    │
│ Reason for export [Sale ▾]    Currency [USD ▾]   IOSS (?) [            ] (EU only)           │
│ ☐ Send ETGB document after the label is created (?)          (only if ETGB is on in Settings)│
│ ──────────────────────────────────────────────────────────────────────────────────────────── │
│ Options                                                                                      │
│ ☑ Send tracking to Etsy after the label is created                                           │
│ Signature [None ▾]   Label format [PDF 4×6 ▾]                                                │
│ (UPS only)  Recipient VAT number (optional) [        ]                                        │
│ (DHL only)  Shipping paid by [Me ▾] · Delivery type [Standard ▾] · ☐ Cash on delivery [₺   ] │
│             ☑ SMS the recipient when shipped  ☑ SMS on delivery                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⋯ (Save details without creating)                                  [Cancel]  [Create label] │ footer 64
└──────────────────────────────────────────────────────────────────────────────────────────────┘
Footer shows "Total $38.40" left of Cancel only when a rate amount exists (A7). Never a made-up price.
Fields that the chosen carrier does not use are not rendered (e.g. District hides for FedEx/UPS; IOSS only for EU).
```

**Success state** (body replaced, same panel):
```
│ ✓ Label created · FedEx International Priority                                              │
│ ┌────────────────────────────┐   Tracking number                                             │
│ │  label preview (img/pdf)   │   794 6129 0012 ⧉                                             │
│ │  data:image → <img>        │   ✓ Tracking sent to Etsy  ·  or  "Queued for the Chrome       │
│ │  pdf → "Preview not        │     extension · Open Etsy to send it"  ·  or "Couldn't send    │
│ │  available"                │     tracking · Retry"                                          │
│ └────────────────────────────┘   ✓ ETGB document sent to gumruk@…  (if chosen)                │
│                                                                                              │
│ ⋯ (Download PDF)                                     [Next order ›]   [Print label]          │
```
`Print label` opens the stored URL inside the click (popup-safe, `openLabelUrl`). `Next order ›` opens the CreateLabelPanel for the next labelable row of the current list (`j`).

### 2.6 BulkCreateLabelsPanel (SidePanel lg)

```
┌──────────────────────────────────────────────────────────────────────────────── 720 ┐
│ Create 9 labels                                                          ⋯    ✕     │
│ Every order uses this carrier, service and package. Weight comes from each order.   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ From      Belle Couture Gifts · Bursa TR                               Change ↗     │
│ Carrier & service   (same RateList; DHL eCommerce enabled only if all 9 are TR)     │
│ Package   Preset [Small pak 0,5 kg ▾]                                               │
│ Options   ☑ Send tracking to each marketplace                                       │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│ Orders (DataTable compact, no pagination)                                           │
│ ● Ready     #3891  Sarah Miller · US          0,8 kg                                │
│ ● Ready     #TY-88213 Ayşe K. · TR            0,5 kg                                │
│ ● Problem   #12-11834 J. Weber · DE  postal code missing          [Fix]             │ Fix → single panel
│ …                                                                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ 8 ready · 1 needs details                                 [Cancel] [Create 8 labels]│
└─────────────────────────────────────────────────────────────────────────────────────┘
Running: primary → disabled "Creating 3 of 8…" (loading verb), secondary "Stop after current". Rows get
  Sent / Failed (reason, Retry). Sequential, concurrency 1 (carrier rate limits; usage limiter counts each).
Done: "7 labels created · 1 failed"  [Retry failed]  [Print 7 labels] (opens the first ≤ 20 URLs; then batches).
```

### 2.7 ManualOrderPanel (SidePanel md 560)

```
┌──────────────────────────────────────────────────── 560 ┐
│ Add manual order                                   ✕   │
├────────────────────────────────────────────────────────┤
│ Customer                                               │
│ Customer name   [                       ]              │
│ Email (optional)[                       ]              │
│ Phone (optional)[🇹🇷 +90 ▾][            ]              │
│ Order number    [IG-2026-031            ]              │
│ Your own reference, e.g. an Instagram order.           │
│ Currency        [₺ TRY ▾]   (default = account base)   │
│ ────────────────────────────────────────────────────── │
│ Delivery address                                       │
│ Country [🇹🇷 Türkiye (TR) ▾]                           │
│ Address line 1 [                              ]        │
│ Address line 2 (optional) [                   ]        │
│ City [        ]  Postal code [      ]                  │
│ State (US/CA select · else optional text)              │
│ ────────────────────────────────────────────────────── │
│ Items                                                  │
│ Product name [                          ]              │
│ SKU (optional) [        ]                              │
│ Price [₺   ] Quantity [1]   Weight [0,5][kg]          │
│ + Add item                                   Remove ✕  │
├────────────────────────────────────────────────────────┤
│ Total ₺1.250,00    Unsaved changes  [Cancel] [Create order]│
└────────────────────────────────────────────────────────┘
After success: toast "Order IG-2026-031 created", list revalidates, the panel becomes the OrderPanel of the new
order (primary [Create label]). Close while dirty → ConfirmDialog nested "Discard this order?" Keep editing / Discard.
```

### 2.8 AddTrackingModal (Modal sm, 3 fields; DS §3.6 allows ≤ 4)

```
┌ Add tracking number ───────────────────────────── 440 ┐
│ Order #3891 · [E] Belle Couture Gifts                 │
│ Tracking number [1Z999AA10123456784        ]          │
│ Carrier         [UPS ▾]   (prefilled from latest label)│
│ ☑ Notify the buyer                                    │
│                              [Cancel] [Send to Etsy]  │
└───────────────────────────────────────────────────────┘
Primary label uses the marketplace: "Send to Etsy" / "Etsy'ye gönder" (ICU select, §11 rule).
Body: POST /api/orders/:id/submit-tracking { trackingNumber, carrierId, notifyCustomer, updateRemoteOrder: true }.
```

---

## 3. Mobile wireframes (390)

### 3.1 List

```
┌──────────────────────────────────┐
│ Orders                    ⌕   ⋯  │ TopBar 48 (⋯: Add manual order, Export, Print pick list)
├──────────────────────────────────┤
│ Refreshed 2 min ago ⟳            │ caption
│ [To ship 12][Overdue 1][Label …]→│ SavedViews chips (h-scroll, deliberate)
│ [⌕ Search orders…     ][Filters 2]│ 44px
│ 12 results                Select │
│ ┌──────────────────────────────┐ │
│ │[img] Personalized Baby Bl… ⋯ │ │ media 64 · title · overflow
│ │ 64   #3891 · [E] Belle · US  │ │ subtitle
│ │      $169.99      ● Overdue  │ │ trailing · status
│ │      Overdue 1 day · ⚡ Express│ │ meta
│ │      [ Create label        ] │ │ action, 44px, secondary variant
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │[img] Wooden Keepsake Box   ⋯ │ │
│ │      #TY-88213 · [T] · TR    │ │
│ │      ₺1.109,30    ● To ship  │ │
│ │      Today 22:59             │ │
│ │      [ Create label        ] │ │
│ └──────────────────────────────┘ │
│ [ Load more ]                    │
├──────────────────────────────────┤
│ 9 orders ready for labels        │ StickyActionBar (state-driven)
│ [     Create 9 labels          ] │ 48
├──────────────────────────────────┤
│ Overview Orders Listings Msgs More│ tab bar 56 + safe area
└──────────────────────────────────┘
```
- The card action is the row's inline action (Create label / Print label / Fix address / none) as a `secondary` 44px button, so the StickyActionBar stays the only primary.
- "Select" turns on checkboxes. The StickyActionBar becomes `5 selected · [Print ▾] [Create 4 labels]` (50/50, 48px). `⋯` in the bar: Export, Copy addresses, ETGB.

### 3.2 Filters sheet (BottomSheet, fullHeight)

```
┌──────────────────────────────────┐
│            ───                   │ drag handle
│ Filters                       ✕  │
│ Store        [All stores      ▾] │ 44
│ Status       [All             ▾] │
│ Order date   [Any date        ▾] │ → presets sheet + 1 month
│ Search in    [All fields      ▾] │
│ Sort         [Ship by, soonest▾] │
├──────────────────────────────────┤
│ [ Clear ]      [ Show 12 results]│ 50/50 · 48
└──────────────────────────────────┘
```

### 3.3 OrderPanel as a sheet

```
┌──────────────────────────────────┐
│            ───                   │
│ ✕  Order #3891          ● Overdue│ sticky 56
│ [E] Belle · Overdue 1 day        │
├──────────────────────────────────┤
│ Items (2)                        │
│ [img] Personalized Baby Blanket  │
│       $69.99 × 2 · Pink          │
│       "LENA – 03.10.2026" ⧉      │
│ Ship to              Copy  Edit  │
│ Sarah Miller ⧉                   │
│ 12 Oak St… Austin TX 78701, US   │
│ +1 555 0134 (tap to call) ⧉      │
│ Private note                     │
│ [                              ] │ 16px text
│ Costs · History (collapsed? no:  │ sections never collapse; scroll)
├──────────────────────────────────┤
│ [ Packing slip ] [ Create label ]│ 50/50 · 48 sticky
└──────────────────────────────────┘
```

### 3.4 Create label as a sheet (drill-in rows → edit sheets)

```
┌──────────────────────────────────┐
│ ✕  Create label · #3891          │
├──────────────────────────────────┤
│ From    Belle Couture Gifts   ›  │ 48 rows → BottomSheet editors
│ To      Sarah Miller, US      ›  │ (a row in danger text if invalid:
│ Package 0,8 kg · 30×20×8      ›  │  "To · postal code missing ›")
│ Service                          │
│ ◉ [FedEx] Intl Priority  1–3 d   │ 48px radio rows
│ ○ [FedEx] Intl Economy   2–5 d   │
│ ○ [UPS]   UPS Saver      1–3 d   │
│ ○ [DHL]   DHL eCommerce  (TR) ⓘ  │ disabled + reason
│ Customs 2 items · $144.98     ›  │
│ Options  Tracking → Etsy      ›  │
├──────────────────────────────────┤
│ [ Cancel ]    [ Create label   ] │ 50/50 · 48
└──────────────────────────────────┘
```
Only one editor sheet opens over the panel sheet at a time (one layer; DS §3.6 forbids two). Editor sheets have their own 50/50 footer "Cancel / Done".

### 3.5 Manual order as a sheet
Same sections as §2.7, single column, full-height sheet, sticky footer `[Cancel] [Create order]`. Phone and country pickers open as sheets.

---

## 4. List: columns and rows

### 4.1 `orderColumns(t, fmt): Column<OrderRow>[]`

| key | header (i18n) | width | type / render | sortable | hideable | mobile |
|---|---|---|---|---|---|---|
| `select` | — | 40 | checkbox (DataTable) | — | no | hidden (Select mode) |
| `thumb` | — | 56 | `Thumb size=48 src=items[0].image preview` + badge "+N" when items > 1 | no | no | `media` (64) |
| `order` | Order | flex ≥ 280 | Line 1: first item title (2-line clamp) + " (+N items)". Line 2 mono caption: `#orderNumber · buyer · ISO country` + note indicator | no | no | `title` (line 1) / `subtitle` (line 2) |
| `store` | Store | 160 | `LogoTile 16` + store name (`Order.marketplace`); manual orders: text "Manual order" | yes (`store`) | yes | `subtitle` (logo only) |
| `total` | Total | 112, right | `Money amount=total currency` (never summed across rows) | yes (`total`) | yes | `trailing` |
| `status` | Status | 148 | `StatusPill domain status raw` + optional caption line (tracking push) | no | no | `status` |
| `shipBy` | Ship by | 156 | `ShipBy date shippedAt` + `⚡ {upgrade}` caption when `shippingUpgrade` | yes (`shipBy`) | yes | `meta` |
| `orderedAt` | Ordered | 120 | `DateText mode=date` | yes (`orderedAt`) | yes, **hidden by default** | hidden |
| `tracking` | Tracking | 180 | `LogoTile carrier 16` + `CopyText mono truncate=14` | no | yes, hidden by default | hidden |
| `carrierCost` | Carrier cost | 112, right | `Money` or `—` | no | yes, hidden by default | hidden |
| `actions` | — | 80 | inline action + `⋯` (hover/focus) | — | no | `action` |

`columnStateKey: 'orders.v1'`. The default sort follows the view (§1.3). Clicking a header sets `sort`/`dir` in the URL.

### 4.2 Status (one pill per row): `lib/ds/status/orders.ts`

`orderRowStatus(row): { domain: 'order'|'label'; key; raw; reason? }`. It is pure and tested with fixtures for each marketplace. **Priority, first match wins:**

1. raw `cancelled|canceled` → `cancelled` · `refunded` → `refunded`.
2. raw `delivered|completed` → `delivered`.
3. raw `shipped|partially_shipped|kargolandi` (Trendyol `Shipped`, Amazon `Shipped`, Etsy `is_shipped`) → `shipped`.
4. latest LabelJob `failed` or `Order.labelStatus='failed'` → `label.label_failed` (tooltip: `errorMessage`).
5. `isFBA` → the raw status is mapped through rules 1–3, and `to_ship` otherwise, with the tooltip "Fulfilled by Amazon". **Never `overdue`**, and never labelable.
6. has label (Shipment `created` with tracking or pdf, LabelJob `created`, `Order.trackingNumber` / `shippingLabelUrl` / `labelStatus='created'`; **Trendyol:** `rawData.cargoTrackingNumber` alone does not count) → `label_created`.
7. address incomplete (`shipTo.missing.length > 0`) → `problem` (tooltip "Address incomplete: postal code missing"; Etsy with no address → "Etsy doesn't share buyer addresses…").
8. raw `on_hold` → `on_hold`.
9. effective ship-by < now → `overdue`, else → `to_ship`.

The raw marketplace value is always in the tooltip ("Etsy: paid, unshipped"). The legacy `statusColors` hex map is deleted.

### 4.3 Row inline action and `⋯` (DS §3.4: at most 1 + ⋯)

| Row state | Inline action (IconButton desktop / button on mobile card) |
|---|---|
| to_ship / overdue, not FBA | **Create label** (`Tag`) → CreateLabelPanel |
| problem (address) | **Fix address** (`Pencil`) → CreateLabelPanel with Ship to in edit mode, first invalid field focused |
| label_created with URL | **Print label** (`Printer`) |
| label_created, tracking only | **Copy tracking number** |
| label_failed | **Create label** (retry) |
| shipped / delivered / cancelled / refunded / FBA | none |

`⋯` (OverflowMenu, danger last and separated): Open order · Create label / Print label · Add tracking number… · Copy address (international) · Copy address (Turkish format) · Open on {marketplace} ↗ · Print packing slip · Message buyer… (Amazon only: `MessageBuyerModal`, Modal sm, rebuilt here in G3 from `AmazonMessageDialog`: message type `Select` + optional text `TextArea`, primary "Send to Amazon". Messages M8 does **not** take it over, because Amazon has no readable inbox, messages.md §0; CRITIQUE U4) · ── · Delete label… (only with `shipmentId`) · Delete order….

---

## 5. OrderPanel sections → data

| Section | Element | Field (OrderRow) | Source today |
|---|---|---|---|
| Header | logo, `#number` (CopyText), pill, caption | `marketplace`, `orderNumber`, `status`, `storeName`, `orderedAt`, `shipBy` | `/api/orders` `marketplace`, `orderNumber`, `marketplaceOrderDate`, `shipByDate`/`items[].shipBy` |
| Items | thumb, title (link), variant, SKU (copy), qty × unit price, personalization | `items[]` `{title, listingUrl, variant, sku, quantity, unitPrice, image, personalization}` | `line_items[]` + `/api/listing-urls` + Trendyol `buildTrendyolProductUrl` (logic moved verbatim from `toLabelRows`) |
| Items footer | items subtotal · order total | sum(qty×unit) · `total` | `orderTotalPrice` |
| Gift message / Note from buyer | text + CopyText | `giftMessage`, `buyerNote` | `Order.giftMessage`, `Order.customerNote` or extension `_etsyCustomerNote` |
| Ship to | name, address, phone (`tel:`), email, upgrade line, Copy ▾ (intl / TR), Edit | `shipTo` | flattened `recipient*` + Etsy enrichment (`/api/etsy-addresses`) + Wix/Trendyol fallbacks; `formatAddressForCopy` (`lib/format/address`) |
| Ship to → Edit | inline form (same `ShipToForm` as CreateLabel), Save | `POST /api/orders/update { id, shippingAddress }` | exists (L2224). It saves to KolayXport only (marketplace not touched) |
| Label & tracking | carrier logo, tracking CopyText, created date, push result, [Add tracking number] | `label` (`getLatestLabel`), `trackingSubmission` | `shipments[]`, `labelJobs[]`, `trackingSubmissions[]` (`status`, `etsySubmitStatus`, `submittedAt`) |
| Private note | `TextArea` autosave 600ms, "Saved", 1000-char `CharCount` | `note` | `POST /api/orders/:id/updateNoteAndStatus { not }` (logic of `OrderNoteField` moved into `useOrderNote`) |
| Costs | Carrier cost `MoneyField` + `CurrencySelect` (default = account base currency) | `carrierCost` | `PATCH /api/orders/:id/shipping-cost { cost, currency }` |
| History | `Timeline` | `orderedAt`, `importedAt` (`Order.createdAt`), shipments/labelJobs `createdAt`, `trackingSubmissions[].submittedAt/etsySubmittedAt`, `shippedAt` | LabelJob `createdAt` needs A2 |

The Costs section has no Profit field in v1. Product cost per SKU exists (`ProductCost`), but marketplace fees per order do not. A "profit" without fees would be a dishonest number (P6). It ships with the Finance work (M9).

---

## 6. CreateLabelPanel: one model, three adapters

### 6.1 `LabelDraft` (`lib/shipping/labelDraft.ts`)

```ts
export type CarrierKey = 'fedex' | 'ups' | 'dhl';           // 'dhl' = DHL eCommerce (MNG API)
export interface LabelDraft {
  orderId: string; orderNumber: string; marketplace: string;
  shipTo: { name: string; phone: string; email: string; country: string /* ISO2 */; street1: string; street2: string;
            city: string; state: string; postal: string; district: string; neighbourhood: string };
  pkg: { weightKg: number; lengthCm?: number; widthCm?: number; heightCm?: number; packaging: string /* carrier code */ };
  carrier: CarrierKey; service: string;                       // FEDEX_SERVICE_TYPES / UPS code / DHL serviceType
  customs: { items: { itemId: string; description: string; hsCode: string; quantity: number; unitValue: number; origin: string }[];
             currency: string; terms: 'DAP' | 'DDP'; exportReason: 'SALE'|'GIFT'|'SAMPLE'|'RETURN'|'REPAIR';
             ioss: string; vat: string; invoiceNumber: string; sendEtgb: boolean };
  options: { sendTracking: boolean; signature: string; labelStock: string;
             dhl?: { paymentType: number; deliveryType: number; packagingType: number; cod: boolean; codAmount: number; smsShipped: boolean; smsDelivered: boolean; content: string } };
}
export function draftFromOrder(row: OrderRow, ctx: { sender: ShipperProfile; presets: PackagePreset[]; lastCarrier?: CarrierKey; baseCurrency: string }): LabelDraft;
```

Prefill rules (each one fixes a finding):
- `shipTo.phone` comes from the order (`recipientPhone`, Wix contact, Trendyol `shipmentAddress`). **FedEx today leaves it empty. This fixes it.** It never falls back to the seller's phone for the recipient (today's MNG drawer uses `shipperPhoneNumber` as the recipient phone; that is wrong and removed). DHL requires a phone, so an empty phone is a field error.
- `shipTo.country`: an ISO2 code via `resolveEtsyCountryCode`/name map. The `CountrySelect` shows flag + name.
- `pkg.weightKg` = Σ items `weightKg × qty`, else `ShipperProfile.defaultWeightKg`, else 0.5. The default preset wins if the user set one.
- `carrier`: TR → TR defaults to `dhl` when DHL is connected. Otherwise the last carrier used for international (localStorage, try/catch), otherwise the first connected of FedEx → UPS.
- `service`: `ShipperProfile.defaultServiceType` when it belongs to the chosen carrier, else the carrier default (FedEx `INTERNATIONAL_PRIORITY`, UPS `65` Saver, DHL `1`).
- `customs.items`: one line per order item (today's FedEx drawer sends one line built from the first item, and UPS a single product; both are wrong for multi-item orders). UPS `description` max 35 characters (counter shown).
- `customs.currency` = order currency. `terms` = `ShipperProfile.dutiesPaymentType` (`SENDER` → DDP, else DAP). `invoiceNumber` = `INV-{orderNumber}`.
- `options.sendTracking` = true (remembered per viewer). Hidden for manual orders.

### 6.2 Field matrix (what each carrier renders and sends)

| Draft field | FedEx (`update` + `update-options` + `generate-label`) | UPS (`/api/labels/ups`) | DHL eCommerce (`/api/labels/mng`) |
|---|---|---|---|
| shipTo.name | `recipientFirstName/LastName` (split at last space) → server joins | `recipient.name`, `soldTo.name/attention` | `recipient.name` |
| shipTo.phone | `recipientPhone` (optional) | `recipient.phone` (optional) | `recipient.phone` **required** |
| shipTo.country | `recipientCountry` | `recipient.countryCode`, `soldTo.countryCode` | must be `TR` (eligibility) |
| street1/street2 | `recipientStreet1/2` | `street1/2` | `address` = street1 + street2 |
| city / postal | required / required | required / required | required / optional |
| state | `recipientState` (US/CA required) | `stateCode` (US/CA required) | — |
| district / neighbourhood | — | — | `district` **required** / `neighbourhood` |
| pkg.weightKg, dims | `weightKg`, `packageLength/Width/Height`, `dimensionUnits:'CM'` | `package.weightKg/lengthCm/…` | `packageInfo.weight/width/height/length` |
| pkg.packaging | `fedexPackagingType` (`FEDEX_PACKAGING_TYPES`) | `packageType` (`UPS_PACKAGE_TYPES`) | `packagingType` |
| service | `fedexServiceType` | `serviceType` | `serviceType` |
| customs.items | `line_items[]` (all items) + `customsValue` (Σ) + `harmonizedCode`/`countryOfMfg` (first item) | `internationalForms.products[]` + `invoiceLineTotal` | — (domestic) |
| customs.terms | `termsOfSale` (DDP/DAP), `fedexDutiesPaymentType` | `dutyPaymentType` (SHIPPER/RECEIVER), `termsOfShipment` | — |
| exportReason, ioss, vat, invoiceNumber | — | `internationalForms.*` | — |
| options.signature | `signatureType` | `signatureOption` | — |
| options.labelStock | `labelStockType` | — | — |
| options.dhl.* | — | — | `paymentType, deliveryType, isCOD, codAmount, smsPreference2/3, content, description` |

Each adapter is a pure `buildRequest(draft) → { url, init }[]` plus `parseResult(res) → { trackingNumber, labelHref, barcode?, alerts? }`, unit-tested against JSON snapshots of today's request bodies (built from the legacy code paths) so nothing changes on the wire.

### 6.3 Eligibility and validation (`lib/shipping/carriers.ts`, `validate.ts`)

| Condition | RateList row |
|---|---|
| carrier not connected (`useConnections()` status) | disabled, reason "Connect UPS in Settings" + link `/ayarlar?tab=connections&provider=ups` |
| `incomplete_credentials` | disabled, reason "UPS setup is incomplete" + same link |
| DHL and recipient ≠ TR (or sender ≠ TR) | disabled, "Turkey domestic only (?)" |
| FedEx/UPS and recipient = TR and sender = TR | enabled, sorted after DHL |
| connection check failed | enabled, reason line "Couldn't check UPS" (P6: never claim "not connected") |

Validation runs on blur and on submit (DS §3.7). Create label stays enabled. On click with errors, a summary `Banner` "Fix 2 fields to continue" appears and focus moves to the first error (and its section expands, in Ship to edit mode). The sender profile being incomplete (missing name, phone, street1, city, postal, country) sets `primary.disabledReason` "Complete your sender profile first" and shows the danger Banner with [Open sender profile] (`/ayarlar?tab=senderProfile`, opens in the same tab after the dirty guard).

### 6.4 Existing label, errors, usage limit

- **Order already labeled:** the panel opens in the success state for the latest label (preview, tracking, push status, [Print label]). The `⋯` has "Delete label…" (Shipment only) and "Create another label…" (ConfirmDialog: "This order already has a label. Create a second one?"). This replaces today's disabled "deleteExistingLabel" button.
- **Carrier error:** inline `ErrorState variant="inline"` at the top of the body: the title "Couldn't create the label", the cause "FedEx said: Postal code is invalid for US" (carrier message text only, max 200 characters, never JSON), [Try again], [Copy error ID]. The fields stay filled, and the field named by a known carrier error code gets the field error.
- **Usage limit (402 from `fetchWithLimit`):** warning `Banner` "You've used all 10 labels in your plan this month" + [See plans]. The primary is disabled with that reason. No toast.
- **Partial success:** if a label is created but `sendTracking` fails, the success state shows "Couldn't send tracking · Retry". The row moves to Problems. The label is never re-created.
- **FedEx alerts** (`labelData.alerts`): shown as one warning `Banner` in the success state, with text only.

### 6.5 Package presets (A5)

`shippingSettings.packagePresets: { id; name; weightKg; lengthCm?; widthCm?; heightCm?; packaging?: Partial<Record<CarrierKey,string>>; isDefault?: boolean }[]`, max 20. "Presets ▾" lists them (`Select`); "Save as preset…" opens a `Modal` sm with 1 field (Name) plus a "Use by default" switch. The write goes through `PATCH /api/user/settings { shippingSettings: { ...current, packagePresets } }` (read-merge-write in `usePackagePresets`). Managing presets in Settings → Sender profile is a Settings follow-up (one `SettingsRow` list). It is not built in M3.

### 6.6 Live rates (A7, after M3a, non-blocking)

`POST /api/labels/rates { orderId, draft }` → `{ rates: { id, carrier, service, transitDays?, amount?, currency?, unavailableReason? }[], errors: { carrier, message }[] }`, made of FedEx Rate API and UPS Rating API calls server-side with stored credentials, a 10s timeout per carrier, and no DB writes. When it exists, RateList gets `amount`, "Recommended" (the cheapest service whose transit ≤ days until ship-by + 5; otherwise the cheapest), and the footer "Total". When it fails, the list stays usable without prices and shows the inline "Couldn't get rates · Retry" (DS §3.16).

---

## 7. States (every async region has exactly 4, plus the partial cases)

### 7.1 List

| State | Render |
|---|---|
| loading (first load) | `TableSkeleton rows=8 thumb` after 200ms (`CardListSkeleton` < 900px). PageHeader with title and a disabled-looking meta. |
| slow (15s) | "Still loading… [Retry]" in the table body (`useAsyncState`) |
| error (30s or HTTP error) with no data | `ErrorState variant="page"` "Couldn't load orders" · cause from status (network / 500 / 401 → redirect) · [Try again] · Copy error ID |
| error with data on screen | rows stay; `ErrorState variant="stale"` inline above the table: "Showing orders from 10:42 · Retry" |
| refetch (filter change) | SWR `keepPreviousData`. Rows stay, the result count reads "Updating…". No spinner, no bar. |
| empty, first use (zero orders all-time AND no connected store) | `EmptyState kind="first-use"` "Connect a store to see your orders" [Connect a store] (body also mentions "or add a manual order" as text; one action only) |
| empty, view done | To ship: `done` "Every order has a label". Overdue: "Nothing is overdue". Problems: "No problems to fix". Label created: `no-results` "No labels waiting to ship". |
| empty, filters/search | `no-results` "No orders match these filters" [Clear filters]. Search: "No orders match "{q}"" + caption "Search covers all dates". |
| pull running | `SyncMeta state=pulling` "Refreshing orders…" (⟳ spinning is the only motion). The list revalidates when the pull ends. |
| pull failed | `SyncMeta state=failed` "Couldn't refresh orders · Retry". The 402 limit shows the usage Banner instead. |

### 7.2 Partial data (row level)

| Case | Rule |
|---|---|
| No product image or `/placeholder.png` | `Thumb` placeholder glyph |
| Amazon anonymized buyer ("Amazon Customer", "Anonymized by Amazon") | buyer reads "Name hidden by Amazon (?)", the tooltip explains the SP-API role. Address fields from Amazon stay as they are. |
| Etsy order without address (API withholds PII) | `problem` pill + tooltip; `⋯` "Open on Etsy" first. The extension fills `EtsyAddress` and the next refresh clears the problem. |
| Partial address (missing postal etc.) | `problem` + inline action "Fix address" |
| Ship-by unknown | `ShipBy` renders `—` (never a guessed date; the old +3 days fallback stays removed) |
| Multi-currency page | totals per row only; nothing summed |
| Trendyol pre-assigned cargo number | not a label (§4.2 rule 6). Shown in the panel as "Trendyol cargo number" under Label & tracking |
| FBA / MCF | meta "Fulfilled by Amazon" / "Multi-Channel Fulfillment"; no label action; excluded from To ship |
| Manual order | store "Manual order"; no "Open on" and no tracking push option |
| Label job failed | `label_failed` pill, tooltip = `errorMessage` (A2) |

### 7.3 Panels

| Panel | loading | error | empty | special |
|---|---|---|---|---|
| OrderPanel (`?open=` not in list) | `PanelSkeleton` | inline `ErrorState` "Couldn't load this order" [Try again]; 404 → "This order no longer exists" + [Back to orders] | — | prev/next disabled at the page edges (no cross-page jump in v1) |
| CreateLabelPanel | `PanelSkeleton` while settings + connections load (`useSettings`, `useConnections`) | settings failed → inline ErrorState, primary disabled with reason | no carriers connected → `EmptyState first-use` "Connect a carrier to create labels" [Connect a carrier] | sender incomplete Banner; existing label → success state |
| BulkCreateLabelsPanel | same | per-row failures listed | 0 labelable → panel not openable (primary not rendered) | stop after current; leaving while running → ConfirmDialog "Stop creating labels?" |
| ManualOrderPanel | settings for currency | submit error inline Banner; duplicate number → field error on Order number (A8) | — | dirty guard |

---

## 8. Interactions and keyboard

| Input | Effect |
|---|---|
| `/` | focus search |
| `j` / `k`, `↑` / `↓` | move row focus; in an open panel, prev/next order (dirty guard) |
| `x` | toggle selection · `⌘A` select page · `Esc` clear selection / close panel |
| `Enter` | open OrderPanel |
| `l` | **not in v1** (DS defers it) |
| `⌘↵` | run the panel primary (Create label / Create order / Create N labels) |
| `⌘S` | in ManualOrderPanel: nothing (no drafts); in OrderPanel: save note now |
| `⌘K` | palette lists: Create N labels, Add manual order, Export, Print pick list, Refresh orders, each saved view ("Go to Overdue") (`usePageActions`) |
| row click | opens the OrderPanel (whole row is the target; checkbox, links and buttons stop propagation; text selection does not open, same rule as today's `shouldToggleFromClick`) |
| Thumb hover 400ms | 240px preview popover (replaces the image Dialog) |
| order number click | CopyText; the marketplace link is the "Open on {marketplace} ↗" action, not the number |
| Pull ⟳ | `POST /api/orders/sync { syncType: 'fast' }` → then `mutate()` list + counts |
| Create label success | list `mutate`, counts `mutate`, the row moves out of To ship on revalidate; focus goes to [Print label] |
| Delete order | ConfirmDialog danger, names the order, "Removed from KolayXport only. Nothing changes on Etsy." → `DELETE /api/orders/:id/delete` → toast "Order #3891 deleted" (no undo: the API has none) |
| Delete label | ConfirmDialog danger, "It is not voided with the carrier." → `DELETE /api/shipments/:id/delete` |
| Copy addresses (bulk) | TSV to clipboard (columns as today's `buildAddressesTsv`), toast "5 addresses copied" |
| ETGB (bulk) | `POST /api/etgb/process { orderIds, recipientEmail }`; missing email → toast error with action "Open settings" |
| Print labels (bulk) | opens stored URLs synchronously in the click, max 20 (popup-safe); `data:` URIs download via `openLabelUrl` |

Focus: opening a panel focuses its title (or the first invalid field in Fix address). Closing returns focus to the trigger row.

---

## 9. API additions (minimal; nothing removed)

| ID | Change | File | Size |
|---|---|---|---|
| **A1** | `GET /api/orders`: new `view` (`to_ship…all`), `status` accepts normalized keys (old values still work), `include=counts` → `counts: { to_ship, overdue, label_created, problems }`, `limit` capped at 250. Clause builders live in `lib/orders/views.ts` (server-only). **That file already exists from M2** (shell-nav §9.1 creates `TO_SHIP_SQL`, `UNLABELED_SQL`, `EFFECTIVE_SHIP_BY_SQL`, `OVERDUE_SQL` for the sidebar counter); A1 extends it rather than redefining them, and Overview M8 imports the same file (CRITIQUE C4), and the effective ship-by SQL mirrors `index.ts` L789–816 (`MIN(OrderItem.shipBy)`, then `rawData->>'due_date'`, `'ship_by_date'`, then the min of Etsy `transactions[].expected_ship_date`). FBA detection in SQL mirrors L844–870. | `pages/api/orders/index.ts`, `lib/orders/views.ts` (new) | M |
| **A2** | Item query adds `lj."createdAt" as "labelJobCreatedAt"`, `lj."errorMessage" as "labelJobError"`; mapping adds `createdAt`, `errorMessage` to `labelJobs[0]` | `pages/api/orders/index.ts` L485, L778 | S |
| **A3** | `GET /api/orders?ids=<id>[,<id>]` (ownership enforced by the existing `userId` clause) so `?open=` works for an order not on the current page with the same mapping | `pages/api/orders/index.ts` | S |
| **A4** | `GET /api/orders` returns `lastPulledAt` (the newest `SyncLog`/user sync timestamp for orders; G1 verifies the field. If there is none, `SyncMeta` shows ⟳ without a time instead of a guess) | `pages/api/orders/index.ts` | S |
| **A5** | none server-side: presets live in `shippingSettings` JSON; the client does read-merge-write | — | — |
| **A6** | (later, not M3) move `toOrderRows` server-side, add `fields=list` to drop `rawData` from list payloads | — | L |
| **A7** | `POST /api/labels/rates` (§6.6) | `pages/api/labels/rates.ts`, `lib/fedex/rates.ts`, `lib/ups/rates.ts` | M, after M3a |
| **A8** | `POST /api/orders/manual` duplicate → `{ error, code: 'DUPLICATE_ORDER_NUMBER' }` (keeps the status 400) | `pages/api/orders/manual.ts` L90 | XS |

---

## 10. Data needed per element (list)

| Element | OrderRow field | Built from (existing) |
|---|---|---|
| Count pill / view counts | `total`, `counts.*` | `/api/orders` `total` + A1 |
| SyncMeta | `lastPulledAt`, pull state | A4 + `POST /api/orders/sync` |
| Store filter options | `{ value, label, count }` | `GET /api/orders/marketplace-options` (via `useMarketplaceOptions`); logo via `canonicalStore()` in the new shared `lib/marketplaces/canonical.ts` (G1 creates it; it wraps `isEtsyOrderSync` + the user's `EtsyShop.shopName` list; Overview and Reports import it; CRITIQUE C5) |
| Thumb | `items[0].image` | `line_items[].image` / Veeqo sellable / `/api/listing-urls` images (moved logic) |
| Title, +N | `items[0].title`, `items.length` | `productName`/`title`/`commodityDesc` (`getProductTitle`) |
| Meta line | `orderNumber`, `buyerName`, `shipTo.country`, `note` | `orderNumber`, `recipientFirstName/LastName`/`customerName`, `senkronData.internalNote` |
| Store cell | `marketplace`, `storeName` | `Order.marketplace` (shop name for Etsy/Wix) |
| Total | `total`, `currency` | `orderTotalPrice`, `currency` (fallback `rawData.currency`; **no `'USD'` default**: an unknown currency renders the number with the code tooltip "Currency unknown") |
| Status | `status` | §4.2 over `status`, labels, shipments, `isFBA`, `shipTo.missing` |
| Ship by | `shipBy`, `shippedAt`, `shippingUpgrade` | `shipByDate`/`items[].shipBy`, `Order.shippedAt`, `shippingUpgrade` |
| Tracking / push | `label`, `trackingSubmission` | `getLatestLabel()`, `trackingSubmissions[]` |
| Carrier cost | `carrierCost` | `manualShippingCost`, `manualShippingCostCurrency` |
| Labelable flag | `canLabel` | status ∈ {to_ship, overdue, label_failed} ∧ ¬FBA ∧ `shipTo.missing` empty |

`OrderRow` is defined once in `lib/orders/types.ts` (G1) and is the only shape UI groups use. `raw: LocalUIOrder` stays on it for the carrier adapters until A6.

---

## 11. i18n keys (EN + TR)

Rules:
- New namespaces `orders.*` and `createLabel.*`. Legacy namespaces (`labels`, `ups`, `mng`, `fedex`, `manualOrder`) are **not edited** while the legacy page lives. They are pruned in the cleanup PR by a key-usage grep.
- Reused as is: `printSlips.packingSlips`, `printSlips.pickList`, `printSlips.popupBlocked`, `printSlips.truncated`. DS-owned (`status.order.*`, `status.label.label_failed`, `ds.*` states, `ds.terms.etgb|hs|ioss`, `ds.optional`) are listed in §11.9 only if missing.
- **Turkish suffixes after marketplace names** use ICU `select` on the marketplace key, never string concatenation: `{mp, select, etsy {Etsy'ye} ebay {eBay'e} amazon {Amazon'a} trendyol {Trendyol'a} wix {Wix'e} shopify {Shopify'a} hepsiburada {Hepsiburada'ya} other {pazaryerine}}`. Below, `{mpDat}` marks that dative select and `{mpLoc}` the locative (`Etsy'de, eBay'de, Amazon'da, Trendyol'da, Wix'te, Shopify'da, Hepsiburada'da, other {pazaryerinde}`).
- Carrier service names (FedEx International Priority, UPS Saver) are product names and are not translated. They come from the constants.

### 11.1 Page, header, toolbar

| Key | EN | TR |
|---|---|---|
| `orders.page.title` | Orders | Siparişler |
| `orders.meta.refreshed` | Refreshed {time} | {time} yenilendi |
| `orders.meta.refreshing` | Refreshing orders… | Siparişler yenileniyor… |
| `orders.meta.refreshFailed` | Couldn't refresh orders | Siparişler yenilenemedi |
| `orders.meta.stores` | {count, plural, one {# store} other {# stores}} | {count} mağaza |
| `orders.actions.refresh` | Refresh orders | Siparişleri yenile |
| `orders.actions.createLabels` | Create {count, plural, one {# label} other {# labels}} | {count} etiket oluştur |
| `orders.actions.createLabelsPartial` | {skipped, plural, one {# order can't get a label here} other {# orders can't get a label here}}: {reason} | {skipped} sipariş için burada etiket oluşturulamaz: {reason} |
| `orders.actions.createLabel` | Create label | Etiket oluştur |
| `orders.actions.printLabel` | Print label | Etiketi yazdır |
| `orders.actions.printLabels` | Labels | Etiketler |
| `orders.actions.print` | Print | Yazdır |
| `orders.actions.printPickListPage` | Print pick list for this page | Bu sayfanın toplama listesini yazdır |
| `orders.actions.printPackingSlip` | Print packing slip | Paket fişini yazdır |
| `orders.actions.printLabelsLimit` | Printing the first {max}. Run Print again for the rest. | İlk {max} etiket yazdırılıyor. Kalanlar için Yazdır'ı tekrar kullanın. |
| `orders.actions.addManualOrder` | Add manual order | Manuel sipariş ekle |
| `orders.actions.export` | Export | Dışa aktar |
| `orders.actions.copyAddresses` | Copy addresses | Adresleri kopyala |
| `orders.actions.addressesCopied` | {count, plural, one {# address copied} other {# addresses copied}} | {count} adres kopyalandı |
| `orders.actions.sendEtgb` | Send ETGB documents | ETGB belgelerini gönder |
| `orders.actions.addTracking` | Add tracking number | Takip numarası ekle |
| `orders.actions.copyTracking` | Copy tracking number | Takip numarasını kopyala |
| `orders.actions.openOrder` | Open order | Siparişi aç |
| `orders.actions.openOn` | Open on {marketplace} | {marketplace} üzerinde aç |
| `orders.actions.copyAddressIntl` | Copy address (international) | Adresi kopyala (uluslararası) |
| `orders.actions.copyAddressTr` | Copy address (Turkish format) | Adresi kopyala (Türkiye formatı) |
| `orders.actions.copyAddress` | Copy | Kopyala |
| `orders.actions.messageBuyer` | Message buyer | Alıcıya mesaj gönder |
| `orders.actions.fixAddress` | Fix address | Adresi düzelt |
| `orders.actions.deleteLabel` | Delete label… | Etiketi sil… |
| `orders.actions.deleteOrder` | Delete order… | Siparişi sil… |
| `orders.actions.select` | Select | Seç |
| `orders.actions.loadMore` | Load more | Daha fazla yükle |
| `orders.toolbar.searchPlaceholder` | Search order #, buyer, SKU, tracking… | Sipariş no, alıcı, SKU, takip no ara… |
| `orders.toolbar.store` | Store | Mağaza |
| `orders.toolbar.storeAll` | All stores | Tüm mağazalar |
| `orders.toolbar.status` | Status | Durum |
| `orders.toolbar.orderDate` | Order date | Sipariş tarihi |
| `orders.toolbar.anyDate` | Any date | Tüm tarihler |
| `orders.toolbar.searchIn` | Search in | Arama alanı |
| `orders.toolbar.sort` | Sort | Sırala |
| `orders.toolbar.results` | {count, plural, one {# result} other {# results}} | {count} sonuç |
| `orders.toolbar.updating` | Updating… | Güncelleniyor… |
| `orders.toolbar.searchAllDates` | Search covers all dates | Arama tüm tarihleri kapsar |
| `orders.searchIn.all` | All fields | Tüm alanlar |
| `orders.searchIn.customer` | Buyer | Alıcı |
| `orders.searchIn.order` | Order number | Sipariş numarası |
| `orders.searchIn.tracking` | Tracking number | Takip numarası |
| `orders.searchIn.product` | Product | Ürün |
| `orders.searchIn.sku` | SKU | SKU |
| `orders.searchIn.city` | City | Şehir |
| `orders.searchIn.phone` | Phone | Telefon |
| `orders.searchIn.note` | Note | Not |
| `orders.sort.orderedAtDesc` | Newest first | En yeni önce |
| `orders.sort.orderedAtAsc` | Oldest first | En eski önce |
| `orders.sort.shipByAsc` | Ship by, soonest | Kargolama tarihi, en yakın |
| `orders.sort.totalDesc` | Total, highest | Tutar, en yüksek |
| `orders.sort.totalAsc` | Total, lowest | Tutar, en düşük |
| `orders.sort.customerAsc` | Buyer, A–Z | Alıcı, A–Z |

### 11.2 Views, columns, rows

| Key | EN | TR |
|---|---|---|
| `orders.views.label` | View | Görünüm |
| `orders.views.toShip` | To ship | Gönderilecek |
| `orders.views.overdue` | Overdue | Geciken |
| `orders.views.labelCreated` | Label created | Etiket hazır |
| `orders.views.shipped` | Shipped | Kargoda |
| `orders.views.problems` | Problems | Sorunlu |
| `orders.views.all` | All orders | Tüm siparişler |
| `orders.views.save` | Save view | Görünümü kaydet |
| `orders.views.saveName` | View name | Görünüm adı |
| `orders.views.delete` | Delete view | Görünümü sil |
| `orders.columns.order` | Order | Sipariş |
| `orders.columns.store` | Store | Mağaza |
| `orders.columns.total` | Total | Tutar |
| `orders.columns.status` | Status | Durum |
| `orders.columns.shipBy` | Ship by | Kargolama tarihi |
| `orders.columns.orderedAt` | Ordered | Sipariş tarihi |
| `orders.columns.tracking` | Tracking | Takip |
| `orders.columns.carrierCost` | Carrier cost | Kargo maliyeti |
| `orders.row.moreItems` | +{count, plural, one {# item} other {# items}} | +{count} ürün |
| `orders.row.buyerHidden` | Name hidden by Amazon | İsim Amazon tarafından gizlendi |
| `orders.row.buyerHiddenHint` | Amazon shares buyer names only with the PII role on your SP-API app. | Amazon alıcı isimlerini yalnızca SP-API uygulamanızda kişisel veri yetkisi varsa paylaşır. |
| `orders.row.manualStore` | Manual order | Manuel sipariş |
| `orders.row.fba` | Fulfilled by Amazon | Amazon tarafından gönderilir |
| `orders.row.mcf` | Multi-Channel Fulfillment | Çok Kanallı Gönderim (MCF) |
| `orders.row.fbaNoLabel` | Amazon ships this order. No label needed. | Bu siparişi Amazon gönderir. Etiket gerekmez. |
| `orders.row.upgrade` | {upgrade} shipping | {upgrade} kargo |
| `orders.row.upgradePaid` | Buyer paid for {upgrade} shipping | Alıcı {upgrade} kargo için ödeme yaptı |
| `orders.row.note` | Private note | Özel not |
| `orders.row.selectOrder` | Select order {number} | {number} numaralı siparişi seç |
| `orders.row.currencyUnknown` | Currency unknown | Para birimi bilinmiyor |
| `orders.row.trackingSent` | Tracking sent ✓ | Takip gönderildi ✓ |
| `orders.row.trackingQueued` | Queued for extension | Eklenti için sırada |
| `orders.row.trackingFailed` | Couldn't send tracking | Takip gönderilemedi |
| `orders.row.trendyolCargo` | Trendyol cargo number | Trendyol kargo numarası |
| `orders.problem.addressIncomplete` | Address incomplete: {fields} missing | Adres eksik: {fields} yok |
| `orders.problem.field.name` | name | ad |
| `orders.problem.field.street1` | street address | sokak adresi |
| `orders.problem.field.city` | city | şehir |
| `orders.problem.field.postal` | postal code | posta kodu |
| `orders.problem.field.country` | country | ülke |
| `orders.problem.etsyAddressHidden` | Etsy doesn't share buyer addresses through its API. Open the order on Etsy with the Chrome extension to import it. | Etsy alıcı adreslerini API üzerinden paylaşmıyor. Adresi almak için siparişi Chrome eklentisi açıkken Etsy'de açın. |
| `orders.problem.labelFailed` | Label failed: {reason} | Etiket oluşturulamadı: {reason} |
| `orders.problem.trackingFailed` | Tracking couldn't be sent: {reason} | Takip numarası gönderilemedi: {reason} |
| `orders.status.rawTooltip` | {marketplace}: {raw} | {marketplace}: {raw} |

### 11.3 Bulk bar, export, ETGB

| Key | EN | TR |
|---|---|---|
| `orders.bulk.selected` | {count} selected | {count} seçili |
| `orders.bulk.selectPage` | Select all on this page | Bu sayfadakilerin tümünü seç |
| `orders.bulk.clear` | Clear | Temizle |
| `orders.export.title` | Export orders | Siparişleri dışa aktar |
| `orders.export.selected` | {count, plural, one {# selected order} other {# selected orders}} | {count} seçili sipariş |
| `orders.export.allMatching` | All matching filters | Filtrelere uyan tümü |
| `orders.export.allMatchingCount` | All {count} matching filters | Filtrelere uyan {count} siparişin tümü |
| `orders.export.csv` | CSV | CSV |
| `orders.export.excel` | Excel | Excel |
| `orders.export.pdf` | PDF | PDF |
| `orders.export.preparing` | Preparing {count} orders… | {count} sipariş hazırlanıyor… |
| `orders.export.done` | {count, plural, one {# order exported} other {# orders exported}} | {count} sipariş dışa aktarıldı |
| `orders.export.empty` | No orders to export | Dışa aktarılacak sipariş yok |
| `orders.export.tooMany` | Export up to {max} orders at a time. Narrow the filters. | Tek seferde en fazla {max} sipariş dışa aktarılabilir. Filtreleri daraltın. |
| `orders.export.failed` | Couldn't export orders | Siparişler dışa aktarılamadı |
| `orders.etgb.sending` | Sending ETGB documents for {count} orders… | {count} sipariş için ETGB belgeleri gönderiliyor… |
| `orders.etgb.sent` | ETGB documents sent to {email} | ETGB belgeleri {email} adresine gönderildi |
| `orders.etgb.noEmail` | Add an ETGB email in Settings first | Önce Ayarlar'dan ETGB e-posta adresini ekleyin |
| `orders.etgb.failed` | Couldn't send ETGB documents | ETGB belgeleri gönderilemedi |
| `orders.etgb.openSettings` | Open settings | Ayarları aç |

### 11.4 States

| Key | EN | TR |
|---|---|---|
| `orders.empty.firstUse.title` | Connect a store to see your orders | Siparişlerinizi görmek için bir mağaza bağlayın |
| `orders.empty.firstUse.body` | Orders from Etsy, eBay, Amazon, Trendyol and your other stores show up here. You can also add a manual order. | Etsy, eBay, Amazon, Trendyol ve diğer mağazalarınızın siparişleri burada görünür. Manuel sipariş de ekleyebilirsiniz. |
| `orders.empty.firstUse.action` | Connect a store | Mağaza bağla |
| `orders.empty.noResults.title` | No orders match these filters | Bu filtrelere uyan sipariş yok |
| `orders.empty.noResults.action` | Clear filters | Filtreleri temizle |
| `orders.empty.noResultsSearch` | No orders match "{query}" | "{query}" ile eşleşen sipariş yok |
| `orders.empty.done.toShip` | Every order has a label | Tüm siparişlerin etiketi hazır |
| `orders.empty.done.overdue` | Nothing is overdue | Geciken sipariş yok |
| `orders.empty.done.problems` | No problems to fix | Düzeltilecek sorun yok |
| `orders.empty.labelCreated` | No labels waiting to ship | Kargoya verilmeyi bekleyen etiket yok |
| `orders.error.title` | Couldn't load orders | Siparişler yüklenemedi |
| `orders.error.stale` | Showing orders from {time} | {time} itibarıyla siparişler gösteriliyor |
| `orders.error.orderTitle` | Couldn't load this order | Bu sipariş yüklenemedi |
| `orders.error.orderGone` | This order no longer exists | Bu sipariş artık yok |
| `orders.error.backToOrders` | Back to orders | Siparişlere dön |
| `orders.limit.labels` | You've used all {limit} labels in your plan this month | Planınızdaki bu ayki {limit} etiket hakkının tamamını kullandınız |
| `orders.limit.syncs` | You've used all {limit} order syncs in your plan this month | Planınızdaki bu ayki {limit} sipariş senkronizasyon hakkının tamamını kullandınız |
| `orders.limit.seePlans` | See plans | Planları gör |

### 11.5 OrderPanel, tracking modal, confirms

| Key | EN | TR |
|---|---|---|
| `orders.panel.title` | Order {number} | Sipariş {number} |
| `orders.panel.ordered` | Ordered {date} | Sipariş tarihi: {date} |
| `orders.panel.items` | Items ({count}) | Ürünler ({count}) |
| `orders.panel.qtyPrice` | {price} × {qty} | {price} × {qty} |
| `orders.panel.personalization` | Personalization | Kişiselleştirme |
| `orders.panel.itemsSubtotal` | Items {amount} | Ürünler {amount} |
| `orders.panel.orderTotal` | Total {amount} | Toplam {amount} |
| `orders.panel.giftMessage` | Gift message | Hediye notu |
| `orders.panel.buyerNote` | Note from buyer | Alıcı notu |
| `orders.panel.shipTo` | Ship to | Teslimat adresi |
| `orders.panel.edit` | Edit | Düzenle |
| `orders.panel.save` | Save | Kaydet |
| `orders.panel.addressSaved` | Address saved in KolayXport. {marketplace} isn't changed. | Adres KolayXport'ta kaydedildi. {marketplace} tarafı değişmedi. |
| `orders.panel.labelTracking` | Label & tracking | Etiket ve takip |
| `orders.panel.noLabel` | No label yet | Henüz etiket yok |
| `orders.panel.labelCreatedOn` | Created {date} | {date} tarihinde oluşturuldu |
| `orders.panel.trackingSentTo` | Tracking sent to {mpDat} | Takip numarası {mpDat} gönderildi |
| `orders.panel.trackingQueued` | Queued for the Chrome extension | Chrome eklentisi için sıraya alındı |
| `orders.panel.trackingNotSent` | Tracking not sent yet | Takip numarası henüz gönderilmedi |
| `orders.panel.note` | Private note | Özel not |
| `orders.panel.notePlaceholder` | Add a note for packing or production… | Paketleme veya üretim için not ekleyin… |
| `orders.panel.noteHint` | Only you see this. Never sent to a marketplace. | Bunu yalnızca siz görürsünüz. Pazaryerine asla gönderilmez. |
| `orders.panel.noteSaveFailed` | Couldn't save the note | Not kaydedilemedi |
| `orders.panel.costs` | Costs | Maliyetler |
| `orders.panel.carrierCost` | Carrier cost | Kargo maliyeti |
| `orders.panel.carrierCostHint` | From the carrier invoice. Used in Finance. | Kargo faturasından girin. Finans raporunda kullanılır. |
| `orders.panel.carrierCostSaved` | Carrier cost saved | Kargo maliyeti kaydedildi |
| `orders.panel.carrierCostInvalid` | Enter an amount of 0 or more | 0 veya daha büyük bir tutar girin |
| `orders.panel.history` | History | Geçmiş |
| `orders.history.ordered` | Ordered on {marketplace} | {marketplace} üzerinden sipariş verildi |
| `orders.history.imported` | Imported into KolayXport | KolayXport'a aktarıldı |
| `orders.history.labelCreated` | Label created · {carrier} | Etiket oluşturuldu · {carrier} |
| `orders.history.labelFailed` | Label failed · {carrier} | Etiket oluşturulamadı · {carrier} |
| `orders.history.trackingSent` | Tracking sent to {mpDat} | Takip numarası {mpDat} gönderildi |
| `orders.history.shipped` | Shipped | Kargoya verildi |
| `orders.tracking.title` | Add tracking number | Takip numarası ekle |
| `orders.tracking.number` | Tracking number | Takip numarası |
| `orders.tracking.carrier` | Carrier | Kargo firması |
| `orders.tracking.carrierOther` | Other | Diğer |
| `orders.tracking.notifyBuyer` | Notify the buyer | Alıcıyı bilgilendir |
| `orders.tracking.submit` | Send to {mp, select, etsy {Etsy} ebay {eBay} amazon {Amazon} trendyol {Trendyol} wix {Wix} shopify {Shopify} other {marketplace}} | {mpDat} gönder |
| `orders.tracking.sending` | Sending… | Gönderiliyor… |
| `orders.tracking.sent` | Tracking sent to {mpDat} | Takip numarası {mpDat} gönderildi |
| `orders.tracking.queued` | Queued. The Chrome extension sends it the next time Etsy is open. | Sıraya alındı. Chrome eklentisi Etsy bir sonraki açıldığında gönderecek. |
| `orders.tracking.failed` | Couldn't send tracking | Takip numarası gönderilemedi |
| `orders.confirm.deleteOrder.title` | Delete order {number}? | {number} numaralı sipariş silinsin mi? |
| `orders.confirm.deleteOrder.body` | It's removed from KolayXport only. Nothing changes on {marketplace}. | Sipariş yalnızca KolayXport'tan silinir. {marketplace} tarafında hiçbir şey değişmez. |
| `orders.confirm.deleteOrder.confirm` | Delete order | Siparişi sil |
| `orders.confirm.deleteOrder.done` | Order {number} deleted | {number} numaralı sipariş silindi |
| `orders.confirm.deleteLabel.title` | Delete the label for order {number}? | {number} numaralı siparişin etiketi silinsin mi? |
| `orders.confirm.deleteLabel.body` | It's removed from KolayXport. It isn't voided with the carrier. | Etiket KolayXport'tan kaldırılır, kargo firmasında iptal edilmez. |
| `orders.confirm.deleteLabel.confirm` | Delete label | Etiketi sil |
| `orders.confirm.deleteLabel.done` | Label deleted | Etiket silindi |

### 11.6 Create label

| Key | EN | TR |
|---|---|---|
| `createLabel.title` | Create label · Order {number} | Etiket oluştur · Sipariş {number} |
| `createLabel.backToOrder` | Order | Sipariş |
| `createLabel.from` | From | Gönderen |
| `createLabel.change` | Change | Değiştir |
| `createLabel.senderMissing.title` | Complete your sender profile to create labels | Etiket oluşturmak için gönderici profilinizi tamamlayın |
| `createLabel.senderMissing.action` | Open sender profile | Gönderici profilini aç |
| `createLabel.senderMissing.reason` | Complete your sender profile first | Önce gönderici profilinizi tamamlayın |
| `createLabel.shipTo` | Ship to | Alıcı |
| `createLabel.edit` | Edit | Düzenle |
| `createLabel.field.name` | Recipient name | Alıcı adı |
| `createLabel.field.phone` | Phone | Telefon |
| `createLabel.field.email` | Email | E-posta |
| `createLabel.field.country` | Country | Ülke |
| `createLabel.field.street1` | Address line 1 | Adres satırı 1 |
| `createLabel.field.street2` | Address line 2 | Adres satırı 2 |
| `createLabel.field.city` | City | Şehir |
| `createLabel.field.postal` | Postal code | Posta kodu |
| `createLabel.field.state` | State / province | Eyalet / bölge |
| `createLabel.field.district` | District | İlçe |
| `createLabel.field.neighbourhood` | Neighbourhood | Mahalle |
| `createLabel.package` | Package | Paket |
| `createLabel.presets` | Presets | Hazır paketler |
| `createLabel.presetNone` | No presets yet | Henüz hazır paket yok |
| `createLabel.savePreset` | Save as preset… | Hazır paket olarak kaydet… |
| `createLabel.presetName` | Preset name | Hazır paket adı |
| `createLabel.presetDefault` | Use by default | Varsayılan olarak kullan |
| `createLabel.presetSaved` | Preset saved | Hazır paket kaydedildi |
| `createLabel.field.weight` | Weight | Ağırlık |
| `createLabel.field.length` | Length | Uzunluk |
| `createLabel.field.width` | Width | Genişlik |
| `createLabel.field.height` | Height | Yükseklik |
| `createLabel.dimsHint` | Optional for paks and envelopes | Pak ve zarf için isteğe bağlı |
| `createLabel.field.packaging` | Packaging | Ambalaj |
| `createLabel.packagingOwn` | Your packaging | Kendi ambalajınız |
| `createLabel.carrier` | Carrier & service | Kargo firması ve servis |
| `createLabel.refreshRates` | Refresh rates | Fiyatları yenile |
| `createLabel.recommended` | Recommended | Önerilen |
| `createLabel.transitDays` | {min}–{max} days | {min}–{max} gün |
| `createLabel.noPrice` | The price shows on the carrier invoice. | Fiyat kargo faturasında görünür. |
| `createLabel.ratesFailed` | Couldn't get rates | Fiyatlar alınamadı |
| `createLabel.unavailable.domesticOnly` | Turkey domestic only | Yalnızca Türkiye içi |
| `createLabel.unavailable.notConnected` | Connect {carrier} in Settings | {carrier} hesabını Ayarlar'dan bağlayın |
| `createLabel.unavailable.incomplete` | {carrier} setup is incomplete | {carrier} kurulumu eksik |
| `createLabel.unavailable.checkFailed` | Couldn't check {carrier} | {carrier} kontrol edilemedi |
| `createLabel.openSettings` | Open settings | Ayarları aç |
| `createLabel.noCarrier.title` | Connect a carrier to create labels | Etiket oluşturmak için bir kargo firması bağlayın |
| `createLabel.noCarrier.action` | Connect a carrier | Kargo firması bağla |
| `createLabel.customs` | Customs | Gümrük |
| `createLabel.customsItems` | {count, plural, one {# item} other {# items}} | {count} ürün |
| `createLabel.field.description` | Description | Açıklama |
| `createLabel.field.hsCode` | HS code | GTİP kodu |
| `createLabel.field.origin` | Country of origin | Menşe ülke |
| `createLabel.field.quantity` | Quantity | Adet |
| `createLabel.field.value` | Value | Değer |
| `createLabel.field.currency` | Currency | Para birimi |
| `createLabel.terms` | Duties & taxes paid by | Gümrük vergilerini ödeyen |
| `createLabel.terms.dap` | Recipient (DAP) | Alıcı (DAP) |
| `createLabel.terms.ddp` | Me (DDP) | Ben (DDP) |
| `createLabel.exportReason` | Reason for export | İhracat nedeni |
| `createLabel.exportReason.sale` | Sale | Satış |
| `createLabel.exportReason.gift` | Gift | Hediye |
| `createLabel.exportReason.sample` | Sample | Numune |
| `createLabel.exportReason.return` | Return | İade |
| `createLabel.exportReason.repair` | Repair | Onarım |
| `createLabel.field.ioss` | IOSS number | IOSS numarası |
| `createLabel.field.vat` | Recipient VAT number | Alıcı KDV numarası |
| `createLabel.field.invoiceNumber` | Invoice number | Fatura numarası |
| `createLabel.sendEtgb` | Send ETGB document after the label is created | Etiket oluşturulduktan sonra ETGB belgesini gönder |
| `createLabel.options` | Options | Seçenekler |
| `createLabel.sendTracking` | Send tracking to {mpDat} after the label is created | Etiket oluşturulduktan sonra takip numarasını {mpDat} gönder |
| `createLabel.field.signature` | Signature | İmza |
| `createLabel.signature.none` | None | Yok |
| `createLabel.field.labelFormat` | Label format | Etiket formatı |
| `createLabel.dhl.paymentType` | Shipping paid by | Kargo ücretini ödeyen |
| `createLabel.dhl.paymentSender` | Me | Ben |
| `createLabel.dhl.paymentRecipient` | Recipient | Alıcı |
| `createLabel.dhl.deliveryType` | Delivery type | Teslimat tipi |
| `createLabel.dhl.cod` | Cash on delivery | Kapıda ödeme |
| `createLabel.dhl.codAmount` | Amount to collect | Tahsil edilecek tutar |
| `createLabel.dhl.smsShipped` | Text the recipient when shipped | Kargoya verilince alıcıya SMS gönder |
| `createLabel.dhl.smsDelivered` | Text the recipient on delivery | Teslimatta alıcıya SMS gönder |
| `createLabel.dhl.content` | Contents | İçerik |
| `createLabel.saveWithoutCreating` | Save details without creating | Oluşturmadan bilgileri kaydet |
| `createLabel.detailsSaved` | Details saved | Bilgiler kaydedildi |
| `createLabel.total` | Total {amount} | Toplam {amount} |
| `createLabel.cancel` | Cancel | İptal |
| `createLabel.submit` | Create label | Etiket oluştur |
| `createLabel.submitting` | Creating label… | Etiket oluşturuluyor… |
| `createLabel.fixFields` | {count, plural, one {Fix # field to continue} other {Fix # fields to continue}} | Devam etmek için {count} alanı düzeltin |
| `createLabel.validation.required` | Required | Zorunlu |
| `createLabel.validation.weight` | Enter a weight above 0 | 0'dan büyük bir ağırlık girin |
| `createLabel.validation.phoneDhl` | DHL eCommerce needs the recipient's phone | DHL eCommerce için alıcının telefonu gerekli |
| `createLabel.validation.districtDhl` | DHL eCommerce needs the district | DHL eCommerce için ilçe gerekli |
| `createLabel.validation.stateRequired` | Required for {country} | {country} için zorunlu |
| `createLabel.validation.maxChars` | Up to {max} characters | En fazla {max} karakter |
| `createLabel.validation.hsFormat` | Use 6 to 10 digits | 6 ile 10 hane arasında girin |
| `createLabel.error.title` | Couldn't create the label | Etiket oluşturulamadı |
| `createLabel.error.carrierSaid` | {carrier} said: {message} | {carrier} yanıtı: {message} |
| `createLabel.existing.title` | This order already has a label | Bu siparişin zaten bir etiketi var |
| `createLabel.existing.another` | Create another label… | Başka bir etiket oluştur… |
| `createLabel.existing.confirmTitle` | Create a second label for order {number}? | {number} numaralı sipariş için ikinci etiket oluşturulsun mu? |
| `createLabel.existing.confirm` | Create another | Yine de oluştur |
| `createLabel.success.title` | Label created · {service} | Etiket oluşturuldu · {service} |
| `createLabel.success.tracking` | Tracking number | Takip numarası |
| `createLabel.success.trackingSent` | Tracking sent to {mpDat} | Takip numarası {mpDat} gönderildi |
| `createLabel.success.trackingQueued` | Queued for the Chrome extension · Open Etsy to send it | Chrome eklentisi için sıraya alındı · Göndermek için Etsy'yi açın |
| `createLabel.success.trackingFailed` | Couldn't send tracking | Takip numarası gönderilemedi |
| `createLabel.success.retry` | Retry | Tekrar dene |
| `createLabel.success.etgbSent` | ETGB document sent to {email} | ETGB belgesi {email} adresine gönderildi |
| `createLabel.success.preview` | Label preview | Etiket önizlemesi |
| `createLabel.success.previewUnavailable` | No preview for this file. Use Print label. | Bu dosya için önizleme yok. Etiketi yazdır'ı kullanın. |
| `createLabel.success.download` | Download PDF | PDF indir |
| `createLabel.success.next` | Next order | Sonraki sipariş |
| `createLabel.success.openFailed` | Couldn't open the label. Allow pop-ups for KolayXport. | Etiket açılamadı. KolayXport için açılır pencerelere izin verin. |

### 11.7 Bulk create labels

| Key | EN | TR |
|---|---|---|
| `createLabel.bulk.title` | Create {count, plural, one {# label} other {# labels}} | {count} etiket oluştur |
| `createLabel.bulk.hint` | Every order uses this carrier, service and package. Weight comes from each order. | Tüm siparişlerde bu kargo firması, servis ve paket kullanılır. Ağırlık her siparişten alınır. |
| `createLabel.bulk.orders` | Orders | Siparişler |
| `createLabel.bulk.ready` | Ready | Hazır |
| `createLabel.bulk.summary` | {ready} ready · {blocked} need details | {ready} hazır · {blocked} siparişte eksik bilgi var |
| `createLabel.bulk.fix` | Fix | Düzelt |
| `createLabel.bulk.running` | Creating {done} of {total}… | {total} etiketten {done}. oluşturuluyor… |
| `createLabel.bulk.stop` | Stop after current | Bu etiketten sonra durdur |
| `createLabel.bulk.stopConfirm` | Stop creating labels? | Etiket oluşturma durdurulsun mu? |
| `createLabel.bulk.done` | {ok} labels created · {failed} failed | {ok} etiket oluşturuldu · {failed} başarısız |
| `createLabel.bulk.retryFailed` | Retry failed | Başarısızları tekrar dene |
| `createLabel.bulk.printAll` | Print {count, plural, one {# label} other {# labels}} | {count} etiketi yazdır |
| `createLabel.bulk.dhlMixed` | DHL eCommerce only works when every order ships within Turkey | DHL eCommerce yalnızca tüm siparişler Türkiye içine gönderiliyorsa kullanılabilir |

### 11.8 Manual order

| Key | EN | TR |
|---|---|---|
| `orders.manual.title` | Add manual order | Manuel sipariş ekle |
| `orders.manual.customer` | Customer | Müşteri |
| `orders.manual.name` | Customer name | Müşteri adı |
| `orders.manual.email` | Email | E-posta |
| `orders.manual.phone` | Phone | Telefon |
| `orders.manual.orderNumber` | Order number | Sipariş numarası |
| `orders.manual.orderNumberHint` | Your own reference, e.g. an Instagram order | Kendi referansınız, örneğin bir Instagram siparişi |
| `orders.manual.currency` | Currency | Para birimi |
| `orders.manual.address` | Delivery address | Teslimat adresi |
| `orders.manual.items` | Items | Ürünler |
| `orders.manual.productName` | Product name | Ürün adı |
| `orders.manual.sku` | SKU | SKU |
| `orders.manual.price` | Price | Fiyat |
| `orders.manual.quantity` | Quantity | Adet |
| `orders.manual.weight` | Weight | Ağırlık |
| `orders.manual.addItem` | Add item | Ürün ekle |
| `orders.manual.removeItem` | Remove item | Ürünü kaldır |
| `orders.manual.total` | Total {amount} | Toplam {amount} |
| `orders.manual.submit` | Create order | Siparişi oluştur |
| `orders.manual.submitting` | Creating order… | Sipariş oluşturuluyor… |
| `orders.manual.created` | Order {number} created | {number} numaralı sipariş oluşturuldu |
| `orders.manual.duplicate` | This order number already exists | Bu sipariş numarası zaten var |
| `orders.manual.failed` | Couldn't create the order | Sipariş oluşturulamadı |
| `orders.manual.discardTitle` | Discard this order? | Sipariş kaydedilmeden kapatılsın mı? |
| `orders.manual.validation.positive` | Enter a number above 0 | 0'dan büyük bir sayı girin |

### 11.9 DS-owned keys this surface needs (add in M1 if missing)

`status.order.{to_ship,overdue,label_created,shipped,delivered,on_hold,problem,cancelled,refunded}`, `status.label.label_failed` (values in DS §3.9), `ds.optional` "(optional)" / "(isteğe bağlı)", `ds.terms.etgb` "Electronic customs declaration for e-commerce exports from Turkey." / "Türkiye'den e-ihracat gönderileri için elektronik gümrük beyannamesi.", `ds.terms.hs` "Harmonized System code: the customs product category." / "GTİP: ürünün gümrük tarife kodu.", `ds.terms.ioss` "EU VAT number for low-value imports. Lets the buyer avoid VAT on delivery." / "Düşük değerli AB ithalatı için KDV numarası. Alıcının teslimatta KDV ödemesini önler.", `ds.state.slow`, `ds.state.retry`, `ds.state.copyErrorId`, `ds.dirty.keepEditing`, `ds.dirty.discard`.

---

## 12. Code to delete

| When | What | Lines |
|---|---|---|
| M3 PR (flag added) | `pages/app/labels.tsx` body moves verbatim to `components/legacy/LegacyLabelsPage.tsx`; the route file becomes a ~20-line flag switch | −3,470 in the route |
| M3 PR | moved out of the legacy body into `lib/` (copied, the legacy file keeps its own copies until deleted): `extractAddress`, `toLabelRows`, `resolveEtsyCountryCode`, `parseEtsyPersonalization`, `getMarketplaceOrderUrl`, `rowToCopyAddress`, `buildAddressesTsv`, `VEEQO_CARRIERS_BASE` → `lib/orders/*`, `lib/shipping/trackingCarriers.ts` | — |
| M3 PR | `components/labels/labelLinks.ts` → `lib/shipping/labelLinks.ts` (re-export shim left at the old path for the legacy page) | — |
| Flag default-on + 1 release | `components/legacy/LegacyLabelsPage.tsx` (incl. the inline FedEx drawer, image Dialog, tracking Dialog, shipment delete Dialog, `statusColors`, `ORDER_STATUS_KEYS`, `ORDER_STATUS_FILTER_KEYS`, `SEARCH_TYPE_KEYS` UI, `cardViewMode`, emoji chips ⏱ ⚡ 🚚, `currSymbol`/`.toFixed`, `parseShippoNotes` (dead), `fmtDateTr`, the `/api/user/settings` fetch for FedEx credentials) | ~3,470 |
| same | `components/UPSLabelDrawer.tsx`, `components/MngLabelDrawer.tsx` | 1,589 |
| same | `components/ManualOrderButton.tsx`, `components/ManualOrderForm.tsx` | 788 |
| same | `components/labels/{LabelsBulkBar, ExportMenu, OrderNoteField, ShippingCostCell, PrintLabelButton, CopyAddressControl}.tsx`, `components/labels/labelLinks.ts` shim | ~1,000 |
| same | `components/print/PrintSelectionActions.tsx` (replaced by `lib/print/openPrintPage.ts`; the print pages stay) | 47 |
| same | `lib/hooks/useOrders.ts` `'labelsPage'` branch (no other caller) | ~50 |
| same | i18n: keys in `labels`, `ups`, `mng`, `manualOrder`, `fedex` that a usage grep finds unused (`fedex.*` currency labels are still used by `lib/fedex/fedex.config.ts`; keep those) | ~370 keys |

---

## 13. Implementation split (disjoint file groups for parallel agents)

**Prerequisites (not this surface; must be merged first):** DS M1 components used here (`Page, PageHeader, SyncMeta, Toolbar, SearchField, FilterButton, FiltersSheet, SavedViews, ActiveFilterChips, BulkActionBar, DateRangeField, DataTable, StatusPill, Thumb, LogoTile, Money, DateText, ShipBy, CopyText, TermHint, SidePanel, SidePanelSection, Modal, ConfirmDialog, BottomSheet, OverflowMenu, Banner, EmptyState, ErrorState, Skeletons, useAsyncState, useToast, Button, IconButton, SplitButton, FormField, TextField, TextArea, NumberField, MoneyField, Select, CountrySelect, CurrencySelect, PhoneInput, Checkbox, Switch, RadioGroup, RateList, StickyActionBar, Timeline, KeyValueList`), `lib/format.ts`, `lib/ds/useUrlState.ts`, `lib/ds/useShortcuts.ts`, `lib/ds/uiFlags.ts`, `public/logos/{fedex,ups,dhl}.svg`, icon registry incl. §0.3 additions. If `lib/ds/status/orders.ts` does not exist yet, **G1 owns it**.

**Frozen contracts (this doc):** `OrderRow` and friends (§10, written by G1 on day 1 as `lib/orders/types.ts`, types only), `LabelDraft` (§6.1), and the component props below. Groups code against them; G1 and G4 publish the types first, in their own files.

```ts
// components/domain/orders/panel/OrderPanel.tsx               (G3)
export interface OrderPanelProps { orderId: string | null; rows: OrderRow[]; onClose(): void; onNavigate(id: string): void;
  onCreateLabel(row: OrderRow): void; onChanged(): void }
// components/domain/shipping/CreateLabelPanel.tsx              (G4)
export interface CreateLabelPanelProps { order: OrderRow | null; open: boolean; onClose(): void; onBack?(): void;
  defaultCarrier?: CarrierKey; mode?: 'create' | 'fixAddress'; onCreated(r: { orderId: string; trackingNumber: string; labelHref: string | null }): void;
  onNext?(): void }
// components/domain/shipping/BulkCreateLabelsPanel.tsx         (G4)
export interface BulkCreateLabelsPanelProps { orders: OrderRow[]; open: boolean; onClose(): void; onFixOrder(id: string): void; onDone(): void }
// components/domain/orders/ManualOrderPanel.tsx                (G5)
export interface ManualOrderPanelProps { open: boolean; onClose(): void; onCreated(orderId: string): void }
// lib/hooks/useOrdersList.ts                                   (G1)
export function useOrdersList(q: OrdersQuery): { rows: OrderRow[]; total: number; counts?: ViewCounts; lastPulledAt?: string;
  state: AsyncState; mutate(): Promise<unknown>; pull(): Promise<void>; pulling: boolean };
export function useOrder(id: string | null): { row?: OrderRow; state: AsyncState; mutate(): Promise<unknown> };
```

| Group | Owns (only these files) | Depends on | Tests |
|---|---|---|---|
| **G1 Data + API** | `pages/api/orders/index.ts` (A1–A4), `pages/api/orders/manual.ts` (A8), `lib/orders/{types,views,toOrderRows,marketplaceUrls,legacyQuery}.ts` (`views.ts` extended, not created), `lib/marketplaces/canonical.ts` (new, shared), `lib/ds/status/orders.ts` (if absent), `lib/hooks/useOrdersList.ts` | prerequisites | `__tests__/orders/{toOrderRows,status,views,legacyQuery}.test.ts` with fixtures per marketplace (Etsy w/o address, Amazon anonymized + FBA, Trendyol pre-assigned cargo, Wix nested address, Veeqo sellable, manual) + an API test for `view`/`counts`/`ids` |
| **G2 List page** | `pages/app/labels.tsx`, `components/legacy/LegacyLabelsPage.tsx` (git mv only), `components/domain/orders/{OrdersPage,orderColumns,ordersFilters,OrdersBulkActions,OrdersExportMenu,OrdersEmptyState}.tsx`, `lib/print/openPrintPage.ts` | G1 types + hook; mounts G3/G4/G5 panels by the props above (stubs until merged) | render tests: each view's empty state, primary rule §1.4, selection → bulk bar, legacy query migration on mount |
| **G3 OrderPanel** | `components/domain/orders/panel/{OrderPanel,ItemsSection,ShipToSection,ShipToForm,LabelSection,NoteSection,CostsSection,HistorySection,AddTrackingModal,MessageBuyerModal}.tsx`, `components/domain/orders/panel/{useOrderNote,useOrderActions}.ts`, `lib/shipping/trackingCarriers.ts` | G1; `ShipToForm` is shared with G4 (G3 owns it, G4 imports it) | note autosave ordering (port of the `OrderNoteField` sequence logic), delete confirms, FBA read-only |
| **G4 Create label** | `components/domain/shipping/{CreateLabelPanel,FromSection,PackageSection,CarrierServiceSection,CustomsSection,OptionsSection,LabelSuccess,BulkCreateLabelsPanel}.tsx`, `lib/shipping/{labelDraft,carriers,validate,labelLinks,usePackagePresets,useSenderProfile}.ts`, `lib/shipping/submit/{fedex,ups,dhl,tracking}.ts`, shim `components/labels/labelLinks.ts` | G1 types, G3 `ShipToForm` | **request snapshot tests** proving each adapter emits the same body as the legacy code for 3 fixtures per carrier; eligibility matrix; validation; bulk runner (sequential, stop, retry) |
| **G5 Manual order** | `components/domain/orders/ManualOrderPanel.tsx`, `lib/orders/manualOrder.ts` | G1 (A8) | payload equals today's `ManualOrderData`; default currency = account base currency, never hard "USD"; duplicate → field error |
| **G6 i18n** | `messages/en.json`, `messages/tr.json` | none; runs **first** and applies §11 verbatim | key-parity test EN/TR for `orders.*`, `createLabel.*` |
| **G7 Rates (after M3a)** | `pages/api/labels/rates.ts`, `lib/fedex/rates.ts`, `lib/ups/rates.ts` | G4 RateList wiring already accepts `amount` | mocked carrier responses; timeout path |

Merge order: G6 → G1 → (G2 ∥ G3 ∥ G4 ∥ G5) → flag on for the founder → G7. No two groups touch the same file. G2 is the only one that edits `pages/app/labels.tsx`, G1 the only one that edits API files, and G6 the only one that edits message files.

**Exit criteria for M3 (in addition to DS §8):** on production behind `?ui=2`, the founder creates 10 real labels across FedEx, UPS and DHL eCommerce. Each request body matches the legacy snapshot. The To ship count equals the number of truly unshipped orders (spot-check 10 against the marketplaces). "Unlabeled shows shipped Amazon orders" no longer reproduces. The recipient phone is prefilled on every carrier. Manual order defaults to TRY for a TR account. EN and TR screenshots at 1440, 1024 and 390 for the list, the panel, Create label (form and success), bulk create and manual order.

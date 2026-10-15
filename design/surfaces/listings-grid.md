# Surface: Listings grid (`ListingsPage`)

Status: design spec, binding once accepted. Date: 2026-10-15. Design only: no app code changed.
Contract: `design/DESIGN_SYSTEM.md` (DS) and `design/tokens.md`. This spec uses only DS components (§4). The two places where it adds to the system are listed in §1.2 with reasons.
Milestone: DS §7.2 **M5 Listings template**. Flags: `listings-etsy`, `listings-ebay`, `listings-trendyol`, `listings-wix`, `listings-shopify` (`lib/ds/uiFlags.ts`).

Code read for this spec (kx-ux-phase0 @ `92087ba`):
`pages/app/etsy-listings.tsx` (3,689 lines), `ebay-listings.tsx` (2,744), `trendyol-urunler.tsx` (999), `wix-urunler.tsx` (1,456), `shopify-urunler.tsx` (1,042); `pages/api/clawd/etsy.ts` (`cached_listings` L3629, `sync_listings` L3701, `listings_with_images` L2911); `pages/api/clawd/ebay.ts` (`cached_listings` L2162, `sync_listings` L2184); `pages/api/{trendyol,wix,shopify}/products.ts`; `pages/api/{etsy,ebay}-drafts/*`; `lib/etsy/draftClient.ts`, `lib/ebay/draftClient.ts`, `lib/etsy/draftService.ts` (L1950 price/qty routing), `lib/etsy/seoRules.ts`; `components/{etsy,ebay}/{ScheduledUpdateDialog,SmartPricing,BackupManager,DuplicateDetector,FindReplaceDialog,BulkOperationsBar,SEOIndicator}.tsx`, `components/trendyol/listings/*`, `components/wix/WixBulkOperationsBar.tsx`; `prisma/schema.prisma` (`EtsyListing`, `EbayListing`, `TrendyolProduct`, `WixProduct`, `ShopifyProduct`, `EtsyListingDraft`, `EbayListingDraft`, `CronLock`); `lib/cron/idempotency.ts`.

---

## 0. What is wrong today (verified in code)

| # | Problem | Where |
|---|---|---|
| 1 | Five layouts for one job: Etsy and eBay have a left rail, Trendyol a search card, Wix a rail with a blue pill, Shopify a bare grid | the 5 route files |
| 2 | Four score visuals: Etsy outline box (`SEOIndicator`), eBay ring, Trendyol letters A+…F computed from a 0–100 number (`calculateTrendyolHealth`, L181), Wix filled square (`gradeColor`, L140). Shopify has none | route files |
| 3 | Two sync concepts on one Etsy screen: "Sync" (pull) next to "Sync all (7)" (push) | `etsy-listings.tsx` |
| 4 | Every list loads the whole shop into the browser. `cached_listings` returns all rows with full descriptions, and Etsy additionally pages through the live Etsy API (`listings_with_images`, L1421) | `clawd/etsy.ts` L3636, `clawd/ebay.ts` L2167 |
| 5 | Inline price/qty edit on an Etsy listing with variations is staged, then **fails at send** with `INVENTORY_PATCH_REQUIRED`. The cache does not know a listing has variations | `draftService.ts` L1966 |
| 6 | "Scheduled updates" live in `localStorage` (`etsy_scheduled_updates`, `ebay_scheduled_updates`) and are executed by a client hook (`useScheduledUpdateExecutor`) **only while a tab is open**, writing live to the marketplace and bypassing drafts and conflict checks | `components/{etsy,ebay}/ScheduledUpdateDialog.tsx` L60–150 |
| 7 | "Backups" are `localStorage` snapshots (lost on another device, capped). "Smart pricing" rules are `localStorage` too and never run server-side | `BackupManager.tsx`, `SmartPricing.tsx` |
| 8 | Wix price/stock edits are staged only in React state: a reload loses them. Shopify and Trendyol edits go live per save | `wix-urunler.tsx` L854, `shopify-urunler.tsx` L786 |
| 9 | Stats strip shows lifetime views and favorites totals summed client-side (`quickStats`, L1682). It shows no time window, and nothing can be done with it | `etsy-listings.tsx` L2813 |
| 10 | Column header "Filter by St…" (Trendyol), per-row pencil, copy and red trash icons (eBay), "View: Compact/Detailed/All" (Etsy) | route files |

---

## 1. Decisions

### 1.1 Decisions for this surface

| Question | Decision | Why |
|---|---|---|
| Filter rail or filter bar | **Filter bar (DS `Toolbar`). Every rail is deleted.** At most 3 pinned `FilterButton`s, and the rest go in `FiltersSheet` | DS §3.3. A rail takes 240px out of a 1440px table that needs 10 columns, and on a phone it turns into a drawer that hides the result. Sections, collections and categories are long lists, so a searchable `FilterButton` handles them better than a rail |
| Stats strip | **Removed.** Counts move into `SavedViews` (each view shows its count) and the PageHeader count pill | The current strip shows lifetime totals with no window or source (P6). The counts a seller acts on (not sent, failed, needs work, sold out) become views that open the rows behind the number |
| Sync model | **One concept: staged changes.** The visible unit is "N changes not sent yet". Push is the page primary "Send N changes to {marketplace}". Pull is `SyncMeta` in the PageHeader meta. Failures and conflicts are a sync pill on the row, a saved view and at most one inline `Banner` | DS P1 and glossary §3.19. The words "Sync", "Sync all" and "Sync from" are banned |
| What N counts | N = **listings with an unsent draft** (one draft per listing, as today), excluding drafts in `syncing`. The bulk editor's "37 changes" (cells) is a different number on a different surface; see §11, open item 1 | Matches `EtsyListingDraft` and `EbayListingDraft`, one row per listing |
| Score column | **`ScoreMeter variant="cell"`**, label "Health". The value is read from a stored column (§9.3) so sort and the "Needs work" view work server-side | DS §3.10. Letters, rings and boxes are deleted. Trendyol uses its existing 0–100 `overall` number directly, so no letter conversion is needed |
| Pagination | Server-side, 50/100/250, as DS §3.4 requires. One new read endpoint, `GET /api/listings` (§9.1) | Shops have up to 5,000 listings, and the page stops pulling the live Etsy API on load |
| Inline edit | Price and Qty are `money-edit` / `int-edit`. A cell is **read-only with a reason** when the listing has variations ("Edit prices per variation in the editor") | Prevents the staged-then-fails case (§0 #5) |
| Per-marketplace differences | One `ListingsConfig` object per marketplace (§3): columns, filters, views, row actions, bulk actions, tools, send wording. **No marketplace-specific JSX in `ListingsPage`** | DS P4 |
| Tools | PageHeader `⋯`: Find & replace · Find duplicates · Import CSV · Export CSV · Scheduled sends. Smart pricing and Backups are **dropped**. eBay "Templates" moves into the eBay creator (outside this surface) | Requested scope. Every tool stages drafts, so none of them writes live |
| Scheduled updates | **Rebuilt as "Schedule send"**: a staged draft gets `scheduledSendAt`, and a server cron sends it through the same executor (conflict check included). The `localStorage` executors are deleted | §0 #6 is a data-loss and safety bug |
| Wix / Shopify / Trendyol staging | **New generic `CatalogDraft`** table and `/api/catalog-drafts` (§9.4), so all five marketplaces stage in the database the same way | One sync concept needs one storage concept. Their flags flip only after this lands |
| Quick view | `Enter` or a row click opens the `SidePanel` (md 560) quick view. `e` or the ✎ icon opens the full editor | DS §6.2 |
| Shop switching | Shop or site lives in the TopBar breadcrumb (`Listings / [E] Etsy / Belle Couture Gifts ▾`) and in the URL `?shop=` | DS §3.1. It is no longer a select inside the page |

### 1.2 Additions to the system (justified)

1. **Two listing status keys**, added to the DS §3.9 table and to `lib/ds/status/listings.ts`:
   | Domain | Key | EN / TR | Tone |
   |---|---|---|---|
   | listing | `in_review` | In review / Onay bekliyor | info |
   | listing | `rejected` | Rejected / Reddedildi | danger |
   
   Why: Trendyol stores `approved=false` (waiting for approval) and `rejected` / `blacklisted` (refused, with `rejectReasons`) as real product states. Mapping them to `draft` or `inactive` would hide the reason a product isn't selling, which breaks P6 (honest data). The raw reason text goes in the pill tooltip. No other marketplace uses these keys today.
2. **None else.** Every other element on this page is an existing DS component used as specified.

---

## 2. Information architecture

```
Page width="list" title="{Marketplace} listings · KolayXport"
├─ PageHeader
│   title "Etsy listings"  count pill (total in shop, all states)
│   meta  SyncMeta "Refreshed from Etsy 10 min ago ⟳"   (pull)
│   secondary  [New listing]  [Bulk edit]                    (≤ 2)
│   overflow ⋯ Tools: Find & replace · Find duplicates · Import CSV · Export CSV · Scheduled sends
│   primary   [Send 7 changes to Etsy]  when N > 0 (otherwise "New listing" is promoted to primary)
├─ Banner (danger, at most one, only when failed + conflict > 0)
│   "2 listings couldn't be sent. 1 changed on Etsy since your draft."  [Show them]
├─ Toolbar   (BulkActionBar replaces this row in place when rows are selected)
│   SearchField · FilterButton ×3 (per config) · Filters (sheet) · SavedViews · density
│   ActiveFilterChips + "Clear all"                                    result count
├─ DataTable (columns from config; cards below 900px)
│   pagination footer "1–50 of 312   Rows 50 ▾   ‹ 1 2 … 7 ›"
├─ SidePanel (quick view, overlay; list stays mounted)
└─ Tool panels (SidePanel lg) / Modals (short forms)
```

Rules in force: one primary per view (P1). When rows are selected, the BulkActionBar primary is the view primary and the header primary is demoted to secondary. If N > 0 at that moment, "Send N changes" stays reachable as the first header secondary and in ⌘K. Destructive actions sit only in `⋯` menus.

---

## 3. Per-marketplace configuration (the only place marketplaces differ)

```ts
// components/domain/listings/config/types.ts
type ListingsConfig = {
  marketplace: 'etsy'|'ebay'|'trendyol'|'wix'|'shopify';
  route: string;                       // existing route, unchanged
  storeParam: 'shop'|'site'|null;      // ?shop= / ?site= in the URL
  columns: ListingColumnKey[];         // order = default order
  hiddenByDefault: ListingColumnKey[];
  filters: FilterDef[];                // first 3 pinned
  views: BuiltInViewKey[];
  rowInlineAction: 'edit';
  rowActions: RowActionKey[];
  bulkPrimary: BulkActionKey;
  bulkActions: BulkActionKey[];        // visible, max 4
  bulkOverflow: BulkActionKey[];
  tools: ToolKey[];
  inlineEdit: { price: boolean; qty: boolean };
  drafts: 'etsy'|'ebay'|'catalog';     // which staging adapter (§9.4)
  editorHref(id): string;              // full editor route
  externalUrl(row): string|null;       // "View on Etsy"
};
```

| | Etsy | eBay | Trendyol | Wix | Shopify |
|---|---|---|---|---|---|
| Store switch | `?shop=` (EtsyShop.shopId) | none (one account) | none (one supplier) | `?site=` (WixSite.id) | `?shop=` (ShopifyShop.id) |
| Default columns | select, thumb, listing, price, qty, status, changes, health, updated | + condition | + brand | + collection | + variants |
| Hidden by default (Columns menu) | section, views (all time), favorites (all time), created | category, format, created | category, list price, barcode, created | visible in store, ribbon, created | vendor, product type, compare-at price, created |
| Pinned filters | Status · Section · Health | Status · Condition · Health | Status · Category · Health | Status · Collection · Health | Status · Product type · Health |
| Sheet filters | Has video, Personalizable, Photos (< 5 / 5–9 / 10+), Stock (in / out), Price range | Category, Format, Photos, Stock, Price range | Brand, Photos, Stock, Price range, Approval | Visible, Photos, Stock, Price range | Vendor, Photos, Stock, Price range |
| Inline price / qty | yes / yes (read-only when `hasVariations`) | yes / yes | yes / yes (sale price) | yes / yes (read-only when variants > 1 or not tracked) | yes / yes (read-only when `variantCount > 1`) |
| Tools | all 5 | all 5 | all 5 | all 5 | all 5 |
| Cross-list bulk / row action | Copy to eBay | Copy to Etsy | Copy to eBay (R4 arbitrage prefill, later) | none | none |
| Send wording key | `listings.send.cta` with `{marketplace}` select (§10) | same | same | same | same |

Status mapping (`lib/ds/status/listings.ts`, pure function `listingStatus(row, marketplace)`, unit-tested):

| Marketplace | Raw | Key |
|---|---|---|
| Etsy | `state` active / draft / inactive / expired / sold_out | `active` / `draft` / `inactive` / `expired` / `sold_out` |
| eBay | `status` PUBLISHED and quantity > 0 · PUBLISHED and quantity 0 · ENDED · anything else (DRAFT, UNPUBLISHED) | `active` · `sold_out` · `inactive` · `draft` |
| Trendyol | `rejected` or `blacklisted` · `!approved` · `archived` · `onSale` and quantity 0 · `onSale` · otherwise | `rejected` · `in_review` · `inactive` · `sold_out` · `active` · `inactive` |
| Wix | `!visible` · `!inStock` or (`trackInventory` and quantity 0) · `visible` | `inactive` · `sold_out` · `active` |
| Shopify | `status` archived · draft · active and tracked and `totalInventory` 0 · active | `inactive` · `draft` · `sold_out` · `active` |

Before coding, run `SELECT status, count(*) FROM "EbayListing" GROUP BY 1;` (and the same for Shopify `status`) on the Hetzner DB to confirm the raw values. The eBay page only compares against `PUBLISHED` today (L1151), so the full value set is unverified.

---

## 4. Columns (one master list; config picks)

| Key | Header (i18n) | DS type | Width | Align | Sort | Mobile role | Etsy | eBay | Trendyol | Wix | Shopify |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `select` | — | checkbox | 40 | | | hidden (Select mode) | | | | | |
| `thumb` | — | `thumb` 48 | 64 | | | `media` (64) | `thumbnailUrl170x135` ?? `75x75` | `imageUrl` | `thumbnailUrl` | `thumbnailUrl` | `thumbnailUrl` |
| `listing` | Listing | text: title (2 lines) + mono meta | flex ≥ 320 | left | title | `title` + meta → `subtitle` | title · meta `ID {etsyListingId}` (+ `· SKU` when `skus[0]`, §9.3) | title · `SKU {sku}` | title · `{barcode}` · `{stockCode}` | title · `{sku}` | title · `{handle}` |
| `price` | Price | `money-edit` | 112 | right | yes | `trailing` | `priceAmount/priceDivisor` `priceCurrencyCode` | `priceValue` `priceCurrency` | `salePrice` `currencyType` | `discountPrice ?? price` `currency` | `price` `currency`; "from" prefix when variants > 1 |
| `qty` | Qty | `int-edit` | 72 | right | yes | `trailing` (joined "· 42 in stock") | `quantity` | `quantity` | `quantity` | `quantity` (shows "Not tracked" when `!trackInventory`) | `totalInventory` |
| `status` | Status | `status` (listing) | 112 | left | | `status` | §3 map | | | | |
| `changes` | Changes | `status` (sync) | 120 | left | | `status` (second pill) | from draft join (§9.1 `sync`) | | | | |
| `health` | Health | `score` | 96 | right | yes | `meta` | `healthScore` column (§9.3) | | | | |
| `updated` | Updated | `date` relative | 88 | right | yes (default desc) | hidden | `etsyUpdatedTimestamp` | `ebayUpdatedAt` | `trendyolLastUpdate` | `wixUpdatedDate` | `shopifyUpdatedAt` |
| `section` | Section | text | 140 | | | hidden | `shopSectionId` → section name | | | | |
| `condition` | Condition | text (i18n map) | 120 | | | hidden | | `condition` | | | |
| `category` | Category | text | 160 | | | hidden | | `categoryName` | `categoryName` | | |
| `format` | Format | text | 100 | | | hidden | | `format` | | | |
| `brand` | Brand | text | 120 | | | hidden | | | `brandName` | | |
| `listPrice` | List price | `money` | 100 | right | | hidden | | | `listPrice` | | |
| `collection` | Collection | text (first + "+2") | 160 | | | hidden | | | | `collectionIds` → names | |
| `visible` | Visible in store | text Yes/No | 100 | | | hidden | | | | `visible` | |
| `variants` | Variants | number | 80 | right | | hidden | | | | variants length | `variantCount` |
| `vendor` / `productType` | Vendor / Product type | text | 140 | | | hidden | | | | | `vendor` / `productType` |
| `compareAt` | Compare-at price | `money` | 110 | right | | hidden | | | | `price` when discounted | `compareAtPrice` |
| `views` / `favorites` | Views (all time) / Favorites (all time) | number | 96 | right | yes | hidden | `views` / `numFavorers` | | | | |
| `created` | Created | `date` | 96 | right | yes | hidden | `etsyCreatedTimestamp` | `ebayCreatedAt` | `trendyolCreatedDate` | `wixCreatedDate` | `shopifyCreatedAt` |
| `actions` | — | inline ✎ + `⋯` | 72 | | | `action` = none; `⋯` top-right of card | | | | | |

Cell rules:
- **Draft overlay.** When a row has an unsent draft that changes price, qty or title, the cell shows the **draft value** with the attention tint and left bar (`dirtyCells`). The tooltip reads "On Etsy: $64.00". The live value never hides a staged one.
- **Read-only edit cells** show the value with no hover affordance and a tooltip giving the reason (`listings.cell.variationsReadOnly`, `listings.cell.notTracked`).
- `ScoreMeter` `null` renders `—` with the tooltip "Not scored yet · refresh to score". Its tooltip otherwise reads "Listing health 78 · Good · Scored on 9 of 12 checks".
- `changes` shows **at most one** sync pill: `pending` / `syncing` / `sync_failed` / `conflict` / `synced` (24 h, from `syncedAt`). Empty means nothing is staged. The pill tooltip for `sync_failed` is the i18n mapping of `lastSyncError` via `draftErrorI18n` (`seoRules.ts` L486), and raw error text never shows. A queued delete adds the meta line "Will be deleted on send" in `danger-fg` under the title, not a second pill.
- Money goes only through `Money` (narrowSymbol, row currency) and dates only through `DateText`. Titles are entity-decoded at the mapper (`decodeEntities`, DS P5).

---

## 5. Saved views and filters

Built-in views (DS §3.3), the same keys on every marketplace (a view hides when it can never match, e.g. `expired` outside Etsy):

| View key | Label EN / TR | Query | Count source |
|---|---|---|---|
| `all` | All / Tümü | — | `counts.all` |
| `active` | Active / Yayında | status=active | `counts.status.active` |
| `not_sent` | Changes not sent / Gönderilmeyenler | sync ∈ pending | `counts.sync.pending` |
| `send_failed` | Send failed / Gönderilemeyenler | sync ∈ sync_failed, conflict | `counts.sync.failed + conflict` |
| `needs_work` | Needs work / Geliştirilmeli | health < 50 | `counts.needsWork` |
| `sold_out` | Sold out / Tükenenler | status=sold_out | `counts.status.sold_out` |
| `inactive` | Inactive / Pasif | status ∈ inactive, draft, expired | sum |
| `review` (Trendyol only) | In review or rejected / Onay ve red | status ∈ in_review, rejected | sum |

The default view is `active` for Etsy (today's default `statusFilter='active'`) and `all` elsewhere. "Save view" stores the current query; v1 saves into `localStorage` keyed by marketplace, guarded with try/catch, as a per-viewer convenience. Server persistence comes later in the DS.

Health filter options: Needs work (< 50) · Fair (50–74) · Good (75–89) · Great (90+) · **Missing photos** · **Missing tags** (Etsy, Shopify) · **No video** (Etsy) · **Short title**. These replace the 7 ad-hoc `healthFilter` values in `etsy-listings.tsx` L1078; the check-based ones read `healthFails` (§9.3).

URL state (`useUrlState`): `?shop=&view=&q=&status=&section=&health=&f.<key>=&sort=updated.desc&page=1&size=50&open=<listingId>&tool=<findReplace|duplicates|import|scheduled>`. A reload restores everything, including an open quick view or tool panel.

---

## 6. Wireframes

### 6.1 Desktop 1440, default (nothing staged, Etsy)

```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Listings / [E] Etsy / Belle Couture Gifts ▾                 [⌘K Search or jump…]     (bell) (TS)  │ TopBar 52
│ (240)    ├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ Etsy listings [312]                                          [Bulk edit]   ⋯   [+ New listing]    │ title row 56
│ Listings │ Refreshed from Etsy 10 min ago ⟳                                                                  │ meta
│  [E] Etsy│                                                                                                    │ 16
│  [e] eBay│ [⌕ Search title, tag, ID…  /] [Status: Active ▾] [Section: All ▾] [Health: All ▾] [Filters]        │ Toolbar 32
│  [T] …   │                                                        View: [Active 248 ▾]  [≡ Density]  248 results│
│          │ ┌──┬──────┬──────────────────────────────────┬─────────┬──────┬──────────┬─────────┬─────────┬──────┬──────┐│
│          │ │☐ │      │ Listing                          │   Price │  Qty │ Status   │ Changes │  Health │ Upd. │      ││ header 36
│          │ ├──┼──────┼──────────────────────────────────┼─────────┼──────┼──────────┼─────────┼─────────┼──────┼──────┤│
│          │ │  │[img] │ Personalized Baby Blanket, Custom│  $69.99 │   42 │ ● Active │         │▰▰▰▰▱ 78 │ 2 h  │      ││ 44
│          │ │  │ 48   │ Name Blanket, Newborn Gift…      │         │      │          │         │         │      │      ││
│          │ │  │      │ ID 1488223311 · BB-PINK          │         │      │          │         │         │      │      ││
│          │ │  │[img] │ Wooden Keepsake Box, Engraved…   │  $54.00 │    0 │ ● Sold   │         │▰▰▰▱▱ 61 │ 1 d  │ ✎  ⋯ ││ hover
│          │ │  │      │ ID 1490012234                    │         │      │   out    │         │         │      │      ││
│          │ │  │[img] │ Name Necklace Gold               │ from    │   —  │ ● Active │         │▰▱▱▱▱ 34 │ 3 d  │      ││
│          │ │  │      │ ID 1477011200 · 4 variations     │  $38.00 │  (?) │          │         │         │      │      ││ read-only
│          │ └──┴──────┴──────────────────────────────────┴─────────┴──────┴──────────┴─────────┴─────────┴──────┴──────┘│
│          │ 1–50 of 248                                                         Rows 50 ▾      ‹ 1 2 3 4 5 ›   │ footer
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘
⋯ (header) = Find & replace · Find duplicates · Import CSV · Export CSV · Scheduled sends
⋯ (row)    = Open quick view (Enter) · View on Etsy ↗ · Copy listing · Copy to eBay · ─ · Deactivate · Renew (expired only) · ─ · Delete listing… (danger)
```

### 6.2 Desktop 1440, staged changes plus one failure (Etsy)

```
│ Etsy listings [312]                                [+ New listing] [Bulk edit]  ⋯  [➤ Send 7 changes to Etsy] │ primary
│ Refreshed from Etsy 10 min ago ⟳                                                                               │
│ ┌ ⚠ 2 listings couldn't be sent · 1 changed on Etsy since your draft                       [Show them] ┐     │ danger Banner
│ └────────────────────────────────────────────────────────────────────────────────────────────────────────┘     │
│ [⌕ Search…  /] [Status: All ▾] [Section: All ▾] [Health: All ▾] [Filters]     View: [All 312 ▾]   312 results │
│ ┌──┬──────┬──────────────────────────────────┬──────────┬──────┬──────────┬────────────────┬─────────┬──────┬──────┐│
│ │  │[img] │ Wooden Keepsake Box, Engraved…   │▌ $49.00 ▒│▌ 12 ▒│ ● Sold   │ ● Not sent yet │▰▰▰▱▱ 61 │ 1 d  │      ││ dirty cells
│ │  │      │ ID 1490012234                    │ (On Etsy │      │   out    │                │         │      │      ││ tooltip
│ │  │      │                                  │  $54.00) │      │          │                │         │      │      ││
│ │  │[img] │ Name Necklace Gold               │  $38.00  │  120 │ ● Active │ ● Send failed ⓘ│▰▱▱▱▱ 34 │ 3 d  │      ││
│ │  │[img] │ Baby Name Sign, Nursery Decor    │  $29.00  │   18 │ ● Active │ ● Changed on   │▰▰▰▰▰ 92 │ 5 h  │      ││
│ │  │      │ ID 1450002291                    │          │      │          │   Etsy         │         │      │      ││
│ │  │[img] │ Old Christmas Ornament           │  $12.00  │    3 │ ● Inactive│ ● Not sent yet│▰▰▱▱▱ 45 │ 9 d  │      ││
│ │  │      │ ID 1401100022 · Will be deleted on send (danger-fg)                                                ││
│ └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘│
```
- **Send N** sends every `draft` / `failed` draft for the shop, in chunks of ≤ 500 through the existing `POST /api/etsy-drafts/bulk-sync`. It **excludes** `conflict` drafts and drafts with a queued `delete`. When drafts were excluded, a confirm summarises first: "Send 5 changes to Etsy? 1 listing changed on Etsy and 1 deletion will wait for you to review them." (`useConfirm`). The deletion is sent only from the row `⋯` "Send deletion…", with `typeToConfirm` set to the shop name (DS §3.6 and the CLAUDE.md caution about queued deletes).
- While sending, the primary shows `loading` "Sending 7 changes…" and the rows switch to `syncing`. The result is a toast: "6 changes sent to Etsy · 1 failed" (`Retry` action), and the Banner updates.
- Row `⋯` on a draft row adds: **Review differences** (conflict → editor conflict view) · **Send this change** · **Schedule send…** · **Discard changes** (confirm).

### 6.3 Desktop, selection (BulkActionBar replaces the Toolbar row)

```
│ Etsy listings [312]                                [Send 7 changes to Etsy] [Bulk edit]  ⋯   (no solid header primary) │
│ Refreshed from Etsy 10 min ago ⟳                                                                                     │
│ 24 selected   [Edit in grid] [Change price] [Add tags] [✦ Improve with AI]   ⋯   · Select all 248 in this view · Clear Esc │ 32, sticky z20
│ ┌──┬──────┬───────────────────────────┬ … rows with ☑, accent-50 + 2px accent bar …                                     │
```
- `Edit in grid` is the bar primary (solid). It goes to `/app/etsy-listings/bulk?ids=…` (BulkGrid, DS §3.17). When "Select all in this view" is on, it goes to `?view=…&q=…` instead, so the ids are not put in the URL.
- **Change price** opens a Modal (sm, 3 fields): Mode [Set to · Increase by % · Decrease by % · Increase by amount · Decrease by amount], Value (`MoneyField` or %), Round to [.99 · .00 · none]. The footer previews "24 listings · $38.00 → $41.80 (example)", and the primary is "Stage 24 price changes". Variation listings are skipped and counted: "3 listings with variations skipped: change them in the grid".
- **Add tags** opens a Modal (sm): a `TagInput` (Etsy 13 × 20 chars, eBay none, Shopify unlimited) and Mode [Add · Remove · Replace all]. It previews "6 listings would go over 13 tags, so extra tags are not added". The primary is "Stage tag changes".
- **Improve with AI** opens the BulkGrid with AI suggestions staged as dirty cells (DS §3.17). There is no live write.
- Bar `⋯`: Copy to eBay · Send selected changes (when any selected row has a draft) · Discard selected changes · Export selected (CSV) · ─ · Deactivate · Activate · Renew · ─ · Delete 24 listings… (danger, `typeToConfirm` = "24" when more than 10). Every item stages. Deletes stage `queuedActions: [{type:'delete'}]` and still need the explicit send.
- Bulk sets per marketplace: Etsy and eBay as above. Trendyol: Change price, Change stock, Archive (no tags). Wix: Change price, Change stock, Show / Hide in store, Add to collection. Shopify: Change price, Add tags, Set status.

### 6.4 Desktop, quick view (SidePanel md 560, `?open=1490012234`)

```
                                     ┌──────────────────────────────────────────────── 560 ┐
                                     │ [img96] Wooden Keepsake Box, Engr…  ● Sold out  ‹ › ⋯ ✕│ header 56
                                     │ ID 1490012234 · Etsy · Updated 1 d ago · View on Etsy ↗│
                                     ├────────────────────────────────────────────────────────┤
                                     │ Photos                                     6 / 20  Edit│
                                     │ [1][2][3][4][5][6]                                      │ Thumb 64 row
                                     │ ───────────────────────────────────────────────────────│
                                     │ Price & stock                                           │
                                     │ Price [$ 49.00 ]▒    Quantity [ 12 ]▒                   │ FormField, staged
                                     │ On Etsy: $54.00 · 0                                     │ caption
                                     │ ───────────────────────────────────────────────────────│
                                     │ Listing health        61 / 100  Fair   9 of 12 checks   │ ScorePanel
                                     │ ✕ Only 6 photos: add 4 more        +8   [Add photos]    │ → editor #photos
                                     │ ✕ 4 tags missing                   +6   [Get tag ideas] │ → Keyword explorer panel
                                     │ ✓ Title 132 / 140                                       │
                                     │ ───────────────────────────────────────────────────────│
                                     │ Edits not sent (2)                                      │
                                     │ · Price $54.00 → $49.00   · Quantity 0 → 12             │ from draft fieldPatch
                                     ├────────────────────────────────────────────────────────┤
                                     │ ⋯ More     Saved · 2 edits not sent     [Open editor] [Send changes to Etsy] │ footer 64
                                     └────────────────────────────────────────────────────────┘
```
- The panel primary is "Send changes to Etsy" (glossary §3.19; this listing's draft) when a draft exists, otherwise "Open editor". The secondary is "Open editor" or "Discard changes". The panel's `⋯` has the same items as the row `⋯`.
- Edits in the panel autosave to the draft on blur, with no live write (feedback rule: autosave stays local). `⌘S` saves now, and `⌘↵` sends.
- `‹ ›` and `j`/`k` move within the current page of results. Moving past the last row loads the next page.
- For a conflict the panel opens with the warning `Banner` "This listing changed on Etsy after your draft started. [Review differences]", and the primary becomes "Review differences" (it opens the editor's conflict review). Send is disabled with a reason.

### 6.5 Mobile 390

```
┌──────────────────────────────────┐
│ Etsy listings        ⌕   + New ⋯ │ TopBar 48 (top-level page: no back chevron; shell-nav §4.1 slot rule, CRITIQUE C2) · ⋯ = Tools + shop switch (Bulk edit is desktop only, not listed)
├──────────────────────────────────┤
│ Refreshed 10 min ago ⟳           │ caption, 44px tap target on ⟳
│ ⚠ 2 couldn't be sent   Show them │ Banner (one line)
│ [Active 248][Not sent 7][Faile…]→│ SavedViews chips, h-scroll (only allowed h-scroll)
│ [⌕ Search listings    ] [Filters]│ 44px, 16px text
│ 248 results               Select │
│ ┌──────────────────────────────┐ │
│ │[img] Personalized Baby Bl… ⋯ │ │ media 64 · title · ⋯
│ │ 64   ID 1488223311           │ │ subtitle
│ │      $69.99 · 42 in stock    │ │ trailing
│ │      ● Active    ▰▰▰▰▱ 78    │ │ status · meta(health)
│ └──────────────────────────────┘ │ 8px gap
│ ┌──────────────────────────────┐ │
│ │[img] Wooden Keepsake Box   ⋯ │ │
│ │      ID 1490012234           │ │
│ │      $49.00▒ · 12 in stock▒  │ │ dirty tint on the values
│ │      ● Sold out ● Not sent   │ │ max 1 listing + 1 sync pill
│ └──────────────────────────────┘ │
│ [ Load more ]                    │ mobile: load more, page size 50
├──────────────────────────────────┤
│ 7 changes not sent yet           │ StickyActionBar (only N > 0)
│ [    Send 7 changes to Etsy    ] │ 48px
├──────────────────────────────────┤
│ Overview Orders Listings Msgs More│ tab bar 56 + safe area
└──────────────────────────────────┘
```
- **Tap a card** to open the quick view as a full-height sheet with a 50/50 footer at 48px: [Open editor] [Send to Etsy] (the short form is allowed only in a 48px mobile half-width button, as in listing-editor §3.4).
- **Select mode** (tap "Select") shows checkboxes on the cards. The StickyActionBar becomes "3 selected · [⋯ More] [Change price]". The bar's ⋯ opens a sheet with Add tags, Improve with AI, Copy to eBay, Deactivate and Delete…. "Edit in grid" is not offered below 900px (DS §3.17).
- **Filters** opens a BottomSheet with every filter of the config (pinned ones first) and a 50/50 footer: [Clear] [Show 248 results].
- Inline cell editing is desktop only. On mobile, price and qty are edited in the quick-view sheet.
- The cards have no swipe actions and no long-press, and the page has no FAB.

### 6.6 Per-marketplace column deltas (desktop header rows only; the layout is identical)

```
eBay      │☐│img│ Listing             │ Price │ Qty │ Status │ Changes │ Condition │ Health │ Upd. │   │
Trendyol  │☐│img│ Listing             │ Price │ Qty │ Status │ Changes │ Brand     │ Health │ Upd. │   │   Status may read ● In review / ● Rejected ⓘ
Wix       │☐│img│ Listing             │ Price │ Qty │ Status │ Changes │ Collection│ Health │ Upd. │   │
Shopify   │☐│img│ Listing             │ Price │ Qty │ Status │ Changes │ Variants  │ Health │ Upd. │   │
```

---

## 7. States

Every async region uses `useAsyncState` (skeleton after 200 ms, "Still loading… Retry" at 15 s, `ErrorState` at 30 s).

| State | Trigger | What renders |
|---|---|---|
| **Loading** (first) | `GET /api/listings` pending | PageHeader with the title only (count pill and meta as 16px skeleton blocks), Toolbar fully interactive, `TableSkeleton rows=8 thumb`. Mobile: `CardListSkeleton` ×5 |
| **Loading** (page, sort or filter change) | refetch with previous data | Keep the old rows at 60% opacity and disable the pagination buttons. No skeleton flash (SWR `keepPreviousData`) |
| **Slow** | 15 s | Inline in the table body: "Still loading… [Retry]" |
| **Error** (no data) | 30 s or a 5xx | `ErrorState variant="page"`: "Couldn't load your Etsy listings" · cause from the error code ("KolayXport's server didn't respond") · [Try again] · Copy error ID |
| **Stale** (data present, refetch failed) | refetch error | `ErrorState variant="stale"` above the table: "Showing listings from 10:42 · Retry". Rows stay usable, and edits still stage |
| **Not connected** | `useConnections` says not connected | `ConnectState brand="etsy"` replaces the body: "Connect Etsy to see your listings" [Connect Etsy]. PageHeader shows the title only (no actions, no meta) |
| **Reconnect needed** | token invalid | warning `Banner` "Etsy needs to be reconnected to refresh or send changes" [Reconnect Etsy]. The cached list still renders. Send and pull are disabled with that reason as `disabledReason`, and staging still works |
| **Couldn't check** | connection check failed | neutral `Banner` "Couldn't check Etsy · Retry". The list still renders. **Never** "Not connected" |
| **Connected, never pulled** | 0 rows and `lastPulledAt` null | `EmptyState first-use` with the Etsy LogoTile: "Bring in your Etsy listings" · "We'll copy them so you can edit and score them. Nothing changes on Etsy." [Refresh from Etsy] (the only time pull is a button) |
| **Pulling** | pull in progress | `SyncMeta state="pulling"`: "Refreshing from Etsy…" with the spinner in the ⟳ icon. No banner and no overlay. Rows refresh when it finishes, and a toast "312 listings refreshed" appears only if the count changed |
| **Pull failed** | pull endpoint error | `SyncMeta state="failed"`: "Couldn't refresh from Etsy · Retry" in `danger-fg` caption, while the data stays |
| **Shop has 0 listings** | pulled and empty | `EmptyState first-use`: "No listings in Belle Couture Gifts yet" [+ New listing] |
| **No results** | filters match nothing | Inside the table frame: `EmptyState no-results` "No listings match these filters" [Clear filters] |
| **Done** views | `not_sent` / `send_failed` / `needs_work` empty | `EmptyState done`: "Everything has been sent to Etsy" / "No failed sends" / "No listings need work" (quiet check icon, no action) |
| **Partial: score missing** | `healthScore` null (never scored) | cell `—` with tooltip. Health sort puts nulls last, and the `needs_work` count excludes them, with a SourceNote-style caption under the view menu: "12 listings not scored yet" |
| **Partial: send result mixed** | bulk send with failures | rows carry their own pill, plus toast "6 sent · 1 failed [Retry failed]" and the Banner |
| **Partial: Trendyol batch pending** | Trendyol price/stock is an async batch | row pill `syncing` until `batch_status` resolves (polled by the executor, §9.4). A page leave doesn't cancel it |
| **Partial: missing image** | no thumbnail | `Thumb` package glyph, never "-" |
| **Sending** | send in progress | primary `loading` keeps its width with "Sending 7 changes…". Rows switch to `syncing`, and inline edit on a syncing row is disabled with reason "Sending to Etsy…" |
| **Usage limit** | 402 or limit error from send | warning `Banner` above the table "You've reached this month's limit · See plans" (`See plans` hidden when `!stripeUpsell`); Send is disabled with that `disabledReason`; no toast; the global `LimitReachedDialog` is suppressed on this route. Same pattern as orders.md §6.4 (CRITIQUE C6) |

---

## 8. Interactions and keyboard

- `/` focuses search (debounce 250 ms, writes `?q=`). `j`/`k`/`↑`/`↓` move the focused row. `x` toggles selection, `⌘A` selects the page, `Esc` clears the selection or closes the panel. `Enter` opens the quick view and `e` opens the full editor. In a panel, `⌘S` saves and `⌘↵` runs the panel primary. `?` shows the sheet. Keys match on `key` and are input-aware (DS P3).
- **Inline edit:** click a price or qty cell, or press `Enter` on a focused editable cell, to make it an input. `Enter`/`Tab` commits by staging the draft, and `Esc` cancels. Validation: price > 0 with at most 2 decimals (Etsy ≥ 0.20 USD-equivalent: `validate` returns "Etsy's minimum price is $0.20"), qty an integer 0–999 (Etsy) or ≥ 0 elsewhere. An invalid value keeps the input open with a danger border and a tooltip, and nothing is staged.
- **Optimistic staging:** the dirty tint appears at once, the N count increments, and on a stage error the cell reverts with toast "Couldn't save this change · Retry".
- **Discard:** row `⋯` → "Discard changes" asks for confirmation ("Discard 2 unsent changes to 'Wooden Keepsake Box'?"), then toasts "Changes discarded · Undo" for 6 s. Undo re-stages from the cached patch.
- **Leaving the page** with a cell in edit mode commits on blur first. Staged drafts are already persisted, so no leave guard is needed (the old Wix in-memory staging needed one; it is gone).
- **Pull while drafts exist** is allowed. Drafts keep their base snapshot, and conflicts are detected at send (existing behaviour), surfacing as the `conflict` pill.
- **Column menu** ("Columns" in the density control popover) toggles hideable columns, persisted per marketplace in `columnStateKey` = `listings.<marketplace>.columns` (localStorage, try/catch).
- **⌘K** (`usePageActions`) registers: Send N changes, Refresh from Etsy, New listing, Bulk edit, the 5 tools, Switch shop and every saved view ("Go to view: Needs work").

---

## 9. Data and APIs

### 9.1 New read endpoint: `GET /api/listings` (the one list API for all five)

`pages/api/listings/index.ts`, auth via the existing session helper. It reads **only the DB caches** and never calls a marketplace.

Query: `marketplace` (required) · `store` (shopId / siteId / shopifyShopId; defaults to the first) · `q` · `status` (csv of listing keys) · `sync` (csv of sync keys) · `health` (`lt50|50-74|75-89|gte90|missing_photos|missing_tags|no_video|short_title`) · marketplace filters (`section`, `condition`, `category`, `brand`, `collection`, `productType`, `vendor`, `hasVideo`, `personalizable`, `photos`, `stock`, `priceMin`, `priceMax`, `visible`, `format`) · `sort` (`updated|title|price|qty|health|views|created` + `.asc|.desc`) · `page` (1-based) · `size` (50|100|250).

Response:
```ts
type ListingsResponse = {
  rows: ListingRow[];
  total: number;                         // after filters
  counts: {                              // for the count pill and SavedViews (one grouped query each)
    all: number;
    status: Partial<Record<ListingStatusKey, number>>;
    sync: { pending: number; syncing: number; failed: number; conflict: number; queuedDeletes: number };
    needsWork: number; unscored: number;
  };
  store: { id: string; name: string; currency: string; lastPulledAt: string|null };
  stores: { id: string; name: string }[];   // for the breadcrumb switcher
};

type ListingRow = {
  id: string;                 // marketplace id used everywhere: Etsy listing_id, eBay sku, Trendyol barcode, Wix wixProductId, Shopify shopifyProductId
  title: string;              // decoded
  metaLine: string[];         // ["ID 1490012234", "BB-PINK"]; rendered mono, joined with ·
  thumbUrl: string|null;
  price: { amount: number; currency: string; from?: boolean } | null;  // major units, number
  qty: number|null;           // null = not tracked
  editable: { price: boolean; qty: boolean; reason?: 'variations'|'not_tracked' };
  status: ListingStatusKey; statusRaw: string; statusNote?: string;   // statusNote = Trendyol reject reason
  health: { score: number|null; used: number; total: number; fails: string[] };
  updatedAt: string|null; createdAt: string|null;
  extra: Record<string, string|number|boolean|null>;  // section, condition, brand, collection, variants, views…
  externalUrl: string|null;
  sync: null | {
    draftId: string; status: 'pending'|'syncing'|'sync_failed'|'conflict'|'synced';
    changedFields: string[];             // ['price','quantity','title','tags',…] from patch keys
    draft: { price?: number; qty?: number; title?: string };   // overlay values
    errorKey?: string; errorParams?: Record<string,string|number>;  // via draftErrorI18n, never raw text
    queuedDelete: boolean; scheduledSendAt: string|null; syncedAt: string|null;
  };
};
```

Implementation: `lib/listings/query.ts` builds the Prisma `where`/`orderBy` per marketplace through `lib/listings/adapters/<marketplace>.ts`. Each adapter exports `{ buildWhere, orderBy, toRow, draftJoin, storeInfo }`. The draft join is a second query for the page's ids only:
- Etsy: `EtsyListingDraft where { etsyShopId, etsyListingId in ids, status in [draft, failed, conflict, syncing] }`, plus `synced` with `syncedAt > now-24h`.
- eBay: `EbayListingDraft where { userId, sku in ids, … }`.
- Trendyol / Wix / Shopify: `CatalogDraft where { userId, marketplace, storeId, externalId in ids }` (§9.4).

Sync filters (`sync=pending`) query the draft table first and pass the ids into the listing `where`. Draft status mapping: `draft`→`pending`, `failed`→`sync_failed`, `conflict`→`conflict`, `syncing`→`syncing`, `synced` within 24 h→`synced`. `queuedDelete` = `queuedActions` contains `{type:'delete'}` with no `completedAt`.

Indexes that exist and suffice: `EtsyListing(etsyShopId, state)`, `EbayListing(userId, status)`, `TrendyolProduct(userId, onSale)`, `ShopifyProduct(shopifyShopId, status)`. New: `(storeKey, healthScore)` on each table (§9.3). Title search uses `contains, mode: 'insensitive'`. At ≤ 5,000 rows per shop no trigram index is needed in v1.

### 9.2 Existing APIs reused unchanged

| Need | Endpoint |
|---|---|
| Pull (Refresh from …) | `POST /api/clawd/etsy?action=sync_listings&shop_id=` · `POST /api/clawd/ebay?action=sync_listings&user_id=&marketplace_id=EBAY_US` · `POST /api/trendyol/products?action=sync` · `POST /api/wix/products?action=sync` · `POST /api/shopify/products?action=sync` |
| Etsy shops for the switcher | `GET /api/integrations/etsy/shops` (also returned in `stores`) |
| Etsy sections (filter options, section column) | `GET /api/clawd/etsy?action=get_shop_sections&shop_id=` |
| Wix collections | `GET /api/wix/collections` |
| Stage / discard / send (Etsy) | `stageEtsyDraft`, `discardEtsyDraft`, `syncEtsyDraft`, `syncEtsyDrafts` (`lib/etsy/draftClient.ts`) → `/api/etsy-drafts`, `/api/etsy-drafts/[id]`, `/api/etsy-drafts/bulk-sync` (max 500) |
| Stage / discard / send (eBay) | `stageEbayDraft`, `discardEbayDraft`, `syncEbayDraft`, `syncEbayDrafts` → `/api/ebay-drafts/*` |
| Connection state | `useConnections` |
| Copy listing / Copy to eBay | `/app/{mp}-listings/new?copy=<id>` (listing-editor §1, the same label in both surfaces; CRITIQUE C10) and the existing creator prefill paths (`ListingCreatorDialog` copy source, cross-list from UX phase 2), launched from the row action and unchanged |
| AI improve | `/api/ai/etsy` (used inside BulkGrid, not on this page) |

### 9.3 Minimal schema additions (one migration, `prisma/migrations/2026xxxx_listings_grid`)

| Change | Why | Filled by |
|---|---|---|
| `healthScore Int?`, `healthChecksUsed Int?`, `healthChecksTotal Int?`, `healthFails String[] @default([])` on `EtsyListing`, `EbayListing`, `TrendyolProduct`, `WixProduct`, `ShopifyProduct`, plus `@@index([<store key>, healthScore])` | Server-side sort, the `needs_work` view and check filters across 5,000 rows | `lib/listings/refreshHealth.ts` (calls `lib/listingScore/<m>.ts` over the cached fields) after every pull, and after a successful draft send for the sent ids. Backfill: `scripts/backfill-listing-health.ts` |
| `hasVariations Boolean @default(false)`, `skus String[] @default([])` on `EtsyListing` | Read-only price/qty for variation listings (§0 #5), and SKU in the meta line and in search | Etsy sync: map `has_variations` from the listing payload (it is already in the v3 listing response). Add `Inventory` to `includes=` in the sync call (`clawd/etsy.ts` L2918) for `skus`. **Verify** that `includes=Images,Inventory` returns `inventory.products[].sku` on `/shops/{id}/listings`. If it doesn't, ship without `skus` and the meta line shows the ID only |
| `scheduledSendAt DateTime?` + `@@index([scheduledSendAt])` on `EtsyListingDraft`, `EbayListingDraft`, `CatalogDraft` | Scheduled sends, server-side | stage APIs accept `scheduledSendAt` |
| New model `CatalogDraft` (below) | DB staging for Trendyol, Wix and Shopify | `/api/catalog-drafts` |

```prisma
model CatalogDraft {
  id              String    @id @default(cuid())
  userId          String
  marketplace     String    // 'trendyol' | 'wix' | 'shopify'
  storeId         String    // supplierId | WixSite.id | ShopifyShop.id
  externalId      String    // barcode | wixProductId | shopifyProductId
  status          String    @default("draft") // draft | syncing | failed | conflict | synced | cancelled
  baseUpdatedAt   DateTime? // remote updated time at stage (conflict check)
  baseSnapshot    Json      @default("{}")
  fieldPatch      Json      @default("{}")    // v1 keys: title, price, quantity, tags (shopify), visible (wix), status (shopify), collectionIds (wix)
  queuedActions   Json      @default("[]")    // v1: archive (trendyol), delete (wix, shopify)
  batchRequestId  String?   // trendyol async batch
  lastSyncError   String?
  scheduledSendAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  syncedAt        DateTime?
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, marketplace, storeId])
  @@index([status])
  @@index([scheduledSendAt])
}
```
Invariant: at most one open draft per product (status in draft, failed, conflict or syncing). The service enforces it inside a transaction, because Prisma can't express a partial unique index. Optionally add a raw-SQL partial unique index in the migration.

### 9.4 New write APIs (minimal)

| Endpoint | Behaviour |
|---|---|
| `GET/POST /api/catalog-drafts` | GET `?marketplace&store&ids` lists open drafts. POST `{ marketplace, storeId, externalId, fields?, queuedActions?, scheduledSendAt? }` merges into the open draft (the same merge semantics as `stageEtsyDraft`) |
| `DELETE /api/catalog-drafts/[id]` | discard (status → `cancelled`) |
| `POST /api/catalog-drafts/send` | `{ draftIds ≤ 500 }`. For each draft: re-read the remote `updated` time (conflict when it is newer than `baseUpdatedAt`), then call the existing write. Wix: `wix/products?action=update` and `inventory`. Shopify: `action=update` / `updateVariants` (single-variant only, enforced by `editable`). Trendyol: `action=update_price_inventory`, storing `batchRequestId` and polling `batch_status`. It records the result, and on success updates the cache row and recomputes health. Failure keeps the draft as `failed` with `lastSyncError` as an i18n key |
| `lib/catalogDrafts/client.ts` | `stageCatalogDraft`, `discardCatalogDraft`, `sendCatalogDrafts` (the same shape as the Etsy client) |
| `PATCH` on `/api/etsy-drafts/[id]`, `/api/ebay-drafts/[id]` | accept `{ scheduledSendAt: string|null }` only (an additive field) |
| `POST /api/cron/send-scheduled-drafts` | every 5 min, `verifyCronAuth` + `runCronGuard('send-scheduled-drafts', bucketFor(5))`. Picks drafts with `scheduledSendAt <= now` and status `draft`, then calls the **same** executors (`syncEtsyDraft` service path, eBay sync, catalog send). **Never forces** a conflict, and skips queued deletes unless they were explicitly scheduled with a type-to-confirm. The result goes into the notification center: "3 scheduled changes sent to Etsy · 1 failed". Add the timer to the Hetzner crontab next to the existing cron jobs |
| `GET /api/listings/export?…same filters…` | CSV of **all** rows matching the current filters (not only the page). Columns: `id, title, price, currency, quantity, status, sku, tags, health, url` plus per-marketplace extras. UTF-8 with BOM (Excel and Turkish characters). The filename is `etsy-listings-{shop}-{yyyy-mm-dd}.csv` |
| `GET /api/listings/duplicates?marketplace&store` | groups computed server-side: the same SKU, the same normalized title (`normalizeTitle` + `contentWords` from `seoRules.ts`), or title Jaccard ≥ 0.8 on content words. Returns `{ groups: { reason, ids, rows: ListingRow[] }[] }`, at most 200 groups |

The adapter on the client (`components/domain/listings/useStagedChanges.ts`) hides the three draft backends behind one interface:
```ts
interface StagingAdapter {
  stage(id: string, patch: { price?: number; qty?: number; title?: string; tags?: string[] }, opts?: { queuedActions?: unknown[]; scheduledSendAt?: string|null }): Promise<void>;
  discard(draftIds: string[]): Promise<void>;
  send(draftIds: string[]): Promise<{ sent: string[]; failed: { id: string; errorKey: string }[]; conflicts: string[] }>;   // chunks of 500
  schedule(draftIds: string[], at: Date|null): Promise<void>;
}
```
Etsy maps `qty` → `quantity` in `fields` (as today, `etsy-listings.tsx` CSV path L139). eBay maps price → `offerPatch.pricingSummary.price.value` and qty → `inventoryPatch.availability.shipToLocationAvailability.quantity`. **Verify** these paths against `stageEbayDraft` callers in `ebay-listings.tsx` before coding.

---

## 10. Tools (PageHeader `⋯`)

All five tools open as panels driven by `?tool=`. Every tool **stages**, and the seller sends through the header primary.

| Tool | Container | Content | Primary |
|---|---|---|---|
| **Find & replace** | SidePanel md | Field [Title · Tags · Description] (Select) · Find (TextField) · Replace with (TextField) · ☐ Match case · Scope [Current view (248) · Selected (24)] (RadioGroup). Below: live preview list (Thumb 32 + before → after with the match highlighted, first 50, "and 34 more"). Etsy title results are checked with `checkTitle` and flagged rows show "Over 140 characters" and are excluded from the count | "Stage 82 changes" |
| **Find duplicates** | SidePanel lg | Groups from `/api/listings/duplicates`, each a `Section` with its reason ("Same SKU BB-PINK", "Titles 92% similar") and DataTable rows (thumb, title, price, qty, status, health). Per row ⋯: Open, Deactivate (stage), Delete… (stage, confirm). An empty result shows `EmptyState done` "No duplicates found" | none (the panel has no primary; P1 allows zero) |
| **Import CSV** | SidePanel lg, 3 steps in one scroll | 1 Drop or pick a file (≤ 5 MB, `.csv`). 2 Column mapping: detected header → field (`id` required: Etsy `listing_id`, eBay `sku`, Trendyol `barcode`, Wix and Shopify `id`). The template link downloads the same columns as Export. 3 Preview table: matched rows, "not found" rows, invalid cells (danger outline + reason) and unchanged rows hidden. The summary reads "120 rows · 96 listings will change · 3 not found · 2 invalid" | "Stage 96 changes" (progress "Staging 40 / 96…", resumable) |
| **Export CSV** | Modal sm | Scope [Current view (248) · Selected (24) · All listings (312)] · ☐ Include description. It downloads through `/api/listings/export` | "Download CSV" |
| **Scheduled sends** | SidePanel md | DataTable of drafts with `scheduledSendAt` (thumb, title, changed fields, `DateText` datetime, sync pill). Row ⋯: Send now · Change time… · Unschedule. An empty list shows `EmptyState done` "Nothing scheduled". Scheduling itself starts from a row ⋯ or the selection ⋯ "Schedule send…", which opens a Modal sm with one `DateTimeField` (listing-editor §4.6 addition: date + time in the seller timezone, x-date-pickers v6 `DateTimePicker`, 15-min steps; the same component the editor's "Schedule send…" uses, CRITIQUE C13) | Modal: "Schedule 5 changes" |

Dropped: **Smart pricing** (client-side rules that never ran) and **Backups** (localStorage snapshots; drafts plus `baseSnapshot` already keep the before-state for every staged change). eBay **Templates** is not a grid tool. It belongs in the eBay creator (the M6 editor surface), and until then it stays reachable from the legacy page only.

Note on the scheduled-date picker: **superseded (CRITIQUE C13).** Use `ds/inputs/DateTimeField` (listing-editor §4.6). There is no `DateRangeField mode="single"`: two components for one job is what P4 forbids. This surface (M5) lands first, so G5 builds `DateTimeField` in `components/ds/inputs/` and the editor (M6) reuses it. This surface also owns the `scheduledSendAt` migration and the cron (G0, G4); listing-editor G3 only consumes them.

---

## 11. Open items (to settle before M5 starts)

1. ~~"Changes" unit across surfaces.~~ **Resolved (CRITIQUE C1):** one unit everywhere: **a "change" is one listing with an unsent draft** (= one `EtsyListingDraft`/`EbayListingDraft`/`CatalogDraft` row, which is also the unit `bulk-sync` sends). This page: "Send 7 changes to Etsy". BulkGrid: header "24 listings · 37 edits not sent", primary "Send 24 changes to Etsy". Listing editor: footer "Send changes to Etsy" (one listing; its "3 changes" status text is renamed "3 edits not sent yet"). Cells and fields are "edits". DS §3.17 and §3.19 get the same wording.
2. **eBay staging field paths** (§9.4) and **eBay/Shopify raw status values** (§3): verify against code and the production DB.
3. **Etsy `includes=Inventory`** on the shop listings call (§9.3), verified with one real request on Hetzner.

---

## 12. i18n keys (new namespace `listings`, shared by all five)

ICU `select` handles Turkish case suffixes. Never concatenate "'ye"/"'den".

| Key | EN | TR |
|---|---|---|
| `listings.title` | `{marketplace, select, etsy {Etsy listings} ebay {eBay listings} trendyol {Trendyol products} wix {Wix products} shopify {Shopify products} other {Listings}}` | `{marketplace, select, etsy {Etsy ilanları} ebay {eBay ilanları} trendyol {Trendyol ürünleri} wix {Wix ürünleri} shopify {Shopify ürünleri} other {İlanlar}}` |
| `listings.mp.to` | `{marketplace, select, etsy {Etsy} ebay {eBay} trendyol {Trendyol} wix {Wix} shopify {Shopify} other {the store}}` | `{marketplace, select, etsy {Etsy'ye} ebay {eBay'e} trendyol {Trendyol'a} wix {Wix'e} shopify {Shopify'a} other {mağazaya}}` |
| `listings.mp.from` | same names as `mp.to` (EN) | `{marketplace, select, etsy {Etsy'den} ebay {eBay'den} trendyol {Trendyol'dan} wix {Wix'ten} shopify {Shopify'dan} other {mağazadan}}` |
| `listings.mp.on` | same names (EN) | `{marketplace, select, etsy {Etsy'de} ebay {eBay'de} trendyol {Trendyol'da} wix {Wix'te} shopify {Shopify'da} other {mağazada}}` |
| `listings.send.cta` | `Send {count, plural, one {# change} other {# changes}} to {to}` | `{count} değişikliği {to} gönder` |
| `listings.send.loading` | `Sending {count, plural, one {# change} other {# changes}}…` | `{count} değişiklik gönderiliyor…` |
| `listings.send.one` | `Send to {to}` | `{to} gönder` |
| `listings.send.thisChange` | `Send this change` | `Bu değişikliği gönder` |
| `listings.send.selected` | `Send selected changes` | `Seçili değişiklikleri gönder` |
| `listings.send.confirmExcluded` | `Send {count} changes to {to}? {conflicts, plural, =0 {} one {# listing changed on {on} and} other {# listings changed on {on} and}} {deletes, plural, =0 {} one {# deletion} other {# deletions}} will wait for your review.` | `{count} değişiklik {to} gönderilsin mi? {conflicts, plural, =0 {} other {{on} değişen # ilan ve}} {deletes, plural, =0 {} other {# silme işlemi}} incelemeniz için bekleyecek.` |
| `listings.send.toastResult` | `{sent} sent to {to}{failed, plural, =0 {} other { · # failed}}` | `{sent} değişiklik {to} gönderildi{failed, plural, =0 {} other { · # tanesi gönderilemedi}}` |
| `listings.send.retryFailed` | `Retry failed` | `Gönderilemeyenleri yeniden dene` |
| `listings.send.deletion` | `Send deletion…` | `Silme işlemini gönder…` |
| `listings.send.deletionConfirm` | `Delete "{title}" on {on}? Type {shop} to confirm.` | `"{title}" {on} silinsin mi? Onaylamak için {shop} yazın.` |
| `listings.pending.bar` | `{count, plural, one {# change not sent yet} other {# changes not sent yet}}` | `{count} değişiklik henüz gönderilmedi` |
| `listings.banner.failed` | `{failed, plural, =0 {} one {# listing couldn't be sent.} other {# listings couldn't be sent.}} {conflicts, plural, =0 {} one {# changed on {on} since your draft.} other {# changed on {on} since your draft.}}` | `{failed, plural, =0 {} other {# ilan gönderilemedi.}} {conflicts, plural, =0 {} other {# ilan taslağınızdan sonra {on} değişti.}}` |
| `listings.banner.showThem` | `Show them` | `Göster` |
| `listings.banner.reconnect` | `{marketplace} needs to be reconnected to refresh or send changes` | `Yenilemek ve değişiklik göndermek için {marketplace} yeniden bağlanmalı` |
| `listings.meta.refreshed` | `Refreshed from {from} {ago}` | `{from} {ago} yenilendi` |
| `listings.meta.refreshing` | `Refreshing from {from}…` | `{from} yenileniyor…` |
| `listings.meta.refreshFailed` | `Couldn't refresh from {from}` | `{from} yenilenemedi` |
| `listings.meta.refresh` | `Refresh from {from}` | `{from} yenile` |
| `listings.meta.refreshToast` | `{count} listings refreshed` | `{count} ilan yenilendi` |
| `listings.action.new` | `New listing` | `Yeni ilan` |
| `listings.action.bulkEdit` | `Bulk edit` | `Toplu düzenle` |
| `listings.action.edit` | `Edit` | `Düzenle` |
| `listings.action.openQuick` | `Open quick view` | `Hızlı görünümü aç` |
| `listings.action.openEditor` | `Open editor` | `Düzenleyiciyi aç` |
| `listings.action.viewOn` | `View on {marketplace}` | `{marketplace} sayfasında gör` |
| `listings.action.duplicate` | `Copy listing` | `İlanı kopyala` |
| `listings.action.copyTo` | `Copy to {target}` | `{target} için kopyala` |
| `listings.action.deactivate` | `Deactivate` | `Pasife al` |
| `listings.action.activate` | `Activate` | `Yayına al` |
| `listings.action.renew` | `Renew` | `Yenile (süresini uzat)` |
| `listings.action.archive` | `Archive` | `Arşivle` |
| `listings.action.showInStore` / `hideInStore` | `Show in store` / `Hide from store` | `Mağazada göster` / `Mağazada gizle` |
| `listings.action.addToCollection` | `Add to collection` | `Koleksiyona ekle` |
| `listings.action.setStatus` | `Set status` | `Durumu değiştir` |
| `listings.action.delete` | `Delete listing…` | `İlanı sil…` |
| `listings.action.deleteMany` | `Delete {count} listings…` | `{count} ilanı sil…` |
| `listings.action.discard` | `Discard changes` | `Değişiklikleri at` |
| `listings.action.discardConfirm` | `Discard {count, plural, one {# unsent change} other {# unsent changes}} to "{title}"?` | `"{title}" için gönderilmemiş {count} değişiklik atılsın mı?` |
| `listings.action.discarded` | `Changes discarded` | `Değişiklikler atıldı` |
| `listings.action.reviewDiff` | `Review differences` | `Farkları incele` |
| `listings.action.schedule` | `Schedule send…` | `Gönderimi zamanla…` |
| `listings.bulk.selected` | `{count} selected` | `{count} seçili` |
| `listings.bulk.selectAllInView` | `Select all {count} in this view` | `Bu görünümdeki {count} ilanın tümünü seç` |
| `listings.bulk.editInGrid` | `Edit in grid` | `Tabloda düzenle` |
| `listings.bulk.changePrice` | `Change price` | `Fiyatı değiştir` |
| `listings.bulk.changeStock` | `Change stock` | `Stoğu değiştir` |
| `listings.bulk.addTags` | `Add tags` | `Etiket ekle` |
| `listings.bulk.improveAi` | `Improve with AI` | `AI ile iyileştir` |
| `listings.bulk.exportSelected` | `Export selected` | `Seçilenleri dışa aktar` |
| `listings.price.mode.set` / `.incPct` / `.decPct` / `.incAmt` / `.decAmt` | `Set to` / `Increase by %` / `Decrease by %` / `Increase by amount` / `Decrease by amount` | `Şu fiyata ayarla` / `% artır` / `% azalt` / `Tutar kadar artır` / `Tutar kadar azalt` |
| `listings.price.round` / `.round99` / `.round00` / `.roundNone` | `Round to` / `.99` / `.00` / `Don't round` | `Yuvarla` / `,99` / `,00` / `Yuvarlama` |
| `listings.price.stage` | `Stage {count} price changes` | `{count} fiyat değişikliğini hazırla` |
| `listings.price.skippedVariations` | `{count} listings with variations skipped: change them in the grid` | `Varyasyonlu {count} ilan atlandı: bunları tabloda değiştirin` |
| `listings.tags.mode.add` / `.remove` / `.replace` | `Add` / `Remove` / `Replace all` | `Ekle` / `Kaldır` / `Tümünü değiştir` |
| `listings.tags.overLimit` | `{count} listings would go over {max} tags, so extra tags are not added` | `{count} ilan {max} etiket sınırını aşacağı için fazla etiketler eklenmez` |
| `listings.tags.stage` | `Stage tag changes` | `Etiket değişikliklerini hazırla` |
| `listings.col.listing` / `.price` / `.qty` / `.status` / `.changes` / `.health` / `.updated` | `Listing` / `Price` / `Qty` / `Status` / `Changes` / `Health` / `Updated` | `İlan` / `Fiyat` / `Adet` / `Durum` / `Değişiklik` / `Sağlık` / `Güncellendi` |
| `listings.col.section` / `.condition` / `.category` / `.format` / `.brand` / `.listPrice` / `.collection` / `.visible` / `.variants` / `.vendor` / `.productType` / `.compareAt` / `.views` / `.favorites` / `.created` | `Section` / `Condition` / `Category` / `Format` / `Brand` / `List price` / `Collection` / `Visible in store` / `Variants` / `Vendor` / `Product type` / `Compare-at price` / `Views (all time)` / `Favorites (all time)` / `Created` | `Bölüm` / `Durum (kondisyon)` / `Kategori` / `Satış türü` / `Marka` / `Liste fiyatı` / `Koleksiyon` / `Mağazada görünür` / `Varyasyon` / `Satıcı` / `Ürün türü` / `Karşılaştırma fiyatı` / `Görüntülenme (tümü)` / `Favori (tümü)` / `Oluşturuldu` |
| `listings.cell.priceFrom` | `from {price}` | `en az {price}` (no suffix after a number: "$40'den" is wrong, "$40'tan" is right; CRITIQUE C11) |
| `listings.cell.onMarketplace` | `On {marketplace}: {value}` | `{marketplace} üzerinde: {value}` |
| `listings.cell.variationsReadOnly` | `Edit prices per variation in the editor` | `Fiyatları düzenleyicide varyasyon bazında değiştirin` |
| `listings.cell.notTracked` | `Not tracked` | `Takip edilmiyor` |
| `listings.cell.notScored` | `Not scored yet · refresh to score` | `Henüz puanlanmadı · puanlamak için yenileyin` |
| `listings.cell.willDelete` | `Will be deleted on send` | `Gönderildiğinde silinecek` |
| `listings.cell.inStock` | `{count} in stock` | `Stokta {count}` |
| `listings.cell.variationsCount` | `{count} variations` | `{count} varyasyon` |
| `listings.cell.sending` | `Sending to {to}…` | `{to} gönderiliyor…` |
| `listings.cell.stageFailed` | `Couldn't save this change` | `Bu değişiklik kaydedilemedi` |
| `listings.validate.priceMin` | `{marketplace}'s minimum price is {min}` | `{marketplace} için en düşük fiyat {min}` |
| `listings.validate.priceInvalid` | `Enter a price above 0` | `0'dan büyük bir fiyat girin` |
| `listings.validate.qtyInvalid` | `Enter a whole number from {min} to {max}` | `{min} ile {max} arasında tam sayı girin` |
| `listings.search.placeholder` | `Search title, tag, SKU or ID…` | `Başlık, etiket, SKU veya ID ara…` |
| `listings.filter.status` / `.section` / `.health` / `.condition` / `.category` / `.collection` / `.productType` / `.brand` / `.vendor` / `.format` / `.photos` / `.stock` / `.price` / `.hasVideo` / `.personalizable` / `.visible` / `.approval` | `Status` / `Section` / `Health` / `Condition` / `Category` / `Collection` / `Product type` / `Brand` / `Vendor` / `Format` / `Photos` / `Stock` / `Price` / `Has video` / `Personalizable` / `Visible in store` / `Approval` | `Durum` / `Bölüm` / `Sağlık` / `Kondisyon` / `Kategori` / `Koleksiyon` / `Ürün türü` / `Marka` / `Satıcı` / `Satış türü` / `Fotoğraf` / `Stok` / `Fiyat` / `Videolu` / `Kişiselleştirilebilir` / `Mağazada görünür` / `Onay` |
| `listings.health.lt50` / `.fair` / `.good` / `.great` / `.missingPhotos` / `.missingTags` / `.noVideo` / `.shortTitle` | `Needs work (under 50)` / `Fair (50–74)` / `Good (75–89)` / `Great (90+)` / `Missing photos` / `Missing tags` / `No video` / `Short title` | `Geliştirilmeli (50 altı)` / `Orta (50–74)` / `İyi (75–89)` / `Mükemmel (90+)` / `Eksik fotoğraf` / `Eksik etiket` / `Video yok` / `Kısa başlık` |
| `listings.health.tooltip` | `Listing health {score} · {band} · Scored on {used} of {total} checks` | `İlan sağlığı {score} · {band} · {total} kontrolün {used} tanesiyle puanlandı` |
| `listings.health.unscored` | `{count} listings not scored yet` | `{count} ilan henüz puanlanmadı` |
| `listings.view.all` / `.active` / `.notSent` / `.sendFailed` / `.needsWork` / `.soldOut` / `.inactive` / `.review` | `All` / `Active` / `Changes not sent` / `Send failed` / `Needs work` / `Sold out` / `Inactive` / `In review or rejected` | `Tümü` / `Yayında` / `Gönderilmeyenler` / `Gönderilemeyenler` / `Geliştirilmeli` / `Tükenenler` / `Pasif` / `Onay ve red` |
| `listings.photos.lt5` / `.5to9` / `.10plus` | `Fewer than 5` / `5–9` / `10 or more` | `5'ten az` / `5–9` / `10 veya daha fazla` |
| `listings.stock.in` / `.out` | `In stock` / `Out of stock` | `Stokta var` / `Stokta yok` |
| `listings.empty.connectTitle` | `Connect {marketplace} to see your listings` | `İlanlarınızı görmek için {marketplace} bağlayın` |
| `listings.empty.firstPullTitle` | `Bring in your {marketplace} listings` | `{marketplace} ilanlarınızı getirin` |
| `listings.empty.firstPullBody` | `We'll copy them so you can edit and score them. Nothing changes on {on}.` | `Düzenleyip puanlayabilmeniz için kopyalarız. {on} hiçbir şey değişmez.` |
| `listings.empty.noListingsTitle` | `No listings in {store} yet` | `{store} mağazasında henüz ilan yok` |
| `listings.empty.noResults` | `No listings match these filters` | `Bu filtrelere uyan ilan yok` |
| `listings.empty.clearFilters` | `Clear filters` | `Filtreleri temizle` |
| `listings.empty.doneNotSent` | `Everything has been sent to {to}` | `Her şey {to} gönderildi` |
| `listings.empty.doneFailed` | `No failed sends` | `Gönderilemeyen değişiklik yok` |
| `listings.empty.doneNeedsWork` | `No listings need work` | `Geliştirilmesi gereken ilan yok` |
| `listings.error.load` | `Couldn't load your {marketplace} listings` | `{marketplace} ilanlarınız yüklenemedi` |
| `listings.error.serverNoResponse` | `KolayXport's server didn't respond` | `KolayXport sunucusu yanıt vermedi` |
| `listings.error.usageLimit` | `You've reached this month's sync limit` | `Bu ayki senkron sınırına ulaştınız` |
| `listings.error.seePlans` | `See plans` | `Planları gör` |
| `listings.panel.photos` / `.priceStock` / `.notSent` | `Photos` / `Price & stock` / `Edits not sent ({count})` | `Fotoğraflar` / `Fiyat ve stok` / `Gönderilmemiş düzenlemeler ({count})` |
| `listings.panel.saved` | `Saved · {count, plural, one {# edit not sent} other {# edits not sent}}` | `Kaydedildi · {count} düzenleme gönderilmedi` |
| `listings.panel.conflict` | `This listing changed on {on} after your draft started.` | `Taslağınız başladıktan sonra bu ilan {on} değişti.` |
| `listings.tools.menu` | `Tools` | `Araçlar` |
| `listings.tools.findReplace` / `.duplicates` / `.import` / `.export` / `.scheduled` | `Find & replace` / `Find duplicates` / `Import CSV` / `Export CSV` / `Scheduled sends` | `Bul ve değiştir` / `Kopyaları bul` / `CSV içe aktar` / `CSV dışa aktar` / `Zamanlanmış gönderimler` |
| `listings.fr.field` / `.find` / `.replace` / `.matchCase` / `.scopeView` / `.scopeSelected` / `.andMore` / `.overLimit` / `.stage` | `Field` / `Find` / `Replace with` / `Match case` / `Current view ({count})` / `Selected ({count})` / `and {count} more` / `Over {max} characters` / `Stage {count} changes` | `Alan` / `Bul` / `Şununla değiştir` / `Büyük/küçük harf duyarlı` / `Geçerli görünüm ({count})` / `Seçilenler ({count})` / `ve {count} tane daha` / `{max} karakteri aşıyor` / `{count} değişikliği hazırla` |
| `listings.dup.sameSku` / `.similarTitle` / `.none` | `Same SKU {sku}` / `Titles {pct} similar` / `No duplicates found` | `Aynı SKU {sku}` / `Başlıklar {pct} benzer` / `Kopya bulunamadı` |
| `listings.csv.drop` / `.mapping` / `.template` / `.summary` / `.notFound` / `.invalid` / `.staging` / `.stage` / `.tooLarge` | `Drop a CSV file or choose one` / `Match your columns` / `Download template` / `{rows} rows · {change} listings will change · {missing} not found · {invalid} invalid` / `Not found` / `Invalid` / `Staging {done} / {total}…` / `Stage {count} changes` / `File is larger than 5 MB` | `CSV dosyasını bırakın veya seçin` / `Sütunlarınızı eşleştirin` / `Şablonu indir` / `{rows} satır · {change} ilan değişecek · {missing} bulunamadı · {invalid} geçersiz` / `Bulunamadı` / `Geçersiz` / `Hazırlanıyor {done} / {total}…` / `{count} değişikliği hazırla` / `Dosya 5 MB'tan büyük` |
| `listings.export.scopeAll` / `.includeDescription` / `.download` | `All listings ({count})` / `Include description` / `Download CSV` | `Tüm ilanlar ({count})` / `Açıklamayı ekle` / `CSV indir` |
| `listings.sched.title` / `.date` / `.time` / `.cta` / `.sendNow` / `.changeTime` / `.unschedule` / `.none` / `.notify` | `Schedule send` / `Date` / `Time` / `Schedule {count, plural, one {# change} other {# changes}}` / `Send now` / `Change time…` / `Unschedule` / `Nothing scheduled` / `{sent} scheduled changes sent to {to}{failed, plural, =0 {} other { · # failed}}` | `Gönderimi zamanla` / `Tarih` / `Saat` / `{count} değişikliği zamanla` / `Şimdi gönder` / `Saati değiştir…` / `Zamanlamayı kaldır` / `Zamanlanmış gönderim yok` / `Zamanlanmış {sent} değişiklik {to} gönderildi{failed, plural, =0 {} other { · # tanesi gönderilemedi}}` |
| `status.listing.in_review` / `status.listing.rejected` (DS addition) | `In review` / `Rejected` | `Onay bekliyor` / `Reddedildi` |

`status.sync.*`, `status.listing.*` (the other keys), `ds.*` and the glossary strings come from the DS namespaces and are not redefined here. The listing-condition values for eBay (`NEW`, `USED_EXCELLENT`…) reuse the existing `ebayListings.condition*` keys until those are folded into `listings.condition.*` in the cleanup PR.

---

## 13. What to delete

After each marketplace flag has been default-on for one release (DS §7.1 step 5), delete:

| Delete | Replaced by |
|---|---|
| The body of `pages/app/etsy-listings.tsx`, `ebay-listings.tsx`, `trendyol-urunler.tsx`, `wix-urunler.tsx`, `shopify-urunler.tsx` (~9,900 lines). Each route becomes about 10 lines: `<ListingsPage marketplace="etsy"/>` inside the flag switch, and later without it | `components/domain/listings/*` |
| The legacy copies kept for one release under `components/legacy/listings/{Etsy,Ebay,Trendyol,Wix,Shopify}ListingsLegacy.tsx` | — |
| `components/etsy/SmartPricing.tsx`, `components/ebay/SmartPricing.tsx` | dropped |
| `components/etsy/BackupManager.tsx`, `components/ebay/BackupManager.tsx`, `components/trendyol/listings/TrendyolBackupManager.tsx` | dropped (drafts keep `baseSnapshot`) |
| `components/etsy/DuplicateDetector.tsx`, `components/ebay/DuplicateDetector.tsx` | `tools/DuplicatesPanel` + `/api/listings/duplicates` |
| `components/etsy/FindReplaceDialog.tsx`, `components/ebay/FindReplaceDialog.tsx`, `components/trendyol/listings/TrendyolFindReplace.tsx` | `tools/FindReplacePanel` |
| `components/etsy/ScheduledUpdateDialog.tsx`, `components/ebay/ScheduledUpdateDialog.tsx` (localStorage + client executor) | `scheduledSendAt` + cron. **The import in `components/etsy/ListingEditorDrawer.tsx` (L70, L474) is removed by the M6 editor surface; until then the Listings PR leaves `ListingEditorDrawer` untouched.** Ship a one-time client migration in `ListingsPage` that reads `etsy_scheduled_updates` / `ebay_scheduled_updates` from localStorage, shows "You have 3 scheduled updates from the old tool. Review them" (info `Banner`) and stages them as scheduled drafts on confirm, then removes the keys |
| `components/etsy/BulkOperationsBar.tsx`, `components/ebay/BulkOperationsBar.tsx`, `components/wix/WixBulkOperationsBar.tsx`, `components/trendyol/listings/TrendyolBulkOpsBar.tsx` | DS `BulkActionBar` + `bulk/*` modals. Their op logic (AI optimize, copy-to-shop, renew, variation updates) moves into BulkGrid (M7) or the bulk modals. Grep each op before deleting and port any that is still used |
| `components/etsy/SEOIndicator.tsx`, `components/ebay/SEOIndicator.tsx`, `calculateTrendyolHealth` and its letter grades (`trendyol-urunler.tsx` L181), Wix `calculateHealth` / `gradeColor` (L127–145) | `lib/listingScore/*` + `ScoreMeter` |
| `quickStats` and the stats strip, the filter rail (`sectionsExpanded`, filter drawer), the `View: Compact/Detailed/All` toggle, `mobileVisibleCount`, every per-page `formatTimeSince` | DS components |
| `components/ebay/ListingTemplates.tsx` entry in the grid Tools menu (the file stays for the eBay creator) | moved |
| i18n: `etsyListings.*`, `ebayListings.*`, `trendyolListings.*`, `wixListings.*`, `shopifyListings.*` keys used **only** by the deleted files (grep each key; editor drawers still use many until M6) | `listings.*` |
| The live-API listing loader path (`listings_with_images` paging on page load, `listing_count` per state) as a **page** dependency. The API actions stay for other callers | `GET /api/listings` |

---

## 14. Implementation split (disjoint file groups for parallel agents)

Global rules: **no group edits `messages/en.json` or `messages/tr.json`.** Each group writes its keys to `messages/fragments/listings-<group>.en.json` and `.tr.json`, and G7 merges them. Each group runs `npx next build --webpack` and `npm run test` before finishing. DS M1 components are imported from `components/ds/*` with the signatures in DS §4. If M1 hasn't landed, code against those signatures and do not create look-alikes.

| Group | Owns (only these files) | Delivers | Depends on |
|---|---|---|---|
| **G0 Contracts** (day 1, small, lands first) | `prisma/schema.prisma`, `prisma/migrations/2026xxxx_listings_grid/*`, `lib/listings/types.ts` (`ListingRow`, `ListingsResponse`, filter, sort and view keys), `components/domain/listings/config/types.ts`, `lib/ds/status/listings.ts` + `__tests__/ds/status/listings.test.ts` (including `in_review` / `rejected`) | §9.3 schema, the shared types, status map | — |
| **G1 Read API** | `pages/api/listings/index.ts`, `pages/api/listings/export.ts`, `pages/api/listings/duplicates.ts`, `lib/listings/query.ts`, `lib/listings/adapters/{etsy,ebay,trendyol,wix,shopify}.ts`, `lib/listings/csv.ts` (shared serializer), `__tests__/listings/{query,adapters,csv}.test.ts` | §9.1 and the export and duplicates endpoints, with fixtures for entity-decoded titles and draft overlays | G0 |
| **G2 Pull-side hooks** | the sync handlers only: `pages/api/clawd/etsy.ts` (the `sync_listings` block: `has_variations`, `includes=Inventory` → `skus`, then the `refreshHealth` call), `pages/api/clawd/ebay.ts` (`sync_listings` block), `pages/api/trendyol/products.ts` (`sync`), `pages/api/wix/products.ts` (`sync`), `pages/api/shopify/products.ts` (`sync`) | the cache gets `hasVariations`, `skus` and health after every pull. Edits are confined to the named action blocks | G0, G3 (`refreshHealth` signature only) |
| **G3 Scoring** | `lib/listingScore/{index,etsy,ebay,trendyol,wix,shopify}.ts`, `lib/listings/refreshHealth.ts`, `scripts/backfill-listing-health.ts`, `__tests__/listingScore/*.test.ts` | `scoreListing()` returning `ScoreResult` (DS §3.10). Etsy reuses `computeSeoScore`, `checkTitle` and `checkTags` from `seoRules.ts`; Trendyol ports the 10 factors from `calculateTrendyolHealth`; Wix ports `calculateHealth`; Shopify is new (title length, description, images ≥ 3, SEO title, SEO description, tags). Checks that need data the cache lacks are `na` | G0 |
| **G4 Staging backend** | `pages/api/catalog-drafts/{index,[id],send}.ts`, `lib/catalogDrafts/{service,client}.ts`, `lib/catalogDrafts/executors/{trendyol,wix,shopify}.ts`, `pages/api/cron/send-scheduled-drafts.ts`, `lib/drafts/scheduledSend.ts`, the `scheduledSendAt` acceptance in `pages/api/etsy-drafts/[id]/*` and `pages/api/ebay-drafts/[id]/*`, `__tests__/catalogDrafts/*.test.ts` | §9.4 and the cron entry documented in `scripts/deploy/README` (crontab line). Conflict check and no-force are tested | G0 |
| **G5 Page UI** | `components/domain/listings/{ListingsPage,ListingsTable,ListingsToolbar,SendChangesAction,FailureBanner,useListings,useStagedChanges,useListingsShortcuts}.tsx|ts`, `components/domain/listings/columns.tsx`, `components/domain/listings/config/{etsy,ebay,trendyol,wix,shopify,index}.ts`, `components/domain/listings/QuickViewPanel.tsx`, `components/domain/listings/bulk/{ChangePriceModal,AddTagsModal,ChangeStockModal,ScheduleSendModal}.tsx`, `__tests__/domain/listings/*.test.tsx` | §2–§8, desktop and mobile, every state in §7, the localStorage scheduled-update migration banner | G0 types; G1 and G4 contracts (mock them until they land) |
| **G6 Tools UI** | `components/domain/listings/tools/{ToolsMenuItems,FindReplacePanel,DuplicatesPanel,CsvImportPanel,ExportCsvModal,ScheduledSendsPanel}.tsx`, `lib/listings/csvImport.ts` (parse, map and validate; reuses the `parseCSVLine` logic ported from `etsy-listings.tsx`), `__tests__/domain/listings/tools/*.test.tsx` | §10. G5 renders `ToolsMenuItems` and the panels by `?tool=` and imports them by path only | G0, G1 (export, duplicates), the staging adapter interface from G5 (`useStagedChanges` signature in §9.4, fixed here) |
| **G7 Wiring, i18n and flags** (last) | `pages/app/{etsy-listings,ebay-listings,trendyol-urunler,wix-urunler,shopify-urunler}.tsx` (flag switch), `components/legacy/listings/*` (moved legacy bodies, unchanged), `lib/ds/uiFlags.ts` (add the five keys if missing), `messages/en.json`, `messages/tr.json` (merge fragments), `design/migrated-paths.json` (+ `components/domain/listings/**`) | Flags per marketplace, Etsy first. Smoke test at 1440, 1024 and 390 in EN and TR. Real check on Hetzner: stage 3 price edits, send, verify `EtsyListingDraft` rows go `synced` and no unexpected `EtsyDraftSyncAttempt` failures | all |
| **G8 Deletes** (one release after each flag is default-on) | the files in §13 | removal PR per marketplace. Grep that there are no remaining imports, build, test | G7 + one release |

Order: G0 first → G1, G3 and G4 in parallel → G2 (needs the G3 function) and G5/G6 in parallel against mocks → G7 → founder verification on production → G8. Etsy goes end-to-end first, and eBay, Trendyol, Wix and Shopify are config-only after that (the Trendyol, Wix and Shopify flags wait for G4).

## 15. Definition of done additions (on top of DS §8)

- [ ] The same `ListingsPage` renders all five routes. `grep -n "marketplace ===" components/domain/listings/*.tsx` returns nothing (differences live only in `config/*`).
- [ ] No DataGrid, rail, stats strip, letter grade, ring or "Sync" wording on any listings route.
- [ ] Inline price on an Etsy listing with variations is read-only with the reason. A staged price on a single-variant listing sends successfully on production.
- [ ] Send-all never sends a conflict or a queued delete. A queued delete sends only after a type-to-confirm.
- [ ] A scheduled send fires with every browser tab closed (cron log in `SyncLog`), and the conflict path leaves the draft as `conflict`.
- [ ] A 5,000-row shop: first page under 500 ms server time on Hetzner, health sort correct, export contains all filtered rows.
- [ ] Reload restores view, filters, sort, page and the open quick view or tool.

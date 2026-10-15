# Surface: BulkGrid v1 (`/app/{marketplace-listings}/bulk`) — the Vela milestone

Status: design spec, binding for **M7** (`DESIGN_SYSTEM.md` §3.17, §7.2). Date: 2026-10-15. Design only: no app code changed.
Resolves CRITIQUE **B2 / X2 / U2**. Supersedes the DS §3.17 line "Built on DataGrid Community with cell editing" and the DS §1 exception "DataGrid only inside BulkGrid" (see §1.1). Wording follows CRITIQUE C1: a **change** = one listing with an unsent draft; a cell is an **edit**.

Code read (kx-ux-phase0 working tree, 2026-10-15): `node_modules/@mui/x-data-grid` (installed **8.29.3**, `package.json` `^8.3.1`); `components/etsy/BulkEditor.tsx` (3,748 lines: field × operation editor, variation price ops L206–L275, staging L505–L540 and L1450–L1870), `components/etsy/BulkPhotoStudio.tsx` (1,308), `components/etsy/BulkVideoStudio.tsx` (344), `components/etsy/BulkOperationsBar.tsx`, `lib/etsy/draftClient.ts` (`stageEtsyDraft` merges `fieldPatch` unless `replaceFields`), `lib/etsy/draftService.ts` (`upsertDraftPatch` L626, `getOrCreateDraft` L476: a new draft costs one live listing+inventory read), `pages/api/etsy-drafts/{index,bulk-sync}.ts`, `lib/ebay/draftClient.ts`, `design/surfaces/listings-grid.md` (DataTable, `ListingRow`, `GET /api/listings`, `CatalogDraft`, `StagingAdapter`), `design/surfaces/listing-editor.md`.

---

## 0. Verification: why not MUI X DataGrid Community (checked in `node_modules`, not docs)

| Claim | Evidence in the installed package (8.29.3) | Consequence |
|---|---|---|
| Page size is capped at 100 | `hooks/features/pagination/gridPaginationUtils.js` L8 `const MAX_PAGE_SIZE = 100;` and L35 `throwIfPageSizeExceedsTheLimit`: throws "MUI X: `pageSize` cannot exceed 100 in the MIT version of the DataGrid." when `signature === DataGrid` | A 250-row page throws. 200 rows need 2 pages, so a 200-row paste cannot land in one view |
| Pagination cannot be turned off | `models/props/DataGridProps.d.ts` L44–L45: `DataGridProps = Omit<…, DataGridForcedPropsKey> & { pagination?: true }`; `DataGridForcedPropsKey` (L51) includes `'pagination'` | No "show all 200 rows" escape |
| No clipboard paste | The only clipboard props are copy-side: `onClipboardCopy` (L822), `clipboardCopyCellDelimiter` (L364), `ignoreValueFormatterDuringExport.clipboardExport` (L358); `hooks/features/clipboard/useGridClipboard.d.ts` takes only those three. No `splitClipboardPastedText`, `onClipboardPasteStart/End` or paste processing exists in the Community typings. `isPasteShortcut` (internals) and `GridCellEditStartReasons.pasteKeyDown` only start editing **one** cell | Multi-row TSV paste must be built by us anyway |
| No cell range selection | `cellSelection` exists only in `DataGridPremiumSharedPropsWithDefaultValue` (L895–L901), merged into *processed* props, not settable on `DataGridProps` | Fill-down over a range must be built by us anyway |
| Mobile | DataGrid renders no card form (founder memory: "DataGrid broken on mobile") | BulkGrid is desktop-only anyway (DS §3.17) |

**Conclusion.** The two features that make a bulk grid worth having (multi-row paste, fill-down) do not exist in the MIT DataGrid, and its 100-row cap breaks the M7 exit test. A Pro/Premium license would solve paste and page size but adds a paid dependency and a second table system. **Decision: BulkGrid is built on the DS `DataTable` (headless MUI `Table`).** CRITIQUE §6 item 18 (founder decision D) is answered "DS DataTable"; the license option stays documented in §12 as the fallback if profiling fails.

---

## 1. Decisions

### 1.1 System changes (to fold into DS §1, §3.17, §4.4 by the integrator)

| Change | Before | After |
|---|---|---|
| DS "Conflicts resolved" row "DataGrid" | "Only inside `ds/BulkGrid`" | **"Nowhere in migrated code."** `@mui/x-data-grid` stays installed until M10 for legacy pages, then is removed from `package.json` (m0/package owner) |
| DS §3.17 base | "Built on DataGrid Community with cell editing" | "Built on `ds/data/DataTable` in `mode="grid"`" |
| DS §4.4 `BulkGrid<T>` props | `(DataGrid Community; TSV paste, ⌘D, find & replace)` | as §5.1 below |
| DS §4.4 `Column.type` | `…|'money-edit'|'int-edit'` | adds `'text-edit'|'tags-edit'|'select-edit'|'combobox-edit'` (BulkGrid only; DataTable list pages keep using only `money-edit`/`int-edit`) |
| DS §3.17 header copy | "24 listings · 37 changes not sent" / "Send 37 changes to Etsy" | "24 listings · 37 edits not sent" / **"Send 24 changes to Etsy"** (C1) |

### 1.2 Surface decisions

| Question | Decision | Why |
|---|---|---|
| Rows per page | **250** max (DataTable `pageSize: 250`), server-paged through `GET /api/listings` with the same filters as the list. "Next 250 ›" in the footer; unsent edits survive page changes because they are already staged | DS §3.4 page sizes; no virtualization in v1 (DS) |
| `?view=` matching 5,000 listings | Grid shows page 1 of N with "Showing 1–250 of 5,000 · Next 250 ›". No hard cap on the view; the cap is per page | Paste and fill-down act on the visible page only (stated in the header) |
| Entry | Listings bulk bar "Edit in grid" (`?ids=`), "Select all N in this view" (`?view=&q=&…`), PageHeader "Bulk edit" (current view), Listing doctor "Open in bulk editor" (`?ids=`), "Improve with AI" (`?ids=&ai=1`) | listings-grid §6.3 |
| Marketplaces in v1 | **Etsy** (full), **eBay** (title, price, qty, SKU read-only, condition read-only), Trendyol/Wix/Shopify (title, price, qty via `CatalogDraft` v1 fields). Config-driven like `ListingsConfig` | same staging adapters as listings-grid §9.4 |
| Draft merge | **One draft per listing.** All cell edits of a listing merge into that listing's draft, debounced 800 ms per listing, written by the batch endpoint (§6.2) | C1 unit; fewer requests |
| Invalid values | Stay local (danger outline + tooltip), **never staged**. The listing's other valid edits are staged. Header: "3 edits can't be saved · Show" | never put a value into a draft that Etsy will reject (`block_save`) |
| Variation listings | Price / Qty / SKU cells **read-only** with the reason "Has variations: use Change price, or edit per variation in the editor". The bulk-bar "Change price" handles them through the ported variation price ops (§7.2) | listings-grid §0 #5 (`INVENTORY_PATCH_REQUIRED`) |
| Stock-sync managed listings | Qty cell read-only with "Stock sync manages this quantity (7)" (backend W2 `useStockManaged`, import only) | backend checklist item 7 applied to the grid |
| Undo | No undo stack (DS). **Revert cell** and **Revert row** restore the live value by rewriting the draft without that key (§6.3) | DS §3.17 |
| Mobile | Not offered below 900 px. A deep link on mobile shows `EmptyState` "The bulk editor works on a larger screen" + [Back to listings] + "Change price / Add tags are in the listings bulk bar" | DS §3.17 |
| Photos and video | Bulk bar "Edit photos…" opens the full-page **PhotoStudio** (`/app/{mp}-listings/photos?ids=`), Pro-gated (pro-gating.md §4). BulkGrid has a read-only Photos column (count + first thumb) | CRITIQUE U2 |

---

## 2. Information architecture

```
Page width="list" title="Bulk edit · Etsy listings · KolayXport"
├─ PageHeader
│   backHref "← Etsy listings" (restores the list URL state)
│   title "Bulk edit"   count pill 24 (listings in the grid)
│   meta  "24 listings · 37 edits not sent" · "Saving 12…" while batch staging
│   secondary [Discard all edits]  (confirm; discards drafts created *in this session* only — see §6.4)
│   overflow ⋯  Find & replace · Columns… · Export these rows (CSV) · Keyboard shortcuts
│   primary  [Send 24 changes to Etsy]  (N = listings with an unsent draft among the grid rows)
├─ Banner (≤ 1): invalid edits / paste result / partial send / conflict
├─ Toolbar  (BulkActionBar replaces it when rows are selected)
│   [⌕ Filter rows in this grid  /]  [Show: All · Edited · Invalid ▾]   Columns ▾       24 rows · page 1 of 1
├─ Grid (DataTable mode="grid"; frozen: checkbox, thumb, title)
└─ Footer: "1–24 of 24"  (or "1–250 of 1,284 · Next 250 ›")
```

One primary per view: "Send N changes" when N > 0; otherwise no solid primary (P1 allows none). With a selection, the BulkActionBar primary (Change price) becomes the view primary and "Send N changes" drops to the first secondary.

---

## 3. Wireframes

### 3.1 Desktop 1440 (sidebar auto-collapses to rail on this page: `Page railOnEnter`, restored on leave)

```
┌────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│rail│ Listings / [E] Etsy / Belle Couture Gifts / Bulk edit                         [⌘K Search or jump…] (bell) │
│ 64 ├─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│    │ ← Etsy listings                                                                                              │
│    │ Bulk edit [24]                                [Discard all edits]  ⋯  [➤ Send 9 changes to Etsy]              │
│    │ 24 listings · 17 edits not sent · Saved 10:42                                                                │
│    │ ┌ ⚠ 2 edits can't be saved: price below Etsy's minimum ($0.20)                              [Show them] ┐     │
│    │ [⌕ Filter rows  /] [Show: All ▾]                                         Columns ▾          24 rows           │
│    │ ┌──┬────┬────────────────────────────────┬──────────┬───────┬──────────┬──────────────────────┬───────────┬───────┐│
│    │ │☐ │    │ Title                   (frozen)│    Price │   Qty │ SKU      │ Tags                 │ Section   │ Health││ 36 header
│    │ ├──┼────┼────────────────────────────────┼──────────┼───────┼──────────┼──────────────────────┼───────────┼───────┤│
│    │ │☐ │[48]│ Personalized Baby Blanket, Cu… │   $69.99 │    42 │ BB-PINK  │ baby gift, newborn… 13│ Blankets  │▰▰▰▰▱78││ 44 rows
│    │ │  │    │ 132/140                        │          │       │          │                      │           │       ││ counter caption
│    │ │☐ │[48]│ ▌Wooden Keepsake Box, Engraved ▒│ ▌$49.00 ▒│ ▌ 12 ▒│ WKB-01   │ keepsake box, … 11    │ Boxes     │▰▰▰▱▱61││ dirty = attention
│    │ │☐ │[48]│ Name Necklace Gold             │ from $38 │  — (?)│ — (?)    │ name necklace, … 13   │ Jewelry   │▰▱▱▱▱34││ variations: r/o
│    │ │☐ │[48]│ Baby Name Sign                 │ ┃$0.10 ┃ │    18 │ BNS-3    │ …                     │ Decor     │▰▰▰▰▰92││ invalid = danger
│    │ │  │    │                                │ ⓘ Etsy's minimum price is $0.20                                    │       ││
│    │ └──┴────┴────────────────────────────────┴──────────┴───────┴──────────┴──────────────────────┴───────────┴───────┘│
│    │ 1–24 of 24                                                                                                   │
└────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Focused cell: 2px accent-600 inset outline (focus ring tokens). Editing cell: input fills the cell, same height.
▌ = 2px attention-solid left bar + attention-bg (dirty, DS §2.6). ┃ ┃ = danger-solid 1px outline (invalid).
```

Default Etsy columns (Columns ▾ toggles the rest; persisted `columnStateKey = bulk.etsy.columns`):

| Key | Header | Edit type | Width | Default | Notes |
|---|---|---|---|---|---|
| `select` | — | checkbox | 40 | frozen | |
| `thumb` | — | read-only `Thumb 32` | 48 | frozen | hover preview |
| `title` | Title | `text-edit` (counter 140, `checkTitle` warnings as a `warning` dot, never blocking) | 320 | frozen | entity-decoded at the mapper; caption `132/140` |
| `price` | Price | `money-edit` (shop currency) | 104 | ✓ | read-only for variations |
| `qty` | Qty | `int-edit` 0–999 | 72 | ✓ | read-only for variations / stock-managed |
| `sku` | SKU | `text-edit` (single-product only) | 120 | ✓ | staged via `inventory` with the single product (listing-editor §7 SKU rule) |
| `tags` | Tags | `tags-edit` (Popover `TagInput` 13 × 20, `flagOverlapWith` = title) | 240 | ✓ | cell shows the first tags + count |
| `section` | Section | `select-edit` (shop sections) | 140 | ✓ | |
| `health` | Health | read-only `ScoreMeter cell`, recomputed client-side on the draft view | 88 | ✓ | "78 → 86" tooltip after edits |
| `materials` | Materials | `tags-edit` (13 × 45) | 200 | | |
| `category` | Category | `combobox-edit` (taxonomy search, `GET action=taxonomy`) | 220 | | changing category opens a nested Modal warning "Category details for the old category will be removed" |
| `whoMade` / `whenMade` | Who made / When made | `select-edit` | 120 | | |
| `processing` | Processing | `select-edit` (processing profiles / readiness states) | 140 | | |
| `shipping` | Shipping profile | `select-edit` | 160 | | |
| `photos` | Photos | read-only count + "Edit photos…" link (PhotoStudio) | 88 | | |
| `status` | Status | read-only `StatusPill listing` | 104 | | state changes go through the bulk bar (Deactivate/Activate/Renew) |
| `changes` | Changes | read-only `StatusPill sync` | 120 | ✓ | `pending`/`syncing`/`sync_failed`/`conflict` |

Description is **not** a grid column (multi-paragraph text in a 44px cell is unusable); it is reachable by Find & replace (field Description) and "Improve with AI" (proposals reviewed in a SidePanel per listing).

### 3.2 Selection (BulkActionBar replaces the toolbar row)
```
│ 12 selected   [Change price] [Add tags] [✦ Improve with AI · 12 credits] [Edit photos… (Pro)]  ⋯   Clear (Esc) │
```
Bar ⋯: Copy to eBay · Set section… · Deactivate · Activate · Renew · Revert selected rows · ─ · Delete 12 listings… (danger, `typeToConfirm` "12" when > 10; stages queued deletes that need the explicit send per listings-grid §6.2).

### 3.3 Paste result banner (after ⌘V)
```
│ ┌ ✓ Pasted 200 rows × 3 columns · 597 edits · 3 invalid (Price) · Saving 200 listings… 120 / 200 ┐  [Show invalid] │
```
Info tone while saving; success when done ("Saved · 200 listings, 597 edits not sent"); warning when invalid > 0.

### 3.4 Below 900 px
`EmptyState` (icon `LayoutGrid`): "The bulk editor works on a larger screen" · body "On your phone, use Change price and Add tags from the listings selection bar." · [Back to listings].

---

## 4. Keyboard model (desktop; matches on `KeyboardEvent.key`, input-aware, DS P3)

| Mode | Key | Action |
|---|---|---|
| Navigate | `↑ ↓ ← →` | move focus one cell (skips nothing; read-only cells are focusable) |
| | `Tab` / `⇧Tab` | next / previous cell in the row, wrapping to the next row |
| | `Home` / `End` | first / last column of the row; `⌘↑` / `⌘↓` first / last row of the page |
| | `Enter` or `F2` | edit the focused cell (tags/combobox/select open their popover) |
| | printable key | edit and replace the value with that key (text, money, int only) |
| | `Delete` / `Backspace` | clear the cell (text → "", tags → [], number cells: not allowed, shows "Enter a value" tooltip) |
| | `Space` | toggle row selection (focus on any cell of the row) |
| | `⌘A` | select all rows on the page |
| | `⌘V` | paste (§5.3) at the focused cell |
| | `⌘C` | copy the focused cell's value (plain text) |
| | `⌘D` | fill down (§5.4) |
| | `⌘⇧Z`-free; `⌘Z` | **not bound** (no undo stack); `?` sheet says "Use Revert cell" |
| | `⌥⌫` / context menu "Revert cell" | revert focused cell; with a selection: "Revert row" for each selected row |
| | `⌘F` | Find & replace panel (focused column preselected) — `⌘F` only while focus is inside the grid, otherwise browser find |
| | `Esc` | clear selection, else blur grid |
| | `⌘↵` | page primary (Send N changes) after a confirm |
| | `⌘S` | flush the debounce now ("Saving…") |
| Edit | `Enter` | commit, move down |
| | `⇧Enter` | commit, move up |
| | `Tab` / `⇧Tab` | commit, move right / left |
| | `Esc` | cancel, restore the previous value |
| | (tags popover) `Enter`/`,` | add tag; `⌘Enter` commit and close |

Focus model: roving `tabIndex` (one cell `tabIndex=0`); the grid root is `role="grid"` with `aria-rowcount`/`aria-colcount`; cells `role="gridcell"` with `aria-readonly` and `aria-invalid`; the editor input has `aria-describedby` → the validation tooltip. Screen readers hear "Price, row 3, $49.00, edited, not sent".

---

## 5. Component contract

### 5.1 `ds/data/BulkGrid<T>` (replaces the DS §4.4 row)

```ts
type GridEditType = 'text-edit'|'money-edit'|'int-edit'|'tags-edit'|'select-edit'|'combobox-edit';
interface GridColumn<T> extends Column<T> {
  type: Column<T>['type'] | GridEditType;
  field: string;                                   // staging field key, e.g. 'price', 'tags', 'shop_section_id'
  frozen?: boolean;
  editable?(row: T): true | { reason: string };    // false → read-only with reason tooltip
  parse?(text: string, row: T): unknown;           // paste/typing → value (locale-aware money parse, tags split on ',')
  format?(value: unknown, row: T): string;         // value → copy/paste text
  validate?(value: unknown, row: T): string | null;// i18n message or null
  options?: { value: string; label: string }[] | ((q: string) => Promise<{ value; label }[]>);
  maxTags?: number; maxTagLength?: number; counter?: number;
}
interface BulkGridProps<T> {
  rows: T[]; getRowId(r: T): string; columns: GridColumn<T>[];
  values: Record<string /*rowId*/, Record<string /*field*/, unknown>>;   // draft overlay (staged + local)
  dirty: Set<string>;     // `${rowId}:${field}` staged or pending
  invalid: Map<string, string>;  // `${rowId}:${field}` → message
  onCellsChange(patches: { rowId: string; field: string; value: unknown }[], origin: 'edit'|'paste'|'fill'|'replace'|'ai'): void;
  onRevert(cells: { rowId: string; field?: string }[]): void;   // field undefined = whole row
  selection: { ids: string[]; onChange(ids: string[]): void };
  pagination: DataTableProps<T>['pagination'];
  columnStateKey: string;
  rowMeta?(r: T): ReactNode;   // e.g. "Will be deleted on send"
}
```
`BulkGrid` is a thin layer over `DataTable` (`mode="grid"` adds: roving cell focus, cell editors, frozen columns via `position: sticky; left: <sum>` with an `e1` right shadow once scrolled horizontally, and the grid ARIA roles). The table container scrolls horizontally; the page never does.

### 5.2 Domain wrapper `components/domain/bulk/BulkEditPage.tsx`
Owns data loading (`GET /api/listings` with `ids` or the view query, `size=250`), the staging queue (§6), Find & replace, the bulk bar modals (reused from listings-grid G5 `bulk/*Modal.tsx`), AI improve, and the send primary. Per-marketplace columns come from `components/domain/bulk/config/{etsy,ebay,trendyol,wix,shopify}.ts` (like `ListingsConfig`).

### 5.3 Paste (`lib/bulk/paste.ts`, pure, unit-tested)
1. Listen to the `paste` event on the grid root (not `keydown`), only when the focus is on a grid cell and **not** inside a cell editor (inside an editor, the browser pastes into the input normally).
2. Read `clipboardData.getData('text/plain')`. Parse TSV with Excel/Sheets quoting: fields wrapped in `"` may contain tabs, newlines and `""`; strip one trailing newline; normalize `\r\n`. Result: `string[][]` (R × C).
3. **Single value** (1 × 1) with rows selected and the focused cell inside the selection → paste into that column for every selected row (Sheets behaviour).
4. **Rectangle**: all rows have the same C (after trimming trailing empty cells per row). A ragged clipboard → Banner danger "The copied cells aren't a rectangle (rows have different lengths). Copy a block of cells and paste again." Nothing applied.
5. Target columns = the C **visible** columns starting at the focused column, in display order. If any target column is read-only for the column as a whole (`thumb`, `health`, `status`, `changes`, `photos`) → refuse: "Can't paste into Health. Start the paste in an editable column." Per-row read-only cells (variations, stock-managed) are **skipped** and counted ("12 cells skipped: listings with variations").
6. Target rows = R rows starting at the focused row, in the **current display order** (after sort and row filter) on the current page. Overflow rows beyond the page → applied to none, Banner "Pasted 250 rows; 12 rows didn't fit on this page" (no cross-page paste in v1).
7. Each cell: `parse` → `validate`. Money parse is locale-independent and deterministic (`lib/bulk/parseMoney.ts`): the **last** `.` or `,` followed by exactly 1–2 digits at the end is the decimal separator, every other `.`/`,`/space/`'` is grouping (`1.109,30` and `1,109.30` → 1109.3; `12,50` → 12.5; `1,109` and `1.109` → 1109); a currency symbol or code is stripped if it matches the row currency, otherwise invalid "Currency doesn't match this shop (EUR)"). Tags parse splits on `,` and runs `mergeTagInput` semantics (replace, not append; "Paste replaces this listing's tags"). Text trims and decodes HTML entities.
8. Emit one `onCellsChange(patches, 'paste')`. Valid cells become dirty and enter the staging queue; invalid cells become `invalid` and stay local.
9. Paste over a row with an open **conflict** draft is allowed but the row keeps the `conflict` pill; send skips it (listings-grid §6.2).
10. Telemetry-free; no clipboard read without a user paste event (no `navigator.clipboard.readText` permission prompt).

### 5.4 Fill-down `⌘D` (`lib/bulk/fill.ts`)
- **With selected rows**: copy the focused cell's value into the same column for every selected row (the focused row need not be selected). Per-row read-only cells skipped and counted.
- **Without a selection**: copy the value from the row **above** into the focused cell (Excel semantics).
- Tags fill = replace the target's tags (confirm Modal sm when > 10 rows: "Replace tags on 24 listings with these 13?").
- Origin `'fill'`; the toast "Filled 23 cells · Revert" (Revert reverts exactly those cells).

### 5.5 Find & replace (SidePanel md, `?tool=findReplace`)
Same panel as listings-grid §10 (`FindReplacePanel`, reused by import), scope **This grid (24)** · **Selected (12)** · **Column: Title / Tags / Description / Materials / All text columns**. Preview list first 50; primary "Replace in 82 cells" emits `onCellsChange(…, 'replace')`. Description edits are staged without a visible column (the row's Changes pill shows them).

---

## 6. Staging model (one draft per listing)

### 6.1 Client queue `components/domain/bulk/useBulkStaging.ts`
- `pending: Map<rowId, Record<field, value>>` — valid edits not yet written. Each `onCellsChange` merges into `pending[rowId]` and (re)starts an **800 ms** debounce for the whole queue (not per row: a 200-row paste becomes one flush).
- Flush = `POST /api/{mp}-drafts/batch-stage` (§6.2) with ≤ 50 items per request, **2 requests in flight** max; results update `dirty` (staged), clear `pending`, and report failures as `invalid` cells with the server's i18n key (`block_save` rules from `upsertDraftPatch`).
- Per-row serialization: a row with a request in flight is not re-sent until it returns (its new edits wait in `pending`), so two writes to one draft never race.
- Header meta during flush: "Saving 120 / 200…"; on idle: "Saved 10:42". `⌘S` flushes immediately. Leaving the page with `pending` or in-flight requests → `useUnsavedChangesGuard` confirm "Some edits are still saving. Leave anyway?" (staged drafts are already safe; only the last < 1 s is at risk).
- Field mapping (Etsy) through the existing payload builders: `title/tags/materials/price/quantity/shop_section_id/who_made/when_made/taxonomy_id/shipping_profile_id/readiness_state_id` → `fields`; `sku` → `inventory` (single product, read via `get_listing_inventory` once per row on first SKU edit). eBay: `stageEbayDraft` paths from listings-grid §9.4 (verify there). Trendyol/Wix/Shopify: `CatalogDraft` v1 fields only (others read-only "Not editable for Wix yet").

### 6.2 New endpoint `POST /api/etsy-drafts/batch-stage` (M7-B; not backend-owned: `pages/api/etsy-drafts/*` is UI-track per listings-grid G4)
```ts
// body
{ shopId: string; items: { listingId: string; fields?: Record<string, unknown>; inventory?: unknown; replaceFields?: boolean }[] /* ≤ 50 */ }
// 200
{ results: { listingId: string; ok: true; draftId: string; status: 'draft'|'failed'|'conflict' }
         | { listingId: string; ok: false; code: string; key: string; params?: Record<string, string|number> }[] }
```
Server: auth + `assertShopOwnership` once; then for each item `upsertDraftPatch({ userId, shopId, listingId, fields, inventory, replaceFields })` (import from `lib/etsy/draftService.ts`, **no edit** to that backend-owned file) with **concurrency 5** (a new draft costs one live listing+inventory read through `getOrCreateDraft`, ≈ 2 Etsy calls). Errors per item never fail the batch. eBay: `POST /api/ebay-drafts/batch-stage` with the same shape over the eBay draft service. Catalog: `POST /api/catalog-drafts` already accepts one item; add `items[]` there (listings-grid G4 file; M7-B owns that delta after M5 merges).

### 6.3 Revert
- Revert cell: remove `field` from the listing's patch. Because `stageEtsyDraft` merges, revert writes the **whole** remaining patch with `replaceFields: true` (the client knows the full patch from `GET /api/listings` `sync.draft` + its own staged values; it re-reads the draft with `fetchEtsyDrafts(shopId, listingId)` first to avoid dropping edits made elsewhere). If the remaining `fieldPatch`, `inventoryPatch`, `taxonomyPatch`, media and queued actions are all empty → `discardEtsyDraft(draftId)`.
- Revert row: same, removing every field this grid can edit; drafts with other patch kinds (media, personalization) keep those.
- A reverted invalid (local-only) cell just drops the local value.

### 6.4 Discard all edits
Confirm: "Discard 37 edits on 24 listings? Edits made outside the bulk editor stay." It reverts only the fields this session changed (tracked per row in `sessionEdits`), using §6.3; drafts that existed before the session keep their earlier patches. Toast "37 edits discarded" (no undo: the patch history is gone).

### 6.5 Send
Primary "Send N changes to Etsy" = N listings among the grid rows with a draft in `draft`/`failed`. It flushes `pending` first, then calls `syncEtsyDrafts(draftIds)` (`/api/etsy-drafts/bulk-sync`, ≤ 500). Exclusions and confirm copy exactly as listings-grid §6.2 (conflicts and queued deletes wait). While sending, rows turn `syncing` and are read-only ("Sending to Etsy…"). Result toast "22 sent to Etsy · 2 failed · Retry failed" + rows keep their pills. Usage limit 402 → C6 inline Banner + disabled primary.

---

## 7. Bulk bar actions

| Action | Container | Behaviour |
|---|---|---|
| **Change price** | Modal sm (listings-grid §6.3 `ChangePriceModal`, reused) | Non-variation rows: writes `price` cells (origin `edit`). **Variation rows: included** through `lib/bulk/variationPriceOps.ts` (port of `BulkEditor.tsx` `priorOps`/`applyNumberOps`/inventory fetch L206–L275): fetch `get_listing_inventory`, apply the op to every offering, stage `inventory`. The modal preview counts "3 listings with variations: every variation's price changes the same way" |
| **Add tags** | Modal sm (`AddTagsModal`, reused) | Add / Remove / Replace all; writes `tags` cells; over-limit rows counted |
| **Improve with AI** | starts a run; results as dirty cells | Title, tags (and alt text if photos are selected later in PhotoStudio) via `/api/ai/etsy` `bulk_optimize` (existing action), **1 credit per listing** (tooltip "· 12 credits"). Proposals land as dirty cells with a `Sparkles` marker and the cell tooltip "AI suggestion · Revert to keep yours". Guards: `coerceAiString`, `looksGarbled`, `normalizeTitle`, `normalizeTags`. A garbled result leaves the cell untouched and counts it ("2 listings didn't get a usable suggestion"). Progress in the header meta "Improving 7 / 12…", cancelable |
| **Edit photos…** | navigates to PhotoStudio `?ids=` | Pro (`features.bulkPhotoStudio`); trial shows `PlanTag`; locked plans see the locked state on arrival; shopify_free: action not rendered (pro-gating.md) |
| **Copy to eBay** | existing cross-list prefill | one listing: `/app/ebay-listings/new?crosslist=`; many: queue (listing-editor F1), out of v1 scope if F1 has not shipped → not rendered |
| Set section… | Modal sm (Select) | writes `section` cells |
| Deactivate / Activate / Renew | confirm | stages `queuedActions` (no cell); row meta shows "Will be deactivated on send" |
| Delete N listings… | `ConfirmDialog` typeToConfirm when > 10 | stages queued delete; send requires the separate "Send deletion…" (listings-grid §6.2) |

---

## 8. States

| State | Renders |
|---|---|
| Loading | PageHeader title + `TableSkeleton rows=12 thumb`; the toolbar is interactive |
| Slow / error | `useAsyncState`: 15 s inline "Still loading… Retry", 30 s `ErrorState page` "Couldn't load these listings" |
| Empty ids / view matches nothing | `EmptyState no-results` "No listings to edit" + [Back to listings] |
| Not connected / reconnect needed | as listings-grid §7 (`ConnectState`, warning Banner; staging still works, Send disabled with reason) |
| Saving | meta "Saving 120 / 200…"; cells show the value at once (optimistic) |
| Stage failure (per row) | the row's cells turn invalid with the server reason ("Etsy's minimum price is $0.20", "This listing changed on Etsy since your draft"), Banner "3 listings couldn't be saved · Show them" |
| Partial paste | §3.3 banner with counts (applied, invalid, skipped read-only, overflow) |
| Conflict rows | `conflict` pill; cells editable; send skips; row ⋯ "Review differences" → editor |
| Sending | primary `loading` "Sending 24 changes…"; rows `syncing` read-only |
| Usage / AI credits limit | C6 inline Banner on the affected action only |
| Done (nothing unsent) | no primary; meta "Everything has been sent to Etsy" |

---

## 9. Acceptance test: 200 listings × 3 columns pasted from Google Sheets, sent in one action (M7 exit)

Fixture: an Etsy test shop with ≥ 200 active non-variation listings (or the founder's shop with a filter that yields 200), and a Google Sheet with columns `Title | Price | Qty`, 200 rows, values that differ from the live ones, including: 5 titles with `'` and `&` (entity round-trip), 3 prices with a comma decimal (`12,50`), 2 invalid prices (`0.10`, `abc`), 1 title of 141 characters.

Steps and pass criteria:
1. Open `/app/etsy-listings/bulk?view=active&sort=title.asc&size=250` with the same sort as the Sheet. **Pass:** 200+ rows render on one page in < 1.5 s after data (no DataGrid 100-row error), no horizontal page scroll at 1440 and 1024.
2. Click the first Title cell, select the 200 × 3 block in Sheets, `⌘C`, back in the grid `⌘V`. **Pass:** banner "Pasted 200 rows × 3 columns · 597 edits · 3 invalid". The 3 invalid cells are exactly `abc`, `0.10` (below Etsy's $0.20 minimum) and the 141-character title (Etsy's limit is 140); 600 cells − 3 invalid = 597 staged edits. `12,50` parses as 12.50 in both the en-US and the tr-TR UI.
3. **Pass:** within 60 s the meta reads "Saved · 200 listings · 597 edits not sent" (≤ 4 batch requests of 50 in flight at 2; ≤ 400 Etsy reads total from draft creation; zero Etsy writes — verified by `EtsyApiUsage` delta containing only GETs).
4. DB check (read-only, Hetzner, CLAUDE.md query): 200 `EtsyListingDraft` rows in `draft`, each `fieldPatch` has exactly the pasted keys (`title`, `price`, `quantity`) minus invalid ones; no `&#39;` / `&amp;` in any `fieldPatch.title`.
5. Fix the 3 invalid cells (type), revert 1 cell with `⌥⌫`. **Pass:** that draft's `fieldPatch` no longer has the key (re-read row).
6. Press "Send 200 changes to Etsy", confirm. **Pass:** one `bulk-sync` call (chunked server-side ≤ 500), all rows `synced` within the bulk-sync runtime (record the duration in the PR), 0 `EtsyDraftSyncAttempt` failures except deliberate ones, and the listings page shows the new titles/prices after the live refresh (backend W6 `listing.changed`).
7. Repeat steps 1–3 with the UI in Turkish. **Pass:** identical counts, Turkish banner copy.

Unit tests (`__tests__/bulk/*.test.ts`): TSV parser (quotes, embedded tabs/newlines, CRLF, trailing newline, ragged), money parse per locale, rectangle refusal, read-only skip counting, overflow counting, fill-down both modes, revert with `replaceFields` (mocked client), batch queue (debounce, 2 in flight, per-row serialization), 200 × 3 synthetic paste → exactly 200 batch items in 4 requests.

---

## 10. i18n keys (namespace `bulk`; keys returned to the integrator)

| Key | EN | TR |
|---|---|---|
| `bulk.title` | Bulk edit | Toplu düzenleme |
| `bulk.back` | {marketplace} listings | {marketplace} ilanları |
| `bulk.meta.counts` | {listings, plural, one {# listing} other {# listings}} · {edits, plural, one {# edit not sent} other {# edits not sent}} | {listings} ilan · {edits} düzenleme gönderilmedi |
| `bulk.meta.saving` | Saving {done} / {total}… | Kaydediliyor {done} / {total}… |
| `bulk.meta.saved` | Saved {time} | {time} kaydedildi |
| `bulk.meta.allSent` | Everything has been sent to {to} | Her şey {to} gönderildi |
| `bulk.send.cta` | reuse `listings.send.cta` | — |
| `bulk.discardAll` | Discard all edits | Tüm düzenlemeleri at |
| `bulk.discardAll.confirm` | Discard {edits} edits on {listings} listings? Edits made outside the bulk editor stay. | {listings} ilandaki {edits} düzenleme atılsın mı? Toplu düzenleyici dışında yapılan düzenlemeler kalır. |
| `bulk.filter.placeholder` | Filter rows in this grid | Bu tablodaki satırları filtrele |
| `bulk.show.all` / `.edited` / `.invalid` | All / Edited / Can't be saved | Tümü / Düzenlenen / Kaydedilemeyen |
| `bulk.col.title` / `.price` / `.qty` / `.sku` / `.tags` / `.section` / `.health` / `.materials` / `.category` / `.whoMade` / `.whenMade` / `.processing` / `.shipping` / `.photos` / `.status` / `.changes` | Title / Price / Qty / SKU / Tags / Section / Health / Materials / Category / Who made / When made / Processing / Shipping profile / Photos / Status / Changes | Başlık / Fiyat / Adet / SKU / Etiketler / Bölüm / Sağlık / Malzemeler / Kategori / Kim yaptı / Ne zaman yapıldı / Hazırlık süresi / Kargo profili / Fotoğraflar / Durum / Değişiklik |
| `bulk.readOnly.variations` | Has variations: use Change price, or edit per variation in the editor | Varyasyonlu: Fiyatı değiştir'i kullanın veya düzenleyicide varyasyon bazında düzenleyin |
| `bulk.readOnly.stockManaged` | Stock sync manages this quantity ({qty}) | Bu adedi stok senkronu yönetiyor ({qty}) |
| `bulk.readOnly.notEditable` | Not editable for {marketplace} yet | {marketplace} için henüz düzenlenemiyor |
| `bulk.readOnly.sending` | Sending to {to}… | {to} gönderiliyor… |
| `bulk.invalid.banner` | {count, plural, one {# edit can't be saved} other {# edits can't be saved}}: {reason} | {count} düzenleme kaydedilemiyor: {reason} |
| `bulk.invalid.show` | Show them | Göster |
| `bulk.invalid.currency` | Currency doesn't match this shop ({currency}) | Para birimi bu mağazayla eşleşmiyor ({currency}) |
| `bulk.invalid.enterValue` | Enter a value | Bir değer girin |
| `bulk.paste.result` | Pasted {rows} rows × {cols} columns · {edits} edits{invalid, plural, =0 {} other { · # invalid}}{skipped, plural, =0 {} other { · # skipped}} | {rows} satır × {cols} sütun yapıştırıldı · {edits} düzenleme{invalid, plural, =0 {} other { · # geçersiz}}{skipped, plural, =0 {} other { · # atlandı}} |
| `bulk.paste.notRect` | The copied cells aren't a rectangle (rows have different lengths). Copy a block of cells and paste again. | Kopyalanan hücreler dikdörtgen değil (satır uzunlukları farklı). Bir hücre bloğu kopyalayıp tekrar yapıştırın. |
| `bulk.paste.readOnlyColumn` | Can't paste into {column}. Start the paste in an editable column. | {column} sütununa yapıştırılamaz. Yapıştırmaya düzenlenebilir bir sütundan başlayın. |
| `bulk.paste.overflow` | {count, plural, one {# row didn't fit} other {# rows didn't fit}} on this page | {count} satır bu sayfaya sığmadı |
| `bulk.paste.skippedVariations` | {count} cells skipped: listings with variations | {count} hücre atlandı: varyasyonlu ilanlar |
| `bulk.fill.done` | Filled {count} cells | {count} hücre dolduruldu |
| `bulk.fill.confirmTags` | Replace tags on {count} listings with these {tags}? | {count} ilandaki etiketler bu {tags} etiketle değiştirilsin mi? |
| `bulk.revert.cell` / `.row` / `.selected` | Revert cell / Revert row / Revert selected rows | Hücreyi geri al / Satırı geri al / Seçili satırları geri al |
| `bulk.ai.suggestion` | AI suggestion · Revert to keep yours | AI önerisi · Sizinkini korumak için geri alın |
| `bulk.ai.progress` | Improving {done} / {total}… | İyileştiriliyor {done} / {total}… |
| `bulk.ai.unusable` | {count, plural, one {# listing} other {# listings}} didn't get a usable suggestion | {count} ilan için kullanılabilir öneri gelmedi |
| `bulk.ai.cost` | {count, plural, one {# credit} other {# credits}} | {count} kredi |
| `bulk.photos.edit` | Edit photos… | Fotoğrafları düzenle… |
| `bulk.leaveSaving` | Some edits are still saving. Leave anyway? | Bazı düzenlemeler hâlâ kaydediliyor. Yine de çıkılsın mı? |
| `bulk.mobile.title` | The bulk editor works on a larger screen | Toplu düzenleyici daha büyük bir ekranda çalışır |
| `bulk.mobile.body` | On your phone, use Change price and Add tags from the listings selection bar. | Telefonunuzda ilan seçim çubuğundaki Fiyatı değiştir ve Etiket ekle'yi kullanın. |
| `bulk.category.confirm` | Category details for the old category will be removed | Eski kategoriye ait kategori ayrıntıları kaldırılacak |
| `bulk.pagination.next` | Next {count} | Sonraki {count} |
| `bulk.shortcuts.noUndo` | There's no undo. Use Revert cell (⌥⌫) to restore the value on {on}. | Geri alma yok. {on} değerine dönmek için Hücreyi geri al'ı (⌥⌫) kullanın. |

---

## 11. Implementation split (M7; see BUILD_PLAN.md §4 for ownership across milestones)

| Group | Owns | Delivers | Depends on |
|---|---|---|---|
| **M7-A Grid primitive** | `components/ds/data/BulkGrid.tsx`, `components/ds/data/grid/{useGridFocus,CellEditor,TagsCellEditor,SelectCellEditor,ComboboxCellEditor,FrozenColumns}.tsx`, the `mode="grid"` hook-in to `components/ds/data/DataTable.tsx` (**this group is the only editor of `DataTable.tsx` during M7**), `lib/bulk/{paste,fill,tsv,parseMoney}.ts`, `__tests__/ds/BulkGrid.test.tsx`, `__tests__/bulk/{paste,fill,tsv,parseMoney}.test.ts` | §4, §5.1, §5.3, §5.4 | M1 DataTable, TagInput, Combobox |
| **M7-B Staging backend** | `pages/api/etsy-drafts/batch-stage.ts`, `pages/api/ebay-drafts/batch-stage.ts`, the `items[]` delta in `pages/api/catalog-drafts/index.ts`, `__tests__/api/batch-stage.test.ts` | §6.2 (imports `upsertDraftPatch`; never edits `lib/etsy/**`) | listings-grid G4 merged |
| **M7-C Page + staging client** | `pages/app/{etsy-listings,ebay-listings,trendyol-urunler,wix-urunler,shopify-urunler}/bulk.tsx`, `components/domain/bulk/{BulkEditPage,useBulkStaging,useSessionEdits,BulkBanner,BulkToolbar}.tsx`, `components/domain/bulk/config/*`, `lib/bulk/variationPriceOps.ts` (port), `__tests__/domain/bulk/*.test.tsx` | §2, §3, §6.1, §6.3–§6.5, §7, §8 | M7-A, M7-B; listings-grid G5 modals (import) |
| **M7-D AI improve** | `components/domain/bulk/useBulkAi.ts`, `components/domain/bulk/AiProposalCell.tsx` | §7 Improve with AI | M7-C interface `onCellsChange(…, 'ai')` |
| **M7-E PhotoStudio** | see pro-gating.md §4 (`pages/app/etsy-listings/photos.tsx`, `components/domain/photo-studio/*`) | U2 | pro-gating FeatureGate |
| **Integrator** | wiring "Edit in grid" in `ListingsPage` (listings-grid file, after M5 merges), `migrated-paths.json`, i18n merge, the acceptance test run (§9) on Hetzner | | all |

After M7 is default-on for one release: delete `components/etsy/BulkEditor.tsx` (its PhotoStudio/VideoStudio hosting moves to M7-E first) and the `BulkEditor` mount in `pages/app/etsy-listings.tsx` (legacy body, gone with M5 G8).

## 12. Risks and fallback
- **Render cost at 250 rows × ~10 columns.** Cells render plain text; only the focused cell mounts an input. Budget: < 16 ms per keystroke while editing, < 400 ms full re-render after a 600-cell paste (one state update). If profiling misses either, add `@tanstack/react-virtual` **inside `DataTable` only** (DS rule), not a grid library.
- **Etsy reads for 200 new drafts** (≈ 400 calls through `getOrCreateDraft`). Within the 150 QPS app limit, but it shares the 100K daily budget with research. The batch endpoint checks `EtsyApiQuota` (backend, read-only) and returns `code: 'BUDGET'` per item instead of failing silently.
- **Fallback (only if v1 fails its exit test):** MUI X Premium license for `@mui/x-data-grid-premium` (clipboard paste, cell selection, no page cap). That is a paid dependency and needs a founder decision; it would replace only M7-A.

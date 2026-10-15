# Surface: Trendyol, Wix and Shopify editors and creators (on the shared `ListingEditor`)

Status: design spec, binding for **M6b** (after M6 Etsy/eBay editor). Date: 2026-10-15. Design only: no app code changed.
Resolves CRITIQUE **B3 / U1 / X3**. Extends `design/surfaces/listing-editor.md` (the workspace, save model, footer, conflict review, `SectionNav`, `FieldSuggestion`, `ScorePanel`) and `design/surfaces/listings-grid.md` (`CatalogDraft`, `StagingAdapter`, `ListingsConfig.editorHref`). Nothing here forks the workspace: these three marketplaces are **section configs + one staging adapter each**.

Code read (kx-ux-phase0 working tree, 2026-10-15): `components/trendyol/listings/TrendyolListingEditorDrawer.tsx` (1,026 lines), `components/wix/WixProductEditorDrawer.tsx` (557), `components/wix/WixProductCreatorDialog.tsx` (270), `ShopifyEditorDrawer` inline in `pages/app/shopify-urunler.tsx` L671–L1042; `pages/api/trendyol/{products,metadata}.ts`, `pages/api/ai/trendyol.ts`, `lib/integrations/trendyolApiClient.ts` (L140–L160), `lib/trendyolCommissions.ts`; `pages/api/wix/products.ts`, `lib/integrations/wixClient.ts` (L215–L340); `pages/api/shopify/products.ts` (L190–L530), `lib/integrations/shopifyClient.ts` (L251–L430); `prisma/schema.prisma` (`TrendyolProduct`, `WixProduct`, `ShopifyProduct`).

---

## 0. What is wrong today (verified in code)

| # | Problem | Where | Fixed by |
|---|---|---|---|
| 1 | **Silent data loss (Wix).** The editor renders "Discount price" and "Collections", but `handleSave` sends neither: the body has `name, description, visible, ribbon, priceData.price, sku, weight, customTextFields` only. The creator drops collections and discount the same way | `WixProductEditorDrawer.tsx` L122–L137, `WixProductCreatorDialog.tsx` L60–L69 | Every rendered field is in the payload (§6 field table is the contract); a field we cannot write is read-only with a reason |
| 2 | **Wix collections and images cannot be written at all**: `wixClient` has no collection-membership or media method | `lib/integrations/wixClient.ts` (methods L215–L340) | New client methods + API actions (§7.2, M6b-B) |
| 3 | Wix stock has its own Save button next to the main Save (two save concepts) | `WixProductEditorDrawer.tsx` L158–L180 | One autosave to a draft, one send |
| 4 | **Trendyol sends price and stock through the product-update endpoint** (`PUT /product/sellers/{id}/products`) as a partial item (`barcode, title, description, stockCode, listPrice, salePrice, vatRate, quantity, images`; no `brandId`, `categoryId`, `attributes`, `productMainId`, `cargoCompanyId`, `dimensionalWeight`). Price/stock normally go through `price-and-inventory`, and the product-update call expects the full item. **Unverified on production**: check one `batch_status` result for a drawer save before M6b. Either way the executor (§7.1) splits the two and always sends a full item | `TrendyolListingEditorDrawer.tsx` L355–L392, `trendyolApiClient.ts` L144–L150 | Executor split (§7.1) |
| 5 | Trendyol autosave lives in `localStorage` (`trendyol_editor_draft_<id>`), plus a 10-step undo stack; AI overwrites fields directly | L107, L214, L411–L478 | DB draft (`CatalogDraft`), `FieldSuggestion` proposals |
| 6 | Trendyol attributes are read-only chips; "Suggest attributes" shows AI suggestions with no way to apply them | L865–L895 | Attributes section with required/optional groups (§4.1) |
| 7 | Trendyol profit estimate hard-codes "~18%" commission and formats with `₺` + `.toFixed(2)`; `lib/trendyolCommissions.ts` (per-category rates) exists and is unused here | L841–L856 | `MarginLine` reads `TRENDYOL_COMMISSION_RATES` by category, `Money` formatting |
| 8 | Hard-coded English fallbacks (`t('x') \|\| 'Basics'`, `'Product Main ID'`, `'Blacklisted'`, `'Primary'`) | Trendyol drawer L531–L537, L657, L736, L957 | i18n keys only (§9) |
| 9 | Shopify saves go live on Save (no draft, no conflict check except per-variant `expectedQuantity`), tags are a comma-string `TextField` | `shopify-urunler.tsx` L775–L847, L917 | `CatalogDraft` staging; `TagInput`; the per-variant optimistic check is **kept** in the executor |
| 10 | **No creator UI for Trendyol or Shopify**, although `POST /api/trendyol/products?action=create` and `/api/shopify/products?action=create` exist | — | §5 creators |
| 11 | Three different drawer layouts, three health visuals (Trendyol letters, Wix filled square, Shopify none) | the three files | one workspace, `ScorePanel` (`lib/listingScore/{trendyol,wix,shopify}.ts`, listings-grid G3) |

---

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| Container | The **full-page `ListingEditor`** (listing-editor §2) with `marketplace: 'trendyol'|'wix'|'shopify'`. No drawer survives | DS P4 "full pages for the listing editor and the creators"; CRITIQUE U1 |
| Before M6b ships | M5 behaviour (CRITIQUE X3 step 1): `e`/✎ opens the listings quick view `SidePanel xl` with the `CatalogDraft` v1 fields + "Open in {marketplace} ↗". The legacy drawers are deleted with the M5 flags | no third editor pattern in between |
| Staging | `CatalogDraft` (listings-grid §9.3) with **`fieldPatch` v2 keys** (§6). JSON column: **no migration**. Creates use `queuedActions: [{ type: 'create', payload }]` with `externalId = 'new:<cuid>'` | one staging concept for all five marketplaces |
| Send wording | "Send changes to Trendyol / Wix / Shopify" (`listings.mp.to` ICU select for Turkish suffixes: Trendyol'a, Wix'e, Shopify'a) | glossary §3.19, CRITIQUE C11 |
| Trendyol review | Content edits (title, description, images, attributes) can send an approved product back to Trendyol's approval. The footer state shows "Content changes go to Trendyol review" when the draft contains them; after send the listing pill becomes `in_review` until `batch_status` + the next pull resolve it. **Verify** the re-approval rule with one real product before release; if it does not apply, drop the note | P6 honesty |
| Preview rail | **No `MarketplacePreview` for these three in v1** (no verified rendering reference). The rail holds `ScorePanel`, "Not sent yet" and recent sends. The 900–1199 [Preview] header button is not rendered | no decorative fakes |
| AI | Trendyol: existing `/api/ai/trendyol` actions (`optimize_title`, `optimize_description`, `suggest_attributes`) as `FieldSuggestion` proposals; titles and descriptions in **Turkish** (marketplace language, P5). Wix/Shopify: **no AI in v1** (no endpoint exists; adding one is a separate backend task). `analyze_listing` is replaced by `ScorePanel` | P5 marketplace language; no fake buttons |
| Variants | Trendyol: siblings by `productMainId` listed read-only, each opens its own editor. Wix: variants read-only summary + "Edit options in Wix ↗". Shopify: variant table (price, compare-at, quantity) for single-location shops; multi-location quantity read-only with "Edit stock per location in Shopify ↗" | each marketplace's real model; no invented variant editor |
| Images | Trendyol: image URLs (1–8, `https`), upload through KolayXport image hosting with HMAC-signed URLs (reference: locally hosted listing images need signed URLs). Wix: add by URL/upload + remove + reorder via new media actions (§7.2). Shopify: add (upload base64 `attachment` or `src`), delete, reorder (`position`), alt text via the existing client methods (`createProductImage`, `updateProductImage`, `deleteProductImage`) and new API actions | uses what each API supports |

---

## 2. Routes and entry points

| Route | Mode | Opened from |
|---|---|---|
| `/app/trendyol-urunler/[barcode]` | edit | list row `Enter`/`e`/✎, quick view "Open editor", ⌘K |
| `/app/trendyol-urunler/new` (`?draft=`, `?copy=<barcode>`, `?crosslist=<etsy\|ebay>:<id>`) | create | PageHeader [New product], mobile `+ New` |
| `/app/wix-urunler/[productId]?site=<siteId>` | edit | as above |
| `/app/wix-urunler/new?site=` (`?draft=`, `?copy=`) | create | as above (replaces `WixProductCreatorDialog`) |
| `/app/shopify-urunler/[productId]?shop=<shopId>` | edit | as above |
| `/app/shopify-urunler/new?shop=` (`?draft=`, `?copy=`) | create | as above |

`new.tsx` static files win over `[id].tsx` (same as listing-editor §1). Flags `editor-trendyol`, `editor-wix`, `editor-shopify` (declared in `lib/ds/uiFlags.ts` by M0, see BUILD_PLAN §2). `ListingsConfig.editorHref(id)` (listings-grid §3) points here once the flag is on; until then it opens the M5 quick view. ‹ › and back behave as listing-editor §1 (`kx:editorNav`).

---

## 3. Section config (`lib/listingEditor/sections.ts`, extended)

`SectionDef.marketplaces` gains the three keys. A section that does not apply is not rendered.

| # | Section id | Trendyol | Wix | Shopify | Contents |
|---|---|---|---|---|---|
| 1 | `photos` | ✓ (1–8, URLs) | ✓ (≤ 15 in v1) | ✓ (≤ 250; strip shows 20 + "Show all") | `ImageGrid variant="strip"` |
| 2 | `title` | ✓ title ≤ 100 (**verify** the Trendyol limit in `category_attributes`/docs), description (HTML, Edit/Preview) | ✓ name ≤ 80, description (rich text: Edit/Preview, HTML stored) | ✓ title ≤ 255, description `body_html` (Edit/Preview) | |
| 3 | `tags` | — | — | ✓ `TagInput` (no max count, ≤ 255 chars each) + Organization: vendor (`Combobox` creatable from existing vendors), product type (creatable) | |
| 3 | `attributes` | ✓ required group (from `metadata?action=category_attributes`) then optional; `Combobox` when the attribute has values, `TextField` when `allowCustom` | — | — | |
| 4 | `price` | ✓ List price, Sale price (₺), VAT rate (`Select` 0/1/10/20), discount % caption, `MarginLine` (commission by category from `lib/trendyolCommissions.ts`, VAT, net; Estimate) · Stock: quantity, stock code | ✓ Price, Discount (`SegmentedControl` Amount / Percent + value), "Customers pay {price}" caption · Inventory: Track inventory (`Switch`), quantity or In stock (`Switch`) · SKU · Weight | ✓ single-variant: Price, Compare-at price, SKU, quantity (single location) · multi-variant: moves to `variations` | |
| 5 | `variations` | ✓ read-only siblings (`productMainId`): thumb, barcode, color/size attributes, stock → link to that sibling's editor | ✓ read-only option summary + "Edit options in Wix ↗" | ✓ variant table: option values · price · compare-at · quantity (single location) · SKU; multi-location quantity read-only | |
| 6 | `details` | ✓ Brand (read-only after create; `metadata?action=brands` search on create), Category (read-only after create; leaf picker on create), barcode (read-only), product main ID | ✓ Collections (multi `Combobox` from `/api/wix/collections`), Ribbon, Visible in store (`Switch`) | ✓ Status (`Select` Active / Draft / Archived), Collections (read-only list v1) | |
| 7 | `personalization` | — | ✓ custom text fields (≤ 2 in the current UI; each: title, max length, required) | — | |
| 8 | `shipping` | ✓ Dimensional weight (desi), cargo company (read-only after create), shipment and returning address (create only) | ✓ Weight (in the price section; no section) | ✓ Weight + unit (variant-level; single-variant only) | |
| 9 | `seo` | — | — | ✓ SEO title (≤ 70 counter), meta description (≤ 320 counter), from `action=seo` | |
| — | `status` (banner, not a section) | approval / on sale / rejected (reasons) / archived / blacklisted → `StatusPill listing` + danger `Banner` with the reject reasons (decoded, i18n-wrapped) | — | — | |

Section nav chips follow the same dot rules as listing-editor §2.1.

---

## 4. Wireframes

### 4.1 Desktop 1440, edit (Trendyol)
```
┌──────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Listings / [T] Trendyol / Ahşap anı kutusu                     [⌘K Search or jump…]  (bell) (TS)│
│          ├───────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ ← Trendyol products                                                                   ‹  ›    │
│          │ Kişiye özel ahşap anı kutusu, isim baskılı…     ● Active  ● Not sent yet                        │
│          │ Barcode 8691234567890 · Updated on Trendyol 14 Oct · Refreshed from Trendyol 12 min ago ⟳        │
│          │ ┌ ⚠ Rejected by Trendyol: "Görsel kalitesi yetersiz" · Fix the photos and send again ─────────┐  │ (only when rejected)
│          ├───────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ (Photos•) (Title & description) (Attributes•) (Price & stock) (Variants) (Details) (Shipping)   │
│          ├──────────────────────────────────────────────────────────────┬────────────────────────────────┤
│          │ Photos                                         4 / 8         │ Listing health   73 / 100 Fair │
│          │ [★1][2][3][4][ + Add ]                                       │ Scored on 9 of 10 checks       │
│          │ Drag to reorder · drop files or [Paste image links]          │ ✕ 4 photos: add 2 more   +10   │
│          │ ───────────────────────────────────────────────────────────  │ ✕ 2 required attributes  +15   │
│          │ Title                                            78 / 100    │ ! Description 220 chars  +8    │
│          │ ▌[Kişiye özel ahşap anı kutusu, isim baskılı, doğum günü …]  │ ✓ Brand in title               │
│          │  Changed · Revert                    [✦ Suggest a title]     │ ─────────────────────────────  │
│          │ Description                               [Edit | Preview]   │ Not sent yet (2)               │
│          │ [ auto-grow 4 → 24 rows ]                [✦ Write description]│ · Title             Revert     │
│          │ ───────────────────────────────────────────────────────────  │ · Sale price        Revert     │
│          │ Attributes                         2 required missing  [✦ Suggest attributes] │ ──────────── │
│          │ Required                                                     │ Last sent 12 Oct · In review   │
│          │ Renk [Naturel ▾]   Materyal [—  ▾ ] (!)   Boyut [ 20x15 cm ] │                                │
│          │ Optional (12) · Show                                         │                                │
│          │ ───────────────────────────────────────────────────────────  │                                │
│          │ Price & stock                                                │                                │
│          │ List price [₺ 899,00]  Sale price ▌[₺ 749,00]  VAT [20% ▾]   │                                │
│          │ 17% off on Trendyol · You get ≈ ₺521,40 after 21% commission and VAT (Estimate, Ev & Yaşam rate) │
│          │ Quantity [ 42 ]   Stock code [ AK-001 ]                       │                                │
│          │ Variants   3 sizes in this product group · Show                │                                │
│          │ Details    Brand Belle Couture (fixed) · Category Ev & Yaşam › Dekorasyon › Kutular (fixed)     │
│          │ Shipping   Desi [ 2 ]   Cargo company: Trendyol Express (fixed)│                                │
│          ├──────────────────────────────────────────────────────────────┴────────────────────────────────┤
│          │ ⋯ More   ● Saved 10:42 · 2 edits not sent · Content changes go to Trendyol review  [Discard changes] [Send changes to Trendyol] │
└──────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘
Footer ⋯: View on Trendyol ↗ · Copy product · Archive… (danger-ghost, stages queued `archive`) 
```
- Price and stock changes alone show "Price and stock update in a few minutes" instead of the review note (they go through `price-and-inventory`, an async batch).
- After send: pill `syncing` (Sending…) until the executor's batch poll resolves → `synced`, or `sync_failed` with the batch item's failure reasons (i18n-wrapped), never raw JSON.

### 4.2 Desktop, edit (Wix) — differences only
```
│ (Photos) (Title & description) (Price & inventory) (Variants) (Details) (Personalization)              │
│ Price [$ 39.00]   Discount ( Amount | Percent ) [ 5.00 ]   Customers pay $34.00                        │
│ Track inventory [■]  Quantity [ 12 ]        SKU [ WX-12 ]   Weight [ 0.4 ] kg                          │
│ Details   Collections [Baby ✕][Gifts ✕][+]   Ribbon [ New ]   Visible in store [■]                     │
│ Personalization  1 text field · "Name to engrave" · max 20 · required · Edit                            │
│ Variants  Size (3) · Color (2) · 6 combinations · Edit options in Wix ↗                                │
│ footer: [Discard changes] [Send changes to Wix]                                                        │
```

### 4.3 Desktop, edit (Shopify) — differences only
```
│ (Photos) (Title & description) (Tags & organization) (Price & inventory | Variants) (Details) (SEO)    │
│ Tags [baby gift ✕][nursery ✕][ Type a tag, comma to split ]     Vendor [Belle ▾]  Product type [Blanket ▾] │
│ Variants (3)                                                                                           │
│ ┌──────────────┬──────────┬──────────────┬──────────┬──────────┐                                       │
│ │ Option       │ Price    │ Compare-at   │ Quantity │ SKU      │  (DataTable, money-edit / int-edit)   │
│ │ Pink / S     │ $39.00   │ $49.00       │ ▌ 8      │ BB-P-S   │                                       │
│ └──────────────┴──────────┴──────────────┴──────────┴──────────┘                                       │
│ Quantity is for "Main warehouse". Other locations: edit in Shopify ↗   (multi-location shops)          │
│ Details  Status [Active ▾]                                                                            │
│ SEO  Page title [ … ] 58 / 70   Meta description [ … ] 141 / 320                                       │
│ footer: [Discard changes] [Send changes to Shopify]                                                    │
```

### 4.4 Mobile 390 (all three; same frame as listing-editor §3.4)
TopBar "‹ Edit product [▰▰▰▱▱ 73] ⋯", pills row, section chip strip, sections stacked, heavy parts (attributes, variant table, personalization) open as full-height `BottomSheet`s with their own 50/50 footer [Cancel] [Done] ("Done" stages into the same draft). StickyActionBar: "Saved · 2 edits not sent yet" / [Score] [Send to Trendyol] (short form allowed only at 48 px half width, listing-editor §3.4).

---

## 5. Creators (full page, same workspace, `create` mode)

### 5.1 Trendyol creator `/app/trendyol-urunler/new`
Order matters: **category first** (it decides the attributes), so the create workspace shows the `details` section first with a one-line intro.
```
│ ← Trendyol products                                                                                     │
│ New product   ● Not on Trendyol yet                                                                     │
│ (Category & brand) (Photos) (Title & description) (Attributes) (Price & stock) (Shipping)               │
│ Category & brand                                                                                        │
│ Category  [⌕ Kutu ▾ ]  Ev & Yaşam › Dekorasyon › Saklama kutuları   (leaf only; `metadata?action=categories`) │
│ Brand     [⌕ Belle Couture ▾]  (must exist on Trendyol; `metadata?action=brands&q=`)                    │
│ Barcode   [ 8691234567890 ]  [Generate]   Product main ID [ AK-001 ] (defaults to stock code)           │
│ ┌ Start faster ─────────────────────────────────────────────────────────────────────────────┐           │
│ │ [Copy an Etsy or eBay listing…]  Brings photos, price and a Turkish draft of the title and │           │
│ │ description (AI, 2 credits). You review every field.                                         │           │
│ └───────────────────────────────────────────────────────────────────────────────────────────┘           │
│ … Photos · Title & description · Attributes (required first) · Price & stock · Shipping (cargo company, │
│   desi, shipment address, returning address from `metadata?action=addresses`)                          │
│ footer: Not saved yet                                         [Discard] [Send to Trendyol]               │
│ Right rail: Needed before sending (6): · Category · Brand · 1 photo · Title · 3 required attributes · Price │
```
Send = executor `create` → `createProducts([fullItem])` → `batchRequestId` → poll `batch_status` → on success `externalId` = barcode, URL replaced to `/app/trendyol-urunler/<barcode>`, pill `in_review` until approval appears in a pull. Barcode uniqueness and the category's required attributes are validated client-side first ("Fix 3 fields to continue" summary Banner, DS §3.7).

### 5.2 Wix creator `/app/wix-urunler/new?site=`
Sections: Photos · Title & description · Price & inventory · Details (collections, ribbon, visible) · Personalization. Replaces `WixProductCreatorDialog` (and fixes #1: collections and discount are sent). Send = `create` → collection adds → media adds → inventory set (each step recorded; a failure after create leaves the product created and the draft `failed` with the step name: "Created on Wix, but collections couldn't be added · Retry").

### 5.3 Shopify creator `/app/shopify-urunler/new?shop=`
Sections: Photos · Title & description · Tags & organization · Price & inventory (single variant in v1; "Add options in Shopify after creating" caption) · Details (status, default **Draft**) · SEO. Send = `createProduct` (status draft unless the user picked Active) → images → SEO (GraphQL `updateProductSeo`, existing). Variant options on create are out of v1.

### 5.4 Create-mode rules (all three)
Defaults from the last create on that store (localStorage per store, same as Etsy `defaultsStorageKey`), shown with "From your last product" helper. The "Start faster" card disappears after the first edit. Primary label: "Send to {marketplace}" (create) / "Send changes to {marketplace}" (edit). Nothing is created on the marketplace until the primary.

---

## 6. Data per field (read → staged key → write). This table is the payload contract; a rendered field missing here is a bug

### 6.1 Trendyol (`TrendyolProduct` cache; `GET /api/trendyol/products?action=detail&id=`)
| Field | Read | `fieldPatch` v2 key | Write (executor) |
|---|---|---|---|
| Title | `title` | `title` | content item (`updateProducts`, full item composed from `baseSnapshot` + patch) |
| Description | `description` | `description` | content item |
| Images | `images[].url` | `images: string[]` | content item |
| Attributes | `attributes[]` + `metadata?action=category_attributes&categoryId` | `attributes: { attributeId; attributeValueId?; customAttributeValue? }[]` | content item |
| Stock code | `stockCode` | `stockCode` | content item |
| Dimensional weight | `dimensionalWeight` | `dimensionalWeight` | content item |
| List / sale price, VAT | `listPrice`, `salePrice`, `vatRate` | `listPrice`, `salePrice`, `vatRate` | `update_price_inventory` (`vatRate` goes in the content item; **verify** which endpoint accepts it) |
| Quantity | `quantity` | `quantity` | `update_price_inventory` |
| Brand, category, barcode, cargo company | `brandId/brandName`, `categoryId/categoryName`, `barcode`, `cargoCompanyId` | create only (`queuedActions.create.payload`) | `createProducts` |
| Archive | — | `queuedActions: [{ type: 'archive' }]` | `archiveProducts` |

### 6.2 Wix (`WixProduct` cache; `GET /api/wix/products?action=cached_products`)
| Field | Read | Key | Write |
|---|---|---|---|
| Name, description | `title`, `description` | `name`, `description` | `PATCH /stores/v1/products/{id}` |
| Price | `price` | `price` | `priceData.price` |
| Discount | `discountPrice` (+ raw `discount` in `rawData`: **verify** the cache keeps type/value) | `discount: { type: 'AMOUNT'\|'PERCENT'; value }` | `discount` on the product PATCH (**verify** field name against Wix Stores v1) |
| SKU, weight, visible, ribbon | `sku`, `weight`, `visible`, `ribbon` | same | product PATCH |
| Personalization | `customTextFields` | `customTextFields` | product PATCH (already works) |
| Track inventory / quantity / in stock | `trackInventory`, `quantity`, `inStock` | `trackInventory`, `quantity`, `inStock` | `action=inventory` (`setInventoryVariantQuantities`) |
| Collections | `collectionIds` | `collectionIds` (target set; executor diffs) | **new** `addProductsToCollection` / `removeProductsFromCollection` client methods + `action=collections_add/remove` |
| Media | `images` | `media: ({ op: 'add'; url } \| { op: 'remove'; mediaId } \| { op: 'reorder'; ids: string[] })[]` | **new** `addProductMedia` / `removeProductMedia` / `reorderProductMedia` + actions (**verify** Wix Stores v1 media endpoints) |
| Delete | — | `queuedActions: [{ type: 'delete' }]` | `action=delete` (typeToConfirm) |

### 6.3 Shopify (`ShopifyProduct` cache; `GET /api/shopify/products?action=get&id=`, `action=seo`)
| Field | Read | Key | Write |
|---|---|---|---|
| Title, description, vendor, type, status | `title`, `body_html`, `vendor`, `product_type`, `status` | same | `action=update` (REST) |
| Tags | `tags` (comma string) | `tags: string[]` (joined on write) | `action=update` |
| SEO | `action=seo` | `seo: { title?; description? }` | `updateProductSeo` (GraphQL, existing in `action=update`) |
| Variants | `variants[]` (`id, price, compare_at_price, inventory_quantity, sku, inventory_item_id`) | `variants: { id; price?; compareAtPrice?; inventoryQuantity?; expectedQuantity?; sku? }[]` | `action=updateVariants` (existing; **keeps** the per-variant partial-failure handling and `expectedQuantity` check from `shopify-urunler.tsx` L775–L840) |
| Images | `getProductImages` | `images: ({ op: 'add'; src?; attachment?; alt?; position? } \| { op: 'delete'; id } \| { op: 'reorder'; id; position } \| { op: 'alt'; id; alt })[]` | **new** `action=images` (calls the existing client methods) |
| Delete | — | `queuedActions: [{ type: 'delete' }]` | `action=delete` |

Conflict check (all three, executor): remote updated time (`trendyolLastUpdate` / Wix `lastUpdated` / Shopify `updated_at`) newer than `CatalogDraft.baseUpdatedAt` → `conflict`; the editor's Review differences panel (listing-editor §6.4) works on `baseSnapshot` vs remote vs draft for these keys too (`GET /api/catalog-drafts/[id]/diff`, §7.1).

---

## 7. API additions (minimal)

### 7.1 Catalog drafts (extends listings-grid §9.4; M6b-A owns these deltas after M5 merges)
| Change | File |
|---|---|
| Accept `fieldPatch` v2 keys (§6) per marketplace, validated with zod (`lib/catalogDrafts/schemas.ts`) | `pages/api/catalog-drafts/index.ts`, `lib/catalogDrafts/service.ts` |
| `queuedActions.create` with `externalId = 'new:<cuid>'`; on success the executor rewrites `externalId` and returns it | `lib/catalogDrafts/executors/{trendyol,wix,shopify}.ts` |
| Trendyol executor: split price/stock (`update_price_inventory`) from content (`updateProducts` with a **full** item = `baseSnapshot` ⊕ patch); store both `batchRequestId`s; poll `batch_status`; map failure reasons to i18n keys | `lib/catalogDrafts/executors/trendyol.ts` |
| `GET /api/catalog-drafts/[id]/diff` + `POST .../resolve { keep }` (same contract as listing-editor G1) | `pages/api/catalog-drafts/[id]/{diff,resolve}.ts` |

### 7.2 Marketplace API actions
| Change | File |
|---|---|
| Wix: `addProductsToCollection(collectionId, productIds)`, `removeProductsFromCollection(...)`, `addProductMedia(productId, media[])`, `removeProductMedia(...)`, `reorderProductMedia(...)` | `lib/integrations/wixClient.ts` |
| Wix: `action=collections_add`, `collections_remove`, `media_add`, `media_remove`, `media_reorder` | `pages/api/wix/products.ts` (new action blocks only) |
| Shopify: `action=images` (`GET` list, `POST` add, `PUT` update position/alt, `DELETE`) over existing client methods | `pages/api/shopify/products.ts` (new action block only) |
| Trendyol: none (create, update, price/inventory, batch status, categories, attributes, brands, cargo, addresses already exist) | — |

---

## 8. States (on top of listing-editor §6)

| State | Renders |
|---|---|
| Product not in cache (deep link) | `ErrorState page` "We couldn't find this product in your Trendyol catalog" + [Refresh from Trendyol] |
| Trendyol rejected | danger `Banner` with the reasons, health check `not_rejected` fails, primary stays "Send changes to Trendyol" |
| Trendyol in review / batch pending | info `Banner` "Waiting for Trendyol · sent 10:42" ; fields editable (a new draft is created on the next edit) |
| Trendyol blacklisted / archived | warning `Banner`; send disabled with reason "Archived products can't be changed. Unarchive on Trendyol first" |
| Wix site not connected / token expired | `ConnectState brand="wix"` / warning Banner "Reconnect Wix"; staging still works |
| Shopify multi-location | quantity cells read-only with the location reason |
| Variant partial failure (Shopify) | per-variant inline error on the failed rows (kept behaviour), others marked sent |
| Create step failure after the product exists | draft `failed` with the step ("Created on Wix, but collections couldn't be added") and Retry runs only the remaining steps |
| Legacy localStorage draft found (`trendyol_editor_draft_<id>`) | info `Banner` "Unsaved edits from the old editor were found · Restore" → stages into the draft, then removes the key |

---

## 9. i18n keys (namespace `listingEditor`, new sub-keys; shared keys from listing-editor §8 are reused; returned to the integrator)

| Key | EN | TR |
|---|---|---|
| `listingEditor.section.attributes` | Attributes | Özellikler |
| `listingEditor.section.tagsOrg` | Tags & organization | Etiketler ve düzen |
| `listingEditor.section.categoryBrand` | Category & brand | Kategori ve marka |
| `listingEditor.section.seo` | Search engine listing | Arama motoru görünümü |
| `listingEditor.section.priceStock` | Price & stock | Fiyat ve stok |
| `listingEditor.section.variants` | Variants | Varyantlar |
| `listingEditor.trendyol.listPrice` / `.salePrice` / `.vat` / `.stockCode` / `.barcode` / `.productMainId` / `.desi` / `.cargo` / `.shipAddress` / `.returnAddress` / `.brand` / `.category` | List price / Sale price / VAT / Stock code / Barcode / Product main ID / Desi (dimensional weight) / Cargo company / Shipment address / Returning address / Brand / Category | Liste fiyatı / Satış fiyatı / KDV / Stok kodu / Barkod / Ana ürün kodu / Desi / Kargo firması / Sevkiyat adresi / İade adresi / Marka / Kategori |
| `listingEditor.trendyol.discount` | {pct} off on Trendyol | Trendyol'da {pct} indirim |
| `listingEditor.trendyol.margin` | You get ≈ {net} after {rate} commission and VAT (Estimate, {category} rate) | {rate} komisyon ve KDV sonrası eline geçen ≈ {net} (Tahmin, {category} oranı) |
| `listingEditor.trendyol.reviewNote` | Content changes go to Trendyol review | İçerik değişiklikleri Trendyol onayına gider |
| `listingEditor.trendyol.priceStockNote` | Price and stock update in a few minutes | Fiyat ve stok birkaç dakika içinde güncellenir |
| `listingEditor.trendyol.rejected` | Rejected by Trendyol: {reasons} · Fix and send again | Trendyol tarafından reddedildi: {reasons} · Düzeltip tekrar gönderin |
| `listingEditor.trendyol.waiting` | Waiting for Trendyol · sent {time} | Trendyol bekleniyor · {time} gönderildi |
| `listingEditor.trendyol.archived` | Archived products can't be changed. Unarchive on Trendyol first | Arşivlenmiş ürünler değiştirilemez. Önce Trendyol'da arşivden çıkarın |
| `listingEditor.trendyol.requiredMissing` | {count, plural, one {# required attribute missing} other {# required attributes missing}} | {count} zorunlu özellik eksik |
| `listingEditor.trendyol.optionalCount` | Optional ({count}) · Show | İsteğe bağlı ({count}) · Göster |
| `listingEditor.trendyol.siblings` | {count} products in this product group | Bu ürün grubunda {count} ürün |
| `listingEditor.trendyol.fixedAfterCreate` | Can't be changed after the product is created | Ürün oluşturulduktan sonra değiştirilemez |
| `listingEditor.trendyol.generateBarcode` | Generate | Oluştur |
| `listingEditor.trendyol.copyListing` | Copy an Etsy or eBay listing… | Bir Etsy veya eBay ilanını kopyala… |
| `listingEditor.trendyol.copyListingBody` | Brings photos, price and a Turkish draft of the title and description (AI, 2 credits). You review every field. | Fotoğrafları, fiyatı ve başlık ile açıklamanın Türkçe taslağını getirir (AI, 2 kredi). Her alanı siz kontrol edersiniz. |
| `listingEditor.trendyol.notFound` | We couldn't find this product in your Trendyol catalog | Bu ürünü Trendyol kataloğunuzda bulamadık |
| `listingEditor.wix.discount` / `.amount` / `.percent` / `.customerPays` | Discount / Amount / Percent / Customers pay {price} | İndirim / Tutar / Yüzde / Müşterinin ödediği {price} |
| `listingEditor.wix.trackInventory` / `.inStock` / `.weight` / `.collections` / `.ribbon` / `.visible` | Track inventory / In stock / Weight / Collections / Ribbon / Visible in store | Stok takibi / Stokta / Ağırlık / Koleksiyonlar / Şerit / Mağazada görünür |
| `listingEditor.wix.textFields` | {count, plural, one {# text field} other {# text fields}} | {count} metin alanı |
| `listingEditor.wix.editOptions` | Edit options in Wix | Seçenekleri Wix'te düzenle |
| `listingEditor.wix.partialCreate` | Created on Wix, but {step} couldn't be completed · Retry | Wix'te oluşturuldu ancak {step} tamamlanamadı · Yeniden dene |
| `listingEditor.shopify.vendor` / `.productType` / `.status` / `.compareAt` / `.seoTitle` / `.seoDescription` | Vendor / Product type / Status / Compare-at price / Page title / Meta description | Satıcı / Ürün türü / Durum / Karşılaştırma fiyatı / Sayfa başlığı / Meta açıklama |
| `listingEditor.shopify.status.active` / `.draft` / `.archived` | Active / Draft / Archived | Aktif / Taslak / Arşivlendi |
| `listingEditor.shopify.locationNote` | Quantity is for "{location}". Other locations: edit in Shopify | Adet "{location}" için. Diğer konumlar: Shopify'da düzenleyin |
| `listingEditor.shopify.addOptionsLater` | Add options in Shopify after creating | Seçenekleri oluşturduktan sonra Shopify'da ekleyin |
| `listingEditor.common.openIn` | Open in {marketplace} | {marketplace} içinde aç |
| `listingEditor.common.restoreOld` | Unsaved edits from the old editor were found · Restore | Eski düzenleyicide kaydedilmemiş düzenlemeler bulundu · Geri yükle |
| `listingEditor.common.newProduct` | New product | Yeni ürün |
| `listingEditor.common.notOnYet` | Not on {marketplace} yet | Henüz {marketplace} üzerinde değil |
| `listingEditor.common.sendCreate` | Send to {to} | {to} gönder |

(`{to}` uses `listings.mp.to`: Trendyol'a / Wix'e / Shopify'a.)

---

## 10. What to delete (one release after each `editor-*` flag is default-on)
`components/trendyol/listings/TrendyolListingEditorDrawer.tsx` (and its AI analysis Dialog), `components/wix/WixProductEditorDrawer.tsx`, `components/wix/WixProductCreatorDialog.tsx`, the inline `ShopifyEditorDrawer` (with the M5 G8 deletion of the page body), `calculateTrendyolHealth`/`gradeColor`/Wix `calculateHealth` (already listed in listings-grid §13), the `trendyol_editor_draft_*` localStorage keys (after the restore banner), and `trendyolListings.editor.*`, `wixListings.*`, `shopifyListings.*` keys used only by these files (grep each key first).

## 11. Implementation split (M6b; disjoint files; BUILD_PLAN.md §4)

| Group | Owns | Delivers | Depends on |
|---|---|---|---|
| **M6b-A Catalog draft v2** | `lib/catalogDrafts/{schemas,service}.ts` (deltas), `lib/catalogDrafts/executors/{trendyol,wix,shopify}.ts` (deltas), `pages/api/catalog-drafts/index.ts` (v2 + create), `pages/api/catalog-drafts/[id]/{diff,resolve}.ts`, tests | §6, §7.1 | M5 G4 merged; M7-B `items[]` delta merged first if M7 runs earlier |
| **M6b-B Marketplace actions** | `lib/integrations/wixClient.ts` (new methods only), the new action blocks in `pages/api/wix/products.ts` and `pages/api/shopify/products.ts`, tests with mocked HTTP | §7.2 | M5 G2 (sync blocks) merged |
| **M6b-C Adapters + routes** | `components/domain/listing-editor/adapters/{trendyol,wix,shopify}.ts`, `pages/app/{trendyol-urunler,wix-urunler,shopify-urunler}/{[id],new}.tsx`, `lib/listingEditor/sections.ts` (marketplace rows: **single owner during M6b**) | §2, §3, save/send/conflict wiring | M6 Group A frame + `DraftSection` contract |
| **M6b-D Sections** | `components/domain/listing-editor/sections/{TrendyolAttributesSection,TrendyolPriceSection,TrendyolDetailsSection,WixPriceSection,WixDetailsSection,WixPersonalizationSection,ShopifyOrgSection,ShopifyVariantsSection,ShopifySeoSection,CreateStartCard}.tsx` | §4, §5 | M6b-C contract |
| **M6b-E AI + scoring hooks** | `components/domain/listing-editor/useListingAI.ts` (**delta**: Trendyol actions; M6 Group H owns the file until M6 merges), `lib/listingScore/{trendyol,wix,shopify}.ts` fixes only if the checks need fields added here | §1 AI | M6 H merged |
| **Integrator** | `ListingsConfig.editorHref` flip in `components/domain/listings/config/{trendyol,wix,shopify}.ts`, i18n merge, flags default-on after founder checks | | all |

Verify on production before default-on: one Trendyol content send and one price send (read `batch_status` items), one Wix product with collections + discount (re-read the product), one Shopify product with an image add and a variant price change (re-read).

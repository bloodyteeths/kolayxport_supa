# Surface: Listing editor (create and edit, Etsy and eBay)

Status: design spec, binding for milestone **M6** (`DESIGN_SYSTEM.md` §7.2). Date: 2026-10-15. No app code was changed.
Implements `DESIGN_SYSTEM.md` §4.7 `ListingEditor` and `MarketplacePreview`, §6.3 (wireframe), and findings #11, #24–#29.
Code read at `kx-ux-phase0@92087ba`: `components/etsy/ListingEditorDrawer.tsx` (3,811 lines), `components/ebay/ListingEditorDrawer.tsx` (1,863), `components/etsy/ListingCreatorDialog.tsx` (2,181), `components/ebay/ListingCreatorDialog.tsx` (2,464), `components/etsy/{ImageManager,VideoUploader,VariationEditor,PersonalizationEditor,SEOIndicator,ListingTemplates,ScheduledUpdateDialog}.tsx`, `lib/etsy/{draftClient,draftService,validation,seoRules}.ts`, `lib/ebay/{draftClient,draftService}.ts`, `pages/api/etsy-drafts/**`, `pages/api/ebay-drafts/**`, `pages/api/clawd/{etsy,ebay,ebay-ai}.ts`, `pages/api/ai/etsy.ts`, `prisma/schema.prisma`.

### Wording note (the brief vs the system)
The brief says "Sync to Etsy" and "Draft saved · not on Etsy". The binding glossary (§3.19) bans "Sync" for push. This surface uses the glossary wording: **"Send changes to Etsy"** (one listing is one change; CRITIQUE C1), and **"Saved · 3 edits not sent yet"**. For a listing that does not exist on Etsy yet, the save line reads **"Saved · not on Etsy yet"**, which keeps the brief's meaning in glossary form.

---

## 0. What is wrong today (from the code, not only the screenshot)

| # | Problem | Where | Fix in this spec |
|---|---|---|---|
| 1 | 9 tabs, opening on "Images", Basics 4th; the tab reset on close is `'basics'` and the initial value is `'images'` (inconsistent) | Etsy drawer L432, L971, L1720 | One scrolling page with sticky section nav (§2) |
| 2 | **Two save layers.** Autosave writes only to `localStorage` (`saveDraft`, L1123–1146). The DB draft is written only by the grey "Save Draft" button. A `:staged` marker in localStorage tries to tell them apart. Close-confirm logic depends on that | Etsy drawer L236–296, L1036–1059 | One layer: autosave stages to the DB draft (`stageEtsyDraft`). localStorage only as an offline fallback (§5.1) |
| 3 | No push button in the footer unless a DB draft already exists; 6 equal buttons; green "Save Draft"; hard-coded English `'Save Draft'` | Etsy drawer footer L3153–3378 | Sticky footer: save state + one primary (§5.2) |
| 4 | Hard-coded Turkish in an i18n app: failure explanations (`friendly()`), "Teknik hata", "Sync'e basmadan önce şunları tamamla:", "… ve N kontrol daha" | Etsy drawer L1838–1950 | All via `listingEditor.*` keys; error causes from `draftErrorI18n` (§9) |
| 5 | Conflict banner offers "Apply anyway" (`force: true`) as the only way forward | Etsy drawer L1857 | "Review differences" panel with per-field choice; no blind force (§6.4) |
| 6 | Each sub-editor (images, video, variations, personalization, taxonomy details) has its own save button and its own staging moment; taxonomy details need a separate "Save details" click | `handleSaveTaxonomyDetails` L1324, sub-editors | Each section registers with one autosave engine (§5.1) |
| 7 | AI overwrites the field directly (`updateField('title', newTitle)`) and relies on a 10-step undo stack behind an unlabeled icon | L795–826 | AI proposals shown inline with Use / Dismiss (§4.3) |
| 8 | Scheduled updates live in `localStorage` and are executed by a 30s browser poll (`useScheduledUpdateExecutor`): they only run while a tab is open | `ScheduledUpdateDialog.tsx` L58–150 | Server-side scheduled send (§8, API G3); hidden until shipped (P1) |
| 9 | Rank tracking, rank analysis dialog and "check rank" inside the editor's SEO tab | L2003–2166, L3700+ | Moves to Keyword explorer "Tracked" view (§3.18); the editor links to it |
| 10 | eBay **creator writes straight to eBay** (`create_inventory_item`, `create_offer`, `publish_offer`) even for "save as draft"; eBay draft errors are raw English strings (`throw new Error(data.error)`) | eBay creator L1195–1390, `lib/ebay/draftClient.ts` | eBay create goes through `EbayListingDraft` with a queued `create` (API F1); typed client errors (API F2) |
| 11 | A staged new Etsy listing (negative local id) cannot be reopened in the editor; it can only be synced from a pinned row | `etsy-listings.tsx` L2355–2400 | `/app/etsy-listings/new?draft=<id>` resumes it in the same workspace (§1) |
| 12 | Header shows "0 views · 0 favorites", unlabeled undo + folder icons | L1790–1820 | Stats only when non-zero, as caption meta; icons removed |
| 13 | `SEOIndicator` (Etsy), a different `SEOIndicator` (eBay) and `computeSeoScore` produce three scores | `components/{etsy,ebay}/SEOIndicator.tsx`, `seoRules.computeSeoScore` | One `ScorePanel` fed by `lib/listingScore/{etsy,ebay}.ts` (§4.4) |

---

## 1. Routes and entry points

The editor becomes a **full page** (P4: "Full pages are used only for the listing editor, the bulk editor, the creators…"), width `detail` (1280). The drawer and the stepper dialog are retired.

| Route | Mode | Opened from |
|---|---|---|
| `/app/etsy-listings/[listingId]?shop=<shopId>` | edit | list row `Enter`/`e`/click ✎, quick SidePanel "Open editor", ⌘K, Listing doctor "Fix" |
| `/app/etsy-listings/new?shop=<shopId>` | create (blank) | PageHeader [New listing], mobile TopBar `+ New` |
| `/app/etsy-listings/new?shop=…&draft=<draftId>` | create (resume a staged new listing) | pinned "Not on Etsy yet" rows, Overview queue |
| `/app/etsy-listings/new?shop=…&copy=<listingId>` | create (copy) | row ⋯ "Copy listing", editor ⋯ "Copy listing" |
| `/app/etsy-listings/new?shop=…&prefill=session` | create (from research) | `writeListingPrefill` callers (unchanged contract, `components/etsy/research/shared/listingPrefill.ts`) |
| `/app/ebay-listings/[sku]` | edit | same as Etsy |
| `/app/ebay-listings/new` (`?draft=`, `?copy=<sku>`, `?prefill=session`, `?crosslist=…`) | create | same; Etsy "Copy to eBay" keeps using the existing `crosslist` payload |

- Next.js Pages Router allows `pages/app/etsy-listings.tsx` and `pages/app/etsy-listings/[listingId].tsx` side by side. `new` is a static file (`etsy-listings/new.tsx`) so it wins over `[listingId]`.
- Behind the per-surface flags `editor-etsy` and `editor-ebay` (`lib/ds/uiFlags.ts`, §7.1.5). With the flag off, the list pages keep opening the legacy drawer.
- **Back** returns to the list with its URL state (`router.back()` when the referrer is the list, otherwise `/app/etsy-listings?shop=…`). The list restores scroll and selection from its URL state (`useUrlState`).
- **‹ ›** (and `j`/`k` outside inputs) walk the list's current page. The list writes `sessionStorage['kx:editorNav'] = { marketplace, shopId, ids: string[], query }` when it opens the editor (try/catch; without it the arrows are not rendered).
- After the first successful send of a new listing, the URL is replaced with `/app/etsy-listings/<realId>?shop=…` (`router.replace`) from `result.etsyListingId`.

---

## 2. Information architecture

One page, four zones:

1. **PageHeader** (`backHref`, title, `StatusPill domain="listing"` + `StatusPill domain="sync"`, `meta` = `SyncMeta` "Refreshed from Etsy 12 min ago ⟳", ‹ ›). No primary in the header: the view's single primary lives in the sticky footer (P1, one primary per view).
2. **Section nav** (sticky under the TopBar): anchor chips with a per-section state dot.
3. **Body**, two columns at ≥ 1200: form column (max 848, fields ≤ 720) + **right rail** (360, sticky): `ScorePanel`, `MarketplacePreview`, "Not sent yet" change list, recent sends.
4. **Sticky footer** (`StickyActionBar`, desktop variant): `⋯` · save state · [Discard changes] · **[Send changes to Etsy]**.

### 2.1 Section order (one config, marketplace-specific sections fold in)

Sections come from `lib/listingEditor/sections.ts`: `SectionDef = { id; titleKey; marketplaces: MarketplaceKey[]; required?: boolean; createOnly?: boolean }`. A section that does not apply to the marketplace is **not rendered** (no empty "n/a" sections).

| # | Section id | Etsy | eBay | Contents |
|---|---|---|---|---|
| 1 | `photos` | ✓ | ✓ | Photo strip (Etsy 20, eBay 24), video tile (Etsy only), alt text state (Etsy only) |
| 2 | `title` | ✓ | ✓ | Title (Etsy 140, eBay 80), eBay subtitle (optional, 55), description with Edit / Preview |
| 3 | `tags` | ✓ | — | Tags (13 × 20), materials (13 × 45) |
| 3 | `specifics` | — | ✓ | eBay item specifics (required, recommended, optional groups) from `item_aspects` |
| 4 | `price` | ✓ | ✓ | Price, quantity, SKU; Etsy: market price band; eBay: currency, "Suggest price" |
| 5 | `variations` | ✓ | ✓ | Etsy `VariationEditor` (embedded), eBay `VariationEditor` (embedded) |
| 6 | `details` | ✓ | ✓ | Category (taxonomy combobox) + category attributes; Etsy: who made, when made, supply, shop section; eBay: condition + condition description, store category |
| 7 | `personalization` | ✓ | — | Etsy `PersonalizationEditor` (embedded) |
| 8 | `shipping` | ✓ | ✓ | Etsy: shipping profile, processing profile / days, return policy, weight, dimensions. eBay: fulfillment, return and payment policies, package weight and dimensions |

Rules:
- Sections are `Section variant="plain"` separated by the 1px `neutral-100` rule, 32px apart, `title-md` headings, with an optional right `action` (an AI action or "Apply profile").
- **No section collapses** in create mode, and sections holding required fields never start collapsed (§3.5 rule). In edit mode `variations` and `personalization` start as a one-line summary ("2 variations · 14 combinations · Edit") because they are heavy; clicking expands them in place. This is the SidePanel "collapsed summary" rule applied to a page; it is not an accordion stack.
- Section nav chip dot: `attention-solid` when the section has changes not sent; `danger-solid` when it has a `block_sync` error; none otherwise. The dot has a text equivalent in the chip's `aria-label` ("Tags, 1 change not sent").

---

## 3. Wireframes

### 3.1 Desktop 1440, edit (Etsy), sidebar expanded 240

```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Listings / [E] Etsy / Belle Couture Gifts                [⌘K Search or jump…]        (bell) (TS)  │ TopBar 52
│ 240      ├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ ← Etsy listings                                                                          ‹  ›   │
│          │ Personalized Baby Blanket, Custom Name Blanket, Newb…   ● Active  ● Not sent yet                 │ PageHeader 56
│          │ #1488223311 · Updated on Etsy 14 Oct · Refreshed from Etsy 12 min ago ⟳                          │ meta
│          ├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ (Photos•) (Title & description) (Tags•) (Price & inventory) (Variations) (Details) (Personal…) (Shipping) │ sticky nav 40
│          ├───────────────────────────────────────────────────────────────┬──────────────────────────────────┤
│          │ Photos & video                         6 / 20 · 3 need alt text│ Listing health    78 / 100  Good │
│          │ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌ ─ ─ ┐┌────┐              │ ▰▰▰▰▰▰▰▰▱▱  Scored on 10 of 12   │
│          │ │★ 1 ││ 2  ││ 3 !││ 4 !││ 5 !││ 6 +││ +   ││ ▶  │  96px tiles  │ ✕ 6 photos: add 4        +8 [Add photos] │
│          │ └────┘└────┘└────┘└────┘└────┘└────┘└ Add ┘└Vid ┘              │ ✕ 3 photos without alt   +4 [Write alt text]│
│          │ Drag to reorder · drop files here · [✦ Write alt text for 3]  │ ! Title 96 / 140 chars   +3 [Suggest a title]│
│          │ ─────────────────────────────────────────────────────────────  │ ✓ 13 / 13 tags                   │
│          │ Title & description                                           │ n/a Price vs market  [Check price] │
│          │ Title                                              96 / 140   │ ──────────────────────────────── │
│          │ ▌[Personalized Baby Blanket, Custom Name Blanket, Newborn …]  │ Preview  [Search|Listing] [▭|▯]  │
│          │ ▌Title case, commas only. "blanket" repeats in 2 tags (?)     │ ┌──────────────────────────────┐ │
│          │  Changed · Revert                       [✦ Suggest a title]   │ │ [  image 1, 4:3 crop      ]  │ │
│          │ ┌ Suggested title ────────────────────────────────────────┐  │ │ Personalized Baby Blanket,   │ │
│          │ │ Personalized Baby Blanket, Custom Name Swaddle, Newborn  │  │ │ Custom Name Blanket, Newb…   │ │
│          │ │ Gift, Monogram Nursery Blanket, Baby Shower Gift  134/140│  │ │ $69.99                        │ │
│          │ │                                  [Dismiss] [Try again] [Use]│ │ Belle Couture Gifts           │ │
│          │ └──────────────────────────────────────────────────────────┘  │ └──────────────────────────────┘ │
│          │ Description                              [Edit | Preview]     │ Etsy cuts titles at ~55 chars    │
│          │ ┌──────────────────────────────────────────────────────────┐  │ in search on mobile (?)          │
│          │ │ Wrap your little one in…  (auto-grow 4→24 rows)          │  │ ──────────────────────────────── │
│          │ └──────────────────────────────────────────────────────────┘  │ Not sent yet (3)                 │
│          │ 412 words                              [✦ Write description]  │ · Title                 Revert   │
│          │ ─────────────────────────────────────────────────────────────  │ · Tags (2 added, 1 removed)      │
│          │ Tags                                               13 / 13    │ · Photo order                    │
│          │ ▌[baby gift 9/20 ✕][newborn blanket 15/20 ✕][name blanket !✕]… │ ──────────────────────────────── │
│          │ ▌[ Type a tag or paste a list, Enter to add               ]   │ Last sent 12 Oct · 3 fields ✓    │
│          │  "name blanket" repeats words from the title (?)              │ Failed 11 Oct · Invalid taxonomy │
│          │  [✦ Get tag ideas]  [Open Keyword explorer ↗]                 │                                  │
│          │ Materials (optional)                               3 / 13     │                                  │
│          │ [cotton ✕][minky ✕][thread ✕]                                  │                                  │
│          │ ─────────────────────────────────────────────────────────────  │                                  │
│          │ Price & inventory                                             │                                  │
│          │ Price [$ 69.99 ]   Quantity [ 42 ]      SKU (optional) [BB-PINK]│                                │
│          │ Most similar listings sell for $38–$62 (median $49) · Etsy search · 48 listings · 2h ago · Measured │
│          │ [Use $49]                                                      │                                  │
│          │ ─────────────────────────────────────────────────────────────  │                                  │
│          │ Variations                         2 variations · 14 combos  Edit│                                │
│          │ Details   Category [Home & Living › Bedding › Blankets ▾]      │                                  │
│          │           Primary color [Pink ▾]  Fabric [Cotton ▾] …          │                                  │
│          │           Who made it [I did ▾]  What is it [A finished product ▾] When [Made to order ▾]          │
│          │           Shop section (optional) [Blankets ▾]  + New section  │                                  │
│          │ Personalization    On · Required · 1 question               Edit│                                 │
│          │ Shipping  Shipping profile [US Free 3–5 d ▾]  Processing [1–3 days ▾]                              │
│          │           Return policy [30 days, returns + exchanges ▾]       │                                  │
│          │           Weight [0.8][kg ▾]   L [30] W [20] H [8] cm          │                                  │
│          ├───────────────────────────────────────────────────────────────┴──────────────────────────────────┤
│          │ ⋯ More     ● Saved 10:42 · 3 edits not sent yet           [Discard changes] [Send changes to Etsy] │ footer 64 (e1)
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘
▌ = dirty field marker (2px attention-solid bar on the field's left edge; same meaning as a dirty cell).
Footer ⋯: View on Etsy ↗ · Copy listing · Copy to eBay · Apply profile… · Save as profile… · Schedule send… (only once API G3 ships)
          · Track keywords ↗ · ─ · Deactivate on Etsy… / Publish on Etsy… / Renew on Etsy… (by state) · ─ · Delete listing… (danger-ghost, last)
```

Widths at 1440 with a 240 sidebar: content area 1200 − 48 gutter = 1152 (the `detail` cap of 1280 is not reached). Form column = 1152 − 360 rail − 24 gap = **768**, fields ≤ 720. At 1536 and wider the page caps at 1280, so the form column is 1280 − 48 − 384 = 848.

### 3.2 Desktop, create (Etsy), empty workspace

```
│ ← Etsy listings                                                                                         │
│ New listing    ● Not on Etsy yet                                                                        │
│ Belle Couture Gifts · Started 10:31                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (Photos) (Title & description) (Tags) (Price & inventory) (Variations) (Details) (Personalization) (Shipping) │
├───────────────────────────────────────────────────────────────┬─────────────────────────────────────────┤
│ Photos & video                                        0 / 20  │ Listing health     — Needs photos       │
│ ┌──────────────────────────────────────────────────────────┐  │ Scored on 0 of 12 checks                │
│ │  [⇪]  Drop photos here or [Choose photos]                │  │ Add a photo and a title to get a score. │
│ │       JPG, PNG or GIF, up to 20 · 2000px+ recommended     │  │ ─────────────────────────────────────── │
│ │       [✦ Generate a photo]   [Paste image links]          │  │ Preview  (placeholder card, grey image) │
│ └──────────────────────────────────────────────────────────┘  │ ─────────────────────────────────────── │
│ ┌ Start faster ────────────────────────────────────────────┐  │ Needed before sending (5)                │
│ │ [✦ Fill from photos]  Writes title, description, tags and │  │ · 1 photo   · Title   · Category        │
│ │ category from your photos. You review every field.        │  │ · Price     · Shipping profile          │
│ │ [Apply profile…]  [Copy an existing listing…]             │  │                                         │
│ └──────────────────────────────────────────────────────────┘  │                                         │
│ Title & description … (empty fields, same layout as edit)    │                                         │
├───────────────────────────────────────────────────────────────┴─────────────────────────────────────────┤
│ ⋯ More        Not saved yet                              [Discard] [Publish on Etsy ▾]                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Publish on Etsy ▾ (SplitButton): "Publish on Etsy" (create + publish) · "Send to Etsy as a draft (not live)".
The "Start faster" card disappears after the first field edit or photo; it is the only create-only block.
Defaults prefilled from the last create on this shop (shipping profile, return policy, section; existing
`defaultsStorageKey` logic): those fields show "From your last listing" helper text.
```

### 3.3 Desktop 900–1199 (sidebar auto-rail 64): no right rail

```
│ ← Etsy listings   Personalized Baby Blanket…  ● Active ● Not sent yet   [▰▰▰▰▱ 78]  [Preview]   ‹ ›     │
```
- The rail's content moves behind two header buttons: the `ScoreMeter variant="cell"` button opens `SidePanel sm` "Listing health" (the `ScorePanel`), and [Preview] opens `SidePanel md` with `MarketplacePreview`. The "Not sent yet" list moves into the footer save-state popover (click "3 changes not sent yet").
- Form column fills the content width, fields ≤ 720.

### 3.4 Mobile 390

```
┌──────────────────────────────────┐
│ ‹  Edit listing   [▰▰▰▰▱ 78]   ⋯ │ TopBar 48 (title, score button, overflow)
├──────────────────────────────────┤
│ ● Active  ● Not sent yet         │ pills row (caption meta below)
│ Refreshed 12 min ago ⟳           │
│ (Photos•)(Title)(Tags•)(Price) → │ sticky chip strip (h-scroll allowed)
│ Photos & video   6/20 · 3 no alt │
│ [★][2][3!][4!][5!][6][+][▶] →    │ 72px tiles, h-scroll, long-press drag reorder
│ ──────────────────────────────── │
│ Title                   96 / 140 │
│ ▌[Personalized Baby Blanket, …]  │ 16px input text, 2-line auto-grow
│ [✦ Suggest a title]   Revert     │ 44px targets
│ Description       [Edit|Preview] │
│ [ auto-grow textarea          ]  │
│ [✦ Write description]            │
│ ──────────────────────────────── │
│ Tags                     13 / 13 │
│ [baby gift 9/20 ✕][newborn…✕]    │ chips wrap
│ [ Add tags, comma to split    ]  │
│ [✦ Get tag ideas]                │
│ ──────────────────────────────── │
│ Price & inventory                │
│ Price [$ 69.99]  Qty [42]        │ natural pair, 2 columns
│ SKU (optional) [BB-PINK       ]  │
│ … Variations ›  Details  …       │ heavy editors open as full-height sheets
├──────────────────────────────────┤
│ Saved · 3 edits not sent yet     │ StickyActionBar status line
│ [ Preview ]  [ Send to Etsy    ] │ 50/50, 48px (secondary = Preview, primary = Send)
├──────────────────────────────────┤
│ Overview Orders Listings Msgs More│ tab bar 56
└──────────────────────────────────┘
Score button → BottomSheet "Listing health" (ScorePanel; a fix scrolls to the field and closes the sheet).
Preview → full-height BottomSheet with MarketplacePreview (device forced to mobile).
⋯ (TopBar) → BottomSheet list with the same overflow items as desktop + "Discard changes".
Variations / Personalization / Category attributes → full-height BottomSheet each, with their own 50/50 footer
([Cancel] [Done]); "Done" stages into the same draft (no separate save concept).
Mobile primary label is the short form "Send to Etsy" (the count is in the status line above it).
```

---

## 4. Components and interactions (system components only)

### 4.1 Mapping from zone to DS component

| Zone | DS component (file) | Notes |
|---|---|---|
| Page frame | `Page width="detail" title="{listing title} · KolayXport"` | |
| Header | `PageHeader { title, subtitle?, meta: <SyncMeta/>, backHref }` + `StatusPill` ×2 (`listing`, `sync`) + `IconButton` ‹ › | no `primaryAction` (it is in the footer) |
| Section nav | **`ds/page/SectionNav`** (new, see §4.6) | |
| Sections | `Section variant="plain" { title, description?, action? }` | |
| Fields | `FormField` + `TextField` / `TextArea` / `MoneyField` / `NumberField` / `Select` / `Combobox` / `Switch` / `RadioGroup` | labels above, `CharCount` via `FormField.counter` |
| Tags, materials | `TagInput` | per-chip counters and validation (§4.2) |
| Photos | `ImageGrid` (`variant="strip"`, see §4.6) wrapping `ImageManager` staging logic | |
| Score | `ScorePanel` + `ScoreMeter` | `lib/listingScore/{etsy,ebay}.ts` |
| Preview | `MarketplacePreview` (`components/domain`) | §4.5 |
| Change list | `KeyValueList` (label = section/field, value = summary, row action "Revert") | |
| Recent sends | `Timeline` (last 3 `EtsyDraftSyncAttempt`) | |
| Banners | `Banner` (conflict = warning, failed = danger, queued delete = danger, sending = info, validation summary = danger) | one line + one action each, stacked under the header, max 2 visible |
| Footer | `StickyActionBar { status, primary, secondary, overflow }` | desktop renders as sticky footer bar (e1) |
| Overflow | `OverflowMenu` | registered in ⌘K through `usePageActions` |
| Confirms | `useConfirm` / `ConfirmDialog` (nested z 1550 when over a panel) | delete uses `typeToConfirm` = shop name |
| Review differences | `SidePanel size="lg"` | §6.4 |
| Photo detail | `SidePanel size="lg"` | big preview, alt text, replace, delete, AI alt text |
| Profiles | `Modal size="md"` (picker + section checkboxes, ≤ 4 fields) | wraps `ListingTemplates` storage |
| Schedule | `Modal size="sm"` with **`DateTimeField`** (new, §4.6) | only after API G3 |
| Toasts | `useToast` | only for results not visible on the page |
| Loading | `PanelSkeleton`-style page skeleton (header + strip + 3 field blocks + rail) | §7 |

### 4.2 Tags editor with per-tag validation (Etsy)

`TagInput { value, onChange, max: 13, maxLength: 20, separators: [',', 'Enter'], validate, flagOverlapWith: title }`, backed by `lib/etsy/seoRules` (`mergeTagInput`, `cleanTag`, `tagTitleOverlap`, `checkTags`). The editor does not re-implement any rule.

| Case (`TagDropReason` / `TagIssue`) | When | UI |
|---|---|---|
| `too_long` | typed/pasted tag > 20 | not added; inline error under the input: "'personalized baby blanket' is 25 / 20 characters". The text stays in the input so it can be shortened |
| `duplicate` | `tagKey` match | not added; error "Already added: 'baby gift'"; the existing chip flashes `accent-50` 600ms (opacity only under reduced motion) |
| `invalid` / `invalid_chars` | after `cleanTag` it is empty, or has disallowed characters | not added; error names the character |
| `over_limit` | 14th tag | not added; "13 tags is Etsy's limit. Remove one to add another" |
| `title_overlap` | `tagTitleOverlap(tag, title)` non-empty | **added**, chip gets a `warning-solid` dot and tooltip "Repeats 'blanket' from the title. Tags work better with new words" |
| `single_word` | one-word tag | added, chip gets a neutral `(?)` tooltip "Two- or three-word tags match more searches" (no tone) |
| Paste of a list | `mergeTagInput` | adds the valid ones, then one summary line: "Added 9. Not added: 2 too long, 1 duplicate · Show". "Show" expands the list |

- Each chip: text, `9/20` micro counter (warning at 18, danger above 20 cannot occur), ✕ (`IconButton` label "Remove tag {tag}"). Chips reorder by drag on desktop (Etsy does not rank tags by order, so reorder is cosmetic and **not** offered; no drag).
- Backspace on an empty input selects the last chip, a second Backspace removes it.
- Counter in the label row: `13 / 13` (success-fg is not used; neutral until 13, warning only when < 13 and the score check fails is shown in the panel, not here).
- Materials use the same `TagInput` with `max: 13, maxLength: 45`, no overlap flag.
- eBay has no tags: the `specifics` section takes its place (required aspects first, each a `Combobox` when `aspectMode=SELECTION_ONLY`, creatable when `FREE_TEXT`; value length ≤ 65 per `lib/ebay/payloadRules.ts`).

### 4.3 AI actions inline per field

Every AI action is a `Button variant="ghost" size="sm" icon={Sparkles}` placed in the field's helper row (right side) or the section `action`. Endpoints are the existing ones; the editor consolidates them in `useListingAI(marketplace)`.

| Field | Label (glossary) | Etsy call | eBay call | Result handling |
|---|---|---|---|---|
| Title | Suggest a title | `POST /api/ai/etsy {action:'optimize_title'}` → `normalizeTitle()` | `POST /api/clawd/ebay-ai?action=optimize_title` (≤ 80) | proposal card |
| Description | Write description | `generate_description` | `generate_description` | proposal card in Preview mode |
| Tags | Get tag ideas | `suggest_tags {mode:'add'}` → `normalizeTags(…, {dropTitleOverlap:true})` | — | suggestion chips |
| Item specifics | Fill item specifics | — | `suggest_aspects` | proposal list (each aspect Use / Skip) |
| Photos alt text | Write alt text for N | `generate_alt_text` per image | — | proposal per photo in the photo panel; "Use all" |
| Price | Check price | `GET /api/clawd/etsy?action=search_market` (needs API G2) | `suggest_price` + `ebay-research niche_analyze` | `PriceBand` + `SourceNote` + [Use $49] |
| Whole listing (create) | Fill from photos | the Etsy creator's existing AI fill, run in sequence: `optimize_title` → `generate_description` → `suggest_tags`, seeded by a one-line "What are you selling?" input in the Start faster card, because the Etsy endpoints read text, not images (category stays a manual pick in v1; reading photos for Etsy needs an `identify_product` equivalent in `/api/ai/etsy`, out of scope) | `identify_product` → research → title → category → aspects → price → description (the existing 7-step autofill) | each field gets its own proposal card; nothing is applied until Use (or "Use all" in the Start faster card) |
| Photo (create) | Generate a photo | `POST /api/ai/generate-image` (existing) | same | generated image appears as a staged tile with an "AI" badge |

**Proposal card** (the one AI result pattern, `ds/inputs/FieldSuggestion`, §4.6):
- Appears directly under the field, `neutral-0` with 1px `accent-200` border, `Sparkles` 16 icon, the proposed value, its own counter (`134 / 140`), and three actions: [Dismiss] (ghost) · [Try again] (ghost) · [Use] (secondary, **not** primary: the footer keeps the only primary).
- [Use] writes the value into the field (dirty marker appears, autosave runs). A toast "Title replaced · Undo" (6s) restores the previous value. Nothing is ever sent to the marketplace.
- AI output passes the existing guards first (`coerceAiString`, `looksGarbled`, `normalizeTitle`, `normalizeTags`; `feedback_ai_response_safety`): garbled or empty output shows an inline `ErrorState variant="inline"` "The suggestion didn't come out right · Try again", never a raw toast of model text.
- Titles, descriptions, tags and alt text are always English (P5). Only the card's one-line rationale (when the API returns one) follows the UI locale.
- Loading: the button shows "Writing…" with a spinner (keeps width); the field stays editable. Two different AI actions may run at once; the same one is single-flight.
- Research context: the hook passes `market_context` from the research prefill when present, otherwise from a lazy `search_market` on the first title phrase (existing `fetchQuickResearch` logic), and the card says "Based on 48 Etsy listings for 'baby name blanket'" when it used one.

**Tag ideas** render as suggestion chips under the `TagInput` (`TagInput.suggestions`, §4.6): each chip `+ newborn gift` adds one; [Add all that fit] adds up to the remaining slots; chips that would overlap the title or exceed 20 are not shown (already dropped by `normalizeTags`). "Open Keyword explorer ↗" opens `/app/research/keywords?listing=<id>` in a `SidePanel lg` when R2 ships, a new tab until then.

### 4.4 Listing health panel with actionable fixes

`scoreListing(draftView, marketplace)` runs **on the client on every change** (pure function, < 1ms) over the merged view (Etsy values + staged patch). The list page shows the same function's result on the last *sent* state; the editor header pill says "78 → 86 after you send" when they differ (caption, neutral).

Etsy checks (`lib/listingScore/etsy.ts`, impact points sum to 100; `na` checks leave the denominator):

| id | Check | pass / warn / fail | Impact | Fix (`Check.fix`) |
|---|---|---|---|---|
| `photos_count` | Photos | ≥ 10 pass, 5–9 warn, < 5 fail | 14 | "Add photos" → focus `photos` upload |
| `photos_alt` | Alt text on every photo | all pass, any missing fail | 6 | "Write alt text" → AI alt for missing ones (proposals) |
| `video` | Has a video | yes pass, no warn | 4 | "Add video" → video tile |
| `title_length` | Title length (`TITLE_MIN` 100 – `TITLE_MAX` 140) | 100–140 pass, 70–99 warn, < 70 fail | 12 | "Suggest a title" |
| `title_format` | `checkTitle` issues (case, separators, repeated words) | none pass, 1 warn, ≥ 2 fail | 6 | "Fix title format" → applies `normalizeTitle` as a proposal |
| `tags_count` | 13 tags | 13 pass, 10–12 warn, < 10 fail | 12 | "Get tag ideas" |
| `tags_quality` | `checkTags`: overlap, single-word, duplicates | 0 issues pass, ≤ 2 warn, > 2 fail | 8 | "Show weak tags" → scroll + highlight flagged chips |
| `description` | ≥ 160 words and first 160 chars contain a title phrase | both pass, one warn, none fail | 10 | "Write description" |
| `attributes` | Required category attributes filled (`is_required` taxonomy properties) | all pass, any missing fail; `na` without taxonomy | 10 | "Fill details" → `details` |
| `materials` | ≥ 1 material | pass / warn | 3 | focus materials |
| `shipping_ready` | Shipping profile + processing + weight set | all pass, weight missing warn, profile missing fail | 8 | focus first missing |
| `price_market` | Price inside the market p25–p75 band | inside pass, outside warn; **`na` without research data** | 7 | "Check price" |

- Panel header: "Listing health 78 / 100 Good · Scored on 11 of 12 checks". Bands per §3.10.
- Rows sorted by impact of failing/warn checks first, then passes collapsed into "✓ 8 checks pass · Show".
- `Check.fix.field` → `SectionNav.scrollTo(section, fieldId)` then focus; `Check.fix.action` → runs the AI action which **only produces a proposal** (P6/§3.10: nothing pushed).
- No "tag demand" check in v1: there is no honest demand source in the editor yet. It returns when Keyword explorer (R2) provides Demand Signal per tag; until then it is not listed (not even as `na`) to keep the panel short.

eBay checks (`lib/listingScore/ebay.ts`): `photos_count` (≥ 8 pass, 4–7 warn, < 4 fail, 14), `title_length` (60–80 pass, 40–59 warn, 12), `title_keywords` (brand/type words present from aspects, 6), `aspects_required` (all required filled, 16), `aspects_recommended` (≥ 70% of recommended, 10), `condition` (set; used items need condition description, 8), `description` (≥ 100 words, 10), `category` (set and leaf, 6), `policies` (3 policies set, 8), `package` (weight + dimensions, 6), `price_market` (`na` without research, 4).

### 4.5 Live marketplace preview

`MarketplacePreview { marketplace, listing: PreviewModel, surface: 'search'|'listing', device: 'desktop'|'mobile' }`, controls: `SegmentedControl` [Search | Listing] and [Desktop | Mobile] (icons with labels for screen readers).

| Surface | Shows | Source |
|---|---|---|
| Etsy search card | image 1 (4:3 crop as Etsy crops it, with a dashed crop outline toggle "Show crop"), title clamped to 2 lines (desktop) / ~55 chars visible (mobile), price in shop currency via `Money`, shop name | draft view + `EtsyShop.shopName` from `/api/integrations/etsy/shops` |
| Etsy listing page | photo carousel (thumbs), title full, price, variation selects (labels only), personalization box with instructions and char limit, first 3 lines of description then "Learn more about this item", "Made to order" / processing line | draft view |
| eBay search row | image 1 (square), title (80), condition, price + currency, "Free shipping" only when the fulfillment policy says so (unknown → omitted) | draft view + policy list |
| eBay item page | gallery, title, subtitle, condition, item specifics table (first 8), price | draft view |

- **Honest preview:** no stars, review counts, "Bestseller" or sales badges: we do not have them for the user's own listing in the editor and inventing them is a P6 violation. A caption under the card says "Preview. Etsy's exact layout may differ."
- Description preview renders plain text the way Etsy does (line breaks kept, no HTML, entities already decoded at ingest by `lib/text/decodeEntities.ts`). eBay description renders sanitized HTML (existing eBay description allows HTML) in a sandboxed `iframe srcdoc` with no scripts.
- Updates on every keystroke with a 150ms debounce. Image changes (reorder/delete) update immediately from the staged media list (`/api/etsy-drafts/media-preview` for staged local files).
- One actionable hint line under the card when it applies, from the same rule set as the score: "Etsy cuts titles at about 55 characters on mobile search: your first 55 are 'Personalized Baby Blanket, Custom Name Blanket, Newb'".

### 4.6 Additions to the system (justified; to be added to `DESIGN_SYSTEM.md` §4)

| Addition | Why it cannot be an existing component | Spec |
|---|---|---|
| `ds/page/SectionNav` | `SidePanel` already owns a `sectionNav` prop (§4.5) but full pages (editor, creator, settings-like long forms) need the same anchor chips outside a panel. Extracting it gives one implementation for both | `{ sections: { id; label; state?: 'attention'|'danger' }[]; activeId; onSelect(id) }`; sticky at `top: var(--kx-topbar)`; scroll-spy with `IntersectionObserver`; chips 32px (44 coarse), `accent-50` + `accent-600` text for active; h-scroll strip on mobile. `SidePanel` uses it internally |
| `ds/inputs/FieldSuggestion` | §3.19 defines AI action wording but the system has no pattern for showing an AI result. Without one, every surface invents its own (today: silent overwrite + toast). BulkGrid's "Improve with AI" stages dirty cells, which is the grid equivalent; this is the form equivalent | `{ value: string \| string[]; counter?: { value; max }; basis?: string; onUse(); onDismiss(); onRetry(); loading?; error? }` as described in §4.3 |
| `TagInput.suggestions` prop | Extension of an existing component, not a new one | `suggestions?: string[]; onAcceptSuggestion?(tag); onAcceptAll?()` |
| `ImageGrid variant="strip"` | Extension: one horizontal row with h-scroll (the brief's "photos strip at top"), tiles 96 desktop / 72 mobile, and a trailing video tile | `variant?: 'grid'|'strip'; video?: { src; poster; staged? }` |
| `ds/inputs/DateTimeField` | Scheduling needs one date + time. `DateRangeField` is a range. x-date-pickers v6 Community ships `DateTimePicker` (no new dependency) | `{ value: Date|null; onChange; min?: Date; timezone: string }`, popover z 1600, sheet on mobile; shows the seller timezone ("Europe/Istanbul") |
| `FormField.dirty` + `FormField.onRevert` | The dirty tint exists for cells (§2.6). Fields need the same signal and the same "Revert" escape | `dirty?: boolean` draws the 2px `attention-solid` left bar and a caption "Changed · Revert" |

No other new pattern is used.

---

## 5. Save model and footer

### 5.1 One autosave engine (`useListingDraft`)

`components/domain/listing-editor/useListingDraft.ts` with one adapter per marketplace (`adapters/etsy.ts`, `adapters/ebay.ts`):

```ts
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline';
interface DraftSection { id: SectionId; isDirty(): boolean; stage(): Promise<void> } // registered by each section
interface UseListingDraft {
  view: ListingView;               // remote values merged with the staged patch
  remote: ListingView | null;      // last refreshed marketplace state (null in create)
  draft: DraftRow | null;          // EtsyListingDraft / EbayListingDraft row
  changes: ChangeSummary[];        // field groups that differ from remote (drives counts + "Not sent yet")
  saveState: SaveState; savedAt?: Date;
  setField(key, value): void;      // marks dirty, schedules stage
  register(section: DraftSection): () => void;
  saveNow(): Promise<void>;        // ⌘S
  send(opts?: { publish?: boolean }): Promise<SendResult>; // the primary
  discard(): Promise<void>;
  refreshRemote(): Promise<void>;  // pull, from SyncMeta ⟳
}
```

- **Debounce 1.5s** after the last change, plus on field blur, on `⌘S`, before `send()`, on route change and on `visibilitychange: hidden`. One request in flight; changes during a request queue one follow-up.
- Etsy staging (unchanged server contract): core fields → `stageEtsyDraft({ fields, replaceFields: true })` (same payload builder as today's `handleSave`, moved into the adapter); category attributes → `taxonomy: { properties }` (today's `getChangedListingProperties`, no separate button); inventory/variations → `inventory` (VariationEditor `stage()`); personalization → `personalization`; media → `stageEtsyDraftFile` / `media` ops (ImageManager, VideoUploader); state actions → `queuedActions`.
- eBay staging: `stageEbayDraft({ inventoryFields, offerFields, variationFields, media, queuedActions, replaceFields: true })` (today's eBay `handleSave` builder moved into the adapter).
- A field equal to the remote value is removed from the patch (`replaceFields: true` already does this for Etsy core fields). When every patch is empty and no media/actions are staged, the draft is discarded server-side (existing `fields: {}` path) and the state becomes "Up to date with Etsy".
- **localStorage** is used only when staging fails with a network error: the view is written to `listing_draft_<id>` (existing key, try/catch) and the state becomes `offline` ("Couldn't save · kept on this device · Retry"). On reload, a newer device copy than `draft.updatedAt` shows an attention `Banner` "Unsaved edits from this device · [Restore] [Discard]". The `:staged` marker logic is deleted.
- Sub-editors (`VariationEditor`, `PersonalizationEditor`, `ImageManager`, `VideoUploader`) get an `embedded` prop that hides their own save buttons and exposes `stage()` + `isDirty()` through `forwardRef`/`useImperativeHandle`; they call `register()`. Their internal staging calls are unchanged.
- Create mode: the first stage creates the draft at a negative local listing id with `queuedActions: [{ type: 'create_listing', payload: fields }]` (existing server merges `payload` with later `fieldPatch`, `draftService.ts` L2032). The URL is replaced with `?draft=<id>` so a reload resumes. Defaults memory (`defaultsStorageKey`) is kept.

### 5.2 Footer (`StickyActionBar`)

| Situation | Status text (left of the buttons) | Secondary | Primary |
|---|---|---|---|
| Edit, no changes | "Up to date with Etsy" | — | **not rendered** (P1: a button that cannot do anything is not rendered); the footer still shows ⋯ and the status |
| Edit, typing | "Unsaved changes" (attention dot) | Discard changes | Send changes to Etsy |
| Edit, saving | "Saving…" | Discard changes | Send changes to Etsy (enabled; `send()` flushes the save first) |
| Edit, saved | "Saved 10:42 · 3 edits not sent yet" | Discard changes | Send changes to Etsy (one listing = one change; the field count is "edits", CRITIQUE C1) |
| Save failed | "Couldn't save · Retry" (danger dot, "Retry" is a link) | Discard changes | Send changes to Etsy (disabled, reason "Save first: we couldn't reach KolayXport") |
| Offline fallback | "Kept on this device · Retry" | — | disabled, same reason |
| Sending | "Sending to Etsy…" (info) | — | button `loading` "Sending…" |
| Send failed | "Send failed · see above" (danger) | Discard changes | Try sending again |
| Conflict | "Changed on Etsy · review first" (warning) | Discard changes | Review differences (opens §6.4; the send itself is reachable only after review) |
| Create, empty | "Not saved yet" | Discard | Publish on Etsy ▾ (`SplitButton`) |
| Create, saved | "Saved · not on Etsy yet" | Discard | Publish on Etsy ▾ |
| eBay | same rows with "eBay" | | "Send changes to eBay"; create: "List on eBay ▾" / "Save on eBay as unpublished" |

- **Count** N = number of `ChangeSummary` groups (Title, Description, Tags, Materials, Price, Quantity, SKU, Photos, Photo order, Alt text, Video, Variations, Category, Category details, Who/when/supply, Section, Personalization, Shipping profile, Processing, Return policy, Weight & size, plus one per queued state action). Clicking the status opens a popover with the same list as the rail's "Not sent yet".
- `⌘S` → `saveNow()`; `⌘↵` → primary (respects disabled state); both work inside inputs (P3).
- **Send** flow: flush save → client validation (`validateEtsyFields`, `validateEtsyInventory`, `validateEtsyPersonalization`; eBay `payloadRules`) → if `block_sync` errors: scroll to and focus the first, danger `Banner` "Fix 2 fields before sending to Etsy", stop → else `syncEtsyDraft(draftId)` → success: toast "Sent to Etsy" (or "Sent with 1 warning · Details"), refresh remote, state "Up to date". Warnings (`result.warnings`, already i18n keys) render as a warning `Banner` with the list, not as a 10s toast.
- **Discard changes** → `useConfirm({ title: "Discard 3 changes?", body: "Your listing on Etsy stays as it is.", confirmLabel: "Discard changes", tone: 'danger' })` → `discardEtsyDraft`. In create mode: "Delete this new listing draft?".
- **Leaving the page**: no confirm when `saveState` is `saved`/`idle` (everything is in the DB draft). Confirm only for `dirty`/`saving` (flushes first, then leaves if it succeeds) and `error`/`offline` ("Your last edits are only on this device").

---

## 6. States

### 6.1 Page load

| State | Trigger | UI |
|---|---|---|
| Skeleton | `useAsyncState` loading, after 200ms | header title bar, pill blocks, strip of 6 × 96 tiles, 3 field blocks, rail with a meter bar and a card block |
| Slow | 15s | skeleton replaced by "Still loading… [Retry]" in the form column |
| Error | 30s or request failed | `ErrorState variant="page"`: "Couldn't load this listing from Etsy" + cause (`draftErrorI18n` / HTTP mapping: 401 → "Etsy needs to be reconnected" + [Reconnect Etsy]; 404 → "This listing isn't on Etsy any more" + [Back to listings], and if a draft exists [Open the draft]) + [Try again] + "Copy error ID" |
| Not connected | no Etsy shop | `ConnectState brand="etsy"` replaces the body |
| Shop mismatch | `?shop` not owned / missing | redirect to `/app/etsy-listings` with toast "Choose a shop first" |
| Ready | | form |

Partial loads (each region has its own four states; none blocks the form):
- Videos (`get_listing_videos`) fail → the video tile shows `ErrorState variant="inline"` "Couldn't load the video · Retry"; photos and fields work.
- Taxonomy properties fail → Details shows "Couldn't load category details · Retry"; the `attributes` check becomes `na`.
- Shop metadata (sections/shipping profiles/return policies) fail → those selects show the current value as a read-only label + "Couldn't load your profiles · Retry".
- Drafts fetch fails → `Banner` warning "Couldn't check for unsent changes · Retry"; editing is allowed but **Send is disabled** ("We couldn't check your draft") to avoid overwriting a draft we did not see.
- Research for price/tags fails → only that card shows `—` with the reason.

### 6.2 Empty

- Create mode (§3.2) is the empty state: upload dropzone, "Start faster" card, rail "Add a photo and a title to get a score".
- Photos 0 on an existing listing → dropzone inline in the strip ("This listing has no photos. Etsy needs at least 1 to publish").
- No variations → section row "No variations · [Add variations]"; no personalization → `Switch` "Ask buyers for personalization" off.
- No shop sections → Select empty + "+ New section" (stages `create_shop_section`, existing).

### 6.3 Draft-state banners (stacked under the header, one line each)

| Draft condition (`EtsyListingDraft`) | Banner | Action |
|---|---|---|
| `status = failed` | danger: "Couldn't send to Etsy: {cause}" (cause from `draftErrorI18n(lastSyncError)` server keys; unknown → "Etsy rejected the change", with "Copy error ID" = latest `EtsyDraftSyncAttempt.id`) | [Try sending again] |
| `status = conflict` | warning: "Changed on Etsy since your draft" | [Review differences] |
| `status = syncing` | info: "Sending to Etsy… started 10:41" (fields read-only) | — (stale > 10 min → existing recovery flips it to failed) |
| queued `delete` | danger: "This draft will delete the listing on Etsy when sent" | [Remove delete] (`removeEtsyDraftQueuedActions(['delete'])`) |
| queued `deactivate` / `publish` / `renew` | info: "Will deactivate on Etsy when you send" | [Undo] (remove that queued action) |
| local device copy newer | attention: "Unsaved edits from this device" | [Restore] (Discard is in the line's ⋯) |
| validation on send | danger: "Fix 2 fields before sending to Etsy" | [Go to first] |

The field-level errors (`FieldError.field` → `FormField.error`) are always shown inline as well; the banner is only the summary (§3.7).

### 6.4 Review differences (conflict)

`SidePanel lg` titled "Review differences", opened from the banner or the footer primary.

```
┌ Review differences                                                     ✕ ┐
│ Etsy changed this listing at 14:02, after your draft started at 10:31.     │
│ Pick what to keep for each field.                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ Field        Your draft                 On Etsy now               Keep    │
│ Title        Personalized Baby Blan…    Personalized Baby Blan…  (•)Mine ( )Etsy │
│ Price        $69.99                     $64.99                   (•)Mine ( )Etsy │
│ Quantity     —  (not in your draft)     38                       Etsy's (no choice) │
│ ⚠ Queued: delete listing                                         [Remove] │
├──────────────────────────────────────────────────────────────────────────┤
│                                  [Cancel]  [Keep my choices]              │
└──────────────────────────────────────────────────────────────────────────┘
```
- Data from **API G1** (`GET /api/etsy-drafts/[id]/diff`). Fields Etsy changed but the draft did not touch are listed read-only (so the user knows what moved).
- [Keep my choices] → **API G1** `POST /api/etsy-drafts/[id]/resolve { keep: string[] }`: drops the fields marked "Etsy" from the patch, re-bases `baseSnapshot`/`baseEtsyUpdatedTimestamp` on the live listing, sets `status: 'draft'`. The panel closes, the banner clears, the footer returns to "Send N changes to Etsy". Sending is a separate, explicit click: the review never sends by itself.
- A queued `delete` is always listed first with [Remove]; the primary stays enabled but the confirm after it repeats "This will delete the listing on Etsy" with `typeToConfirm` (shop name).
- `force: true` is **not** reachable from the UI any more.

### 6.5 Other interactions

- **Photos strip:** drag to reorder (keyboard: focus a tile, `Space` to lift, arrows to move, `Space` to drop; announced via `aria-live`); drop files anywhere on the section; tile badges: `★` primary (first), `!` missing alt text (warning dot), staged add (attention dot + "New"), staged delete (tile 40% opacity + "Will be removed · Undo"). Click a tile → photo `SidePanel lg` (large image, alt text `TextArea` with 250-char counter + "Write alt text", Replace, Make primary, Remove). Video tile → same panel with player, Replace, Remove. All operations go through the existing ImageManager/VideoUploader staging calls, including the May 2026 safety rules (`lib/etsy/mediaSafety.ts`: dedupe deletes, last-op-wins reorder/alt).
- **Price & inventory:** `MoneyField` with the shop currency adornment (Etsy prices in shop currency only, so no currency select for Etsy; eBay keeps `CurrencySelect` limited to USD/GBP/EUR/TRY as today). When variations set price/quantity per combination, the price and quantity fields become read-only summaries "From $54 – $79 · set in Variations" with a link.
- **Category:** `Combobox` with `loadOptions` over the Etsy taxonomy tree (`action=taxonomy`, already used by the creator; search by name, shows the path). Changing category reloads attributes and keeps values whose `property_id` still exists; dropped values are listed in a one-line attention note "2 details don't apply to the new category and will be removed".
- **Processing profile:** keeps the existing readiness-state select + "Create profile" (`create_readiness_state`), shown as a `Select` + ghost "+ New profile" that opens a `Modal sm`.
- **Shipping profile / return policy / section creation:** the three existing creation dialogs become `Modal md` (shipping profile has 7 fields today → becomes a `SidePanel md` "New shipping profile", per the ≤ 4 field rule), staging `create_shipping_profile` etc. exactly as today.
- **Profiles (Vela parity, better):** "Apply profile…" opens a `Modal md`: profile `Select` + checkboxes for the sections it contains ("Tags", "Details", "Shipping", "Price"); applying sets those fields (dirty markers, one toast "Applied 'Baby blankets' · Undo"). Vela pushes profile edits straight to live listings with no preview or undo; here a profile only fills the draft and nothing reaches Etsy until Send. "Save as profile…" stores the chosen sections (existing `ListingTemplates` storage). **eBay:** the same Modal wraps `components/ebay/ListingTemplates.tsx` storage (listings-grid §10 moved eBay Templates here; until M6 they stay on the legacy page only). Its 4 legacy dialogs are deleted with the eBay drawer (CRITIQUE U5).
- **Copy listing** (⋯) → navigates to `new?copy=<id>` (prefills the workspace from the current view, title prefixed with nothing, photos staged by URL as the creator does today). The legacy "copy" queued action on the source listing is no longer used by the editor.
- **Deactivate / Publish / Renew** (⋯) → `useConfirm`, then stage the queued action (existing), shown as an info banner + a change in the count; they go to Etsy with the next Send. Renew shows the fee note "Etsy charges a $0.20 listing fee" (i18n, static).
- **Delete listing…** (⋯, last, danger-ghost) → `useConfirm({ typeToConfirm: shopName, tone: 'danger' })` → stage `delete` (exclusive, `assertDeleteIsExclusive`) → danger banner. Never sent without Send.
- **Refresh from Etsy** (⟳ in `SyncMeta`) → `refreshRemote()`; if the draft exists and Etsy changed, the conflict check runs on the next send as today; the meta shows "Etsy changed this listing at 14:02" in warning-fg.
- **Keyboard:** `⌘S`, `⌘↵`, `Esc` (closes a proposal card / popover; on the page it does nothing), `j`/`k` prev/next outside inputs, ⌘K command "Jump to section…" (no `g` key: `g s` is Settings in shell-nav §7; CRITIQUE C3), `?` sheet.

---

## 7. Data per element (verified in code)

| Element | Read | Write (staged) | Notes / gaps |
|---|---|---|---|
| Header title, state, id, updated | `GET /api/clawd/etsy?action=listing&listing_id&shop_id` → `title, state, listing_id, updated_timestamp, url` | — | `views`, `num_favorers` shown only when > 0 |
| Sync pill, banners | `GET /api/etsy-drafts?shop_id&listing_id` → `status, lastSyncError, queuedActions, media, syncAttempts[5]` | — | `syncStatus(draft)` in `lib/ds/status/sync.ts` |
| Shop name (preview), currency | `GET /api/integrations/etsy/shops` → `shopName`; currency from `listing.price.currency_code` | — | |
| Photos | `listing.images[] {listing_image_id, url_570xN, url_fullxfull, rank, alt_text}` + draft `media` (staged) + `GET /api/etsy-drafts/media-preview` | `stageEtsyDraftFile(kind:'image')`, `stageEtsyDraft({ media: [{operation:'delete'|'reorder'|'alt_text'}] })` | logic stays inside `ImageManager` |
| Video | `GET action=get_listing_videos` | `stageEtsyDraftFile(kind:'video')`, media delete | |
| Title, description, tags, materials, price, quantity, who_made, when_made, is_supply, section, shipping profile, return policy, processing min/max, readiness_state_id, weight/unit, L/W/H/unit | `listing.*` (same fields as `EditableFields` L184–206) | `stageEtsyDraft({ fields, replaceFields:true })` → `fieldPatch` | payload builder = today's `handleSave` L1203–1252 |
| SKU | `GET action=get_listing_inventory` → `products[0].sku` (single-product listings) | `inventory` patch | **gap:** SKU is not in `EditableFields` today; it is written only by VariationEditor. v1 shows SKU only for listings without variations, staged via `inventory` with the single product |
| Category + attributes | `listing.taxonomy_id`, `GET action=get_taxonomy_properties&taxonomy_id`, `GET action=get_listing_properties` | `fields.taxonomy_id`, `taxonomy: { properties }` → `taxonomyPatch` | |
| Taxonomy search | `GET action=taxonomy&shop_id` | — | reused from creator |
| Variations | VariationEditor's own reads (`get_listing_inventory`, property ids) | `inventory`, `variationImages` | embedded |
| Personalization | `listing.is_personalizable, personalization_*`, `personalization_questions` | `personalization` → `personalizationPatch` | embedded |
| Sections / profiles / policies lists | `get_shop_sections`, `get_shipping_profiles`, `get_return_policies`, `get_readiness_states` | `queuedActions: create_shop_section / create_shipping_profile / create_return_policy`, `create_readiness_state` (direct, as today) | |
| Score | client `scoreListing(view)` | — | new `lib/listingScore/etsy.ts` |
| Price band | `GET action=search_market&keywords` → `priceStats` | — | **gap:** returns `min/avg/median/max`; avg is banned (P6). API G2 adds `p25, p75, n, excluded` |
| AI | `POST /api/ai/etsy` actions `optimize_title, generate_description, suggest_tags, generate_alt_text`; `POST /api/ai/generate-image` | — (proposal → field) | |
| Recent sends | `draft.syncAttempts` (`status, startedAt, finishedAt, error`) | — | after a successful send the draft leaves the list; the rail then shows "Last sent {date}" from `EtsyListingDraft.syncedAt` via **API G1** `GET /api/etsy-drafts/history?listing_id` (last 3 synced drafts) |
| Conflict diff | — | — | **API G1** |
| eBay listing | `GET /api/clawd/ebay?action=listing&sku&user_id` (`product.*, condition*, availability, offers[0].*, packageWeightAndSize`) | `stageEbayDraft({ inventoryFields, offerFields, variationFields, media })` | |
| eBay aspects / categories | `action=item_aspects&category_id`, `action=category_suggestions&q`, `action=store_categories` | inventory `aspects`, offer `categoryId`, `storeCategoryNames` | |
| eBay policies | `action=fulfillment_policies` (+ return, payment, as the list page does) | offer `listingPolicies` | |
| eBay AI | `POST /api/clawd/ebay-ai?action=optimize_title|generate_description|suggest_price|suggest_aspects|identify_product|analyze_listing` | — | `analyze_listing` is replaced by the score panel and not called from the editor |
| eBay market | `GET /api/clawd/ebay-research?action=niche_analyze&q&marketplace_id=EBAY_US` | — | price band uses its sold/active prices through `robustStats` (R0) |

### 7.1 Minimal API additions (each owned by one group in §10)

| Id | Endpoint / change | Why | Size |
|---|---|---|---|
| **G1** | `GET /api/etsy-drafts/[id]/diff` → `{ remoteUpdatedAt, fields: [{ key, base, remote, draft, changedRemotely, inDraft }], queuedActions }` (uses `getListing` + `remoteChangedKeys` + `fieldPatch`); `POST /api/etsy-drafts/[id]/resolve { keep: string[] }` (drop non-kept conflicting keys, re-base to live, status `draft`); `GET /api/etsy-drafts/history?shop_id&listing_id` (last 3 `synced` drafts with `syncedAt` and changed keys) | conflict review without blind force; rail history | ~180 lines in `draftService.ts` + 3 route files |
| **G2** | `search_market` response adds `priceStats.{p25, p75, n, excluded}` via `lib/research/stats.ts` `robustStats` (R0); `avg` stays in the payload for legacy callers until research R1, the editor never reads it | honest price band | ~20 lines once R0 lands |
| **G3** | **Owned by listings-grid** (M5, groups G0 and G4: one migration adding `scheduledSendAt` to `EtsyListingDraft`, `EbayListingDraft` and `CatalogDraft`, the `PATCH` field, and the one cron file; CRITIQUE C13). This surface only consumes it. For reference, the contract: `EtsyListingDraft.scheduledSendAt DateTime?` (migration) + `PATCH /api/etsy-drafts/[id] { scheduledSendAt }` + `pages/api/cron/send-scheduled-drafts.ts` (every 5 min, `CronLock`, calls `syncDraft`; conflict → leaves it `conflict` and notifies via `lib/notifications.ts`) | replace the tab-bound localStorage scheduler | ~150 lines + migration. Until shipped, "Schedule send…" is **not rendered** |
| **F1** | eBay: `queuedActions: [{ type: 'create', payload }]` handled in `lib/ebay/draftService.ts` `syncDraft` (moves the creator's `create_inventory_item` → (group) → `create_offer` → optional `publish_offer` sequence server-side; the 404 guard at L363 already anticipates `create`); `stageEbayDraft` accepts a local SKU for new listings | eBay create must stage, not write | ~250 lines, moved not new |
| **F2** | `lib/ebay/draftClient.ts`: typed `EbayDraftClientError { status, code, key, params }` like Etsy; eBay routes return `{ code, key }` for known failures; `sync` returns 409 for conflicts with `fields` | i18n errors, conflict UI parity | ~80 lines |
| **F3** | `GET /api/ebay-drafts/[id]/diff` + `resolve` (same contract as G1, over `baseSnapshotInventory/Offer`) | conflict review parity | ~120 lines; eBay conflict review ships after Etsy (until then eBay conflict shows the banner with [Discard my changes] and [Refresh and keep editing]) |

No change to `POST /api/etsy-drafts`, `/sync`, `/bulk-sync`, `/media`, `PATCH`/`DELETE [id]`.

---

## 8. i18n keys

New namespace **`listingEditor`** (shared by both marketplaces; `{marketplace}` is the display name "Etsy"/"eBay"). **Turkish dative** uses the ICU select `{mpDat}` from orders.md §11 (`Etsy'ye`, `eBay'e`), never `{marketplace}'e`, which produced "Etsy'e" (CRITIQUE C11; patched in every key below). Locative `'de` and ablative `'den` are correct for both names and stay. Sentence case, real Turkish characters, glossary wording. Field validation messages keep using the existing `etsy.validation.*`, `etsy.draftSync.*`, `etsy.aiErrors.*` keys (server returns those keys). Status pills use `status.listing.*` / `status.sync.*` from the DS.

| Key | en | tr |
|---|---|---|
| `listingEditor.page.editTitle` | Edit listing | İlanı düzenle |
| `listingEditor.page.newTitle` | New listing | Yeni ilan |
| `listingEditor.page.back` | {marketplace} listings | {marketplace} ilanları |
| `listingEditor.page.idMeta` | #{id} · Updated on {marketplace} {date} | #{id} · {marketplace}'de güncellendi: {date} |
| `listingEditor.page.startedMeta` | {shop} · Started {time} | {shop} · Başlangıç {time} |
| `listingEditor.page.prev` | Previous listing | Önceki ilan |
| `listingEditor.page.next` | Next listing | Sonraki ilan |
| `listingEditor.page.stats` | {views} views · {favorites} favorites | {views} görüntülenme · {favorites} favori |
| `listingEditor.nav.label` | Sections | Bölümler |
| `listingEditor.nav.changes` | {section}, {count, plural, one {# change} other {# changes}} not sent | {section}, {count} değişiklik gönderilmedi |
| `listingEditor.nav.errors` | {section}, needs a fix | {section}, düzeltilmesi gerekiyor |
| `listingEditor.section.photos` | Photos & video | Fotoğraflar ve video |
| `listingEditor.section.title` | Title & description | Başlık ve açıklama |
| `listingEditor.section.tags` | Tags | Etiketler |
| `listingEditor.section.specifics` | Item specifics | Ürün özellikleri |
| `listingEditor.section.price` | Price & inventory | Fiyat ve stok |
| `listingEditor.section.variations` | Variations | Varyasyonlar |
| `listingEditor.section.details` | Details | Detaylar |
| `listingEditor.section.personalization` | Personalization | Kişiselleştirme |
| `listingEditor.section.shipping` | Shipping | Kargo |
| `listingEditor.photos.count` | {count} / {max} | {count} / {max} |
| `listingEditor.photos.needAlt` | {count, plural, one {# needs alt text} other {# need alt text}} | {count} fotoğrafta alt metin yok |
| `listingEditor.photos.dropzone` | Drop photos here or | Fotoğrafları buraya bırakın veya |
| `listingEditor.photos.choose` | Choose photos | Fotoğraf seçin |
| `listingEditor.photos.hint` | JPG, PNG or GIF, up to {max} · 2000px or larger looks best | JPG, PNG veya GIF, en fazla {max} · 2000px ve üzeri en iyi sonucu verir |
| `listingEditor.photos.pasteLinks` | Paste image links | Görsel bağlantısı yapıştır |
| `listingEditor.photos.reorderHint` | Drag to reorder · drop files to add | Sıralamak için sürükleyin · eklemek için dosya bırakın |
| `listingEditor.photos.primary` | Primary | Ana fotoğraf |
| `listingEditor.photos.new` | New | Yeni |
| `listingEditor.photos.willRemove` | Will be removed | Kaldırılacak |
| `listingEditor.photos.makePrimary` | Make primary | Ana fotoğraf yap |
| `listingEditor.photos.replace` | Replace | Değiştir |
| `listingEditor.photos.remove` | Remove | Kaldır |
| `listingEditor.photos.altLabel` | Alt text | Alt metin |
| `listingEditor.photos.altHelper` | Describes the photo for screen readers and search | Fotoğrafı ekran okuyucular ve arama için tanımlar |
| `listingEditor.photos.noPhotos` | This listing has no photos. {marketplace} needs at least 1 to publish | Bu ilanda fotoğraf yok. {marketplace} yayın için en az 1 fotoğraf ister |
| `listingEditor.photos.moved` | Moved photo {from} to position {to} | Fotoğraf {from}. sıradan {to}. sıraya taşındı |
| `listingEditor.video.label` | Video | Video |
| `listingEditor.video.add` | Add video | Video ekle |
| `listingEditor.video.loadFailed` | Couldn't load the video | Video yüklenemedi |
| `listingEditor.field.title` | Title | Başlık |
| `listingEditor.field.titleHelperEtsy` | Title case, commas only | Kelimelerin baş harfi büyük, ayraç olarak yalnızca virgül |
| `listingEditor.field.titleRepeats` | "{word}" repeats in {count} tags | "{word}" {count} etikette tekrar ediyor |
| `listingEditor.field.subtitle` | Subtitle | Alt başlık |
| `listingEditor.field.description` | Description | Açıklama |
| `listingEditor.field.descriptionWords` | {count} words | {count} kelime |
| `listingEditor.field.edit` | Edit | Düzenle |
| `listingEditor.field.preview` | Preview | Önizleme |
| `listingEditor.field.materials` | Materials | Malzemeler |
| `listingEditor.field.price` | Price | Fiyat |
| `listingEditor.field.quantity` | Quantity | Adet |
| `listingEditor.field.sku` | SKU | SKU |
| `listingEditor.field.priceFromVariations` | From {min} – {max} · set in Variations | {min} – {max} arası · Varyasyonlarda ayarlanır |
| `listingEditor.field.category` | Category | Kategori |
| `listingEditor.field.categoryDropped` | {count, plural, one {# detail doesn't} other {# details don't}} apply to the new category and will be removed | {count} detay yeni kategoriye uymuyor ve kaldırılacak |
| `listingEditor.field.whoMade` | Who made it | Kim yaptı |
| `listingEditor.field.whatIsIt` | What is it | Bu nedir |
| `listingEditor.field.whenMade` | When was it made | Ne zaman yapıldı |
| `listingEditor.field.section` | Shop section | Mağaza bölümü |
| `listingEditor.field.newSection` | New section | Yeni bölüm |
| `listingEditor.field.condition` | Condition | Durum |
| `listingEditor.field.conditionDescription` | Condition description | Durum açıklaması |
| `listingEditor.field.shippingProfile` | Shipping profile | Kargo profili |
| `listingEditor.field.processing` | Processing time | Hazırlama süresi |
| `listingEditor.field.returnPolicy` | Return policy | İade politikası |
| `listingEditor.field.paymentPolicy` | Payment policy | Ödeme politikası |
| `listingEditor.field.weight` | Weight | Ağırlık |
| `listingEditor.field.dimensions` | Length, width, height | Uzunluk, genişlik, yükseklik |
| `listingEditor.field.fromLastListing` | From your last listing | Son ilanınızdan |
| `listingEditor.field.changed` | Changed | Değişti |
| `listingEditor.field.revert` | Revert | Geri al |
| `listingEditor.field.profilesLoadFailed` | Couldn't load your profiles | Profilleriniz yüklenemedi |
| `listingEditor.field.detailsLoadFailed` | Couldn't load category details | Kategori detayları yüklenemedi |
| `listingEditor.tags.placeholder` | Type a tag or paste a list, Enter to add | Etiket yazın veya liste yapıştırın, eklemek için Enter |
| `listingEditor.tags.remove` | Remove tag {tag} | {tag} etiketini kaldır |
| `listingEditor.tags.tooLong` | "{tag}" is {length} / {max} characters | "{tag}" {length} / {max} karakter |
| `listingEditor.tags.duplicate` | Already added: "{tag}" | Zaten ekli: "{tag}" |
| `listingEditor.tags.invalid` | "{tag}" has characters {marketplace} doesn't allow: {chars} | "{tag}" {marketplace}'in izin vermediği karakterler içeriyor: {chars} |
| `listingEditor.tags.overLimit` | {max} tags is {marketplace}'s limit. Remove one to add another | {marketplace} en fazla {max} etikete izin verir. Yenisini eklemek için birini kaldırın |
| `listingEditor.tags.overlap` | Repeats "{words}" from the title. Tags work better with new words | Başlıktaki "{words}" kelimesini tekrar ediyor. Etiketler yeni kelimelerle daha iyi çalışır |
| `listingEditor.tags.singleWord` | Two- or three-word tags match more searches | İki veya üç kelimelik etiketler daha çok aramayla eşleşir |
| `listingEditor.tags.pasteSummary` | Added {added}. Not added: {reasons} | {added} eklendi. Eklenmeyenler: {reasons} |
| `listingEditor.tags.show` | Show | Göster |
| `listingEditor.tags.addAllThatFit` | Add all that fit | Sığanların hepsini ekle |
| `listingEditor.tags.openExplorer` | Open Keyword explorer | Anahtar kelime aracını aç |
| `listingEditor.ai.suggestTitle` | Suggest a title | Başlık öner |
| `listingEditor.ai.writeDescription` | Write description | Açıklama yaz |
| `listingEditor.ai.tagIdeas` | Get tag ideas | Etiket fikri al |
| `listingEditor.ai.fillSpecifics` | Fill item specifics | Ürün özelliklerini doldur |
| `listingEditor.ai.writeAlt` | Write alt text for {count} | {count} fotoğraf için alt metin yaz |
| `listingEditor.ai.checkPrice` | Check price | Fiyatı kontrol et |
| `listingEditor.ai.fillFromPhotos` | Fill from photos | Fotoğraflardan doldur |
| `listingEditor.ai.fillFromPhotosHelp` | Writes title, description, tags and category from your photos. You review every field | Fotoğraflarınızdan başlık, açıklama, etiket ve kategori yazar. Her alanı siz onaylarsınız |
| `listingEditor.ai.generatePhoto` | Generate a photo | Fotoğraf oluştur |
| `listingEditor.ai.writing` | Writing… | Yazılıyor… |
| `listingEditor.ai.suggestedTitle` | Suggested title | Önerilen başlık |
| `listingEditor.ai.suggestedDescription` | Suggested description | Önerilen açıklama |
| `listingEditor.ai.suggestedTags` | Tag ideas | Etiket fikirleri |
| `listingEditor.ai.use` | Use | Kullan |
| `listingEditor.ai.useAll` | Use all | Hepsini kullan |
| `listingEditor.ai.tryAgain` | Try again | Tekrar dene |
| `listingEditor.ai.dismiss` | Dismiss | Kapat |
| `listingEditor.ai.basis` | Based on {count} {marketplace} listings for "{query}" | "{query}" için {count} {marketplace} ilanına göre |
| `listingEditor.ai.garbled` | The suggestion didn't come out right | Öneri düzgün oluşmadı |
| `listingEditor.ai.replaced` | {field} replaced | {field} değiştirildi |
| `listingEditor.price.band` | Most similar listings sell for {p25}–{p75} (median {median}) | Benzer ilanların çoğu {p25}–{p75} arasında satılıyor (medyan {median}) |
| `listingEditor.price.use` | Use {price} | {price} kullan |
| `listingEditor.start.title` | Start faster | Hızlı başlayın |
| `listingEditor.start.applyProfile` | Apply profile… | Profil uygula… |
| `listingEditor.start.copyExisting` | Copy an existing listing… | Mevcut bir ilanı kopyala… |
| `listingEditor.health.empty` | Add a photo and a title to get a score | Puan için bir fotoğraf ve başlık ekleyin |
| `listingEditor.health.afterSend` | {now} → {next} after you send | Gönderdikten sonra {now} → {next} |
| `listingEditor.health.passing` | {count} checks pass | {count} kontrol geçti |
| `listingEditor.health.check.*` | (one label + one fix label per check id in §4.4, e.g. `photos_count`: "Only {count} photos: add {missing} more" / "Add photos") | ("Yalnızca {count} fotoğraf: {missing} tane daha ekleyin" / "Fotoğraf ekle") |
| `listingEditor.preview.title` | Preview | Önizleme |
| `listingEditor.preview.search` | Search | Arama |
| `listingEditor.preview.listing` | Listing | İlan sayfası |
| `listingEditor.preview.desktop` | Desktop | Masaüstü |
| `listingEditor.preview.mobile` | Mobile | Mobil |
| `listingEditor.preview.showCrop` | Show crop | Kırpmayı göster |
| `listingEditor.preview.disclaimer` | Preview. {marketplace}'s exact layout may differ | Önizleme. {marketplace}'in gerçek görünümü farklı olabilir |
| `listingEditor.preview.mobileCut` | {marketplace} cuts titles at about {chars} characters on mobile search | {marketplace} mobil aramada başlıkları yaklaşık {chars} karakterde keser |
| `listingEditor.changes.title` | Not sent yet ({count}) | Henüz gönderilmedi ({count}) |
| `listingEditor.changes.group.*` | Title · Description · Tags · Materials · Price · Quantity · SKU · Photos · Photo order · Alt text · Video · Variations · Category · Category details · Item details · Shop section · Personalization · Shipping profile · Processing · Return policy · Weight & size · Item specifics · Condition · Policies | Başlık · Açıklama · Etiketler · Malzemeler · Fiyat · Adet · SKU · Fotoğraflar · Fotoğraf sırası · Alt metin · Video · Varyasyonlar · Kategori · Kategori detayları · Ürün bilgileri · Mağaza bölümü · Kişiselleştirme · Kargo profili · Hazırlama süresi · İade politikası · Ağırlık ve ölçü · Ürün özellikleri · Durum · Politikalar |
| `listingEditor.history.lastSent` | Last sent {date} · {count} fields | Son gönderim {date} · {count} alan |
| `listingEditor.history.failed` | Failed {date} · {cause} | Başarısız {date} · {cause} |
| `listingEditor.save.upToDate` | Up to date with {marketplace} | {marketplace} ile güncel |
| `listingEditor.save.unsaved` | Unsaved changes | Kaydedilmemiş değişiklikler |
| `listingEditor.save.saving` | Saving… | Kaydediliyor… |
| `listingEditor.save.saved` | Saved {time} · {count, plural, one {# edit} other {# edits}} not sent yet | Kaydedildi {time} · {count} düzenleme henüz gönderilmedi |
| `listingEditor.save.savedNew` | Saved · not on {marketplace} yet | Kaydedildi · henüz {marketplace}'de değil |
| `listingEditor.save.notSavedYet` | Not saved yet | Henüz kaydedilmedi |
| `listingEditor.save.failed` | Couldn't save | Kaydedilemedi |
| `listingEditor.save.device` | Kept on this device | Bu cihazda saklandı |
| `listingEditor.save.retry` | Retry | Tekrar dene |
| `listingEditor.save.saveFirstReason` | Save first: we couldn't reach KolayXport | Önce kaydedin: KolayXport'a ulaşılamadı |
| `listingEditor.save.draftCheckReason` | We couldn't check your draft | Taslağınız kontrol edilemedi |
| `listingEditor.action.send` | Send changes to {marketplace} | Değişiklikleri {mpDat} gönder |
| `listingEditor.action.sendCount` | Send {count, plural, one {# change} other {# changes}} to {marketplace} | {count} değişikliği {mpDat} gönder |
| `listingEditor.action.sendShort` | Send to {marketplace} | {mpDat} gönder |
| `listingEditor.action.sending` | Sending… | Gönderiliyor… |
| `listingEditor.action.sendAgain` | Try sending again | Tekrar göndermeyi dene |
| `listingEditor.action.publishEtsy` | Publish on Etsy | Etsy'de yayınla |
| `listingEditor.action.sendAsDraftEtsy` | Send to Etsy as a draft (not live) | Etsy'ye taslak olarak gönder (yayında değil) |
| `listingEditor.action.listEbay` | List on eBay | eBay'de listele |
| `listingEditor.action.saveUnpublishedEbay` | Save on eBay as unpublished | eBay'de yayınlanmamış olarak kaydet |
| `listingEditor.action.discard` | Discard changes | Değişiklikleri at |
| `listingEditor.action.discardNew` | Discard | Vazgeç |
| `listingEditor.action.review` | Review differences | Farkları incele |
| `listingEditor.action.preview` | Preview | Önizleme |
| `listingEditor.action.more` | More | Diğer |
| `listingEditor.action.viewOn` | View on {marketplace} | {marketplace}'de görüntüle |
| `listingEditor.action.copy` | Copy listing | İlanı kopyala |
| `listingEditor.action.copyToEbay` | Copy to eBay | eBay'e kopyala |
| `listingEditor.action.applyProfile` | Apply profile… | Profil uygula… |
| `listingEditor.action.saveProfile` | Save as profile… | Profil olarak kaydet… |
| `listingEditor.action.schedule` | Schedule send… | Gönderimi planla… |
| `listingEditor.action.trackKeywords` | Track keywords | Anahtar kelimeleri takip et |
| `listingEditor.action.deactivate` | Deactivate on {marketplace}… | {marketplace}'de pasifleştir… |
| `listingEditor.action.publish` | Publish on {marketplace}… | {marketplace}'de yayınla… |
| `listingEditor.action.renew` | Renew on {marketplace}… | {marketplace}'de yenile… |
| `listingEditor.action.delete` | Delete listing… | İlanı sil… |
| `listingEditor.action.refresh` | Refresh from {marketplace} | {marketplace}'den yenile |
| `listingEditor.banner.failed` | Couldn't send to {marketplace}: {cause} | {mpDat} gönderilemedi: {cause} |
| `listingEditor.banner.rejected` | {marketplace} rejected the change | {marketplace} değişikliği reddetti |
| `listingEditor.banner.copyErrorId` | Copy error ID | Hata kimliğini kopyala |
| `listingEditor.banner.conflict` | Changed on {marketplace} since your draft | Taslağınızdan sonra {marketplace}'de değişti |
| `listingEditor.banner.sending` | Sending to {marketplace}… started {time} | {mpDat} gönderiliyor… başlangıç {time} |
| `listingEditor.banner.queuedDelete` | This draft will delete the listing on {marketplace} when sent | Bu taslak gönderildiğinde ilan {marketplace}'den silinecek |
| `listingEditor.banner.removeDelete` | Remove delete | Silmeyi kaldır |
| `listingEditor.banner.queuedState` | Will {action} on {marketplace} when you send | Gönderdiğinizde {marketplace}'de {action} |
| `listingEditor.banner.undo` | Undo | Geri al |
| `listingEditor.banner.deviceCopy` | Unsaved edits from this device | Bu cihazdan kaydedilmemiş düzenlemeler |
| `listingEditor.banner.restore` | Restore | Geri yükle |
| `listingEditor.banner.fixFields` | Fix {count, plural, one {# field} other {# fields}} before sending to {marketplace} | {mpDat} göndermeden önce {count} alanı düzeltin |
| `listingEditor.banner.goToFirst` | Go to first | İlkine git |
| `listingEditor.banner.warnings` | Sent with {count, plural, one {# warning} other {# warnings}} | {count} uyarıyla gönderildi |
| `listingEditor.banner.draftCheckFailed` | Couldn't check for unsent changes | Gönderilmemiş değişiklikler kontrol edilemedi |
| `listingEditor.review.title` | Review differences | Farkları incele |
| `listingEditor.review.intro` | {marketplace} changed this listing at {remoteTime}, after your draft started at {draftTime}. Pick what to keep for each field | {marketplace} bu ilanı {remoteTime}'da değiştirdi; taslağınız {draftTime}'da başlamıştı. Her alan için neyi tutacağınızı seçin |
| `listingEditor.review.field` | Field | Alan |
| `listingEditor.review.mine` | Your draft | Taslağınız |
| `listingEditor.review.remote` | On {marketplace} now | Şu an {marketplace}'de |
| `listingEditor.review.keepMine` | Mine | Benimki |
| `listingEditor.review.keepRemote` | {marketplace}'s | {marketplace}'deki |
| `listingEditor.review.notInDraft` | Not in your draft | Taslağınızda yok |
| `listingEditor.review.keep` | Keep my choices | Seçimlerimi tut |
| `listingEditor.confirm.discardTitle` | Discard {count, plural, one {# change} other {# changes}}? | {count} değişiklik atılsın mı? |
| `listingEditor.confirm.discardBody` | Your listing on {marketplace} stays as it is | {marketplace}'deki ilanınız olduğu gibi kalır |
| `listingEditor.confirm.discardNewTitle` | Delete this new listing draft? | Bu yeni ilan taslağı silinsin mi? |
| `listingEditor.confirm.leaveTitle` | Leave with unsaved edits? | Kaydedilmemiş düzenlemelerle çıkılsın mı? |
| `listingEditor.confirm.leaveBody` | Your last edits are only on this device | Son düzenlemeleriniz yalnızca bu cihazda |
| `listingEditor.confirm.leave` | Leave | Çık |
| `listingEditor.confirm.keepEditing` | Keep editing | Düzenlemeye devam et |
| `listingEditor.confirm.deleteTitle` | Delete listing "{title}"? | "{title}" ilanı silinsin mi? |
| `listingEditor.confirm.deleteBody` | It is removed from {marketplace} when you send changes. Type {shop} to confirm | Değişiklikleri gönderdiğinizde {marketplace}'den kaldırılır. Onaylamak için {shop} yazın |
| `listingEditor.confirm.deactivateBody` | Buyers won't see it until you publish it again | Tekrar yayınlayana kadar alıcılar görmez |
| `listingEditor.confirm.renewBody` | Etsy charges a $0.20 listing fee | Etsy $0.20 ilan ücreti alır |
| `listingEditor.profile.title` | Apply profile | Profil uygula |
| `listingEditor.profile.sections` | Fill these sections | Bu bölümleri doldur |
| `listingEditor.profile.applied` | Applied "{name}" | "{name}" uygulandı |
| `listingEditor.profile.saveTitle` | Save as profile | Profil olarak kaydet |
| `listingEditor.profile.name` | Profile name | Profil adı |
| `listingEditor.schedule.title` | Schedule send | Gönderimi planla |
| `listingEditor.schedule.when` | Send on | Gönderim zamanı |
| `listingEditor.schedule.helper` | Times are in {timezone} | Saatler {timezone} saat dilimindedir |
| `listingEditor.schedule.scheduled` | Will send on {date} | {date} tarihinde gönderilecek |
| `listingEditor.state.loadFailed` | Couldn't load this listing from {marketplace} | Bu ilan {marketplace}'den yüklenemedi |
| `listingEditor.state.notFound` | This listing isn't on {marketplace} any more | Bu ilan artık {marketplace}'de değil |
| `listingEditor.state.openDraft` | Open the draft | Taslağı aç |
| `listingEditor.state.reconnect` | {marketplace} needs to be reconnected | {marketplace} yeniden bağlanmalı |
| `listingEditor.state.chooseShop` | Choose a shop first | Önce bir mağaza seçin |
| `listingEditor.variations.summary` | {variations} variations · {combos} combinations | {variations} varyasyon · {combos} kombinasyon |
| `listingEditor.variations.none` | No variations | Varyasyon yok |
| `listingEditor.variations.add` | Add variations | Varyasyon ekle |
| `listingEditor.personalization.toggle` | Ask buyers for personalization | Alıcılardan kişiselleştirme iste |
| `listingEditor.personalization.summary` | On · {required, select, true {Required} other {Optional}} · {count} questions | Açık · {required, select, true {Zorunlu} other {İsteğe bağlı}} · {count} soru |
| `listingEditor.sheet.done` | Done | Tamam |
| `listingEditor.sheet.cancel` | Cancel | İptal |
| `listingEditor.toast.sent` | Sent to {marketplace} | {mpDat} gönderildi |
| `listingEditor.toast.discarded` | Changes discarded | Değişiklikler atıldı |

Integrator rule (same as settings): groups return their keys as EN/TR JSON fragments in `messages/fragments/listing-editor-<group>.json`; one final commit merges them. Keys that become unused after legacy deletion (`etsy.editor.tab*`, `etsy.editor.saveStatus.*`, `etsy.editor.closeConfirm.*`, `ebay.listing.*` editor-only keys) are removed in the deletion PR after a grep.

---

## 9. What to delete

After the flags `editor-etsy` / `editor-ebay` have been default-on for one release (§7.1.5):

| Delete | Lines | Replaced by |
|---|---|---|
| `components/etsy/ListingEditorDrawer.tsx` | 3,811 | `components/domain/listing-editor/*` + `pages/app/etsy-listings/[listingId].tsx` |
| `components/ebay/ListingEditorDrawer.tsx` | 1,863 | same + `pages/app/ebay-listings/[sku].tsx` |
| `components/etsy/ListingCreatorDialog.tsx` | 2,181 | `pages/app/etsy-listings/new.tsx` (same workspace). Keep `CopySourceData` type → moved to `lib/listingEditor/types.ts` |
| `components/ebay/ListingCreatorDialog.tsx` | 2,464 | `pages/app/ebay-listings/new.tsx`; its autofill pipeline moves to `useListingAI('ebay').fillFromPhotos`, its create sequence moves server-side (F1). `EbayListingPrefill` type → `lib/listingEditor/types.ts` |
| `components/etsy/SEOIndicator.tsx`, `components/ebay/SEOIndicator.tsx` | 422 | `ScorePanel` + `lib/listingScore/*` (check other importers first: grep; BulkEditor may import SEOIndicator → swap to `ScoreMeter`) |
| `seoRules.computeSeoScore` | ~40 | `lib/listingScore/etsy.ts` (after the list pages switch in M5) |
| `components/etsy/ScheduledUpdateDialog.tsx` + `useScheduledUpdateExecutor` + `kx_scheduled_updates` localStorage | 333 | API G3 (only after G3 ships; migrate pending local schedules on first editor load with a one-time banner "1 scheduled change was moved to your account") |
| Editor rank-tracking UI (SEO tab, rank analysis dialog, `check_keyword_rank`/`analyze_keyword_ranking` calls from the editor) | ~400 inside the drawer | Keyword explorer "Tracked" (R2). The API actions stay for research |
| `localStorage` editor draft layer (`saveDraft`/`loadDraft`/`markStaged`/`matchesStaged`) | ~70 | §5.1 offline fallback only (`listing_draft_<id>` key reused) |
| Hard-coded TR strings (`friendly()`, "Teknik hata", validation banner text) | — | i18n keys (§8) |
| Per-sub-editor save buttons (VariationEditor, PersonalizationEditor, taxonomy "Save details") | — | `embedded` mode + autosave engine |
| `etsy-listings.tsx` / `ebay-listings.tsx` editor + creator mounting code, `drawerOpen`/`drawerListingId`/`createDialogOpen` state, `pendingNewListingDrafts` "sync from pinned row" handler (rows now open `new?draft=`) | ~250 | navigation to the routes (part of M5 `ListingsPage`) |

Total removed ≈ 11,900 lines; new code estimate ≈ 3,800 lines (workspace 900, sections 1,200, adapters + engine 700, score 350, preview 350, API 300).

---

## 10. Implementation split (disjoint file groups for parallel agents)

Preconditions: M1 primitives exist in `components/ds/*` with the signatures in `DESIGN_SYSTEM.md` §4 (groups code against those signatures if M1 is still landing). Every group: no edits to `messages/en.json`/`tr.json` (return a fragment), `npx next build --webpack` before finishing, unit tests for pure logic, no edits outside its files.

**Group S: system additions** (first, small, unblocks the rest)
- `components/ds/page/SectionNav.tsx` (+ refactor `ds/overlay/SidePanel.tsx` to use it), `components/ds/inputs/FieldSuggestion.tsx`, `components/ds/inputs/DateTimeField.tsx`, `TagInput` `suggestions` props, `ImageGrid` `variant="strip"`, `FormField` `dirty`/`onRevert`, render tests, and the §4.6 rows appended to `design/DESIGN_SYSTEM.md` §4.

**Group A: workspace frame, routes and save engine**
- `components/domain/listing-editor/ListingEditor.tsx` (layout, header, banners, footer, rail slots, responsive rules, keyboard), `useListingDraft.ts`, `adapters/types.ts`, `adapters/etsy.ts` (stage/sync/discard/refresh, payload builders moved from the drawer), `changeSummary.ts` (+ tests), `lib/listingEditor/{sections.ts,types.ts,editorNav.ts}`.
- `pages/app/etsy-listings/[listingId].tsx`, `pages/app/etsy-listings/new.tsx` (blank / `draft` / `copy` / `prefill` bootstraps), `lib/ds/uiFlags.ts` entries `editor-etsy`, `editor-ebay`.
- Defines the `DraftSection` registration contract that groups B, C, D implement.

**Group B: Etsy field sections**
- `components/domain/listing-editor/sections/{TitleSection,TagsSection,PriceSection,DetailsSection,ShippingSection}.tsx`, `sections/CategoryCombobox.tsx`, `sections/CreateShippingProfilePanel.tsx`, `sections/CreateReturnPolicyModal.tsx`, `sections/NewSectionModal.tsx`, `sections/ProcessingProfileField.tsx`. Validation wiring from `lib/etsy/validation.ts` (read-only use).

**Group C: media**
- `components/domain/listing-editor/sections/PhotosSection.tsx`, `PhotoPanel.tsx`; `components/etsy/ImageManager.tsx` and `components/etsy/VideoUploader.tsx` gain `embedded` + `stage()/isDirty()` handles and render through `ImageGrid variant="strip"` (staging calls and `mediaSafety` untouched); `components/ebay/ImageManager.tsx` same treatment.

**Group D: heavy sub-editors**
- `components/etsy/VariationEditor.tsx`, `components/etsy/PersonalizationEditor.tsx`, `components/ebay/VariationEditor.tsx`, `components/ebay/ItemSpecificsEditor.tsx`, `components/ebay/ConditionSelector.tsx`: `embedded` mode (no own save button, DS inputs, `register()` handle, collapsed summary row, mobile full-height sheet wrapper) + `sections/{VariationsSection,PersonalizationSection,SpecificsSection}.tsx`.

**Group E: health score and preview**
- `lib/listingScore/{etsy,ebay,types}.ts` + `__tests__/listingScore/*.test.ts` (fixtures for each check and each `na` case), `components/domain/MarketplacePreview.tsx` + `preview/{EtsySearchCard,EtsyListingPage,EbaySearchRow,EbayItemPage}.tsx`, `components/domain/listing-editor/RailHealth.tsx`, `RailChanges.tsx`, `RailHistory.tsx`.

**Group F: eBay adapter and backend**
- `components/domain/listing-editor/adapters/ebay.ts`, `pages/app/ebay-listings/[sku].tsx`, `pages/app/ebay-listings/new.tsx` (incl. `crosslist`), `sections/EbayPoliciesSection.tsx`.
- API F1–F3: `lib/ebay/draftService.ts`, `lib/ebay/draftClient.ts`, `pages/api/ebay-drafts/[id]/{diff,resolve}.ts`, error-key mapping in `pages/api/ebay-drafts/**`.
- Verify on a real draft row (`EbayListingDraft`, `EbayDraftMedia`) that create → sync produces the same eBay calls as the old creator (inventory item, inventory item group for variations, offer, optional publish).

**Group G: Etsy backend additions**
- API G1: `lib/etsy/draftService.ts` (`getDraftDiff`, `resolveDraft`, `listSyncedDrafts`), `pages/api/etsy-drafts/[id]/diff.ts`, `pages/api/etsy-drafts/[id]/resolve.ts`, `pages/api/etsy-drafts/history.ts`.
- API G2: `search_market` handler in `pages/api/clawd/etsy.ts` (after R0's `lib/research/stats.ts` exists; otherwise this item waits).
- API G3: `prisma/migrations/<ts>_draft_scheduled_send/`, `schema.prisma` field, `PATCH` support in `pages/api/etsy-drafts/[id]/index.ts`, `pages/api/cron/send-scheduled-drafts.ts`, systemd timer / cron line documented in the PR. Before running anything against production drafts, inspect `EtsyListingDraft`/`EtsyDraftSyncAttempt` (CLAUDE.md) and never auto-send a draft whose `queuedActions` contains `delete`.

**Group H: AI and review panels**
- `components/domain/listing-editor/useListingAI.ts` (Etsy + eBay, wraps `/api/ai/etsy`, `/api/clawd/ebay-ai`, `/api/ai/generate-image`, guards from `seoRules`), `AiFillCard.tsx` ("Start faster"), `ReviewDifferencesPanel.tsx`, `ProfilesModal.tsx` (wraps `components/etsy/ListingTemplates.tsx` storage, read-only use), `ScheduleModal.tsx`.

**Integrator (last)**
- Wire list pages to the routes behind the flags (`pages/app/etsy-listings.tsx`, `pages/app/ebay-listings.tsx`: row open, `e`, ⋯ Copy, pinned new drafts → `new?draft=`, `kx:editorNav` write), merge i18n fragments, add paths to `design/migrated-paths.json`, run the DoD (§8 of the system) at 1440 / 1024 / 390 in EN and TR, verify staged-draft parity by diffing `EtsyListingDraft.fieldPatch/taxonomyPatch/inventoryPatch/personalizationPatch/queuedActions` and `EtsyDraftMedia` rows produced by old vs new editor for the same 10 edits, then commit, push, and verify the deploy by SHA. Deletion (§9) is a separate PR one release later.

Dependency order: S → (A ∥ E ∥ G ∥ F-backend) → (B ∥ C ∥ D ∥ H) → F-frontend → Integrator.

---

## 11. Why this beats Vela (checked against public Vela material)

Vela (getvela.com, Shopify App Store listing, comparison write-ups) edits single listings in a tabbed editor and pushes edits and section "Profiles" to live listings; reviewers note no preview or undo before profile edits go live.

| Seller need | Vela | KolayXport editor |
|---|---|---|
| See everything at once | tabs per area | one scroll, section nav with "not sent"/"needs a fix" dots |
| Know what will change on Etsy | no staged view | "Not sent yet (3)" list, dirty markers, per-field Revert, one explicit Send |
| Safety when Etsy changed meanwhile | — | conflict review per field, no blind overwrite, queued delete always surfaced |
| Quality guidance | basic counters | Listing health with honest denominator and one-click fixes that only stage |
| AI | paid AI credits, applies text | free inline proposals per field (title, description, tags, alt text, specifics, fill from photos), never silent, English content enforced |
| Preview | — | live Etsy/eBay search card + listing page, desktop and mobile, title cut-off hint |
| Profiles | push to live | fill the draft per section, undoable |
| Create vs edit | separate flows | same workspace, resumable drafts, research prefill |
| Phone | desktop-first | full mobile layout with sticky Send above the tab bar |
| Turkish sellers | English only | full EN/TR, Turkish characters, TRY-aware money formatting |

# Critique: completeness and consistency of the design package

Date: 2026-10-15. Reviewer: completeness and consistency critic. Design only: no app code was changed.
Read in full: `DESIGN_SYSTEM.md` (DS), `tokens.md`, `RESEARCH_REDESIGN.md` (RR), all 8 files in `surfaces/`, `scratchpad/visual_findings.md`. Repo checked at `kx-ux-phase0@92087ba` (`pages/**` routes, every `<Dialog|Drawer|SwipeableDrawer|Modal|ConfirmDialog>` under `components/` and `pages/`).

**Patch policy.** I patched surface specs in place only where the fix had a single obvious answer. Each patch carries a `CRITIQUE Cn/Un/Vn` tag in the spec, so `grep -n "CRITIQUE" design/surfaces/*.md` lists them all. §5 has the log. Changes that belong in `DESIGN_SYSTEM.md`, `tokens.md` or `RESEARCH_REDESIGN.md` are listed in §6 and **not** applied, because I was only allowed to write `CRITIQUE.md` and the surface specs.

---

## 0. Verdict: what still blocks a "much better than Vela" build

The DS and the 8 surface specs are strong: specific, sourced from code, honest about data. They are **not complete**. Six things block the founder's goals:

| # | Blocker | Why it matters | Fix (section) |
|---|---|---|---|
| B1 | **Research has no surface spec.** Only DS §3.18 plus §6.6 (2 wireframes) and RR exist. RR also disagrees with the DS on routes, tool names, layout and timeouts. | The founder's headline complaint is "research tools are from the stone age". R1 is scheduled right after M1, but no group can build Product finder, Listing doctor or Shop tracker from what exists: there are no states, API contracts, i18n, mobile layout or file split. | X1, C17 |
| B2 | **BulkGrid (M7, "the Vela milestone") has no surface spec**, and its stated base is very likely unbuildable as described. MUI X DataGrid MIT caps page size at 100 and has no clipboard paste. The M7 exit criterion is "200 listings × 3 columns pasted in one sync". | Bulk editing is where we beat Vela. Today it is one DS paragraph. | X2 |
| B3 | **Trendyol, Wix and Shopify have no editor or creator spec.** `ListingsConfig.editorHref(id)` points nowhere for 3 of the 5 marketplaces, and `TrendyolListingEditorDrawer`, `WixProductEditorDrawer`, `WixProductCreatorDialog` and the inline `ShopifyEditorDrawer` are not covered. | `e` / ✎ on 3 listings pages has no target after M5. "Inconsistent on every drawer" survives exactly there. | U1, X3 |
| B4 | **Pro features are sold but not designed.** The pricing page sells "Arbitrage scanner, Financials, Bulk photo studio" as Pro. No spec defines the locked state. Bulk photo and video studio (`BulkPhotoStudio`, `BulkVideoStudio`, inside `components/etsy/BulkEditor.tsx`) have no new home. Arbitrage is "Price gap, R4" in the DS. | Without a spec we either sell a feature we deleted, or we gate with an ad-hoc modal on every page. | U2, X6 |
| B5 | **The same server logic was specified three times with different results.** To-ship and overdue counts, FX, canonical store and usage limits each had 2–3 owners and definitions. The sidebar counter, the Overview KPI and the Orders view would have disagreed (finding #19 again). | Trust. | C4, C5, C8 (**patched**) |
| B6 | **File-ownership collisions across parallel milestones.** `messages/{en,tr}.json` is "owned" by 4 different groups (shell F, Orders G6, Overview G7, Listings G7 by fragments). Prisma migrations come from 5 surfaces, and `scheduledSendAt` and its cron were specified twice. M3 and M4 run in parallel. | Merge conflicts and duplicate columns. | C26, C27, C13 (**partly patched**) |

---

## 1. Visual findings not fully resolved by a spec

DS §5 maps all 35 findings to a resolution. I checked each mapping against the surface spec that has to deliver it. **28 are fully specified** (#1–5, 7–10, 12–17, 19, 21–30, 33–34). The other 7 (#6, 11, 18, 20, 31, 32, 35):

| # | Finding (visual_findings.md) | Status | Gap | Concrete fix |
|---|---|---|---|---|
| V1 | Research: purple gradient hero, floating purple FAB (#31); eBay: two stacked search bars, two marketplace selectors, an empty grey button (#32) | **Late** | R0 changes data only. shell-nav §6.2 leaves the heroes for R0/R1. So production keeps the gradient hero, the FAB and the duplicate search bars until R1 (about week 5 or later). The M0 theme flattens buttons, not custom heroes. | Add to R0 (week 1): delete the hero blocks and the FAB (`AiOptimizePanel` mount), drop the second eBay search bar and second marketplace select, and remove the empty grey button. All JSX deletions, no DS needed. Owner: research track R0. |
| V2 | Raw HTML entities "one&#39;s", and the risk of pushing them back to Etsy (#11) | **Partial** | `decodeEntities` runs "at the mapper boundary". **Rows already in `EtsyListing`, `OrderItem` and other caches stay encoded until the next pull.** The editor and BulkGrid stage from the cache, so an untouched encoded title could be staged and sent. Only overview.md decodes at read time. | (a) `scripts/backfill-decode-entities.ts` over `EtsyListing.title/description/tags`, `EbayListing`, `OrderItem.productName`, run once in M1. (b) `lib/listings/adapters/*.toRow` and the editor's `ListingView` builder also call `decodeEntities` (idempotent). (c) `stageEtsyDraft` decodes `fields.title/description/tags` before writing `fieldPatch`. Add a fixture test: an encoded cache row is staged and the sent payload has no `&#`. |
| V3 | Settings: "Last sync 3 weeks ago" with no sync action (#35) | **Patched** | settings put "Refresh all orders" only in the tile `⋯`. DS §5 promises a refresh next to the meta. | settings §4.2: when the data is older than 24h, an inline ghost link "Refresh all orders" follows the meta. |
| V4 | Wix: "Tr" badges | **Unverified** | No spec names it. The likely source is the collection chips at `pages/app/wix-urunler.tsx:325` (collections named "Tr"?). | listings-grid already turns collections into a hidden `collection` column, which resolves it if that guess holds. **Verify on production before M5** and add a line to listings-grid §0. |
| V5 | Turkish seasonal tips in the English UI; "Trending Niches" (#6, #31) | **Partial** | R0 removes Trending Niches and moves tips to i18n. RR's replacement, the Seasonal calendar on Research Home, is **missing from DS §3.18 and §6.6**. That leaves no answer to "what should I list for the season", which sellers do ask. | Decide: either add "Upcoming seasons (from TR)" as a Home card in DS §6.6 (deterministic data, RR §3 supporting module), or drop it explicitly in RR. My recommendation is to keep it: it is honest, cheap and unique to Turkish sellers. |
| V6 | eBay research: stuck "Loading your eBay listings…" banner (#32) | **Contradiction** | DS §7.2 R0 says "20s fallback", RR §6.3 #12 says "timeout at 20s", but P6 and `useAsyncState` say 15s "Still loading" and 30s `ErrorState`. | R0 uses `useAsyncState` semantics (15/30), or a 15s inline "Still loading… Retry" if `useAsyncState` is not built yet. Fix DS §7.2 and RR. |
| V7 | FedEx drawer: no rate or service preview (#18/#20) | **Partial, honestly** | v1 RateList has no prices (no rate API exists; orders §0.1). DS §6.4 still draws "Total $38.40" and "Recommended". | Acceptable, because A7 is planned. DS §6.4 must label price, total and "Recommended" as A7-only, so nobody builds fake prices (see C20). |

---

## 2. Surfaces, drawers and dialogs with no spec

Method: every page route under `pages/` (excluding `api/`), plus every file under `components/` and `pages/` that renders `<Dialog|Drawer|SwipeableDrawer|Modal|ConfirmDialog>` (55 files), grepped by basename against `design/**`. Mentions in a "code to delete" list count as covered only when a replacement is named.

### 2.1 Uncovered (needs a spec or an explicit decision)

| ID | Item | Today | Decision needed | Suggested owner |
|---|---|---|---|---|
| U1 | Trendyol, Wix, Shopify **editors and creators**: `components/trendyol/listings/TrendyolListingEditorDrawer.tsx` (2 overlays), `components/wix/WixProductEditorDrawer.tsx` (2), `components/wix/WixProductCreatorDialog.tsx`, `ShopifyEditorDrawer` inline at `pages/app/shopify-urunler.tsx:671` | Each its own drawer layout | X3 | listing-editor (M6b) |
| U2 | **Bulk photo and video studio**: `components/etsy/BulkPhotoStudio.tsx` (2 dialogs), `BulkVideoStudio.tsx`, hosted by `components/etsy/BulkEditor.tsx` (3 dialogs) | Pro feature on the pricing page; RR Listing doctor links "Open photo studio" | Where it lives after BulkGrid replaces BulkEditor: a BulkGrid bulk-bar action "Edit photos…" opening a full-page `PhotoStudio` (`?ids=`) that stages `EtsyDraftMedia` ops, Pro-gated (X6) | BulkGrid spec (X2) |
| U3 | **Research overlays and pages**: `pages/app/{etsy-research,ebay-research,trendyol-arastirma,amazon-research}.tsx` (ebay 4 dialogs, trendyol 1), `components/ebay/research/arbitrage/{ArbitrageScanner,ArbitrageCategoryBrowser,ArbitrageProductDetail}.tsx`, `components/amazon/research/AiInsightsPanel.tsx`, `components/ebay/research/CompetitiveIntelligence.tsx` (2) | RR lists most of them for deletion. Arbitrage is "keep until R4, re-skin". `AiInsightsPanel` is mentioned nowhere | Covered by the research spec (X1). The arbitrage detail dialog becomes the Price gap row expansion, and `AiInsightsPanel` is deleted (AI is a verb, RR §1.1.6) | research spec |
| U4 | `components/amazon/AmazonMessageDialog.tsx` | orders.md said "kept as is until Messages M8"; messages.md does not take Amazon (no readable inbox) | **Patched:** orders G3 rebuilds it as `MessageBuyerModal` (Modal sm) | Orders M3 |
| U5 | `components/ebay/ListingTemplates.tsx` (4 dialogs) | listings-grid moved it "to the eBay creator (M6)"; listing-editor covered only the Etsy profiles | **Patched:** listing-editor §6.5 profiles Modal wraps the eBay storage too | Editor M6 |
| U6 | `components/billing/LimitReachedDialog.tsx`, mounted globally from `pages/_app.tsx` through `lib/http/limitInterceptor.ts` and `lib/fetchWithLimit.ts` | Each surface specifies its own inline 402 UI; the global dialog would still fire on top of it | See C6: migrated routes opt out of the global dialog; delete it in M10 | shell-nav group F |
| U7 | `components/etsy/VariationEditor.tsx` (4 internal dialogs), `components/etsy/VideoUploader.tsx` (2) | The editor embeds them and says "heavy editors open as full-height sheets" on mobile. Their **internal** dialogs are not specified | Rule: inside an embedded sub-editor, a dialog with ≤ 4 fields becomes `Modal nested`; longer flows become a `SidePanel md`. List the 4 VariationEditor dialogs in listing-editor §9 with their target | Editor M6 |
| U8 | Auth pages: login (rendered by `pages/app/index.js` when there is no session, and `pages/login.js`), `pages/auth/{verify,forgot,reset,confirm-email,error}`, `pages/logout.js` | No spec. This is the first screen of a paid SaaS | A small "Auth" spec: `PublicLayout`, card 440 (`Modal`-like surface, not a modal), `FormField` forms, glossary wording, EN/TR, states for each `?status=` of `/auth/verify` | new `surfaces/auth.md` (before the launch) |
| U9 | Help and guides: `pages/app/nasil-kullanirim.js`, `pages/app/entegrasyonlar-ve-rehberler.js` | Only the M2 header pass (`reading` width) | Body redesign, or an explicit "out of scope v1" | backlog |
| U10 | Print pages `pages/app/print/{packing-slips,pick-list}.tsx` | Reused unchanged by Orders | Must follow `Money`/`DateText` and decoded text (they print buyer-facing paper). Add a 5-line print-style section to orders.md | Orders M3 |
| U11 | Admin: `pages/admin/index.tsx` (600 lines), `pages/admin/monitoring.tsx` (576) | Internal | Out of scope; state it in DS §7 so lint ramps skip `pages/admin/**` | DS |
| U12 | Marketing: `/`, `/en`, `/ozellikler`, `/entegrasyonlar`, `/blog/*`, `/iletisim`, `/kurumsal`, `/kariyer`, `/docs/*`, privacy and terms | Only `/fiyatlandirma` is specified | Out of scope for this rebuild (refreshed separately), but they must at least take the M0 tokens. Say so in DS §7 | DS |

### 2.2 Covered (checked)

Orders (labels page, UPS/MNG/FedEx drawers, `ManualOrderForm`, `ExportMenu`), settings (`components/settings/*`, `ErrorDetailsDialog` → `SyncErrorsPanel`), finance (`CostEntryDrawer`, `BankedPanel`), listings tools (`FindReplaceDialog` ×3, `DuplicateDetector`, `SmartPricing` dropped, `BackupManager` ×2 dropped, `ScheduledUpdateDialog` ×2, the 4 `*BulkOperationsBar`), editor (`ListingEditorDrawer` ×2, `ListingCreatorDialog` ×2, `ImageManager` ×2, `ListingTemplates` Etsy), shell (`CommandPalette`, `NotificationBell`), messages (`pages/app/mesajlar.tsx`), `components/ui/ConfirmDialog`. Redirect-only pages (`envanter`, `urunler`, `dashboard`, `app/senkron`, `app/settings`) need nothing, except **keeping** them. `subscribe.js` is deleted (settings §1.1). `404`, `_error` and `offline` take `PublicLayout` (shell-nav §11).

---

## 3. Contradictions (different patterns for the same job)

Status: **P** = patched in the surface specs, **DS** = needs a DS, tokens or RR edit (§6), **D** = founder or owner decision.

| ID | Job | Conflict | Resolution | Status |
|---|---|---|---|---|
| C1 | Count of unsent work | listings-grid "Send 7 changes" = 7 listings. DS §3.17 BulkGrid "Send 37 changes" = 37 cells. Editor "Send 3 changes" = 3 field groups. One word, three units. | **A change = one listing with an unsent draft** (the unit `bulk-sync` sends). Field and cell counts are **edits**. Grid: "Send 7 changes to Etsy". BulkGrid: "24 listings · 37 edits not sent", primary "Send 24 changes to Etsy". Editor: "Saved · 3 edits not sent yet", primary "Send changes to Etsy". | P (listings-grid §11 resolved, §6.4 copy, `listings.panel.*`; listing-editor wording note, §3.1, §3.4, §5.2, `save.saved`) · DS §3.17, §3.19 |
| C2 | Mobile TopBar right side | 7 versions: shell-nav "⌕ 🔔 (+action)"; Orders "⌕ ⋯"; Listings "‹ … ⌕ + New ⋯" (back chevron on a top-level page); Overview "+ New (bell)" (the text said ⋯); Messages "⌕ ⋯"; Reports "⋯ (bell)"; Editor "‹ … [score] ⋯". shell-nav also said page actions go "into one ⋯ in the content". | One fixed slot order: **⌕ (not on drill-ins) · ≤1 `mobileAction` · `⋯` if the page has actions, else 🔔**. The bell then moves to the top of the More sheet. `Page` exposes `mobileOverflow`. | P (shell-nav §4.1, §6.1; overview §2.3; finance §2.5; listings-grid §6.5) · DS §6.2 mobile has "‹" too |
| C3 | Navigation keys and the Reports/Finance item | finance-analytics A1 merges Reports + Finance into one "Reports" item **and claims `g r`**, which shell-nav gives to Research. shell-nav keeps 2 items (`g p`, `g f`). listing-editor uses `g s` for "jump to section"; `g s` is Settings. | Merge in the M9 PR (`REPORTS_HOME` constant, `finance` row and `g f` removed then). `g p` = Reports, `g r` = Research. The editor's section jump becomes a ⌘K command. | P (shell-nav §2.1; finance §1, §4.1; overview `reportsHref()`; listing-editor §6.5) · DS §3.1 nav list |
| C4 | To-ship and overdue counts | 3 modules and 3 definitions: shell-nav `lib/orders/toShipWhere.ts` (overdue = `MIN(OrderItem.shipBy)` only, FBA included); orders `lib/orders/views.ts` (FBA/MCF excluded, effective ship-by with `rawData` fallbacks); overview `lib/orders/statusGroups.ts` (rawData orders count as "without ship-by", not overdue). The sidebar, the Overview KPI and the Orders view would show 3 different numbers. | **One server-only module, `lib/orders/views.ts`**: created in M2 by shell-nav group B (`TO_SHIP_SQL`, `UNLABELED_SQL`, `EFFECTIVE_SHIP_BY_SQL`, `OVERDUE_SQL`), extended by Orders G1, imported by Overview (no `statusGroups.ts`). The orders §1.3 definition wins. A parity test covers all three numbers. | P (shell-nav §9.1, §12 B; orders A1, G1; overview §4.1, §4.3, §4.4, §8) |
| C5 | FX conversion and store identity | FX: overview creates `lib/fx.ts` (`convertToBase`), finance used `lib/finance/fx.convertCurrency`. Store identity: finance `lib/marketplaces/canonical.ts`, overview `lib/utils/etsyDetection.ts` + shop names, orders "`lib/ds/marketplaces.ts` brand detection". | One `lib/fx.ts` (Overview M8 G1). One `lib/marketplaces/canonical.ts` (Orders M3 G1 creates it; Overview and Reports import it). | P (finance B11, §6.1, §6.2; overview §4.1; orders §10, G1) |
| C6 | Usage limit reached (402) | Orders: warning Banner + disabled primary, no toast. Listings: error toast. Overview: disabled ⟳ + queue row. Settings: Banner in a panel. The global `LimitReachedDialog` (in `_app`) fires on top of all of them. | Rule: **402 from a user action → one inline warning `Banner` in the affected region ("See plans", hidden when `!stripeUpsell`) + that action disabled with `disabledReason`. No toast, no modal.** A toast is used only for background jobs (scheduled send). Migrated routes opt out of the global dialog (`limitInterceptor` skip-list in shell-nav group F); delete it in M10. | P (listings-grid §7) · shell-nav F needs the opt-out line · DS §3.13 |
| C7 | Billing-state pills | overview added domain `account` (`paused`, `near_limit`, `trial_ending`); settings added `subscription` (`expired` = "Paused", …). Two pills for "account paused". | One domain, `subscription`, gains `near_limit` and `trial_ending`. Overview row 1 uses `subscription.expired`. | P (overview §3.2, §5, §6, §8 G5; settings §14, §15.3) |
| C8 | Plan numbers and usage source | shell-nav UsageMeter read `/api/user/settings` and drew 7/10 labels and 32/50 orders (today's trial). settings uses `useEntitlement()` and the new tiers (150/30, 14 days). overview has its own `getUsageSnapshot`. | **UI reads usage only through `useEntitlement()`** (its fallback mode uses the shell-nav `subscription.limits` field). `getUsageSnapshot` (overview, server) must be the function behind `/api/billing/entitlement`, not a second implementation. Numbers in wireframes are examples. | P (shell-nav §8) · D: confirm with the tiers track that `getUsageSnapshot` lives in `lib/billing/` |
| C9 | Shopify-free billing wording | shell-nav account menu: "Billed through Shopify". settings §0.1 bans it (Shopify review risk): label "Plan", text "Included with the KolayXport Shopify app". | settings wording | P (shell-nav §3.5) |
| C10 | Copy a listing | listings-grid row ⋯ "Duplicate as new"; editor "Copy listing" with route `new?copy=`. | "Copy listing" everywhere, same route | P (listings-grid §6.1, §9.2, i18n) |
| C11 | Turkish suffixes after variables | orders mandates ICU `select` (`{mpDat}`: Etsy'ye, eBay'e). listing-editor concatenated `{marketplace}'e` in 7 keys → "Etsy'e" (wrong). listings-grid `{price}'den` is wrong for "$40" (needs "'tan"). | Use `{mpDat}`/`{mpLoc}` from orders §11 in every surface. Never put a suffix after a number. | P (listing-editor §8, 7 keys; listings-grid `cell.priceFrom`) · DS P5 should state the rule |
| C12 | Pulling orders: the label | "Refresh orders from stores" (palette), "Refresh from stores ⟳" (header pass), "Refresh orders" (overview), "Refresh all orders" (settings fullSync, a different operation). | Fast pull: "Refresh orders" / "Siparişleri yenile", meta "Orders refreshed 2 min ago". Full resync: "Refresh all orders" (settings only). | P (shell-nav §3.6, §6.2, §10) · DS §3.19 add the row |
| C13 | Scheduling a send | listings-grid: `DateRangeField mode="single"` + time `Select`; listing-editor: new `DateTimeField`. Both specified the `scheduledSendAt` migration and `pages/api/cron/send-scheduled-drafts.ts`. | `DateTimeField` only. listings-grid (M5) builds it and owns the migration (Etsy, eBay, CatalogDraft) and the cron. Editor G3 consumes it. | P (listings-grid §10; listing-editor §7.1 G3) |
| C14 | Sender profile icon | settings §1.2 table says `Package`; the note under it says `Warehouse` (Package is the Thumb placeholder). | `Warehouse` | P |
| C15 | Deep link to a provider | overview queue links `/ayarlar?tab=connections&provider=ebay`; settings says `&provider` "opens that provider's panel", but eBay and Wix have no panel. | No panel: scroll to the tile, focus ring, focus "Reconnect". Never auto-start OAuth. | P (settings §1.1) |
| C16 | Closing a mobile sheet | orders sheets: "✕ Order #3891"; messages thread sheet: "‹ Ayşe Kaya". | Sheets close with ✕; only drill-in pages use ‹ | P (messages §3.2) |
| C17 | Research information architecture | RR vs DS §3.18: **routes** (`/validate`, `/competitors`, `/rankings`, `/price-gap` vs `/products`, `/shops`, Tracked view, source mode); **names** (Validate / Competitor Watch vs Product finder / Shop tracker); **count** (6 jobs vs 4 tools + Home); **layout** (200px left section nav at max 1200 vs `Page width="list"` with no in-tool nav defined); **Doctor score** (RR "no 0–100 score, issue count" vs DS ScorePanel); **AI verdict** (RR "VERDICT Promising" vs DS `EvidenceSummary`); timeouts 20s vs 15/30; compact ≥10k vs ≥100k; `Metric` in `components/ui/` vs `ds/research/`; `ConnectEmptyState` vs `ConnectState`; "Sync to Etsy" wording. Consumers already follow the DS (editor `/app/research/keywords?listing=`, overview `/app/research/listings`). | **DS wins on every point.** Mapping: Validate → Product finder `/app/research/products`; Keywords → Keyword explorer `/app/research/keywords`; My listings/Doctor → Listing doctor `/app/research/listings`; Competitors → Shop tracker `/app/research/shops`; Rankings → Keyword explorer view `?view=tracked`; Price gap → Product finder `?source=trendyol` (R4). Switching between tools: **route `Tabs`** under the PageHeader (Home · Product finder · Keyword explorer · Listing doctor · Shop tracker = 5, the DS `Tabs` limit), the same pattern as Reports. No left section nav. RR keeps its data inventory, guards (§6) and build order, and gets a "superseded by DS §3.18" header. | DS / RR (§6) |
| C18 | SidePanel backdrop | DS §3.5: "16% backdrop", "light". DS §2.7 and tokens: one `backdrop` = `.32`, applied to every `MuiBackdrop`, so SidePanels would render at 32%. | tokens: `backdropPanel: 'rgb(15 23 42 / .16)'`, set on the `SidePanel` Drawer's `slotProps.backdrop` | DS/tokens |
| C19 | Toast offset on mobile | DS §3.14 and shell-nav: `bottom: calc(var(--kx-bottom-nav) + 8px)`. tokens §4 Toaster: `+ 16px`. | 8px | tokens |
| C20 | DS §6 wireframes vs the surface specs | DS §6.1 bulk bar "Mark shipped" (orders dropped it: no API) and header "[Print picklist]" (orders: Export ▾); §6.2 selection bar with 5 visible actions (listings caps it at 4); §6.3 and §3.10 "n/a Tag demand" check (the editor removes it until R2); §6.4 "Total $38.40" and "Recommended" (v1 has no rates); §6.5 "Etsy 2 · Wix 1" (Etsy has no messages API), "TCMB rate" (code uses exchangerate-api.com), "Top listings 18 sold" (no listing linkage: "Best sellers by SKU"). | Precedence rule in DS: **"DS §1–§4 rules win over surfaces; surface specs win over DS §6 wireframes"**, then correct those 8 spots. | DS |
| C21 | Product cost | DS finding #16: "Product cost becomes an OrderPanel field and a Profit column". orders §5: carrier cost only, no profit in v1 (no fees per order). finance: product cost lives in Reports › Profit (`ProductCost` panel). | finance + orders are right. DS #16 → "Carrier cost in OrderPanel; product cost and profit in Reports › Profit". | DS |
| C22 | KpiTile third line, DataTable without pagination | overview uses a KpiTile caption and an unpaginated DataTable; finance declares `KpiTile.caption` (A2); overview declares optional pagination. Each surface adds a different half. | Merge both once into DS §4.4 in M1 (not per surface) | DS |
| C23 | Right rail width | editor rail 360; messages rail 320 | Keep both (the inbox has 3 regions), and document "right rail 320–360" in DS §2.10 so nobody adds a third value | DS |
| C24 | Tracking push display | overview §6 says "Orders (tracking column) will reuse" the `tracking` pills; orders uses caption text under the status pill (the 1-pill rule). | orders is right; delete that sentence from overview §6 during integration | DS integration |
| C25 | Language switch | avatar menu radio rows; More sheet `SegmentedControl`; Settings › Preferences `SegmentedControl` | Acceptable (menus use radio rows) — no change | — |
| C26 | Who writes `messages/{en,tr}.json` and `status.*` keys | shell F, Orders G6, Overview G7 and Settings each "own" the message files; listings uses fragments merged by G7. `status.*` keys are added by 5 surfaces. M3 and M4 run in parallel. | **Global rule:** every group writes `messages/fragments/<surface>-<group>.{en,tr}.json`; one script (`scripts/i18n/merge-fragments.ts`, M1) merges them in CI with a duplicate-key failure. **All `status.*` keys and `lib/ds/status/*` maps land once in M1** (listing `in_review`/`rejected`, message `in_review`/`answer_rejected`, subscription ×8, invoice ×4, run ×3, tracking ×2, `sync.refresh_failed`). | DS §7 (affects every surface's split table) |
| C27 | Prisma migrations | listings_grid (health columns, CatalogDraft, scheduledSendAt), inbox_thread_saved_reply, user_timezone, billing_v2 (tiers track), research models (R3). | One `design/migrations-plan.md` order: M3 none → M4 `user_timezone` + `billing_v2` → M5 `listings_grid` → M8 `inbox_thread_saved_reply` → R3 research. Each runs against a production copy first (Hetzner Postgres). `scheduledSendAt` exists only in `listings_grid`. | DS §7 |

---

## 4. Unbuildable or vague

| ID | Where | Problem | Concrete fix |
|---|---|---|---|
| X1 | Research (DS §3.18, §6.6, RR) | No buildable spec (B1). Missing: states per tool, mobile for Product finder, Listing doctor and Shop tracker, `/api/research/*` contracts (RR names the data, not the endpoints), the file split, i18n keys, **watch quotas per plan** (RR suggests Trial 3, Starter 10, Growth 50, but the entitlement `meters` have no research meter), how "Keyword explorer in a SidePanel" from the editor and the listings quick view works (a full-page tool inside a 720px panel), and the Pro gating of Price gap. | Write `surfaces/research.md` **before R1**, using C17's mapping. Required parts: `KeywordExplorer variant: 'page' \| 'panel'` (panel = one listing, views Suggested + Used in my shop only, primary "Add N tags to this listing"); endpoints `GET /api/research/products?q&mkt`, `/keywords?listing\|q&view`, `/listings?shop&sort=opportunity`, `/shops` + `POST /watch`, each returning `{ data, source: SourceNoteProps }`; a `research` meter in the entitlement (or "unlimited in v1" stated); route Tabs; mobile cards; the same §0–§15 structure as the other surface specs. |
| X2 | BulkGrid (DS §3.17, M7) | (a) No spec (B2). (b) "Built on DataGrid Community with cell editing", but the MIT DataGrid limits page size to 100 and has no clipboard paste or range selection (both Premium). **Verify against the `@mui/x-data-grid@8.3` MIT docs.** If confirmed, the exit criterion "200 listings × 3 columns pasted in one sync" cannot be met on one page. (c) Undefined: Tags and Category cell editors, variation listings (read-only?), how cell edits merge into one draft per listing, the row cap for `?view=` (a view can match 5,000), and the photo studio entry (U2). | Decision first: **build BulkGrid on the DS `DataTable` (MUI `Table`, headless, 250-row pages)**, extending its existing `money-edit`/`int-edit` cells with `text-edit`, `tags-edit` (TagInput in a popover) and `combobox-edit`. Paste = a `paste` listener on the grid root that writes down from the focused cell. That removes the DataGrid exception from DS §1 ("DataGrid only inside BulkGrid") and the Premium risk. Then write `surfaces/bulk-grid.md` with the C1 unit, a 250-row cap plus "Next 250", per-listing draft merge via `stageEtsyDraft({fields})` debounced 800ms, variations read-only with a reason, and "Edit photos…" → PhotoStudio. |
| X3 | `ListingsConfig.editorHref` for Trendyol, Wix, Shopify | No target (B3). `CatalogDraft.fieldPatch` v1 supports only title, price, quantity, tags, visible, status and collectionIds, so a full editor cannot stage descriptions, images or attributes. | Two-step plan: (1) M5: on these 3 marketplaces `e` opens the quick-view SidePanel in **`xl` (960)** with editable sections for the CatalogDraft v1 fields, plus "Open in {marketplace} ↗" for the rest. The legacy drawers are deleted with the M5 flag, so no third editor pattern survives. (2) M6b: extend `lib/listingEditor/sections.ts` (`marketplaces` already exists in `SectionDef`) and `CatalogDraft.fieldPatch` to description and images. Add to listings-grid §1.1 and listing-editor §1. |
| X4 | Toolbar "one row, 32px" (DS §3.3) | At 1440 with the sidebar expanded the content is 1152px: Orders' row (search 280 + 3 FilterButtons ≈ 430 + Filters 80 + View 150 + Density 32 + count 90 + gaps) ≈ 1,100px, which barely fits. At 1024 (rail) the content is 912px: it **does not fit**, and DS §8 requires 1024 screenshots with nothing overflowing. orders §2.1 already draws 2 rows. | DS §3.3 overflow rule: at narrow widths the pinned FilterButtons fold right-to-left into "Filters • n", search shrinks to a minimum of 200, and the result count moves to the right end of the chips row (always rendered). Test at 1024 for Orders and Listings. |
| X5 | Pro gating (B4) | `entitlement.features.{arbitrage,financials,bulkPhotoStudio}` exists, but there is no DS pattern for a locked feature. The trial includes Pro. It is unclear whether "Financials" means all of Reports or only Profit, Payouts and Transactions. | DS: `EmptyState kind="locked"` (`LockKeyhole` 20 tile, "{Feature} is part of Pro", one primary "See plans" only when `stripeUpsell`, otherwise the text "Not included in your plan"); nav items stay visible; ⌘K entries get a "Pro" caption. **D:** Financials = Reports › Profit, Payouts, Transactions (Sales stays free); Arbitrage = Product finder source "From Trendyol" (R4); Bulk photo studio = U2. Add the gating matrix to finance-analytics and research.md. |
| X6 | AI credits (settings §9.1 meter "AI credits", "text 1, image 10") | No surface says which buttons spend credits, shows the cost, or handles running out: editor "Suggest a title" and "Generate a photo", BulkGrid "Improve with AI", messages "Draft with AI", research explanations. | DS §3.19 rule: every AI button's tooltip ends "· 1 credit" (or "10 credits"); `aiCredits` 402 → the C6 pattern on that button only; a server table `lib/billing/aiCost.ts` (action → credits), used by both the UI and the limiter. |
| X7 | `SectionNav` sticky `top: var(--kx-topbar)` (listing-editor §4.6) | `--kx-topbar` is 52; the mobile TopBar is 48 (tokens has `--kx-topbar-mobile`). The chips would sit 4px off on phones. | The shell sets `--kx-topbar-current` (52 or 48) on `<html>` by breakpoint; sticky elements use it. |
| X8 | "Verify before coding" items scattered across specs | Raw eBay/Shopify status values (listings §3), Etsy `includes=Inventory` (listings §9.3), Trendyol Q&A enums and answer limits (messages §2.2, §5.2), Wix order-number join (messages §6.1), "To ship" > 500 rows (orders §1.3), DataGrid MIT limits (X2), Stripe `flow_data` and `createPreview` on basil (settings A2, A3). | Collect them into one "G0 verification" checklist run once on Hetzner (read-only SQL plus 3 API calls) before M3, with the answers pasted back into each spec. |
| X9 | DS §2.11 / AppShell | `pages/app/print/**` is excluded from AppShell (shell-nav F), but `/app/print/*` is listed as an Orders `match` in navConfig. That is harmless, but print pages render without the shell, so the nav state is never visible there anyway. | No change; noted so nobody "fixes" it. |

---

## 5. Patches applied to the surface specs (log)

| File | Section | Change | Ref |
|---|---|---|---|
| `shell-nav.md` | §2.1 table + notes | `reports` → `REPORTS_HOME` with merged `match`; `finance` row marked "removed in M9 Reports PR"; `g r` reserved for Research | C3 |
| `shell-nav.md` | §3.5 account menu | Shopify-free label "Plan" and settings wording | C9 |
| `shell-nav.md` | §3.6, §6.2, §10 | "Refresh orders from stores" / "Refresh from stores" → "Refresh orders"; meta "Orders refreshed 2 min ago" | C12 |
| `shell-nav.md` | §4.1 TopBar | fixed slot order ⌕ · mobileAction · ⋯/bell; bell to More | C2 |
| `shell-nav.md` | §6.1 | mobile actions collapse into the TopBar ⋯; `mobileOverflow` in `ShellContext` | C2 |
| `shell-nav.md` | §8 | UsageMeter and banner read `useEntitlement()`; `subscription.limits` is fallback only | C8 |
| `shell-nav.md` | §9.1, §12 B | `toShipWhere.ts` → `lib/orders/views.ts` (shared); To ship excludes FBA/MCF and the Trendyol cargo number; overdue uses effective ship-by; parity test | C4 |
| `finance-analytics.md` | §1, §4.1 | `g r` → `g p` | C3 |
| `finance-analytics.md` | §0.4 B11, §6.1, §6.2 | FX via shared `lib/fx.ts`; `canonical.ts` is shared (created by Orders) | C5 |
| `finance-analytics.md` | §2.5 | mobile TopBar "⌕ ⋯" | C2 |
| `overview.md` | §2.3 | mobile TopBar "⌕ + New ⋯" | C2 |
| `overview.md` | §3.1 | Revenue KPI href → `reportsHref()` (+ added to `lib/nav/links.ts` row in §4.4) | C3 |
| `overview.md` | §3.2 rows 1, 11; §5 keys; §6; §8 G5 | `account.*` → `subscription.expired` / `.near_limit` / `.trial_ending` | C7 |
| `overview.md` | §4.1, §4.3, §4.4, §8 G1 | `statusGroups.ts` → `lib/orders/views.ts`; effective ship-by; channel via `canonical.ts`; test renamed | C4, C5 |
| `orders.md` | §9 A1, §10, §13 G1 | `views.ts` exists from M2 and is extended; G1 creates `lib/marketplaces/canonical.ts` | C4, C5 |
| `orders.md` | §4.3, §13 G3 | `AmazonMessageDialog` → `MessageBuyerModal` in M3 | U4 |
| `listings-grid.md` | §6.1, §9.2, §12 | "Duplicate as new" → "Copy listing" | C10 |
| `listings-grid.md` | §6.4, §6.5, §12 | quick-view primary "Send changes to Etsy"; "edits" for field counts | C1 |
| `listings-grid.md` | §6.5 | mobile TopBar without back chevron | C2 |
| `listings-grid.md` | §7 | usage limit → inline Banner + disabled Send, no toast | C6 |
| `listings-grid.md` | §10 + note | `DateTimeField`; this surface owns migration and cron | C13 |
| `listings-grid.md` | §11 item 1 | resolved the "change" unit | C1 |
| `listings-grid.md` | §12 `cell.priceFrom` | TR "en az {price}" (no suffix after a number) | C11 |
| `listing-editor.md` | wording note, §3.1, §3.4, §5.2, §8 `save.saved` | "edits not sent yet"; primary "Send changes to Etsy" | C1 |
| `listing-editor.md` | §6.5 keyboard | `g s` → ⌘K "Jump to section…" | C3 |
| `listing-editor.md` | §6.5 profiles | eBay `ListingTemplates` folded into the profiles Modal | U5 |
| `listing-editor.md` | §7.1 G3 | ownership moved to listings-grid | C13 |
| `listing-editor.md` | §8 (7 keys + header) | `{marketplace}'e` → `{mpDat}` | C11 |
| `settings-billing-pricing.md` | §1.1 `&provider` | behaviour for providers with no panel | C15 |
| `settings-billing-pricing.md` | §1.2 | Sender profile icon `Warehouse` | C14 |
| `settings-billing-pricing.md` | §4.2 connected row | inline "Refresh all orders" when stale > 24h | V3 |
| `settings-billing-pricing.md` | §14, §15.3 | `subscription.near_limit`, `subscription.trial_ending` | C7 |
| `messages.md` | §3.2 | thread sheet closes with ✕ | C16 |

---

## 6. Edits for the integrator (outside the files I was allowed to change)

**`DESIGN_SYSTEM.md`**
1. Add a precedence line under "Conflicts resolved": rules in §1–§4 bind the surfaces; surface specs supersede the §6 wireframes (C20).
2. §3.1 nav: Reports and Finance merge in M9; `g p` Reports, `g r` Research (C3). §6.2 mobile: drop the "‹" on the list page (C2).
3. §3.3: toolbar overflow rule for narrow widths (X4).
4. §3.10 and §6.3: remove the "n/a Tag demand" example until R2 (C20).
5. §3.13: 402 pattern (C6) and the `locked` EmptyState kind (X5).
6. §3.17: BulkGrid base decision (X2) and the "change"/"edit" wording (C1). §3.19 glossary: rows for "change vs edit", "Refresh orders / Orders refreshed …", "Refresh all orders", and the AI credit tooltip (C1, C12, X6).
7. §3.9: merge all new status domains and keys in one table (C7, C26).
8. §4: absorb the surface additions once: `KpiTile.caption`, optional `DataTable.pagination`, `Chart` comparison role, `Column.type 'share'`, `SectionNav`, `FieldSuggestion`, `DateTimeField`, `ImageGrid variant="strip"`, `TagInput.suggestions`, `FormField.dirty/onRevert`, `Money.wholeIfIntegral`, `NavItem.match/gKey`, `Page.breadcrumbs/backHref/mobileAction/mobileOverflow` (C22).
9. §5 #16: product cost lives in Reports › Profit (C21). §6.1: remove "Mark shipped" and "Print picklist". §6.4: label price, total and "Recommended" as A7-only. §6.5: "Trendyol 2 · Wix 1", exchangerate-api.com, "Best sellers (7 days)" (C20).
10. §7.2: R0 also deletes heroes, FAB and duplicate search (V1); R0 timeouts follow `useAsyncState` (V6); add the i18n fragment rule and the migration order (C26, C27); add `surfaces/research.md`, `surfaces/bulk-grid.md` and `surfaces/auth.md` as prerequisites of R1, M7 and the launch (X1, X2, U8); state that admin and marketing pages are out of scope (U11, U12).

**`tokens.md`**
11. Add `backdropPanel = 'rgb(15 23 42 / .16)'` and use it for `SidePanel` (C18).
12. Toaster `containerStyle.bottom` `+ 16px` → `+ 8px` (C19).
13. Add the `--kx-topbar-current` variable set by the shell (X7).

**`RESEARCH_REDESIGN.md`**
14. Header note: "Routes, tool names, layout, timeouts, the score display and AI wording are superseded by DS §3.18 (mapping in CRITIQUE C17). This file remains binding for §0 data inventory, §4.3–§4.4 data model and budget, §5 delete list and §6 guards." Then fix "Sync to Etsy" → "Send changes to Etsy", `components/ui/Metric` → `components/ds/research/Metric`, `ConnectEmptyState` → `ConnectState`, compact ≥ 100,000, and the 15/30s timeouts.
15. Decide whether the Seasonal calendar survives (V5).

**Founder decisions (D)**
16. Whether "Financials (Pro)" covers only Profit, Payouts and Transactions, or all of Reports (X5).
17. Whether research watch quotas are a plan meter, or unlimited in v1 (X1).
18. Confirm the BulkGrid base: DS `DataTable` (recommended) or a DataGrid Pro license (X2).

---

## 7. Resolved (2026-10-15, close-blockers pass)

Written by the close-blockers group. New files: `surfaces/research.md`, `surfaces/bulk-grid.md`, `surfaces/marketplace-editors.md`, `surfaces/pro-gating.md`, `BUILD_PLAN.md`. No existing surface spec, `DESIGN_SYSTEM.md`, `tokens.md` or `RESEARCH_REDESIGN.md` was edited; where those need a change, the new file states the superseding rule and the integrator folds it in (§6 list still applies).

### 7.1 Blockers

| # | Status | Resolution |
|---|---|---|
| B1 Research has no surface spec | **Resolved** | `surfaces/research.md`: 5 routes with route `Tabs` (no left nav), the C17 mapping applied as a table (§1.1), Home / Product finder / Keyword explorer (page + 720px panel variant) / Listing doctor / Shop tracker / Price gap (R4) wireframes desktop + mobile, states, `/api/research/*` contracts returning `{ data, source }`, i18n (`research.*`), redirects for every old tab, file split R1–R4. It also wires in data the backend session already built (`EtsyListingDailyStat` for measured 30-day views and sales, `OrderItem.listingRef`, `SeoExperiment` and `EtsyListingVersion` send markers) instead of re-deriving it |
| B2 BulkGrid has no spec / unbuildable base | **Resolved** | Verified in `node_modules/@mui/x-data-grid` 8.29.3: `MAX_PAGE_SIZE = 100` throws in the MIT build (`gridPaginationUtils.js` L8, L35), `pagination` is a forced prop, the only clipboard props are copy-side (`onClipboardCopy`, `clipboardCopyCellDelimiter`), `cellSelection` exists only in the Premium shared props. `surfaces/bulk-grid.md` builds BulkGrid on the DS `DataTable` (`mode="grid"`, 250-row pages), with TSV paste (Sheets quoting), fill-down, revert cell/row via `replaceFields`, one draft per listing through a new batch-stage endpoint, a full keyboard model and the 200 × 3 paste acceptance test with DB checks. Founder decision D18 answered "DataTable" (license kept as the documented fallback) |
| B3 Trendyol/Wix/Shopify editors and creators | **Resolved** | `surfaces/marketplace-editors.md`: the three marketplaces are section configs + one `CatalogDraft` adapter each on the shared `ListingEditor`; per-field read → staged key → write contract; creators for all three (Trendyol and Shopify had none in the UI). M5 keeps the X3 step 1 quick-view bridge |
| B4 Pro features sold but not designed | **Resolved** | `surfaces/pro-gating.md`: `PlanTag`, `EmptyState kind="locked"`, `FeaturePreview` (labelled sample data), `FeatureGate`; full gating matrix by plan (trial, Starter/Growth, Pro, shopify_free, unknown); shopify_free never sees "Pro", plans, prices or upgrade wording and gated entry points are not rendered; 402 `featureLocked` swaps the region, no toast/modal. Bulk photo + video studio → full-page `PhotoStudio` (`/app/etsy-listings/photos`, Pro, server gate on a new `batch-media` endpoint). Arbitrage → Product finder "From Trendyol" (R4) |
| B5 Same server logic specified three times | Already patched (§5); **ownership closed** in `BUILD_PLAN.md` §3 (`lib/orders/views.ts`: M2 → M3 → M8; `lib/marketplaces/canonical.ts`: created by orders G1, finance imports; `lib/fx.ts`: overview G1; usage snapshot: billing track) |
| B6 File-ownership collisions | **Resolved** | `BUILD_PLAN.md`: one-owner rule, 30+ contested files each given one owner per milestone (§3), registries declared once (§2), i18n central (agents return keys; supersedes C26's fragment files), every migration handed to the backend session (§5), backend-owned paths import-only (§1), the backend checklist items 3–12 mapped to an interim I0 pass on legacy files plus their final milestone (§7), real logos via `lib/ds/logos.ts` (§2.1) |

### 7.2 Other items closed or changed by this pass

| Item | Now |
|---|---|
| X1, C17, U3 | research.md (above). Watch quotas = plan limit `researchWatches` (not a monthly meter), numbers are founder decision D-R1 |
| X2, U2 | bulk-grid.md, pro-gating.md §4 |
| X3, U1 | marketplace-editors.md |
| X5 | pro-gating.md; "Financials" = Profit + Payouts + Transactions, Sales free (founder decision D-P1, one-line flip in `lib/billing/featureMap.ts`) |
| X6 (AI credits) | partially: research, BulkGrid and PhotoStudio show credit costs on every AI button; the server table `lib/billing/aiCost.ts` stays with the billing track (tiers.md `AI_ACTION_COST`) |
| V1, V6 | research.md §14.1 (R0 deletes the hero/FAB/duplicate eBay search; 15/30 s timeouts) |
| V5 | Seasonal calendar kept as the Home card "Upcoming seasons", with lead times from the user's own label history (research.md §4.1) |
| C13 | `DateTimeField` (and `FieldSuggestion`, `TagInput.suggestions`, `FormField.dirty`) move into M1-b (BUILD_PLAN §3); listings G5 and editor S consume |
| C22 | DataTable optional pagination + `share`, KpiTile `caption`, Chart `role` are built once in M1 (BUILD_PLAN §3) |
| C26 | Superseded: the integrator merges keys returned by agents; no per-group fragment files |
| C27 | BUILD_PLAN §5 (migration list and production order) |
| listing-editor API G2 | Dropped: research R1-B returns p25/p75/n through `lib/research/etsySearch.ts` |

### 7.3 New findings from this pass (verified in code)

1. **Wix silent data loss**: the Wix editor and creator render "Discount price" and "Collections" but never send them (`WixProductEditorDrawer.tsx` L122–L137, `WixProductCreatorDialog.tsx` L60–L69); `wixClient` has no collection or media write method at all. Fixed by marketplace-editors.md §0 #1–#2, §7.2. Until M6b, this is a live bug worth a one-line legacy fix (hide or wire the two fields).
2. **Trendyol drawer** sends price and quantity in a partial item to the product-update endpoint (`PUT /products`) instead of `price-and-inventory`; unverified whether Trendyol rejects it (marketplace-editors.md §0 #4 asks for one `batch_status` check).
3. Listing-editor G1 and the overview/orders label-route work sit in **backend-owned paths** (`lib/etsy/**`, `pages/api/labels/*`) → backend requests BR-3, BR-5, BR-6 (BUILD_PLAN §6).
4. `EtsyListing.hasVariations` and `NotificationSettings.timezone` **already exist** (backend migrations of 2026-10-15): the listings_grid request drops `hasVariations`, and the settings `user_timezone` migration is proposed to be replaced by the existing timezone (BR-2, founder/backend decision).
5. Backend components `components/notification-center/*` use `uppercase` (3 places) and will render inside the new shell (BR-9).
6. `lib/ds/logos.ts` still points Trendyol and Hepsiburada at 600×600 PNG wordmarks that are unreadable at 16 px (decision D-L1).

### 7.4 Still open after this pass
- U8 (auth pages spec), U9–U12 decisions, X4 (toolbar overflow at 1024), X7 (`--kx-topbar-current`), X8 (G0 verification checklist) are untouched.
- §6 integrator edits to `DESIGN_SYSTEM.md`, `tokens.md` and `RESEARCH_REDESIGN.md` are still not applied; the new files add to that list: DS "Conflicts resolved" DataGrid row and §3.17/§4.4 BulkGrid (bulk-grid.md §1.1), DS §3.13/§4.4 `locked`/`PlanTag`/`FeaturePreview` (pro-gating.md §3.1), DS §3.18 Tabs + seasonal card (research.md §1.1), DS §4.1 brand registry = `lib/ds/logos.ts` (BUILD_PLAN §2.1).
- Every "verify" in the new files (Trendyol title limit and re-approval rule, Wix discount/media endpoints, `includes=Inventory` SKUs, eBay staging paths) must be checked on Hetzner before its milestone.

# Surface: Research hub (`/app/research`)

Status: design spec, binding for the research track **R1–R4** (`DESIGN_SYSTEM.md` §3.18, §6.6, §7.2). Date: 2026-10-15. Design only: no app code changed.
Resolves CRITIQUE **B1 / X1 / C17 / U3 / V1 / V5 / V6**. Contract: `DESIGN_SYSTEM.md` (DS) + `tokens.md`. Data inventory, guards, Etsy budget and delete list: `RESEARCH_REDESIGN.md` (RR) §0, §4.3–§4.4, §5, §6, **which stay binding**. Everything else in RR (routes, tool names, layout, timeouts, score display, AI wording) is superseded by this file and the DS (mapping in §1.1).

Code read (kx-ux-phase0 working tree, 2026-10-15): `pages/app/{etsy-research,ebay-research,trendyol-arastirma,amazon-research}.tsx` (252 / 3,306 / 198 / 150 lines); `components/{etsy,ebay,trendyol,amazon}/research/**` (18,904 lines); `lib/stores/use{Etsy,Ebay,Trendyol,Amazon}ResearchStore.ts`; `pages/api/clawd/etsy.ts` (`search_market` L253, `get_public_shop` L356, `get_public_shop_listings` L396, `batch_shops` L470, `analyze_niche` L505, `estimate_sales_velocity` L648, `get_shop_reviews` L808, `get_discovery_data` L903, rank actions L3282–L3509); `pages/api/clawd/{ebay-research,arbitrage,amazon-research}.ts`; `pages/api/trendyol/research.ts`; `pages/api/trends/{etsy,amazon}.ts`; `pages/api/ai/{etsy,trendyol,amazon}.ts`; `components/{etsy,ebay}/research/**/listingPrefill.ts`; `lib/researchCache.ts`; `lib/research/stats.ts` (R0, landed in this tree: `robustStats`, `summarizePrices`, `normalizePrices`, `priceDisplay`, `decodeEntities`); `prisma/schema.prisma` (`RankTrackedKeyword`, `RankSnapshot`, `ResearchCache`, `EbayTracked*`, `AmazonTrackedProduct`, `ArbitrageMatch`, `*ProductIndex`, and the backend session's new `EtsyListingDailyStat`, `EtsyListingVersion`, `SeoExperiment`, `EtsyPublicListingSnapshot`, `OrderItem.listingRef`).

---

## 0. What is wrong today (short; RR §1 has the long version)

| # | Problem | Where | Fixed by |
|---|---|---|---|
| 1 | 27 sub-tools on 4 pages, 4 navigation patterns (pill tabs, a 14-item tab list, a gradient side rail, a purple FAB) | the 4 route files | One hub, 5 route tabs (§2) |
| 2 | "Trending niches" = 3 hard-coded queries per month; "$5,218.94 avg" = arithmetic mean over mixed currencies | `clawd/etsy.ts` L903, L253 (`priceStats.avg`) | R0 (`lib/research/stats.ts`) + `Metric` guards (§3) |
| 3 | "Demand score" is supply/5000 plus a 3% favorites guess; "sales velocity" invented twice | `analyze_niche` L505, `estimate_sales_velocity` L648 | Demand **Signal** tiers (RR §6.2), measured shop sales from snapshots (§8) |
| 4 | Results lead nowhere: almost no `writeListingPrefill`, no watch, no "apply to my listing" | everywhere | Every result ends in one primary that stages a draft or opens a prefilled creator (§3.4) |
| 5 | AI is a destination (FAB, eBay `ai_hub` tab, Trendyol "AI Report" tab) | `AiOptimizePanel`, `AiOptimizationHub`, `AiReport`, `components/amazon/research/AiInsightsPanel.tsx` | AI is a verb inside a result, gated by the numbers check (§3.5) |
| 6 | Gradient heroes, duplicate eBay search bars, empty grey button, stuck "Loading your eBay listings…" banner, Turkish tips in the EN UI | route files | V1/V6 patch in R0 (§14.1), then the hub |
| 7 | We already own data nobody shows: real per-listing sales (`OrderItem.listingRef`), daily views/favorites deltas (`EtsyListingDailyStat`), daily rank (`RankSnapshot`), edit outcomes (`SeoExperiment`), shop sales counters (`EtsyPublicListingSnapshot.shopSoldCount`) | backend W1/W3 tables | Listing doctor (§7) and Shop tracker (§8) read them |

---

## 1. Decisions

### 1.1 RR → DS reconciliation (CRITIQUE C17; the DS wins every conflict)

| Topic | RR said | Binding now | Why |
|---|---|---|---|
| Job 1 Validate `/app/research/validate` | Job name + route | **Product finder** `/app/research/products` | DS §3.18 |
| Job 2 Keywords | `/app/research/keywords?listing=` | **Keyword explorer** `/app/research/keywords` (same route) | DS §3.18; consumers already link here (listing-editor §4.3) |
| Job 3 Listing Doctor `/app/research/listings` | "My listings" | **Listing doctor** `/app/research/listings` | DS §3.18; overview links here |
| Job 4 Competitor Watch `/app/research/competitors` | | **Shop tracker** `/app/research/shops` | DS §3.18 |
| Job 5 Rankings `/app/research/rankings` | own page | **Keyword explorer view `?view=tracked`** | DS §3.18 ("Rankings is its Tracked saved view") |
| Job 6 Price gap `/app/research/price-gap` | own page | **Product finder `?source=trendyol`** (R4, Pro) | DS §3.18; arbitrage = Pro (§9) |
| Layout | 200px left section nav, content max 1200 | `Page width="list"` (1600) + **route `Tabs`** under the PageHeader: Home · Product finder · Keyword explorer · Listing doctor · Shop tracker (5 = DS `Tabs` max). No left nav | DS §3.2, §4.6; same pattern as Reports |
| Doctor score | "No 0–100 score; issue count" | `ScoreMeter` cell + `ScorePanel` (one representation app-wide), **sorted by opportunity**, plus an "Issues" count column | DS §3.10 one score; RR's sort is kept |
| AI verdict card ("VERDICT Promising") | | **`EvidenceSummary`** (2–4 computed facts + confidence from n). AI may only rephrase after the numbers check | DS "Conflicts resolved" |
| Stuck-load timeout | 20s | `useAsyncState`: 15s "Still loading… Retry", 30s `ErrorState` (CRITIQUE V6) | DS P6 |
| Compact numbers | ≥ 10k | ≥ 100,000, KPI tiles and axes only | DS §3.12 |
| `Metric` location | `components/ui/` | `components/ds/research/Metric.tsx` | DS §4.4 |
| Not-connected state | `ConnectEmptyState` | `ConnectState` | DS §4.5 |
| Push wording | "Sync to Etsy", "Apply as draft" | "Send changes to Etsy" (push), "Add 5 tags to…" / "Stage fixes" (staging) | DS §3.19 |
| Seasonal calendar (RR §3 supporting module) | Home card | **Kept** as Home card "Upcoming seasons" (deterministic, ship-from-Türkiye lead times). CRITIQUE V5 resolved | Answers "what should I list for the season" honestly; no hard-coded tip strings (all i18n) |
| MarginBox | Job 1 + Job 6 | **R4 only**, inside the Price gap row expansion. R1 Product finder has no margin block | R1 scope; landed cost needs label history + FX that R4 builds |
| Amazon column | Job 1 | Marketplace filter value `amazon`, shown only with confirmed Creators API eligibility (§3.2) | RR rule kept |

### 1.2 Decisions for this surface

| Question | Decision | Why |
|---|---|---|
| One page or five | Five route files sharing one `ResearchLayout` (PageHeader + Tabs + marketplace `FilterButton`). Each tool is its own route so URLs are shareable and each tool code-splits | P3 URL state; a 3,306-line page is what we are deleting |
| Default landing | `/app/research` (Home). `RESEARCH_HOME` in `lib/nav/navConfig.ts` flips to it in the R1 PR (shell-nav §2.1) | |
| Marketplace switch | One `FilterButton` "Marketplace: Etsy ▾" in the PageHeader actions slot, persisted in `?mkt=` and remembered per viewer (`localStorage` `kx.research.mkt`, try/catch). Default: the first connected of Etsy → eBay → Trendyol → Amazon | DS §3.18 "the marketplace is a filter, not a page" |
| Keyword explorer inside the editor / quick view | `KeywordExplorer variant="panel"` in a `SidePanel lg` (720): one listing, views **Suggested** and **Used in my shop** only, primary "Add N tags to this listing" | CRITIQUE X1; a 1600px tool does not fit 720px, so the panel variant drops columns, not features that matter there |
| Watch quotas | Plan limit `limits.researchWatches` (Trial 3 · Starter 10 · Growth 25 · Pro 50 · Enterprise ∞ · shopify_free 10), counted over active `ResearchWatch` rows. **Not** an entitlement meter in v1 (meters are monthly; watches are a standing count). Founder confirms the numbers (BUILD_PLAN §8 D-R1) | CRITIQUE X1; keeps the Etsy 100K QPD budget (RR §4.4) |
| AI cost | Every AI button tooltip ends "· 1 credit" (CRITIQUE X6); "Explain" = 1, "Suggest seeds" = 1. 402 `aiCredits` → C6 pattern on that button only | settings §9 AI credits meter |
| Pro gating | Only **Price gap** (`?source=trendyol`) is Pro (`features.arbitrage`). Everything else in Research is in every plan (pricing page "research" is core) | pro-gating.md §2 |
| Old routes | `getServerSideProps` 308 redirects (table §2.3), keeping `?tab=` mapped for one release, then plain redirects forever | links in emails, bookmarks, the Chrome extension |

---

## 2. Information architecture

### 2.1 Routes and URL state (`useUrlState`)

| Route | File | URL state | Tab |
|---|---|---|---|
| `/app/research` | `pages/app/research/index.tsx` | `?mkt=` | Home |
| `/app/research/products` | `pages/app/research/products.tsx` | `?q=&mkt=&country=US&compare=q1\|q2\|q3&source=search\|trendyol&sort=&page=` | Product finder |
| `/app/research/keywords` | `pages/app/research/keywords.tsx` | `?q=\|listing=<id>&shop=&mkt=&country=US&view=suggested\|longtail\|seasonal\|mine\|tracked&f.<key>=&sel=` | Keyword explorer |
| `/app/research/listings` | `pages/app/research/listings.tsx` | `?shop=&mkt=&sort=opportunity\|health\|views\|sales&f.issue=&open=<listingId>&page=&size=` | Listing doctor |
| `/app/research/shops` | `pages/app/research/shops.tsx` | `?mkt=&open=<watchId>&add=<url>` | Shop tracker |

`Page width="list"`, title "Research · KolayXport" (Home) / "{Tool} · KolayXport". Breadcrumbs: `Research › Product finder`.

### 2.2 Entry points

| From | Goes to |
|---|---|
| Sidebar "Research" (`g r`), mobile More sheet | `/app/research` |
| ⌘K: typed text + "Research: {text}" action (palette group `actions`) | Home with `?q=` → smart-search routing (§4.3) |
| Listing editor Tags "Get tag ideas" / "Open Keyword explorer ↗" | `KeywordExplorer variant="panel"` in `SidePanel lg` (R2); a new tab until R2 |
| Listings quick view ScorePanel "Get tag ideas" | same panel |
| Overview queue "N listings need work" | `/app/research/listings?sort=opportunity` |
| Listings PageHeader ⋯ (Etsy, eBay) "Find what to fix" | `/app/research/listings?shop=` |
| Notification "Competitor added 9 listings" (R3) | `/app/research/shops?open=<watchId>` |

### 2.3 Redirects (old → new), in each old route's `getServerSideProps`

| Old | New |
|---|---|
| `/app/etsy-research` (any tab), `?tab=discover\|unified` | `/app/research/products?mkt=etsy` |
| `/app/etsy-research?tab=grader` | `/app/research/listings?mkt=etsy` |
| `/app/etsy-research?tab=competitors` | `/app/research/shops?mkt=etsy` |
| `/app/etsy-research?tab=keywords\|ranks` | `/app/research/keywords?mkt=etsy` (`ranks` → `&view=tracked`) |
| `/app/ebay-research` default, `product_database`, `niche_finder`, `marketplace_comparison`, `niche_comparison`, `category_explorer` | `/app/research/products?mkt=ebay` |
| `/app/ebay-research?tab=keyword_intelligence\|seo_analyzer` | `/app/research/keywords?mkt=ebay` |
| `/app/ebay-research?tab=listing_optimizer\|ai_hub` | `/app/research/listings?mkt=ebay` |
| `/app/ebay-research?tab=product_tracker\|seller_tracker\|competitive_intelligence` | `/app/research/shops?mkt=ebay` |
| `/app/ebay-research?tab=arbitrage` | `/app/research/products?source=trendyol` (R4; before R4 the old page stays) |
| `/app/ebay-research?tab=financial` | `/app/reports/profit` (after M9; before that `/app/financials`) |
| `/app/trendyol-arastirma` | `/app/research/products?mkt=trendyol` (R4: `?source=trendyol`) |
| `/app/amazon-research` | `/app/research/products?mkt=amazon` |

Before each tool ships, its old routes keep working (behind flag `research`, DS §7.1.5). The redirect for a tab lands in the same PR as the tool that replaces it. The verified tab keys above must be re-checked against the `activeTab` unions in each route file before coding (the eBay page uses a string union at the top of the file).

### 2.4 Page frame (all five routes)

```
Page width="list"
├─ PageHeader   title "Research"  subtitle (Home only) "Find what to sell, how to price it, and which words buyers use"
│               actions: [Marketplace: [E] Etsy ▾]  (FilterButton, the only header control on Home)
│               tools: ⋯ (tool-specific) · one primary per tool (§5–§8)
├─ Tabs (route tabs, 40px, sticky under the TopBar with the toolbar)
│   Home · Product finder · Keyword explorer · Listing doctor · Shop tracker
├─ Toolbar (tool-specific; DS §3.3)
└─ Content
```

Mobile (< 900): the Tabs become a horizontally scrolling chip strip under the 48px TopBar (the only allowed h-scroll besides SavedViews), title "Research" in the TopBar, `⌕ ⋯` on the right (C2 slot rule: no `mobileAction`, `⋯` holds the marketplace switch and tool overflow).

---

## 3. Shared rules (every tool)

### 3.1 Numbers
- Every number is a `Metric` with `kind` (`measured | estimate | signal | user`). `SourceNote` sits under every card header and every table footer: "Etsy search · 48 listings sampled · 3 excluded (no FX rate) · updated 2 h ago · Measured".
- Prices go through `summarizePrices()` / `priceDisplay()` from `lib/research/stats.ts` (R0): median and p25–p75, Tukey-trimmed, FX-normalized, plausibility bounds. `quality: 'small'` (n < 20) renders the range only with "small sample"; `'insufficient'` (n < 5) renders "Not enough data"; `'implausible'` renders `—` with "check: unusual price range". **No mean of prices anywhere.**
- Money through `Money` (narrowSymbol, marketplace currency). A TRY view is `≈` with the FX source and date in the tooltip ("Converted at exchangerate-api.com rate, 15 Oct"; never "TCMB").
- Lifetime counters (views, favorites, eBay `estimatedSoldQuantity`) are labelled "(all time)" and never shown as a rate. Rates come only from two snapshots (Shop tracker) or from `EtsyListingDailyStat` (own listings).
- Rank `null` = "Not in top 500", never 0.

### 3.2 Marketplace eligibility (the `FilterButton` options; a disabled option has a reason)

| Marketplace | Home | Product finder | Keyword explorer | Listing doctor | Shop tracker |
|---|---|---|---|---|---|
| Etsy | ✓ | ✓ (public API) | ✓ (R2) | ✓ needs a connected Etsy shop, else `ConnectState brand="etsy"` | ✓ (R3) |
| eBay | ✓ | ✓ (Browse) | ✓ suggestions + competition only (no top-48 tags: eBay has no tags) | ✓ needs eBay connected | ✓ sellers (existing `EbayTrackedSeller`) |
| Amazon | ✓ | ✓ **only** when Creators API eligibility is confirmed; otherwise the option is disabled with "Amazon research needs an eligible Amazon Associates account" | autocomplete only | — (option hidden) | ASIN watch (existing `AmazonTrackedProduct`) |
| Trendyol | ✓ | ✓ sourcing view (TRY), R4 adds `source=trendyol` Price gap | — (hidden) | — (hidden) | — (hidden in v1) |

A hidden option is never rendered; a disabled option shows its reason. A tool whose selected marketplace is not connected shows `ConnectState` (never an error). A failed connection check shows "Couldn't check {marketplace} · Retry" (P6).

### 3.3 Search
- One `SearchField size="md"` per tool (Home has the large one). Turkish input is allowed: Product finder and Keyword explorer offer "Translate to English keywords" (AI, 1 credit) when the query is detected as Turkish (`/[çğıöşüÇĞİÖŞÜ]/` or the user's UI locale is TR and no ASCII-English stopwords match). The result shows the chosen English seeds as removable chips; **keywords, titles and tags stay English** (P5).
- Debounce 400 ms for typing in tables; the big searches run on Enter or the button (each search costs Etsy calls).

### 3.4 Actions (all write into KolayXport, never into a marketplace)
| Action | Contract | Where |
|---|---|---|
| Draft a listing | `writeListingPrefill({ target, source: 'research-hub', title?, tags, price?, currency, imageUrls?, categoryHint?, research })` → `/app/{etsy\|ebay}-listings/new?prefill=session` (listing-editor §1). `ListingPrefillSource` gains `'research-hub'` (the two prefill copies are unified into `components/etsy/research/shared/listingPrefill.ts`; the eBay file re-exports) | Product finder, Shop tracker |
| Use $49 in listing | listing picker → `stageEtsyDraft({ fields: { price } })` / `stageEbayDraft(offer price)`; variation listings: disabled with "Has variations: change prices in the editor" | Product finder Price card |
| Add N tags to… | listing picker (`Combobox` over own listings, recent first) → `stageEtsyDraft({ fields: { tags: merged } })` with `mergeTagInput` (13 × 20, no title overlap); result toast "5 tags added to 'Jewelry box' · Not sent yet · Open" | Keyword explorer, Product finder Buyer words card, Shop tracker tag gap |
| Stage fixes | per check `fix.action` → proposal → `stageEtsyDraft`; bulk: one draft per listing | Listing doctor |
| Track | `POST /api/clawd/etsy?action=add_tracked_keyword` (existing; R2 wraps it in `/api/research/keywords/track`) | Keyword explorer |
| Watch | `POST /api/research/watches` (R3) | Product finder, Shop tracker, Price gap |
| Open in BulkGrid | `/app/etsy-listings/bulk?ids=` (M7; before M7 the action is not rendered) | Listing doctor bulk bar |

Every staging action ends with the same toast pattern (≤ 80 chars, `Undo` 6 s where the patch is reversible) and the Listings send primary picks the change up ("Send N changes to Etsy" on the listings page). Research never shows a send button itself.

### 3.5 AI
- `EvidenceSummary` facts are **computed strings** from the API (`facts[]`, i18n keys + params), not AI text.
- "Explain" (ghost button, `Sparkles`, "· 1 credit") calls `POST /api/research/explain` with the computed metrics JSON; the server validates with zod, runs the numbers check (RR §6.5: every number in the text must appear in the input ±rounding, otherwise the sentence is stripped), caps at 600 chars, and returns `{ text, locale }` in the UI locale. Garbled or empty → inline `ErrorState` "The explanation didn't come out right · Try again". Never a toast with model text.
- AI suggestions of keywords/titles/tags are English and pass `normalizeTags` / `normalizeTitle` (existing `lib/etsy/seoRules.ts`, read-only use).

### 3.6 States (every region, `useAsyncState`)
Skeleton after 200 ms (layout-matched: card skeletons for Product finder, `TableSkeleton thumb` for tables) · 15 s "Still loading… Retry" inline · 30 s `ErrorState inline` with the real cause ("Etsy didn't respond", "Etsy's daily request budget is used up: showing yesterday's data") · stale data stays visible with `ErrorState variant="stale"` "Showing results from 10:42 · Retry". Upstream budget circuit breaker (RR §4.4, 85K Etsy calls/day) → info `Banner` "Showing cached results: Etsy's daily limit is close" and every result carries its cached `fetchedAt`.

---

## 4. Home (`/app/research`)

### 4.1 Desktop 1440

```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Research                                                          [Marketplace: [E] Etsy ▾]  │ PageHeader 56
│          │ Find what to sell, how to price it, and which words buyers use                                │ subtitle
│          │ (Home) (Product finder) (Keyword explorer) (Listing doctor) (Shop tracker)                    │ Tabs 40
│          │ ┌──────────────────────────────────────────────────────────────────────────────┐ [Research]   │ SearchField md 40 + primary
│          │ │ ⌕ Idea, keyword, Etsy listing link, shop URL or Trendyol link…           /   │              │ (max 880)
│          │ └──────────────────────────────────────────────────────────────────────────────┘              │
│          │ ( Is this niche worth it? ) ( What price should I charge? ) ( Which tags? )                   │ question chips 32
│          │ ( Why is my listing not selling? ) ( What are my competitors doing? )                         │
│          │                                                                                              │ 32
│          │ ┌ Your listings that need work ───────────────── Etsy listings · health · now ┐ ┌ Upcoming seasons (shipping from Türkiye) ┐ │
│          │ │ [img] Name Necklace Gold        ▰▱▱▱▱ 34   4 issues   [Fix]                 │ │ Christmas (US)   List by 20 Oct · in 5 days │ │
│          │ │ [img] Wooden Keepsake Box       ▰▰▰▱▱ 61   2 issues   [Fix]                 │ │                  Last FedEx from İstanbul 15 Dec│ │
│          │ │ [img] Baby Name Puzzle          ▰▰▱▱▱ 45   views 412, 0 sales (30 d)  [Fix] │ │ Valentine's Day  List by 1 Dec              │ │
│          │ │ 18 listings under 50 · Open Listing doctor ›                                │ │ Mother's Day (US) List by 15 Mar            │ │
│          │ └─────────────────────────────────────────────────────────────────────────────┘ │ Your production days: 3 · Edit ›            │ │
│          │ ┌ Recent and watched ──────────────────────────────────────────────────────────┐ └────────────────────────────────────────────┘ │
│          │ │ wooden keepsake box · Product finder · Etsy · 2 h ago                    ›   │                                                │
│          │ │ WoodAndWords · +9 listings in 7 days · Shop tracker                      ›   │                                                │
│          │ │ "baby keepsake box" · rank 34 → 71 · Keyword explorer                    ›   │                                                │
│          │ └──────────────────────────────────────────────────────────────────────────────┘                                                │
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Two columns at ≥ 1200 (`8fr / 4fr`, 24 gap); one column below. Cards are `Section variant="card"` with `SourceNote` in the header right ("Etsy listings · health · now").
- The search primary "Research" is the **one primary** on Home. Card actions ([Fix], "Open Listing doctor ›") are ghost/link buttons.
- Question chips are `Button variant="secondary" size="sm"` (not filters): they navigate with the current query prefilled (table §4.3). With an empty query they focus the search with a placeholder hint for that question.
- "Your listings that need work": top 3 by opportunity (§7.3), from `GET /api/research/listings?shop&sort=opportunity&size=3`. Hidden when no Etsy or eBay store is connected; then the card becomes `ConnectState` compact ("Connect Etsy to see which listings need work").
- "Upcoming seasons": `lib/research/seasons.ts` (deterministic event table with per-country dates) + lead time = production days (account preference `research.productionDays`, default 3, edited inline in a Popover with a `NumberField`; stored in `localStorage` in v1, per viewer) + **median transit days from the user's own `Shipment` history per carrier and destination** (fallback: carrier rate-card transit, labelled Estimate) + the marketplace order-by date. Each row links to Product finder with a seed (`?q=christmas ornament personalized`). Source note: "Your FedEx labels to US · median 4 days · 23 labels · Measured".
- "Recent and watched": recent searches (`localStorage` `kx.research.recent`, 10, per viewer) merged with watched items (R3 `ResearchWatch` + existing `RankTrackedKeyword`), newest change first. Empty: the card is not rendered.

### 4.2 Mobile 390

```
┌──────────────────────────────────┐
│ Research                    ⌕  ⋯ │ TopBar 48 (⋯ = Marketplace switch)
├──────────────────────────────────┤
│ (Home)(Product finder)(Keyw…  →  │ tab chips, h-scroll
│ [⌕ Idea, keyword or link…      ] │ 44px, 16px text
│ [          Research           ]  │ 44px full width (primary)
│ (Is this niche worth it?) (Wh… → │ question chips, h-scroll
│ ┌ Your listings that need work ┐ │
│ │[img] Name Necklace Gold      │ │
│ │      ▰▱▱▱▱ 34 · 4 issues   › │ │ row = 56, tap → Listing doctor ?open=
│ │[img] Wooden Keepsake Box   › │ │
│ │ Open Listing doctor ›        │ │
│ └──────────────────────────────┘ │
│ ┌ Upcoming seasons ────────────┐ │
│ │ Christmas (US) · list by 20 Oct│
│ └──────────────────────────────┘ │
│ ┌ Recent and watched ──────────┐ │
├──────────────────────────────────┤
│ Overview Orders Listings Msgs More│
└──────────────────────────────────┘
```
No StickyActionBar on Home (no state-driven primary).

### 4.3 Smart search routing (`lib/research/detectQuery.ts`, pure, unit-tested)

| Input | Detected | Goes to |
|---|---|---|
| `etsy.com/listing/<id>` (any subdomain, with or without slug/query) | Etsy listing | own shop → `/app/research/listings?open=<id>`; someone else's → Product finder with the listing's main phrase (title words) and a "Compared with: {title}" chip |
| `etsy.com/shop/<name>` | Etsy shop | `/app/research/shops?add=<name>` (confirm Modal "Watch WoodAndWords?") |
| `ebay.com/itm/<id>` / `ebay.com/str/<name>` / `ebay.com/usr/<name>` | eBay item / seller | Product finder with item title / Shop tracker add |
| `trendyol.com/...-p-<id>` | Trendyol product | R4: Product finder `?source=trendyol&url=`; before R4: Product finder `mkt=trendyol` with the title |
| `amazon.com/dp/<ASIN>` | ASIN | Product finder `mkt=amazon` (if eligible) |
| anything else | idea/keyword | chip pressed → that tool; no chip → Product finder |

Question chips: "Is this niche worth it?" → Product finder · "What price should I charge?" → Product finder `#price` · "Which tags?" → Keyword explorer · "Why is my listing not selling?" → Listing doctor · "What are my competitors doing?" → Shop tracker.

---

## 5. Product finder (`/app/research/products`)

**Question:** "What should I make or sell next, and at what price?"  **Primary:** "Draft a listing" (when results exist; otherwise "Research" on the search).

### 5.1 Desktop 1440 (result)

```
│ Research                                                                   [Marketplace: [E] Etsy ▾]  │
│ (Home) (Product finder) (Keyword explorer) (Listing doctor) (Shop tracker)                            │
│ [⌕ wooden baby keepsake box                         ] [Country: US ▾] [Category: All ▾] [Compare +]  ⋯ [Draft a listing] │ toolbar 32/40
│ English keywords: (wooden baby keepsake box ✕) (personalized memory box ✕)   from "ahşap anı kutusu"  │ seed chips (only after TR input)
│ Etsy search · 287 of 300 listings used · 13 excluded (no FX rate) · updated 2 h ago · Measured         │ SourceNote (page level)
│ ┌ Evidence ────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ · Most sell between $38 and $62 (median $49)        · 30% of top shops opened less than 1 year ago │ │
│ │ · 18,420 competing listings                          · Demand Signal ●●●○○ (2 of 3 inputs)          │ │
│ │ Confidence: medium · 287 listings, Etsy shares no search volume          [✦ Explain · 1 credit]    │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Price ───────────────────┐ ┌ Competition ─────────────┐ ┌ Demand Signal ───────────┐ ┌ Newcomers ──────────────┐ │
│ │ $38 ──[ $49 ]── $62      │ │ 18,420 listings          │ │ ●●●○○ Medium             │ │ 30% of top-48 shops     │ │
│ │ p25 · median · p75       │ │ Top 5 shops hold 28% of  │ │ Google interest 54 (12 m)│ │ opened < 1 year ago     │ │
│ │ n = 287 · Measured       │ │ the top 48 · Measured    │ │ In 2 of 3 autocompletes  │ │ Measured                │ │
│ │ [Use $49 in a listing]   │ │ [See top shops]          │ │ Signal · why?            │ │                         │ │
│ └──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘ └─────────────────────────┘ │
│ ┌ Buyer words (tags used by top 48) ──────────────────────────────────────────────── Measured ┐       │
│ │ keepsake box 62% · memory box 48% · baby gift 40% · newborn keepsake 31% · wooden box 29% …  │       │
│ │ [Add 5 tags to a listing…]                                                                    │       │
│ └────────────────────────────────────────────────────────────────────────────────────────────────┘     │
│ Top listings (48)                                                                     Sort: Relevance ▾ │
│ ┌──┬──────┬──────────────────────────────────────────┬────────┬────────────┬─────────┬──────────┬────┐ │
│ │  │      │ Listing                                   │  Price │ Favorites  │ Age     │ Shop     │    │ │
│ │  │[img] │ Personalized Wooden Baby Keepsake Box…    │ $45.00 │ 1,204 (all)│ 2 y     │ WoodAnd… │ ⋯  │ │
│ └──┴──────┴──────────────────────────────────────────┴────────┴────────────┴─────────┴──────────┴────┘ │
│ Etsy search (API order, not personalized) · 48 of 18,420 · updated 2 h ago                             │
```
- KPI-like cards use `Section variant="card"` (not `KpiTile`: these carry ranges and actions). 4 per row at ≥ 1200, 2 at 900–1199, 1 on mobile.
- **Compare (+)**: up to 3 queries side by side (`?compare=q1|q2|q3`). Compare mode replaces the cards with one `DataTable` (rows = metrics, columns = queries; mobile = one query at a time via `SegmentedControl`). Evidence per query is a single line.
- eBay columns: Price (sold ≥ 1 is unknown; active listings only, labelled "active listings"), Competition (active count), "N of top 50 have sold at least 1 (all time)" in place of Newcomers. Amazon: median BSR → `~` sales estimate (Estimate, model named "KolayXport BSR model v1"). Trendyol (sourcing): median TRY price, `socialProof` counts as Signal.
- Top listings `DataTable`: thumb, title (decoded), price (`Money`), favorites "(all time)", age from `original_creation_timestamp` (never `created_timestamp`), shop (link). Row ⋯: Open on Etsy ↗ · Watch this shop · Use this title as a starting point (prefill, AI rewrite required: "Draft a listing from this" never copies verbatim). Row click opens a `SidePanel md` with the listing's tags, price, shop stats (`get_public_shop`) and the same actions.
- Header ⋯: Watch this search (R3) · Export results (CSV) · Copy link.
- **Draft a listing** → `writeListingPrefill({ target: mkt === 'ebay' ? 'ebay' : 'etsy', title: undefined /* the creator's AI writes it */, tags: top-tag set (≤ 13, ≤ 20 chars, no title overlap), price: median only when currency = shop currency, categoryHint: mode taxonomy_id, research: { query, priceSummary, fetchedAt } })`.

### 5.2 Mobile 390
Search full width + [Country] [Filters] row (44px). Seed chips wrap. Evidence card, then the 4 cards stacked, Buyer words, Top listings as cards (media 64 · title · price · "1,204 favorites (all time)" meta). StickyActionBar: "[Draft a listing]" (state-driven: only once results exist). Compare on mobile shows one query at a time.

### 5.3 States (on top of §3.6)
| State | Renders |
|---|---|
| No query | `EmptyState first-use` (icon `Telescope`): "Search an idea to see prices, competition and buyer words" + the 5 question chips |
| Searching | cards skeleton + table skeleton; the search button `loading` "Researching…" |
| 0 results | `EmptyState no-results` "No Etsy listings match 'xyz'" + [Try a broader phrase] (removes the last word) |
| n < 20 / n < 5 | cards show ranges / "Not enough data"; Evidence confidence "low" with the reason |
| Mixed currency | SourceNote "13 excluded (no FX rate)"; never summed |
| eBay token missing (Browse uses app token: should not happen) | `ErrorState inline` "Couldn't reach eBay" + Retry |
| Amazon not eligible | option disabled (§3.2); a deep link with `mkt=amazon` shows `ConnectState`-style info: "Amazon research needs an eligible Associates account" + [Learn how] (help link) |

---

## 6. Keyword explorer (`/app/research/keywords`)

**Question:** "Which tags and title words win for this listing?"  **Primary:** "Add N tags to…" (with a selection) / "Add to listing" (no selection: disabled with "Select keywords first").

### 6.1 Desktop 1440 (`variant="page"`)
DS §6.6 wireframe is binding, with these specifics:
```
│ [⌕ wooden jewelry box                     ] or [For listing: [img] Engraved Walnut Box ▾]  [Country: US ▾] [Filters • 1]  View: [Suggested ▾] │
│ Current tags 11 / 13 · 2 repeat title words · 1 over 20 characters        (only with ?listing=)                                                │
│ ┌──┬─────────────────────────────┬─────────┬─────────────┬────────────┬────────────┬─────────────┬────────────┬────────┐                     │
│ │☐ │ Keyword                     │ Demand  │ Competition │ Top-48 use │ Price band │ In my shop  │ Etsy volume│ Rank   │                     │
│ │☐ │ engraved jewelry box        │ ●●●●○   │ 1,820       │ 18 of 48   │ $38–$72    │ 4 listings  │ 2,410 (you)│ —      │                     │
│ │☐ │ personalized keepsake box   │ ●●●○○   │ 3,410       │ 11 of 48   │ $29–$55    │ —           │ add ↗      │ #34 ▲41│                     │
│ │☐ │ halloween decor             │ —  (?) small sample: 7 listings                                                        │                     │
│ └──┴─────────────────────────────┴─────────┴─────────────┴────────────┴────────────┴─────────────┴────────────┴────────┘                     │
│ Demand Signal is indirect: Etsy doesn't share search volume. Check real volume in Etsy Marketplace Insights ↗                                    │
│ 2 selected  [Add 2 tags to…  Engraved Walnut Box ▾]  [Add to title]  [Track]  · Clear (Esc)                                                      │ BulkActionBar
```
- Views (`SavedViews`, built-in, not user-savable in v1): **Suggested** (candidate pool, sorted by Top-48 use then Demand) · **Long-tail** (≥ 3 words, competition < 5,000) · **Seasonal** (Google Trends peak month within the next 90 days, ▲ month marker) · **Used in my shop** (tags across the user's listings with listing counts; row expand lists the listings) · **Tracked** (RankTrackedKeyword rows; replaces RR Job 5).
- Filters (FiltersSheet): Not in title (with `?listing`) · ≤ 20 characters · Competition (< 1k / 1–10k / > 10k) · Demand (≥ ●●●).
- "Etsy volume" = `ResearchKeywordNote` (You entered): "add ↗" opens Etsy Marketplace Insights in a new tab and a Popover with a `NumberField` "Searches in the last 30 days (from Etsy)". Disagreement ≥ 3 tiers with our Signal shows the RR §6.4 note in the row tooltip: "Our signal differs from Etsy's number: trust Etsy's".
- Row click opens `SidePanel md`: the top 48 listings for that keyword (thumb, title, price), the tag co-occurrence list, the price band with `SourceNote`, rank history (Tracked only, `Chart line` single axis, **send markers** from `EtsyListingVersion` rows with `attribution='kolayxport_draft'` and `SeoExperiment` cohort dates; caption "Position in Etsy API search (not personalized, ads excluded)").
- **Tracked view** columns: Keyword · Listing · Position (today) · 7-day change · Best · Sales 14 d (Measured, `EtsyListingDailyStat.unitsSold` for that listing, before/after the last send). Row ⋯: Find better keywords (→ Suggested with `?listing=`) · See SEO experiment (→ `/app/etsy-aktivite?tab=seo`, the backend's `SeoExperimentList`; we link, we do not rebuild it) · Stop tracking.
- **Add N tags to…**: `Combobox` listing picker (own listings; with `?listing` preselected). Merge rule: `mergeTagInput(current ∪ selected)`; over 13 → Modal sm "Only 2 of 5 fit (13-tag limit). Replace weaker tags?" with a checklist of current tags sorted by Top-48 use ascending; primary "Replace 3 tags". Staged, never sent. Auto-track: tags added from here are tracked automatically (existing `auto_track_listing_tags`), with a caption in the toast.
- eBay: columns Demand, Competition (Browse total), Price band; no Top-48 use, no In my shop tags (eBay has no tags; "Add to title" only).

### 6.2 `variant="panel"` (SidePanel lg 720, from the editor / quick view)
```
┌ Keyword ideas · Engraved Walnut Box ───────────────────────────────────────── ✕ ┐
│ Current tags 11 / 13 · 2 repeat title words                                       │
│ (Suggested) (Used in my shop)                                                     │ SegmentedControl
│ ☐ engraved jewelry box     ●●●●○   18 of 48   1,820                               │ 4 columns only:
│ ☐ personalized keepsake…   ●●●○○   11 of 48   3,410                               │ keyword · demand · top-48 · competition
│ … (20 rows, "Show more")                                                          │
│ Etsy search · top 48 per keyword · 2 h ago · Measured                             │
├───────────────────────────────────────────────────────────────────────────────────┤
│ ⋯  Open full Keyword explorer ↗          2 selected      [Add 2 tags to this listing] │
└───────────────────────────────────────────────────────────────────────────────────┘
```
Inside the editor the panel **does not stage**: it returns the chosen tags to the editor's `TagInput` (the editor's autosave stages them, so there is one staging path per screen). From the listings quick view it stages directly (`stageEtsyDraft`). Prop: `onApply?(tags: string[])` — present = return to caller, absent = stage.

### 6.3 Mobile 390
Search / listing picker full width; views as chips; keyword rows → cards: keyword (title) · "●●●●○ · 1,820 listings" (subtitle) · "Used by 18 of top 48 · $38–$72" (meta) · checkbox via "Select". StickyActionBar with a selection: "[Track] [Add 2 tags]".

### 6.4 States
No query and no listing → `EmptyState first-use` "Type a keyword or pick one of your listings" + listing picker. Candidate pool building (≈ 40 Etsy calls, cached 24 h shared) → progressive rows ("Checking 12 of 40 keywords…" in `SourceNote` meta) — rows appear as they resolve; never a blank table for 20 s. Tracked view empty → `EmptyState first-use` "Track a keyword to see your listing's position every day" + [Track keywords for a listing]. Signal inputs < 2 → "Not enough signal" in the Demand cell with the inputs listed in the tooltip.

---

## 7. Listing doctor (`/app/research/listings`)

**Question:** "Why isn't my listing selling, and what do I fix first?"  **Primary:** "Stage N fixes" (with a selection or an open row) — staging, not sending.

### 7.1 Desktop 1440
```
│ Research › Listing doctor                                        [Marketplace: [E] Etsy ▾]  ⋯  [Stage 6 fixes] │
│ (Home) (Product finder) (Keyword explorer) (Listing doctor) (Shop tracker)                                     │
│ [⌕ Search your listings  /] [Shop: Belle Couture Gifts ▾] [Issue: Any ▾] [Health: All ▾]   Sort: [Biggest opportunity ▾]  214 listings │
│ ┌──┬──────┬──────────────────────────────┬──────────┬──────────┬──────────┬───────────┬──────────┬──────────────────────────┐ │
│ │☐ │      │ Listing                      │ Views 30d│ Sales 30d│ Conv.    │ Main kw   │  Health  │ Biggest issue             │ │
│ │  │      │                              │ Measured │ Measured │          │ rank      │          │                           │ │
│ │☐ │[img] │ Baby Name Puzzle…            │ 412      │ 0        │ 0%       │ #212      │▰▰▱▱▱ 45  │ Price 38% above peers  (4)│ │
│ │☐ │[img] │ Wooden Ring Box…             │ 190      │ 3        │ 1.6%     │ —         │▰▰▰▱▱ 61  │ 5 photos, peers have 9 (2)│ │
│ └──┴──────┴──────────────────────────────┴──────────┴──────────┴──────────┴───────────┴──────────┴──────────────────────────┘ │
│ Views and sales: Etsy daily stats + your orders · last 30 days · updated 06:00                                 │
```
Row click / `Enter` opens the **Doctor panel** (`SidePanel lg` 720, list stays mounted, `‹ ›`):
```
┌ [img96] Baby Name Puzzle, Personalized Wooden…            ● Active   ‹ ›  ⋯  ✕ ┐
│ ID 1490012234 · compared with 48 listings for "baby name puzzle" (main keyword) │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Last 30 days      412 views · 0 sales · 18 favorites       Measured · Etsy + your orders │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ Listing health   45 / 100  Needs work   Scored on 11 of 12 checks              │ ScorePanel
│ ✕ Price $58, peers median $42 (p75 $49)          +7   [Set price…]             │ ← peer check (research-only)
│ ✕ 6 tags repeat title words                      +8   [Get tag ideas]          │ → KeywordExplorer panel
│ ✕ Title 62 characters, peers median 118          +12  [Suggest a title]        │ → FieldSuggestion inline
│ ! 5 photos, peers median 9 · no video (61% of peers) +14 [Open photo studio]   │ → PhotoStudio (Pro) or editor #photos
│ ✓ Personalization on · ✓ Free shipping like 73% of peers                        │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ Staged here (2)  · Title → "Personalized Baby Name Puzzle, Wooden…"  · Price $58 → $45 │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ⋯ More      Saved · 2 edits not sent       [Open editor] [Stage 2 fixes]         │
└─────────────────────────────────────────────────────────────────────────────────┘
```
- The ScorePanel is the **same** `lib/listingScore/etsy.ts` result as the listings grid and the editor, plus up to 3 **peer checks** added by Research (`price_vs_peers`, `title_vs_peers`, `photos_vs_peers`, `tags_vs_peers`) with `na` when peers n < 20. Peer checks never change the stored `healthScore` (they are research context, shown as a separate group "Compared with peers").
- Fix behaviour: "Set price…" opens a Popover with `MoneyField` prefilled with the peer median and the band; "Suggest a title" shows a `FieldSuggestion` card in the panel; "Get tag ideas" opens the KeywordExplorer panel nested **as a second SidePanel is not allowed** → it replaces the Doctor panel body with a back link "‹ Baby Name Puzzle" (panel drill-in, one panel at a time). Accepted proposals collect in "Staged here" and are written with **one** `stageEtsyDraft` per listing when the user presses the primary (or `⌘S`). "Open photo studio" → `/app/etsy-listings/photos?ids=<id>` when `features.bulkPhotoStudio`, otherwise → editor `#photos` (pro-gating.md §4).
- Selection bulk bar: "6 selected · [Stage fixes ▾] (Apply suggested prices · Add suggested tags · Write titles with AI) · [Open in BulkGrid] · Clear". Bulk AI titles go to BulkGrid as dirty cells (DS §3.17), never straight into drafts without review.
- After staging: toast "2 fixes staged for 'Baby Name Puzzle' · Not sent yet · Go to listings" (link to `/app/etsy-listings?view=not_sent`).

### 7.2 Mobile 390
Rows → cards (title · "412 views · 0 sales (30 d)" · biggest issue as meta · health in status slot). Card tap → Doctor panel as full-height sheet, footer 50/50 [Open editor] [Stage 2 fixes]. Select mode → StickyActionBar "[More] [Stage fixes]". No BulkGrid on mobile.

### 7.3 Opportunity sort (deterministic; `lib/research/opportunity.ts`, unit-tested)
1. **Traffic without sales:** `views30d ≥ max(50, shop p50 views)` and `sales30d = 0` → score by views descending.
2. **Can't be found:** main-keyword rank > 100 or null (only when tracked) → by views.
3. **Health gaps:** health < 50 → by impact sum of failing checks.
4. Everything else by health ascending.
`views30d` and `sales30d` come from `EtsyListingDailyStat` (sum over 30 days; `views` is the daily delta, `unitsSold` the measured sales). When a listing has fewer than 7 daily rows, the cells show "—" with "Collecting daily stats since {date}" and the listing falls back to rule 3. eBay: views are not available → rules 2–4, and "Sales 30d" from `OrderItem.listingRef` joined to orders in the window.

### 7.4 States
Not connected → `ConnectState`. Connected, never pulled → `EmptyState first-use` "Bring in your Etsy listings first" [Refresh from Etsy] (same as listings-grid §7). No issues → `EmptyState done` "Nothing urgent: every listing scores 75 or more". Peers unavailable (Etsy budget) → peer group shows `n/a` with reason; the rest works. Main keyword unknown (no tracked keyword) → AI pick from the title (1 credit, cached per listing 7 days), labelled "Main keyword (suggested)" with an edit pencil.

---

## 8. Shop tracker (`/app/research/shops`) — R3

**Question:** "What are my competitors doing?"  **Primary:** "Watch a shop" (opens Modal sm: one `TextField` "Shop link or name", marketplace auto-detected).

### 8.1 Desktop 1440
```
│ Research › Shop tracker                                        [Marketplace: All ▾]  ⋯  [Watch a shop]    │
│ Watching 3 of 10 shops on your plan                                                                         │ caption (link "Compare plans" only if stripeUpsell)
│ ┌──────┬─────────────────┬───────┬──────────────┬────────────┬────────┬────────┬───────────┬────┐           │
│ │      │ Shop            │ Mkt   │ Sales / day  │ vs prev 7d │ Active │ New 7d │ Price Δ   │    │           │
│ │      │                 │       │ 7d · Measured│            │        │        │ median    │    │           │
│ │[logo]│ WoodAndWords    │ [E]   │ 14.3         │ ▲ 22%      │ 412    │ +9     │ —         │ ⋯  │           │
│ │[logo]│ MemoryCrafts    │ [E]   │ 6.1          │ ▼ 8%       │ 188    │ +2     │ ▼ 6%      │ ⋯  │           │
│ │[logo]│ engrave_us      │ [e]   │ —  (?)       │            │ 90     │ +0     │ —         │ ⋯  │           │
│ └──────┴─────────────────┴───────┴──────────────┴────────────┴────────┴────────┴───────────┴────┘           │
│ Etsy shop counters, daily at 06:00 · Measured from 2 snapshots or more                                       │
```
Row → `SidePanel lg`: header (shop, since, ★ 4.9 (8.1k)); "Sales per day, 30 days" (`Chart line`, single axis, points dropped by guard 7 shown as gaps); "New listings this week (9)" thumbnails → each: [Research this idea] (Product finder prefilled) · [Draft a similar listing] (prefill with **our** AI title, never theirs); "Fastest-gaining listings" (favorites Δ 7 d, `~` share of shop sales, Estimate); "Tags they use that you don't" chips → "Add to Keyword explorer"; Alerts (`Switch` ×3: new listings · price drop > 10% · sales spike > 2×). Panel primary: "Compare with my listing" (listing picker → Product finder compare with that listing's main keyword).

- Sales/day is **Measured** only from ≥ 2 daily snapshots of `transaction_sold_count` (RR §6.3 guard 7: negative or > 50× deltas dropped and flagged). Before the second snapshot: "—" with tooltip "First reading taken today. Daily sales appear tomorrow."
- eBay sellers: Δ`estimatedSoldQuantity` per tracked item between snapshots (Measured once 2 exist); "Sales/day" shows "—" until then, with "N items sold at least once (all time)" as caption.
- Alerts go through the backend's `notify()` (`lib/notifications.ts`, backend-owned) with new types `researchShopNewListings`, `researchShopPriceDrop`, `researchShopSalesSpike` (requested in BUILD_PLAN §6).

### 8.2 Mobile / states
Cards: logo + shop (title) · "14.3 sales/day · ▲ 22%" (subtitle) · "412 active · +9 new" (meta). Panel = full-height sheet. Empty → `EmptyState first-use` "Watch a competitor to see their daily sales, new listings and price changes" [Watch a shop]. At the quota → primary disabled with `disabledReason` "You're watching 10 of 10 shops. Remove one to add another" (+ "Compare plans" link only when `stripeUpsell`).

---

## 9. Price gap: Türkiye → abroad (`/app/research/products?source=trendyol`) — R4, Pro

Product finder gains a `SegmentedControl` "Source: [Search] [From Trendyol (Pro)]" in its toolbar. `source=trendyol` shows the arbitrage results as a `DataTable` (product (TR) · TR price · eBay US median (n) · Etsy median (n) · Match confidence (High/Medium/Low, from `ArbitrageMatch`) · Landed cost (Estimate) · Margin (Estimate)) with low-confidence matches collapsed ("Show 12 low-confidence matches"). Row expansion = the old `ArbitrageProductDetail` re-skinned (MarginBox: cost ₺ → $ via FX, shipping = median of the user's own label costs for that carrier and weight band from `Shipment`, fees table). Primary per row: "List on eBay" (prefill with images rehosted as HMAC-signed URLs). Source picker: My Trendyol products · Trendyol category bestsellers · Paste a Trendyol link.
- **Locked** for plans without `features.arbitrage`: the `From Trendyol` segment carries a `PlanTag` and selecting it renders the locked state (pro-gating.md §3) instead of the table. shopify_free: the segment is **not rendered**.
- The arbitrage scan job, `ArbitrageScanner`, `ArbitrageCategoryBrowser`, `ArbitrageProductDetail` stay on `/app/ebay-research?tab=arbitrage` until R4 parity, then are deleted (§14).

---

## 10. API (all under `pages/api/research/*`; auth via the existing session helper; every response `{ data, source: SourceNoteProps, errors?: { section, key }[] }`)

```ts
// lib/research/types.ts (shared, types only)
export type ResearchMkt = 'etsy'|'ebay'|'amazon'|'trendyol';
export type MetricKind = 'measured'|'estimate'|'signal'|'user';
export interface SourceNoteProps { source: string /* i18n key */; sourceParams?: Record<string,string|number>; fetchedAt: string; sample?: number; excluded?: { count: number; reasonKey: string }; kind: MetricKind }
export interface Guarded<T> { value: T|null; kind: MetricKind; guard: { ok: boolean; reasonKey?: string; reasonParams?: Record<string,string|number> } }
export interface Fact { key: string; params: Record<string,string|number> }      // EvidenceSummary facts, i18n-rendered on the client
export interface Evidence { facts: Fact[]; confidence: 'high'|'medium'|'low'; basis: Fact }
```

| Endpoint | Request | Response `data` | Backed by | Cache |
|---|---|---|---|---|
| `GET /api/research/products` | `q` (repeatable for compare ≤ 3), `mkt`, `country`, `taxonomyId?`, `sort?` | `{ query; evidence: Evidence; price: PriceSummary (lib/research/stats); competition: { total: Guarded<number>; top5Share: Guarded<number> }; demand: { tier: 1..5|null; inputs: {key; value; ok}[] }; newcomers: Guarded<number>; buyerWords: { tag; share }[]; top: TopListing[] }` | `search_market` logic moved into `lib/research/etsySearch.ts` (the clawd action keeps working for legacy callers and calls the same function), `get_public_shop` for ≤ 48 shops (shared cache), `trends/etsy` for Google interest, autocomplete | **shared** `ResearchCache` rows with `userId = '__public__'`, key `public:etsy:search:<sha1(q,country,taxonomy)>`, 24 h (no migration: `ResearchCache.userId` has no FK) |
| `POST /api/research/seeds` | `{ text, mkt }` | `{ seeds: string[] }` (English, ≤ 5) | `/api/ai/etsy` new action `translate_seeds` (1 credit) | per user 7 d |
| `GET /api/research/keywords` | `q` or `listing` + `shop`, `mkt`, `country`, `view`, filters, `cursor` | `{ rows: KeywordRow[]; current?: { tags; issues }; next?: string; progress?: { done; total } }` where `KeywordRow = { keyword; demand: {tier; inputs}; competition: Guarded<number>; top48: Guarded<number>; priceBand: Pick<PriceSummary,'p25'|'p75'|'currency'|'n'>; inMyShop: number; etsyVolume?: { value; enteredAt }; rank?: { now: number|null; delta7: number|null; best: number|null } }` | candidate pool = tag frequency (`search_market`) ∪ autocomplete ∪ AI expansion; per-candidate count via 1 Etsy call (shared cache 24 h); `RankTrackedKeyword/RankSnapshot` for Tracked | shared 24 h per keyword |
| `POST /api/research/keywords/note` | `{ keyword, etsySearches30d }` | `{ ok }` | `ResearchKeywordNote` (R2 migration) | — |
| `POST /api/research/keywords/track` / `DELETE` | `{ listingId, shopId, keywords[] }` | `{ tracked: n }` | wraps `add_tracked_keyword` / `remove_tracked_keyword` (existing actions; moved into `lib/research/rank.ts`, the clawd actions call it) | — |
| `GET /api/research/listings` | `shop`, `mkt`, `sort`, `issue`, `q`, `page`, `size` (50/100/250) | `{ rows: DoctorRow[]; total; statsSince: string }`, `DoctorRow = { listing: ListingRow (listings-grid §9.1 type); views30d: Guarded<number>; sales30d: Guarded<number>; conversion: Guarded<number>; mainKeyword?: { keyword; source: 'tracked'|'ai'; rank: number|null }; biggestIssue?: { checkId; params }; issues: number }` | `GET /api/listings` query helpers (listings-grid G1 `lib/listings/query.ts`, import) + `EtsyListingDailyStat` 30-day sums + `OrderItem.listingRef` (eBay) | none (DB only) |
| `GET /api/research/listings/[id]/peers` | `shop`, `keyword?` | `{ keyword; peers: { n; price: PriceSummary; titleLen: Guarded<number>; photos: Guarded<number>; videoShare: Guarded<number>; freeShippingShare: Guarded<number> }; checks: Check[] }` | `etsySearch` (shared cache) | shared 24 h |
| `POST /api/research/explain` | `{ tool, metrics: unknown }` (zod per tool) | `{ text; locale }` | `/api/ai/etsy` new action `explain_research` replacing `market_analysis`/`niche_report`/`shop_spy_report` | per input hash 24 h |
| `GET /api/research/watches` · `POST` · `PATCH /[id]` · `DELETE /[id]` | `{ type: 'etsyShop'\|'ebaySeller'\|'query'\|'asin'\|'trendyolProduct'; marketplace; refId; label; alertRules }` | rows + latest snapshot metrics + quota `{ used; limit }` | `ResearchWatch` + adapter over `EbayTrackedSeller`, `EbayTrackedProduct`, `AmazonTrackedProduct` (read-only adapter, no data move) | — |
| `POST /api/cron/research-snapshots` | cron auth + `runCronGuard` | — | daily: per distinct watched Etsy shop `GET /shops/{id}` + active listings pages; writes `ResearchSnapshot` (shared across users) | registered in `cron-daily.yml` next to `track-ranks` (backend session owns the workflow file; requested) |
| `GET /api/research/seasons` | `country?` | `{ events: { key; date; listBy; lastShip: { carrier; date; transitDays: Guarded<number> } }[] }` | `lib/research/seasons.ts` + `Shipment` medians | per user 24 h |
| `GET /api/research/home` | `mkt`, `shop?` | `{ needsWork: DoctorRow[3]; needsWorkTotal; recentWatched: { kind; label; href; change?: Fact; at }[] }` | composes the above | none |

Server rules: `decodeEntities` on every marketplace string; `robustStats`/`summarizePrices` for every price; all user-visible text as i18n keys + params (no Turkish or English strings in responses: RR §5 i18n rule); the Etsy global budget check (`EtsyApiUsage`/`EtsyApiQuota`, backend-owned, read-only) before any live call, falling back to cached-only with `errors: [{ section, key: 'research.error.budget' }]`.

---

## 11. Components and files

| Component | File | Notes |
|---|---|---|
| `ResearchLayout` | `components/domain/research/ResearchLayout.tsx` | Page + PageHeader + route Tabs + marketplace FilterButton + `usePageActions` |
| `ResearchHome` | `components/domain/research/home/{ResearchHome,NeedsWorkCard,SeasonsCard,RecentCard,QuestionChips}.tsx` | |
| `ProductFinder` | `components/domain/research/products/{ProductFinder,EvidenceCard,PriceCard,CompetitionCard,DemandCard,NewcomersCard,BuyerWordsCard,TopListingsTable,ComparePanel,SeedChips}.tsx` | |
| `KeywordExplorer` | `components/domain/research/keywords/{KeywordExplorer,keywordColumns,KeywordPanel,TrackedView,VolumePopover,AddTagsAction}.tsx` | `variant: 'page'|'panel'`, `onApply?` |
| `ListingDoctor` | `components/domain/research/listings/{ListingDoctor,doctorColumns,DoctorPanel,PeerChecks,StagedHere}.tsx` | |
| `ShopTracker` | `components/domain/research/shops/{ShopTracker,ShopPanel,WatchShopModal,AlertSwitches}.tsx` | R3 |
| `PriceGap` | `components/domain/research/products/PriceGapTable.tsx` | R4 |
| DS research primitives | `components/ds/research/{SourceNote,Metric,SignalDots,PriceBand,EvidenceSummary}.tsx` | M1 (DS §4.4); R1 builds them in `ds/` if M1 has not |
| Pure libs | `lib/research/{types,detectQuery,opportunity,seasons,peers,etsySearch,rank,listingPicker}.ts` | `stats.ts` exists (R0) |
| Hooks | `lib/research/hooks/{useResearchProducts,useKeywords,useDoctor,useWatches,useSeasons}.ts` | SWR, `keepPreviousData` |

No `useResearchHub` zustand store: URL state + SWR cover it. The four legacy stores are deleted with their pages.

---

## 12. Data model needs (owned by the backend session; UI only consumes)

| Change | Milestone | Notes |
|---|---|---|
| `ResearchKeywordNote { id, userId, keyword, etsySearches30d Int, enteredAt }` `@@unique([userId, keyword])` | R2 | RR §4.3 |
| `ResearchWatch` and `ResearchSnapshot` as RR §4.3 | R3 | `ResearchSnapshot` is shared across users (one fetch per shop per day) |
| `PLANS.*.limits.researchWatches` | R3 | tiers-plan file `lib/billing/plans.ts` (billing track); entitlement adds `limits.researchWatches` (not a meter) |
| Notification types `researchShopNewListings`, `researchShopPriceDrop`, `researchShopSalesSpike`, `researchRankDrop` + templates | R3 | backend W5 registry |
| `cron-daily.yml` step for `/api/cron/research-snapshots` | R3 | |
| **No** migration for the shared cache | R1 | `ResearchCache.userId = '__public__'` |

---

## 13. i18n (namespace `research`; EN + TR; sentence case; glossary wording; keys returned to the integrator, never written by a group)

| Key | EN | TR |
|---|---|---|
| `research.title` | Research | Pazar araştırması |
| `research.subtitle` | Find what to sell, how to price it, and which words buyers use | Ne satacağınızı, fiyatını ve alıcıların kullandığı kelimeleri bulun |
| `research.tabs.home` / `.products` / `.keywords` / `.listings` / `.shops` | Home / Product finder / Keyword explorer / Listing doctor / Shop tracker | Başlangıç / Ürün bulucu / Anahtar kelime gezgini / İlan doktoru / Mağaza takibi |
| `research.mkt.label` | Marketplace | Pazaryeri |
| `research.mkt.amazonIneligible` | Amazon research needs an eligible Amazon Associates account | Amazon araştırması için uygun bir Amazon Associates hesabı gerekir |
| `research.search.placeholder` | Idea, keyword, Etsy listing link, shop URL or Trendyol link… | Fikir, anahtar kelime, Etsy ilan linki, mağaza adresi veya Trendyol linki… |
| `research.search.cta` | Research | Araştır |
| `research.search.loading` | Researching… | Araştırılıyor… |
| `research.q.niche` / `.price` / `.tags` / `.notSelling` / `.competitors` | Is this niche worth it? / What price should I charge? / Which tags? / Why is my listing not selling? / What are my competitors doing? | Bu niş değer mi? / Hangi fiyatı koymalıyım? / Hangi etiketler? / İlanım neden satmıyor? / Rakiplerim ne yapıyor? |
| `research.home.needsWork` | Your listings that need work | Geliştirilmesi gereken ilanlarınız |
| `research.home.needsWorkMore` | {count} listings under 50 · Open Listing doctor | 50 puanın altında {count} ilan · İlan doktorunu aç |
| `research.home.issues` | {count, plural, one {# issue} other {# issues}} | {count} sorun |
| `research.home.fix` | Fix | Düzelt |
| `research.home.seasons` | Upcoming seasons (shipping from Türkiye) | Yaklaşan sezonlar (Türkiye'den gönderim) |
| `research.home.listBy` | List by {date} · in {days, plural, one {# day} other {# days}} | {date} tarihine kadar listeleyin · {days} gün kaldı |
| `research.home.lastShip` | Last {carrier} from İstanbul {date} | İstanbul'dan son {carrier} gönderimi {date} |
| `research.home.productionDays` | Your production days: {days} · Edit | Üretim süreniz: {days} gün · Düzenle |
| `research.home.recent` | Recent and watched | Son aramalar ve takip edilenler |
| `research.translate.cta` | Translate to English keywords · 1 credit | İngilizce anahtar kelimelere çevir · 1 kredi |
| `research.translate.from` | from "{text}" | "{text}" ifadesinden |
| `research.source.etsySearch` | Etsy search · {used} of {sampled} listings used{excluded, plural, =0 {} other { · # excluded ({reason})}} · updated {ago} · {kind} | Etsy araması · {sampled} ilanın {used} tanesi kullanıldı{excluded, plural, =0 {} other { · # tanesi hariç ({reason})}} · {ago} güncellendi · {kind} |
| `research.kind.measured` / `.estimate` / `.signal` / `.user` | Measured / Estimate / Signal / You entered | Ölçülen / Tahmin / Sinyal / Sizin girdiğiniz |
| `research.guard.small` | Small sample: {n} listings | Küçük örnek: {n} ilan |
| `research.guard.insufficient` | Not enough data | Yeterli veri yok |
| `research.guard.implausible` | Check: unusual price range | Kontrol edin: olağan dışı fiyat aralığı |
| `research.guard.noFx` | no FX rate | döviz kuru yok |
| `research.guard.notEnoughSignal` | Not enough signal | Yeterli sinyal yok |
| `research.evidence.title` | Evidence | Kanıtlar |
| `research.evidence.priceBand` | Most sell between {p25} and {p75} (median {median}) | Çoğu {p25} ile {p75} arasında satılıyor (medyan {median}) |
| `research.evidence.competing` | {count} competing listings | {count} rakip ilan |
| `research.evidence.newcomers` | {pct} of top shops opened less than 1 year ago | En iyi mağazaların {pct} kadarı 1 yıldan kısa süre önce açıldı |
| `research.evidence.demand` | Demand Signal {dots} ({inputs} of 3 inputs) | Talep sinyali {dots} (3 girdiden {inputs}) |
| `research.evidence.confidence` | Confidence: {level, select, high {high} medium {medium} other {low}} · {basis} | Güven: {level, select, high {yüksek} medium {orta} other {düşük}} · {basis} |
| `research.evidence.noVolume` | Etsy shares no search volume | Etsy arama hacmi paylaşmıyor |
| `research.explain.cta` | Explain · 1 credit | Açıkla · 1 kredi |
| `research.explain.failed` | The explanation didn't come out right | Açıklama düzgün oluşturulamadı |
| `research.card.price` / `.competition` / `.demand` / `.newcomers` / `.buyerWords` | Price / Competition / Demand Signal / Newcomers / Buyer words (tags used by top 48) | Fiyat / Rekabet / Talep sinyali / Yeni gelenler / Alıcı kelimeleri (ilk 48'in etiketleri) |
| `research.card.pctMedian` | p25 · median · p75 | p25 · medyan · p75 |
| `research.card.top5Share` | Top 5 shops hold {pct} of the top 48 | İlk 5 mağaza ilk 48'in {pct} kadarını tutuyor |
| `research.card.demandNote` | Demand Signal is indirect: Etsy doesn't share search volume. Check real volume in Etsy Marketplace Insights | Talep sinyali dolaylıdır: Etsy arama hacmini paylaşmaz. Gerçek hacmi Etsy Marketplace Insights'ta kontrol edin |
| `research.action.draftListing` | Draft a listing | İlan taslağı oluştur |
| `research.action.usePrice` | Use {price} in a listing | {price} fiyatını bir ilanda kullan |
| `research.action.addTags` | Add {count, plural, one {# tag} other {# tags}} to… | {count} etiketi şuna ekle… |
| `research.action.addTagsThis` | Add {count, plural, one {# tag} other {# tags}} to this listing | {count} etiketi bu ilana ekle |
| `research.action.addToTitle` | Add to title | Başlığa ekle |
| `research.action.track` | Track | Takip et |
| `research.action.watch` | Watch | İzle |
| `research.action.watchShop` | Watch a shop | Mağaza izle |
| `research.action.compare` | Compare | Karşılaştır |
| `research.action.stageFixes` | Stage {count, plural, one {# fix} other {# fixes}} | {count} düzeltmeyi hazırla |
| `research.action.openBulkGrid` | Open in bulk editor | Toplu düzenleyicide aç |
| `research.action.openPhotoStudio` | Open photo studio | Fotoğraf stüdyosunu aç |
| `research.toast.tagsAdded` | {count} tags added to "{title}" · Not sent yet | {count} etiket "{title}" ilanına eklendi · Henüz gönderilmedi |
| `research.toast.fixesStaged` | {count} fixes staged for "{title}" · Not sent yet | "{title}" için {count} düzeltme hazırlandı · Henüz gönderilmedi |
| `research.tags.overLimit` | Only {fit} of {count} fit (13-tag limit). Replace weaker tags? | {count} etiketten yalnızca {fit} tanesi sığıyor (13 etiket sınırı). Zayıf etiketler değiştirilsin mi? |
| `research.tags.replaceCta` | Replace {count} tags | {count} etiketi değiştir |
| `research.kw.col.keyword` / `.demand` / `.competition` / `.top48` / `.priceBand` / `.inMyShop` / `.etsyVolume` / `.rank` | Keyword / Demand / Competition / Top-48 use / Price band / In my shop / Etsy volume / Rank | Anahtar kelime / Talep / Rekabet / İlk 48'de kullanım / Fiyat aralığı / Mağazamda / Etsy hacmi / Sıra |
| `research.kw.top48Value` | {count} of 48 | 48'de {count} |
| `research.kw.view.suggested` / `.longtail` / `.seasonal` / `.mine` / `.tracked` | Suggested / Long-tail / Seasonal / Used in my shop / Tracked | Önerilen / Uzun kuyruk / Sezonluk / Mağazamda kullanılan / Takip edilen |
| `research.kw.current` | Current tags {count} / 13 · {overlap} repeat title words · {long} over 20 characters | Mevcut etiketler {count} / 13 · {overlap} tanesi başlık kelimelerini tekrar ediyor · {long} tanesi 20 karakteri aşıyor |
| `research.kw.volumeAdd` | add | ekle |
| `research.kw.volumePrompt` | Searches in the last 30 days (from Etsy) | Son 30 gündeki aramalar (Etsy'den) |
| `research.kw.trustEtsy` | Our signal differs from Etsy's number: trust Etsy's | Sinyalimiz Etsy'nin sayısından farklı: Etsy'ninkine güvenin |
| `research.kw.rankNote` | Position in Etsy API search (not personalized, ads excluded) | Etsy API aramasındaki sıra (kişiselleştirilmemiş, reklamlar hariç) |
| `research.kw.notInTop500` | Not in top 500 | İlk 500'de değil |
| `research.kw.building` | Checking {done} of {total} keywords… | {total} anahtar kelimeden {done} tanesi kontrol ediliyor… |
| `research.kw.seeExperiment` | See SEO experiment | SEO deneyini gör |
| `research.doc.col.views30` / `.sales30` / `.conversion` / `.mainKw` / `.health` / `.biggestIssue` | Views 30d / Sales 30d / Conversion / Main keyword rank / Health / Biggest issue | 30 günlük görüntülenme / 30 günlük satış / Dönüşüm / Ana kelime sırası / Sağlık / En büyük sorun |
| `research.doc.sort.opportunity` / `.health` / `.views` / `.sales` | Biggest opportunity / Lowest health / Most views / Most sales | En büyük fırsat / En düşük sağlık / En çok görüntülenen / En çok satan |
| `research.doc.statsSource` | Views and sales: Etsy daily stats + your orders · last 30 days · updated {time} | Görüntülenme ve satış: Etsy günlük istatistikleri + siparişleriniz · son 30 gün · {time} güncellendi |
| `research.doc.collecting` | Collecting daily stats since {date} | {date} tarihinden beri günlük istatistik toplanıyor |
| `research.doc.comparedWith` | compared with {n} listings for "{keyword}" | "{keyword}" için {n} ilanla karşılaştırıldı |
| `research.doc.peers` | Compared with peers | Rakiplerle karşılaştırma |
| `research.doc.check.priceVsPeers` | Price {price}, peers median {median} (p75 {p75}) | Fiyat {price}, rakip medyanı {median} (p75 {p75}) |
| `research.doc.check.titleVsPeers` | Title {len} characters, peers median {median} | Başlık {len} karakter, rakip medyanı {median} |
| `research.doc.check.photosVsPeers` | {count} photos, peers median {median} | {count} fotoğraf, rakip medyanı {median} |
| `research.doc.stagedHere` | Staged here ({count}) | Burada hazırlanan ({count}) |
| `research.doc.mainKwSuggested` | Main keyword (suggested) | Ana anahtar kelime (önerilen) |
| `research.doc.doneEmpty` | Nothing urgent: every listing scores 75 or more | Acil bir şey yok: her ilan 75 veya üzeri puanda |
| `research.shops.quota` | Watching {used} of {limit} shops on your plan | Planınızda {limit} mağazadan {used} tanesini izliyorsunuz |
| `research.shops.quotaFull` | You're watching {limit} of {limit} shops. Remove one to add another | {limit} mağazanın tamamını izliyorsunuz. Yenisini eklemek için birini kaldırın |
| `research.shops.col.salesDay` / `.vsPrev` / `.active` / `.new7` / `.priceDelta` | Sales / day / vs previous 7 days / Active / New in 7 days / Price change (median) | Satış / gün / önceki 7 güne göre / Aktif / 7 günde yeni / Fiyat değişimi (medyan) |
| `research.shops.firstReading` | First reading taken today. Daily sales appear tomorrow. | İlk ölçüm bugün alındı. Günlük satışlar yarın görünür. |
| `research.shops.linkLabel` | Shop link or name | Mağaza linki veya adı |
| `research.shops.alert.newListings` / `.priceDrop` / `.salesSpike` | New listings / Price drop over 10% / Sales spike over 2× | Yeni ilanlar / %10'dan fazla fiyat düşüşü / 2 katı aşan satış artışı |
| `research.empty.products` | Search an idea to see prices, competition and buyer words | Fiyatları, rekabeti ve alıcı kelimelerini görmek için bir fikir arayın |
| `research.empty.noResults` | No {marketplace} listings match "{q}" | "{q}" ile eşleşen {marketplace} ilanı yok |
| `research.empty.broader` | Try a broader phrase | Daha genel bir ifade deneyin |
| `research.empty.keywords` | Type a keyword or pick one of your listings | Bir anahtar kelime yazın veya ilanlarınızdan birini seçin |
| `research.empty.tracked` | Track a keyword to see your listing's position every day | İlanınızın sırasını her gün görmek için bir anahtar kelimeyi takip edin |
| `research.empty.shops` | Watch a competitor to see their daily sales, new listings and price changes | Günlük satışlarını, yeni ilanlarını ve fiyat değişimlerini görmek için bir rakibi izleyin |
| `research.error.budget` | Showing cached results: Etsy's daily limit is close | Önbellekteki sonuçlar gösteriliyor: Etsy'nin günlük sınırına yaklaşıldı |
| `research.error.etsy` | Etsy didn't respond | Etsy yanıt vermedi |
| `research.error.ebay` | Couldn't reach eBay | eBay'e ulaşılamadı |
| `research.source.trendyol` | From Trendyol | Trendyol'dan |
| `research.source.search` | Search | Arama |
| `research.gap.col.product` / `.trPrice` / `.ebayMedian` / `.etsyMedian` / `.confidence` / `.landed` / `.margin` | Product (TR) / TR price / eBay US median / Etsy median / Match confidence / Landed cost / Margin | Ürün (TR) / TR fiyatı / eBay ABD medyanı / Etsy medyanı / Eşleşme güveni / Toplam maliyet / Kâr marjı |
| `research.gap.listOnEbay` | List on eBay | eBay'de listele |
| `research.gap.lowConfidence` | Show {count} low-confidence matches | Düşük güvenli {count} eşleşmeyi göster |

Season names (`research.season.<key>`) and question-chip hints are added in the R1 PR with the event table; they are data keys, one per event (Christmas, Valentine's Day, Mother's Day US/UK/DE, Father's Day, Halloween, Black Friday, Diwali, Ramadan, Eid al-Adha, Back to school, Graduation).

---

## 14. What to delete and when

### 14.1 R0 additions (CRITIQUE V1/V6; JSX deletions only, week 1)
`pages/app/etsy-research.tsx`: the gradient hero block and the `AiOptimizePanel` FAB mount. `pages/app/ebay-research.tsx`: the second search bar, the second marketplace `Select`, the empty grey button; the "Loading your eBay listings…" banner gets `useAsyncState`-style 15 s "Still loading… Retry" (a local timer if the DS hook is not merged). Turkish tip strings move to i18n.

### 14.2 After parity (each behind its redirect, one release after the tool's flag is default-on)
Exactly RR §5 "Delete", plus `components/amazon/research/AiInsightsPanel.tsx` (AI is a verb), `components/ebay/research/CompetitiveIntelligence.tsx` (2 dialogs), and the four `lib/stores/use*ResearchStore.ts`. The arbitrage components go after R4. `components/etsy/research/shared/{listingPrefill,exportUtils}.ts` stay (prefill unified, exports reused by "Export results").

---

## 15. Implementation split (disjoint files; see BUILD_PLAN.md for cross-milestone ownership)

| Group | Owns | Delivers | Depends on |
|---|---|---|---|
| **R1-A Contracts + server** | `lib/research/{types,detectQuery,opportunity,seasons,peers,etsySearch}.ts`, `pages/api/research/{products,seeds,home,seasons,explain}.ts`, `pages/api/research/listings/index.ts`, `pages/api/research/listings/[id]/peers.ts`, `__tests__/research/*.test.ts` | §10 R1 endpoints with fixtures (mixed currency, n < 5, entity titles, budget fallback) | R0 `stats.ts`; listings-grid G1 `lib/listings/query.ts` (import) |
| **R1-B `search_market` delegation** | the `search_market`, `analyze_niche`, `get_discovery_data` blocks in `pages/api/clawd/etsy.ts` only (call `lib/research/etsySearch.ts`, drop `avg` from new fields) | legacy callers keep working | R1-A; **one owner of `clawd/etsy.ts` at a time** (BUILD_PLAN §3) |
| **R1-C Shell + Home + Product finder UI** | `pages/app/research/{index,products}.tsx`, `components/domain/research/{ResearchLayout}.tsx`, `components/domain/research/home/*`, `components/domain/research/products/*` (not `PriceGapTable`), `lib/research/hooks/{useResearchProducts,useSeasons}.ts` | §2, §4, §5 desktop + mobile, all states | M1 DS; R1-A types |
| **R1-D Listing doctor UI** | `pages/app/research/listings.tsx`, `components/domain/research/listings/*`, `lib/research/hooks/useDoctor.ts` | §7 | R1-A; M1 `ScorePanel`; listings-grid G3 `lib/listingScore/*` |
| **R1-E Redirects** | the four legacy route files (`getServerSideProps` redirects only, flag-aware) | §2.3 | R1-C, R1-D merged |
| **R2-A Keywords server** | `pages/api/research/keywords/{index,note,track}.ts`, `lib/research/rank.ts`, and the rank action blocks in `pages/api/clawd/etsy.ts` (delegation only) | §10 keyword endpoints | backend migration `ResearchKeywordNote` |
| **R2-B Keyword explorer UI** | `pages/app/research/keywords.tsx`, `components/domain/research/keywords/*`, `lib/research/hooks/useKeywords.ts` | §6 both variants | R2-A |
| **R3-A Watches server** | `pages/api/research/watches/{index,[id]}.ts`, `pages/api/cron/research-snapshots.ts`, `lib/research/watchAdapter.ts` | §8 data | backend migration `ResearchWatch`/`ResearchSnapshot`, notification types |
| **R3-B Shop tracker UI** | `pages/app/research/shops.tsx`, `components/domain/research/shops/*`, `lib/research/hooks/useWatches.ts` | §8 | R3-A |
| **R4 Price gap** | `components/domain/research/products/PriceGapTable.tsx`, `pages/api/research/price-gap.ts`, the arbitrage deletes | §9 | pro-gating `FeatureGate` (G-pro-2, M4) |

Every group: no edits to `messages/*.json` (return keys), no edits to backend-owned paths (BUILD_PLAN §1), `npx next build --webpack` + `npm run test` before finishing.

## 16. Definition of done (on top of DS §8)
- [ ] `grep -rn "avg\b" components/domain/research pages/api/research` returns nothing; every price on screen came through `summarizePrices`.
- [ ] Every card and table has a `SourceNote`; every number has a `kind`.
- [ ] The "halloween decor" fixture (mixed JPY/INR/USD, a $9,999 placeholder) shows a median under $200 and an "excluded" count.
- [ ] Each tool ends in one primary that stages a draft or writes a prefill; nothing writes to a marketplace (verified by spying `fetch` in tests: no `/api/clawd/etsy` POST mutation and no `etsy-drafts/*/sync`).
- [ ] Old routes redirect with the mapped `?tab=`; the sidebar Research item is active on all of them.
- [ ] At 390 nothing scrolls horizontally except the tab chips and question chips.
- [ ] A forced Etsy budget breach renders cached results with the budget banner, not an error page.

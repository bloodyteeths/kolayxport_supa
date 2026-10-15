# Research redesign: from 27 tabs to 6 jobs

Status: proposal (design only, no app code changed). Date: 2026-10-15.
Inputs: production visual audit (2026-10-14), the code in this repo (`pages/app/*research*`, `components/{etsy,ebay,trendyol,amazon}/research/*`, `lib/stores/*Research*`, `pages/api/clawd/{etsy,ebay,ebay-research,ebay-ai,amazon-research,arbitrage}.ts`, `pages/api/trends/*`, `pages/api/trendyol/research.ts`, `pages/api/ai/*`, `pages/api/cron/track-ranks.ts`), and public material on eRank, Marmalead, EverBee, Alura, Sale Samurai, Vela, Terapeak, ZIK Analytics, Helium 10 and Jungle Scout.

Founder verdict: "research tools are from the stone age, not useful any of it." After reading the code, the verdict holds. The main problem is not how the pages look. The tools answer questions nobody asked, with numbers we cannot back up, and almost none of them lead to an action. A reskin will not fix that. The fix is fewer tools, honest numbers, and a one-click action at the end of every result.

---

## 0. What we actually have: a data inventory

Every claim on a research screen must come from one of these sources. Anything else is decoration.

| Source | What it really gives us | What it does NOT give us | Where it is in code |
|---|---|---|---|
| **Etsy Open API v3, public** (x-api-key `KEY:SECRET`, 150 QPS / 100K QPD across the whole app) | `GET /listings/active`: keyword search, `sort_on=score/price/created/updated`, price and taxonomy filters, 100 per page. Per listing: `views` (lifetime), `num_favorers` (lifetime), `tags`, `price{amount,divisor,currency_code}`, `original_creation_timestamp`, `created_timestamp` (this is the last renew date, not the creation date), `shop_id`, `taxonomy_id`. `GET /shops/{id}`: **`transaction_sold_count`** (the real lifetime shop sales counter), `review_count`, `review_average`, `listing_active_count`, `create_date`. Shop reviews. Taxonomy tree. | No search volume. No per-listing sales. No ads or "bestseller" badges. No personalized ranking, so API search order is not what a buyer sees. No batch shops endpoint, so N shops cost N calls. | `pages/api/clawd/etsy.ts` (`search_market`, `get_public_shop`, `batch_shops`, `analyze_niche`, `estimate_sales_velocity`, `get_discovery_data`, `check_keyword_rank`) |
| **Etsy OAuth (the user's own shop)** | Their listings (EtsyListing DB cache), receipts and transactions (real sales per listing), the staged-draft pipeline (`EtsyListingDraft`) | Etsy Stats (visits, conversion, search terms) are not in the API | `lib/etsy/draftService.ts`, order sync, `/api/clawd/etsy?action=listings_with_images` |
| **Etsy Marketplace Insights** (Shop Manager > Stats; 15 searches per week free, unlimited on Etsy Plus) | Real Etsy 30-day search counts and a competition level | No API. The seller can only read it themselves | none. We can deep-link to it and let the user type the number in (see Job 2) |
| **eBay Browse API** | `item_summary/search` (active listings, aspect refinements, `filter=sellers:{}`), `getItem` → `estimatedSoldQuantity` (lifetime sold count on a multi-quantity fixed-price listing) | No sold-item history. Marketplace Insights is a limited-release API we do not have. No Terapeak (that lives inside Seller Hub only). `estimatedSoldQuantity` has no time window | `pages/api/clawd/ebay.ts`, `pages/api/clawd/ebay-research.ts` |
| **Amazon Creators API** (PA-API successor) | `SearchItems` with `BrowseNodeInfo.SalesRank` (BSR), price, offers. Our BSR→sales estimator and our fee calculator | Needs Associates eligibility. BSR→sales is a model, not a measurement | `pages/api/clawd/amazon-research.ts`, `lib/amazon/salesEstimator.ts`, `lib/amazon/feeCalculator.ts` |
| **Trendyol public pages** | Scraped HTML PROPS: price, rating, review count, `socialProof` (for example "X people bought"), merchant, badges, category bestseller lists. Our `TrendyolProductIndex` | Scraping is fragile: there is no contract and the markup changes | `pages/api/trendyol/research.ts`, arbitrage indexes |
| **Arbitrage indexes** | `EbayProductIndex`, `TrendyolProductIndex`, `ArbitrageMatch` (AI offline matching), FX (`exchange_rate`) | Matches can be wrong, so every match needs a confidence score | `pages/api/clawd/arbitrage.ts` |
| **Google** | Autocomplete (`suggestqueries`), Google Trends relative interest (`google-trends-api`, unofficial and flaky) | Interest is relative (0-100), not absolute volume. Google is not Etsy | `pages/api/trends/etsy.ts`, `pages/api/trends/amazon.ts` |
| **Amazon autocomplete** | Suggestions and "alphabet soup" expansion | No volume | `pages/api/trends/amazon.ts` |
| **Our own cross-marketplace orders** | Real units, revenue and margin per SKU across Etsy, eBay, Amazon, Shopify, Wix, Trendyol and Hepsiburada. Shipping cost per label | Only covers the user's own shop | `Order`, `OrderItem`, `Shipment`, finance sync |
| **Rank cron** | Daily API search position for tracked keyword+listing pairs (`RankTrackedKeyword`, `RankSnapshot`, `/api/cron/track-ranks`, run by `.github/workflows/cron-daily.yml`) | Non-personalized, ads excluded, top 500 only | already built and running |
| **Gemini 2.5 Flash** | Writing, clustering, translation (TR→EN seeds), explanations of numbers we already computed | AI must never produce a number of its own | `pages/api/ai/etsy.ts`, `pages/api/clawd/ebay-ai.ts`, `pages/api/ai/amazon.ts` |

Our two real moats, which none of the competitors have together:
1. **We see the user's own sales on every marketplace.** eRank, EverBee and Alura only see Etsy, and only public data.
2. **We can act.** The staged draft system, the listing creators (via the `kx:listingPrefill` contract), cross-listing, and shipping costs from real labels. Vela can act but has no research. eRank and EverBee can research but cannot act.

---

## 1. Honest assessment of the current tools

There are 27 sub-tools across 4 pages, with 4 different navigation patterns: pill tabs (Etsy, Amazon), a 14-item internal tab list (eBay, 3306-line page), a 7-item gradient side rail (Trendyol), and a floating purple AI FAB (Etsy). Each page uses its own brand gradient.

### 1.1 Problems that run across all of them (verified in code)

1. **"Trending Niches" is not trending.** `get_discovery_data` (`pages/api/clawd/etsy.ts:894`) runs a **hardcoded list of three queries per calendar month** (October: `'halloween decor', 'fall wedding', 'harvest centerpiece'`) and labels them "trending". Nothing is measured.
2. **The "$5218.94 avg" bug.** The same function takes an **arithmetic mean** of `price.amount/divisor` over 48 listings. It **ignores `currency_code`**: Etsy returns prices in the seller's currency (JPY, INR, IDR, TRY...). It does not trim outliers ($9,999 placeholder listings, wholesale lots). The UI then hard-prefixes `$` (`UnifiedResearch.tsx:208`, `:290`). One ¥150,000 listing turns the "average" into nonsense. `analyze_niche` and `search_market` have the same mean-over-mixed-currency problem.
3. **A fake "Demand Score".** `analyze_niche` (`etsy.ts:~565`) labels **total result count / 5000** as "Search volume". That is supply, not demand. It then estimates sales as `favorites / ageMonths × 3%`, where `ageMonths` comes from `created_timestamp`, which resets on every renewal. It adds a "price room" term on top. The 0-100 composite looks precise and means nothing.
4. **Sales velocity is invented twice.** `estimate_sales_velocity` uses the same 3% favorites rule. Meanwhile the one real sales counter Etsy exposes, `shop.transaction_sold_count`, is fetched (`batch_shops`) but **never snapshotted**. Day-over-day deltas of it would be measured shop sales.
5. **eBay "demand" uses lifetime sold quantity with no time window** (`ebay-research.ts:~500`). An item that sold 400 units over 6 years looks "hot".
6. **AI is a separate destination**: the FAB, the eBay `ai_hub` tab, and the Trendyol "AI Report" tab. AI should be a verb inside each result ("Write title from this", "Explain this"), not a page.
7. **Results lead nowhere.** Only a few places call `writeListingPrefill`. There is no "watch", no alert, and no "apply to my listing".
8. **Three different score styles, raw HTML entities, Turkish tips inside the English UI, a stuck "Loading your eBay listings..." banner, and empty tables with no empty state** (see the visual audit).

### 1.2 Tool by tool

| Page / tool | Verdict | Why |
|---|---|---|
| **Etsy: Discovery / Trending Niches** (`get_discovery_data`) | **KILL** | Hardcoded queries presented as trends. Broken averages. Replace it with the Seasonal calendar plus the user's own watchlist on Research Home. |
| **Etsy: Demand Score** (`analyze_niche.demandScore`) | **KILL** | Supply mislabelled as volume, plus a made-up conversion rate. Replace it with Signal tiers (§6). |
| **Etsy: UnifiedResearch** (search + price histogram + tag frequency + shops) | **MERGE → Job 1 Validate** | Tag frequency among top results and the shop list are real and useful. The price histogram is fine once it uses the median and normalizes currency. |
| **Etsy: ListingGrader** (URL grader + AI audit) | **MERGE → Job 3 Listing Doctor** | Grading someone else's listing is a curiosity. Grading *my* listings against the keyword peers they compete with, and staging the fix, is the product. |
| **Etsy: CompetitorIntelligence** (shop deep dive, reviews, AI spy report) | **MERGE → Job 4 Competitor Watch** | A one-off deep dive is forgotten the next day. It is worth something only once it is *tracked* (daily snapshots). |
| **Etsy: AiOptimizePanel** (floating FAB) | **KILL (as a surface)** | The actions move inline. The FAB also covers content on mobile. |
| **Etsy: rank tracking** (`RankTrackedKeyword` + cron) | **KEEP → Job 5** | The only longitudinal measured data we have. It is hidden today. |
| **eBay: product_database / niche_finder / marketplace_comparison / niche_comparison** | **MERGE → Job 1** | Four versions of "search a term, see listings + stats". One Validate screen with marketplace columns and "compare up to 3 ideas" replaces them. |
| **eBay: keyword_intelligence / seo_analyzer** | **MERGE → Job 2 Keywords** | Same job, two tabs. |
| **eBay: listing_optimizer / ai_hub** | **MERGE → Job 3** / **KILL ai_hub** | Optimizing belongs to the user's listings. AI is a verb, not a hub. |
| **eBay: product_tracker / seller_tracker / competitive_intelligence** | **MERGE → Job 4** | Keep the `EbayTrackedProduct`/`EbayTrackedSeller`/`EbayPriceSnapshot` tables and one watchlist UI. |
| **eBay: category_explorer** | **KILL** | A browse tree with no signal. Category becomes a filter chip in Validate. |
| **eBay: financial (FinancialIntelligence, 1687 lines)** | **KILL from Research** | Fee and profit math becomes a shared inline `MarginBox` (§3, Job 1/6). P&L already lives in Financials. |
| **eBay: arbitrage (ArbitrageScanner + indexes)** | **KEEP → Job 6 Price Gap** | The best data asset in Research: precomputed indexes, AI matching, FX. It needs a match-confidence display and a "list it" action. |
| **Trendyol: Dashboard** | **KILL** | A tile grid that links to the other tabs. |
| **Trendyol: CategoryExplorer** (bestseller scraping) | **KEEP as a data feed** | Feeds Job 6 ("Trendyol bestsellers → priced abroad"). It is not a screen of its own. |
| **Trendyol: Price / Seller / Brand analyzers** | **MERGE** (price → Job 1 TR column, seller/brand → Job 4) | |
| **Trendyol: ProfitCalculator** | **MERGE → shared MarginBox** | |
| **Trendyol: AI Report** | **KILL (as a tab)** | Becomes the "Explain" action on any result. |
| **Amazon: UnifiedResearch / Keywords / Competitors** | **MERGE** → Job 1 Amazon column, Job 2 (Amazon autocomplete), Job 4 (ASIN watch) | Show these only when Creators API eligibility is confirmed. Otherwise show a connect state, not an error. |

Net: **27 tools → 6 jobs in 1 hub.** Roughly 15k lines of research UI get deleted (§5).

---

## 2. What sellers actually pay for (market scan)

| Tool | Job it really does | Data it shows | What it gets wrong |
|---|---|---|---|
| **eRank** ($0-$10/mo) | Keyword and tag research, listing audit, rank check | Monthly searches/clicks/CTR from a **third-party opt-in panel** (labelled as estimates), competition, a 15-month trend across Etsy/Google/Amazon/eBay | Raw lists with no link to what top sellers use. Dated UI. Shows numbers with precision they do not have |
| **Marmalead** ($19/mo) | Keyword brainstorming, seasonality | Engagement, competition, "% of top sellers using this keyword", forecasts | Etsy only. No product-validation view |
| **EverBee** ($30/mo) | "Is this product worth making?" via a Chrome overlay | Estimated monthly sales and revenue per listing, modelled from reviews, favorites, views and age. The company claims ~80% accuracy | Users report 200-400% misses on small or new listings. Trustpilot 3.2 ("$30/mo for guesswork"). Billing complaints |
| **Alura** | Product seeker, shop analyzer, keyword finder, plus email marketing | Similar estimates. A modern UI and a Chrome extension | Same estimate problem. Spread thin |
| **Sale Samurai** ($0-$20/mo) | Tag generation, bulk tag analysis across listings, competitor keyword view | Etsy search volume estimates, CTR, competition | No revenue estimates in search (honest, but less "exciting") |
| **Etsy Marketplace Insights** (free, 15/wk) | Real search counts | Real 30-day searches, competition, top listings | No API and rate-limited. Sellers already distrust third-party volume once they compare it to this |
| **Vela** ($20-$30/mo) | Bulk edit and cross-list Etsy/Shopify/eBay/Faire; Profiles; AI photos | Listing data only | **No research at all.** This is our opening: research that ends in a Vela-grade bulk edit |
| **Terapeak** (free in Seller Hub) | eBay sold comps | Sold prices and sell-through over 1-3 years | Outdated UX. Locked inside Seller Hub |
| **ZIK Analytics** ($39/mo) | eBay product and competitor research, dropshipping | 7/14/30-day sales, seller tracking, category saturation | Aimed at dropshippers. Accuracy concerns |
| **Helium 10 / Jungle Scout** | Amazon product finder (Black Box / Opportunity Finder), reverse ASIN keywords (Cerebro), tracking | BSR→sales models, keyword volumes from Amazon data | Expensive. Amazon only |

**Pattern.** Sellers pay for four things: (a) "**is this idea worth it**", (b) "**which words do I use**", (c) "**what are my competitors doing**", (d) "**is my listing healthy / did my change work**". They churn on (1) estimates that are obviously wrong and (2) tools that end in a spreadsheet instead of a change. None of these products combines research with the user's real sales on all marketplaces and a one-click edit. That combination is the position we take.

**Positioning line:** *"Research that ends in a listing."* Every result has a primary action: Create, Apply, Watch, or Alert.

---

## 3. The six jobs (for Turkish sellers going global, plus Etsy/eBay sellers)

Shared rules for all six:
- **Input language.** Turkish or English. AI translates Turkish seeds into English marketplace keywords. Keywords, titles and tags stay in English; only the commentary is localized (founder rule).
- **Currency.** Marketplace numbers are shown in the marketplace currency (USD for Etsy/eBay US), with a TRY toggle via FX. Never mix currencies.
- **Every number carries a provenance tag**: `Measured` / `Estimate` / `Signal` (§6), plus its source, sample size (n) and fetch time.
- **Every result ends in one primary action.** Secondary actions sit in a `⋯` menu.
- **Action contracts used:**
  - `writeListingPrefill({target, source, title, tags, keywords, price, currency, imageUrls, categoryHint, research})` → `/app/etsy-listings?prefill=session` or `/app/ebay-listings?prefill=session` (existing contract, `components/ebay/research/listingPrefill.ts`). Extend `ListingPrefillSource` with `'research-hub'`.
  - **Apply to my listing** → creates or updates an `EtsyListingDraft` (`fieldPatch.tags`, `fieldPatch.title`) through `lib/etsy/draftClient.ts`. It never writes to Etsy directly; the user still presses "Sync to Etsy". The eBay equivalent uses `ebay-drafts`.
  - **Watch** → a new `ResearchWatch` row (§4.3), with daily snapshots and alerts through the existing `Notification` model.

### Job 1: Validate an idea ("Fikir doğrula: Is this worth making/listing?")

**Who:** a Turkish workshop deciding what to make for the US, or an Etsy/eBay seller choosing the next product.

**Flow:**
1. Type an idea (TR or EN): "ahşap anı kutusu" → AI proposes 3-5 English seed phrases ("wooden keepsake box", "personalized memory box", ...). The user picks one or more.
2. Pick marketplaces (chips: Etsy ✓, eBay ✓, Amazon (if eligible), Trendyol (sourcing view)).
3. One screen with one column per marketplace and the same rows in each.
4. Act: **Create listing** (prefill), **Watch this idea**, **Compare** (add up to 3 ideas side by side).

```
┌ Research ▸ Validate ───────────────────────────────────────────────────────┐
│ [ wooden keepsake box                          ] [Etsy✓][eBay✓][Amazon][TR] │
│  AI seeds: personalized memory box · engraved wood box · baby keepsake box │
├────────────────────────────────────────────────────────────────────────────┤
│ VERDICT  Promising · crowded at the top, room for new shops                 │
│ "Top 48 on Etsy are 31% shops under 1 year old; median price $42 vs your   │
│  cost $11 + FedEx $14 → est. margin 38%." (AI explains computed numbers)   │
├──────────────────────┬─────────────────────┬───────────────────────────────┤
│                      │ Etsy (US)           │ eBay (US)                     │
│ Supply   Measured    │ 18,420 listings     │ 2,310 active                  │
│ Demand   Signal      │ ●●●○○ Medium        │ ●●○○○ Low-Med                 │
│   why?  ▸            │ Google interest 54, │ 37 of top 50 have sold ≥1     │
│                      │ in 4 autocompletes  │ (lifetime, see note)          │
│ Price    Measured    │ $42 median          │ $29 median                    │
│                      │ $28–$61 (P25–P75)   │ $19–$44                       │
│                      │ n=287 USD of 300    │ n=50                          │
│ Top-48 shop sales/day│ 6.1 median Measured │ —                             │
│ Newcomer share       │ 31% shops < 1 yr    │ 22% sellers < 100 fb          │
│ Concentration        │ Top 5 shops: 28%    │ Top 5 sellers: 41%            │
│ Etsy Insights volume │ [ add from Etsy ↗ ] │                               │
├──────────────────────┴─────────────────────┴───────────────────────────────┤
│ Top listings (Etsy)  ▢img  Title…  $45  ♥ 1.2k  shop: 14/day  [Watch shop] │
│ Most-used tags in top 48:  keepsake box 62% · memory box 48% · …           │
├────────────────────────────────────────────────────────────────────────────┤
│ MarginBox  cost [11] ship from TR [FedEx ▾ $14.2 avg of your labels]       │
│            fees Etsy 6.5%+3%+$0.20 → margin $16.4 (38%) at $42             │
├────────────────────────────────────────────────────────────────────────────┤
│                [ Create Etsy listing ▸ ]   Watch idea   Compare   ⋯        │
└────────────────────────────────────────────────────────────────────────────┘
```

**Data and endpoints:**
- Etsy: `GET /listings/active?keywords=&sort_on=score&limit=100` × 3 pages, then `GET /shops/{id}` for the unique shops in the top 48 (≤48 calls, **cached in a shared, cross-user cache for 24h**). Supply = `count`. Price = median and P25-P75 over listings whose currency matches the marketplace currency (others converted via FX or dropped; the drop count is shown). Newcomer share = shops with `create_date` < 365 days. "Shop sales/day" is **Measured** only once a shop has ≥2 daily snapshots. Until then the cell shows lifetime sales / shop age, labelled `Estimate`.
- eBay: Browse `item_summary/search` (US), plus `getItem` on the top 20 for `estimatedSoldQuantity`. Show "N of top 50 have sold ≥1" rather than a velocity, because there is no time window.
- Amazon: Creators `SearchItems` → median BSR → sales estimator (labelled `Estimate`, with the model named).
- Trendyol column (sourcing): median price in TRY, `socialProof` counts, so the user can see what it costs at home.
- Demand Signal tier: §6.2.
- MarginBox: product cost (user input), shipping = **median of the user's own label costs for that carrier and destination** (from `Shipment`), falling back to the carrier rate card, plus the marketplace fee table.

**AI:** TR→EN seeds; a one-paragraph verdict that may only cite numbers passed in (validated, §6.5); 3 angle suggestions ("personalized for new parents", "engraved wedding").

**Action:** `writeListingPrefill({ target:'etsy', source:'research-hub', title: AI draft title, tags: top-tag set (≤13, ≤20 chars each), price: median (only if the currency matches), categoryHint: mode taxonomy_id, research: {query, priceStats, fetchedAt} })`. Watch idea → `ResearchWatch{type:'query'}`. Weekly digest when supply, median price or the top shops move.

### Job 2: Keywords and tags for a listing ("Hangi kelimeleri kullanmalıyım?")

**Who:** everyone, every listing. This is the highest-frequency job and what eRank, Marmalead and Sale Samurai sell.

**Honest data limit:** **we have no Etsy search volume.** We never show a "searches/month" number of our own. We show:
- **Demand Signal** (tier ●○○○○ to ●●●●●) from Google Trends relative interest, autocomplete presence (Google, Amazon, eBay), and an engagement proxy (median favorites accrual of the top 48 listings for the phrase).
- **Competition** (Measured: Etsy result count).
- **Top-seller usage** (Measured: "used as a tag by 18 of the top 48"). This is Marmalead's best metric and we can compute it exactly.
- **Etsy Insights volume** (optional, user-entered): "Check real volume on Etsy ↗" deep-links to Marketplace Insights. The number the user types is stored per keyword and shown as `Measured · from Etsy, entered by you on 12 Oct`. This is honest and free, and no competitor does it.

**Flow:** pick one of my listings (or type a seed) → we build a candidate pool → a table with filter chips → select up to 13 → **Apply as draft** (or bulk-apply the same tag set to N listings).

```
┌ Research ▸ Keywords ─────────── for: [▢ Engraved Walnut Keepsake Box ▾] ───┐
│ Current tags 11/13 · 2 dupes of title words · 1 over 20 chars              │
├────────────────────────────────────────────────────────────────────────────┤
│ Filters: [Long-tail] [Not in title] [≤20 chars] [Low competition] [Seasonal]│
├──────────────────────────┬────────┬───────────┬──────────┬─────────┬───────┤
│ Phrase                   │ Demand │ Etsy comp │ Top-48   │ Etsy vol│       │
│                          │ Signal │ Measured  │ usage    │ (you)   │       │
├──────────────────────────┼────────┼───────────┼──────────┼─────────┼───────┤
│ ☑ baby keepsake box      │ ●●●●○  │ 9,120     │ 21/48    │ 2,410   │ ▲ Nov │
│ ☑ memory box wood        │ ●●●○○  │ 4,388     │ 9/48     │  add ↗  │       │
│ ☐ anniversary box        │ ●●●●○  │ 31,002    │ 3/48     │  add ↗  │       │
│ …                        │        │           │          │         │       │
├──────────────────────────┴────────┴───────────┴──────────┴─────────┴───────┤
│ Selected 13/13 · 0 overlap with title · all ≤ 20 chars                     │
│ [ Apply to listing as draft ▸ ]  Apply to 12 similar…   Track ranks   ⋯    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Data:** the candidate pool = tag frequency over the top 100-300 results for the listing's main phrases (`search_market`) + Google/Amazon/eBay autocomplete + AI expansions. Each candidate costs 1 Etsy call for the count (cached 24h, shared). Rules from founder memory: 20-char max, no overlap with title words, English only, Title Case titles of 100-140 chars.

**AI:** expansion and clustering (group "memory box / keepsake box / remembrance box"), and the reason a phrase fits. AI never assigns demand.

**Action:** Apply → `EtsyListingDraft.fieldPatch.tags` (staged; the draft badge appears in the Listings drawer, then "Sync to Etsy"). "Track ranks" → creates `RankTrackedKeyword` rows for the chosen phrases (feeds Job 5).

### Job 3: Listing Doctor ("Neden satmıyor? Fix my listings")

**Who:** sellers with 20-500 listings. This is the job that moves money for existing users, and the bridge to Vela-style bulk editing.

**Flow:** Research Home → "My listings" → the catalog is sorted by **opportunity** (not by score) → open a row → the issues are listed, each with a fix → **Stage fixes** (one, or bulk across the selection).

```
┌ Research ▸ My listings ─────────────── Etsy: BelleCouture ▾ · 214 active ──┐
│ Sort: [Biggest opportunity ▾]  Filter: [Has views, 0 sales 90d] [Low rank] │
├───┬──────────────────────────────┬───────┬────────┬────────┬──────────────┤
│   │ Listing                      │ Views │ Sales  │ Rank   │ Issues       │
│   │                              │ (life)│ 90d ✓  │ main kw│              │
├───┼──────────────────────────────┼───────┼────────┼────────┼──────────────┤
│ ☐ │ ▢ Baby Name Puzzle…          │ 4,812 │ 0      │ #212   │ 4 · price +38%│
│ ☐ │ ▢ Wooden Ring Box…           │ 2,190 │ 3      │ —      │ 2 · 5 photos │
├───┴──────────────────────────────┴───────┴────────┴────────┴──────────────┤
│ ▾ Baby Name Puzzle — vs 48 peers for "baby name puzzle"                    │
│   ✕ Price $58 vs peer median $42 (P75 $49)           [Set price…]          │
│   ✕ 6 tags duplicate title words                      [Suggest tags ▸ J2]   │
│   ✕ Title 62 chars, peers median 118                  [AI rewrite title]   │
│   ! 5 photos, peers median 9; no video (61% peers)    [Open photo studio]  │
│   ✓ Personalization on · ✓ Free shipping like 73% of peers                 │
├────────────────────────────────────────────────────────────────────────────┤
│ 2 selected · [ Stage fixes as drafts ▸ ]   Open bulk editor   ⋯            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Data:**
- The user's EtsyListing cache: views and favorites (lifetime), photo count, video, tags, title, price.
- **Real sales per listing from our synced Etsy receipts and transactions** (no competitor can show this next to research). This is `Measured`.
- Peers: `search_market` for the listing's main phrase. The "main phrase" is the top-ranked tracked keyword if one exists, otherwise an AI pick from the title.
- Rank from `RankSnapshot`.

**Opportunity sort (deterministic and explainable):** `views_90d_or_lifetime high AND sales low` first (traffic that does not convert, so fix price, photos and offer), then `rank > 100 on main keyword` (cannot be found, so fix SEO), then cosmetic issues. No 0-100 black-box score; we show the issue count and the single biggest issue. Using one checklist representation everywhere also fixes the "3 score styles" problem.

**AI:** a title rewrite (the founder's Etsy title rules), a description rewrite, alt text. Each rewrite is a suggestion the user accepts before it is staged.

**Action:** Stage → `EtsyListingDraft` patches (title, tags, price), batched. "Open bulk editor" passes the selected IDs to `BulkEditor`. Nothing syncs until the user presses Sync. eBay listings get the same screen against eBay peers (Browse).

### Job 4: Competitor Watch ("Rakiplerim ne yapıyor?")

**Who:** everyone in a niche. ZIK, EverBee and Alura charge for this. Our edge: **measured** daily shop sales from `transaction_sold_count` deltas instead of modelled guesses.

**Flow:** add a shop (Etsy URL or name, eBay seller ID, Amazon ASIN, Trendyol merchant) from anywhere (a Validate row, a Doctor peer, by pasting a URL) → a daily snapshot runs → the Watch list shows trends → alerts fire in the bell and in a weekly email digest.

```
┌ Research ▸ Competitors ─────────────────────────────── [+ Add competitor] ─┐
│ Shop             Mkt   Sales/day 7d  Δ vs prev   Active  New 7d  Price Δ    │
│                        Measured                  lst     lst     median     │
│ WoodAndWords     Etsy  14.3          ▲ 22%       412     +9      —          │
│ MemoryCrafts     Etsy   6.1          ▼ 8%        188     +2      ▼ 6%       │
│ engrave_us       eBay   —  (sold≥1: 31 items)    90      +0      —          │
├────────────────────────────────────────────────────────────────────────────┤
│ ▾ WoodAndWords · since 2021 · ★4.9 (8.1k)                                  │
│  [sparkline sales/day 30d]                                                 │
│  New listings this week (9):  ▢ ▢ ▢ ▢   → [Validate this idea] [Create similar]│
│  Fastest-gaining listings (favorites Δ 7d, Estimate share of sales):       │
│   ▢ Personalized Recipe Box  +142 ♥  ~31% of shop's sales est.            │
│  Tags they use that you don't: "recipe card box", "kitchen keepsake" [→ J2]│
│  Alerts: [✓ new listing] [✓ price drop >10%] [ ] sales spike >2×           │
└────────────────────────────────────────────────────────────────────────────┘
```

**Data:**
- Daily cron `/api/cron/research-snapshots`: per watched Etsy shop, `GET /shops/{id}` (1 call) + `GET /shops/{id}/listings/active` (≈ listing_active_count/100 calls), storing `transaction_sold_count`, review count, and per-listing `num_favorers`/`views`/price/tags.
  - Sales/day = Δ`transaction_sold_count` / Δdays → **Measured** (Etsy's own counter; it counts transactions, i.e. line items, the same thing Etsy shows on the shop page).
  - Per-listing share = Δfavorites share → **Estimate**, labelled as such.
- eBay sellers: Browse `filter=sellers:{}` with an existing `EbayTrackedSeller`/`EbayPriceSnapshot`; plus Δ`estimatedSoldQuantity` per item between snapshots. **That delta is Measured.** This upgrades the lifetime number into a real rate.
- Amazon ASIN: `AmazonTrackedProduct` + BSR snapshots.
- Trendyol: index snapshots.

**AI:** "What changed this week" summary for each competitor; the reviews summary (`review_sentiment`) moves here, run on demand.

**Actions:** Validate this idea (→ Job 1 prefilled), Create similar (prefill with *our* AI title, not a copy of theirs), take a tag gap to Job 2, alert toggles.

**Quota:** watch limits per plan (for example Trial 3, Starter 10, Growth 50) keep within the 100K QPD Etsy budget (§4.4).

### Job 5: Rank and change tracker ("Değişiklik işe yaradı mı?")

**Who:** anyone who edited a listing. eRank shows ranks; nobody ties rank to *your edit* and *your sales*.

**Flow:** a tracked keyword or listing shows its daily position. Every Sync-to-Etsy of a draft drops a marker on the chart. Below the chart: real sales before and after the edit (from orders).

```
┌ Research ▸ Rankings ─────────────────────── 38 tracked · checked 06:00 ────┐
│ Keyword              Listing                 Pos   7d     Best  Sales 14d │
│ baby keepsake box    Engraved Walnut Box     #34   ▲ 41   #29   5 (▲3)    │
│ memory box wood      Engraved Walnut Box     >500  —      #301  —         │
├────────────────────────────────────────────────────────────────────────────┤
│ ▾ baby keepsake box                                                        │
│   pos  ┤        ╭──╮                                                       │
│        ┤  ──────╯  ╰──── ◆ synced draft "tags+title" (Oct 3)               │
│   Before 14d: 2 sales · After 14d: 5 sales (Measured, your orders)         │
│   Note: position in Etsy API search (non-personalized, ads excluded).      │
│   [Find better keywords ▸]   Stop tracking   ⋯                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Data:** the existing `RankTrackedKeyword`/`RankSnapshot` + `track-ranks` cron, the `EtsyDraftSyncAttempt` (status=success) timestamps as markers, `OrderItem` by listing ID for sales. `rank=null` is shown as ">500", never as 0.

**Action:** auto-track (the existing `auto_track_listing_tags`) when tags are applied in Job 2. Alert on a drop of >20 positions or falling off the first 3 pages.

### Job 6: Price gap: Türkiye → global ("Türkiye'den yurtdışına: nerede daha pahalı satılıyor?")

**Who:** the core KolayXport user: a Turkish seller or a Trendyol supplier going to eBay/Etsy. This is unique to us (arbitrage indexes + our own shipping labels + FX).

**Flow:** pick a source: a Trendyol category bestseller list, the user's **own Trendyol products** (we have their catalog), or a pasted Trendyol URL → see matched eBay/Etsy US listings and the landed margin → **List on eBay/Etsy** (prefill with images) or **Watch**.

```
┌ Research ▸ Price gap TR → Global ─── Source: [My Trendyol products ▾] ─────┐
│ FX 1 USD = 41.2 TRY (today) · Ship: FedEx IP, your median $14.2 / 0.5kg    │
├──────────────────────┬──────────┬─────────────┬────────┬────────┬─────────┤
│ Product (TR)         │ TR price │ eBay US     │ Match  │ Landed │ Margin  │
│                      │          │ median sold≥1│ conf. │ cost   │ est.    │
├──────────────────────┼──────────┼─────────────┼────────┼────────┼─────────┤
│ ▢ El yapımı bakır cezve│ ₺640   │ $48 (n=22)  │ High   │ $31.9  │ $9.7 20%│
│ ▢ Türk havlusu peştemal│ ₺290   │ $26 (n=61)  │ Medium │ $21.6  │ $1.1 4% │
├──────────────────────┴──────────┴─────────────┴────────┴────────┴─────────┤
│ ▾ Bakır cezve — 22 eBay matches (show)   Etsy: $54 median (n=140)          │
│   MarginBox: cost ₺640→$15.5 + ship $14.2 + eBay fees 13.6% → $9.7         │
│   [ List on eBay ▸ ]   List on Etsy   Watch price   ⋯                       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Data:** `TrendyolProductIndex`/`EbayProductIndex`/`ArbitrageMatch` (with AI matching confidence, already computed offline), Etsy `search_market` for the Etsy column, `exchange_rate`, the user's `Shipment` costs by carrier and weight band, and the fee tables. Low-confidence matches are collapsed by default.

**Action:** `writeListingPrefill({ target:'ebay', source:'arbitrage', title: AI English title, imageUrls: Trendyol images (HMAC-signed rehost per reference_local_image_hosting), price: suggested = eBay median, research })`. Watch → `ResearchWatch{type:'trendyolProduct'}`, alert when the margin crosses a threshold.

### Supporting module (not a job): Seasonal calendar on Research Home

A deterministic event calendar (Valentine's, Mother's Day US/UK/DE, Halloween, Black Friday, Christmas, Diwali, Ramadan/Eid...) with **ship-from-Türkiye lead times**: production days (user setting) + carrier transit from their own label history + the marketplace "order by" date. "Christmas US: list by Oct 20, last FedEx ship from İstanbul Dec 15." This replaces the fake "Trending Niches" and the Turkish tip strings. Each event links to Validate with a seed query.

---

## 4. Information architecture: one Research hub

### 4.1 Navigation

The sidebar "Research" group (currently 4 entries with the same Target icon, `components/AppLayout.js:149-158`) becomes **one entry: `Research` → `/app/research`**.

```
/app/research                      Home
/app/research/validate?q=&mkt=     Job 1  (q, mkt=etsy,ebay,amazon,tr; compare=q1|q2|q3)
/app/research/keywords?listing=    Job 2  (or ?q=)
/app/research/listings?shop=       Job 3  (My listings / Doctor)
/app/research/competitors          Job 4
/app/research/rankings             Job 5
/app/research/price-gap?source=    Job 6
```

Desktop layout follows the app shell (PageHeader + a secondary section nav, the same pattern as the Settings spec): a left section nav at 200px with 6 items + Home, and content at max-width 1200px. Mobile: Home is a grouped list (as in the Settings mobile index), each job is a drill-in page with a sticky top bar, and tables become expandable cards (founder memory: DataGrid is broken on mobile).

**The marketplace is a filter, not a page.** Chips on each job (`Etsy · eBay · Amazon · Trendyol`). A chip without a connection or eligibility shows `ConnectEmptyState` instead of an error.

### 4.2 Research Home

```
┌ Research ──────────────────────────────────────────────────────────────────┐
│ [ Search an idea, keyword, shop URL or Trendyol link…          ] (⌘K too)  │
│   → detects: idea→Validate · shop URL→Competitors · listing URL→Doctor ·   │
│     trendyol.com URL→Price gap                                              │
├───────────────────────────────┬────────────────────────────────────────────┤
│ Needs attention (3)           │ Upcoming seasons (from TR)                 │
│ ▼ "baby keepsake box" #34→#71 │ Christmas US · list by Oct 20 · 6 days     │
│ ● WoodAndWords +9 listings    │ Valentine's · start Dec 1                  │
│ ● 4 listings: views, 0 sales  │                                            │
├───────────────────────────────┼────────────────────────────────────────────┤
│ Watching: 3 shops · 38 kws ·  │ Recent research                            │
│ 2 ideas · 5 TR products       │ wooden keepsake box · 2h ago · Etsy+eBay   │
└───────────────────────────────┴────────────────────────────────────────────┘
```

One smart search box. ⌘K gets a "Research: <text>" action (the Cmd+K palette from UX phase 3).

### 4.3 Data model additions (proposal)

```prisma
model ResearchWatch {          // one table for all watch types
  id String @id @default(cuid())
  userId String
  type   String  // query | etsyShop | ebaySeller | asin | trendyolProduct | listing
  marketplace String
  refId  String  // shop_id, seller username, ASIN, query text…
  label  String
  alertRules Json   // {newListing:true, priceDropPct:10, salesSpikeX:2, marginOver:15}
  isActive Boolean @default(true)
  createdAt DateTime @default(now())
  @@unique([userId, type, marketplace, refId])
}
model ResearchSnapshot {        // shared across users: one fetch per refId per day
  id String @id @default(cuid())
  type String; marketplace String; refId String
  takenAt DateTime @default(now())
  metrics Json   // {transactionSoldCount, reviewCount, activeCount, medianPrice, currency, n…}
  @@index([type, marketplace, refId, takenAt])
}
model ResearchKeywordNote {     // user-entered Etsy Marketplace Insights volume
  id String @id @default(cuid())
  userId String; keyword String; etsySearches30d Int; enteredAt DateTime @default(now())
  @@unique([userId, keyword])
}
```

The existing `EbayTrackedSeller`, `EbayTrackedProduct`, `AmazonTrackedProduct` and `RankTrackedKeyword` stay as they are, and the hub reads them through one adapter. Migrate them into `ResearchWatch` later, if ever. `ResearchCache` is per-user today; add a **shared** cache key namespace (`public:etsy:search:<hash>`) so 50 users researching "halloween decor" cost 3 Etsy calls, not 150.

### 4.4 Etsy API budget (100K QPD for the whole app)

| Operation | Calls | Cache |
|---|---|---|
| Validate (Etsy column) | 3 search + ≤48 shops ≈ 51 | 24h shared |
| Keyword candidate counts | 1 per phrase (~40/run) | 24h shared |
| Competitor snapshot | 1 + ⌈active/100⌉ per shop per day | daily shared |
| Rank check | ≤5 per keyword per day | daily |

With shared caches, 500 active users × (5 validations + 2 keyword runs + 10 shops + 30 keywords) ≈ 60-75K/day at the worst case. That is fine, but enforce plan quotas and a global circuit breaker at 85K that degrades to cached-only mode with a visible "data from yesterday" note.

---

## 5. Build order and delete list

### MVP order

**Phase R0: honesty patch (2-3 days, ship first, even before the hub)**
1. New `lib/research/stats.ts`: `normalizePrices(items, targetCurrency, fx)`, `robustStats()` (median, P25/P75, Tukey trim, n, droppedCount), `isPlausible()`, `formatMoney(locale,currency)`. Unit tests with fixtures containing JPY/INR listings, $9,999 placeholders, n<10 samples, and HTML entities.
2. Use it in `search_market`, `analyze_niche`, and `get_discovery_data`, and stop showing `avg` anywhere.
3. Remove the "Trending Niches" block and the Demand Score ring. Change "Search volume" labels to "Listings (supply)".
4. Decode HTML entities in Etsy text (`he.decode`) on read; never write entities back.
This alone removes the most visible embarrassments in production.

**Phase R1: hub shell + Job 1 Validate (Etsy + eBay) + Job 3 Listing Doctor (Etsy)** (~2 weeks)
- `/app/research` shell, Home with the smart search, redirects from the 4 old routes (`etsy-research → /app/research/validate?mkt=etsy`, and so on; keep `?tab=` mapping for one release).
- Validate with the provenance tags, MarginBox and prefill action.
- Doctor using own listings + own sales + peers + staged drafts. Doctor is the part paying users feel the most, because it changes their listings.

**Phase R2: Job 2 Keywords + Job 5 Rankings** (~1.5 weeks)
- Candidate pool, filters, Etsy Insights manual volume, Apply as draft, bulk apply, auto-track.
- Expose the existing rank data with sync markers and before/after sales.

**Phase R3: Job 4 Competitor Watch + alerts** (~2 weeks)
- `ResearchWatch` / `ResearchSnapshot`, the daily snapshot cron (in `cron-daily.yml` next to `track-ranks`), measured sales/day, notifications plus a weekly digest email (Postmark).

**Phase R4: Job 6 Price gap + Amazon column** (~1.5 weeks)
- Re-skin the arbitrage scanner into the hub with match confidence, landed cost from own labels, and the List-on-eBay prefill. Add the Amazon column only behind confirmed Creators API eligibility.

**Phase R5 (optional, later):** a Chrome extension overlay on Etsy search pages (the extension already exists, v9.x) that shows our Measured/Signal badges in place, as EverBee does. This is a founder decision on scope; it is not needed for the MVP.

### Delete (after R1-R4 reach parity; each behind a redirect)

- `pages/app/etsy-research.tsx`, `pages/app/ebay-research.tsx` (3306 lines), `pages/app/trendyol-arastirma.tsx`, `pages/app/amazon-research.tsx` → redirects.
- `components/etsy/research/{UnifiedResearch,ListingGrader,CompetitorIntelligence,AiOptimizePanel,ComparisonPanel}.tsx`. Keep `shared/listingPrefill.ts` (but unify it with the eBay copy) and `shared/exportUtils.ts`.
- `components/ebay/research/{AiOptimizationHub,CategoryExplorer,CompetitiveIntelligence,FinancialIntelligence,KeywordIntelligence,ListingOptimizer,MarketplaceComparison,NicheComparison,SeoAnalyzer}.tsx`. Keep `arbitrage/*` until R4, and keep `listingPrefill.ts` and `useCreateListingPrefill.ts`.
- `components/trendyol/research/{Dashboard,TrendyolBrandAnalyzer,TrendyolPriceAnalyzer,TrendyolSellerIntelligence,TrendyolProfitCalculator,AiReport}.tsx`. CategoryExplorer's data fetching moves into a hook used by Job 6.
- `components/amazon/research/*` → folded into the Validate column and the Watch adapter.
- API actions: `get_discovery_data`, `estimate_sales_velocity`, `analyze_niche.demandScore`, the eBay `niche_analyze` demand composite; `/api/ai/etsy` `market_analysis`/`niche_report`/`shop_spy_report` get replaced by one `explain_research` action that takes computed numbers in.
- Stores: `useEtsyResearchStore` (1004 lines), `useEbayResearchStore`, `useTrendyolResearchStore`, `useAmazonResearchStore` → one `useResearchHub` store plus SWR per job.
- i18n: `etsyResearch.*`, `ebayResearch.*`, `trendyolResearch.*`, `amazonResearch.*` → a new `research.*` namespace (EN + TR from day one; no hardcoded Turkish tip strings in the API).

---

## 6. Data-quality guards (non-negotiable)

### 6.1 The provenance label on every number

| Label | Meaning | Visual | Examples |
|---|---|---|---|
| **Measured** | Read directly from a marketplace or our DB, or a deterministic aggregate of such reads | plain number; tooltip with source, n, fetch time | listing count, median price, shop sales/day from counter deltas, your sales, rank position |
| **Estimate** | A model output | `~` prefix, dotted underline, the model named in the tooltip | Amazon sales from BSR, per-listing share of shop sales, eBay lifetime sold → rate before 2 snapshots exist |
| **Signal** | Relative indicator, no unit | 5-dot tier, never a number | Demand Signal, seasonality ▲ |
| **You entered** | User-provided | "you, 12 Oct" | Etsy Insights volume, product cost |

There is no unlabeled number anywhere in Research. A shared component `<Metric value kind="measured|estimate|signal|user" source n fetchedAt />` lives in `components/ui/`.

### 6.2 Demand Signal: how it is computed and labelled

Inputs, each normalized to 0-1:
- (a) Google Trends US relative interest, 12-month mean (when the API fails, the input drops out and the tooltip says so);
- (b) autocomplete presence: the phrase or its prefix appears in Google, Amazon and eBay suggestions (0-3 sources);
- (c) engagement: the median of `num_favorers / months since original_creation_timestamp` over the top 48 Etsy listings, with listings <60 days old excluded, compared against a per-taxonomy baseline we store.

The tier is the mean of the available inputs, quantized to 1-5 dots, and the tier needs **≥2 inputs**; otherwise it shows "Not enough signal". The tooltip lists every input. The UI copy reads: "Demand Signal is an indirect indicator. Etsy does not share search volume. For real volume, check Etsy Marketplace Insights ↗". Never write "searches/month" unless the value is `You entered` or comes from a licensed source.

### 6.3 Price and number sanity checks (fixes "Halloween Decor $5218.94 avg")

1. **Currency.** Group by `currency_code`. Convert to the display currency with today's FX (the cached `exchange_rate`), or exclude when FX is missing. Show "n=287 of 300 (13 excluded: no FX)".
2. **Robust statistics only.** Median and P25-P75. Trim by Tukey fences (Q1−1.5·IQR, Q3+3·IQR) before any min or max. **No arithmetic means of prices anywhere in the UI.**
3. **Plausibility bounds.** Reject unit prices < $0.50 or > $2,000 for physical goods (configurable per taxonomy; digital < $0.20), and flag a median > $500 as "check: unusual price range" instead of printing it.
4. **Minimum sample.** n < 20 → show the range only, with the label "small sample". n < 5 → "Not enough data".
5. **Timestamps.** Use `original_creation_timestamp` for age, never `created_timestamp` (it resets on renewal). Exclude listings < 60 days old from any rate.
6. **Lifetime vs rate.** A lifetime counter (views, favorites, eBay sold) is never shown as a rate unless it comes from a delta between two snapshots.
7. **Rates have bounds.** A shop sales/day delta < 0 (counter reset or API anomaly) or > 50× the 30-day median → drop the point and flag it.
8. **Duplicates.** Collapse multiple listings from the same shop in concentration math. Dedupe eBay variations.
9. **Rank.** `null` = ">500 / not found", never 0. A rank is only compared across days when `totalResults` changed by less than 50%.
10. **Formatting.** `Intl.NumberFormat(locale, {style:'currency', currency})` everywhere (no "$" string concatenation, no "2999.00 TRY"). Compact numbers only in tiles (≥10k). Never `text-transform: uppercase` on TR-locale text (the FAİLED bug).
11. **Text.** Decode HTML entities from Etsy and eBay on read; strip them before writing back.
12. **Staleness.** Every panel shows "Updated 3h ago". Data > 48h old is greyed with a "Refresh" link. A failed upstream shows an `ErrorState` with a retry button and keeps the last good data. The UI never sits on a spinner (timeout at 20s, which fixes the stuck "Loading your eBay listings...").

### 6.4 Cross-checks run before display (cheap and automatic)

- Median price falls inside [P25, P75]. Supply count ≥ items returned. Sum of shares ≤ 100%.
- When we hold a user-entered Etsy Insights volume for the phrase and our Signal tier disagrees by ≥3 tiers, show "Our signal differs from Etsy's data, trust Etsy's" (honesty beats consistency).
- Doctor price comparisons only run when the listing's currency equals the peer display currency after conversion.

### 6.5 AI guardrails

- AI receives the computed metrics as JSON and returns `{verdict, reasons[], angles[]}`, validated with zod. Gemini sometimes returns arrays or garbled text (founder memory), so reject and fall back to a template sentence.
- **Numbers check.** Every number in AI text must match a number in the input (± rounding). Otherwise strip the sentence.
- AI never outputs search volume, sales or revenue.
- AI output is capped at 600 chars in the UI, and AI errors are never shown in huge toasts.
- Keywords, titles and tags from AI are English; commentary follows the UI locale.

### 6.6 Tests

- `__tests__/research/stats.test.ts`: the mixed-currency fixture must not produce a median above $200 for "halloween decor"; placeholder prices get trimmed; n thresholds hold.
- A snapshot-delta test: a counter reset produces no negative sales.
- A contract test: the `writeListingPrefill` payload from each job passes `sanitizeListingPrefill`.

---

## 7. Success criteria

- Every research screen ends in an action. Target: ≥30% of Validate sessions end in Create, Apply or Watch.
- Zero unlabeled numbers. Zero mean prices. Zero hardcoded "trending".
- Doctor → staged draft → synced within 7 days for ≥20% of users who open it.
- The founder test: "Would I pay for this instead of eRank + EverBee + Vela?" The answer is yes because it covers their jobs with honest data, plus the user's own cross-marketplace sales, plus one-click staged edits.

## Sources

- eRank keyword data methodology: https://help.erank.com/features/keyword-tool/
- Etsy Marketplace Insights: https://help.etsy.com/hc/en-us/articles/35122361353239 · https://help.erank.com/blog/etsy-marketplace-insights-tool/
- Tool comparisons and pricing: https://craftybase.com/blog/best-etsy-seo-tools · https://sellertoolshq.com/tools/compare/erank-vs-everbee/ · https://sellertoolshq.com/tools/compare/marmalead-vs-everbee/ · https://revenuegeeks.com/compare/erank-vs-everbee · https://revenuegeeks.com/software/everbee/alternative
- EverBee accuracy and complaints: https://revenuegeeks.com/software/everbee/chrome-extension · https://ojdigitalsolutions.com/everbee-review/
- Sale Samurai: https://revenuegeeks.com/software/sale-samurai · https://www.insightagent.app/guides/sales-samurai-vs-everbee
- Alura: https://alura.io/vs/erank · https://www.nichepursuits.com/alura-review/
- Vela: https://apps.shopify.com/vela · https://www.listadum.com/blog/get-vela-vs-listadum
- eBay Marketplace Insights (limited release): https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html
- ZIK vs Terapeak: https://www.zikanalytics.com/compare/zik-analytics-vs-terapeak-alternative
- Helium 10 / Jungle Scout: https://www.smartscout.com/blog/helium-10-vs-jungle-scout · https://www.nexscope.ai/blog/helium-10-vs-jungle-scout

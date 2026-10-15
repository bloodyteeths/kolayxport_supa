# Surface: Pro features and the locked-feature pattern

Status: design spec, binding for M1 (components), M7 (PhotoStudio), M9 (Reports gating) and R4 (Price gap). Date: 2026-10-15. Design only: no app code changed.
Resolves CRITIQUE **B4 / X5 / U2**. Contract: `DESIGN_SYSTEM.md`, `tokens.md`; billing contract `design/surfaces/settings-billing-pricing.md` §0.2, §2.2 (`Entitlement.features`, `stripeUpsell`), §11 (Shopify gating matrix); backend gate `design/launch/tiers.md` (D13: "Pro features have no gate anywhere"; `withEntitlement` 402 `{ limitType: 'feature', reason: 'featureLocked', feature }`).

Code read (kx-ux-phase0 working tree): `components/etsy/BulkEditor.tsx` (hosts `BulkPhotoStudio`/`BulkVideoStudio`; tiers.md cites L3476–L3477), `components/etsy/BulkPhotoStudio.tsx` (1,308 lines: ops `add|replace|delete|reorder|alt|enhance|removebg|copy`, sources `upload|ai|url`, positions 1–20 or end, all staged through `stageEtsyDraft`/`stageEtsyDraftFile`), `components/etsy/BulkVideoStudio.tsx` (344), `pages/app/ebay-research.tsx` (arbitrage tab; tiers.md cites L2943, L3104), `components/ebay/research/arbitrage/*`, `pages/app/financials.tsx`, `components/AppLayout.js` (`isShopifyFree` L245), `components/billing/LimitReachedDialog.tsx` (L79 Shopify check), `lib/middleware/withUsageLimiter.ts` (L24, L90 `shopify_free`).

---

## 0. What is wrong today

| # | Problem | Where |
|---|---|---|
| 1 | The pricing page sells three Pro features (Arbitrage scanner, Financials, Bulk photo studio). **No gate exists** in the UI or the API (tiers.md D13) | everywhere |
| 2 | There is no design for "you don't have this": each surface would invent its own modal | — |
| 3 | Bulk photo and video studio live inside `BulkEditor` dialogs, which M7 replaces; they have no home after M7 | `BulkEditor.tsx` |
| 4 | Arbitrage lives in a tab of a 3,306-line page that the research track deletes; the DS calls it "Price gap, R4" | `ebay-research.tsx` |
| 5 | Shopify-installed merchants must never see a Stripe upsell (App Store review), but "Pro" badges and "Upgrade" buttons are exactly that | Shopify review 1.2.1 history |

---

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| Which features are Pro | Exactly `Entitlement.features`: `arbitrage`, `financials`, `bulkPhotoStudio`. No new Pro features in this rebuild | settings §0.2 |
| What "Financials" covers | **Reports › Profit, Payouts and Transactions** (the three tabs fed by `/api/finance/*`). **Reports › Sales stays in every plan** (it is order data the user already syncs). Founder decision **D-P1** (BUILD_PLAN §8); the UI is built so flipping Sales to Pro is one line in `lib/billing/featureMap.ts` | CRITIQUE X5 recommendation; Sales is the free hook into Reports |
| What "Arbitrage scanner" covers | Product finder source **"From Trendyol"** (R4, research.md §9) and its scan jobs. Until R4 ships: the legacy `ebay-research?tab=arbitrage` tab | DS §3.18 |
| What "Bulk photo studio" covers | The full-page **PhotoStudio** (`/app/{mp}-listings/photos`), both its Photos and Video tabs. **Single-listing photo editing in the listing editor stays in every plan** (it is core editing) | U2 |
| Where gating is enforced | **Server first** (tiers.md `withEntitlement`/`requireFeature` on the finance handlers, `clawd/arbitrage.ts`, the arbitrage job runner, the PhotoStudio staging calls via a `feature: 'bulkPhotoStudio'` check in the new `batch-media` endpoint, §4.4). The UI gate is presentation only; the UI never trusts its own check for data access | a client gate can be bypassed |
| Trial | Pro features **on** (settings §0.2). Entry points show `PlanTag` "Pro" with the tooltip "Included in your trial until {date}" | sells Pro during the trial |
| Plans without the feature (Stripe users) | Entry points stay **visible** with a `PlanTag`. Opening them shows the locked state (§3) with one primary "See plans" | X5; discoverability |
| `shopify_free` / `stripeUpsell === false` | **No `PlanTag`, no "Pro", no "See plans", no prices, no upgrade wording anywhere.** Entry points that cannot do anything are **not rendered** (P1 "a button that cannot do anything is not rendered"): the PhotoStudio bulk action, the "From Trendyol" source segment, the Profit/Payouts/Transactions tabs. A direct URL to a gated route renders the neutral locked state ("This isn't included in your plan.") with no action | settings §0.2 and §11 (Shopify review risk) |
| Entitlement unknown (loading / error) | Loading: the gated region shows its skeleton. Error: render the feature normally and let the server decide; a 402 `featureLocked` then swaps the region to the locked state. Never show "See plans" while the provider is unknown (settings §0.2 safe direction) | no false locks, no Stripe surface for unknown providers |
| `expired` / `grace` states | Pro features follow `features.*` from the entitlement (the backend decides; tiers.md: `expired` blocks Pro). The locked state's copy changes to the billing reason ("Your plan is paused") and the action to "Reactivate" → `/ayarlar?tab=billing` (only when `stripeUpsell`) | one place decides |
| Nav | Nav items never carry a lock icon. Research and Reports items stay plain (most of their tools are free). ⌘K entries for gated destinations get the caption "Pro" (Stripe users) or are **not registered** (shopify_free) | DS §3.1 nav calm; settings §11 ⌘K rule |

---

## 2. Gating matrix

| Feature | Entry point | Trial | Starter / Growth | Pro / Enterprise | shopify_free | Unknown |
|---|---|---|---|---|---|---|
| bulkPhotoStudio | BulkGrid bulk bar "Edit photos…" (bulk-grid.md §7) | visible + `PlanTag` | visible + `PlanTag` → locked page | visible, no tag | **not rendered** | visible, server decides |
| | Listing doctor fix "Open photo studio" (research.md §7.1) | as above | label becomes "Add photos" → editor `#photos` (free path), no tag | PhotoStudio | "Add photos" → editor | editor |
| | Listings selection bar ⋯ "Edit photos…" | tag | tag → locked | plain | not rendered | plain |
| | `/app/{mp}-listings/photos?ids=` direct URL | studio | locked page (§3.2) | studio | neutral locked page | studio; 402 → locked |
| financials | Reports tabs Profit · Payouts · Transactions (finance-analytics) | tabs + `PlanTag` | tabs + `PlanTag` → locked tab body | plain | **tabs not rendered** (Reports shows Sales only, no `Tabs` row when one tab remains) | plain; 402 → locked body |
| | Overview KPI "Profit" tile (if any) / queue rows that link to Profit | normal | tile hidden (no teaser tiles on Overview) | normal | hidden | normal |
| | `/app/financials` legacy route | normal | locked page | normal | neutral locked page | normal |
| arbitrage | Product finder "Source: From Trendyol" segment (R4) | segment + tag | segment + tag → locked body | plain | **segment not rendered** | plain |
| | Home smart search with a Trendyol link (research.md §4.3) | Price gap | Product finder `mkt=trendyol` (free sourcing view) + inline info "Price gap needs Pro" (Stripe users) | Price gap | sourcing view, no note | sourcing view |
| | Legacy `ebay-research?tab=arbitrage` (until R4) | tab | tab + locked body | tab | tab not rendered | tab |

---

## 3. The locked pattern

### 3.1 Components (DS additions; add to DS §3.13 and §4.4/§4.5 in the M1 PR)

| Component | File | Props | Rules |
|---|---|---|---|
| `PlanTag` | `components/ds/data/PlanTag.tsx` | `{ plan: 'pro'; trialEndsAt?: Date }` | 18px tall, `micro` 11/14 weight 500, `neutral-100` background, `neutral-700` text, radius full, text "Pro". Not a `StatusPill` (it is not a status). Tooltip: trial → "Included in your trial until {date}"; else "Part of the Pro plan". **Returns `null` when `stripeUpsell !== true`** (one place enforces the Shopify rule) |
| `EmptyState kind="locked"` | `components/ds/state/EmptyState.tsx` (new kind) | existing props + `kind: 'locked'` | 40px `neutral-100` tile with `LockKeyhole` 20 (`lib/ds/icons.ts` meaning "locked"); title, ≤ 2-line body; one action or none |
| `FeaturePreview` | `components/ds/state/FeaturePreview.tsx` | `{ image: { src; srcSet; alt }; caption: string; points: string[] /* ≤ 3 */ }` | A static, **non-interactive** screenshot of the feature rendered from fixtures, at 100% opacity (no blur, no glass, no fake interactivity), framed with a 1px border and radius 8, with the mandatory caption "Example with sample data" (P6: sample data is labelled). Images live in `public/previews/{photo-studio,profit,price-gap}.{png,@2x.png}`, light theme, EN and TR variants (`-tr`) |
| `FeatureGate` | `components/domain/billing/FeatureGate.tsx` | `{ feature: Feature; placement: 'page'|'region'|'action'; children; preview?: FeaturePreviewProps }` | Reads `useEntitlement()`. `page`/`region`: renders children, the skeleton, or the locked state. `action`: returns `{ visible, tag, onBlockedClick }` via `useFeatureAction(feature)` for bulk bars and menus |
| `lib/billing/featureMap.ts` | — | `FEATURE_COPY: Record<Feature, { titleKey; bodyKey; pointsKeys; preview }>`, `isTabGated(tab)` | the single mapping of features to surfaces (D-P1 flips here) |

### 3.2 Locked page / region (Stripe user without the feature)

Desktop (inside the normal `Page` + `PageHeader`; the header keeps its title and `meta`, but no primary and no tool actions):
```
│ Reports                                                                                         │
│ (Sales) (Profit Pro) (Payouts Pro) (Transactions Pro)                                           │ Tabs: `PlanTag` after the label
│                                                                                                  │
│                ┌──┐                                                                              │
│                │LK│  Profit is part of Pro                                                       │ EmptyState kind="locked" (LK = LockKeyhole tile)
│                └──┘  See your real profit per order and per product: fees, ad spend,            │ (max width 560, centered,
│                      shipping and product costs from every marketplace.                           │  top margin 48)
│                      [See plans]                                                                  │ primary (the view's only one)
│                      Your trial included it until 29 Oct.   (only after a trial)                  │ caption
│     ┌──────────────────────────────────────────────────────────────────────────────┐            │
│     │ [static screenshot of the Profit report, light, 1px border, radius 8]         │            │ FeaturePreview (max 880)
│     └──────────────────────────────────────────────────────────────────────────────┘            │
│       Example with sample data                                                                    │ caption, neutral-500
│       · Profit per order after every fee  · Payouts matched to orders  · CSV export              │ 3 points, body 14
```
- "See plans" → `/fiyatlandirma?plan=pro&from=<feature>` (settings §10 handles the return). It is a `Button variant="primary"` because it is the only action of that view (P1).
- No modal, no toast, no banner on top of the page. Never open anything on load (DS §3.6).

Mobile 390: same content stacked; the preview image scales to the width (16 px gutters); the primary moves to `StickyActionBar` ("See plans", 48 px).

### 3.3 Neutral locked (shopify_free or `stripeUpsell === false`, reached by URL)
```
                ┌──┐
                │LK│  This isn't included in your plan
                └──┘  Your plan covers orders, labels, listings, bulk editing and research.
```
No action, no preview, no plan names, no prices (settings §11 test: no element contains "Pro", "Stripe", `/fiyatlandirma` or a currency symbol).

### 3.4 Locked action (bulk bars, menus, row actions)
- Stripe users without the feature: the action is rendered with a `PlanTag` after its label ("Edit photos… Pro"). Clicking it navigates to the gated route, which shows §3.2 (one consistent place to explain, not a popover per button).
- Trial: same tag, the action works.
- shopify_free: the action is not rendered.
- The DS rule "a disabled button always has a `disabledReason`" does not apply: locked actions are **enabled** and lead to the explanation.

### 3.5 Server 402 `featureLocked` (any gated API)
`{ error: 'Payment Required', limitType: 'feature', reason: 'featureLocked', feature, neutral }` (tiers.md). The UI maps it in `lib/http/limitInterceptor.ts` (shell-nav F owns the skip-list, CRITIQUE C6) to **swap the region to its locked state** (§3.2 or §3.3 by `neutral`/`stripeUpsell`), never a toast and never the global `LimitReachedDialog`. Background jobs (arbitrage scans resumed after a downgrade) report through the notification center (backend W5), not the UI.

---

## 4. Where the bulk photo and video studio live: `PhotoStudio`

### 4.1 Route and entry
`/app/etsy-listings/photos?ids=<id,id…>&tab=photos|video` (Etsy only in v1, as today). Entry points in §2. "← Back" returns to the caller (BulkGrid, listings or Listing doctor) with its URL state. Width `list`. Desktop and tablet ≥ 900 only; below 900 the bulk-grid.md §3.4 message with "Add photos one listing at a time in the editor".

### 4.2 Desktop 1440
```
│ ← Bulk edit                                                                                              │
│ Photo studio [24]   Pro                                 ⋯   [Stage 18 photo changes]                     │ PlanTag only in trial
│ 24 listings · 18 photo changes staged here · not sent yet                                                │ meta
│ (Photos) (Video)                                                                                         │ Tabs
│ ┌ Operation ───────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Do [Add ▾]   at position [End ▾]   from [Upload ▾]   [Choose files…]          Applies to 12 selected │ │ Select ×3 + action, 40px row
│ │ Add · Replace · Delete · Move · Alt text · Improve quality ✦ · Remove background ✦ · Copy from…       │ │ (menu content)
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ [⌕ Filter listings /] [Show: All · No photos · Fewer than 5 · Missing alt text ▾]   ☐ Select all        │
│ ┌──┬────────────────────────────────┬────────────────────────────────────────────────────────────────┐   │
│ │☑ │ [48] Personalized Baby Blank…  │ [1★][2][3][4][5][6][+]          6 / 20 · 2 need alt text        │   │ row = listing, strip of Thumb 64
│ │☐ │ [48] Wooden Keepsake Box       │ [1★][2][3][⊕ new][4]            5 / 20                          │   │ staged tiles: attention bar + badge
│ │☑ │ [48] Name Necklace Gold        │ [1★][2][✕ 3][4]                  4 / 20 · will remove 1          │   │ (DS ImageGrid staged states)
│ └──┴────────────────────────────────┴────────────────────────────────────────────────────────────────┘   │
│ 1–24 of 24                                                                                               │
```
- The operation row is the current studio's "operation × position × source" model (Vela-style), rebuilt on DS inputs. "Apply" is implicit in the action button of the row ("Add 3 photos to 12 listings", "Delete photo 3 on 12 listings", "Write alt text for photo 1 on 12 listings ✦ · 12 credits"); it **stages** media ops (`stageEtsyDraft({ media })`, `stageEtsyDraftFile`) through the new batch endpoint (§4.4), with progress in the header meta.
- AI ops (`Improve quality`, `Remove background`, AI alt text, AI generate) show their credit cost in the button (image 10 credits, alt text 1 credit; settings `billing.usage.aiHelp`), run with concurrency 3 (as today), and land as staged tiles with an "AI" badge; a 402 `aiCredits` → C6 Banner above the table.
- Tile click → `SidePanel lg` "Photo 3 · Wooden Keepsake Box": large preview, alt text field, Replace / Remove / Make primary, AI actions (same panel as listing-editor's Photo detail).
- Header primary "Stage N photo changes" is only needed for the **queued** operation of the operation row; single tile edits stage immediately. After staging, the listings send primary picks them up ("Send N changes to Etsy" on listings or BulkGrid). PhotoStudio itself never sends (one push place per listing).
- Video tab: one row per listing with its video tile; operation row "Add video to selected" (one file fanned out, as `BulkVideoStudio` does) · "Remove video from selected". Same staging path (`kind: 'video'`).
- Safety (unchanged rules from the May 2026 hardening): media ops validate image IDs at send time; duplicate deletes are ignored; reorder/alt keep the latest op per image (server side, `lib/etsy/draftService.ts`, backend-owned, unchanged).

### 4.3 States
Loading: `TableSkeleton thumb rows=8`. Image fetch per listing uses the existing `listingImagesById` loading (cached; one call per listing, concurrency 4) with per-row skeleton strips. A listing at 20 photos: Add is skipped for it and counted ("3 listings already have 20 photos"). Etsy not connected / reconnect: as listings-grid §7. Locked: §3.2 with the PhotoStudio preview.

### 4.4 New endpoint
`POST /api/etsy-drafts/batch-media` (M7-E): `{ shopId, items: { listingId, media: MediaOp[] }[] /* ≤ 50 */ }` → per-item results, calls `upsertDraftPatch({ media })` (import only). **Server gate:** `requireFeature(userId, 'bulkPhotoStudio')` (tiers.md helper) → 402 `featureLocked`. Single-listing staging through `POST /api/etsy-drafts` stays ungated (editor path). File uploads keep using `POST /api/etsy-drafts/media` (single file per call, unchanged; the client fans out) — the client-only gate for those is accepted (tiers.md "Bulk Photo Studio's non-AI gate is client-only") because each call stages one listing, which the editor can do anyway.

### 4.5 Arbitrage
Lives at research.md §9 (Product finder `?source=trendyol`, R4). The legacy tab keeps working until R4 and gets the §2 gating now (I0/M2 era: `FeatureGate placement="region"` around the tab body; shopify_free hides the tab).

---

## 5. i18n (namespace `pro`; keys returned to the integrator)

| Key | EN | TR |
|---|---|---|
| `pro.tag` | Pro | Pro |
| `pro.tag.trialTooltip` | Included in your trial until {date} | Deneme sürenize {date} tarihine kadar dahil |
| `pro.tag.tooltip` | Part of the Pro plan | Pro planının parçası |
| `pro.locked.seePlans` | See plans | Planları gör |
| `pro.locked.trialEnded` | Your trial included it until {date}. | Deneme süreniz {date} tarihine kadar bunu içeriyordu. |
| `pro.locked.paused.title` | Your plan is paused | Planınız durduruldu |
| `pro.locked.reactivate` | Reactivate | Yeniden etkinleştir |
| `pro.locked.neutral.title` | This isn't included in your plan | Bu özellik planınıza dahil değil |
| `pro.locked.neutral.body` | Your plan covers orders, labels, listings, bulk editing and research. | Planınız siparişleri, etiketleri, ilanları, toplu düzenlemeyi ve araştırmayı kapsar. |
| `pro.preview.caption` | Example with sample data | Örnek verilerle gösterim |
| `pro.feature.financials.title` | Profit is part of Pro | Kâr raporu Pro planına dahildir |
| `pro.feature.financials.body` | See your real profit per order and per product: fees, ad spend, shipping and product costs from every marketplace. | Sipariş ve ürün bazında gerçek kârınızı görün: tüm pazaryerlerinden komisyonlar, reklam harcaması, kargo ve ürün maliyetleri. |
| `pro.feature.financials.p1` / `.p2` / `.p3` | Profit per order after every fee / Payouts matched to orders / CSV export | Tüm kesintiler sonrası sipariş başına kâr / Siparişlerle eşleşen ödemeler / CSV dışa aktarma |
| `pro.feature.bulkPhotoStudio.title` | Photo studio is part of Pro | Fotoğraf stüdyosu Pro planına dahildir |
| `pro.feature.bulkPhotoStudio.body` | Add, replace, reorder and caption photos on many listings at once, with AI quality and background tools. | Birçok ilanda fotoğrafları tek seferde ekleyin, değiştirin, sıralayın ve alt metin yazın; AI kalite ve arka plan araçlarıyla. |
| `pro.feature.bulkPhotoStudio.p1` / `.p2` / `.p3` | One change on 100 listings in one step / AI alt text for every photo / Videos on many listings at once | 100 ilanda tek adımda aynı değişiklik / Her fotoğraf için AI alt metin / Birçok ilana aynı anda video |
| `pro.feature.arbitrage.title` | Price gap is part of Pro | Fiyat farkı analizi Pro planına dahildir |
| `pro.feature.arbitrage.body` | Find Trendyol products that sell for more on eBay and Etsy, with landed cost from your own shipping labels. | eBay ve Etsy'de daha pahalıya satılan Trendyol ürünlerini, kendi kargo etiketlerinizden hesaplanan toplam maliyetle bulun. |
| `pro.feature.arbitrage.p1` / `.p2` / `.p3` | Matches with a confidence level / Margin after fees and shipping / List on eBay in one click | Güven düzeyli eşleşmeler / Komisyon ve kargo sonrası marj / Tek tıkla eBay'de listeleme |
| `pro.feature.arbitrage.inlineNote` | Price gap needs Pro | Fiyat farkı analizi için Pro gerekir |
| `pro.palette.caption` | Pro | Pro |
| `photoStudio.title` | Photo studio | Fotoğraf stüdyosu |
| `photoStudio.tabs.photos` / `.video` | Photos / Video | Fotoğraflar / Video |
| `photoStudio.op.label` / `.position` / `.source` | Do / at position / from | İşlem / konum / kaynak |
| `photoStudio.op.add` / `.replace` / `.delete` / `.move` / `.alt` / `.enhance` / `.removeBg` / `.copy` | Add / Replace / Delete / Move / Alt text / Improve quality / Remove background / Copy from… | Ekle / Değiştir / Sil / Taşı / Alt metin / Kaliteyi iyileştir / Arka planı kaldır / Şuradan kopyala… |
| `photoStudio.source.upload` / `.ai` / `.url` | Upload / Generate with AI / Image link | Yükle / AI ile oluştur / Görsel linki |
| `photoStudio.position.end` | End | Sona |
| `photoStudio.appliesTo` | Applies to {count} selected | Seçili {count} ilana uygulanır |
| `photoStudio.stage` | Stage {count, plural, one {# photo change} other {# photo changes}} | {count} fotoğraf değişikliğini hazırla |
| `photoStudio.meta` | {listings} listings · {count} photo changes staged here · not sent yet | {listings} ilan · burada {count} fotoğraf değişikliği hazırlandı · henüz gönderilmedi |
| `photoStudio.full` | {count} listings already have 20 photos | {count} ilanda zaten 20 fotoğraf var |
| `photoStudio.filter.noPhotos` / `.lt5` / `.missingAlt` | No photos / Fewer than 5 / Missing alt text | Fotoğrafsız / 5'ten az / Alt metni eksik |
| `photoStudio.video.add` / `.remove` | Add video to selected / Remove video from selected | Seçililere video ekle / Seçililerden videoyu kaldır |
| `photoStudio.mobile` | Add photos one listing at a time in the editor | Fotoğrafları düzenleyicide ilan ilan ekleyin |

## 6. Implementation split

| Group | Milestone | Owns |
|---|---|---|
| **G-pro-1 Primitives** | M1 | `components/ds/data/PlanTag.tsx`, the `locked` kind in `components/ds/state/EmptyState.tsx` (M1 EmptyState owner adds it in the same PR), `components/ds/state/FeaturePreview.tsx`, `LockKeyhole` row in `lib/ds/icons.ts` (via the M1 icons owner), tests (render with trial / starter / pro / shopify_free / unknown fixtures) |
| **G-pro-2 Gate** | M4 (needs `useEntitlement`) | `components/domain/billing/FeatureGate.tsx`, `lib/billing/{featureMap,useFeatureAction}.ts`, the `featureLocked` mapping in `lib/http/limitInterceptor.ts` (**delta handed to shell-nav F**, which owns that file), `__tests__/billing/featureGate.test.tsx` incl. the settings §11 assertions |
| **G-pro-3 Previews** | M9 / M7 / R4 | `public/previews/*.png` produced by the Playwright screenshot pipeline from fixtures (investor-deck pipeline pattern), EN + TR |
| **M7-E PhotoStudio** | M7 | `pages/app/etsy-listings/photos.tsx`, `components/domain/photo-studio/{PhotoStudioPage,OperationBar,ListingStripRow,PhotoDetailPanel,VideoTab,usePhotoStudio}.tsx`, `pages/api/etsy-drafts/batch-media.ts`; ports the staging logic from `BulkPhotoStudio.tsx`/`BulkVideoStudio.tsx` (those files are deleted with `BulkEditor` one release after M7) |
| Consumers | M9 / R4 / M7 | finance-analytics C/F wrap Profit/Payouts/Transactions in `FeatureGate`; research R4 wraps Price gap; bulk-grid M7-C uses `useFeatureAction('bulkPhotoStudio')` |

Server gates (finance handlers, `clawd/arbitrage.ts`, job runner) belong to the billing backend track (tiers.md); this spec only consumes their 402s.

## 7. Tests
- `PlanTag` returns `null` for `stripeUpsell` false and unknown.
- For each gated entry point (§2) a render test per plan fixture: trial (tag + works), starter (tag + locked route), pro (no tag), shopify_free (not rendered; neutral page by URL contains no "Pro", "Stripe", `/fiyatlandirma` or currency symbol), unknown (renders, no tag, no Stripe link).
- 402 `featureLocked` from a mocked `/api/finance/dashboard` swaps the Profit body to the locked state and fires no toast and no `LimitReachedDialog`.

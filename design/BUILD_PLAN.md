# Build plan: milestones, file ownership, i18n, migrations, backend integration

Status: binding for every agent working in `kx-ux-phase0`. Date: 2026-10-15. Resolves CRITIQUE **B6** (and closes the ownership halves of C4, C5, C13, C22, C26, C27).
Inputs: `DESIGN_SYSTEM.md` §7, the 8 + 4 surface specs (`design/surfaces/*.md`, each with its own "Implementation split"), `CRITIQUE.md`, `docs/integration/etsy-webhook-ui.md` (backend session checklist), `design/launch/tiers.md`, the working tree on 2026-10-15 (M0, R0 and logo work already in progress: `lib/ds/tokens.ts`, `lib/ds/logos.ts`, `lib/research/stats.ts`, `eslint.config.mjs`, `public/logos/*.svg`).

Where a surface spec's split table disagrees with this file, **this file wins** (it is the only place that sees all of them). Each conflict is listed in §3.

---

## 0. Rules for every agent

1. **One owner per file at any moment.** A file is owned by exactly one group of the milestone that is running. Ownership passes to the next milestone's group only after the previous PR is merged to `main`. A group that needs a change in a file it does not own writes it into its result as an `outOfScopeNeeds` item (file, location, exact change) for the owner or the integrator.
2. **i18n is central.** No agent edits `messages/en.json` or `messages/tr.json`, and no agent writes `messages/fragments/*` (that folder is the backend session's channel only). Every agent returns `newI18nKeys: { namespace, key, en, tr }[]`. The **integrator** merges them, runs the key-parity test (`__tests__/i18n/parity.test.ts`, integrator-owned, added in M1) and the ASCII-Turkish check (`Olustur|Gonder|Siparis|Iptal|Odeme`). This supersedes CRITIQUE C26's per-group fragment files and every surface split that names a group as "owner of the message files" (orders G6, overview G7, listings G7, settings G, finance F, shell F). The integrator never touches the backend session's namespaces: `etsyOps`, `listingHistory`, `liveOrders`, `notificationCenter`, `orderPipeline`, `seoExperiments`, `stockSync`.
3. **Migrations belong to the backend session.** No UI group edits `prisma/*`. UI groups code against the schema requests in §5 and ship behind a guard (feature off, or the field read as optional) until the backend session reports the migration deployed on Hetzner.
4. **Backend-owned paths are import-only** (§1). Need a change there → §6 request.
5. **`package.json` / `yarn.lock`**: only the m0 group (yarn; the repo's lockfile is `yarn.lock`).
6. **Registries are declared once** (§2), so later groups never edit them.
7. Every group: `npx next build --webpack` and its own tests before finishing; type-check only its own files (`npx tsc --noEmit -p . | grep <its paths>`), no git commit unless the run says so, no dev server, no DB, no production.

---

## 1. Backend-owned paths (import only for every UI group)

`lib/orderSync.ts`, `lib/integrations/etsyOrderSync.ts`, `lib/etsy/**` (includes `draftService.ts`, `draftClient.ts`, `seoRules.ts`, `validation.ts`, `variantKey.ts`), `lib/stock/**`, `lib/live/**`, `lib/notifications.ts`, `pages/api/notifications/*`, `pages/api/labels/*`, `pages/api/orders/[orderId]/generate-label.ts`, `pages/api/orders/[orderId]/submit-tracking.ts`, `pages/api/shipments/*`, `prisma/*`, `components/live/**`, `components/stock/**`, `components/etsy-history/**`, `components/etsy-seo/**`, `components/notification-center/**`, `components/etsy-ops/**`, `components/orders-live/**`, `pages/app/stok-senkron.tsx`, `pages/app/etsy-aktivite.tsx`, `pages/app/bildirimler.tsx`, plus the seven i18n namespaces above and `messages/fragments/*`.

Consequences already applied to the surface specs by this plan:
- listing-editor §7.1 **G1** (`getDraftDiff`, `resolveDraft`, `listSyncedDrafts` in `lib/etsy/draftService.ts`) → backend request **BR-3** (§6). The route files `pages/api/etsy-drafts/[id]/{diff,resolve}.ts` and `pages/api/etsy-drafts/history.ts` stay UI-owned (M6 Group G) and import the new functions.
- orders **G7** (`pages/api/labels/rates.ts`) and overview **G2** (`pages/api/labels/{ups,mng}.ts` failure writes) → backend requests **BR-5**, **BR-6**.
- New batch endpoints (`pages/api/etsy-drafts/batch-stage.ts`, `batch-media.ts`) are UI-owned route files that **import** `upsertDraftPatch`; they never edit `lib/etsy/**`.

---

## 2. Registries declared once (nobody edits them after their milestone, except the integrator)

| Registry | Created by | Content fixed at creation | Later changes |
|---|---|---|---|
| `lib/ds/uiFlags.ts` | M0 | **All** flag keys now: `orders`, `settings`, `pricing`, `listings-etsy`, `listings-ebay`, `listings-trendyol`, `listings-wix`, `listings-shopify`, `editor-etsy`, `editor-ebay`, `editor-trendyol`, `editor-wix`, `editor-shopify`, `bulk`, `photo-studio`, `overview`, `messages`, `reports`, `research` (+ `NEXT_PUBLIC_UI_V2` parsing, `?ui=` override with try/catch localStorage) | integrator flips defaults |
| `lib/ds/tokens.ts`, `styles/tokens.css` | M0 | DS §2 + CRITIQUE C18 `backdropPanel`, C19 toast `+8px`, X7 `--kx-topbar-current` | integrator (DS patch PRs) |
| `lib/ds/logos.ts` + `public/logos/*` | M0 logo group (exists in the tree) | see §2.1 | logo group until M2, then integrator |
| `lib/ds/icons.ts` | M1-a | every meaning from DS §3.15 plus all surface additions: settings §14 (`Plug`, `KeyRound`, `Warehouse`, `CreditCard`, `Globe`, `History`), orders §0.3, shell-nav §14, research (`Telescope`), pro-gating (`LockKeyhole` = locked), stock sync (`Boxes`), Etsy activity (`Activity`), notifications (`Bell`). M1-a greps every `surfaces/*.md` for "icon" before freezing | integrator |
| `lib/ds/status/*.ts` + `status.*` keys | M1-a | every domain and key from DS §3.9 + listings (`in_review`, `rejected`) + messages (`in_review`, `answer_rejected`) + subscription ×8 + invoice ×4 + run ×3 + tracking ×2 + `sync.refresh_failed` (CRITIQUE C26) | integrator |
| `lib/nav/navConfig.ts` | M2 shell-A | shell-nav §2.1 + the backend nav entries (§7 item 6) | integrator only: `RESEARCH_HOME` flip (R1 PR), Reports merge (M9 PR) |
| `design/migrated-paths.json` | M0 | empty array | integrator |
| `__tests__/i18n/parity.test.ts` | integrator (M1) | — | integrator |

### 2.1 Real logos (founder decision: real logos, not monograms)
- `LogoTile` reads **`lib/ds/logos.ts`** (exists: `LogoAsset { provider, src, monoSrc, name, color, initials, kind: 'mark'|'monogram' }`, sources in `design/logos/SOURCES.md`). It is the DS §4.1 brand registry: **`lib/ds/marketplaces.ts` is not created**; shell-nav §1's `public/logos/marks/*` folder and its "monogram until a mark lands" default are superseded. The monogram renders only as the `onError` fallback of `LogoTile`.
- Rules (unit test `__tests__/ds/logos.test.ts`, logo group): every `src`/`monoSrc` exists; SVGs have a square `viewBox` and no `<text>`; `kind: 'mark'` entries are the owner's official mark (nominative use, source URL in `SOURCES.md`).
- **Open gaps in the current tree** (logo group, before M2): `trendyol` and `hepsiburada` still point at `.png` files that shell-nav §1 measured as wordmarks on a 600×600 canvas (unreadable at 16 px); `shopify.jpg` remains next to the new `shopify.svg`. Marketing pages (`components/marketing/HomeContent.js` L23–L34, `pages/entegrasyonlar.js` L29–L31) still reference `trendyol.png` and `shopify.jpg`, so those two files must not be deleted until marketing switches (out of scope; keep them).

---

## 3. Contested files: one owner, in order (resolves every collision between surface split tables)

| File | Claimed by | Decision (owner per milestone, in order) |
|---|---|---|
| `messages/en.json`, `messages/tr.json` | shell F, orders G6, overview G7, listings G7, settings G, finance F, editor integrator | **Integrator only** (§0.2) |
| `prisma/schema.prisma`, `prisma/migrations/*` | listings G0, messages G1, settings F (A6), editor G3, research R2/R3, tiers `billing_v2` | **Backend session only** (§5) |
| `pages/_app.tsx` | M0 (lang sync, `next/font`, Toaster position), shell F (AppShell mount), backend item 1 (done) | M0 → M2 shell-F |
| `components/AppLayout.js` | I0 (backend item 6 nav entries), shell F (shim) | I0 → M2 shell-F |
| `components/CommandPalette.tsx` | I0 (item 6 routes), overview G4, shell E (replaced by `ds/shell/CommandPalette.tsx`) | I0 → M2 shell-E (moves it); **overview G4 does not edit it**: Overview registers commands through `useCommand` |
| `pages/app/etsy-listings.tsx` | I0 (items 3, 11), listings G7, overview G4 (`?open=` reader), editor integrator, bulk integrator | I0 → M5 listings-G7 (moves the body to `components/legacy/listings/EtsyListingsLegacy.tsx`, route becomes a flag switch) → frozen. Overview's `?open=` reader lives in `ListingsPage` (listings G5) instead; editor/bulk wiring edits `ListingsPage`/config, not the route |
| `pages/app/labels.tsx` | I0 (items 4, 9 voided rule), orders G2 | I0 → M3 orders-G2 |
| `components/UPSLabelDrawer.tsx`, `components/MngLabelDrawer.tsx` | I0 (item 4) | I0; deleted by M3 cleanup |
| `components/NotificationBell.tsx`, `lib/hooks/useNotifications.ts` | I0 (item 5), shell C (`NotificationsButton`) | I0 → M2 shell-C (renders the backend `NotificationPanel`, import only) |
| `components/etsy/VariationEditor.tsx` | I0 (item 7), editor Group D (embedded mode) | I0 → M6 editor-D |
| `components/etsy/ListingEditorDrawer.tsx` | I0 (item 8b data-loss fix), listings (import removal) | I0 → M6 (deleted one release after `editor-etsy`) |
| `pages/api/clawd/etsy.ts` | R0 (now: `search_market`/`analyze_niche`/`get_discovery_data`), listings G2 (`sync_listings`), research R1-B, editor G2 (`search_market` p25/p75), research R2-A (rank actions) | **R0 → M5 listings-G2 → R1-B → R2-A.** Editor API G2 is **dropped**: R1-B already returns `priceStats.{p25,p75,n,excluded}` through `lib/research/etsySearch.ts` |
| `pages/api/{trendyol,wix,shopify}/products.ts` | listings G2 (sync blocks), M6b-B (new actions) | M5 listings-G2 → M6b-B |
| `pages/api/catalog-drafts/index.ts`, `lib/catalogDrafts/**` | listings G4, M6b-A (v2 keys, create), M7-B (`items[]`) | M5 listings-G4 → whichever of M6b-A / M7-B is scheduled first (default **M7-B then M6b-A**, §4) |
| `pages/api/etsy-drafts/[id]/index.ts` | listings G4 (`scheduledSendAt` PATCH), editor G (diff/resolve are separate files) | M5 listings-G4 |
| `lib/orders/views.ts` | shell B (creates), orders G1 (extends), overview G1 (extends) | M2 shell-B → M3 orders-G1 → M8 overview-G1 |
| `pages/api/orders/index.ts` | orders G1, overview G1 | M3 orders-G1 → M8 overview-G1 |
| `lib/marketplaces/canonical.ts` | orders G1 (creates), finance A ("new") | M3 orders-G1 creates; finance A **imports only** (its "new" is superseded, CRITIQUE C5) |
| `lib/fx.ts` | overview G1 (creates), finance B11 | M8 overview-G1 creates; M9 imports. If M9 runs first, finance-A creates it with the same `convertToBase` signature (overview §4.1) |
| `components/ds/data/DataTable.tsx` | M1, overview G5 (optional pagination), finance Group 0 (`type: 'share'`), M7-A (grid mode) | **M1 builds optional pagination, `share` and `caption` up front (CRITIQUE C22)** → M7-A (grid mode). Overview G5 and finance Group 0 make **no** DataTable edits |
| `components/ds/data/KpiTile.tsx`, `Chart.tsx` | M1, finance Group 0 | M1 builds `caption` and the series `role` up front; finance Group 0 is reduced to tests |
| `components/ds/data/StatusPill.tsx`, `lib/ds/status/*` | M1, orders G1 ("if absent"), listings G0, messages G4, settings A, overview G5 | **M1-a only** (§2) |
| `components/ds/state/EmptyState.tsx` | M1, pro-gating (`locked` kind) | M1 builds `locked` |
| `components/ds/inputs/{DateTimeField,FieldSuggestion}.tsx`, `TagInput.suggestions`, `FormField.dirty/onRevert` | listings G5 (`DateTimeField`, CRITIQUE C13), editor Group S | **M1-b** builds all four (signatures in listing-editor §4.6). This moves C13's "listings G5 builds `DateTimeField`" into M1; listings G5 and editor S only consume |
| `lib/listingScore/**` | M1 (`types`, `etsy`), listings G3, editor Group E | M1 → M5 listings-G3 (owns all of `lib/listingScore/**` from then on) → editor E and M6b-E request deltas from it, or own deltas only after M5 merged |
| `lib/nav/navConfig.ts` | shell A, finance F (Reports merge), research (home flip), I0/item 6 | M2 shell-A → integrator |
| `lib/http/limitInterceptor.ts` | shell F (C6 skip-list), pro G-pro-2 (`featureLocked`) | M2 shell-F (includes the `featureLocked` swap hook from pro-gating §3.5) |
| `lib/middleware/withUsageLimiter.ts` | shell B (import), overview G2 (`getUsageSnapshot`), tiers backend | **Billing backend track** (tiers.md). `getUsageSnapshot` lives in `lib/billing/` (CRITIQUE C8), billing track |
| `pages/api/user/settings.ts` | shell B (`subscription.limits`), settings F (A6 timezone) | M2 shell-B → M4 settings-F |
| `lib/ds/uiFlags.ts` | listings G7, editor A, finance F, settings G, overview G6 | M0 declares all keys (§2); nobody adds keys later |
| `components/ds/page/Page.tsx` | M1, shell F (wire to `ShellContext`) | M1 → M2 shell-F |
| `lib/listingEditor/sections.ts` | editor Group A, M6b-C | M6 editor-A → M6b-C |
| `components/domain/listing-editor/useListingAI.ts` | editor Group H, M6b-E | M6 editor-H → M6b-E |
| `public/logos/*`, `lib/ds/logos.ts` | logo group (now), shell B (marks), DS M1 ("LogoTile + SVGs") | logo group (M0) → integrator; shell B and M1 do not touch assets |

---

## 4. Milestones and their groups (who owns what)

Order (product track and research track in parallel; a later milestone may start when its inputs are merged):

```
week 1        I0 ─────┐   M0 ───────┐   R0 (in progress)
week 1–2              │             M1 ───────────────┐
week 3                └──────────── M2 ──┐            R1 (after M1; R1-B after M5-G2)
week 4–5                                 M3 ∥ M4      │
week 6–7                                 M5 ──────────┤ R2
week 8–9                                 M6 ── M6b    │
week 10–11                               M7           R3
week 12                                  M8           R4 (needs pro-gating G-pro-2 from M4)
week 13                                  M9
week 14                                  M10 cleanup
```

| Milestone | Groups (owned files; details in the cited spec section) | Exit |
|---|---|---|
| **I0 Backend checklist on legacy files** (days 1–2) | One group, exclusive: `pages/app/etsy-listings.tsx`, `pages/app/labels.tsx`, `components/UPSLabelDrawer.tsx`, `components/MngLabelDrawer.tsx`, `components/NotificationBell.tsx`, `lib/hooks/useNotifications.ts`, `components/AppLayout.js`, `components/CommandPalette.tsx`, `components/etsy/VariationEditor.tsx`, `components/etsy/ListingEditorDrawer.tsx`, `pages/ayarlar.tsx` (item 12 link only). Scope = §7 "I0" column | founder test: new Etsy order chimes and appears; a cancelled order's label shows the dialog |
| **M0 Foundation** | m0: `package.json`, `yarn.lock`, `lib/theme.tsx`, `lib/ds/tokens.ts`, `styles/tokens.css`, `styles/globals.css`, `pages/_document.js`, `pages/_app.tsx`, `eslint.config.mjs`, `lib/ds/uiFlags.ts`, `design/migrated-paths.json`, the uppercase/gradient sweep files **except** I0's files (I0 merges first; the sweep rebases onto it) and except backend-owned files (§6 BR-9); logo group: `lib/ds/logos.ts`, `public/logos/*`, `design/logos/SOURCES.md` | DS §7.2 M0 |
| **R0 Honesty patch** | research-R0: `lib/research/stats.ts` (exists), the three `clawd/etsy.ts` blocks, `components/etsy/research/**`, `components/ebay/research/**` touched files, `pages/app/{etsy,ebay}-research.tsx` (hero/FAB/duplicate search deletions, research.md §14.1), `lib/stores/use*ResearchStore.ts` | RR §5 R0 |
| **M1 Primitives** (proposed cut; the M1 lead may re-cut but keeps one owner per file) | M1-a foundations: `lib/format.ts`, `lib/ds/status/*`, `lib/ds/icons.ts`, `lib/text/decodeEntities.ts` (re-exports `decodeEntities` from `lib/research/stats.ts`), `components/ds/format/*`, `StatusPill` · M1-b inputs: `components/ds/inputs/*` (incl. `DateTimeField`, `FieldSuggestion`, `TagInput.suggestions`, `FormField.dirty` from listing-editor §4.6 so M6 Group S shrinks to `SectionNav` + `ImageGrid strip`) · M1-c overlays/feedback/state: `components/ds/overlay/*`, `components/ds/feedback/*`, `components/ds/state/*` (incl. `locked`, `FeaturePreview`), `useAsyncState` · M1-d data: `components/ds/data/*` (DataTable with optional pagination + `share`, KpiTile `caption`, Chart `role`, ScoreMeter/ScorePanel, Thumb, LogoTile, PlanTag, UsageMeter), `components/ds/research/*`, `lib/listingScore/{types,etsy}.ts` · M1-e page/toolbar/hooks: `components/ds/page/*`, `components/ds/toolbar/*`, `lib/ds/{useUrlState,useShortcuts}.ts` · M1-f shims: `components/ui/*`, `components/settings/ui/*` · integrator: parity test | every component has a render test (EN/TR) |
| **M2 Shell** | shell-nav §12 groups A–F with these deltas: B drops `public/logos/marks/*` and `lib/ds/marketplaces.ts`; F does **not** write message files; C's `NotificationsButton` renders the backend `NotificationPanel`; A's navConfig includes §7 item 6 | DS §7.2 M2 |
| **M3 Orders** (flag `orders`) | orders §13 G1–G5 (G6 i18n → integrator; G7 rates → backend BR-5) | orders §13 exit |
| **M4 Settings** (parallel with M3) | settings §17 A–F (G i18n → integrator; F's A6 migration replaced by BR-2 decision); **pro G-pro-2** (`FeatureGate`, `featureMap`, `useFeatureAction`) joins here because it needs `useEntitlement` (settings D) | DS §8 |
| **M5 Listings** (flags `listings-*`) | listings-grid §14 G0–G8 with deltas: G0's schema work → backend BR-1 (G0 keeps `lib/listings/types.ts`, config types, and nothing in `prisma/`; status map is M1-a's); G7 does not merge i18n; G2 is the `clawd/etsy.ts` owner during M5 | listings §15 |
| **R1 Research hub** | research.md §15 R1-A…R1-E (R1-B waits for M5-G2 to merge `clawd/etsy.ts`) | research §16 |
| **M6 Editor Etsy/eBay** (flags `editor-etsy`, `editor-ebay`) | listing-editor §10 S, A–H with deltas: S builds only `SectionNav` + `ImageGrid strip` (rest moved to M1-b); E owns tests + rail components only (score files: M5-G3); G's `lib/etsy/draftService.ts` functions → backend BR-3, G keeps the route files; G2 dropped (§3); G3 already moved to listings | listing-editor DoD |
| **M6b Editor Trendyol/Wix/Shopify** (flags `editor-trendyol`, `editor-wix`, `editor-shopify`) | marketplace-editors.md §11 M6b-A…E | marketplace-editors §11 verify list |
| **R2 Keyword explorer** | research.md §15 R2-A, R2-B (needs BR-1b `ResearchKeywordNote`) | |
| **M7 BulkGrid** (flag `bulk`, `photo-studio`) | bulk-grid.md §11 M7-A…E; pro-gating §6 M7-E PhotoStudio | bulk-grid §9 acceptance test |
| **M8 Overview + Messages** | overview §8 G1, G3, G4 (minus `CommandPalette.tsx`), G6 (G2 → billing track + backend BR-6; G5 → already in M1; G7 → integrator) · messages §8 G1–G6 (G1's schema → backend BR-4) | DS §8 |
| **R3 Shop tracker** | research.md §15 R3-A, R3-B (needs BR-1c, BR-7, BR-8) | |
| **M9 Reports** | finance-analytics §10 groups A–E (Group 0 reduced to tests; F's nav/i18n/flag work → integrator); Profit/Payouts/Transactions wrapped in `FeatureGate` | finance §11 |
| **R4 Price gap** | research.md §15 R4 | |
| **M10 Cleanup** | DS §7.2 M10 + remove `@mui/x-data-grid` (m0 owner of `package.json`) once no legacy page imports it | zero lint warnings |

The **integrator** (one session, last in every milestone) owns: `messages/*.json`, `design/migrated-paths.json`, flag default flips, `lib/nav/navConfig.ts` after M2, registry additions (§2), the DS/tokens/RR doc patches listed in CRITIQUE §6 and in the "Resolved" section, the founder-verification runs, and deletion PRs one release after each flag flip.

---

## 5. Schema needs the UI hands to the backend session (no UI group writes these)

| ID | Needed by | Change | Notes |
|---|---|---|---|
| **BR-1a** `listings_grid` | M5 | `healthScore Int?`, `healthChecksUsed Int?`, `healthChecksTotal Int?`, `healthFails String[] @default([])` + `@@index([<store key>, healthScore])` on `EtsyListing`, `EbayListing`, `TrendyolProduct`, `WixProduct`, `ShopifyProduct`; `skus String[] @default([])` on `EtsyListing`; `scheduledSendAt DateTime?` + index on `EtsyListingDraft`, `EbayListingDraft`; new model `CatalogDraft` (listings-grid §9.3, incl. `scheduledSendAt`) | **`EtsyListing.hasVariations` already exists** (backend W3, migration `20261015100300_etsy_listing_intel`), so it is dropped from this request |
| **BR-1b** `research_keyword_note` | R2 | `ResearchKeywordNote` (research.md §12) | |
| **BR-1c** `research_watch` | R3 | `ResearchWatch`, `ResearchSnapshot` (RR §4.3) | shared cache needs **no** migration (`ResearchCache.userId = '__public__'`) |
| **BR-2** timezone | M4 | **No new column proposed.** `NotificationSettings.timezone` (default `Europe/Istanbul`) already exists (backend W5). Proposal: it is the account timezone for the whole UI; the backend exposes read/write through its preferences API, and settings A6's `User.timezone` migration is dropped. Backend session decides; if it refuses, A6 stands as written | avoids two timezone sources |
| **BR-2b** `billing_v2` | M4 | tiers.md migration, plus settings A5 `cancelAtPeriodEnd` | billing backend track |
| **BR-4** `inbox_thread_saved_reply` | M8 | `InboxThread`, `SavedReply` + `User` relations (messages §6.2, §6.4) | |
| — | M3, M6, M6b, M7, M9, pro-gating, shell | **no schema change** (`CatalogDraft.fieldPatch`/`queuedActions` are JSON; package presets live in `shippingSettings` JSON) | |

Order on production (each against a copy of the Hetzner DB first, CRITIQUE C27): BR-2b → BR-1a → BR-4 → BR-1b → BR-1c.

## 6. Non-schema requests to the backend session

| ID | Request | For |
|---|---|---|
| BR-3 | `lib/etsy/draftService.ts`: `getDraftDiff(draftId, userId)`, `resolveDraft(draftId, userId, keep: string[])`, `listSyncedDrafts(shopId, listingId, limit)` (listing-editor §7.1 G1 contract) | M6 conflict review, rail history |
| BR-5 | `pages/api/labels/rates.ts` + `lib/{fedex,ups}/rates.ts` (orders §9 A7) | M3 follow-up (A7) |
| BR-6 | `pages/api/labels/{ups,mng}.ts`: write `LabelJob{status:'failed', errorMessage}` on failure; UPS `result.success` check (overview §4.3.1) | M8 failed-label queue |
| BR-7 | Notification types + templates: `researchShopNewListings`, `researchShopPriceDrop`, `researchShopSalesSpike`, `researchRankDrop`, `scheduledSendResult` ("3 scheduled changes sent to Etsy · 1 failed") | R3, M5 cron |
| BR-8 | Job registration (`lib/scheduler/jobs.ts` or `cron-daily.yml`): `send-scheduled-drafts` every 5 min (M5), `research-snapshots` daily (R3) | M5, R3 |
| BR-9 | DS P5 on backend components: remove `uppercase` from `components/notification-center/{NotificationFeed.tsx:256, NotificationPanel.tsx:91, NotificationPreferencesPanel.tsx:345}` and move their `slate-*`/hex classes onto DS tokens (the panel is rendered inside the new shell) | M0/M2 |
| BR-10 | `CancelledOrderLabelDialog` and `DispatchHealthCard` accept a `variant="ds"` (or are restyled to DS tokens) so they render inside `CreateLabelPanel` and the Overview without a second visual language | M3, M8 |
| BR-11 | `useStockManaged` exported for list use (batch: `useStockManagedMany(listingIds)`), so BulkGrid can mark managed quantities without N hooks | M7 |
| BR-12 | `EtsyListingDailyStat` read helper for 30-day sums per listing (`sumListingStats(shopId, listingIds, days)`) | R1 Listing doctor |

---

## 7. Backend checklist (`docs/integration/etsy-webhook-ui.md`) items 3–12 → milestones

Items 1 and 2 are done in the tree (`pages/_app.tsx` mounts `LiveAppMount`; `components/AppLayout.js` has `LiveSoundToggle`).

| # | Item | Priority | I0 (legacy file, now) | Final home (new UI) |
|---|---|---|---|---|
| 3 | Etsy listings live refresh, DB-only (W3 §2b, W6 §3) | REQUIRED | `pages/app/etsy-listings.tsx`: `refetchListingsFromDb` on `listing.changed`/`listing.removed`/`sync.finished`; never `fetchListings()` | **M5** `useListings` (listings G5): `useLiveRevalidate(['listing.changed','listing.removed','sync.finished'])` revalidates `GET /api/listings`, which is DB-only by design. Same in BulkGrid (M7-C) and the editor (M6 A: refresh the live snapshot, never overwrite a dirty field) |
| 4 | Label 409 `ORDER_CANCELLED` / `ORDER_SHIPPED_EXTERNALLY` → `CancelledOrderLabelDialog` → retry with `forceCancelled` (W4 §2a–c) | REQUIRED (blocking since backend deploy) | `UPSLabelDrawer.tsx`, `MngLabelDrawer.tsx`, `labels.tsx` (FedEx) | **M3** `CreateLabelPanel` (orders G4) and `BulkCreateLabelsPanel`: on 409 open the dialog as `Modal nested` (z 1550, import from `components/orders-live`), retry with `forceCancelled: true`; bulk: the row reads "Cancelled on Etsy · Create anyway" and is skipped unless confirmed per row |
| 5 | Bell → `NotificationPanel`, `X-KX-Locale` header, no order sound on `notification.raised`, badge counts `badge=true` only (W5 §2–3, §9) | REQUIRED | `components/NotificationBell.tsx`, `lib/hooks/useNotifications.ts` | **M2** shell-C `NotificationsButton` renders `NotificationPanel` (desktop popover 380, mobile sheet), hook keeps the header; BR-9 restyle |
| 6 | Nav + ⌘K entries: `/app/stok-senkron`, `/app/etsy-aktivite`, `/app/bildirimler` | REQUIRED | `components/AppLayout.js` nav + `components/CommandPalette.tsx` routes | **M2** `navConfig`: "Stock sync" row in the Listings group after the marketplaces (icon `Boxes`, shown when ≥ 2 stores are connected or stock sync is set up); "Etsy activity" is **not** a nav row: it is the Etsy listings PageHeader ⋯ "Activity" (M5 config) and a ⌘K "Go to" entry; "Notifications" is the bell's "See all" + ⌘K entry + Settings › Preferences link. Breadcrumb for `/app/etsy-aktivite`: `Listings › [E] Etsy › Activity` |
| 7 | `VariationEditor`: managed-quantity chip, skip managed variants in bulk qty apply, stamp `kx_loaded_quantity` before staging (W2 §1b, W1 cross-workstream) | RECOMMENDED (data correctness) | `components/etsy/VariationEditor.tsx` | **M6** editor-D embedded mode keeps all three; **M7** BulkGrid Qty read-only for managed listings (BR-11); **M5** listings inline Qty read-only with the same reason |
| 8 | `ListingEditorDrawer`: History tab (`ListingHistoryPanel`, `applyRestoredDraft`) and overlay the server draft's `fieldPatch` on open (pre-existing data-loss bug, W3 §1, §10) | RECOMMENDED; 8b is a data-loss fix | 8b only (overlay on open). 8a skipped on the legacy drawer | **M6**: footer ⋯ "History" opens `ListingHistoryPanel` in a `SidePanel lg`; restore → `useListingDraft.restore()` (stages, never sends). 8b is inherent: `useListingDraft` loads the DB draft first |
| 9 | Labels page: `useOrderLifecycleFlags` + `OrderLifecycleBadges`, `?highlight=` + "New" chip for live arrivals, `labelStatus === 'voided'` = no label (W4 §2c, §8; W6 §2) | RECOMMENDED; the voided rule is correctness | voided rule only (`labels.tsx`) | **M3**: voided rule in `lib/orders/toOrderRows.ts` (G1); lifecycle flags as the caption under the order pill in `orderColumns` and as an OrderPanel section (1-pill rule); `?highlight=<id>` maps to `?open=<id>` (G2); live arrivals get the row meta "New" for 10 min |
| 10 | `DispatchHealthCard` on the dashboard (W4 §2d) | RECOMMENDED | skipped (legacy dashboard is replaced) | **M8** Overview: a queue row ("3 orders at risk of shipping late") linking to the card's detail; the card itself renders in Reports › Sales "Dispatch" section only if BR-10 restyles it |
| 11 | Freshness chip next to "Sync from Etsy", warning toast on `data.partial` (W3 §2a, §2d) | OPTIONAL | skipped | **M5** `SyncMeta` meta line uses the chip's wording ("Etsy live · last change 2 min ago" / "Checked daily · last check …"), never the word "webhook"; `partial` → `ErrorState variant="stale"` line, not a toast |
| 12 | Settings link to `/app/bildirimler?tab=preferences` (W5 §5) | OPTIONAL | one link in `pages/ayarlar.tsx` | **M4** Settings › Preferences row "Notification settings ›" |

---

## 8. Open founder decisions (UI is built for the recommended answer)

| ID | Decision | Recommended | Where |
|---|---|---|---|
| D-B1 | BulkGrid base: DS DataTable vs MUI X Premium license | DataTable (verified Community limits, bulk-grid §0) | bulk-grid §12 |
| D-P1 | "Financials (Pro)" = Profit + Payouts + Transactions; Sales free | yes | pro-gating §1 |
| D-R1 | Research watch limits: Trial 3 · Starter 10 · Growth 25 · Pro 50 · shopify_free 10 | yes | research §1.2 |
| D-R2 | Seasonal calendar kept on Research Home | yes (CRITIQUE V5) | research §4.1 |
| D-T1 | Account timezone = `NotificationSettings.timezone` (BR-2) | yes | §5 |
| D-L1 | Trendyol and Hepsiburada square marks (replace the 600×600 PNG wordmarks in `lib/ds/logos.ts`) | yes, before M2 | §2.1 |

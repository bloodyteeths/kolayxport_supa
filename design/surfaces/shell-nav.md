# Surface: App shell and navigation (`AppShell`, `SideNav`, `TopBar`, `MobileTabBar`, `CommandPalette`, page header usage)

Status: design spec, ready to build. Date: 2026-10-15. Milestone: **M2 Shell + header pass** (`DESIGN_SYSTEM.md` §7.2). Needs M0 (tokens, theme) and these M1 primitives: `LogoTile`, `Tooltip`, `IconButton`, `Button`, `OverflowMenu`, `BottomSheet`, `Modal`, `Banner`, `ErrorState`, `Skeleton*`, `UsageMeter`, `Kbd`, `DateText`, `useShortcuts`, `useToast`.
Contract: `DESIGN_SYSTEM.md` §3.1, §3.2, §4.2, §2.8 and §2.10. This file only adds detail. Where it adds to the system, the addition is listed and justified in §14.
Code read at `92087ba`: `components/AppLayout.js` (895 lines), `MobileTabBar.tsx`, `CommandPalette.tsx`, `NotificationBell.tsx`, `Layout.js`, `SidebarToggle.js`, `TrialNotification.tsx`, `withAuth.tsx`, `ui/PageHeader.tsx`, `hooks/useSidebar.js`, `hooks/useScreenSize.js`, `lib/hooks/useConnections.ts`, `lib/hooks/useNotifications.ts`, `lib/stores/useMessageCountStore.ts`, `lib/integrations/connectionStatus.ts`, `pages/api/user/settings.ts`, `pages/api/orders/index.ts`, `lib/middleware/withUsageLimiter.ts`, `pages/_app.tsx`, `messages/{en,tr}.json` (`nav`, `commandPalette`).

---

## 0. What changes, in one screen

| Today (verified in code) | After M2 |
|---|---|
| Every page mounts its own `AppLayout`, so the sidebar, the palette and the polling remount on every navigation. A module-level `pinnedMemo` hack works around the width snapping (`AppLayout.js:106`) | `AppShell` is mounted **once** in `_app` for app routes. `AppLayout` becomes a 15-line title shim, so no page has to change in the same PR |
| Rail with hover-to-expand overlay, plus a pin button (`AppLayout.js:306–351`). Default is the 64px rail | Expanded (240) by default at ≥1200. Automatic rail at 900–1199. No hover-expand. `[` or the footer button toggles, and the choice persists |
| 3 identical `Target` icons (research), 2 `Package` and 2 `ShoppingBag` (Trendyol/Wix, eBay/Shopify) (`AppLayout.js:133–158`) | Listing rows use real marketplace marks in `LogoTile`. Research is **one** item. A Vitest test fails the build if two items share an icon or a brand |
| Uppercase 10px group labels (`AppLayout.js:577`), red count badges, blue left-bar active pill, gradient brand tile and avatar | Sentence-case 12/500 group labels. Neutral tabular counts that turn red only when overdue. Active row is white with an `e1` hairline. Flat `KX` app icon |
| The TopBar shows an H1 page title, and pages add their own H1, so titles appear twice (finding #1) | The TopBar shows breadcrumbs only (desktop). `PageHeader` is the only title. `<title>` is "Page · KolayXport" |
| Language toggle "EN/TR" pill, search icon, bell, mail icon, and a gradient avatar that links to `/ayarlar` | `[⌕ Search or jump to…  ⌘K]` centered, bell, avatar menu (account, plan, **language**, shortcuts, help, sign out). Messages leaves the TopBar: it is already in the sidebar and the tab bar |
| Mobile (<640px) uses a 75vw left drawer that copies the sidebar, plus a tab bar | Mobile (<900px, the DS breakpoint) has no drawer. "More" opens a `BottomSheet` with the full nav and account rows |
| `TrialNotification` banner above every page; "All Features Free" on Overview | Plan and trial state live in the sidebar `UsageMeter`. A `Banner` appears only when the account is **blocked** (trial ended, no plan, or a limit reached) |
| A third shell: `components/Layout.js` (dark sidebar) used by `404`, `_error` and `logout` | Deleted. Those pages render `PublicLayout` |

---

## 1. Logos: what exists and what to add

`public/logos/` today (checked with `file` and by viewing the images):

| File | What it really is | Usable at 16/20px in nav? |
|---|---|---|
| `etsy.svg` | `<text>Etsy</text>` in Arial, viewBox 100×40. A wordmark rendered from a font, not the logo | **No** |
| `amazon.svg` | Full "amazon" wordmark with smile, 603×182 | **No** (wordmark) |
| `trendyol.png` | "trendyol.com" wordmark on a 600×600 canvas | **No** (unreadable at 16) |
| `hepsiburada.png` | Round multicolour ring with "hepsi burada" text, 600×600 | Ring readable at 24+, not 16 |
| `n11.png` | 2560×1357 wordmark, 128 KB | **No** |
| `shopify.jpg` | 1280×363 JPEG wordmark, 50 KB | **No** |
| `woocommerce.svg` | Wordmark, viewBox 512 wide | **No** (and not an integration) |
| `public/images/FedEx-Logo-PNG-Transparent.png`, `United_Parcel_Service_logo.png` | Carrier wordmarks | Not used in the shell |
| `public/icon-192x192.png` | Flat `#2563EB` rounded square with white "KX" | **Yes**: the shell brand mark |

**Conclusion: no existing file works as a square nav mark.** The shell needs square brand marks. Add them under a new folder so the wordmarks used by marketing pages (`components/marketing/HomeContent.js`, `pages/entegrasyonlar.js`) are not disturbed:

```
public/logos/marks/etsy.svg        public/logos/marks/ebay.svg
public/logos/marks/amazon.svg      public/logos/marks/shopify.svg
public/logos/marks/wix.svg         public/logos/marks/trendyol.svg
public/logos/marks/hepsiburada.svg public/logos/marks/n11.svg
```
Plus the carrier and tool marks the DS already lists (fedex, ups, dhl, veeqo, shippo, parasut, google). The shell uses only the five listing marketplaces plus amazon and hepsiburada in the Connect sheet.

Rules for each mark (enforced by review, with a unit test that only checks that the file exists and has a square viewBox):
- Square `viewBox` (`0 0 24 24` or `0 0 32 32`), with no `<text>` element, so it does not depend on fonts. Under 4 KB. Official app or favicon mark (the "E" tile for Etsy, the 4-colour "ebay" letters for eBay, the smile arrow for Amazon, the bag for Shopify, "Wix" letters, the orange "t" tile for Trendyol, the ring for Hepsiburada). Sourced from each brand's press or media kit page. Nominative use in navigation only.
- `lib/ds/marketplaces.ts` maps `BrandKey → { name, mark: '/logos/marks/<key>.svg' | null, color, initials }`. **Until a mark lands, `mark: null` and `LogoTile` renders the monogram fallback** (white initials on `brand.<key>`), so M2 never waits on assets.
- The shell renders marks only through `<LogoTile brand size={16|20|24}>`. Brand colours never appear outside the tile (P2).

---

## 2. Information architecture

### 2.1 `lib/nav/navConfig.ts`: the single source

One typed array drives the sidebar, the rail, the mobile tab bar, the More sheet, breadcrumbs, the `g`-shortcuts and the ⌘K "Go to" group. Nothing else defines destinations.

| Group (`id`, label) | Item `id` | Label key | `href` | Icon / brand | `requires` | Badge | `g` key | Active `match` |
|---|---|---|---|---|---|---|---|---|
| `main` (no label) | `overview` | `nav.items.overview` | `/app` | `Home` | — | — | `g h` | `/app` (exact) |
| | `orders` | `nav.items.orders` | `/app/labels` | `Receipt` | — | count `ordersToShip`, danger when `ordersOverdue > 0` | `g o` | `/app/labels`, `/app/print/*` |
| | `messages` | `nav.items.messages` | `/app/mesajlar` | `MessageSquare` | `['wix','trendyol']` | count `messagesUnread` | `g m` | `/app/mesajlar` |
| `listings` ("Listings") | `listings-etsy` | brand name | `/app/etsy-listings` | brand `etsy` | `etsy` | dot `attention` when unsent Etsy drafts > 0; dot `warning` when Etsy needs reconnect | `g l` (first visible listing row) | `/app/etsy-listings`, `/app/etsy-listings/*` |
| | `listings-ebay` | brand name | `/app/ebay-listings` | brand `ebay` | `ebay` | same, from eBay drafts | — | `/app/ebay-listings*` |
| | `listings-trendyol` | brand name | `/app/trendyol-urunler` | brand `trendyol` | `trendyol` | reconnect dot | — | `/app/trendyol-urunler*` |
| | `listings-wix` | brand name | `/app/wix-urunler` | brand `wix` | `wix` | reconnect dot | — | `/app/wix-urunler*` |
| | `listings-shopify` | brand name | `/app/shopify-urunler` | brand `shopify` | `shopify` | reconnect dot | — | `/app/shopify-urunler*` |
| | `connect-store` | `nav.items.connectStore` | `/ayarlar?tab=connections` | `Plus` | shown only when ≥1 store provider is known **not** connected (today's rule, `AppLayout.js:238`) | — | — | never active |
| `insights` (no label) | `research` | `nav.items.research` | `RESEARCH_HOME` (see below) | `Telescope` | — | — | `g r` | `/app/research*`, `/app/etsy-research`, `/app/ebay-research`, `/app/trendyol-arastirma`, `/app/amazon-research` |
| | `reports` | `nav.items.reports` | `REPORTS_HOME` (see below) | `BarChart3` | — | — | `g p` | `/app/analytics`, `/app/reports*`, and `/app/financials` once `finance` is removed |
| | `finance` | `nav.items.finance` | `/app/financials` | `Wallet` | — | — | `g f` | `/app/financials` · **removed in the M9 Reports PR** (finance-analytics A1; CRITIQUE C3) |
| `account` (bottom) | `settings` | `nav.items.settings` | `/ayarlar` | `Settings` | — | dot `warning` when `needsReauth.length > 0` | `g s` | `/ayarlar`, `/faturalar` |
| | `help` | `nav.items.help` | `/app/nasil-kullanirim` | `LifeBuoy` | — | — | `g ?` is not used (`?` is the shortcut sheet) | `/app/nasil-kullanirim`, `/app/entegrasyonlar-ve-rehberler` |

Notes:
- **Research is one item.** `RESEARCH_HOME` is a constant in `navConfig.ts`: `'/app/etsy-research'` until the research track's R1 PR ships `/app/research`, which flips it in the same PR. The `match` list already covers the four legacy routes, so the item is active on all of them.
- **Reports and Finance merge in M9** (finance-analytics §0.2 A1). `REPORTS_HOME` is `'/app/analytics'` until the `reports` flag is default-on, then `'/app/reports'`. The same PR deletes the `finance` row and the `g f` key; `g p` stays Reports. `g r` is **Research only** (patched by CRITIQUE C3; finance-analytics had also claimed `g r`).
- **Invoices** (`/faturalar`) leave the nav. They are reached from Settings › Plan & billing ("View all", `settings_spec.md` §3.3) and from ⌘K. The Shopify-free rule is kept: the palette entry is hidden when `billingProvider === 'shopify_free'` (`AppLayout.js:244–249`).
- **Integrations & guides** (`/app/entegrasyonlar-ve-rehberler`) leave the nav. Help links to it, and it stays in ⌘K under Help.
- Amazon and Hepsiburada have no listings page, so they have no listing row. Their orders appear in Orders. They appear in "Connect a store" and in Settings.
- Gating keeps today's tri-state rules exactly: `true` shows the item, `false` hides it, and `undefined` (still loading, or errored with no data) uses the cached flags from `kx.nav.connections.v1` (tagged with the user id), and **shows** the item when there is no cache (`AppLayout.js:62–101, 224–237`). That logic moves verbatim into `lib/nav/useNavModel.ts`.
- Item labels in the listings group are the brand names from `lib/ds/marketplaces.ts` (data, not JSX literals). Their tooltip, `aria-label`, palette label and breadcrumb use `nav.items.listingsOf` ("Etsy listings" / "Etsy ilanları").

### 2.2 Mobile tab bar slots (≤ 5)

| Slot | Item | Rule |
|---|---|---|
| 1 | Overview | always |
| 2 | Orders | always; count badge |
| 3 | Listings | goes to the first visible listing row (`listingsHref`, today's logic `AppLayout.js:259–265`); active on any listing route. With no store connected it goes to `/ayarlar?tab=connections` |
| 4 | Messages, **or** Research when Wix and Trendyol are both known not connected | today's rule (`MobileTabBar.tsx:72–74`) |
| 5 | More | opens the More sheet; warning dot when anything in it needs attention (reconnect) |

### 2.3 Breadcrumbs (desktop TopBar)

Derived automatically from `navConfig` (group label › item label). A page can extend them through `<Page breadcrumbs>` (§6). Examples:
- `/app/labels` → `Orders`
- `/app/etsy-listings` → `Listings › [E] Etsy`
- `/app/etsy-listings/123` (M6) → `Listings › [E] Etsy › Personalized Baby Blanket`
- `/ayarlar?tab=billing` → `Settings › Plan & billing`

The shop switcher ("BelleCoutureGifts ▾" in the DS §3.1 sketch) is a breadcrumb item **supplied by `ListingsPage`** (M5), because the selected shop is page state today (`etsy-listings.tsx:1266 selectedShopId`). The shell only renders a breadcrumb item with `menu` options when the page passes them.

---

## 3. Desktop wireframes

### 3.1 1440px, sidebar expanded (default at ≥1200)

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ [KX] KolayXport          │ Listings › [E] Etsy               [⌕ Search or jump to…            ⌘K]          (🔔 3)  (TS ▾) │ TopBar 52, white, 1px bottom border
│                          ├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⌂  Overview              │                                                                                              │
│ ▤  Orders            12  │  <Page width="list">                                                                         │
│ ▢  Messages           3  │    Etsy listings  [1,284]                     [Bulk edit]  ⋯  [Send 7 changes to Etsy]        │ PageHeader (56)
│                          │    Refreshed from Etsy 12 min ago ⟳                                                         │
│ Listings                 │    Toolbar …                                                                                 │
│ [E] Etsy              •  │    Content …                                                                                 │ • = attention dot (unsent)
│ [e] eBay                 │                                                                                              │
│ [t] Trendyol          •  │                                                                                              │ • = warning dot (reconnect)
│ [W] Wix                  │                                                                                              │
│ [S] Shopify              │                                                                                              │
│ +  Connect a store       │                                                                                              │
│                          │                                                                                              │
│ ⌖  Research              │                                                                                              │ Telescope
│ ▥  Reports               │                                                                                              │
│ ◫  Finance               │                                                                                              │
│                          │                                                                                              │
│ ──────────────────────── │                                                                                              │
│ ⚙  Settings           •  │                                                                                              │
│ ◌  Help                  │                                                                                              │
│ ┌──────────────────────┐ │                                                                                              │
│ │ Trial · 12 days left │ │                                                                                              │ UsageMeter (footer)
│ │ Labels       7 / 10  │ │                                                                                              │
│ │ ▰▰▰▰▰▰▰▱▱▱           │ │                                                                                              │ amber ≥ 80%
│ │ Orders imported 32/50│ │                                                                                              │
│ │ ▰▰▰▰▰▰▱▱▱▱           │ │                                                                                              │
│ └──────────────────────┘ │                                                                                              │
│ «  Collapse          [   │                                                                                              │ ghost row + Kbd "["
└──────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
  240px, neutral-50, 1px right border                content column: neutral-50 bg, 24px gutter, Page caps the width
```

Measurements (all tokens):
- Brand row: 52px (aligns with the TopBar), 16px side padding. `KX` icon 24px (`/icon-192x192.png`, radius 6) + "KolayXport" `title-sm`. It links to `/app`.
- Items: 32px tall, 8px side margin inside the 240 column (so the row is 224 wide), 8px inner padding, radius 6, gap 8 between icon and label. Text `label` 13/500 `neutral-600`, icon 18px lucide stroke 1.75 `neutral-500`, `LogoTile` 16px.
- Hover: `neutral-100` background. **Active:** `neutral-0` background, `neutral-900` text and icon, `e1` shadow plus a 1px `neutral-200` border (this is a floating-looking chip on the `neutral-50` rail, which is why it may carry `e1`; it is the DS rule from §3.1).
- Group labels: `caption` 12/500 `neutral-500`, sentence case, 24px top spacing, 4px below. Unlabeled groups are separated by 16px of space only, with no divider line.
- The bottom group sits above a 1px `neutral-200` rule and is pushed down with `margin-top: auto`. The nav scrolls (`overflow-y: auto`) between the brand row and the footer when the window is short. The footer never scrolls away.
- Counts: right-aligned `micro` 11/14 tabular, `neutral-500`. The Orders count becomes `danger-fg` when `ordersOverdue > 0`, and its tooltip reads "12 to ship · 1 overdue". 99+ caps at "99+".
- Dots: 6px circle at the row's right edge (where a count would sit). `warning` solid for reconnect, `attention` solid for unsent changes. When a row has both, the warning dot wins and the tooltip lists both lines. A dot is never the only signal: the `aria-label` carries the sentence.

### 3.2 1024px (900–1199): automatic rail, 64px

```
┌──────┬────────────────────────────────────────────────────────────────────────────┐
│ [KX] │ Orders                 [⌕ Search or jump to…   ⌘K]           (🔔)  (TS ▾) │
│      ├────────────────────────────────────────────────────────────────────────────┤
│  ⌂   │                                                                            │
│  ▤ ● │◀─ tooltip: "Orders · 12 to ship · 1 overdue   G O"                          │ count → 6px dot in rail (danger when overdue, else neutral-500)
│  ▢ ● │                                                                            │
│ ──── │  (8px gap + 1px neutral-200 hairline, 24px wide, between groups in rail)   │
│ [E]• │◀─ tooltip: "Etsy listings · 7 changes not sent yet"                         │
│ [e]  │                                                                            │
│ [t]• │◀─ tooltip: "Trendyol listings · Trendyol needs reconnecting"                │
│ [W]  │                                                                            │
│ [S]  │                                                                            │
│  +   │◀─ tooltip: "Connect a store"                                                │
│ ──── │                                                                            │
│  ⌖   │◀─ tooltip: "Research   G R"                                                 │
│  ▥   │                                                                            │
│  ◫   │                                                                            │
│      │                                                                            │
│ ──── │                                                                            │
│  ⚙ • │                                                                            │
│  ◌   │                                                                            │
│  ◔   │◀─ only when a meter is ≥ 80%: Gauge icon (warning-fg) → tooltip            │
│      │   "Labels 9 of 10 used · Trial ends in 3 days", click → /ayarlar?tab=billing│
│  »   │◀─ tooltip: "Expand sidebar   ["                                           │
└──────┴────────────────────────────────────────────────────────────────────────────┘
```

- Rail items are 40×40 hit areas centred in the 64px column, the icon or `LogoTile` 20px. Group labels are hidden. Groups are separated by an 8px gap plus a 24px-wide `neutral-200` hairline (the hairline is the only cue that the logos belong together, so it stays).
- **Every rail item has a `Tooltip`** (right side, 8px offset, z 1800) with the label, the count or dot sentence, and the `g` shortcut through `Kbd`. Tooltips open on hover after 400ms and **on keyboard focus immediately**.
- Expanding at 900–1199 (button, `[`) opens the 240px sidebar **as an overlay** above the content (z 1150, `e3`, no backdrop, closes on `Esc`, on outside click and on navigation). It never pushes the content, because the content needs the width at this size. At ≥1200 the sidebar pushes the content, and the preference persists.
- The `KX` icon alone stays in the brand row.

### 3.3 TopBar details (desktop)

```
│ Listings › [E] Etsy ›  BelleCoutureGifts ▾  │      [⌕ Search or jump to…                 ⌘K]      │   (🔔 3)  (TS ▾) │
  breadcrumbs: caption 13/500 neutral-500,           SearchTrigger: 32px, 400px wide (min 240,             IconButton 32 + avatar 28
  last item neutral-900, "›" ChevronRight 14          shrinks first), neutral-0 bg, border-strong, 
  max 3 visible, middle ones collapse to "…"          placeholder neutral-500, Kbd right-aligned
```
- 52px, `neutral-0`, 1px bottom border, 24px side padding, z 1100. It is a 3-column grid: `1fr auto 1fr`, so the search stays centred whatever the breadcrumb length. Breadcrumbs truncate with an ellipsis before they can push the search.
- The search trigger is a `button`, not an input. Clicking it, `⌘K`/`Ctrl+K` or `/` **when the page registers no page search** opens the palette. Its `Kbd` shows `⌘K` on Mac and `Ctrl K` elsewhere, resolved after mount (today's `isMacLike` logic, `AppLayout.js:271–278`).
- **Bell:** `IconButton` (label "Notifications", or "Notifications (3 unread)"). The unread count is a `micro` tabular pill (16px tall, `neutral-900` background, white text) at the top-right of the icon. It is neutral, not red, because notifications are news. It turns `danger` only when an unread item has `severity: 'error'` (send failed, reconnect, order import failed).
- **Avatar:** 28px `Avatar` (NextAuth `session.user.image`, else initials from `name` or `email`, on a neutral tint) plus `ChevronDown` 14. It opens the account menu (§3.5).

### 3.4 Notifications popover (desktop) and sheet (mobile)

```
┌ Notifications ─────────────────────────── Mark all as read ┐  Popover 380 wide, max 480 tall, e2, radius 8, z 1600
│ ● ⚠  Couldn't send "Name Necklace Gold" to Etsy          ● │  row 56+: tone icon 16 in a 28px tone-bg tile,
│      Invalid taxonomy · 4 min ago                          │  title dense 13 (600 when unread), caption meta,
│ ●  ⓘ  eBay needs reconnecting                            ● │  unread = 6px accent dot right + font weight
│      Reconnect eBay to keep importing orders · 2 h ago     │
│    ⓘ  You've used 8 of 10 labels on your trial             │
│      Yesterday                                             │
├────────────────────────────────────────────────────────────┤
│ Notification settings                                      │  ghost link → /ayarlar?tab=syncAdvanced; rendered only once that tab has a notifications section (none at 92087ba)
└────────────────────────────────────────────────────────────┘
```
- Data is unchanged: `useNotifications()` (`GET /api/notifications?limit=20`, 60s refresh, `POST /api/notifications/read`). The text resolution (`titleFor`, `REQUIRED_PARAMS`, the `fallback` key) moves verbatim from `NotificationBell.tsx`. The local `relativeTime()` is replaced by `<DateText mode="relative">`.
- Tone icons come from the DS tones (`info`, `warning`, `danger`). Hex values in `SEVERITY_STYLE` are deleted.
- A row click marks it read and routes to `item.link` (today's behaviour).
- Mobile renders the same list in a `BottomSheet` (title "Notifications", the "Mark all as read" ghost action in the sheet header).

### 3.5 Account menu (`OverflowMenu`-style `Menu`, 260 wide, anchored right)

```
┌──────────────────────────────────┐
│ Tamer Samsar                     │  title-sm
│ kolayxport@gmail.com             │  caption neutral-500 (the session email, display only)
├──────────────────────────────────┤
│ ⚙  Account settings              │  → /ayarlar
│ ◔  Plan & billing                │  → /ayarlar?tab=billing  (Shopify-free: label "Plan", and that tab says "Included with the KolayXport Shopify app"; settings-billing-pricing §0.1, CRITIQUE C9)
├──────────────────────────────────┤
│ Language                         │  caption label (not a row)
│ ○  English                       │  radio rows (endonyms, never translated)
│ ●  Türkçe                        │  → useLocaleStore.setLocale('tr'|'en')
├──────────────────────────────────┤
│ ⌨  Keyboard shortcuts        ?   │  opens ShortcutSheet
│ ◌  Help                          │  → /app/nasil-kullanirim
├──────────────────────────────────┤
│ ⎋  Sign out                      │  ghost row (not danger: signing out is not destructive)
└──────────────────────────────────┘
```
- The language switch applies at once and the menu stays open, so the user sees the result. `<html lang>` follows through the M0 `_app` effect.
- Sign out keeps `clearNavConnCache()` before `supabaseSignOut()` (`AppLayout.js:480–483`).

### 3.6 Command palette (desktop 640 wide, top 12vh, `e4`, radius 12, z 1650)

```
┌──────────────────────────────────────────────────────────────────┐
│ ⌕  Search pages, actions or orders…                          Esc │  48px input, 16px text
├──────────────────────────────────────────────────────────────────┤
│ On this page                                                     │  ← usePageActions (PageHeader actions)
│   ➤  Send 7 changes to Etsy                              ⌘ ↵     │
│   ⟳  Refresh from Etsy                                          │
│ Actions                                                          │
│   ⟳  Refresh orders                                              │  (was "Sync orders"; same label as Overview/Orders, CRITIQUE C12)
│   ＋  New Etsy listing                                            │
│ Go to                                                            │
│   ▤  Orders                                       Orders   G O   │
│  [E] Etsy listings                                Listings       │
│   ⌖  Research                                              G R   │
│ Orders                                                           │  ← live search when ≥ 2 chars (today's /api/orders search)
│   #3891 · Sarah M.                                [E] Etsy       │
│   Search orders for "3891"                                   ↵   │
├──────────────────────────────────────────────────────────────────┤
│ ↑↓ to navigate   ↵ to select   Esc to close                      │  caption footer, Kbd
└──────────────────────────────────────────────────────────────────┘
```
- Group order with an empty query: **On this page**, Recent (the last 5 commands run, `localStorage` `kx.palette.recent.v1`, in try/catch), Actions, Go to. With a query: one ranked list per group, using today's `fold` + `fuzzyScore` (moved to `lib/ds/fuzzy.ts` unchanged), plus the Orders group.
- An order hit routes to `/app/labels?q=<orderNumber>`. The `kx:labels-search` CustomEvent (`CommandPalette.tsx:312–322`) has **no listener** in `pages/app/labels.tsx` today, so the code always falls back to `window.location.assign`. It is removed: from M3, Orders reads `q` with `useUrlState` and reacts to shallow route changes. Until M3 the palette keeps the full navigation fallback (`window.location.assign`) only on `/app/labels`.
- Brand items show a `LogoTile` 16 in place of the icon.
- Mobile: a full-screen sheet (input at the top, 16px text, `Esc`/"Cancel" ghost button).

### 3.7 Shortcut sheet (`?`)

A `Modal` md (560) titled "Keyboard shortcuts", made of a `KeyValueList` (2 columns) of `Kbd` + label. Global rows: `⌘K` Search or jump · `g` then a letter Go to · `[` Collapse or expand the sidebar · `?` Show shortcuts · `Esc` Close or clear. Then the page's own rows, registered through `useShortcuts(map, { scope, describe: true })`. It is not offered under `pointer: coarse`.

---

## 4. Mobile wireframes (390px; everything below 900px)

### 4.1 Page with the tab bar

```
┌──────────────────────────────────┐
│ Orders                ⌕   🔔3    │  TopBar 48: title-md title (the only place the TopBar shows a title),
├──────────────────────────────────┤  IconButtons 44 (search → palette sheet, bell → notifications sheet)
│                                  │
│  page content (16px gutters)     │
│                                  │
│                                  │
├──────────────────────────────────┤
│ [ Create 3 labels              ] │  StickyActionBar (page-owned), bottom: var(--kx-bottom-nav)
├──────────────────────────────────┤
│  ⌂       ▤12      ▦       ▢3    ≡•│  MobileTabBar 56 + safe area
│ Overview Orders Listings Messages More │
└──────────────────────────────────┘
```
- TopBar: `neutral-0`, 1px bottom border, `padding-top: env(safe-area-inset-top)`, 16px side padding. Left side: a back chevron `IconButton` ("Back") when the page passes `backHref` or the route is a drill-in (`/app/etsy-listings/[id]`, `/ayarlar?tab=*`), then the title (one line, ellipsis). Right side, **in this fixed order, every surface** (CRITIQUE C2): (1) search `⌕`, omitted on drill-in pages; (2) at most **one** `<Page mobileAction>`: a labeled 40px button (for example `+ New`) or, on the listing editor only, the `ScoreMeter` button; (3) the page `⋯` when the page has secondary or overflow actions, otherwise the bell. When the bell is not shown, it is the first row of the More sheet with its unread count, and the More tab carries the unread dot. So the bar never holds more than 2 icons + 1 button.
- **Settings drill-in reconciliation:** `settings_spec.md` §2 asks for its own sticky 52px bar with a back chevron. Under this spec that bar **is** the shell TopBar (48px, DS §2.10). `pages/ayarlar.tsx` passes `backHref="/ayarlar"` and the section title through `<Page>`. No second bar is drawn.
- Tab bar: 56px plus `env(safe-area-inset-bottom)`. It keeps setting `--kx-bottom-nav` (now `calc(56px + env(safe-area-inset-bottom))`; it was 60). Items: 18px icon over an 11px `micro` label, `neutral-500`. **Active: `neutral-900` icon and label at weight 600**, plus a 2px × 24px `neutral-900` bar on the top edge. Accent blue is not used, so the colour rule matches the sidebar. Count badges are the same neutral pill as the bell (danger when orders are overdue). z 1050, `neutral-0`, 1px top border, no shadow.
- Pull-to-refresh is kept with the same behaviour (soft refresh: `kx:pull-refresh` event + `router.replace` + global SWR `mutate`; `AppLayout.js:380–478`), restyled: a 24px `RefreshCw` in `neutral-500` on a `neutral-0` circle with `e2`, sliding down from below the TopBar. The gradient strip is deleted.

### 4.2 More sheet (`BottomSheet`, full height when needed)

```
┌──────────────────────────────────┐
│              ────                │  drag handle
│ Menu                          ✕  │
├──────────────────────────────────┤
│ Listings                         │  caption group label
│ [E] Etsy                      •  │  48px rows, LogoTile 24, same badges as the sidebar
│ [e] eBay                         │
│ [t] Trendyol   Reconnect needed  │  warning text in place of the dot (room exists on mobile)
│ [W] Wix                          │
│ [S] Shopify                      │
│ +  Connect a store               │
│                                  │
│ ⌖  Research                      │  (or Messages, whichever is not in tab slot 4)
│ ▥  Reports                       │
│ ◫  Finance                       │
│ ──────────────────────────────── │
│ ⚙  Settings                   •  │
│ ◌  Help                          │
│ ──────────────────────────────── │
│ Trial · 12 days left             │  UsageMeter, same content as the desktop footer
│ Labels 7 / 10  ▰▰▰▰▰▰▰▱▱▱        │
│ ──────────────────────────────── │
│ (TS) Tamer Samsar                │  account row → /ayarlar
│ Language            English | Türkçe │  SegmentedControl, 2 options (allowed: not a filter)
│ ⎋  Sign out                      │
└──────────────────────────────────┘
```
- Items already present in the tab bar are not repeated. Rows are 48px with 44px+ targets. A tap navigates and closes the sheet. The sheet is the same `navConfig` with the same logos (DS §3.1).

### 4.3 Rules carried from the DS
- No FAB anywhere. Page primaries go in `StickyActionBar`, which sits above `--kx-bottom-nav`.
- Toasts sit at `bottom: calc(var(--kx-bottom-nav) + 8px)` (M0 Toaster change).
- Below 900 there is no sidebar at all: no drawer, no hamburger. The `mobile-nav-item` and `body.sidebar-open` CSS is deleted.

---

## 5. States

| Element | Loading | Empty | Error | Partial / special |
|---|---|---|---|---|
| **Shell (auth)** | Session loading: the sidebar renders the brand row plus 8 skeleton rows (32px, `neutral-100`, 200ms delay); the TopBar renders the search trigger and an avatar skeleton; content renders the page's own skeleton. No spinner (this replaces the `withAuth` full-page `Loader2`) | — | — | No session: `AppShell` renders `children` bare (no chrome), so `/app`'s login screen and the redirect message render as today |
| **Nav gating** (`/api/integrations/status`) | Cached flags from `kx.nav.connections.v1`; with no cache, every listing row is shown (never hide a connected user's features) | Every store known not connected: no listing rows, only "Connect a store" under Listings, and the Listings tab goes to `/ayarlar?tab=connections` | Keep the last data (SWR `keepPreviousData`). Rows stay as they were. **No reconnect dots are invented**, and nothing says "Not connected" (P6) | One provider needs reauth: warning dot on its row and on Settings, plus the More tab dot on mobile |
| **Counts** (`/api/nav/counts`, messages counts) | No count rendered (never a "0" placeholder) | 0 renders nothing | Counts hidden; retried with SWR backoff. Counters are decorations on navigation, not a data region, so no `ErrorState` appears in the nav (justified: an error tile in a 32px nav row would be noise; the Orders page shows the real state) | Stale data older than 10 min is hidden rather than shown wrong |
| **UsageMeter** | Footer reserves its height with a 2-line skeleton | Shopify-free and enterprise: one line "Free via Shopify" or "Enterprise · Unlimited", no bars | Hidden | ≥ 80%: amber bar plus the rail Gauge. ≥ 100%: red bar plus the blocking `Banner` |
| **Account banner** (top of the content column, above `<Page>`) | — | not rendered | — | `subscriptionStatus` not `active`/`trialing` (or trial date passed) → danger `Banner` "Your trial has ended…" [Choose a plan] → `/ayarlar?tab=billing`. A limit reached → warning `Banner` "You've used all 10 labels on your trial" [Upgrade]. Never for Shopify-free. Not dismissible while blocking. **No marketing banners** (the "All Features Free" Overview banner goes in M8) |
| **Notifications** | 3 skeleton rows (after 200ms), "Still loading… Retry" at 15s via `useAsyncState` | `EmptyState kind="done"`: "You're all caught up" | `ErrorState variant="inline"` "Couldn't load notifications" [Try again] | Unknown `titleKey` or missing params → `notifications.fallback` (kept) |
| **Palette order search** | A "Searching…" row in the Orders group | "No orders match "x"" plus the "Search orders for "x"" row | "Couldn't search orders" row with a Retry action; navigation and actions still work | < 2 characters: no search runs |
| **Breadcrumbs** | Static labels from `navConfig` render at once | — | — | Page-supplied crumbs (listing title) show a 120px skeleton until the page has its data |
| **Offline** | — | — | The existing `pages/offline.tsx` fallback is untouched | — |

---

## 6. Page header usage (how pages plug into the shell)

### 6.1 Contract
```tsx
<Page
  title={t('orders.title')}                  // required: PageHeader title, mobile TopBar title, <title> "Orders · KolayXport"
  width="list"                                // list | detail | form | reading
  breadcrumbs={[{ label: shopName, menu: shopOptions }]}   // optional, appended after the navConfig crumbs
  backHref="/ayarlar"                         // optional: mobile back chevron (and desktop PageHeader back link)
  mobileAction={{ id: 'new', label: t('common.new'), icon: icons.add, href: '/app/etsy-listings/new' }}  // optional, ≤ 1
>
  <PageHeader title={t('orders.title')} count={142} meta={<SyncMeta …/>} primaryAction={…} secondaryActions={[…]} overflowActions={[…]} />
  …
</Page>
```
- `Page` writes `{ title, breadcrumbs, backHref, mobileAction }` into `ShellContext` (a React context provided by `AppShell`) in a layout effect and clears it on unmount. `TopBar` and `<Head><title>` read from it.
- `PageHeader` keeps its DS behaviour: one title row of fixed 56px height, subtitle, `meta`, 1 primary + ≤ 2 secondaries + overflow, all registered in ⌘K through `usePageActions`. **On mobile the PageHeader title row is not rendered** (the TopBar has it). Only `meta` and the subtitle remain. Secondaries and overflow collapse into the **TopBar** `⋯` (slot 3 of §4.1; Orders, Listings, Messages and Reports all draw it there), a creation primary goes to `mobileAction`, and the state-driven primary goes to `StickyActionBar`. `Page` therefore also writes `mobileOverflow: ActionSpec[]` into `ShellContext` (derived from the PageHeader actions; CRITIQUE C2).
- `<title>` is `shell.pageTitle` = "{title} · KolayXport". The suffix is never part of the `title` prop.

### 6.2 M2 header pass: what each page does

The pass is mechanical: wrap the existing body, delete the ad-hoc H1, keep every handler. Page bodies are not rebuilt here.

| Route file | `AppLayout title` today | Ad-hoc header to remove | `<Page width>` | PageHeader title key |
|---|---|---|---|---|
| `pages/app/index.js` | `t('pageTitle')` + 3 `simpleHeader` uses (prop is ignored by AppLayout) | page H1 / greeting block stays until M8 | `detail` | `overview.title` |
| `pages/app/labels.tsx:3482` | `t('labelManagement')` | top header row; Sync button moves to `meta` as "Orders refreshed 2 min ago ⟳" (action label "Refresh orders") | `list` | `nav.items.orders` |
| `pages/app/etsy-listings.tsx:3680` | `"Etsy Listings - KolayXport"` (literal, with suffix) | header + "Sync all (7)" → primary "Send 7 changes to Etsy"; Sync → meta | `list` | `nav.items.listingsOf` (Etsy) |
| `pages/app/ebay-listings.tsx:2736` | `"eBay Listings — KolayXport"` (literal) | big H1 + subtitle; "Sync from eBay" → meta | `list` | `listingsOf` (eBay) |
| `pages/app/trendyol-urunler.tsx:784`, `wix-urunler.tsx:522`, `shopify-urunler.tsx:263` | `t('title')` / `t('pageTitle')` / none | "Wix Products" header inside content, etc. | `list` | `listingsOf` |
| `pages/app/mesajlar.tsx:789,808` | `t('title')` | page title block | `list` | `nav.items.messages` |
| `pages/app/etsy-research.tsx`, `ebay-research.tsx`, `trendyol-arastirma.tsx`, `amazon-research.tsx` | `t('pageTitle')` / `t('title')` | gradient heroes are **not** touched here (R0/R1 own them); only the title moves | `list` | existing page title keys |
| `pages/app/analytics.tsx:432,443` | `t('pageTitle')` ("Dashboard") | gradient Refresh → meta | `detail` | `nav.items.reports` (fixes "Dashboard" vs "Reports", finding #33) |
| `pages/app/financials.tsx:130` | `t('pageTitle')` | gradient icon header | `detail` | `nav.items.finance` |
| `pages/ayarlar.tsx:142` | `t('pageTitle')` | the second "Settings" title (finding #35) | `form` | `nav.items.settings` |
| `pages/faturalar.tsx` | none (imports AppLayout as `Layout`) | own header | `form`, `backHref="/ayarlar?tab=billing"` | `settings.billing.invoices` |
| `pages/app/nasil-kullanirim.js`, `entegrasyonlar-ve-rehberler.js` | `t('title')` / `t('pageTitle')` | own H1 | `reading` | existing keys |
| `components/withAuth.tsx` | `t('loading')` / `t('redirecting')` | full-page spinner | — (renders `null`; the shell shows its skeleton) | — |

---

## 7. Interactions and keyboard

| Input | Behaviour |
|---|---|
| `⌘K` / `Ctrl+K` | Toggle the palette, from anywhere, including inside inputs (today's listener, `CommandPalette.tsx:124–136`) |
| `/` | Focus the page `SearchField` when the page registered one; otherwise open the palette. Never inside inputs |
| `g` then a letter (within 1s) | Go to: `h` Overview, `o` Orders, `l` first listings row, `m` Messages, `r` Research, `p` Reports, `f` Finance, `s` Settings. A small "g …" `Kbd` hint shows bottom-left for that second. Matched on `KeyboardEvent.key`, lowercased with `toLocaleLowerCase('en')` so Turkish Q/F layouts work (P3) |
| `[` | Collapse or expand the sidebar (≥ 900 only). Not inside inputs |
| `?` | Shortcut sheet (not on `pointer: coarse`) |
| `Esc` | Closes, in order: palette, menu or popover, overlay sidebar (900–1199), sheet |
| Sidebar keyboard | The sidebar is a `<nav aria-label="Main">` with a list of links; `Tab` moves through items in reading order. Rail tooltips open on focus. Focus ring on every item (`focusRing`) |
| Skip link | The first focusable element is "Skip to content", visible on focus, targeting `<main id="kx-main">` |
| Route change | Closes the More sheet, the overlay sidebar and the palette. Focus moves to `<main>` (with `tabindex="-1"`) so screen readers start at the new page; the route announcer reads the `<title>` |
| Dirty pages | The shell does not guard; pages own their dirty guard (DS §8). Nav clicks are plain `next/link`, so a page's `routeChangeStart` guard (as in `settings_spec.md` §3.5) works unchanged |
| Collapse persistence | `localStorage['kx.sidebar.collapsed.v1'] = '1'|'0'` (try/catch). Read in a layout effect before paint; the first applied value snaps without animation (today's `instantRef` trick, `AppLayout.js:311–329`). Because the shell no longer remounts per page, `pinnedMemo` goes away. The old `kx.sidebar.pinned` key is ignored and removed once |
| Width animation | 240 ↔ 64 over `motion.base` (200ms) with `ease`, `width` only. Labels fade at `motion.instant`. `prefers-reduced-motion` makes it instant. **`framer-motion` is dropped from the shell** (CSS transitions only) |
| Polling | Counts every 60s and on window focus; messages counts every 3 min only when Wix or Trendyol is connected (today's rule, `AppLayout.js:295–304`); notifications 60s (unchanged). All stop while the tab is hidden (SWR `refreshWhenHidden: false`) |

---

## 8. Data per element (verified against code)

| Element | Source today | Field(s) | Change |
|---|---|---|---|
| Nav gating, reconnect dots, Settings dot | `useConnections()` → `GET /api/integrations/status` | `connections[p].connected`, `connections[p].needsReauth`, `needsReauth[]` | none |
| Listing row order, Listings tab target | `navConfig` + gating | — | none (logic moved) |
| Shop names (breadcrumb menu, M5) | `connections[p].accounts[].name`, `externalId` | `ConnectionAccount` | none in M2 |
| Orders count (to ship, overdue) | **none** (Overview computes its own numbers) | — | **new** `GET /api/nav/counts` (§9) |
| Unsent drafts dot (Etsy, eBay) | **none** (drafts are listed per shop, `GET /api/etsy-drafts?shop_id=` requires `shop_id`) | `EtsyListingDraft.userId,status`, `EbayListingDraft.userId,status` | in `/api/nav/counts` (§9) |
| Messages count | `useMessageCountStore` → `GET /api/messages?action=counts` | `{ wix, trendyol, total }` | none |
| Notifications | `useNotifications()` → `GET /api/notifications?limit=20`, `POST /api/notifications/read` | `items[]`, `unreadCount`, `severity`, `titleKey`, `params`, `link`, `readAt`, `createdAt` | none |
| UsageMeter, account banner | `useEntitlement()` (`lib/billing/useEntitlement.ts`, settings-billing-pricing §2.4: `meters`, `state`, `trialEndsAt`, `stripeUpsell`). Until `/api/billing/entitlement` ships, that hook's fallback mode derives the same shape from `GET /api/user/settings` (`subscription.{subscriptionPlan, subscriptionStatus, billingProvider, trialExpiresAt, orderSyncCount, labelCount, usageResetAt}` + `limits`) | — | **add** `subscription.limits` (§9), consumed only by the `useEntitlement` fallback. The shell never reads `subscription.*` directly and never hard-codes plan numbers (the wireframe's 10 / 50 are examples; CRITIQUE C8) |
| Avatar, account header | `useAuth()` → NextAuth `session.user` | `name`, `email`, `image` | none |
| Locale | `useLocaleStore` | `locale`, `setLocale` | none |
| Palette order search | `GET /api/orders?search=&searchType=all&page=1&limit=5` | `orders[].{id, orderNumber, customerName, marketplace}` | none |
| Palette "Refresh orders" | `POST /api/orders/sync {syncType:'fast'}` via `fetchWithLimit` | — | none (label renamed) |
| Palette "New Etsy listing" | `router.push('/app/etsy-listings')` | — | none in M2 (M6 gives it a real creator URL) |

---

## 9. Minimal API additions (2)

### 9.1 `GET /api/nav/counts` (new file `pages/api/nav/counts.ts`)
```ts
// 200
{
  orders: { toShip: number; overdue: number };
  drafts: { etsy: number; ebay: number };   // drafts in status draft | failed | conflict (not syncing, not synced)
  generatedAt: string;                       // ISO
}
```
- Auth: `getAuthUser` session only (no API-key path). `Cache-Control: private, max-age=0`.
- `toShip` = the Orders "To ship" view clause (orders.md §1.3): orders that `/api/orders` would list (same base clause: `LOWER(status) NOT IN ('awaiting_payment','pending_payment')`, `orders/index.ts:159`) **and** match the `labelFilter=unlabeled` clause (`orders/index.ts:383–397`, with the Trendyol pre-assigned cargo number **not** counting as a label, orders.md §4.2 rule 6) **and** are not shipped, delivered, cancelled or refunded **and** are not FBA/MCF.
- `overdue` = the `toShip` subset whose **effective ship-by** < `now()` (the same expression as orders.md A1: `MIN(OrderItem.shipBy)`, then the `rawData` fallbacks of `index.ts` L789–816).
- **One module for every count of this kind (CRITIQUE C4):** `lib/orders/views.ts` (server-only). This group creates it in M2 with `TO_SHIP_SQL`, `UNLABELED_SQL`, `EFFECTIVE_SHIP_BY_SQL`, `OVERDUE_SQL` and the excluded-status constant; Orders M3 G1 extends the same file (A1 views and counts); Overview M8 imports it (it no longer creates `lib/orders/statusGroups.ts`). `/api/nav/counts` imports it now; `orders/index.ts` is **not** edited in M2. A parity test asserts nav count = Orders "To ship" count = Overview KPI for one fixture.
- Cost: 2 `COUNT(*)` queries plus 2 Prisma `count`s, using the existing `userId` indexes. Polled at 60s per open tab.

### 9.2 `GET /api/user/settings`: add `subscription.limits`
```ts
subscription: {
  …existing fields…,
  limits: { orderSync: number | null; label: number | null };   // null = unlimited
  period: 'trial' | 'month' | null;
}
```
- Move the `plans` table and `trialLimits` from `lib/middleware/withUsageLimiter.ts:17–24, 96` into **`lib/billing/planLimits.ts`** (`getPlanLimits(plan, status, trialExpiresAt)`), imported by both the middleware and the settings route. Behaviour is unchanged. `Infinity` becomes `null` in JSON (today the middleware already omits it, `:127`).
- Add `limits`/`period` to `UserSettingsResponse['subscription']` together with the missing `billingProvider` (`settings_spec.md` finding 8). Coordinate with the Settings group: it reads the same fields for `UsageCard`.

No other endpoint changes. Notifications, connections and messages are used as they are.

---

## 10. i18n keys (new or changed; both files, sentence case, real Turkish characters)

Namespace `nav` (labels) and new namespace `shell` (chrome). ICU plurals where counts appear.

| Key | en | tr |
|---|---|---|
| `nav.groups.listings` | Listings | İlanlar |
| `nav.items.overview` | Overview | Genel bakış |
| `nav.items.orders` | Orders | Siparişler |
| `nav.items.messages` | Messages | Mesajlar |
| `nav.items.listingsOf` | {marketplace} listings | {marketplace} ilanları |
| `nav.items.connectStore` | Connect a store | Mağaza bağla |
| `nav.items.research` | Research | Pazar araştırması |
| `nav.items.reports` | Reports | Raporlar |
| `nav.items.finance` | Finance | Finans |
| `nav.items.settings` | Settings | Ayarlar |
| `nav.items.help` | Help | Yardım |
| `nav.items.invoices` | Invoices | Faturalar |
| `nav.items.guides` | Integrations & guides | Entegrasyonlar ve rehberler |
| `shell.pageTitle` | {title} · KolayXport | {title} · KolayXport |
| `shell.skipToContent` | Skip to content | İçeriğe geç |
| `shell.mainNav` | Main | Ana menü |
| `shell.breadcrumbs` | Breadcrumb | Konum |
| `shell.sidebar.collapse` | Collapse sidebar | Kenar çubuğunu daralt |
| `shell.sidebar.expand` | Expand sidebar | Kenar çubuğunu genişlet |
| `shell.badge.toShip` | {count, plural, one {# to ship} other {# to ship}} | {count} gönderilecek |
| `shell.badge.overdue` | {count, plural, one {# overdue} other {# overdue}} | {count} gecikti |
| `shell.badge.unread` | {count, plural, one {# unread} other {# unread}} | {count} okunmadı |
| `shell.badge.unsent` | {count, plural, one {# change not sent yet} other {# changes not sent yet}} | {count} değişiklik henüz gönderilmedi |
| `shell.badge.reconnect` | {marketplace} needs reconnecting | {marketplace} yeniden bağlanmalı |
| `shell.badge.reconnectShort` | Reconnect needed | Yeniden bağlan |
| `shell.badge.settingsReconnect` | A store needs reconnecting | Bir mağaza yeniden bağlanmalı |
| `shell.topbar.search` | Search or jump to… | Ara veya git… |
| `shell.topbar.notifications` | Notifications | Bildirimler |
| `shell.topbar.notificationsUnread` | Notifications ({count} unread) | Bildirimler ({count} okunmadı) |
| `shell.topbar.account` | Account | Hesap |
| `shell.topbar.back` | Back | Geri |
| `shell.account.settings` | Account settings | Hesap ayarları |
| `shell.account.billing` | Plan & billing | Plan ve faturalandırma |
| `shell.account.language` | Language | Dil |
| `shell.account.shortcuts` | Keyboard shortcuts | Klavye kısayolları |
| `shell.account.signOut` | Sign out | Çıkış yap |
| `shell.usage.plan.trial` | Trial | Deneme |
| `shell.usage.plan.starter` | Starter | Starter |
| `shell.usage.plan.growth` | Growth | Growth |
| `shell.usage.plan.enterprise` | Enterprise · Unlimited | Enterprise · Sınırsız |
| `shell.usage.plan.shopifyFree` | Free via Shopify | Shopify üzerinden ücretsiz |
| `shell.usage.trialDaysLeft` | Trial · {days, plural, one {# day} other {# days}} left | Deneme · {days} gün kaldı |
| `shell.usage.labels` | Labels | Etiketler |
| `shell.usage.ordersImported` | Orders imported | Aktarılan siparişler |
| `shell.usage.ofLimit` | {used} / {limit} | {used} / {limit} |
| `shell.usage.railTooltip` | {kind} {used} of {limit} used | {kind}: {limit} hakkın {used} tanesi kullanıldı |
| `shell.usage.resets` | Resets {date} | {date} tarihinde sıfırlanır |
| `shell.banner.trialEnded` | Your trial has ended. Choose a plan to keep importing orders and creating labels. | Deneme süreniz bitti. Sipariş aktarmaya ve etiket oluşturmaya devam etmek için bir plan seçin. |
| `shell.banner.noPlan` | You don't have an active plan. Choose one to keep importing orders and creating labels. | Aktif bir planınız yok. Sipariş aktarmaya ve etiket oluşturmaya devam etmek için bir plan seçin. |
| `shell.banner.limitReached` | You've used all {limit} {kind} for this period. | Bu dönemdeki {limit} {kind} hakkınızın tamamını kullandınız. |
| `shell.banner.choosePlan` | Choose a plan | Plan seç |
| `shell.banner.upgrade` | Upgrade | Planı yükselt |
| `shell.notifications.markAllRead` | Mark all as read | Tümünü okundu işaretle |
| `shell.notifications.empty` | You're all caught up | Yeni bildirim yok |
| `shell.notifications.error` | Couldn't load notifications | Bildirimler yüklenemedi |
| `shell.notifications.retry` | Try again | Tekrar dene |
| `shell.notifications.settings` | Notification settings | Bildirim ayarları |
| `shell.palette.onThisPage` | On this page | Bu sayfada |
| `shell.palette.recent` | Recent | Son kullanılanlar |
| `shell.palette.searchError` | Couldn't search orders | Siparişler aranamadı |
| `shell.palette.noOrders` | No orders match “{query}” | “{query}” ile eşleşen sipariş yok |
| `shell.palette.cancel` | Cancel | Vazgeç |
| `commandPalette.syncOrders` (changed) | Refresh orders | Siparişleri yenile |
| `commandPalette.syncOrdersHint` (changed) | Get the latest orders from your connected stores | Bağlı mağazalarınızdaki son siparişleri getir |
| `shell.shortcuts.title` | Keyboard shortcuts | Klavye kısayolları |
| `shell.shortcuts.palette` | Search or jump | Ara veya git |
| `shell.shortcuts.goTo` | Go to a page (g, then a letter) | Sayfaya git (g, ardından harf) |
| `shell.shortcuts.sidebar` | Collapse or expand the sidebar | Kenar çubuğunu daralt veya genişlet |
| `shell.shortcuts.help` | Show shortcuts | Kısayolları göster |
| `shell.shortcuts.close` | Close or clear | Kapat veya temizle |
| `shell.shortcuts.goHint` | g … | g … |
| `shell.mobile.more` | More | Daha fazla |
| `shell.mobile.menu` | Menu | Menü |
| `shell.pull.pull` / `release` / `refreshing` | Pull to refresh / Release to refresh / Refreshing… | Yenilemek için çekin / Yenilemek için bırakın / Yenileniyor… |

Language option labels "English" and "Türkçe" are endonyms in `lib/i18n/locales.ts` (data), not message keys.

**Existing values to fix** (wrong language or wrong word in `messages/tr.json` today): `nav.etsyListings` "Etsy Listings", `nav.ebayListings` "eBay Listings", `nav.ebayResearch` "eBay Research", `nav.analytics` "Dashboard", `nav.labels` "Label", `nav.listings` "Ürünler". They are not reused; they are deleted with the rest below.

**Keys deleted after M2** (no consumer left; checked with grep in M2): `nav.{analytics, marketplaces, operations, management, sync, integrations, etsyResearch, etsyListings, ebayListings, ebayResearch, amazonResearch, wixProducts, trendyolProducts, trendyolResearch, shopifyProducts, labels, labelsNav, allOrders, home, productionList, searchPlaceholder, pinSidebar, unpinSidebar, closeMenu, toggleMenu, reauthNeeded, noNotifications, refreshing, release, pullToRefresh}`, and the `trial.*` banner keys used only by `TrialNotification`. A key that is still used elsewhere stays: the deleting agent greps each key in `pages`, `components`, `lib` first.

---

## 11. Code to delete

| Path | Lines | Why |
|---|---|---|
| `components/AppLayout.js` | 895 → ~15 | All chrome moves to `ds/shell/*`. What remains is a compat shim: `export default function AppLayout({ title, children }) { usePageTitle(stripSuffix(title)); return children; }`, so 18 call sites keep compiling. The shim is deleted in M10 once every page uses `<Page>` |
| `components/Layout.js` | 152 | A third, dark-sidebar shell. `pages/404.js`, `_error.js`, `logout.js` switch to `PublicLayout`. The unused `Layout` import in `pages/_app.tsx:6` goes too |
| `components/SidebarToggle.js` | 92 | Only used by `Layout.js` |
| `components/TrialNotification.tsx` | 193 | Replaced by `UsageMeter` + the blocking `Banner` |
| `components/MobileTabBar.tsx` | 147 | Rewritten as `ds/shell/MobileTabBar.tsx`. `MOBILE_TAB_BAR_HEIGHT` and `BOTTOM_NAV_CSS_VAR` are re-exported from `lib/ds/tokens.ts` (`layout.tabBar`) |
| `components/NotificationBell.tsx` | 214 | Rewritten as `ds/shell/NotificationsButton.tsx` (logic moved, hex styles dropped) |
| `components/CommandPalette.tsx` | 455 | Rewritten as `ds/shell/CommandPalette.tsx`. `fold`/`fuzzyScore`/`toOrderHits` move to `lib/ds/fuzzy.ts` and `lib/nav/orderHits.ts` unchanged. The `LABELS_SEARCH_EVENT` handoff is removed (no listener exists) |
| `hooks/useSidebar.js` | 9 | Replaced by `lib/nav/useShellStore.ts` (`collapsed`, `overlayOpen`, `moreOpen`). `Layout.js`, its last other user, is deleted |
| `withAuth.tsx` loading and redirect markup | ~20 | The shell shows its skeleton. `withAuth` keeps the redirect effect and returns `null` meanwhile |
| `styles/globals.css` `body.sidebar-open`, `.mobile-nav-item` (`:242–250`) | ~10 | The drawer is gone |
| Shell-local `framer-motion` use | — | CSS transitions only. The package stays (16 other files use it) |
| The `kx:labels-search` event | — | No listener anywhere (`grep` of `pages/app/labels.tsx`) |

`hooks/useScreenSize.js` is **kept**: legacy pages use its `<640px` `isMobile`. The shell does not use it; it uses `theme.breakpoints.down('md')` (900). Between 640 and 899 a legacy page body may still render its desktop layout inside the mobile shell. That is accepted for M2 and goes away page by page as surfaces migrate.

---

## 12. Implementation split (disjoint file groups for parallel agents)

Order: **A** and **B** start together. **C**, **D** and **E** start once A's `navConfig.ts`, `useNavModel.ts` and `ShellContext` types are merged (day 1; the types can be stubbed first). **F** comes last. No two groups write the same file.

| Group | Owner writes only these files | Delivers | Depends on |
|---|---|---|---|
| **A · Nav model** | `lib/nav/navConfig.ts`, `lib/nav/useNavModel.ts` (gating, cache, listingsHref, breadcrumbs from pathname, `g`-map), `lib/nav/useShellStore.ts`, `lib/nav/ShellContext.tsx` (`ShellProvider`, `usePageMeta`, `usePageTitle`), `lib/ds/icons.ts` additions (§14), `__tests__/ds/nav-unique-icons.test.ts`, `__tests__/nav/useNavModel.test.ts` | the typed IA, uniqueness test, gating parity with today | M0, M1 `LogoTile` types |
| **B · APIs and assets** | `pages/api/nav/counts.ts`, `lib/orders/views.ts` (created here, extended by Orders G1; CRITIQUE C4), `lib/billing/planLimits.ts`, `lib/middleware/withUsageLimiter.ts` (import only), `pages/api/user/settings.ts` (add `limits`/`period`), the `UserSettingsResponse` type file, `lib/nav/useNavCounts.ts` (SWR hook), `public/logos/marks/*.svg`, `lib/ds/marketplaces.ts` (`mark` paths), `__tests__/api/nav-counts.test.ts`, `__tests__/billing/planLimits.test.ts` | counts endpoint, limits field, square marks | — |
| **C · Desktop chrome** | `components/ds/shell/AppShell.tsx`, `SideNav.tsx`, `SideNavItem.tsx`, `SideNavFooter.tsx` (UsageMeter + collapse), `TopBar.tsx`, `Breadcrumbs.tsx`, `SearchTrigger.tsx`, `AccountMenu.tsx`, `AccountBanner.tsx`, `NotificationsButton.tsx`, `ShortcutSheet.tsx`, `__tests__/ds/shell/*.test.tsx` | sidebar (expanded, auto-rail, overlay at 900–1199), TopBar, account menu, notifications, banner | A, M1 |
| **D · Mobile chrome** | `components/ds/shell/MobileTopBar.tsx`, `MobileTabBar.tsx`, `MoreSheet.tsx`, `usePullToRefresh.ts`, `__tests__/ds/shell/mobile*.test.tsx` | 48px TopBar, tab bar (`--kx-bottom-nav`), More sheet, pull-to-refresh | A, M1 `BottomSheet` |
| **E · Command palette** | `components/ds/shell/CommandPalette.tsx`, `lib/ds/usePageActions.ts`, `lib/ds/useCommand.ts`, `lib/ds/fuzzy.ts`, `lib/nav/orderHits.ts`, `lib/nav/useGoShortcuts.ts`, `__tests__/ds/palette.test.tsx`, `__tests__/ds/fuzzy.test.ts` | palette with On this page / Recent / Actions / Go to / Orders, `g`-shortcuts | A |
| **F · Integration and header pass** | `pages/_app.tsx` (mount `AppShell` for app routes: `/app/**` except `/app/print/**`, `/ayarlar`, `/faturalar`), `components/AppLayout.js` (shim), `components/withAuth.tsx`, `components/ds/page/Page.tsx` (wire to `ShellContext`), the 18 route files in §6.2 (title + `<Page>` wrap + ad-hoc H1 removal only), `pages/404.js`, `pages/_error.js`, `pages/logout.js`, deletions in §11, `styles/globals.css` (shell rules only), `messages/en.json` + `messages/tr.json` (all §10 keys, one owner so the JSON never conflicts) | the switch-over in one PR | A–E |

i18n: groups C, D and E **do not** edit the message files. They use only the keys in §10 and list any extra key they need in their PR description. Group F writes both message files once, from §10 plus those lists. A missing key shows up in F's render tests (next-intl returns the key path, which the tests assert against).

Flag: the shell switches globally (DS §7.1.6). There is no per-surface flag, because two shells side by side would double the polling and the state. The rollback is a revert of PR F.

---

## 13. Tests and definition of done (shell-specific, on top of DS §8)

- `nav-unique-icons.test.ts`: no two items share an `icon` reference or a `brand`; every label key exists in both message files.
- `useNavModel.test.ts`: the tri-state gating table (connected / not connected / unknown with and without cache / cache from another user id) gives the same visible items as today's `AppLayout` for 6 fixtures. The Shopify-free account never sees an Invoices entry in the palette.
- `nav-counts.test.ts`: a fixture with one shipped Amazon order, one cancelled order, one labeled order and one unlabeled order past its ship-by date returns `{ toShip: 1, overdue: 1 }`.
- `planLimits.test.ts`: the middleware decisions are byte-identical before and after the extraction (trial 50/10, starter 200/100, growth 2000/500, enterprise and shopify_free unlimited).
- Render tests: rail tooltips exist for every item; the active item has `aria-current="page"`; a reconnect dot has a text equivalent; the tab bar sets and removes `--kx-bottom-nav`.
- Screenshots: 1440 expanded, 1440 collapsed, 1024 rail, 1024 overlay open, 390 page, 390 More sheet, 390 notifications sheet, all in EN and TR, plus the account banner state and the empty-store state.
- Manual: navigate 10 routes and confirm the sidebar does not flash or re-animate (persistent shell); keyboard-only run of `⌘K`, `g o`, `[`, `?`, `Esc`; Turkish Q layout check for `g` shortcuts; iPhone safe areas (TopBar top inset, tab bar bottom inset).

---

## 14. Additions to the system (justified)

Each one is small and has no existing DS equivalent. They are proposed for `DESIGN_SYSTEM.md` §4.2 and §3.15 in the same PR as group A.

1. **Icon registry entries** (`lib/ds/icons.ts`): `overview: Home`, `help: LifeBuoy`, `add: Plus`, `notifications: Bell`, `search: Search`, `signOut: LogOut`, `language: Languages`, `shortcuts: Keyboard`, `usage: Gauge`, `collapse: PanelLeftClose`, `expand: PanelLeftOpen`, `back: ChevronLeft`, `menu: Menu` (More tab). The registry today has no entry for these shell meanings, and P4 forbids importing lucide directly in pages. `Home` is not used anywhere else (Overview only), which keeps "one icon, one meaning".
2. **`NavItem.match?: string[]`** (path globs for the active state) and **`NavItem.gKey?: string`**. Without `match`, Research could not be active on its 4 legacy routes plus the hub, and the Etsy row could not be active on `/app/etsy-listings/[id]` and `/bulk`. `gKey` replaces the free-form `shortcut` for nav items so the uniqueness test can also check that no two items share a `g` letter.
3. **`NavItem.dot` gains `'attention'`** (unsent staged changes). The DS defines attention as exactly "changes not sent yet" (§2.1). Showing it per marketplace in the nav is the cheapest way to make the staged-draft model visible everywhere, which is something Vela's always-live editing does not need and we do. `countTone` is unchanged.
4. **`Page` props `breadcrumbs`, `backHref`, `mobileAction`** plus a `ShellContext`. `TopBar` already declares `breadcrumbs`, `mobileTitle`, `onBack` and `mobileAction` (§4.2), but nothing in the system says how a page supplies them. Putting them on `Page` keeps P4 (one way to do it) and avoids pages importing `TopBar`.
5. **`ShortcutSheet`** is a composition (`Modal` + `KeyValueList` + `Kbd`), not a new primitive. It lives in `ds/shell/` because `?` is global.
6. **`AccountBanner`** is a `Banner` instance with fixed rules (blocking account state only, never for Shopify-free, never marketing). It is named so the "no marketing banners" rule has one enforcement point.
7. **Persistent shell in `_app`** (not a component, an architecture rule): app routes share one mounted `AppShell`. This is what makes "no remount flicker" and single polling possible, and it is why `AppLayout` can shrink to a shim without touching 18 pages at once.

Nothing else is introduced: no new colours, sizes, radii, motion values or component kinds.

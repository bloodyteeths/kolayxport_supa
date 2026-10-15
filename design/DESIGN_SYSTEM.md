# KolayXport Design System (final)

Status: **final, binding**. Date: 2026-10-15. Design only: no app code has been changed.
Base: the "Seller Workspace" proposal (`proposals/seller-tool.md`, the judges' winner on seller speed and on beating Vela). It is merged with ideas from "Precision" and "Merchant-friendly", following the judges' graft lists. Research follows `design/RESEARCH_REDESIGN.md` (data inventory, guards, build order), shaped into the tool set defined in §3.18.
Paste-ready code (theme, Tailwind `@theme`, tokens, parity test, font, lint) lives in `design/tokens.md`. This file is the contract and `tokens.md` is the implementation. When they disagree, this file wins and `tokens.md` gets fixed.

Inputs: `scratchpad/visual_findings.md` (production audit, 35 findings), `scratchpad/settings_spec.md`, the three proposals, the two judge verdicts, and the `kx-ux-phase0` checkout at `92087ba`.

### Repo facts this system is built on (checked on 2026-10-15)

| Fact | Consequence |
|---|---|
| `@mui/material ^5.17`, `@mui/x-data-grid ^8.3` (Community), `@mui/x-date-pickers ^6.20` (Community: **no range picker**) | Theme uses the v5 `createTheme` API. Date ranges are built from `DateCalendar`. The MUI core upgrade is its own project, outside this rebuild. |
| `lib/theme.tsx` has gradient `contained` buttons, `translateY(-1px)` hover, purple `secondary`, `borderRadius: 12`, Paper with border **and** shadow | Replacing these overrides in one PR calms every legacy page at once (M0). |
| `styles/globals.css`: `@import "tailwindcss"` (v4), **no `@theme`**, Google Fonts `@import`, `.glass`, `.gradient-text`, `.card-premium`, a z-index scale (1000–1600) that conflicts with MUI | Tokens move into `styles/tokens.css` (`@theme`). Inter moves to `next/font`. Legacy utilities are deleted in M10. |
| 112 files use `sx={{ p: 2 }}`-style spacing | **MUI `spacing` stays 8.** Changing it to 4 would silently halve every legacy gap. |
| 73 files use `<TextField label>` (floating labels) | **No global `shrink: true` and no global legend hiding.** Labels sit above the field only inside `ds/FormField` and `ds/TextField`. |
| 47 files use Tailwind default palettes (`slate-*`, `blue-*`, `purple-*`…) | **No `--color-*: initial` until M10**, after a grep for non-DS palettes comes back empty. The DS neutral scale uses Tailwind slate values, so legacy `slate-*` and new `neutral-*` render identically. |
| 39 files use Tailwind responsive prefixes (`md:` = 768px) and MUI `md` = 900px | Tailwind breakpoints stay at their defaults until M10. DS components get responsive behaviour from MUI `theme.breakpoints`, and migrated pages may not use Tailwind responsive prefixes. |
| Tailwind v4 default radii: `rounded-sm` 4, `md` 6, `lg` 8, `xl` 12 | These **are** the DS radius scale, so the defaults are not redefined. |
| The legacy unlayered `:root` in `globals.css` sets `--radius-lg: 16px`, `--radius-xl: 20px` and `--font-sans`, which override Tailwind's theme variables. Today `rounded-lg` renders at 16px and `rounded-xl` at 20px | M0 deletes that `:root` block. `rounded-lg`/`rounded-xl` drop to 8/12 in 36 files. This is intended: it removes the "bubbly template" look app-wide, and it is checked in the M0 screenshots. `.btn-primary`/`.btn-secondary`/`.gradient-text` are flattened in M0 and deleted in M10. |
| `@mui/icons-material` in 74 files, `lucide-react` in 64 | Only lucide is allowed. MUI icons are migrated out by M10. |
| `<input type="date">` in 5 files, `uppercase` in 20, `gradient` in 44, `.toFixed(` in 65 | Lint rules start as warnings and become errors per directory once that directory is migrated. |
| DataGrid is used in 7 files (5 listings pages, labels, ShippingCostCell) | DataGrid is retired from list pages and survives **only inside `ds/BulkGrid`**. |
| `_document.js` hard-codes `<Html lang="tr">`. The locale is client-side (`useLocaleStore`, localStorage) | `_app` sets `document.documentElement.lang` on every locale change, and `uppercase` is removed everywhere. Together these kill the "FAİLED" bug. |
| `lib/i18n/formatting.ts` exists (`formatCurrency/formatDate/formatNumber`, `getIntlLocale`) | `lib/format.ts` wraps it. There is no second formatter. |
| `lib/hooks/useConfirm` has `typeToConfirm`, implemented with `window.prompt` | `typeToConfirm` is kept, rendered as a field inside `ConfirmDialog` instead of `window.prompt`. |
| `react-hot-toast`, ApexCharts, `date-fns@2`, `CommandPalette.tsx` (455 lines), `MobileTabBar.tsx` (sets `--kx-bottom-nav`) | The DS wraps these. **No new runtime dependencies** in v1 (M0 adds ESLint as a devDependency; the repo has none today). `@tanstack/react-virtual` is added only if profiling shows a need (§3.4). |
| `public/logos/` has etsy, amazon (svg), trendyol, hepsiburada, n11 (png), shopify (jpg), woocommerce (svg) | Add SVGs for ebay, wix, fedex, ups, dhl, veeqo, shippo, parasut and google, and replace the png/jpg files with SVG. Until then a monogram fallback is used. |
| Listing routes are `/app/etsy-listings`, `/app/ebay-listings`, `/app/trendyol-urunler`, `/app/wix-urunler`, `/app/shopify-urunler` | **Routes stay.** Each route file renders `<ListingsPage marketplace=…>`. URLs are not renamed. |

### Conflicts resolved (no options remain)

| Question | Decision | Why |
|---|---|---|
| Base proposal | Seller Workspace | Only proposal with a real answer to Vela (bulk grid, inline edits, rate list). |
| MUI spacing | **8** (unchanged) | 112 legacy files. DS code uses token values, not `theme.spacing` multiples. |
| Floating labels | Labels above, **only in `ds/FormField`** | 73 legacy files. |
| Tailwind palette wipe | **M10 only**, once grep finds no non-DS palette | 47 legacy files. |
| Global `* { text-transform: none !important }` | **Rejected.** `uppercase` is removed from the 20 files in M0, the theme sets `textTransform: 'none'`, and lint bans it | A blunt global override hides bugs and breaks legitimate CSS. |
| Neutral scale | Tailwind slate values, named `neutral-*` | Legacy `slate-*` and the DS look the same during migration. |
| Accent | `#2563EB` (current `primary.main`) | Continuity: legacy `color="primary"` is already correct. |
| Info tone | Blue, same hue as the accent, but only in pills and banners | A cyan fourth hue was rejected. Info never appears on a button. |
| Unsent changes | New tone **attention** (orange) | Reads as different from warning (amber) and from failure (red). |
| Dirty cell tint | `attention-bg`, **not** `accent-50` | One meaning, one color. `accent-50` already means "selected row". |
| List tables | Headless `ds/DataTable` on MUI `Table`, with columns that declare a mobile role | DataGrid breaks on mobile, and one rows+columns definition renders both forms. |
| DataGrid | Only inside `ds/BulkGrid` | Cell editing is the one thing it does well. |
| Virtualization | None in v1. Max page size 250. Add `@tanstack/react-virtual` only if a 250-row page drops frames in profiling | Avoids weeks of infrastructure. |
| Pagination | Server-side, 50/100/250, footer "1–50 of 1,284" on Orders and Listings. "Load more" only for Messages | Shops have up to 5,000 listings. |
| Sync controls | **Push and pull are separate.** Push: "Send N changes to Etsy" is the page primary when N > 0. Pull: "Refreshed from Etsy 12 min ago ⟳" in the PageHeader `meta` | Two different directions should never share one button or one word. |
| Side panel | **Overlay** with a light backdrop. The list stays mounted (scroll and selection preserved), with prev/next. No push-content mode in v1 | The non-modal push mode is a lot of state work for little gain. |
| Mobile primary | `StickyActionBar` above the tab bar. **No FAB anywhere** | Thumb reach, and one pattern. |
| Mobile "New listing" | A labeled 40px `+ New` button in the mobile TopBar. The sticky bar is reserved for state-driven primaries (send N changes, create N labels) | The sticky bar should not be permanently occupied by a creation action. |
| Keyboard v1 | `⌘K`, `/`, `Esc`, `j/k`, `x`, `Enter`, `e`, `⌘↵`, `⌘S`, `g`+letter (via the palette), `?`. **Deferred:** `l`, `p`, `⇧x`, range select, `⌘Z` | Most of the speed for a fraction of the build. Phone-first sellers do not need more. |
| BulkGrid v1 | Cell edit, TSV paste (from the focused cell down one column; multi-column paste if the clipboard is rectangular and the columns are editable), fill-down `⌘D`, find & replace per column, dirty/invalid tint, revert cell. **Deferred:** free range selection, undo stack | Range selection and undo are Premium-grade features to rebuild. Revert cell covers undo for staged drafts. |
| Date range | `ds/DateRangeField` built on x-date-pickers v6 `DateCalendar` (two months plus presets) | No `react-day-picker`. Uses what is installed. |
| Toasts | `react-hot-toast` wrapped in `useToast()`. Bottom-center on desktop, above the tab bar on mobile. **One visible**, the rest queued | Calm. |
| Score name | Component `ScoreMeter`. User-facing label "Listing health" / "İlan sağlığı" | Plain-language glossary. |
| Score bands | 0–49 Needs work (danger) · 50–74 Fair (warning) · 75–89 Good (success) · 90–100 Great (success, full bar) | One scale everywhere. |
| Research | One hub, four tools plus Home (§3.18), run as a **parallel track** starting with the R0 honesty patch in week 1 | It is the founder's headline complaint. |
| AI verdict card | **Dropped.** It is replaced by an `EvidenceSummary` (computed facts plus a confidence label derived from sample size). AI may only explain numbers we computed | Confident-but-wrong numbers are the founder's main research complaint. |
| Sales sparkline column | **Cut** from v1. A plain "Sold 30d" number column ships once `OrderItem` to listing linkage is verified per marketplace | No decorative data. |
| `/design-system` route and Playwright visual snapshots | M10, optional | Not on the critical path. |
| Shared primitives location | `components/ds/*`. `components/ui/*` and `components/settings/ui/*` become **re-export shims** | No second mini design system. |
| Theme file | `lib/theme.tsx` stays at its path and imports values from `lib/ds/tokens.ts` | Zero import churn. |

---

## 1. Principles (6), each with hard rules

A screen that breaks a rule has a bug, not a style choice.

### P1. One job per view, one primary action
- **Exactly one primary (solid accent) button per view.** A drawer, sheet or modal is its own view with its own single primary. While an overlay is open, the page primary is behind the backdrop.
- When rows are selected, the BulkActionBar's main action becomes the primary, and the PageHeader primary is demoted to secondary.
- PageHeader holds at most 1 primary and 2 visible secondaries. Everything else goes in `⋯`.
- Destructive actions (delete, disconnect, cancel order, queued Etsy delete) live **only** in `⋯` (last, separated, `danger-ghost`) or in a confirmation modal. They never sit next to the primary.
- **Push and pull never share a control.** "Send N changes to Etsy" (push) is a primary or a banner action. "Refresh from Etsy" (pull) is an icon button inside the PageHeader `meta`.
- A button that cannot do anything is not rendered. A disabled button always has a `disabledReason` tooltip.

### P2. Calm density, color only means something
- Table rows are 44px (36 in compact density) with 13px body text. Toolbar controls are 32px, form controls 40px, and both are 44px on `pointer: coarse`.
- Chrome uses only the neutral scale plus one accent. Semantic tones appear only in `StatusPill`, `Banner`, `ScoreMeter`, form validation, KPI deltas and dirty-cell tint.
- Marketplace and carrier brand colors appear **only inside `LogoTile`**.
- No gradients, glass, glows, colored hero banners, rainbow KPI tiles or `translateY` hovers, anywhere. **Green is never a button color.**
- Surfaces are flat: white with a 1px `neutral-200` border. Shadows exist only on floating layers.

### P3. Fast for 5,000 listings, easy on a phone
- Every list page supports `/` (search), `j`/`k` (move), `x` (select), `Enter` (open panel), `e` (open editor, listings only) and `Esc` (clear or close). Every panel supports `⌘/Ctrl+Enter` (primary) and `⌘/Ctrl+S` (save draft). `⌘K` works everywhere and `?` shows the shortcut sheet.
- Shortcuts match on `KeyboardEvent.key`, not `code`, so they work on Turkish Q and F layouts. They never fire while focus is in an input, except `Esc`, `⌘↵` and `⌘S`.
- **`usePageActions`**: every PageHeader primary, secondary and overflow action registers itself in the command palette. Nothing is reachable only from the palette, and nothing in a header is missing from it.
- Filters, sort, search, saved view, page, page size and the open record live in the URL query, so views are shareable and survive a reload.
- Mobile thumb rules: touch targets are at least 44×44 under `pointer: coarse`, inputs use 16px text (no iOS zoom), the state-driven primary sits in `StickyActionBar` above `--kx-bottom-nav`, sheet footers split 50/50 at 48px, and sheets have a drag handle.

### P4. One component per concept, edit in place
- One `PageHeader`, one `Toolbar`, one `DataTable`, one `SidePanel`, one `StatusPill` vocabulary, one `ScoreMeter`, one `Money`, one `DateRangeField`, one icon registry.
- When marketplaces differ, the component takes props and the layout is never forked. All five listing routes render `<ListingsPage marketplace>`. All carriers render one `<CreateLabelPanel>`.
- Selecting a row opens a `SidePanel` over the list. The list stays mounted, so scroll and selection survive, and `‹ ›` / `j`/`k` move between records. Full pages are used only for the listing editor, the bulk editor, the creators and research tools.
- Modals are only for confirmations and short forms of 4 fields or fewer.
- Migrated pages import UI only from `components/ds/*` and `lucide-react`. A raw `@mui/material` import in a migrated page is a lint error.

### P5. One language, one format
- Every user-facing string goes through `next-intl`. `react/jsx-no-literals` covers `pages/app/**` and `components/**`. Each screen is 100% EN or 100% TR. Turkish uses real characters (ı İ ş ğ ç ö ü) and never ASCII-Turkish ("Olustur" is a bug).
- Labels are verb-first and plain, from the glossary (§3.19): "Send changes to Etsy", "Refresh from Etsy", "Reconnect Etsy", "Create label". Jargon (ETGB, IOSS, HS code, SKU, GTIN) gets a `(?)` `TermHint` tooltip on first use per screen.
- **No `text-transform: uppercase` anywhere.** Everything is sentence case in the message files. `<html lang>` follows the UI locale. Where an uppercase string is unavoidable, use `toLocaleUpperCase(locale)`.
- Money, numbers and dates go only through `Money`, `Num`, `DateText`, `ShipBy` (which wrap `lib/format.ts`, which wraps `lib/i18n/formatting.ts`). `.toFixed(` in TSX and `<input type="date">` are lint errors.
- Marketplace text is entity-decoded once at the mapper boundary (`lib/text/decodeEntities.ts`), stored decoded, and never re-encoded on push. The UI never shows `&#39;`.
- AI listing content stays in the marketplace language: English titles and tags for Etsy, eBay and Amazon. Only AI commentary follows the UI locale.

### P6. Honest data
- No metric without a source and a time. KPI tiles show "as of 10:42 · Etsy + eBay". Research and AI metrics carry a mandatory `SourceNote` (source · fetched · sample n · kind).
- Each number is one of four kinds: **Measured** (plain), **Estimate** (`~` prefix with the model named in the tooltip), **Signal** (5-dot tier with no unit) or **You entered**. No unlabeled numbers appear in research.
- A value that fails a sanity guard (sample too small, outlier, currency mix, implausible bound) renders `—` with the reason in a tooltip. Never print a fake-precise number. Prices use the median and the p25–p75 band and **never an arithmetic mean**.
- Scores state their denominator. A check that depends on missing data is `n/a`, it is excluded, and the panel reads "Scored on 9 of 12 checks".
- Every async region has exactly four states: skeleton, data, empty and error. **No endless skeletons**: at 15s it shows "Still loading… Retry", and at 30s an `ErrorState`. Background syncs report progress in PageHeader `meta`, never in a permanent banner.
- ErrorState says what really happened: "Couldn't check Etsy" when a check failed, never "Not connected" unless we know that is true.

---

## 2. Tokens

Values are listed here; the code is in `tokens.md`. `lib/ds/tokens.ts` is the single source of truth. `styles/tokens.css` mirrors it, and `__tests__/ds/tokens-parity.test.ts` fails CI on drift.

### 2.1 Color

**Neutral** (Tailwind slate values, so legacy `slate-*` matches; plus `25`)

| Token | Hex | Use |
|---|---|---|
| `neutral-0` | `#FFFFFF` | surfaces: tables, cards, panels, inputs |
| `neutral-25` | `#FBFCFD` | table header, sticky footers |
| `neutral-50` | `#F8FAFC` | page background, sidebar, row hover |
| `neutral-100` | `#F1F5F9` | hover fill, skeleton base, table row separators |
| `neutral-200` | `#E2E8F0` | **default border**, dividers |
| `neutral-300` | `#CBD5E1` | input border, secondary-button border |
| `neutral-400` | `#94A3B8` | placeholder, disabled text (never body text) |
| `neutral-500` | `#64748B` | secondary text, icons (4.8:1 on white) |
| `neutral-600` | `#475569` | dense table text, nav text |
| `neutral-700` | `#334155` | strong secondary, ghost-button text |
| `neutral-800` | `#1E293B` | primary text |
| `neutral-900` | `#0F172A` | headings, tooltip and toast background |

**Accent** (the only brand hue; purple and indigo are removed)

| Token | Hex | Use |
|---|---|---|
| `accent-50` | `#EFF6FF` | **selected row**, active filter chip |
| `accent-100` | `#DBEAFE` | selected hover |
| `accent-200` | `#BFDBFE` | info border |
| `accent-500` | `#3B82F6` | focus-ring base |
| `accent-600` | `#2563EB` | **primary button**, links, focus border, active tab, selected-row bar (5.2:1 with white) |
| `accent-700` | `#1D4ED8` | primary hover, info text |
| `accent-800` | `#1E40AF` | primary pressed |
| focus ring | `0 0 0 3px rgb(37 99 235 / .28)` | every focusable control |

**Semantic tones.** Each has `bg`, `border`, `fg` (text and icon, AA on bg) and `solid` (dot, bar, danger button).

| Tone | bg | border | fg | solid | Meaning (only) |
|---|---|---|---|---|---|
| success | `#F0FDF4` | `#BBF7D0` | `#15803D` | `#16A34A` | done, live, connected, shipped |
| warning | `#FFFBEB` | `#FDE68A` | `#B45309` | `#D97706` | needs attention soon, not broken |
| danger | `#FEF2F2` | `#FECACA` | `#B91C1C` | `#DC2626` | failed, overdue, destructive |
| info | `#EFF6FF` | `#BFDBFE` | `#1D4ED8` | `#3B82F6` | in progress, neutral news |
| attention | `#FFF7ED` | `#FED7AA` | `#C2410C` | `#EA580C` | **changes not sent yet** (staged drafts, dirty cells) and nothing else |
| neutral | `#F1F5F9` | `#E2E8F0` | `#475569` | `#94A3B8` | inactive, cancelled, n/a |

**Brand colors** (used only as the monogram fallback background inside `LogoTile`; real logos keep their own colors on a white tile)

| Key | Hex | Key | Hex |
|---|---|---|---|
| etsy | `#F1641E` | fedex | `#4D148C` |
| ebay | `#E53238` | ups | `#351C15` |
| amazon | `#FF9900` | dhl | `#FFCC00` (text `#D40511`) |
| shopify | `#95BF47` | veeqo | `#2A2E3B` |
| wix | `#000000` | shippo | `#1B9C85` |
| trendyol | `#F27A1A` | parasut | `#00A1E4` |
| hepsiburada | `#FF6000` | n11 | `#6E2C91` |

**Chart palette** (charts only, in order): `#2563EB`, `#0D9488`, `#D97706`, `#7C3AED`, `#DB2777`, `#64748B`. A single-series chart uses `#2563EB`. Money direction uses `success-fg` and `danger-fg` as **text color only**.

### 2.2 Typography
- **Family:** Inter via `next/font/google`, `subsets: ['latin','latin-ext']` (latin-ext covers ğ ş ı İ), `display: 'swap'`, `variable: '--font-inter'`. The Google Fonts `@import` and the preconnects in `_document` are deleted.
- **Mono:** `ui-monospace, "SF Mono", Menlo, monospace` for order numbers, SKUs, tracking numbers and IDs.
- **Numerals:** `tabular-nums` in tables, `Money`, `Num` and KPI tiles.
- **Weights:** 400, 500, 600. **700 and 800 are not used.**

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 28 / 36 | 600 | -0.02em | KPI values (Overview, Reports) |
| `title-lg` | 20 / 28 | 600 | -0.015em | page title (PageHeader) |
| `title-md` | 16 / 24 | 600 | -0.01em | panel title, section heading |
| `title-sm` | 14 / 20 | 600 | 0 | card title, form group heading |
| `body` | 14 / 20 | 400 | 0 | forms, paragraphs |
| `dense` | 13 / 18 | 400 | 0 | table cells, list rows |
| `label` | 13 / 18 | 500 | 0 | field labels, buttons |
| `caption` | 12 / 16 | 400 | 0 | helper text, meta, timestamps, table headers (500) |
| `micro` | 11 / 14 | 500 | 0.01em | pills, counters, kbd |

On `pointer: coarse`, input text is 16px. MUI `h1`–`h6` stay defined for legacy code, remapped to 28/24/20/18/16/14 at weight 600. New code uses the semantic variants only, and lint bans `variant="h1..h6"` in migrated files.

### 2.3 Spacing (4px grid)
Allowed values: `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Tailwind's v4 default `--spacing` (4px) already matches (`p-3` = 12px). **MUI `theme.spacing` stays 8**, so DS components write pixel tokens (`sx={{ p: '12px' }}` via `space[3]`) or Tailwind classes, never `p: 1.5`.

Fixed usages:
- Page gutter: 24 desktop, 16 mobile.
- PageHeader to content: 16. Between page sections: 32.
- Toolbar control gap: 8.
- Card and panel padding: 16 (20 for panel body sections).
- Fields: 16 between fields, 24 between groups.
- Table cell horizontal padding: 12.

### 2.4 Control heights

| Token | px | Use |
|---|---|---|
| `control-sm` | 32 | toolbar, filter buttons, row actions, segmented controls |
| `control-md` | 40 | form fields, panel and modal footer buttons, PageHeader actions |
| `control-lg` | 44 | mobile primary, empty-state CTA. Every control is at least 44 on `pointer: coarse` |
| `control-xl` | 48 | mobile sheet footer and StickyActionBar buttons |

**One height per row.** A 32px search next to a 40px date field is a bug.

### 2.5 Radii (equal to the Tailwind v4 defaults; nothing redefined)

| Token | px | Tailwind | Use |
|---|---|---|---|
| `radius-xs` | 4 | `rounded-sm` | kbd, checkbox, menu items, tooltip |
| `radius-sm` | 6 | `rounded-md` | **buttons, inputs, selects, nav items, thumbnails** |
| `radius-md` | 8 | `rounded-lg` | cards, tables, menus, popovers, LogoTile, toasts |
| `radius-lg` | 12 | `rounded-xl` | modals, side panels (leading edge), sheets (top corners), command palette |
| `radius-full` | 9999 | `rounded-full` | StatusPill, avatar, switch |

MUI `shape.borderRadius` = 6.

### 2.6 Borders
- `border`: 1px `neutral-200`. Every surface and divider.
- `border-strong`: 1px `neutral-300`. Inputs and secondary buttons. `neutral-400` on hover.
- `border-focus`: 1px `accent-600` plus the focus ring.
- `border-invalid`: 1px `danger-solid`.
- Table row separators are 1px `neutral-100`.
- Selected row: `accent-50` background plus a 2px `accent-600` inset bar on the left.
- Dirty cell: `attention-bg` background plus a 2px `attention-solid` inset bar on the left.
- **Never a border and a shadow together** on an in-flow surface.

### 2.7 Elevation (floating layers only)

| Token | Value | Use |
|---|---|---|
| `e0` | none | all in-flow surfaces |
| `e1` | `0 1px 2px rgb(15 23 42 / .06)` | sticky table header once scrolled, StickyActionBar |
| `e2` | `0 4px 12px rgb(15 23 42 / .08), 0 1px 3px rgb(15 23 42 / .06)` | menus, popovers, autocomplete, date picker |
| `e3` | `0 12px 32px rgb(15 23 42 / .12), 0 2px 6px rgb(15 23 42 / .06)` | side panel, toast |
| `e4` | `0 24px 64px rgb(15 23 42 / .18)` | modal, command palette |

The backdrop is `rgb(15 23 42 / .32)` with no blur. `.glass` is deleted.

### 2.8 Z-index (one table; MUI `zIndex` is overridden to match)

| Layer | z | How |
|---|---|---|
| sticky table header | 2 | DS CSS |
| sticky toolbar / BulkActionBar | 20 | DS CSS |
| StickyActionBar (mobile) | 1040 | DS CSS |
| mobile tab bar | 1050 | `zIndex.mobileStepper` |
| top bar | 1100 | `zIndex.appBar` |
| sidebar | 1150 | `zIndex.speedDial` (otherwise unused) |
| SidePanel / Drawer | 1200 | `zIndex.drawer` |
| Modal / Dialog | 1500 | `zIndex.modal` |
| nested dialog (confirm inside a panel or modal) | 1550 | `<Modal nested>` / `ConfirmDialog` |
| Menu, Select, Popover, Autocomplete popper, date picker | 1600 | theme `MuiPopover`/`MuiMenu`/`MuiAutocomplete.popper`/`MuiPopper` root |
| command palette | 1650 | DS CSS |
| toast | 1700 | `zIndex.snackbar`, plus `Toaster` `containerStyle` |
| tooltip | 1800 | `zIndex.tooltip` |

This satisfies the existing rule that nested MUI Select, Autocomplete and Dialog layers sit at 1500–1600. The old `--z-*` scale in `globals.css` is deleted in M0.

### 2.9 Motion

| Token | ms | Easing | Use |
|---|---|---|---|
| `instant` | 80 | linear | hover background, checkbox |
| `fast` | 140 | `cubic-bezier(.2,0,0,1)` | menus, tooltips, pill changes |
| `base` | 200 | same | side panel, tab indicator |
| `slow` | 280 | same | sheet, modal |

No bounce and no hover transforms. `prefers-reduced-motion` sets every duration to 0, except opacity fades, which stay at 80ms. The skeleton shimmer (1.4s linear) is off under reduced motion.

### 2.10 Layout constants
- Sidebar 240 expanded, 64 rail.
- TopBar 52 desktop, 48 mobile. Tab bar 56 plus safe area (`--kx-bottom-nav`, already set by MobileTabBar).
- Content max widths: list 1600, detail/dashboard 1280, form 880, reading 720.
- Field max width 480. Long text fields max 720.
- SidePanel widths: sm 440, md 560, lg 720, xl 960.
- Breakpoints (MUI): xs 0, sm 600, md 900, lg 1200, xl 1536.

### 2.11 Dark mode
Not in scope until M10 is done. Tokens are CSS variables, so dark mode is a later variable swap under `[data-theme="dark"]`. Shipping it on a half-migrated app would expose every hard-coded hex.

---

## 3. Layout and patterns

### 3.1 AppShell (`ds/shell/AppShell`)

```
┌────────────┬──────────────────────────────────────────────────────────────────┐
│ [K] Kolay  │ Listings / [E] Etsy / BelleCoutureGifts ▾    [⌘K Search or jump…]  (bell) (TS) │ TopBar 52
│            ├──────────────────────────────────────────────────────────────────┤
│ Overview   │  <Page width="list|detail|form|reading">                         │
│ Orders  12 │    PageHeader                                                    │
│ Messages 3 │    Toolbar                                                       │
│ Listings   │    Content                                                       │
│  [E] Etsy  │                                                                  │
│  [e] eBay  │                                                                  │
│  [T] Trendyol                                                                 │
│  [W] Wix   │                                                                  │
│  [S] Shopify                                                                  │
│  + Connect a store                                                            │
│ Research   │                                                                  │
│ Reports    │                                                                  │
│ Finance    │                                                                  │
│ ─────────  │                                                                  │
│ Settings • │                                                                  │
│ Help       │                                                                  │
│ [plan meter]                                                                  │
│ « Collapse │                                                                  │
└────────────┴──────────────────────────────────────────────────────────────────┘
```

**Sidebar** (`ds/shell/SideNav`, driven by one `lib/nav/navConfig.ts`)
- 240px expanded and 64px rail. The rail **collapses automatically at 900–1199px**. Below 900 the sidebar is hidden and MobileTabBar shows instead. The user's choice persists through the existing `useSidebar`, and `[` toggles it.
- `neutral-50` background with a 1px right border. Items are 32px tall, 13/500, radius 6, with a 16px lucide icon or a 16px `LogoTile`.
- **Active item:** `neutral-0` background, `neutral-900` text, `e1` hairline. This is the same selection style everywhere (no filled blue pill).
- Counters (orders to ship, unread messages) are right-aligned `micro` tabular text in neutral color, turning `danger-fg` only when something is overdue. A dot marks "needs attention" (reconnect).
- **Every marketplace item uses its real logo.** In the rail, every item shows its icon or logo plus a tooltip with the label and shortcut. **No two items share an icon**, enforced by a Vitest test over `navConfig`.
- Groups (sentence-case labels, 12/500, `neutral-500`; never uppercase):
  - Overview, Orders, Messages.
  - **Listings:** one row per connected marketplace, plus "Connect a store".
  - **Research:** one entry to `/app/research`. The marketplace is a filter inside the tools.
  - Reports, Finance.
  - Bottom: Settings (reauth dot), Help. Invoices and "Integrations & guides" move into Settings and Help.
- The footer holds a `UsageMeter` plan meter (Stripe-style) and the collapse toggle. A launch offer, if any, appears as one line in the plan meter and never as a page banner.

**TopBar** (`ds/shell/TopBar`)
- Holds breadcrumbs, the `⌘K` trigger (centered on desktop), notifications and the avatar menu (language, account, sign out).
- **It never shows the page title** (PageHeader owns that) and never adds "- KolayXport". The browser title is "{Page} · KolayXport", set by `<Page title>`.

**Mobile (< 900px)**
- MobileTabBar shows Overview, Orders, Listings, Messages, More. "More" opens a bottom sheet with the full `navConfig` (same logos).
- The TopBar is 48px and shows the page title (the only place it does), a back chevron on drill-in pages, search, and at most one labeled action (for example `+ New`).

### 3.2 Page template (`ds/page/Page`, `ds/page/PageHeader`)

```
PageHeader
  [title-lg Title] [count pill]                    [secondary] [secondary] [⋯] [Primary]
  caption subtitle (≤ 1 line, optional) · meta: "Refreshed from Etsy 12 min ago ⟳"
Toolbar (sticky under the TopBar)
Content
```

- `title` is required (i18n). `subtitle` is one line. `meta` carries freshness, pull and sync progress ("Syncing Etsy · 120 / 340").
- `primaryAction` takes 1, `secondaryActions` at most 2, `overflowActions` the rest. All of them register in ⌘K through `usePageActions`.
- The title row has a fixed 56px height, so pages do not jump when the subtitle is absent.
- Mobile: the title moves to the TopBar. Secondaries and overflow collapse into one `⋯`. A state-driven primary goes to `StickyActionBar`, and a creation primary goes to the TopBar `+ New`.

| `width` | Max | Pages |
|---|---|---|
| `list` | 1600, full width below that, left-aligned | Orders, all Listings, Messages, research tools, report tables |
| `detail` | 1280, centered | Overview, Reports, Finance, listing editor (form plus right rail) |
| `form` | 880 (Settings: 220px nav + 40px gap + 880) | Settings, Sender profile, Billing |
| `reading` | 720, centered | Help, guides, legal |

### 3.3 Toolbar (`ds/toolbar/Toolbar`)

```
[⌕ Search orders, SKU, buyer…  /] [Store: All ▾] [Status: All ▾] [Last 30 days ▾] [Filters • 2]   View: [To ship ▾]  [Density] 
Store: Etsy ✕   Ship by: Today ✕   Clear all                                                              142 results
```

- **One row, 32px controls.** It holds search (280px), at most 3 visible `FilterButton`s (outlined, "Label: Value ▾", where an empty value reads "Status: All"), a "Filters" button with a count that opens `FiltersSheet` (a right popover on desktop, a bottom sheet on mobile), `SavedViews` and density.
- Filters apply immediately on desktop. The mobile sheet has a 50/50 footer: "Clear" and "Show 142 results".
- **SavedViews replace segmented status controls.** Built-in views:
  - Orders: To ship · Overdue · Label created · Shipped · Problems · All.
  - Listings: All · Changes not sent · Sync failed · Needs work (score < 50) · Sold out · Inactive.
  - Messages: Needs reply · Unread · All.
  
  Users can "Save view". Views are defined on normalized status keys, so "To ship" can never contain a shipped Amazon order.
- Active filters appear as removable chips with "Clear all". There is no separate "Reset" button.
- **Dates use `DateRangeField` only.** Presets (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, This year, Custom) sit next to a two-month `DateCalendar`. The range applies on a preset click or on the second date pick, with no Apply button. The trigger reads "1–14 Oct 2026" / "1–14 Eki 2026". Weeks start on Monday in TR. Mobile gets a sheet with the presets and one month.
- The result count is right-aligned and tabular.
- **With a selection, the Toolbar row is replaced in place** by `BulkActionBar` at the same height: "12 selected · [Create labels] [Print] [Mark shipped] ⋯ · Clear (Esc)". On mobile the bulk bar is the `StickyActionBar`.
- Data refresh is **not** a toolbar button. It lives in the PageHeader `meta`.

### 3.4 DataTable, which becomes cards on mobile (`ds/data/DataTable`)

A headless table rendered with MUI `Table` primitives. **DataGrid is not used on list pages.**

Desktop:
- 1px border, radius 8.
- A sticky 36px header in `caption` 12/500 `neutral-500`, sentence case, that gains `e1` once scrolled.
- 44px rows (36 compact), 13px text.
- Column order: checkbox (visible on hover or once any row is selected), thumbnail 48 (`Thumb`), identity cell (title of at most 2 lines plus a mono meta line "SKU · ID"), then data columns. Numbers are right-aligned and tabular.
- Cells use `Money`, `DateText`, `StatusPill` and `ScoreMeter` only.
- Row hover is `neutral-50`. Selected rows are `accent-50` with the left bar.
- Row actions: at most **one** inline icon button (the most common action, for example "Create label") plus `⋯`, both shown on hover or focus. No red trash icons in rows.
- A "Columns" menu toggles columns, and the choice persists per page (`columnStateKey`, localStorage, guarded with try/catch).
- **Editable cells** (`type: 'money-edit' | 'int-edit'`): price and quantity in the listings tables. Click or `Enter` turns the cell into an input. `Enter`/`Tab` commits, which **stages a draft** (`EtsyListingDraft.fieldPatch` / `inventoryPatch` via `lib/etsy/draftClient.ts`, and the equivalent for other marketplaces), and `Esc` cancels. Dirty cells get the attention tint, and the page primary becomes "Send N changes to Etsy". Etsy is never written directly.
- Pagination is server-side with page sizes 50/100/250 and a footer "1–50 of 1,284  Rows 50 ▾  ‹ 1 2 … 26 ›". Messages uses cursor-based "Load more".
- Keyboard: `j`/`k`/`↑`/`↓` move focus, `x` toggles selection, `⌘A` selects the page, `Enter` opens the panel, `e` opens the editor.
- No virtualization in v1. If profiling a 250-row page shows dropped frames, add `@tanstack/react-virtual` inside DataTable only.

**Columns declare their mobile role:** `mobile: 'media' | 'title' | 'subtitle' | 'meta' | 'status' | 'trailing' | 'action' | 'hidden'`. Below 900px the same `rows` and `columns` render as cards:

```
┌──────────────────────────────────────────┐
│ [img]  Personalized Baby Blanket…      ⋯ │  media 64 · title · overflow
│ 64×64  #3891 · [E] Belle                 │  subtitle
│        $169.99            ● To ship      │  trailing · status
│        Ships today                        │  meta (joined with ·)
│        [ Create label ]                   │  action (max 1, 44px)
└──────────────────────────────────────────┘
```

- Cards are white with a 1px border, radius 8, 12px padding and 8px between them. Tapping a card opens the full-screen sheet version of the SidePanel.
- Selection uses a "Select" button in the list header (no long-press). It reveals checkboxes, and the BulkActionBar becomes the StickyActionBar. There are no swipe actions.
- Mobile shows "Load more" in place of page numbers. The page size stays 50.

### 3.5 SidePanel (`ds/overlay/SidePanel`)

```
┌──────────────────────────────────────────── md 560 (sm 440 / lg 720 / xl 960) ┐
│ [Logo] Title (title-md, 1 line)        ● Status    ‹ ›   ⋯   ✕               │ header 56, sticky
│ caption: #3891 · Etsy · Ordered 14 Oct                                         │
├────────────────────────────────────────────────────────────────────────────────┤
│ Section title                                                    Action link   │
│ content…                                                                        │
│ ─────────────────────────────────────────────────────────────────────────────── │
│ Section title                                                                   │
│ content…                                                          (scrolls)     │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⋯ More            Saved · 3 changes not sent to Etsy       [Secondary] [Primary]│ footer 64, sticky
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Header:** a logo or 40px thumbnail, the title, one `StatusPill`, `‹ ›` (also `j`/`k`), `⋯` and close (`Esc`). No unlabeled icons.
- **Body:** `SidePanelSection`s (title 14/600, an optional right action link) separated by a 1px `neutral-100` rule and 20px padding. There is no card-per-section and no tabs. With more than 5 sections a sticky anchor-chip nav appears. Sections holding required fields never start collapsed.
- **Footer:** one primary and one secondary on the right, `⋯` on the left (destructive actions last, in red), and the save state in the middle ("Saved", "Unsaved changes", "Sent to Etsy 2 min ago").
- **Behavior:**
  - At 900px and up it overlays the right side with a 16% backdrop. The list stays mounted and keeps scroll and selection.
  - At 600–899 the panel is `min(560px, 100vw - 48px)`.
  - Below 600 it is a full-height sheet with a drag handle, a sticky header and a sticky 50/50 footer at 48px.
- **Dirty guard:** close and prev/next on a dirty panel open a nested `ConfirmDialog` (z 1550) with "Keep editing" / "Discard".
- Opening focuses the first field or the title, and closing returns focus to the trigger row.

### 3.6 Modal (`ds/overlay/Modal`, `ConfirmDialog`, `useConfirm`)
- Use a modal only for confirmations, pickers and short forms (4 fields or fewer, no scrolling). Widths are 440 (sm) and 560 (md), with 20px padding, a `title-md` title and a right-aligned footer: secondary "Cancel" plus primary (or `danger` for destructive actions).
- A destructive confirm names the object: "Delete listing 'Baby Blanket'?" Irreversible bulk actions on more than 10 items, and any queued Etsy `delete`, require `typeToConfirm` (the count or the shop name) through a **field inside the dialog** (the current `window.prompt` implementation is replaced).
- Never open a modal on page load. Never stack two modals over a panel. `<Modal nested>` sets z 1550.
- Add Manual Order moves from a modal to a `SidePanel` (md).

### 3.7 Form fields (`ds/inputs/FormField` + inputs)
- **The label sits above** the control: 13/500 `neutral-800`, with a 6px gap. Floating labels never appear in DS forms; they come from the DS `TextField` using `hiddenLabel` and `notched={false}` locally, never from global theme settings.
- Optional fields carry "(optional)" in `neutral-500`. Required fields get no asterisk.
- Helper text (12px `neutral-500`, 1 line) sits below. An error replaces it (12px `danger-fg` plus a 14px alert icon), and the border turns `danger-solid`.
- Validation runs on blur and on submit, then re-validates on change once a field has shown an error. The submit button stays enabled. On click with errors, it scrolls to and focuses the first error and shows a summary `Banner` at the top of the form or panel: "Fix 2 fields to continue".
- Field widths: short (price, qty, postal) 160–240, medium (name, city, select) 400, long (title, address, URL) up to 640. Inputs never exceed 480, except long text (720). Two columns only for natural pairs: City/Postal code, Key/Secret, Weight/Unit, Price/Quantity, and L/W/H (three across).
- Units and currency go in adornments (`₺`, `kg`, `.myshopify.com`), never in the label.
- Country, currency and phone are always pickers (`CountrySelect` with flag and ISO, `CurrencySelect`, `PhoneInput`). Free text "TR" is never accepted. Prefill from data we have: the order's phone, and the seller's base currency (TRY for TR sellers).
- `TextArea` auto-grows from 4 rows to 24 with no inner scroll below the maximum. Descriptions get an "Edit | Preview" toggle that renders the way the marketplace does.
- `CharCount` sits right-aligned in the label row ("112 / 140"). It turns warning at 90% and danger above 100%.
- `TagInput` accepts comma-separated values on paste and Enter. Each chip shows its own counter (20 for Etsy), duplicates are rejected inline, and title-overlap words are flagged.
- Settings forms (Sender profile) use `SettingsRow`: label-left at 240px and field-right on desktop, stacked on mobile. Its layout comes from `settings_spec.md`.

### 3.8 Buttons (`ds/inputs/Button`, `IconButton`, `SplitButton`)

| Variant | MUI mapping | Look | When |
|---|---|---|---|
| `primary` | `contained` | solid `accent-600`, white text | the one main action of the view |
| `secondary` | `outlined` | white, 1px `neutral-300`, `neutral-800` text | other visible actions |
| `ghost` | `text` | transparent, `neutral-700`, hover `neutral-50` | Cancel in panels, toolbar actions, inline actions |
| `danger` | `contained color="error"` | solid `danger-solid` | only inside confirmation modals |
| `danger-ghost` | `text color="error"` | `danger-fg` | destructive items in `⋯` |

- Sizes: `sm` 32, `md` 40, `lg` 44, `xl` 48 (sheet footers).
- Never uppercase, never a gradient, no colored shadows, no hover transform. The theme maps legacy `color="success"` and `color="secondary"` contained buttons onto the accent in M0, so legacy green and purple buttons disappear at once.
- A 16px leading icon is optional. A trailing icon is only `▾` for menus.
- `loading` keeps the width, swaps the label for a spinner plus a verb ("Creating label…") and disables only that button.
- `IconButton` requires a `label` (aria-label plus tooltip with the shortcut).
- `SplitButton` covers a primary with variants. It is used for "Print ▾" (label / packing slip / both). Carrier choice is a rate list (§3.16), not a split button.

### 3.9 StatusPill (`ds/data/StatusPill`): fixed vocabulary
The pill is 20px tall, `micro` 11/14 at 500, with a 6px dot, a soft background and radius full. **Props are `domain` + `status` only, with no free-form label.** The label comes from i18n `status.<domain>.<key>`, and the raw marketplace value appears in the tooltip ("Etsy: paid, unshipped"). Mapping functions live in `lib/ds/status/{orders,listings,sync,connections,messages}.ts`, as pure functions with unit tests.

| Domain | Key | EN / TR | Tone |
|---|---|---|---|
| order | `to_ship` | To ship / Gönderilecek | info |
| | `overdue` | Overdue / Gecikti | danger |
| | `label_created` | Label created / Etiket hazır | neutral, accent dot |
| | `shipped` | Shipped / Kargoda | success |
| | `delivered` | Delivered / Teslim edildi | success, hollow dot |
| | `on_hold` | On hold / Beklemede | warning |
| | `problem` | Problem / Sorun | danger |
| | `cancelled` | Cancelled / İptal | neutral |
| | `refunded` | Refunded / İade edildi | neutral |
| label | `label_failed` | Label failed / Etiket hatası | danger |
| listing | `active` | Active / Yayında | success |
| | `draft` | Draft / Taslak | neutral |
| | `inactive` | Inactive / Pasif | neutral, hollow dot |
| | `sold_out` | Sold out / Tükendi | warning |
| | `expired` | Expired / Süresi doldu | warning |
| sync | `pending` | Not sent yet / Henüz gönderilmedi | **attention** |
| | `syncing` | Sending… / Gönderiliyor… | info, pulsing dot |
| | `sync_failed` | Send failed / Gönderilemedi | danger |
| | `conflict` | Changed on Etsy / Etsy'de değişti | warning |
| | `synced` | Sent / Gönderildi | success (shown for 24h, then hidden) |
| connection | `connected` | Connected / Bağlı | success |
| | `needs_reconnect` | Reconnect needed / Yeniden bağlan | warning |
| | `incomplete` | Setup incomplete / Kurulum eksik | warning, outline |
| | `not_connected` | Not connected / Bağlı değil | neutral |
| | `check_failed` | Couldn't check / Kontrol edilemedi | neutral |
| message | `unread` | Unread / Okunmadı | info |
| | `needs_reply` | Needs reply / Yanıt bekliyor | warning |

Rules:
- **At most one order pill and one sync pill per row.** "Awaiting Fulfillment" plus "Received" collapse into `to_ship`.
- Whether a label exists is shown as copyable mono tracking text, never as a second status.
- Pills are never buttons. A clickable status is a `FilterButton`.

### 3.10 ScoreMeter: one listing-health representation (`ds/data/ScoreMeter`, `ScorePanel`)

```
Table cell:   ▰▰▰▰▱ 78                      (5 segments, 40×6, number 13/600 tabular)
Panel/rail:   Listing health   78 / 100   Good          Scored on 9 of 12 checks
              ▰▰▰▰▰▰▰▰▱▱
              ✕ Only 6 photos: add 4 more            +8   [Add photos]
              ✕ 3 photos without alt text            +4   [Write alt text]
              ! Title 96/140 characters              +3   [Suggest titles]
              ✓ 13 / 13 tags
              n/a Tag demand (no research data)            [Get tag ideas]
```

- The score is always an integer from 0 to 100 and is computed by `lib/listingScore/{etsy,ebay,trendyol,wix,shopify,amazon}.ts`, which returns `{ score, band, checksUsed, checksTotal, checks: Check[] }`. `Check = { id, label, status: 'pass'|'warn'|'fail'|'na', impact: number, fix?: { label, field?, action? } }`.
- Bands: 0–49 "Needs work / Geliştirilmeli" (danger), 50–74 "Fair / Orta" (warning), 75–89 "Good / İyi" (success), 90–100 "Great / Mükemmel" (success, full bar).
- `na` checks are excluded from the denominator, and the panel always states "Scored on X of Y checks".
- Checks are sorted by impact. Every failing check has a one-click fix that either scrolls to and focuses the field ("Add photos") or runs an action that **stages** a change ("Generate 4 tags", "Write alt text"). Nothing is pushed to the marketplace.
- Trendyol letter grades are converted and never shown: A+ 97, A 93, B+ 87, B 83, C+ 77, C 73, D 60, F 40.
- Rings, letter boxes, outline boxes and filled squares are removed everywhere. Every listings table can sort by score, and "Needs work" is a saved view.

### 3.11 Thumbnails and logos
- `Thumb`: sizes 32, 48 (table), 64 (mobile card), 96 (panel header) and 120 (editor grid). It has a 1px `neutral-200` border, radius 6, `object-fit: cover` and a `neutral-50` background. A missing image shows a neutral package glyph, never "-". Desktop hover opens a 240px preview popover after 400ms.
- `ImageGrid` (editor): drag reorder, a "Primary" badge on the first image, an alt-text state icon, drop-to-upload, and staged add/delete/reorder badges (wrapping the existing `ImageManager` staging logic).
- `LogoTile`: sizes 16, 20, 24, 32, 40, as an SVG on a white tile with a 1px border and a radius scaled to its size. The monogram fallback puts white initials on the brand color. It always carries an `aria-label`.

### 3.12 Money, numbers and dates (`lib/format.ts`, `Money`, `Num`, `DateText`, `ShipBy`)
`lib/format.ts` wraps `lib/i18n/formatting.ts` (`getIntlLocale`), and `useFormatters()` binds the locale and the shop timezone. **The locale follows the UI and the currency follows the data.**

| Kind | Rule | tr-TR | en-US |
|---|---|---|---|
| Money | `currencyDisplay: 'narrowSymbol'`, 2 decimals (0 for JPY/KRW). **Symbol, never the ISO code** | ₺1.109,30 · $169,99 | ₺1,109.30 · $169.99 |
| Large money | standard grouping | ₺1.070.860,03 | ₺1,070,860.03 |
| Compact | KPI tiles and chart axes only, ≥ 100,000, full value in the tooltip | ₺1,07 Mn | ₺1.07M |
| Mixed currencies | Never summed. Either per-currency totals ("$4,210 · ₺86.400") or converted with `≈` and a tooltip ("Converted at TCMB rate, 15 Oct") | ≈ ₺1.070.860 | ≈ ₺1,070,860 |
| Numbers | `Intl.NumberFormat(locale)` | 12.480 | 12,480 |
| Percent | `style: 'percent'`, at most 1 decimal | %4,2 | 4.2% |
| Delta (KPI only) | arrow plus a signed percent, success or danger text | ▲ %12,4 | ▲ 12.4% |
| Date, same year | `day numeric, month short` | 15 Eki | Oct 15 |
| Date, other year | adds the year | 15 Eki 2025 | Oct 15, 2025 |
| Date-time | locale hour cycle | 15 Eki 22:59 | Oct 15, 10:59 PM |
| Relative | under 7 days, `Intl.RelativeTimeFormat`, absolute value in the tooltip | 4 dk önce | 4 min ago |
| Ship-by (`ShipBy`) | **one phrase**: danger when overdue, warning when due within 24h. Never relative and absolute together | Bugün 22:59'a kadar · 1 gün gecikti | Ship by today 10:59 PM · Overdue 1 day |
| IDs, tracking | mono, `CopyText` on hover | 1Z999AA10123456784 | |

Times use the seller's timezone (an account setting, default `Europe/Istanbul`), never the server's.

### 3.13 Empty, error and loading
- **Skeletons** match the final layout (table rows with a thumb block, KPI tiles, panel sections) and appear after a 200ms delay, so fast loads never flash. Spinners appear only inside buttons.
- **No stuck states:** at 15s the skeleton is replaced by "Still loading… [Retry]", and at 30s by an `ErrorState`. This is implemented once in `useAsyncState(swr)`.
- **EmptyState kinds:**
  - `first-use`: "Connect Etsy to see your listings" plus [Connect Etsy], with a LogoTile. `ConnectState` replaces the whole page body, never a half-empty table.
  - `no-results`: "No orders match these filters" plus [Clear filters].
  - `done`: "Every order has a label", no action, a quiet check icon.
  
  Layout: a 40px `neutral-100` icon tile, a 14/600 title, a body of at most 2 lines, and one action.
- **ErrorState:**
  - Variants: `page`; `inline` (inside a card or panel); `stale` ("Showing data from 10:42 · Retry", where the last good data stays visible).
  - Content: a plain cause ("Etsy didn't respond", "Couldn't check Etsy"), [Try again], and "Copy error ID". Raw JSON never reaches the UI.
- **Banner:** tone info/warning/danger/success/attention. It has a 1px border, a soft background, one line, at most one action, and a persisted dismissal when it is not blocking. It sits inline at the top of the region it affects. **Banners are never used for marketing.**

### 3.14 Toasts (`useToast`, wrapping react-hot-toast)
- Bottom-center on desktop; on mobile at `bottom: calc(var(--kx-bottom-nav) + 8px)`. **One visible at a time**, the rest queued, z 1700.
- Neutral-900 background, white 13px text, and a tone icon only.
- Success and info last 4s. Toasts with Undo last 6s ("12 listings moved to draft · Undo"). Errors persist until dismissed and carry "Retry" or "Details".
- Toast text is at most 80 characters, from i18n. **Never raw API errors, JSON or AI output.**
- No toast when the result is already visible (a pill changed). No toast for form validation.

### 3.15 Icons (`lib/ds/icons.ts`)
- **lucide-react only**, stroke 1.75: 16px in controls and tables, 18 in nav, 20 in empty-state tiles.
- **Semantic registry: one icon, one meaning:**

| Meaning | Icon |
|---|---|
| push | `Send` |
| pull | `RefreshCw` |
| label | `Tag` |
| print | `Printer` |
| order | `Receipt` |
| listing | `LayoutGrid` |
| research | `Telescope` |
| message | `MessageSquare` |
| reports | `BarChart3` |
| finance | `Wallet` |
| settings | `Settings` |
| AI | `Sparkles` |
| edit | `Pencil` |
| more | `MoreHorizontal` |
| delete | `Trash2`, menus only |

  Pages import from the registry, not from lucide directly.
- Brands are never icons. They are always `LogoTile`. `@mui/icons-material` is a lint error in migrated files and is removed in M10.

### 3.16 Shipping: one label flow (`CreateLabelPanel`)
- **One structure for all carriers** (SidePanel lg 720). Sections, in order: From (sender summary with Change), Ship to (prefilled from the order including the phone, `CountrySelect`), Package (presets plus weight and dimensions), **Carrier & service rate list**, Customs (international only: HS code with `TermHint`, ETGB toggle), Options (carrier-specific extras appear here as rows, never as a different drawer layout).
- **Rate list:** FedEx and UPS services in one radio list showing the logo, service, transit days and price, with "Recommended" marking the cheapest service that arrives on time. DHL eCommerce appears in the same list with its unavailable reason ("Turkey domestic only") when it does not apply. If live rates fail, the list falls back to `RadioCards` with one card per carrier (no price) and an inline `ErrorState` "Couldn't get rates · Retry".
- The footer shows "Total $38.40" and the primary "Create label". Every carrier uses the same title, primary and naming ("DHL eCommerce", never "MNG Kargo").
- **Success state** replaces the body: a label PDF preview, the tracking number (`CopyText`), the primary [Print label], and a result line "Tracking sent to Etsy ✓" (or "Couldn't send tracking to Etsy · Retry" / "Send with the Chrome extension").

### 3.17 Bulk editing (`ds/data/BulkGrid`): the Vela answer
- A full page at `/app/{marketplace-listings}/bulk?ids=…` or `?view=…`, with "← Back to listings" and the filters preserved.
- Built on DataGrid Community with cell editing. Frozen columns: thumb and title. Columns: Title (with counter), Price, Qty, SKU, Tags, Section, Category, Materials, Status, Score, plus a "Columns" picker.
- **v1 features:**
  - `⌘V` pastes TSV from Google Sheets or Excel, starting at the focused cell and going down, and right when the clipboard is rectangular. Values are validated per cell.
  - `⌘D` fills down the focused value over the selected rows of that column.
  - Find & replace runs on the current column or on all text columns, with a preview count.
  - Bulk-bar actions on selected rows: Change price (set / ± % / ± amount), Add or remove tags, **Improve with AI** (stages AI titles, tags and alt text for review as dirty cells, never pushed), **Copy to eBay** (cross-list prefill).
  - Dirty cells get the attention tint, invalid cells a danger outline plus a tooltip, and "Revert cell" sits in the cell context menu.
  - The header reads "24 listings · 37 changes not sent". The primary is **"Send 37 changes to Etsy"**, and [Discard] is secondary.
- **Deferred:** free range selection (Shift+click rectangles) and the undo stack.
- Mobile: BulkGrid is not offered below 900px. The listings bulk bar on mobile offers the same actions as sheets (Change price, Add tags, Improve with AI).

### 3.18 Research hub (parallel track): four tools that each answer one question and end in an action
Research is rebuilt as a product, not reskinned. The data inventory, sanity guards (median and p25–p75, Tukey trim, plausibility bounds, minimum n, FX normalization), budget and delete list in `RESEARCH_REDESIGN.md` §0, §4.4, §5 and §6 are part of this contract.

| Tool (route) | Seller question | Rows / content | Row and card actions (all write into KolayXport) |
|---|---|---|---|
| **Home** `/app/research` | — | One smart search ("idea, keyword, Etsy listing link, shop URL or Trendyol link"). **Question chips:** "Is this niche worth it?" → Product finder · "What price should I charge?" → Product finder, Price card · "Which tags?" → Keyword explorer · "Why is my listing not selling?" → Listing doctor. With no query: "Your listings that need work" (score < 50, from the user's own catalog), recent searches, watched items. Pasting an Etsy listing link starts Listing doctor | — |
| **Product finder** `/app/research/products` (RESEARCH_REDESIGN Job 1; Job 6 "Price gap TR → global" joins in R4 as source mode "From Trendyol") | "What should I make or sell next, and at what price?" | `EvidenceSummary` + cards: Price (median, p25–p75, n), Competition (listing count, strong shops), Demand Signal (5 dots), Newcomer share; then a Top listings table (real thumbnails, price, reviews, age, shop) | **Use $49 in listing** (prefill or stage) · **Draft a listing** (`writeListingPrefill`) · Watch · Compare (up to 3) |
| **Keyword explorer** `/app/research/keywords` (Job 2; Job 5 Rankings is its "Tracked" saved view) | "Which tags and title words win for this listing?" | Keyword rows: Demand Signal, Competition (Measured), "Used by 18 of top 48" (Measured), price band of the top 48, "In my shop" (count), Etsy Insights volume (You entered); views: Suggested · Long-tail · Seasonal · Used in my shop · Tracked (daily rank, with send markers) | **Add 5 tags to…** (listing picker → stages `fieldPatch.tags`) · Add to title · Track |
| **Listing doctor** `/app/research/listings` (Job 3) | "Why isn't my listing selling, and what do I fix first?" | The user's own listings sorted by **opportunity** (views without sales, score gaps, rank drops), each with its ScorePanel checks and peer comparison | **Stage fixes** (one or bulk) → drafts → "Send N changes to Etsy" · Open in BulkGrid |
| **Shop tracker** `/app/research/shops` (Job 4) | "What are my competitors doing?" | Tracked shops: sales/day (Measured from `transaction_sold_count` deltas), new listings 7d, price changes, top movers; alerts into notifications | Open shop · **Compare with my listing** · Add their keyword to Keyword explorer |

Rules for every research surface:
- One search and one marketplace `FilterButton` (Etsy · eBay · Amazon · Trendyol). The marketplace is a filter, not a page. A marketplace that is not connected or not eligible shows `ConnectState`, not an error.
- **No hero, no gradient, no FAB, no "Trending niches" block and no "avg price".** AI help lives in ⌘K.
- **`SourceNote` is mandatory** on every card and table: "Etsy search · 48 listings sampled · updated 2h ago · Measured". Each metric uses `Metric kind="measured|estimate|signal|user"`.
- **Sanity guard:** a value that fails a check renders `—` with the reason ("small sample: 7 listings", "13 excluded: no FX rate"). n < 20 shows the range only, and n < 5 shows "Not enough data".
- **EvidenceSummary** replaces any AI "verdict". It shows 2–4 computed facts plus a confidence label derived from n and from the input count ("Confidence: medium · 48 listings, no Etsy sales data"). AI may rephrase these facts only after the numbers check (`RESEARCH_REDESIGN` §6.5) passes.
- Every result ends in one primary action. Secondaries go in `⋯`. Writes always go through staged drafts or `writeListingPrefill`, and never directly to a marketplace.
- Keywords, titles and tags are always in English. Commentary and tips follow the UI locale, with no hard-coded Turkish strings in API responses.

### 3.19 Plain-language glossary (EN / TR): binding wording

| Concept | EN | TR | Never |
|---|---|---|---|
| push staged drafts | Send changes to Etsy · Send 7 changes to Etsy | Değişiklikleri Etsy'ye gönder · 7 değişikliği Etsy'ye gönder | Sync, Push, Sync all (7), Save Profile |
| pull from marketplace | Refresh from Etsy · Refreshed 12 min ago | Etsy'den yenile · 12 dk önce yenilendi | Sync Data, Sync from eBay |
| autosaved local draft | Saved · 3 changes not sent yet | Kaydedildi · 3 değişiklik henüz gönderilmedi | Save Draft (disabled grey) |
| draft conflict | Changed on Etsy since your draft · Review differences | Taslağınızdan sonra Etsy'de değişti · Farkları incele | Conflict error |
| expired auth | Reconnect Etsy | Etsy'yi yeniden bağla | Re-auth, Token expired |
| failed health check | Couldn't check Etsy | Etsy kontrol edilemedi | Not connected (when unknown) |
| shipping label | Create label · Print label | Etiket oluştur · Etiketi yazdır | CREATE LABEL, Save (in UPS) |
| tracking push | Tracking sent to Etsy | Takip numarası Etsy'ye gönderildi | Push tracking |
| listing quality | Listing health | İlan sağlığı | SEO score, grade |
| research | Research | Pazar araştırması | Intelligence, Hub, AI ile Optimize Et |
| AI action | Improve with AI · Suggest titles · Get tag ideas | AI ile iyileştir · Başlık öner · Etiket fikri al | AI ile Olustur |
| DHL eCommerce | DHL eCommerce | DHL eCommerce | MNG Kargo |

---

## 4. Component inventory (`components/ds/*`)

Shared types:

```ts
type Tone = 'success'|'warning'|'danger'|'info'|'attention'|'neutral';
type MarketplaceKey = 'etsy'|'ebay'|'amazon'|'shopify'|'wix'|'trendyol'|'hepsiburada'|'n11';
type CarrierKey = 'fedex'|'ups'|'dhl'|'shippo';
type BrandKey = MarketplaceKey|CarrierKey|'veeqo'|'parasut'|'google'|'chrome';
type ActionSpec = {
  id: string; label: string; icon?: LucideIcon; onClick?: () => void; href?: string;
  shortcut?: string; loading?: boolean; loadingLabel?: string;
  disabled?: boolean; disabledReason?: string; tone?: 'default'|'danger';
  paletteGroup?: 'actions'|'goto';
};
```

Every component:
- forwards `className` and `data-testid`;
- accepts `sx` only on layout primitives;
- contains **no hard-coded user-facing strings** (its accessible defaults come from the `ds.*` i18n namespace);
- has a Vitest render test.

### 4.1 Foundations (`lib/`)

| File | Exports |
|---|---|
| `lib/ds/tokens.ts` | `neutral, accent, tone, brand, chart, type, space, control, radius, elevation, zIndex, motion, layout, panelWidth` (see tokens.md) |
| `lib/theme.tsx` | MUI theme built from tokens (see tokens.md) |
| `styles/tokens.css` | Tailwind `@theme` + `:root` vars |
| `lib/format.ts` | `fmtMoney(amount, currency, {locale, compact?, approx?, sign?})`, `fmtNum`, `fmtPercent`, `fmtDate(v, mode)`, `fmtRelative`, `fmtShipBy`, `useFormatters()` |
| `lib/ds/status/*.ts` | `orderStatus(raw, marketplace)`, `listingStatus`, `syncStatus(draft)`, `connectionStatus`, `messageStatus` → `StatusKey` |
| `lib/ds/icons.ts` | semantic icon registry |
| `lib/ds/marketplaces.ts` | `BrandKey → { name, logo, color, initials }` |
| `lib/listingScore/*.ts` | `scoreListing(listing, marketplace): ScoreResult` |
| `lib/text/decodeEntities.ts` | used in every mapper at ingest |
| `lib/research/stats.ts` | `robustStats`, `normalizePrices`, `isPlausible` (RESEARCH_REDESIGN R0) |
| `lib/ds/useUrlState.ts` | `useUrlState(schema)` for filters, sort, page, view and open record |
| `lib/ds/useShortcuts.ts` | `useShortcuts(map, { scope })` (key-based, input-aware) |

### 4.2 Shell and page

| Component | File | Props |
|---|---|---|
| `AppShell` | `ds/shell/AppShell.tsx` (replaces `AppLayout.js` chrome) | `{ children; nav: NavGroup[]; topBar?: TopBarProps }` |
| `SideNav` | `ds/shell/SideNav.tsx` | `{ groups: NavGroup[]; activeHref; collapsed; onCollapsedChange; footer?: ReactNode }`. `NavGroup = { id; label?; items: NavItem[]; bottom?: boolean }`. `NavItem = { href; label; icon?: LucideIcon; brand?: BrandKey; count?: number; countTone?: 'neutral'|'danger'; dot?: 'warning'|'danger'; shortcut?; requires?: MarketplaceKey[] }` |
| `TopBar` | `ds/shell/TopBar.tsx` | `{ breadcrumbs?: { label; href? }[]; mobileTitle?: string; onBack?(); mobileAction?: ActionSpec }` |
| `MobileTabBar` | `ds/shell/MobileTabBar.tsx` (refactor of the existing one; keeps `--kx-bottom-nav`) | `{ items: NavItem[] /* ≤5 */; more: NavGroup[] }` |
| `CommandPalette` | `ds/shell/CommandPalette.tsx` (refactor of the existing one) | `{ open; onClose }` + `usePageActions(actions: ActionSpec[])` + `useCommand(cmd)`. `Command = { id; label; group: 'actions'|'goto'|'search'|'recent'; icon?; brand?; shortcut?; keywords?: string[]; run() }` |
| `UsageMeter` | `ds/data/UsageMeter.tsx` | `{ label; used: number; limit: number|null /* null = unlimited */ }`; amber ≥ 80%, red ≥ 100% |
| `Page` | `ds/page/Page.tsx` | `{ title: string /* <title> */; width: 'list'|'detail'|'form'|'reading'; children }` |
| `PageHeader` | `ds/page/PageHeader.tsx` | `{ title; count?: number; subtitle?; meta?: ReactNode; primaryAction?: ActionSpec; secondaryActions?: ActionSpec[] /* ≤2 */; overflowActions?: ActionSpec[]; backHref? }` (auto `usePageActions`) |
| `SyncMeta` | `ds/page/SyncMeta.tsx` | `{ source: MarketplaceKey|'all'; lastPulledAt?: Date; state: 'idle'|'pulling'|'failed'; progress?: { done; total }; onPull?() }` → "Refreshed from Etsy 12 min ago ⟳" |
| `Section` | `ds/page/Section.tsx` | `{ title?; description?; action?: ActionSpec; variant?: 'plain'|'card'; children }` |
| `StickyActionBar` | `ds/page/StickyActionBar.tsx` | `{ status?: ReactNode; primary: ActionSpec; secondary?: ActionSpec; overflow?: ActionSpec[]; visible?: boolean }` (mobile: fixed above `--kx-bottom-nav`, 50/50 at 48px when a secondary is present; desktop: renders as a sticky page footer bar) |
| `SettingsLayout`, `SettingsMobileIndex`, `SettingsRow` | `ds/page/Settings*.tsx` | signatures exactly as `settings_spec.md` §7; `components/settings/ui/*` re-export these |

### 4.3 Toolbar and filters

| Component | File | Props |
|---|---|---|
| `Toolbar` | `ds/toolbar/Toolbar.tsx` | `{ search?: SearchFieldProps; filters?: FilterDef[] /* first 3 pinned visible */; values; onChange(values); views?: SavedViewsProps; density?: { value; onChange }; resultCount?: number; selection?: { count; primary?: ActionSpec; actions: ActionSpec[]; overflow?: ActionSpec[]; onClear() } }` |
| `SearchField` | `ds/toolbar/SearchField.tsx` | `{ value; onChange; placeholder; shortcut?: '/'; debounceMs?: 250; size?: 'sm'|'md' }` |
| `FilterButton` | `ds/toolbar/FilterButton.tsx` | `{ label; value?: string|string[]; options: Option[]; multiple?; searchable?; onChange }` |
| `FiltersSheet` | `ds/toolbar/FiltersSheet.tsx` | `{ open; onClose; filters: FilterDef[]; values; onChange; resultCount? }` |
| `SavedViews` | `ds/toolbar/SavedViews.tsx` | `{ views: { id; label; query; builtIn?; count? }[]; activeId; onSelect; onSave?(label); onDelete?(id) }` (dropdown on desktop, scrollable chips on mobile) |
| `ActiveFilterChips` | `ds/toolbar/ActiveFilterChips.tsx` | `{ chips: { key; label; onRemove() }[]; onClearAll() }` |
| `BulkActionBar` | `ds/toolbar/BulkActionBar.tsx` | `{ count; primary?: ActionSpec; actions?: ActionSpec[]; overflow?: ActionSpec[]; onClear() }` |
| `DateRangeField` | `ds/inputs/DateRangeField.tsx` | `{ value: { from: Date|null; to: Date|null; preset?: PresetKey }; onChange; presets?: PresetKey[]; min?; max?; size?: 'sm'|'md' }` (x-date-pickers v6 `DateCalendar` ×2 in a `Popover`, z 1600; sheet on mobile) |

`FilterDef = { key; label; type: 'select'|'multiselect'|'daterange'|'boolean'|'range'; options?; pinned?: boolean }`

### 4.4 Data display

| Component | File | Props |
|---|---|---|
| `DataTable<T>` | `ds/data/DataTable.tsx` | `{ rows: T[]; columns: Column<T>[]; getRowId(r): string; state: 'loading'|'ready'|'empty'|'error'; empty?: ReactNode; error?: ReactNode; selection?: { ids: string[]; onChange(ids) }; onRowOpen?(r); inlineAction?(r): ActionSpec; rowActions?(r): ActionSpec[]; density?: 'compact'|'standard'; sort?: { key; dir }; onSortChange?; pagination: { mode: 'pages'; page; pageSize: 50|100|250; total; onChange } | { mode: 'cursor'; hasMore; onLoadMore }; onCellCommit?(rowId, key, value): void; dirtyCells?: Set<string>; columnStateKey: string }` |
| `Column<T>` | (type) | `{ key; header: string; width?; align?: 'left'|'right'; sortable?; hideable?; type?: 'text'|'money'|'number'|'date'|'status'|'score'|'thumb'|'brand'|'money-edit'|'int-edit'; render?(r): ReactNode; validate?(v): string|null; mobile: 'media'|'title'|'subtitle'|'meta'|'status'|'trailing'|'action'|'hidden' }` |
| `BulkGrid<T>` | `ds/data/BulkGrid.tsx` | `{ rows: T[]; columns: GridColumn<T>[]; onCellsChange(patches: { rowId; field; value }[]); validate?(row, field, value): string|null; dirty: Set<string>; onRevert(rowId, field); frozenColumns?: number }` (DataGrid Community; TSV paste, ⌘D, find & replace) |
| `StatusPill` | `ds/data/StatusPill.tsx` | `{ domain: 'order'|'label'|'listing'|'sync'|'connection'|'message'; status: StatusKey; raw?: string; size?: 'sm'|'md' }` |
| `ScoreMeter` | `ds/data/ScoreMeter.tsx` | `{ score: number|null; variant: 'cell'|'panel'; checksUsed?: number; checksTotal?: number; onClick? }` |
| `ScorePanel` | `ds/data/ScorePanel.tsx` | `{ result: ScoreResult; onFix(check: Check) }` |
| `Thumb` | `ds/data/Thumb.tsx` | `{ src?; alt; size: 32|48|64|96|120; preview?: boolean; badge?: ReactNode }` |
| `LogoTile` | `ds/data/LogoTile.tsx` | `{ brand: BrandKey; size?: 16|20|24|32|40; withName?: boolean }` |
| `Avatar` | `ds/data/Avatar.tsx` | `{ name; src?; size?: 24|32|40; brand?: BrandKey /* corner badge */ }` (neutral tint fallback) |
| `KpiTile` | `ds/data/KpiTile.tsx` (replaces `ui/StatCard`) | `{ label; value: ReactNode; delta?: { value: number; period: string; goodWhen: 'up'|'down' }; source: string; asOf: Date; href?; loading? }` (neutral; ≤ 4 per row) |
| `Chart` | `ds/data/Chart.tsx` (ApexCharts wrapper) | `{ type: 'line'|'bar'|'donut'; series; categories?; format: 'money'|'number'|'percent'; currency?; height? }` (**single y-axis only**, chart palette) |
| `Timeline` | `ds/data/Timeline.tsx` | `{ events: { at: Date; label; tone?: Tone; detail? }[] }` |
| `KeyValueList` | `ds/data/KeyValueList.tsx` | `{ items: { label; value: ReactNode; copy?: string }[]; columns?: 1|2 }` |
| `Money`, `Num`, `DateText`, `ShipBy` | `ds/format/*.tsx` | `Money { amount; currency; compact?; approx?; fxNote?; sign? }`, `Num { value; percent?; compact?; decimals? }`, `DateText { value; mode?: 'relative'|'date'|'datetime'|'time' }`, `ShipBy { date; shippedAt? }` |
| `CopyText` | `ds/format/CopyText.tsx` (absorbs `ui/CopyButton`) | `{ value; display?; mono?: boolean; truncate?: number }` |
| `Kbd` | `ds/format/Kbd.tsx` | `{ keys: string }` (⌘ or Ctrl by platform) |
| `TermHint` | `ds/format/TermHint.tsx` | `{ term: 'etgb'|'ioss'|'hs'|'sku'|'gtin'|… }` (glossary `(?)` tooltip from i18n) |
| `SourceNote` | `ds/research/SourceNote.tsx` | `{ source: string; fetchedAt: Date; sample?: number; excluded?: { count; reason }; kind: 'measured'|'estimate'|'signal'|'user' }` |
| `Metric` | `ds/research/Metric.tsx` | `{ value: ReactNode|null; kind: 'measured'|'estimate'|'signal'|'user'; guard?: { ok: boolean; reason?: string }; tooltip? }` (renders `—` + reason when `guard.ok` is false) |
| `SignalDots` | `ds/research/SignalDots.tsx` | `{ tier: 1|2|3|4|5|null; inputs: { label; value }[] }` |
| `PriceBand` | `ds/research/PriceBand.tsx` | `{ p25; median; p75; currency; n }` |
| `EvidenceSummary` | `ds/research/EvidenceSummary.tsx` | `{ facts: string[] /* 2–4 */; confidence: 'high'|'medium'|'low'; basis: string }` |

### 4.5 Overlays and feedback

| Component | File | Props |
|---|---|---|
| `SidePanel` | `ds/overlay/SidePanel.tsx` | `{ open; onClose; size?: 'sm'|'md'|'lg'|'xl'; title; leading?: ReactNode; status?: { domain; status }; meta?: ReactNode; onPrev?; onNext?; primary?: ActionSpec; secondary?: ActionSpec; overflow?: ActionSpec[]; saveState?: 'idle'|'dirty'|'saving'|'saved'|'error'; saveNote?: ReactNode; dirty?: boolean; sectionNav?: { id; label }[]; children }` |
| `SidePanelSection` | `ds/overlay/SidePanelSection.tsx` | `{ id; title; description?; action?: ActionSpec; children }` |
| `Modal` | `ds/overlay/Modal.tsx` | `{ open; onClose; title; size?: 'sm'|'md'; nested?: boolean; primary: ActionSpec; secondary?: ActionSpec; children }` |
| `ConfirmDialog` / `useConfirm` | `ds/overlay/ConfirmDialog.tsx` (absorbs `ui/ConfirmDialog`; `lib/hooks/useConfirm` keeps its API) | `useConfirm()({ title; body?; confirmLabel; tone?: 'default'|'danger'; typeToConfirm?: string }) => Promise<boolean>` |
| `BottomSheet` | `ds/overlay/BottomSheet.tsx` | `{ open; onClose; title; fullHeight?; footer?: ReactNode; children }` (drag handle, top radius 12) |
| `OverflowMenu` | `ds/overlay/OverflowMenu.tsx` | `{ items: (ActionSpec|'divider')[]; label?; size?: 'sm'|'md' }` (danger items forced last, separated) |
| `Tooltip` | `ds/overlay/Tooltip.tsx` | `{ title: string; shortcut?: string; children }` |
| `Banner` | `ds/feedback/Banner.tsx` | `{ tone: Tone; title: string; children?; action?: ActionSpec; dismissKey?: string }` |
| `useToast` | `ds/feedback/toast.ts` | `{ success(msg, { undo? }); error(msg, { action?, persist? }); info(msg) }` |
| `EmptyState` | `ds/state/EmptyState.tsx` | `{ kind: 'first-use'|'no-results'|'done'; icon?: LucideIcon; brand?: BrandKey; title; body?; action?: ActionSpec }` |
| `ConnectState` | `ds/state/ConnectState.tsx` (absorbs `ui/ConnectEmptyState`) | `{ brand: MarketplaceKey; title; body; connectHref }` |
| `ErrorState` | `ds/state/ErrorState.tsx` | `{ variant?: 'page'|'inline'|'stale'; title; cause?; errorId?; staleSince?: Date; onRetry?() }` |
| `Skeleton*` | `ds/state/Skeletons.tsx` | `TableSkeleton { rows?: 8; thumb? }`, `CardListSkeleton`, `PanelSkeleton`, `KpiSkeleton { count }` |
| `useAsyncState` | `ds/state/useAsyncState.ts` | `(swr) => 'loading'|'slow'|'ready'|'empty'|'error'` (15s → slow, 30s → error) |

### 4.6 Inputs and actions

| Component | File | Props |
|---|---|---|
| `Button` | `ds/inputs/Button.tsx` | `{ variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'; size?: 'sm'|'md'|'lg'|'xl'; icon?: LucideIcon; trailingIcon?; loading?; loadingLabel?; disabled?; disabledReason?; href?; onClick?; type?; fullWidth?; children: string }` |
| `IconButton` | `ds/inputs/IconButton.tsx` | `{ icon: LucideIcon; label: string /* required */; size?: 'sm'|'md'; variant?: 'ghost'|'secondary'; shortcut?; onClick? }` |
| `SplitButton` | `ds/inputs/SplitButton.tsx` | `{ primary: ActionSpec; options: ActionSpec[]; variant?: 'primary'|'secondary' }` |
| `FormField` | `ds/inputs/FormField.tsx` | `{ label; htmlFor; optional?; helper?; error?; counter?: { value; max }; hint?: TermKey; width?: 'short'|'medium'|'long'|'full'; children }` |
| `TextField` | `ds/inputs/TextField.tsx` | `{ value; onChange; placeholder?; prefix?; suffix?; size?: 'sm'|'md'; invalid?; type?; inputMode? }` (label-less; lives inside FormField) |
| `TextArea` | `ds/inputs/TextArea.tsx` | `{ value; onChange; minRows?: 4; maxRows?: 24; preview?: (v) => ReactNode }` |
| `NumberField`, `MoneyField` | `ds/inputs/*.tsx` | `{ value: number|null; onChange; min?; max?; step?; unit? }`, `+ currency` (locale-aware parse of `1.109,30`) |
| `Select<T>` | `ds/inputs/Select.tsx` | `{ value; onChange; options: { value: T; label; icon?; brand? }[]; placeholder?; size? }` |
| `Combobox<T>` | `ds/inputs/Combobox.tsx` | `{ value; onChange; loadOptions?(q); options?; multiple?; creatable?; renderOption? }` (taxonomy search) |
| `CountrySelect`, `CurrencySelect`, `PhoneInput` | `ds/inputs/*.tsx` | `{ value; onChange; defaultCountry?: 'TR' }` |
| `TagInput` | `ds/inputs/TagInput.tsx` | `{ value: string[]; onChange; max: number; maxLength: number; separators?: string[]; validate?(t): string|null; flagOverlapWith?: string }` |
| `Checkbox`, `Switch`, `RadioGroup`, `RadioCards` | `ds/inputs/*.tsx` | standard props; `RadioCards { value; onChange; options: { value; title; description?; trailing?; brand?; disabledReason? }[] }` |
| `RateList` | `ds/inputs/RateList.tsx` | `{ value; onChange; rates: { id; carrier: CarrierKey; service; transitDays?; amount?; currency?; recommended?; unavailableReason? }[]; state: 'loading'|'ready'|'error'; onRetry? }` |
| `SegmentedControl` | `ds/inputs/SegmentedControl.tsx` | `{ value; onChange; options: { value; label; icon? }[] /* 2–4 */; size? }` (never for filters or status views) |
| `Tabs` | `ds/inputs/Tabs.tsx` | `{ value; onChange; tabs: { value; label; count? }[] /* ≤5 */ }` |
| `ImageGrid` | `ds/inputs/ImageGrid.tsx` | `{ images: { id; src; alt?; staged?: 'add'|'delete'|'reorder' }[]; max; onReorder; onUpload; onDelete; onAltChange; onOpen }` |

### 4.7 Domain compositions (built only from DS parts; under `components/domain/*`)

| Component | Props | Replaces |
|---|---|---|
| `ListingsPage` | `{ marketplace: 'etsy'|'ebay'|'trendyol'|'wix'|'shopify'; shopId? }` | 5 listing page layouts |
| `ListingEditor` | `{ marketplace; listingId; draftId? }` (staged-draft semantics preserved) | `ListingEditorDrawer` 9-tab drawer |
| `MarketplacePreview` | `{ marketplace; listing; surface: 'search'|'listing'; device?: 'desktop'|'mobile' }` | none |
| `OrdersPage` + `orderColumns(t, fmt)` | — | `pages/app/labels.tsx` list UI |
| `OrderPanel` | `{ orderId; onPrev?; onNext? }` | expanded order card |
| `CreateLabelPanel` | `{ order; open; onClose; defaultCarrier?: CarrierKey }` | FedEx, UPS and MNG drawers |
| `ConversationList`, `ThreadPane` | `{ items: { id; name; brand; preview; at; unread; needsReply; orderRef? }[]; activeId; onSelect }` | messages list |
| `ResearchHome`, `ProductFinder`, `KeywordExplorer`, `ListingDoctor`, `ShopTracker` | per §3.18 | 27 research sub-tools |

**Shims:** `components/ui/{PageHeader,StatusBadge,EmptyState,ErrorState,StatCard,ConfirmDialog,ConnectEmptyState,CopyButton}` re-export DS equivalents with adapter props from M1 onward, and are deleted in M10. `components/settings/ui/*` re-export from `components/ds/*` from the start; Settings Group A builds those primitives **in** `ds/`.

**Lint guards** (`eslint` `no-restricted-imports` / `no-restricted-syntax`, `react/jsx-no-literals`; a warning everywhere from M0, an error per directory after migration):
- no `@mui/icons-material`;
- no `@mui/material` in migrated `pages/**` (only `components/ds/**` may import it);
- no `<input type="date">`;
- no `uppercase` (class or `textTransform`);
- no `linear-gradient`;
- no hex literals outside `lib/ds/**`;
- no `.toFixed(` in TSX;
- no `Typography variant="h1..h6"`;
- no literal JSX strings;
- no Tailwind responsive prefixes in migrated files.

---

## 5. Visual findings → resolution (all 35 from `visual_findings.md`)

| # | Finding | Resolved by |
|---|---|---|
| 1 | No shared page header; TopBar repeats the title; "Settings" twice; "- KolayXport" suffix | `PageHeader` is the only title, TopBar shows breadcrumbs only, `<title>` is "Page · KolayXport" (§3.1–3.2). The M2 header pass removes every ad-hoc header |
| 2 | 4+ button styles; no single primary | 5 variants, flat, no uppercase, no green. P1 gives one primary per view. M0 theme flattens `contained` and maps legacy `success`/`secondary` buttons onto the accent (§3.8) |
| 3 | 3+ score representations | `ScoreMeter` / `ScorePanel`: 0–100, 4 bands, honest denominator, Trendyol letters converted (§3.10) |
| 4 | Inconsistent money formats | `Money` / `fmtMoney`: narrowSymbol, locale grouping, 2 decimals, compact only in KPI tiles, lint on `.toFixed` (§3.12) |
| 5 | Native date inputs next to floating-label fields; mixed heights | `DateRangeField`, lint on `type="date"`, labels above in DS forms, 32/40/44 height scale with one height per row (§2.4, §3.3) |
| 6 | Mixed languages, ASCII-Turkish | P5: `jsx-no-literals`, glossary (§3.19), AI language rule, research tips from i18n instead of the API |
| 7 | "FAİLED" / "RECEİVED" | `uppercase` removed from 20 files in M0, theme `textTransform: 'none'`, `<html lang>` follows the locale, lint ban |
| 8 | Collapsed sidebar with identical icons | Real logos through `LogoTile`, a nav uniqueness test, rail tooltips, Research collapsed into one entry (§3.1) |
| 9 | Full-width pages, 1400px inputs | `<Page width>` caps at 1600/1280/880/720; fields at 480 (§3.2, §3.7) |
| 10 | Rainbow colors, gradient heroes | P2: neutral `KpiTile` with only the delta colored, fixed chart palette, gradients deleted, brand colors only in LogoTile (§2.1) |
| 11 | Raw HTML entities from Etsy, risk of pushing them back | `decodeEntities` at ingest, no re-encode on push, fixture tests for `&#39;`, `&amp;` and `&quot;` (P5) |
| 12 | Overview: "All Features Free" banner, 6 nav tiles with no data | Overview becomes an action queue (§6.5). Marketing banners are banned, and any offer lives in the plan meter |
| 13 | Orders toolbar: 13 controls in 2 rows | One-row `Toolbar` of 32px controls: search, Store, Status, Date, Filters, SavedViews, density. Pull moves to `meta`, and "Add manual order" and ETGB move to `⋯` (§3.3) |
| 14 | Ship-by chip shows the date twice | `ShipBy`: one phrase, toned only when due today or overdue (§3.12) |
| 15 | "Awaiting Fulfillment" + "Received" | One order pill from the fixed vocabulary, raw status in the tooltip (§3.9) |
| 16 | Tiny icon buttons; "+ Cost" chip | `IconButton` 32/40 with a required label. Product cost becomes an OrderPanel field and a Profit column |
| 17 | "Already has a tracking number" as a green button | `label_created` pill plus `CopyText` tracking. Pills are never buttons |
| 18 | Carrier buttons with no logos; Delete next to primary actions | `CreateLabelPanel` with `RateList` and logos. Delete goes in `⋯` as `danger-ghost` with a confirm (§3.16) |
| 19 | "Unlabeled" shows Shipped Amazon orders; "Amazon Customer" and "-" image | Saved views use normalized keys (`to_ship` excludes `shipped`). The buyer cell reads "Name hidden by Amazon (?)" and `Thumb` has a placeholder |
| 20 | Three carrier drawers with three structures | One `CreateLabelPanel` (§3.16, §6.4) |
| 21 | Add Manual Order as a modal, currency defaulting to USD | Becomes a SidePanel. `MoneyField` defaults to the base currency (TRY) (§3.6) |
| 22 | 4 listings layouts, 2 sync buttons, "Filter by St…" header bug | One `ListingsPage`. Push is the primary and pull sits in meta. Rails removed. Headers from i18n (§6.2) |
| 23 | Per-row pencil/copy/red trash icons | One inline action plus `⋯`; destructive actions in the menu (§3.4) |
| 24 | Editor with 9 tabs, Basics 4th | Full-page `ListingEditor`: one scroll with anchor nav in the order Photos & video, Title & description, Tags, Price & inventory, Variations, Details, Personalization, Shipping (§6.3) |
| 25 | 6 equal footer buttons, disabled Save Draft, no Sync to Etsy, no status | Autosave to a local draft. Footer: `⋯` (View on Etsy, Copy, Schedule, Save as profile, Delete) · "Saved · 3 changes not sent yet" · [Discard changes] · **[Send changes to Etsy]** |
| 26 | Unlabeled undo and folder icons; "0 views · 0 favorites" | Labeled `IconButton`s. Stats shown only when non-zero and sourced |
| 27 | Inner-scrolling description, raw entities, no preview | Auto-grow `TextArea` with Edit/Preview; entities decoded at ingest |
| 28 | "No research data" orange warning | The Tags field gets a ghost "Get tag ideas" action that opens Keyword explorer in a side panel. The score check shows `n/a` |
| 29 | No live preview or score in the editor | Right rail: `ScorePanel` plus `MarketplacePreview` (search card / listing page) |
| 30 | Messages with no preview, no unread state, all "1m", empty pane | `ConversationList`: Avatar with a brand badge, one-line preview, relative time, bold plus dot for unread, `needs_reply` pill, order chip. The newest "Needs reply" opens automatically on desktop. Labeled filters (§3.3) |
| 31 | Research: gradient hero, implausible numbers, TR tips in an EN UI, FAB | Research hub (§3.18, §6.6): R0 honesty patch, `SourceNote`, `Metric` guards, p25–p75, no hero/FAB/trending block, i18n tips |
| 32 | eBay research: two search bars, empty button, stuck loading banner, empty table | One search, one marketplace filter, `useAsyncState` 15s/30s fallbacks, `EmptyState` in tables, no unlabeled buttons |
| 33 | Analytics: "Dashboard" vs "Reports", gradient Refresh, "TRY 1,070,860.03", dual-axis chart | Title from `navConfig`, pull in `SyncMeta`, `Money`, single-axis `Chart` (two small charts in place of the dual axis) |
| 34 | Financials: gradient header, 10 rainbow tiles, native dates + Apply, green Sync Data | PageHeader, at most 4 neutral `KpiTile`s (the rest go into a table), `DateRangeField` without an Apply button, "Refresh from …" in meta |
| 35 | Settings: duplicate titles, icon tabs, yellow restriction box, pale green rows, "Last sync 3 weeks ago" with no action | `settings_spec.md` on DS primitives: `SettingsLayout` nav, IntegrationTile grid with `LogoTile` and `StatusPill`, the Etsy restriction as a one-line info `Banner` in the Etsy drawer, and "Refresh now" next to the last-sync meta |

---

## 6. Wireframes (ASCII)

### 6.1 Orders (`/app/labels`)

**Desktop 1440**
```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Orders                                              [⌘K Search or jump…]       (bell) (TS)   │
│          ├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Orders 12│ Orders [142]                                         [Print picklist]  ⋯   [Create 12 labels] │
│          │ Refreshed 2 min ago ⟳ · Etsy, eBay, Amazon, Trendyol                                         │
│          │ [⌕ Search order #, buyer, SKU…  /][Store: All ▾][Status: All ▾][Last 30 days ▾][Filters]  View: [To ship ▾] │
│          │ Store: Etsy ✕  Ship by: Today ✕  Clear all                                         142 results │
│          │ ┌──┬──────┬──────────────────────────────┬──────────┬───────────┬──────────┬───────────────┬─────┐│
│          │ │☐ │      │ Order                        │ Store    │     Total │ Status   │ Ship by       │     ││
│          │ ├──┼──────┼──────────────────────────────┼──────────┼───────────┼──────────┼───────────────┼─────┤│
│          │ │☐ │[img] │ Personalized Baby Blanket ×2 │ [E] Belle│   $169.99 │● To ship │ Today 22:59   │ ⎙ ⋯ ││
│          │ │  │ 48   │ #3891 · Sarah M. · US        │          │           │          │ (warning)     │     ││
│          │ │☐ │[img] │ Wooden Keepsake Box          │ [T] Trend│ ₺1.109,30 │● To ship │ Thu 15 Oct    │ ⎙ ⋯ ││
│          │ │  │      │ #TY-88213 · Ayşe K. · İstanbul│         │           │          │               │     ││
│          │ │☐ │[img] │ Name Necklace (+2 items)     │ [a] Amzn │    $42.00 │● Overdue │ Overdue 1 day │ ⎙ ⋯ ││
│          │ │  │      │ #114-…-0098 · Name hidden (?)│          │           │          │ (danger)      │     ││
│          │ │☐ │[img] │ Baby Name Sign               │ [e] eBay │    €58.00 │● Label   │ —             │ ⧉ ⋯ ││
│          │ │  │      │ #12-11834 · 1Z999AA1… (copy) │          │           │  created │               │     ││
│          │ └──┴──────┴──────────────────────────────┴──────────┴───────────┴──────────┴───────────────┴─────┘│
│          │ 1–50 of 142                                                        Rows 50 ▾    ‹ 1 2 3 ›     │
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
Selection replaces the toolbar row: "3 selected  [Create 3 labels] [Print] [Mark shipped] ⋯   Clear Esc"
(the bulk primary becomes the view's primary; the header primary demotes to secondary).
Enter on a row → OrderPanel (md 560): Items (thumb, SKU, personalization with copy) · Ship to (Edit) ·
Payment · Costs (product cost → profit) · History (Timeline). Footer: ⋯ (Delete order…) · [Print packing slip] [Create label].
```

**Mobile 390**
```
┌──────────────────────────────────┐
│ Orders                    ⌕   ⋯  │ 48 top bar
├──────────────────────────────────┤
│ [To ship 12][Overdue 1][Label…] →│ saved-view chips
│ [⌕ Search orders…  ] [Filters 2] │ 44px
│ 142 results              Select  │
│ ┌──────────────────────────────┐ │
│ │[img] Personalized Baby Bl… ⋯ │ │
│ │ 64   #3891 · [E] Belle       │ │
│ │      $169.99     ● To ship   │ │
│ │      Ship by today 22:59     │ │
│ │      [ Create label ]        │ │ one action, 44px
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │[img] Wooden Keepsake Box   ⋯ │ │
│ │      #TY-88213 · [T]         │ │
│ │      ₺1.109,30   ● To ship   │ │
│ └──────────────────────────────┘ │
│ [ Load more ]                    │
├──────────────────────────────────┤
│ (in select mode) 3 selected      │ StickyActionBar
│ [ Print ]      [ Create 3 labels]│ 50/50 · 48px
├──────────────────────────────────┤
│ Overview Orders Listings Msgs More│ tab bar 56
└──────────────────────────────────┘
Tap a card → full-height sheet (OrderPanel) with a sticky footer [Create label].
```

### 6.2 Listings (one `ListingsPage` for Etsy, eBay, Trendyol, Wix and Shopify)

**Desktop**
```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Listings / [E] Etsy / Belle Couture Gifts ▾                    [⌘K…]           (bell) (TS)   │
│          ├──────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ Etsy listings [312]                   [New listing] [Bulk edit]  ⋯   [Send 7 changes to Etsy] │
│          │ Refreshed from Etsy 10 min ago ⟳                                                              │
│          │ [⌕ Search title, SKU, tag…  /][Status: Active ▾][Section ▾][Health ▾][Filters] View: [All ▾] │
│          │                                                                                  312 results │
│          │ ┌──┬──────┬─────────────────────────────┬─────────┬──────┬─────────┬───────────┬────────┬──────┬────┐│
│          │ │☐ │      │ Listing                     │   Price │  Qty │ Status  │ Changes   │ Health │ Upd. │    ││
│          │ ├──┼──────┼─────────────────────────────┼─────────┼──────┼─────────┼───────────┼────────┼──────┼────┤│
│          │ │☐ │[img] │ Personalized Baby Blanket,  │  $69.99 │   42 │● Active │           │▰▰▰▰▱ 78│ 2 h  │ ✎ ⋯││
│          │ │  │      │ Custom Name Blanket, Newb…  │         │      │         │           │        │      │    ││
│          │ │  │      │ BB-PINK · 1488223311        │         │      │         │           │        │      │    ││
│          │ │☐ │[img] │ Wooden Keepsake Box, Engr…  │ [54.00]▒│ [0]▒ │● Sold   │● Not sent │▰▰▰▱▱ 61│ 1 d  │ ✎ ⋯││
│          │ │  │      │ KB-OAK · 1490012234         │ (dirty) │      │  out    │   yet     │        │      │    ││
│          │ │☐ │[img] │ Name Necklace Gold          │  $38.00 │  120 │● Active │● Send     │▰▱▱▱▱ 34│ 3 d  │ ✎ ⋯││
│          │ │  │      │ NN-G · 1477011200           │         │      │         │  failed(?)│        │      │    ││
│          │ └──┴──────┴─────────────────────────────┴─────────┴──────┴─────────┴───────────┴────────┴──────┴────┘│
│          │ 1–50 of 312                                                      Rows 50 ▾   ‹ 1 2 … 7 ›       │
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
With 0 pending changes the primary is [New listing] and "Bulk edit" stays secondary.
Price and Qty cells edit inline (Enter/Tab commits → staged draft, attention tint ▒).
Selection bar: "24 selected  [Edit in grid] [Change price] [Add tags] [Improve with AI] [Copy to eBay] ⋯ (Deactivate…)".
Enter → quick SidePanel (photos, title, price, status, ScorePanel); e → full editor.
```

**Bulk edit (full page, `BulkGrid`)**
```
│ ← Back to listings   Bulk edit · 24 listings · 37 changes not sent   Columns ▾  Find & replace  [Discard] [Send 37 changes to Etsy] │
│ ┌──────┬──────────────────────────────┬────────┬─────┬──────────────────────────┬──────────┬────────┐                  │
│ │ img  │ Title  (140)                 │ Price  │ Qty │ Tags (13)                │ Section  │ Health │                  │
│ │[img] │ Personalized Baby Blanket,…▌ │  69.99 │  42 │ baby gift, newborn bl…   │ Blankets │   78   │                  │
│ │[img] │ Wooden Keepsake Box… ▒       │  54.00▒│   0 │ keepsake box, …          │ Boxes    │   61   │                  │
│ │[img] │ Name Necklace Gold           │ -3 ✕   │ 120 │ …                        │ Jewelry  │   34   │ ← invalid outline │
│ └──────┴──────────────────────────────┴────────┴─────┴──────────────────────────┴──────────┴────────┘                  │
│ ⌘V paste from Sheets · ⌘D fill down · right-click a cell → Revert                                                     │
```

**Mobile**
```
┌──────────────────────────────────┐
│ ‹  Etsy listings      ⌕  + New ⋯ │
├──────────────────────────────────┤
│ Refreshed 10 min ago ⟳           │
│ [All][Not sent 7][Failed 1][Ne…]→│
│ [⌕ Search listings ] [Filters]   │
│ ┌──────────────────────────────┐ │
│ │[img] Personalized Baby Bl… ⋯ │ │
│ │ 64   $69.99 · 42 in stock    │ │
│ │      ● Active    ▰▰▰▰▱ 78    │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │[img] Wooden Keepsake Box   ⋯ │ │
│ │      $54.00 · 0 in stock     │ │
│ │      ● Sold out ● Not sent   │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ 7 changes not sent yet           │ StickyActionBar (only when N > 0)
│ [   Send 7 changes to Etsy     ] │ 48px
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```

### 6.3 Listing editor (`/app/etsy-listings/[id]`, full page, width `detail`)

**Desktop**
```
┌──────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ ← Etsy listings   Personalized Baby Blanket, Custom Name…  ● Active ● Not sent yet   ‹ ›   ⋯   │
│          ├──────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ Photos · Title · Tags · Price · Variations · Details · Personalization · Shipping (anchors)  │
│          ├──────────────────────────────────────────────────────────────┬───────────────────────────────┤
│          │ Photos & video                                      6 / 20   │ Listing health  78/100  Good  │
│          │ [★1][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ][ + Add ]   drag to reorder      │ ▰▰▰▰▰▰▰▰▱▱  9 of 12 checks    │
│          │ Video [▶ thumb]  Replace · Remove                            │ ✕ 6 photos: add 4   +8 [Add]  │
│          │ ──────────────────────────────────────────────────────────── │ ✕ 3 without alt  +4 [Write]   │
│          │ Title                                            132 / 140   │ ✓ 13 / 13 tags                │
│          │ [Personalized Baby Blanket, Custom Name Blanket, Newborn …]  │ n/a Tag demand  [Get ideas]   │
│          │ Title Case, commas only. 3 words repeat in tags (?)          │ ───────────────────────────── │
│          │ [✦ Suggest titles]                                           │ Preview  [Search] [Listing]   │
│          │ Description                                  [Edit|Preview]  │ ┌───────────────────────────┐ │
│          │ ┌─────────────────────────────────────────────────────────┐  │ │ [img]                     │ │
│          │ │ auto-grow, no inner scroll, entities decoded            │  │ │ Personalized Baby Blan…   │ │
│          │ └─────────────────────────────────────────────────────────┘  │ │ ★★★★★ (212) · $69.99      │ │
│          │ Tags                                              13 / 13    │ └───────────────────────────┘ │
│          │ [baby gift 9/20 ✕][newborn blanket ✕][…]  type or paste      │ Not sent yet (3)              │
│          │ [✦ Get tag ideas] → Keyword explorer in a side panel          │ · Title · Tags · Photo order  │
│          │ Price & inventory   Price [$ 69.99]  Qty [42]  SKU [BB-PINK] │                               │
│          │ … Variations · Details (taxonomy) · Personalization · Shipping│                               │
│          ├──────────────────────────────────────────────────────────────┴───────────────────────────────┤
│          │ ⋯ (View on Etsy, Copy, Schedule, Save as profile, Delete…)                                    │
│          │                       Saved 10:42 · 3 changes not sent yet  [Discard changes] [Send changes to Etsy] │
└──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
Autosave goes to the local draft only. ⌘S saves now; ⌘↵ = Send changes to Etsy.
Conflict → warning Banner at top: "This listing changed on Etsy after your draft started. [Review differences]".
Never a blind force; queued delete actions are listed in the review.
```

**Mobile**
```
┌──────────────────────────────────┐
│ ‹  Edit listing     ▰▰▰▰▱ 78   ⋯ │ tap score → checklist sheet
├──────────────────────────────────┤
│ [Photos][Title][Tags][Price] … → │ sticky anchor chips
│ Photos & video           6 / 20  │
│ [img][img][img] →  (h-scroll)    │
│ Title                  132 / 140 │
│ [Personalized Baby Blanket, … ]  │ 16px input text
│ Description        Edit|Preview  │
│ Tags                     13 / 13 │
│ [chips…]                         │
├──────────────────────────────────┤
│ Saved · 3 changes not sent yet   │ StickyActionBar
│ [ Preview ]  [ Send to Etsy    ] │ 50/50 · 48px
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```

### 6.4 Create label (`CreateLabelPanel`, SidePanel lg 720)

**Desktop**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Create label · Order #3891                     ● To ship            ⋯    ✕   │
│ Sarah Miller · Austin TX, US · 2 items · Ship by today 22:59                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ From                                                             Change      │
│ Belle Couture Gifts · Atatürk Cad. 12, Bursa TR · +90 532 …                   │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Ship to                                                          Edit        │
│ Sarah Miller · +1 555 0134 · 12 Oak St, Austin TX 78701 · [US ▾]              │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Package                                                       Presets ▾      │
│ Weight [0.8] [kg ▾]   L [30] W [20] H [8] cm                ☐ Save as preset │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Carrier & service                                             Refresh rates ⟳│
│ ◉ [FedEx] International Priority   2–3 days   $38.40   Recommended            │
│ ○ [FedEx] International Economy    4–6 days   $29.10                          │
│ ○ [UPS]   Worldwide Saver          2–4 days   $41.75                          │
│ ○ [DHL]   DHL eCommerce            Turkey domestic only (?)   (disabled)      │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Customs                                                        2 items ▾     │
│ Baby blanket · HS (?) 6302.10 · Qty 2 · $139.99 · Origin TR                   │
│ Content type [Merchandise ▾]   ETGB (?) ☑ Include                             │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Options   ☐ Signature  ☐ Insurance  Label format [PDF 4×6 ▾]                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⋯ (Save as draft, Use another account)      Total $38.40  [Cancel] [Create label] │
└──────────────────────────────────────────────────────────────────────────────┘
Success state (same panel): label PDF preview · Tracking 1Z999AA1… (copy) · "Tracking sent to Etsy ✓" · [Print label].
```

**Mobile**
```
┌──────────────────────────────────┐
│ ✕  Create label · #3891          │
├──────────────────────────────────┤
│ From    Belle Couture Gifts   ›  │ rows → edit sheets
│ To      Sarah Miller, US      ›  │
│ Package 0.8 kg · 30×20×8      ›  │
│ Service                          │
│ ◉ [FedEx] Intl Priority  $38.40  │ 48px rows
│ ○ [FedEx] Intl Economy   $29.10  │
│ ○ [UPS]   Worldwide Saver $41.75 │
│ Customs 2 items · $139.99     ›  │
│ Options                       ›  │
├──────────────────────────────────┤
│ Total $38.40                     │
│ [ Cancel ]    [ Create label   ] │ 50/50 · 48px
└──────────────────────────────────┘
```

### 6.5 Overview (`/app`, width `detail`): an action queue, not nav tiles

**Desktop**
```
┌──────────┬────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Good morning, Tamer                                                     [Go to orders] │
│          │ Wednesday 15 Oct · All stores · Updated 1 min ago                                      │
│          │ ┌────────────────┐┌────────────────┐┌────────────────┐┌────────────────┐               │
│          │ │ To ship        ││ Overdue        ││ Revenue (7 d)  ││ Needs reply    │ KpiTile ×4    │
│          │ │ 12             ││ 1              ││ ≈ ₺86.400      ││ 3              │ neutral       │
│          │ │ 4 due today    ││ Amazon #114…   ││ ▲ 12% vs prev  ││ Etsy 2 · Wix 1 │               │
│          │ │ Orders · 10:42 ││ Orders · 10:42 ││ TCMB FX (?)    ││ Messages ·10:40│               │
│          │ └────────────────┘└────────────────┘└────────────────┘└────────────────┘               │
│          │ Needs your attention                                                                   │
│          │ ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│          │ │ ● Overdue        [a] Name Necklace · #114-…-0098 · 1 day late   [Create label]   │  │
│          │ │ ● Changed on Etsy [E] Wooden Keepsake Box · draft vs Etsy       [Review]         │  │
│          │ │ ● Send failed    [E] Name Necklace Gold · "Invalid taxonomy"    [Open]           │  │
│          │ │ ● Reconnect      [e] eBay authorization expired                 [Reconnect eBay] │  │
│          │ │ ● Not sent yet   [E] 7 changes waiting                          [Review & send]  │  │
│          │ │ ● Needs work     18 listings under 50                           [Open doctor]    │  │
│          │ └──────────────────────────────────────────────────────────────────────────────────┘  │
│          │ ┌──────────────────────────────────────────┐┌──────────────────────────────────────┐  │
│          │ │ Orders, last 14 days   (single axis)     ││ Top listings (7 d)                   │  │
│          │ │ ▁▂▃▅▃▆▇▅▆▇█▆▇█                           ││ [img] Baby Blanket  18 sold $1,259.82│  │
│          │ └──────────────────────────────────────────┘└──────────────────────────────────────┘  │
│          │ Stores  [E] Belle ● Connected · 2 min   [e] eBay ● Reconnect   [T] Trendyol ● Connected│
└──────────┴────────────────────────────────────────────────────────────────────────────────────────┘
Primary = "Go to orders" when anything is to ship, else "New listing". A new account sees a 3-step
checklist instead of KPIs (Connect a store → Sender profile → First label). The queue is "done" when empty.
```

**Mobile**
```
┌──────────────────────────────────┐
│ Overview                 (bell)  │
├──────────────────────────────────┤
│ [To ship 12 ][Overdue 1 ]        │ 2×2 KPI grid
│ [Rev 7d ₺86K][Reply 3   ]        │ compact allowed in KPI only
│ Needs your attention             │
│ ● Overdue   Name Necklace     ›  │ 48px rows
│ ● Changed on Etsy Keepsake Box › │
│ ● Reconnect eBay              ›  │
│ Orders, last 14 days             │
│ ▁▂▃▅▃▆▇▅▆▇█▆▇█                   │
├──────────────────────────────────┤
│ [        Go to orders          ] │ StickyActionBar
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```

### 6.6 Research: Home and Keyword explorer

**Home, desktop (`/app/research`, width `list`)**
```
┌──────────┬────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Research                                                   [Marketplace: [E] Etsy ▾]  │
│          │ Find what to sell, how to price it, and which words buyers use                         │
│          │ [⌕ Idea, keyword, Etsy listing link, shop URL or Trendyol link…            ] [Research]│
│          │ ( Is this niche worth it? ) ( What price should I charge? ) ( Which tags? )            │
│          │ ( Why is my listing not selling? )                                                     │
│          │ Tools:  Product finder · Keyword explorer · Listing doctor · Shop tracker              │
│          │ ┌ Your listings that need work ─────────────────────┐┌ Recent & watched ─────────────┐ │
│          │ │ [img] Name Necklace Gold   ▰▱▱▱▱ 34  [Fix]        ││ wooden keepsake box · 2h ago  │ │
│          │ │ [img] Keepsake Box         ▰▰▰▱▱ 61  [Fix]        ││ WoodAndWords +9 listings (7d) │ │
│          │ │ 18 listings under 50 → [Open Listing doctor]      ││ "baby keepsake box" #34 → #71 │ │
│          │ └───────────────────────────────────────────────────┘└───────────────────────────────┘ │
└──────────┴────────────────────────────────────────────────────────────────────────────────────────┘
```

**Product finder result (question "Is this niche worth it?")**
```
│ Product finder · wooden baby keepsake box · Etsy US                                   ⋯  [Draft a listing] │
│ Etsy search · 48 listings sampled · 3 excluded (no FX) · updated 2h ago · Measured                         │
│ ┌ Evidence ─────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ · Most sell between $38 and $62 (median $49)  · 30% of top shops opened < 1 year ago                   │ │
│ │ · 2,140 competing listings                    · Demand Signal ●●●○○ (2 of 3 inputs)                    │ │
│ │ Confidence: medium · 48 listings, Etsy shares no search volume                                          │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Price ─────────────────┐┌ Competition ────────────┐┌ Buyer words ──────────────────────────────┐       │
│ │ $38 ──[$49]── $62      ││ 2,140 listings          ││ newborn keepsake · baby memory box · …    │       │
│ │ p25 · median · p75     ││ 6 strong shops          ││ used by 18 of top 48                      │       │
│ │ [Use $49 in listing]   ││ [See top 10]            ││ [Add 5 tags to a listing]                 │       │
│ └────────────────────────┘└─────────────────────────┘└───────────────────────────────────────────┘       │
│ Top listings (DataTable): thumb · title · price · reviews · age · shop · [⋯ Watch shop]                    │
```

**Keyword explorer (desktop)**
```
│ Keyword explorer                                                              ⋯   [Add to listing]   │
│ Etsy search · top 48 per keyword · refreshed 2h ago                                                  │
│ [⌕ wooden jewelry box                    ] [Marketplace: [E] Etsy ▾] [Country: US ▾] [Filters]      │
│ View: Suggested · Long-tail · Seasonal · Used in my shop · Tracked                                    │
│ ┌──┬──────────────────────────────┬─────────┬──────────────┬────────────┬──────────────┬───────────┐ │
│ │☐ │ Keyword                      │ Demand  │ Competition  │ Top-48 use │ Price band   │ In my shop│ │
│ │☐ │ engraved jewelry box         │ ●●●●○   │ 1,820        │ 18 of 48   │ $38–$72      │ 4 listings│ │
│ │☐ │ personalized keepsake box    │ ●●●○○   │ 3,410        │ 11 of 48   │ $29–$55      │ —         │ │
│ │☐ │ halloween decor              │ —  (?) small sample: 7 listings, see note                       │ │
│ └──┴──────────────────────────────┴─────────┴──────────────┴────────────┴──────────────┴───────────┘ │
│ 2 selected  [Add 2 tags to…  Jewelry box ▾]  [Track]                                                 │
```
Mobile: the search is full width, question chips scroll horizontally, keyword rows become cards (keyword / demand · competition / price band / [Add to listing]), and the selection primary goes in the StickyActionBar.

---

## 7. Migration plan

### 7.1 How old and new run side by side
1. **One theme for everything.** M0 replaces `lib/theme.tsx` in place, so legacy MUI pages immediately get flat buttons, 6px radii, no gradients, flat Paper, z-index fixes and `size="small"` text fields. Nothing in that PR breaks a legacy API: spacing stays 8, floating labels still work, `h1`–`h6` stay defined, and the Tailwind palettes and breakpoints stay.
2. **Additive tokens.** `styles/tokens.css` adds `neutral-*`, `accent-*`, semantic tones and `--text-*`/`--shadow-e*` names next to the Tailwind defaults. Legacy `slate-*` classes look identical to `neutral-*`.
3. **Two kinds of file.** A file is **migrated** when it renders `<Page>` and imports UI only from `components/ds/*`. Everything else is **legacy**. Legacy files may import DS components at any time (an incremental win). Migrated files may not import raw MUI or use hex, gradients, uppercase or Tailwind responsive prefixes. ESLint enforces this per path: `eslint.config.mjs` reads `design/migrated-paths.json` and applies the strict rule set to those globs, and the list grows one PR at a time. (The repo has **no ESLint today**. M0 adds `eslint`, `eslint-config-next`, `eslint-plugin-react` as devDependencies and an `npm run lint` script; CI runs it.)
4. **Shims.** From M1, `components/ui/*` re-exports DS components with adapter props, so the existing call sites in 20 files improve without being edited. `components/settings/ui/*` re-exports `ds/*` from the first Settings PR.
5. **Big surfaces ship behind a per-surface flag** so the founder can test on production before switching: `lib/ds/uiFlags.ts` reads `NEXT_PUBLIC_UI_V2` (a comma list such as `orders,listings-etsy`) plus a query override `?ui=2` / `?ui=1`, which is persisted in `localStorage` with try/catch. The route file renders `flag ? <OrdersPage/> : <LegacyLabelsPage/>`. The legacy component is renamed and kept for **one release** after the flag flips to default-on, then deleted in the next PR. APIs and data contracts do not change, because new UIs call the same endpoints (`/api/orders`, `etsy-drafts`, `generate-label`…).
6. **The shell switches globally once (M2).** `AppShell` replaces `AppLayout.js` chrome for every page in one PR. The same PR runs a **header pass**: every page's ad-hoc H1, subtitle and top buttons are replaced mechanically with `<PageHeader>` and `<Page width>`, keeping their existing handlers. This fixes finding #1 app-wide without rebuilding page bodies.
7. **Lint ramps.** All guards are warnings from M0. A directory flips to errors in the PR that migrates it. M10 flips everything to errors.

### 7.2 Order (product track and research track run in parallel)

| Step | Scope | Exit criteria |
|---|---|---|
| **M0 Foundation** (3 days) | `lib/ds/tokens.ts`, new `lib/theme.tsx`, `styles/tokens.css`, Inter via `next/font` (remove the `@import` and preconnects), `document.documentElement.lang` sync in `_app`, `uppercase` removed from the 20 files, old `--z-*` vars removed, Toaster moved to bottom-center, ESLint added (devDependency, flat config, `npm run lint`), parity test, nav-icon uniqueness test, lint guards in warn mode | Legacy pages look calmer with no layout breaks at 1440 and 390 on the top 8 routes (EN and TR); "FAİLED" gone |
| **M1 Primitives** (1.5 weeks) | `lib/format.ts`, the status maps, `decodeEntities` in all mappers, Button/IconButton/SplitButton, FormField + inputs, DateRangeField, StatusPill, ScoreMeter/ScorePanel + `lib/listingScore/etsy`, Thumb, LogoTile + SVGs, Banner, EmptyState/ErrorState/ConnectState/Skeletons, `useAsyncState`, useToast, Modal/ConfirmDialog (`typeToConfirm` field), SidePanel, BottomSheet, OverflowMenu, StickyActionBar, DataTable, Toolbar family, `useUrlState`, `useShortcuts`; `components/ui/*` shims | Every component has a render test and an EN/TR story in the test file |
| **M2 Shell + header pass** (1 week) | AppShell, SideNav with logos and auto-rail, TopBar, MobileTabBar refactor, CommandPalette + `usePageActions`, `navConfig` (Research as one entry; Invoices and Integrations moved), PageHeader/Page on every page | No page shows two titles; each nav item is unique; ⌘K lists every header action |
| **M3 Orders** (2 weeks, flag `orders`) | OrdersPage (DataTable, SavedViews, server pagination), OrderPanel, **CreateLabelPanel** with RateList and success state, Add manual order panel, bulk create and print | DoD (§8); the founder ships 10 real labels across FedEx/UPS/DHL eCommerce on the flag |
| **M4 Settings** (parallel with M3, per `settings_spec.md` groups A–D, built on `ds/`) | SettingsLayout, IntegrationTile grid, drawers, billing, sender, sync | DoD |
| **M5 Listings template** (2 weeks, flags `listings-etsy` then `listings-ebay`, `-trendyol`, `-wix`, `-shopify`) | `ListingsPage` for Etsy first, inline price/qty staging, push primary + pull meta, quick SidePanel, then the other four by config (scores from `lib/listingScore/*`) | DoD per marketplace; no DataGrid left in listing pages |
| **M6 Listing editor** (2 weeks) | Full-page `ListingEditor` (Etsy first), ImageGrid, ScorePanel with fixes, MarketplacePreview, StickyActionBar, conflict review; then eBay | Staged-draft behaviour identical to today (verified against `EtsyListingDraft`/`EtsyDraftMedia` rows) |
| **M7 BulkGrid** (2 weeks, the Vela milestone) | BulkGrid v1 (§3.17), bulk bar actions (Change price, Add tags, Improve with AI, Copy to eBay) | 200 listings × 3 columns pasted from Google Sheets and sent in one sync |
| **M8 Overview + Messages** (1.5 weeks) | Action-queue Overview, ConversationList/ThreadPane with unread and needs_reply | DoD |
| **M9 Reports + Finance** (1 week) | KpiTile ≤ 4, single-axis charts, DateRangeField, per-currency totals | DoD |
| **M10 Cleanup** (1 week) | Lint to error everywhere; delete `components/ui/*` shims, `AppLayout.js` chrome, legacy page components, `.glass`/`.gradient-text`/`.card-premium`/`.btn-primary`, `tailwind.config.js`; remove `@mui/icons-material`; `--color-*: initial` once `grep -rE "(bg|text|border|from|to|ring)-(purple|indigo|violet|emerald|green|red|amber|yellow|orange|pink|cyan|teal|sky|rose|zinc|gray|blue|slate)-[0-9]" pages components` is empty; align Tailwind breakpoints to MUI; optional `/design-system` route + Playwright snapshots; then consider dark mode | Zero lint warnings; build passes |

**Research track** (owner separate from the product track; follows `RESEARCH_REDESIGN.md` §5):

| Step | When | Scope |
|---|---|---|
| **R0 Honesty patch** | Week 1, before or with M0 (data only, no DS needed) | `lib/research/stats.ts` (median, p25–p75, Tukey trim, FX normalization, plausibility, minimum n); remove "Trending Niches", the Demand Score ring and every average price; decode entities; move TR tips to i18n; 20s fallback on the stuck eBay banner |
| **R1 Hub + Product finder + Listing doctor** | Starts after M1 (needs DataTable, SourceNote, Metric, ScorePanel); ~2 weeks | `/app/research` Home with question chips and "Your listings that need work", Product finder (Etsy + eBay), Listing doctor with staged fixes; redirects from the 4 old routes |
| **R2 Keyword explorer** (+ Tracked view) | after R1; ~1.5 weeks | candidate pool, Top-48 use, Etsy Insights "You entered", "Add N tags to…" staging, rank tracking with send markers |
| **R3 Shop tracker** | after R2; ~2 weeks | `ResearchWatch`/`ResearchSnapshot`, daily cron, measured sales/day, alerts |
| **R4 Price gap TR → global + Amazon** | after R3; ~1.5 weeks | Product finder "From Trendyol" source mode, landed margin from real label costs; Amazon only with confirmed eligibility |
| **Delete** | after R4 parity | the list in RESEARCH_REDESIGN §5 |

---

## 8. Definition of done (every rebuilt surface)

A surface is done only when **every** box is checked in the PR description, with screenshots attached.

**Visual (1440 and 390, EN and TR = 4 screenshots minimum, plus 1024 for the auto-rail)**
- [ ] Exactly one primary per view (page, panel, sheet, modal). At most 2 visible secondaries. Destructive actions only in `⋯` or a confirm.
- [ ] One title (PageHeader). No TopBar title on desktop. `<title>` is "Page · KolayXport".
- [ ] Content respects its `Page width`, and inputs are ≤ 480 (long text ≤ 720).
- [ ] No gradient, glass, colored shadow, hover transform, green button, uppercase text or rainbow tile. Brand colors only inside `LogoTile`.
- [ ] Every control on a row has the same height (32 / 40 / 44). Spacing values come only from the token list.
- [ ] Statuses come from `StatusPill` (at most 1 order + 1 sync pill per row), scores from `ScoreMeter`, money and dates from `Money`/`DateText`/`ShipBy`. No ISO currency codes in cells and no `toFixed`.
- [ ] Every marketplace or carrier shows its logo. No two nav items share an icon.
- [ ] At 390: no horizontal page scroll (except a deliberate chip strip). Tables render as cards. Panels are full-height sheets with sticky header and footer. The state-driven primary is in `StickyActionBar` above the tab bar and is not covered by it. Every touch target is ≥ 44px and input text is 16px.
- [ ] At 1024 the sidebar is in rail mode with tooltips, and nothing overflows.

**States**
- [ ] Skeleton (after 200ms) matching the layout, "Still loading… Retry" at 15s, `ErrorState` at 30s. No endless spinner.
- [ ] Empty states for first use (`ConnectState` when not connected), no results (with Clear filters) and done.
- [ ] ErrorState with a human cause, Retry and a copyable error ID. "Couldn't check" when the state is unknown.
- [ ] Loading buttons keep their width and show a verb. Disabled buttons have a reason tooltip.
- [ ] A dirty panel or page guards close and navigation through a nested confirm (z 1550). `⌘S` saves the draft and `⌘↵` runs the primary.
- [ ] Staged-draft surfaces: autosave stays local, the push wording is "Send N changes to …", conflicts show "Review differences", and nothing writes to a marketplace without the explicit action.
- [ ] Research and AI numbers carry a `SourceNote`, implausible values render `—` with a reason, and there are no averages of prices.

**i18n and data**
- [ ] Zero literal JSX strings (lint error in this directory). All new keys exist in **both** `messages/en.json` and `messages/tr.json`, in correct Turkish (no ASCII-Turkish), in sentence case, using glossary wording.
- [ ] The TR screenshot shows no English strings and the EN screenshot no Turkish strings (except marketplace content and English tags or titles).
- [ ] No raw HTML entities visible. Marketplace text is decoded at the mapper.
- [ ] Filters, sort, view, page and the open record are in the URL. Reloading restores the view.

**Accessibility**
- [ ] Every icon-only button has an `aria-label` and a tooltip. Pills include text, never color alone.
- [ ] Visible focus ring on every interactive element. Tab order follows reading order. Opening a panel moves focus into it and closing returns focus to the trigger.
- [ ] Contrast is AA (text ≥ 4.5:1, large text and UI parts ≥ 3:1). `neutral-400` is never body text.
- [ ] Keyboard-only run: open, act and close every flow on the surface. `/`, `j`/`k`, `x`, `Enter`, `Esc` and `⌘K` work, and shortcuts don't fire inside inputs.
- [ ] `prefers-reduced-motion` honoured. Form errors are announced (`aria-describedby`, `aria-invalid`), with a summary banner on submit.

**Engineering**
- [ ] `npx next build --webpack` passes locally. `npm run test` passes, including tokens parity and nav uniqueness.
- [ ] The path is added to `design/migrated-paths.json`, and lint is error-clean for it.
- [ ] Surface flag default-on only after the founder has verified on production. Legacy component deleted one release later.
- [ ] Committed and pushed to main, and the deploy is verified by SHA (`.next/BUILD_ID` mtime) before asking anyone to test.

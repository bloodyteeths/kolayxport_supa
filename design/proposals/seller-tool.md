# KolayXport Design System: "Seller Workspace" proposal

Angle: **a seller workspace that beats Vela.** It is built for people who touch 50 to 5,000 listings and ship 20 to 500 orders a day. The design rests on dense but calm grids, spreadsheet-style bulk editing, keyboard-first control, editing in side panels, and product photos you can actually see.

Status: proposal, 2026-10-15. No app code has been changed. All new components go under `components/ds/*`. The theme lives in `lib/theme.tsx`. Tokens live in `styles/tokens.css`, which `styles/globals.css` imports.

Reality check against the repo. These facts constrain the proposal:
- `@mui/material` is **5.17** and `@mui/x-data-grid` is **8.3**. The brief says "MUI v8". The theme skeleton below uses APIs that exist in v5 (`createTheme`, `components.*.styleOverrides`, `defaultProps`) and carry forward unchanged to v6/v7. When core MUI is upgraded, enable `cssVariables: true`. Nothing below depends on that.
- `@mui/x-date-pickers` is **6.20**, and `DateRangePicker` there is **Pro** (paid). The `DateRangeField` below is built from the free `DateCalendar` inside a `Popover`, plus presets.
- DataGrid Community (MIT) has cell editing but **no clipboard paste, no fill handle and no row grouping** (those are Premium). Spreadsheet paste is a thin custom `onPaste` handler in `ds/BulkGrid` (section 4.6).
- Icons are mixed today: `lucide-react` 0.507 plus `@mui/icons-material`. **Rule: lucide only** (section 3.16).
- `public/logos` has etsy, amazon, trendyol, shopify, hepsiburada, n11 and woocommerce. These are missing and must be added as SVGs: ebay, wix, fedex, ups, dhl, veeqo, shippo, parasut, google. A monogram fallback covers the gap until then.
- `_document.js` sets `<Html lang="tr">` for every locale. That plus CSS `text-transform: uppercase` causes the "FAİLED" bug. Fix both: set `lang` per locale and ban uppercase (rule P5).
- Existing primitives to replace or absorb: `components/ui/{PageHeader, StatusBadge, EmptyState, ErrorState, StatCard, ConfirmDialog, ConnectEmptyState, CopyButton}`, `components/MobileTabBar.tsx` (keep its `--kx-bottom-nav` var) and `components/CommandPalette.tsx` (keep it and add keyboard shortcuts to it).

---

## 1. Principles (6), each with hard rules

### P1. One job per view, one primary action
- **Exactly one primary (solid) button per view.** A drawer or modal is its own view with its own single primary.
- Two to four secondary actions may be visible. Anything more goes into the `⋯` overflow menu.
- Destructive actions (delete, disconnect, cancel order) live **only** in an overflow menu or in a confirmation modal. They never sit next to the primary.
- One sync concept per screen. Each listings page has a single `SyncButton` with a split menu: "Sync changes (7)" and "Pull from Etsy".

### P2. Calm density
- Default table row height is **44px**, and density toggles between 36 (compact) and 52 (comfortable). The body text in tables is 13px.
- Color carries **meaning only**: status, money direction or a score band. No decorative gradients anywhere, no rainbow KPI tiles and no colored hero banners.
- Surfaces are flat: a white background with a 1px `--kx-border` line. Shadows appear only on floating layers (menus, panels, modals, toasts).
- List pages fill the width up to 1600px. Forms and settings stop at 880px. Input fields stop at 480px.

### P3. Keyboard first, mouse friendly
- Every list page supports `/` for search, `j`/`k` to move between rows, `x` to select a row, `Enter` to open the side panel and `Esc` to close it.
- Every side panel supports `⌘/Ctrl+Enter` to run its primary action and `⌘/Ctrl+S` to save a draft.
- `⌘K` opens the command palette everywhere. `?` opens the shortcut sheet. `g o` goes to Orders, `g l` to Listings, `g m` to Messages and `g r` to Reports.
- Every icon-only button has an `aria-label` and a tooltip that shows its shortcut (`<Kbd>`).
- Shortcuts match on `KeyboardEvent.key`, not `code`, so they work on Turkish Q and F layouts.

### P4. Edit in place, never lose context
- Selecting a row opens a **side panel**. The list stays visible and keeps its scroll position and selection. Arrow keys move to the next or previous record while the panel stays open.
- Full pages are used only for the listing editor and the bulk editor. Both keep a "Back to list" link and preserve filters in the URL.
- Modals are reserved for confirmations and short forms of four fields or fewer.
- All filters, sorts, the search query and the selected record live in the URL query, so views are shareable and survive a reload.

### P5. One language, one format
- Every user-facing string goes through `next-intl`. A lint rule (`no-literal-string` in JSX under `pages/app/**` and `components/**`) fails CI on any hard-coded string.
- **No `text-transform: uppercase` anywhere.** Section labels use sentence case at 12px/600. Turkish casing goes through `toLocaleUpperCase(locale)` only when unavoidable.
- Money, numbers and dates go **only** through `<Money>`, `<Num>` and `<DateText>`, which wrap `Intl` (section 3.13). Calling `toFixed` in JSX is a lint error.
- Marketplace text is decoded at the mapper boundary: HTML entities are decoded on ingest and never re-encoded on push. The UI never shows `&#39;`.
- AI listing content stays in the marketplace language: tags and titles in English for Etsy, Amazon and eBay. Only AI commentary and tips follow the UI locale.

### P6. Honest data
- No number appears without a source and a time. KPI tiles show "as of 10:42 · Etsy + eBay".
- When data is implausible (a sample under the minimum n, or an outlier beyond 3σ) or stale, the UI shows `—` with a reason tooltip instead of a fake-precise value.
- Every async surface has exactly four states: skeleton, data, empty and error. A spinner that never ends is a bug: each state has a timeout of 20s and then shows `ErrorState` with a retry.
- A button that cannot do anything is not rendered. Disabled buttons always explain why in a tooltip.

---

## 2. Tokens

### 2.1 Color

**Neutral scale ("slate-cool").** These are the only greys in the product.

| Token | Hex | Use |
|---|---|---|
| `neutral-0` | `#FFFFFF` | panels, tables, cards |
| `neutral-25` | `#FAFBFC` | page background |
| `neutral-50` | `#F4F6F8` | row hover, input disabled bg, sidebar bg |
| `neutral-100` | `#EBEEF2` | selected-row bg (with accent bar), skeleton base |
| `neutral-200` | `#DDE2E8` | **default border**, dividers |
| `neutral-300` | `#C5CCD5` | input border, strong divider |
| `neutral-400` | `#9AA4B1` | placeholder, disabled text |
| `neutral-500` | `#6B7685` | secondary text, icons |
| `neutral-600` | `#4D5766` | body text in dense tables |
| `neutral-700` | `#363E4A` | strong secondary text |
| `neutral-800` | `#232932` | primary text |
| `neutral-900` | `#14181F` | headings, primary button in dark contexts |

**Brand accent (one).** Indigo-blue. It is a single hue, used for the primary button, links, focus ring, selection and the active nav item.

| Token | Hex |
|---|---|
| `accent-50` | `#EEF3FF` |
| `accent-100` | `#DCE6FF` |
| `accent-500` | `#3B6CF6` |
| `accent-600` | `#2556E8` (**primary**, AA on white: 5.0:1) |
| `accent-700` | `#1C44BD` (hover/pressed) |
| `focus-ring` | `0 0 0 3px rgb(37 86 232 / 0.28)` |

There is no secondary brand color. **Purple is removed** (`secondary.main #7c3aed` goes away, along with every `.gradient-text`, `.btn-primary` gradient and research hero).

**Semantic colors.** Each has a "soft" background, a "fg" text color and a "solid" color for dots, bars and the danger button.

| Role | soft bg | fg (text) | solid |
|---|---|---|---|
| success | `#E8F6EE` | `#146C3A` | `#1F9D55` |
| warning | `#FFF4E0` | `#8A5300` | `#E08A00` |
| danger | `#FDECEC` | `#A61B1B` | `#D92D2D` |
| info | `#E9F2FD` | `#1D4F91` | `#2F7FD8` |
| neutral | `#F1F3F6` | `#4D5766` | `#9AA4B1` |

**Marketplace and carrier brand colors.** These are used **only** inside `<MarketplaceLogo>` tiles (as the background of the monogram fallback or the logo's own fill). They are never used for buttons, charts, text or borders. Charts use the data palette below.

| Key | Hex | Key | Hex |
|---|---|---|---|
| etsy | `#F1641E` | fedex | `#4D148C` |
| ebay | `#0064D2` | ups | `#351C15` |
| amazon | `#FF9900` | dhl | `#FFCC00` |
| shopify | `#95BF47` | veeqo | `#2A2E3B` |
| wix | `#0C6EFC` | shippo | `#1B9C85` |
| trendyol | `#F27A1A` | parasut | `#00A1E4` |
| hepsiburada | `#FF6000` | n11 | `#6E2C91` |

**Chart and data palette.** This is a categorical series, in order, used in charts only: `#2556E8, #13A3A0, #E08A00, #8C5BD8, #D9467A, #6B7685`. Money direction uses `success.fg` for positive and `danger.fg` for negative, as text color only and never as tile backgrounds.

### 2.2 Typography

- **Family:** Inter, loaded via `next/font/google` with `subsets: ['latin', 'latin-ext']` (latin-ext supplies the Turkish ğ ş ı İ). Use `display: 'swap'` and expose it as the variable `--font-sans`. This replaces the CSS `@import` of Google Fonts in `globals.css`.
- **Mono:** `ui-monospace, "SF Mono", Menlo, monospace`, for order numbers, SKUs, tracking numbers and IDs.
- **Numbers:** `font-variant-numeric: tabular-nums` is on by default in tables, `<Money>`, `<Num>` and KPI tiles.
- **Weights:** 400 regular, 500 medium, 600 semibold. **No 700/800** (that removes the heavy "admin template" feel).

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 28 / 36 | 600 | -0.02em | KPI values on Overview only |
| `title-lg` | 20 / 28 | 600 | -0.015em | Page title (PageHeader) |
| `title-md` | 16 / 24 | 600 | -0.01em | Panel title, section heading |
| `title-sm` | 14 / 20 | 600 | 0 | Card title, table group header |
| `body` | 14 / 20 | 400 | 0 | Forms, paragraphs |
| `body-dense` | 13 / 18 | 400 | 0 | Table cells, list rows |
| `label` | 13 / 18 | 500 | 0 | Field labels, buttons md |
| `caption` | 12 / 16 | 400 | 0 | Helper text, meta, timestamps |
| `micro` | 11 / 14 | 500 | 0.01em | Pills, counters, kbd |

The MUI `h1..h6` variants are remapped to these tokens, and the app uses only the semantic names (`variant="titleLg"`, etc.).

### 2.3 Spacing (4px base)

`0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Tailwind `--spacing: 4px`, so `p-3` is 12px. MUI `spacing: 4`, so `sx={{ p: 3 }}` is 12px.

Fixed usages:
- Page gutter: 24 desktop, 16 mobile.
- PageHeader to content: 16.
- Toolbar gap: 8.
- Card and panel padding: 16. Panel sections: 20 vertical.
- Form field vertical rhythm: 16 between fields, 24 between groups.
- Table cell padding: 12 horizontal, density-driven vertical.

### 2.4 Radii

| Token | px | Use |
|---|---|---|
| `radius-xs` | 4 | kbd, checkbox, tiny tags |
| `radius-sm` | 6 | inputs, buttons, pills (pills use full) |
| `radius-md` | 8 | cards, menus, logo tiles, thumbnails |
| `radius-lg` | 12 | modals, side panels (outer edge only), bottom sheets (top corners) |
| `radius-full` | 9999 | StatusPill, avatar, toggles |

The theme's `borderRadius: 12` on everything goes away. Buttons and inputs drop to 6px, which reads as a modern tool rather than a "bubbly template".

### 2.5 Borders
- `border` is 1px `neutral-200`. It is the default for every surface and divider.
- `border-strong` is 1px `neutral-300`. It is used for inputs, outlined buttons and table header bottoms.
- `border-focus` is 1px `accent-600` plus the `focus-ring`.
- Selected rows get a 2px `accent-600` inset bar on the left edge and a `neutral-100` background.
- **Never draw a border and a shadow together on a flat surface.** This fixes the current `MuiPaper` default.

### 2.6 Elevation (floating layers only)

| Token | Value | Use |
|---|---|---|
| `shadow-0` | none | all in-flow surfaces |
| `shadow-1` | `0 1px 2px rgb(20 24 31 / .06)` | sticky table header when scrolled, sticky footer |
| `shadow-2` | `0 4px 12px rgb(20 24 31 / .08), 0 1px 3px rgb(20 24 31 / .06)` | menus, popovers, autocomplete, date picker |
| `shadow-3` | `0 12px 32px rgb(20 24 31 / .12), 0 2px 6px rgb(20 24 31 / .06)` | side panel, toasts |
| `shadow-4` | `0 24px 64px rgb(20 24 31 / .18)` | modal, command palette |

MUI's 25-step `shadows` array maps onto these values: index 0 is `shadow-0`, 1 is `shadow-1`, 2 to 4 are `shadow-2`, 5 to 12 are `shadow-3` and 13 to 24 are `shadow-4`.

Backdrops are `rgb(20 24 31 / .32)` with no blur. `.glass` is deleted.

### 2.7 Z-index layers

MUI's own popovers render through `Modal` with `theme.zIndex.modal`, so the scale is set in the theme and the menus are pushed above dialogs explicitly. This follows the founder's rule that nested MUI Select, Autocomplete and Dialog layers sit at 1500 to 1600.

| Layer | z | MUI mapping |
|---|---|---|
| base / sticky table header | 2 | — |
| sticky toolbar / bulk action bar | 20 | — |
| mobile bottom tab bar | 1050 | `mobileStepper` |
| app bar / top bar | 1100 | `appBar` |
| sidebar | 1150 | `speedDial` (unused, repurposed) |
| side panel (Drawer) | 1200 | `drawer` |
| **Modal / Dialog** | **1500** | `modal: 1500` |
| **Nested dialog** (confirm-in-drawer, confirm-in-modal) | **1550** | `MuiDialog` prop `sx={{ zIndex: 1550 }}` via `<Modal nested>` |
| **Menus, Select, Autocomplete popper, Popover, DatePicker** | **1600** | `MuiPopover`, `MuiMenu`, `MuiPopper`, `MuiAutocomplete.popper` root `zIndex: 1600` |
| command palette | 1650 | — |
| toast / snackbar | 1700 | `snackbar: 1700` |
| tooltip | 1800 | `tooltip: 1800` |

### 2.8 Motion

| Token | ms | Easing | Use |
|---|---|---|---|
| `motion-instant` | 80 | linear | hover background, checkbox |
| `motion-fast` | 140 | `cubic-bezier(.2,0,0,1)` | menus, tooltips, pill changes |
| `motion-base` | 200 | `cubic-bezier(.2,0,0,1)` | side panel slide-in, tab underline |
| `motion-slow` | 280 | `cubic-bezier(.2,0,0,1)` | bottom sheet, modal |

Motion rules:
- No `translateY` on hover.
- No bounce.
- `prefers-reduced-motion` sets every duration to 0 except opacity, which is 80ms.
- Skeleton shimmer is 1.4s linear and disabled under reduced motion.

### 2.9 Dark mode (optional, phase 2)
Tokens are CSS variables, so dark mode is a variable swap under `[data-theme="dark"]`. The values are `neutral-0` → `#14181F`, the page → `#0E1116`, borders → `#2A313C`, text → `#E7EAF0` and the accent → `#5B86FF`. MUI reads the same variables through `cssVariables` once core is on v6+. **Do not ship dark mode before every page is on `ds/*`.** Half-migrated dark mode exposes every hard-coded hex.

### 2.10 Tailwind v4 `@theme` block (`styles/tokens.css`)

```css
/* styles/tokens.css — single source of truth; imported first in globals.css */
@theme {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;

  --spacing: 4px;

  /* neutrals */
  --color-neutral-0: #FFFFFF;   --color-neutral-25: #FAFBFC;  --color-neutral-50: #F4F6F8;
  --color-neutral-100: #EBEEF2; --color-neutral-200: #DDE2E8; --color-neutral-300: #C5CCD5;
  --color-neutral-400: #9AA4B1; --color-neutral-500: #6B7685; --color-neutral-600: #4D5766;
  --color-neutral-700: #363E4A; --color-neutral-800: #232932; --color-neutral-900: #14181F;

  /* accent */
  --color-accent-50: #EEF3FF; --color-accent-100: #DCE6FF; --color-accent-500: #3B6CF6;
  --color-accent-600: #2556E8; --color-accent-700: #1C44BD;

  /* semantic */
  --color-success-soft: #E8F6EE; --color-success-fg: #146C3A; --color-success: #1F9D55;
  --color-warning-soft: #FFF4E0; --color-warning-fg: #8A5300; --color-warning: #E08A00;
  --color-danger-soft:  #FDECEC; --color-danger-fg:  #A61B1B; --color-danger:  #D92D2D;
  --color-info-soft:    #E9F2FD; --color-info-fg:    #1D4F91; --color-info:    #2F7FD8;

  /* type scale: --text-*  with paired line-height */
  --text-display: 28px;  --text-display--line-height: 36px;
  --text-title-lg: 20px; --text-title-lg--line-height: 28px;
  --text-title-md: 16px; --text-title-md--line-height: 24px;
  --text-title-sm: 14px; --text-title-sm--line-height: 20px;
  --text-body: 14px;     --text-body--line-height: 20px;
  --text-dense: 13px;    --text-dense--line-height: 18px;
  --text-caption: 12px;  --text-caption--line-height: 16px;
  --text-micro: 11px;    --text-micro--line-height: 14px;

  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;

  --shadow-1: 0 1px 2px rgb(20 24 31 / .06);
  --shadow-2: 0 4px 12px rgb(20 24 31 / .08), 0 1px 3px rgb(20 24 31 / .06);
  --shadow-3: 0 12px 32px rgb(20 24 31 / .12), 0 2px 6px rgb(20 24 31 / .06);
  --shadow-4: 0 24px 64px rgb(20 24 31 / .18);

  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --breakpoint-sm: 600px; --breakpoint-md: 900px; --breakpoint-lg: 1200px; --breakpoint-xl: 1536px;
}

:root {
  --kx-sidebar-w: 240px;
  --kx-sidebar-w-collapsed: 64px;
  --kx-topbar-h: 52px;
  --kx-bottom-nav: 0px;           /* set by MobileTabBar, keep */
  --kx-content-max-list: 1600px;
  --kx-content-max-form: 880px;
  --kx-field-max: 480px;
  --kx-control-h: 40px;           /* inputs + md buttons */
  --kx-control-h-sm: 32px;
  --kx-row-h: 44px;               /* density: 36 / 44 / 52 */
  --z-sticky: 20; --z-drawer: 1200; --z-modal: 1500; --z-modal-nested: 1550;
  --z-popover: 1600; --z-palette: 1650; --z-toast: 1700; --z-tooltip: 1800;
}

/* bans, enforced globally */
* { text-transform: none !important; }   /* kills FAİLED / RECEİVED, MUI button uppercase */
body { background: var(--color-neutral-25); color: var(--color-neutral-800); font-family: var(--font-sans); }
.tnum { font-variant-numeric: tabular-nums; }
```

Delete `tailwind.config.js`'s `theme.extend`, because Tailwind v4 reads `@theme`. Keep the file only if a plugin needs it. Delete these from `globals.css`: `.glass`, `.gradient-text`, `.card-premium*`, `.btn-primary` and the old `:root` z-index scale.

### 2.11 MUI `createTheme` skeleton (`lib/theme.tsx`)

```ts
import { createTheme, alpha } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';

const c = {
  n0: '#FFFFFF', n25: '#FAFBFC', n50: '#F4F6F8', n100: '#EBEEF2', n200: '#DDE2E8', n300: '#C5CCD5',
  n400: '#9AA4B1', n500: '#6B7685', n600: '#4D5766', n700: '#363E4A', n800: '#232932', n900: '#14181F',
  accent: '#2556E8', accentHover: '#1C44BD', accentSoft: '#EEF3FF',
};
const shadow = {
  s1: '0 1px 2px rgb(20 24 31 / .06)',
  s2: '0 4px 12px rgb(20 24 31 / .08), 0 1px 3px rgb(20 24 31 / .06)',
  s3: '0 12px 32px rgb(20 24 31 / .12), 0 2px 6px rgb(20 24 31 / .06)',
  s4: '0 24px 64px rgb(20 24 31 / .18)',
};

declare module '@mui/material/styles' {
  interface TypographyVariants { display: React.CSSProperties; titleLg: React.CSSProperties; titleMd: React.CSSProperties;
    titleSm: React.CSSProperties; dense: React.CSSProperties; label: React.CSSProperties; micro: React.CSSProperties; }
  interface TypographyVariantsOptions { display?: React.CSSProperties; titleLg?: React.CSSProperties; titleMd?: React.CSSProperties;
    titleSm?: React.CSSProperties; dense?: React.CSSProperties; label?: React.CSSProperties; micro?: React.CSSProperties; }
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides { display: true; titleLg: true; titleMd: true; titleSm: true; dense: true; label: true; micro: true;
    h1: false; h2: false; h3: false; h4: false; h5: false; h6: false; overline: false; }
}
declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides { ghost: true; }
}

export const theme = createTheme({
  spacing: 4,
  shape: { borderRadius: 6 },
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
  zIndex: { mobileStepper: 1050, appBar: 1100, speedDial: 1150, drawer: 1200, modal: 1500, snackbar: 1700, tooltip: 1800 },
  palette: {
    mode: 'light',
    primary:   { main: c.accent, dark: c.accentHover, light: '#3B6CF6', contrastText: '#fff' },
    secondary: { main: c.n800, contrastText: '#fff' },            // NOT purple; used for neutral solid only
    success:   { main: '#1F9D55', dark: '#146C3A', light: '#E8F6EE' },
    warning:   { main: '#E08A00', dark: '#8A5300', light: '#FFF4E0' },
    error:     { main: '#D92D2D', dark: '#A61B1B', light: '#FDECEC' },
    info:      { main: '#2F7FD8', dark: '#1D4F91', light: '#E9F2FD' },
    grey: { 50: c.n50, 100: c.n100, 200: c.n200, 300: c.n300, 400: c.n400, 500: c.n500, 600: c.n600, 700: c.n700, 800: c.n800, 900: c.n900 },
    text: { primary: c.n800, secondary: c.n500, disabled: c.n400 },
    divider: c.n200,
    background: { default: c.n25, paper: c.n0 },
    action: { hover: c.n50, selected: c.n100, focus: alpha(c.accent, .12) },
  },
  typography: {
    fontFamily: 'var(--font-sans)',
    fontSize: 14,
    fontWeightRegular: 400, fontWeightMedium: 500, fontWeightBold: 600,
    display: { fontSize: 28, lineHeight: '36px', fontWeight: 600, letterSpacing: '-0.02em' },
    titleLg: { fontSize: 20, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.015em' },
    titleMd: { fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.01em' },
    titleSm: { fontSize: 14, lineHeight: '20px', fontWeight: 600 },
    body1:   { fontSize: 14, lineHeight: '20px' },
    body2:   { fontSize: 13, lineHeight: '18px' },
    dense:   { fontSize: 13, lineHeight: '18px' },
    label:   { fontSize: 13, lineHeight: '18px', fontWeight: 500 },
    caption: { fontSize: 12, lineHeight: '16px', color: c.n500 },
    micro:   { fontSize: 11, lineHeight: '14px', fontWeight: 500 },
    button:  { fontSize: 13, fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
  },
  shadows: ['none', shadow.s1, shadow.s2, shadow.s2, shadow.s2, ...Array(8).fill(shadow.s3), ...Array(12).fill(shadow.s4)] as any,
  transitions: { duration: { shortest: 80, shorter: 140, short: 140, standard: 200, complex: 280, enteringScreen: 200, leavingScreen: 140 },
                 easing: { easeInOut: 'cubic-bezier(.2,0,0,1)', easeOut: 'cubic-bezier(.2,0,0,1)' } },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { backgroundColor: c.n25 }, '*': { textTransform: 'none' } } },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'medium' },
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 500, boxShadow: 'none', gap: 6, '&:focus-visible': { boxShadow: `0 0 0 3px ${alpha(c.accent, .28)}` } },
        sizeSmall: { height: 32, padding: '0 10px', fontSize: 13 },
        sizeMedium: { height: 40, padding: '0 14px' },
        sizeLarge: { height: 44, padding: '0 18px', fontSize: 14 },        // mobile primary
        contained: { background: c.accent, '&:hover': { background: c.accentHover, boxShadow: 'none' } }, // NO gradient
        containedError: { background: '#D92D2D', '&:hover': { background: '#A61B1B' } },
        outlined: { borderColor: c.n300, color: c.n800, background: c.n0, '&:hover': { background: c.n50, borderColor: c.n300 } },
        text: { color: c.n700, '&:hover': { background: c.n50 } },
      },
      variants: [{ props: { variant: 'ghost' }, style: { color: c.n700, '&:hover': { background: c.n50 } } }],
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 6, color: c.n500, '&:hover': { background: c.n50, color: c.n800 } },
                                       sizeSmall: { width: 32, height: 32 }, sizeMedium: { width: 40, height: 40 } } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' },
      outlined: { borderColor: c.n200 }, elevation0: { border: `1px solid ${c.n200}` } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 8 } } },
    MuiInputLabel: { defaultProps: { shrink: true } },                    // labels rendered ABOVE by ds/Field; no floating
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined', fullWidth: true } },
    MuiOutlinedInput: { styleOverrides: {
      root: { minHeight: 40, borderRadius: 6, background: c.n0, fontSize: 14,
        '& .MuiOutlinedInput-notchedOutline': { borderColor: c.n300, top: 0, '& legend': { display: 'none' } },
        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: c.n400 },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: c.accent, borderWidth: 1 },
        '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(c.accent, .2)}` } },
      inputSizeSmall: { padding: '9px 12px' } } },
    MuiSelect: { defaultProps: { size: 'small', MenuProps: { sx: { zIndex: 1600 } } } },
    MuiPopover: { styleOverrides: { root: { zIndex: 1600 }, paper: { boxShadow: shadow.s2, border: `1px solid ${c.n200}`, borderRadius: 8 } } },
    MuiMenu: { styleOverrides: { root: { zIndex: 1600 } } },
    MuiPopper: { styleOverrides: { root: { zIndex: 1600 } } },
    MuiAutocomplete: { defaultProps: { size: 'small' }, styleOverrides: { popper: { zIndex: 1600 }, paper: { boxShadow: shadow.s2 } } },
    MuiMenuItem: { styleOverrides: { root: { minHeight: 36, fontSize: 14, borderRadius: 4, margin: '0 4px' } } },
    MuiTooltip: { defaultProps: { arrow: false, enterDelay: 400 }, styleOverrides: { tooltip: { background: c.n900, fontSize: 12, borderRadius: 4, padding: '4px 8px' } } },
    MuiDialog: { styleOverrides: { root: { zIndex: 1500 }, paper: { borderRadius: 12, boxShadow: shadow.s4, border: 'none' } } },
    MuiDrawer: { styleOverrides: { paper: { boxShadow: shadow.s3, border: 'none' } } },
    MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgb(20 24 31 / .32)' } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 40 }, indicator: { height: 2, background: c.accent } } },
    MuiTab: { styleOverrides: { root: { minHeight: 40, padding: '0 12px', fontSize: 13, fontWeight: 500, color: c.n500, '&.Mui-selected': { color: c.n900 } } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 9999, height: 24, fontSize: 12 } } },
    MuiSnackbar: { defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } } },
    MuiDataGrid: { defaultProps: { density: 'standard', rowHeight: 44, columnHeaderHeight: 40, disableRowSelectionOnClick: true },
      styleOverrides: { root: { border: `1px solid ${c.n200}`, borderRadius: 8, fontSize: 13, '--DataGrid-rowBorderColor': c.n200 },
        columnHeaders: { background: c.n25 }, columnHeaderTitle: { fontWeight: 500, color: c.n500, fontSize: 12 },
        row: { '&:hover': { background: c.n50 }, '&.Mui-selected': { background: c.n100, boxShadow: `inset 2px 0 0 ${c.accent}` } },
        cell: { '&:focus, &:focus-within': { outline: `2px solid ${c.accent}`, outlineOffset: -2 } } } },
  },
});
export default theme;
```

`pages/_app` must also do two things:
- Load Inter with `next/font/google` (`variable: '--font-inter'`) and put the variable class on `<html>`.
- Have `_document` set `lang={locale}`, not a hard-coded `"tr"`.

---

## 3. Layout and patterns

### 3.1 AppShell (`ds/AppShell`)

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ ▣ Kolay    │ Breadcrumb / context            ⌘K Search…   🔔  (avatar)   │ ← TopBar 52px, no page title here
│            ├──────────────────────────────────────────────────────────────┤
│ Overview   │                                                              │
│ Orders  12 │   PageHeader                                                 │
│ Messages 3 │   Toolbar                                                    │
│ ─ Listings │   Content (max-width per page type)                          │
│ [E] Etsy   │                                                              │
│ [e] eBay   │                                                              │
│ [T] Trendyol                                                              │
│ [S] Shopify│                                                              │
│ [W] Wix    │                                                              │
│ + Connect  │                                                              │
│ ─ Research │                                                              │
│ ─ Money    │                                                              │
│ Settings • │                                                              │
│ « collapse │                                                              │
└────────────┴──────────────────────────────────────────────────────────────┘
```

**Sidebar**
- It is 240px expanded and 64px collapsed. The collapsed state is persisted in `localStorage` and toggled with `[`.
- The background is `neutral-50` with a 1px right border.
- Items are 32px tall, 13px/500 and have a 6px radius. A 16px lucide icon sits on the left; for marketplaces, a 20px `<MarketplaceLogo size="xs">` takes its place.
- The **active** item gets a `neutral-0` background, `neutral-900` text and the `shadow-1` hairline. It does not get a blue pill, so selection looks the same everywhere.
- Counters are right-aligned `micro` tabular numbers: orders to ship and unread messages. They use neutral text and turn `danger-fg` only when overdue.
- **Each marketplace item uses its real logo** (`MarketplaceLogo`), never a generic cube. Collapsed, every item keeps its logo or icon plus a tooltip with the label and shortcut. **No two items may share an icon** (this is unit-tested over the nav config).
- Groups, matching phase-3 navigation:
  - Overview, Orders, Messages.
  - **Listings**, one row per connected marketplace plus "Connect a store".
  - **Research**, which becomes a single entry, "Research", with marketplace as a filter inside the page (see section 5).
  - **Money** (Reports, Financials).
  - Settings with a reauth dot, then Help.
- Group labels are 12px/500 in `neutral-500`, in sentence case.
- The footer holds a plan and usage meter (Stripe-style) and the collapse toggle.

**TopBar**
- It is 52px tall with a white background and a bottom border.
- It holds breadcrumbs (e.g. "Listings / Etsy / BelleCoutureGifts"), the global `⌘K` search trigger, a notifications bell and the account menu.
- It **never shows the page title** (the PageHeader owns that) and never adds a "- KolayXport" suffix. `<title>` is "Orders · KolayXport".

**Mobile (< 900px)**
- The sidebar becomes a `MobileTabBar` bottom bar of 56px plus the safe area: Overview, Orders, Listings, Messages, More.
- "More" opens a bottom sheet with the remaining nav.
- The TopBar becomes 48px with the title of the current page (the only case where the bar shows a title) and a back chevron on drill-in.
- Keep `--kx-bottom-nav`.

### 3.2 Page template (`ds/Page`, `ds/PageHeader`)

```
PageHeader
  [title-lg Title]  [count pill]                        [secondary] [secondary] [⋯]  [Primary]
  caption subtitle (≤ 1 line, optional)  ·  "Updated 2m ago"
Toolbar (sticky under TopBar on scroll)
Content
```

**PageHeader**
- The title is required and comes from i18n. The subtitle is optional and limited to one line.
- `primaryAction` holds at most 1, `secondaryActions` at most 2 visible, and `overflowActions` takes the rest.
- On mobile, the primary becomes a full-width button below the title, or a FAB on list pages. The secondary actions collapse into `⋯`.

**Max content width by page type** (`<Page width="list|detail|form|reading">`)

| Type | Max width | Pages |
|---|---|---|
| `list` | 1600px, left-aligned, full width below that | Orders, Listings (all), Messages, Research results, Reports tables |
| `detail` | 1280px | Overview, Financials, listing editor (form + preview split) |
| `form` | 880px (settings: 220 nav + 880 content) | Settings, Sender profile, Add manual order (if full page), Billing |
| `reading` | 720px | Help, guides |

Inputs never exceed `--kx-field-max` (480px), except for description and long-text areas, which may reach 720px.

### 3.3 Toolbar / FilterBar (`ds/Toolbar`)

```
[⌕ Search orders, SKU, buyer…  /]  [Store ▾] [Status ▾] [📅 Last 30 days ▾]  [Filters • 2]   ·  View: [To ship ▾]   [≡ density] [⟳]
Active chips: Store: Etsy ✕  Ship by: Today ✕   Clear all                                        142 results
```

Rules:
- **One row on desktop.** It contains search, at most 3 visible filters, a "Filters" button that opens a right `FiltersSheet` for everything else, saved views, density and refresh.
- All controls are **32px** (`size="sm"`), the same height across the row. Filter triggers are `FilterButton`s (outlined, label plus value, `▾`), not MUI floating-label selects. An empty value reads "Status: All".
- **Saved views** (`SavedViews`) replace the segmented "ALL/UNLABELED/RECEIVED/FAILED" control. They are a dropdown of named filter sets. Built-in views:
  - Orders: To ship, Overdue, Label created, Shipped, Problems, All.
  - Listings: All, Pending changes, Sync failed, Low score, Sold out, Inactive.
  
  Users can save their own. The selected view is in the URL.
- Active filters appear as removable chips beneath the row, with "Clear all". There is no separate "Reset" button.
- **Date range: always `DateRangeField`.** Presets (Today, Yesterday, Last 7, Last 30, This month, Last month, Custom) sit in a popover with a two-month `DateCalendar`, and the result reads "1 Oct – 14 Oct 2026". **Native `<input type="date">` is banned** by a lint rule.
- The result count is right-aligned and tabular, e.g. "142 results".
- When rows are selected, the Toolbar is **replaced in place** by `BulkActionBar`: "12 selected · Create labels · Print · Mark shipped · ⋯ · Clear (Esc)". Its height matches the toolbar, so nothing jumps.
- Mobile: search takes the full width, and a "Filters (2)" button opens a bottom sheet. Saved views become horizontally scrollable chips. The date range picker opens as a bottom sheet holding the presets plus one month.

### 3.4 DataTable → cards on mobile (`ds/DataTable`)

**Desktop** is MUI DataGrid (v8 Community) wrapped by `ds/DataTable`. There is one wrapper for all marketplaces.
- The first column is a checkbox, the second is a **48×48 thumbnail** (`ProductThumb`, radius 6, 1px border, lazy-loaded, with a hover preview at 240px). Then come the primary text (title, 2 lines max) and a mono meta line (SKU · ID).
- Numbers are right-aligned and tabular. Money uses `<Money>`, dates use `<DateText>` and statuses use `<StatusPill>`.
- Row actions: a **single** `⋯` per row that appears on hover or focus. The most common action may show as one inline icon button (e.g. "Create label" on orders). **There are no red trash icons in rows.**
- The header is sticky and becomes `shadow-1` when scrolled. Columns can be resized, reordered and hidden through a "Columns" menu, and the result is persisted per view.
- Rows virtualize past 100. Server pagination uses a page size of 50/100/250 and a footer reading "1–50 of 1,284".
- Keyboard: `j`/`k` or the arrow keys move focus, `x` toggles selection, `Shift+x` selects a range, `Enter` opens the side panel and `e` opens the full editor (listings).

**Mobile (< 900px)** uses `DataTable` `mobileCard` render props. The grid is **not** used on mobile.
```
┌──────────────────────────────────────────┐
│ [img]  Personalized Baby Blanket…      ⋯ │
│ 64×64  #3891 · Etsy [E]                  │
│        $169.99      ● To ship · Ships Thu│
│ ▸ (tap to expand: items, address, actions)│
└──────────────────────────────────────────┘
```
- The card is a white surface with a 1px border, 8px radius and 12px padding, with 8px between cards. There is one primary inline action per card at most, and everything else goes in `⋯`.
- Selection uses a long press or the "Select" header button, which reveals checkboxes and a bottom `BulkActionBar` above the tab bar.
- Pull to refresh is supported. Infinite scroll appears with a "Load more" fallback.

### 3.5 Detail side panel (`ds/SidePanel`)

```
┌──────────────────────────────────────────── 560px (sm 480 / lg 720 / xl 960) ─┐
│ [Logo] Title (title-md, 1 line)          ● Status     ‹ ›   ⋯   ✕            │ header 56px, sticky
│ caption meta: #3891 · Etsy · Ordered 14 Oct                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Section title                                                     action link │
│ content…                                                                     │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Section title                                                                 │
│ content…                                                     (scrolls)        │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⋯ More          Unsaved changes · Draft saved 10:42      [Secondary] [Primary]│ footer 64px, sticky
└──────────────────────────────────────────────────────────────────────────────┘
```

**Header**
- It shows a logo or thumbnail, the title, a `StatusPill`, prev/next arrows (`‹ ›`, which also respond to `j`/`k`), `⋯` and close (`Esc`).

**Body**
- The body holds `SidePanelSection`s with a title and an optional right link. Sections are divided by a 1px line, not a card per section.
- No tabs unless there are more than 5 sections. Then a sticky anchor nav appears instead (pills that scroll to the section).

**Footer**
- One primary and one secondary sit on the right, with `⋯` on the left for the rest, destructive actions last and in red.
- A save-state text appears in the middle: "Draft saved", "Unsaved changes" or "Synced to Etsy 2m ago".

**Behavior**
- The panel is non-modal on desktop ≥ 1200: the list stays interactive and the panel pushes the content or overlays the right side.
- Below 1200 it overlays with a backdrop.
- On mobile it is a full-screen sheet with a sticky header and footer.
- A dirty panel asks "Discard changes?" through a nested `ConfirmDialog` (z 1550) before it closes or moves to the next record.

### 3.6 Modal (`ds/Modal`)

Modals are **only** for confirmations, short forms (≤ 4 fields) and pickers.
- Width is 440 (sm) or 560 (md). Padding is 20. The title is `title-md`, the body is `body`, and the footer is right-aligned with Cancel (secondary) and Confirm (primary, or danger for destructive actions).
- A destructive confirm names the object: "Delete listing 'Baby Blanket'?" When the action cannot be undone, the user must type the shop or listing name for bulk actions on more than 10 items.
- Never use a modal for anything with tabs, scroll or more than 4 fields. That is a `SidePanel` or a page. This moves Add Manual Order into a SidePanel.
- `<Modal nested>` sets z 1550 automatically when the modal is opened from inside a Drawer or Dialog.

### 3.7 Form fields (`ds/Field` + inputs)

- **The label sits above** the control: 13px/500, `neutral-800`, 6px gap. Floating labels are never used.
- An optional "(optional)" suffix appears in the label in `neutral-500`. Required fields get no asterisk; the optional ones are marked instead.
- **The control is 40px** (`size="md"`) on desktop. On mobile it is 44px with a font-size of 16px, which prevents iOS zoom. Toolbar controls are 32px.
- Helper text is 12px `neutral-500` below the control, and the error text replaces it in `danger-fg` with a 14px alert icon.
- **Inline validation**: it runs on blur and on submit, then re-validates on change once the field has shown an error. The submit button stays enabled; on click it scrolls to and focuses the first error.
- Character counters (`CharCount`) sit right-aligned in the label row: "112 / 140". They turn warning at 90% and danger above 100%. This applies to Etsy titles, tags and alt text.
- Layout:
  - A single column at max 480px.
  - Two-column pairs only for City/Postal code, Key/Secret, Weight/Unit, Price/Quantity and Length/Width/Height (a 3-up).
  - Groups are separated by a `title-sm` heading and a 24px gap.
- Country, currency and phone fields are always pickers (`CountrySelect` with flag and ISO, `CurrencySelect`, `PhoneInput` with country code). Free-text "TR" is never accepted.
- Long text uses an auto-growing `TextArea` with a minimum of 4 rows and a maximum of 24, and no inner scroll below the maximum. Descriptions get a "Preview" toggle that renders as the marketplace does.
- Tags use `TagInput`: paste comma-separated values, each chip shows its own 20-character counter, duplicates are rejected inline, and words that overlap the title are flagged.

### 3.8 Buttons (`ds/Button`)

| Variant | Look | When |
|---|---|---|
| `primary` | solid `accent-600`, white text | the one main action of the view |
| `secondary` | white bg, 1px `neutral-300`, `neutral-800` text | other visible actions |
| `ghost` | transparent, `neutral-700`, hover `neutral-50` | toolbar actions, "Cancel" in panels, inline links-as-buttons |
| `danger` | solid `danger`, white text | only inside confirmation modals |
| `danger-ghost` | transparent, `danger-fg` | destructive items in menus or footer overflow |

Sizes are `sm` 32, `md` 40 and `lg` 44 (mobile primary and the empty-state CTA).

Rules:
- **Never uppercase, never gradient, never colored shadows, no `translateY` hover.**
- A leading icon is optional (16px). Trailing icons are allowed only for `▾` menus.
- A loading button keeps its width and swaps its label for a spinner plus "Creating label…". It disables only itself.
- The green "New Listing" and green "Sync Data" buttons become `primary` or `secondary` according to P1. **Green is never a button color.**
- `SplitButton` covers a primary with variants ("Create label ▾": FedEx / UPS / DHL eCommerce).
- `IconButton` requires `label` (aria plus tooltip). There are no unlabeled icons (fixes the editor's undo and folder icons).

### 3.9 StatusPill (`ds/StatusPill`): fixed vocabulary

The pill is 20px tall, `micro` 11/14 at 500, with a 6px dot and a soft background. **Only these statuses exist.** Each marketplace status maps into them in `lib/ds/statusMap.ts`, and the raw value appears in the tooltip.

| Domain | Status key → Label (EN / TR) | Tone |
|---|---|---|
| Order | `to_ship` To ship / Gönderilecek | info |
| | `overdue` Overdue / Gecikti | danger |
| | `label_created` Label created / Etiket hazır | accent (neutral pill with accent dot) |
| | `shipped` Shipped / Kargoda | success |
| | `delivered` Delivered / Teslim edildi | success (hollow dot) |
| | `cancelled` Cancelled / İptal | neutral |
| | `refunded` Refunded / İade edildi | neutral |
| | `problem` Problem / Sorun | warning |
| Listing | `active` Active / Aktif | success |
| | `draft` Draft / Taslak | neutral |
| | `inactive` Inactive / Pasif | neutral (hollow) |
| | `sold_out` Sold out / Tükendi | warning |
| | `expired` Expired / Süresi doldu | warning |
| Sync (listing drafts) | `pending` Pending changes / Bekleyen değişiklik | info |
| | `syncing` Syncing / Senkronize ediliyor | info (pulsing dot) |
| | `sync_failed` Sync failed / Senkron hatası | danger |
| | `conflict` Conflict / Çakışma | warning |
| | `synced` Synced / Senkronize | success |
| Connection | `connected` / `needs_reconnect` / `not_connected` / `incomplete` | success / warning / neutral / warning (outline) |

Rules:
- **At most one order pill and one sync pill per row.** "Awaiting Fulfillment + Received" together is not allowed. A label's existence is a column or an icon, not a second status.
- Pills are never clickable buttons. "This order already has a tracking number" becomes the `label_created` pill plus the tracking number as copyable mono text.

### 3.10 Score indicator (`ds/ScoreMeter`): one listing-quality representation

**One 0–100 score for every marketplace**, computed by `lib/listingScore/*` per marketplace from that marketplace's rules. The visual is identical everywhere.

```
Table cell (compact):   ▰▰▰▰▱  78        ← 5-segment bar 40px + number, tabular
Panel / editor (full):  Listing score  78 / 100   Good
                        ▰▰▰▰▰▰▰▰▱▱ ───────────────────
                        ✓ Title 132/140   ✓ 13/13 tags   ✕ Only 4 photos (add 6)   ✕ No video
```

| Band | Range | Color | Label |
|---|---|---|---|
| Poor | 0–49 | `danger` | Needs work / Geliştirilmeli |
| Fair | 50–74 | `warning` | Fair / Orta |
| Good | 75–89 | `success` | Good / İyi |
| Great | 90–100 | `success` | Great / Mükemmel |

- **Letter grades, rings, orange outline boxes and filled squares are removed** from Etsy, eBay, Trendyol and Wix.
- The score is always clickable or hoverable and reveals its checklist. Every failed item links to the field that fixes it, and the editor scrolls there.
- Sorting by score is available on every listings table. The "Low score" saved view is a filter with score < 50.

### 3.11 Thumbnails and imagery (`ds/ProductThumb`, `ds/ImageGrid`)
- Sizes: 32 (dense), 48 (table), 64 (mobile card), 96 (panel header), and an editor grid at 120 square.
- The image uses a 1px `neutral-200` border, 6px radius and `object-fit: cover` on a `neutral-50` background.
- A missing image shows a neutral package glyph, never "-".
- Hover (desktop) or tap opens a 240px preview popover. Clicking an editor tile opens a lightbox with arrow navigation.
- The editor image grid supports drag reorder, sets the first image as the "Primary" badge, shows the alt-text state as an icon, and accepts bulk uploads by dropping onto the grid.

### 3.12 MarketplaceLogo (`ds/MarketplaceLogo`)
- Sizes: xs 16 (inline), sm 20 (nav), md 24 (table), lg 40 (tile).
- The logo is an SVG from `public/logos/{key}.svg` on a white tile with a 1px border and a radius scaled to size.
- The monogram fallback uses the brand color background and white initials. **This is the only place brand colors appear.**
- It always carries an `aria-label` with the marketplace name.

### 3.13 Money, number and date formatting (`lib/format.ts` + `ds/Money`, `ds/Num`, `ds/DateText`)

**Locale** follows the UI language (`next-intl` locale: `tr-TR` or `en-US`). **Currency** follows the data, never the locale.

```ts
fmtMoney(amount, currency, { locale, compact?: boolean, sign?: 'auto'|'always' })
  => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol',
       minimumFractionDigits: compact ? 0 : 2, maximumFractionDigits: compact ? 1 : 2,
       notation: compact ? 'compact' : 'standard', signDisplay: sign }).format(amount)
```

| Value | tr-TR | en-US |
|---|---|---|
| 1070860.03 TRY | ₺1.070.860,03 | ₺1,070,860.03 |
| 169.99 USD | $169,99 | $169.99 |
| 2999 EUR | €2.999,00 | €2,999.00 |
| compact 163700 TRY | ₺163,7 B | ₺163.7K |

Rules:
- Use the **symbol** (narrowSymbol: ₺ $ € £), never the ISO code in cells. When a column mixes currencies, each cell carries its own symbol and the column total is shown per currency ("$4,210 · ₺86.400"), never summed across currencies.
- Converted totals (a KPI tile in a base currency) read "≈ ₺1,2 Mn" with a tooltip giving the FX rate, source and date.
- Show 2 decimals in tables, panels and forms. Compact notation is allowed **only** in KPI tiles and chart axes, always with the full value in the tooltip.
- Use tabular-nums, right alignment and a minus sign for negatives (`signDisplay: 'auto'`). Coloring negatives is optional, as text only.
- `<Num>` uses `Intl.NumberFormat(locale)` with grouping. Percentages use `style: 'percent'` with 1 decimal at most.
- **Dates** come from `<DateText value mode="relative|date|datetime|time" />`:
  - Under 7 days uses relative time (`Intl.RelativeTimeFormat`): "2 h ago" / "2 sa önce". The absolute datetime is in the tooltip.
  - Otherwise the date reads "14 Oct" in the current year or "14 Oct 2025" in another year. In Turkish that is "14 Eki" / "14 Eki 2025".
  - Datetime: "14 Oct, 22:59". Use the 24h clock in TR and 12h in en-US via `hourCycle` from the locale.
  - Ship-by uses `<ShipBy>`: "Ships by Thu 15 Oct". It turns danger when overdue ("Overdue 1 day") and warning when due today. It is shown once, never duplicated as both a relative and an absolute chip.
- Default timezone is the user's shop timezone from settings, falling back to the browser.

### 3.14 Empty, error and loading states
- **Loading:** a skeleton matching the final layout (table rows with a thumb block and text bars, KPI tiles, panel sections). A spinner is allowed only inside buttons and for refreshes under 1s. Skeletons appear after 150ms to avoid a flash.
- **Empty** (`EmptyState`): a 40px neutral icon (no gradient circle), a `title-sm` title, a one-line description and **one** primary CTA. There are two kinds:
  - "nothing yet" (connect or create)
  - "no results" (filters active: "No orders match these filters" plus a "Clear filters" ghost button)
- **Not connected** (`ConnectState`): the marketplace logo, "Connect Etsy to see listings" and a Connect button. It replaces the page body and never shows half-empty tables.
- **Error** (`ErrorState`): a plain-language title, the cause if known ("Etsy rejected the request: token expired"), a "Retry" button and "Copy details" (request ID). Inline errors in a panel use `Banner tone="danger"` at the top of the body.
- **Stuck states are forbidden:** every loading banner, such as "Loading your eBay listings…", has a 20s timeout and then becomes an ErrorState.
- **Banners** (`Banner`): `info|warning|danger|success`, placed inline at the top of a section. One line plus an optional action. They can be dismissed and the dismissal is persisted. They are never used for marketing ("All Features Free"); a launch offer, if any, lives in the plan meter in the sidebar footer.

### 3.15 Toasts (`ds/toast`, wrapping notistack-style API over MUI Snackbar)
- They sit bottom-center on desktop and above the tab bar on mobile. At most 3 stack, and z is 1700.
- Tone uses only a leading icon (✓, !, ✕) on a `neutral-900` background with white 13px text. The toasts themselves are not colored.
- Durations: 4s for success, 6s with an action, and errors stay until dismissed when they need a decision.
- Copy is at most 80 characters and has no raw server payloads. An error toast links to "Details", which opens the panel or error state. **AI output is never shown in a toast.**
- Undo appears on reversible bulk actions ("12 listings moved to draft · Undo").
- Toasts are not used for form validation, which is inline.

### 3.16 Icons
- Use **`lucide-react` only**, at a 1.75 stroke and sizes of 16 (inline and buttons), 18 (nav) and 20 (empty states use 40 at stroke 1.5).
- `@mui/icons-material` imports are banned by lint, and the package is removed after migration.
- Marketplace and carrier marks are **never** icons. They are always `MarketplaceLogo`.
- Every icon that carries meaning has a text label or tooltip.

### 3.17 Keyboard map (`ds/useShortcuts`, shown by `?`)

| Scope | Keys |
|---|---|
| Global | `⌘K` palette · `?` shortcuts · `g o/l/m/r/s` go to Orders/Listings/Messages/Reports/Settings · `[` toggle sidebar |
| List | `/` search · `j k ↑ ↓` move · `x` select · `⇧x` range · `⌘A` select page · `Enter` open panel · `e` edit (listings) · `l` create label (orders) · `p` print · `Esc` clear selection |
| Panel / editor | `⌘↵` primary · `⌘S` save draft · `Esc` close · `j k` next/prev record · `⌘⇧P` toggle preview |
| Bulk grid | arrows · `Enter`/`F2` edit cell · `Tab` next cell · `⌘C/⌘V` copy/paste ranges · `⌘D` fill down · `⌘Z` undo |

---

## 4. Component inventory (`components/ds/*`)

Each component exports a typed props interface. All strings arrive as props or through `useTranslations` inside the component, and none are hard-coded.

### 4.1 Shell
| Component | File | Props |
|---|---|---|
| `AppShell` | `ds/shell/AppShell.tsx` | `{ children; nav: NavGroup[]; topBar?: ReactNode; collapsed?: boolean; onCollapsedChange?(v) }` |
| `SideNav` | `ds/shell/SideNav.tsx` | `{ groups: NavGroup[]; activeHref: string; collapsed: boolean; footer?: ReactNode }` where `NavGroup = { id; label?: string; items: NavItem[] }`, `NavItem = { href; label; icon?: LucideIcon; marketplace?: MarketplaceKey; count?: number; countTone?: 'neutral'|'danger'; dot?: 'warning'|'danger'; shortcut?: string; requires?: MarketplaceKey[] }` |
| `TopBar` | `ds/shell/TopBar.tsx` | `{ breadcrumbs?: Crumb[]; mobileTitle?: string; onBack?(); right?: ReactNode }` |
| `MobileTabBar` | `ds/shell/MobileTabBar.tsx` (absorbs `components/MobileTabBar.tsx`) | `{ items: NavItem[]; moreItems: NavGroup[] }`, sets `--kx-bottom-nav` |
| `CommandPalette` | `ds/shell/CommandPalette.tsx` (absorbs existing) | `{ open; onClose(); sources: PaletteSource[] }`, `PaletteSource = { id; label; search(q): Promise<PaletteItem[]> }` |
| `PlanMeter` | `ds/shell/PlanMeter.tsx` | `{ plan: string; usage: { label; used: number; limit: number | null }[]; href }` |

### 4.2 Page
| Component | File | Props |
|---|---|---|
| `Page` | `ds/page/Page.tsx` | `{ width: 'list'|'detail'|'form'|'reading'; children }` |
| `PageHeader` | `ds/page/PageHeader.tsx` | `{ title: string; count?: number; subtitle?: ReactNode; meta?: ReactNode; primaryAction?: ActionSpec; secondaryActions?: ActionSpec[] /* ≤2 */; overflowActions?: ActionSpec[]; backHref?: string }`, `ActionSpec = { label; onClick?|href?; icon?; shortcut?; loading?; disabled?; disabledReason?; tone?: 'default'|'danger' }` |
| `Section` | `ds/page/Section.tsx` | `{ title?: string; description?: string; action?: ReactNode; children; variant?: 'plain'|'card' }` |
| `Banner` | `ds/feedback/Banner.tsx` | `{ tone: 'info'|'warning'|'danger'|'success'; title: string; children?; action?: ActionSpec; dismissKey?: string }` |

### 4.3 Toolbar and filters
| Component | File | Props |
|---|---|---|
| `Toolbar` | `ds/toolbar/Toolbar.tsx` | `{ search?: SearchProps; filters?: ReactNode /* ≤3 FilterButton */; moreFilters?: FilterDef[]; views?: SavedViewsProps; right?: ReactNode; resultCount?: number; selection?: { count: number; actions: ActionSpec[]; onClear() } }` (renders `BulkActionBar` when `selection.count > 0`) |
| `SearchField` | `ds/toolbar/SearchField.tsx` | `{ value; onChange(v); placeholder; shortcut?: '/'; debounceMs?: 250; size?: 'sm'|'md' }` |
| `FilterButton` | `ds/toolbar/FilterButton.tsx` | `{ label: string; value?: string | string[]; options: Option[]; multiple?: boolean; searchable?: boolean; onChange(v) }` |
| `FiltersSheet` | `ds/toolbar/FiltersSheet.tsx` | `{ open; onClose(); filters: FilterDef[]; values: Record<string, unknown>; onApply(values) }` |
| `SavedViews` | `ds/toolbar/SavedViews.tsx` | `{ views: SavedView[]; activeId: string; onSelect(id); onSave?(name, query); onDelete?(id) }`, `SavedView = { id; label; query: Record<string,string>; builtin?: boolean; count?: number }` |
| `ActiveFilterChips` | `ds/toolbar/ActiveFilterChips.tsx` | `{ chips: { key; label; onRemove() }[]; onClearAll() }` |
| `DateRangeField` | `ds/inputs/DateRangeField.tsx` | `{ value: { from: Date|null; to: Date|null }; onChange(v); presets?: PresetKey[]; maxDate?: Date; size?: 'sm'|'md'; label?: string }`, built on `DateCalendar` (x-date-pickers v6, MIT) inside `Popover`; bottom sheet on mobile |
| `BulkActionBar` | `ds/toolbar/BulkActionBar.tsx` | `{ count; actions: ActionSpec[]; overflow?: ActionSpec[]; onClear() }` |

### 4.4 Data display
| Component | File | Props |
|---|---|---|
| `DataTable<T>` | `ds/data/DataTable.tsx` | `{ rows: T[]; columns: DSColumn<T>[]; getRowId(r); loading?; error?; empty?: ReactNode; selection?: { ids; onChange }; onRowOpen?(r); rowActions?(r): ActionSpec[]; inlineAction?(r): ActionSpec; density?: 'compact'|'standard'|'comfortable'; pagination: { page; pageSize; total; onChange }; sort?: SortModel; onSortChange?; mobileCard(r): MobileCardSpec; columnStateKey: string }`, `DSColumn<T> = { field; header; width?; align?; type?: 'text'|'money'|'number'|'date'|'status'|'score'|'thumb'|'marketplace'; render?(r); sortable?; hideable? }` |
| `MobileCard` | `ds/data/MobileCard.tsx` | `{ thumb?: string; title; meta?: ReactNode; amount?: ReactNode; status?: ReactNode; inlineAction?: ActionSpec; overflow?: ActionSpec[]; expandable?: ReactNode; selected?; onSelect?; onOpen? }` |
| `BulkGrid<T>` | `ds/data/BulkGrid.tsx` | `{ rows: T[]; columns: GridColumn<T>[]; onCellsChange(patches: CellPatch[]); validate?(row, field, value): string|null; dirty: Set<string>; frozenColumns?: number }`. Excel-like editing: DataGrid cell edit plus a custom range selection, `onPaste` (TSV parse), fill-down and undo stack. Dirty cells get an accent-50 background and invalid cells a danger outline. |
| `StatusPill` | `ds/data/StatusPill.tsx` | `{ status: StatusKey; raw?: string /* tooltip */; size?: 'sm'|'md' }`, label and tone from `lib/ds/statusMap.ts` |
| `ScoreMeter` | `ds/data/ScoreMeter.tsx` | `{ score: number | null; variant: 'cell'|'full'; checks?: { id; label; ok: boolean; fixField?: string }[]; onFix?(field) }` |
| `ProductThumb` | `ds/data/ProductThumb.tsx` | `{ src?: string; alt: string; size: 32|48|64|96|120; preview?: boolean; badge?: ReactNode }` |
| `MarketplaceLogo` | `ds/data/MarketplaceLogo.tsx` | `{ marketplace: MarketplaceKey | CarrierKey; size: 'xs'|'sm'|'md'|'lg'; withName?: boolean }` |
| `Money` | `ds/format/Money.tsx` | `{ amount: number | string | null; currency: 'TRY'|'USD'|'EUR'|'GBP'|string; compact?: boolean; sign?: 'auto'|'always'; approx?: boolean; fxNote?: string }` |
| `Num` | `ds/format/Num.tsx` | `{ value: number|null; percent?: boolean; compact?: boolean; decimals?: number }` |
| `DateText` | `ds/format/DateText.tsx` | `{ value: string|Date|null; mode?: 'relative'|'date'|'datetime'|'time'; tz?: string }` |
| `ShipBy` | `ds/format/ShipBy.tsx` | `{ date: string|Date; shippedAt?: string|Date }` |
| `Mono` / `CopyText` | `ds/format/CopyText.tsx` (absorbs `ui/CopyButton`) | `{ value: string; display?: string; mono?: boolean }` |
| `KpiTile` | `ds/data/KpiTile.tsx` (replaces `ui/StatCard`) | `{ label; value: ReactNode; delta?: { value: number; period: string; goodWhen: 'up'|'down' }; source: string; asOf: Date; href?: string; loading? }`. Neutral tile; the delta is the only color. |
| `Sparkline` / `Chart` | `ds/data/Chart.tsx` | `{ type: 'line'|'bar'; series: Series[]; yFormat: 'money'|'number'|'percent'; currency? }`. Uses the data palette and a single y-axis (no dual axis; use two charts). |
| `Timeline` | `ds/data/Timeline.tsx` | `{ events: { at: Date; label; tone?; detail? }[] }` (order history, sync attempts) |

### 4.5 Overlays
| Component | File | Props |
|---|---|---|
| `SidePanel` | `ds/overlay/SidePanel.tsx` | `{ open; onClose(); size?: 'sm'|'md'|'lg'|'xl'; title: string; leading?: ReactNode; status?: ReactNode; meta?: ReactNode; onPrev?(); onNext?(); overflow?: ActionSpec[]; primary?: ActionSpec; secondary?: ActionSpec; saveState?: 'idle'|'dirty'|'saving'|'saved'|'error'; savedAt?: Date; dirty?: boolean; modal?: boolean; children }` |
| `SidePanelSection` | `ds/overlay/SidePanelSection.tsx` | `{ id; title; action?: ReactNode; children }` |
| `Modal` | `ds/overlay/Modal.tsx` | `{ open; onClose(); title; size?: 'sm'|'md'; nested?: boolean; primary: ActionSpec; secondary?: ActionSpec; children }` |
| `ConfirmDialog` / `useConfirm` | `ds/overlay/ConfirmDialog.tsx` (absorbs `ui/ConfirmDialog`) | `useConfirm()(opts: { title; body?; confirmLabel; tone?: 'default'|'danger'; typeToConfirm?: string }) => Promise<boolean>` |
| `BottomSheet` | `ds/overlay/BottomSheet.tsx` | `{ open; onClose(); title; fullHeight?: boolean; footer?: ReactNode; children }` |
| `OverflowMenu` | `ds/overlay/OverflowMenu.tsx` | `{ items: (ActionSpec | 'divider')[]; label?: string; size?: 'sm'|'md' }` |
| `Tooltip` | `ds/overlay/Tooltip.tsx` | `{ title: string; shortcut?: string; children }` |
| `toast` | `ds/feedback/toast.ts` + `ToastHost.tsx` | `toast.success(msg, { action? })`, `toast.error(msg, { details?, persist? })`, `toast.info(msg)` |

### 4.6 Inputs
| Component | File | Props |
|---|---|---|
| `Field` | `ds/inputs/Field.tsx` | `{ label: string; htmlFor; optional?: boolean; helper?: string; error?: string; counter?: { value: number; max: number }; children }` |
| `TextInput` | `ds/inputs/TextInput.tsx` | `{ value; onChange; size?: 'sm'|'md'; prefix?; suffix?; type?; inputMode?; ...InputBaseProps }` |
| `TextArea` | `ds/inputs/TextArea.tsx` | `{ value; onChange; minRows?: 4; maxRows?: 24; preview?: (v) => ReactNode }` |
| `Select` | `ds/inputs/Select.tsx` | `{ value; onChange; options: Option[]; placeholder?; size? }` (MUI Select, z 1600) |
| `Combobox` | `ds/inputs/Combobox.tsx` | `{ value; onChange; loadOptions?(q); options?; multiple?; creatable?; renderOption? }` (Autocomplete, z 1600; taxonomy search) |
| `TagInput` | `ds/inputs/TagInput.tsx` | `{ value: string[]; onChange; maxTags: number; maxLength: number; separators?: [',', 'Enter']; validate?(tag): string|null; flagOverlapWith?: string }` |
| `MoneyInput` | `ds/inputs/MoneyInput.tsx` | `{ amount; currency; onChange({ amount, currency }); currencies?: string[] }` (locale-aware decimal comma) |
| `CountrySelect` / `PhoneInput` / `CurrencySelect` | `ds/inputs/*.tsx` | `{ value; onChange; defaultCountry?: 'TR' }` |
| `SegmentedControl` | `ds/inputs/SegmentedControl.tsx` | `{ value; onChange; options: { value; label; icon? }[]; size?: 'sm' }` (≤ 4 options; otherwise Select) |
| `Switch` / `Checkbox` / `Radio` | `ds/inputs/*.tsx` | MUI re-exports with DS sizing |
| `ImageGrid` | `ds/inputs/ImageGrid.tsx` | `{ images: { id; src; alt?; staged?: 'add'|'delete'|'reorder' }[]; max: number; onReorder(ids); onUpload(files); onDelete(id); onAltChange(id, alt); onOpen(id) }` |
| `Button` / `IconButton` / `SplitButton` | `ds/inputs/Button.tsx` | `Button { variant: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'; size?: 'sm'|'md'|'lg'; icon?: LucideIcon; loading?; loadingLabel?; disabledReason?; shortcut? }`, `IconButton { icon; label /* required */; size?; shortcut? }`, `SplitButton { primary: ActionSpec; options: ActionSpec[] }` |
| `Kbd` | `ds/format/Kbd.tsx` | `{ keys: string }` (renders ⌘ vs Ctrl by platform) |

### 4.7 States
| Component | File | Props |
|---|---|---|
| `EmptyState` | `ds/state/EmptyState.tsx` | `{ kind: 'empty'|'no-results'; icon?: LucideIcon; title; description?; action?: ActionSpec; onClearFilters?() }` |
| `ConnectState` | `ds/state/ConnectState.tsx` | `{ marketplace: MarketplaceKey; title; description; connectHref }` |
| `ErrorState` | `ds/state/ErrorState.tsx` | `{ title; cause?: string; requestId?: string; onRetry?() }` |
| `Skeleton*` | `ds/state/Skeletons.tsx` | `TableSkeleton { rows?: 8; thumb?: boolean }`, `PanelSkeleton`, `KpiSkeleton { count }`, `CardListSkeleton` |
| `useAsyncState` | `ds/state/useAsyncState.ts` | `(swr) => 'loading'|'empty'|'error'|'ready'`, with a 20s timeout → error |

Utilities: `lib/format.ts` (fmtMoney, fmtNum, fmtDate, fmtRelative), `lib/ds/statusMap.ts`, `lib/ds/marketplaces.ts` (key → name, logo, brand color), `lib/text/decodeEntities.ts` (ingest-time decode) and `lib/listingScore/{etsy,ebay,amazon,trendyol,wix,shopify}.ts` → `{ score, checks[] }`.

Lint guards (`eslint` custom rules / `no-restricted-imports` / `no-restricted-syntax`):
- No `@mui/icons-material`.
- No `<input type="date">`.
- No `textTransform: 'uppercase'`.
- No `linear-gradient` in `sx` or `className`.
- No `.toFixed(` in TSX.
- No literal JSX strings.
- No `Typography variant="h1..h6"`.

---

## 5. Visual findings → resolution

| # | Finding (visual_findings.md) | Resolved by |
|---|---|---|
| 1 | No shared page header; top bar duplicates title; "Settings" twice; "- KolayXport" suffix | `PageHeader` is the only title. `TopBar` shows breadcrumbs, never the title. `<title>` is "Page · KolayXport" (§3.1, §3.2) |
| 2 | 4+ button styles (gradient, flat, green, uppercase, outline); no single primary | `Button` has 5 variants, no gradient, no uppercase and no green. P1 allows one primary per view. Theme `MuiButton.contained` is flat. Lint bans gradients (§3.8) |
| 3 | 3+ score representations (box, ring, letter, square) | `ScoreMeter` gives one 0–100 score in four bands with a checklist, computed per marketplace in `lib/listingScore/*` (§3.10) |
| 4 | Inconsistent price formats ($169.99, ₺1109.30, 2999.00 TRY, TRY 1,070,860.03, ₺163.7K) | `<Money>` / `fmtMoney` use Intl narrowSymbol, locale grouping and 2 decimals. Compact appears only in KPI and axes, with a tooltip. `toFixed` is a lint error (§3.13) |
| 5 | Native date inputs next to floating-label MUI fields; mixed control heights | `DateRangeField` with presets. Native date input is lint-banned. Labels sit above, never floating. Toolbar controls are 32 and form controls 40 (§3.3, §3.7) |
| 6 | Mixed languages, ASCII-Turkish ("AI ile Olustur") | P5: next-intl only, a literal-string lint rule and i18n key review. AI content language rule (tags in English, commentary in the locale) |
| 7 | "FAİLED", "RECEİVED" uppercase bug | Global `text-transform: none`, MUI button `textTransform: none`, no overline variant, sentence-case labels and `lang` set per locale in `_document` |
| 8 | Collapsed sidebar: identical cube and target icons | `SideNav` uses `MarketplaceLogo` for every marketplace item, a uniqueness unit test and tooltips with labels. Research collapses to one item with an internal marketplace filter (§3.1, §3.12) |
| 9 | Full-width pages, 1400px inputs | `<Page width>` sets list 1600 / detail 1280 / form 880 / reading 720. Fields max 480 (§3.2) |
| 10 | Rainbow, meaningless colors (10 colored KPI tiles, gradient heroes) | P2: color carries meaning only. `KpiTile` is neutral and only the delta is colored. The chart palette is fixed. Gradient utilities are deleted. Brand colors live only in logo tiles (§2.1) |
| 11 | Raw HTML entities from Etsy (one&#39;s), risk of pushing them back | `lib/text/decodeEntities` runs in mappers at ingest. The draft service never re-encodes. A test fixture covers `&#39;`, `&amp;` and `&quot;` (P5) |
| 12 | Overview: "All Features Free" banner; 6 nav tiles with no data, one to a removed page | Overview becomes an **action queue** (wireframe §6.5). Marketing banners are banned (`Banner` rules). The plan offer moves to `PlanMeter` |
| 13 | Orders toolbar: 13 controls in 2 rows, mixed heights | `Toolbar`: search, 3 filters (Store, Status, Date range), `FiltersSheet`, `SavedViews`, density and refresh in **one row of 32px** controls. "Sync" and "Add manual order" move to the PageHeader (secondary or overflow) (§3.3) |
| 14 | Ship-by chip duplicated relative and absolute | `<ShipBy>` shows one string, with color only when due today or overdue (§3.13) |
| 15 | "Awaiting Fulfillment" + "Received" chips with unclear meaning | `StatusPill` has a fixed vocabulary and one order status per row. Raw marketplace status goes in the tooltip (§3.9) |
| 16 | Tiny icon buttons; "+ Cost" chip | `IconButton` is 32/40 with a required label. Cost becomes a column or a panel field, not a chip (§3.8) |
| 17 | "Already has a tracking number" rendered as a green button | Shown as the `label_created` pill plus `CopyText` tracking. Pills are never clickable (§3.9) |
| 18 | Carrier buttons with no logos; "Delete order" next to primary actions | `SplitButton` "Create label ▾" with `MarketplaceLogo` carrier options. Delete goes to `⋯` as `danger-ghost` with a confirm (P1) |
| 19 | "Unlabeled" view shows Amazon Shipped orders; "Amazon Customer" / "-" image | Saved views are defined on normalized `StatusKey` (`to_ship` excludes `shipped`). `ProductThumb` has a package placeholder. The buyer column falls back to "Buyer name hidden by Amazon" with an info tooltip (P6) |
| 20 | Three carrier drawers with three structures (FedEx form, UPS accordions + "Save", "MNG Kargo") | **One `CreateLabelPanel`** (wireframe §6.4): carrier picker with logos and live rates, then shared sections (Ship to, Package, Service, Customs). The primary is always "Create label". DHL eCommerce is named correctly. Phone and country come from the order. `CountrySelect` replaces free text |
| 21 | Add Manual Order as a centered modal; currency defaults to USD | Becomes a `SidePanel` (the modal rule caps forms at 4 fields). `MoneyInput` defaults to the shop's currency (TRY for TR sellers) (§3.6) |
| 22 | Four different listings layouts (rail vs no rail, two sync buttons, pill vs bold selection, "Filter by St…" header bug) | **One `ListingsPage` template** for all marketplaces with one `Toolbar`, one `DataTable` column set (thumb, title, price, qty, status, sync, score, updated) and one `SyncButton` split. Rails are removed; filters live in the Toolbar. Column headers come from i18n (§6.2) |
| 23 | Per-row pencil/copy/red trash icons | Row: one inline action plus `⋯`, with destructive actions in the menu and a confirm (§3.4) |
| 24 | Editor: 9 tabs, Basics 4th | Editor is a full page with one scroll and a sticky section anchor nav in order: Photos & video, Title & description, Tags, Price & inventory, Variations, Details, Personalization, Shipping. Score and preview sit in a right rail (§6.3) |
| 25 | Editor footer with 6 equal buttons; disabled grey Save Draft; no "Sync to Etsy"; no saved or live status | Autosave to draft (`saveState`). Footer: `⋯` (View on Etsy, Copy, Schedule, Save as profile, Delete) on the left, secondary "Discard changes" and **primary "Sync to Etsy"** on the right. Save state "Draft saved 10:42 · 3 changes not on Etsy" in the middle |
| 26 | Unlabeled undo and folder icons; "0 views · 0 favorites" | `IconButton label` with a required tooltip. Stats appear only when non-zero and sourced; otherwise hidden (P6) |
| 27 | Fixed-height inner-scroll description, raw entities, no preview | `TextArea` auto-grows to 24 rows with a preview toggle that renders as Etsy does. Entities are decoded at ingest |
| 28 | "No research data" orange warning in a corner | Replaced by an inline `Field` helper: "Get tag ideas" ghost button that runs research in place (§6.3) |
| 29 | No live preview, no quality score in editor | Right rail: `ScoreMeter full` plus a marketplace-accurate preview (search card and listing page) |
| 30 | Messages: no preview, no unread state, all "1m", generic avatars, empty pane | Messages list: `MarketplaceLogo` avatar badge, buyer name, 1-line preview, `DateText relative`, bold unread with a dot, an order or product chip. On desktop the right pane auto-opens the newest unread. Empty: "No unread messages" `EmptyState`. Filters use `FilterButton` with a label |
| 31 | Research: purple gradient hero, implausible numbers, Turkish tips in EN UI, purple FAB | No heroes or FABs. Numbers carry a source, sample size and date, with an outlier guard showing `—` (P6). Tips follow the locale. **Product rethink, not a reskin:** one "Research" workspace in which a query (keyword, product or shop) returns an answer-first summary: demand, competition, price band, top listings with real thumbnails, and suggested title/tags with a "Use in listing" action into the editor. Every result row can create a draft. The DS provides `KpiTile`, `DataTable`, `ProductThumb` and `ScoreMeter` for it |
| 32 | eBay research: two search bars, two marketplace selectors, empty grey button, stuck loading banner, empty table | One `SearchField` and one marketplace `FilterButton`. Buttons are never rendered without a label or action. `useAsyncState` 20s timeout leads to `ErrorState`. An empty table becomes `EmptyState` (§3.14) |
| 33 | Analytics: top bar "Dashboard" vs nav "Reports"; gradient Refresh; "TRY 1,070,860.03"; dual-axis chart | Title from the nav label. Refresh is a ghost `IconButton` with "Updated 2m ago". `<Money>`. `Chart` forbids dual axes and uses two small charts (§4.4) |
| 34 | Financials: gradient header, 10 rainbow tiles, gradient balance cards, native dates + Apply, green "Sync Data" | `PageHeader`, at most 4 neutral `KpiTile`s in a row (the rest go into a table), `DateRangeField` (applies immediately, no Apply button), "Sync" as secondary (§3.3, §4.4) |
| 35 | Settings: duplicate titles, icon tabs, yellow restriction box, pale green rows, "Last sync 3 weeks ago" with no action | Adopts `settings_spec.md`: left `SettingsNav` with 880px content, `IntegrationTile` grid with `MarketplaceLogo` and `StatusPill`, the Etsy restriction as a one-line `Banner tone="info"` inside the Etsy tile drawer, and "Sync now" in the tile overflow next to the last-sync meta |

---

## 6. ASCII wireframes

### 6.1 Orders (`/app/labels`)

**Desktop (1440)**
```
┌──────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ Kolay  │ Orders                                                    ⌘K  Search…            🔔  (TS)      │
│          ├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Overview │ Orders  [142]                                     [⟳ Sync] [Print picklist]  ⋯   [Create labels]│
│ Orders 12│ Updated 2 min ago · Etsy, eBay, Amazon, Trendyol                                                │
│ Messages3│                                                                                                 │
│ Listings │ View: [To ship ▾] │ ⌕ Search order #, buyer, SKU…  /  │[Store: All ▾][Status: All ▾][📅 Last 30 days ▾][Filters]  ≡  │
│ [E] Etsy │ Store: Etsy ✕   Ship by: Today ✕   Clear all                                                142 results │
│ [e] eBay │ ┌───┬──────┬────────────────────────────────┬──────────┬────────────┬──────────┬───────────────┬───────┐│
│ [a] Amzn │ │ ☐ │      │ Order                          │ Store    │ Total      │ Status   │ Ship by       │       ││
│ [T] Tren │ ├───┼──────┼────────────────────────────────┼──────────┼────────────┼──────────┼───────────────┼───────┤│
│ Research │ │ ☐ │[img] │ Personalized Baby Blanket ×2   │ [E] Belle│   $169.99  │● To ship │ Today         │ ⎙  ⋯ ││
│ Money    │ │   │48×48 │ #3891 · Sarah M. · US          │          │            │          │ (warning)     │       ││
│          │ │ ☑ │[img] │ Wooden Keepsake Box            │ [T] Tren │ ₺1.109,30  │● To ship │ Thu 15 Oct    │ ⎙  ⋯ ││
│ Settings•│ │   │      │ #TY-88213 · Ayşe K. · İstanbul │          │            │          │               │       ││
│ Help     │ │ ☐ │[img] │ Name Necklace (+2 items)       │ [a] Amzn │    $42.00  │● Overdue │ Overdue 1 day │ ⎙  ⋯ ││
│          │ │   │      │ #114-…-0098 · Buyer hidden ⓘ   │          │            │          │ (danger)      │       ││
│ ▱▱▱▰ Plan│ │ ☐ │[img] │ Baby Name Sign                 │ [e] eBay │    €58.00  │● Label   │ —             │ ⧉  ⋯ ││
│ « collap │ │   │      │ #12-11834 · 1Z999… (copy)      │          │            │  created │               │       ││
│          │ └───┴──────┴────────────────────────────────┴──────────┴────────────┴──────────┴───────────────┴───────┘│
│          │ 1–50 of 142                                                         Rows: 50 ▾    ‹  1 2 3  ›       │
└──────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘
With rows selected the toolbar row becomes:
│ 3 selected   [Create labels]  [Print]  [Mark shipped]  ⋯                                    Clear  Esc │
Enter on a row opens the Order SidePanel (560px) on the right; list stays interactive; j/k moves records.

Order SidePanel
┌──────────────────────────────────────────────────────────────────┐
│ [E] Order #3891                    ● To ship    ‹ ›   ⋯   ✕       │
│ Belle Couture Gifts · Ordered 13 Oct, 22:59 · Ships by Today      │
├──────────────────────────────────────────────────────────────────┤
│ Items                                                             │
│ [img] Personalized Baby Blanket · SKU BB-PINK · ×2     $139.99    │
│       Personalization: "Emma Rose" (copy)                         │
│ [img] Gift wrap                                         $30.00    │
│ Ship to                                              Edit         │
│ Sarah Miller · +1 555 0134 · 12 Oak St, Austin TX 78701, US       │
│ Payment          Subtotal $169.99 · Shipping $0.00 · Fees $14.20  │
│ Costs            Product cost [ $0.00 ] (optional) → Profit $…    │
│ History          ● Paid 13 Oct 22:59 · ● Synced 14 Oct 08:10      │
├──────────────────────────────────────────────────────────────────┤
│ ⋯ More (Delete order…)                 [Print packing slip] [Create label ▾] │
└──────────────────────────────────────────────────────────────────┘
```

**Mobile (390)**
```
┌──────────────────────────────────┐
│ Orders                    ⌕   ⋯  │  48px top bar
├──────────────────────────────────┤
│ [To ship 12][Overdue 1][Label…]→ │  saved-view chips, scroll
│ [⌕ Search orders…   ] [Filters 2]│
│ 142 results              Select  │
│ ┌──────────────────────────────┐ │
│ │[img] Personalized Baby Bl… ⋯ │ │
│ │64px  #3891 · [E] Belle       │ │
│ │      $169.99  ● To ship      │ │
│ │      Ships today (warning)   │ │
│ │ [ Create label ]             │ │  one inline primary per card
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │[img] Wooden Keepsake Box   ⋯ │ │
│ │      #TY-88213 · [T]         │ │
│ │      ₺1.109,30  ● To ship    │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ ⌂ Overview  ▤ Orders  ▦ List  ✉ 3  ≡ │  56px tab bar
└──────────────────────────────────┘
Tap card → full-screen sheet (Order panel), sticky footer [Create label] full width.
```

### 6.2 Listings (`/app/listings/[marketplace]`, one template for Etsy, eBay, Trendyol, Wix and Shopify)

**Desktop**
```
┌──────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Listings / [E] Etsy / Belle Couture Gifts ▾                     ⌘K Search…       🔔  (TS)       │
│          ├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ Etsy listings  [312]                       [Bulk edit] [⟳ Sync ▾]   ⋯          [New listing]    │
│          │ 7 changes not on Etsy · Last pulled 10 min ago                                                  │
│          │ View: [All ▾] │ ⌕ Search title, SKU, tag…  / │[Status: Active ▾][Section ▾][Score ▾][Filters] ≡ │
│          │                                                                                   312 results   │
│          │ ┌───┬──────┬───────────────────────────────┬─────────┬──────┬─────────┬──────────┬───────┬──────┬────┐│
│          │ │ ☐ │      │ Listing                       │ Price   │ Qty  │ Status  │ Sync     │ Score │Updat.│    ││
│          │ ├───┼──────┼───────────────────────────────┼─────────┼──────┼─────────┼──────────┼───────┼──────┼────┤│
│          │ │ ☐ │[img] │ Personalized Baby Blanket,    │ $69.99  │  42  │● Active │          │▰▰▰▰▱78│ 2 h  │ ✎ ⋯││
│          │ │   │      │ Custom Name Blanket, Newborn… │         │      │         │          │       │      │    ││
│          │ │   │      │ BB-PINK · 1488223311          │         │      │         │          │       │      │    ││
│          │ │ ☐ │[img] │ Wooden Keepsake Box, Engraved │ $54.00  │   0  │● Sold   │● Pending │▰▰▰▱▱61│ 1 d  │ ✎ ⋯││
│          │ │   │      │ KB-OAK · 1490012234           │         │      │  out    │  changes │       │      │    ││
│          │ │ ☐ │[img] │ Name Necklace Gold            │ $38.00  │ 120  │● Active │● Sync    │▰▱▱▱▱34│ 3 d  │ ✎ ⋯││
│          │ │   │      │ NN-G · 1477011200             │         │      │         │  failed ⓘ│       │      │    ││
│          │ └───┴──────┴───────────────────────────────┴─────────┴──────┴─────────┴──────────┴───────┴──────┴────┘│
│          │ 1–50 of 312                                                        Rows 50 ▾   ‹ 1 2 … 7 ›          │
└──────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘
Sync ▾ menu: "Sync 7 changes to Etsy" (primary item) · "Pull latest from Etsy" · "View sync history".
Selection bar: "24 selected · [Edit in grid] [Change price] [Add tags] [Deactivate] ⋯".
Click the price or qty cell → inline edit (BulkGrid behavior, dirty cell tinted accent-50, stages a draft).
Enter → quick SidePanel (photos, title, price, status, score checklist); e → full editor.

Bulk edit (full page, BulkGrid, Vela-style but keyboard-complete):
│ ← Back to listings   Bulk edit · 24 listings     Columns ▾  Find & replace  [Discard] [Sync 24 to Etsy] │
│ ┌──────┬──────────────────────────────┬────────┬─────┬──────────────────────┬──────────┬───────┐        │
│ │ img  │ Title (140)                  │ Price  │ Qty │ Tags (13)            │ Section  │ Score │        │
│ │[img] │ Personalized Baby Blanket,…▌ │ 69.99  │ 42  │ baby gift, newborn…  │ Blankets │  78   │        │
│ │[img] │ Wooden Keepsake Box… (tinted)│ 54.00  │  0  │ …                    │ Boxes    │  61   │        │
│ └──────┴──────────────────────────────┴────────┴─────┴──────────────────────┴──────────┴───────┘        │
│ ⌘V pastes a TSV range from Sheets · ⌘D fill down · invalid cells outlined red with tooltip              │
```

**Mobile**
```
┌──────────────────────────────────┐
│ ‹  Etsy listings          ⌕  ⋯   │
├──────────────────────────────────┤
│ 7 changes not on Etsy  [Sync]    │  inline Banner(info) with action
│ [All][Pending 7][Failed 1][Low]→ │
│ [⌕ Search listings  ] [Filters]  │
│ ┌──────────────────────────────┐ │
│ │[img] Personalized Baby Bl… ⋯ │ │
│ │64px  $69.99 · 42 in stock    │ │
│ │      ● Active   ▰▰▰▰▱ 78     │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │[img] Wooden Keepsake Box   ⋯ │ │
│ │      $54.00 · 0 in stock     │ │
│ │      ● Sold out ● Pending    │ │
│ └──────────────────────────────┘ │
│                         ( + New ) │  FAB = the page primary on mobile
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```

### 6.3 Listing editor (`/app/listings/etsy/[id]/edit`, full page, width `detail`)

**Desktop**
```
┌──────────┬─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ ← Etsy listings   Personalized Baby Blanket, Custom Name…   ● Active ● Pending changes   ‹ ›  ⋯   │
│          ├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ Photos · Title · Tags · Price · Variations · Details · Personalization · Shipping   (anchor nav)  │
│          ├───────────────────────────────────────────────────────────────┬─────────────────────────────────┤
│          │ Photos & video                                    6 / 20      │ Listing score     78 / 100 Good │
│          │ ┌────┐┌────┐┌────┐┌────┐┌────┐┌────┐┌ ─ ─ ┐                   │ ▰▰▰▰▰▰▰▰▱▱                      │
│          │ │ ★1 ││ 2  ││ 3  ││ 4  ││ 5  ││ 6  │  + Add                 │ ✓ Title 132/140                 │
│          │ └────┘└────┘└────┘└────┘└────┘└────┘└ ─ ─ ┘  (drag to reorder) │ ✓ 13 / 13 tags                  │
│          │ Video  [▶ thumbnail]  Replace · Remove                        │ ✕ 6 photos: add 4 more → Fix   │
│          │ ───────────────────────────────────────────────────────────── │ ✕ No alt text on 3 photos → Fix│
│          │ Title                                            132 / 140    │ ✓ Video                         │
│          │ [Personalized Baby Blanket, Custom Name Blanket, Newborn …  ] │ ─────────────────────────────── │
│          │ Title Case, commas only. 3 words overlap with tags ⓘ          │ Preview   [Search] [Listing]    │
│          │ [✦ Suggest titles]                                            │ ┌─────────────────────────────┐ │
│          │ Description                                    [Edit|Preview] │ │ [img]                       │ │
│          │ ┌──────────────────────────────────────────────────────────┐  │ │ Personalized Baby Blanket,  │ │
│          │ │ auto-growing text, no inner scroll, entities decoded      │  │ │ Custom Name Blanket…        │ │
│          │ └──────────────────────────────────────────────────────────┘  │ │ ★★★★★ (212) · $69.99        │ │
│          │ Tags                                              13 / 13     │ │ Free shipping               │ │
│          │ [baby gift ✕ 9/20][newborn blanket ✕][…]  type or paste, …    │ └─────────────────────────────┘ │
│          │ [✦ Get tag ideas] → runs research inline, shows volume/comp   │                                 │
│          │ Price & inventory                                             │ Changes not on Etsy (3)         │
│          │ Price [$ 69.99 ]  Quantity [ 42 ]  SKU [ BB-PINK ]            │ · Title · Tags · Photo order    │
│          │ … Variations · Details (taxonomy-specific) · Personalization …│                                 │
│          ├───────────────────────────────────────────────────────────────┴─────────────────────────────────┤
│          │ ⋯ More (View on Etsy, Copy, Schedule, Save as profile, Delete)                                   │
│          │                         Draft saved 10:42 · 3 changes not on Etsy   [Discard changes] [Sync to Etsy] │
└──────────┴─────────────────────────────────────────────────────────────────────────────────────────────────┘
Autosave → local draft (never Etsy). ⌘S forces save, ⌘↵ = Sync to Etsy. Conflict → Banner(warning) at top:
"This listing changed on Etsy after your draft started. [Review differences]" (no blind force).
```

**Mobile**
```
┌──────────────────────────────────┐
│ ‹  Edit listing      78 ▰▰▰▰▱  ⋯ │  score in top bar, tap → checklist sheet
├──────────────────────────────────┤
│ [Photos][Title][Tags][Price]…  → │  anchor chips, sticky
│ Photos & video           6 / 20  │
│ ┌───┐┌───┐┌───┐ →  (h-scroll)    │
│ Title                  132 / 140 │
│ [Personalized Baby Blanket, …  ] │
│ Description          Edit|Preview│
│ [ … ]                            │
│ Tags                   13 / 13   │
│ [chips…]                         │
│ …                                │
├──────────────────────────────────┤
│ Draft saved · 3 not on Etsy      │
│ [        Sync to Etsy          ] │  sticky footer above tab bar
└──────────────────────────────────┘
Preview opens as a bottom sheet from ⋯ → "Preview".
```

### 6.4 Create-label drawer (`CreateLabelPanel`, SidePanel lg 720)

**Desktop**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Create label · Order #3891                        ● To ship        ⋯    ✕    │
│ Sarah Miller · Austin TX, US · 2 items · Ships by Today                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ From                                                         Change         │
│ Belle Couture Gifts · Atatürk Cad. 12, Bursa TR · +90 532 …  (sender summary)│
│ ──────────────────────────────────────────────────────────────────────────── │
│ Ship to                                                     Edit            │
│ Sarah Miller · +1 555 0134 (from order) · 12 Oak St, Austin TX 78701 · [US ▾]│
│ ──────────────────────────────────────────────────────────────────────────── │
│ Package                                                     Presets ▾       │
│ Weight [ 0.8 ] [kg ▾]   L [30] W [20] H [8] cm            ☐ Save as preset  │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Carrier & service                                         Refresh rates ⟳   │
│ ◉ [FedEx]  International Priority    2–3 days    $38.40   Recommended       │
│ ○ [FedEx]  International Economy     4–6 days    $29.10                     │
│ ○ [UPS]    Worldwide Saver           2–4 days    $41.75                     │
│ ○ [DHL]    DHL eCommerce (TR domestic only)      not available for US  ⓘ    │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Customs (international)                                    ▾ 2 items        │
│ Baby blanket · HS 6302.10 · Qty 2 · $139.99 · Origin TR                      │
│ Content type [Merchandise ▾]   ETGB  ☑ Include                               │
│ ──────────────────────────────────────────────────────────────────────────── │
│ Options    ☐ Signature   ☐ Insurance   Label format [PDF 4×6 ▾]             │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⋯ (Save as draft, Use other carrier account)     Total $38.40    [Cancel] [Create label] │
└──────────────────────────────────────────────────────────────────────────────┘
After success: panel body becomes the result: label PDF preview, tracking (CopyText), [Print label] primary,
"Push tracking to Etsy: done ✓". Same structure for every carrier; carrier-specific fields appear as extra
rows inside "Options", never as a separate drawer layout.
```

**Mobile**
```
┌──────────────────────────────────┐
│ ✕  Create label · #3891          │
├──────────────────────────────────┤
│ From  Belle Couture Gifts   ›    │  rows; tap → edit sheet
│ To    Sarah Miller, US      ›    │
│ Package 0.8 kg · 30×20×8    ›    │
│ Service                          │
│ ◉ [FedEx] Intl Priority  $38.40  │
│ ○ [FedEx] Intl Economy   $29.10  │
│ ○ [UPS]   Worldwide Saver $41.75 │
│ Customs  2 items · $139.99  ›    │
│ Options                     ›    │
├──────────────────────────────────┤
│ Total $38.40                     │
│ [        Create label          ] │
└──────────────────────────────────┘
```

### 6.5 Overview (`/app`, width `detail`, an action queue rather than nav tiles)

**Desktop**
```
┌──────────┬─────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar  │ Good morning, Tamer                                       [Connect a store]   [Go to orders]│
│          │ Wednesday 15 Oct · All stores · Updated 1 min ago                                            │
│          ├─────────────────────────────────────────────────────────────────────────────────────────────┤
│          │ ┌─────────────────┐┌─────────────────┐┌─────────────────┐┌─────────────────┐               │
│          │ │ To ship         ││ Overdue         ││ Revenue (7 d)   ││ Unread messages │  KpiTile ×4   │
│          │ │ 12              ││ 1  (danger)     ││ ≈ ₺86.400       ││ 3               │  neutral      │
│          │ │ 4 due today     ││ Amazon #114…    ││ ▲ 12% vs prev   ││ Etsy 2 · Wix 1  │               │
│          │ └─────────────────┘└─────────────────┘└─────────────────┘└─────────────────┘               │
│          │ Needs your attention                                                                         │
│          │ ┌──────────────────────────────────────────────────────────────────────────────────────────┐│
│          │ │ ● Overdue   [a] Name Necklace · #114-…-0098 · 1 day late             [Create label]       ││
│          │ │ ● Conflict  [E] Wooden Keepsake Box · draft vs Etsy                  [Review]             ││
│          │ │ ● Sync fail [E] Name Necklace Gold · "Invalid taxonomy"              [Open]               ││
│          │ │ ● Reconnect [e] eBay authorization expired                           [Reconnect]          ││
│          │ │ ● Low score 18 listings under 50                                     [View listings]      ││
│          │ └──────────────────────────────────────────────────────────────────────────────────────────┘│
│          │ ┌──────────────────────────────────────────────┐┌──────────────────────────────────────────┐ │
│          │ │ Orders, last 14 days        [Line ▾]          ││ Top listings (7 d)                       │ │
│          │ │  ▁▂▃▅▃▆▇▅▆▇█▆▇█   single axis, data palette   ││ [img] Baby Blanket   18 sold   $1,259.82 │ │
│          │ │                                               ││ [img] Keepsake Box   11 sold     $594.00 │ │
│          │ └──────────────────────────────────────────────┘└──────────────────────────────────────────┘ │
│          │ Stores   [E] Belle ● Connected · 2m   [e] eBay ● Reconnect   [T] Trendyol ● Connected · 5m   │
└──────────┴─────────────────────────────────────────────────────────────────────────────────────────────┘
Header primary = "Go to orders" when anything is to ship, else "New listing". New account: KPIs replaced by
a 3-step ConnectState checklist (Connect store → Sender profile → First label).
```

**Mobile**
```
┌──────────────────────────────────┐
│ Overview                    🔔   │
├──────────────────────────────────┤
│ ┌──────────────┐┌──────────────┐ │
│ │ To ship  12  ││ Overdue  1   │ │  2×2 KPI grid
│ └──────────────┘└──────────────┘ │
│ ┌──────────────┐┌──────────────┐ │
│ │ Rev 7d ₺86K  ││ Unread  3    │ │  compact allowed in KPI only
│ └──────────────┘└──────────────┘ │
│ Needs your attention             │
│ ● Overdue  Name Necklace    ›    │
│ ● Conflict Keepsake Box     ›    │
│ ● Reconnect eBay            ›    │
│ Orders, last 14 days             │
│ ▁▂▃▅▃▆▇▅▆▇█▆▇█                   │
│ [       Go to orders         ]   │
├──────────────────────────────────┤
│ tab bar                          │
└──────────────────────────────────┘
```

---

## 7. Migration order (for planning, not part of the DS contract)

1. **Tokens and theme.** Ship `styles/tokens.css`, the new `lib/theme.tsx`, Inter via next/font, `lang` per locale and the global uppercase kill. The whole app gets calmer at once: no gradients, flat buttons, 6px radii.
2. **Base components.** `ds/format/*`, `StatusPill`, `MarketplaceLogo`, `Button`, `Field`, `DateRangeField`, and the lint guards in warn mode.
3. **Shell.** `AppShell`, `SideNav` with logos, `TopBar`, `PageHeader`, `Page`.
4. **Orders.** Toolbar, `DataTable`, Order `SidePanel` and the unified `CreateLabelPanel`. This is the highest daily-use page.
5. **Listings.** One template for all five marketplaces, plus `ScoreMeter`, the editor rebuild and `BulkGrid`.
6. **Overview, Messages, Reports, Financials and Settings** (the latter per `settings_spec.md`).
7. **Research product rethink**, on top of the DS.
8. Turn the lint guards to error, remove `@mui/icons-material`, delete `components/ui/*` and `globals.css` legacy utilities, and then consider dark mode.

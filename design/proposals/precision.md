# KolayXport Design System — "Precision" proposal

Angle: Linear / Stripe Dashboard precision. Quiet neutral palette, one accent, 4px grid, crisp type, 1px borders instead of shadows, very little motion, and everything reachable from the command palette.

Status: proposal (design only, no app code changed). Date: 2026-10-15.
Inputs: `scratchpad/visual_findings.md` (production audit, 1440px), `scratchpad/settings_spec.md` (settings redesign), and the current code in `kx-ux-phase0` (`lib/theme.tsx`, `styles/globals.css`, `tailwind.config.js`, `components/ui/*`, `components/AppLayout.js`, `MobileTabBar.tsx`, `CommandPalette.tsx`).

Facts about the codebase that shape this proposal:

| Fact (verified in code) | Consequence |
|---|---|
| `package.json` has `@mui/material ^5.17.1`, not v8. `@mui/x-date-pickers ^6` (community, which has **no range picker**). | The theme skeleton below is written against the v5 API, and it carries forward unchanged to v6/v7. Do the MUI upgrade as its own project; it is not part of the visual rebuild. |
| `lib/theme.tsx` sets `MuiButton.contained` to a blue→indigo gradient with `translateY(-1px)` on hover. `MuiPaper`/`MuiCard` have a border **and** a shadow. `shape.borderRadius: 12`. | These overrides are the source of the gradient buttons and the "floaty card" look on every page. Replace them in one change. |
| `styles/globals.css` uses `@import "tailwindcss"` (v4) but has no `@theme` and no `@config`. | Tailwind v4 never reads `tailwind.config.js`, so `brand-*`, `shadow-card` and the rest are dead config. Tokens move into a `@theme` block. |
| Inter is loaded with a CSS `@import` from Google Fonts. | Replace with `next/font/google` (self-hosted, no layout shift, with the `latin-ext` subset that Turkish needs: ğ ş ı İ). |
| Icons: `lucide-react` in 64 files and `@mui/icons-material` in 74 files. | We keep one set: **lucide**. |
| Toasts use `react-hot-toast`. `CommandPalette.tsx` and `MobileTabBar.tsx` already exist. Charts use ApexCharts. `date-fns ^2` is installed. | The DS wraps these instead of adding competing libraries. The only new dependency is `react-day-picker@8` (MIT, peer `date-fns@2`) for date ranges. |

---

## 1. Principles

Each principle comes with rules that can be checked in code review. If a screen breaks a rule, it is a bug.

### P1. One job per view, one primary action
- **Exactly one primary (accent-filled) button per view.** A drawer or modal counts as its own view. If a second action seems just as important, the screen is doing two jobs: split it.
- Destructive actions are never shown inline next to primary actions. They live in the overflow menu (`⋯`), shown last and in red, and always open a confirmation.
- Header actions are capped at 1 primary + 2 secondary. Anything more goes into `⋯`.

### P2. Quiet by default, color only means something
- Chrome (sidebar, headers, tables, cards) uses only the neutral scale plus the one accent.
- Semantic colors (success/warning/danger/info) appear only inside `StatusPill`, `Banner`, `ScoreMeter`, form validation and charts that encode those meanings.
- Marketplace and carrier brand colors appear **only inside `LogoTile`**. They are never used for text, buttons, tiles or chart series.
- No gradients, glass, glows or colored hero banners anywhere. KPI tiles are neutral, and only the delta arrow is colored.

### P3. Borders, not shadows
- Surfaces inside a page sit flat on a 1px `border-subtle` line. Nothing in the page flow has a shadow.
- Shadows are reserved for things that float above the page: menus, popovers, drawers, modals, toasts and the command palette.
- Nothing moves on hover (no `translateY`). Hover changes only background or border color.

### P4. One component per concept, everywhere
- One `PageHeader`, one `FilterBar`, one `DataTable`, one `DetailDrawer`, one `StatusPill` vocabulary, one `ScoreMeter`, one `Money` formatter, one `DateRangePicker`, one icon set.
- When marketplaces differ, the component takes props; we do not fork the layout. All 5 listing pages render `<ListingsPage marketplace="etsy|ebay|trendyol|wix|shopify">`, and all 3 carriers render `<CreateLabelDrawer carrier="fedex|ups|dhl">`.
- New UI code may only import from `components/ds/*` and `lucide-react`. Raw `@mui/material` imports in pages are lint warnings during migration and become errors afterwards.

### P5. Honest, legible data
- Every number goes through `Money`, `NumberText`, `DateText` or `RelativeTime`. Those use `Intl` and the UI locale. No hand-built `"₺" + x.toFixed(2)`.
- Every metric that comes from estimation or scraping (research, AI) carries a **source + freshness** line ("Etsy search · 2h ago · sample 48 listings"). A value that fails a sanity check is shown as "—" with a tooltip giving the reason. The page never prints an implausible number.
- Text from marketplaces is decoded once at the mapper boundary (`decodeEntities`). Components never render raw HTML or HTML entities, and nothing that was double-encoded is written back to a marketplace.
- No `text-transform: uppercase` anywhere: it breaks Turkish (`FAİLED`). Everything is sentence case, enforced by a stylelint rule.

### P6. Keyboard and palette first, mobile complete
- Every primary action of every page is registered in the command palette (⌘K / Ctrl K), with a verb-first label ("Create label for #4512", "Sync Etsy listings").
- The shortcuts are shown in menus and tooltips using `Kbd`.
- Every desktop pattern has a defined mobile form: table → cards, drawer → full-height sheet, toolbar → search + "Filters" sheet, header actions → primary + `⋯`. Tap targets are at least 44px, and nothing scrolls horizontally except a deliberately scrollable table.

---

## 2. Tokens

**Single source of truth:** `lib/ds/tokens.ts` (plain TS object). From it:
1. `lib/ds/theme.ts` builds the MUI theme. MUI needs real hex values, because `alpha()` cannot parse `var()`.
2. `styles/tokens.css` holds the Tailwind v4 `@theme` block and the `--kx-*` CSS variables.
3. `__tests__/ds/tokens.parity.test.ts` parses `tokens.css` and fails if any value drifts from `tokens.ts`. This removes the current three-way drift between `theme.tsx`, `globals.css` and `tailwind.config.js`.

### 2.1 Color

#### Neutral scale ("gray", slightly cool; 12 steps)
| Token | Hex | Use |
|---|---|---|
| `gray-0` | `#FFFFFF` | surfaces (cards, tables, drawers) |
| `gray-25` | `#FBFBFC` | page background |
| `gray-50` | `#F6F7F9` | hover row, subtle fills, sidebar background |
| `gray-100` | `#EEF0F3` | selected nav item, pressed, skeleton base |
| `gray-200` | `#E3E6EA` | **default border** (`border-subtle`), dividers |
| `gray-300` | `#CDD2D9` | input border, secondary button border |
| `gray-400` | `#A3AAB5` | placeholder, disabled text, inactive icons |
| `gray-500` | `#7A828F` | tertiary text, meta, captions |
| `gray-600` | `#5B6370` | secondary text, icons in controls |
| `gray-700` | `#3F4652` | body text in dense tables |
| `gray-800` | `#262B33` | headings in dark surfaces / tooltips bg |
| `gray-900` | `#14171C` | primary text, titles |

Text roles: `text-primary = gray-900`, `text-secondary = gray-600`, `text-tertiary = gray-500`, `text-disabled = gray-400`, `text-on-accent = #FFFFFF`.

#### Brand accent: "KX Blue" (the only accent)
This keeps the current brand hue (`#2563EB`) so the product stays recognisable. It is just used much less.
| Token | Hex | Use |
|---|---|---|
| `accent-50` | `#EEF3FF` | selected row tint, info pill bg |
| `accent-100` | `#DCE6FE` | focus ring (with alpha), selected chip bg |
| `accent-200` | `#B9CCFD` | — |
| `accent-500` | `#3B6CF5` | links on hover, chart primary series |
| `accent-600` | `#2563EB` | **primary button, links, active nav marker, focus border** |
| `accent-700` | `#1D4FD0` | primary hover |
| `accent-800` | `#1A41A8` | primary pressed |

Focus ring: `0 0 0 3px rgba(37,99,235,.24)` + 1px `accent-600` border. It shows on every interactive element via `:focus-visible` only.

#### Semantic (fixed; each has bg / border / fg / solid)
| Role | bg | border | fg (text) | solid (dot, icon, meter) |
|---|---|---|---|---|
| success | `#EEFBF3` | `#BFE9CF` | `#126B3A` | `#1F9D55` |
| warning | `#FFF7E8` | `#F6DDA6` | `#8A5300` | `#D98A00` |
| danger | `#FEF1F1` | `#F7C9C9` | `#A61B1B` | `#DC2E2E` |
| info | `#EEF3FF` | `#C8D7FD` | `#1D4FD0` | `#2563EB` (= accent) |
| neutral | `#F6F7F9` | `#E3E6EA` | `#5B6370` | `#A3AAB5` |

Every fg-on-bg pair meets WCAG AA (≥ 4.5:1) at 12px/500.

#### Marketplace & carrier brand colors: **`LogoTile` only**
These are the only values in the system that may come from a brand. Use them only for the tile background tint or the monogram fallback. **Check every hex against the official brand kit before shipping.**
| Brand | Primary | Logo file (`public/logos/`) |
|---|---|---|
| Etsy | `#F1641E` | `etsy.svg` (exists) |
| eBay | `#E53238` / `#0064D2` / `#F5AF02` / `#86B817` | `ebay.svg` (add) |
| Amazon | `#FF9900` on `#232F3E` | `amazon.svg` (exists) |
| Shopify | `#95BF47` | `shopify.svg` (replace `.jpg`) |
| Wix | `#000000` | `wix.svg` (add) |
| Trendyol | `#F27A1A` | `trendyol.svg` (replace `.png`) |
| Hepsiburada | `#FF6000` | `hepsiburada.svg` (replace `.png`) |
| FedEx | `#4D148C` / `#FF6600` | `fedex.svg` (add) |
| UPS | `#351C15` / `#FFB500` | `ups.svg` (add) |
| DHL eCommerce (MNG) | `#FFCC00` / `#D40511` | `dhl.svg` (add) |
| Shippo, Veeqo, Paraşüt | from brand kit | add SVGs; until then a monogram |

Rule: a missing logo renders a **monogram tile** (initials 600 weight on `gray-100`, `gray-700` text). We never substitute a generic icon such as a cube or a target, because three identical cubes in the collapsed sidebar is exactly the bug we are fixing.

#### Data-viz palette (charts only)
Categorical, in order: `#2563EB`, `#0E9F8E`, `#7A5AF8`, `#D98A00`, `#DB2777`, `#5B6370`. A chart uses at most 4 series, and the rest fold into "Other". Marketplace breakdowns use this palette in a stable order, not brand colors (brand colors sit in the legend's `LogoTile`).

### 2.2 Typography
**Family.** Inter via `next/font/google` (`subsets: ['latin', 'latin-ext']`, `display: 'swap'`, `variable: '--font-sans'`), with OpenType features `"cv11", "ss01"` for the single-storey a and open digits. Numbers in tables, KPIs and money always use `font-variant-numeric: tabular-nums`.
**Mono.** `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace`. Use it only for tracking numbers, order IDs, SKUs and API keys.

The base UI size is **14px**, as in Stripe. The dense table size is 13px.

| Token | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 30 / 36 | 600 | -0.02em | Overview KPIs only |
| `title-lg` | 24 / 32 | 600 | -0.015em | Marketing-like empty states, auth |
| `title` | 20 / 28 | 600 | -0.01em | **PageHeader title** (every page) |
| `heading` | 16 / 24 | 600 | -0.005em | Drawer title, section title |
| `subheading` | 14 / 20 | 600 | 0 | Card titles, group labels |
| `body` | 14 / 20 | 400 | 0 | Default text, form values |
| `body-strong` | 14 / 20 | 500 | 0 | Row primary text, labels |
| `small` | 13 / 18 | 400/500 | 0 | Tables, helper text, toolbar controls |
| `caption` | 12 / 16 | 400/500 | 0 | Meta lines, timestamps, pill text |
| `micro` | 11 / 14 | 600 | 0.01em | Sidebar group labels, badges (**sentence case, never uppercase**) |

Weights allowed: 400, 500 and 600 only. 700/800 are removed (Inter is loaded only at 400/500/600).

### 2.3 Spacing (4px grid)
| Token | px | Typical use |
|---|---|---|
| `0.5` | 2 | icon/text nudge |
| `1` | 4 | pill padding-y, icon gap in tight controls |
| `2` | 8 | gap between controls in a toolbar, icon-label gap |
| `3` | 12 | card inner gap, table cell padding-x |
| `4` | 16 | card padding (mobile), field-to-field vertical gap, mobile gutter |
| `5` | 20 | card padding (desktop), drawer padding |
| `6` | 24 | page gutter (desktop), between header and content |
| `8` | 32 | between page sections |
| `10` | 40 | — |
| `12` | 48 | empty-state padding |
| `16` | 64 | — |

Every margin, padding and gap must be a value from this table. Values like 6, 10, 14 or 18px fail review.

**MUI `spacing` migration note.** Today `theme.spacing(1) = 8px`, and roughly 150 files use `sx={{ p: 2 }}` and similar. We keep `spacing: 8` for legacy code. `components/ds/*` uses the tokens (`var(--kx-space-*)` / Tailwind `p-4` = 16px in v4's 4px scale). Do not switch MUI to `spacing: 4` until legacy pages are migrated, because the switch would silently halve every legacy gap.

### 2.4 Control heights (one scale for every input, select and button)
| Token | Height | Use |
|---|---|---|
| `control-sm` | 32px | Toolbars, FilterBar, table-row actions, pills inside inputs |
| `control-md` | 40px | **All form fields**, drawer/modal footers, page header actions |
| `control-lg` | 44px | Mobile (md controls render at 44 on `< sm`), bottom sheets |

Rule: **every control on one row has the same height token.** A 32px search next to a 40px date field is a bug.

### 2.5 Radii
| Token | px | Use |
|---|---|---|
| `radius-xs` | 4 | Checkboxes, kbd, inner chips in inputs |
| `radius-sm` | 6 | **Buttons, inputs, selects, menu items, nav items** |
| `radius-md` | 8 | Cards, tables, menus/popovers, LogoTile, toasts |
| `radius-lg` | 12 | Drawers (leading edge on desktop; top corners on mobile sheets), modals, command palette |
| `radius-full` | 9999 | StatusPill, avatars, toggles |

The current 12px-on-everything (`shape.borderRadius: 12`) goes away; MUI `shape.borderRadius` becomes 6.

### 2.6 Borders
- `border-subtle`: 1px `gray-200`. Cards, tables, dividers, sidebar edge, drawer header/footer separators.
- `border-default`: 1px `gray-300`. Inputs and secondary buttons.
- `border-strong`: 1px `gray-400`. Input hover.
- `border-focus`: 1px `accent-600` + focus ring.
- `border-danger`: 1px `danger.solid`. Invalid input.
- Table row separators: 1px `gray-100` (lighter than the card edge, so rows read as one block).

### 2.7 Elevation (overlays only)
| Token | Value | Use |
|---|---|---|
| `elev-0` | `none` | Everything in the page flow |
| `elev-1` | `0 1px 2px rgba(20,23,28,.06), 0 4px 12px rgba(20,23,28,.08)` + `border-subtle` | Menus, selects, popovers, tooltips (dark), date picker |
| `elev-2` | `0 8px 24px rgba(20,23,28,.12), 0 2px 6px rgba(20,23,28,.06)` | Toasts, command palette |
| `elev-3` | `0 16px 48px rgba(20,23,28,.18)` | Drawers, modals |
| scrim | `rgba(20,23,28,.32)`, **no blur** | Behind drawers/modals (the current `backdropFilter: blur(4px)` is removed) |

### 2.8 Z-index layers (single table; MUI `zIndex` is overridden to match)
| Layer | z | Notes |
|---|---|---|
| `base` | 0 | — |
| `sticky` | 10 | Sticky table header, sticky FilterBar |
| `sticky-footer` | 20 | Sticky save bar inside page |
| `topbar` | 1100 | MUI `appBar` |
| `sidebar` | 1150 | Desktop rail (above topbar so the tooltip flyout is not clipped) |
| `mobile-tabbar` | 1200 | `MobileTabBar` |
| `drawer` | 1300 | MUI `drawer`: DetailDrawer, mobile nav drawer |
| `modal` | 1400 | MUI `modal`: Modal, ConfirmDialog |
| `command-palette` | 1450 | Always above any drawer or modal it was opened from |
| `nested-dialog` | 1500 | Dialog opened from a drawer or modal (e.g. "Discard changes?" from the editor) |
| `popover` | 1550 | **All** Menu / Select / Autocomplete / DatePicker poppers, via `defaultProps` so they sit above nested dialogs |
| `tooltip` | 1600 | MUI `tooltip` |
| `toast` | 1700 | react-hot-toast container, MUI `snackbar` |

This formalises the MUI nested-dialog lesson (Select and Autocomplete inside nested dialogs need 1500–1600). Components never set z-index ad hoc; they reference `zIndex.<layer>`.

### 2.9 Motion
| Token | ms | Easing | Use |
|---|---|---|---|
| `instant` | 0 | — | Data updates, selection |
| `fast` | 100 | `cubic-bezier(.2,0,0,1)` | Hover/pressed bg, focus ring |
| `base` | 150 | same | Menus, popovers, tooltip in, toast in |
| `slow` | 200 | `cubic-bezier(.2,0,0,1)` in / `cubic-bezier(.4,0,1,1)` out (150ms) | Drawer, modal, sheet, sidebar collapse |

- Only `opacity`, `background-color`, `border-color` and `transform` are animated, and transform only on overlays entering.
- No hover lifts, no number tickers (`NumberTicker.js` is retired from the app), no animated gradients and no shimmer: skeletons use a 1.2s opacity pulse.
- `prefers-reduced-motion: reduce` sets every duration to 0 except opacity, which drops to 100ms.

### 2.10 Dark mode (optional, phase 2)
Every color is consumed through `--kx-*` CSS variables, so dark mode means swapping variables under `[data-theme="dark"]` (neutral scale inverted to `#0E1014 … #ECEEF2`, accent shifted to `#5B86F7`, semantic bgs at 12% alpha). MUI v5 supports this through `experimental_extendTheme` + `CssVarsProvider`, and v6+ through `cssVariables: true`. Light mode ships first. The rule now is: **no hex literals in components**, so dark mode stays a token change and never becomes a rewrite.

### 2.11 `lib/ds/tokens.ts` (skeleton)
```ts
// lib/ds/tokens.ts — the only place raw values live
export const gray = {
  0: '#FFFFFF', 25: '#FBFBFC', 50: '#F6F7F9', 100: '#EEF0F3', 200: '#E3E6EA', 300: '#CDD2D9',
  400: '#A3AAB5', 500: '#7A828F', 600: '#5B6370', 700: '#3F4652', 800: '#262B33', 900: '#14171C',
} as const;
export const accent = { 50: '#EEF3FF', 100: '#DCE6FE', 200: '#B9CCFD', 500: '#3B6CF5', 600: '#2563EB', 700: '#1D4FD0', 800: '#1A41A8' } as const;
export const semantic = {
  success: { bg: '#EEFBF3', border: '#BFE9CF', fg: '#126B3A', solid: '#1F9D55' },
  warning: { bg: '#FFF7E8', border: '#F6DDA6', fg: '#8A5300', solid: '#D98A00' },
  danger:  { bg: '#FEF1F1', border: '#F7C9C9', fg: '#A61B1B', solid: '#DC2E2E' },
  info:    { bg: '#EEF3FF', border: '#C8D7FD', fg: '#1D4FD0', solid: '#2563EB' },
  neutral: { bg: '#F6F7F9', border: '#E3E6EA', fg: '#5B6370', solid: '#A3AAB5' },
} as const;
export const space = { 0.5: 2, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const control = { sm: 32, md: 40, lg: 44 } as const;
export const radius = { xs: 4, sm: 6, md: 8, lg: 12, full: 9999 } as const;
export const font = {
  sans: 'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
} as const;
export const type = {
  display: [30, 36, 600, '-0.02em'], titleLg: [24, 32, 600, '-0.015em'], title: [20, 28, 600, '-0.01em'],
  heading: [16, 24, 600, '-0.005em'], subheading: [14, 20, 600, '0'], body: [14, 20, 400, '0'],
  small: [13, 18, 400, '0'], caption: [12, 16, 400, '0'], micro: [11, 14, 600, '0.01em'],
} as const;
export const elevation = {
  0: 'none',
  1: '0 1px 2px rgba(20,23,28,.06), 0 4px 12px rgba(20,23,28,.08)',
  2: '0 8px 24px rgba(20,23,28,.12), 0 2px 6px rgba(20,23,28,.06)',
  3: '0 16px 48px rgba(20,23,28,.18)',
} as const;
export const zIndex = {
  sticky: 10, stickyFooter: 20, topbar: 1100, sidebar: 1150, mobileTabbar: 1200, drawer: 1300,
  modal: 1400, commandPalette: 1450, nestedDialog: 1500, popover: 1550, tooltip: 1600, toast: 1700,
} as const;
export const motion = { fast: 100, base: 150, slow: 200, ease: 'cubic-bezier(.2,0,0,1)', easeOut: 'cubic-bezier(.4,0,1,1)' } as const;
export const layout = { sidebarExpanded: 240, sidebarCollapsed: 56, topbar: 48, tabbar: 56, maxList: 1600, maxDashboard: 1280, maxForm: 880, maxReading: 720 } as const;
export const drawerWidth = { sm: 440, md: 560, lg: 720, xl: 960 } as const;
```

### 2.12 MUI theme (`lib/ds/theme.ts`, replaces `lib/theme.tsx`)
```ts
import { createTheme, alpha } from '@mui/material/styles';
import { gray, accent, semantic, radius, font, type, elevation, zIndex, motion, control } from './tokens';

const t = (k: keyof typeof type) => {
  const [size, lh, weight, ls] = type[k];
  return { fontSize: `${size / 16}rem`, lineHeight: `${lh}px`, fontWeight: weight, letterSpacing: ls };
};

export const theme = createTheme({
  spacing: 8, // legacy-compatible; DS components use tokens.space directly (see §2.3)
  shape: { borderRadius: radius.sm },
  palette: {
    mode: 'light',
    primary: { main: accent[600], dark: accent[700], light: accent[500], contrastText: '#fff' },
    secondary: { main: gray[700], dark: gray[900], light: gray[500], contrastText: '#fff' }, // NOT purple; secondary is neutral
    success: { main: semantic.success.solid, dark: semantic.success.fg, light: semantic.success.bg },
    warning: { main: semantic.warning.solid, dark: semantic.warning.fg, light: semantic.warning.bg },
    error:   { main: semantic.danger.solid,  dark: semantic.danger.fg,  light: semantic.danger.bg },
    info:    { main: semantic.info.solid,    dark: semantic.info.fg,    light: semantic.info.bg },
    grey: { 50: gray[50], 100: gray[100], 200: gray[200], 300: gray[300], 400: gray[400], 500: gray[500], 600: gray[600], 700: gray[700], 800: gray[800], 900: gray[900] },
    text: { primary: gray[900], secondary: gray[600], disabled: gray[400] },
    divider: gray[200],
    background: { default: gray[25], paper: gray[0] },
    action: { hover: gray[50], selected: accent[50], focus: alpha(accent[600], 0.24), disabledBackground: gray[100], disabled: gray[400] },
  },
  typography: {
    fontFamily: font.sans,
    fontSize: 14, htmlFontSize: 16,
    fontWeightRegular: 400, fontWeightMedium: 500, fontWeightBold: 600,
    h1: t('display'), h2: t('titleLg'), h3: t('title'), h4: t('heading'), h5: t('subheading'), h6: t('subheading'),
    subtitle1: { ...t('body'), color: gray[600] }, subtitle2: { ...t('small'), color: gray[600] },
    body1: t('body'), body2: t('small'),
    caption: { ...t('caption'), color: gray[500] },
    overline: { ...t('micro'), textTransform: 'none', color: gray[500] }, // never uppercase (Turkish İ)
    button: { ...t('body'), fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
  },
  shadows: ['none', elevation[1], elevation[1], elevation[2], elevation[2], ...Array(20).fill(elevation[3])] as any,
  zIndex: { appBar: zIndex.topbar, drawer: zIndex.drawer, modal: zIndex.modal, snackbar: zIndex.toast, tooltip: zIndex.tooltip, mobileStepper: zIndex.mobileTabbar, fab: zIndex.mobileTabbar, speedDial: zIndex.mobileTabbar },
  transitions: {
    duration: { shortest: motion.fast, shorter: motion.fast, short: motion.base, standard: motion.base, complex: motion.slow, enteringScreen: motion.slow, leavingScreen: motion.base },
    easing: { easeInOut: motion.ease, easeOut: motion.ease, easeIn: motion.easeOut, sharp: motion.ease },
  },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { backgroundColor: gray[25], fontFeatureSettings: '"cv11","ss01"' } } },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'medium' },
      styleOverrides: {
        root: { borderRadius: radius.sm, height: control.md, padding: '0 14px', gap: 6, transition: `background-color ${motion.fast}ms ${motion.ease}, border-color ${motion.fast}ms` },
        sizeSmall: { height: control.sm, padding: '0 10px', fontSize: '0.8125rem' },
        containedPrimary: { background: accent[600], '&:hover': { background: accent[700] }, '&:active': { background: accent[800] } }, // no gradient, no lift
        outlined: { borderColor: gray[300], color: gray[900], background: gray[0], '&:hover': { borderColor: gray[400], background: gray[50] } },
        text: { color: gray[700], '&:hover': { background: gray[50] } },
      },
    },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: gray[200] } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: radius.md, borderColor: gray[200], boxShadow: 'none' } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: radius.sm, background: gray[0], minHeight: control.md,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: gray[300] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: gray[400] },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: accent[600], borderWidth: 1 },
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(accent[600], 0.24)}` } },
        input: { padding: '0 12px', height: control.md, boxSizing: 'border-box' },
        notchedOutline: { '& legend': { display: 'none' }, top: 0 }, // labels live above fields (FormField), never floating
      },
    },
    MuiInputLabel: { defaultProps: { shrink: true } },
    MuiMenu: { defaultProps: { slotProps: { root: { style: { zIndex: zIndex.popover } } } as any } },
    MuiPopover: { defaultProps: { style: { zIndex: zIndex.popover } }, styleOverrides: { paper: { borderRadius: radius.md, border: `1px solid ${gray[200]}`, boxShadow: elevation[1] } } },
    MuiAutocomplete: { defaultProps: { slotProps: { popper: { style: { zIndex: zIndex.popover } } } as any } },
    MuiTooltip: { defaultProps: { arrow: false, enterDelay: 400 }, styleOverrides: { tooltip: { background: gray[800], fontSize: '0.75rem', borderRadius: radius.sm, padding: '4px 8px' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: radius.lg, boxShadow: elevation[3] } } },
    MuiDrawer: { styleOverrides: { paper: { boxShadow: elevation[3], borderLeft: `1px solid ${gray[200]}` } } },
    MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(20,23,28,.32)' } } }, // no blur
    MuiChip: { styleOverrides: { root: { borderRadius: radius.full, height: 22, fontSize: '0.75rem', fontWeight: 500 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 40, fontWeight: 500 } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: gray[100], fontSize: '0.8125rem', padding: '0 12px', height: 44 }, head: { color: gray[500], fontWeight: 500, height: 36, background: gray[0] } } },
  },
});
```

### 2.13 Tailwind v4 `@theme` (`styles/tokens.css`, imported first in `globals.css`)
```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;

  /* Reset Tailwind's default palette so only DS colors exist (prevents rainbow utilities) */
  --color-*: initial;
  --color-white: #fff;
  --color-gray-0: #FFFFFF;  --color-gray-25: #FBFBFC; --color-gray-50: #F6F7F9;  --color-gray-100: #EEF0F3;
  --color-gray-200: #E3E6EA; --color-gray-300: #CDD2D9; --color-gray-400: #A3AAB5; --color-gray-500: #7A828F;
  --color-gray-600: #5B6370; --color-gray-700: #3F4652; --color-gray-800: #262B33; --color-gray-900: #14171C;
  --color-accent-50: #EEF3FF; --color-accent-100: #DCE6FE; --color-accent-500: #3B6CF5;
  --color-accent-600: #2563EB; --color-accent-700: #1D4FD0; --color-accent-800: #1A41A8;
  --color-success-bg: #EEFBF3; --color-success-border: #BFE9CF; --color-success-fg: #126B3A; --color-success: #1F9D55;
  --color-warning-bg: #FFF7E8; --color-warning-border: #F6DDA6; --color-warning-fg: #8A5300; --color-warning: #D98A00;
  --color-danger-bg:  #FEF1F1; --color-danger-border:  #F7C9C9; --color-danger-fg:  #A61B1B; --color-danger:  #DC2E2E;
  --color-info-bg:    #EEF3FF; --color-info-border:    #C8D7FD; --color-info-fg:    #1D4FD0; --color-info:    #2563EB;

  --spacing: 4px; /* Tailwind v4: p-1 = 4px, p-4 = 16px, gap-2 = 8px */

  --text-display: 30px;  --text-display--line-height: 36px;
  --text-title: 20px;    --text-title--line-height: 28px;
  --text-heading: 16px;  --text-heading--line-height: 24px;
  --text-body: 14px;     --text-body--line-height: 20px;
  --text-small: 13px;    --text-small--line-height: 18px;
  --text-caption: 12px;  --text-caption--line-height: 16px;
  --text-micro: 11px;    --text-micro--line-height: 14px;

  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;

  --shadow-*: initial;
  --shadow-e1: 0 1px 2px rgba(20,23,28,.06), 0 4px 12px rgba(20,23,28,.08);
  --shadow-e2: 0 8px 24px rgba(20,23,28,.12), 0 2px 6px rgba(20,23,28,.06);
  --shadow-e3: 0 16px 48px rgba(20,23,28,.18);
  --shadow-focus: 0 0 0 3px rgba(37,99,235,.24);

  --ease-standard: cubic-bezier(.2,0,0,1);
  --breakpoint-sm: 600px; --breakpoint-md: 900px; --breakpoint-lg: 1200px; --breakpoint-xl: 1536px; /* = MUI breakpoints */
}

:root {
  --kx-control-sm: 32px; --kx-control-md: 40px; --kx-control-lg: 44px;
  --kx-sidebar: 240px; --kx-sidebar-collapsed: 56px; --kx-topbar: 48px;
  --kx-max-list: 1600px; --kx-max-dashboard: 1280px; --kx-max-form: 880px; --kx-max-reading: 720px;
  --kx-z-sticky: 10; --kx-z-drawer: 1300; --kx-z-modal: 1400; --kx-z-popover: 1550; --kx-z-tooltip: 1600; --kx-z-toast: 1700;
  --kx-dur-fast: 100ms; --kx-dur-base: 150ms; --kx-dur-slow: 200ms;
}

@media (prefers-reduced-motion: reduce) { :root { --kx-dur-fast: 0ms; --kx-dur-base: 0ms; --kx-dur-slow: 0ms; } }
```
`globals.css` then **deletes** `.glass`, `.gradient-text`, `.card-premium`, `--shadow-premium` and the old z-index scale (1000–1600, which conflicts with MUI). `tailwind.config.js` is deleted, since v4 never loaded it. Breakpoints are aligned with MUI so that `md:` in Tailwind means the same thing as `theme.breakpoints.up('md')`.

---

## 3. Layout and patterns

### 3.1 AppShell
```
┌─────────────┬──────────────────────────────────────────────────────────────┐
│ ◧ KolayXport│ TopBar 48px:  [⌘K Search or jump to…        ]   (?)  🔔  (TA) │
│─────────────│──────────────────────────────────────────────────────────────│
│ ⌂ Home      │                                                              │
│ ▤ Orders  12│   <Page width="list|dashboard|form|reading">                 │
│ Listings    │     <PageHeader/>                                            │
│  [E] Etsy   │     …                                                        │
│  [e] eBay   │                                                              │
│  [T] Trendyol                                                              │
│  [W] Wix    │                                                              │
│  [S] Shopify│                                                              │
│ ✉ Messages 3│                                                              │
│ Research    │                                                              │
│  ⌕ Product finder                                                          │
│  ⌕ Keyword explorer                                                        │
│  ⌕ Shop tracker                                                            │
│ ▥ Reports   │                                                              │
│ ₺ Finance   │                                                              │
│             │                                                              │
│─────────────│                                                              │
│ ⚙ Settings •│                                                              │
│ ? Help      │                                                              │
│ ⟨⟨ Collapse │                                                              │
└─────────────┴──────────────────────────────────────────────────────────────┘
```
- **Sidebar.** 240px expanded / 56px collapsed, `gray-50` background, 1px right border, no shadow. The state persists per user (existing `useSidebar`).
- **Nav item.** 32px tall, radius 6, 13px/500 label, 16px lucide icon, `gray-600`. Hover `gray-100`. Active: `gray-100` background + `gray-900` text + a 2px accent bar on the left edge.
- **Marketplace items use `LogoTile size={16}`** (real logos) instead of lucide icons. Research items use distinct lucide icons per tool. **No two items in the nav may share an icon** (lint-checked in `navConfig.ts`).
- **Collapsed.** Icons and logo tiles only. Every item has a right-side `Tooltip` showing label + shortcut ("Orders  G O"). Group headings become 1px dividers.
- Counts (orders needing labels, unread messages) are right-aligned `caption`/`gray-500` text, not colored badges. A red dot appears only for "needs attention" (e.g. reconnect needed).
- **TopBar.** 48px with a bottom border. It contains **no page title**: the title lives once, in `PageHeader`. The browser tab title is `"{Page} · KolayXport"`, set by `<Page title>`. The center holds the command-palette trigger. Right: help, notifications, avatar menu (language, account, sign out).
- **Mobile (< md).** The sidebar is hidden. A 56px bottom `MobileTabBar` (+ safe-area inset) shows Home · Orders · Listings · Messages · More. "More" opens a bottom sheet with the full nav (same `navConfig`, same logos). The TopBar becomes 48px with a back chevron on drill-in pages, the page title (on mobile only, since PageHeader collapses into it), and ⌘K/search.

### 3.2 Page template
```tsx
<Page title={t('orders.title')} width="list">          // sets <title>, max-width, gutters
  <PageHeader
    title={t('orders.title')}
    subtitle={t('orders.subtitle')}                     // one line, gray-600, optional
    primaryAction={{ label: t('orders.createLabel'), icon: Tag, onClick, shortcut: 'C' }}
    secondaryActions={[{ label: t('orders.sync'), icon: RefreshCw, onClick }]}   // max 2 visible
    overflowActions={[{ label: t('orders.addManual'), onClick }, { label: t('orders.etgb'), onClick }]}
    meta={<SyncStatus source="all" lastSyncedAt={…} />}  // "Synced 4 min ago"
  />
  <FilterBar …/>
  <DataTable …/>
</Page>
```
| Page type | `width` | Max content width | Alignment |
|---|---|---|---|
| Lists (Orders, Listings, Messages list, Research results) | `list` | 1600px | full width up to max, then centered |
| Dashboards (Overview, Reports, Finance) | `dashboard` | 1280px | centered |
| Forms, Settings, Sender profile, Create listing | `form` | 880px (content column; the settings nav sits outside it) | left-aligned with the header |
| Help, docs, legal | `reading` | 720px | centered |

Gutters are 24px on desktop and 16px on mobile. There are 24px between PageHeader and the first block, and 32px between sections. PageHeader height is fixed at 56px of content area (title row), so pages do not jump when the subtitle is absent.

PageHeader on mobile: the title moves into the TopBar. The header row shows the primary action as a full-width `control-lg` button only if the page's main job is creation (New listing). Otherwise the primary shows as a compact button with secondaries + overflow behind `⋯`.

### 3.3 Toolbar / FilterBar
```
[⌕ Search orders, SKU, buyer…   /]  [Status: Unlabeled ×] [Store ▾] [Last 30 days ▾]  [⚲ Filters 2]   ·····   [Sort: Ship by ▾] [≡ density]
───────────────────────────────────────────────────────────────────────────────────────────────────
Views:  All 214 · Needs label 12 · Ship today 5 · Problems 2 · Shipped        [+ Save view]
```
- **One row, one height (`control-sm` 32px).** Search is first (280px, `/` focuses it). Then **at most 3 visible filters**, which are page-defined and show as `FilterChip`s ("Label: Missing ×" once set, or a plain "Store ▾" while empty). "Filters" opens the full set in a popover on desktop and a bottom sheet on mobile, with a count badge for the filters hidden in it.
- Right side: sort, density (Compact/Comfortable), column visibility. Data refresh is not a toolbar button: the PageHeader `meta` shows "Synced 4 min ago" with a refresh icon button.
- **Saved views** are the second row: a tab-like strip of named filter presets with counts. Built-in views are defined per page; users can "Save view" and rename it. This replaces segmented controls like `ALL/UNLABELED/RECEIVED/FAILED` and unlabeled "All" selects.
- **Filter state lives in the URL** (`?view=needs-label&store=etsy-1&from=…`) so views are shareable and the Back button works.
- **Dates: always `DateRangePicker`, never `<input type="date">`.** The trigger shows the preset or range in the UI locale ("Last 30 days", "1–15 Oct"). The popover has a preset list (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, This year, Custom) and a two-month calendar (`react-day-picker@8`, `date-fns/locale/tr` | `enUS`, week starts Monday for tr). Apply happens on preset click or when the second date is picked, with no separate Apply button. Mobile: a sheet with presets on top and a single-month calendar.
- **Mobile.** Search full width, then a "Filters (2)" button and a "Sort" button. Saved views become a horizontally scrollable strip (the one allowed horizontal scroll).

### 3.4 DataTable → cards on mobile
- Desktop: a real `<table>`, 1px border, radius 8, sticky 36px header (`caption` 12/500 `gray-500`, sentence case), 44px rows (36 in compact density), 13px text. Numbers are right-aligned and tabular. The first column is the row identity (thumbnail 32px + title + meta line).
- Row hover `gray-50`. Selected row `accent-50`. The checkbox column appears on hover or once any row is selected.
- Row click opens the DetailDrawer. Row actions are at most 2 icon buttons (32px, tooltips) shown on hover, plus `⋯`. **No colored icon buttons**: the red trash icon moves into `⋯`.
- **BulkActionBar.** When rows are selected, the FilterBar is replaced in place by "12 selected · [Create labels] [Edit] [⋯] · Clear". It has one primary.
- **Column defs carry their mobile role:** `mobile: 'title' | 'subtitle' | 'meta' | 'status' | 'trailing' | 'hidden'`. On `< md` the same `rows` + `columns` render as cards (16px padding, 1px separators, no shadows):
  ```
  [img] Title (title)                         [StatusPill] (status)
        Subtitle (subtitle)                   ₺1.109,30   (trailing)
        meta · meta · meta (meta, joined with ·)
  ```
  Tapping a card opens the full-screen sheet version of the same drawer. Swipe actions are not used, because they are not discoverable.
- Loading: 8 skeleton rows that match the column widths. Empty: `EmptyState` inside the table frame. Pagination: cursor-based "Load more" for synced data, or a numbered footer ("1–50 of 214  ‹ ›") for local data. Rows are virtualized above 200.
- Implementation: a headless table (simple custom renderer, `@tanstack/react-virtual` only if needed). MUI X DataGrid is retired from list pages because it fails on mobile; it may remain in admin-only pages.

### 3.5 Detail side panel (`DetailDrawer`)
```
┌───────────────────────────────────────────────┐
│ ‹ ›  Order #4512  [Awaiting shipment]  ⋯   ✕ │  header 56px, border-bottom
│      Etsy · BelleCoutureGifts · 2 items       │  subtitle (caption)
├───────────────────────────────────────────────┤
│ Section title                       [Edit]   │  scrollable body, padding 20
│  key ............................... value   │  sections separated by 1px + 24px
│  key ............................... value   │
│                                               │
│ Section title                                 │
│  …                                            │
├───────────────────────────────────────────────┤
│ ⋯   Saved 2 min ago        [Secondary] [Primary] │ footer 64px sticky, border-top
└───────────────────────────────────────────────┘
```
- Widths: `sm` 440 (quick view), `md` 560 (order, label), `lg` 720 (messages thread, settings provider), `xl` 960 (listing editor). On mobile it is always a full-height bottom sheet with 12px top radius, a sticky header and a sticky footer.
- **Header.** `‹ ›` previous/next record (J/K), title (`heading` 16/600), one StatusPill, `⋯` overflow, close (Esc). The subtitle is a single caption line. Nothing else lives in the header; no unlabeled icons.
- **Body.** `DrawerSection`s (title 14/600 + optional description + optional section action as a text button), each separated by 24px and a 1px `gray-100` rule. A long body may show a sticky section index on the left at `xl` width only (listing editor).
- **Footer.** Exactly **one primary + one secondary**, right-aligned. `⋯` overflow on the left holds destructive and rare actions. Save state text is in the middle-left ("Draft saved · 3 changes not synced to Etsy"). **Footer buttons never number more than 2 visible.**
- Dirty guard: closing with unsaved changes opens a nested ConfirmDialog (z 1500) with "Keep editing / Discard".
- **Drawer vs page.** A drawer is for inspecting or editing one record without losing list context. A flow with more than about 6 sections or needing more than 960px (Create listing) is a full page.

### 3.6 Modal (`Modal`, `ConfirmDialog`)
- Use a modal **only** for confirmations and short forms (≤ 3 fields, no scrolling). Anything longer is a drawer.
- Widths are 400 (confirm) and 560 (short form). Layout: title (`heading`), body (14px, max 3 lines), footer right-aligned: secondary "Cancel" + primary, or `danger` for destructive.
- Irreversible bulk destructive actions (delete 12 listings, a queued Etsy `delete`) require typing the count or the word shown. Single deletes do not.
- Never open a modal from page load. Never stack more than one modal over a drawer.
- "Add manual order" (currently a centered modal with many fields) becomes a `DetailDrawer` (md).

### 3.7 Form field rules (`FormField`)
- **Label above** the control (13px/500 `gray-900`), 6px gap. Labels never float. Optional fields are marked "(optional)" in `gray-500`, and required fields get no asterisk; most fields are required.
- **Helper text** below (12px `gray-500`, at most 1 line). **Inline validation**: the error replaces the helper (12px `danger.fg` + 12px alert icon), and the border turns `danger`. Validate on blur; once a field is invalid, re-validate on change. On submit, scroll to the first error and focus it.
- **Heights.** Every single-line control is 40px (`control-md`), or 44 on mobile. Selects, comboboxes, date triggers and number fields share that height.
- **Width by content** (inside the 880 form column): short (postal code, qty, price) 160–240px, medium (name, city, select) 400px, long (title, address line, URL) 100% up to 640px. Two-column rows only for natural pairs (City / Postal code, Key / Secret, Weight / Unit).
- **Textarea** auto-grows from 4 rows up to 16, then the page scrolls (not the field). Character counters sit right-aligned in the label row ("94 / 140"), turning `warning` at 90% and `danger` over the limit.
- Units and currency go in adornments (`₺`, `kg`, `.myshopify.com`), never in the label.
- Prefill from data we already have (the phone from the order, the country as an ISO select with flag + name, never free text "TR"). Currency defaults to the seller's base currency (TRY for TR sellers).
- **Field i18n.** Every label, helper and error comes from `useTranslations`. DS components accept strings only; they contain no copy of their own except accessible defaults, which come from the `ds.*` namespace.

### 3.8 Buttons
| Variant | Look | Use |
|---|---|---|
| `primary` | `accent-600` fill, white text, hover `accent-700` | The one main action per view |
| `secondary` | white, 1px `gray-300`, `gray-900` text, hover `gray-50` | Everything else that is a button |
| `ghost` | transparent, `gray-700` text, hover `gray-100` | Toolbars, tertiary, "Cancel" in tight spots, icon buttons |
| `danger` | `danger.solid` fill, white | **Only** as the confirm button in a destructive ConfirmDialog |
| `danger-ghost` | transparent, `danger.fg` text | Destructive item inside menus/overflow |

- Sizes: `sm` 32px (13px text, 10px padding-x), `md` 40px (14px, 14px padding-x). Mobile md renders at 44px.
- Icons are 16px lucide placed leading. A trailing chevron marks menus only.
- **Never uppercase, never gradients, never shadows, never `translateY`.** Labels are verb-first sentence case ("Create label", "Sync to Etsy"), at most 3 words.
- Loading: the label stays, a 14px spinner replaces the leading icon, and the width is locked. Disabled buttons show a tooltip explaining why ("Add a weight to get rates").
- Icon-only buttons (`IconButton`) require `label` (tooltip + aria-label). A row of icon buttons has at most 3 before `⋯`.
- Links look like links (`accent-600`, underline on hover) and navigate. Buttons act. A message such as "This order already has a tracking number" is **never** a button: it is a `Banner`.

### 3.9 StatusPill (fixed vocabulary)
22px tall, `caption` 12/500, 6px dot, radius full, bg/fg from §2.1. A **row shows one pill per dimension, at most 2 pills.** The raw marketplace status appears in the pill's tooltip ("Etsy: paid, unshipped").

| Domain | Status key | Label EN / TR | Tone |
|---|---|---|---|
| Order | `new` | New / Yeni | info |
| | `awaiting_shipment` | Awaiting shipment / Gönderim bekliyor | warning |
| | `label_created` | Label created / Etiket oluşturuldu | info |
| | `shipped` | Shipped / Kargoda | neutral |
| | `delivered` | Delivered / Teslim edildi | success |
| | `on_hold` | On hold / Beklemede | warning |
| | `cancelled` | Cancelled / İptal | neutral (strikethrough-free, muted) |
| | `problem` | Problem / Sorun | danger |
| Label | `label_failed` | Label failed / Etiket hatası | danger |
| Listing | `active` | Active / Yayında | success |
| | `draft` | Draft / Taslak | neutral |
| | `inactive` | Inactive / Pasif | neutral |
| | `sold_out` | Sold out / Tükendi | warning |
| | `expired` | Expired / Süresi doldu | warning |
| Sync (listing drafts) | `changes_pending` | Unsynced changes / Senkronize edilmedi | info |
| | `syncing` | Syncing / Senkronize ediliyor | info + pulsing dot |
| | `sync_failed` | Sync failed / Senkron hatası | danger |
| | `conflict` | Conflict / Çakışma | danger |
| Connection | `connected` | Connected / Bağlı | success |
| | `reconnect` | Reconnect needed / Yeniden bağlan | warning |
| | `not_connected` | Not connected / Bağlı değil | neutral |
| Messages | `unread` | Unread / Okunmadı | info |
| | `needs_reply` | Needs reply / Yanıt bekliyor | warning |

- The mapping from raw marketplace states lives in `lib/ds/status/{orders,listings,connections}.ts` (pure functions with unit tests). "Awaiting Fulfillment" + "Received" collapse into one `awaiting_shipment`. Amazon "Shipped" is mapped correctly, so the "Needs label" view excludes it.
- Labels come from i18n keys `status.<domain>.<key>`. Pills never use CSS uppercase.

### 3.10 Score indicator (one representation for listing quality everywhere)
```
 inline (table):   82 ▮▮▮▮▯        panel header:   Listing score  82 / 100  ▮▮▮▮▮▮▮▮▯▯  Good
```
- **Scale.** 0–100 integer, always. Letter grades, rings, filled squares and outline boxes are removed.
- **Visual.** The number (`body-strong`, tabular) + a 5-segment bar 40×6px (or a continuous 10-segment bar in the panel). Bands: 0–49 `danger` "Needs work", 50–74 `warning` "Fair", 75–89 `accent` "Good", 90–100 `success` "Excellent". The band label is shown in the panel and the tooltip, not inline.
- **One engine.** `lib/listingScore/` exposes `scoreListing(listing, marketplace): { score, band, checks: Check[] }`, where `Check = { id, label, status: 'pass'|'warn'|'fail', impact: number, fix?: { label, action } }`. Rules differ per marketplace (Etsy: 13 tags, title 100–140 chars Title Case, ≥ 5 photos, attributes; eBay: item specifics, 65-char aspects; Trendyol: required attributes, images), but the output and display are identical.
- **`ScorePanel`.** Checks sorted by impact, each with a one-click fix ("Generate 4 more tags", "Add alt text to 3 photos"). Clicking a fix scrolls to and focuses the field in the editor.
- The score never claims what we do not measure: if research data is missing, the checks that depend on it show `n/a`, they are not counted, and the denominator is stated ("Scored on 9 of 12 checks").

### 3.11 Money, number and date formatting
All formatting goes through `lib/ds/format.ts`. The locale comes from the UI language (`tr` → `tr-TR`, `en` → `en-US`). The currency comes from the data.

| Kind | Rule | tr-TR | en-US |
|---|---|---|---|
| Money | `Intl.NumberFormat(locale, { style:'currency', currency, currencyDisplay:'narrowSymbol' })`. **Symbol, never ISO code.** Always 2 decimals except JPY/KRW (0). | `₺1.109,30` · `$169,99` · `€24,00` | `₺1,109.30` · `$169.99` · `€24.00` |
| Money (KPI compact) | `notation:'compact'` only for ≥ 100,000 and only in KPI tiles. The full value goes in the tooltip. | `₺1,07 Mn` | `₺1.07M` |
| Mixed currencies | Never sum different currencies silently. Either show per-currency totals or convert to the base currency with a `≈` prefix and "Converted at TCMB rate, 15 Oct" in the tooltip. | `≈ ₺1.070.860` | `≈ ₺1,070,860` |
| Numbers | `Intl.NumberFormat(locale)`; percentages `style:'percent', maximumFractionDigits:1` | `12.480` · `%4,2` | `12,480` · `4.2%` |
| Deltas | Sign + percent, colored `success/danger` only in KPI deltas; arrow icon | `▲ %12,4` | `▲ 12.4%` |
| Date (same year) | `day:'numeric', month:'short'` | `15 Eki` | `Oct 15` |
| Date (other year) | + `year:'numeric'` | `15 Eki 2025` | `Oct 15, 2025` |
| Date-time | + `hour/minute`, locale hour cycle (24h tr, 12h en-US) | `15 Eki 22:59` | `Oct 15, 10:59 PM` |
| Relative | `< 7 days`: `Intl.RelativeTimeFormat` ("4 dk önce", "Yesterday"); otherwise absolute. Absolute value always in the tooltip. | `4 dk önce` | `4 min ago` |
| Deadline (ship-by) | One phrase + tone: overdue = danger, < 24h = warning. **Never relative + absolute together in visible text.** | `Bugün 22:59'a kadar` | `Ship by today 10:59 PM` |
| IDs / tracking | Mono, with `CopyButton` on hover | `1Z999AA10123456784` | |

Times display in the seller's timezone (account setting, default `Europe/Istanbul`), never the server's.

### 3.12 Empty, error, loading
- **EmptyState** has 3 kinds, each with one action:
  - `first-use`: "Connect Etsy to see your listings" + [Connect Etsy] (uses `LogoTile`).
  - `no-results`: "No orders match these filters" + [Clear filters].
  - `done`: "All orders have labels" (no action, quiet check icon).
  Layout: 40px icon tile (`gray-100`, 20px `gray-500` icon), title 14/600, body 13px `gray-600` (max 2 lines, max-width 400), centered in the container with 48px padding. No illustrations, no colored blobs.
- **ErrorState** (whole region failed): title "Couldn't load orders", the human cause if known ("Etsy didn't respond"), [Try again] + a "Copy error ID" link. Raw JSON and stack traces never reach the UI.
- **Banner** (partial or contextual problem, inline at the top of the region it affects): tone info/warning/danger, 1px border + bg, 14px text, optional single action, dismissible if not blocking. Example: "Etsy API restriction: messages can't be synced." The settings page's giant yellow box becomes a `warning` Banner on the Etsy tile only.
- **Loading.** Show skeletons that match the final layout (table rows, KPI tiles, drawer sections) after a 200ms delay, so fast loads never flash. Spinners are only for inline buttons. **No stuck states:** any load still pending after 15s replaces the skeleton with "Still loading… [Retry]", and background syncs report progress through PageHeader `meta` ("Syncing Etsy · 120 / 340"), never as a permanent banner.

### 3.13 Toasts
- Wrap `react-hot-toast` in `useToast()`. Desktop bottom-right, mobile bottom above the tab bar (`bottom: calc(var(--kx-bottom-nav) + 8px)`).
- One visible at a time, the rest queued. Success/info auto-dismiss after 4s. Errors persist until dismissed and carry an action ("Retry", "View details").
- Text is ≤ 80 characters and one sentence, from i18n. **Never** raw API errors, JSON or AI output in a toast: validate and truncate, with details in a drawer.
- Use a toast only for results of actions the user just took that are not visible on screen. If the result is visible (a row's pill changes), no toast. Reversible actions offer **Undo** for 6s ("Listing deactivated · Undo").

### 3.14 Icons
- **One set: `lucide-react`**, 16px in controls and tables, 18px in nav, 20px in empty states, `strokeWidth={1.75}`, color inherits (`gray-600` default). `@mui/icons-material` is banned in new code and migrated out (74 files).
- Brands are never icons. Marketplaces and carriers always render `LogoTile` with real SVGs. Carrier choice buttons show logos (FedEx/UPS/DHL), not plain text.
- Every icon conveys one meaning across the app (registry in `lib/ds/icons.ts`: `sync = RefreshCw`, `label = Tag`, `order = Receipt`, `listing = LayoutGrid`, `research = Telescope` …). No icon may be reused for a different meaning.

### 3.15 Command palette (center of navigation)
- ⌘K / Ctrl K anywhere, and `/` focuses page search. The palette (640px, radius 12, `elev-2`, z 1450) has sections: **Actions** (context-aware: on an order "Create label", "Copy tracking"; globally "New listing", "Sync all stores"), **Go to** (every nav item + settings sections + `?provider=` drawers), **Search** (orders by #/buyer/tracking, listings by title/SKU, across marketplaces with `LogoTile`), **Recent**.
- Navigation shortcuts: `G H` home, `G O` orders, `G L` listings, `G M` messages, `G R` research; `C` creates in context; `J/K` move rows, `Enter` opens, `E` edits, `⌘Enter` submits the drawer primary, `Esc` closes.
- Page primary/secondary/overflow actions passed to `PageHeader` auto-register into the palette (`usePageActions`). Nothing is palette-only, and nothing in a header is missing from the palette.

---

## 4. Component inventory (`components/ds/*`)

Shared types: `type Tone = 'success'|'warning'|'danger'|'info'|'neutral'`, `type Size = 'sm'|'md'`, `type Marketplace = 'etsy'|'ebay'|'amazon'|'shopify'|'wix'|'trendyol'|'hepsiburada'`, `type Carrier = 'fedex'|'ups'|'dhl'|'shippo'`, `type Action = { id?: string; label: string; icon?: LucideIcon; onClick?: () => void; href?: string; shortcut?: string; disabled?: boolean | string /* tooltip reason */; tone?: 'default'|'danger'; loading?: boolean }`.

All components: forward `className` and `data-testid`, accept `sx` only on layout primitives, contain no hard-coded user-facing strings, and are covered by a Vitest render test plus a Playwright visual snapshot in `/design-system` (an internal route listing every component and state).

### Foundations
| File | Component | Props |
|---|---|---|
| `lib/ds/tokens.ts` | tokens | see §2.11 |
| `lib/ds/theme.ts` | `theme` | MUI theme, §2.12 |
| `lib/ds/format.ts` | `formatMoney(amount, currency, opts?)`, `formatNumber`, `formatPercent`, `formatDate(date, { style: 'short'|'long'|'datetime' })`, `formatRelative`, `formatDeadline`, `useFormatters()` (binds locale + timezone) | — |
| `lib/ds/status/*.ts` | `orderStatus(raw, marketplace): StatusKey`, `listingStatus`, `connectionStatus` | — |
| `lib/ds/icons.ts` | semantic icon registry | — |
| `lib/listingScore/index.ts` | `scoreListing(listing, marketplace)` | §3.10 |
| `lib/text/decodeEntities.ts` | used in every mapper | — |

### Shell & page
| File | Component | Props |
|---|---|---|
| `components/ds/AppShell.tsx` | `AppShell` | `{ children; nav: NavGroup[]; user; collapsed?: boolean; onCollapsedChange? }` |
| `components/ds/Sidebar.tsx` | `Sidebar`, `NavItem` | `NavGroup = { id; label?: string; items: NavItemDef[]; bottom?: boolean }`, `NavItemDef = { href; label; icon?: LucideIcon; logo?: Marketplace|Carrier; count?: number; attention?: boolean; shortcut?: string; requires?: Marketplace[] }` |
| `components/ds/TopBar.tsx` | `TopBar` | `{ backHref?: string; mobileTitle?: string }` |
| `components/ds/MobileTabBar.tsx` | `MobileTabBar` (refactor of existing) | `{ items: { key; label; icon; href?; badge?: number; onClick? }[] }` (max 5) |
| `components/ds/Page.tsx` | `Page` | `{ title: string; width: 'list'|'dashboard'|'form'|'reading'; children }` |
| `components/ds/PageHeader.tsx` | `PageHeader` | `{ title; subtitle?; primaryAction?: Action; secondaryActions?: Action[] /* ≤2 */; overflowActions?: Action[]; meta?: ReactNode; backHref?: string; tabs?: TabDef[] }` |
| `components/ds/Section.tsx` | `Section` | `{ title?; description?; action?: Action; children; divider?: boolean }` |
| `components/ds/Surface.tsx` | `Surface` (card) | `{ padding?: 0|4|5; as?: 'div'|'section'; interactive?: boolean; children }` |
| `components/ds/SettingsLayout.tsx` | `SettingsLayout` | `{ nav: { group; items: { key; label; icon; dot?: 'warning'|'unsaved' }[] }[]; active: string; onChange(key) }` (per settings spec) |

### Data display
| File | Component | Props |
|---|---|---|
| `components/ds/DataTable.tsx` | `DataTable<T>` | `{ rows: T[]; columns: Column<T>[]; getRowId(row): string; loading?; error?: ReactNode; empty?: ReactNode; onRowClick?(row); selectable?: boolean; selected?: string[]; onSelectedChange?; bulkActions?: Action[]; density?: 'compact'|'comfortable'; sort?: { key; dir }; onSortChange?; pagination?: { mode: 'cursor'; hasMore; onLoadMore } | { mode: 'pages'; page; pageSize; total; onPageChange }; rowActions?(row): Action[] }`. `Column<T> = { key; header: string; width?: number|string; align?: 'left'|'right'; sortable?; render?(row): ReactNode; mobile?: 'title'|'subtitle'|'meta'|'status'|'trailing'|'media'|'hidden' }` |
| `components/ds/BulkActionBar.tsx` | `BulkActionBar` | `{ count: number; primary?: Action; actions?: Action[]; onClear() }` |
| `components/ds/KeyValueList.tsx` | `KeyValueList` | `{ items: { label; value: ReactNode; copy?: string }[]; columns?: 1|2 }` |
| `components/ds/StatusPill.tsx` | `StatusPill` | `{ domain: 'order'|'listing'|'sync'|'connection'|'message'|'label'; status: StatusKey; rawTooltip?: string; size?: 'sm'|'md' }` (label from i18n, tone from vocabulary; no free-form `label` prop) |
| `components/ds/ScoreMeter.tsx` | `ScoreMeter` | `{ score: number|null; variant?: 'inline'|'panel'; checksUsed?: number; checksTotal?: number; onClick? }` |
| `components/ds/ScorePanel.tsx` | `ScorePanel` | `{ result: ScoreResult; onFix(check) }` |
| `components/ds/Money.tsx` | `Money` | `{ amount: number|string|null; currency: string; compact?: boolean; approx?: boolean; tooltip?: string }` |
| `components/ds/NumberText.tsx` | `NumberText` | `{ value: number|null; style?: 'decimal'|'percent'; compact?: boolean }` |
| `components/ds/DateText.tsx` | `DateText`, `RelativeTime`, `Deadline` | `{ value: Date|string; format?: 'short'|'long'|'datetime' }`, `{ value }`, `{ value; label: 'shipBy'|'due' }` |
| `components/ds/StatTile.tsx` | `StatTile` (replaces `ui/StatCard`) | `{ label; value: ReactNode; delta?: { value: number; goodWhen: 'up'|'down' }; hint?: string; source?: string; loading? }` (neutral surface only) |
| `components/ds/Chart.tsx` | `LineChart`, `BarChart`, `DonutChart` (ApexCharts wrappers with DS theme) | `{ series; categories?; format: 'money'|'number'|'percent'; currency?; height?: number }` (**single y-axis only**; dual-axis is disallowed, use two small charts) |
| `components/ds/Sparkline.tsx` | `Sparkline` | `{ values: number[]; tone?: 'accent'|'neutral' }` |
| `components/ds/LogoTile.tsx` | `LogoTile` | `{ brand: Marketplace|Carrier|'parasut'|'veeqo'|'chrome'; size?: 16|20|24|32|40; label?: string /* a11y */ }` |
| `components/ds/Avatar.tsx` | `Avatar` | `{ name; src?; size?: 24|32|40 }` (deterministic neutral tint fallback) |
| `components/ds/Thumb.tsx` | `Thumb` | `{ src?; alt; size?: 32|40|56|80; count?: number }` (neutral placeholder, never "-") |
| `components/ds/CopyText.tsx` | `CopyText` (wraps `ui/CopyButton`) | `{ value; mono?: boolean; truncate?: number }` |
| `components/ds/SourceNote.tsx` | `SourceNote` | `{ source: string; fetchedAt: Date; sample?: number; confidence?: 'high'|'medium'|'low' }` (mandatory on research metrics) |
| `components/ds/UsageMeter.tsx` | `UsageMeter` | `{ label; used; limit: number|'unlimited' }` |

### Inputs & actions
| File | Component | Props |
|---|---|---|
| `components/ds/Button.tsx` | `Button` | `{ variant?: 'primary'|'secondary'|'ghost'|'danger'|'danger-ghost'; size?: Size; icon?: LucideIcon; trailingIcon?: LucideIcon; loading?; disabled?: boolean|string; href?; onClick?; type?; fullWidth?; children: string }` |
| `components/ds/IconButton.tsx` | `IconButton` | `{ icon: LucideIcon; label: string /* required */; size?: Size; variant?: 'ghost'|'secondary'; shortcut?; onClick? }` |
| `components/ds/OverflowMenu.tsx` | `OverflowMenu` | `{ actions: Action[]; label?: string; align?: 'start'|'end' }` (danger actions forced last, separated) |
| `components/ds/FormField.tsx` | `FormField` | `{ label; htmlFor; optional?: boolean; helper?: string; error?: string; counter?: { value: number; max: number }; width?: 'short'|'medium'|'long'|'full'; children }` |
| `components/ds/TextField.tsx` | `TextField` | `{ value; onChange; placeholder?; prefix?: ReactNode; suffix?: ReactNode; size?: Size; invalid?; type?: 'text'|'email'|'tel'|'url'|'password' }` (inside `FormField`) |
| `components/ds/TextArea.tsx` | `TextArea` | `{ value; onChange; minRows?: 4; maxRows?: 16; preview?: 'plain'|'none' }` |
| `components/ds/NumberField.tsx` / `MoneyField.tsx` | `NumberField`, `MoneyField` | `{ value: number|null; onChange; min?; max?; step?; unit?: string }`, `{ … ; currency: string }` (locale-aware parsing of `1.109,30`) |
| `components/ds/Select.tsx` | `Select<T>` | `{ value; onChange; options: { value: T; label; icon?; logo? }[]; placeholder?; size? }` |
| `components/ds/Combobox.tsx` | `Combobox<T>` | `{ value; onChange; loadOptions?(q): Promise<Option[]>; options?; multiple?; creatable?; placeholder? }` (taxonomy search, tags) |
| `components/ds/CountrySelect.tsx` | `CountrySelect` | `{ value: string /* ISO-2 */; onChange }` |
| `components/ds/TagInput.tsx` | `TagInput` | `{ value: string[]; onChange; max?: number; maxLength?: number; separators?: string[]; validate?(tag): string|null }` (Etsy 13 × 20) |
| `components/ds/Checkbox.tsx`, `Switch.tsx`, `RadioGroup.tsx`, `RadioCards.tsx` | — | standard; `RadioCards` `{ value; onChange; options: { value; title; description?; trailing?: ReactNode; logo? }[] }` (carrier/service picker) |
| `components/ds/SegmentedControl.tsx` | `SegmentedControl` | `{ value; onChange; options: { value; label; icon? }[]; size? }` (2–4 options; not for filters) |
| `components/ds/Tabs.tsx` | `Tabs` | `{ value; onChange; tabs: { value; label; count?: number }[] }` (≤ 5; beyond that use a section nav) |
| `components/ds/SearchInput.tsx` | `SearchInput` | `{ value; onChange; placeholder; shortcut?: '/'; debounceMs?: 250 }` |
| `components/ds/DateRangePicker.tsx` | `DateRangePicker` | `{ value: { from: Date; to: Date; preset?: PresetKey }; onChange; presets?: PresetKey[]; min?; max?; size? }` |
| `components/ds/DatePicker.tsx` | `DatePicker` | `{ value: Date|null; onChange; min?; max? }` (same popover, single month) |
| `components/ds/ImageGrid.tsx` | `ImageGrid` | `{ images: { id; src; alt?; pending?: 'upload'|'delete' }[]; onReorder; onAdd; onRemove; onAltChange; max?: number }` (wraps existing ImageManager logic) |

### Filtering
| File | Component | Props |
|---|---|---|
| `components/ds/FilterBar.tsx` | `FilterBar` | `{ search?: { value; onChange; placeholder }; filters: FilterDef[] /* first 3 visible */; values: Record<string, unknown>; onChange(values); sort?: { options; value; onChange }; density?: { value; onChange }; trailing?: ReactNode }`. `FilterDef = { key; label; type: 'select'|'multiselect'|'daterange'|'boolean'|'range'; options?; pinned?: boolean }` |
| `components/ds/FilterChip.tsx` | `FilterChip` | `{ label; valueLabel?: string; onClick; onClear? }` |
| `components/ds/FiltersSheet.tsx` | `FiltersSheet` | `{ open; onClose; filters; values; onApply; onReset }` |
| `components/ds/SavedViews.tsx` | `SavedViews` | `{ views: { id; label; count?: number; builtIn?: boolean }[]; active: string; onChange(id); onSave?(label); onRename?; onDelete? }` |
| `lib/ds/useUrlFilters.ts` | `useUrlFilters(schema)` | URL ↔ filter state |

### Overlays & feedback
| File | Component | Props |
|---|---|---|
| `components/ds/DetailDrawer.tsx` | `DetailDrawer` | `{ open; onClose; width?: 'sm'|'md'|'lg'|'xl'; title: string; subtitle?: string; status?: { domain; status }; onPrev?; onNext?; overflowActions?: Action[]; primaryAction?: Action; secondaryAction?: Action; footerNote?: ReactNode; dirty?: boolean; sectionNav?: { id; label }[]; children }` |
| `components/ds/DrawerSection.tsx` | `DrawerSection` | `{ id?; title; description?; action?: Action; children; collapsible?: false }` (sections never start collapsed when they hold required fields) |
| `components/ds/Modal.tsx` | `Modal` | `{ open; onClose; title; children; size?: 'confirm'|'form'; primaryAction: Action; secondaryAction?: Action }` |
| `components/ds/ConfirmDialog.tsx` | `ConfirmDialog` + `useConfirm()` (refactor of `ui/ConfirmDialog`) | `{ title; body; confirmLabel; tone?: 'default'|'danger'; typeToConfirm?: string }` → `Promise<boolean>` |
| `components/ds/Popover.tsx`, `Menu.tsx`, `Tooltip.tsx` | — | z-index preset per §2.8 |
| `components/ds/Banner.tsx` | `Banner` | `{ tone: Tone; title?; children; action?: Action; onDismiss? }` |
| `components/ds/Toast.ts` | `useToast()` | `{ success(msg, { undo? }); error(msg, { action? }); info(msg) }` |
| `components/ds/EmptyState.tsx` | `EmptyState` | `{ kind: 'first-use'|'no-results'|'done'; icon?: LucideIcon; logo?: Marketplace; title; body?; action?: Action }` |
| `components/ds/ErrorState.tsx` | `ErrorState` | `{ title; cause?: string; onRetry?(); errorId?: string }` |
| `components/ds/Skeleton.tsx` | `Skeleton`, `SkeletonRows`, `SkeletonTiles` | `{ width?; height?; radius? }`, `{ rows?: 8; columns }`, `{ count }` |
| `components/ds/SyncStatus.tsx` | `SyncStatus` | `{ source: Marketplace|'all'; lastSyncedAt?: Date; state: 'idle'|'syncing'|'failed'; progress?: { done; total }; onSync?() }` |
| `components/ds/Kbd.tsx` | `Kbd` | `{ keys: string[] }` |
| `components/ds/CommandPalette.tsx` | `CommandPalette` + `usePageActions(actions)` + `useCommand(cmd)` (refactor of existing) | `Command = { id; label; group: 'actions'|'goto'|'search'|'recent'; icon?; logo?; shortcut?; keywords?: string[]; run() }` |

### Domain compositions (built only from DS parts)
| File | Component | Props |
|---|---|---|
| `components/ds/domain/OrderRow.tsx` | columns + mobile card for orders | `columns(t, fmt): Column<Order>[]` |
| `components/ds/domain/ListingsPage.tsx` | `ListingsPage` | `{ marketplace: Marketplace; shopId?: string }` (one page for all 5 listing routes) |
| `components/ds/domain/ListingEditor.tsx` | `ListingEditor` | `{ marketplace; listingId; draftId? }` (sections + ScorePanel + Preview; staged-draft semantics preserved) |
| `components/ds/domain/CreateLabelDrawer.tsx` | `CreateLabelDrawer` | `{ order: Order; open; onClose; defaultCarrier?: Carrier }` (one structure for FedEx/UPS/DHL eCommerce) |
| `components/ds/domain/MarketplacePreview.tsx` | `MarketplacePreview` | `{ marketplace; listing; device?: 'desktop'|'mobile' }` |
| `components/ds/domain/ConversationList.tsx` | `ConversationList` | `{ items: { id; name; avatar?; marketplace; preview: string; at: Date; unread: boolean; needsReply: boolean }[]; activeId; onSelect }` |

`components/ui/*` stays as a shim that re-exports DS components until the migration is done, then it is deleted.

---

## 5. Visual findings → resolution

| # | Finding (visual_findings.md) | Resolved by |
|---|---|---|
| 1 | No shared page header; each page invents its own; "<Page> - KolayXport" in top bar; "Settings" twice | `Page` + `PageHeader` mandatory on every route; TopBar has **no title** (§3.1); browser `<title>` = "{Page} · KolayXport" set by `Page` |
| 2 | 4+ button styles: gradient, flat blue, green, uppercase, outline; no primary rule | `Button` with 5 variants, theme removes gradient/lift/uppercase (§2.12); P1 "one primary per view"; green buttons removed (green = success semantics only) |
| 3 | 3+ score representations (outline box, ring, letter grades, filled square) | One `ScoreMeter` 0–100 + bands + one `scoreListing` engine (§3.10) |
| 4 | Currency formatting inconsistent (`$169.99`, `₺1109.30`, `2999.00 TRY`, `TRY 1,070,860.03`, `₺163.7K`) | `Money` / `formatMoney`: Intl, narrowSymbol, locale grouping, compact only in KPI tiles with tooltip (§3.11) |
| 5 | Native date inputs next to MUI floating-label fields; mixed heights in one toolbar | `DateRangePicker` (react-day-picker), labels-above `FormField`, control height tokens with the "one height per row" rule (§2.4, §3.3, §3.7) |
| 6 | Mixed languages on one screen ("AI ile Optimize Et", "karakter", Turkish tips in EN UI) | DS components accept no hard-coded copy; ESLint `i18next/no-literal-string` on `components/**` + `pages/**`; AI commentary returned in UI locale (keywords stay English per policy) |
| 7 | Turkish uppercase bug "FAİLED", "RECEİVED" | P5 ban on `text-transform: uppercase` (stylelint), `overline` redefined, sentence-case vocabulary in StatusPill (§3.9) |
| 8 | Collapsed sidebar: identical cube/target icons | `NavItemDef.logo` renders `LogoTile` with real SVGs; unique-icon lint on `navConfig`; tooltip with label + shortcut (§3.1, §3.14) |
| 9 | Pages stretch to 1440+; 1400px-wide inputs | `Page width` variants with max widths (1600/1280/880/720) and `FormField width` (§3.2, §3.7) |
| 10 | Rainbow colors without meaning (10 colored KPI tiles, gradient heroes) | P2: neutral `StatTile` only, color limited to deltas; no gradients; chart palette ≤ 4 series (§2.1) |
| 11 | Raw HTML entities ("one&#39;s"), risk of pushing literal entity back | `decodeEntities` at mapper boundary + editor save uses decoded text (P5) |
| 12 | Overview: "All features free" banner contradicts paid tiers | Banner rules: banners only for actionable state; plan info lives in Settings › Plan; trial state as quiet `SyncStatus`-style meta in TopBar avatar menu |
| 13 | Overview: 6 nav tiles incl. removed "Sync" page; empty right half | Overview rebuilt as a "Today" dashboard: work queues + KPIs + connection health (wireframe §6.5); nav lives in nav + ⌘K only |
| 14 | Orders toolbar: 13 controls in 2 rows, mixed heights/styles | `FilterBar`: search + ≤3 filters + Filters sheet + sort/density; `SavedViews` replace ALL/UNLABELED segmented; Sync moves to header `meta`; Add manual order + ETGB move to header overflow (§3.3, §6.1) |
| 15 | Ship-by chip duplicates info ("Tomorrow 10/15/2026, 10:59 PM") | `Deadline` component: one phrase + tone, absolute in tooltip (§3.11) |
| 16 | Status chips "Awaiting Fulfillment" + "Received" unclear | Fixed vocabulary, one pill per dimension, raw status in tooltip; mapping in `lib/ds/status/orders.ts` (§3.9) |
| 17 | Tiny icon buttons, "+ Cost" chip | `IconButton` 32px min with required label/tooltip; cost becomes a column/inline editable field in the drawer, not a chip |
| 18 | "Already has tracking number" rendered as a green outline button | `Banner tone="info"` with tracking `CopyText` and "Create another label" text action (§3.8 rule: messages are never buttons) |
| 19 | Carrier buttons FedEx/UPS/MNG plain, no logos | `RadioCards` with `LogoTile` inside `CreateLabelDrawer` (§6.4) |
| 20 | "Delete order" on same row as primary actions | Destructive in `OverflowMenu`, last, red, with `useConfirm` (P1) |
| 21 | "Unlabeled" view shows Amazon Shipped orders; "Amazon Customer" with "-" image | Status mapping makes `shipped` exclude from "Needs label" view; `Thumb` neutral placeholder, buyer shows "Name hidden by Amazon" caption with info tooltip instead of fake name |
| 22 | FedEx drawer: uppercase title, gradient uppercase button, empty phone, free-text country, uneven grid, no sender summary, no rates | One `CreateLabelDrawer`: sentence case, single primary "Create label · ₺…", phone prefilled from order, `CountrySelect`, `FormField` widths, "Ship from" summary section, live rate `RadioCards` (§6.4) |
| 23 | UPS drawer: 4 collapsed accordions + "Save" | Same `CreateLabelDrawer`; `DrawerSection`s never collapsed when holding required fields; primary verb "Create label" |
| 24 | MNG drawer: third structure, titled "MNG Kargo" though DHL eCommerce | Same drawer; carrier name/logo from a carrier registry ("DHL eCommerce" with "formerly MNG Kargo" caption in settings only) |
| 25 | Add Manual Order: centered modal, USD default | Modal rule (≤3 fields) → becomes `DetailDrawer md`; currency defaults to seller base currency (§3.6, §3.7) |
| 26 | 4 different listing page layouts; two sync concepts; "View: Compact/Detailed/All" | One `ListingsPage marketplace=…`; one `SyncStatus` in header meta (pull from marketplace) vs "Sync N changes" as the BulkActionBar/Page primary for staged drafts (push); density control standard (§6.2) |
| 27 | eBay per-row pencil/copy/red trash | Row hover actions ≤2 ghost icons + `⋯`; delete in overflow (§3.4) |
| 28 | Trendyol column header "Filter by St…" bug, letter grades | DataTable column headers are static strings from columns def; filters live only in FilterBar; ScoreMeter |
| 29 | Wix filled-blue pill selection, "Wix Products" header inside content | Single selection style (`gray-100` + accent bar for nav; `accent-50` for rows); PageHeader only |
| 30 | Etsy editor: 9 tabs, Basics 4th | `ListingEditor` single scroll with section nav (Basics first), ordered by seller task frequency (§6.3) |
| 31 | Editor footer: 6 equal buttons + disabled "Save draft"; no "Sync to Etsy"; no saved/live status | Footer: primary "Sync to Etsy (N changes)", secondary "Preview", overflow (Copy, Schedule, Save as profile, Deactivate, Delete); autosave note "Draft saved 10s ago · Live version from 2 Oct" (§3.5) |
| 32 | Unlabeled undo + folder icons in header; "0 views · 0 favorites" | Header holds only title/status/prev-next/overflow/close; stats move to a "Performance" section, hidden when zero/unavailable |
| 33 | Description fixed-height inner scroll, raw entities, no preview | `TextArea` auto-grow 4–16 rows, decoded text, `MarketplacePreview` tab in right rail |
| 34 | "No research data — run market research first" orange corner warning | `ScorePanel` check with status `n/a` + fix action "Run keyword research" (inline, neutral); no orphan warnings |
| 35 | No live preview, no visible score | Right rail: `ScoreMeter` panel + `MarketplacePreview` (§6.3) |
| 36 | Messages: no preview, no unread, all "1m", generic avatar, empty right pane, unlabeled filters | `ConversationList` with preview line, unread weight + dot, `RelativeTime`, `Avatar` initials + `LogoTile` badge; empty pane shows "N need reply" queue; filters via `FilterBar` with labeled chips |
| 37 | Etsy research: purple hero, implausible "Trending niches" numbers, Turkish tips in EN UI, floating FAB | No heroes/FABs (AI entry via ⌘K and a page-level secondary action); `SourceNote` + sanity checks on every metric, "—" when implausible; i18n. Product rethink in §6.6 |
| 38 | eBay research: two search bars, two marketplace selectors, empty grey button, stuck loading banner, empty table | One `SearchInput` + one marketplace `Select` in FilterBar; 15s stuck-load rule; EmptyState kinds (§3.12) |
| 39 | Research tools "not useful" (founder) | Research reframed as 3 jobs (Product finder, Keyword explorer, Shop tracker), each a list page whose rows act ("Create listing from this", "Add tags to listing") (§6.6) |
| 40 | Analytics: top bar "Dashboard" vs nav "Reports"; gradient Refresh; `TRY 1,070,860.03`; dual-axis chart | Title from `Page` = nav label; `SyncStatus` instead of refresh button; `Money compact` in KPIs; single-axis charts only (§4 Chart) |
| 41 | Financials: gradient header, 10 rainbow KPIs, gradient balance cards, native dates + Apply, green Sync | `StatTile` neutral (max 4 in a row, 8 total, the rest in a table); `DateRangePicker` (no Apply); `SyncStatus` |
| 42 | Settings: duplicate titles, icon tab bar, big yellow restriction box, pale green rows, "Last sync 3 weeks ago" with no action | `SettingsLayout` left nav (per settings_spec), `IntegrationTile` with `LogoTile` + `StatusPill`, Banner scoped to Etsy tile, `SyncStatus` with Sync action |

---

## 6. Wireframes (ASCII)

Legend: `[Primary]` = accent button, `[Secondary]` = bordered, `(ghost)`, `⋯` = overflow, `[E]` `[e]` `[A]` `[T]` `[W]` `[S]` = LogoTile (Etsy/eBay/Amazon/Trendyol/Wix/Shopify), `●` = status dot.

### 6.1 Orders — desktop (list, max 1600)
```
┌────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar│ [⌘K  Search or jump to…                                       ]            ?   🔔   (TA)   │
│        ├──────────────────────────────────────────────────────────────────────────────────────────────┤
│        │ Orders                                                        [Sync ⟳]  ⋯   [＋ Create label]│
│        │ Synced 4 min ago · 6 stores                                                                  │
│        │                                                                                              │
│        │ [⌕ Order #, buyer, SKU, tracking   /] [Store ▾] [Carrier ▾] [Last 30 days ▾] [⚲ Filters]  Sort: Ship by ▾ ≡ │
│        │ All 214 · Needs label 12 · Ship today 5 · Problems 2 · Shipped 180          [+ Save view]  │
│        │ ┌──────────────────────────────────────────────────────────────────────────────────────────┐ │
│        │ │ ☐  Order                          Store       Ship by          Status            Total   │ │
│        │ ├──────────────────────────────────────────────────────────────────────────────────────────┤ │
│        │ │ ☐ [img] #4512 · Sarah Miller      [E] Belle   Today 22:59 ⚠   ● Awaiting shipment $169.99│ │
│        │ │         Personalized jewelry box ×2 · US                                       ⎙  ⋯     │ │
│        │ │ ☐ [img] #4511 · Ahmet Yılmaz      [T] Main    Tomorrow        ● Label created  ₺1.109,30 │ │
│        │ │         Wooden name puzzle · TR · DHL eCom 7341…  ⧉                                      │ │
│        │ │ ☐ [img] #113-552… · Name hidden   [A] US      16 Oct          ● Awaiting shipment $42.00 │ │
│        │ │         Baby keepsake box · US                                                            │ │
│        │ │ …                                                                                        │ │
│        │ ├──────────────────────────────────────────────────────────────────────────────────────────┤ │
│        │ │ 1–50 of 214                                                                    ‹   ›   │ │
│        │ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
│        │                                                                                              │
│        │ (selection replaces the FilterBar row:)                                                      │
│        │ 3 selected   [Create 3 labels]  [Print packing slips]  ⋯                          Clear ✕  │
└────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 ⋯ (header overflow): Add manual order · ETGB export · Export CSV
 Row click → Order DetailDrawer (md) with sections Items · Ship to · Shipping · Costs · Timeline;
 footer: ⋯ (Delete order, Mark shipped)  [View on Etsy]  [Create label]
```

### 6.1m Orders — mobile
```
┌──────────────────────────────┐
│ Orders                 ⌕   ⋯ │  TopBar 48 (title lives here on mobile)
├──────────────────────────────┤
│ [⌕ Search orders           ] │
│ [⚲ Filters 1]  [Sort ▾]      │
│ All 214 │Needs label 12│Ship… →  (scrollable views strip)
├──────────────────────────────┤
│ [img] #4512 · Sarah Miller    │
│       ● Awaiting shipment     │
│       [E] Belle · Today 22:59 ⚠ │
│       $169.99                 │
├──────────────────────────────┤
│ [img] #4511 · Ahmet Yılmaz    │
│       ● Label created          │
│       [T] Main · Tomorrow      │
│       ₺1.109,30               │
├──────────────────────────────┤
│            …                 │
├──────────────────────────────┤
│ [ ＋ Create label          ] │  primary, only when ≥1 needs label (sticky above tab bar)
├──────────────────────────────┤
│  ⌂     ▤      ▦      ✉     ≡ │  MobileTabBar 56 + safe area
│ Home Orders Listings Msgs More│
└──────────────────────────────┘
```

### 6.2 Listings (one page for all marketplaces) — desktop
```
┌────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar│ Etsy listings  [E] BelleCoutureGifts ▾                    [Import ⇩]  ⋯   [＋ New listing]  │
│        │ 342 listings · Synced from Etsy 12 min ago ⟳                                                  │
│        │                                                                                              │
│        │ ┌ Banner (info) ──────────────────────────────────────────────────────────────────────────┐  │
│        │ │ 7 listings have unsynced changes.                     [Review & sync 7 to Etsy]        │  │
│        │ └─────────────────────────────────────────────────────────────────────────────────────────┘  │
│        │ [⌕ Title, SKU, tag   /] [Status: Active ×] [Section ▾] [Score ▾] [⚲ Filters]   Sort: Score ↑ ≡ ▦│
│        │ All 342 · Active 318 · Low score 41 · Unsynced 7 · Sold out 6 · Expiring 3   [+ Save view] │
│        │ ┌──────────────────────────────────────────────────────────────────────────────────────────┐ │
│        │ │ ☐  Listing                                   Status        Score     Price   Stock  30d  │ │
│        │ ├──────────────────────────────────────────────────────────────────────────────────────────┤ │
│        │ │ ☐ [img] Personalized Wooden Jewelry Box, …   ● Active      82 ▮▮▮▮▯  $69.00   14   ╱╲_ │ │
│        │ │         SKU JB-01 · Jewelry boxes · 12 sales                          ✎  ⋯              │ │
│        │ │ ☐ [img] Baby Keepsake Box, Engraved Name, …  ● Unsynced    54 ▮▮▮▯▯  $49.00    8   _╱  │ │
│        │ │ ☐ [img] Wedding Card Box With Lock, …        ● Sold out    91 ▮▮▮▮▮  $89.00    0   ╲_  │ │
│        │ │ …                                                                                        │ │
│        │ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
│        │ 3 selected  [Edit in bulk]  [Improve with AI]  ⋯ (Copy to eBay, Deactivate, Delete)  Clear ✕│
└────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
 Same component for eBay / Trendyol / Wix / Shopify: header logo + shop switcher change, columns from
 `listingColumns(marketplace)`, ScoreMeter from `scoreListing(…, marketplace)`. "Edit in bulk" opens the
 full-page bulk grid (Vela-style spreadsheet: frozen title column, cells editable, staged changes highlighted
 in accent-50, footer "Sync 23 changes to Etsy").
```

### 6.2m Listings — mobile
```
┌──────────────────────────────┐
│ ‹  [E] Etsy listings  ⌕   ⋯  │
├──────────────────────────────┤
│ ┌ 7 unsynced changes  Review ›│
│ [⚲ Filters 1]  [Sort ▾]      │
│ All 342 │Active 318│Low score…→│
├──────────────────────────────┤
│ [img]  Personalized Wooden    │
│ 56px   Jewelry Box, …         │
│        ● Active    82 ▮▮▮▮▯    │
│        $69.00 · 14 in stock   │
├──────────────────────────────┤
│ [img]  Baby Keepsake Box, …   │
│        ● Unsynced  54 ▮▮▮▯▯    │
│        $49.00 · 8 in stock    │
├──────────────────────────────┤
│ [ ＋ New listing           ] │
├──────────────────────────────┤
│  ⌂     ▤      ▦      ✉     ≡ │
└──────────────────────────────┘
```

### 6.3 Listing editor — desktop (DetailDrawer xl 960, or full page at `/app/listings/etsy/[id]`)
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ ›  Personalized Wooden Jewelry Box…   ● Unsynced changes                          ⋯     ✕  │
│      [E] BelleCoutureGifts · Live version from 2 Oct · 3 fields changed                       │
├────────────────┬────────────────────────────────────────────────┬────────────────────────────┤
│ Basics       ● │ Basics                                         │ Listing score              │
│ Photos & video │  Title                                94 / 140 │ 82 / 100 ▮▮▮▮▮▮▮▮▯▯ Good   │
│ Price & stock  │  [Personalized Wooden Jewelry Box, Engraved…]  │ Scored on 11 of 12 checks  │
│ Variations     │  Title Case · commas only            (✦ Improve)│ ✕ Only 9 of 13 tags  +8    │
│ Category &     │                                                │   [Generate 4 tags]        │
│  details       │  Description                                   │ ⚠ 2 photos lack alt  +3    │
│ Personalization│  [ auto-growing textarea, decoded text …      ]│   [Write alt text]         │
│ Shipping       │  [                                            ]│ ✓ Title length             │
│ Tags & SEO   ● │                                                │ ✓ Price within market band │
│ Performance    │ Photos & video                         10 / 20 │ – Keyword demand  n/a      │
│                │  [■][■][■][■][■][■][■][■][■][■] [＋ Add]       │   [Run keyword research]   │
│                │  drag to reorder · click for alt text          │────────────────────────────│
│                │                                                │ Preview   (Desktop|Mobile) │
│                │ Price & stock                                  │ ┌────────────────────────┐ │
│                │  Price        Quantity     SKU                 │ │ [img]                  │ │
│                │  [$ 69.00 ]   [ 14   ]     [JB-01      ]       │ │ Personalized Wooden…   │ │
│                │                                                │ │ $69.00  ★★★★★          │ │
│                │ Tags & SEO                              9 / 13 │ └────────────────────────┘ │
│                │  [jewelry box ×][engraved box ×] … [+ add tag] │                            │
│                │  20 chars max · avoid repeating title words    │                            │
├────────────────┴────────────────────────────────────────────────┴────────────────────────────┤
│ ⋯   Draft saved 10 s ago · 3 changes not on Etsy             [Preview on Etsy ↗]  [Sync to Etsy] │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
 ⋯ overflow: Copy listing · Schedule sync · Save as profile · Discard draft · Deactivate · Delete listing (red, last)
 Section nav (scrollspy) replaces 9 tabs; dots mark sections with changes or failing checks.
 Conflict state: Banner (danger) above body: "Etsy changed this listing after your draft (2 Oct 14:02).
   [Compare]" — primary becomes "Review conflict", never a blind force.
 Header contains no unlabeled icons; undo lives in ⌘Z and the "Discard draft" overflow item.
```

### 6.3m Listing editor — mobile (full-height sheet)
```
┌──────────────────────────────┐
│ ✕  Wooden Jewelry Box…   ⋯   │  sticky header
│    ● Unsynced · 82 ▮▮▮▮▯ ›   │  score chip opens ScorePanel sheet
├──────────────────────────────┤
│ Basics ▾  (jump-to sections)  │
├──────────────────────────────┤
│ Title               94 / 140 │
│ [Personalized Wooden Jewel…] │
│ (✦ Improve title)            │
│                              │
│ Description                  │
│ [                          ] │
│ [                          ] │
│                              │
│ Photos & video       10 / 20 │
│ [■][■][■][■] →               │
│ …                            │
├──────────────────────────────┤
│ Draft saved · 3 changes       │
│ [Preview]   [ Sync to Etsy  ] │  sticky footer 64 + safe area
└──────────────────────────────┘
```

### 6.4 Create-label drawer (one structure for FedEx / UPS / DHL eCommerce) — desktop (md 560)
```
┌────────────────────────────────────────────────────────┐
│ ‹ ›  Create label · #4512   ● Awaiting shipment   ⋯  ✕│
│      [E] Belle · Sarah Miller · 2 items · US           │
├────────────────────────────────────────────────────────┤
│ ┌ Banner (info, only if tracking exists) ─────────────┐│
│ │ This order already has tracking 1Z999AA1… ⧉         ││
│ │                           (Create another label)   ││
│ └─────────────────────────────────────────────────────┘│
│ Carrier                                                │
│ ┌──────────────┐┌──────────────┐┌──────────────────┐  │
│ │ [FedEx] FedEx││ [UPS] UPS    ││ [DHL] DHL eCom.  │  │  RadioCards with LogoTile
│ │ ◉            ││ ○            ││ ○ TR only        │  │
│ └──────────────┘└──────────────┘└──────────────────┘  │
│                                                        │
│ Ship to                                    (Edit)      │
│  Sarah Miller · +1 415 555 0134                        │
│  12 Market St, Apt 4, San Francisco CA 94103, 🇺🇸 US   │
│  ✓ Address validated                                    │
│                                                        │
│ Package                                                │
│  Preset            Weight         Dimensions (cm)      │
│  [Small box ▾]     [ 0.8 ] kg     [20]×[15]×[10]        │
│                                                        │
│ Service & rate                                          │
│  ◉ FedEx International Priority   2–3 days   ₺1.284,00 │
│  ○ FedEx International Economy    4–6 days     ₺962,50 │
│  ○ FedEx International Connect+   5–8 days     ₺811,20 │
│                                                        │
│ Customs (international)                     ETGB ✓     │
│  Item               HS code      Qty   Value           │
│  Jewelry box        4420.90      2     $69.00          │
│  Contents  [Merchandise ▾]   Duties  [Recipient pays ▾]│
│                                                        │
│ Ship from                                   (Change)   │
│  Belle Couture · İstanbul, TR · default sender profile │
├────────────────────────────────────────────────────────┤
│ ⋯              [Cancel]   [Create label · ₺1.284,00]   │
└────────────────────────────────────────────────────────┘
 ⋯: Save without buying · Mark shipped without label · Carrier settings
 Carrier-specific fields (UPS label options, DHL eCom. JWT two-step) are additional DrawerSections inside the
 same structure, never separate drawers. Disabled primary explains why on hover ("Add package weight").
```

### 6.4m Create label — mobile (full-height sheet)
```
┌──────────────────────────────┐
│ ✕  Create label · #4512   ⋯  │
├──────────────────────────────┤
│ Carrier                      │
│ ┌────────┐┌────────┐┌───────┐│
│ │[FedEx]◉││[UPS] ○ ││[DHL] ○││
│ └────────┘└────────┘└───────┘│
│ Ship to              (Edit)  │
│ Sarah Miller · +1 415 …      │
│ 12 Market St, San Fran… US   │
│ Package                      │
│ [Small box ▾]                │
│ [0.8] kg  [20][15][10] cm    │
│ Service                      │
│ ◉ Intl Priority  2–3 d ₺1.284│
│ ○ Intl Economy   4–6 d ₺962  │
│ Customs ›   Ship from ›      │
├──────────────────────────────┤
│ [ Create label · ₺1.284,00 ] │
└──────────────────────────────┘
```

### 6.5 Overview ("Today") — desktop (dashboard, max 1280)
```
┌────────┬────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar│ Good morning, Tamsar                                     Last 30 days ▾            │
│        │ Wednesday, 15 Oct · All stores synced 4 min ago                                     │
│        │                                                                                    │
│        │ ┌ Needs you now ───────────────────────────────────────────────────────────────┐   │
│        │ │ 12 orders need a label (5 ship today)                      [Create labels]   │   │
│        │ │  3 messages need a reply                                         Open ›      │   │
│        │ │  7 listings have unsynced changes                                Review ›    │   │
│        │ │  1 connection needs reconnecting  [A] Amazon                      Fix ›      │   │
│        │ └──────────────────────────────────────────────────────────────────────────────┘   │
│        │                                                                                    │
│        │ ┌ Revenue ──────────┐┌ Orders ───────────┐┌ Avg. order ────────┐┌ Listings score ┐ │
│        │ │ ₺412,8 B          ││ 214               ││ ₺1.929             ││ 76 ▮▮▮▮▯       │ │
│        │ │ ▲ %12,4 vs prev.  ││ ▲ %8,1            ││ ▼ %2,3             ││ 41 below 50    │ │
│        │ │ ╱╲_╱‾╲_╱‾         ││ _╱‾╲_╱‾           ││ ‾╲_╱‾╲_            ││                │ │
│        │ └───────────────────┘└───────────────────┘└────────────────────┘└────────────────┘ │
│        │                                                                                    │
│        │ ┌ Revenue by store (single axis) ───────────────────┐┌ Top listings ─────────────┐ │
│        │ │  ▁▃▅▇▅▃▂▄▆▇█▆▄                                     ││ [img] Jewelry box  $2,140 │ │
│        │ │  ■ [E] Etsy  ■ [e] eBay  ■ [T] Trendyol  ■ Other   ││ [img] Card box     $1,780 │ │
│        │ └────────────────────────────────────────────────────┘│ [img] Puzzle       ₺9.300 │ │
│        │                                                        └──────────────────────────┘ │
│        │ ┌ Store health ──────────────────────────────────────────────────────────────────┐ │
│        │ │ [E] Belle   ● Connected  4 min ago │ [T] Main ● Connected │ [A] US ● Reconnect │ │
│        │ └────────────────────────────────────────────────────────────────────────────────┘ │
└────────┴────────────────────────────────────────────────────────────────────────────────────┘
 Exactly one primary on the page ("Create labels"), which only appears when there is work.
 With zero connections the whole page is one EmptyState first-use: "Connect your first store" + LogoTile grid.
```

### 6.5m Overview — mobile
```
┌──────────────────────────────┐
│ Home                  ⌕  🔔  │
├──────────────────────────────┤
│ Needs you now                │
│ 12 orders need a label     › │
│  3 messages need a reply   › │
│  7 unsynced listings       › │
│ [A] Amazon: reconnect      › │
│ [ Create 12 labels         ] │
├──────────────────────────────┤
│ Last 30 days ▾               │
│ ┌─────────────┐┌────────────┐│
│ │Revenue      ││Orders      ││
│ │₺412,8 B     ││214         ││
│ │▲ %12,4      ││▲ %8,1      ││
│ └─────────────┘└────────────┘│
│ ┌─────────────┐┌────────────┐│
│ │Avg. order   ││Score       ││
│ └─────────────┘└────────────┘│
│ Revenue by store             │
│ ▁▃▅▇▅▃▂▄▆▇█                  │
├──────────────────────────────┤
│  ⌂     ▤      ▦      ✉     ≡ │
└──────────────────────────────┘
```

### 6.6 Research (product rethink, built on the same list pattern)
The founder's point is that the research tools are useless, so a reskin is not enough. Each research page must answer one seller question and end in an action inside KolayXport.

| Tool | Question it answers | Rows | Row actions |
|---|---|---|---|
| **Product finder** | "What should I make/sell next?" | niches with demand (search volume proxy), competition (listing count), price band (p25–p75, not "avg"), newcomer share, trend sparkline, `SourceNote` | Save to board · "Draft a listing" (opens creator prefilled) |
| **Keyword explorer** | "Which tags/title words win for this listing?" | keywords with est. demand, competition, appears-in-top-48 %, already-used-in-my-listings | Add to listing tags (picker) · Add to title |
| **Shop tracker** | "What are competitors doing?" | tracked shops with sales/day est., new listings, price changes, top movers | Open shop analysis · Compare with my listing |

```
┌────────┬──────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar│ Keyword explorer                                               ⋯   [Add to listing]   │
│        │ Etsy search data · refreshed 2 h ago · sample 48 listings per keyword                 │
│        │ [⌕ wooden jewelry box                         ] [Marketplace: [E] Etsy ▾] [US ▾] [⚲]  │
│        │ Suggested · Long-tail · Seasonal · Used in my shop          (views)                  │
│        │ ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│        │ │ ☐ Keyword                    Demand   Competition  Top-48 price   In my shop  Trend│ │
│        │ │ ☐ engraved jewelry box       ▮▮▮▮▯    ▮▮▯▯▯ low    $38–$72        ✓ 4 listings ╱‾ │ │
│        │ │ ☐ personalized keepsake box  ▮▮▮▯▯    ▮▮▮▯▯ med    $29–$55        —            _╱ │ │
│        │ │ ☐ halloween decor            —  (implausible sample, see note)                     │ │
│        │ └──────────────────────────────────────────────────────────────────────────────────┘ │
│        │ 2 selected → [Add 2 tags to…  Jewelry box ▾]                                          │
└────────┴──────────────────────────────────────────────────────────────────────────────────────┘
 No hero, no FAB, no "avg price" of skewed samples (use p25–p75); every metric is labeled with its source,
 and values that fail sanity checks (e.g. avg price > 10× category median) render "—" with the reason.
```

---

## 7. Rollout (suggested, so the system lands instead of becoming a 5th style)

1. **Foundation PR.** `lib/ds/tokens.ts`, `lib/ds/theme.ts` (swapped in `_app`), `styles/tokens.css`, `next/font`, the uppercase/gradient/shadow purge, the z-index table, and the parity test. This one PR fixes most of the "4 button styles" problem.
2. **Primitives.** Button, IconButton, FormField + inputs, StatusPill (+ status maps), Money/Date, LogoTile (+ SVGs), Banner, EmptyState/ErrorState/Skeleton, Toast, DetailDrawer, Modal, the `/design-system` route, and Playwright visual snapshots.
3. **Shell.** AppShell, Sidebar with logos, TopBar without title, MobileTabBar, Page/PageHeader, and ⌘K registration.
4. **Pages in order of daily use.** Orders + CreateLabelDrawer → ListingsPage (Etsy first, then the other 4 by config) + ListingEditor → Overview → Messages → Settings (per settings_spec) → Reports/Finance → Research rethink.
5. **Lint gates** switch from warn to error per directory once that directory is migrated: no `@mui/icons-material`, no raw `@mui/material` in pages, no literal strings, no `text-transform: uppercase`, no hex literals outside `lib/ds`.

# KolayXport Design System: "Merchant-friendly" proposal

Angle: Shopify Polaris-style. The target user is a non-technical Turkish seller who runs a shop from a phone between packing orders. The interface should be calm, use plain language, put one clear next step on each screen, give generous touch targets, and guide the user through empty states. "Better than Vela" means a seller needs fewer taps to ship, fix or improve a listing, not that we have more features on screen.

Status: proposal only. No app code was changed. Codebase read: `lib/theme.tsx`, `styles/globals.css`, `components/ui/*`, `components/AppLayout.js`, `components/MobileTabBar.tsx`, `lib/i18n/formatting.ts`, `lib/i18n/localeConfig.ts`, `public/logos/*`.

Facts about the current code that this proposal relies on:
- `@mui/material` is **^5.17.1** (not v8). `@mui/x-data-grid` is v8 and `@mui/x-date-pickers` is v6. The theme skeleton in §2.9 uses the v5 `createTheme` API, which carries forward unchanged to v6/v7 if we upgrade.
- Icons are split: `lucide-react` is used in ~64 files and `@mui/icons-material` in ~74 files.
- `lib/theme.tsx` makes every `contained` button a blue-to-indigo gradient with `translateY(-1px)` on hover. It also defines a purple `secondary` palette and gives `MuiPaper` both a border and a shadow. `globals.css` adds `.btn-primary` gradients and `.gradient-text`. These are where the "4 button styles" come from.
- Inter is loaded via a Google Fonts CSS `@import` (render-blocking). It is not loaded through `next/font`.
- `lib/i18n/formatting.ts` already has `formatCurrency/formatDate/formatNumber` keyed to `tr-TR` / `en-US`, but pages bypass it.
- `public/logos/` has etsy, amazon, trendyol, shopify, hepsiburada, woocommerce and n11. It has no eBay, Wix, FedEx, UPS, DHL or Paraşüt.
- The settings redesign draft (`settings_spec.md`) already uses labels above fields, 40px inputs, flat 1px-border cards, `StatusPill` and `LogoTile`. This proposal adopts those choices system-wide. Its primitives should live in `components/ds/*`, with `components/settings/ui/*` re-exporting from there, so we don't end up with a second mini design system.

---

## 1. Principles (6)

### P1. One obvious next step
- **Exactly one primary (filled) button per view.** A "view" is the page, or the drawer/modal on top of it. When a drawer is open, its footer owns the primary and the page primary is hidden behind the scrim.
- When a bulk selection is active, the bulk bar's main action becomes the primary and the page-header primary turns into a secondary.
- Destructive actions are never next to the primary. They go in the overflow menu (⋯), last, in red, and they always confirm.
- A page header shows at most **1 primary + 2 secondary** buttons. Everything else goes in ⋯.

### P2. Plain language, one language
- Every string goes through next-intl. Each screen is 100% EN or 100% TR, with no mixed strings. CI should fail if a TSX file has a raw string literal in JSX (eslint `react/jsx-no-literals` on `pages/app/**`, `components/**`).
- Turkish strings use correct characters (ı, İ, ş, ğ, ç, ö, ü), never ASCII-Turkish ("Olustur" is a bug).
- Use verbs that say what happens: "Send changes to Etsy" rather than "Sync", "Create label" rather than "Submit", "Reconnect Etsy" rather than "Re-auth". Glossary in §3.17.
- **No `text-transform: uppercase` anywhere.** This fixes "FAİLED" and "RECEİVED". Labels are written in sentence case in the message files. The theme sets `textTransform: 'none'` on Button, Tab, Chip, TableCell and overline.
- No jargon without an explanation. Words like ETGB, IOSS, SKU and HS code get a `(?)` tooltip on first use per screen.

### P3. Calm surfaces; color means something
- Surfaces are white with a 1px border and **no shadow**. Shadows are reserved for things that float: menu, popover, drawer, modal and toast.
- **No gradients**, ever: not on buttons, banners, KPI tiles, icons or text. Delete `.btn-primary`, `.gradient-text`, the gradient `contained*` overrides and the `secondary` purple.
- Color is used only for: the brand accent (primary action, focus, selection, links), semantic states (success/warning/danger/info), and marketplace logos inside `LogoTile`. A KPI tile is never colored just to be colored.
- Charts use the dataviz palette. One series is brand blue; additional series use the neutral-plus-one-accent scheme.

### P4. Same job, same layout
- Every list page uses `PageHeader` → `FilterBar` → `DataTable`/cards. Etsy, eBay, Trendyol, Wix, Shopify and Amazon listings are **one page component** with a marketplace switcher (§6.2), not five layouts.
- Every side panel uses `DetailDrawer`. Every carrier label flow uses one `CreateLabelDrawer` with carrier-specific field sets.
- There is one score representation (`HealthScore`), one status vocabulary (`StatusPill`), one money formatter (`<Money>`) and one date-range picker (`DateRangePicker`).

### P5. Thumb-first, then desktop-dense
- Touch targets are at least 44×44 on mobile (`pointer: coarse`). Desktop controls are 40px tall, and dense table row actions are 32px.
- Mobile inputs use 16px font so iOS doesn't zoom.
- The primary action on mobile lives in a sticky bottom bar above the tab bar, within thumb reach. It never sits only in the top-right.
- Tables turn into cards below 900px. Drawers turn into full-height bottom sheets below 600px. Multi-step choices use sheets, not dropdown menus.

### P6. Honest data, guided gaps
- Never show a number without its unit, currency and period ("₺1.109,30 · last 30 days").
- Research numbers show their source, sample size and freshness ("Based on 48 Etsy listings · updated 2h ago"). If confidence is low we say so, and implausible values are hidden instead of displayed. This targets the "$9995 avg Harvest Centerpiece" problem.
- Every empty state tells the user why it's empty and gives one action that fixes it. Every error says what failed and offers Retry. A skeleton is used for every load longer than 300ms. No surface is left blank.
- Text from marketplaces is HTML-entity-decoded once at the mapper boundary (`lib/text/decodeEntities.ts`) and stored decoded. The UI never renders or re-sends `&#39;`.

---

## 2. Tokens

All tokens live in one source file, `lib/ds/tokens.ts`. `lib/theme.tsx` imports from it, and `styles/globals.css` mirrors it in `@theme`. A Vitest test (`__tests__/ds/tokens-sync.test.ts`) parses `globals.css` and asserts every CSS variable equals the TS value, so the two can't drift.

### 2.1 Color

**Neutral scale** (cool slate, already used; kept for continuity)

| Token | Hex | Use |
|---|---|---|
| `neutral-0` | `#ffffff` | surface (cards, drawers, inputs) |
| `neutral-25` | `#fbfcfd` | table header, sticky footers |
| `neutral-50` | `#f8fafc` | app background |
| `neutral-100` | `#f1f5f9` | hover fill, subtle dividers, skeleton base |
| `neutral-200` | `#e2e8f0` | default border |
| `neutral-300` | `#cbd5e1` | input border, strong divider |
| `neutral-400` | `#94a3b8` | placeholder, disabled icon |
| `neutral-500` | `#64748b` | secondary text (4.8:1 on white) |
| `neutral-600` | `#475569` | icons, tertiary headings |
| `neutral-700` | `#334155` | secondary button text |
| `neutral-800` | `#1e293b` | tooltip bg |
| `neutral-900` | `#0f172a` | primary text |

**Brand accent: one blue.** Purple and indigo are removed.

| Token | Hex | Use |
|---|---|---|
| `brand-50` | `#eff6ff` | selected row, selected nav item bg |
| `brand-100` | `#dbeafe` | selected hover, focus halo |
| `brand-500` | `#3b82f6` | focus ring |
| `brand-600` | `#2563eb` | **primary button, links, active indicator** (5.2:1 with white) |
| `brand-700` | `#1d4ed8` | primary hover |
| `brand-800` | `#1e40af` | primary pressed |

**Semantic.** Each has `bg` (pill/callout fill), `border`, `fg` (text and icon on bg, AA) and `solid` (dot and solid buttons).

| Role | bg | border | fg | solid | Meaning |
|---|---|---|---|---|---|
| success | `#f0fdf4` | `#bbf7d0` | `#15803d` | `#16a34a` | done, live, connected, delivered |
| warning | `#fffbeb` | `#fde68a` | `#b45309` | `#f59e0b` | needs attention soon, not broken |
| danger | `#fef2f2` | `#fecaca` | `#b91c1c` | `#dc2626` | failed, overdue, destructive |
| info | `#ecfeff` | `#a5f3fc` | `#0e7490` | `#0891b2` | neutral news, in progress (cyan, so it never reads as "primary") |
| attention | `#fff7ed` | `#fed7aa` | `#c2410c` | `#ea580c` | "changes not sent yet" (unsynced drafts) |

Rule: semantic colors are used only by `StatusPill`, `Callout`, `HealthScore`, `Toast`, form validation and `UsageMeter`. They are never used for decoration.

**Marketplace and carrier brand colors.** These are used **only** inside `LogoTile` as the monogram fallback tint, and never for text, buttons, chips or charts.

| Brand | Color | Logo file (to add if missing) |
|---|---|---|
| Etsy | `#F1641E` | `public/logos/etsy.svg` ✓ |
| eBay | `#E53238` | `ebay.svg` (add) |
| Amazon | `#FF9900` | `amazon.svg` ✓ |
| Shopify | `#95BF47` | `shopify.svg` (replace .jpg) |
| Wix | `#000000` | `wix.svg` (add) |
| Trendyol | `#F27A1A` | `trendyol.svg` (replace .png) |
| Hepsiburada | `#FF6000` | `hepsiburada.svg` (replace .png) |
| FedEx | `#4D148C` | `fedex.svg` (add) |
| UPS | `#351C15` | `ups.svg` (add) |
| DHL eCommerce | `#FFCC00` | `dhl.svg` (add); replaces "MNG Kargo" naming in UI |
| Paraşüt | `#2D3748` | `parasut.svg` (add) |
| Veeqo / Shippo | `#6C2BD9` / `#1B1F3B` | add |

Logos come from each brand's official press kit, shown at their natural colors on a white tile. We don't recolor them.

### 2.2 Typography

Font: **Inter** via `next/font/google` with `subsets: ['latin', 'latin-ext']`. `latin-ext` covers ı, İ, ş, ğ. Use `display: 'swap'` and `variable: '--font-sans'`, and delete the CSS `@import`. Fallback stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`. Numbers in tables, money and KPIs use `font-variant-numeric: tabular-nums`.

Only three weights are allowed: 400, 500 and 600. There is no 700 or 800. Bold reads as shouting at these sizes.

| Token | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 28 / 36 | 600 | -0.02em | Overview greeting and the KPI hero number only |
| `heading-lg` (h1) | 22 / 28 (mobile 20 / 28) | 600 | -0.015em | page title (once per page) |
| `heading-md` (h2) | 17 / 24 | 600 | -0.01em | card/section title, drawer title |
| `heading-sm` (h3) | 15 / 22 | 600 | 0 | subsection, table group header |
| `body-md` | 14 / 20 | 400 | 0 | default UI text (desktop) |
| `body-lg` | 16 / 24 | 400 | 0 | mobile body and **all inputs on mobile** |
| `body-sm` | 13 / 18 | 400 | 0 | helper text, table secondary line, meta |
| `caption` | 12 / 16 | 500 | 0.01em | pill labels, group labels in sidebar (sentence case) |
| `kpi` | 24 / 32 | 600 | -0.01em | KPI tile values, tabular-nums |
| `mono` | 13 / 20 | 400 | 0 | tracking numbers, IDs (`ui-monospace, SFMono-Regular, Menlo`) |

Text colors: `neutral-900` primary, `neutral-500` secondary, `neutral-400` disabled/placeholder, `brand-600` links (underline on hover). Text is never lighter than `neutral-500` on white.

### 2.3 Spacing

The base unit is 4. The only allowed steps are `0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.

| Use | Value |
|---|---|
| Page gutter | 16 mobile / 24 tablet / 32 desktop |
| Between page header and content | 24 |
| Between cards/sections | 16 mobile / 24 desktop |
| Card padding | 16 mobile / 20 desktop |
| Form field vertical gap | 16 |
| Label → input gap | 6 |
| Inline control gap (toolbar) | 8 |
| Table cell padding | 12 horizontal / 10 vertical (comfortable), 6 vertical (compact) |

### 2.4 Radii

| Token | px | Use |
|---|---|---|
| `radius-xs` | 4 | checkbox, tiny tags |
| `radius-sm` | 8 | buttons, inputs, selects, menu items, thumbnails |
| `radius-md` | 12 | cards, drawer inner sections, popovers, logo tiles (10 on 40px tile) |
| `radius-lg` | 16 | modals, top corners of mobile sheets |
| `radius-full` | 999 | pills, avatars, toggles |

### 2.5 Borders

- Default: `1px solid neutral-200`. Inputs use `1px solid neutral-300`. Dividers inside cards use `1px solid neutral-100`.
- Focus: `outline: 2px solid brand-500; outline-offset: 2px` for buttons and links. Inputs get `border-color brand-600` plus a `0 0 0 3px brand-100` ring. Never remove focus outlines.
- Error input: `border danger.solid` plus a `danger.bg` ring.
- Selected card or row: `1px solid brand-600` plus a `brand-50` fill. Use a fill, not a thick border.

### 2.6 Elevation

Only floating things get shadows.

| Level | Shadow | Use |
|---|---|---|
| 0 | none | cards, tables, sidebar, page sections |
| 1 | `0 1px 2px rgb(15 23 42 / .06), 0 4px 12px rgb(15 23 42 / .08)` | menus, popovers, autocomplete list, date picker |
| 2 | `0 8px 24px rgb(15 23 42 / .12)` | drawers, bottom sheets, sticky bulk bar |
| 3 | `0 20px 48px rgb(15 23 42 / .18)` | modals, toasts |

Scrim: `rgb(15 23 42 / .40)` with **no backdrop blur**. Blur is expensive on low-end Android and it adds visual noise.

### 2.7 Z-index layers

The MUI `zIndex` theme key is the single source. The values encode the known nested-dialog rule (Select, Autocomplete and Dialog inside a Drawer or Dialog need 1500-1600).

| Layer | Value | Notes |
|---|---|---|
| `base` | 0 | |
| `stickyHeader` (table head, sticky footer inside page) | 10 | local stacking only |
| `appBar` / top bar | 1100 | MUI default |
| `sidebar` | 1150 | |
| `bottomBar` (MobileTabBar, page sticky action bar) | 1150 | sets `--kx-bottom-nav` |
| `bulkBar` | 1160 | floats above the bottom bar |
| `drawer` (DetailDrawer, sheets) | 1200 | MUI default |
| `modal` (Modal, ConfirmDialog from page) | 1300 | MUI default |
| `snackbar` | 1400 | unused; we use react-hot-toast |
| `nestedDialog` (Modal/ConfirmDialog opened from a Drawer or Modal) | 1500 | `<Modal layer="nested">` |
| `popover` (Menu, Select menu, Autocomplete popper, DateRangePicker) | 1550 | set globally so popovers always beat nested dialogs |
| `tooltip` | 1600 | |
| `toast` | 1700 | `<Toaster containerStyle={{ zIndex: 1700 }}>` |
| `commandPalette` | 1650 | Cmd+K, above tooltips, below toasts |

### 2.8 Motion

| Token | ms | Easing | Use |
|---|---|---|---|
| `motion-fast` | 100 | `ease-out` | hover/press color changes |
| `motion-base` | 150 | `cubic-bezier(.2,0,0,1)` | pills, toggles, accordion chevrons, toast in |
| `motion-enter` | 220 | `cubic-bezier(.2,0,0,1)` | drawer/sheet/modal enter |
| `motion-exit` | 160 | `cubic-bezier(.4,0,1,1)` | drawer/sheet/modal exit |

Rules: no `transform` on hover (delete the `translateY(-1px)` lifts). Skeleton shimmer runs at 1.2s, or is static under `prefers-reduced-motion: reduce`, which also sets every duration to 0.

### 2.9 Dark mode

Not in v1. Tokens are named by role (`--color-surface`, `--color-text`), so a dark theme can be added later by redefining variables under `[data-theme="dark"]` and switching MUI `palette.mode`. Don't build dark-specific components.

### 2.10 Code skeleton: `lib/ds/tokens.ts`

```ts
// lib/ds/tokens.ts — single source of truth. Mirrored in styles/globals.css @theme (tested).
export const color = {
  neutral: { 0:'#ffffff',25:'#fbfcfd',50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',
             400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a' },
  brand:   { 50:'#eff6ff',100:'#dbeafe',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8',800:'#1e40af' },
  success: { bg:'#f0fdf4', border:'#bbf7d0', fg:'#15803d', solid:'#16a34a' },
  warning: { bg:'#fffbeb', border:'#fde68a', fg:'#b45309', solid:'#f59e0b' },
  danger:  { bg:'#fef2f2', border:'#fecaca', fg:'#b91c1c', solid:'#dc2626' },
  info:    { bg:'#ecfeff', border:'#a5f3fc', fg:'#0e7490', solid:'#0891b2' },
  attention:{ bg:'#fff7ed', border:'#fed7aa', fg:'#c2410c', solid:'#ea580c' },
} as const;

export const radius = { xs: 4, sm: 8, md: 12, lg: 16, full: 999 } as const;
export const space = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;
export const controlHeight = { sm: 32, md: 40, lg: 48, touch: 44 } as const;
export const shadow = {
  1: '0 1px 2px rgb(15 23 42 / .06), 0 4px 12px rgb(15 23 42 / .08)',
  2: '0 8px 24px rgb(15 23 42 / .12)',
  3: '0 20px 48px rgb(15 23 42 / .18)',
} as const;
export const z = { stickyHeader: 10, appBar: 1100, sidebar: 1150, bottomBar: 1150, bulkBar: 1160,
  drawer: 1200, modal: 1300, snackbar: 1400, nestedDialog: 1500, popover: 1550,
  tooltip: 1600, commandPalette: 1650, toast: 1700 } as const;
export const motion = { fast: 100, base: 150, enter: 220, exit: 160,
  easeStandard: 'cubic-bezier(.2,0,0,1)', easeExit: 'cubic-bezier(.4,0,1,1)' } as const;
export const font = {
  sans: 'var(--font-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;
```

### 2.11 Code skeleton: `lib/theme.tsx` (replaces the current file)

```tsx
import { createTheme, alpha } from '@mui/material/styles';
import { color as c, radius as r, shadow, z, motion, font, controlHeight as h } from './ds/tokens';

declare module '@mui/material/styles' {
  interface Palette { attention: Palette['primary']; }
  interface PaletteOptions { attention?: PaletteOptions['primary']; }
  interface TypographyVariants { kpi: React.CSSProperties; caption2: React.CSSProperties; }
  interface TypographyVariantsOptions { kpi?: React.CSSProperties; caption2?: React.CSSProperties; }
  interface ZIndex { nestedDialog: number; popover: number; bottomBar: number; bulkBar: number; toast: number; }
}
declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides { ghost: true; }
}

const theme = createTheme({
  palette: {
    primary:  { main: c.brand[600], dark: c.brand[700], light: c.brand[100], contrastText: '#fff' },
    // secondary intentionally mapped to neutral: there is no second accent.
    secondary:{ main: c.neutral[700], dark: c.neutral[900], light: c.neutral[100], contrastText: '#fff' },
    success:  { main: c.success.solid, dark: c.success.fg, light: c.success.bg },
    warning:  { main: c.warning.solid, dark: c.warning.fg, light: c.warning.bg },
    error:    { main: c.danger.solid,  dark: c.danger.fg,  light: c.danger.bg },
    info:     { main: c.info.solid,    dark: c.info.fg,    light: c.info.bg },
    attention:{ main: c.attention.solid, dark: c.attention.fg, light: c.attention.bg },
    grey: c.neutral as any,
    text: { primary: c.neutral[900], secondary: c.neutral[500], disabled: c.neutral[400] },
    divider: c.neutral[200],
    background: { default: c.neutral[50], paper: c.neutral[0] },
    action: { hover: c.neutral[100], selected: c.brand[50], focus: c.brand[100] },
  },
  shape: { borderRadius: r.sm },
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1600 } },
  zIndex: { appBar: z.appBar, drawer: z.drawer, modal: z.modal, snackbar: z.snackbar, tooltip: z.tooltip,
            nestedDialog: z.nestedDialog, popover: z.popover, bottomBar: z.bottomBar, bulkBar: z.bulkBar, toast: z.toast } as any,
  typography: {
    fontFamily: font.sans,
    fontSize: 14, htmlFontSize: 16,
    fontWeightRegular: 400, fontWeightMedium: 500, fontWeightBold: 600,
    h1: { fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.015em' },
    h2: { fontSize: 17, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.01em' },
    h3: { fontSize: 15, lineHeight: '22px', fontWeight: 600 },
    h4: undefined, h5: undefined, h6: undefined,          // banned: lint rule flags variant="h4|h5|h6"
    body1: { fontSize: 14, lineHeight: '20px' },
    body2: { fontSize: 13, lineHeight: '18px' },
    caption: { fontSize: 12, lineHeight: '16px', fontWeight: 500, color: c.neutral[500] },
    overline: { fontSize: 12, lineHeight: '16px', fontWeight: 500, textTransform: 'none', letterSpacing: '0.01em' },
    button: { fontSize: 14, fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
    kpi: { fontSize: 24, lineHeight: '32px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  },
  shadows: ['none', shadow[1], shadow[1], shadow[2], shadow[2], shadow[2], ...Array(19).fill(shadow[3])] as any,
  transitions: { duration: { shortest: motion.fast, shorter: motion.base, short: motion.base,
                             standard: motion.enter, enteringScreen: motion.enter, leavingScreen: motion.exit } },
  components: {
    MuiCssBaseline: { styleOverrides: {
      body: { backgroundColor: c.neutral[50], color: c.neutral[900] },
      '@media (pointer: coarse)': { 'input, textarea, select': { fontSize: '16px !important' } },
      '@media (prefers-reduced-motion: reduce)': { '*': { transition: 'none !important', animation: 'none !important' } },
    } },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'medium' },
      variants: [{ props: { variant: 'ghost' as any }, style: { color: c.neutral[700], '&:hover': { backgroundColor: c.neutral[100] } } }],
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: r.sm, fontWeight: 500, minHeight: h.md, padding: '0 16px',
                transition: `background-color ${motion.fast}ms, border-color ${motion.fast}ms`,
                '@media (pointer: coarse)': { minHeight: h.touch },
                '&.Mui-focusVisible': { outline: `2px solid ${c.brand[500]}`, outlineOffset: 2 } },
        sizeSmall: { minHeight: h.sm, padding: '0 12px', fontSize: 13 },
        sizeLarge: { minHeight: h.lg, padding: '0 20px', fontSize: 15 },
        contained: { background: c.brand[600], '&:hover': { background: c.brand[700] }, '&:active': { background: c.brand[800] },
                     '&.Mui-disabled': { background: c.neutral[100], color: c.neutral[400] } },
        containedError: { background: c.danger.solid, '&:hover': { background: c.danger.fg } },
        outlined: { borderColor: c.neutral[300], color: c.neutral[900], background: '#fff',
                    '&:hover': { background: c.neutral[50], borderColor: c.neutral[400] } },
        text: { color: c.brand[600], '&:hover': { background: c.brand[50] } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: r.sm, width: h.md, height: h.md,
      '@media (pointer: coarse)': { width: h.touch, height: h.touch } } } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: {
      root: { backgroundImage: 'none' },
      outlined: { borderColor: c.neutral[200], borderRadius: r.md } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: r.md, boxShadow: 'none' } } },
    MuiOutlinedInput: { styleOverrides: {
      root: { borderRadius: r.sm, minHeight: h.md, backgroundColor: '#fff',
              '& fieldset': { borderColor: c.neutral[300] },
              '&:hover fieldset': { borderColor: c.neutral[400] },
              '&.Mui-focused fieldset': { borderColor: c.brand[600], borderWidth: 1 },
              '&.Mui-focused': { boxShadow: `0 0 0 3px ${c.brand[100]}` },
              '&.Mui-error.Mui-focused': { boxShadow: `0 0 0 3px ${c.danger.bg}` },
              '@media (pointer: coarse)': { minHeight: h.touch } },
      input: { padding: '0 12px', height: h.md, boxSizing: 'border-box' },
      inputMultiline: { padding: '10px 12px', height: 'auto' } } },
    MuiInputLabel: { defaultProps: { shrink: true } },          // labels live above (FormField renders them)
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true, InputLabelProps: { shrink: true } } },
    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 0, marginTop: 6, fontSize: 13 } } },
    MuiPopover: { styleOverrides: { root: { zIndex: z.popover } , paper: { borderRadius: r.md, boxShadow: shadow[1], border: `1px solid ${c.neutral[200]}` } } },
    MuiMenu:    { styleOverrides: { root: { zIndex: z.popover } } },
    MuiAutocomplete: { styleOverrides: { popper: { zIndex: z.popover }, paper: { boxShadow: shadow[1], border: `1px solid ${c.neutral[200]}` } } },
    MuiPopper:  { styleOverrides: { root: { zIndex: z.popover } } },
    MuiMenuItem:{ styleOverrides: { root: { minHeight: 36, borderRadius: 6, margin: '2px 6px', fontSize: 14,
      '@media (pointer: coarse)': { minHeight: h.touch } } } },
    MuiTooltip: { defaultProps: { arrow: false, enterDelay: 400 }, styleOverrides: {
      popper: { zIndex: z.tooltip }, tooltip: { background: c.neutral[800], fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '6px 8px' } } },
    MuiDialog: { styleOverrides: {
      paper: { borderRadius: r.lg, boxShadow: shadow[3] },
      root: { '& .MuiBackdrop-root': { backgroundColor: alpha(c.neutral[900], 0.4) } } } },
    MuiDrawer: { styleOverrides: {
      paper: { border: 'none', boxShadow: shadow[2] },
      root: { '& .MuiBackdrop-root': { backgroundColor: alpha(c.neutral[900], 0.4) } } } },
    MuiChip: { styleOverrides: { root: { borderRadius: r.full, fontWeight: 500, fontSize: 13, height: 28 },
      sizeSmall: { height: 24, fontSize: 12 } } },               // Chips are for filter tokens/tags only; status uses StatusPill
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, fontSize: 14, minHeight: 44 } } },
    MuiTableCell: { styleOverrides: {
      root: { borderColor: c.neutral[100], fontSize: 14, padding: '10px 12px' },
      head: { background: c.neutral[25], color: c.neutral[500], fontSize: 13, fontWeight: 500, textTransform: 'none',
              borderBottom: `1px solid ${c.neutral[200]}` } } },
    MuiAlert: { defaultProps: { variant: 'outlined' } },          // prefer <Callout>; Alert kept for legacy
    MuiAccordion: { defaultProps: { disableGutters: true, elevation: 0 } },
    MuiSwitch: { defaultProps: { disableRipple: true } },
  },
});
export default theme;
```

### 2.12 Code skeleton: `styles/globals.css` (Tailwind v4)

```css
@import "tailwindcss";

/* Font comes from next/font (variable --font-sans set on <html> in _app.tsx). No @import url(). */

@theme {
  /* Wipe Tailwind's rainbow so only tokens exist (prevents bg-purple-500 etc. creeping back) */
  --color-*: initial;

  --color-white: #ffffff;
  --color-neutral-0: #ffffff;   --color-neutral-25: #fbfcfd;  --color-neutral-50: #f8fafc;
  --color-neutral-100: #f1f5f9; --color-neutral-200: #e2e8f0; --color-neutral-300: #cbd5e1;
  --color-neutral-400: #94a3b8; --color-neutral-500: #64748b; --color-neutral-600: #475569;
  --color-neutral-700: #334155; --color-neutral-800: #1e293b; --color-neutral-900: #0f172a;

  --color-brand-50: #eff6ff; --color-brand-100: #dbeafe; --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb; --color-brand-700: #1d4ed8; --color-brand-800: #1e40af;

  --color-success-bg: #f0fdf4; --color-success-border: #bbf7d0; --color-success-fg: #15803d; --color-success: #16a34a;
  --color-warning-bg: #fffbeb; --color-warning-border: #fde68a; --color-warning-fg: #b45309; --color-warning: #f59e0b;
  --color-danger-bg:  #fef2f2; --color-danger-border:  #fecaca; --color-danger-fg:  #b91c1c; --color-danger:  #dc2626;
  --color-info-bg:    #ecfeff; --color-info-border:    #a5f3fc; --color-info-fg:    #0e7490; --color-info:    #0891b2;
  --color-attention-bg:#fff7ed; --color-attention-border:#fed7aa; --color-attention-fg:#c2410c; --color-attention:#ea580c;

  /* role aliases used by components */
  --color-bg: var(--color-neutral-50);
  --color-surface: var(--color-neutral-0);
  --color-text: var(--color-neutral-900);
  --color-text-muted: var(--color-neutral-500);
  --color-border: var(--color-neutral-200);
  --color-border-strong: var(--color-neutral-300);

  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-display: 28px;   --text-display--line-height: 36px;
  --text-h1: 22px;        --text-h1--line-height: 28px;
  --text-h2: 17px;        --text-h2--line-height: 24px;
  --text-h3: 15px;        --text-h3--line-height: 22px;
  --text-body-lg: 16px;   --text-body-lg--line-height: 24px;
  --text-body: 14px;      --text-body--line-height: 20px;
  --text-body-sm: 13px;   --text-body-sm--line-height: 18px;
  --text-caption: 12px;   --text-caption--line-height: 16px;
  --text-kpi: 24px;       --text-kpi--line-height: 32px;

  --font-weight-regular: 400; --font-weight-medium: 500; --font-weight-semibold: 600;

  --spacing: 4px;   /* p-4 = 16px, gap-2 = 8px … only use the documented steps */

  --radius-xs: 4px; --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-full: 999px;

  --shadow-1: 0 1px 2px rgb(15 23 42 / .06), 0 4px 12px rgb(15 23 42 / .08);
  --shadow-2: 0 8px 24px rgb(15 23 42 / .12);
  --shadow-3: 0 20px 48px rgb(15 23 42 / .18);

  --ease-standard: cubic-bezier(.2,0,0,1);
  --ease-exit: cubic-bezier(.4,0,1,1);

  --breakpoint-sm: 600px; --breakpoint-md: 900px; --breakpoint-lg: 1200px; --breakpoint-xl: 1600px;
}

/* z-index is not a Tailwind theme namespace — use z-(--z-drawer) */
:root {
  --z-sticky: 10; --z-appbar: 1100; --z-sidebar: 1150; --z-bottom-bar: 1150; --z-bulk-bar: 1160;
  --z-drawer: 1200; --z-modal: 1300; --z-nested-dialog: 1500; --z-popover: 1550;
  --z-tooltip: 1600; --z-command: 1650; --z-toast: 1700;
  --motion-fast: 100ms; --motion-base: 150ms; --motion-enter: 220ms; --motion-exit: 160ms;
  --control-h: 40px;
}
@media (pointer: coarse) { :root { --control-h: 44px; } }

html { font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
body { background: var(--color-bg); color: var(--color-text); }
.tabular { font-variant-numeric: tabular-nums; }

/* DELETE: .glass, .gradient-text, .card-premium*, .btn-primary, .btn-secondary, translateY hovers */
```

Note on `--color-*: initial`: this makes legacy `bg-slate-*`, `text-purple-*` and similar classes stop rendering. Ship it behind the migration (§7): first add the tokens next to the defaults, migrate pages, then wipe the defaults once `grep -r "slate-\|purple-\|indigo-" components pages` is empty.

---

## 3. Layout and patterns

### 3.1 AppShell

```
Desktop ≥1200: expanded sidebar 248px          Desktop 900–1199: collapsed rail 64px (labels in tooltips)
┌────────────┬───────────────────────────────┐ ┌────┬──────────────────────────────────┐
│ KolayXport │ [⌘K Search…]      🔔  (avatar) │ │ K  │ [⌘K]                  🔔 (avatar)│
│            ├───────────────────────────────┤ │    ├──────────────────────────────────┤
│ ⌂ Overview │ page                          │ │ ⌂  │                                  │
│ ▣ Orders 12│                               │ │ ▣• │                                  │
│ ─ Listings │                               │ │[E] │  ← real logo, 20px, tooltip "Etsy│
│ [E] Etsy   │                               │ │[eB]│     listings"                    │
│ [eB] eBay  │                               │ │[T] │                                  │
│ [T] Trendy.│                               │ │    │                                  │
│ + Connect  │                               │ │ +  │                                  │
│ ✉ Messages3│                               │ │ ✉  │                                  │
│ ◎ Research │                               │ │ ◎  │                                  │
│ ∿ Reports  │                               │ │ ∿  │                                  │
│ ₺ Finance  │                               │ │ ₺  │                                  │
│            │                               │ │    │                                  │
│ ⚙ Settings•│                               │ │ ⚙• │                                  │
│ ? Help     │                               │ │ ?  │                                  │
│ [«] Collapse                               │ │ »  │                                  │
└────────────┴───────────────────────────────┘ └────┴──────────────────────────────────┘
```

Rules:
- **Sidebar.** White background, 1px right border, no shadow.
  - Groups: Overview, Orders, Listings (one row per connected marketplace, with its `LogoTile size={20}`), Messages, Research, Reports and Finance, then Settings and Help pinned at the bottom.
  - "Invoices" moves into Settings › Plan & billing. "Integrations & guides" moves into Help.
- **Item anatomy.** 36px tall (44 on touch), radius 8, 20px icon or logo, label in 14/500, and an optional count badge on the right (neutral pill; danger pill for overdue).
  - Active: `brand-50` background, `brand-700` text and icon, plus a 2px left indicator.
  - Group labels: 12/500 `neutral-500`, sentence case. No uppercase.
- **Logos, not icons, for marketplaces.** Every per-marketplace item uses its real logo. Research items become **one** "Research" item. Research is a single hub with a marketplace switcher (§6.6), which fixes the three identical target icons.
- **Collapsed rail.** Each item shows a tooltip with its full label after 400ms. Logos keep their color, and Lucide icons are `neutral-600`.
  - Pinned or expanded state stays in `localStorage`, as it does today.
  - Collapsing happens automatically at widths of 900-1199px.
- **Top bar.** 56px with no title. The page title lives only in `PageHeader`, so the "<Page> - KolayXport" duplication goes away. It holds: the Cmd+K search (a full field on desktop, an icon on mobile), notifications and the account menu. The `<title>` tag is "Orders · KolayXport".
- **Mobile (<900px).** No sidebar.
  - Bottom tab bar, 60px plus safe area: Home, Orders, Listings, Messages/Research, More. `MobileTabBar.tsx` already sets `--kx-bottom-nav`.
  - "More" opens a bottom sheet with the full nav list, using logos.
  - The top bar is 52px: page title (h1 20px), with a back chevron on drill-in pages and icon actions on the right.

### 3.2 Page template

```tsx
<Page width="list" | "form" | "detail" | "dashboard">
  <PageHeader
    title="Orders"
    subtitle="12 to ship today · last synced 4 min ago"
    breadcrumb?={[{label:'Listings', href:'/app/listings'}]}
    primaryAction={{ label:'Create labels', onClick, disabled? }}
    secondaryActions={[{ label:'Sync now', icon:<RefreshCw/>, onClick }]}   // max 2 visible, rest overflow
    overflowActions={[{ label:'Add manual order' }, { label:'Export CSV' }, { label:'ETGB documents' }]}
  />
  …content
</Page>
```

| `width` | Max content width | Pages |
|---|---|---|
| `list` | 100% up to **1600px**, left-aligned | Orders, Listings, Messages, Research results |
| `dashboard` | **1280px** | Overview, Reports, Finance |
| `detail` | **1200px** (main 760 + rail 360 + gap) | Listing editor, Order detail page |
| `form` | **880px** | Settings sections, Sender profile, Create listing wizard |

Rules:
- The page title appears exactly once (h1). The subtitle is one line of live context, never marketing copy.
- Header actions are right-aligned on desktop. On mobile, the primary moves to a sticky bottom action bar (`<StickyActionBar>`), and secondaries plus overflow collapse into a single ⋯ in the top bar.
- No hero banners, no gradient headers, and no promotional banners inside the app. Plan or trial notices go to one `Callout` slot under the header, and only when the user needs to act.

### 3.3 FilterBar and Toolbar

```
[ Saved views:  All 248 | To ship 12 | Label ready 3 | Shipped | Problems 2 | + ]   ← SavedViews (tabs, scroll on mobile)
[🔍 Search orders, buyer, SKU, tracking…        ] [Store ▾] [Date: Last 30 days ▾] [Carrier ▾] [⚙ Filters 2] [⋯]
  active: (Store: Etsy · BelleCouture ✕) (Country: US ✕)  Clear all                 248 orders  · Sort: Ship by ▾
```

Rules:
- One row. The order is: search (flex-grow, min 240), then **at most 3 visible filters** chosen per page, then a "Filters" button with an active count, then ⋯ for view options (density, columns, export).
- All controls are 40px tall on desktop and 44px on touch, use the same `FilterButton` style (outlined, label plus value plus chevron), and have no floating labels. An unlabeled "All" select is forbidden. A filter button always reads "Label: value".
- The "Filters" button opens `FiltersSheet` (a right drawer of 400px on desktop, a bottom sheet on mobile). It holds every filter grouped, plus "Apply" (primary) and "Reset".
- **Saved views** are tabs above the bar. Each view is a named preset of filters and sort, stored per user. The defaults are shipped per page, the user can add more with "Save view", and the counts are live. Status segmentation goes here, so there's no separate ALL/UNLABELED/RECEIVED/FAILED segmented control.
- Active filters show as removable chips under the bar, with a "Clear all" link.
- Search is debounced at 300ms, and the query is kept in the URL (`?q=&view=&store=`) so views can be shared and reloaded.
- **Dates use `DateRangePicker` only.** Native `<input type="date">` is forbidden (lint rule).
  - The button reads "Date: Last 30 days". The popover (a sheet on mobile) shows presets on the left (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, This year, Custom) and two `DateCalendar` months from `@mui/x-date-pickers` v6, which are free in MUI X. `DateRangePicker` itself is MUI X Pro, so we compose our own.
  - Locale formatting: tr-TR "1–14 Eki 2026", en-US "Oct 1–14, 2026". The week starts Monday for TR and Sunday for EN.
  - Changes apply on "Apply". Presets apply instantly.
- On mobile, row 2 becomes: search (full width) and then a horizontally scrollable chip row: `[Filters 2] [Store] [Date] [Carrier]`.

### 3.4 DataTable becomes cards on mobile

One component, `DataTable<T>`, with `columns` for desktop and a `renderCard(row)` (or declarative `card` slots) for under 900px. It wraps MUI `Table` and does not use DataGrid. DataGrid is the known mobile breakage and is heavy. DataGrid is kept only for the BulkEditor spreadsheet.

Desktop rules:
- Row height: 56px comfortable (with a thumbnail) or 44px compact. The header is sticky.
- The first column is a checkbox (selection). The second is the identity cell: `Thumbnail 40` plus title (14/500, 1 line, ellipsis) plus a secondary line (13 `neutral-500`).
- Numbers and money are right-aligned and tabular. Statuses use `StatusPill`. Dates use `<RelativeDate>` with the absolute date in a tooltip.
- Row actions: one inline ghost icon or button (the most common action, for example "Create label"). Everything else goes in a ⋯ menu at the end of the row. **No row of 3 colored icons** (eBay's pencil, copy and red trash).
- Clicking a row opens the `DetailDrawer` (or navigates, for the listing editor). Cmd/Ctrl-click opens in a new tab.
- When rows are selected, a `BulkBar` floats at the bottom center (elevation 2): "3 selected · [Create labels] [Print] [⋯] ✕". Its first action is the view's primary.
- Pagination: "Load more" or infinite scroll for at most 1000 rows, plus a total count in the FilterBar. No page-size selector.

Mobile card:
```
┌──────────────────────────────────────┐
│ [img] Personalized Baby Blanket   ⋯  │
│       #3412 · Emma W. · 🇺🇸 US        │
│       ● To ship   Ship by tomorrow   │
│ $169,99                 [Create label]│
└──────────────────────────────────────┘
```
- The card is a single tap target (min-height 88) that opens the detail sheet. The inline button is one 36-44px secondary. Long-press or the checkbox mode button in the header enables selection.

### 3.5 DetailDrawer template

```
┌──────────── 480px (sm 400 / lg 640 / xl 880) ────────────┐
│ [logo] Order #3412            ● To ship        [⋯] [✕]   │ header 64px, sticky, border-bottom
│ Etsy · BelleCoutureGifts · Oct 13                        │ meta line 13px
├──────────────────────────────────────────────────────────┤
│ Section title                                   [Edit]   │ body scrolls; sections separated by 24px
│  content…                                                │ section = h3 + content, no nested cards
│                                                          │
│ Section title                                            │
│  content…                                                │
├──────────────────────────────────────────────────────────┤
│ [⋯]                          [Secondary]  [Primary]      │ footer 72px, sticky, neutral-25 bg
└──────────────────────────────────────────────────────────┘
```
Rules:
- The header has: an optional `LogoTile`, the title (h2, one line, ellipsis), a `StatusPill`, ⋯ and close. There are no unlabeled icons in the header. Every icon button has a tooltip and an aria-label.
- The body is made of `DrawerSection`s. Inside a drawer there are no tabs if there are fewer than 4 sections. With 4 or more, use a sticky section-anchor chip row instead of tabs, so content is still one scroll.
- The footer has exactly one primary, at most one secondary, and ⋯ on the left for the rest. Destructive actions go in ⋯ only.
- When the drawer has dirty state, close confirms "Discard changes?" (nested dialog at layer 1500).
- On mobile the drawer becomes a full-height bottom sheet: 16px top radius, a drag handle, a sticky header and sticky footer, and the footer buttons split 50/50 at 48px tall.
- A drawer never opens a second drawer. Drill-down replaces the drawer content and shows a back arrow in the header.

### 3.6 Modal template

Use a modal only for: (a) confirmations, (b) short forms of 3 fields or fewer (rename, add note, save view), and (c) blocking errors. Anything longer is a drawer.

- Width 440 (sm) or 560 (md). Header: title h2 plus close. Body. Footer right-aligned: [Cancel] [Primary]. Destructive confirms use a red solid primary with a specific verb ("Delete listing", not "OK").
- Use the existing `components/ui/ConfirmDialog.tsx` (`useConfirm`) and restyle it. Keep `typeToConfirm` for listing deletes and similar.
- When a modal is opened from a drawer, pass `layer="nested"` (z 1500).
- "Add manual order" becomes a drawer (it has more than 10 fields). Its currency defaults from the seller's locale/store currency (TRY for TR sellers).

### 3.7 Form field rules

- `FormField` = label above (14/500 `neutral-900`, with a required `*` in `danger-fg`, or "(optional)" in `neutral-500`. **Mark the minority**: if most fields are required, mark optional ones instead), then the control, then helper text (13 `neutral-500`), then the error (13 `danger-fg` with an icon, replacing the helper).
- There are no floating labels anywhere. `TextField label=` is banned in favor of `FormField`.
- Controls are 40px desktop and 44px touch, with 16px font on touch. Field widths follow their content (postal code 160, phone 240, name 400, full-width text max 560). They never stretch to 1400px, because the `form` page width caps at 880.
- Validation runs on blur and on submit, never on every keystroke (except character counters). On submit, scroll to and focus the first error and show a summary `Callout` at the top of the form or drawer: "Fix 2 fields to continue".
- Character counters for Etsy titles and tags show inside the helper row on the right, "87/140". They turn warning at 90% and danger past the limit.
- Use the right inputs: `inputMode="tel"` / `"decimal"` / `"email"`; `MoneyInput` (currency prefix from the store currency, locale decimal separator, so TR accepts "1.109,30"); a country `Combobox` with flag and name, never free-text "TR"; `Switch` rows for on/off settings (never an Active/Passive select).
- Long text (descriptions) uses an auto-growing textarea (min 6 rows, no inner scroll), with "Preview" showing it as Etsy renders it.
- Disabled fields explain why in their helper text ("Set by Etsy for this category").

### 3.8 Buttons

| Variant | Look | Use |
|---|---|---|
| `primary` | solid `brand-600`, white text | the one main action per view |
| `secondary` | white, 1px `neutral-300`, `neutral-900` text | other actions |
| `ghost` | transparent, `neutral-700`, hover `neutral-100` | toolbars, low-emphasis, row actions |
| `danger` | solid `danger-solid` | **only** as the confirm button in a destructive confirm dialog |
| `danger-ghost` | transparent, `danger-fg` | destructive item in ⋯ menus |
| `link` | `brand-600` text, underline on hover | inline navigation in text |

Sizes: `sm` 32 (dense table rows only), `md` 40 (default), `lg` 48 (mobile sticky footers, empty-state CTAs). On touch, `sm` and `md` grow to 44.

Rules:
- Sentence case, never uppercase. No gradients, no shadows, no hover lift.
- Labels are verb plus noun. Icons are 16px, leading position only, and optional. Icon-only buttons need a tooltip and an aria-label.
- Loading state keeps the label width and shows a spinner in place of the icon. The button is disabled while pending.
- Never more than 3 buttons in a row: one primary, one secondary, then ⋯.
- Marketplace-colored or green "New listing" or "Sync data" buttons are forbidden. Green is not an action color.

### 3.9 StatusPill: fixed vocabulary

Anatomy: 24px tall (20 in dense tables), radius full, 6px dot plus a 12/500 label in sentence case, using the tone's `bg`/`fg`. A pill is not clickable. If something needs to be clickable it's a button. (This fixes the green outline "already has tracking" pseudo-button.)

| Domain | Key → Label (EN / TR) | Tone |
|---|---|---|
| **Order (fulfilment)**: one pill per order | `to_ship` To ship / Gönderilecek | warning (danger if overdue) |
| | `label_ready` Label ready / Etiket hazır | info |
| | `shipped` Shipped / Kargoda | success |
| | `delivered` Delivered / Teslim edildi | success |
| | `cancelled` Cancelled / İptal | neutral |
| | `label_failed` Label failed / Etiket hatası | danger |
| | `on_hold` On hold / Beklemede | neutral |
| **Listing** | `active` Active / Yayında | success |
| | `draft` Draft / Taslak | neutral |
| | `inactive` Inactive / Pasif | neutral |
| | `sold_out` Sold out / Tükendi | warning |
| | `expired` Expired / Süresi doldu | warning |
| **Listing changes** (second pill only when present) | `unsynced` 3 changes not sent / 3 değişiklik gönderilmedi | attention |
| | `syncing` Sending… / Gönderiliyor… | info (pulsing dot) |
| | `sync_failed` Couldn't send / Gönderilemedi | danger |
| | `conflict` Changed on Etsy / Etsy'de değişti | danger |
| **Connection** | `connected` Connected / Bağlı | success |
| | `reconnect` Reconnect needed / Yeniden bağlanın | warning |
| | `incomplete` Incomplete / Eksik bilgi | warning |
| | `off` Not connected / Bağlı değil | neutral |
| **Billing** | `trial` Trial / Deneme · `active` Active / Aktif · `past_due` Payment failed / Ödeme başarısız · `canceled` Canceled / İptal | info / success / danger / neutral |
| **Message** | `unread` Unread / Okunmadı · `needs_reply` Needs reply / Yanıt bekliyor | brand dot only / warning |

Rules:
- Raw marketplace statuses ("Awaiting Fulfillment", "Received") are mapped in `lib/ds/statusMap.ts` per marketplace to these keys. The raw value is shown only in the detail drawer under "Marketplace status".
- **One fulfilment pill per order.** Label status is folded into it (`label_ready`). The "Unlabeled" filter is a saved view built on the mapped key, so Amazon "Shipped" orders no longer appear as unlabeled.
- "Ship by" is a separate text, not a pill: "Ship by tomorrow" in `neutral-500`, `warning-fg` when under 24h, `danger-fg` "Overdue 2 days" when late. The absolute time goes in a tooltip.

### 3.10 HealthScore: one listing-quality representation

The same component and the same scale everywhere: Etsy, eBay, Trendyol, Wix, Shopify, Amazon, the editor and research.

- **Scale:** 0–100 integer. Marketplace-specific graders all output 0–100. Trendyol letter grades are converted (A+ 97, A 93, B+ 87, B 83, C+ 77, C 73, D 60, F 40) and never shown as letters.
- **Bands:**
  - 80–100 "Great" / "Çok iyi", success.
  - 60–79 "Good" / "İyi", success-fg on neutral.
  - 40–59 "Needs work" / "Geliştirilmeli", warning.
  - 0–39 "Poor" / "Zayıf", danger.
- **Variants:**
  - `inline` (tables and cards): a 4-segment mini bar (36×6), then the number (13/600 tabular), then the band word on wide screens. Example: `▰▰▰▱ 72`.
  - `summary` (editor right rail): number in `kpi` plus the band word, a full-width 8px bar, and "+14 possible" (points recoverable).
  - `checklist` (below summary): a list of checks with ✓, ! or ✕, each showing points and a "Fix" link that scrolls to the field. Examples: "Title uses 87/140 characters", "Only 4 of 10 photos", "2 tags overlap title words".
- No rings, letter boxes or colored squares. The color comes from the band, and the number is always visible (P6).

### 3.11 Money, number and date formatting

All formatting goes through `lib/ds/format.ts`, which wraps the existing `lib/i18n/formatting.ts`. It's exposed as components: `<Money value currency />`, `<Num value />`, `<DateText value format="date|datetime|relative" />`. Pages never call `toFixed` or concatenate currency strings (enforced by a lint rule against `.toFixed(` in TSX plus a code-review checklist).

- **The locale follows the UI language** (`tr-TR` or `en-US`). **The currency follows the data** (the order's currency or the store's currency). We never convert silently. Converted values are labeled "≈ ₺5.420 (converted)".
- `Intl.NumberFormat(locale, { style:'currency', currency, currencyDisplay:'narrowSymbol' })`:
  - tr-TR: TRY `₺1.109,30`, USD `$169,99`, EUR `€24,50`.
  - en-US: TRY `₺1,109.30`, USD `$169.99`, EUR `€24.50`.
  - So: always a symbol, never "2999.00 TRY" or "TRY 1,070,860.03".
- Ambiguous symbols: if a view mixes USD with CAD or AUD, use `currencyDisplay:'symbol'`, which renders "CA$" / "A$".
- Decimals: 2 for money in tables and forms. KPI tiles may use compact notation (`notation:'compact'`, giving `₺1,07 Mn` / `₺1.07M`), but the full value is always in a tooltip, and compact is only used for values ≥ 100,000.
- Mixed currencies in one total: show one line per currency ("$4.210,00 + ₺18.300,00"), or convert explicitly with a "converted at" note. Never add them.
- Numbers: `Intl.NumberFormat(locale)` gives grouping (tr `1.234`, en `1,234`). Percentages use `style:'percent', maximumFractionDigits:1` (tr `%12,5`, en `12.5%`). Intl handles the TR prefix percent automatically.
- Dates:
  - Tables use relative time within 7 days ("4 min ago", "Yesterday 14:20" / "Dün 14:20"), then absolute ("14 Eki 2026" / "Oct 14, 2026").
  - Use the 24h clock in TR and 12h in EN.
  - The full timestamp goes in a tooltip.
  - Never show both relative and absolute inline (this fixes "Tomorrow 10/15/2026, 10:59 PM").
  - Times show in the seller's timezone (default `Europe/Istanbul` for TR) with "(your time)" in the tooltip.
- Weights and dimensions are always shown with units ("1,2 kg", "30 × 20 × 10 cm"), and the unit system comes from the sender profile.

### 3.12 EmptyState, ErrorState and Loading

Empty states come in three kinds, selected by `kind` on `EmptyState`. The illustration is a 48px Lucide icon in a `neutral-100` circle, not a gradient.

| kind | When | Content |
|---|---|---|
| `first-use` | nothing set up yet | title "Connect your Etsy shop to see orders here", one sentence of benefit, primary CTA ("Connect Etsy"), and a secondary "How it works" link. Optionally a 3-step mini checklist. |
| `no-results` | filters exclude everything | "No orders match these filters" plus a "Clear filters" button. Never a CTA to create. |
| `all-done` | queue empty (good news) | "All orders are shipped 🎉" (the one place emoji is allowed), a success icon, and a link to the next useful place ("See shipped orders"). |

- `ErrorState` (exists; restyle): the title says what failed ("Couldn't load your orders"), the body is one plain sentence (the raw error is behind "Show details"), and it has Retry. Variants: `page`, `inline` (inside a card) and `banner` (stale data still shown, with "Showing data from 10:42 · Retry"). Never say "not connected" when the truth is "couldn't check".
- Loading:
  - Skeletons match the final layout (table rows with a thumbnail square plus 2 text bars; KPI tiles; drawer sections). They are shown after 300ms to avoid flicker.
  - Spinners are allowed only inside buttons and for under-1s inline refresh.
  - Never a full-page spinner, and never a "Loading your eBay listings…" banner without a timeout. After 15s, switch to `ErrorState banner` with Retry.
- Background work (sync, bulk send) shows a `ProgressToast` or a pill in the header ("Syncing Etsy… 34/120"), never a modal.

### 3.13 Toast rules

- Use react-hot-toast through a `notify` wrapper (`lib/ds/notify.ts`), positioned bottom-center on mobile (above `--kx-bottom-nav`) and bottom-right on desktop, at z 1700.
- Types: `success` (4s), `error` (persist until dismissed when there's an action, otherwise 8s), `info` (4s), and `progress` (updatable, sticky until done).
- Content: at most one line of about 80 characters, plus an optional single action ("Undo", "View", "Retry"). **Never** show raw JSON, stack traces or AI output in a toast (per `feedback_ai_response_safety`). Long errors go into the drawer or an `ErrorState`.
- Use stable `id`s per operation to dedupe. Don't toast for things already visible on screen (for example a status pill that just changed). Undo is preferred over a confirm for reversible actions (archive, mark as read).

### 3.14 Callout (inline banner)

Tones: `info`, `warning`, `danger` and `success`. Each has a 1px semantic border, a semantic background, an icon, a title (14/600), a body (13) and up to 2 actions. Callouts are placed inline above the content they concern. Only one page-level callout is shown at a time (highest severity first). They are dismissible unless they're blocking. Example: the Etsy API restriction notice becomes an `info` Callout inside the Etsy connection drawer, not a giant yellow box.

### 3.15 Icon set

**Lucide only** (`lucide-react`, already used in ~64 files). Sizes: 16 (in buttons and inputs), 20 (nav, row actions), 24 (empty states inside a 48 circle). Stroke width 1.75. Color is inherited.

- `@mui/icons-material` is removed gradually (~74 files). A lint rule bans new imports of it.
- Import through `components/ds/Icon.tsx` re-exports, so the set is curated.
- Marketplace and carrier identity always uses `LogoTile` or `MarketplaceLogo`, never an icon.

### 3.16 KPI tiles (StatTile)

A white card showing: label (13 `neutral-500`), value (`kpi`), delta ("▲ 12% vs last 30 days" in success-fg or danger-fg; neutral when flat) and an optional sparkline (brand-600 line, no fill colors).

- **All tiles look identical.** No per-tile colors or gradient icons. Replace `StatCard`'s `color` prop.
- At most 4 tiles per row and at most 8 per page. The rest go into a table.
- Each tile is clickable when a drill-down exists.

### 3.17 Plain-language glossary (EN / TR)

| Concept | EN | TR | Never |
|---|---|---|---|
| push staged draft to marketplace | Send changes to Etsy | Değişiklikleri Etsy'ye gönder | Sync, Push, Save Profile |
| pull data from marketplace | Refresh from Etsy | Etsy'den yenile | Sync all (7) |
| autosaved local draft | Saved · not sent yet | Kaydedildi · henüz gönderilmedi | Save Draft (disabled grey) |
| connection expired | Reconnect Etsy | Etsy'yi yeniden bağla | Re-auth, Token expired |
| shipping label | Label | Kargo etiketi | CREATE LABEL |
| listing quality | Listing health | İlan sağlığı | SEO score, grade |
| market research | Research | Pazar araştırması | Intelligence, Hub |
| DHL eCommerce (MNG) | DHL eCommerce | DHL eCommerce | MNG Kargo |

---

## 4. Component inventory: `components/ds/*`

Everything is TypeScript. Every user-visible string arrives already translated via props, or uses `useTranslations('ds')` for built-ins ("Cancel", "Clear all"). Components forward `className`/`sx` for layout only, never for color. Existing `components/ui/*` files become re-export shims during migration.

### Shell and layout
```ts
// components/ds/AppShell.tsx
AppShell({ children, nav?: NavGroup[] /* default from lib/ds/nav.ts */ })
type NavGroup = { id: string; label?: string; bottom?: boolean; items: NavItem[] };
type NavItem  = { href: string; label: string; icon?: LucideIcon; logo?: MarketplaceId;
                  requires?: ConnectionProvider | ConnectionProvider[]; badge?: { count: number; tone?: 'neutral'|'danger' };
                  dot?: 'warning'|'danger' };

// components/ds/SidebarNav.tsx
SidebarNav({ groups: NavGroup[], collapsed: boolean, onToggleCollapsed(): void, activeHref: string })

// components/ds/MobileBottomBar.tsx   (supersedes components/MobileTabBar.tsx; keeps --kx-bottom-nav)
MobileBottomBar({ tabs: { key; label; icon: LucideIcon; href?; onClick?; badge?: number; dot?: boolean; active: boolean }[] })

// components/ds/Page.tsx
Page({ width: 'list'|'dashboard'|'detail'|'form', children, title /* <title> */ })

// components/ds/PageHeader.tsx   (replaces components/ui/PageHeader.tsx)
PageHeader({ title: string; subtitle?: ReactNode; breadcrumb?: { label: string; href: string }[];
             leading?: ReactNode /* LogoTile */; status?: ReactNode /* StatusPill */;
             primaryAction?: Action; secondaryActions?: Action[] /* max 2 */; overflowActions?: Action[] })
type Action = { label: string; onClick?(): void; href?: string; icon?: ReactNode; disabled?: boolean;
                disabledReason?: string; loading?: boolean; tone?: 'default'|'danger' };

// components/ds/StickyActionBar.tsx   (mobile primary + page save bars; positions above --kx-bottom-nav)
StickyActionBar({ status?: ReactNode; primary: Action; secondary?: Action; overflow?: Action[]; visible?: boolean })

// components/ds/Card.tsx
Card({ title?: string; description?: string; actions?: ReactNode; padding?: 'none'|'md'; children })
// components/ds/Section.tsx  (heading + content, no box; used in drawers and forms)
Section({ title: string; description?: string; action?: ReactNode; id?: string; children })
```

### Actions
```ts
// components/ds/Button.tsx
Button({ variant?: 'primary'|'secondary'|'ghost'|'danger'|'dangerGhost'|'link'; size?: 'sm'|'md'|'lg';
         icon?: ReactNode; loading?: boolean; fullWidth?: boolean; href?: string; ...ButtonHTMLAttributes })
// components/ds/IconButton.tsx      (label required → tooltip + aria-label)
IconButton({ icon: ReactNode; label: string; size?: 'sm'|'md'; onClick; tone?: 'default'|'danger'; badge?: number })
// components/ds/OverflowMenu.tsx
OverflowMenu({ actions: Action[]; label?: string /* aria, default "More actions" */; placement?: 'bottom-end'|'top-end' })
// components/ds/BulkBar.tsx
BulkBar({ count: number; onClear(): void; primary: Action; secondary?: Action[]; overflow?: Action[] })
```

### Data display
```ts
// components/ds/StatusPill.tsx
StatusPill({ status: StatusKey; label?: string /* override with count, e.g. "3 changes not sent" */; size?: 'sm'|'md'; pulse?: boolean })
type StatusKey = OrderStatus | ListingStatus | ChangeStatus | ConnectionStatus | BillingStatus | MessageStatus; // from lib/ds/statusMap.ts

// components/ds/HealthScore.tsx
HealthScore({ score: number /* 0–100 */; variant?: 'inline'|'summary'; showBand?: boolean; potential?: number })
HealthChecklist({ checks: { id: string; label: string; state: 'pass'|'warn'|'fail'; points: number; onFix?(): void }[] })

// components/ds/LogoTile.tsx
LogoTile({ id: MarketplaceId | CarrierId | ToolId; size?: 20|24|32|40; title?: string /* default brand name */ })
// components/ds/Money.tsx, Num.tsx, DateText.tsx
Money({ value: number; currency: string; compact?: boolean; signed?: boolean; muted?: boolean })
Num({ value: number; style?: 'decimal'|'percent'; compact?: boolean; unit?: 'kg'|'lb'|'cm'|'in' })
DateText({ value: Date|string; format?: 'date'|'datetime'|'relative'|'shipBy'; tz?: string })

// components/ds/StatTile.tsx   (replaces components/ui/StatCard.tsx; no color prop)
StatTile({ label: string; value: ReactNode; delta?: { value: number; period: string; goodWhen?: 'up'|'down' };
           spark?: number[]; href?: string; loading?: boolean; info?: string /* (?) tooltip: definition + source */ })
// components/ds/UsageMeter.tsx
UsageMeter({ label: string; used: number; limit: number /* Infinity ok */; resetAt?: Date })
// components/ds/Thumbnail.tsx
Thumbnail({ src?: string; alt: string; size?: 32|40|56|80; fallback?: 'image'|'initials'; badge?: ReactNode })
// components/ds/Avatar.tsx
Avatar({ name: string; src?: string; size?: 24|32|40; marketplace?: MarketplaceId /* small logo badge */ })
// components/ds/KeyValueList.tsx   (drawer details)
KeyValueList({ items: { label: string; value: ReactNode; copyable?: boolean }[]; columns?: 1|2 })
// components/ds/Callout.tsx
Callout({ tone: 'info'|'warning'|'danger'|'success'; title: string; children?: ReactNode; actions?: Action[]; onDismiss?(): void })
// components/ds/Tooltip.tsx, InfoTip.tsx  ((?) glossary helper)
InfoTip({ term: string; children: ReactNode })
```

### Lists and tables
```ts
// components/ds/DataTable.tsx
DataTable<T>({
  rows: T[]; rowKey(row: T): string; columns: Column<T>[];
  card: { thumbnail?(r: T): ReactNode; title(r: T): ReactNode; meta?(r: T): ReactNode;
          status?(r: T): ReactNode; amount?(r: T): ReactNode; action?(r: T): ReactNode };
  density?: 'comfortable'|'compact'; selectable?: boolean; selected?: Set<string>; onSelectedChange?(s: Set<string>): void;
  onRowClick?(r: T): void; rowActions?(r: T): Action[]; loading?: boolean; error?: unknown; onRetry?(): void;
  empty: ReactNode /* <EmptyState> */; hasMore?: boolean; onLoadMore?(): void; sort?: SortState; onSortChange?(s: SortState): void;
})
type Column<T> = { id: string; header: string; cell(r: T): ReactNode; width?: number|string; align?: 'left'|'right';
                   sortable?: boolean; hideBelow?: 'lg'|'xl' };

// components/ds/FilterBar.tsx
FilterBar({ search: { value: string; onChange(v: string): void; placeholder: string };
            filters: FilterDef[] /* first 3 visible, rest in sheet */; values: Record<string, unknown>;
            onChange(values: Record<string, unknown>): void; total?: number; sort?: { options; value; onChange };
            viewOptions?: Action[] })
type FilterDef = { id: string; label: string; type: 'select'|'multiselect'|'dateRange'|'marketplace'|'boolean'|'numberRange';
                   options?: { value: string; label: string; logo?: MarketplaceId; count?: number }[]; pinned?: boolean };
// components/ds/FiltersSheet.tsx
FiltersSheet({ open; onClose; filters: FilterDef[]; values; onApply(values): void; onReset(): void })
// components/ds/SavedViews.tsx
SavedViews({ views: { id: string; label: string; count?: number; system?: boolean }[]; activeId: string;
             onSelect(id: string): void; onSave?(name: string): void; onDelete?(id: string): void })
// components/ds/SearchField.tsx
SearchField({ value; onChange; placeholder: string; debounceMs?: number; autoFocusShortcut?: '/' })
// components/ds/DateRangePicker.tsx
DateRangePicker({ value: { from: Date; to: Date; preset?: PresetId }; onChange(v): void;
                  presets?: PresetId[]; maxDate?: Date; label?: string /* "Date" */ })
```

### Overlays
```ts
// components/ds/DetailDrawer.tsx
DetailDrawer({ open; onClose(): void; title: string; meta?: ReactNode; leading?: ReactNode; status?: ReactNode;
               size?: 'sm'|'md'|'lg'|'xl' /* 400/480/640/880 */; sections?: { id: string; label: string }[] /* anchor chips */;
               footer?: { primary?: Action; secondary?: Action; overflow?: Action[]; status?: ReactNode };
               dirty?: boolean /* confirms on close */; onBack?(): void; loading?: boolean; error?: unknown; children })
DrawerSection({ id: string; title: string; action?: ReactNode; children })
// components/ds/Modal.tsx
Modal({ open; onClose; title: string; size?: 'sm'|'md'; layer?: 'page'|'nested'; primary: Action; secondary?: Action; children })
// components/ds/ConfirmDialog.tsx   (moved from components/ui; API unchanged: useConfirm(options))
// components/ds/Sheet.tsx            (mobile bottom sheet primitive used by Drawer/Filters/DateRange)
Sheet({ open; onClose; title?: string; height?: 'auto'|'full'; children; footer?: ReactNode })
```

### Forms
```ts
// components/ds/FormField.tsx
FormField({ label: string; htmlFor: string; required?: boolean; optional?: boolean; helper?: ReactNode;
            error?: string; counter?: { value: number; max: number }; info?: string; children })
TextInput({ ...InputHTMLAttributes; prefix?: ReactNode; suffix?: ReactNode; invalid?: boolean; width?: 'xs'|'sm'|'md'|'lg'|'full' })
TextArea({ autoGrow?: true; minRows?: number; ... })
Select({ options: { value; label; logo?: MarketplaceId }[]; value; onChange; placeholder?: string })
Combobox({ options | loadOptions(q): Promise<Option[]>; value; onChange; multiple?: boolean; creatable?: boolean })
MoneyInput({ value: number|null; currency: string; onChange(v: number|null): void })   // locale-aware parsing
NumberInput({ value; onChange; unit?: string; min?; max?; step? })
CountrySelect({ value: string /* ISO-2 */; onChange })
PhoneInput({ value; onChange; defaultCountry?: string })
TagInput({ value: string[]; onChange; max?: number; maxLength?: number; separator?: ',' })  // Etsy 13×20 rules
SwitchRow({ label: string; description?: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean })
Checkbox, Radio, RadioCards({ options: { value; title; description?; logo?; meta?: ReactNode }[] })  // carrier/service pick
FormErrorSummary({ errors: { field: string; message: string }[] })
```

### Feedback
```ts
// components/ds/EmptyState.tsx      (replaces components/ui/EmptyState.tsx)
EmptyState({ kind: 'first-use'|'no-results'|'all-done'; icon?: LucideIcon; title: string; description?: string;
             primary?: Action; secondary?: Action; steps?: { label: string; done: boolean; href?: string }[] })
// components/ds/ErrorState.tsx      (existing API kept + variant)
ErrorState({ title?; message?; error?; onRetry?; retrying?; variant?: 'page'|'inline'|'banner'; staleSince?: Date })
// components/ds/Skeleton.tsx
Skeleton({ variant: 'table'|'cards'|'tiles'|'drawer'|'form'|'text'; rows?: number })
// lib/ds/notify.ts
notify.success(msg, { action?, id? }) / notify.error(msg|err, { action?, id? }) / notify.info / notify.progress(id, { label, done, total })
// components/ds/SetupChecklist.tsx  (Overview onboarding)
SetupChecklist({ steps: { id; title; description; done: boolean; action: Action }[]; onDismiss?(): void })
```

### Domain composites built on the DS (not in `ds/`, but specified so they're consistent)
- `components/orders/OrdersTable.tsx`, `OrderDrawer.tsx`
- `components/shipping/CreateLabelDrawer.tsx`: one drawer, with `carrier: 'fedex'|'ups'|'dhl'`. Per-carrier field sets live in `lib/shipping/carrierForms.ts`. It replaces `UPSLabelDrawer.tsx`, `MngLabelDrawer.tsx` and the FedEx drawer.
- `components/listings/ListingsPage.tsx` (marketplace-agnostic, with an adapter per marketplace), `ListingEditor.tsx` (full page)
- `components/research/ResearchHub.tsx` (§6.6)

---

## 5. Visual findings → resolution

| # | Finding (visual_findings.md) | Resolved by |
|---|---|---|
| 1 | No shared page header; "Settings" twice; "<Page> - KolayXport" in top bar inconsistently | `PageHeader` is the only h1 (§3.2). The top bar has no title (§3.1). `<title>` comes from `Page title` |
| 2 | 4+ button styles (gradient, flat, green, uppercase, outline) | §3.8 variants; gradients and green removed from the theme; `textTransform:'none'`; P1 one primary per view; delete `.btn-primary` |
| 3 | 3+ score representations (box, ring, letter, square) | `HealthScore` 0–100 with 4 bands, everywhere; Trendyol letters converted (§3.10) |
| 4 | Currency formatting chaos ("2999.00 TRY", "TRY 1,070,860.03", "₺163.7K") | `<Money>` with Intl `narrowSymbol` and locale grouping; compact only in KPIs with a tooltip; `.toFixed` lint ban (§3.11) |
| 5 | Native date inputs beside MUI floating-label fields; mixed heights | `DateRangePicker` only; native date inputs banned; `FormField` labels above; 40/44px control height token (§3.3, §3.7) |
| 6 | Mixed EN/TR strings; ASCII Turkish | P2: `jsx-no-literals` lint, a single-locale screen rule, a Turkish character check in i18n review; glossary §3.17 |
| 7 | "FAİLED" / "RECEİVED" uppercase bug | No `text-transform: uppercase` anywhere (theme plus lint on `uppercase` class); sentence-case strings (P2) |
| 8 | Collapsed sidebar: identical icons for products/research | Real marketplace logos via `LogoTile` in nav; one Research item; tooltips on the rail (§3.1) |
| 9 | Pages full width at 1440+; 1400px inputs | `Page width` caps: list 1600, dashboard 1280, detail 1200, form 880; field width presets (§3.2, §3.7) |
| 10 | Rainbow KPI tiles, gradient heroes | P3; `StatTile` has no color prop; no hero banners; a semantic-only color rule (§3.16) |
| 11 | Raw HTML entities from Etsy ("one&#39;s"), round-tripped on save | P6: decode once in mappers (`lib/text/decodeEntities.ts`), store decoded, and a test that a save never sends `&#\d+;` |
| 12 | Overview: "All Features Free" banner; 6 dead nav tiles; empty half | Overview rebuilt as a "Today" to-do list + KPIs + setup checklist (§6.5); no promo banners in-app (§3.2) |
| 13 | Orders toolbar: 13 controls across 2 rows | `FilterBar`: search + 3 filters + Filters sheet + SavedViews tabs replace the segmented control; Sync/Add/ETGB move to header secondary and overflow (§3.3, §6.1) |
| 14 | Ship-by chip duplicates info ("Tomorrow 10/15/2026, 10:59 PM") | `DateText format="shipBy"` shows relative only, with the absolute in a tooltip and tone by urgency (§3.9, §3.11) |
| 15 | Two unclear status chips ("Awaiting Fulfillment" + "Received") | One mapped fulfilment `StatusPill`; the raw status appears only in the drawer (§3.9) |
| 16 | Tiny icon buttons, "+ Cost" chip | `IconButton` 40/44 with labels; cost becomes a field in `OrderDrawer` "Costs" section; chips are for filters and tags only |
| 17 | "Already has tracking" rendered as a green outline button | Pills are non-interactive and buttons are actions; tracking is shown as a `KeyValueList` row with a copy button (§3.9) |
| 18 | Carrier buttons without logos; "Delete order" next to primary actions | `RadioCards` with `LogoTile` carriers inside `CreateLabelDrawer`; delete only in ⋯ (§3.5, §6.4) |
| 19 | "Unlabeled" filter shows Amazon Shipped orders; "Amazon Customer" / "-" placeholder | Saved views built on mapped status keys (`to_ship`); `Avatar` and `Thumbnail` fallbacks ("Buyer name hidden by Amazon" helper) instead of "-" |
| 20 | FedEx drawer: uppercase title/button, empty phone, free-text country, uneven grid, no sender summary, no rates | One `CreateLabelDrawer`: prefilled recipient (phone from order), `CountrySelect`, sender summary card, rate `RadioCards` with price and ETA, primary "Create label · ₺412,50" (§6.4) |
| 21 | UPS drawer: 4 collapsed accordions + "Save" | Same drawer; sections always expanded; one-scroll; correct verb (§3.5) |
| 22 | MNG drawer: third structure, wrong brand name | Same drawer; brand "DHL eCommerce" (glossary) |
| 23 | Add Manual Order centered modal, USD default for TR sellers | Becomes a drawer (more than 3 fields); currency defaults from store or locale (§3.6) |
| 24 | 4 different listings layouts; two sync concepts; "View: Compact/Detailed/All" | One `ListingsPage` with a marketplace switcher, one FilterBar, density in ⋯; "Refresh from Etsy" vs "Send changes" vocabulary (§3.17, §6.2) |
| 25 | eBay row icons pencil/copy/red trash | One row action plus ⋯; delete in ⋯ with confirm (§3.4) |
| 26 | Trendyol "Filter by St…" table header bug | Headers come from `Column.header` (string, i18n); filters live only in the FilterBar |
| 27 | Wix filled-blue pill selection style | One selection style: `brand-50` fill plus a 2px indicator (nav) or a checkbox plus `brand-50` row (tables) |
| 28 | Editor: 9 tabs, Basics 4th | Full-page `ListingEditor` with one scroll and an anchored section nav in task order: Photos → Title & description → Tags → Category & details → Price & stock → Variations → Personalization → Shipping (§6.3) |
| 29 | Editor footer: 6 equal buttons, disabled "Save Draft", no "Sync to Etsy", no status | `StickyActionBar`: status "Saved · 3 changes not sent", secondary "Preview", ⋯ (Copy, Schedule, Deactivate, Delete), primary "Send changes to Etsy" |
| 30 | Unlabeled undo and folder icons; "0 views · 0 favorites" | Labeled `IconButton`s with tooltips; stats move to a "Performance" section, hidden when zero (with an empty hint) |
| 31 | Fixed-height inner-scrolling description; entities; no preview | Auto-grow `TextArea`; decoded text; "Preview as on Etsy" toggle (§3.7) |
| 32 | Orange "No research data" warning in a corner | Becomes a `HealthChecklist` item with "Run research" as its Fix action, or an `EmptyState` inside the Tags section |
| 33 | No live preview; no quality score | Right rail: `HealthScore summary` + `HealthChecklist` + live marketplace preview card (§6.3) |
| 34 | Messages: no preview, no unread, all "1m", generic avatars, empty right pane | `DataTable` card mode with a last-message preview, an unread dot, `DateText relative`, `Avatar` with a marketplace badge; the right pane auto-opens the newest unread on desktop, with a `first-use`/`all-done` EmptyState otherwise |
| 35 | Etsy research: purple hero, implausible numbers, TR tips in EN UI, purple FAB | No heroes or FABs; P6 provenance line plus plausibility guard; tips are i18n (§6.6) |
| 36 | eBay research: two search bars, two marketplace selectors, empty button, stuck loader, empty table | `ResearchHub` with one search, one marketplace switcher, a 15s loader timeout to `ErrorState`, `EmptyState no-results` (§6.6) |
| 37 | Research not useful at all | Out of scope for a design system. §6.6 defines the surface: question-first entry, evidence cards and a "use this" handoff into the listing editor |
| 38 | Analytics: title mismatch, gradient Refresh, "TRY 1,070,860.03", dual-axis chart | `PageHeader` title = nav label ("Reports"); secondary Refresh; `<Money>`; one metric per chart (no dual axis) following the dataviz skill |
| 39 | Financials: gradient header, 10 rainbow tiles, gradient balance cards, native dates, green Sync | At most 8 identical `StatTile`s, `DateRangePicker`, secondary "Refresh data" in the header |
| 40 | Settings: duplicate titles, icon tab bar, yellow Etsy box, pale-green rows, "Last sync 3 weeks ago" with no action | Adopt `settings_spec.md` on these primitives: left section nav, `IntegrationTile` with `LogoTile`, `StatusPill`, the Etsy notice as an info `Callout` in the drawer, and a "Refresh now" action beside a stale sync time |

---

## 6. Wireframes

### 6.1 Orders: desktop (1440)

```
┌─sidebar─┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│         │ Orders                                            [↻ Sync now]  [⋯]   [ Create labels ]      │
│         │ 12 to ship today · last synced 4 min ago                       ↑ primary disabled until select│
│         │                                                                                              │
│         │  All 248 │ To ship 12 │ Label ready 3 │ Shipped │ Problems 2 │ + Save view                    │
│         │ ┌──────────────────────────────────────────┐ [Store: All ▾][Date: Last 30 days ▾][Carrier ▾] │
│         │ │🔍 Search order #, buyer, SKU, tracking    │ [⚙ Filters] [⋯]                248 orders      │
│         │ └──────────────────────────────────────────┘                                                 │
│         │ ┌──┬────────────────────────────────┬─────────────┬──────────────┬────────────┬──────┬────┐  │
│         │ │☐ │ Order                          │ Status      │ Ship by      │ Destination│ Total│    │  │
│         │ ├──┼────────────────────────────────┼─────────────┼──────────────┼────────────┼──────┼────┤  │
│         │ │☐ │[img] Personalized Baby Blanket │● To ship    │ Tomorrow     │ 🇺🇸 US      │$169,99│[Label]⋯│
│         │ │  │[E] #3412 · Emma W. · 2 items   │             │              │            │      │    │  │
│         │ │☐ │[img] Wooden Keepsake Box       │● To ship    │ Overdue 1 day│ 🇩🇪 DE      │ €84,00│[Label]⋯│
│         │ │  │[a] 113-55… · Buyer hidden      │             │  (red)       │            │      │    │  │
│         │ │☐ │[img] Bebek Battaniyesi         │● Label ready│ Today        │ 🇹🇷 İstanbul│₺1.109,30│[Print]⋯│
│         │ │  │[T] #9921 · Ayşe K.             │             │              │            │      │    │  │
│         │ └──┴────────────────────────────────┴─────────────┴──────────────┴────────────┴──────┴────┘  │
│         │                                   [ Load more ]                                              │
│         │                ┌─────────────────────────────────────────────────────────┐                   │
│         │                │ 3 selected   [ Create labels ] [Print packing slips] ⋯ ✕│ ← BulkBar (primary)│
│         │                └─────────────────────────────────────────────────────────┘                   │
└─────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
⋯ (header) = Add manual order · Export CSV · ETGB documents (2)
Row click → OrderDrawer (480): Items · Buyer & address (copy) · Shipping (tracking, carrier) · Costs · Notes · Marketplace status
```

### 6.1 Orders: mobile (375)

```
┌───────────────────────────────┐
│ Orders                 ↻   ⋯  │ 52px
├───────────────────────────────┤
│ All 248 │To ship 12│Label re… │ ← scrollable views
│ [🔍 Search orders           ] │ 44px
│ [⚙ Filters 1][Store ▾][Date ▾]│ ← chip row, scrolls
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │[img] Personalized Baby B…⋯│ │
│ │[E] #3412 · Emma W. · 🇺🇸   │ │
│ │● To ship · Ship by tomorrow│ │
│ │$169,99      [Create label]│ │ 44px button
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │[img] Wooden Keepsake Box ⋯│ │
│ │[a] 113-55… · 🇩🇪           │ │
│ │● To ship · Overdue 1 day  │ │
│ │€84,00       [Create label]│ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│ 2 selected  [Create labels] ✕ │ ← BulkBar above tab bar (select mode)
├───────────────────────────────┤
│ ⌂ Home ▣ Orders ▤ Listings ✉ ≡│ 60px tab bar
└───────────────────────────────┘
```

### 6.2 Listings: desktop (one page for all marketplaces)

```
┌─sidebar─┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│         │ [E] Listings · Etsy ▾                    [↻ Refresh from Etsy] [⋯]   [ + New listing ]       │
│         │ BelleCoutureGifts · 142 listings · 3 with changes not sent                                   │
│         │                                                                                              │
│         │ ┌ Callout(attention) ─────────────────────────────────────────────────────────────────────┐ │
│         │ │ 3 listings have changes not sent to Etsy.        [Review changes] [Send all to Etsy]      │ │
│         │ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
│         │  All 142 │ Active 118 │ Draft 9 │ Sold out 6 │ Needs work 21 │ Not sent 3 │ + Save view        │
│         │ [🔍 Search title, SKU, tag            ] [Section ▾][Health ▾][Price ▾] [⚙ Filters] [⋯]       │
│         │ ┌──┬─────────────────────────────────────┬──────────┬────────┬───────┬──────────┬────────┬──┐ │
│         │ │☐ │ Listing                             │ Status   │ Health │ Stock │ Price    │ Updated│  │ │
│         │ ├──┼─────────────────────────────────────┼──────────┼────────┼───────┼──────────┼────────┼──┤ │
│         │ │☐ │[img] Personalized Wooden Baby Box…  │● Active  │▰▰▰▱ 72 │ 14    │ $49,00   │ 2h ago │⋯ │ │
│         │ │  │     SKU KB-01 · Keepsake Boxes      │● 2 not sent        │       │          │        │  │ │
│         │ │☐ │[img] Custom Name Blanket Muslin…    │● Active  │▰▰▰▰ 91 │ 3     │ $39,00   │ Oct 2  │⋯ │ │
│         │ │☐ │[img] Engraved Jewelry Box Walnut…   │● Draft   │▰▱▱▱ 34 │ —     │ $64,00   │ Sep 28 │⋯ │ │
│         │ └──┴─────────────────────────────────────┴──────────┴────────┴───────┴──────────┴────────┴──┘ │
│         │   select → BulkBar: [ Edit in bulk ] [Change price] [Add tags] ⋯ (Deactivate, Delete)        │
└─────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
"Listings · Etsy ▾" switcher lists connected marketplaces with logos (Etsy, eBay, Trendyol, Wix, Shopify) + "All marketplaces".
Columns adapt via adapter (eBay: Watchers; Trendyol: Barcode, Commission) but layout, filters, pills, HealthScore are identical.
Row click → full-page ListingEditor. ⋯ row = Open on Etsy · Copy · Deactivate · Delete.
```

### 6.2 Listings: mobile

```
┌───────────────────────────────┐
│ [E] Etsy ▾ Listings     ↻  ⋯  │
├───────────────────────────────┤
│ ⚠ 3 changes not sent  [Send]  │ compact callout
│ All 142│Active 118│Needs work…│
│ [🔍 Search listings         ] │
│ [⚙ Filters][Health ▾][Section]│
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │[img ] Personalized Wooden │ │
│ │[56px] Baby Box, Engraved… │ │
│ │       ● Active ▰▰▰▱ 72    │ │
│ │       $49,00 · 14 in stock│ │
│ │       ● 2 changes not sent│ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │[img ] Custom Name Blanket…│ │
│ │       ● Active ▰▰▰▰ 91    │ │
│ │       $39,00 · 3 in stock │ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│      [ + New listing ]        │ sticky primary, 48px
├───────────────────────────────┤
│ ⌂  ▣  ▤  ✉  ≡                 │
└───────────────────────────────┘
```

### 6.3 Listing editor: desktop (full page, `width="detail"`)

```
┌─sidebar─┬──────────────────────────────────────────────────────────────────────────────────────────────┐
│         │ ‹ Listings                                                                                   │
│         │ [E] Personalized Wooden Baby Box, Engraved Keepsake…   ● Active   ● 3 changes not sent        │
│         │ Etsy · Listing 1543219987 · Open on Etsy ↗                                                   │
│         │ ┌──────────────┐┌─────────────────────────────────────────┐┌──────────────────────────────┐  │
│         │ │ Photos     ✓ ││ Photos & video                          ││ Listing health               │  │
│         │ │ Title      ! ││ [img1★][img2][img3][img4][ + Add ]      ││ 72  Good                     │  │
│         │ │ Description  ││ drag to reorder · tap to edit alt text  ││ ▰▰▰▰▰▰▰▱▱▱  +18 possible      │  │
│         │ │ Tags       ! ││ 4 of 10 photos · add 6 more for reach   ││ ✓ Title length 118/140       │  │
│         │ │ Category     ││                                         ││ ! Only 4 photos      [Fix]   │  │
│         │ │ Price&stock  ││ Title & description                     ││ ! 2 tags repeat title [Fix]  │  │
│         │ │ Variations   ││ Title *                       118/140   ││ ✕ No video          [Add]    │  │
│         │ │ Personaliz.  ││ [Personalized Wooden Baby Box, Engr…]   ││──────────────────────────────│  │
│         │ │ Shipping     ││ [✦ Improve with AI]                     ││ Preview on Etsy  (search ▾)  │  │
│         │ │ Performance  ││ Description                             ││ ┌──────────────────────────┐ │  │
│         │ │              ││ ┌─────────────────────────────────────┐ ││ │ [img]                    │ │  │
│         │ │ (anchor nav, ││ │ auto-growing text, no inner scroll  │ ││ │ Personalized Wooden Baby │ │  │
│         │ │  sticky)     ││ │ …                                   │ ││ │ Box, Engraved Keepsake…  │ │  │
│         │ └──────────────┘│ └─────────────────────────────────────┘ ││ │ $49,00  ★ BelleCouture   │ │  │
│         │                 │ [Edit | Preview]                        ││ └──────────────────────────┘ │  │
│         │                 │ Tags                       11/13        ││ sticky rail                  │  │
│         │                 │ [baby keepsake ✕][new baby gift ✕]…     │└──────────────────────────────┘  │
│         │                 │ [ add tags, comma separated ]           │                                  │
│         │                 │ Suggested from research: [+ newborn box]│                                  │
│         │                 │  … Category & details · Price & stock · Variations · Personalization …   │
│         │                 └─────────────────────────────────────────┘                                  │
│         ├──────────────────────────────────────────────────────────────────────────────────────────────┤
│         │ ✓ Saved 2s ago · 3 changes not sent to Etsy      [⋯]   [ Preview ]   [ Send changes to Etsy ] │ sticky
└─────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
⋯ = Copy listing · Schedule changes · Save as template · Deactivate · Delete (red, typeToConfirm)
Autosave writes the local EtsyListingDraft (never Etsy). Conflict → danger Callout at top: "This listing changed on Etsy after
you started editing. [Review differences]" — Send is disabled until resolved.
```

### 6.3 Listing editor: mobile

```
┌───────────────────────────────┐
│ ‹  Edit listing   ▰▰▰▱ 72   ⋯ │ 52px, health opens checklist sheet
├───────────────────────────────┤
│ [Photos][Title][Tags][Price]… │ sticky anchor chips (scroll)
├───────────────────────────────┤
│ Photos & video                │
│ [img1★][img2][img3][ + ]  →   │ horizontal strip, 80px
│ 4 of 10 · add more for reach  │
│                               │
│ Title *              118/140  │
│ [Personalized Wooden Baby…  ] │ 16px text
│ [✦ Improve with AI]           │
│                               │
│ Description                   │
│ [ auto-growing …            ] │
│                               │
│ Tags                   11/13  │
│ [baby keepsake ✕][new baby…✕] │
│ …                             │
├───────────────────────────────┤
│ ✓ Saved · 3 not sent          │
│ [ Preview ] [Send to Etsy   ] │ 48px, 50/50, above tab bar
├───────────────────────────────┤
│ ⌂  ▣  ▤  ✉  ≡                 │
└───────────────────────────────┘
```

### 6.4 Create-label drawer: desktop (DetailDrawer size md 480, one template for all carriers)

```
                                   ┌─────────────────── 480 ───────────────────┐
                                   │ Create label · Order #3412          ⋯  ✕  │
                                   │ [E] Etsy · 2 items · 0,8 kg               │
                                   ├───────────────────────────────────────────┤
                                   │ Carrier                                   │
                                   │ ┌─────────────┐┌─────────────┐┌──────────┐│
                                   │ │[FedEx] ◉    ││[UPS] ○      ││[DHL] ○   ││ RadioCards w/ logos
                                   │ │ Connected   ││ Connected   ││ TR only  ││
                                   │ └─────────────┘└─────────────┘└──────────┘│
                                   │ Ship to                          [Edit]   │
                                   │ Emma Wilson · +1 415 555 0134             │ ← phone prefilled from order
                                   │ 12 Oak St, San Francisco CA 94110, 🇺🇸 US │
                                   │ ✓ Address verified                        │
                                   │ Ship from                        [Change] │
                                   │ BelleCouture · İstanbul 34000, 🇹🇷 TR      │ ← sender profile summary
                                   │ Package                                   │
                                   │ Preset [Small box 30×20×10 ▾]             │
                                   │ Weight [ 0,8 ] kg   Packages [ 1 ]        │
                                   │ Service & rate                            │
                                   │ ◉ FedEx International Priority  ₺412,50   │
                                   │   Arrives Oct 18 (3 days)                 │
                                   │ ○ FedEx International Economy   ₺318,20   │
                                   │   Arrives Oct 21 (6 days)                 │
                                   │ Customs (international)                   │
                                   │ Contents [Gift ▾]  Value $169,99 (from order)│
                                   │ 2 items · HS 4420.10 · Origin TR  [Edit]  │
                                   │ [■] Send ETGB documents automatically (?) │
                                   ├───────────────────────────────────────────┤
                                   │ ⋯           [Cancel] [Create label · ₺412,50]│ sticky
                                   └───────────────────────────────────────────┘
⋯ = Save as draft · Use different sender · Open carrier help
Errors: field-level + top FormErrorSummary; carrier error shows inline Callout(danger) with plain message, "Show details" for raw.
UPS/DHL: same sections; carrier-specific fields (e.g. DHL desi, UPS reference) appear inside Package/Customs via carrierForms.ts.
Success → drawer content swaps to: ✓ Label created · tracking (copy) · [Print label] (primary) · [Done].
```

### 6.4 Create-label drawer: mobile (full-height sheet)

```
┌───────────────────────────────┐
│ ───                           │ drag handle
│ Create label · #3412       ✕  │ sticky
├───────────────────────────────┤
│ Carrier                       │
│ [FedEx ◉][UPS ○][DHL ○]       │ 44px logo segments
│ Ship to              [Edit]   │
│ Emma Wilson · +1 415 555…     │
│ San Francisco, 🇺🇸 US          │
│ Ship from          [Change]   │
│ BelleCouture · İstanbul       │
│ Package                       │
│ [Small box 30×20×10       ▾]  │
│ Weight [0,8   ] kg            │
│ Service                       │
│ ◉ Intl Priority  ₺412,50  3d  │
│ ○ Intl Economy   ₺318,20  6d  │
│ Customs  2 items · $169,99 ›  │ drill-in
├───────────────────────────────┤
│ [Cancel] [Create · ₺412,50  ] │ 48px sticky
└───────────────────────────────┘
```

### 6.5 Overview: desktop (`width="dashboard"`, 1280)

```
┌─sidebar─┬──────────────────────────────────────────────────────────────────────────────┐
│         │ Good morning, Tamer                                    [Date: Last 7 days ▾] │
│         │ Here's what needs you today                                                  │
│         │                                                                              │
│         │ ┌ To do ────────────────────────────────────────────────────────────────────┐│
│         │ │ ▣  12 orders to ship · 1 overdue                         [ Ship orders ]  ││ ← page primary
│         │ │ ✉  3 messages need a reply                                [Open inbox]    ││
│         │ │ ▤  3 listings have changes not sent to Etsy               [Review]        ││
│         │ │ ⚠  eBay needs reconnecting                                [Reconnect]     ││
│         │ │ ▰  21 listings are below "Good" health                    [Improve]       ││
│         │ └───────────────────────────────────────────────────────────────────────────┘│
│         │ ┌──────────────┐┌──────────────┐┌──────────────┐┌──────────────┐              │
│         │ │ Revenue      ││ Orders       ││ Avg order    ││ Profit (est.)│ identical    │
│         │ │ ₺84.210,00   ││ 62           ││ ₺1.358,23    ││ ₺21.400,00 (?)│ StatTiles   │
│         │ │ ▲ 12% vs prev││ ▲ 4          ││ ▼ 3%         ││ ▲ 8%         │              │
│         │ └──────────────┘└──────────────┘└──────────────┘└──────────────┘              │
│         │ ┌ Revenue by day ─────────────────────────┐┌ By marketplace ──────────────────┐│
│         │ │ single brand line, axis in ₺            ││ [E] Etsy       ₺52.100  62%  ▬▬▬ ││
│         │ │                                         ││ [T] Trendyol   ₺21.300  25%  ▬   ││
│         │ │                                         ││ [a] Amazon     ₺10.810  13%  ▬   ││
│         │ └─────────────────────────────────────────┘└──────────────────────────────────┘│
│         │ ┌ Get set up · 3 of 5 done ──────────────────────────────────────────── ✕ ┐   │
│         │ │ ✓ Connect a store  ✓ Sender profile  ✓ First label  ○ Connect FedEx [Set up]│ │
│         │ └─────────────────────────────────────────────────────────────────────────┘   │
└─────────┴──────────────────────────────────────────────────────────────────────────────┘
New user (nothing connected): To-do card is replaced by EmptyState first-use "Connect your first store" + SetupChecklist;
KPIs hidden (not zeros). Mixed-currency revenue shown converted to TRY with "(converted)" note in the (?) tooltip.
```

### 6.5 Overview: mobile

```
┌───────────────────────────────┐
│ Good morning, Tamer      🔔   │
├───────────────────────────────┤
│ To do                         │
│ ┌───────────────────────────┐ │
│ │▣ 12 orders to ship      › │ │ 56px rows, whole row tappable
│ │  1 overdue                │ │
│ ├───────────────────────────┤ │
│ │✉ 3 messages need reply  › │ │
│ ├───────────────────────────┤ │
│ │▤ 3 changes not sent     › │ │
│ ├───────────────────────────┤ │
│ │⚠ Reconnect eBay         › │ │
│ └───────────────────────────┘ │
│ Last 7 days ▾                 │
│ ┌────────────┐┌────────────┐  │
│ │Revenue     ││Orders      │  │ 2-up tiles
│ │₺84.210     ││62          │  │
│ │▲ 12%       ││▲ 4         │  │
│ └────────────┘└────────────┘  │
│ [ revenue sparkline card ]    │
│ Get set up · 3 of 5      ›    │
├───────────────────────────────┤
│ ⌂  ▣  ▤  ✉  ≡                 │
└───────────────────────────────┘
```

### 6.6 Research Hub (the founder's top complaint: the surface pattern only)

The system can't make research useful by itself. It can force research to answer a seller's question with evidence and hand the result into an action. Proposed surface:

```
┌─sidebar─┬──────────────────────────────────────────────────────────────────────────────────────┐
│         │ Research                                     [Marketplace: [E] Etsy ▾]                │
│         │ Find what to sell, how to price it and which words buyers use                        │
│         │ ┌────────────────────────────────────────────────────────────────────────┐           │
│         │ │🔍 Try "wooden baby keepsake box" or paste an Etsy listing link          │ [Research]│
│         │ └────────────────────────────────────────────────────────────────────────┘           │
│         │  What do you want to know?                                                           │
│         │  ( Is this niche worth it? ) ( What price should I charge? ) ( Which tags? ) ( Why    │
│         │    is my listing not selling? )                                                      │
│         │ ─────────────────────────────────────────────────────────────────────────────────── │
│         │ Wooden baby keepsake box · Etsy US · 48 listings sampled · updated 2h ago   (?) how  │
│         │ ┌ Verdict ───────────────────────────────────────────────────────────────────────┐   │
│         │ │ Worth testing. Demand is steady, 30% of top sellers are under 1 year old.      │   │
│         │ │ Confidence: Medium (48 listings, no sales data from Etsy API)                  │   │
│         │ └────────────────────────────────────────────────────────────────────────────────┘   │
│         │ ┌ Price ──────────────┐┌ Competition ─────────┐┌ Buyer words ──────────────────────┐ │
│         │ │ Most sell $38–$62   ││ 48 similar listings  ││ newborn keepsake · baby memory box│ │
│         │ │ median $49,00       ││ 6 strong shops       ││ engraved baby box · …             │ │
│         │ │ [Use $49 in listing]││ [See top 10]         ││ [Add 5 tags to a listing]         │ │
│         │ └─────────────────────┘└──────────────────────┘└───────────────────────────────────┘ │
│         │ Top listings (DataTable: thumbnail, title, price, reviews, age, shop) ……              │
└─────────┴──────────────────────────────────────────────────────────────────────────────────────┘
```
Rules:
- One search and one marketplace switcher. No hero, no FAB. AI help lives in the Cmd+K assistant.
- Every number has a provenance line. Values outside sanity bounds (for example avg price over 10× the sample median) are dropped and the count is shown in the (?) note.
- Every card ends in an action that writes into a listing draft ("Use $49", "Add tags").
- A stuck loader times out after 15s and falls back to `ErrorState`. With no query, show recent searches plus "Your listings that need work" (HealthScore < 60), so the page is never blank.

---

## 7. Adoption plan (short)

1. **Foundation:**
   - Add `lib/ds/tokens.ts`, the new `lib/theme.tsx`, `next/font` Inter and the `@theme` tokens. Keep Tailwind default colors for now.
   - Delete the gradients from the theme, which alone fixes most button chaos globally.
   - Add lint rules: no `type="date"`, no `uppercase`, no `@mui/icons-material` in new code, no `.toFixed(` in TSX, `jsx-no-literals`.
2. **Primitives:** build `components/ds/*` and shim `components/ui/*` to them. Settings Group A builds on `ds/` instead of `components/settings/ui/`.
3. **Shell:** AppShell with logos, PageHeader everywhere, and Page widths.
4. **Flows, in user-value order:** Orders + CreateLabelDrawer → Listings page + ListingEditor → Overview → Settings (spec) → Messages → Reports/Finance → Research Hub (with the product rethink).
5. **Cleanup:** remove the default Tailwind colors (`--color-*: initial`), `@mui/icons-material`, `StatCard`, `SubscriptionDashboard`, and the old drawers.

Each step is verified at 375px and 1440px in EN and TR before it ships, with `npx next build --webpack` passing.

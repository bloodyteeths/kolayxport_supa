# KolayXport tokens: paste-ready code

This file is the implementation of `DESIGN_SYSTEM.md` §2. Target versions: `@mui/material` 5.17, `@mui/x-data-grid` 8.3, Tailwind 4.1, Next 16 (Pages Router).

Paste order (M0 Foundation):
1. `lib/ds/tokens.ts`
2. `styles/tokens.css`, plus the `globals.css` head change
3. `lib/theme.tsx` (replace the file; `_app` already imports `../lib/theme`)
4. The `pages/_app.tsx` changes (font, `lang`, Toaster)
5. `__tests__/ds/tokens-parity.test.ts`
6. `eslint.config.mjs` and `design/migrated-paths.json`

What M0 deliberately keeps unchanged:
- MUI `spacing` stays 8.
- No global `InputLabel shrink` and no hidden notch legend.
- Tailwind default palettes, radii, spacing and breakpoints stay.
- MUI `h1`–`h6` stay defined (remapped).

---

## 1. `lib/ds/tokens.ts` (the single source of truth)

```ts
// lib/ds/tokens.ts — the ONLY place raw design values live. styles/tokens.css mirrors it
// (enforced by __tests__/ds/tokens-parity.test.ts).

export const neutral = {
  0: '#FFFFFF', 25: '#FBFCFD', 50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1',
  400: '#94A3B8', 500: '#64748B', 600: '#475569', 700: '#334155', 800: '#1E293B', 900: '#0F172A',
} as const;

export const accent = {
  50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8', 800: '#1E40AF',
} as const;

export type ToneKey = 'success' | 'warning' | 'danger' | 'info' | 'attention' | 'neutral';
export const tone: Record<ToneKey, { bg: string; border: string; fg: string; solid: string }> = {
  success:   { bg: '#F0FDF4', border: '#BBF7D0', fg: '#15803D', solid: '#16A34A' },
  warning:   { bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309', solid: '#D97706' },
  danger:    { bg: '#FEF2F2', border: '#FECACA', fg: '#B91C1C', solid: '#DC2626' },
  info:      { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1D4ED8', solid: '#3B82F6' },
  attention: { bg: '#FFF7ED', border: '#FED7AA', fg: '#C2410C', solid: '#EA580C' },
  neutral:   { bg: '#F1F5F9', border: '#E2E8F0', fg: '#475569', solid: '#94A3B8' },
};

/** Used ONLY inside <LogoTile> (monogram fallback background). */
export const brand = {
  etsy: '#F1641E', ebay: '#E53238', amazon: '#FF9900', shopify: '#95BF47', wix: '#000000',
  trendyol: '#F27A1A', hepsiburada: '#FF6000', n11: '#6E2C91',
  fedex: '#4D148C', ups: '#351C15', dhl: '#FFCC00', shippo: '#1B9C85',
  veeqo: '#2A2E3B', parasut: '#00A1E4', google: '#4285F4', chrome: '#4285F4',
} as const;

/** Charts only, in series order. */
export const chart = ['#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DB2777', '#64748B'] as const;

export const font = {
  sans: 'var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** [fontSize, lineHeight, fontWeight, letterSpacing] in px / em */
export const type = {
  display: [28, 36, 600, '-0.02em'],
  titleLg: [20, 28, 600, '-0.015em'],
  titleMd: [16, 24, 600, '-0.01em'],
  titleSm: [14, 20, 600, '0'],
  body:    [14, 20, 400, '0'],
  dense:   [13, 18, 400, '0'],
  label:   [13, 18, 500, '0'],
  caption: [12, 16, 400, '0'],
  micro:   [11, 14, 500, '0.01em'],
} as const;

/** px. Use these in DS sx (`p: px(space[3])`), never theme.spacing multiples (MUI spacing stays 8 for legacy). */
export const space = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const px = (n: number) => `${n}px`;

export const control = { sm: 32, md: 40, lg: 44, xl: 48 } as const;
export const radius = { xs: 4, sm: 6, md: 8, lg: 12, full: 9999 } as const;

export const elevation = {
  e0: 'none',
  e1: '0 1px 2px rgb(15 23 42 / .06)',
  e2: '0 4px 12px rgb(15 23 42 / .08), 0 1px 3px rgb(15 23 42 / .06)',
  e3: '0 12px 32px rgb(15 23 42 / .12), 0 2px 6px rgb(15 23 42 / .06)',
  e4: '0 24px 64px rgb(15 23 42 / .18)',
} as const;
export const focusRing = '0 0 0 3px rgb(37 99 235 / .28)';
export const backdrop = 'rgb(15 23 42 / .32)';

export const zIndex = {
  stickyHeader: 2, stickyToolbar: 20, stickyActionBar: 1040, tabBar: 1050, topBar: 1100, sidebar: 1150,
  drawer: 1200, modal: 1500, nestedModal: 1550, popover: 1600, palette: 1650, toast: 1700, tooltip: 1800,
} as const;

export const motion = {
  instant: 80, fast: 140, base: 200, slow: 280,
  ease: 'cubic-bezier(.2,0,0,1)',
} as const;

export const layout = {
  sidebar: 240, sidebarRail: 64, topBar: 52, topBarMobile: 48, tabBar: 56,
  maxList: 1600, maxDetail: 1280, maxForm: 880, maxReading: 720, fieldMax: 480, longFieldMax: 720,
  gutter: 24, gutterMobile: 16, rowH: 44, rowHCompact: 36,
} as const;

export const panelWidth = { sm: 440, md: 560, lg: 720, xl: 960 } as const;
export const breakpoints = { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } as const;

/** Flat map used by the parity test: CSS var name (without --color-) -> hex. */
export function colorVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(neutral)) out[`neutral-${k}`] = v;
  for (const [k, v] of Object.entries(accent)) out[`accent-${k}`] = v;
  for (const [name, t] of Object.entries(tone)) {
    if (name === 'neutral') continue; // neutral tone is expressed via neutral-* scale
    out[`${name}-bg`] = t.bg; out[`${name}-border`] = t.border; out[`${name}-fg`] = t.fg; out[name] = t.solid;
  }
  return out;
}
```

---

## 2. `styles/tokens.css` (Tailwind v4 `@theme`, imported by `globals.css`)

```css
/* styles/tokens.css — mirrors lib/ds/tokens.ts (parity-tested). Additive: Tailwind defaults stay until M10. */
@theme {
  /* font: --font-inter is defined at :root by pages/_app.tsx (next/font) */
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;

  /* neutral = Tailwind slate values, so legacy slate-* and new neutral-* render identically */
  --color-neutral-0: #FFFFFF;   --color-neutral-25: #FBFCFD;  --color-neutral-50: #F8FAFC;
  --color-neutral-100: #F1F5F9; --color-neutral-200: #E2E8F0; --color-neutral-300: #CBD5E1;
  --color-neutral-400: #94A3B8; --color-neutral-500: #64748B; --color-neutral-600: #475569;
  --color-neutral-700: #334155; --color-neutral-800: #1E293B; --color-neutral-900: #0F172A;

  --color-accent-50: #EFF6FF;  --color-accent-100: #DBEAFE; --color-accent-200: #BFDBFE;
  --color-accent-500: #3B82F6; --color-accent-600: #2563EB; --color-accent-700: #1D4ED8;
  --color-accent-800: #1E40AF;

  --color-success-bg: #F0FDF4;   --color-success-border: #BBF7D0;   --color-success-fg: #15803D;   --color-success: #16A34A;
  --color-warning-bg: #FFFBEB;   --color-warning-border: #FDE68A;   --color-warning-fg: #B45309;   --color-warning: #D97706;
  --color-danger-bg: #FEF2F2;    --color-danger-border: #FECACA;    --color-danger-fg: #B91C1C;    --color-danger: #DC2626;
  --color-info-bg: #EFF6FF;      --color-info-border: #BFDBFE;      --color-info-fg: #1D4ED8;      --color-info: #3B82F6;
  --color-attention-bg: #FFF7ED; --color-attention-border: #FED7AA; --color-attention-fg: #C2410C; --color-attention: #EA580C;

  /* type scale (new names; Tailwind text-xs…text-9xl stay for legacy) */
  --text-display: 28px;  --text-display--line-height: 36px;  --text-display--font-weight: 600;  --text-display--letter-spacing: -0.02em;
  --text-title-lg: 20px; --text-title-lg--line-height: 28px; --text-title-lg--font-weight: 600; --text-title-lg--letter-spacing: -0.015em;
  --text-title-md: 16px; --text-title-md--line-height: 24px; --text-title-md--font-weight: 600; --text-title-md--letter-spacing: -0.01em;
  --text-title-sm: 14px; --text-title-sm--line-height: 20px; --text-title-sm--font-weight: 600;
  --text-body: 14px;     --text-body--line-height: 20px;
  --text-dense: 13px;    --text-dense--line-height: 18px;
  --text-label: 13px;    --text-label--line-height: 18px;    --text-label--font-weight: 500;
  --text-caption: 12px;  --text-caption--line-height: 16px;
  --text-micro: 11px;    --text-micro--line-height: 14px;    --text-micro--font-weight: 500;    --text-micro--letter-spacing: 0.01em;

  /* elevation (new names; shadow-sm/md/lg stay for legacy until M10) */
  --shadow-e1: 0 1px 2px rgb(15 23 42 / .06);
  --shadow-e2: 0 4px 12px rgb(15 23 42 / .08), 0 1px 3px rgb(15 23 42 / .06);
  --shadow-e3: 0 12px 32px rgb(15 23 42 / .12), 0 2px 6px rgb(15 23 42 / .06);
  --shadow-e4: 0 24px 64px rgb(15 23 42 / .18);
  --shadow-focus: 0 0 0 3px rgb(37 99 235 / .28);

  --ease-standard: cubic-bezier(.2, 0, 0, 1);

  /* NOT redefined on purpose:
     --spacing (v4 default 4px = DS grid), --radius-* (v4 defaults sm4/md6/lg8/xl12 = DS scale),
     --breakpoint-* (aligned to MUI 600/900/1200/1536 in M10 only; 39 legacy files use md:/lg:). */
}

:root {
  /* layout */
  --kx-sidebar: 240px; --kx-sidebar-rail: 64px;
  --kx-topbar: 52px; --kx-topbar-mobile: 48px; --kx-tabbar: 56px;
  /* --kx-bottom-nav is set at runtime by MobileTabBar (keep); default for SSR: */
  --kx-bottom-nav: 0px;
  --kx-max-list: 1600px; --kx-max-detail: 1280px; --kx-max-form: 880px; --kx-max-reading: 720px;
  --kx-field-max: 480px; --kx-long-field-max: 720px;

  /* controls */
  --kx-control-sm: 32px; --kx-control-md: 40px; --kx-control-lg: 44px; --kx-control-xl: 48px;
  --kx-row-h: 44px; --kx-row-h-compact: 36px;

  /* z-index (matches MUI theme.zIndex) */
  --kx-z-sticky-header: 2; --kx-z-sticky-toolbar: 20; --kx-z-action-bar: 1040; --kx-z-tabbar: 1050;
  --kx-z-topbar: 1100; --kx-z-sidebar: 1150; --kx-z-drawer: 1200; --kx-z-modal: 1500;
  --kx-z-modal-nested: 1550; --kx-z-popover: 1600; --kx-z-palette: 1650; --kx-z-toast: 1700; --kx-z-tooltip: 1800;

  /* motion */
  --kx-dur-instant: 80ms; --kx-dur-fast: 140ms; --kx-dur-base: 200ms; --kx-dur-slow: 280ms;
}

@media (pointer: coarse) {
  :root { --kx-control-sm: 44px; --kx-control-md: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  :root { --kx-dur-fast: 0ms; --kx-dur-base: 0ms; --kx-dur-slow: 0ms; }
  *, *::before, *::after { animation-duration: 0ms !important; scroll-behavior: auto !important; }
}

.tnum { font-variant-numeric: tabular-nums; }
```

### `styles/globals.css` head (M0 change)

Replace the top of the file, from `@import "tailwindcss";` through the end of the `:root { … }` block, with the code below. The old block holds the Google Fonts `@import`, `--font-sans`, `--color-brand-*`, `--radius-default/lg/xl`, `--shadow-*` and the `--z-*` scale.

```css
@import "tailwindcss";
@import "./tokens.css";

/* legacy aliases kept until M10 so .card-premium / .btn-* keep compiling */
:root {
  --color-brand-500: #3B82F6; --color-brand-600: #2563EB; --color-brand-700: #1D4ED8;
  --color-surface-primary: #FFFFFF; --color-surface-secondary: #F8FAFC; --color-surface-tertiary: #F1F5F9;
  --color-border-subtle: #E2E8F0; --color-border-muted: #F1F5F9;
  --radius-default: 8px;                      /* was 12; legacy --radius-lg/xl overrides REMOVED */
  --shadow-card: none; --shadow-card-hover: none; --shadow-premium: none;   /* flat surfaces */
}
```

In the same PR, flatten the legacy utilities. They are deleted in M10.
- `.btn-primary`: `background: var(--color-accent-600)`, no `transform`, `box-shadow: none`, `border-radius: 6px`, `font-weight: 500`. Hover is `var(--color-accent-700)`.
- `.btn-secondary`: `border-radius: 6px`, `font-weight: 500`.
- `.gradient-text`: `background: none; -webkit-text-fill-color: currentColor; color: inherit`.
- `.card-premium-interactive:hover`: `transform: none`.
- `.glass`: `background: #fff; backdrop-filter: none; border: 1px solid var(--color-border-subtle)`.

Keep the existing `html`/`body` rules, and change `body { background-color: var(--color-neutral-50); color: var(--color-neutral-800); }`.

---

## 3. `lib/theme.tsx` (replace the whole file)

```tsx
// lib/theme.tsx — MUI v5 theme built from lib/ds/tokens.ts. Legacy-safe: spacing 8, floating labels intact,
// h1–h6 kept (remapped). Gradients, purple, hover transforms and heavy shadows are gone.
import { createTheme, alpha } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import {
  neutral as n, accent as a, tone, font, type, elevation as e, focusRing, backdrop,
  zIndex as z, motion, radius, control,
} from './ds/tokens';

declare module '@mui/material/styles' {
  interface Palette { attention: Palette['primary']; neutral: Palette['primary']; }
  interface PaletteOptions { attention?: PaletteOptions['primary']; neutral?: PaletteOptions['primary']; }
  interface TypographyVariants {
    display: React.CSSProperties; titleLg: React.CSSProperties; titleMd: React.CSSProperties;
    titleSm: React.CSSProperties; dense: React.CSSProperties; label: React.CSSProperties; micro: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    display?: React.CSSProperties; titleLg?: React.CSSProperties; titleMd?: React.CSSProperties;
    titleSm?: React.CSSProperties; dense?: React.CSSProperties; label?: React.CSSProperties; micro?: React.CSSProperties;
  }
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    display: true; titleLg: true; titleMd: true; titleSm: true; dense: true; label: true; micro: true;
    // h1–h6 stay enabled for legacy; lint bans them in migrated files.
  }
}

const t = (k: keyof typeof type, extra: React.CSSProperties = {}): React.CSSProperties => {
  const [size, lh, weight, ls] = type[k];
  return { fontSize: size, lineHeight: `${lh}px`, fontWeight: weight, letterSpacing: ls, ...extra };
};

// Solid accent used for every "contained" color except error — kills legacy green/purple/gradient buttons.
const solidAccent = {
  backgroundColor: a[600], color: '#fff', backgroundImage: 'none',
  '&:hover': { backgroundColor: a[700], boxShadow: 'none' },
  '&:active': { backgroundColor: a[800] },
};
const neutralOutlined = {
  borderColor: n[300], color: n[800], backgroundColor: n[0],
  '&:hover': { backgroundColor: n[50], borderColor: n[400] },
};

const theme = createTheme({
  // spacing intentionally left at MUI default (8) — 112 legacy files rely on it.
  shape: { borderRadius: radius.sm },
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
  zIndex: {
    mobileStepper: z.tabBar, fab: z.tabBar, speedDial: z.sidebar, appBar: z.topBar,
    drawer: z.drawer, modal: z.modal, snackbar: z.toast, tooltip: z.tooltip,
  },
  palette: {
    mode: 'light',
    primary:   { main: a[600], dark: a[700], light: a[500], contrastText: '#FFFFFF' },
    secondary: { main: n[800], dark: n[900], light: n[600], contrastText: '#FFFFFF' }, // no purple
    success:   { main: tone.success.solid, dark: tone.success.fg, light: tone.success.bg, contrastText: '#FFFFFF' },
    warning:   { main: tone.warning.solid, dark: tone.warning.fg, light: tone.warning.bg, contrastText: '#FFFFFF' },
    error:     { main: tone.danger.solid,  dark: tone.danger.fg,  light: tone.danger.bg,  contrastText: '#FFFFFF' },
    info:      { main: tone.info.solid,    dark: tone.info.fg,    light: tone.info.bg,    contrastText: '#FFFFFF' },
    attention: { main: tone.attention.solid, dark: tone.attention.fg, light: tone.attention.bg, contrastText: '#FFFFFF' },
    neutral:   { main: n[500], dark: n[700], light: n[100], contrastText: '#FFFFFF' },
    grey: { 50: n[50], 100: n[100], 200: n[200], 300: n[300], 400: n[400], 500: n[500], 600: n[600], 700: n[700], 800: n[800], 900: n[900] },
    text: { primary: n[800], secondary: n[500], disabled: n[400] },
    divider: n[200],
    background: { default: n[50], paper: n[0] },
    action: {
      hover: n[50], hoverOpacity: 0.04, selected: a[50], selectedOpacity: 0.08,
      focus: alpha(a[600], 0.12), disabled: n[400], disabledBackground: n[100],
    },
  },
  typography: {
    fontFamily: font.sans,
    fontSize: 14,
    htmlFontSize: 16,
    fontWeightLight: 400, fontWeightRegular: 400, fontWeightMedium: 500, fontWeightBold: 600,
    display: t('display'), titleLg: t('titleLg'), titleMd: t('titleMd'), titleSm: t('titleSm'),
    dense: t('dense'), label: t('label'), micro: t('micro'),
    // legacy remaps (weight 600 max)
    h1: { fontSize: 28, lineHeight: '36px', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontSize: 24, lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.015em' },
    h3: { fontSize: 20, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.015em' },
    h4: { fontSize: 18, lineHeight: '26px', fontWeight: 600, letterSpacing: '-0.01em' },
    h5: { fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontSize: 14, lineHeight: '20px', fontWeight: 600 },
    subtitle1: { fontSize: 14, lineHeight: '20px', fontWeight: 500, color: n[600] },
    subtitle2: { fontSize: 13, lineHeight: '18px', fontWeight: 500, color: n[500] },
    body1: t('body'),
    body2: t('dense'),
    caption: { ...t('caption'), color: n[500] },
    overline: { ...t('micro'), textTransform: 'none' },
    button: { fontSize: 13, lineHeight: '18px', fontWeight: 500, letterSpacing: 0, textTransform: 'none' },
  },
  // 25 entries: 0 none · 1 e1 · 2–4 e2 · 5–12 e3 · 13–24 e4
  shadows: ['none', e.e1, e.e2, e.e2, e.e2, ...Array(8).fill(e.e3), ...Array(12).fill(e.e4)] as any,
  transitions: {
    duration: {
      shortest: motion.instant, shorter: motion.fast, short: motion.fast, standard: motion.base,
      complex: motion.slow, enteringScreen: motion.base, leavingScreen: motion.fast,
    },
    easing: { easeInOut: motion.ease, easeOut: motion.ease, easeIn: 'cubic-bezier(.4,0,1,1)', sharp: motion.ease },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: n[50], color: n[800],
          scrollbarWidth: 'thin', scrollbarColor: `${n[300]} transparent`,
          WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
        },
        '.tnum': { fontVariantNumeric: 'tabular-nums' },
      },
    },

    // ── Buttons ───────────────────────────────────────────────────────────
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none', fontWeight: 500, borderRadius: radius.sm, boxShadow: 'none', gap: 6,
          transition: `background-color ${motion.fast}ms ${motion.ease}, border-color ${motion.fast}ms ${motion.ease}`,
          '&:hover': { boxShadow: 'none' },
          '&.Mui-focusVisible, &:focus-visible': { boxShadow: focusRing },
          '&.Mui-disabled': { backgroundImage: 'none' },
          '@media (pointer: coarse)': { minHeight: control.lg },
        },
        startIcon: { marginRight: 0, marginLeft: 0 },
        endIcon: { marginLeft: 0, marginRight: 0 },
        sizeSmall:  { minHeight: control.sm, padding: '0 10px', fontSize: 13 },
        sizeMedium: { minHeight: control.md, padding: '0 14px', fontSize: 13 },
        sizeLarge:  { minHeight: control.lg, padding: '0 18px', fontSize: 14 },
        contained: {
          ...solidAccent,
          '&.Mui-disabled': { backgroundColor: n[100], color: n[400] },
        },
        containedPrimary: solidAccent,
        containedSecondary: solidAccent,   // legacy purple → accent
        containedSuccess: solidAccent,     // legacy green "New Listing"/"Sync Data" → accent
        containedInfo: solidAccent,
        containedWarning: solidAccent,
        containedError: {
          backgroundColor: tone.danger.solid, color: '#fff', backgroundImage: 'none',
          '&:hover': { backgroundColor: tone.danger.fg },
        },
        outlined: neutralOutlined,
        outlinedPrimary: neutralOutlined,
        outlinedSecondary: neutralOutlined,
        outlinedSuccess: neutralOutlined,
        outlinedInfo: neutralOutlined,
        outlinedError: { borderColor: tone.danger.border, color: tone.danger.fg, '&:hover': { backgroundColor: tone.danger.bg, borderColor: tone.danger.solid } },
        text: { '&:hover': { backgroundColor: n[50] } },
        textPrimary: { color: a[600], '&:hover': { backgroundColor: a[50] } },
        textInherit: { color: n[700], '&:hover': { backgroundColor: n[50] } },   // DS "ghost"
        textSecondary: { color: n[700], '&:hover': { backgroundColor: n[50] } },
        textError: { color: tone.danger.fg, '&:hover': { backgroundColor: tone.danger.bg } }, // DS "danger-ghost"
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: radius.sm, color: n[500],
          '&:hover': { backgroundColor: n[50], color: n[800] },
          '&.Mui-focusVisible': { boxShadow: focusRing },
        },
        sizeSmall: { width: control.sm, height: control.sm, padding: 6 },
        sizeMedium: { width: control.md, height: control.md, padding: 8 },
        sizeLarge: { width: control.lg, height: control.lg, padding: 10 },
      },
    },
    MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { color: a[600], fontWeight: 500 } } },

    // ── Surfaces ──────────────────────────────────────────────────────────
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        elevation0: { border: `1px solid ${n[200]}` },
        outlined: { borderColor: n[200] },
        rounded: { borderRadius: radius.md },
      },
    },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: radius.md, boxShadow: 'none' } } },
    MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
    MuiAccordion: {
      defaultProps: { elevation: 0, disableGutters: true },
      styleOverrides: {
        root: {
          border: `1px solid ${n[200]}`, borderRadius: radius.md, '&:before': { display: 'none' },
          '&:not(:last-of-type)': { marginBottom: 8 },
        },
      },
    },
    MuiAccordionSummary: { styleOverrides: { root: { minHeight: 48, padding: '0 16px' }, content: { margin: '12px 0' } } },
    MuiDivider: { styleOverrides: { root: { borderColor: n[200] } } },

    // ── Inputs (legacy floating labels keep working; DS FormField renders labels above) ──
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radius.sm, backgroundColor: n[0], fontSize: 14,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: n[300] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: n[400] },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: a[600], borderWidth: 1 },
          '&.Mui-focused': { boxShadow: focusRing },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: tone.danger.solid },
          '&.Mui-disabled': { backgroundColor: n[50] },
          '@media (pointer: coarse)': { fontSize: 16 },
        },
        input: { lineHeight: '20px', height: 20, '&::placeholder': { color: n[400], opacity: 1 } },
        inputSizeSmall: { padding: '10px 12px', '@media (pointer: coarse)': { padding: '12px 12px' } }, // 40 / 44
        multiline: { padding: 0 },
        inputMultiline: { padding: '10px 12px', height: 'auto' },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14, color: n[500], '&.Mui-focused': { color: a[700] } } } },
    MuiFormLabel: { styleOverrides: { root: { color: n[800], fontSize: 13, fontWeight: 500 } } },
    MuiFormHelperText: { styleOverrides: { root: { margin: '6px 0 0', fontSize: 12, lineHeight: '16px', color: n[500] } } },
    MuiCheckbox: { defaultProps: { size: 'small' }, styleOverrides: { root: { color: n[400], '&.Mui-checked': { color: a[600] } } } },
    MuiRadio: { defaultProps: { size: 'small' }, styleOverrides: { root: { color: n[400], '&.Mui-checked': { color: a[600] } } } },
    MuiSwitch: {
      styleOverrides: {
        switchBase: { '&.Mui-checked': { color: '#fff' }, '&.Mui-checked + .MuiSwitch-track': { backgroundColor: a[600], opacity: 1 } },
        track: { backgroundColor: n[300], opacity: 1, borderRadius: 9999 },
      },
    },

    // ── Floating layers (z-index per DESIGN_SYSTEM §2.8) ─────────────────
    MuiPopover: {
      styleOverrides: {
        root: { zIndex: z.popover },
        paper: { boxShadow: e.e2, border: `1px solid ${n[200]}`, borderRadius: radius.md },
      },
    },
    MuiMenu: {
      styleOverrides: {
        root: { zIndex: z.popover },
        paper: { boxShadow: e.e2, border: `1px solid ${n[200]}`, borderRadius: radius.md, minWidth: 180 },
        list: { padding: 4 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 36, fontSize: 14, borderRadius: radius.xs, margin: '0 4px', padding: '0 8px', gap: 8,
          '&:hover': { backgroundColor: n[50] },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: a[50] },
          '@media (pointer: coarse)': { minHeight: 44 },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        popper: { zIndex: z.popover },
        paper: { boxShadow: e.e2, border: `1px solid ${n[200]}`, borderRadius: radius.md },
        option: { fontSize: 14, minHeight: 36 },
        tag: { height: 24, borderRadius: 9999 },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: false, enterDelay: 400, enterNextDelay: 200 },
      styleOverrides: { tooltip: { backgroundColor: n[900], fontSize: 12, lineHeight: '16px', fontWeight: 500, borderRadius: radius.xs, padding: '4px 8px' } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: radius.lg, boxShadow: e.e4, border: 'none' } },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: 16, lineHeight: '24px', fontWeight: 600, padding: '20px 20px 8px' } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 20px', fontSize: 14 } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 20px 20px', gap: 8, '& > :not(:first-of-type)': { marginLeft: 0 } } } },
    MuiDrawer: {
      styleOverrides: {
        paper: { boxShadow: e.e3, border: 'none' },
        paperAnchorRight: { borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg },
        paperAnchorBottom: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
      },
    },
    MuiBackdrop: {
      styleOverrides: { root: { backgroundColor: backdrop }, invisible: { backgroundColor: 'transparent' } },
    },
    MuiSnackbar: { defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } } },

    // ── Navigation ───────────────────────────────────────────────────────
    MuiTabs: { styleOverrides: { root: { minHeight: 40 }, indicator: { height: 2, backgroundColor: a[600] } } },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none', minHeight: 40, minWidth: 0, padding: '0 12px', fontSize: 13, fontWeight: 500,
          color: n[500], '&.Mui-selected': { color: n[900] },
        },
      },
    },

    // ── Data display ─────────────────────────────────────────────────────
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 9999, height: 24, fontSize: 12, fontWeight: 500, textTransform: 'none' },
        sizeSmall: { height: 20, fontSize: 11 },
        label: { padding: '0 8px' },
        outlined: { borderColor: n[200] },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: radius.md, border: '1px solid', fontSize: 14, padding: '6px 12px', alignItems: 'center' },
        standardSuccess: { backgroundColor: tone.success.bg, borderColor: tone.success.border, color: tone.success.fg },
        standardWarning: { backgroundColor: tone.warning.bg, borderColor: tone.warning.border, color: tone.warning.fg },
        standardError:   { backgroundColor: tone.danger.bg,  borderColor: tone.danger.border,  color: tone.danger.fg },
        standardInfo:    { backgroundColor: tone.info.bg,    borderColor: tone.info.border,    color: tone.info.fg },
        icon: { padding: 0, marginRight: 8, opacity: 1 },
        message: { padding: '4px 0' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 6, borderRadius: 9999, backgroundColor: n[100] }, bar: { borderRadius: 9999 } },
    },
    MuiSkeleton: { defaultProps: { animation: 'wave' }, styleOverrides: { root: { backgroundColor: n[100] } } },
    MuiTableHead: { styleOverrides: { root: { backgroundColor: n[25] } } },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: n[50] },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: a[50], boxShadow: `inset 2px 0 0 ${a[600]}` },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${n[100]}`, padding: '0 12px', height: 44, fontSize: 13, color: n[800] },
        head: { height: 36, fontSize: 12, fontWeight: 500, color: n[500], borderBottom: `1px solid ${n[200]}`, textTransform: 'none', whiteSpace: 'nowrap' },
        sizeSmall: { height: 36, padding: '0 12px' },
        paddingCheckbox: { width: 44, padding: '0 0 0 8px' },
      },
    },

    // ── DataGrid (BulkGrid + legacy pages until M5) ──────────────────────
    MuiDataGrid: {
      defaultProps: { rowHeight: 44, columnHeaderHeight: 36, disableRowSelectionOnClick: true },
      styleOverrides: {
        root: {
          border: `1px solid ${n[200]}`, borderRadius: radius.md, fontSize: 13, backgroundColor: n[0],
          '--DataGrid-rowBorderColor': n[100],
          '--DataGrid-containerBackground': n[25],
        },
        columnHeaderTitle: { fontWeight: 500, color: n[500], fontSize: 12 },
        row: {
          '&:hover': { backgroundColor: n[50] },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: a[50], boxShadow: `inset 2px 0 0 ${a[600]}` },
        },
        cell: {
          '&:focus, &:focus-within': { outline: `2px solid ${a[600]}`, outlineOffset: -2 },
          '&.kx-dirty': { backgroundColor: tone.attention.bg, boxShadow: `inset 2px 0 0 ${tone.attention.solid}` },
          '&.kx-invalid': { outline: `1px solid ${tone.danger.solid}`, outlineOffset: -1 },
        },
      },
    },
  },
});

export default theme;
export { theme };
```

Notes:
- `MuiFormControl.defaultProps.size: 'small'` plus `MuiTextField size: 'small'` turn legacy 56px fields into 40px fields. Floating labels still render correctly at that size, and this fixes the mixed toolbar heights (finding #5) app-wide.
- DS `TextField` renders `<OutlinedInput notched={false}>` without an `InputLabel`. `FormField` renders the `<label>` above. Nothing global hides the legend.
- Legacy `<Button color="success" variant="contained">` now renders in accent blue. That is intended: green is never a button color.
- With `MuiPaper.defaultProps.elevation: 0`, a legacy `<Paper>` without an explicit elevation becomes flat with a border. Menus, Popovers, Dialogs and Drawers pass their own elevation, so they keep their shadow.

---

## 4. `pages/_app.tsx` changes

```tsx
// 1) font — top of file
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

// 2) inside MyApp, after `const locale = useLocaleStore((s) => s.locale);`
useEffect(() => {
  // _document hard-codes lang="tr"; the UI locale is client-side, so keep <html lang> in sync.
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}, [locale]);

// 3) in the returned JSX, as the first child inside <ThemeProvider> (defines the var at :root so MUI portals get it)
<style jsx global>{`
  :root { --font-inter: ${inter.style.fontFamily}; }
`}</style>

// 4) replace <Toaster position="top-center" /> with:
<Toaster
  position="bottom-center"
  gutter={8}
  containerStyle={{ zIndex: 1700, bottom: 'calc(var(--kx-bottom-nav, 0px) + 16px)' }}
  toastOptions={{
    duration: 4000,
    style: { background: '#0F172A', color: '#FFFFFF', fontSize: 13, lineHeight: '18px', borderRadius: 8, padding: '10px 12px', maxWidth: 420 },
    error: { duration: Infinity },
  }}
/>
```

In `pages/_document.js`, delete the two `fonts.googleapis.com` / `fonts.gstatic.com` preconnect links. Keep `<Html lang="tr">` as the SSR default; step 2 corrects it on the client.

"One toast visible" is enforced in `components/ds/feedback/toast.ts`: each call runs `toast.dismiss()` on the previous id, unless that toast is a persistent error, in which case the new message waits in a small queue.

---

## 5. `__tests__/ds/tokens-parity.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { colorVars, elevation } from '@/lib/ds/tokens';

const css = readFileSync(join(process.cwd(), 'styles/tokens.css'), 'utf8');
const themeBlock = css.slice(css.indexOf('@theme'), css.indexOf(':root'));

function cssVar(name: string): string | undefined {
  const m = themeBlock.match(new RegExp(`--${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}:\\s*([^;]+);`));
  return m?.[1].trim();
}

describe('design tokens parity (lib/ds/tokens.ts ↔ styles/tokens.css)', () => {
  it('every TS color exists in @theme with the same hex', () => {
    for (const [name, hex] of Object.entries(colorVars())) {
      expect(cssVar(`color-${name}`)?.toUpperCase(), `--color-${name}`).toBe(hex.toUpperCase());
    }
  });

  it('every @theme --color-* is defined in TS (no CSS-only colors)', () => {
    const defined = new Set(Object.keys(colorVars()));
    for (const m of themeBlock.matchAll(/--color-([a-z0-9-]+):/g)) {
      expect(defined.has(m[1]), `--color-${m[1]} missing from lib/ds/tokens.ts`).toBe(true);
    }
  });

  it('elevation matches', () => {
    for (const k of ['e1', 'e2', 'e3', 'e4'] as const) {
      expect(cssVar(`shadow-${k}`)?.replace(/\s+/g, ' ')).toBe(elevation[k].replace(/\s+/g, ' '));
    }
  });

  it('does not redefine Tailwind spacing/radius/breakpoints before M10', () => {
    expect(themeBlock).not.toMatch(/--spacing:/);
    expect(themeBlock).not.toMatch(/--radius-(sm|md|lg|xl):/);
    expect(themeBlock).not.toMatch(/--breakpoint-/);
  });
});
```

Companion test (added in M2): `__tests__/ds/nav-unique-icons.test.ts` imports `lib/nav/navConfig.ts`, flattens every item, and asserts that no two items share the same `icon` reference or `brand` key, and that every item has a non-empty i18n `label` key present in both `messages/en.json` and `messages/tr.json`.

---

## 6. `eslint.config.mjs` (new; the repo has no ESLint today)

devDependencies: `eslint@^9`, `typescript-eslint@^8`, `eslint-plugin-react@^7`. Add the script `"lint": "eslint pages components lib"`.

```js
// eslint.config.mjs
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import { readFileSync } from 'node:fs';

const migrated = JSON.parse(readFileSync(new URL('./design/migrated-paths.json', import.meta.url), 'utf8')).paths;

const dsSyntax = [
  { selector: "JSXAttribute[name.name='type'][value.value='date']", message: 'Use ds/DateRangeField or ds/DatePicker.' },
  { selector: 'Literal[value=/linear-gradient|radial-gradient/]', message: 'No gradients (DESIGN_SYSTEM P2).' },
  { selector: 'TemplateElement[value.raw=/linear-gradient/]', message: 'No gradients (DESIGN_SYSTEM P2).' },
  { selector: 'Literal[value=/\\buppercase\\b/]', message: 'No uppercase: breaks Turkish (FAİLED). Write sentence case in messages.' },
  { selector: "CallExpression[callee.property.name='toFixed']", message: 'Use <Money>/<Num> or lib/format.ts.' },
  { selector: "JSXAttribute[name.name='variant'][value.value=/^h[1-6]$/]", message: 'Use titleLg/titleMd/titleSm/display.' },
];
const strictSyntax = [
  ...dsSyntax,
  { selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]', message: 'No hex literals outside lib/ds. Use tokens.' },
  { selector: 'Literal[value=/(^|\\s)(sm|md|lg|xl|2xl):[a-z]/]', message: 'No Tailwind responsive prefixes in migrated files (breakpoints differ until M10). Use DS components / theme.breakpoints.' },
];

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'scripts/**', '**/*.test.*'] },
  {
    files: ['pages/**/*.{js,jsx,ts,tsx}', 'components/**/*.{js,jsx,ts,tsx}', 'lib/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react },
    rules: {
      'no-restricted-imports': ['warn', { paths: [{ name: '@mui/icons-material', message: 'Use lucide via lib/ds/icons.ts.' }], patterns: ['@mui/icons-material/*'] }],
      'no-restricted-syntax': ['warn', ...dsSyntax],
      'react/jsx-no-literals': ['warn', { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '/', '×', '%', '(', ')', ':', '…', '⋯'] }],
    },
  },
  {
    // migrated surfaces: everything is an error, raw MUI banned
    files: migrated,
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@mui/icons-material', message: 'Use lucide via lib/ds/icons.ts.' }],
        patterns: [
          { group: ['@mui/icons-material/*'], message: 'Use lucide via lib/ds/icons.ts.' },
          { group: ['@mui/material', '@mui/material/*'], message: 'Migrated files import UI only from components/ds/*.' },
          { group: ['@/components/ui/*', '**/components/ui/*'], message: 'Import from components/ds/* (ui/* are shims).' },
        ],
      }],
      'no-restricted-syntax': ['error', ...strictSyntax],
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '/', '×', '%', '(', ')', ':', '…', '⋯'] }],
    },
  },
  {
    // the DS itself may use MUI and tokens
    files: ['components/ds/**/*', 'lib/ds/**/*', 'lib/theme.tsx'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': ['error', ...dsSyntax.filter((r) => !r.selector.includes('#'))] },
  },
);
```

`design/migrated-paths.json` starts with the DS and grows one PR at a time:

```json
{ "paths": ["components/ds/**/*", "components/domain/**/*"] }
```

---

## 7. Quick reference for DS authors

```tsx
import { neutral as n, accent as a, tone, space, px, control, radius, elevation, zIndex } from '@/lib/ds/tokens';

// sx: pixel tokens, never theme.spacing multiples
<Box sx={{ p: px(space[4]), gap: px(space[2]), borderRadius: px(radius.md), border: `1px solid ${n[200]}` }} />

// Tailwind (page layout only): DS color names + default spacing (4px grid) + default radii
<div className="flex gap-2 p-4 rounded-lg border border-neutral-200 bg-neutral-0 text-dense text-neutral-800" />

// tones
<span className="bg-attention-bg text-attention-fg border border-attention-border" />   // "not sent yet" only
```

| Need | Tailwind | MUI sx / token |
|---|---|---|
| page background | `bg-neutral-50` | `n[50]` |
| card | `bg-neutral-0 border border-neutral-200 rounded-lg` | `Section variant="card"` |
| secondary text | `text-neutral-500 text-caption` | `variant="caption"` |
| table cell text | `text-dense text-neutral-800` | `variant="dense"` |
| page title | `text-title-lg` | `variant="titleLg"` (via PageHeader only) |
| selected row | `bg-accent-50` | `a[50]` + inset bar |
| dirty cell | `bg-attention-bg` | `.kx-dirty` |
| floating menu | `shadow-e2 rounded-lg` | theme default |
| control heights | `h-(--kx-control-sm)` / `h-(--kx-control-md)` | `control.sm` / `control.md` |
| z-index | `z-(--kx-z-popover)` | `zIndex.popover` |

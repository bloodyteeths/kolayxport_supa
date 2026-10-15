// lib/ds/tokens.ts — the ONLY place raw design values live. styles/tokens.css mirrors it
// (enforced by test/ds/tokens-parity.test.ts).

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

/** xs 28 = dense-row control (table/card trailing actions); stays 28 visually on touch and gets a 44 hit slop. */
export const control = { xs: 28, sm: 32, md: 40, lg: 44, xl: 48 } as const;
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
/** Lighter backdrop for SidePanel overlays (CRITIQUE C18). */
export const backdropPanel = 'rgb(15 23 42 / .16)';

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
  /** Vertical gap between page sections / cards (USABILITY_FINDINGS density: ≤24 desktop, 16 mobile). */
  sectionGap: 24, sectionGapMobile: 16,
  /** Inner padding of a card / panel section. */
  panelPad: 16,
} as const;

/** Responsive sx value for the section gap: `mb: sectionGapSx` / `gap: sectionGapSx`. 16 below md, 24 from md. */
export const sectionGapSx = { xs: `${layout.sectionGapMobile}px`, md: `${layout.sectionGap}px` } as const;

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

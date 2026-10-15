import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  colorVars, elevation, zIndex, control, layout, motion, radius, focusRing, neutral, accent, tone, type as typeScale,
} from '@/lib/ds/tokens';
import theme from '@/lib/theme';

const css = readFileSync(join(process.cwd(), 'styles/tokens.css'), 'utf8');
// '\n:root {' — the @theme block's comments mention :root, so anchor on the rule itself.
const themeBlock = css.slice(css.indexOf('@theme {'), css.indexOf('\n:root {')).replace(/\/\*[\s\S]*?\*\//g, '');

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

// ── tokens.ts ↔ tokens.css :root (layout / control / z-index / motion) ───────────────

const rootBlock = css.slice(css.indexOf('\n:root {'));
function rootVar(name: string): string | undefined {
  const m = rootBlock.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m?.[1].trim();
}
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('design tokens parity (lib/ds/tokens.ts ↔ styles/tokens.css :root)', () => {
  it('z-index vars match zIndex', () => {
    const cssName: Record<keyof typeof zIndex, string> = {
      stickyHeader: 'kx-z-sticky-header', stickyToolbar: 'kx-z-sticky-toolbar', stickyActionBar: 'kx-z-action-bar',
      tabBar: 'kx-z-tabbar', topBar: 'kx-z-topbar', sidebar: 'kx-z-sidebar', drawer: 'kx-z-drawer', modal: 'kx-z-modal',
      nestedModal: 'kx-z-modal-nested', popover: 'kx-z-popover', palette: 'kx-z-palette', toast: 'kx-z-toast', tooltip: 'kx-z-tooltip',
    };
    for (const [k, v] of Object.entries(zIndex)) {
      expect(rootVar(cssName[k as keyof typeof zIndex]), k).toBe(String(v));
    }
  });

  it('control heights and row heights match', () => {
    for (const [k, v] of Object.entries(control)) expect(rootVar(`kx-control-${k}`), k).toBe(`${v}px`);
    expect(rootVar('kx-row-h')).toBe(`${layout.rowH}px`);
    expect(rootVar('kx-row-h-compact')).toBe(`${layout.rowHCompact}px`);
  });

  it('layout constants match', () => {
    const pairs: Array<[string, number]> = [
      ['kx-sidebar', layout.sidebar], ['kx-sidebar-rail', layout.sidebarRail], ['kx-topbar', layout.topBar],
      ['kx-topbar-mobile', layout.topBarMobile], ['kx-tabbar', layout.tabBar], ['kx-max-list', layout.maxList],
      ['kx-max-detail', layout.maxDetail], ['kx-max-form', layout.maxForm], ['kx-max-reading', layout.maxReading],
      ['kx-field-max', layout.fieldMax], ['kx-long-field-max', layout.longFieldMax],
    ];
    for (const [name, v] of pairs) expect(rootVar(name), name).toBe(`${v}px`);
  });

  it('motion durations match', () => {
    for (const k of ['instant', 'fast', 'base', 'slow'] as const) expect(rootVar(`kx-dur-${k}`), k).toBe(`${motion[k]}ms`);
  });

  it('type scale matches @theme --text-*', () => {
    for (const [k, [size, lh, weight, ls]] of Object.entries(typeScale)) {
      const name = `text-${kebab(k)}`;
      expect(cssVar(name), name).toBe(`${size}px`);
      expect(cssVar(`${name}--line-height`), `${name} lh`).toBe(`${lh}px`);
      if (weight !== 400) expect(cssVar(`${name}--font-weight`), `${name} weight`).toBe(String(weight));
      if (ls !== '0') expect(cssVar(`${name}--letter-spacing`), `${name} ls`).toBe(ls);
    }
  });

  it('focus ring matches --shadow-focus', () => {
    expect(cssVar('shadow-focus')?.replace(/\s+/g, ' ')).toBe(focusRing);
  });
});

describe('MUI theme is built from tokens', () => {
  it('keeps legacy-safe defaults (spacing 8, h1–h6 defined)', () => {
    expect(theme.spacing(1)).toBe('8px');
    for (const v of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      expect(theme.typography[v].fontSize, v).toBeDefined();
      expect(Number(theme.typography[v].fontWeight)).toBeLessThanOrEqual(600);
    }
  });

  it('radius, palette and z-index come from tokens', () => {
    expect(theme.shape.borderRadius).toBe(radius.sm);
    expect(theme.palette.primary.main).toBe(accent[600]);
    expect(theme.palette.secondary.main).toBe(neutral[800]);
    expect(theme.palette.error.main).toBe(tone.danger.solid);
    expect(theme.palette.text.primary).toBe(neutral[800]);
    expect(theme.zIndex.appBar).toBe(zIndex.topBar);
    expect(theme.zIndex.drawer).toBe(zIndex.drawer);
    expect(theme.zIndex.modal).toBe(zIndex.modal);
    expect(theme.zIndex.snackbar).toBe(zIndex.toast);
    expect(theme.zIndex.tooltip).toBe(zIndex.tooltip);
    expect(theme.zIndex.mobileStepper).toBe(zIndex.tabBar);
  });

  it('never uppercases text and has no gradients', () => {
    expect(theme.typography.button.textTransform).toBe('none');
    expect(theme.typography.overline.textTransform).toBe('none');
    const serialized = JSON.stringify(theme.components);
    expect(serialized).not.toMatch(/uppercase/);
    expect(serialized).not.toMatch(/gradient\(/);
  });

  it('flat Paper and small text fields by default', () => {
    expect(theme.components?.MuiPaper?.defaultProps?.elevation).toBe(0);
    expect(theme.components?.MuiTextField?.defaultProps?.size).toBe('small');
    expect(theme.components?.MuiButton?.defaultProps?.disableElevation).toBe(true);
  });
});

describe('globals.css legacy block removed (M0)', () => {
  const globals = readFileSync(join(process.cwd(), 'styles/globals.css'), 'utf8');
  it('imports tokens.css and no remote fonts', () => {
    expect(globals).toMatch(/@import "\.\/tokens\.css";/);
    expect(globals).not.toMatch(/fonts\.googleapis/);
  });
  it('drops the old z-index scale and the radius-lg/xl overrides', () => {
    expect(globals).not.toMatch(/--z-(dropdown|sticky|drawer|modal|popover|tooltip|toast):/);
    expect(globals).not.toMatch(/--radius-(lg|xl):/);
    expect(globals).not.toMatch(/--font-sans:/);
  });
});

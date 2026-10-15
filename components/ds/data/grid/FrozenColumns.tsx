// BulkGrid frozen columns (bulk-grid.md §5.1): `position: sticky; left: <sum of the widths before it>` inside
// DataTable's horizontal scroller, with an e1 right shadow on the last frozen column once scrolled sideways.
// Frozen columns are ordered first; the checkbox column is always frozen at left 0 when there is one.
// DataTable lays out with `table-layout: auto`, so the rendered widths (padding, a 48px thumb + 24px padding,
// the MUI checkbox) differ from the declared ones: BulkGrid measures the frozen header cells
// (`useMeasuredFrozenWidths`) and the offsets come from those; the declared widths are only the fallback.
import { useCallback, useLayoutEffect, useState, type MutableRefObject } from 'react';
import { neutral as n, zIndex } from '@/lib/ds/tokens';

export const SELECT_COL_WIDTH = 40;
const DEFAULT_WIDTH = 120;

type FrozenLike = { key: string; frozen?: boolean; width?: number | string };

/** Frozen columns first (stable), then the rest in their given order. */
export function orderFrozenFirst<C extends FrozenLike>(cols: C[]): C[] {
  return [...cols.filter((c) => c.frozen), ...cols.filter((c) => !c.frozen)];
}

export function columnWidthPx(c: FrozenLike): number {
  return typeof c.width === 'number' ? c.width : DEFAULT_WIDTH;
}

/** Rendered widths of the checkbox column (`select`) and of the frozen columns by key. */
export type MeasuredWidths = { select?: number; cols: Map<string, number> };

/** key → left offset for every frozen column among the VISIBLE ones (in display order). */
export function frozenOffsets(
  visible: FrozenLike[],
  hasSelection: boolean,
  measured?: MeasuredWidths | null,
): { left: Map<string, number>; lastKey: string | null } {
  const left = new Map<string, number>();
  let x = hasSelection ? (measured?.select ?? SELECT_COL_WIDTH) : 0;
  let lastKey: string | null = null;
  for (const c of visible) {
    if (!c.frozen) break;
    left.set(c.key, x);
    x += measured?.cols.get(c.key) ?? columnWidthPx(c);
    lastKey = c.key;
  }
  return { left, lastKey };
}

const sameMeasure = (a: MeasuredWidths | null, b: MeasuredWidths | null): boolean => {
  if (!a || !b) return a === b;
  if (a.select !== b.select || a.cols.size !== b.cols.size) return false;
  for (const [k, v] of a.cols) if (b.cols.get(k) !== v) return false;
  return true;
};

/**
 * Measures the rendered header cells of the checkbox column + the leading frozen columns inside `containerRef`
 * (the first header row: `[checkbox?, ...visibleCols]`). Re-measures when a measured cell resizes (content,
 * fonts, rows loading). Returns null until a real
 * layout exists (jsdom / before paint reports 0) so the declared widths are used.
 */
export function useMeasuredFrozenWidths(
  containerRef: MutableRefObject<HTMLElement | null>,
  visibleKeys: string[],
  frozenCount: number,
  hasSelection: boolean,
): MeasuredWidths | null {
  const [measured, setMeasured] = useState<MeasuredWidths | null>(null);
  const keysSig = visibleKeys.join('\u0000');
  useLayoutEffect(() => {
    const root = containerRef.current;
    const head = root?.querySelector('thead tr');
    if (!root || !head || frozenCount === 0) { setMeasured((prev) => (prev === null ? prev : null)); return undefined; }
    const cells = Array.from(head.children) as HTMLElement[];
    const offset = hasSelection ? 1 : 0;
    const targets = cells.slice(0, offset + frozenCount);
    const measure = () => {
      const widths = targets.map((el) => el.getBoundingClientRect().width);
      if (widths.some((w) => !(w > 0))) { setMeasured((prev) => (prev === null ? prev : null)); return; }
      const next: MeasuredWidths = { select: hasSelection ? widths[0] : undefined, cols: new Map() };
      visibleKeys.slice(0, frozenCount).forEach((k, i) => next.cols.set(k, widths[offset + i]));
      setMeasured((prev) => (sameMeasure(prev, next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    targets.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [containerRef, keysSig, frozenCount, hasSelection]);
  return measured;
}

const edgeShadow = `4px 0 4px -2px rgb(15 23 42 / .08)`;

/** sx for a frozen body or header cell. `bg` must be opaque so scrolled cells don't show through. */
export function frozenCellSx(left: number, opts: { last: boolean; scrolled: boolean; header?: boolean; bg?: string }): Record<string, unknown> {
  return {
    position: 'sticky',
    left,
    zIndex: opts.header ? zIndex.stickyHeader + 1 : 1,
    ...(opts.bg ? { bgcolor: opts.bg } : {}),
    ...(opts.last && opts.scrolled ? { boxShadow: `${edgeShadow}, inset -1px 0 0 ${n[100]}` } : {}),
  };
}

/** Horizontal-scroll flag for the shadow (fed by DataTable's `grid.onHorizontalScroll`). */
export function useHorizontalScrolled(): [boolean, (v: boolean) => void] {
  const [scrolled, setScrolled] = useState(false);
  const set = useCallback((v: boolean) => setScrolled(v), []);
  return [scrolled, set];
}

// BulkGrid roving cell focus (bulk-grid.md §4 "Focus model"): exactly one cell has tabIndex=0. Focus is stored
// by row id + column key so it survives re-sorting and column toggles, and resolved to indices per render.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

export type GridPos = { rowIndex: number; colIndex: number };
type FocusKey = { rowId: string; colKey: string };

export const cellSelector = (p: GridPos) => `[data-gr="${p.rowIndex}"][data-gc="${p.colIndex}"]`;

export function clampPos(p: GridPos, rowCount: number, colCount: number): GridPos {
  return {
    rowIndex: Math.max(0, Math.min(rowCount - 1, p.rowIndex)),
    colIndex: Math.max(0, Math.min(colCount - 1, p.colIndex)),
  };
}

/** Tab order inside the grid: right along the row, wrapping to the next row. null = leave the grid. */
export function tabStep(p: GridPos, dir: 1 | -1, rowCount: number, colCount: number): GridPos | null {
  let { rowIndex, colIndex } = p;
  colIndex += dir;
  if (colIndex >= colCount) { colIndex = 0; rowIndex += 1; }
  if (colIndex < 0) { colIndex = colCount - 1; rowIndex -= 1; }
  if (rowIndex < 0 || rowIndex >= rowCount) return null;
  return { rowIndex, colIndex };
}

export function useGridFocus(opts: {
  rowIds: string[];
  colKeys: string[];
  containerRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const { rowIds, colKeys, containerRef } = opts;
  const [focus, setFocusKey] = useState<FocusKey | null>(null);
  const wantDom = useRef(false);

  const pos: GridPos | null = useMemo(() => {
    if (rowIds.length === 0 || colKeys.length === 0) return null;
    if (!focus) return { rowIndex: 0, colIndex: 0 };
    const r = rowIds.indexOf(focus.rowId);
    const c = colKeys.indexOf(focus.colKey);
    return { rowIndex: r < 0 ? 0 : r, colIndex: c < 0 ? 0 : c };
  }, [focus, rowIds, colKeys]);

  const setPos = useCallback((p: GridPos, moveDom = true) => {
    if (rowIds.length === 0 || colKeys.length === 0) return;
    const q = clampPos(p, rowIds.length, colKeys.length);
    wantDom.current = moveDom;
    setFocusKey({ rowId: rowIds[q.rowIndex], colKey: colKeys[q.colIndex] });
  }, [rowIds, colKeys]);

  /** Puts DOM focus on the current cell (after an editor closes, for example). */
  const focusDom = useCallback((p?: GridPos | null) => {
    const target = p ?? pos;
    if (!target) return;
    const el = containerRef.current?.querySelector<HTMLElement>(cellSelector(target));
    el?.focus({ preventScroll: false });
  }, [containerRef, pos]);

  useEffect(() => {
    if (!wantDom.current || !pos) return;
    wantDom.current = false;
    focusDom(pos);
  }, [pos, focusDom]);

  return { pos, setPos, focusDom };
}

import { describe, expect, it } from 'vitest';
import { planFill } from '@/lib/bulk/fill';
import { liveValue, type GridCellSpec } from '@/lib/bulk/paste';
import { columns, getRowId, makeRows, messages, type Row } from './fixtures-m7a';

const getValue = (row: Row, col: GridCellSpec<Row>) => liveValue(col, row);
const PRICE = 2;
const TAGS = 4;

describe('planFill (⌘D)', () => {
  it('with a selection: the focused value goes to every other selected row', () => {
    const rows = makeRows(5);
    const out = planFill({ rows, getRowId, columns, focus: { rowIndex: 0, colIndex: PRICE }, selectedIds: ['L1', 'L3', 'L4'], getValue, messages });
    expect(out.kind === 'ok' && out.mode).toBe('selection');
    expect(out.kind === 'ok' && out.patches.map((p) => [p.rowId, p.value])).toEqual([['L3', 10], ['L4', 10]]);
  });

  it('the focused row need not be selected', () => {
    const out = planFill({ rows: makeRows(3), getRowId, columns, focus: { rowIndex: 2, colIndex: PRICE }, selectedIds: ['L1'], getValue, messages });
    expect(out.kind === 'ok' && out.patches.map((p) => [p.rowId, p.value])).toEqual([['L1', 12]]);
  });

  it('without a selection: copies from the row above into the focused cell', () => {
    const out = planFill({ rows: makeRows(3), getRowId, columns, focus: { rowIndex: 2, colIndex: PRICE }, getValue, messages });
    expect(out.kind === 'ok' && [out.mode, out.patches]).toEqual(['above', [{ rowId: 'L3', field: 'price', value: 11 }]]);
    expect(planFill({ rows: makeRows(3), getRowId, columns, focus: { rowIndex: 0, colIndex: PRICE }, getValue, messages })).toEqual({ kind: 'error', code: 'noSource' });
  });

  it('skips and counts per-row read-only cells; refuses read-only columns', () => {
    const rows = makeRows(4, (i) => ({ variations: i === 2 }));
    const out = planFill({ rows, getRowId, columns, focus: { rowIndex: 0, colIndex: PRICE }, selectedIds: ['L2', 'L3', 'L4'], getValue, messages });
    expect(out.kind === 'ok' && [out.patches.length, out.skipped, out.skippedReasons]).toEqual([2, 1, [{ reason: 'Has variations', count: 1 }]]);
    expect(planFill({ rows, getRowId, columns, focus: { rowIndex: 0, colIndex: 6 }, getValue, messages })).toEqual({ kind: 'error', code: 'readOnlyColumn', column: 'Health' });
  });

  it('tags fill copies (replace), each target gets its own array', () => {
    const rows = makeRows(3, (i) => ({ tags: i === 0 ? ['x', 'y'] : [] }));
    const out = planFill({ rows, getRowId, columns, focus: { rowIndex: 0, colIndex: TAGS }, selectedIds: ['L2', 'L3'], getValue, messages });
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.colType).toBe('tags-edit');
    expect(out.patches.map((p) => p.value)).toEqual([['x', 'y'], ['x', 'y']]);
    expect(out.patches[0].value).not.toBe(out.patches[1].value);
  });

  it('validates the copied value against each target row', () => {
    const rows = makeRows(2, (i) => ({ price: i === 0 ? 0.1 : 5 }));
    const out = planFill({ rows, getRowId, columns, focus: { rowIndex: 1, colIndex: PRICE }, getValue, messages });
    expect(out.kind === 'ok' && out.patches[0].error).toBe("Etsy's minimum price is $0.20");
  });

  it('targets that already hold the value are dropped and counted; an invalid target is still filled', () => {
    const rows = makeRows(4, (i) => ({ price: i === 2 ? 10 : 10 + i }));
    const out = planFill({ rows, getRowId, columns, focus: { rowIndex: 0, colIndex: PRICE }, selectedIds: ['L2', 'L3', 'L4'], getValue, messages });
    expect(out.kind === 'ok' && [out.patches.map((p) => p.rowId), out.unchanged]).toEqual([['L2', 'L4'], 1]);
    const out2 = planFill({
      rows, getRowId, columns, focus: { rowIndex: 0, colIndex: PRICE }, selectedIds: ['L3'], getValue, messages,
      isInvalid: (id) => id === 'L3',
    });
    expect(out2.kind === 'ok' && [out2.patches.map((p) => p.rowId), out2.unchanged]).toEqual([['L3'], 0]);
  });
});

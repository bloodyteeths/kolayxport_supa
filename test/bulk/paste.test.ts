import { describe, expect, it } from 'vitest';
import { evaluateCellText, formatCellValue, liveValue, planPaste, type GridCellSpec } from '@/lib/bulk/paste';
import { parseTsv } from '@/lib/bulk/tsv';
import { acceptanceSheet, columns, getRowId, makeRows, messages, type Row } from './fixtures-m7a';

const visible = columns; // display order: thumb, title, price, qty, tags, section, health
const TITLE = 1;
const PRICE = 2;

const plan = (text: string, rows: Row[], focus: { rowIndex: number; colIndex: number }, selectedIds: string[] = []) =>
  planPaste({ matrix: parseTsv(text), rows, getRowId, columns: visible, focus, selectedIds, messages });

describe('planPaste: bulk-grid §9 acceptance (200 × 3 from Google Sheets)', () => {
  it('200 rows × 3 columns → 597 edits, exactly the 3 expected invalid cells, one patch list', () => {
    const rows = makeRows(250);
    const out = plan(acceptanceSheet(), rows, { rowIndex: 0, colIndex: TITLE });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.rows).toBe(200);
    expect(out.cols).toBe(3);
    expect(out.patches).toHaveLength(600);
    expect(out.edits).toBe(597);
    expect(out.invalid).toBe(3);
    expect(out.overflow).toBe(0);
    expect(out.rowIds).toHaveLength(200);
    const bad = out.patches.filter((p) => p.error).map((p) => [p.rowId, p.field, p.value]);
    expect(bad).toEqual([
      ['L11', 'title', 'x'.repeat(141)],
      ['L31', 'price', '0.10'],
      ['L32', 'price', 'abc'],
    ]);
    // entity round trip: titles stored decoded, never `&#39;` / `&amp;`
    const t1 = out.patches.find((p) => p.rowId === 'L1' && p.field === 'title');
    expect(t1?.value).toBe("Mom's Gift & Keepsake 1");
    // comma decimals → 12.5 (no locale involved)
    expect(out.patches.filter((p) => p.field === 'price' && p.value === 12.5)).toHaveLength(3);
    // pasted keys are exactly title / price / quantity
    expect(new Set(out.patches.map((p) => p.field))).toEqual(new Set(['title', 'price', 'quantity']));
    // batching contract with the staging queue (≤ 50 items per request → 4 requests)
    expect(Math.ceil(new Set(out.patches.filter((p) => !p.error).map((p) => p.rowId)).size / 50)).toBe(4);
  });

  it('decodes entities that came from the sheet', () => {
    const out = plan('Tom &amp; Jerry&#39;s', makeRows(1), { rowIndex: 0, colIndex: TITLE });
    expect(out.kind === 'ok' && out.patches[0].value).toBe("Tom & Jerry's");
  });
});

describe('planPaste rules', () => {
  it('ragged clipboard → notRect, nothing applied', () => {
    expect(plan('a\tb\nc', makeRows(3), { rowIndex: 0, colIndex: TITLE })).toEqual({ kind: 'error', code: 'notRect' });
  });

  it('trailing empty cells per row are trimmed before the rectangle check', () => {
    const out = plan('a\t1\t\nb\t2', makeRows(3), { rowIndex: 0, colIndex: TITLE });
    expect(out.kind === 'ok' && out.cols).toBe(2);
  });

  it('a whole-column read-only target refuses the paste with the column name', () => {
    expect(plan('5\t6', makeRows(3), { rowIndex: 0, colIndex: 5 })).toEqual({ kind: 'error', code: 'readOnlyColumn', column: 'Health' });
    expect(plan('x', makeRows(3), { rowIndex: 0, colIndex: 0 })).toEqual({ kind: 'error', code: 'readOnlyColumn', column: '' });
  });

  it('per-row read-only cells are skipped and counted by reason', () => {
    const rows = makeRows(4, (i) => ({ variations: i === 1, managed: i === 2 }));
    const out = plan('1\t2\n3\t4\n5\t6\n7\t8', rows, { rowIndex: 0, colIndex: PRICE });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.skipped).toBe(3);
    expect(out.skippedReasons).toEqual([
      { reason: 'Has variations', count: 2 },
      { reason: 'Stock sync manages this quantity', count: 1 },
    ]);
    expect(out.edits).toBe(5);
  });

  it('rows beyond the page are counted as overflow, never applied', () => {
    const out = plan('a\nb\nc\nd', makeRows(3), { rowIndex: 1, colIndex: TITLE });
    expect(out.kind === 'ok' && [out.overflow, out.patches.length]).toEqual([2, 2]);
  });

  it('columns beyond the last visible one are counted', () => {
    const out = plan('a\tb\tc', makeRows(1), { rowIndex: 0, colIndex: 5 - 1 });
    // section(4)…: target section, health → health is read-only → refused
    expect(out.kind).toBe('error');
    const out2 = planPaste({ matrix: [['x', 'y', 'z']], rows: makeRows(1), getRowId, columns: visible.slice(0, 3), focus: { rowIndex: 0, colIndex: 1 }, messages });
    expect(out2.kind === 'ok' && out2.colOverflow).toBe(1);
    // `cols` reports what was applied (2), not the clipboard width (3)
    expect(out2.kind === 'ok' && [out2.cols, out2.patches.length]).toEqual([2, 2]);
  });

  it('valid cells equal to the current value are dropped and counted as unchanged (unless the cell is invalid)', () => {
    const rows = makeRows(3); // prices 10, 11, 12
    const getValue = (r: Row, c: GridCellSpec<Row>) => liveValue(c, r);
    const out = planPaste({ matrix: parseTsv('10\n99\n12'), rows, getRowId, columns: visible, focus: { rowIndex: 0, colIndex: PRICE }, messages, getValue });
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.patches).toEqual([{ rowId: 'L2', field: 'price', value: 99 }]);
    expect([out.edits, out.unchanged, out.rowIds]).toEqual([1, 2, ['L2']]);
    // a currently invalid cell receiving its live value is a real fix → emitted
    const out2 = planPaste({
      matrix: [['10']], rows, getRowId, columns: visible, focus: { rowIndex: 0, colIndex: PRICE }, messages, getValue,
      isInvalid: (id, f) => id === 'L1' && f === 'price',
    });
    expect(out2.kind === 'ok' && [out2.patches, out2.unchanged]).toEqual([[{ rowId: 'L1', field: 'price', value: 10 }], 0]);
  });

  it('a single value with rows selected (focus inside the selection) fills every selected row', () => {
    const rows = makeRows(5);
    const out = plan('9,99', rows, { rowIndex: 1, colIndex: PRICE }, ['L2', 'L4', 'L5']);
    expect(out.kind === 'ok' && out.patches.map((p) => [p.rowId, p.value])).toEqual([['L2', 9.99], ['L4', 9.99], ['L5', 9.99]]);
    expect(out.kind === 'ok' && out.intoSelection).toBe(true);
    // focus outside the selection → only the focused cell
    const out2 = plan('9,99', rows, { rowIndex: 0, colIndex: PRICE }, ['L2']);
    expect(out2.kind === 'ok' && out2.patches.map((p) => p.rowId)).toEqual(['L1']);
  });

  it('follows the display order of the given rows (after sort / filter)', () => {
    const rows = makeRows(3).reverse();
    const out = plan('a\nb', rows, { rowIndex: 0, colIndex: TITLE });
    expect(out.kind === 'ok' && out.patches.map((p) => p.rowId)).toEqual(['L3', 'L2']);
  });

  it('empty clipboard', () => {
    expect(plan('', makeRows(1), { rowIndex: 0, colIndex: TITLE })).toEqual({ kind: 'error', code: 'empty' });
  });
});

describe('evaluateCellText defaults', () => {
  const row = makeRows(1)[0];
  const col = (key: string) => columns.find((c) => c.key === key)!;
  it('money: currency mismatch, empty', () => {
    expect(evaluateCellText(col('price'), row, '5 EUR', messages).error).toBe("Currency doesn't match this shop (USD)");
    expect(evaluateCellText(col('price'), row, '', messages).error).toBe('Enter a value');
  });
  it('int: whole numbers only', () => {
    expect(evaluateCellText(col('qty'), row, '2.5', messages).error).toBe('Enter a whole number');
    expect(evaluateCellText(col('qty'), row, '1.000', messages)).toEqual({ value: '1.000', error: '0–999' });
    expect(evaluateCellText(col('qty'), row, '1.234', messages)).toEqual({ value: '1.234', error: '0–999' });
    expect(evaluateCellText(col('qty'), row, '12', messages)).toEqual({ value: 12, error: null });
  });
  it('tags: replace, split on commas, dedupe, limits', () => {
    expect(evaluateCellText(col('tags'), row, 'baby gift, newborn , baby gift', messages)).toEqual({ value: ['baby gift', 'newborn'], error: null });
    expect(evaluateCellText(col('tags'), row, 'a'.repeat(21), messages).error).toBe(`${'a'.repeat(21)} 21/20`);
    expect(evaluateCellText(col('tags'), row, Array.from({ length: 14 }, (_, i) => `t${i}`).join(','), messages).error).toBe('13 tags is the limit');
  });
  it('tags: the column TagInput rules apply to paste exactly like the popover editor', () => {
    const rules: GridCellSpec<Row> = {
      ...col('tags'),
      tagInputProps: () => ({
        normalize: (raw: string) => raw.trim().toLowerCase().replace(/[^a-z0-9 ]/g, ''),
        validate: (t: string) => (t.startsWith('etsy') ? 'No marketplace names' : null),
      }),
    };
    expect(evaluateCellText(rules, row, 'Baby Gift!, NEWBORN', messages)).toEqual({ value: ['baby gift', 'newborn'], error: null });
    expect(evaluateCellText(rules, row, 'baby gift, etsy best', messages)).toEqual({ value: 'baby gift, etsy best', error: 'No marketplace names' });
    expect(evaluateCellText(rules, row, 'baby gift, ***', messages)).toEqual({ value: 'baby gift, ***', error: 'bad tag ***' });
  });
  it('select: by value or label, otherwise no option', () => {
    expect(evaluateCellText(col('section'), row, 'boxes', messages)).toEqual({ value: '2', error: null });
    expect(evaluateCellText(col('section'), row, '1', messages)).toEqual({ value: '1', error: null });
    expect(evaluateCellText(col('section'), row, 'Lamps', messages).error).toBe('no option Lamps');
  });
  it('format round-trips money and tags', () => {
    expect(formatCellValue(col('price'), row, 1109.3)).toBe('1109.30');
    expect(formatCellValue(col('tags'), row, ['a', 'b'])).toBe('a, b');
    expect(formatCellValue(col('section'), row, '2')).toBe('Boxes');
  });
});

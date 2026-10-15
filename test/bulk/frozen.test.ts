import { describe, expect, it } from 'vitest';
import { frozenOffsets, SELECT_COL_WIDTH } from '@/components/ds/data/grid/FrozenColumns';

const cols = [
  { key: 'thumb', width: 48, frozen: true },
  { key: 'title', width: 320, frozen: true },
  { key: 'price', width: 104 },
];

describe('frozenOffsets', () => {
  it('falls back to the declared widths until measured', () => {
    const { left, lastKey } = frozenOffsets(cols, true);
    expect([left.get('thumb'), left.get('title'), left.has('price'), lastKey]).toEqual([SELECT_COL_WIDTH, SELECT_COL_WIDTH + 48, false, 'title']);
  });
  it('uses the rendered widths (thumb 48 + 24 padding, MUI checkbox) once measured', () => {
    const { left } = frozenOffsets(cols, true, { select: 46, cols: new Map([['thumb', 72], ['title', 320]]) });
    expect([left.get('thumb'), left.get('title')]).toEqual([46, 118]);
  });
});

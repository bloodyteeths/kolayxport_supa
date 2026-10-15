import { describe, expect, it } from 'vitest';
import { parseTsv, rectangleWidth, toTsv, trimRow, tsvCell } from '@/lib/bulk/tsv';

describe('parseTsv (Excel / Sheets quoting)', () => {
  it('splits tabs and newlines, strips one trailing newline', () => {
    expect(parseTsv('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('a\tb')).toEqual([['a', 'b']]);
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('x\n')).toEqual([['x']]);
  });
  it('normalizes CRLF and lone CR', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('a\rb')).toEqual([['a'], ['b']]);
  });
  it('quoted fields keep tabs, newlines and doubled quotes', () => {
    expect(parseTsv('"line 1\nline 2"\t"say ""hi"""\n"a\tb"\tc')).toEqual([
      ['line 1\nline 2', 'say "hi"'],
      ['a\tb', 'c'],
    ]);
  });
  it('a quote inside an unquoted field is literal', () => {
    expect(parseTsv('5" wide\tx')).toEqual([['5" wide', 'x']]);
    expect(parseTsv('"5" wide\tx')).toEqual([['"5" wide', 'x']]);
  });
  it('keeps empty cells and empty lines in the middle', () => {
    expect(parseTsv('a\t\tc\n\nb')).toEqual([['a', '', 'c'], [''], ['b']]);
    expect(parseTsv('a\t')).toEqual([['a', '']]);
  });
});

describe('rectangle', () => {
  it('same widths → width; ragged after trimming → null', () => {
    expect(rectangleWidth([['a', 'b'], ['c', 'd']])).toBe(2);
    expect(rectangleWidth([['a', 'b', ''], ['c', 'd']])).toBe(2);
    expect(rectangleWidth([['a', 'b', 'c'], ['c', 'd']])).toBeNull();
    expect(rectangleWidth([])).toBeNull();
    expect(trimRow(['', ''])).toEqual(['']);
  });
});

describe('toTsv', () => {
  it('round-trips through parseTsv', () => {
    const rows = [['Baby "Blanket"', 'a\tb'], ['line\nbreak', 'plain']];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
    expect(tsvCell('plain')).toBe('plain');
  });
});

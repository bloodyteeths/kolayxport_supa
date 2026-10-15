import { describe, it, expect } from 'vitest';
import { CSV_BOM, contentDisposition, csvCell, exportColumns, exportFilename, LISTINGS_EXPORT_BASE_COLUMNS, toCsv } from '@/lib/listings/csv';

describe('csv serializer', () => {
  it('quotes, escapes and guards formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1 gift')).toBe("'+1 gift");
    expect(csvCell('@me')).toBe("'@me");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(64.5)).toBe('64.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(csvCell('Çiçekli Kutu, ışıklı')).toBe('"Çiçekli Kutu, ışıklı"');
  });

  it('writes BOM + header + CRLF rows in column order', () => {
    const out = toCsv(['id', 'title', 'price'], [{ id: '1', title: 'Box', price: 64, extra: 'x' }, { id: '2', title: null }]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out.slice(1)).toBe('id,title,price\r\n1,Box,64\r\n2,,\r\n');
    expect(toCsv(['a'], [], { bom: false })).toBe('a\r\n');
  });

  it('export columns: base, marketplace extras, description last', () => {
    expect(exportColumns(['section', 'views'], true)).toEqual([...LISTINGS_EXPORT_BASE_COLUMNS, 'section', 'views', 'description']);
    expect(exportColumns(['sku'], false)).toEqual([...LISTINGS_EXPORT_BASE_COLUMNS]);
  });

  it('filename folds Turkish letters and dates in UTC', () => {
    expect(exportFilename('etsy', 'Belle Couture Gifts', new Date('2026-10-15T23:30:00Z'))).toBe('etsy-listings-belle-couture-gifts-2026-10-15.csv');
    expect(exportFilename('trendyol', 'Çiçek Şöleni İstanbul', new Date('2026-01-02T00:00:00Z'))).toBe('trendyol-listings-cicek-soleni-istanbul-2026-01-02.csv');
    expect(exportFilename('wix', '***', new Date('2026-01-02T00:00:00Z'))).toBe('wix-listings-2026-01-02.csv');
    expect(contentDisposition('a-ş.csv')).toBe(`attachment; filename="a-_.csv"; filename*=UTF-8''a-%C5%9F.csv`);
  });
});

// M9 Group C pure tests: lib/reports/dateRange (TR timezone edges, previous window, granularity), lib/reports/exportCsv
// (machine-readable format), the Sales response normalizer, ReportsPage routing helpers and the Sales table helpers.
import { describe, expect, it } from 'vitest';
import fixture from '../../__tests__/fixtures/reports/sales.json';
import {
  addDays,
  autoGranularity,
  dayToPickerDate,
  effectiveGranularity,
  isDayKey,
  parseBucketStart,
  pickerDateToDay,
  previousWindow,
  rangeDays,
  salesCompareWindow,
  resolveReportPreset,
  resolveReportRange,
  REPORT_MAX_RANGE_DAYS,
  todayIn,
  validGranularities,
} from '@/lib/reports/dateRange';
import { CSV_BOM, buildCsv, csvCell, csvNumber, reportCsvFilename } from '@/lib/reports/exportCsv';
import { normalizeSalesReport, salesReportKey, salesReportUrl } from '@/lib/reports/useSalesReport';
import { legacyReportsHref, reportTabHref, resolveFinanceMarketplace } from '@/components/domain/reports/ReportsPage';
import { bucketLabel, alignPrevious } from '@/components/domain/reports/sales/SalesTrendChart';
import { currencySymbol, originalRevenueText, reportOrdersHref, rowConverted, storeDisplayName, storeOrdersHref, storeOrdersValues } from '@/components/domain/reports/sales/StoreTable';
import { summarizeStatuses } from '@/components/domain/reports/sales/StatusSummary';
import { matchesProduct } from '@/components/domain/reports/sales/TopProductsTable';
import { baseSalesCurrency, convertedCurrencies, defaultSalesCurrency, excludedCurrencies, isRangeRejected, salesCsvBlocks, storeChoices } from '@/components/domain/reports/sales/SalesReport';

const IST = 'Europe/Istanbul';

describe('dateRange: seller timezone (B2/B13)', () => {
  it('an Istanbul 00:30 on 1 Oct is 1 Oct, though UTC still reads 30 Sep', () => {
    const now = new Date('2026-09-30T21:30:00Z'); // 00:30 in Istanbul (UTC+3)
    expect(todayIn(IST, now)).toBe('2026-10-01');
    expect(todayIn('UTC', now)).toBe('2026-09-30');
    expect(resolveReportPreset('thisMonth', IST, now)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(resolveReportPreset('today', IST, now)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });

  it('presets', () => {
    const now = new Date('2026-10-15T09:00:00Z');
    expect(resolveReportPreset('yesterday', IST, now)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(resolveReportPreset('last7', IST, now)).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(resolveReportPreset('last30', IST, now)).toEqual({ from: '2026-09-16', to: '2026-10-15' });
    expect(resolveReportPreset('last90', IST, now)).toEqual({ from: '2026-07-18', to: '2026-10-15' });
    expect(resolveReportPreset('lastMonth', IST, now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolveReportPreset('thisYear', IST, now)).toEqual({ from: '2026-01-01', to: '2026-10-15' });
    expect(resolveReportPreset('lastYear', IST, now)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    // January → last month is December of the previous year.
    expect(resolveReportPreset('lastMonth', IST, new Date('2026-01-10T09:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('URL state → range: named preset wins, explicit days are custom (swapped), junk → Last 30 days', () => {
    const now = new Date('2026-10-15T09:00:00Z');
    expect(resolveReportRange({ preset: 'last7', from: '2026-01-01', to: '2026-01-02' }, IST, now)).toEqual({ from: '2026-10-09', to: '2026-10-15', preset: 'last7' });
    expect(resolveReportRange({ from: '2026-09-30', to: '2026-09-01' }, IST, now)).toEqual({ from: '2026-09-01', to: '2026-09-30', preset: 'custom' });
    expect(resolveReportRange({ from: '2026-02-30', to: 'x' }, IST, now)).toEqual({ from: '2026-09-16', to: '2026-10-15', preset: 'last30' });
    expect(resolveReportRange({ from: '2026-09-05' }, IST, now)).toEqual({ from: '2026-09-05', to: '2026-09-05', preset: 'custom' });
    // Longer than REPORT_MAX_RANGE_DAYS (the API's 732-day limit): clamped to the last 732 days ending on `to`.
    const long = resolveReportRange({ from: '2020-01-01', to: '2026-10-15' }, IST, now);
    expect(long).toEqual({ from: '2024-10-14', to: '2026-10-15', preset: 'custom' });
    expect(rangeDays(long.from, long.to)).toBe(REPORT_MAX_RANGE_DAYS);
    expect(resolveReportRange({ from: '2024-10-14', to: '2026-10-15' }, IST, now).from).toBe('2024-10-14');
  });

  it('previous window: equal length before; whole months and This month use the calendar rule (same as the Sales API)', () => {
    expect(previousWindow('2026-10-15', '2026-10-15')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(previousWindow('2026-09-16', '2026-10-15')).toEqual({ from: '2026-08-17', to: '2026-09-15' });
    expect(previousWindow('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(previousWindow('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousWindow('2026-01-01', '2026-01-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    // This month (2+ days) → the same days of last month, clipped.
    expect(previousWindow('2026-10-01', '2026-10-15', 'thisMonth')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(previousWindow('2026-03-01', '2026-03-30', 'thisMonth')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // Any other range starting on the 1st: equal length (Last 7 days on 7 Oct, custom 1–15 Oct).
    expect(previousWindow('2026-10-01', '2026-10-07', 'last7')).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(previousWindow('2026-10-01', '2026-10-15', 'custom')).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    // A single day → the previous day, even on the 1st (Today, This month on the 1st) or the 2nd (Yesterday).
    expect(previousWindow('2026-10-01', '2026-10-01', 'today')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(previousWindow('2026-10-01', '2026-10-01', 'thisMonth')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(previousWindow('2026-10-01', '2026-10-01', 'yesterday')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
  });

  it('salesCompareWindow: only This month sends an explicit window, and it is what the UI labels', () => {
    expect(salesCompareWindow('2026-10-01', '2026-10-15', 'thisMonth')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(salesCompareWindow('2026-10-01', '2026-10-01', 'thisMonth')).toBeNull(); // single day: server rule agrees
    expect(salesCompareWindow('2026-10-01', '2026-10-31', 'thisMonth')).toBeNull(); // whole month: server rule agrees
    expect(salesCompareWindow('2026-10-01', '2026-10-07', 'last7')).toBeNull();
    const p = { from: '2026-10-01', to: '2026-10-15', tz: 'Europe/Istanbul', stores: [], currency: 'TRY' as const, granularity: 'day' as const };
    const compare = salesCompareWindow(p.from, p.to, 'thisMonth');
    expect(salesReportUrl({ ...p, compare })).toContain('&compareFrom=2026-09-01&compareTo=2026-09-15');
    expect(salesReportKey({ ...p, compare })).not.toEqual(salesReportKey(p));
  });

  it('granularity: automatic thresholds, valid overrides, invalid override falls back', () => {
    expect(autoGranularity('2026-10-15', '2026-10-15')).toBe('hour');
    expect(autoGranularity('2026-10-14', '2026-10-15')).toBe('day');
    expect(autoGranularity('2026-09-01', addDays('2026-09-01', 44))).toBe('day');
    expect(autoGranularity('2026-09-01', addDays('2026-09-01', 45))).toBe('week');
    expect(autoGranularity('2026-01-01', addDays('2026-01-01', 179))).toBe('week');
    expect(autoGranularity('2026-01-01', addDays('2026-01-01', 180))).toBe('month');
    expect(validGranularities('2026-10-15', '2026-10-15')).toEqual(['hour']);
    expect(validGranularities('2026-10-09', '2026-10-15')).toEqual(['day']);
    expect(validGranularities('2026-09-16', '2026-10-15')).toEqual(['day', 'week']);
    expect(validGranularities('2025-01-01', '2026-10-15')).toEqual(['week', 'month']);
    expect(effectiveGranularity('2026-09-16', '2026-10-15', 'week')).toBe('week');
    expect(effectiveGranularity('2026-09-16', '2026-10-15', 'month')).toBe('day');
    expect(effectiveGranularity('2026-10-15', '2026-10-15', 'day')).toBe('hour');
  });

  it('day keys and the picker boundary never shift a day', () => {
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(rangeDays('2026-10-01', '2026-10-31')).toBe(31);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(pickerDateToDay(dayToPickerDate('2026-10-01'))).toBe('2026-10-01');
    expect(parseBucketStart('2026-10-01T05')).toEqual({ day: '2026-10-01', hour: 5 });
    expect(parseBucketStart('2026-10-01')).toEqual({ day: '2026-10-01', hour: null });
    expect(parseBucketStart('nope')).toBeNull();
  });
});

describe('exportCsv (§4.8)', () => {
  it('BOM, comma, dot decimals, ISO dates, CRLF, quoting', () => {
    const csv = buildCsv([
      { title: 'Sales by store', header: ['Store', 'Revenue', 'Currency'], rows: [['Belle, Gifts', 1070860.03, 'TRY'], ['"Quoted"', 0.1 + 0.2, 'USD']] },
      { header: ['Date', 'Amount'], rows: [[new Date('2026-10-01T00:00:00Z'), -12.5]] },
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(
      `${CSV_BOM}Sales by store\r\nStore,Revenue,Currency\r\n"Belle, Gifts",1070860.03,TRY\r\n"""Quoted""",0.3,USD\r\n\r\nDate,Amount\r\n2026-10-01,-12.5\r\n`,
    );
  });
  it('numbers: rounding, integers, non-finite', () => {
    expect(csvNumber(1.005)).toBe('1.01');
    expect(csvNumber(1234567.891)).toBe('1234567.89');
    expect(csvNumber(42)).toBe('42');
    expect(csvNumber(-0.001)).toBe('0');
    expect(csvNumber(Number.NaN)).toBe('');
    expect(csvNumber(0.5714, 4)).toBe('0.5714');
  });
  it('neutralizes spreadsheet formulas in text, not in numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(null)).toBe('');
  });
  it('file name is ASCII and untranslated', () => {
    expect(reportCsvFilename('sales', '2026-09-16', '2026-10-15')).toBe('kolayxport-sales-2026-09-16_2026-10-15.csv');
    expect(reportCsvFilename('Satış raporu', '2026-09-16', 'x/y')).toBe('kolayxport-sat-raporu-2026-09-16_x-y.csv');
  });
});

describe('Sales response normalizer (§6.1)', () => {
  const r = normalizeSalesReport(fixture);
  it('reads the Group A shape (byCurrency map, null deltas, previousRange, availableStores)', () => {
    expect(r.totals.revenue).toBe(1070860.03);
    expect(r.totals.unitsDelta).toBeNull();
    expect(r.previousRange).toEqual({ from: '2026-08-17', to: '2026-09-15' });
    expect(r.availableStores.map((s) => s.key)).toContain('manual');
    expect(r.stores[2].byCurrency).toEqual([{ currency: 'USD', revenue: 2910.1 }, { currency: 'EUR', revenue: 410 }]);
    expect(r.series).toHaveLength(30);
    expect(r.series[0].bucketStart < r.series[29].bucketStart).toBe(true);
    expect(r.fx.excluded).toEqual([{ currency: 'CAD', orders: 12 }]);
  });
  it('is tolerant of a partial or broken body', () => {
    const e = normalizeSalesReport({ totals: { revenue: 'x', revenueDelta: 'NaN' }, stores: [{ marketplace: 'Weird', share: 3, byCurrency: [{ currency: 'usd', amount: 5 }] }] });
    expect(e.totals.revenue).toBe(0);
    expect(e.totals.revenueDelta).toBeNull();
    expect(e.stores[0].marketplace).toBe('other');
    expect(e.stores[0].share).toBe(1);
    expect(e.stores[0].byCurrency).toEqual([{ currency: 'USD', revenue: 5 }]);
    expect(e.series).toEqual([]);
    expect(normalizeSalesReport(null).products).toEqual([]);
  });
  it('request url / key are stable across store order', () => {
    const p = { from: '2026-09-16', to: '2026-10-15', tz: IST, stores: ['trendyol', 'etsy:belle'], currency: 'TRY' as const, granularity: 'day' as const };
    expect(salesReportUrl(p)).toBe('/api/analytics?from=2026-09-16&to=2026-10-15&tz=Europe%2FIstanbul&currency=TRY&granularity=day&stores=etsy%3Abelle%2Ctrendyol');
    expect(salesReportKey(p)).toEqual(salesReportKey({ ...p, stores: ['etsy:belle', 'trendyol'] }));
  });
});

describe('ReportsPage helpers', () => {
  it('tab hrefs: Sales = /app/reports until analytics.tsx is wired, shared range kept, other keys dropped', () => {
    const q = { from: '2026-09-01', to: '2026-09-30', preset: 'custom', stores: 'etsy', q: 'x' };
    expect(reportTabHref('sales', q)).toBe('/app/analytics?from=2026-09-01&to=2026-09-30&preset=custom');
    expect(reportTabHref('profit', { preset: 'lastMonth' }, { mp: 'etsy' })).toBe('/app/reports/profit?preset=lastMonth&mp=etsy');
    expect(reportTabHref('payouts')).toBe('/app/reports/payouts');
  });
  it('legacy fallback keeps the query', () => {
    expect(legacyReportsHref('sales', { preset: 'last7' })).toBe('/app/analytics?preset=last7');
    expect(legacyReportsHref('profit', { mp: 'ebay' })).toBe('/app/financials?mp=ebay');
  });
  it('finance marketplace: URL, then first connected, unsupported deep links flagged', () => {
    expect(resolveFinanceMarketplace('ebay', {})).toEqual({ mp: 'ebay', supported: true });
    expect(resolveFinanceMarketplace(undefined, { etsy: false, ebay: false, amazon: true })).toEqual({ mp: 'amazon', supported: true });
    expect(resolveFinanceMarketplace('wix', { etsy: true })).toEqual({ mp: 'etsy', supported: false });
  });
});

describe('Sales helpers', () => {
  const r = normalizeSalesReport(fixture);
  const fmt = { money: (a: number | null | undefined, c: string | null | undefined) => `${c} ${a}` };
  it('store names, Orders filter values and original revenue (never summed)', () => {
    expect(storeDisplayName(r.stores[0], 'Manual orders')).toBe('BelleCoutureGifts');
    expect(storeDisplayName(r.stores[1], 'Manual orders')).toBe('Trendyol');
    expect(storeDisplayName({ key: 'manual', marketplace: 'manual', shopName: null }, 'Manual orders')).toBe('Manual orders');
    // Exact raw values only: a shop row's name is its raw value; a merged marketplace bucket is unknown (no link).
    expect(storeOrdersValues(r.stores[0])).toEqual(['BelleCoutureGifts']);
    expect(storeOrdersValues(r.stores[1])).toBeNull();
    expect(storeOrdersValues({ shopName: null })).toBeNull();
    expect(storeOrdersValues({ shopName: null, rawMarketplaces: ['Amazon', 'amazon', 'Amazon Channel'] })).toEqual(['Amazon', 'amazon', 'Amazon Channel']);
    expect(originalRevenueText(r.stores[2], fmt as never)).toBe('USD 2910.1 · EUR 410');
    expect(rowConverted(r.stores[1], 'TRY')).toBe(false);
    expect(rowConverted(r.stores[0], 'TRY')).toBe(true);
    // CAD had no rate: left out, not converted.
    expect(excludedCurrencies(r)).toEqual(['CAD']);
    expect(convertedCurrencies(r, 'TRY')).toEqual(['EUR', 'USD']);
    expect(rowConverted({ byCurrency: [{ currency: 'CAD', revenue: 540 }] }, 'TRY', ['CAD'])).toBe(false);
    expect(rowConverted({ byCurrency: [{ currency: 'CAD', revenue: 540 }] }, 'TRY')).toBe(true);
    expect(currencySymbol('TRY', 'tr-TR')).toBe('₺');
  });
  it('Orders deep links: v2 carries the range, legacy falls back to a view', () => {
    expect(reportOrdersHref({ from: '2026-09-01', to: '2026-09-30', status: 'shipped' }, { orders: true })).toBe(
      '/app/labels?view=all&status=shipped&from=2026-09-01&to=2026-09-30&preset=custom',
    );
    expect(reportOrdersHref({ from: '2026-09-01', to: '2026-09-30', store: 'Trendyol' }, { orders: false })).toBe('/app/labels?label=all&mp=Trendyol&from=all');
    const range = { from: '2026-09-01', to: '2026-09-30' };
    const amazon = { shopName: null, rawMarketplaces: ['Amazon', 'amazon'] };
    expect(storeOrdersHref(amazon, range, { orders: true })).toBe('/app/labels?view=all&store=Amazon&store=amazon&from=2026-09-01&to=2026-09-30&preset=custom');
    // The legacy page takes one store: several raw values → plain text, never a partial list.
    expect(storeOrdersHref(amazon, range, { orders: false })).toBeNull();
    expect(storeOrdersHref({ shopName: null }, range, { orders: true })).toBeNull();
  });
  it('statuses map through the DS order vocabulary and sum per key, in display order', () => {
    const s = summarizeStatuses(r.statuses);
    expect(s.map((x) => [x.key, x.count])).toEqual([
      ['to_ship', 42],
      ['shipped', 1120],
      ['delivered', 88],
      ['cancelled', 21],
      ['refunded', 13],
    ]);
  });
  it('store choices: connected shops + stores seen in data, deduped', () => {
    const choices = storeChoices(
      {
        etsy: { connected: true, needsReauth: false, accounts: [{ id: '1', name: 'BelleCoutureGifts', externalId: null }] },
        trendyol: { connected: true, needsReauth: false, accounts: [] },
        ebay: { connected: false, needsReauth: false, accounts: [] },
      } as never,
      [{ key: 'amazon', marketplace: 'amazon', label: 'Amazon' }, { key: 'trendyol', marketplace: 'trendyol', label: 'Trendyol' }],
    );
    expect(choices.map((c) => c.key)).toEqual(['etsy:bellecouturegifts', 'trendyol', 'amazon']);
  });
  it('product search folds case, accents and the Turkish dotless i', () => {
    expect(matchesProduct({ name: 'Işıklı Kutu', sku: null }, 'isikli')).toBe(true);
    expect(matchesProduct({ name: 'Name Necklace', sku: 'NN-G' }, 'nn-g')).toBe(true);
    expect(matchesProduct({ name: 'Name Necklace', sku: 'NN-G' }, 'box')).toBe(false);
  });
  it('bucket labels and aligned comparison', () => {
    expect(bucketLabel('2026-10-01T14', 'hour', 'tr-TR')).toBe('14:00');
    expect(bucketLabel('2026-09-08', 'day', 'en-US')).toMatch(/^8 Sept?$/); // ICU versions differ on 'Sep'/'Sept'
    expect(bucketLabel('2026-09-07', 'week', 'tr-TR', undefined, '2026-09-13')).toMatch(/^7\s?–\s?13 Eyl$/);
    expect(bucketLabel('2026-09-28', 'week', 'tr-TR', '2026-09-30')).toMatch(/^28\s?–\s?30 Eyl$/);
    expect(bucketLabel('2026-09-01', 'month', 'tr-TR')).toBe('Eyl 2026');
    expect(alignPrevious(r.series.slice(0, 3), r.previousSeries.slice(0, 2), 'orders')).toEqual([25, 30, null]);
    // A null previous bucket (shorter previous window) survives normalization and is drawn as a gap.
    const withGap = normalizeSalesReport({ ...fixture, previousSeries: [...fixture.previousSeries.slice(0, 1), null] });
    expect(withGap.previousSeries[1]).toBeNull();
    expect(alignPrevious(withGap.series.slice(0, 2), withGap.previousSeries, 'orders')).toEqual([withGap.previousSeries[0]?.orders, null]);
  });
  it('base currency and CSV blocks', () => {
    expect(baseSalesCurrency('tr')).toBe('TRY');
    expect(baseSalesCurrency('en')).toBe('USD');
    // The account base wins over the UI locale (a TR seller on the EN UI sees TRY); locale only as the fallback.
    expect(defaultSalesCurrency({ state: 'ready', hasSender: true, baseCurrency: 'TRY' }, 'en')).toBe('TRY');
    expect(defaultSalesCurrency({ state: 'ready', hasSender: true, baseCurrency: 'GBP' }, 'en')).toBe('USD');
    expect(defaultSalesCurrency({ state: 'ready', hasSender: false, baseCurrency: 'USD' }, 'tr')).toBe('TRY');
    expect(defaultSalesCurrency({ state: 'error', hasSender: false, baseCurrency: 'USD' }, 'en')).toBe('USD');
    expect(isRangeRejected({ status: 400 })).toBe(true);
    expect(isRangeRejected({ status: 500 })).toBe(false);
    const blocks = salesCsvBlocks(r, { currency: 'TRY', t: (k) => k, manualLabel: 'Manual orders' });
    expect(blocks).toHaveLength(3);
    expect(blocks[0].rows[0]).toEqual(['BelleCoutureGifts', 'etsy', 612, 901, 611300, 'TRY', '0.571', 998.86]);
    const precise = salesCsvBlocks({ ...r, stores: [{ ...r.stores[0], share: 0.5714 }] }, { currency: 'TRY', t: (k) => k, manualLabel: 'Manual orders' });
    expect(precise[0].rows[0][6]).toBe('0.5714');
    expect(blocks[2].rows).toHaveLength(30);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { chart as palette, neutral } from '@/lib/ds/tokens';
import { Chart, getChartTable } from '@/components/ds/data/Chart';
import { barColumnWidth, buildChartOptions, comparisonDelta, seriesColors } from '@/components/ds/data/chartOptions';
import { makeDsFormat } from '@/components/ds/data/fmt';
import { Metric } from '@/components/ds/research/Metric';
import { SourceNote } from '@/components/ds/research/SourceNote';
import { SignalDots } from '@/components/ds/research/SignalDots';
import { PriceBand, priceBandMode } from '@/components/ds/research/PriceBand';
import { EvidenceSummary } from '@/components/ds/research/EvidenceSummary';
import { LOCALES, Providers, html, intlErrors, text } from './m1d-render';

vi.mock('react-apexcharts', () => ({
  default: (p: { type: string; series: unknown; options: { colors?: string[] } }) => (
    <div data-testid="apex" data-type={p.type} data-series={JSON.stringify(p.series)} data-colors={JSON.stringify(p.options.colors ?? [])} />
  ),
}));

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; });
afterEach(() => { expect(intlErrors).toEqual([]); });

const fmt = makeDsFormat('en', 'Europe/Istanbul');

describe('chartOptions (dataviz rules)', () => {
  const series = [
    { name: 'Revenue', data: [10, 20, null, 40] },
    { name: '', data: [8, 18, 22, 30], role: 'comparison' as const },
  ];

  it('comparison is neutral-400, drawn first, solid (A3), unfilled; primary gets an area wash', () => {
    const { series: s, options } = buildChartOptions(
      { type: 'line', series, categories: ['a', 'b', 'c', 'd'], format: 'money', currency: 'USD', comparisonName: 'Previous period' },
      fmt,
    );
    expect(s.map((x) => x.name)).toEqual(['Previous period', 'Revenue']);
    expect(options.colors).toEqual([neutral[400], palette[0]]);
    expect(options.stroke.dashArray).toBe(0);
    expect(options.stroke.width).toEqual([2, 2]);
    expect(options.fill.opacity).toEqual([1, 0.1]);
    expect((s as Array<{ type: string }>).map((x) => x.type)).toEqual(['line', 'area']);
    expect(options.fill.type).toBe('solid');
    expect(Array.isArray(options.yaxis)).toBe(false); // single y-axis
    expect(options.legend.show).toBe(true);
  });

  it('single series: no legend; compact money on the axis only ≥ 100,000', () => {
    const { options } = buildChartOptions({ type: 'bar', series: [series[0]], format: 'money', currency: 'TRY', comparisonName: 'x' }, fmt);
    expect(options.legend.show).toBe(false);
    expect(options.yaxis.labels.formatter(250000)).toBe('₺250K');
    expect(options.yaxis.labels.formatter(1234)).toBe('₺1,234.00');
    expect(options.tooltip.y.formatter(250000)).toBe('₺250,000.00');
  });

  it('palette slots: comparison never consumes a slot; maxSlots caps', () => {
    expect(seriesColors([{ name: 'a', data: [] }, { name: 'b', data: [], role: 'comparison' }, { name: 'c', data: [] }]))
      .toEqual([palette[0], neutral[400], palette[1]]);
    expect(seriesColors(Array.from({ length: 6 }, (_, i) => ({ name: String(i), data: [] })), 4).slice(4)).toEqual([palette[3], palette[3]]);
  });

  it('direct label on the last point', () => {
    const { options } = buildChartOptions(
      { type: 'line', series: [series[0]], categories: ['a', 'b', 'c', 'd'], format: 'number', directLabel: 'last', comparisonName: 'x' },
      fmt,
    );
    expect(options.annotations.points[0]).toMatchObject({ x: 'd', y: 40 });
  });

  it('bars are ≤ 24px, else 60 % of the slot', () => {
    expect(barColumnWidth(600, 3)).toBe('24px');
    expect(barColumnWidth(600, 90)).toBe('4px');
    const few = buildChartOptions({ type: 'bar', series: [series[0]], categories: ['a', 'b', 'c', 'd'], format: 'number', comparisonName: 'x', plotWidth: 800 }, fmt);
    expect(few.options.plotOptions.bar.columnWidth).toBe('24px');
    expect(few.options.plotOptions.bar.borderRadius).toBe(4);
  });

  it('shared tooltip adds the delta against the comparison to primary values only', () => {
    expect(comparisonDelta(20, 0)).toBeNull();
    expect(comparisonDelta(20, 10)).toBe(1);
    const { options } = buildChartOptions(
      { type: 'line', series, categories: ['a', 'b', 'c', 'd'], format: 'money', currency: 'USD', comparisonName: 'Previous period' },
      fmt,
    );
    // ordered = [comparison, Revenue]
    const primary = options.tooltip.y.formatter(20, { seriesIndex: 1, dataPointIndex: 1 });
    expect(primary.startsWith('$20.00 · ')).toBe(true);
    expect(primary).toMatch(/11/);
    expect(options.tooltip.y.formatter(18, { seriesIndex: 0, dataPointIndex: 1 })).toBe('$18.00');
  });

  it('markers become neutral-400 x-axis annotations on the matching category', () => {
    const { options } = buildChartOptions(
      {
        type: 'line', series: [series[0]], categories: [new Date('2026-10-01T12:00:00Z'), new Date('2026-10-02T12:00:00Z')],
        format: 'number', comparisonName: 'x', markers: [{ at: new Date('2026-10-02T12:00:00Z'), label: 'Sent title v3' }],
      },
      fmt,
    );
    expect(options.annotations.xaxis).toHaveLength(1);
    expect(options.annotations.xaxis[0]).toMatchObject({ x: 'Oct 2', borderColor: neutral[400], label: { text: 'Sent title v3' } });
  });

  it('getChartTable rows per category', () => {
    expect(getChartTable(series, ['a', 'b'])[0]).toEqual({ id: '0', category: 'a', values: [8, 10] });
  });
});

describe.each(LOCALES)('Chart (%s)', (locale) => {
  it('loads ApexCharts on the client and always renders an accessible data table', async () => {
    render(
      <Providers locale={locale}>
        <Chart
          type="bar"
          ariaLabel="Orders, last 14 days"
          format="number"
          series={[{ name: 'Orders', data: [3, 5] }, { name: '', data: [2, 4], role: 'comparison' }]}
          categories={[new Date('2026-10-01T12:00:00Z'), new Date('2026-10-02T12:00:00Z')]}
        />
      </Providers>,
    );
    expect(screen.getByRole('img', { name: 'Orders, last 14 days' })).toBeTruthy();
    const table = document.querySelector('table') as HTMLTableElement;
    expect(table.textContent).toContain(locale === 'en' ? 'Previous period' : 'Önceki dönem');
    expect(table.textContent).toContain(locale === 'en' ? 'Oct 1' : '1 Eki');
    await waitFor(() => expect(screen.getByTestId('apex').getAttribute('data-type')).toBe('bar'));
  });

  it('actions="table": ⋯ → Show as table opens a Modal with a DataTable of the data', async () => {
    render(
      <Providers locale={locale}>
        <Chart
          type="line"
          ariaLabel="Revenue over time"
          format="money"
          currency="USD"
          actions="table"
          series={[{ name: 'Revenue', data: [10, 20] }, { name: '', data: [8, 18], role: 'comparison' }]}
          categories={['Week 1', 'Week 2']}
        />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', {
      name: locale === 'en' ? 'More actions for Revenue over time' : 'Revenue over time için diğer işlemler',
    }));
    fireEvent.click(screen.getByRole('menuitem', { name: locale === 'en' ? 'Show as table' : 'Tablo olarak göster' }));
    const dialog = await screen.findByRole('dialog');
    const table = within(dialog).getByRole('table', { name: 'Revenue over time' });
    expect(table.textContent).toContain('Week 2');
    expect(table.textContent).toContain(locale === 'en' ? '$20.00' : '$20,00');
    expect(table.textContent).toContain(locale === 'en' ? 'Previous period' : 'Önceki dönem');
  });
});

describe.each(LOCALES)('research primitives (%s)', (locale) => {
  it('Metric: measured plain, estimate "~", user caption, guard → dash with reason', () => {
    expect(text(<Metric value="$42" kind="measured" />, locale)).toBe('$42');
    expect(html(<Metric value="1,200" kind="estimate" />, locale)).toMatch(/>~<\/span>1,200/);
    expect(text(<Metric value="900" kind="user" />, locale)).toContain(locale === 'en' ? 'You entered' : 'Sizin girdiğiniz');
    const g = html(<Metric value="$5,218" kind="measured" guard={{ ok: false, reason: 'small sample: 7 listings' }} />, locale);
    expect(g).toContain('—');
    expect(g).toContain('aria-label="small sample: 7 listings"');
    expect(g).not.toContain('5,218');
    const k = html(<Metric value={null} kind="measured" guard={{ ok: false, reasonKey: 'ds.research.implausible' }} />, locale);
    expect(k).toContain(locale === 'en' ? 'Check: unusual price range' : 'Kontrol edin');
  });

  it('SourceNote: source · sample · excluded · updated · kind', () => {
    const out = text(
      <SourceNote
        source="Etsy search"
        fetchedAt={new Date(Date.now() - 2 * 3600 * 1000)}
        sample={287}
        sampleTotal={300}
        excluded={{ count: 13, reason: locale === 'en' ? 'no FX rate' : 'kur yok' }}
        kind="measured"
      />,
      locale,
    );
    if (locale === 'en') {
      expect(out).toBe('Etsy search · 287 of 300 listings used · 13 excluded (no FX rate) · updated 2 hr. ago · Measured'.replace('2 hr. ago', out.match(/updated ([^·]+) ·/)?.[1]?.trim() ?? ''));
      expect(out).toMatch(/updated 2 hr/);
    } else {
      expect(out).toContain('300 ilandan 287 tanesi kullanıldı');
      expect(out).toContain('13 hariç tutuldu (kur yok)');
      expect(out).toContain('Ölçülen');
    }
    const keyed = text(<SourceNote source="ds.research.kind.signal" fetchedAt={new Date()} sample={48} kind="signal" />, locale);
    expect(keyed).toContain(locale === 'en' ? 'Signal · 48 listings sampled' : 'Sinyal · 48 ilan incelendi');
  });

  it('SignalDots: 5 dots with tier, null → not enough data', () => {
    const out = html(<SignalDots tier={3} inputs={[{ label: 'Google interest', value: 'rising' }]} />, locale);
    expect(out).toContain('data-tier="3"');
    expect(out).toContain(locale === 'en' ? 'Signal 3 of 5' : 'Sinyal 5 üzerinden 3');
    expect(text(<SignalDots tier={null} inputs={[]} />, locale)).toBe(locale === 'en' ? 'Not enough data' : 'Yeterli veri yok');
  });

  it('PriceBand: median + band, range only below n 20, nothing below n 5, never a mean', () => {
    expect(priceBandMode({ p25: 1, median: 2, p75: 3, n: 4 })).toBe('insufficient');
    expect(priceBandMode({ p25: 1, median: 2, p75: 3, n: 12 })).toBe('range');
    expect(priceBandMode({ p25: 1, median: 2, p75: 3, n: 48 })).toBe('full');
    const full = text(<PriceBand p25={35} median={42} p75={49} currency="USD" n={48} />, locale);
    expect(full).toContain(locale === 'en' ? '$42.00' : '$42,00');
    expect(full).toContain(locale === 'en' ? 'median' : 'medyan');
    expect(full).toContain(locale === 'en' ? '$35.00–$49.00' : '$35,00–$49,00');
    const small = text(<PriceBand p25={35} median={42} p75={49} currency="USD" n={7} />, locale);
    expect(small).toContain(locale === 'en' ? 'Small sample: 7 listings' : 'Küçük örneklem: 7 ilan');
    expect(small).not.toContain(locale === 'en' ? '$42.00' : '$42,00');
    expect(text(<PriceBand p25={null} median={null} p75={null} currency="USD" n={3} />, locale)).toContain('—');
  });

  it('EvidenceSummary: facts (keys or text) and a confidence line', () => {
    const out = text(
      <EvidenceSummary
        facts={[{ key: 'ds.research.smallSample', params: { count: 7 } }, 'Most top listings offer free shipping', 'c', 'd', 'e']}
        confidence="medium"
        basis="48 listings, no Etsy sales data"
      />,
      locale,
    );
    expect(out).toContain(locale === 'en' ? 'Small sample: 7 listings' : 'Küçük örneklem: 7 ilan');
    expect(out).toContain(locale === 'en' ? 'Confidence: medium · 48 listings' : 'Güven: orta · 48 listings');
    expect(out).not.toMatch(/\be\b/);
  });
});

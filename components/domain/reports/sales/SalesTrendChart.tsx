// components/domain/reports/sales/SalesTrendChart.tsx — finance-analytics §2.1, §4.5 (M9 Group C).
// "Revenue over time" / "Orders over time": one line chart, one y-axis (Revenue and Orders are two views of one
// chart, never two axes), chart slot 1 for this period and the neutral-400 comparison line for the previous period
// (DS A3). The API series is ascending and zero-filled (B1), so quiet days show as zero. A single-day range is
// "Orders by hour": bars, with the previous day as the comparison line; the granularity control is hidden.
// Desktop only: the granularity SegmentedControl (automatic on mobile). ⋯ → Show as table (Chart `actions`).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page/Section';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { Chart, type ChartSeries } from '@/components/ds/data/Chart';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Bone } from '@/components/ds/state/Skeletons';
import { px, space } from '@/lib/ds/tokens';
import { bucketEnd, dayKeyToDate, parseBucketStart, type Granularity } from '@/lib/reports/dateRange';
import type { SalesBucket } from '@/lib/reports/useSalesReport';

export type SalesMetric = 'revenue' | 'orders';

/** DS range locale: EN reads "8–14 Sep" (en-GB order), TR "8–14 Eyl". */
function rangeLocale(intlLocale: string): string {
  return intlLocale.startsWith('en') ? 'en-GB' : intlLocale;
}

/**
 * Pure: the x-axis / tooltip label of a bucket. Hour → "14:00" / "2:00 PM"; day → "8 Sep"; week → "8–14 Sep"
 * (the API `bucketEnd`, else 7 days clamped to the range end); month → "Sep 2026". Dates are calendar days (formatted in UTC from noon-UTC instants,
 * so the viewer's zone never shifts them).
 */
export function bucketLabel(bucketStart: string, granularity: Granularity, intlLocale: string, rangeTo?: string, bucketEndKey?: string | null): string {
  const p = parseBucketStart(bucketStart);
  if (!p) return bucketStart;
  const loc = rangeLocale(intlLocale);
  if (granularity === 'hour') {
    const hour = p.hour ?? 0;
    return new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, hour, 0)));
  }
  const start = dayKeyToDate(p.day);
  if (granularity === 'month') {
    return new Intl.DateTimeFormat(loc, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(start);
  }
  const dayFmt = new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (granularity === 'week') {
    const endKey = bucketEndKey && /^\d{4}-\d{2}-\d{2}$/.test(bucketEndKey) ? bucketEndKey : bucketEnd(p.day, 'week', rangeTo);
    const end = dayKeyToDate(endKey);
    const fr = (dayFmt as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string }).formatRange;
    if (end.getTime() === start.getTime()) return dayFmt.format(start);
    return fr ? fr.call(dayFmt, start, end) : `${dayFmt.format(start)} – ${dayFmt.format(end)}`;
  }
  return dayFmt.format(start);
}

/** Pure: previous-period values aligned by index to the current series (missing → null, never a fake 0). */
export function alignPrevious(current: SalesBucket[], previous: ReadonlyArray<SalesBucket | null>, metric: SalesMetric): Array<number | null> {
  return current.map((_, i) => {
    const b = previous[i];
    return b ? b[metric] : null;
  });
}

export interface SalesTrendChartProps {
  series: SalesBucket[] | undefined;
  /** Null entries (shorter previous window) are drawn as gaps. */
  previousSeries: ReadonlyArray<SalesBucket | null> | undefined;
  granularity: Granularity;
  granularities: Granularity[];
  onGranularityChange: (g: Granularity) => void;
  /** Last day of the range (clamps the last week bucket label). */
  rangeTo: string;
  /** "1–31 Aug" for the legend "Previous period (1–31 Aug)". */
  previousLabel: string;
  currency: string;
  intlLocale: string;
  loading: boolean;
  metric: SalesMetric;
  onMetricChange: (m: SalesMetric) => void;
}

export function SalesTrendChart({
  series,
  previousSeries,
  granularity,
  granularities,
  onGranularityChange,
  rangeTo,
  previousLabel,
  currency,
  intlLocale,
  loading,
  metric: metricProp,
  onMetricChange,
}: SalesTrendChartProps) {
  const t = useTranslations('reports');
  const mobile = useIsMobile();
  const hourly = granularity === 'hour';
  // Orders by hour has one measure (orders).
  const metric: SalesMetric = hourly ? 'orders' : metricProp;
  const height = mobile ? 200 : 280;
  const title = hourly ? t('sales.chart.hourlyTitle') : metric === 'revenue' ? t('sales.chart.revenueTitle') : t('sales.chart.ordersTitle');

  const controls = (
    <Box sx={{ display: 'flex', gap: px(space[2]), flexWrap: 'wrap', alignItems: 'center' }}>
      {hourly ? null : (
        <SegmentedControl<SalesMetric>
          value={metric}
          onChange={onMetricChange}
          aria-label={title}
          options={[
            { value: 'revenue', label: t('sales.chart.metricRevenue') },
            { value: 'orders', label: t('sales.chart.metricOrders') },
          ]}
          data-testid="sales-chart-metric"
        />
      )}
      {!mobile && granularities.length > 1 ? (
        <SegmentedControl<Granularity>
          value={granularity}
          onChange={onGranularityChange}
          aria-label={t('granularity.label')}
          options={granularities.map((g) => ({ value: g, label: t(`granularity.${g}`) }))}
          data-testid="sales-chart-granularity"
        />
      ) : null}
    </Box>
  );

  let body: React.ReactNode;
  if (loading || !series) {
    body = <Bone w="100%" h={height} />;
  } else {
    const categories = series.map((b) => bucketLabel(b.bucketStart, granularity, intlLocale, rangeTo, b.bucketEnd));
    const chartSeries: ChartSeries[] = [
      { name: t('chart.thisPeriod'), data: series.map((b) => b[metric]), role: 'primary' },
    ];
    if (previousSeries && previousSeries.length) {
      chartSeries.push({
        name: hourly ? t('chart.previousDay') : t('chart.previousPeriod', { range: previousLabel }),
        data: alignPrevious(series, previousSeries, metric),
        role: 'comparison',
      });
    }
    body = (
      <Chart
        type={hourly ? 'bar' : 'line'}
        series={chartSeries}
        categories={categories}
        format={metric === 'revenue' ? 'money' : 'number'}
        currency={currency}
        height={height}
        ariaLabel={title}
        directLabel={hourly ? 'max' : 'last'}
        maxSlots={4}
        actions="table"
        data-testid="sales-trend-chart"
      />
    );
  }

  return (
    <Section title={title} headerSlot={controls} data-testid="sales-trend">
      {body}
    </Section>
  );
}

export default SalesTrendChart;

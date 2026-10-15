// Reports › Profit "Net sales and net profit" (finance-analytics §2.2, §4.5): one money axis, two primary series
// (chart slots 1 and 2: accent, teal), ascending zero-filled buckets from the API, negative profit below the zero
// baseline, "⋯ Show as table". Granularity: SegmentedControl on desktop among the valid options; automatic on mobile.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Chart } from '@/components/ds/data/Chart';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { Section } from '@/components/ds/page/Section';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { useFormatters } from '@/lib/format';
import type { Granularity } from '@/lib/reports/dateRange';
import type { FinanceDashboard } from '@/lib/reports/useFinanceReport';

/** Bucket key → chart category: "HH:00" for hour buckets, a noon-UTC Date for day/week (formatted in the seller
 * timezone, never shifted a day), a short month label for month buckets. */
export function bucketCategory(period: string, intlLocale: string): Date | string {
  const hour = /^\d{4}-\d{2}-\d{2}T(\d{2})/.exec(period);
  if (hour) return `${hour[1]}:00`;
  if (/^\d{4}-\d{2}-\d{2}/.test(period)) return new Date(`${period.slice(0, 10)}T12:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(period)) {
    return new Intl.DateTimeFormat(intlLocale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-15T12:00:00Z`));
  }
  return period;
}

export interface ProfitTrendChartProps {
  data: FinanceDashboard;
  granularity: Granularity;
  options: Granularity[];
  onGranularityChange(g: Granularity): void;
  loading?: boolean;
}

export function ProfitTrendChart({ data, granularity, options, onGranularityChange, loading }: ProfitTrendChartProps) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const mobile = useIsMobile();
  const points = data.timeSeries;
  const categories = points.map((p) => bucketCategory(p.period, fmt.intlLocale));
  const series = [
    { name: t('profit.chart.netSales'), data: points.map((p) => p.netSales), role: 'primary' as const },
    { name: t('profit.chart.netProfit'), data: points.map((p) => p.netProfit), role: 'primary' as const },
  ];
  const control = !mobile && options.length > 1 ? (
    <SegmentedControl<Granularity>
      value={granularity}
      onChange={onGranularityChange}
      options={options.map((g) => ({ value: g, label: t(`granularity.${g}`) }))}
      aria-label={t('profit.chart.title')}
      data-testid="profit-granularity"
    />
  ) : undefined;

  return (
    <Section title={t('profit.chart.title')} variant="card" headerSlot={control} data-testid="profit-trend">
      <Box aria-busy={loading || undefined} sx={{ opacity: loading ? 0.6 : 1 }}>
        <Chart
          type="line"
          series={series}
          categories={categories}
          format="money"
          currency={data.summary.currency}
          height={mobile ? 200 : 280}
          ariaLabel={t('profit.chart.title')}
          directLabel="none"
          maxSlots={4}
          actions="table"
        />
      </Box>
    </Section>
  );
}

export default ProfitTrendChart;

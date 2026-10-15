// Chart: ApexCharts wrapper (DESIGN_SYSTEM §4.4; finance-analytics A3, §4.5). Single y-axis, chart palette,
// comparison role, no gradients. ApexCharts touches `window`, so it loads on the client only; the data is
// always also rendered as a visually-hidden table (accessibility, and the "Show as table" source).
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Box, Skeleton } from '@mui/material';
import { useTranslations } from 'next-intl';
import { px, space } from '@/lib/ds/tokens';
import { OverflowMenu } from '@/components/ds/overlay/OverflowMenu';
import { Modal } from '@/components/ds/overlay/Modal';
import { useDsFormat } from './fmt';
import {
  buildChartOptions, formatCategory, formatValue, orderSeries,
  type ChartFormat, type ChartMarker, type ChartSeries, type ChartType,
} from './chartOptions';
import { DataTable } from './DataTable';
import type { Column } from './dataTableParts';
import type { DsBaseProps } from './types';

export type { ChartFormat, ChartMarker, ChartSeries, ChartType, ChartSeriesRole } from './chartOptions';

/** y-axis label width reserved when deriving the plot width for bar sizing. */
const Y_AXIS_PX = 56;

export type ChartProps = DsBaseProps & {
  type: ChartType;
  series: ChartSeries[];
  categories?: Array<string | number | Date>;
  format: ChartFormat;
  currency?: string;
  height?: number;
  /** Accessible name, e.g. "Orders, last 14 days". */
  ariaLabel: string;
  directLabel?: 'last' | 'max' | 'none';
  /** Limit categorical slots (Reports: 4). */
  maxSlots?: number;
  /** Max x ticks; defaults to 8 (4 below 600px wide). */
  maxTicks?: number;
  /** `'table'`: a ⋯ menu with "Show as table" that opens a Modal md with a DataTable of the data
   *  (category, one column per series; finance §4.5 Table view). */
  actions?: 'table';
  /** x-axis event markers (research rank history "send markers"). */
  markers?: ChartMarker[];
};

type ChartTableRow = ReturnType<typeof getChartTable>[number];

/** Rows for a "Show as table" DataTable: one per category, one value column per series. */
export function getChartTable(series: ChartSeries[], categories: Array<string | number | Date> = []) {
  const ordered = orderSeries(series);
  const len = Math.max(categories.length, ...ordered.map((s) => s.data.length), 0);
  return Array.from({ length: len }, (_, i) => ({
    id: String(i),
    category: categories[i],
    values: ordered.map((s) => s.data[i] ?? null),
  }));
}

type ApexComponent = ComponentType<{
  type: string; series: unknown; options: unknown; height: number | string; width?: number | string;
}>;

export function Chart({
  type, series, categories, format, currency, height = 240, ariaLabel, directLabel, maxSlots, maxTicks, actions,
  markers, className, 'data-testid': testId,
}: ChartProps) {
  const t = useTranslations('ds.chart');
  const fmt = useDsFormat();
  const [Apex, setApex] = useState<ApexComponent | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    import('react-apexcharts')
      .then((m) => { if (alive) setApex(() => (m.default as unknown as ApexComponent)); })
      .catch(() => { /* chart lib failed to load: the hidden table still carries the data */ });
    if (typeof window !== 'undefined') setNarrow(window.innerWidth < 600);
    return () => { alive = false; };
  }, []);

  const built = useMemo(
    () => buildChartOptions(
      {
        type, series, categories, format, currency, maxSlots, directLabel,
        maxTicks: maxTicks ?? (narrow ? 4 : 8), comparisonName: t('previousPeriod'), markers,
        plotWidth: width !== null ? Math.max(1, width - Y_AXIS_PX) : undefined,
      },
      fmt,
    ),
    [type, series, categories, format, currency, maxSlots, directLabel, maxTicks, narrow, t, fmt, markers, width],
  );

  const ordered = orderSeries(series).map((s) => (s.role === 'comparison' && !s.name ? { ...s, name: t('previousPeriod') } : s));
  const rows = getChartTable(series, categories);
  const srOnly = {
    position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
  } as const;

  const tableColumns: Column<ChartTableRow>[] = [
    { key: 'category', header: t('category'), mobile: 'title', render: (r) => formatCategory(r.category, fmt) },
    ...ordered.map((s, i): Column<ChartTableRow> => ({
      key: `s${i}`,
      header: s.name,
      align: 'right',
      mobile: i === ordered.length - 1 ? 'trailing' : 'meta',
      render: (r) => formatValue(r.values[i], format, fmt, currency),
    })),
  ];

  return (
    <Box ref={root} className={className} data-testid={testId} sx={{ position: 'relative', width: '100%', minHeight: px(height) }}>
      {actions === 'table' && (
        <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}>
          <OverflowMenu
            items={[{ id: 'show-table', label: t('showAsTable'), onClick: () => setTableOpen(true) }]}
            label={t('chartActions', { name: ariaLabel })}
          />
        </Box>
      )}
      {actions === 'table' && (
        <Modal
          open={tableOpen}
          onClose={() => setTableOpen(false)}
          title={ariaLabel}
          size="md"
          primary={{ id: 'close', label: t('close'), onClick: () => setTableOpen(false) }}
          secondary={null}
        >
          <Box sx={{ pt: px(space[1]) }}>
            <DataTable<ChartTableRow>
              rows={rows}
              columns={tableColumns}
              getRowId={(r) => r.id}
              state={rows.length ? 'ready' : 'empty'}
              columnStateKey="ds.chart.table"
              ariaLabel={ariaLabel}
              stickyHeader
              maxHeight={px(400)}
              density="compact"
            />
          </Box>
        </Modal>
      )}
      <Box role="img" aria-label={ariaLabel} sx={{ width: '100%' }}>
        {Apex ? (
          <Apex type={type === 'bar' ? 'bar' : type === 'donut' ? 'donut' : 'line'} series={built.series} options={built.options} height={height} width="100%" />
        ) : (
          <Skeleton variant="rectangular" height={height} sx={{ borderRadius: px(6) }} aria-hidden />
        )}
      </Box>
      <Box component="table" sx={srOnly}>
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{t('category')}</th>
            {ordered.map((s) => <th key={s.name} scope="col">{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">{formatCategory(r.category, fmt)}</th>
              {r.values.map((v, i) => <td key={i}>{formatValue(v, format, fmt, currency)}</td>)}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

export default Chart;

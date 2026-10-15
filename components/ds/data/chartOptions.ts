// Pure ApexCharts option builder for ds/data/Chart (DESIGN_SYSTEM §2.1 chart palette, finance-analytics §4.5).
// Kept separate from the component so the dataviz rules are unit-testable without a DOM.
import { chart as palette, neutral as n, font } from '@/lib/ds/tokens';
import type { DsFormat } from './fmt';

export type ChartType = 'line' | 'bar' | 'donut';
export type ChartFormat = 'money' | 'number' | 'percent';
export type ChartSeriesRole = 'primary' | 'comparison';

export type ChartSeries = {
  name: string;
  data: Array<number | null>;
  /** `comparison` = previous period: 2px neutral-400 line, never filled (finance A3). */
  role?: ChartSeriesRole;
};

export type ChartBuildInput = {
  type: ChartType;
  series: ChartSeries[];
  categories?: Array<string | number | Date>;
  format: ChartFormat;
  currency?: string;
  /** Categorical slots used for primary series (Reports uses 4: slots 1–4 pass the CVD check). */
  maxSlots?: number;
  /** Max x-axis ticks (8 desktop, 4 mobile). */
  maxTicks?: number;
  /** Direct label on the latest point (line) or the tallest bar. */
  directLabel?: 'last' | 'max' | 'none';
  comparisonName: string;
  /** Measured plot width in px; bar width = min(24px, 60 % of a category slot). Default 600. */
  plotWidth?: number;
  /** x-axis event markers (e.g. research rank history "sent" events), drawn as neutral-400 lines. */
  markers?: ChartMarker[];
};

export type ChartMarker = {
  /** A category value (same type as `categories`: Date, string or number). */
  at: string | number | Date;
  /** Already-translated label, e.g. "Sent title v3". */
  label: string;
};

export const BAR_MAX_PX = 24;

/** finance §4.5: bars ≤ 24px, otherwise 60 % of the slot. Returned as an Apex px width. */
export function barColumnWidth(plotWidth: number, count: number): string {
  const slot = plotWidth / Math.max(1, count);
  return `${Math.max(2, Math.floor(Math.min(BAR_MAX_PX, slot * 0.6)))}px`;
}

/** Relative change from the comparison value; null when the comparison is missing or 0 (no delta then). */
export function comparisonDelta(value: number | null | undefined, previous: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
  return (value - previous) / Math.abs(previous);
}

export function formatValue(v: number | null | undefined, format: ChartFormat, fmt: DsFormat, currency = 'USD', compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (format === 'money') return fmt.money(v, currency, { compact });
  if (format === 'percent') return fmt.percent(v);
  return fmt.num(v, { compact });
}

export function formatCategory(c: string | number | Date | undefined, fmt: DsFormat): string {
  if (c === undefined || c === null) return '';
  if (c instanceof Date) return fmt.date(c);
  return String(c);
}

/** Colors per series in order: primary series take palette slots, comparison series are neutral-400. */
export function seriesColors(series: ChartSeries[], maxSlots: number = palette.length): string[] {
  let slot = 0;
  return series.map((s) => {
    if (s.role === 'comparison') return n[400];
    const c = palette[Math.min(slot, Math.max(1, maxSlots) - 1)];
    slot += 1;
    return c;
  });
}

/** Comparison series are drawn first (under the primary). Returns the reordered list. */
export function orderSeries(series: ChartSeries[]): ChartSeries[] {
  return [...series.filter((s) => s.role === 'comparison'), ...series.filter((s) => s.role !== 'comparison')];
}

export function buildChartOptions(input: ChartBuildInput, fmt: DsFormat) {
  const { type, format, currency, categories = [], maxTicks = 8, directLabel = 'none' } = input;
  const ordered = orderSeries(input.series).map((s) =>
    s.role === 'comparison' && !s.name ? { ...s, name: input.comparisonName } : s,
  );
  const colors = seriesColors(ordered, input.maxSlots);
  const cats = categories.map((c) => formatCategory(c, fmt));
  const fmtAxis = (v: number) => formatValue(v, format, fmt, currency, true);
  const fmtFull = (v: number) => formatValue(v, format, fmt, currency, false);
  const axisLabelStyle = { colors: n[500], fontSize: '12px', fontFamily: font.sans };
  const primaryIdx = ordered.findIndex((s) => s.role !== 'comparison');
  const comparison = ordered.find((s) => s.role === 'comparison');
  // Shared tooltip: a primary value also shows its delta against the comparison series (finance §4.5 Hover).
  const tooltipY = (v: number, ctx?: { seriesIndex?: number; dataPointIndex?: number }) => {
    const base = fmtFull(v);
    const si = ctx?.seriesIndex ?? -1;
    const di = ctx?.dataPointIndex ?? -1;
    if (!comparison || si < 0 || di < 0 || ordered[si]?.role === 'comparison') return base;
    const d = comparisonDelta(v, comparison.data[di]);
    const text = d === null ? null : fmt.delta(d, 'up')?.text ?? null;
    return text ? `${base} · ${text}` : base;
  };

  if (type === 'donut') {
    const first = ordered[0];
    return {
      series: (first?.data ?? []).map((v) => v ?? 0),
      options: {
        chart: { type: 'donut' as const, fontFamily: font.sans, toolbar: { show: false }, animations: { enabled: false } },
        labels: cats,
        colors: palette.slice(0, Math.max(1, input.maxSlots ?? palette.length)),
        legend: { show: true, position: 'bottom' as const, labels: { colors: n[600] } },
        dataLabels: { enabled: false },
        stroke: { width: 1, colors: [n[0]] },
        fill: { type: 'solid' },
        tooltip: { theme: 'dark', y: { formatter: fmtFull } },
      },
    };
  }

  // ApexCharts mixed series: primary lines are drawn as area with a 10 % wash; comparison is a plain line.
  const apexSeries = ordered.map((s, i) => ({
    name: s.name,
    data: s.data,
    type: type === 'bar' ? (s.role === 'comparison' ? 'line' : 'column') : i === primaryIdx ? 'area' : 'line',
  }));

  let annotationPoint: { x: string; y: number; label: string } | null = null;
  const primary = ordered[primaryIdx];
  if (primary && directLabel !== 'none') {
    let idx = -1;
    if (directLabel === 'last') {
      for (let i = primary.data.length - 1; i >= 0; i -= 1) if (primary.data[i] !== null) { idx = i; break; }
    } else {
      let best = -Infinity;
      primary.data.forEach((v, i) => { if (v !== null && v > best) { best = v; idx = i; } });
    }
    if (idx >= 0 && primary.data[idx] !== null) {
      annotationPoint = { x: cats[idx] ?? String(idx), y: primary.data[idx] as number, label: fmtAxis(primary.data[idx] as number) };
    }
  }

  return {
    series: apexSeries,
    options: {
      chart: {
        type: (type === 'bar' ? 'bar' : 'line') as 'bar' | 'line',
        fontFamily: font.sans,
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: false },
        parentHeightOffset: 0,
      },
      colors,
      stroke: {
        width: apexSeries.map((s) => (s.type === 'column' ? 0 : 2)),
        curve: 'straight' as const,
        // finance A3: the comparison is a plain (solid) 2px neutral-400 line under the primary.
        dashArray: 0,
      },
      fill: {
        type: 'solid',
        opacity: apexSeries.map((s) => (s.type === 'area' ? 0.1 : 1)),
      },
      plotOptions: {
        bar: {
          columnWidth: barColumnWidth(input.plotWidth ?? 600, Math.max(cats.length, ...ordered.map((s) => s.data.length), 1)),
          borderRadius: 4,
          borderRadiusApplication: 'end' as const,
        },
      },
      dataLabels: { enabled: false },
      markers: { size: 0, hover: { size: 4 } },
      grid: { borderColor: n[100], strokeDashArray: 0, xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
      legend: { show: ordered.length >= 2, position: 'top' as const, horizontalAlign: 'left' as const, labels: { colors: n[600] } },
      xaxis: {
        categories: cats,
        tickAmount: Math.min(maxTicks, Math.max(1, cats.length - 1)),
        labels: { style: axisLabelStyle, rotate: 0, hideOverlappingLabels: true },
        axisBorder: { show: false },
        axisTicks: { show: false },
        crosshairs: { show: true },
        tooltip: { enabled: false },
      },
      // Single y-axis, always (DS §4.4, finance §4.5).
      yaxis: { labels: { style: axisLabelStyle, formatter: fmtAxis }, forceNiceScale: true },
      tooltip: { theme: 'dark', shared: true, intersect: false, y: { formatter: tooltipY } },
      annotations: {
        yaxis: [{ y: 0, borderColor: n[300], strokeDashArray: 0 }],
        xaxis: (input.markers ?? []).map((m) => ({
          x: formatCategory(m.at, fmt),
          borderColor: n[400],
          strokeDashArray: 0,
          label: {
            text: m.label,
            borderWidth: 0,
            orientation: 'horizontal' as const,
            style: { background: n[0], color: n[600], fontSize: '11px' },
          },
        })),
        points: annotationPoint
          ? [{
              x: annotationPoint.x,
              y: annotationPoint.y,
              marker: { size: 3, fillColor: colors[primaryIdx], strokeColor: n[0] },
              label: {
                text: annotationPoint.label,
                borderWidth: 0,
                style: { background: 'transparent', color: n[700], fontSize: '12px', fontWeight: 500 },
              },
            }]
          : [],
      },
      states: { hover: { filter: { type: 'none' } }, active: { filter: { type: 'none' } } },
    },
  };
}

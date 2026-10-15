// components/domain/reports/sales/SalesKpis.tsx — finance-analytics §2.1 KPI row (M9 Group C; dense pass from
// USABILITY_FINDINGS). Revenue · Orders · Average order · Units sold. Neutral tiles; the delta is the only colored
// text, with a short comparison ("önceki 30 güne göre", exact range in the tooltip). Freshness and the store count
// are stated once in the page header meta, never per tile. A previous window with nothing in it renders `—` with
// "No data in the previous period" (B4), never "▲ 0%". Converted money is `≈` with the FX note; compact only at
// ≥ 100,000 (DS §3.12, `Money compact`).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Money } from '@/components/ds/format/Money';
import { Num } from '@/components/ds/format/Num';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { KpiSkeleton } from '@/components/ds/state/Skeletons';
import { px, space } from '@/lib/ds/tokens';
import type { SalesReport } from '@/lib/reports/useSalesReport';
import { ReportKpiTile, type ReportKpiDelta } from '../ReportKpiTile';

export interface SalesKpisProps {
  report: SalesReport | undefined;
  loading: boolean;
  /** Display currency (`Show in`). */
  currency: string;
  /** Money is converted from other currencies (≈). */
  approx: boolean;
  fxNote?: string;
  /** Short comparison, e.g. "vs previous 30 days" (translated). */
  periodLabel: string;
  /** Exact comparison window for the tooltip, e.g. "18 Aug – 16 Sep 2026". */
  periodDetail?: string;
}

/** Pure: tile delta, or undefined when there is no baseline (null) — the caption then carries `—`. */
export function salesDelta(value: number | null | undefined, goodWhen: 'up' | 'down' = 'up'): ReportKpiDelta | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return { value, goodWhen };
}

function NoBaseline({ label }: { label: string }) {
  return (
    <Tooltip title={label}>
      <span data-testid="kpi-no-baseline" aria-label={label}>
        {'—'}
      </span>
    </Tooltip>
  );
}

export function SalesKpis({ report, loading, currency, approx, fxNote, periodLabel, periodDetail }: SalesKpisProps) {
  const t = useTranslations('reports');
  if (loading || !report) return <KpiSkeleton count={4} />;
  const totals = report.totals;
  const excluded = report.fx.excluded.reduce((s, x) => s + x.orders, 0);
  const noBaseline = <NoBaseline label={t('delta.noBaseline')} />;

  const caption = (d: number | null, extra?: string | null) => {
    if (d != null && !extra) return undefined;
    if (d != null) return extra;
    return (
      <Box component="span" sx={{ display: 'inline-flex', gap: px(space[1]), alignItems: 'baseline', minWidth: 0 }}>
        {extra ? <span>{extra}</span> : null}
        {noBaseline}
      </Box>
    );
  };
  const common = { period: periodLabel, periodDetail };

  return (
    <Box
      data-testid="sales-kpis"
      sx={{
        display: 'grid',
        gap: { xs: px(space[2]), md: px(space[3]) },
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
      }}
    >
      <ReportKpiTile
        label={t('sales.kpi.revenue')}
        value={<Money amount={totals.revenue} currency={currency} approx={approx} fxNote={fxNote} compact />}
        delta={salesDelta(totals.revenueDelta)}
        caption={caption(totals.revenueDelta, excluded > 0 ? t('sales.kpi.excludes', { count: excluded }) : null)}
        {...common}
        data-testid="kpi-revenue"
      />
      <ReportKpiTile
        label={t('sales.kpi.orders')}
        value={<Num value={totals.orders} />}
        delta={salesDelta(totals.ordersDelta)}
        caption={caption(totals.ordersDelta)}
        {...common}
        data-testid="kpi-orders"
      />
      <ReportKpiTile
        label={t('sales.kpi.aov')}
        value={<Money amount={totals.aov} currency={currency} approx={approx} fxNote={fxNote} compact />}
        delta={salesDelta(totals.aovDelta)}
        caption={caption(totals.aovDelta)}
        {...common}
        data-testid="kpi-aov"
      />
      <ReportKpiTile
        label={t('sales.kpi.units')}
        value={<Num value={totals.units} />}
        delta={salesDelta(totals.unitsDelta)}
        caption={caption(totals.unitsDelta)}
        {...common}
        data-testid="kpi-units"
      />
    </Box>
  );
}

export default SalesKpis;

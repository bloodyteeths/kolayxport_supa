// components/domain/reports/sales/SalesKpis.tsx — finance-analytics §2.1 KPI row (M9 Group C).
// Revenue · Orders · Average order · Units sold. Neutral tiles (no colored tile); the delta is the only colored
// text. A previous window with nothing in it renders `—` with "No data in the previous period" (B4), never "▲ 0%".
// Converted money is `≈` with the FX note; compact only at ≥ 100,000 (DS §3.12, `Money compact`).
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { KpiTile, type KpiDelta } from '@/components/ds/data/KpiTile';
import { Money } from '@/components/ds/format/Money';
import { Num } from '@/components/ds/format/Num';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { KpiSkeleton } from '@/components/ds/state/Skeletons';
import { px, space } from '@/lib/ds/tokens';
import type { SalesReport } from '@/lib/reports/useSalesReport';

export interface SalesKpisProps {
  report: SalesReport | undefined;
  loading: boolean;
  /** Display currency (`Show in`). */
  currency: string;
  /** Money is converted from other currencies (≈). */
  approx: boolean;
  fxNote?: string;
  /** "vs 1–31 Aug" (translated). */
  periodLabel: string;
}

/** Pure: KpiTile delta, or undefined when there is no baseline (null) — the caption then carries `—`. */
export function salesDelta(value: number | null | undefined, period: string, goodWhen: 'up' | 'down' = 'up'): KpiDelta | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return { value, period, goodWhen };
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

export function SalesKpis({ report, loading, currency, approx, fxNote, periodLabel }: SalesKpisProps) {
  const t = useTranslations('reports');
  if (loading || !report) return <KpiSkeleton count={4} />;
  const totals = report.totals;
  const asOf = new Date(report.generatedAt);
  const source = t('sales.kpi.source', { count: report.storesIncluded.length || report.stores.length });
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

  return (
    <Box
      data-testid="sales-kpis"
      sx={{
        display: 'grid',
        gap: { xs: px(space[2]), md: px(space[4]) },
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
      }}
    >
      <KpiTile
        label={t('sales.kpi.revenue')}
        value={<Money amount={totals.revenue} currency={currency} approx={approx} fxNote={fxNote} compact />}
        delta={salesDelta(totals.revenueDelta, periodLabel)}
        caption={caption(totals.revenueDelta, excluded > 0 ? t('sales.kpi.excludes', { count: excluded }) : null)}
        source={source}
        asOf={asOf}
        data-testid="kpi-revenue"
      />
      <KpiTile
        label={t('sales.kpi.orders')}
        value={<Num value={totals.orders} />}
        delta={salesDelta(totals.ordersDelta, periodLabel)}
        caption={caption(totals.ordersDelta)}
        source={source}
        asOf={asOf}
        data-testid="kpi-orders"
      />
      <KpiTile
        label={t('sales.kpi.aov')}
        value={<Money amount={totals.aov} currency={currency} approx={approx} fxNote={fxNote} compact />}
        delta={salesDelta(totals.aovDelta, periodLabel)}
        caption={caption(totals.aovDelta)}
        source={source}
        asOf={asOf}
        data-testid="kpi-aov"
      />
      <KpiTile
        label={t('sales.kpi.units')}
        value={<Num value={totals.units} />}
        delta={salesDelta(totals.unitsDelta, periodLabel)}
        caption={caption(totals.unitsDelta)}
        source={source}
        asOf={asOf}
        data-testid="kpi-units"
      />
    </Box>
  );
}

export default SalesKpis;

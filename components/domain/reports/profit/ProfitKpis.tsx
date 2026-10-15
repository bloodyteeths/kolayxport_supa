// Reports › Profit KPI row (finance-analytics §2.2): Net sales · Fees and costs · Net profit · Margin. Neutral tiles
// (no colored tile, no margin chip); the delta is the only colored text, Fees and costs is `goodWhen: 'down'`.
// The margin delta is in percentage points, so it is a caption line (KpiDelta only formats relative %).
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { KpiTile, type KpiDelta } from '@/components/ds/data/KpiTile';
import { Money } from '@/components/ds/format/Money';
import { useFormatters } from '@/lib/format';
import { px, space } from '@/lib/ds/tokens';
import { financeKpis, type FinanceDashboard } from '@/lib/reports/useFinanceReport';

export interface ProfitKpisProps {
  data: FinanceDashboard;
  /** Already-translated source, e.g. "Etsy payments ledger". */
  source: string;
  asOf: Date;
  /** "vs 1–31 Aug" (tooltip-style period label for the deltas). */
  period: string;
  loading?: boolean;
}

export function ProfitKpis({ data, source, asOf, period, loading }: ProfitKpisProps) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const k = financeKpis(data.summary, data.previousSummary);
  const c = data.summary.currency;
  const delta = (v: number | null, goodWhen: 'up' | 'down'): KpiDelta | undefined =>
    v === null ? undefined : { value: v, period, goodWhen };
  const missing = data.costCoverage.productsWithoutCost;
  const pts = k.deltas.marginPts;
  const marginCaption = pts === null
    ? t('delta.noBaseline')
    : `${pts > 0 ? '▲' : pts < 0 ? '▼' : ''} ${t('delta.points', { value: fmt.num(Math.abs(pts), { decimals: 1 }) })} ${period}`.trim();

  return (
    <Box
      data-testid="profit-kpis"
      aria-busy={loading || undefined}
      sx={{
        display: 'grid',
        gap: px(space[3]),
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        opacity: loading ? 0.6 : 1,
      }}
    >
      <KpiTile
        label={t('profit.kpi.netSales')}
        value={<Money amount={k.netSales} currency={c} compact />}
        caption={t('profit.kpi.orders', { count: data.summary.orderCount })}
        delta={delta(k.deltas.netSales, 'up')}
        source={source}
        asOf={asOf}
        data-testid="kpi-net-sales"
      />
      <KpiTile
        label={t('profit.kpi.costs')}
        value={<Money amount={k.costs} currency={c} compact />}
        caption={k.costsShare === null ? undefined : t('profit.kpi.costsShare', { value: fmt.percent(k.costsShare) })}
        delta={delta(k.deltas.costs, 'down')}
        source={source}
        asOf={asOf}
        data-testid="kpi-costs"
      />
      <KpiTile
        label={t('profit.kpi.netProfit')}
        value={<Money amount={k.netProfit} currency={c} compact />}
        caption={missing > 0 ? t('profit.kpi.costMissing', { count: missing }) : undefined}
        delta={delta(k.deltas.netProfit, 'up')}
        source={source}
        asOf={asOf}
        valueTone={k.netProfit < 0 ? 'danger' : 'default'}
        data-testid="kpi-net-profit"
      />
      <KpiTile
        label={t('profit.kpi.margin')}
        value={fmt.percent(k.margin)}
        caption={marginCaption}
        source={source}
        asOf={asOf}
        data-testid="kpi-margin"
      />
    </Box>
  );
}

export default ProfitKpis;

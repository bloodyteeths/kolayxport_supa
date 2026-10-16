// Reports › Profit KPI row (finance-analytics §2.2; dense pass from USABILITY_FINDINGS): Net sales · Fees and
// costs · Net profit · Margin. Neutral tiles (no colored tile, no margin chip); the delta is the only colored text,
// Fees and costs is `goodWhen: 'down'`. The margin delta is in percentage points. Freshness and the ledger source
// are in the page header meta once, not repeated on every tile.
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Money } from '@/components/ds/format/Money';
import { useFormatters } from '@/lib/format';
import { px, space } from '@/lib/ds/tokens';
import { financeKpis, type FinanceDashboard } from '@/lib/reports/useFinanceReport';
import { ReportKpiTile, type ReportKpiDelta } from '../ReportKpiTile';

export interface ProfitKpisProps {
  data: FinanceDashboard;
  /** Short comparison, e.g. "vs previous 30 days". */
  period: string;
  /** Exact comparison window (tooltip). */
  periodDetail?: string;
  loading?: boolean;
}

export function ProfitKpis({ data, period, periodDetail, loading }: ProfitKpisProps) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const k = financeKpis(data.summary, data.previousSummary);
  const c = data.summary.currency;
  const delta = (v: number | null, goodWhen: 'up' | 'down'): ReportKpiDelta | null => (v === null ? null : { value: v, goodWhen });
  const missing = data.costCoverage.productsWithoutCost;
  const pts = k.deltas.marginPts;
  const marginDelta = pts === null
    ? null
    : {
        text: `${pts > 0 ? '▲ ' : pts < 0 ? '▼ ' : ''}${t('delta.points', { value: fmt.num(Math.abs(pts), { decimals: 1 }) })}`,
        tone: (pts > 0 ? 'success' : pts < 0 ? 'danger' : 'neutral') as 'success' | 'danger' | 'neutral',
      };
  const common = { period, periodDetail };

  return (
    <Box
      data-testid="profit-kpis"
      aria-busy={loading || undefined}
      sx={{
        display: 'grid',
        gap: { xs: px(space[2]), md: px(space[3]) },
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        opacity: loading ? 0.6 : 1,
      }}
    >
      <ReportKpiTile
        label={t('profit.kpi.netSales')}
        value={<Money amount={k.netSales} currency={c} compact />}
        caption={t('profit.kpi.orders', { count: data.summary.orderCount })}
        delta={delta(k.deltas.netSales, 'up')}
        {...common}
        data-testid="kpi-net-sales"
      />
      <ReportKpiTile
        label={t('profit.kpi.costs')}
        value={<Money amount={k.costs} currency={c} compact />}
        caption={k.costsShare === null ? undefined : t('profit.kpi.costsShare', { value: fmt.percent(k.costsShare) })}
        delta={delta(k.deltas.costs, 'down')}
        {...common}
        data-testid="kpi-costs"
      />
      <ReportKpiTile
        label={t('profit.kpi.netProfit')}
        value={<Money amount={k.netProfit} currency={c} compact />}
        caption={missing > 0 ? t('profit.kpi.costMissing', { count: missing }) : undefined}
        delta={delta(k.deltas.netProfit, 'up')}
        {...common}
        valueTone={k.netProfit < 0 ? 'danger' : 'default'}
        data-testid="kpi-net-profit"
      />
      <ReportKpiTile
        label={t('profit.kpi.margin')}
        value={fmt.percent(k.margin)}
        caption={pts === null ? t('delta.noBaseline') : undefined}
        deltaText={marginDelta}
        {...common}
        data-testid="kpi-margin"
      />
    </Box>
  );
}

export default ProfitKpis;

// components/domain/overview/OrdersChartCard.tsx (overview G6, §3.3) — "Orders, last 14 days": 14 bars, one per
// local day in the seller timezone, single series, single y-axis. Header: total + delta against the previous
// 14 days (no delta when that was 0). Caption names the source and the zone. All zeros: the axis is drawn plus
// "No orders in the last 14 days", never fake bars.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Chart } from '@/components/ds/data';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { Bone } from '@/components/ds/state/Skeletons';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { useFormatters } from '@/lib/format';
import { neutral, tone, px, space } from '@/lib/ds/tokens';
import type { OverviewSummary } from '@/lib/overview/types';

export interface OrdersChartCardProps {
  series: OverviewSummary['series'] | undefined;
  tz: string;
  loading: boolean;
  /** The section failed (`errors` includes `series`) or the whole request failed. */
  failed: boolean;
  errorId?: string;
  onRetry: () => void;
}

/** Pure: a `YYYY-MM-DD` day key as a Date at noon UTC (formats as that calendar day in any zone within ±11 h). */
export function dayKeyToDate(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function OrdersChartCard({ series, tz, loading, failed, errorId, onRetry }: OrdersChartCardProps) {
  const t = useTranslations('overview');
  const fmt = useFormatters();
  const mobile = useIsMobile();
  const height = mobile ? 120 : 160;

  let body: React.ReactNode;
  if (series) {
    const total = series.days.reduce((s, d) => s + d.orders, 0);
    const prev = series.previousTotal;
    const delta = prev > 0 ? fmt.delta((total - prev) / prev, 'up') : null;
    const empty = total === 0;
    body = (
      <>
        <Typography variant="dense" component="p" sx={{ m: 0, color: neutral[700] }} data-testid="overview-chart-total">
          <span className="tnum">{t('chart.total', { count: total })}</span>
          {delta ? (
            <>
              {' · '}
              <Box component="span" className="tnum" sx={{ color: delta.tone === 'neutral' ? neutral[600] : tone[delta.tone].fg, fontWeight: 500 }}>
                {delta.text}
              </Box>{' '}
              {t('chart.vsPrev14')}
            </>
          ) : null}
        </Typography>
        <Box sx={{ position: 'relative', mt: px(space[2]) }}>
          <Chart
            type="bar"
            series={[{ name: t('chart.title'), data: series.days.map((d) => d.orders) }]}
            categories={series.days.map((d) => dayKeyToDate(d.date))}
            format="number"
            height={height}
            ariaLabel={t('chart.title')}
            maxTicks={mobile ? 4 : 7}
          />
          {empty ? (
            <Box
              data-testid="overview-chart-empty"
              sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
            >
              <Typography variant="dense" sx={{ color: neutral[500], bgcolor: neutral[0], px: px(space[2]) }}>
                {t('chart.empty')}
              </Typography>
            </Box>
          ) : null}
        </Box>
        <Typography variant="caption" component="p" sx={{ m: 0, mt: px(space[2]), color: neutral[500] }}>
          {t('chart.source', { tz })}
        </Typography>
      </>
    );
  } else if (failed) {
    body = <ErrorState variant="inline" title={t('chart.loadFailed')} errorId={errorId} onRetry={onRetry} />;
  } else if (loading) {
    body = (
      <Box data-testid="overview-chart-loading" aria-busy>
        <Bone w="40%" h={12} />
        <Box sx={{ mt: px(space[2]) }}>
          <Bone w="100%" h={height} />
        </Box>
      </Box>
    );
  } else {
    body = null;
  }

  return (
    <Section variant="card" title={t('chart.title')} data-testid="overview-chart">
      {body}
    </Section>
  );
}

export default OrdersChartCard;

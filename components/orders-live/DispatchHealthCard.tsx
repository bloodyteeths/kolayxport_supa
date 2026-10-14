import React from 'react';
import useSWR from 'swr';
import { Box, Card, CardContent, Chip, LinearProgress, Skeleton, Typography } from '@mui/material';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import type { DispatchHealth } from '@/lib/orders/dispatch';

async function fetcher(url: string): Promise<DispatchHealth> {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 1000) / 10}%`;
}

/**
 * Dispatch health (Etsy Star Seller criterion 1/3: on-time dispatch with
 * tracking). Mobile-first: stacked metrics, no table.
 */
export default function DispatchHealthCard({ days = 90 }: { days?: number }) {
  const t = useTranslations('orderPipeline');
  const { data, error, isLoading, mutate } = useSWR(`/api/orders/dispatch-health?days=${days}`, fetcher, { revalidateOnFocus: false });

  const onTime = data?.onTimeWithTrackingRate ?? null;
  const tone = onTime === null ? 'primary' : onTime >= 0.95 ? 'success' : onTime >= 0.9 ? 'warning' : 'error';

  return (
    <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <LocalShippingOutlinedIcon fontSize="small" color="primary" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>
            {t('dispatchHealth.title')}
          </Typography>
        </Box>

        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <Box>
            <Skeleton variant="text" width="40%" height={40} />
            <Skeleton variant="rectangular" height={8} sx={{ borderRadius: 1, my: 1 }} />
            <Skeleton variant="text" width="80%" />
          </Box>
        ) : data.shippedCount === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('dispatchHealth.empty', { days: data.windowDays })}
          </Typography>
        ) : (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{pct(onTime)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('dispatchHealth.onTimeWithTracking')}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={onTime === null ? 0 : Math.min(100, onTime * 100)}
              color={tone as any}
              sx={{ height: 8, borderRadius: 4, my: 1.25 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('dispatchHealth.target')}
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5, mb: 1.5 }}>
              <Metric label={t('dispatchHealth.onTime')} value={pct(data.onTimeRate)} />
              <Metric label={t('dispatchHealth.shipped')} value={String(data.shippedCount)} />
              <Metric label={t('dispatchHealth.late')} value={String(data.lateCount)} />
              <Metric label={t('dispatchHealth.avgHandling')} value={data.avgHandlingHours === null ? '—' : t('dispatchHealth.hours', { hours: data.avgHandlingHours })} />
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: data.deliveryDaysByCarrier.length ? 1.5 : 0 }}>
              <Chip size="small" variant="outlined" label={t('dispatchHealth.openNoLabel', { count: data.openByState.no_label })} />
              <Chip
                size="small"
                color={data.openByState.label_not_pushed > 0 ? 'warning' : 'default'}
                variant={data.openByState.label_not_pushed > 0 ? 'filled' : 'outlined'}
                label={t('dispatchHealth.openLabelNotPushed', { count: data.openByState.label_not_pushed })}
              />
            </Box>

            {data.deliveryDaysByCarrier.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                  {t('dispatchHealth.deliveryDays')}
                </Typography>
                {data.deliveryDaysByCarrier.slice(0, 5).map((c) => (
                  <Box key={c.carrier} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.carrier}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {t('dispatchHealth.p50p90', { p50: c.p50, p90: c.p90, n: c.n })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 600, fontSize: 16 }}>{value}</Typography>
    </Box>
  );
}

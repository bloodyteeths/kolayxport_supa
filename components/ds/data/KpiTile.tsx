// KpiTile: neutral KPI (DESIGN_SYSTEM §4.4, P6, finance A2). Label · value (display 28/600) · optional caption
// line · delta (the only colored text) · "as of 10:42 · Etsy + eBay". Never a rainbow tile.
import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { Box, Skeleton, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n, tone as toneTokens, px, radius, space } from '@/lib/ds/tokens';
import { useDsFormat } from './fmt';
import type { DsBaseProps } from './types';

export type KpiDelta = {
  /** Fraction: 0.124 = +12.4 %. Omit the delta entirely when the previous value is 0. */
  value: number;
  /** Already-translated period, e.g. "vs previous 14 days". */
  period: string;
  goodWhen: 'up' | 'down';
};

export type KpiTileProps = DsBaseProps & {
  label: string;
  value: ReactNode;
  /** One line between value and delta (finance A2), e.g. "Excludes product cost for 14 products". */
  caption?: ReactNode;
  delta?: KpiDelta;
  /** Source of the number (P6), already translated, e.g. "Etsy + eBay". */
  source: string;
  asOf: Date;
  href?: string;
  loading?: boolean;
  /** Overview "Overdue > 0": the value turns danger-fg. The only tone besides deltas. */
  valueTone?: 'default' | 'danger';
};

export function deltaTone(delta: KpiDelta): 'success' | 'danger' | 'neutral' {
  if (!delta.value) return 'neutral';
  const up = delta.value > 0;
  return up === (delta.goodWhen === 'up') ? 'success' : 'danger';
}

export function KpiTile({
  label, value, caption, delta, source, asOf, href, loading, valueTone = 'default', className, 'data-testid': testId,
}: KpiTileProps) {
  const t = useTranslations('ds.kpi');
  const fmt = useDsFormat();

  // Day comparison in the seller timezone (the text is formatted there too), never the runtime's local zone.
  const when = fmt.sameDay(new Date(), asOf) ? fmt.time(asOf) : fmt.dateTime(asOf);
  const tone = delta ? deltaTone(delta) : 'neutral';
  const deltaColor = tone === 'neutral' ? n[600] : toneTokens[tone].fg;
  const deltaText = delta ? fmt.delta(delta.value, delta.goodWhen)?.text ?? null : null;

  const body = (
    <Box
      className={className}
      data-testid={testId}
      aria-busy={loading || undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(space[1]),
        p: px(space[4]),
        bgcolor: n[0],
        border: `1px solid ${n[200]}`,
        borderRadius: px(radius.md),
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
        ...(href ? { transition: 'background-color 80ms linear', '&:hover': { bgcolor: n[50] } } : {}),
      }}
    >
      <Typography variant="label" component="span" sx={{ color: n[500] }}>{label}</Typography>
      {loading ? (
        <Skeleton variant="text" width="60%" sx={{ fontSize: px(28) }} />
      ) : (
        <Typography
          variant="display"
          component="span"
          sx={{ color: valueTone === 'danger' ? toneTokens.danger.fg : n[900], fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
        >
          {value}
        </Typography>
      )}
      {caption && !loading && (
        <Typography variant="caption" component="span" sx={{ color: n[500] }}>{caption}</Typography>
      )}
      {delta && !loading && (
        <Typography
          variant="caption"
          component="span"
          data-tone={tone}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]), color: n[500], fontVariantNumeric: 'tabular-nums' }}
        >
          <Box
            component="span"
            aria-label={t(delta.value > 0 ? 'deltaUp' : delta.value < 0 ? 'deltaDown' : 'deltaFlat', { value: fmt.percent(Math.abs(delta.value)) })}
            sx={{ color: deltaColor, fontWeight: 500 }}
          >
            {deltaText}
          </Box>
          {delta.period}
        </Typography>
      )}
      <Typography variant="caption" component="span" suppressHydrationWarning sx={{ color: n[500], mt: 'auto', pt: px(space[1]), display: { xs: 'none', md: 'block' } }}>
        {/* Phones: the page header states freshness once; repeating it on every tile doubled their height. */}
        {t('asOf', { time: when, source })}
      </Typography>
    </Box>
  );

  if (!href) return body;
  return (
    <Box component={NextLink} href={href} sx={{ textDecoration: 'none', color: 'inherit', display: 'block', borderRadius: px(radius.md) }}>
      {body}
    </Box>
  );
}

export default KpiTile;

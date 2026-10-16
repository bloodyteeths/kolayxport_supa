// components/domain/reports/ReportKpiTile.tsx — the dense KPI tile of Home / Profit (USABILITY_FINDINGS: "each KPI
// card repeats a '0:19 itibarıyla · Siparişler · 4 mağaza' footer — state freshness once in the header";
// "comparison text '18 Ağu – 16 Eyl 2026 dönemine göre' wraps badly").
// Label · value · optional caption · one short comparison line ("▲ %24,4 önceki 30 güne göre", the arrow and the
// percent never split; the exact previous range is the tooltip). No per-tile "as of" footer: the page header meta
// carries freshness and source once. Neutral tile, the delta is the only colored text (DS §4.4).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { useFormatters } from '@/lib/format';
import { neutral as n, tone as toneTokens, px, radius, space } from '@/lib/ds/tokens';

export interface ReportKpiDelta {
  /** Fraction: 0.244 = +24.4 %. */
  value: number;
  goodWhen: 'up' | 'down';
}

export interface ReportKpiTileProps {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  /** null/undefined = no comparison (the caption carries "—" when there is no baseline). */
  delta?: ReportKpiDelta | null;
  /** Short comparison text, e.g. "önceki 30 güne göre". */
  period?: string;
  /** Exact comparison window, e.g. "18 Ağu – 16 Eyl 2026" (tooltip). */
  periodDetail?: string;
  /** Delta already formatted (Profit margin in points). Wins over `delta`. */
  deltaText?: { text: string; tone: 'success' | 'danger' | 'neutral' } | null;
  valueTone?: 'default' | 'danger';
  'data-testid'?: string;
}

export function ReportKpiTile({
  label, value, caption, delta, period, periodDetail, deltaText, valueTone = 'default', 'data-testid': testId,
}: ReportKpiTileProps) {
  const t = useTranslations('ds.kpi');
  const fmt = useFormatters();
  const parts = deltaText ?? (delta ? fmt.delta(delta.value, delta.goodWhen) : null);
  const tone = parts?.tone ?? 'neutral';
  const color = tone === 'neutral' ? n[600] : toneTokens[tone].fg;
  const aria = delta
    ? t(delta.value > 0 ? 'deltaUp' : delta.value < 0 ? 'deltaDown' : 'deltaFlat', { value: fmt.percent(Math.abs(delta.value)) })
    : undefined;

  const comparison = parts ? (
    <Typography
      variant="caption"
      component="span"
      data-tone={tone}
      data-testid={testId ? `${testId}-delta` : undefined}
      sx={{ display: 'block', color: n[500], fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
    >
      <Box component="span" aria-label={aria} sx={{ color, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {parts.text}
      </Box>
      {period ? <>{' '}{period}</> : null}
    </Typography>
  ) : null;

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        p: { xs: px(space[3]), md: px(space[4]) },
        bgcolor: n[0],
        border: `1px solid ${n[200]}`,
        borderRadius: px(radius.md),
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Typography variant="label" component="span" noWrap sx={{ color: n[500] }}>{label}</Typography>
      <Typography
        variant="display"
        component="span"
        noWrap
        sx={{
          color: valueTone === 'danger' ? toneTokens.danger.fg : n[900],
          fontVariantNumeric: 'tabular-nums',
          minWidth: 0,
          fontSize: { xs: px(22), md: px(28) },
          lineHeight: { xs: '28px', md: '34px' },
        }}
      >
        {value}
      </Typography>
      {caption ? (
        <Typography variant="caption" component="span" sx={{ color: n[500], minWidth: 0 }}>{caption}</Typography>
      ) : null}
      {comparison && periodDetail ? <Tooltip title={periodDetail}><Box component="span" tabIndex={0} sx={{ minWidth: 0 }}>{comparison}</Box></Tooltip> : comparison}
    </Box>
  );
}

export default ReportKpiTile;

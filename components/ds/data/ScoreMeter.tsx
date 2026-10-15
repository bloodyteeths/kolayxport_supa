// ScoreMeter: the one listing-health representation (DESIGN_SYSTEM §3.10).
// cell  → ▰▰▰▰▱ 78 (5 segments, 40×6, number 13/600 tabular)
// panel → "Listing health  78 / 100  Good  Scored on 9 of 12 checks" + a 10-segment bar
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n, tone as toneTokens, px, radius, space, control } from '@/lib/ds/tokens';
import { BAND_TONE, bandFor, type ScoreBand } from '@/lib/listingScore/types';
import type { DsBaseProps } from './types';

export type ScoreMeterProps = DsBaseProps & {
  score: number | null;
  variant: 'cell' | 'panel';
  checksUsed?: number;
  checksTotal?: number;
  /** Editor: score after the staged edits are sent ("78 → 86 after you send"). */
  afterScore?: number | null;
  onClick?: () => void;
};

export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Filled segments of the 5-segment cell meter: needs work 1–2, fair 3, good 4, great 5. */
export function cellSegments(score: number): number {
  const s = clampScore(score);
  const band = bandFor(s);
  if (band === 'great') return 5;
  if (band === 'good') return 4;
  if (band === 'fair') return 3;
  return s >= 25 ? 2 : 1;
}

/** Filled segments of the 10-segment panel bar (great = full bar). */
export function panelSegments(score: number): number {
  const s = clampScore(score);
  if (bandFor(s) === 'great') return 10;
  return Math.min(9, Math.round(s / 10));
}

function Segments({ count, filled, band, width, height, gap }: {
  count: number; filled: number; band: ScoreBand; width: number; height: number; gap: number;
}) {
  const fill = toneTokens[BAND_TONE[band]].solid;
  const seg = (width - gap * (count - 1)) / count;
  return (
    <Box aria-hidden sx={{ display: 'inline-flex', gap: px(gap), width: px(width), flexShrink: 0 }}>
      {Array.from({ length: count }, (_, i) => (
        <Box
          key={i}
          sx={{ width: px(seg), height: px(height), borderRadius: px(1), bgcolor: i < filled ? fill : n[200] }}
        />
      ))}
    </Box>
  );
}

export function ScoreMeter({
  score, variant, checksUsed, checksTotal, afterScore, onClick, className, 'data-testid': testId,
}: ScoreMeterProps) {
  const t = useTranslations('ds.score');

  if (score === null || score === undefined || Number.isNaN(score)) {
    return (
      <Tooltip title={t('notScored')}>
        <Typography
          component="span"
          variant="dense"
          className={className}
          data-testid={testId}
          aria-label={t('notScored')}
          sx={{ color: n[500], fontVariantNumeric: 'tabular-nums' }}
        >
          {'—'}
        </Typography>
      </Tooltip>
    );
  }

  const s = clampScore(score);
  const band = bandFor(s);
  const bandLabel = t(`band.${band}`);
  const denominator =
    checksUsed !== undefined && checksTotal !== undefined ? t('scoredOn', { used: checksUsed, total: checksTotal }) : null;
  const tip = [t('tooltip', { score: s, band: bandLabel }), denominator].filter(Boolean).join(' · ');

  if (variant === 'cell') {
    const body = (
      <Box
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[2]) }}
        aria-label={tip}
        role="img"
      >
        <Segments count={5} filled={cellSegments(s)} band={band} width={40} height={6} gap={2} />
        <Typography component="span" variant="label" sx={{ fontWeight: 600, color: n[800], fontVariantNumeric: 'tabular-nums' }}>
          {s}
        </Typography>
      </Box>
    );
    return (
      <Tooltip title={tip}>
        {onClick ? (
          <ButtonBase
            onClick={onClick}
            className={className}
            data-testid={testId}
            aria-label={tip}
            sx={{
              borderRadius: px(radius.xs), px: px(space[1]), py: px(space[0.5]), '&:hover': { bgcolor: n[50] },
              '@media (pointer: coarse)': { minHeight: px(control.lg), minWidth: px(control.lg) },
            }}
          >
            {body}
          </ButtonBase>
        ) : (
          <Box component="span" className={className} data-testid={testId} sx={{ display: 'inline-flex' }}>
            {body}
          </Box>
        )}
      </Tooltip>
    );
  }

  const after = typeof afterScore === 'number' && clampScore(afterScore) !== s ? clampScore(afterScore) : null;
  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: px(space[2]) }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: px(space[3]), rowGap: px(space[1]) }}>
        <Typography variant="titleSm" component="span" sx={{ color: n[800] }}>{t('title')}</Typography>
        <Typography variant="titleMd" component="span" sx={{ color: n[900], fontVariantNumeric: 'tabular-nums' }}>
          {t('outOf', { score: s })}
        </Typography>
        <Typography variant="label" component="span" sx={{ color: toneTokens[BAND_TONE[band]].fg }}>{bandLabel}</Typography>
        {after !== null && (
          <Typography variant="caption" component="span" sx={{ color: n[500] }}>
            {t('afterSend', { from: s, to: after })}
          </Typography>
        )}
        {denominator && (
          <Typography variant="caption" component="span" sx={{ color: n[500], ml: { sm: 'auto' } }}>{denominator}</Typography>
        )}
      </Box>
      <Box role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s} aria-label={tip}>
        <Segments count={10} filled={panelSegments(s)} band={band} width={200} height={6} gap={3} />
      </Box>
    </Box>
  );
}

export default ScoreMeter;

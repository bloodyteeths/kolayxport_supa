// Metric: every research number carries its kind (P6, DESIGN_SYSTEM §3.18, research §3.1).
// measured = plain · estimate = "~" prefix + model in the tooltip · signal = no unit (SignalDots) ·
// user = "You entered". A failed guard or a null value renders "—" with the reason in the tooltip.
import type { ReactNode } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n, px, space } from '@/lib/ds/tokens';
import type { MetricGuard, MetricKind } from './types';

export type MetricProps = {
  value: ReactNode | null;
  kind: MetricKind;
  guard?: MetricGuard;
  /** Already-translated extra tooltip text, e.g. the estimate model ("from favorites × 2.4 % conversion"). */
  tooltip?: string;
  /** Typography of the value (default `dense`; `display` for headline numbers). */
  size?: 'dense' | 'titleMd' | 'display';
  className?: string;
  'data-testid'?: string;
};

/** Resolves a guard reason: translated `reason`, else `reasonKey` + params, else undefined. */
export function useGuardReason() {
  const root = useTranslations();
  return (g?: MetricGuard): string | undefined => {
    if (!g) return undefined;
    if (g.reason) return g.reason;
    if (g.reasonKey) return root(g.reasonKey, g.reasonParams ?? {});
    return undefined;
  };
}

export function Metric({ value, kind, guard, tooltip, size = 'dense', className, 'data-testid': testId }: MetricProps) {
  const t = useTranslations('ds.research');
  const reasonOf = useGuardReason();
  const blocked = value === null || value === undefined || (guard !== undefined && !guard.ok);
  const kindLabel = t(`kind.${kind}`);

  if (blocked) {
    const reason = reasonOf(guard) ?? t('noData');
    return (
      <Tooltip title={reason}>
        <Typography
          component="span"
          variant={size}
          className={className}
          data-testid={testId}
          data-kind={kind}
          data-guarded="true"
          aria-label={reason}
          tabIndex={0}
          sx={{ color: n[500], fontVariantNumeric: 'tabular-nums' }}
        >
          {'—'}
        </Typography>
      </Tooltip>
    );
  }

  const tip = [kindLabel, tooltip].filter(Boolean).join(' · ');
  return (
    <Tooltip title={tip}>
      <Box
        component="span"
        className={className}
        data-testid={testId}
        data-kind={kind}
        sx={{ display: 'inline-flex', alignItems: 'baseline', gap: px(space[1]), fontVariantNumeric: 'tabular-nums' }}
      >
        <Typography component="span" variant={size} sx={{ color: n[900] }}>
          {kind === 'estimate' && <span aria-label={kindLabel}>{t('approxPrefix')}</span>}
          {value}
        </Typography>
        {kind === 'user' && (
          <Typography component="span" variant="caption" sx={{ color: n[500] }}>{t('kind.user')}</Typography>
        )}
      </Box>
    </Tooltip>
  );
}

export default Metric;

// EvidenceSummary: replaces any AI "verdict" (DESIGN_SYSTEM §3.18). 2–4 computed facts + a confidence label
// derived from sample size. Facts come from the API as i18n keys + params, never as AI text.
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { neutral as n, tone as toneTokens, px, radius, space } from '@/lib/ds/tokens';
import type { Fact } from './types';

export type EvidenceConfidence = 'high' | 'medium' | 'low';

export type EvidenceSummaryProps = {
  /** 2–4 facts: i18n references (preferred) or already-translated strings. Facts beyond 4 are dropped. */
  facts: Array<Fact | string>;
  confidence: EvidenceConfidence;
  /** What the confidence is based on ("48 listings, no Etsy sales data"). */
  basis: Fact | string;
  className?: string;
  'data-testid'?: string;
};

const CONF_TONE: Record<EvidenceConfidence, 'success' | 'warning' | 'neutral'> = { high: 'success', medium: 'warning', low: 'neutral' };

export function EvidenceSummary({ facts, confidence, basis, className, 'data-testid': testId }: EvidenceSummaryProps) {
  const t = useTranslations('ds.research');
  const root = useTranslations();
  const text = (f: Fact | string) => (typeof f === 'string' ? f : root(f.key, f.params ?? {}));
  const shown = facts.slice(0, 4);
  return (
    <Box
      className={className}
      data-testid={testId}
      data-confidence={confidence}
      sx={{ border: `1px solid ${n[200]}`, borderRadius: px(radius.md), bgcolor: n[0], p: px(space[4]), display: 'flex', flexDirection: 'column', gap: px(space[2]) }}
    >
      <Box component="ul" sx={{ m: 0, pl: px(space[4]), display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
        {shown.map((f, i) => (
          <Typography key={i} component="li" variant="body2" sx={{ color: n[800] }}>{text(f)}</Typography>
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>
        <Box component="span" sx={{ color: toneTokens[CONF_TONE[confidence]].fg, fontWeight: 500 }}>
          {t(`confidence.${confidence}`)}
        </Box>
        {t('basisSuffix', { basis: text(basis) })}
      </Typography>
    </Box>
  );
}

export default EvidenceSummary;

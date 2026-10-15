// components/ds/inputs/FieldSuggestion.tsx — listing-editor §4.3/§4.6: the ONE pattern for showing an AI result
// under a field. [Dismiss] · [Try again] · [Use] (secondary: the page footer keeps the only primary).
// Nothing is written until Use; nothing is ever sent to a marketplace from here.
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Tooltip from '@mui/material/Tooltip';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius, type as typeScale } from '@/lib/ds/tokens';
import { IconAI, IconError, ICON_STROKE } from './_icons';
import { Button } from './Button';
import { CharCount } from './FormField';
import { chipBaseSx } from './_shared';
import type { DsBaseProps } from './types';

export interface FieldSuggestionProps extends DsBaseProps {
  /** The proposed value; an array renders as chips (tags, materials). */
  value: string | string[];
  counter?: { value: number; max: number };
  /** "Based on 48 Etsy listings for 'baby name blanket'". */
  basis?: string;
  /** One-line rationale from the model (follows the UI locale). */
  rationale?: string;
  onUse: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  /** Shows "Writing…" and a skeleton; the field above stays editable. */
  loading?: boolean;
  /** true → the default "The suggestion didn't come out right" line; a string replaces it. */
  error?: boolean | string;
  /** Override the Use label ("Use all", "Use $49"). */
  useLabel?: string;
  /** AI credits spent by Try again (CRITIQUE X6); adds "· 1 credit" to its tooltip. */
  credits?: number;
}

export function FieldSuggestion({
  value, counter, basis, rationale, onUse, onDismiss, onRetry, loading, error, useLabel, credits,
  className, 'data-testid': testId,
}: FieldSuggestionProps) {
  const t = useTranslations('ds.inputs.suggestion');
  const isList = Array.isArray(value);
  const empty = isList ? value.length === 0 : !value;

  return (
    <Box
      role="region"
      aria-label={t('label')}
      aria-busy={loading || undefined}
      className={className}
      data-testid={testId}
      sx={{
        display: 'flex', flexDirection: 'column', gap: '8px', p: '12px', borderRadius: `${radius.md}px`,
        border: `1px solid ${accent[200]}`, backgroundColor: neutral[0],
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', color: accent[700], fontSize: typeScale.label[0], fontWeight: 500 }}>
        <IconAI size={16} strokeWidth={ICON_STROKE} aria-hidden />
        <span>{loading ? t('writing') : t('label')}</span>
        <Box sx={{ flex: 1 }} />
        {counter && !loading && !error ? <CharCount value={counter.value} max={counter.max} /> : null}
      </Box>

      {loading ? (
        <Box aria-hidden>
          <Skeleton variant="text" width="90%" />
          <Skeleton variant="text" width="60%" />
        </Box>
      ) : error ? (
        <Box role="alert" sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: 13, color: tone.danger.fg }}>
          <Box component="span" sx={{ display: 'inline-flex', mt: '1px' }}><IconError size={14} strokeWidth={ICON_STROKE} aria-hidden /></Box>
          <span>{typeof error === 'string' ? error : t('error')}</span>
        </Box>
      ) : isList ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {value.map((v) => <Box key={v} component="span" sx={{ ...chipBaseSx, padding: '0 8px' }}>{v}</Box>)}
        </Box>
      ) : (
        <Box sx={{ fontSize: 14, lineHeight: '20px', color: neutral[800], whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</Box>
      )}

      {!loading && !error && (rationale || basis) ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: 12, lineHeight: '16px', color: neutral[500] }}>
          {rationale ? <span>{rationale}</span> : null}
          {basis ? <span>{basis}</span> : null}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
        <Button variant="ghost" size="sm" onClick={onDismiss}>{t('dismiss')}</Button>
        {(() => {
          const retry = (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              disabled={loading}
              aria-label={credits ? t('retryCost', { count: credits }) : undefined}
            >
              {t('retry')}
            </Button>
          );
          // CRITIQUE X6: every AI button's tooltip ends with "· 1 credit" — visible, not only in the aria-label.
          return credits && !loading
            ? <Tooltip title={t('retryCost', { count: credits })}><span style={{ display: 'inline-flex' }}>{retry}</span></Tooltip>
            : retry;
        })()}
        {!error ? (
          <Button variant="secondary" size="sm" onClick={onUse} disabled={loading || empty} disabledReason={loading ? t('writing') : undefined}>
            {useLabel ?? t('use')}
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

export default FieldSuggestion;

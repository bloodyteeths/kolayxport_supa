// components/ds/format/TermHint.tsx — DS P5 / §4.4. Jargon (ETGB, IOSS, HS code, SKU, GTIN) gets a "(?)"
// tooltip on first use per screen. Text from i18n `ds.terms.<term>`, the term's name from `ds.termNames.<term>`.
// A surface-specific hint (settings plan matrix) passes its own already-translated `label` + `body`.

import { ButtonBase, Tooltip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { focusRing, neutral, zIndex } from '@/lib/ds/tokens';

export const TERM_KEYS = ['etgb', 'ioss', 'hs', 'sku', 'gtin'] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export type TermHintProps =
  | { term: TermKey; label?: never; body?: never; className?: string; 'data-testid'?: string }
  | { term?: never; /** Name of the thing explained (aria-label "What is {label}?"). */ label: string; body: string; className?: string; 'data-testid'?: string };

const HintIcon = icons.hint;

export function TermHint(props: TermHintProps) {
  const t = useTranslations('ds');
  const name = props.term ? t(`termNames.${props.term}`) : props.label;
  const body = props.term ? t(`terms.${props.term}`) : props.body;
  return (
    <Tooltip
      describeChild
      title={body}
      enterTouchDelay={0}
      leaveTouchDelay={4000}
      slotProps={{ popper: { sx: { zIndex: zIndex.tooltip } } }}
    >
      <ButtonBase
        className={props.className}
        data-testid={props['data-testid']}
        aria-label={t('termHint.label', { term: name })}
        onClick={(e) => e.stopPropagation()}
        sx={{
          display: 'inline-flex',
          verticalAlign: 'middle',
          width: 20,
          height: 20,
          borderRadius: '50%',
          color: neutral[400],
          '&:hover': { color: neutral[600] },
          '&.Mui-focusVisible': { boxShadow: focusRing },
          '@media (pointer: coarse)': { width: 44, height: 44 },
        }}
      >
        <HintIcon size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </ButtonBase>
    </Tooltip>
  );
}

export default TermHint;

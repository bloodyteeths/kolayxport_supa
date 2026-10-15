// components/ds/inputs/FormField.tsx — DS §3.7: label above, helper/error below, CharCount in the label row,
// dirty bar + "Changed · Revert" (listing-editor §4.6). Wires id / aria-describedby / aria-invalid into the
// DS control inside it through FieldContext.
import { useId, useMemo, type ReactElement, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, type as typeScale } from '@/lib/ds/tokens';
import { TermHint, type TermKey } from '../format/TermHint';
import { FieldContext, useIntlLocale, fmtInt, focusVisibleSx, hitSlopSx } from './_shared';
import { IconError, ICON_STROKE } from './_icons';
import type { DsBaseProps } from './types';

export type FieldWidth = 'short' | 'medium' | 'long' | 'full';

/** DS §3.7 widths: short 160–240, medium 400, long up to 640 (long text 720 max). */
export const FIELD_WIDTH: Record<FieldWidth, number | string> = {
  short: 240,
  medium: 400,
  long: 640,
  full: '100%',
};

export interface CharCountProps extends DsBaseProps {
  value: number;
  max: number;
  id?: string;
}

/** "112 / 140": neutral, warning at ≥ 90 %, danger above 100 % (DS §3.7). */
export function CharCount({ value, max, id, className, 'data-testid': testId }: CharCountProps) {
  const t = useTranslations('ds.inputs');
  const locale = useIntlLocale();
  const ratio = max > 0 ? value / max : 0;
  const color = ratio > 1 ? tone.danger.fg : ratio >= 0.9 ? tone.warning.fg : neutral[500];
  return (
    <Box
      component="span"
      id={id}
      className={className}
      data-testid={testId}
      data-tone={ratio > 1 ? 'danger' : ratio >= 0.9 ? 'warning' : 'neutral'}
      sx={{ fontSize: typeScale.caption[0], lineHeight: `${typeScale.caption[1]}px`, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {t('charCount', { value: fmtInt(value, locale), max: fmtInt(max, locale) })}
    </Box>
  );
}

export interface FormFieldProps extends DsBaseProps {
  label: string;
  /** id of the control. Defaults to a generated id that the DS control picks up from context. */
  htmlFor?: string;
  optional?: boolean;
  helper?: ReactNode;
  /** An error replaces the helper (DS §3.7). */
  error?: string | null;
  counter?: { value: number; max: number };
  /** DS §4.6: a TermKey ("hs") renders `<TermHint term="hs" />` after the label; an element (e.g. a TermHint with
   *  its own label/body) renders as-is. */
  hint?: TermKey | ReactElement;
  /** Right side of the label row, before the counter (e.g. a ghost "Suggest a title" button). */
  labelAction?: ReactNode;
  width?: FieldWidth;
  /** listing-editor §4.6: 2px attention bar + caption "Changed · Revert". */
  dirty?: boolean;
  onRevert?: () => void;
  /** Visually hide the label (it stays for screen readers). */
  hideLabel?: boolean;
  required?: boolean;
  children: ReactNode;
}

const srOnly = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
} as const;

export function FormField({
  label, htmlFor, optional, helper, error, counter, hint, labelAction, width = 'full', dirty, onRevert,
  hideLabel, required, children, className, 'data-testid': testId,
}: FormFieldProps) {
  const t = useTranslations('ds.inputs');
  const autoId = useId();
  const id = htmlFor ?? `f${autoId.replace(/:/g, '')}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const hasError = Boolean(error);
  const describedBy = [hasError ? errorId : helper ? helperId : null, counter ? counterId : null].filter(Boolean).join(' ') || undefined;
  const labelId = `${id}-label`;
  const ctx = useMemo(() => ({ id, labelId, describedBy, invalid: hasError, required }), [id, labelId, describedBy, hasError, required]);

  return (
    <Box
      className={className}
      data-testid={testId}
      data-dirty={dirty ? 'true' : undefined}
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: FIELD_WIDTH[width],
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        ...(dirty
          ? { '&::before': { content: '""', position: 'absolute', left: -12, top: 0, bottom: 0, width: 2, borderRadius: 1, backgroundColor: tone.attention.solid } }
          : null),
      }}
    >
      <Box sx={hideLabel ? srOnly : { display: 'flex', alignItems: 'center', gap: '8px', minHeight: 18 }}>
        <Box
          component="label"
          id={labelId}
          htmlFor={id}
          sx={{ fontSize: typeScale.label[0], lineHeight: `${typeScale.label[1]}px`, fontWeight: typeScale.label[2], color: neutral[800] }}
        >
          {label}
          {optional ? (
            <Box component="span" sx={{ color: neutral[500], fontWeight: 400, ml: '4px' }}>
              {t('formField.optional')}
            </Box>
          ) : null}
        </Box>
        {hint ? <Box component="span" sx={{ display: 'inline-flex' }}>{typeof hint === 'string' ? <TermHint term={hint} /> : hint}</Box> : null}
        <Box sx={{ flex: 1 }} />
        {labelAction}
        {counter ? <CharCount id={counterId} value={counter.value} max={counter.max} /> : null}
      </Box>

      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>

      {hasError ? (
        <Box
          id={errorId}
          role="alert"
          sx={{ display: 'flex', alignItems: 'flex-start', gap: '4px', fontSize: 12, lineHeight: '16px', color: tone.danger.fg }}
        >
          <Box component="span" sx={{ display: 'inline-flex', mt: '1px', flexShrink: 0 }}>
            <IconError size={14} strokeWidth={ICON_STROKE} aria-hidden />
          </Box>
          {error}
        </Box>
      ) : helper ? (
        <Box id={helperId} sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>
          {helper}
        </Box>
      ) : null}

      {dirty ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12, lineHeight: '16px', color: tone.attention.fg }}>
          <span>{t('formField.changed')}</span>
          {onRevert ? (
            <>
              <span aria-hidden>{'·'}</span>
              <ButtonBase
                onClick={onRevert}
                aria-label={t('formField.revertLabel', { label })}
                sx={{ fontSize: 12, lineHeight: '16px', fontWeight: 500, color: accent[600], borderRadius: '4px', px: '2px', ...hitSlopSx, ...focusVisibleSx, '&:hover': { textDecoration: 'underline' } }}
              >
                {t('formField.revert')}
              </ButtonBase>
            </>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export default FormField;

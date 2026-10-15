// components/ds/inputs/TextField.tsx — DS §3.7 / §4.6: label-less text input that lives inside FormField.
// Labels are never floating here (no InputLabel, notched outline off). Units go in prefix/suffix adornments.
import { forwardRef, type ChangeEvent, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import { font } from '@/lib/ds/tokens';
import { outlinedInputSx, useFieldContext } from './_shared';
import type { DsBaseProps, FieldSize } from './types';

export interface TextFieldProps extends DsBaseProps {
  value: string;
  onChange: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  /** Leading adornment, e.g. "₺" or a 16px icon. */
  prefix?: ReactNode;
  /** Trailing adornment, e.g. "kg" or ".myshopify.com". */
  suffix?: ReactNode;
  /** Interactive trailing slot (an IconButton), rendered after `suffix`. */
  endAction?: ReactNode;
  size?: FieldSize;
  invalid?: boolean;
  type?: 'text' | 'email' | 'password' | 'url' | 'tel' | 'search';
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'url' | 'search' | 'none';
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  maxLength?: number;
  /** Monospace (order numbers, SKUs, tracking, IDs; DS §2.2). */
  mono?: boolean;
  /** Tabular numerals (numbers, money). */
  numeric?: boolean;
  /** Defaults to true: the field fills its FormField width. */
  fullWidth?: boolean;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** Required when the field is not inside a FormField. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-autocomplete'?: 'list' | 'none' | 'inline' | 'both';
}

export const TextField = forwardRef<HTMLDivElement, TextFieldProps>(function TextField(
  {
    value, onChange, id, name, placeholder, prefix, suffix, endAction, size = 'md', invalid, type = 'text', inputMode,
    disabled, readOnly, autoFocus, autoComplete, maxLength, mono, numeric, fullWidth = true, onBlur, onFocus, onKeyDown,
    inputRef, className, 'data-testid': testId, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy,
    'aria-autocomplete': ariaAutocomplete,
  },
  ref,
) {
  const field = useFieldContext();
  const isInvalid = Boolean(invalid ?? field?.invalid);
  const describedBy = [field?.describedBy, ariaDescribedBy].filter(Boolean).join(' ') || undefined;
  return (
    <OutlinedInput
      ref={ref}
      id={id ?? field?.id}
      name={name}
      className={className}
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value, e as ChangeEvent<HTMLInputElement>)}
      placeholder={placeholder}
      type={type}
      notched={false}
      error={isInvalid}
      disabled={disabled}
      readOnly={readOnly}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      fullWidth={fullWidth}
      size="small"
      onBlur={onBlur as never}
      onFocus={onFocus as never}
      onKeyDown={onKeyDown as never}
      inputRef={inputRef}
      inputProps={{
        inputMode,
        maxLength,
        'aria-label': ariaLabel,
        'aria-invalid': isInvalid || undefined,
        'aria-describedby': describedBy,
        'aria-required': field?.required || undefined,
        'aria-autocomplete': ariaAutocomplete,
      }}
      startAdornment={prefix != null ? <InputAdornment position="start">{prefix}</InputAdornment> : undefined}
      endAdornment={
        suffix != null || endAction ? (
          <InputAdornment position="end" sx={{ gap: '4px', mr: endAction ? '-6px' : 0 }}>
            {suffix}
            {endAction}
          </InputAdornment>
        ) : undefined
      }
      sx={{ ...outlinedInputSx(size), ...(mono ? { fontFamily: font.mono } : null), ...(numeric ? { fontVariantNumeric: 'tabular-nums' } : null) }}
    />
  );
});

export default TextField;

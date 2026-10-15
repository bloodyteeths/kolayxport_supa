// components/ds/inputs/NumberField.tsx — DS §4.6: `value: number | null`, locale-aware parse ("1.109,30" and
// "1,109.30" both work), formatted on blur, ArrowUp/ArrowDown step. Units go in the suffix adornment.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { TextField } from './TextField';
import { useIntlLocale } from './_shared';
import { parseLocaleNumber, formatLocaleNumber, roundTo } from './_number';
import type { DsBaseProps, FieldSize } from './types';

export interface NumberFieldProps extends DsBaseProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Max fraction digits kept (default 0 = integers). */
  decimals?: number;
  /** Always show this many fraction digits when formatted (MoneyField: the currency's digits). */
  fixedDecimals?: boolean;
  /** Suffix unit, e.g. "kg", "%", "days". */
  unit?: ReactNode;
  prefix?: ReactNode;
  id?: string;
  name?: string;
  placeholder?: string;
  size?: FieldSize;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Clamp to min/max on blur (default false: out-of-range values stay and are marked invalid). */
  clampOnBlur?: boolean;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  'aria-label'?: string;
}

export function NumberField({
  value, onChange, min, max, step = 1, decimals = 0, fixedDecimals, unit, prefix, id, name, placeholder, size = 'md',
  invalid, disabled, readOnly, autoFocus, clampOnBlur, onBlur, inputRef, className, 'data-testid': testId,
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  const locale = useIntlLocale();
  const fmt = (n: number | null) =>
    n == null ? '' : formatLocaleNumber(n, locale, { minDecimals: fixedDecimals ? decimals : 0, maxDecimals: decimals });
  const [text, setText] = useState(() => fmt(value));
  const [badInput, setBadInput] = useState(false);
  const focused = useRef(false);

  // Follow outside changes while the user is not typing.
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value, locale, decimals, fixedDecimals]);

  const outOfRange = value != null && ((min != null && value < min) || (max != null && value > max));

  const commitText = (raw: string) => {
    setText(raw);
    const n = parseLocaleNumber(raw, locale);
    if (n === null) { setBadInput(false); onChange(null); return; }
    if (Number.isNaN(n)) { setBadInput(true); return; }
    setBadInput(false);
    onChange(roundTo(n, decimals));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (readOnly || disabled || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const base = value ?? min ?? 0;
    let next = roundTo(base + (e.key === 'ArrowUp' ? step : -step), decimals);
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange(next);
    setText(formatLocaleNumber(next, locale, { maxDecimals: decimals, grouping: false }));
  };

  return (
    <TextField
      id={id}
      name={name}
      value={text}
      onChange={(v) => commitText(v)}
      onFocus={() => {
        focused.current = true;
        // Edit without grouping separators so the caret math stays simple.
        if (value != null) setText(formatLocaleNumber(value, locale, { maxDecimals: decimals, grouping: false }));
      }}
      onBlur={() => {
        focused.current = false;
        let v = value;
        if (clampOnBlur && v != null) {
          if (min != null && v < min) v = min;
          if (max != null && v > max) v = max;
          if (v !== value) onChange(v);
        }
        if (!badInput) setText(fmt(v));
        onBlur?.();
      }}
      onKeyDown={onKeyDown}
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      placeholder={placeholder}
      prefix={prefix}
      suffix={unit}
      size={size}
      invalid={invalid || badInput || outOfRange ? true : undefined}
      disabled={disabled}
      readOnly={readOnly}
      autoFocus={autoFocus}
      inputRef={inputRef}
      className={className}
      data-testid={testId}
      aria-label={ariaLabel}
      numeric
    />
  );
}

export default NumberField;

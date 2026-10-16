// components/ds/inputs/CurrencySelect.tsx — DS §3.7: currency is always a picker ("₺ TRY · Turkish lira").
// The seller's base currency is pinned first (TRY for TR sellers). `currencies` limits the list (eBay: USD/GBP/EUR/TRY).
import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from './Combobox';
import { useIntlLocale } from './_shared';
import { COMMON_CURRENCIES, currencyName } from './_countries';
import { currencySymbol } from './_number';
import type { DsBaseProps, FieldSize } from './types';

export interface CurrencySelectProps extends DsBaseProps {
  /** ISO 4217. */
  value: string | null;
  onChange: (code: string | null) => void;
  /** Pinned first. Default: TRY in the TR UI, USD otherwise. */
  defaultCurrency?: string;
  currencies?: string[];
  placeholder?: string;
  size?: FieldSize;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Hide the ✕ (the field always holds a currency). Default false. */
  disableClearable?: boolean;
  'aria-label'?: string;
}

export function CurrencySelect({
  value, onChange, defaultCurrency, currencies, placeholder, size = 'md', id, invalid, disabled, disableClearable, className,
  'data-testid': testId, 'aria-label': ariaLabel,
}: CurrencySelectProps) {
  const locale = useIntlLocale();
  const pinned = defaultCurrency ?? (locale.startsWith('tr') ? 'TRY' : 'USD');
  const listKey = (currencies ?? []).join(',');
  const options: ComboboxOption[] = useMemo(() => {
    const list = currencies?.length ? currencies : COMMON_CURRENCIES;
    const ordered = list.includes(pinned) ? [pinned, ...list.filter((c) => c !== pinned)] : list;
    return ordered.map((code) => {
      const sym = currencySymbol(code, locale);
      return { value: code, label: sym && sym !== code ? `${sym} ${code}` : code, description: currencyName(code, locale) };
    });
  }, [locale, pinned, listKey]);
  const selected = value ? options.find((o) => o.value === value) ?? { value, label: value } : null;
  return (
    <Combobox
      value={selected}
      onChange={(o) => onChange(o ? o.value : null)}
      options={options}
      placeholder={placeholder}
      size={size}
      id={id}
      invalid={invalid}
      disabled={disabled}
      disableClearable={disableClearable}
      className={className}
      data-testid={testId}
      aria-label={ariaLabel}
    />
  );
}

export default CurrencySelect;

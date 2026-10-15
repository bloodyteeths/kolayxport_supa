// components/ds/inputs/CountrySelect.tsx — DS §3.7: country is always a picker (flag + localized name + ISO),
// never free text. Names come from Intl.DisplayNames in the UI locale, sorted with the locale collator.
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { neutral } from '@/lib/ds/tokens';
import { Combobox, type ComboboxOption } from './Combobox';
import { useIntlLocale } from './_shared';
import { COUNTRY_CODES, countryName, flagEmoji } from './_countries';
import type { DsBaseProps, FieldSize } from './types';

export interface CountrySelectProps extends DsBaseProps {
  /** ISO 3166-1 alpha-2, e.g. "TR". */
  value: string | null;
  onChange: (code: string | null) => void;
  /** Pinned first in the list (seller base country). Default 'TR'. */
  defaultCountry?: string;
  /** Extra pinned codes after the default (e.g. the most common destinations). */
  priority?: string[];
  /** Restrict to these codes (e.g. a carrier's service area). */
  countries?: string[];
  placeholder?: string;
  size?: FieldSize;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

export function useCountryOptions(locale: string, opts: { pinned?: string[]; only?: string[] } = {}): ComboboxOption[] {
  const pinnedKey = (opts.pinned ?? []).join(',');
  const onlyKey = (opts.only ?? []).join(',');
  return useMemo(() => {
    const codes = opts.only?.length ? opts.only : COUNTRY_CODES;
    const collator = new Intl.Collator(locale);
    const all = codes.map((code) => ({
      value: code,
      label: `${countryName(code, locale)} (${code})`,
      leading: <Box component="span" aria-hidden sx={{ fontSize: 16, lineHeight: 1, width: 20, color: neutral[800] }}>{flagEmoji(code)}</Box>,
    }));
    all.sort((a, b) => collator.compare(a.label, b.label));
    const pinned = (opts.pinned ?? []).filter((c, i, arr) => c && arr.indexOf(c) === i && codes.includes(c));
    const head = pinned.map((c) => all.find((o) => o.value === c)).filter(Boolean) as ComboboxOption[];
    return [...head, ...all.filter((o) => !pinned.includes(o.value))];
  }, [locale, pinnedKey, onlyKey]);
}

export function CountrySelect({
  value, onChange, defaultCountry = 'TR', priority, countries, placeholder, size = 'md', id, invalid, disabled,
  className, 'data-testid': testId, 'aria-label': ariaLabel,
}: CountrySelectProps) {
  const locale = useIntlLocale();
  const options = useCountryOptions(locale, { pinned: [defaultCountry, ...(priority ?? [])], only: countries });
  const selected = value ? options.find((o) => o.value === value) ?? null : null;
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
      className={className}
      data-testid={testId}
      aria-label={ariaLabel}
    />
  );
}

export default CountrySelect;

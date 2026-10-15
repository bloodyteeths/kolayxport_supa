// components/ds/inputs/PhoneInput.tsx — DS §3.7 / orders §5 / settings: [🇹🇷 +90 ▾][532 000 00 00].
// `value` is E.164 ("+905320000000", '' when empty). Prefill from the order's phone; the country comes from the
// number's calling code, else `defaultCountry`. A national trunk "0" ("0532…") is dropped.
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Combobox, type ComboboxOption } from './Combobox';
import { TextField } from './TextField';
import { useFieldContext, useIntlLocale } from './_shared';
import { COUNTRY_CODES, COUNTRY_DIAL, countryFromE164, countryName, flagEmoji } from './_countries';
import type { DsBaseProps, FieldSize } from './types';

export interface PhoneInputProps extends DsBaseProps {
  /** E.164, or '' for empty. */
  value: string;
  onChange: (e164: string) => void;
  defaultCountry?: string;
  placeholder?: string;
  size?: FieldSize;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/** Pure: country + national input → E.164 ('' when there are no digits). */
export function toE164(country: string, national: string): string {
  let digits = national.replace(/[^\d]/g, '');
  if (!digits) return '';
  const dial = COUNTRY_DIAL[country] ?? '';
  if (national.trim().startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) digits = digits.slice(1);
  return `+${dial}${digits}`;
}

/** Pure: E.164 → { country, national digits }. */
export function fromE164(e164: string, fallbackCountry: string): { country: string; national: string } {
  const country = countryFromE164(e164, fallbackCountry) ?? fallbackCountry;
  const digits = e164.replace(/[^\d]/g, '');
  const dial = COUNTRY_DIAL[country] ?? '';
  return { country, national: e164.trim().startsWith('+') && digits.startsWith(dial) ? digits.slice(dial.length) : digits };
}

export function PhoneInput({
  value, onChange, defaultCountry = 'TR', placeholder, size = 'md', id, invalid, disabled, className,
  'data-testid': testId,
}: PhoneInputProps) {
  const t = useTranslations('ds.inputs.phone');
  const locale = useIntlLocale();
  const field = useFieldContext();
  const initial = fromE164(value, defaultCountry);
  const [country, setCountry] = useState(initial.country);
  const [national, setNational] = useState(initial.national);

  // Follow outside changes (prefill from an order) when they differ from what we would emit.
  useEffect(() => {
    if (value !== toE164(country, national)) {
      const next = fromE164(value, country || defaultCountry);
      setCountry(next.country);
      setNational(next.national);
    }
  }, [value]);

  const options: ComboboxOption[] = useMemo(() => {
    const collator = new Intl.Collator(locale);
    const all = COUNTRY_CODES.map((code) => ({
      value: code,
      label: `${flagEmoji(code)} +${COUNTRY_DIAL[code]}`,
      description: countryName(code, locale),
    }));
    all.sort((a, b) => collator.compare(a.description, b.description));
    const head = all.filter((o) => o.value === defaultCountry);
    return [...head, ...all.filter((o) => o.value !== defaultCountry)];
  }, [locale, defaultCountry]);

  const selected = options.find((o) => o.value === country) ?? null;
  const numberId = id ?? field?.id;

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', gap: '8px', width: '100%' }}>
      <Box sx={{ width: 128, flexShrink: 0 }}>
        <Combobox
          value={selected}
          onChange={(o) => {
            if (!o) return;
            // A raw "+…" number carries its own calling code: drop it so the picked country applies.
            const nat = national.trim().startsWith('+') ? fromE164(toE164(country, national), country).national : national;
            setCountry(o.value);
            setNational(nat);
            onChange(toE164(o.value, nat));
          }}
          options={options}
          id={numberId ? `${numberId}-country` : undefined}
          size={size}
          disabled={disabled}
          invalid={invalid}
          disableClearable
          aria-label={t('country')}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <TextField
          id={numberId}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          onChange={(v) => {
            if (v.trim().startsWith('+')) {
              const detected = countryFromE164(v, country);
              // A pasted whole number ("+44 20 7946 0958") splits into country + national at once. Typed one key at a
              // time the calling code is still ambiguous ("+2" → "+20" Egypt or "+212" Morocco), so the raw text stays
              // in the field (it already is a full international number) and only the flag follows the digits.
              const pasted = v.length - national.length > 1;
              if (detected && pasted) {
                const next = fromE164(v, detected);
                setCountry(next.country);
                setNational(next.national);
                onChange(toE164(next.country, next.national));
                return;
              }
              if (detected) setCountry(detected);
              setNational(v);
              onChange(toE164(detected ?? country, v));
              return;
            }
            setNational(v);
            onChange(toE164(country, v));
          }}
          placeholder={placeholder}
          size={size}
          invalid={invalid}
          disabled={disabled}
          aria-label={field ? undefined : t('number')}
        />
      </Box>
    </Box>
  );
}

/** Task alias (the DS names it PhoneInput). */
export const PhoneField = PhoneInput;

export default PhoneInput;

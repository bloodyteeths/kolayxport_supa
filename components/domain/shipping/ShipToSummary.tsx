/**
 * CreateLabelPanel › Ship to, collapsed (usability wave 2026-10-15): a read-only card — name, address lines,
 * phone — instead of the full recipient form. When a field the carrier requires is missing, only that field
 * renders under the card (highlighted), so a Trendyol order with no phone asks for the phone and nothing else.
 * The full `ShipToForm` opens from the section's "Edit". Control ids stay `label-shipto-<field>` so the panel's
 * focus-first-error keeps working.
 */
import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { Button } from '@/components/ds/inputs/Button';
import { CountrySelect } from '@/components/ds/inputs/CountrySelect';
import { PhoneInput } from '@/components/ds/inputs/PhoneInput';
import { neutral as n, radius, tone } from '@/lib/ds/tokens';
import { stateCode, type ShipToFieldKey } from '@/components/domain/orders/panel/ShipToForm';
import { CA_PROVINCES, US_STATES, stateRequired } from '@/lib/shipping/regions';
import type { ShipTo } from '@/lib/shipping/labelDraft';

export interface ShipToSummaryProps {
  value: ShipTo;
  intlLocale: string;
  /** Fields to ask for under the card (frozen by the caller so a field does not vanish while typing). */
  missing: readonly ShipToFieldKey[];
  onChange: (next: ShipTo) => void;
  errors?: Partial<Record<ShipToFieldKey, string | undefined>>;
  onBlurField?: (field: ShipToFieldKey) => void;
  /** Seller phone (E.164) offered under an empty phone (DHL eCommerce only). Never applied automatically. */
  phoneFallback?: string;
  idPrefix?: string;
}

function countryName(code: string, intlLocale: string): string {
  if (!code) return '';
  try { return new Intl.DisplayNames([intlLocale], { type: 'region' }).of(code) || code; } catch { return code; }
}

/** Address lines of the card: street, district / neighbourhood, "postal city state", country. */
export function summaryLines(s: ShipTo, intlLocale: string): string[] {
  return [
    [s.street1, s.street2].filter(Boolean).join(', '),
    [s.neighbourhood, s.district].filter(Boolean).join(', '),
    [s.postal, s.city, s.state].filter(Boolean).join(' '),
    countryName(s.country, intlLocale),
  ].filter(Boolean);
}

export function ShipToSummary({
  value, intlLocale, missing, onChange, errors = {}, onBlurField, phoneFallback, idPrefix = 'label-shipto',
}: ShipToSummaryProps) {
  const t = useTranslations('createLabel');
  const lines = summaryLines(value, intlLocale);
  const country = (value.country || '').toUpperCase();
  const set = (patch: Partial<ShipTo>) => onChange({ ...value, ...patch });
  const id = (f: ShipToFieldKey) => `${idPrefix}-${f}`;
  const stateOptions: SelectOption<string>[] = useMemo(
    () => (country === 'CA' ? CA_PROVINCES : US_STATES).map(([code, name]) => ({ value: code, label: `${name} (${code})` })),
    [country],
  );

  const field = (f: ShipToFieldKey) => {
    const error = errors[f] || null;
    let control: React.ReactNode;
    if (f === 'phone') {
      control = (
        <>
          <PhoneInput id={id('phone')} value={value.phone} onChange={(v) => set({ phone: v })} defaultCountry={country || 'TR'} invalid={!!error} data-testid="shipto-phone" />
          {phoneFallback && !(value.phone || '').trim() ? (
            <Box sx={{ mt: '4px' }}>
              <Button variant="ghost" size="sm" onClick={() => set({ phone: phoneFallback })} data-testid="shipto-use-sender-phone">
                {t('useSenderPhone', { phone: phoneFallback })}
              </Button>
            </Box>
          ) : null}
        </>
      );
    } else if (f === 'country') {
      control = (
        <CountrySelect
          id={id('country')}
          value={country || null}
          onChange={(code) => { set({ country: (code || '').toUpperCase() }); onBlurField?.('country'); }}
          data-testid="shipto-country"
        />
      );
    } else if (f === 'state' && stateRequired(country)) {
      control = (
        <Select<string>
          id={id('state')}
          value={stateCode(country, value.state) || null}
          onChange={(code) => { set({ state: code }); onBlurField?.('state'); }}
          options={stateOptions}
          data-testid="shipto-state"
        />
      );
    } else {
      control = (
        <TextField
          id={id(f)}
          value={String(value[f as keyof ShipTo] ?? '')}
          onChange={(v) => set({ [f]: v } as Partial<ShipTo>)}
          onBlur={() => onBlurField?.(f)}
          invalid={!!error}
          maxLength={100}
          data-testid={`shipto-${f}`}
        />
      );
    }
    return (
      <Box key={f} sx={f === 'phone' || f === 'country' || f === 'street1' ? { gridColumn: { sm: '1 / -1' } } : undefined}>
        <FormField label={t(`field.${f}`)} htmlFor={id(f)} error={error} required>
          {control}
        </FormField>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Box sx={{ fontSize: 13, lineHeight: '20px', color: n[700], minWidth: 0 }} data-testid="shipto-summary">
        {value.name ? <Box sx={{ fontWeight: 600, color: n[900] }}>{value.name}</Box> : null}
        {lines.map((l) => <Box key={l} sx={{ overflowWrap: 'anywhere' }}>{l}</Box>)}
        {value.phone ? <Box sx={{ color: n[500] }}>{value.phone}</Box> : null}
      </Box>
      {missing.length > 0 ? (
        <Box
          sx={{ p: '12px', borderRadius: `${radius.md}px`, bgcolor: tone.warning.bg, border: `1px solid ${tone.warning.border}` }}
          data-testid="shipto-missing"
        >
          <Box sx={{ fontSize: 13, fontWeight: 600, color: tone.warning.fg, mb: '8px' }}>
            {t('shipToMissing', { count: missing.length })}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px' }}>
            {missing.map(field)}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

export default ShipToSummary;

/**
 * Ship-to address form (orders §2.5 "Ship to → Edit", §5). One form for the OrderPanel "Edit" and the
 * CreateLabelPanel Ship to section (G4 imports it; G3 owns it). Pure presentation: the caller owns the
 * value, validation messages and saving.
 *
 * Rules (DS §3.7, orders §6.2): country is a `CountrySelect` (never free text), phone is a `PhoneInput`
 * prefilled from the order (E.164), State / province is a select for US and CA (required there),
 * District / Neighbourhood render only for Turkish addresses (or when the caller forces them).
 */
import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { CountrySelect } from '@/components/ds/inputs/CountrySelect';
import { PhoneInput, toE164 } from '@/components/ds/inputs/PhoneInput';
import type { ShipTo } from '@/lib/orders/types';
import { stateRequired, US_STATES, CA_PROVINCES } from '@/lib/shipping/regions';

/** Same shape as `LabelDraft['shipTo']` (orders §6.1). */
export interface ShipToValue {
  name: string;
  /** E.164 or ''. */
  phone: string;
  email: string;
  /** ISO2. */
  country: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  district: string;
  neighbourhood: string;
}

export type ShipToFieldKey = keyof ShipToValue;

/** Already-translated error per field (null/undefined = valid). */
export type ShipToErrors = Partial<Record<ShipToFieldKey, string | null | undefined>>;

export interface ShipToFormProps {
  value: ShipToValue;
  onChange: (next: ShipToValue) => void;
  errors?: ShipToErrors;
  /**
   * Validation on blur (DS §3.7). Also called right after a country/state select change, with the value
   * that change produced (`next`): the caller's `value` is still the previous render's, so validate `next`.
   */
  onBlurField?: (field: ShipToFieldKey, next?: ShipToValue) => void;
  /**
   * Render District / Neighbourhood. Default: the country is TR. G4 passes `true` for DHL eCommerce and
   * `false` for FedEx/UPS (orders §2.5: "District hides for FedEx/UPS").
   */
  showDistrict?: boolean;
  /** Mark fields required (label asterisk only; the caller still validates). Phone/district for DHL. */
  required?: Partial<Record<ShipToFieldKey, boolean>>;
  /** Focus this field on mount (Fix address: the first invalid field). */
  autoFocusField?: ShipToFieldKey;
  /** Prefix for the control ids (`${idPrefix}-${field}`), so a caller can focus a field by id. */
  idPrefix?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export const EMPTY_SHIP_TO: ShipToValue = {
  name: '', phone: '', email: '', country: '', street1: '', street2: '', city: '', state: '', postal: '', district: '', neighbourhood: '',
};

/** Phone as E.164 for `PhoneInput`. Order phones come in any format ("0532 …", "(555) 013-4", "+1 555 0134"). */
export function phoneToE164(phone: string | null | undefined, country: string | null | undefined): string {
  const raw = String(phone ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) {
    const digits = raw.replace(/[^\d]/g, '');
    return digits ? `+${digits}` : '';
  }
  return toE164((country || 'TR').toUpperCase(), raw);
}

/** `OrderRow.shipTo` → form value. */
export function shipToFromRow(shipTo: ShipTo | null | undefined): ShipToValue {
  if (!shipTo) return { ...EMPTY_SHIP_TO };
  const country = /^[A-Z]{2}$/.test(shipTo.country || '') ? shipTo.country : '';
  return {
    name: shipTo.nameHidden ? '' : shipTo.name || '',
    phone: phoneToE164(shipTo.phone, country),
    email: shipTo.email || '',
    country,
    street1: shipTo.street1 || '',
    street2: shipTo.street2 || '',
    city: shipTo.city || '',
    state: shipTo.state || '',
    postal: shipTo.postal || '',
    district: shipTo.district || '',
    neighbourhood: shipTo.neighbourhood || '',
  };
}

export function sameShipTo(a: ShipToValue, b: ShipToValue): boolean {
  return (Object.keys(EMPTY_SHIP_TO) as ShipToFieldKey[]).every((k) => (a[k] || '').trim() === (b[k] || '').trim());
}

export { stateRequired, US_STATES, CA_PROVINCES } from '@/lib/shipping/regions';

/** Resolve a stored state ("Texas", "tx", "TX") to its code for the select; '' when it does not match. */
export function stateCode(country: string, state: string): string {
  const list = country.toUpperCase() === 'CA' ? CA_PROVINCES : country.toUpperCase() === 'US' ? US_STATES : null;
  const s = (state || '').trim();
  if (!list || !s) return s;
  const hit = list.find(([code, name]) => code === s.toUpperCase() || name.toLowerCase() === s.toLowerCase());
  return hit ? hit[0] : '';
}

export function ShipToForm({
  value, onChange, errors = {}, onBlurField, showDistrict, required = {}, autoFocusField, idPrefix = 'shipto', disabled,
  className, 'data-testid': testId,
}: ShipToFormProps) {
  const t = useTranslations('createLabel.field');
  const country = (value.country || '').toUpperCase();
  const withDistrict = showDistrict ?? country === 'TR';
  const stateSelect = stateRequired(country);

  const stateOptions: SelectOption<string>[] = useMemo(() => {
    const list = country === 'CA' ? CA_PROVINCES : US_STATES;
    return list.map(([code, name]) => ({ value: code, label: `${name} (${code})` }));
  }, [country]);

  const set = <K extends ShipToFieldKey>(key: K, v: ShipToValue[K]) => onChange({ ...value, [key]: v });
  const id = (key: ShipToFieldKey) => `${idPrefix}-${key}`;
  const blur = (key: ShipToFieldKey) => () => onBlurField?.(key);
  const err = (key: ShipToFieldKey) => errors[key] || null;

  const text = (key: ShipToFieldKey, opts: { autoComplete?: string; type?: 'text' | 'email'; maxLength?: number; optional?: boolean } = {}) => (
    <FormField label={t(key)} htmlFor={id(key)} error={err(key)} optional={opts.optional} required={required[key]}>
      <TextField
        id={id(key)}
        value={value[key]}
        onChange={(v) => set(key, v)}
        onBlur={blur(key)}
        type={opts.type}
        autoComplete={opts.autoComplete}
        maxLength={opts.maxLength}
        autoFocus={autoFocusField === key}
        disabled={disabled}
        data-testid={`shipto-${key}`}
      />
    </FormField>
  );

  return (
    <Box
      className={className}
      data-testid={testId ?? 'ship-to-form'}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px', '& > .span2': { gridColumn: { sm: '1 / -1' } } }}
    >
      <Box className="span2">{text('name', { autoComplete: 'shipping name', maxLength: 100 })}</Box>
      <Box className="span2">
        <FormField label={t('phone')} htmlFor={id('phone')} error={err('phone')} optional={!required.phone} required={required.phone}>
          <PhoneInput
            id={id('phone')}
            value={value.phone}
            onChange={(v) => set('phone', v)}
            defaultCountry={country || 'TR'}
            disabled={disabled}
            data-testid="shipto-phone"
          />
        </FormField>
      </Box>
      <Box className="span2">{text('email', { type: 'email', autoComplete: 'email', optional: !required.email })}</Box>
      <Box className="span2">
        <FormField label={t('country')} htmlFor={id('country')} error={err('country')} required>
          <CountrySelect
            id={id('country')}
            value={country || null}
            onChange={(code) => {
              const next = (code || '').toUpperCase();
              // A state from another country's list is no longer valid.
              const nextValue = { ...value, country: next, state: stateRequired(next) ? stateCode(next, value.state) : value.state };
              onChange(nextValue);
              onBlurField?.('country', nextValue);
            }}
            disabled={disabled}
            data-testid="shipto-country"
          />
        </FormField>
      </Box>
      <Box className="span2">{text('street1', { autoComplete: 'shipping address-line1', maxLength: 100 })}</Box>
      <Box className="span2">{text('street2', { autoComplete: 'shipping address-line2', maxLength: 100, optional: true })}</Box>
      <Box>{text('city', { autoComplete: 'shipping address-level2', maxLength: 60 })}</Box>
      <Box>{text('postal', { autoComplete: 'shipping postal-code', maxLength: 20, optional: !required.postal })}</Box>
      <Box className="span2">
        {stateSelect ? (
          <FormField label={t('state')} htmlFor={id('state')} error={err('state')} required>
            <Select<string>
              id={id('state')}
              value={stateCode(country, value.state) || null}
              onChange={(code) => {
                const nextValue = { ...value, state: code };
                onChange(nextValue);
                onBlurField?.('state', nextValue);
              }}
              options={stateOptions}
              disabled={disabled}
              data-testid="shipto-state"
            />
          </FormField>
        ) : (
          text('state', { autoComplete: 'shipping address-level1', maxLength: 60, optional: true })
        )}
      </Box>
      {withDistrict && (
        <>
          <Box>{text('district', { maxLength: 60, optional: !required.district })}</Box>
          <Box>{text('neighbourhood', { maxLength: 80, optional: true })}</Box>
        </>
      )}
    </Box>
  );
}

export default ShipToForm;

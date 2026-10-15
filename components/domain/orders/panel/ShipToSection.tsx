/**
 * OrderPanel › Ship to (orders §2.4, §5, §7.2): recipient, address, phone (`tel:`), email, the buyer's paid
 * shipping upgrade, Copy ▾ (international / Turkish format) and Edit. Edit expands `ShipToForm` in place and
 * saves to KolayXport only (`POST /api/orders/update`); the marketplace is never changed.
 *
 * Partial data: Etsy without an address → the extension hint; Amazon anonymized name → "Name hidden by Amazon";
 * missing fields → a warning Banner with [Fix address].
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Link, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Banner } from '@/components/ds/feedback/Banner';
import { CopyText } from '@/components/ds/format/CopyText';
import { TermHint } from '@/components/ds/format/TermHint';
import { Button } from '@/components/ds/inputs/Button';
import { SplitButton } from '@/components/ds/inputs/SplitButton';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { useFormatters } from '@/lib/format';
import { defaultAddressStyle, type AddressCopyStyle } from '@/lib/format/address';
import type { OrderRow, ShipTo, ShipToField } from '@/lib/orders/types';
import {
  ShipToForm,
  sameShipTo,
  shipToFromRow,
  stateRequired,
  type ShipToErrors,
  type ShipToFieldKey,
  type ShipToValue,
} from './ShipToForm';
import { copyableShipTo } from './useOrderActions';

export interface ShipToSectionProps {
  row: OrderRow;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** Resolves true when saved (the section leaves edit mode). */
  onSave: (value: ShipToValue) => Promise<boolean>;
  saving?: boolean;
  onCopy: (style: AddressCopyStyle) => void;
  /** Unsaved edits (feeds the SidePanel dirty guard). */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Required ship-to fields for the KolayXport copy of the address (validate.ts in G4 adds carrier rules). */
export function validateShipToBasic(v: ShipToValue, t: (key: string, values?: Record<string, string>) => string, countryName: (c: string) => string): ShipToErrors {
  const e: ShipToErrors = {};
  const req = t('validation.required');
  if (!v.name.trim()) e.name = req;
  if (!v.street1.trim()) e.street1 = req;
  if (!v.city.trim()) e.city = req;
  if (!v.country.trim()) e.country = req;
  if (stateRequired(v.country) && !v.state.trim()) e.state = t('validation.stateRequired', { country: countryName(v.country) });
  return e;
}

const FOCUS_ORDER: ShipToFieldKey[] = ['name', 'phone', 'email', 'country', 'street1', 'street2', 'city', 'postal', 'state', 'district', 'neighbourhood'];

export function firstInvalid(errors: ShipToErrors, missing?: readonly ShipToField[]): ShipToFieldKey | undefined {
  const fromErrors = FOCUS_ORDER.find((k) => errors[k]);
  if (fromErrors) return fromErrors;
  return FOCUS_ORDER.find((k) => (missing as readonly string[] | undefined)?.includes(k));
}

function useCountryName() {
  const f = useFormatters();
  return useMemo(() => {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([f.intlLocale], { type: 'region' });
    } catch {
      dn = null;
    }
    return (code: string) => {
      const c = (code || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(c)) return code;
      try {
        return dn?.of(c) || c;
      } catch {
        return c;
      }
    };
  }, [f.intlLocale]);
}

/** "12 Oak St, Apt 4 · Austin, TX 78701 · United States (US)" */
export function addressLines(s: ShipTo, countryName: (c: string) => string): string[] {
  const street = [s.street1, s.street2].filter(Boolean).join(', ');
  const local = [s.neighbourhood, s.district].filter(Boolean).join(', ');
  const cityLine = [s.city, [s.state, s.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const country = s.country ? (/^[A-Z]{2}$/.test(s.country) ? `${countryName(s.country)} (${s.country})` : s.country) : '';
  return [street, local, cityLine, country].filter(Boolean);
}

export function ShipToSection({ row, editing, onEdit, onCancelEdit, onSave, saving, onCopy, onDirtyChange }: ShipToSectionProps) {
  const t = useTranslations('orders');
  const tl = useTranslations('createLabel');
  const countryName = useCountryName();
  const s = row.shipTo;

  const initial = useMemo(() => shipToFromRow(s), [s]);
  const [value, setValue] = useState<ShipToValue>(initial);
  const [errors, setErrors] = useState<ShipToErrors>({});
  const [focusField, setFocusField] = useState<ShipToFieldKey | undefined>(undefined);

  // Entering edit mode (or switching orders) starts from the order's current address.
  useEffect(() => {
    if (!editing) return;
    setValue(initial);
    setErrors({});
    // District / Neighbourhood are not editable here (see showDistrict below).
    setFocusField(FOCUS_ORDER.find((k) => k !== 'district' && k !== 'neighbourhood' && (s.missing as readonly string[]).includes(k)) ?? 'name');
  }, [editing, row.id]);

  const dirty = editing && !sameShipTo(value, initial);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // A select change passes the value it produced (`value` here is still the previous render's).
  const validateField = (key: ShipToFieldKey, next?: ShipToValue) => {
    const all = validateShipToBasic(next ?? value, tl as never, countryName);
    setErrors((prev) => ({ ...prev, [key]: all[key] ?? null }));
  };

  const save = async () => {
    const all = validateShipToBasic(value, tl as never, countryName);
    setErrors(all);
    const bad = firstInvalid(all);
    if (bad) {
      setFocusField(undefined);
      // Re-trigger autofocus on the first invalid field.
      requestAnimationFrame(() => document.getElementById(`order-shipto-${bad}`)?.focus());
      return;
    }
    const ok = await onSave(value);
    if (ok) onDirtyChange?.(false);
  };

  const copyStyle = defaultAddressStyle(copyableShipTo(s));
  const hasAddress = !s.unavailable && Boolean(s.street1 || s.city || s.postal);
  const missingFields = s.missing.map((f) => t(`problem.field.${f}`)).join(', ');

  const editAction = !editing
    ? { id: 'edit-ship-to', label: s.missing.length > 0 && !s.unavailable ? t('actions.fixAddress') : t('panel.edit'), icon: icons.edit, onClick: onEdit }
    : undefined;

  return (
    <SidePanelSection id="order-ship-to" title={t('panel.shipTo')} action={editAction}>
      {editing ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <ShipToForm
            value={value}
            onChange={setValue}
            errors={errors}
            onBlurField={validateField}
            // District / Neighbourhood are not stored by /api/orders/update (it rebuilds shippingAddress from a
            // fixed key list) and are read from rawData only, so an edit would be dropped silently. Hidden until
            // the backend persists them (outOfScopeNeeds).
            showDistrict={false}
            autoFocusField={focusField}
            idPrefix="order-shipto"
            disabled={saving}
          />
          <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>{t('panel.addressLocalOnly')}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="secondary" size="sm" onClick={onCancelEdit} disabled={saving} disabledReason={t('panel.saving')}>
              {t('panel.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} loadingLabel={t('panel.saving')} data-testid="ship-to-save">
              {t('panel.save')}
            </Button>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {s.unavailable ? (
            <Banner
              tone="info"
              title={t('problem.etsyAddressHidden')}
              action={row.marketplaceUrl ? { id: 'open-etsy', label: t('actions.openOn', { marketplace: 'Etsy' }), href: row.marketplaceUrl, icon: icons.externalLink } : undefined}
              data-testid="ship-to-unavailable"
            />
          ) : s.missing.length > 0 ? (
            <Banner
              tone="warning"
              title={t('problem.addressIncomplete', { fields: missingFields })}
              action={{ id: 'fix-address', label: t('actions.fixAddress'), icon: icons.edit, onClick: onEdit }}
              data-testid="ship-to-missing"
            />
          ) : null}

          {s.nameHidden ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Typography variant="dense" component="span" sx={{ color: n[700] }}>{t('row.buyerHidden')}</Typography>
              <TermHint label={t('row.buyerHidden')} body={t('row.buyerHiddenHint')} />
            </Box>
          ) : s.name ? (
            <Box><CopyText value={s.name} data-testid="ship-to-name" /></Box>
          ) : null}

          {hasAddress && (
            <Typography variant="dense" component="address" sx={{ m: 0, fontStyle: 'normal', color: n[800], display: 'flex', flexDirection: 'column' }} data-testid="ship-to-address">
              {addressLines(s, countryName).map((line, i) => <span key={i}>{line}</span>)}
            </Typography>
          )}

          {(s.phone || s.email) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              {s.phone && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Link href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} underline="hover" variant="dense" sx={{ color: n[800] }}>
                    {s.phone}
                  </Link>
                  <CopyText value={s.phone} display="" />
                </Box>
              )}
              {s.phone && s.email && <Box component="span" aria-hidden sx={{ color: n[400] }}>·</Box>}
              {s.email && <CopyText value={s.email} truncate={36} />}
            </Box>
          )}

          {row.shippingUpgrade && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: tone.attention.fg }} data-testid="ship-to-upgrade">
              <icons.rush size={16} strokeWidth={ICON_STROKE} aria-hidden />
              <Typography variant="dense" component="span">{t('row.upgradePaid', { upgrade: row.shippingUpgrade })}</Typography>
            </Box>
          )}

          {hasAddress && (
            <Box>
              <SplitButton
                variant="secondary"
                size="sm"
                primary={{ id: 'copy-address', label: t('actions.copyAddress'), icon: icons.copy, onClick: () => onCopy(copyStyle) }}
                options={[
                  { id: 'copy-intl', label: t('actions.copyAddressIntl'), onClick: () => onCopy('intl') },
                  { id: 'copy-tr', label: t('actions.copyAddressTr'), onClick: () => onCopy('tr') },
                ]}
                data-testid="ship-to-copy"
              />
            </Box>
          )}
        </Box>
      )}
    </SidePanelSection>
  );
}

export default ShipToSection;

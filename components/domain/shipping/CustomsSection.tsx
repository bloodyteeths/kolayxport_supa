/**
 * CreateLabelPanel › Customs (orders §2.5, §6.1–§6.2; international FedEx/UPS only): one line per order item
 * (description, HS code with TermHint, quantity, unit value, origin), duties DAP/DDP (UPS: a choice; FedEx:
 * read-only, the sender profile's value, since generate-label reads nothing else), reason for export,
 * currency, IOSS (EU recipients only), recipient VAT (UPS only), invoice number, and "Send ETGB document after
 * the label is created" (only when ETGB is on in Settings; it is a separate `/api/etgb/process` call).
 */
import React from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { Select } from '@/components/ds/inputs/Select';
import { CountrySelect } from '@/components/ds/inputs/CountrySelect';
import { CurrencySelect } from '@/components/ds/inputs/CurrencySelect';
import { RadioGroup } from '@/components/ds/inputs/RadioGroup';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { TermHint } from '@/components/ds/format/TermHint';
import { neutral as n } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { EXPORT_REASONS, customsTotal, type CarrierKey, type CustomsItem, type LabelCustoms } from '@/lib/shipping/labelDraft';
import { UPS_DESCRIPTION_MAX } from '@/lib/shipping/submit/ups';

export interface CustomsSectionProps {
  customs: LabelCustoms;
  carrier: CarrierKey;
  recipientCountry: string;
  onChange: (customs: LabelCustoms) => void;
  /** Already-translated errors keyed `items.<i>.description|hsCode`. */
  errors?: Record<string, string | undefined>;
  onBlurField?: (path: string) => void;
  etgbEnabled: boolean;
  /** Show the IOSS field (EU recipient). */
  showIoss: boolean;
  disabled?: boolean;
}

export function CustomsSection({
  customs, carrier, onChange, errors = {}, onBlurField, etgbEnabled, showIoss, disabled,
}: CustomsSectionProps) {
  const t = useTranslations('createLabel');
  const fmt = useFormatters();
  const set = (patch: Partial<LabelCustoms>) => onChange({ ...customs, ...patch });
  const setItem = (i: number, patch: Partial<CustomsItem>) =>
    set({ items: customs.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const total = customsTotal(customs.items);
  const isUps = carrier === 'ups';

  return (
    <SidePanelSection
      id="label-customs"
      title={t('customs')}
      description={`${t('customsItems', { count: customs.items.length })} · ${fmt.money(total, customs.currency)}`}
      data-testid="label-customs"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {customs.items.map((it, i) => (
          <Box
            key={it.itemId || i}
            data-testid="customs-item"
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 120px 72px 112px 150px' }, gap: '8px', alignItems: 'start', pb: '12px', borderBottom: `1px solid ${n[100]}`, '& > .desc': { gridColumn: { xs: '1 / -1', sm: 'auto' } } }}
          >
            <Box className="desc">
              <FormField
                label={t('field.description')}
                htmlFor={`customs-${i}-description`}
                error={errors[`items.${i}.description`]}
                counter={isUps ? { value: it.description.length, max: UPS_DESCRIPTION_MAX } : undefined}
                required
              >
                <TextField
                  id={`customs-${i}-description`}
                  value={it.description}
                  onChange={(v) => setItem(i, { description: v })}
                  onBlur={() => onBlurField?.(`items.${i}.description`)}
                  maxLength={isUps ? UPS_DESCRIPTION_MAX : 200}
                  disabled={disabled}
                />
              </FormField>
            </Box>
            <FormField
              label={t('field.hsCode')}
              htmlFor={`customs-${i}-hs`}
              hint="hs"
              optional
              error={errors[`items.${i}.hsCode`]}
            >
              <TextField
                id={`customs-${i}-hs`}
                value={it.hsCode}
                onChange={(v) => setItem(i, { hsCode: v.replace(/[^\d.]/g, '') })}
                onBlur={() => onBlurField?.(`items.${i}.hsCode`)}
                inputMode="numeric"
                mono
                maxLength={13}
                disabled={disabled}
              />
            </FormField>
            <FormField label={t('field.quantity')} htmlFor={`customs-${i}-qty`}>
              <NumberField
                id={`customs-${i}-qty`}
                value={it.quantity}
                onChange={(v) => setItem(i, { quantity: Math.max(1, Math.round(v ?? 1)) })}
                min={1}
                decimals={0}
                disabled={disabled}
              />
            </FormField>
            <FormField label={t('field.value')} htmlFor={`customs-${i}-value`}>
              <MoneyField
                id={`customs-${i}-value`}
                currency={customs.currency || 'USD'}
                value={it.unitValue}
                onChange={(v) => setItem(i, { unitValue: v ?? 0 })}
                disabled={disabled}
              />
            </FormField>
            <FormField label={t('field.origin')} htmlFor={`customs-${i}-origin`}>
              <CountrySelect
                id={`customs-${i}-origin`}
                value={it.origin || null}
                onChange={(c) => setItem(i, { origin: (c || '').toUpperCase() })}
                size="sm"
                disabled={disabled}
              />
            </FormField>
          </Box>
        ))}

        {carrier === 'fedex' ? (
          // generate-label bills duties from ShipperProfile.dutiesPaymentType only: shown, not editable here.
          <FormField label={t('terms.label')} helper={t('terms.fromProfile')}>
            <Box component="span" sx={{ fontSize: 13, lineHeight: '20px', color: n[800] }} data-testid="customs-terms-readonly">
              {customs.terms === 'DDP' ? t('terms.ddp') : t('terms.dap')}
            </Box>
          </FormField>
        ) : (
          <FormField label={t('terms.label')}>
            <RadioGroup<'DAP' | 'DDP'>
              value={customs.terms}
              onChange={(v) => set({ terms: v })}
              options={[{ value: 'DAP', label: t('terms.dap') }, { value: 'DDP', label: t('terms.ddp') }]}
              direction="row"
              name="label-terms"
              data-testid="customs-terms"
            />
          </FormField>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px' }}>
          {isUps ? (
            <FormField label={t('exportReason.label')} htmlFor="customs-reason">
              <Select
                id="customs-reason"
                value={customs.exportReason}
                onChange={(v) => set({ exportReason: v })}
                options={EXPORT_REASONS.map((r) => ({ value: r, label: t(`exportReason.${r.toLowerCase()}`) }))}
                disabled={disabled}
              />
            </FormField>
          ) : null}
          <FormField label={t('field.currency')} htmlFor="customs-currency">
            <CurrencySelect
              id="customs-currency"
              value={customs.currency || null}
              onChange={(c) => set({ currency: (c || customs.currency).toUpperCase() })}
              disabled={disabled}
            />
          </FormField>
          {isUps && showIoss ? (
            <FormField label={t('field.ioss')} htmlFor="customs-ioss" hint="ioss" optional>
              <TextField id="customs-ioss" value={customs.ioss} onChange={(v) => set({ ioss: v.trim() })} mono maxLength={12} disabled={disabled} />
            </FormField>
          ) : null}
          {isUps ? (
            <FormField label={t('field.vat')} htmlFor="customs-vat" optional>
              <TextField id="customs-vat" value={customs.vat} onChange={(v) => set({ vat: v.trim() })} mono maxLength={30} disabled={disabled} />
            </FormField>
          ) : null}
          {isUps ? (
            <FormField label={t('field.invoiceNumber')} htmlFor="customs-invoice">
              <TextField id="customs-invoice" value={customs.invoiceNumber} onChange={(v) => set({ invoiceNumber: v })} mono maxLength={35} disabled={disabled} />
            </FormField>
          ) : null}
        </Box>

        {etgbEnabled ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Checkbox
              checked={customs.sendEtgb}
              onChange={(v) => set({ sendEtgb: v })}
              label={t('sendEtgb')}
              disabled={disabled}
              data-testid="customs-etgb"
            />
            <TermHint term="etgb" />
          </Box>
        ) : null}
      </Box>
    </SidePanelSection>
  );
}

export default CustomsSection;

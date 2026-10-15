/**
 * CreateLabelPanel › Options (orders §2.5, §6.2): "Send tracking to {marketplace} after the label is created"
 * (only where submit-tracking can push: hidden for manual, Trendyol, Shopify and Hepsiburada orders), then the
 * DHL eCommerce rows: payment, delivery type, cash on delivery, SMS and contents. FedEx and UPS render no
 * carrier rows (P1: no control that does nothing): generate-label hardcodes the label stock and reads no
 * signature, and /api/labels/ups reads neither; the draft keeps sending the stored defaults.
 */
import React from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { Switch } from '@/components/ds/inputs/Switch';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { TextField } from '@/components/ds/inputs/TextField';
import { DHL_DELIVERY_TYPES, DHL_PAYMENT_TYPES } from '@/lib/shipping/carriers';
import { canPushTracking, marketplaceSelectKey, type CarrierKey, type DhlOptions, type LabelOptions } from '@/lib/shipping/labelDraft';

export interface OptionsSectionProps {
  options: LabelOptions;
  carrier: CarrierKey;
  marketplace: string;
  onChange: (options: LabelOptions) => void;
  /** Bulk: "Send tracking to each marketplace" wording is the caller's; it passes `trackingLabel`. */
  trackingLabel?: string;
  disabled?: boolean;
}

const DHL_FALLBACK: DhlOptions = { paymentType: 1, deliveryType: 1, packagingType: 1, cod: false, codAmount: 0, smsShipped: true, smsDelivered: true, content: '' };

export function OptionsSection({ options, carrier, marketplace, onChange, trackingLabel, disabled }: OptionsSectionProps) {
  const t = useTranslations('createLabel');
  const set = (patch: Partial<LabelOptions>) => onChange({ ...options, ...patch });
  const dhl = options.dhl ?? DHL_FALLBACK;
  const setDhl = (patch: Partial<DhlOptions>) => set({ dhl: { ...dhl, ...patch } });
  const pushable = canPushTracking(marketplace);

  return (
    <SidePanelSection id="label-options" title={t('options')} data-testid="label-options">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {pushable ? (
          <Checkbox
            checked={options.sendTracking}
            onChange={(v) => set({ sendTracking: v })}
            label={trackingLabel ?? t('sendTracking', { mp: marketplaceSelectKey(marketplace) })}
            disabled={disabled}
            data-testid="option-send-tracking"
          />
        ) : null}

        {carrier === 'dhl' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '12px' }}>
              <FormField label={t('dhl.paymentType')} htmlFor="option-dhl-payment">
                <Select<number>
                  id="option-dhl-payment"
                  value={dhl.paymentType}
                  onChange={(v) => setDhl({ paymentType: v })}
                  options={DHL_PAYMENT_TYPES.map((v) => ({ value: v, label: t(v === 1 ? 'dhl.paymentSender' : 'dhl.paymentRecipient') }))}
                  disabled={disabled}
                />
              </FormField>
              <FormField label={t('dhl.deliveryType')} htmlFor="option-dhl-delivery">
                <Select<number>
                  id="option-dhl-delivery"
                  value={dhl.deliveryType}
                  onChange={(v) => setDhl({ deliveryType: v })}
                  options={DHL_DELIVERY_TYPES.map((v) => ({ value: v, label: t(v === 1 ? 'dhl.delivery.address' : 'dhl.delivery.branch') }))}
                  disabled={disabled}
                />
              </FormField>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
              <Switch checked={dhl.cod} onChange={(v) => setDhl({ cod: v })} label={t('dhl.cod')} disabled={disabled} data-testid="option-dhl-cod" />
              {dhl.cod ? (
                <Box sx={{ width: 180 }}>
                  <FormField label={t('dhl.codAmount')} htmlFor="option-dhl-cod-amount">
                    <MoneyField id="option-dhl-cod-amount" currency="TRY" value={dhl.codAmount || null} onChange={(v) => setDhl({ codAmount: v ?? 0 })} disabled={disabled} />
                  </FormField>
                </Box>
              ) : null}
            </Box>
            <Checkbox checked={dhl.smsShipped} onChange={(v) => setDhl({ smsShipped: v })} label={t('dhl.smsShipped')} disabled={disabled} />
            <Checkbox checked={dhl.smsDelivered} onChange={(v) => setDhl({ smsDelivered: v })} label={t('dhl.smsDelivered')} disabled={disabled} />
            <FormField label={t('dhl.content')} htmlFor="option-dhl-content" optional>
              <TextField id="option-dhl-content" value={dhl.content} onChange={(v) => setDhl({ content: v })} maxLength={100} disabled={disabled} />
            </FormField>
          </Box>
        ) : null}
      </Box>
    </SidePanelSection>
  );
}

export default OptionsSection;

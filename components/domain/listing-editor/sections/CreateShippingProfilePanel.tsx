// components/domain/listing-editor/sections/CreateShippingProfilePanel.tsx — listing-editor §6.5: the drawer's
// 7-field "Create shipping profile" dialog becomes a SidePanel md (DS ≤ 4-field rule for modals). The parent
// stages `create_shipping_profile` with exactly the drawer's payload (`shippingProfilePayload`); Etsy creates
// the profile when the listing is sent.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { FormField, MoneyField, NumberField, Select, TextField } from '@/components/ds/inputs';
import { tone, type as typeScale, neutral } from '@/lib/ds/tokens';
import {
  SHIPPING_COUNTRIES, shippingProfilePayload, validateShippingProfile,
  type NewShippingProfileInput, type ShippingFormError,
} from './etsyShared';

export interface CreateShippingProfilePanelProps {
  open: boolean;
  onClose: () => void;
  /** Receives the drawer-identical payload; reject to keep the panel open. */
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  /** Seller's default origin (settings), default 'TR'. */
  defaultOrigin?: string;
  /** Shop currency for the cost fields (Etsy charges shipping in the shop currency). */
  currency: string;
}

const blank = (origin: string): NewShippingProfileInput => ({
  title: '',
  origin_country_iso: origin,
  destination_country_iso: null,
  primary_cost: 0,
  secondary_cost: 0,
  min_processing_days: 1,
  max_processing_days: 3,
});

export function CreateShippingProfilePanel({ open, onClose, onSubmit, defaultOrigin = 'TR', currency }: CreateShippingProfilePanelProps) {
  const t = useTranslations('listingEditor');
  const tEtsy = useTranslations('etsy');
  const [form, setForm] = useState<NewShippingProfileInput>(() => blank(defaultOrigin));
  const [errors, setErrors] = useState<ShippingFormError[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) { setForm(blank(defaultOrigin)); setErrors([]); setBusy(false); setFailed(false); }
  }, [open, defaultOrigin]);

  const set = <K extends keyof NewShippingProfileInput>(k: K, v: NewShippingProfileInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors.length) setErrors([]);
  };

  const submit = async () => {
    if (busy) return;
    const errs = validateShippingProfile(form);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(shippingProfilePayload(form));
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const countryOptions = SHIPPING_COUNTRIES.map((c) => ({ value: c as string, label: tEtsy(`countries.${c}`) }));
  const dirty = Boolean(form.title.trim());

  return (
    <SidePanel padded
      open={open}
      onClose={onClose}
      size="md"
      title={t('shippingForm.title')}
      dirty={dirty && !busy}
      primary={{ id: 'create-shipping-profile', label: t('shippingForm.create'), onClick: submit, loading: busy }}
      secondary={{ id: 'cancel', label: t('sheet.cancel'), onClick: onClose }}
      data-testid="le-new-shipping-profile-panel"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: 520 }}>
        <Box sx={{ fontSize: typeScale.body[0], lineHeight: `${typeScale.body[1]}px`, color: neutral[600] }}>{t('createdOnSend')}</Box>
        <FormField
          label={t('shippingForm.name')}
          helper={t('shippingForm.nameHelper')}
          error={errors.includes('titleRequired') ? t('shippingForm.nameRequired') : null}
          required
        >
          <TextField value={form.title} onChange={(v) => set('title', v)} placeholder={t('shippingForm.namePlaceholder')} autoFocus />
        </FormField>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px' }}>
          <FormField label={t('shippingForm.origin')}>
            <Select<string> value={form.origin_country_iso} onChange={(v) => set('origin_country_iso', v)} options={countryOptions} />
          </FormField>
          <FormField label={t('shippingForm.destination')} optional>
            <Select<string>
              value={form.destination_country_iso ?? ''}
              onChange={(v) => set('destination_country_iso', v || null)}
              options={[{ value: '', label: t('shippingForm.everywhere') }, ...countryOptions]}
            />
          </FormField>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px' }}>
          <FormField label={t('shippingForm.firstItem')} helper={t('shippingForm.firstItemHelper')}>
            <MoneyField value={form.primary_cost} onChange={(v) => set('primary_cost', v)} currency={currency} />
          </FormField>
          <FormField label={t('shippingForm.additionalItem')} helper={t('shippingForm.additionalItemHelper')}>
            <MoneyField value={form.secondary_cost} onChange={(v) => set('secondary_cost', v)} currency={currency} />
          </FormField>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr' }, gap: '16px' }}>
          <FormField
            label={t('shippingForm.minDays')}
            error={errors.includes('processingRange') ? t('shippingForm.rangeError') : null}
          >
            <NumberField value={form.min_processing_days} onChange={(v) => set('min_processing_days', v)} min={1} max={45} unit={t('unit.days')} />
          </FormField>
          <FormField label={t('shippingForm.maxDays')}>
            <NumberField value={form.max_processing_days} onChange={(v) => set('max_processing_days', v)} min={1} max={45} unit={t('unit.days')} />
          </FormField>
        </Box>

        {failed ? (
          <Box role="alert" sx={{ fontSize: 12, lineHeight: '16px', color: tone.danger.fg }}>{t('stageFailed')}</Box>
        ) : null}
      </Box>
    </SidePanel>
  );
}

export default CreateShippingProfilePanel;

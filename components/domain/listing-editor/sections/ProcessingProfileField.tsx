// components/domain/listing-editor/sections/ProcessingProfileField.tsx — listing-editor §6.5 "Processing profile".
// Etsy replaced listing processing_min/max with processing profiles (readiness states). Select of the shop's
// profiles + ghost "+ New profile" that opens a Modal sm. Creating a profile is a direct Etsy call
// (`create_readiness_state`, exactly as the drawer did: profiles are shop settings, not listing edits); picking
// one only sets `readiness_state_id` in the draft, which reaches Etsy on Send.
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { Button, FormField, NumberField, RadioGroup, Select } from '@/components/ds/inputs';
import { icons } from '@/lib/ds/icons';
import { tone } from '@/lib/ds/tokens';
import { useToast } from '@/components/ds/feedback/toast';
import { fieldDomId, type LoadStatus, type ReadinessStateOption } from './etsyShared';

export interface ProcessingProfileFieldProps {
  shopId: string;
  value: number | '';
  onChange: (value: number | '') => void;
  options: ReadinessStateOption[];
  status: LoadStatus;
  onRetry: () => void;
  /** Called with the profile Etsy created (the list adds it). */
  onCreated: (state: ReadinessStateOption) => void;
  dirty?: boolean;
  onRevert?: () => void;
  readOnly?: boolean;
  error?: string | null;
}

export type ReadinessKind = 'made_to_order' | 'ready_to_ship';

/** Same rule as the drawer: whole days, 1 ≤ min ≤ max ≤ 10. */
export function validProcessingRange(min: number | null, max: number | null): boolean {
  return min != null && max != null && Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max <= 10 && min <= max;
}

export function ProcessingProfileField({
  shopId, value, onChange, options, status, onRetry, onCreated, dirty, onRevert, readOnly, error,
}: ProcessingProfileFieldProps) {
  const t = useTranslations('listingEditor');
  const tEtsy = useTranslations('etsy');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReadinessKind>('made_to_order');
  const [min, setMin] = useState<number | null>(1);
  const [max, setMax] = useState<number | null>(3);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setKind('made_to_order'); setMin(1); setMax(3); setFormError(null); setBusy(false); }
  }, [open]);

  const label = (s: ReadinessStateOption) => {
    const state = s.readiness_state === 'ready_to_ship' ? tEtsy('processingProfile.readyToShip') : tEtsy('processingProfile.madeToOrder');
    const range = s.processing_days_display_label
      || tEtsy('processingProfile.daysRange', { min: s.min_processing_days ?? '?', max: s.max_processing_days ?? '?' });
    return `${state} · ${range}`;
  };

  const create = async () => {
    if (busy) return;
    if (!validProcessingRange(min, max)) { setFormError(tEtsy('processingProfile.rangeError')); return; }
    setBusy(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/clawd/etsy?action=create_readiness_state&shop_id=${encodeURIComponent(shopId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readiness_state: kind, min_processing_time: min, max_processing_time: max, processing_time_unit: 'days' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.readiness_state_id) throw new Error(`HTTP ${res.status}`);
      const created: ReadinessStateOption = {
        readiness_state_id: Number(data.readiness_state_id),
        readiness_state: data.readiness_state || kind,
        min_processing_days: data.min_processing_days ?? min,
        max_processing_days: data.max_processing_days ?? max,
        processing_days_display_label: data.processing_days_display_label || null,
      };
      onCreated(created);
      onChange(created.readiness_state_id);
      toast.success(tEtsy('processingProfile.created'));
      setOpen(false);
    } catch {
      // Never raw server text (DS §3.14).
      setFormError(tEtsy('processingProfile.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const known = value !== '' && options.some((s) => s.readiness_state_id === value);
  const selectOptions = [
    { value: '', label: tEtsy('processingProfile.none') },
    ...options.map((s) => ({ value: String(s.readiness_state_id), label: label(s) })),
    ...(value !== '' && !known ? [{ value: String(value), label: t('field.processingCurrent', { id: value }) }] : []),
  ];

  return (
    <>
      <FormField
        label={t('field.processing')}
        htmlFor={fieldDomId('processing')}
        helper={status === 'error' ? undefined : t('field.processingHelper')}
        error={error ?? (status === 'error' ? tEtsy('processingProfile.loadFailed') : null)}
        dirty={dirty}
        onRevert={onRevert}
        width="medium"
        labelAction={
          readOnly ? undefined : status === 'error' ? (
            <Button variant="ghost" size="sm" onClick={onRetry}>{t('save.retry')}</Button>
          ) : (
            <Button variant="ghost" size="sm" icon={icons.add} onClick={() => setOpen(true)}>{t('field.newProcessingProfile')}</Button>
          )
        }
      >
        <Select<string>
          id={fieldDomId('processing')}
          value={value === '' ? '' : String(value)}
          onChange={(v) => onChange(v ? Number(v) : '')}
          options={selectOptions}
          disabled={readOnly || status === 'loading'}
          placeholder={tEtsy('processingProfile.none')}
        />
      </FormField>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={tEtsy('processingProfile.createTitle')}
        description={t('field.processingCreateNote')}
        primary={{ id: 'create-processing-profile', label: tEtsy('processingProfile.create'), onClick: create, loading: busy }}
        data-testid="le-new-processing-profile-modal"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label={tEtsy('processingProfile.stateLabel')}>
            <RadioGroup<ReadinessKind>
              value={kind}
              onChange={setKind}
              direction="row"
              options={[
                { value: 'made_to_order', label: tEtsy('processingProfile.madeToOrder') },
                { value: 'ready_to_ship', label: tEtsy('processingProfile.readyToShip') },
              ]}
            />
          </FormField>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <FormField label={tEtsy('processingProfile.minDays')}>
              <NumberField value={min} onChange={setMin} min={1} max={10} unit={t('unit.days')} />
            </FormField>
            <FormField label={tEtsy('processingProfile.maxDays')}>
              <NumberField value={max} onChange={setMax} min={1} max={10} unit={t('unit.days')} />
            </FormField>
          </Box>
          {formError ? <Box role="alert" sx={{ fontSize: 12, lineHeight: '16px', color: tone.danger.fg }}>{formError}</Box> : null}
        </Box>
      </Modal>
    </>
  );
}

export default ProcessingProfileField;

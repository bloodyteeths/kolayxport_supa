/**
 * CreateLabelPanel › Package (orders §2.5, §6.5): weight (kg), L × W × H (cm, optional for paks and envelopes),
 * packaging (only for carriers whose request carries one: FedEx, DHL eCommerce), the "Presets" picker and
 * "Save as preset…" (Modal sm: Name + "Use by default"). Presets are read-merge-written by the caller
 * (`usePackagePresets.save`).
 */
import React, { useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { Switch } from '@/components/ds/inputs/Switch';
import { Button } from '@/components/ds/inputs/Button';
import { neutral as n } from '@/lib/ds/tokens';
import { PACKAGING, dimsOptional, hasPackagingChoice } from '@/lib/shipping/carriers';
import type { CarrierKey, LabelPackage, PackagePreset } from '@/lib/shipping/labelDraft';

export interface PackageSectionProps {
  pkg: LabelPackage;
  carrier: CarrierKey;
  onChange: (pkg: LabelPackage) => void;
  presets: readonly PackagePreset[];
  onApplyPreset: (preset: PackagePreset) => void;
  /** Resolves when saved; rejects on failure (the section shows the error inline). */
  onSavePreset?: (input: { name: string; isDefault: boolean }) => Promise<void>;
  /** Already-translated weight error. */
  weightError?: string | null;
  onBlurWeight?: () => void;
  /** Bulk panel: preset picker only, no weight field (weight comes from each order). */
  presetOnly?: boolean;
  disabled?: boolean;
}

export function PackageSection({
  pkg, carrier, onChange, presets, onApplyPreset, onSavePreset, weightError, onBlurWeight, presetOnly, disabled,
}: PackageSectionProps) {
  const t = useTranslations('createLabel');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const presetOptions: SelectOption<string>[] = presets.map((p) => ({
    value: p.id,
    label: p.name,
    description: [p.weightKg ? `${p.weightKg} ${t('unit.kg')}` : '', p.lengthCm && p.widthCm && p.heightCm ? `${p.lengthCm}×${p.widthCm}×${p.heightCm} ${t('unit.cm')}` : '']
      .filter(Boolean).join(' · ') || undefined,
  }));
  const packagingOptions: SelectOption<string>[] = PACKAGING[carrier].map((p) => ({ value: p.value, label: p.i18nKey ? t(p.i18nKey) : p.label }));
  const set = (patch: Partial<LabelPackage>) => onChange({ ...pkg, ...patch });
  const optionalDims = dimsOptional(pkg.packaging);

  const pickPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p) onApplyPreset(p);
  };

  const submitPreset = async () => {
    if (!onSavePreset) return;
    if (!name.trim()) {
      setSaveError(t('validation.required'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSavePreset({ name: name.trim().slice(0, 60), isDefault });
      setSaveOpen(false);
      setName('');
      setIsDefault(false);
    } catch {
      setSaveError(t('presetFailed'));
    } finally {
      setSaving(false);
    }
  };

  const presetPicker = (
    <Box sx={{ minWidth: 200 }}>
      {presets.length === 0 ? (
        <Box component="span" sx={{ fontSize: 13, color: n[500] }}>{t('presetNone')}</Box>
      ) : (
        <Select<string>
          value={presetId}
          onChange={pickPreset}
          options={presetOptions}
          placeholder={presetOnly ? t('bulk.presetDefault') : t('presetPick')}
          size="sm"
          disabled={disabled}
          aria-label={t('presets')}
          data-testid="package-preset"
        />
      )}
    </Box>
  );

  const packaging = hasPackagingChoice(carrier) ? (
    <FormField label={t('field.packaging')} htmlFor="label-packaging">
      <Select<string>
        id="label-packaging"
        value={pkg.packaging}
        onChange={(v) => set({ packaging: v })}
        options={packagingOptions}
        disabled={disabled}
        data-testid="package-packaging"
      />
    </FormField>
  ) : null;

  // Usability wave 2026-10-15: no "Presets: none yet" row; weight, L × W × H and packaging share one row on
  // desktop (2 columns on mobile); the preset picker and "Save as preset…" sit together under it.
  return (
    <SidePanelSection id="label-package" title={t('package')} data-testid="label-package">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {presetOnly ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Box component="span" sx={{ fontSize: 13, fontWeight: 500, color: n[700] }}>{t('presets')}</Box>
            {presetPicker}
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: 'grid',
                // Fit the panel, not the viewport: the side panel is ~560px even on large screens, so a fixed
                // 5-column row overflowed sideways. Fields wrap to the next row when they no longer fit.
                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(auto-fill, minmax(104px, 1fr))' },
                gap: '12px',
                alignItems: 'start',
              }}
            >
              <FormField label={t('field.weight')} htmlFor="label-weight" error={weightError} required>
                <NumberField
                  id="label-weight"
                  value={pkg.weightKg || null}
                  onChange={(v) => set({ weightKg: v ?? 0 })}
                  onBlur={onBlurWeight}
                  min={0}
                  step={0.1}
                  decimals={3}
                  unit={t('unit.kg')}
                  invalid={!!weightError}
                  disabled={disabled}
                  data-testid="package-weight"
                />
              </FormField>
              {(['lengthCm', 'widthCm', 'heightCm'] as const).map((k) => (
                <FormField
                  key={k}
                  label={t(`field.${k === 'lengthCm' ? 'length' : k === 'widthCm' ? 'width' : 'height'}`)}
                  htmlFor={`label-${k}`}
                  optional={optionalDims}
                >
                  <NumberField
                    id={`label-${k}`}
                    value={pkg[k] ?? null}
                    onChange={(v) => set({ [k]: v ?? undefined } as Partial<LabelPackage>)}
                    min={0}
                    decimals={1}
                    unit={t('unit.cm')}
                    disabled={disabled}
                    data-testid={`package-${k}`}
                  />
                </FormField>
              ))}
              {packaging ? <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>{packaging}</Box> : null}
            </Box>
            {optionalDims ? <Box sx={{ mt: '-4px', fontSize: 12, color: n[500] }}>{t('dimsHint')}</Box> : null}
            {presets.length > 0 || onSavePreset ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {presets.length > 0 ? presetPicker : null}
                {onSavePreset ? (
                  <Button variant="ghost" size="sm" onClick={() => setSaveOpen(true)} disabled={disabled} data-testid="save-preset">
                    {t('savePreset')}
                  </Button>
                ) : null}
              </Box>
            ) : null}
          </>
        )}
      </Box>
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        nested
        title={t('presetTitle')}
        primary={{ id: 'save-preset', label: t('presetSave'), onClick: submitPreset, loading: saving }}
        data-testid="save-preset-modal"
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label={t('presetName')} htmlFor="preset-name" error={saveError} required>
            <TextField id="preset-name" value={name} onChange={setName} maxLength={60} autoFocus />
          </FormField>
          <Switch checked={isDefault} onChange={setIsDefault} label={t('presetDefault')} />
        </Box>
      </Modal>
    </SidePanelSection>
  );
}

export default PackageSection;

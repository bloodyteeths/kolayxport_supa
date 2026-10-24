// components/domain/listing-editor/sections/TaxonomyPropertyField.tsx — one Etsy category detail (taxonomy property)
// input: multi-select of Etsy's possible values (or free values when Etsy lists none) plus the unit scale. Shared by
// the listing editor's Details section and the bulk "Category attributes" dialog.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Combobox, FormField, Select, type ComboboxOption } from '@/components/ds/inputs';
import type { ListingPropertyValue, TaxonomyProperty } from './etsyShared';

/** "Primary color" → "primaryColor". Pure. */
export function taxPropKey(name: string): string {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}

/** Etsy sends category detail names in English; show the translation when we have one (values stay as Etsy sends them). */
export function taxPropLabel(t: ReturnType<typeof useTranslations<'listingEditor'>>, name: string): string {
  const key = `taxProp.${taxPropKey(name)}`;
  return name && t.has(key as never) ? t(key as never) : name;
}

export function PropertyField({ prop, value, onChange, disabled }: {
  prop: TaxonomyProperty;
  value: ListingPropertyValue | undefined;
  onChange: (next: ListingPropertyValue) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('listingEditor');
  const options: ComboboxOption[] = prop.possible_values.map((v) => ({ value: v.value_id != null ? String(v.value_id) : `n:${v.name}`, label: v.name }));
  const selected: ComboboxOption[] = (value?.values ?? []).map((name, i) => {
    const vid = value?.value_ids?.[i];
    const byId = vid != null ? options.find((o) => o.value === String(vid)) : undefined;
    return byId ?? options.find((o) => o.label === name) ?? { value: `n:${name}`, label: name, created: true };
  });
  return (
    <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FormField label={taxPropLabel(t, prop.display_name)} required={prop.is_required}>
          <Combobox
            multiple
            value={selected}
            options={options}
            creatable={options.length === 0}
            disabled={disabled}
            placeholder={selected.length ? undefined : t('field.choose')}
            onChange={(next) => onChange({
              ...(value ?? { property_id: prop.property_id, values: [] }),
              property_id: prop.property_id,
              values: next.map((o) => o.label),
              value_ids: next.map((o) => (o.created || o.value.startsWith('n:') ? NaN : Number(o.value))).filter((n) => Number.isFinite(n)),
            })}
          />
        </FormField>
      </Box>
      {prop.scales.length > 0 ? (
        <Box sx={{ width: 120, flexShrink: 0 }}>
          <FormField label={t('field.scale')}>
            <Select<string>
              value={value?.scale_id ? String(value.scale_id) : ''}
              disabled={disabled}
              onChange={(v) => onChange({ ...(value ?? { property_id: prop.property_id, values: [] }), property_id: prop.property_id, scale_id: v ? Number(v) : null })}
              placeholder={t('field.choose')}
              options={prop.scales.map((s) => ({ value: String(s.scale_id), label: s.display_name }))}
            />
          </FormField>
        </Box>
      ) : null}
    </Box>
  );
}


// components/domain/listing-editor/sections/CategoryCombobox.tsx — listing-editor §6.5 "Category": one Combobox
// over the Etsy seller taxonomy (`action=taxonomy`, flattened and cached per shop), searched by name and path.
// Options show the name with the full path under it; leaves rank first.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs';
import { loadEtsyTaxonomy, searchTaxonomy, type FlatTaxonomy } from './etsyShared';

export interface CategoryComboboxProps {
  shopId: string;
  value: number | '';
  onChange: (taxonomyId: number | '', node: FlatTaxonomy | null) => void;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Reports the resolved path of the current value (preview, change list). */
  onResolved?: (node: FlatTaxonomy | null) => void;
}

const toOption = (n: FlatTaxonomy): ComboboxOption => {
  const parent = n.path.includes(' › ') ? n.path.slice(0, n.path.lastIndexOf(' › ')) : undefined;
  return { value: String(n.id), label: n.name, description: parent };
};

export function CategoryCombobox({ shopId, value, onChange, id, invalid, disabled, onResolved }: CategoryComboboxProps) {
  const t = useTranslations('listingEditor');
  const [list, setList] = useState<FlatTaxonomy[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadEtsyTaxonomy(shopId)
      .then((l) => { if (!cancelled) { setList(l); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [shopId]);

  const byId = useMemo(() => new Map((list ?? []).map((n) => [n.id, n])), [list]);
  const current = value === '' ? null : byId.get(value) ?? null;

  useEffect(() => {
    if (list) onResolved?.(current);
  }, [list, current?.id]);

  const selected: ComboboxOption | null = value === ''
    ? null
    : current ? toOption(current) : { value: String(value), label: t('field.categoryUnknown', { id: value }) };

  const loadOptions = useCallback(async (q: string) => {
    const l = list ?? (await loadEtsyTaxonomy(shopId));
    return searchTaxonomy(l, q, 60).map(toOption);
  }, [list, shopId]);

  return (
    <Combobox
      id={id}
      value={selected}
      onChange={(o) => {
        if (!o) { onChange('', null); return; }
        const node = byId.get(Number(o.value)) ?? null;
        onChange(Number(o.value), node);
      }}
      loadOptions={loadOptions}
      debounceMs={120}
      placeholder={t('field.categoryPlaceholder')}
      noOptionsText={failed ? t('field.categoryLoadFailed') : t('field.categoryNoMatch')}
      invalid={invalid}
      disabled={disabled}
      data-testid="le-category-combobox"
    />
  );
}

export default CategoryCombobox;

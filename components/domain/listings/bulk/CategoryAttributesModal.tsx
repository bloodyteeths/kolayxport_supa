// components/domain/listings/bulk/CategoryAttributesModal.tsx — Etsy bulk "Category attributes": pick a category
// (default: the one most selected listings are in), fill the details to set (Primary color, Material, Occasion…),
// and stage them on every selected listing of that category (lib/bulk/categoryAttributes.ts). Empty fields stay as
// they are; listings of other categories are skipped and counted. Nothing reaches Etsy before "Send N changes".
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow } from '@/lib/listings/types';
import { CategoryCombobox } from '@/components/domain/listing-editor/sections/CategoryCombobox';
import { PropertyField } from '@/components/domain/listing-editor/sections/TaxonomyPropertyField';
import { parseTaxonomyProperties, type ListingPropertyValue, type TaxonomyProperty } from '@/components/domain/listing-editor/sections/etsyShared';
import { filledProperties, mostCommonCategory, type CategoryRowLike } from '@/lib/bulk/categoryAttributes';

export interface CategoryAttributesModalProps {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  shopId: string;
  onStage: (taxonomyId: number, changed: ListingPropertyValue[]) => Promise<void>;
}

export const categoryRows = (rows: ListingRow[]): CategoryRowLike[] =>
  rows.map((r) => {
    const v = Number(r.extra?.taxonomyId);
    return { id: r.id, taxonomyId: Number.isFinite(v) && v > 0 ? v : null };
  });

export function CategoryAttributesModal({ open, onClose, rows, shopId, onStage }: CategoryAttributesModalProps) {
  const t = useTranslations('listings.categoryAttrs');
  const cats = React.useMemo(() => categoryRows(rows), [rows]);
  const [taxonomyId, setTaxonomyId] = React.useState<number | null>(null);
  const [props, setProps] = React.useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; list: TaxonomyProperty[] }>({ status: 'idle', list: [] });
  const [values, setValues] = React.useState<Record<number, ListingPropertyValue | undefined>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTaxonomyId(mostCommonCategory(cats));
    setValues({});
    setBusy(false);
  }, [open, cats]);

  React.useEffect(() => {
    if (!open || !taxonomyId) { setProps({ status: 'idle', list: [] }); return; }
    let cancelled = false;
    setProps({ status: 'loading', list: [] });
    setValues({});
    fetch(`/api/clawd/etsy?action=get_taxonomy_properties&taxonomy_id=${taxonomyId}&shop_id=${encodeURIComponent(shopId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => { if (!cancelled) setProps({ status: 'ready', list: parseTaxonomyProperties(json) }); })
      .catch(() => { if (!cancelled) setProps({ status: 'error', list: [] }); });
    return () => { cancelled = true; };
  }, [open, taxonomyId, shopId]);

  const inCategory = taxonomyId ? cats.filter((c) => c.taxonomyId === taxonomyId).length : 0;
  const changed = filledProperties(values);
  const stage = async () => {
    if (!taxonomyId || !changed.length || !inCategory) return;
    setBusy(true);
    try {
      await onStage(taxonomyId, changed as ListingPropertyValue[]);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={t('title', { count: rows.length })}
      description={t('description')}
      primary={{ id: 'category-attrs-stage', label: t('stage', { count: inCategory }), onClick: () => void stage(), disabled: !changed.length || !inCategory || busy, loading: busy }}
      data-testid="listings-category-attributes"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <FormField label={t('category')} helper={taxonomyId ? t('inCategory', { count: inCategory, skipped: rows.length - inCategory }) : t('noCategory')}>
          <CategoryCombobox shopId={shopId} value={taxonomyId ?? ''} onChange={(v) => setTaxonomyId(v === '' || v == null ? null : Number(v))} />
        </FormField>
        {props.status === 'loading' ? <Typography variant="body2" sx={{ color: neutral[600] }}>{t('loading')}</Typography> : null}
        {props.status === 'error' ? <Typography variant="body2" sx={{ color: 'error.main' }}>{t('loadFailed')}</Typography> : null}
        {props.status === 'ready' && props.list.length === 0 ? <Typography variant="body2" sx={{ color: neutral[600] }}>{t('none')}</Typography> : null}
        {props.status === 'ready' && props.list.length > 0 ? (
          <>
            <Typography variant="caption" sx={{ color: neutral[600] }}>{t('emptyKeeps')}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '48vh', overflowY: 'auto', pr: '4px' }} data-testid="category-attrs-fields">
              {props.list.map((p) => (
                <PropertyField key={p.property_id} prop={p} value={values[p.property_id]} onChange={(next) => setValues((cur) => ({ ...cur, [p.property_id]: next }))} disabled={busy} />
              ))}
            </Box>
          </>
        ) : null}
      </Box>
    </Modal>
  );
}

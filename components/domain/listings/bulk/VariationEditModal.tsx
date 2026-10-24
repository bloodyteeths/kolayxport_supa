// components/domain/listings/bulk/VariationEditModal.tsx — Etsy "Edit variations / SKU" (bulk): stock and SKU per variation
// on listings with variations (optionally only where <property> = <value>), SKU on listings without. Price per variation stays in
// "Change price" (it already handles variation listings). Primary STAGES inventory drafts (lib/bulk/variationOps);
// nothing reaches Etsy until "Send N changes".
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { TextField } from '@/components/ds/inputs/TextField';
import { activeMatch, type VariationMatch } from '@/lib/bulk/variationPriceOps';
import type { SkuEdit, VariationEdits } from '@/lib/bulk/variationOps';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow } from '@/lib/listings/types';
import type { ListingsT } from '../columns';

type Field = 'quantity' | 'sku';
type QtyMode = 'set' | 'inc' | 'dec';
type SkuMode = SkuEdit['mode'];

export interface VariationEditModalProps {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  onStage: (rows: ListingRow[], edits: VariationEdits, match: VariationMatch | null) => Promise<void>;
  t: ListingsT;
}

/** Pure: the edits for the form state, or null when the form is incomplete. */
export function variationEditsFromForm(f: { field: Field; qtyMode: QtyMode; qty: number | null; skuMode: SkuMode; skuValue: string; skuFind: string }): VariationEdits | null {
  if (f.field === 'quantity') {
    if (f.qty === null || !Number.isFinite(f.qty) || f.qty < 0) return null;
    const op = f.qtyMode === 'set' ? 'set' : f.qtyMode === 'inc' ? 'increase_fixed' : 'decrease_fixed';
    return { quantity: [{ op, amount: Math.round(f.qty) }] };
  }
  if (f.skuMode === 'replace') return f.skuFind ? { sku: { mode: 'replace', find: f.skuFind, with: f.skuValue } } : null;
  return f.skuValue.trim() ? { sku: { mode: f.skuMode, value: f.skuValue } as SkuEdit } : null;
}

export function VariationEditModal({ open, onClose, rows, onStage, t }: VariationEditModalProps) {
  const [field, setField] = React.useState<Field>('quantity');
  const [qtyMode, setQtyMode] = React.useState<QtyMode>('set');
  const [qty, setQty] = React.useState<number | null>(null);
  const [skuMode, setSkuMode] = React.useState<SkuMode>('template');
  const [skuValue, setSkuValue] = React.useState('');
  const [skuFind, setSkuFind] = React.useState('');
  const [matchProperty, setMatchProperty] = React.useState('');
  const [matchValue, setMatchValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setField('quantity'); setQtyMode('set'); setQty(null); setSkuMode('template'); setSkuValue(''); setSkuFind(''); setMatchProperty(''); setMatchValue('');
  }, [open]);
  const edits = variationEditsFromForm({ field, qtyMode, qty, skuMode, skuValue, skuFind });
  const match = activeMatch({ property: matchProperty, value: matchValue });
  const stage = async () => {
    if (!edits) return;
    setBusy(true);
    try {
      await onStage(rows, edits, match);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('listings.variations.title', { count: rows.length })}
      description={t('listings.variations.description')}
      primary={{ id: 'variations-stage', label: t('listings.variations.stage', { count: rows.length }), onClick: () => void stage(), disabled: !edits || busy, loading: busy }}
      data-testid="listings-edit-variations"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <FormField label={t('listings.variations.field')}>
          <Select<Field> value={field} onChange={setField} fullWidth options={[
            { value: 'quantity', label: t('listings.variations.fieldQuantity') },
            { value: 'sku', label: t('listings.variations.fieldSku') },
          ]} />
        </FormField>
        {field === 'quantity' ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '8px' }}>
            <FormField label={t('listings.variations.mode')}>
              <Select<QtyMode> value={qtyMode} onChange={setQtyMode} fullWidth options={[
                { value: 'set', label: t('listings.variations.qtySet') },
                { value: 'inc', label: t('listings.variations.qtyInc') },
                { value: 'dec', label: t('listings.variations.qtyDec') },
              ]} />
            </FormField>
            <FormField label={t('listings.variations.amount')} helper={t('listings.variations.qtyHelp')}>
              <NumberField value={qty} onChange={setQty} min={0} max={999} decimals={0} />
            </FormField>
          </Box>
        ) : (
          <>
            <FormField label={t('listings.variations.mode')}>
              <Select<SkuMode> value={skuMode} onChange={setSkuMode} fullWidth options={[
                { value: 'template', label: t('listings.variations.skuTemplate') },
                { value: 'set', label: t('listings.variations.skuSet') },
                { value: 'prefix', label: t('listings.variations.skuPrefix') },
                { value: 'suffix', label: t('listings.variations.skuSuffix') },
                { value: 'replace', label: t('listings.variations.skuReplace') },
              ]} />
            </FormField>
            {skuMode === 'replace' ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '8px' }}>
                <FormField label={t('listings.variations.skuFind')}><TextField value={skuFind} onChange={setSkuFind} mono /></FormField>
                <FormField label={t('listings.variations.skuWith')}><TextField value={skuValue} onChange={setSkuValue} mono /></FormField>
              </Box>
            ) : (
              <FormField label={t('listings.variations.skuValue')} helper={skuMode === 'template' ? t('listings.variations.skuTemplateHelp') : t('listings.variations.skuMaxHelp')}>
                <TextField value={skuValue} onChange={setSkuValue} mono placeholder={skuMode === 'template' ? '{sku}-{Color}-{Size}' : ''} />
              </FormField>
            )}
          </>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '8px' }}>
          <FormField label={t('listings.price.matchProperty')} helper={t('listings.price.matchHelp')}>
            <TextField value={matchProperty} onChange={setMatchProperty} placeholder={t('listings.price.matchPropertyPlaceholder')} />
          </FormField>
          <FormField label={t('listings.price.matchValue')}>
            <TextField value={matchValue} onChange={setMatchValue} placeholder={t('listings.price.matchValuePlaceholder')} />
          </FormField>
        </Box>
        <Typography variant="caption" sx={{ color: neutral[600] }}>{t('listings.variations.note')}</Typography>
      </Box>
    </Modal>
  );
}

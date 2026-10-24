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
import { optionValuesOf, propertyNamesOf, type SkuEdit, type VariationEdits } from '@/lib/bulk/variationOps';
import { Button } from '@/components/ds/inputs/Button';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow } from '@/lib/listings/types';
import type { ListingsT } from '../columns';

type Field = 'quantity' | 'sku' | 'priceByOption';
type OptionRow = { value: string; price: number | null };
type QtyMode = 'set' | 'inc' | 'dec';
type SkuMode = SkuEdit['mode'];

export interface VariationEditModalProps {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  onStage: (rows: ListingRow[], edits: VariationEdits, match: VariationMatch | null) => Promise<void>;
  /** Variation inventories of (some of) these listings, for the price-per-option table (open draft first, else live). */
  loadInventories?: (rows: ListingRow[]) => Promise<unknown[]>;
  /** Shop currency for the price inputs. */
  currency?: string;
  t: ListingsT;
}

/** Pure: the edits for the form state, or null when the form is incomplete. */
export function variationEditsFromForm(f: { field: Field; qtyMode: QtyMode; qty: number | null; skuMode: SkuMode; skuValue: string; skuFind: string; property?: string; options?: OptionRow[] }): VariationEdits | null {
  if (f.field === 'priceByOption') {
    const prices = (f.options ?? []).filter((o) => o.value.trim() && o.price !== null && Number.isFinite(o.price) && o.price > 0).map((o) => ({ value: o.value.trim(), price: o.price as number }));
    return f.property?.trim() && prices.length ? { priceByOption: { property: f.property.trim(), prices } } : null;
  }
  if (f.field === 'quantity') {
    if (f.qty === null || !Number.isFinite(f.qty) || f.qty < 0) return null;
    const op = f.qtyMode === 'set' ? 'set' : f.qtyMode === 'inc' ? 'increase_fixed' : 'decrease_fixed';
    return { quantity: [{ op, amount: Math.round(f.qty) }] };
  }
  if (f.skuMode === 'replace') return f.skuFind ? { sku: { mode: 'replace', find: f.skuFind, with: f.skuValue } } : null;
  return f.skuValue.trim() ? { sku: { mode: f.skuMode, value: f.skuValue } as SkuEdit } : null;
}

export function VariationEditModal({ open, onClose, rows, onStage, loadInventories, currency = 'USD', t }: VariationEditModalProps) {
  const [property, setProperty] = React.useState('');
  const [options, setOptions] = React.useState<OptionRow[]>([]);
  const [inventories, setInventories] = React.useState<unknown[] | null>(null);
  const [loadingOptions, setLoadingOptions] = React.useState(false);
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
    setProperty(''); setOptions([]); setInventories(null);
  }, [open]);
  const edits = variationEditsFromForm({ field, qtyMode, qty, skuMode, skuValue, skuFind, property, options });
  const propertyNames = React.useMemo(() => (inventories ? propertyNamesOf(inventories) : []), [inventories]);
  // The option values of the chosen property, read from the selected listings (keeps prices typed so far).
  const fillOptions = React.useCallback((invs: unknown[], prop: string) => {
    const values = optionValuesOf(invs, prop);
    setOptions((cur) => values.map((v) => ({ value: v, price: cur.find((o) => o.value.toLocaleLowerCase('tr') === v.toLocaleLowerCase('tr'))?.price ?? null })));
  }, []);
  const loadOptions = async () => {
    if (!loadInventories) return;
    setLoadingOptions(true);
    try {
      const invs = await loadInventories(rows);
      setInventories(invs);
      const prop = property.trim() || propertyNamesOf(invs)[0] || '';
      if (prop) { setProperty(prop); fillOptions(invs, prop); }
    } finally {
      setLoadingOptions(false);
    }
  };
  const match = field === 'priceByOption' ? null : activeMatch({ property: matchProperty, value: matchValue });
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
            { value: 'priceByOption', label: t('listings.variations.fieldPriceByOption') },
          ]} />
        </FormField>
        {field === 'priceByOption' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="variations-price-by-option">
            <Typography variant="caption" sx={{ color: neutral[600] }}>{t('listings.variations.priceByOptionHelp')}</Typography>
            <Box sx={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 180 }}>
                <FormField label={t('listings.variations.property')}>
                  <TextField value={property} onChange={(v) => { setProperty(v); if (inventories) fillOptions(inventories, v); }} placeholder={t('listings.price.matchPropertyPlaceholder')} data-testid="variations-option-property" />
                </FormField>
              </Box>
              {loadInventories ? (
                <Button variant="secondary" size="sm" onClick={() => void loadOptions()} loading={loadingOptions} data-testid="variations-load-options">
                  {t('listings.variations.loadOptions')}
                </Button>
              ) : null}
            </Box>
            {propertyNames.length > 1 ? (
              <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {propertyNames.map((n) => (
                  <Button key={n} variant={n === property ? 'secondary' : 'ghost'} size="sm" onClick={() => { setProperty(n); if (inventories) fillOptions(inventories, n); }}>{n}</Button>
                ))}
              </Box>
            ) : null}
            {inventories && property.trim() && options.length === 0 ? (
              <Typography variant="caption" sx={{ color: neutral[600] }}>{t('listings.variations.noOptions', { property: property.trim() })}</Typography>
            ) : null}
            {options.map((o, i) => (
              <Box key={i} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px', gap: '8px', alignItems: 'center' }}>
                <TextField value={o.value} onChange={(v) => setOptions((cur) => cur.map((x, j) => (j === i ? { ...x, value: v } : x)))} placeholder={t('listings.variations.optionValue')} />
                <MoneyField value={o.price} onChange={(v) => setOptions((cur) => cur.map((x, j) => (j === i ? { ...x, price: v } : x)))} currency={currency} min={0} />
              </Box>
            ))}
            <Box>
              <Button variant="ghost" size="sm" onClick={() => setOptions((cur) => [...cur, { value: '', price: null }])} data-testid="variations-add-option">
                {t('listings.variations.addOption')}
              </Button>
            </Box>
          </Box>
        ) : field === 'quantity' ? (
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
        {field !== 'priceByOption' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '8px' }}>
          <FormField label={t('listings.price.matchProperty')} helper={t('listings.price.matchHelp')}>
            <TextField value={matchProperty} onChange={setMatchProperty} placeholder={t('listings.price.matchPropertyPlaceholder')} />
          </FormField>
          <FormField label={t('listings.price.matchValue')}>
            <TextField value={matchValue} onChange={setMatchValue} placeholder={t('listings.price.matchValuePlaceholder')} />
          </FormField>
        </Box>
        ) : null}
        <Typography variant="caption" sx={{ color: neutral[600] }}>{t('listings.variations.note')}</Typography>
      </Box>
    </Modal>
  );
}

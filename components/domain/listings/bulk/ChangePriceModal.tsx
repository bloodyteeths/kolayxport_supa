// components/domain/listings/bulk/ChangePriceModal.tsx — listings-grid §6.3 "Change price" (Modal sm, 3 fields).
// Mode · Value · Round to. Footer preview "24 listings · $38.00 → $41.80 (example)". Primary STAGES drafts
// ("Stage 24 price changes"); listings whose price can't be edited inline (variations) are skipped and counted.
// Trendyol (`currentListPrice` given): the list price moves with the sale price (legacy TrendyolBulkOpsBar: same
// formula on both), and never ends below the new sale price (Trendyol rejects sale > list). "Set to" keeps the list
// price unless it would fall below the new sale price. The preview shows both.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Button } from '@/components/ds/inputs/Button';
import { activeMatch, type VariationMatch } from '@/lib/bulk/variationPriceOps';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow, StagePatch } from '@/lib/listings/types';
import type { ListingsT } from '../columns';
import { TemplateStepSaver } from './TemplateStepSaver';

export type PriceMode = 'set' | 'incPct' | 'decPct' | 'incAmt' | 'decAmt';
export type PriceRound = '99' | '00' | 'none';

/** New price for one listing (pure, unit-tested). Never below 0.01; null when the input is unusable. */
export function computeNewPrice(current: number, mode: PriceMode, value: number, round: PriceRound): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(value) || value < 0) return null;
  let next: number;
  switch (mode) {
    case 'set':
      next = value;
      break;
    case 'incPct':
      next = current * (1 + value / 100);
      break;
    case 'decPct':
      next = current * (1 - value / 100);
      break;
    case 'incAmt':
      next = current + value;
      break;
    case 'decAmt':
      next = current - value;
      break;
    default:
      return null;
  }
  if (round === '99') next = Math.floor(next) + 0.99;
  else if (round === '00') next = Math.round(next);
  next = Math.round(next * 100) / 100;
  return next > 0 ? Math.max(0.01, next) : null;
}

export type ChangePriceModalProps = {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  /** Store currency (MoneyField for "Set to" / amounts). */
  currency: string;
  /** Marketplace minimum (Etsy 0.20); listings that would go below it are skipped. */
  priceMin?: number;
  /** Current price shown for a row (draft overlay first). */
  currentPrice: (row: ListingRow) => number | null;
  formatMoney: (amount: number, currency: string) => string;
  onStage: (patches: Array<{ id: string; patch: StagePatch }>) => Promise<{ ok: string[]; failed: string[] }>;
  /** Trendyol: current list price (draft overlay first). Given → the list price is staged too. */
  currentListPrice?: (row: ListingRow) => number | null;
  /**
   * Etsy: listings with variations are not skipped; the same change is applied to every variation's price and
   * staged as the listing's inventory (lib/bulk/variationPriceOps.ts). Omitted → they are skipped and counted.
   */
  onStageVariations?: (rows: ListingRow[], op: { mode: PriceMode; value: number; round: PriceRound; match?: VariationMatch | null }) => Promise<void>;
  /** Etsy: show "Save as template step" (saved bulk-edit templates). */
  templates?: boolean;
  t: ListingsT;
};

/** New Trendyol list price next to a new sale price (pure). Null = leave the list price as it is. */
export function computeNewListPrice(currentList: number | null, newSale: number, mode: PriceMode, value: number, round: PriceRound): number | null {
  if (currentList === null || !Number.isFinite(currentList) || currentList <= 0) return null;
  const moved = mode === 'set' ? currentList : computeNewPrice(currentList, mode, value, round);
  const next = Math.max(moved ?? currentList, newSale);
  return next === currentList ? null : Math.round(next * 100) / 100;
}

export type PricePlanItem = { id: string; patch: StagePatch; from: number; to: number; listFrom?: number; listTo?: number };

export function planPriceChanges(
  rows: ListingRow[],
  currentPrice: (row: ListingRow) => number | null,
  mode: PriceMode,
  value: number | null,
  round: PriceRound,
  priceMin?: number,
  currentListPrice?: (row: ListingRow) => number | null,
): { patches: PricePlanItem[]; skippedVariations: number; skippedInvalid: number } {
  const patches: PricePlanItem[] = [];
  let skippedVariations = 0;
  let skippedInvalid = 0;
  for (const r of rows) {
    if (!r.editable.price) {
      skippedVariations += 1;
      continue;
    }
    const cur = currentPrice(r);
    const next = value === null || cur === null ? null : computeNewPrice(cur, mode, value, round);
    if (next === null || (priceMin !== undefined && next < priceMin)) {
      skippedInvalid += 1;
      continue;
    }
    const listFrom = currentListPrice ? currentListPrice(r) : null;
    const listTo = currentListPrice && value !== null ? computeNewListPrice(listFrom, next, mode, value, round) : null;
    if (next === cur && listTo === null) continue;
    const item: PricePlanItem = { id: r.id, patch: { price: next }, from: cur as number, to: next };
    if (listTo !== null && listFrom !== null) {
      item.patch.listPrice = listTo;
      item.listFrom = listFrom;
      item.listTo = listTo;
    }
    patches.push(item);
  }
  return { patches, skippedVariations, skippedInvalid };
}

export function ChangePriceModal({ open, onClose, rows, currency, priceMin, currentPrice, currentListPrice, formatMoney, onStage, onStageVariations, templates, t }: ChangePriceModalProps) {
  const [mode, setMode] = React.useState<PriceMode>('incPct');
  const [value, setValue] = React.useState<number | null>(null);
  const [round, setRound] = React.useState<PriceRound>('none');
  const [busy, setBusy] = React.useState(false);
  // "Only variations where <property> is <value>" (legacy Variation Price dialog): limits the change to matching
  // variations, and leaves listings without variations alone.
  const [matchProperty, setMatchProperty] = React.useState('');
  const [matchValue, setMatchValue] = React.useState('');
  // Most price changes cover every variation: the property/value filter stays behind a link until asked for.
  const [showMatch, setShowMatch] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValue(null);
      setBusy(false);
      setMatchProperty('');
      setMatchValue('');
    }
  }, [open]);

  const plan = React.useMemo(
    () => planPriceChanges(rows, currentPrice, mode, value, round, priceMin, currentListPrice),
    [rows, currentPrice, mode, value, round, priceMin, currentListPrice],
  );
  const example = plan.patches[0];
  const isMoney = mode === 'set' || mode === 'incAmt' || mode === 'decAmt';
  // Listings with variations (price per variation): staged as inventory when the marketplace supports it.
  const variationRows = React.useMemo(() => (onStageVariations ? rows.filter((r) => !r.editable.price) : []), [rows, onStageVariations]);
  const variationCount = value !== null ? variationRows.length : 0;
  const match = variationRows.length > 0 ? activeMatch({ property: matchProperty, value: matchValue }) : null;
  const plainPatches = match ? [] : plan.patches;
  const stageCount = plainPatches.length + variationCount;

  const stage = async () => {
    if (!stageCount || busy) return;
    setBusy(true);
    try {
      if (plainPatches.length) await onStage(plainPatches.map(({ id, patch }) => ({ id, patch })));
      if (variationCount && value !== null && onStageVariations) await onStageVariations(variationRows, { mode, value, round, ...(match ? { match } : {}) });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('listings.bulk.changePrice')}
      primary={{
        id: 'stagePrice',
        label: t('listings.price.stage', { count: stageCount }),
        onClick: () => void stage(),
        loading: busy,
        disabled: stageCount === 0,
        disabledReason: stageCount === 0 ? t('listings.price.nothingToStage') : undefined,
      }}
      data-testid="listings-change-price"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <FormField label={t('listings.price.modeLabel')}>
          <Select<PriceMode>
            value={mode}
            onChange={setMode}
            fullWidth
            options={(['set', 'incPct', 'decPct', 'incAmt', 'decAmt'] as const).map((m) => ({ value: m, label: t(`listings.price.mode.${m}`) }))}
          />
        </FormField>
        <FormField label={t('listings.price.valueLabel')}>
          {isMoney ? (
            <MoneyField value={value} onChange={setValue} currency={currency} min={0} />
          ) : (
            <NumberField value={value} onChange={setValue} min={0} max={1000} decimals={2} unit="%" />
          )}
        </FormField>
        <FormField label={t('listings.price.round')}>
          <Select<PriceRound>
            value={round}
            onChange={setRound}
            fullWidth
            options={[
              { value: '99', label: t('listings.price.round99') },
              { value: '00', label: t('listings.price.round00') },
              { value: 'none', label: t('listings.price.roundNone') },
            ]}
          />
        </FormField>
        <Typography variant="body2" sx={{ color: neutral[600] }} data-testid="listings-change-price-preview">
          {example
            ? t('listings.price.preview', {
                count: plan.patches.length,
                from: formatMoney(example.from, currency),
                to: formatMoney(example.to, currency),
              })
            : t('listings.price.previewEmpty', { count: rows.length })}
        </Typography>
        {currentListPrice && example ? (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' }} data-testid="listings-change-price-both">
            <Typography component="li" variant="caption" sx={{ color: neutral[600] }}>
              {t('listings.bulk.price.salePrice', { from: formatMoney(example.from, currency), to: formatMoney(example.to, currency) })}
            </Typography>
            {example.listFrom !== undefined && example.listTo !== undefined ? (
              <Typography component="li" variant="caption" sx={{ color: neutral[600] }}>
                {t('listings.bulk.price.listPrice', { from: formatMoney(example.listFrom, currency), to: formatMoney(example.listTo, currency) })}
              </Typography>
            ) : null}
          </Box>
        ) : null}
        {variationRows.length > 0 ? (
          <>
            <Typography variant="caption" sx={{ color: neutral[600] }} data-testid="listings-change-price-variations">
              {t('listings.price.variations', { count: variationRows.length })}
            </Typography>
            {!showMatch && !matchProperty && !matchValue ? (
              <Box>
                <Button variant="ghost" size="sm" onClick={() => setShowMatch(true)} data-testid="listings-change-price-match-open">
                  {t('listings.price.matchOpen')}
                </Button>
              </Box>
            ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '8px' }}>
              <FormField label={t('listings.price.matchProperty')} helper={t('listings.price.matchHelp')}>
                <TextField value={matchProperty} onChange={setMatchProperty} placeholder={t('listings.price.matchPropertyPlaceholder')} data-testid="listings-change-price-match-property" />
              </FormField>
              <FormField label={t('listings.price.matchValue')}>
                <TextField value={matchValue} onChange={setMatchValue} placeholder={t('listings.price.matchValuePlaceholder')} data-testid="listings-change-price-match-value" />
              </FormField>
            </Box>
            )}
            {match && plan.patches.length > 0 ? (
              <Typography variant="caption" sx={{ color: neutral[600] }}>
                {t('listings.price.matchSkipsPlain', { count: plan.patches.length })}
              </Typography>
            ) : null}
          </>
        ) : plan.skippedVariations > 0 ? (
          <Typography variant="caption" sx={{ color: neutral[600] }}>
            {t('listings.price.skippedVariations', { count: plan.skippedVariations })}
          </Typography>
        ) : null}
        {plan.skippedInvalid > 0 && value !== null ? (
          <Typography variant="caption" sx={{ color: neutral[600] }}>
            {t('listings.price.skippedInvalid', { count: plan.skippedInvalid })}
          </Typography>
        ) : null}
        {templates ? <TemplateStepSaver step={value !== null && value >= 0 ? { kind: 'price', mode, value, round } : null} /> : null}
      </Box>
    </Modal>
  );
}

export default ChangePriceModal;

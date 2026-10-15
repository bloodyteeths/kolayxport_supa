// components/domain/listings/bulk/ChangePriceModal.tsx — listings-grid §6.3 "Change price" (Modal sm, 3 fields).
// Mode · Value · Round to. Footer preview "24 listings · $38.00 → $41.80 (example)". Primary STAGES drafts
// ("Stage 24 price changes"); listings whose price can't be edited inline (variations) are skipped and counted.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { MoneyField } from '@/components/ds/inputs/MoneyField';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow, StagePatch } from '@/lib/listings/types';
import type { ListingsT } from '../columns';

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
  t: ListingsT;
};

export function planPriceChanges(
  rows: ListingRow[],
  currentPrice: (row: ListingRow) => number | null,
  mode: PriceMode,
  value: number | null,
  round: PriceRound,
  priceMin?: number,
): { patches: Array<{ id: string; patch: StagePatch; from: number; to: number }>; skippedVariations: number; skippedInvalid: number } {
  const patches: Array<{ id: string; patch: StagePatch; from: number; to: number }> = [];
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
    if (next !== cur) patches.push({ id: r.id, patch: { price: next }, from: cur as number, to: next });
  }
  return { patches, skippedVariations, skippedInvalid };
}

export function ChangePriceModal({ open, onClose, rows, currency, priceMin, currentPrice, formatMoney, onStage, t }: ChangePriceModalProps) {
  const [mode, setMode] = React.useState<PriceMode>('incPct');
  const [value, setValue] = React.useState<number | null>(null);
  const [round, setRound] = React.useState<PriceRound>('none');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValue(null);
      setBusy(false);
    }
  }, [open]);

  const plan = React.useMemo(() => planPriceChanges(rows, currentPrice, mode, value, round, priceMin), [rows, currentPrice, mode, value, round, priceMin]);
  const example = plan.patches[0];
  const isMoney = mode === 'set' || mode === 'incAmt' || mode === 'decAmt';

  const stage = async () => {
    if (!plan.patches.length || busy) return;
    setBusy(true);
    try {
      await onStage(plan.patches.map(({ id, patch }) => ({ id, patch })));
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
        label: t('listings.price.stage', { count: plan.patches.length }),
        onClick: () => void stage(),
        loading: busy,
        disabled: plan.patches.length === 0,
        disabledReason: plan.patches.length === 0 ? t('listings.price.nothingToStage') : undefined,
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
        {plan.skippedVariations > 0 ? (
          <Typography variant="caption" sx={{ color: neutral[600] }}>
            {t('listings.price.skippedVariations', { count: plan.skippedVariations })}
          </Typography>
        ) : null}
        {plan.skippedInvalid > 0 && value !== null ? (
          <Typography variant="caption" sx={{ color: neutral[600] }}>
            {t('listings.price.skippedInvalid', { count: plan.skippedInvalid })}
          </Typography>
        ) : null}
      </Box>
    </Modal>
  );
}

export default ChangePriceModal;

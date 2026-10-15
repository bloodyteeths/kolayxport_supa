// components/domain/listings/bulk/ChangeStockModal.tsx — listings-grid §6.3 "Change stock" (Trendyol, Wix,
// Shopify, eBay). Set to · Increase by · Decrease by. STAGES drafts; listings whose quantity can't be edited
// inline (variations, not tracked) are skipped and counted.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { NumberField } from '@/components/ds/inputs/NumberField';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow, StagePatch } from '@/lib/listings/types';
import type { ListingsT } from '../columns';

export type StockMode = 'set' | 'inc' | 'dec';

/** New quantity (pure, unit-tested). Clamped to 0…max; null when the input is unusable. */
export function computeNewQty(current: number | null, mode: StockMode, value: number, max?: number): number | null {
  if (!Number.isInteger(value) || value < 0) return null;
  const base = current ?? 0;
  let next = mode === 'set' ? value : mode === 'inc' ? base + value : base - value;
  next = Math.max(0, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

export function planStockChanges(
  rows: ListingRow[],
  currentQty: (row: ListingRow) => number | null,
  mode: StockMode,
  value: number | null,
  max?: number,
): { patches: Array<{ id: string; patch: StagePatch }>; skipped: number } {
  const patches: Array<{ id: string; patch: StagePatch }> = [];
  let skipped = 0;
  for (const r of rows) {
    if (!r.editable.qty) {
      skipped += 1;
      continue;
    }
    const cur = currentQty(r);
    const next = value === null ? null : computeNewQty(cur, mode, value, max);
    if (next !== null && next !== cur) patches.push({ id: r.id, patch: { qty: next } });
  }
  return { patches, skipped };
}

export type ChangeStockModalProps = {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  qtyMax?: number;
  currentQty: (row: ListingRow) => number | null;
  onStage: (patches: Array<{ id: string; patch: StagePatch }>) => Promise<{ ok: string[]; failed: string[] }>;
  t: ListingsT;
};

export function ChangeStockModal({ open, onClose, rows, qtyMax, currentQty, onStage, t }: ChangeStockModalProps) {
  const [mode, setMode] = React.useState<StockMode>('set');
  const [value, setValue] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValue(null);
      setBusy(false);
    }
  }, [open]);

  const plan = React.useMemo(() => planStockChanges(rows, currentQty, mode, value, qtyMax), [rows, currentQty, mode, value, qtyMax]);

  const stage = async () => {
    if (!plan.patches.length || busy) return;
    setBusy(true);
    try {
      await onStage(plan.patches);
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
      title={t('listings.bulk.changeStock')}
      primary={{
        id: 'stageStock',
        label: t('listings.stock.stage', { count: plan.patches.length }),
        onClick: () => void stage(),
        loading: busy,
        disabled: plan.patches.length === 0,
        disabledReason: plan.patches.length === 0 ? t('listings.price.nothingToStage') : undefined,
      }}
      data-testid="listings-change-stock"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <FormField label={t('listings.price.modeLabel')}>
          <Select<StockMode>
            value={mode}
            onChange={setMode}
            fullWidth
            options={(['set', 'inc', 'dec'] as const).map((m) => ({ value: m, label: t(`listings.stock.mode.${m}`) }))}
          />
        </FormField>
        <FormField label={t('listings.stock.valueLabel')}>
          <NumberField value={value} onChange={setValue} min={0} max={qtyMax} />
        </FormField>
        {plan.skipped > 0 ? (
          <Typography variant="caption" sx={{ color: neutral[600] }}>
            {t('listings.stock.skipped', { count: plan.skipped })}
          </Typography>
        ) : null}
      </Box>
    </Modal>
  );
}

export default ChangeStockModal;

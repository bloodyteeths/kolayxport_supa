// components/domain/listings/bulk/CopyToShopModal.tsx — Etsy "Copy to another shop…" (bulk bar ⋯, only with 2+ shops).
// Port of BulkOperationsBar's copy action: stages `queuedActions: [{ type: 'copy', targetShopId }]` on each selected
// listing's draft. Nothing is copied until the seller sends those drafts (row "Send this change" / "Send selected
// changes", or from the editor); "Send N changes" never sends a copy, like any draft that creates a listing.
// A copy is staged alone: listings with other open changes are skipped (the copy reads the listing as it is on Etsy).
import * as React from 'react';
import Box from '@mui/material/Box';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Select } from '@/components/ds/inputs/Select';
import { neutral } from '@/lib/ds/tokens';
import type { ListingRow } from '@/lib/listings/types';
import { hasOpenChanges, type ListingsT } from '../columns';

export type CopyToShopModalProps = {
  open: boolean;
  onClose: () => void;
  rows: ListingRow[];
  /** The other shops of the seller (the current one excluded). */
  shops: { id: string; name: string }[];
  onStage: (targets: ListingRow[], targetShopId: string) => Promise<void>;
  t: ListingsT;
};

/** Rows a copy can be staged on (pure): no open changes, no queued removal. */
export function copyTargets(rows: ListingRow[]): { ok: ListingRow[]; skipped: number } {
  const ok = rows.filter((r) => !hasOpenChanges(r) && !(r.sync?.queuedDelete && r.sync.status !== 'synced'));
  return { ok, skipped: rows.length - ok.length };
}

export function CopyToShopModal({ open, onClose, rows, shops, onStage, t }: CopyToShopModalProps) {
  const [target, setTarget] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTarget(shops.length === 1 ? shops[0].id : null);
    setBusy(false);
  }, [open, shops]);

  const plan = React.useMemo(() => copyTargets(rows), [rows]);

  const stage = async () => {
    if (!target || !plan.ok.length || busy) return;
    setBusy(true);
    try {
      await onStage(plan.ok, target);
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
      title={t('listings.copyToShop.title', { count: rows.length })}
      description={t('listings.copyToShop.help')}
      primary={{
        id: 'stageCopies',
        label: t('listings.copyToShop.stage', { count: plan.ok.length }),
        onClick: () => void stage(),
        loading: busy,
        disabled: !target || plan.ok.length === 0,
        disabledReason: !target ? t('listings.copyToShop.pick') : t('listings.price.nothingToStage'),
      }}
      data-testid="listings-copy-to-shop"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <FormField label={t('listings.copyToShop.target')}>
          <Select<string>
            value={target}
            onChange={setTarget}
            placeholder={t('listings.copyToShop.pick')}
            options={shops.map((s) => ({ value: s.id, label: s.name }))}
            data-testid="listings-copy-to-shop-target"
          />
        </FormField>
        {plan.skipped > 0 ? (
          <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>{t('listings.copyToShop.skipped', { count: plan.skipped })}</Box>
        ) : null}
      </Box>
    </Modal>
  );
}

export default CopyToShopModal;

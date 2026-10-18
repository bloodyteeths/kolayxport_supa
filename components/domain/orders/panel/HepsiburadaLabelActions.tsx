/**
 * OrderPanel › Label & tracking, Hepsiburada orders: one click packs the order's open lines (if needed) and opens
 * HB's mutual cargo label ("ortak barkod") PDF for the HB-contracted cargo company. `GET /api/hepsiburada/operations
 * ?action=label` does both steps server-side.
 */
import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { useToast } from '@/components/ds/feedback';
import { neutral as n } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import type { OrderRow } from '@/lib/orders/types';

export function HepsiburadaLabelActions({ row }: { row: OrderRow }) {
  const t = useTranslations('hepsiburada.orders');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const hb = row.hepsiburada;
  if (!hb) return null;
  const canPrint = !!hb.packageNumber || hb.canPack;

  const print = async () => {
    if (busy) return;
    setBusy(true);
    // Open the tab synchronously so pop-up blockers allow it, then point it at the PDF.
    const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    try {
      const res = await fetch(`/api/hepsiburada/operations?action=label&orderId=${encodeURIComponent(row.id)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (err) {
      win?.close();
      toast.error(t('labelFailed', { reason: String((err as Error)?.message || err).slice(0, 200) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} data-testid="hb-label-actions">
      {canPrint && (
        <Button variant="secondary" size="sm" icon={icons.print} onClick={() => void print()} loading={busy} data-testid="hb-print-label">
          {hb.packageNumber ? t('printLabel') : t('packAndPrint')}
        </Button>
      )}
      {hb.cargoCompany && (
        <Typography variant="caption" component="span" sx={{ color: n[500] }}>{t('cargoCompany', { name: hb.cargoCompany })}</Typography>
      )}
    </Box>
  );
}

export default HepsiburadaLabelActions;

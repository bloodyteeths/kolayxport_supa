/**
 * OrderPanel › Label & tracking, Trendyol orders:
 *  - "Print cargo label" → our 100×150 mm PDF (Code 128 of Trendyol's cargo number), any carrier, any printer;
 *  - "Trendyol label (ZPL)" → Trendyol's own common label for thermal printers (Trendyol Express / Aras only).
 * No manual status buttons: Trendyol sets Shipped/Delivered itself, the invoice provider sets Invoiced, and Picking is
 * reported on print when the seller turned it on (Settings › Sender › Trendyol). `pages/api/trendyol/cargo.ts`.
 */
import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { useToast } from '@/components/ds/feedback';
import { neutral as n } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import type { OrderRow } from '@/lib/orders/types';

async function errorOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return String(body?.error || `HTTP ${res.status}`).slice(0, 200);
}

class CargoError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

async function cargoError(res: Response): Promise<CargoError> {
  const body = await res.json().catch(() => ({}));
  return new CargoError(String(body?.error || `HTTP ${res.status}`).slice(0, 200), body?.code);
}

export function TrendyolCargoActions({ row }: { row: OrderRow }) {
  const t = useTranslations('trendyolCargo');
  const locale = useLocale();
  const toast = useToast();
  const [busy, setBusy] = useState<'pdf' | 'zpl' | null>(null);
  /** Trendyol answered COMMON_LABEL_NOT_ALLOWED: the store is not enabled for the common label. */
  const [zplBlocked, setZplBlocked] = useState(false);
  const info = row.trendyol;
  if (!info?.cargoNumber) return null;
  const base = `/api/trendyol/cargo?orderId=${encodeURIComponent(row.id)}`;

  const openPdf = async () => {
    if (busy) return;
    setBusy('pdf');
    const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    try {
      const res = await fetch(`${base}&action=label&format=pdf&locale=${locale === 'en' ? 'en' : 'tr'}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(await errorOf(res));
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (err) {
      win?.close();
      toast.error(t('labelFailed', { reason: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const downloadZpl = async () => {
    if (busy) return;
    setBusy('zpl');
    try {
      const res = await fetch(`${base}&action=label&format=zpl`, { credentials: 'same-origin' });
      if (!res.ok) throw await cargoError(res);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `trendyol-${info.cargoNumber}.zpl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      if ((err as CargoError).code === 'common_label_not_allowed') {
        setZplBlocked(true);
        toast.error(t('zplNotAllowed'), { persist: true });
      } else {
        toast.error(t('labelFailed', { reason: (err as Error).message }));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ mt: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="trendyol-cargo-actions">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" icon={icons.print} onClick={() => void openPdf()} loading={busy === 'pdf'} data-testid="trendyol-label-pdf">
          {t('printLabel')}
        </Button>
        {info.commonLabel && !zplBlocked && (
          <Button variant="ghost" size="sm" icon={icons.download} onClick={() => void downloadZpl()} loading={busy === 'zpl'} data-testid="trendyol-label-zpl">
            {t('zplLabel')}
          </Button>
        )}
        {info.carrier && (
          <Typography variant="caption" component="span" sx={{ color: n[500] }}>{t('carrier', { name: info.carrier })}</Typography>
        )}
      </Box>
    </Box>
  );
}

export default TrendyolCargoActions;

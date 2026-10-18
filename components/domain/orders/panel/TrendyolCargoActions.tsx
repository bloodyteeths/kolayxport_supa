/**
 * OrderPanel › Label & tracking, Trendyol orders:
 *  - "Print cargo label" → our 100×150 mm PDF (Code 128 of Trendyol's cargo number), any carrier, any printer;
 *  - "Trendyol label (ZPL)" → Trendyol's own common label for thermal printers (Trendyol Express / Aras only);
 *  - report the package status Trendyol expects from the seller: Picking, then Invoiced with the invoice number.
 * `pages/api/trendyol/cargo.ts` does the work.
 */
import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { TextField } from '@/components/ds/inputs/TextField';
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
  const [busy, setBusy] = useState<'pdf' | 'zpl' | 'status' | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [reported, setReported] = useState<'Picking' | 'Invoiced' | null>(null);
  /** Trendyol answered COMMON_LABEL_NOT_ALLOWED: the store is not enabled for the common label. */
  const [zplBlocked, setZplBlocked] = useState(false);
  const info = row.trendyol;
  if (!info?.cargoNumber) return null;
  const next = reported === 'Picking' ? 'Invoiced' : reported === 'Invoiced' ? null : info.nextStatus;
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

  const report = async (status: 'Picking' | 'Invoiced') => {
    if (busy) return;
    setBusy('status');
    try {
      const res = await fetch(`${base}&action=status`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: row.id, status, invoiceNumber: status === 'Invoiced' ? invoiceNumber.trim() : undefined }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      setReported(status);
      toast.success(status === 'Picking' ? t('pickingDone') : t('invoicedDone'));
    } catch (err) {
      toast.error(t('statusFailed', { reason: (err as Error).message }));
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
      {next === 'Picking' && (
        <Box>
          <Button variant="ghost" size="sm" icon={icons.done} onClick={() => void report('Picking')} loading={busy === 'status'} data-testid="trendyol-picking">
            {t('reportPicking')}
          </Button>
        </Box>
      )}
      {next === 'Invoiced' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Box sx={{ width: 220, maxWidth: '100%' }}>
            <TextField size="sm" value={invoiceNumber} onChange={(v) => setInvoiceNumber(v)} placeholder={t('invoicePlaceholder')} aria-label={t('invoiceNumber')} mono data-testid="trendyol-invoice-number" />
          </Box>
          <Button
            variant="ghost"
            size="sm"
            icon={icons.done}
            onClick={() => void report('Invoiced')}
            loading={busy === 'status'}
            disabled={!invoiceNumber.trim()}
            disabledReason={t('invoiceRequired')}
            data-testid="trendyol-invoiced"
          >
            {t('reportInvoiced')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default TrendyolCargoActions;

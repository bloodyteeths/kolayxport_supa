// components/domain/orders/TrendyolBulkLabels.tsx — Orders page "Trendyol labels (N)": prints the cargo labels of every
// unshipped, not yet printed Trendyol order in one file (pages/api/trendyol/cargo-bulk.ts). PDF (default, every
// carrier) or ZPL (thermal; Trendyol Express / Aras only) through a DS SplitButton, like OrdersBulkActions' Print ▾.
// Printed orders are remembered server-side (`Order.cargoLabelPrintedAt`); a reprint is the order panel's button.
// iPhone / home-screen app: a blob download after an await is ignored, so the POST answers with a link and the page
// navigates to it (the OrdersExportMenu pattern).
import * as React from 'react';
import useSWR from 'swr';
import { useLocale, useTranslations } from 'next-intl';
import { SplitButton } from '@/components/ds/inputs/SplitButton';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { BULK_LABELS_MAX, countsFromHeaders, type BulkLabelCounts, type BulkLabelFormat } from '@/lib/trendyol/bulkLabels';
import { needsGestureDownload } from './OrdersExportMenu';

export const TRENDYOL_BULK_KEY = '/api/trendyol/cargo-bulk';

type CountResponse = { eligible: number; skippedNoCargoNumber: number };

const countFetcher = async (url: string): Promise<CountResponse | null> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) return null; // not enabled / not connected: no button
  return res.json();
};

type Tx = (key: string, values?: Record<string, string | number>) => string;

/** Toast text for one run: "18 etiket yazdırıldı; 2 sipariş atlandı: kargo numarası yok. Kalan 40 için tekrar basın". */
export function bulkLabelsSummary(t: Tx, c: BulkLabelCounts): string {
  const parts = [t('done', { count: c.printed })];
  if (c.skippedNoCargoNumber) parts.push(t('skippedNoCargo', { count: c.skippedNoCargoNumber }));
  if (c.skippedNotCommonLabel) parts.push(t('skippedNotCommon', { count: c.skippedNotCommonLabel }));
  if (c.skippedFailed) parts.push(t('skippedFailed', { count: c.skippedFailed }));
  const text = parts.join('; ');
  return c.remaining ? `${text}. ${t('remaining', { count: c.remaining })}` : text;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function filenameFrom(res: Response, format: BulkLabelFormat): string {
  const m = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
  return m?.[1] || `trendyol-etiketler.${format}`;
}

export type TrendyolBulkLabels = {
  /** Printable now (unshipped, unprinted, with a cargo number); 0 hides the button. */
  count: number;
  /** The SplitButton, or null when there is nothing to print. */
  render(opts: { size: 'sm' | 'xl'; variant?: 'primary' | 'secondary' }): React.ReactNode;
};

export function useTrendyolBulkLabels({ enabled, onPrinted }: { enabled: boolean; onPrinted?: () => void }): TrendyolBulkLabels {
  const t = useTranslations('trendyolCargo.bulk') as unknown as Tx;
  const tCargo = useTranslations('trendyolCargo');
  const locale = useLocale();
  const toast = useToast();
  const { data, mutate } = useSWR(enabled ? TRENDYOL_BULK_KEY : null, countFetcher, { revalidateOnFocus: true, dedupingInterval: 10_000 });
  const [busy, setBusy] = React.useState<BulkLabelFormat | null>(null);
  const count = data?.eligible ?? 0;

  const run = async (format: BulkLabelFormat) => {
    if (busy) return;
    setBusy(format);
    const viaLink = needsGestureDownload();
    toast.info(t('preparing', { count: Math.min(count, BULK_LABELS_MAX) }));
    try {
      const res = await fetch(TRENDYOL_BULK_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ format, locale: locale === 'en' ? 'en' : 'tr', deliver: viaLink ? 'link' : 'file' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
        if (body.code === 'nothing_to_print') toast.info(format === 'zpl' ? t('nothingZpl') : t('nothing'));
        else if (body.code === 'common_label_not_allowed') toast.error(tCargo('zplNotAllowed'), { persist: true });
        else toast.error(t('failed', { reason: String(body.error || `HTTP ${res.status}`).slice(0, 120) }));
        return;
      }
      let counts: BulkLabelCounts;
      if (viaLink) {
        const body = (await res.json()) as { counts: BulkLabelCounts; downloadUrl: string };
        counts = body.counts;
        window.location.assign(body.downloadUrl);
      } else {
        counts = countsFromHeaders((name) => res.headers.get(name));
        saveBlob(await res.blob(), filenameFrom(res, format));
      }
      toast.success(bulkLabelsSummary(t, counts));
      if (counts.commonLabelNotAllowed) toast.error(tCargo('zplNotAllowed'), { persist: true });
    } catch (err) {
      toast.error(t('failed', { reason: (err as Error)?.message || 'network' }));
    } finally {
      setBusy(null);
      void mutate();
      onPrinted?.();
    }
  };

  const render: TrendyolBulkLabels['render'] = ({ size, variant = 'secondary' }) => {
    if (count <= 0) return null;
    const pdf = { id: 'trendyolLabelsPdf', label: t('pdf'), icon: icons.print, onClick: () => void run('pdf') };
    const zpl = { id: 'trendyolLabelsZpl', label: t('zpl'), icon: icons.download, onClick: () => void run('zpl') };
    const button = (
      <SplitButton
        variant={variant}
        size={size}
        primary={{
          id: 'trendyolLabels',
          label: t('button', { count }),
          icon: icons.print,
          onClick: () => void run('pdf'),
          loading: busy !== null,
          loadingLabel: t('printing'),
        }}
        options={[pdf, zpl]}
        menuLabel={t('menuLabel')}
        data-testid="orders-trendyol-labels"
      />
    );
    // Phones: no hover tooltip (a long-press would only get in the way).
    if (size === 'xl') return button;
    return (
      <Tooltip title={t('tooltip', { max: BULK_LABELS_MAX })}>
        <span style={{ display: 'inline-flex', minWidth: 0 }}>{button}</span>
      </Tooltip>
    );
  };

  return { count, render };
}

/**
 * OrderPanel › History (orders §2.4, §5): a `Timeline` of `OrderRow.history` (ordered, imported, label
 * created / failed, tracking sent / queued / failed, shipped), oldest first as in the wireframe.
 */
import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Timeline, type TimelineEvent } from '@/components/ds/data/Timeline';
import { marketplaceSelectKey } from '@/lib/shipping/trackingCarriers';
import type { OrderHistoryEvent, OrderRow } from '@/lib/orders/types';
import { carrierName } from './LabelSection';

export interface HistorySectionProps {
  row: OrderRow;
  /** Display name of the marketplace ("Etsy"), already resolved by the panel. */
  marketplaceName: string;
}

type T = (key: string, values?: Record<string, string>) => string;

export function historyEvents(row: OrderRow, t: T, marketplaceName: string): TimelineEvent[] {
  const mp = marketplaceSelectKey(row.store.marketplace);
  const label = (e: OrderHistoryEvent): Pick<TimelineEvent, 'label' | 'tone'> => {
    const carrier = carrierName(e.carrier) || '—';
    switch (e.kind) {
      case 'ordered':
        return { label: row.isManual ? t('history.orderedManual') : t('history.ordered', { marketplace: marketplaceName }) };
      case 'imported':
        return { label: t('history.imported') };
      case 'label_created':
        return { label: t('history.labelCreated', { carrier }), tone: 'success' };
      case 'label_failed':
        return { label: t('history.labelFailed', { carrier }), tone: 'danger' };
      case 'tracking_sent':
        return { label: t('history.trackingSent', { mp }), tone: 'success' };
      case 'tracking_queued':
        return { label: t('history.trackingQueued'), tone: 'info' };
      case 'tracking_failed':
        return { label: t('history.trackingFailed'), tone: 'danger' };
      case 'shipped':
        return { label: t('history.shipped'), tone: 'success' };
      default:
        return { label: String(e.kind) };
    }
  };
  return row.history
    .filter((e) => e.at && Number.isFinite(new Date(e.at).getTime()))
    .map((e, i) => ({
      id: `${e.kind}-${i}`,
      at: e.at,
      ...label(e),
      detail: e.trackingNumber || (e.kind === 'label_failed' && e.detail ? e.detail.slice(0, 200) : undefined),
    }));
}

export function HistorySection({ row, marketplaceName }: HistorySectionProps) {
  const t = useTranslations('orders');
  const events = useMemo(() => historyEvents(row, t as unknown as T, marketplaceName), [row, t, marketplaceName]);
  if (events.length === 0) return null;
  return (
    <SidePanelSection id="order-history" title={t('panel.history')}>
      <Timeline events={events} data-testid="order-history" />
    </SidePanelSection>
  );
}

export default HistorySection;

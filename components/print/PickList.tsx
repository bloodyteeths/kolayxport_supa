import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import { PrintThumb } from './PrintShell';
import type { PrintDataResponse, PrintOrder } from './types';

export interface PickRow {
  key: string;
  sku: string;
  title: string;
  variation: string;
  image: string;
  totalQuantity: number;
  /** Orders needing this line, with the quantity each needs. */
  orders: { orderId: string; orderNumber: string; quantity: number }[];
}

/**
 * Aggregate order lines by SKU (and variation, so different sizes/colours of
 * one SKU are picked separately). Lines without a SKU are grouped by title +
 * variation and sorted after all SKU rows.
 */
export function buildPickRows(orders: PrintOrder[]): PickRow[] {
  const rows = new Map<string, PickRow>();
  for (const order of orders) {
    for (const item of order.items) {
      const sku = item.sku.trim();
      const variation = item.variation.trim();
      const key = sku
        ? `sku:${sku.toLowerCase()}\u0000${variation.toLowerCase()}`
        : `title:${item.title.trim().toLowerCase()}\u0000${variation.toLowerCase()}`;
      let row = rows.get(key);
      if (!row) {
        row = { key, sku, title: item.title, variation, image: item.image, totalQuantity: 0, orders: [] };
        rows.set(key, row);
      }
      if (!row.image && item.image) row.image = item.image;
      if (!row.title && item.title) row.title = item.title;
      row.totalQuantity += item.quantity;
      // Key on the order id: two orders can share a display number across
      // marketplaces/shops and are still separate packages.
      const existing = row.orders.find(o => o.orderId === order.id);
      if (existing) existing.quantity += item.quantity;
      else row.orders.push({ orderId: order.id, orderNumber: order.orderNumber, quantity: item.quantity });
    }
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return Array.from(rows.values()).sort((a, b) => {
    if (!!a.sku !== !!b.sku) return a.sku ? -1 : 1;
    return cmp(a.sku, b.sku) || cmp(a.title, b.title) || cmp(a.variation, b.variation);
  });
}

export default function PickList({ data }: { data: PrintDataResponse }) {
  const t = useTranslations('printSlips');
  const { formatDateTime } = useLocale();
  const rows = useMemo(() => buildPickRows(data.orders), [data.orders]);
  const totalUnits = rows.reduce((sum, r) => sum + r.totalQuantity, 0);
  // Orders with no item data are left out of the aggregation; say so on the
  // printed list so the picker knows it is incomplete.
  const withoutItems = data.orders.filter(o => o.items.length === 0).map(o => `#${o.orderNumber}`);
  const generatedAt = useMemo(() => formatDateTime(new Date()), [formatDateTime]);

  return (
    <div className="kxp-pages">
      <section className="kxp-sheet">
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{t('pickList')}</div>
            {data.sender?.name && <div className="kxp-muted" style={{ fontSize: '0.85rem' }}>{data.sender.name}</div>}
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 700 }}>
              {t('pickSummary', { orders: data.orders.length, lines: rows.length, units: totalUnits })}
            </div>
            <div className="kxp-muted">{t('generatedAt', { date: generatedAt })}</div>
          </div>
        </header>

        {withoutItems.length > 0 && (
          <div className="kxp-note" role="alert">
            {t('ordersWithoutItems', { count: withoutItems.length, orders: withoutItems.join(', ') })}
          </div>
        )}

        <div style={{ marginTop: 16, borderTop: '2px solid #111', display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.75rem', fontWeight: 700 }}>
          <span>{t('items')}</span>
          <span>{t('totalQty')}</span>
        </div>

        {rows.length === 0 ? (
          <div className="kxp-muted" style={{ padding: '10px 0' }}>{t('noItems')}</div>
        ) : (
          rows.map(row => (
            <div className="kxp-row" key={row.key}>
              <span className="kxp-check" role="presentation" title={t('picked')} />
              <PrintThumb src={row.image} alt={row.title} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
                  {row.sku || <span className="kxp-muted" style={{ fontFamily: 'inherit', fontWeight: 600 }}>{t('noSku')}</span>}
                </div>
                <div style={{ fontSize: '0.9rem', wordBreak: 'break-word' }}>{row.title || '—'}</div>
                {row.variation && (
                  <div style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
                    <span className="kxp-muted">{t('variation')}:</span> {row.variation}
                  </div>
                )}
                <div style={{ fontSize: '0.8rem', marginTop: 2, wordBreak: 'break-word' }}>
                  <span className="kxp-muted">{t('neededFor')}:</span>{' '}
                  {row.orders
                    .map(o => (o.quantity > 1 ? `#${o.orderNumber} ×${o.quantity}` : `#${o.orderNumber}`))
                    .join(', ')}
                </div>
              </div>
              <div className="kxp-qty">×{row.totalQuantity}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

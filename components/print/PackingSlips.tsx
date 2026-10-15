import React from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import { defaultAddressStyle, formatAddressForCopy, normalizeAddress } from '@/lib/format/address';
import { PrintThumb } from './PrintShell';
import type { PrintDataResponse, PrintOrder, PrintSender } from './types';

function senderLines(sender: PrintSender | null): { name: string; address: string } {
  if (!sender) return { name: '', address: '' };
  const address = formatAddressForCopy(
    {
      street1: sender.street1,
      street2: sender.street2,
      city: sender.city,
      state: sender.state,
      postal: sender.postal,
      country: sender.country,
    },
    sender.country && /^(tr|tur|turkey|türkiye|turkiye)$/i.test(sender.country) ? 'tr' : 'intl'
  );
  return { name: sender.name, address };
}

function PackingSlip({ order, sender }: { order: PrintOrder; sender: PrintSender | null }) {
  const t = useTranslations('printSlips');
  const { formatDate } = useLocale();
  // The address's own name is the recipient (may differ from the buyer on
  // gift orders); fall back to the buyer's name only when the address has none.
  const shipTo = formatAddressForCopy(order.address, defaultAddressStyle(order.address), {
    name: normalizeAddress(order.address).name ? null : order.customerName || null,
  });
  const from = senderLines(sender);
  const totalUnits = order.items.reduce((sum, it) => sum + it.quantity, 0);
  const date = order.orderDate ? formatDate(order.orderDate) : '';

  return (
    <section className="kxp-sheet kxp-break" aria-label={t('orderNumber', { number: order.orderNumber })}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, lineHeight: 1.2 }}>{from.name || order.marketplace}</div>
          {from.name && order.marketplace && (
            <div className="kxp-muted" style={{ fontSize: '0.8rem' }}>{order.marketplace}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.75rem' }} className="kxp-muted">
            {t('packingSlip')}
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', wordBreak: 'break-all' }}>
            {t('orderNumber', { number: order.orderNumber })}
          </div>
          {date && (
            <div className="kxp-muted" style={{ fontSize: '0.85rem' }}>
              {t('orderDate')}: {date}
            </div>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 20 }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="kxp-muted" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
            {t('shipTo')}
          </div>
          <div className="kxp-pre" style={{ marginTop: 4, fontSize: '0.95rem', lineHeight: 1.4 }}>{shipTo || '—'}</div>
        </div>
        {(from.name || from.address) && (
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div className="kxp-muted" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {t('from')}
            </div>
            <div className="kxp-pre" style={{ marginTop: 4, fontSize: '0.85rem', lineHeight: 1.4 }}>
              {[from.name, from.address].filter(Boolean).join('\n')}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, borderTop: '2px solid #111', display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.75rem', fontWeight: 700 }}>
        <span>{t('items')}</span>
        <span>{t('qty')}</span>
      </div>

      {order.items.length === 0 ? (
        <div className="kxp-muted" style={{ padding: '10px 0' }}>{t('noItems')}</div>
      ) : (
        order.items.map(item => (
          <div className="kxp-row" key={item.id}>
            <PrintThumb src={item.image} alt={item.title} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{item.title || '—'}</div>
              {item.variation && (
                <div style={{ fontSize: '0.85rem', wordBreak: 'break-word' }}>
                  <span className="kxp-muted">{t('variation')}:</span> {item.variation}
                </div>
              )}
              {item.sku && (
                <div style={{ fontSize: '0.8rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
                  <span className="kxp-muted">{t('sku')}:</span> {item.sku}
                </div>
              )}
              {item.note && (
                <div className="kxp-pre" style={{ fontSize: '0.85rem', marginTop: 2, wordBreak: 'break-word' }}>
                  <span className="kxp-muted">{t('itemNote')}:</span> {item.note}
                </div>
              )}
            </div>
            <div className="kxp-qty">×{item.quantity}</div>
          </div>
        ))
      )}

      <div style={{ borderTop: '1px solid #111', paddingTop: 6, textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>
        {t('totalUnits', { count: totalUnits })}
      </div>

      {order.giftMessage && (
        <div className="kxp-note">
          <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{t('giftMessage')}</div>
          <div className="kxp-pre" style={{ wordBreak: 'break-word' }}>{order.giftMessage}</div>
        </div>
      )}
      {order.customerNote && (
        <div className="kxp-note">
          <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>{t('buyerNote')}</div>
          <div className="kxp-pre" style={{ wordBreak: 'break-word' }}>{order.customerNote}</div>
        </div>
      )}

      <div className="kxp-muted" style={{ marginTop: 20, textAlign: 'center', fontSize: '0.9rem' }}>{t('thankYou')}</div>
    </section>
  );
}

/** One packing slip per order; each slip starts on a new printed page. */
export default function PackingSlips({ data }: { data: PrintDataResponse }) {
  return (
    <div className="kxp-pages">
      {data.orders.map(order => (
        <PackingSlip key={order.id} order={order} sender={data.sender} />
      ))}
    </div>
  );
}

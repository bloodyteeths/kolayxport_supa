/**
 * OrderPanel › Items (orders §2.4, §5): thumb, title (marketplace link), variant, SKU (copy), unit price × qty,
 * personalization (copy), then "Items {subtotal} · Total {total}". Gift message and buyer note follow as their
 * own blocks. Amounts are never summed across currencies; an unknown unit price shows "—".
 */
import React from 'react';
import { Box, Link, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Thumb } from '@/components/ds/data/Thumb';
import { CopyText } from '@/components/ds/format/CopyText';
import { neutral as n, accent } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import type { OrderItemRow, OrderRow } from '@/lib/orders/types';

export interface ItemsSectionProps {
  row: OrderRow;
  /** "Open on {marketplace} ↗" label (already translated), shown when `row.marketplaceUrl` exists. */
  openOnLabel?: string;
}

/** Σ qty × unit price, or null when any unit price is unknown (never a partial sum). */
export function itemsSubtotal(items: readonly OrderItemRow[]): number | null {
  if (items.length === 0) return null;
  let sum = 0;
  for (const it of items) {
    if (it.unitPrice == null || !Number.isFinite(it.unitPrice)) return null;
    sum += it.unitPrice * (it.quantity || 0);
  }
  return Math.round(sum * 100) / 100;
}

function ItemLine({ item, currency }: { item: OrderItemRow; currency: string | null }) {
  const t = useTranslations('orders.panel');
  const td = useTranslations('ds');
  const f = useFormatters();
  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', columnGap: '12px', alignItems: 'start', py: '8px' }} data-testid="order-item">
      <Thumb src={item.image} alt={item.title} size={48} preview />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="dense" component="p" sx={{ m: 0, fontWeight: 500, color: n[900], overflowWrap: 'anywhere' }}>
          {item.listingUrl ? (
            <Link href={item.listingUrl} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ color: 'inherit' }}>
              {item.title}
            </Link>
          ) : (
            item.title
          )}
        </Typography>
        {(item.variant || item.sku) && (
          <Typography variant="caption" component="div" sx={{ color: n[600], display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
            {item.variant && <span>{item.variant}</span>}
            {item.variant && item.sku && <span aria-hidden>·</span>}
            {item.sku && (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span>{td('termNames.sku')}</span>
                <CopyText value={item.sku} mono truncate={24} />
              </Box>
            )}
          </Typography>
        )}
        {item.personalization && (
          <Box sx={{ mt: '4px', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px' }}>
            <Typography variant="caption" component="span" sx={{ color: n[500] }}>{t('personalization')}:</Typography>
            <CopyText value={item.personalization} data-testid="item-personalization" />
          </Box>
        )}
      </Box>
      <Typography variant="dense" component="div" sx={{ color: n[800], whiteSpace: 'nowrap', textAlign: 'right' }}>
        {t('qtyPrice', { price: item.unitPrice == null ? '—' : f.money(item.unitPrice, currency), qty: String(item.quantity) })}
      </Typography>
    </Box>
  );
}

export function ItemsSection({ row, openOnLabel }: ItemsSectionProps) {
  const t = useTranslations('orders.panel');
  const f = useFormatters();
  const subtotal = itemsSubtotal(row.items);

  return (
    <>
      <SidePanelSection
        id="order-items"
        title={t('items', { count: row.items.length })}
        action={row.marketplaceUrl && openOnLabel ? { id: 'open-on', label: openOnLabel, href: row.marketplaceUrl, icon: icons.externalLink } : undefined}
      >
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, '& > li + li': { borderTop: `1px solid ${n[100]}` } }}>
          {row.items.map((it) => <ItemLine key={it.id} item={it} currency={row.currency} />)}
        </Box>
        <Typography
          variant="dense"
          component="p"
          sx={{ m: 0, mt: '8px', color: n[600], textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexWrap: 'wrap' }}
          data-testid="items-totals"
        >
          {subtotal != null && (
            <span>{t('itemsSubtotal', { amount: f.money(subtotal, row.currency) })}</span>
          )}
          {row.total != null && (
            <Box component="span" sx={{ color: n[900], fontWeight: 600 }}>
              {t('orderTotal', { amount: f.money(row.total, row.currency) })}
            </Box>
          )}
        </Typography>
      </SidePanelSection>

      {row.giftMessage && (
        <SidePanelSection id="order-gift" title={t('giftMessage')}>
          <QuotedText value={row.giftMessage} />
        </SidePanelSection>
      )}
      {row.buyerNote && (
        <SidePanelSection id="order-buyer-note" title={t('buyerNote')}>
          <QuotedText value={row.buyerNote} />
        </SidePanelSection>
      )}
    </>
  );
}

function QuotedText({ value }: { value: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
      <Typography variant="dense" component="p" sx={{ m: 0, flex: 1, color: n[800], whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: `2px solid ${accent[200]}`, pl: '8px' }}>
        {value}
      </Typography>
      <CopyText value={value} display="" />
    </Box>
  );
}

export default ItemsSection;

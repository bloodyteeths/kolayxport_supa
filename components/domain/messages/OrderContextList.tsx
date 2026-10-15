// components/domain/messages/OrderContextList.tsx — messages §4 "Rail: Orders (Wix)", §5.1 rail row
// (group G6). `GET /api/messages?action=orderContext&contactId=` (newest first). A 502 is an error, never
// "no orders" (D9). Per order: mono number, order StatusPill (`orderStatus(raw, 'wix')`), up to 3 thumbs
// +N, Money total, order date, ship-by while it still has to ship, tracking (copy) and "Open order" only
// when the local join found the order (`kxOrderId`).
import Box from '@mui/material/Box';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Thumb } from '@/components/ds/data/Thumb';
import { CopyText } from '@/components/ds/format/CopyText';
import { DateText } from '@/components/ds/format/DateText';
import { Money } from '@/components/ds/format/Money';
import { ShipBy } from '@/components/ds/format/ShipBy';
import { Button } from '@/components/ds/inputs/Button';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { Bone } from '@/components/ds/state/Skeletons';
import { isClosedOrderStatus, orderStatus } from '@/lib/ds/status/orders';
import { neutral as n, font, type as typeScale } from '@/lib/ds/tokens';
import { ordersHref } from '@/lib/nav/links';
import type { OrderContext, OrderContextResponse } from '@/types/messages';
import { jsonFetcher, MESSAGES_API } from './useThread';

export const ORDER_THUMBS_MAX = 3;

export function orderContextUrl(contactId: string): string {
  return `${MESSAGES_API}?action=orderContext&contactId=${encodeURIComponent(contactId)}`;
}

/** "Open order" target (lib/nav/links.ts): Orders `view=all&open=<id>` (OrderPanel). */
export function orderHref(kxOrderId: string): string {
  return ordersHref('order', kxOrderId);
}

export interface UseOrderContextResult {
  orders: OrderContext[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/** Shared by the rail, the mobile summary row and the composer's `{order}` fill (SWR dedupes). */
export function useOrderContext(contactId: string | null | undefined): UseOrderContextResult {
  const { data, error, mutate } = useSWR<OrderContextResponse>(contactId ? orderContextUrl(contactId) : null, jsonFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  });
  return {
    orders: Array.isArray(data?.orders) ? data!.orders : [],
    loading: !!contactId && !data && !error,
    error: !!error && !data,
    retry: () => void mutate(),
  };
}

export interface OrderContextListProps {
  contactId: string | null | undefined;
  now?: Date;
}

function OrderSkeleton() {
  return (
    <Box data-testid="order-context-loading" sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <Bone w="40%" h={14} />
      <Box sx={{ display: 'flex', gap: '4px' }}>
        <Bone w={32} h={32} />
        <Bone w={32} h={32} />
      </Box>
      <Bone w="60%" h={12} />
    </Box>
  );
}

export function OrderContextRow({ order, now }: { order: OrderContext; now?: Date }) {
  const t = useTranslations('messages.context');
  const status = orderStatus(order.status, 'wix');
  const items = Array.isArray(order.items) ? order.items : [];
  const shown = items.slice(0, ORDER_THUMBS_MAX);
  const more = items.length - shown.length;
  const [capSize, capLine] = typeScale.caption;
  const [denseSize, denseLine] = typeScale.dense;
  const orderLabel = `#${order.orderNumber}`;

  return (
    <Box data-testid="order-context-row" sx={{ display: 'flex', flexDirection: 'column', gap: '6px', py: '12px', '& + &': { borderTop: `1px solid ${n[100]}` } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Box sx={{ flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: denseSize, lineHeight: `${denseLine}px`, color: n[900] }}>
          {orderLabel}
        </Box>
        <StatusPill domain="order" status={status} raw={order.status} size="sm" />
      </Box>
      {shown.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
          {shown.map((it, i) => (
            <Thumb key={`${it.name}-${i}`} src={it.imageUrl} alt={it.name} size={32} />
          ))}
          <Box sx={{ ml: '4px', minWidth: 0, flex: 1, fontSize: denseSize, lineHeight: `${denseLine}px`, color: n[700], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {shown[0]?.name}
            {more > 0 && (
              <Box component="span" sx={{ color: n[500] }}>
                {' '}
                {t('moreItems', { count: more })}
              </Box>
            )}
          </Box>
        </Box>
      )}
      <Box sx={{ fontSize: capSize, lineHeight: `${capLine}px`, color: n[600] }}>
        <Money amount={order.totalAmount} currency={order.currency} />
        {order.createdDate && (
          <>
            {' · '}
            <DateText value={order.createdDate} mode="date" now={now} />
          </>
        )}
      </Box>
      {order.shipByDate && !isClosedOrderStatus(status) && (
        <Box sx={{ fontSize: capSize, lineHeight: `${capLine}px` }}>
          <ShipBy date={order.shipByDate} now={now} />
        </Box>
      )}
      {order.trackingNumber && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: capSize, lineHeight: `${capLine}px`, color: n[600], minWidth: 0 }}>
          <span>{t('tracking')}</span>
          <CopyText value={order.trackingNumber} mono truncate={18} />
        </Box>
      )}
      {order.kxOrderId && (
        <Box>
          <Button variant="secondary" size="sm" href={orderHref(order.kxOrderId)} data-testid="open-order">
            {t('openOrder')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

export function OrderContextList({ contactId, now }: OrderContextListProps) {
  const t = useTranslations('messages.context');
  const { orders, loading, error, retry } = useOrderContext(contactId);
  const [capSize, capLine] = typeScale.caption;

  if (!contactId) {
    return <Box sx={{ fontSize: capSize, lineHeight: `${capLine}px`, color: n[500] }}>{t('noOrders')}</Box>;
  }
  if (loading) return <OrderSkeleton />;
  if (error) {
    return <ErrorState variant="inline" title={t('ordersError')} onRetry={retry} data-testid="order-context-error" />;
  }
  if (orders.length === 0) {
    return (
      <Box data-testid="order-context-empty" sx={{ fontSize: capSize, lineHeight: `${capLine}px`, color: n[500] }}>
        {t('noOrders')}
      </Box>
    );
  }
  return (
    <Box data-testid="order-context-list" sx={{ mt: '-12px' }}>
      {orders.map((o) => (
        <OrderContextRow key={o.orderNumber} order={o} now={now} />
      ))}
    </Box>
  );
}

export default OrderContextList;

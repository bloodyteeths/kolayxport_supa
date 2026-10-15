// components/domain/orders/OrdersEmptyState.tsx (orders G2) — the empty states of the Orders list (orders §7.1).
//   first use (no orders ever AND no connected store) · filters/search match nothing · a view queue is done.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { icons } from '@/lib/ds/icons';
import { CONNECTIONS_HREF } from '@/lib/nav/navConfig';
import type { OrderViewKey } from './ordersFilters';

export type OrdersEmptyKind = 'first-use' | 'no-results' | 'view-done';

export type OrdersEmptyInput = {
  view: OrderViewKey;
  /** The current page has no rows. */
  empty: boolean;
  /** Any filter, search or explicit date differs from the view defaults. */
  filtered: boolean;
  /** `anyMarketplace` from useConnections (undefined = unknown). */
  anyStoreConnected: boolean | undefined;
};

/** Which empty state applies (pure, unit-tested). Unknown connection state never shows first-use. */
export function ordersEmptyKind(i: OrdersEmptyInput): OrdersEmptyKind | null {
  if (!i.empty) return null;
  if (i.filtered) return 'no-results';
  // No store connected and nothing to show: first use (manual orders alone keep the list non-empty).
  if (i.anyStoreConnected === false) return 'first-use';
  return 'view-done';
}

export type OrdersEmptyStateProps = {
  kind: OrdersEmptyKind;
  view: OrderViewKey;
  query?: string;
  onClearFilters(): void;
  connectHref?: string;
  'data-testid'?: string;
};

const DONE_KEY: Partial<Record<OrderViewKey, string>> = {
  to_ship: 'empty.done.toShip',
  overdue: 'empty.done.overdue',
  problems: 'empty.done.problems',
};

export function OrdersEmptyState({ kind, view, query, onClearFilters, connectHref = CONNECTIONS_HREF, 'data-testid': testId = 'orders-empty' }: OrdersEmptyStateProps) {
  const t = useTranslations('orders');

  if (kind === 'first-use') {
    return (
      <EmptyState
        kind="first-use"
        icon={icons.order}
        title={t('empty.firstUse.title')}
        body={t('empty.firstUse.body')}
        action={{ id: 'connectStore', label: t('empty.firstUse.action'), icon: icons.add, href: connectHref }}
        data-testid={`${testId}-first-use`}
      />
    );
  }

  if (kind === 'no-results') {
    return (
      <EmptyState
        kind="no-results"
        title={query ? t('empty.noResultsSearch', { query }) : t('empty.noResults.title')}
        body={query ? t('toolbar.searchAllDates') : undefined}
        action={{ id: 'clearFilters', label: t('empty.noResults.action'), onClick: onClearFilters }}
        data-testid={`${testId}-no-results`}
      />
    );
  }

  // View queue is empty. "Label created" reads as no-results (nothing waiting), the work queues as done.
  if (view === 'label_created') {
    return <EmptyState kind="no-results" title={t('empty.labelCreated')} data-testid={`${testId}-label-created`} />;
  }
  const doneKey = DONE_KEY[view];
  if (doneKey) return <EmptyState kind="done" title={t(doneKey)} data-testid={`${testId}-done-${view}`} />;
  return <EmptyState kind="no-results" title={t('empty.noResults.title')} data-testid={`${testId}-none-${view}`} />;
}

export default OrdersEmptyState;

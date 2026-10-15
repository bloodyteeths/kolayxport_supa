// components/domain/billing/InvoicesCard.tsx — settings §9.6. Last 5 invoices; "View all" (`?invoices=all`)
// switches to pages of 20 with "Load more" (`starting_after`). Row click opens the hosted invoice. Past due:
// the open invoice is sorted first and its inline action is "Pay now". Never rendered for Shopify
// (shopify_free) or unknown accounts — the parent decides with `billingView().invoices`, and `useInvoices` is
// disabled for them, so no request is made either. Enterprise (neutral, no Stripe actions) is the one
// exception: invoices are shown when any exist (§9.3 enterprise row).
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { DataTable, type Column } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { CopyText } from '@/components/ds/format';
import { ActionButton } from '@/components/ds/overlay';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ds/state';
import type { ActionSpec } from '@/components/ds/types/actions';
import { icons } from '@/lib/ds/icons';
import { invoiceStatus } from '@/lib/ds/status/billing';
import { useFormatters } from '@/lib/format';
import { useInvoices } from '@/lib/billing/useInvoices';
import type { Invoice } from '@/lib/billing/types';
import { CardHeader } from './parts';

export const INVOICES_PREVIEW = 5;
export const INVOICES_PAGE = 20;

export interface InvoicesCardProps {
  /** false → render nothing and make no request (neutral / unknown accounts). */
  enabled: boolean;
  /** `ifAny`: render only once the list is known to be non-empty (trial without a Stripe customer). */
  onlyIfAny?: boolean;
  /** Full list (`?invoices=all`). */
  all: boolean;
  onViewAll: () => void;
  /** past_due: open invoice first, inline "Pay now". */
  openFirst?: boolean;
}

/** Pure: open invoices first (stable), when asked. */
export function sortInvoices(list: Invoice[], openFirst: boolean): Invoice[] {
  if (!openFirst) return list;
  return [...list.filter((i) => i.status === 'open'), ...list.filter((i) => i.status !== 'open')];
}

function openUrl(url: string | null) {
  if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
}

export function InvoicesCard({ enabled, onlyIfAny, all, onViewAll, openFirst = false }: InvoicesCardProps) {
  const t = useTranslations('billing');
  const f = useFormatters();
  const inv = useInvoices({ limit: all ? INVOICES_PAGE : INVOICES_PREVIEW, enabled });
  const rows = useMemo(() => sortInvoices(inv.invoices, openFirst), [inv.invoices, openFirst]);

  const columns = useMemo<Column<Invoice>[]>(() => [
    { key: 'date', header: t('invoices.col.date'), type: 'date', value: (r) => r.date, mobile: 'meta', width: 110 },
    {
      key: 'number',
      header: t('invoices.col.number'),
      mobile: 'subtitle',
      render: (r) => (r.number ? <CopyText value={r.number} mono /> : '—'),
    },
    {
      key: 'plan',
      header: t('invoices.col.plan'),
      mobile: 'title',
      render: (r) => {
        const range = r.periodStart && r.periodEnd ? `${f.date(r.periodStart)}–${f.date(r.periodEnd)}` : null;
        if (r.plan && range) return t('invoices.period', { plan: t(`planName.${r.plan}`), start: f.date(r.periodStart), end: f.date(r.periodEnd) });
        if (r.plan) return t(`planName.${r.plan}`);
        return range ?? '—';
      },
    },
    { key: 'amount', header: t('invoices.col.amount'), type: 'money', align: 'right', value: (r) => r.amount, currency: (r) => r.currency, mobile: 'trailing' },
    {
      key: 'status',
      header: t('invoices.col.status'),
      mobile: 'status',
      render: (r) => <StatusPill domain="invoice" status={invoiceStatus(r.status)} raw={r.status} />,
    },
  ], [t, f]);

  if (!enabled) return null;
  if (onlyIfAny && inv.state !== 'ready') return null;

  const inlineAction = (r: Invoice): ActionSpec | null => {
    if (openFirst && r.status === 'open' && r.hostedInvoiceUrl) {
      return { id: 'pay-now', label: t('invoices.payNow'), onClick: () => openUrl(r.hostedInvoiceUrl) };
    }
    if (r.invoicePdf) return { id: 'download', label: t('invoices.download'), icon: icons.download, onClick: () => openUrl(r.invoicePdf) };
    return null;
  };
  const rowActions = (r: Invoice): ActionSpec[] =>
    r.hostedInvoiceUrl ? [{ id: 'open', label: t('invoices.open'), icon: icons.externalLink, onClick: () => openUrl(r.hostedInvoiceUrl) }] : [];

  const countKnown = all && !inv.hasMore && inv.state === 'ready';
  const title = countKnown ? `${t('invoices.title')} · ${f.num(rows.length)}` : t('invoices.title');
  const viewAll: ActionSpec | null = !all && (inv.hasMore || rows.length >= INVOICES_PREVIEW)
    ? { id: 'view-all-invoices', label: t('invoices.viewAll'), onClick: onViewAll }
    : null;

  const tableState = inv.state === 'ready' || inv.state === 'stale' ? 'ready' : inv.state === 'empty' ? 'empty' : inv.state === 'error' ? 'error' : 'loading';

  return (
    <Section variant="card" data-testid="billing-invoices-card">
      <CardHeader title={title} trailing={viewAll ? <ActionButton action={viewAll} variant="ghost" size="sm" /> : null} />
      <div style={{ marginTop: 12 }}>
        <DataTable<Invoice>
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          state={tableState}
          density="compact"
          columnStateKey="billing-invoices"
          ariaLabel={t('invoices.title')}
          stickyHeader={false}
          onRowOpen={(r) => openUrl(r.hostedInvoiceUrl)}
          inlineAction={inlineAction}
          rowActions={rowActions}
          loading={<TableSkeleton rows={3} columns={5} density="compact" />}
          empty={<EmptyState kind="first-use" icon={icons.billing} compact title={t('invoices.empty.title')} body={t('invoices.empty.body')} />}
          error={<ErrorState variant="inline" title={t('invoices.loadFailed')} onRetry={inv.retry} />}
          pagination={all && (inv.hasMore || inv.loadingMore) ? { mode: 'cursor', hasMore: inv.hasMore, onLoadMore: inv.loadMore, loading: inv.loadingMore } : undefined}
        />
        {inv.loadMoreFailed ? (
          <ErrorState variant="inline" title={t('invoices.loadMoreFailed')} onRetry={inv.loadMore} />
        ) : null}
      </div>
    </Section>
  );
}

export default InvoicesCard;

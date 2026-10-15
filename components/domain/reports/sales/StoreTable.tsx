// components/domain/reports/sales/StoreTable.tsx — finance-analytics §2.1 "Sales by store" (M9 Group C).
// Store · Orders · Units · Revenue (original, per currency, never summed) · Revenue (display currency, ≈ when
// converted) · Share (revenue share bar, DS A4) · Avg order. Stores are bucketed by `canonicalStore()` on the server
// (B8): Etsy shops are their own rows. Store identity is a real logo (`LogoTile`), never a chart color. The row opens
// nothing; the store name links to Orders for the same store and range, with the exact raw `Order.marketplace`
// values behind the row (the Orders filter is an exact match; a canonical row can merge "Amazon"/"amazon"/"eBay US").
// When those values are not known exactly the name is plain text, never a link to a partial list. Mobile: cards.
import * as React from 'react';
import Box from '@mui/material/Box';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { DataTable } from '@/components/ds/data/DataTable';
import type { Column } from '@/components/ds/data/dataTableParts';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Section } from '@/components/ds/page/Section';
import { Money } from '@/components/ds/format/Money';
import { getLogo } from '@/lib/ds/logos';
import { useFormatters, type Formatters } from '@/lib/format';
import { accent, neutral, px, space } from '@/lib/ds/tokens';
import { ordersHref, type LinkFlags } from '@/lib/nav/links';
import type { OrderViewKey } from '@/lib/orders/types';
import type { SalesStoreRow } from '@/lib/reports/useSalesReport';

// ── links into Orders (shared with StatusSummary) ──────────────────────────────────────────────────────

export interface ReportOrdersLink {
  from: string;
  to: string;
  /** Exact `Order.marketplace` filter value(s) (Orders store filter, one repeated `store=` per value). */
  store?: string | readonly string[] | null;
  /** DS order status key (Orders status filter). */
  status?: string | null;
}

const LEGACY_VIEW_BY_STATUS: Record<string, OrderViewKey> = {
  to_ship: 'to_ship',
  overdue: 'overdue',
  shipped: 'shipped',
  delivered: 'shipped',
  problem: 'problems',
};

/**
 * Pure: Orders for a store/status in the same range. Orders v2 (flag `orders`) takes the range and filters
 * (`view=all&store&status&from&to&preset=custom`); the legacy page has no range parameters, so it gets the closest
 * view through `lib/nav/links.ordersHref`.
 */
export function reportOrdersHref(link: ReportOrdersLink, flags: LinkFlags): string {
  const stores = (typeof link.store === 'string' ? [link.store] : link.store ?? []).filter((v) => v.trim() !== '');
  if (flags.orders) {
    const sp = new URLSearchParams({ view: 'all' });
    for (const v of stores) sp.append('store', v);
    if (link.status) sp.append('status', link.status);
    sp.set('from', link.from);
    sp.set('to', link.to);
    sp.set('preset', 'custom');
    return `/app/labels?${sp.toString()}`;
  }
  const view = (link.status && LEGACY_VIEW_BY_STATUS[link.status]) || 'all';
  // The legacy page filters one store; callers only pass several values with Orders v2 (`storeOrdersHref`).
  return ordersHref(view, null, stores[0] ?? null, null, {}, flags);
}

// ── store naming ────────────────────────────────────────────────────────────────────────────────────────

/** Pure: the display name of a store row (shop name, else the marketplace's proper noun, else "Manual orders"). */
export function storeDisplayName(row: Pick<SalesStoreRow, 'marketplace' | 'shopName' | 'key'>, manualLabel: string): string {
  if (row.shopName) return row.shopName;
  if (row.marketplace === 'manual') return manualLabel;
  if (row.marketplace === 'other') return row.key.replace(/^other:?/, '') || '—';
  return getLogo(row.marketplace)?.name ?? row.marketplace;
}

/**
 * Pure: the exact `Order.marketplace` values Orders must filter by for this row, or null when they are not known.
 * The API's `rawMarketplaces` wins. Without it only a shop/aggregator row is exact (`shopName` is the raw value);
 * a plain marketplace or Manual bucket may merge several spellings ("Amazon", "amazon", "Amazon Channel"), and a
 * guessed display name would open an empty or partial Orders list.
 */
export function storeOrdersValues(row: Pick<SalesStoreRow, 'shopName'> & { rawMarketplaces?: string[] | null }): string[] | null {
  if (row.rawMarketplaces?.length) return row.rawMarketplaces;
  if (row.rawMarketplaces == null && row.shopName) return [row.shopName];
  return null;
}

/** Pure: the store-name link, or null (plain text) when the exact values are unknown or the legacy page cannot take them. */
export function storeOrdersHref(
  row: Pick<SalesStoreRow, 'shopName'> & { rawMarketplaces?: string[] | null },
  range: { from: string; to: string },
  flags: LinkFlags,
): string | null {
  const values = storeOrdersValues(row);
  if (!values) return null;
  if (!flags.orders && values.length > 1) return null;
  return reportOrdersHref({ ...range, store: values }, flags);
}

/** Pure: original per-currency revenue, never summed ("$2.910,10 · €410,00"). */
export function originalRevenueText(row: Pick<SalesStoreRow, 'byCurrency'>, fmt: Pick<Formatters, 'money'>): string {
  const parts = row.byCurrency.filter((c) => c.revenue !== 0);
  if (!parts.length) return '—';
  return parts.map((c) => fmt.money(c.revenue, c.currency)).join(' · ');
}

/**
 * Pure: is this row's display revenue converted (it has revenue in another currency that had a rate)? Currencies in
 * `excluded` (`fx.excluded`, no rate) were left out, not converted.
 */
export function rowConverted(row: Pick<SalesStoreRow, 'byCurrency'>, currency: string, excluded: readonly string[] = []): boolean {
  return row.byCurrency.some((c) => c.revenue !== 0 && c.currency !== currency && !excluded.includes(c.currency));
}

export interface StoreTableProps {
  rows: SalesStoreRow[];
  currency: string;
  /** FX tooltip for converted cells. */
  fxNote?: string;
  /** `fx.excluded` currencies (no rate): left out of the converted revenue, never marked ≈. */
  excludedCurrencies?: readonly string[];
  from: string;
  to: string;
  flags: LinkFlags;
  /** Empty-state slot when the store filter excludes everything. */
  empty?: React.ReactNode;
}

export function StoreTable({ rows, currency, fxNote, excludedCurrencies = [], from, to, flags, empty }: StoreTableProps) {
  const t = useTranslations('reports');
  const fmt = useFormatters();
  const manual = t('sales.stores.manual');
  const symbol = React.useMemo(() => currencySymbol(currency, fmt.intlLocale), [currency, fmt.intlLocale]);

  const storeCell = (r: SalesStoreRow) => {
    const name = storeDisplayName(r, manual);
    const href = storeOrdersHref(r, { from, to }, flags);
    const mpName = r.marketplace !== 'manual' && r.marketplace !== 'other' && r.shopName ? getLogo(r.marketplace)?.name ?? null : null;
    const label = (
      <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: neutral[900] }}>
          {name}
        </Box>
        {mpName ? (
          <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>
            {mpName}
          </Box>
        ) : null}
      </Box>
    );
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: px(space[2]), minWidth: 0 }}>
        {r.marketplace === 'manual' || r.marketplace === 'other' ? (
          <Box component="span" aria-hidden sx={{ width: 20, flexShrink: 0 }} />
        ) : (
          <LogoTile brand={r.marketplace} size={20} />
        )}
        {href ? (
          <Box
            component={NextLink}
            href={href}
            sx={{ color: 'inherit', textDecoration: 'none', minWidth: 0, '&:hover span:first-of-type': { textDecoration: 'underline' }, '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: 2 } }}
            data-testid={`store-link-${r.key}`}
          >
            {label}
          </Box>
        ) : (
          label
        )}
      </Box>
    );
  };

  const columns: Column<SalesStoreRow>[] = [
    { key: 'store', header: t('sales.stores.store'), mobile: 'title', render: storeCell, minWidth: 200 },
    { key: 'orders', header: t('sales.stores.orders'), type: 'number', mobile: 'meta' },
    { key: 'units', header: t('sales.stores.units'), type: 'number', mobile: 'meta' },
    {
      key: 'revenueOriginal',
      header: t('sales.stores.revenueOriginal'),
      align: 'right',
      mobile: 'subtitle',
      render: (r) => <span className="tnum">{originalRevenueText(r, fmt)}</span>,
    },
    {
      key: 'revenue',
      header: t('sales.stores.revenueConverted', { symbol }),
      type: 'money',
      currency: () => currency,
      fxNote: (r) => (rowConverted(r, currency, excludedCurrencies) ? fxNote ?? null : null),
      // A store with orders left out (no rate) shows a partial total: say so under the amount (as the Revenue KPI does).
      render: (r) => {
        const conv = rowConverted(r, currency, excludedCurrencies);
        return (
          <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Money amount={r.revenue} currency={currency} approx={conv} fxNote={conv ? fxNote : undefined} />
            {r.excludedOrders > 0 ? (
              <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }} data-testid={`store-excluded-${r.key}`}>
                {t('sales.kpi.excludes', { count: r.excludedOrders })}
              </Box>
            ) : null}
          </Box>
        );
      },
      mobile: 'trailing',
    },
    { key: 'share', header: t('sales.stores.share'), type: 'share', mobile: 'meta', width: 140 },
    {
      key: 'aov',
      header: t('sales.stores.aov'),
      type: 'money',
      currency: () => currency,
      fxNote: (r) => (rowConverted(r, currency, excludedCurrencies) ? fxNote ?? null : null),
      mobile: 'hidden',
      hideable: true,
    },
  ];

  return (
    <Section title={t('sales.stores.title')} data-testid="sales-stores">
      <DataTable<SalesStoreRow>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.key}
        state={rows.length ? 'ready' : 'empty'}
        empty={empty}
        columnStateKey="reports.sales.stores"
        ariaLabel={t('sales.stores.title')}
        stickyHeader={false}
      />
    </Section>
  );
}

/** "₺" / "$" / "€" for the converted column header (narrow symbol, never the ISO code). */
export function currencySymbol(currency: string, intlLocale: string): string {
  try {
    const part = new Intl.NumberFormat(intlLocale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

export default StoreTable;

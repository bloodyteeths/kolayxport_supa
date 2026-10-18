// Product finder "Top listings (48)" (research.md §5.1, §5.2): thumb · title (decoded) · price (Money) · favorites
// "(all time)" · age (from original_creation_timestamp, never the renew date) · shop. Row ⋯: Open on Etsy ↗ ·
// Use this listing as a starting point (prefill with its tags and title words; the creator's AI writes the title,
// never a verbatim copy). Row click opens the TopListingPanel. Mobile: cards (64 media · title · price ·
// "1,204 favorites (all time)").
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/ds/data';
import { FilterButton } from '@/components/ds/toolbar/FilterButton';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { ActionSpec } from '@/components/ds/page';
import type { ResearchMkt, SourceNoteProps, TopListing } from '@/lib/research/types';
import { PRODUCT_SORTS, type ProductSort } from '@/lib/research/hooks/useResearchProducts';
import { displayRevenue, type ListingSales } from '@/lib/research/hooks/useListingSales';
import { MKT_NAME } from '../ResearchLayout';
import { ApiSourceNote } from './ApiSourceNote';

export type TopListingsTableProps = {
  rows: TopListing[];
  mkt: ResearchMkt;
  /** Total competing listings (for "48 of 18,420"). */
  total: number | null;
  source?: SourceNoteProps;
  sort: ProductSort;
  onSortChange: (s: ProductSort) => void;
  onOpen: (row: TopListing) => void;
  onStartFrom: (row: TopListing) => void;
  loading?: boolean;
  /** Estimated monthly sales per listing id (Etsy; /api/research/sales). Absent = no sales columns. */
  sales?: Record<string, ListingSales>;
  salesLoading?: boolean;
};

/** Pure: compact age from days ("12 d", "5 mo", "2 y"); null = "—". */
export function ageParts(days: number | null): { unit: 'days' | 'months' | 'years'; count: number } | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  if (days < 60) return { unit: 'days', count: Math.round(days) };
  if (days < 730) return { unit: 'months', count: Math.round(days / 30.44) };
  return { unit: 'years', count: Math.floor(days / 365.25) };
}

export function TopListingsTable({ rows, mkt, total, source, sort, onSortChange, onOpen, onStartFrom, loading, sales, salesLoading }: TopListingsTableProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const ageText = (d: number | null) => {
    const a = ageParts(d);
    return a ? t(`top.age.${a.unit}`, { count: a.count }) : '—';
  };
  const favText = (n: number | null) => (n === null ? '—' : t('top.favoritesAll', { count: fmt.num(n) }));

  const salesText = (r: TopListing): string => {
    const s = sales?.[r.id];
    if (!s) return salesLoading ? '…' : '—';
    if (s.kind === 'pending') return '…';
    if (s.monthlySales != null && (s.kind === 'measured' || s.kind === 'estimated')) {
      // Whole sales: "~6/mo" (a fraction reads like false precision); under one a month → "<1".
      const shown = s.monthlySales < 1 ? '<1' : fmt.num(Math.round(s.monthlySales));
      return t('top.salesValue', { count: shown, kind: s.kind });
    }
    // An upper bound only informs when it is small: "up to 92/mo" on a day-old listing is the shop's total, not a hint.
    if (s.monthlySalesUpperBound != null && s.monthlySalesUpperBound <= 10) {
      return t('top.salesUpTo', { count: fmt.num(Math.max(1, Math.ceil(s.monthlySalesUpperBound))) });
    }
    return '—';
  };
  const revenueText = (r: TopListing): string => {
    const rev = displayRevenue(r, sales?.[r.id]);
    return rev ? fmt.money(rev.amount, rev.currency, { approx: true }) : sales?.[r.id] || !salesLoading ? '—' : '…';
  };
  const salesColumns: Column<TopListing>[] = sales
    ? [
        { key: 'sales', header: t('top.col.sales'), width: 130, align: 'right', render: salesText, mobileRender: (r) => t('top.salesCard', { value: salesText(r) }), mobile: 'subtitle' },
        { key: 'revenue', header: t('top.col.revenue'), width: 120, align: 'right', render: revenueText, mobile: 'meta' },
      ]
    : [];

  // Trendyol: the marketplace's own signals instead of our estimates (order badge "100+", ratings count).
  const trendyolColumns: Column<TopListing>[] = mkt === 'trendyol'
    ? [
        { key: 'orders', header: t('top.col.orders'), width: 120, align: 'right', render: (r) => r.orderBadge ? t('top.ordersBadge', { badge: r.orderBadge }) : '—', mobile: 'subtitle' },
        { key: 'ratings', header: t('top.col.ratings'), width: 110, align: 'right', render: (r) => (r.ratingCount != null ? fmt.num(r.ratingCount) : '—'), mobile: 'meta' },
      ]
    : [];

  const columns: Column<TopListing>[] = [
    { key: 'thumb', header: '', type: 'thumb', width: 64, value: (r) => r.thumbUrl, thumbAlt: () => '', mobile: 'media' },
    {
      key: 'title',
      header: t('top.col.listing'),
      minWidth: 280,
      render: (r) => (
        <Typography variant="body2" sx={{ color: neutral[900], overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {r.title || '—'}
        </Typography>
      ),
      mobile: 'title',
    },
    { key: 'price', header: t('top.col.price'), type: 'money', width: 110, value: (r) => r.priceConverted?.amount ?? r.price?.amount ?? null, currency: (r) => r.priceConverted?.currency ?? r.price?.currency, mobile: 'subtitle' },
    ...salesColumns,
    ...trendyolColumns,
    {
      key: 'favorites',
      header: t('top.col.favorites'),
      width: 140,
      align: 'right',
      render: (r) => favText(r.favorites),
      mobileRender: (r) => (r.favorites === null ? '—' : t('top.favoritesCard', { count: fmt.num(r.favorites) })),
      mobile: 'meta',
    },
    { key: 'age', header: t('top.col.age'), width: 90, align: 'right', render: (r) => ageText(r.ageDays), mobile: 'meta' },
    { key: 'shop', header: t('top.col.shop'), width: 160, render: (r) => r.shop.name ?? '—', mobile: 'meta' },
  ];

  const rowActions = (r: TopListing): ActionSpec[] => [
    ...(r.url ? [{ id: 'open', label: t('top.openOn', { marketplace: MKT_NAME[mkt] }), icon: icons.externalLink, onClick: () => window.open(r.url as string, '_blank', 'noopener,noreferrer') }] : []),
    { id: 'start', label: t('top.startFrom'), icon: icons.ai, onClick: () => onStartFrom(r) },
  ];

  const sortOptions = PRODUCT_SORTS.map((s) => ({ value: s, label: t(`sort.${s.replace('.', '_')}`) }));

  return (
    <Box component="section" aria-labelledby="research-top-title" sx={{ mb: '24px' }} data-testid="research-top">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', mb: '8px', flexWrap: 'wrap' }}>
        <Typography id="research-top-title" variant="titleSm" component="h2" sx={{ flex: 1, m: 0 }}>
          {t('top.title', { count: rows.length })}
        </Typography>
        <FilterButton
          label={t('sort.label')}
          value={sort}
          options={sortOptions}
          required
          onChange={(v) => {
            const next = Array.isArray(v) ? v[0] : v;
            if (next && (PRODUCT_SORTS as readonly string[]).includes(next)) onSortChange(next as ProductSort);
          }}
          data-testid="research-sort"
        />
      </Box>
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        state={loading ? 'loading' : rows.length ? 'ready' : 'empty'}
        onRowOpen={onOpen}
        rowActions={rowActions}
        columnStateKey="kx.research.top"
        ariaLabel={t('top.title', { count: rows.length })}
      />
      {/* The SourceNote is a <p>; outside the DataTable caption (also a <p>) to keep valid nesting. */}
      <Box sx={{ mt: '8px' }}>
        <ApiSourceNote
          source={
            source
              ? { ...source, source: 'research.source.searchApiOrder', sourceParams: { marketplace: MKT_NAME[mkt] }, sample: rows.length, sampleTotal: total ?? undefined, excluded: undefined }
              : undefined
          }
          data-testid="research-top-source"
        />
      </Box>
    </Box>
  );
}

export default TopListingsTable;

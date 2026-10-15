// components/domain/overview/BestSellersCard.tsx (overview G6, §3.4) — "Best sellers (7 days)": a compact
// DataTable of the top 5 products by units in orders (grouped by SKU, product name when the SKU is empty).
// No checkbox, row actions or pagination. A row opens Orders searched for that product: there is no listing
// link (OrderItem has no listing id), so the caption says these are units in orders, not listing sales.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { DataTable, LogoTile, Thumb, type Column } from '@/components/ds/data';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { TableSkeleton } from '@/components/ds/state/Skeletons';
import { decodeEntities } from '@/lib/research/stats';
import { getLogo } from '@/lib/ds/logos';
import type { OverviewSummary } from '@/lib/overview/types';

export type BestSeller = NonNullable<OverviewSummary['topSellers']>['items'][number];

export interface BestSellersCardProps {
  topSellers: OverviewSummary['topSellers'] | undefined;
  /** First load (kept for parity with the other cards; the table shows its skeleton while no data). */
  loading?: boolean;
  failed: boolean;
  errorId?: string;
  onRetry: () => void;
  /** `ordersHref('search', null, null, q)` bound to the current flags. */
  searchHref: (q: string) => string;
}

/** Pure: the Orders search term for a row — the SKU, or the product name when the group key is the name. */
export function bestSellerQuery(item: Pick<BestSeller, 'key' | 'name'>): string {
  const name = decodeEntities(item.name).trim();
  const key = (item.key ?? '').trim();
  if (!key || key === name.toLowerCase()) return name;
  return key;
}

export function BestSellersCard({ topSellers, failed, errorId, onRetry, searchHref }: BestSellersCardProps) {
  const t = useTranslations('overview');
  const router = useRouter();

  const columns = React.useMemo<Column<BestSeller>[]>(
    () => [
      {
        key: 'thumb',
        header: '',
        type: 'thumb',
        width: 48,
        mobile: 'media',
        render: (r) => <Thumb src={r.image} alt={decodeEntities(r.name)} size={32} />,
      },
      {
        key: 'name',
        header: t('best.colProduct'),
        mobile: 'title',
        render: (r) => (
          <Box component="span" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {decodeEntities(r.name)}
          </Box>
        ),
      },
      {
        key: 'channel',
        header: '',
        width: 32,
        mobile: 'subtitle',
        render: (r) => <LogoTile brand={r.channel} size={16} label={getLogo(r.channel)?.name ?? r.channel} />,
      },
      {
        key: 'units',
        header: t('best.colUnits'),
        align: 'right',
        width: 96,
        mobile: 'trailing',
        render: (r) => <span className="tnum">{t('best.units', { count: r.units })}</span>,
      },
    ],
    [t],
  );

  const items = topSellers?.items ?? [];
  const state = topSellers ? (items.length ? 'ready' : 'empty') : failed ? 'error' : 'loading';

  return (
    <Section variant="card" title={t('best.title')} data-testid="overview-best">
      <DataTable<BestSeller>
        rows={items}
        columns={columns}
        getRowId={(r) => r.key}
        state={state}
        density="compact"
        columnStateKey="overview.bestSellers"
        ariaLabel={t('best.title')}
        caption={state === 'ready' ? t('best.source') : undefined}
        stickyHeader={false}
        onRowOpen={(r) => void router.push(searchHref(bestSellerQuery(r)))}
        loading={<TableSkeleton rows={5} thumb />}
        empty={<EmptyState kind="no-results" compact title={t('best.empty')} icon={null} />}
        error={<ErrorState variant="inline" title={t('best.loadFailed')} errorId={errorId} onRetry={onRetry} />}
      />
    </Section>
  );
}

export default BestSellersCard;

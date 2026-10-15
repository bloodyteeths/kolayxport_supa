// Product finder row detail (research.md §5.1 "Row click opens a SidePanel md"): the listing's tags and price, the
// shop's public counters (Etsy `get_public_shop`, read-only, lifetime numbers labelled "(all time)") and the row
// actions. Primary: "Use this listing as a starting point" (prefill; the creator's AI writes the title).
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { KeyValueList, Thumb } from '@/components/ds/data';
import { Money } from '@/components/ds/format/Money';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import { decodeEntities } from '@/lib/research/stats';
import type { ResearchMkt, TopListing } from '@/lib/research/types';
import { MKT_NAME } from '../ResearchLayout';
import { ageParts } from './TopListingsTable';

type PublicShop = {
  shop_name: string;
  num_sales: number;
  review_count: number;
  review_average: number;
  listing_active_count: number;
  created_timestamp: number;
};

export type TopListingPanelProps = {
  row: TopListing | null;
  mkt: ResearchMkt;
  onClose: () => void;
  onStartFrom: (row: TopListing) => void;
  onPrev?: () => void;
  onNext?: () => void;
};

/**
 * eBay item → the Shop tracker's "Watch an eBay item" (prefilled `?add=` with the canonical item link), or null for
 * other marketplaces / links without an item id (pure). Port of the legacy eBay research "Track product" button.
 */
export function watchItemHref(mkt: ResearchMkt, url: string | null | undefined): string | null {
  if (mkt !== 'ebay' || !url) return null;
  const m = /ebay\.[a-z.]+\/itm\/(?:[^/?#]+\/)?(\d{9,15})/i.exec(url);
  if (!m) return null;
  return `/app/research/shops?mkt=ebay&add=${encodeURIComponent(`https://www.ebay.com/itm/${m[1]}`)}`;
}

async function fetchShop(url: string): Promise<PublicShop> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`shop ${res.status}`);
  return res.json();
}

export function TopListingPanel({ row, mkt, onClose, onStartFrom, onPrev, onNext }: TopListingPanelProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const shopKey = row && mkt === 'etsy' && row.shop.id ? `/api/clawd/etsy?action=get_public_shop&target_shop_id=${encodeURIComponent(row.shop.id)}` : null;
  const shop = useSWR<PublicShop>(shopKey, fetchShop, { revalidateOnFocus: false, dedupingInterval: 600_000, shouldRetryOnError: false });
  const age = row ? ageParts(row.ageDays) : null;
  const watchHref = row ? watchItemHref(mkt, row.url) : null;

  return (
    <SidePanel
      open={Boolean(row)}
      onClose={onClose}
      size="md"
      title={row?.title || '—'}
      leading={row ? <Thumb src={row.thumbUrl} alt="" size={40} /> : undefined}
      meta={row ? [row.shop.name, age ? t(`top.age.${age.unit}`, { count: age.count }) : null].filter(Boolean).join(' · ') : undefined}
      onPrev={onPrev}
      onNext={onNext}
      primary={row ? { id: 'start', label: t('top.startFrom'), icon: icons.ai, onClick: () => onStartFrom(row) } : undefined}
      secondary={row?.url ? { id: 'open', label: t('top.openOn', { marketplace: MKT_NAME[mkt] }), icon: icons.externalLink, onClick: () => window.open(row.url as string, '_blank', 'noopener,noreferrer') } : undefined}
      overflow={watchHref ? [{ id: 'watchItem', label: t('top.watchItem'), href: watchHref }] : undefined}
      data-testid="research-top-panel"
    >
      {row ? (
        <>
          <SidePanelSection id="research-top-price" title={t('top.col.price')}>
            {row.price ? <Money amount={row.price.amount} currency={row.price.currency} /> : <Typography component="span">—</Typography>}
            {row.favorites !== null ? (
              <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>{t('top.favoritesCard', { count: fmt.num(row.favorites) })}</Typography>
            ) : null}
          </SidePanelSection>
          {row.tags.length ? (
            <SidePanelSection id="research-top-tags" title={t('top.tags', { count: row.tags.length })}>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {row.tags.map((tag) => (
                  <Box component="li" key={tag} sx={{ px: '8px', py: '2px', borderRadius: `${radius.full}px`, bgcolor: neutral[100] }}>
                    <Typography variant="body2" component="span">{tag}</Typography>
                  </Box>
                ))}
              </Box>
            </SidePanelSection>
          ) : null}
          {shopKey ? (
            <SidePanelSection id="research-top-shop" title={t('top.shop')}>
              {shop.error ? (
                <ErrorState variant="inline" title={t('top.shopFailed')} onRetry={() => void shop.mutate()} />
              ) : !shop.data ? (
                <ListSkeleton rows={3} leading="none" />
              ) : (
                <KeyValueList
                  items={[
                    { label: t('top.shopName'), value: decodeEntities(shop.data.shop_name) || '—' },
                    { label: t('top.shopSales'), value: fmt.num(shop.data.num_sales) },
                    { label: t('top.shopReviews'), value: shop.data.review_count ? t('top.shopReviewsValue', { rating: Math.round(shop.data.review_average * 10) / 10, count: fmt.num(shop.data.review_count) }) : '—' },
                    { label: t('top.shopActive'), value: fmt.num(shop.data.listing_active_count) },
                    ...(shop.data.created_timestamp ? [{ label: t('top.shopSince'), value: fmt.date(new Date(shop.data.created_timestamp * 1000)) }] : []),
                  ]}
                />
              )}
            </SidePanelSection>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

export default TopListingPanel;

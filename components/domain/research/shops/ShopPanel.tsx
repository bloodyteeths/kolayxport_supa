// components/domain/research/shops/ShopPanel.tsx (research R3-B) — one watched shop (research.md §8.1): SidePanel lg
// (full-height sheet on mobile), the table stays mounted, ‹ › between rows.
//
// Header: shop · since · ★ rating (reviews). Body: "Sales per day, 30 days" (Chart line, single axis; points dropped
// by guard 7 are gaps, never zeros) · "New listings this week (N)" → [Research this idea] (Product finder prefilled
// with the title's lead phrase) · [Draft a similar listing] (prefill with OUR AI title: no title is passed, only
// keywords + their tags) · "Fastest-gaining listings" (favorites Δ 7 days Measured, `~` share of shop sales
// Estimate) · "Tags they use that you don't" → Keyword explorer · Alerts (3 switches).
// Footer primary: "Compare with my listing" (listing picker → Product finder compare). Nothing here writes to a
// marketplace: the only writes are the watch's alert rules and its removal (KolayXport rows).
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Avatar } from '@/components/ds/data/Avatar';
import { Thumb } from '@/components/ds/data/Thumb';
import { Chart } from '@/components/ds/data/Chart';
import { useDsFormat } from '@/components/ds/data/fmt';
import { Money } from '@/components/ds/format/Money';
import { Metric } from '@/components/ds/research/Metric';
import { Button } from '@/components/ds/inputs/Button';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { ApiSourceNote } from '@/components/domain/research/products/ApiSourceNote';
import { icons } from '@/lib/ds/icons';
import { neutral as n, radius } from '@/lib/ds/tokens';
import type { Guarded } from '@/lib/research/types';
import { useWatchDetail, type WatchDetail, type WatchListingLite, type WatchSummary } from '@/lib/research/hooks/useWatches';
import { MKT_NAME } from '../ResearchLayout';
import { AlertSwitches } from './AlertSwitches';
import { keywordHref, notYetKey, researchIdeaHref, salesSeries, sinceYear, usable, type ShopMkt, type ShopT } from './shopModel';

export type ShopPanelProps = {
  row: WatchSummary | null;
  open: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** "Compare with my listing" (opens the picker). */
  onCompare: () => void;
  /** "Draft a similar listing" (writes the prefill and navigates). */
  onDraftSimilar: (listing: WatchListingLite, row: WatchSummary) => void;
  /** Stop watching (confirm lives in the page). */
  onRemove: (row: WatchSummary) => void;
  /** Alert rules saved (revalidate the list). */
  onAlertsSaved?: () => void;
  /** R3-A `alertsAvailable` (BR-7 deployed). */
  alertsAvailable?: boolean;
  /** The viewer has a connected Etsy shop (tag gap is computed against it). */
  etsyConnected?: boolean;
  go: (href: string, opts?: { newTab?: boolean }) => void;
};

const guardOf = (g: Guarded<number>) => ({ ok: g.guard.ok, reasonKey: g.guard.reasonKey, reasonParams: g.guard.reasonParams });
/** A passed value's server qualifier ("over 6.5 days"), shown in its tooltip. */
const qualifier = (g: Guarded<number>, t: ShopT): string | undefined =>
  g.guard.ok && g.guard.reasonKey && t.has(g.guard.reasonKey) ? t(g.guard.reasonKey, g.guard.reasonParams ?? {}) : undefined;
const NEW_MAX = 12;
const FAST_MAX = 5;
const TAGS_MAX = 20;

export function ShopPanel({ row, open, onClose, onPrev, onNext, onCompare, onDraftSimilar, onRemove, onAlertsSaved, alertsAvailable = true, etsyConnected = true, go }: ShopPanelProps) {
  const t = useTranslations() as unknown as ShopT;
  const fmt = useDsFormat();
  const detail = useWatchDetail(open && row ? row.id : null, row);

  if (!row) return null;
  const mkt: ShopMkt = row.marketplace === 'ebay' ? 'ebay' : 'etsy';
  const d = detail.data;
  // Header: the detail's `shop` block, else the list row's shop info.
  const since = sinceYear(d?.shop.since ?? row.shop?.openedAt ?? null);
  const rating = d?.shop.rating ?? row.shop?.reviewAverage ?? null;
  const reviews = d?.shop.reviewCount ?? row.shop?.reviewCount ?? null;
  const metaParts: string[] = [];
  if (since !== null) metaParts.push(t('research.shops.since', { year: String(since) }));
  if (rating != null && reviews != null && reviews > 0) {
    metaParts.push(t('research.shops.rating', { rating: fmt.num(rating, { decimals: 1 }), count: fmt.num(reviews) }));
  }
  const shopUrl = row.url ?? row.shop?.url ?? null;
  if (row.createdAt) metaParts.push(t('research.shops.watchingSince', { date: fmt.date(row.createdAt) }));

  const overflow = row.capabilities.remove
    ? [{ id: 'shop-remove', label: t('research.shops.remove'), icon: icons.delete, tone: 'danger' as const, onClick: () => onRemove(row) }]
    : [];

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="lg"
      title={row.label}
      leading={<Avatar name={row.label} src={row.iconUrl ?? row.shop?.iconUrl ?? null} size={40} />}
      meta={metaParts.join(' · ') || undefined}
      onPrev={onPrev}
      onNext={onNext}
      primary={{ id: 'shop-compare', label: t('research.shops.compareCta'), onClick: onCompare }}
      secondary={
        shopUrl
          ? { id: 'shop-view', label: t('research.shops.viewOn', { marketplace: MKT_NAME[mkt] }), icon: icons.externalLink, onClick: () => go(shopUrl, { newTab: true }) }
          : undefined
      }
      overflow={overflow}
      data-testid="shop-panel"
    >
      <SalesSection row={row} detail={detail} t={t} />
      <DetailSections row={row} mkt={mkt} detail={detail} t={t} fmt={fmt} go={go} onDraftSimilar={onDraftSimilar} etsyConnected={etsyConnected} />
      <SidePanelSection id="shop-alerts" title={t('research.shops.alerts')}>
        <AlertSwitches key={row.id} watch={row} alertsAvailable={alertsAvailable} onSaved={() => onAlertsSaved?.()} />
      </SidePanelSection>
      {detail.source ? (
        <Box sx={{ px: '20px', pb: '16px' }}>
          <ApiSourceNote source={detail.source} data-testid="shop-panel-source" />
        </Box>
      ) : null}
    </SidePanel>
  );
}

type DetailHook = ReturnType<typeof useWatchDetail>;

function SalesSection({ row, detail, t }: { row: WatchSummary; detail: DetailHook; t: ShopT }) {
  const title = t('research.shops.salesChart');
  const s = detail.data ? salesSeries(detail.data.sales) : null;
  let body: React.ReactNode;
  if (row.snapshots.count < 2) {
    body = (
      <Typography variant="body2" component="p" sx={{ m: 0, color: n[600] }} data-testid="shop-first-reading">
        {t(notYetKey(row))}
      </Typography>
    );
  } else if (detail.region.state === 'loading') {
    body = <ListSkeleton rows={2} leading="none" />;
  } else if (detail.region.state === 'slow') {
    body = <SlowState variant="inline" onRetry={detail.region.retry} />;
  } else if (!s || detail.region.state === 'error') {
    body = <ErrorState variant="inline" title={t('research.shops.detailFailed')} onRetry={detail.region.retry} data-testid="shop-detail-error" />;
  } else if (s.measured < 2) {
    body = (
      <Typography variant="body2" component="p" sx={{ m: 0, color: n[600] }}>
        {t('research.shops.chartNotYet')}
      </Typography>
    );
  } else {
    body = (
      <>
        <Chart
          type="line"
          series={[{ name: t('research.shops.col.salesDay'), data: s.data }]}
          categories={s.categories}
          format="number"
          height={180}
          ariaLabel={t('research.shops.chartAria', { shop: row.label })}
          directLabel="none"
          actions="table"
          data-testid="shop-sales-chart"
        />
        {s.dropped > 0 ? (
          <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: n[600] }} data-testid="shop-dropped">
            {t('research.shops.droppedPoints', { count: s.dropped })}
          </Typography>
        ) : null}
      </>
    );
  }
  return (
    <SidePanelSection id="shop-sales" title={title} description={t('research.shops.salesChartNote')}>
      {body}
    </SidePanelSection>
  );
}

function DetailSections({
  row, mkt, detail, t, fmt, go, onDraftSimilar, etsyConnected,
}: {
  row: WatchSummary;
  mkt: ShopMkt;
  detail: DetailHook;
  t: ShopT;
  fmt: ReturnType<typeof useDsFormat>;
  go: ShopPanelProps['go'];
  onDraftSimilar: ShopPanelProps['onDraftSimilar'];
  etsyConnected: boolean;
}) {
  const state = detail.region.state;
  if (state === 'loading' || state === 'slow' || state === 'error' || !detail.data) {
    // The sales section already carries the slow / error state with its Retry; here only a skeleton or nothing.
    return state === 'loading' ? (
      <SidePanelSection id="shop-new" title={t('research.shops.newListingsTitle')}>
        <ListSkeleton rows={3} leading="thumb" />
      </SidePanelSection>
    ) : null;
  }
  const d: WatchDetail = detail.data;
  const newOnes = d.newListings.slice(0, NEW_MAX);
  return (
    <>
      <SidePanelSection id="shop-new" title={t('research.shops.newListings', { count: d.newListings.length })}>
        {newOnes.length === 0 ? (
          <Typography variant="body2" component="p" sx={{ m: 0, color: n[600] }}>
            {row.snapshots.count < 2 ? t('research.shops.newNotYet') : t('research.shops.noNewListings')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="shop-new-list">
            {newOnes.map((l) => (
              <Box component="li" key={l.id} sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start', minWidth: 0 }}>
                <Thumb src={l.thumbUrl} alt={l.title} size={48} preview />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="dense" component="p" sx={{ m: 0, color: n[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.title}>
                    {l.title}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>
                    {l.price ? <Money amount={l.price.amount} currency={l.price.currency} /> : null}
                    {l.price && l.createdAt ? ' · ' : null}
                    {l.createdAt ? t('research.shops.firstSeen', { date: fmt.date(l.createdAt) }) : null}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px', mt: '4px' }}>
                    <Button variant="ghost" size="sm" icon={icons.research} onClick={() => go(researchIdeaHref(l, mkt))} data-testid="shop-research-idea">
                      {t('research.shops.researchIdea')}
                    </Button>
                    <Button variant="ghost" size="sm" icon={icons.ai} onClick={() => onDraftSimilar(l, row)} data-testid="shop-draft-similar">
                      {t('research.shops.draftSimilar')}
                    </Button>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </SidePanelSection>

      <SidePanelSection id="shop-fastest" title={t('research.shops.fastest')} description={t('research.shops.fastestNote')}>
        {d.fastest.length === 0 ? (
          <Typography variant="body2" component="p" sx={{ m: 0, color: n[600] }}>
            {t('research.shops.fastestNotYet')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="shop-fastest-list">
            {d.fastest.slice(0, FAST_MAX).map((f) => (
              <Box component="li" key={f.id} sx={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
                <Thumb src={f.thumbUrl} alt={f.title} size={40} />
                <Typography variant="dense" component="span" sx={{ flex: 1, minWidth: 0, color: n[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.title}>
                  {f.title}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                  <Metric
                    value={usable(f.favoritesDelta7d) ? t('research.shops.favoritesDelta', { value: fmt.num(f.favoritesDelta7d.value) }) : null}
                    kind={f.favoritesDelta7d.kind}
                    guard={guardOf(f.favoritesDelta7d)}
                    tooltip={qualifier(f.favoritesDelta7d, t)}
                  />
                  <Metric
                    value={usable(f.shareOfSales) ? t('research.shops.shareOfSales', { value: fmt.percent(f.shareOfSales.value) }) : null}
                    kind="estimate"
                    guard={guardOf(f.shareOfSales)}
                    tooltip={t('research.shops.shareModel')}
                  />
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </SidePanelSection>

      {mkt === 'etsy' ? (
        <SidePanelSection id="shop-tags" title={t('research.shops.tagGap')} description={t('research.shops.tagGapNote')}>
          {!etsyConnected || !d.tagGapAvailable ? (
            <Typography variant="body2" component="p" sx={{ m: 0, color: n[600] }}>
              {t('research.shops.tagGapConnect')}
            </Typography>
          ) : d.tagGap.length === 0 ? (
            <Typography variant="body2" component="p" sx={{ m: 0, color: n[600] }}>
              {t('research.shops.tagGapNone')}
            </Typography>
          ) : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }} data-testid="shop-tag-gap">
              {d.tagGap.slice(0, TAGS_MAX).map((g) => (
                <Box component="li" key={g.tag}>
                  <ButtonBase
                    onClick={() => go(keywordHref(g.tag, mkt))}
                    aria-label={t('research.shops.addToKeywords', { tag: g.tag })}
                    title={t('research.shops.addToKeywords', { tag: g.tag })}
                    sx={{
                      px: '10px',
                      minHeight: 28,
                      borderRadius: `${radius.full}px`,
                      bgcolor: n[100],
                      color: n[800],
                      fontSize: 13,
                      // DS §1/§8: ≥ 44 px touch targets under a coarse pointer.
                      '@media (pointer: coarse)': { minHeight: 44, px: '14px' },
                      '&:hover': { bgcolor: n[200] },
                      '&.Mui-focusVisible': { outline: `2px solid ${n[400]}`, outlineOffset: 1 },
                    }}
                    data-testid="shop-tag-chip"
                  >
                    {g.tag}
                  </ButtonBase>
                </Box>
              ))}
            </Box>
          )}
        </SidePanelSection>
      ) : null}
    </>
  );
}

export default ShopPanel;

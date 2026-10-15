// components/domain/research/keywords/KeywordPanel.tsx (research R2-B) — row detail (research.md §6.1 "Row click
// opens SidePanel md"): rank history (tracked keywords: single-axis line chart with send markers from
// EtsyListingVersion `kolayxport_draft` and SeoExperiment cohort dates, caption "Position in Etsy API search (not
// personalized, ads excluded)"), the price band with its SourceNote, tags used together by the top listings, the top
// listings (thumb, title, price) and — for "Used in my shop" — the user's listings using the tag.
// Primary: "Add 1 tag to…" (staging, never sending). Secondary: Track (Etsy) / Stop tracking (tracked rows).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Chart, KeyValueList, Thumb } from '@/components/ds/data';
import { Money } from '@/components/ds/format/Money';
import { Metric } from '@/components/ds/research/Metric';
import { PriceBand } from '@/components/ds/research/PriceBand';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { SlowState } from '@/components/ds/state/SlowState';
import { ListSkeleton } from '@/components/ds/state/Skeletons';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral, radius } from '@/lib/ds/tokens';
import type { ActionSpec } from '@/components/ds/page';
import { useKeywordDetail, useRankHistory } from '@/lib/research/hooks/useKeywords';
import type { KeywordMkt, KeywordRowExt, RankHistoryData, TrackedKeywordRow } from '@/lib/research/keywordTypes';
import { ApiSourceNote } from '../products/ApiSourceNote';
import { RankCellView, type KwT } from './keywordColumns';

const TOP_SHOWN = 12;

export type KeywordPanelProps = {
  /** The open keyword (null = closed). */
  keyword: string | null;
  /** Explorer row (Suggested / Long-tail / Seasonal / Used in my shop). */
  row?: KeywordRowExt | null;
  /** Tracked view row (its id drives the rank history). */
  tracked?: TrackedKeywordRow | null;
  mkt: KeywordMkt;
  country?: string;
  listing?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** "Add 1 tag to…" (Etsy) / "Add to title" (eBay, Amazon). */
  onAdd?: (keyword: string) => void;
  onTrack?: (keyword: string) => void;
  onStopTracking?: (trackedId: string) => void;
};

/** Pure: snap marker timestamps to the day categories the chart shows. */
export function historySeries(h: RankHistoryData, labels: { send: string; experiment: string }) {
  const day = (iso: string) => iso.slice(0, 10);
  const categories = h.points.map((p) => new Date(`${day(p.at)}T00:00:00Z`));
  const days = new Set(h.points.map((p) => day(p.at)));
  const markers = h.markers
    .filter((m) => days.has(day(m.at)))
    .map((m) => ({ at: new Date(`${day(m.at)}T00:00:00Z`), label: m.kind === 'experiment' ? labels.experiment : labels.send }));
  return { categories, data: h.points.map((p) => p.rank), markers };
}

function RankHistory({ trackedId, t }: { trackedId: string; t: KwT }) {
  const h = useRankHistory(trackedId);
  if (h.region.state === 'loading') return <ListSkeleton rows={3} leading="none" />;
  if (h.region.state === 'slow') return <SlowState variant="inline" onRetry={h.region.retry} />;
  if (h.region.state === 'error' || !h.data) return <ErrorState variant="inline" title={t('kw.historyFailed')} onRetry={h.region.retry} />;
  const s = historySeries(h.data, { send: t('kw.markerSend'), experiment: t('kw.markerExperiment') });
  return (
    <Box data-testid="kw-rank-history">
      <KeyValueList
        items={[
          { label: t('kw.tcol.position'), value: <RankCellView row={{ rank: { now: h.data.summary.now, delta7: h.data.summary.delta7, best: h.data.summary.best } }} t={t} /> },
          { label: t('kw.tcol.best'), value: h.data.summary.best !== null ? t('kw.rankValue', { rank: h.data.summary.best }) : '—' },
        ]}
      />
      {s.data.length >= 2 ? (
        <Box sx={{ mt: '8px' }}>
          <Chart
            type="line"
            series={[{ name: t('kw.tcol.position'), data: s.data }]}
            categories={s.categories}
            format="number"
            height={180}
            ariaLabel={t('kw.historyAria', { keyword: h.data.keyword })}
            directLabel="none"
            markers={s.markers}
          />
        </Box>
      ) : (
        <Typography variant="caption" component="p" sx={{ m: 0, mt: '8px', color: neutral[600] }}>{t('kw.historyFirst')}</Typography>
      )}
      <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[500] }}>{t('kw.rankNote')}</Typography>
    </Box>
  );
}

export function KeywordPanel({ keyword, row, tracked, mkt, country, listing, onClose, onPrev, onNext, onAdd, onTrack, onStopTracking }: KeywordPanelProps) {
  const t = useTranslations('research') as unknown as KwT;
  const fmt = useDsFormat();
  const detail = useKeywordDetail(keyword, { mkt, country, listing: tracked?.listing.id ?? listing });
  const trackedId = tracked?.id ?? row?.trackedId ?? detail.data?.history?.trackedId ?? null;
  const d = detail.data;
  const [allTop, setAllTop] = React.useState(false);
  React.useEffect(() => setAllTop(false), [keyword]);

  const primary: ActionSpec | undefined = keyword && onAdd
    ? { id: 'kw-panel-add', label: mkt === 'etsy' ? t('action.addTags', { count: 1 }) : t('action.addToTitle'), icon: icons.add, onClick: () => onAdd(keyword) }
    : undefined;
  const secondary: ActionSpec | undefined =
    trackedId && onStopTracking
      ? { id: 'kw-panel-untrack', label: t('kw.stopTracking'), onClick: () => onStopTracking(trackedId) }
      : keyword && onTrack && mkt === 'etsy'
        ? { id: 'kw-panel-track', label: t('action.track'), onClick: () => onTrack(keyword) }
        : undefined;

  const top = d?.top ?? [];
  const shownTop = allTop ? top : top.slice(0, TOP_SHOWN);

  return (
    <SidePanel
      open={Boolean(keyword)}
      onClose={onClose}
      size="md"
      title={keyword ?? '—'}
      meta={tracked ? tracked.listing.title : row && row.inMyShop > 0 ? t('kw.inMyShopValue', { count: row.inMyShop }) : undefined}
      onPrev={onPrev}
      onNext={onNext}
      primary={primary}
      secondary={secondary}
      data-testid="kw-panel"
    >
      {keyword ? (
        <>
          {trackedId ? (
            <SidePanelSection id="kw-panel-rank" title={t('kw.rankHistory')}>
              <RankHistory trackedId={trackedId} t={t} />
            </SidePanelSection>
          ) : null}
          {mkt !== 'etsy' ? (
            <SidePanelSection id="kw-panel-etsy-only" title={t('kw.col.priceBand')}>
              <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>{t('kw.detailEtsyOnly')}</Typography>
            </SidePanelSection>
          ) : detail.region.state === 'loading' ? (
            <ListSkeleton rows={6} leading="thumb" />
          ) : detail.region.state === 'slow' ? (
            <SlowState variant="inline" onRetry={detail.region.retry} />
          ) : detail.region.state === 'error' || !d ? (
            <ErrorState variant="inline" title={t('kw.detailFailed')} onRetry={detail.region.retry} data-testid="kw-panel-error" />
          ) : (
            <>
              <SidePanelSection id="kw-panel-price" title={t('kw.col.priceBand')}>
                <PriceBand p25={d.price.p25} median={d.price.median} p75={d.price.p75} currency={d.price.currency} n={d.price.n} implausible={d.price.quality === 'implausible'} />
                <Box sx={{ mt: '6px' }}>
                  <KeyValueList
                    items={[
                      {
                        label: t('kw.col.competition'),
                        value: <Metric value={d.total.value !== null ? fmt.num(d.total.value) : null} kind={d.total.kind} guard={{ ok: d.total.guard.ok, reasonKey: d.total.guard.reasonKey, reasonParams: d.total.guard.reasonParams }} />,
                      },
                    ]}
                  />
                </Box>
                <Box sx={{ mt: '6px' }}>
                  <ApiSourceNote source={detail.source} data-testid="kw-panel-source" />
                </Box>
              </SidePanelSection>
              {d.cooccurring.length ? (
                <SidePanelSection id="kw-panel-cooc" title={t('kw.cooccurring')}>
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {d.cooccurring.slice(0, 20).map((w) => (
                      <Box component="li" key={w.tag} sx={{ px: '8px', py: '2px', borderRadius: `${radius.full}px`, bgcolor: neutral[100] }}>
                        <Typography variant="body2" component="span" lang="en">{w.tag}</Typography>
                        <Typography variant="caption" component="span" sx={{ ml: '4px', color: neutral[600] }}>{t('kw.top48Value', { count: w.count })}</Typography>
                      </Box>
                    ))}
                  </Box>
                </SidePanelSection>
              ) : null}
              <SidePanelSection id="kw-panel-top" title={t('kw.topListings', { count: top.length })}>
                {top.length === 0 ? (
                  <Typography variant="caption" component="p" sx={{ m: 0, color: neutral[600] }}>{t('guard.insufficient')}</Typography>
                ) : (
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {shownTop.map((l) => (
                      <Box component="li" key={l.id} sx={{ display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 }}>
                        <Thumb src={l.thumbUrl} alt="" size={32} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          {l.url ? (
                            <Typography component="a" href={l.url} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ color: neutral[900], display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {l.title}
                            </Typography>
                          ) : (
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</Typography>
                          )}
                        </Box>
                        {l.price ? <Money amount={l.price.amount} currency={l.price.currency} /> : null}
                      </Box>
                    ))}
                  </Box>
                )}
                {top.length > TOP_SHOWN && !allTop ? (
                  <Box component="button" type="button" onClick={() => setAllTop(true)} sx={{ all: 'unset', cursor: 'pointer', mt: '8px', color: neutral[700], textDecoration: 'underline' }}>
                    <Typography variant="caption" component="span">{t('kw.showAll', { count: top.length })}</Typography>
                  </Box>
                ) : null}
              </SidePanelSection>
            </>
          )}
          {row?.listings?.length ? (
            <SidePanelSection id="kw-panel-mine" title={t('kw.usedInListings', { count: row.inMyShop })}>
              <Box component="ul" sx={{ m: 0, pl: '18px' }}>
                {row.listings.map((l) => (
                  <Typography key={l.id} component="li" variant="body2">{l.title}</Typography>
                ))}
              </Box>
            </SidePanelSection>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

export default KeywordPanel;

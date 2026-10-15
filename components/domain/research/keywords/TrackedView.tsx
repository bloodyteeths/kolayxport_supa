// components/domain/research/keywords/TrackedView.tsx (research R2-B) — Keyword explorer "Tracked" view (research.md
// §6.1; replaces RR Job 5 "Rankings"). RankTrackedKeyword rows, DB-only on the server.
//
// Columns: Keyword · Listing · Position (today) · 7-day change · Best · Sales 14 d (Measured,
// EtsyListingDailyStat.unitsSold; before/after the last send in the tooltip). Rank null = "Not in top 500", never 0.
// Row ⋯: Find better keywords (→ Suggested with `?listing=`) · See SEO experiment (→ /app/etsy-aktivite?tab=seo, the
// backend's list; we link, we do not rebuild it) · Stop tracking. Row click → KeywordPanel with the rank history.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { DataTable, Thumb, type Column, type DataTableState } from '@/components/ds/data';
import { useDsFormat } from '@/components/ds/data/fmt';
import { Metric } from '@/components/ds/research/Metric';
import { neutral, tone } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import type { TrackedKeywordRow } from '@/lib/research/keywordTypes';
import type { KwT } from './keywordColumns';
import { SEO_EXPERIMENTS_HREF } from './keywordModel';

export type TrackedViewProps = {
  rows: TrackedKeywordRow[];
  state: DataTableState;
  loading?: React.ReactNode;
  empty?: React.ReactNode;
  error?: React.ReactNode;
  caption?: React.ReactNode;
  activeId?: string | null;
  onOpen: (row: TrackedKeywordRow) => void;
  onFindBetter: (row: TrackedKeywordRow) => void;
  onStop: (row: TrackedKeywordRow) => void;
  /** Navigation seam (SEO experiment link). */
  navigate: (href: string) => void;
};

/** Pure: the Sales 14 d tooltip ("Before the last send: 3 · after (9 days): 5"). */
export function salesTip(t: KwT, s: TrackedKeywordRow['sales14d']): string | undefined {
  if (!s.lastSendAt) return undefined;
  const v = (g: TrackedKeywordRow['sales14d']['beforeSend']) => (g && g.guard.ok && g.value !== null ? String(g.value) : '—');
  return t('kw.salesTip', { before: v(s.beforeSend), after: v(s.afterSend), days: s.afterDays ?? 0 });
}

export function trackedColumns(t: KwT, root: KwT, fmt: ReturnType<typeof useDsFormat>): Column<TrackedKeywordRow>[] {
  const reason = (g: { reasonKey?: string; reasonParams?: Record<string, string | number> }) =>
    g.reasonKey && (!root.has || root.has(g.reasonKey)) ? root(g.reasonKey, g.reasonParams ?? {}) : undefined;
  return [
    {
      key: 'keyword',
      header: t('kw.col.keyword'),
      minWidth: 180,
      mobile: 'title',
      render: (r) => <Typography component="span" variant="body2" lang="en" sx={{ fontWeight: 500, color: neutral[900] }}>{r.keyword}</Typography>,
    },
    {
      key: 'listing',
      header: t('kw.tcol.listing'),
      minWidth: 220,
      mobile: 'subtitle',
      render: (r) => (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0, maxWidth: 320 }}>
          <Thumb src={r.listing.thumbUrl} alt="" size={32} />
          <Typography component="span" variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.listing.title || r.listing.id}</Typography>
        </Box>
      ),
      mobileRender: (r) => r.listing.title || r.listing.id,
    },
    {
      key: 'position',
      header: t('kw.tcol.position'),
      width: 130,
      align: 'right',
      mobile: 'trailing',
      render: (r) =>
        r.rank.now !== null ? (
          <Metric value={t('kw.rankValue', { rank: r.rank.now })} kind="measured" tooltip={r.rank.checkedAt ? t('kw.checkedAt', { time: fmt.relative(r.rank.checkedAt) }) : undefined} />
        ) : (
          <Typography component="span" variant="dense" sx={{ color: neutral[600] }}>{r.rank.checkedAt ? t('kw.notInTop500') : t('kw.notCheckedYet')}</Typography>
        ),
    },
    {
      key: 'delta7',
      header: t('kw.tcol.delta7'),
      width: 120,
      align: 'right',
      mobile: 'meta',
      render: (r) => {
        const d = r.rank.delta7;
        if (d === null) return <Typography component="span" variant="dense" sx={{ color: neutral[500] }}>{'—'}</Typography>;
        if (d === 0) return <Typography component="span" variant="dense" sx={{ color: neutral[600] }}>{t('kw.noChange')}</Typography>;
        return (
          <Typography component="span" variant="dense" sx={{ color: d > 0 ? tone.success.fg : tone.danger.fg, fontVariantNumeric: 'tabular-nums' }}>
            {d > 0 ? t('kw.rankUp', { n: d }) : t('kw.rankDown', { n: Math.abs(d) })}
          </Typography>
        );
      },
      mobileRender: (r) => (r.rank.delta7 ? (r.rank.delta7 > 0 ? t('kw.rankUp', { n: r.rank.delta7 }) : t('kw.rankDown', { n: Math.abs(r.rank.delta7) })) : ''),
    },
    {
      key: 'best',
      header: t('kw.tcol.best'),
      width: 90,
      align: 'right',
      mobile: 'hidden',
      render: (r) => <Metric value={r.rank.best !== null ? t('kw.rankValue', { rank: r.rank.best }) : null} kind="measured" />,
    },
    {
      key: 'sales14',
      header: t('kw.tcol.sales14'),
      width: 120,
      align: 'right',
      mobile: 'hidden',
      render: (r) => (
        <Metric
          value={r.sales14d.last14.value !== null ? fmt.num(r.sales14d.last14.value) : null}
          kind={r.sales14d.last14.kind}
          guard={{ ok: r.sales14d.last14.guard.ok, reason: reason(r.sales14d.last14.guard) }}
          tooltip={salesTip(t, r.sales14d)}
        />
      ),
    },
  ];
}

export function TrackedView({ rows, state, loading, empty, error, caption, activeId, onOpen, onFindBetter, onStop, navigate }: TrackedViewProps) {
  const t = useTranslations('research') as unknown as KwT;
  const root = useTranslations() as unknown as KwT;
  const fmt = useDsFormat();
  const columns = React.useMemo(() => trackedColumns(t, root, fmt), [t, root, fmt]);
  return (
    <DataTable<TrackedKeywordRow>
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      state={state}
      loading={loading}
      empty={empty}
      error={error}
      onRowOpen={onOpen}
      rowActions={(r) => [
        { id: 'kw-find-better', label: t('kw.findBetter'), icon: icons.research, onClick: () => onFindBetter(r) },
        ...(r.experiment ? [{ id: 'kw-see-experiment', label: t('kw.seeExperiment'), icon: icons.externalLink, onClick: () => navigate(SEO_EXPERIMENTS_HREF) }] : []),
        { id: 'kw-stop-tracking', label: t('kw.stopTracking'), onClick: () => onStop(r), tone: 'danger' as const },
      ]}
      caption={caption}
      columnStateKey="research.keywords.tracked.v1"
      ariaLabel={t('kw.view.tracked')}
      activeRowId={activeId ?? null}
      data-testid="kw-tracked-table"
    />
  );
}

export default TrackedView;

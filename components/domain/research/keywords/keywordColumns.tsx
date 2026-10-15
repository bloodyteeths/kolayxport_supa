// components/domain/research/keywords/keywordColumns.tsx (research R2-B) — DataTable columns of the Keyword explorer
// (research.md §6.1 desktop, §6.2 panel, §6.3 mobile cards).
//
// Page (Etsy): Keyword · Demand · Competition · Top-48 use · Price band · In my shop · Etsy volume · Rank.
// eBay: Keyword · Demand · Competition · Price band (no tags → no Top-48 / In my shop). Amazon: Keyword · Demand.
// Seasonal view adds "Peak". Panel (720): keyword · demand · top-48 · competition. Every number is a Metric with its
// kind; a guarded value renders "—" with the reason. Mobile card: keyword (title) · "●●●●○ · 1,820 listings"
// (subtitle) · "Used by 18 of top 48 · $38–$72" (meta).
import * as React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Column } from '@/components/ds/data';
import type { DsFormat } from '@/components/ds/data/fmt';
import { Metric } from '@/components/ds/research/Metric';
import { SignalDots } from '@/components/ds/research/SignalDots';
import { neutral, tone } from '@/lib/ds/tokens';
import type { KeywordView } from '@/lib/research/types';
import type { KeywordMkt, KeywordRowExt } from '@/lib/research/keywordTypes';
import { monthName, rankCell, type KeywordVariant } from './keywordModel';

/** `research` namespace translator (`t('kw.col.keyword')`). */
export type KwT = ((key: string, values?: Record<string, string | number>) => string) & { has?: (key: string) => boolean };

export type DemandLine = { label: string; value: string; ok: boolean };

export type KeywordColumnsOpts = {
  mkt: KeywordMkt;
  variant: KeywordVariant;
  view: KeywordView;
  /** BR-1b deployed (`volumeAvailable`): show "Etsy volume". */
  volumeAvailable: boolean;
  /** `?listing` present: the Rank column is meaningful. */
  hasListing: boolean;
  t: KwT;
  /** Root translator for API guard keys. */
  root: KwT;
  fmt: DsFormat;
  locale: string;
  demandLines: (inputs: KeywordRowExt['demand']['inputs']) => DemandLine[];
  /** Renders the "Etsy volume" cell (VolumePopover). */
  renderVolume?: (row: KeywordRowExt) => React.ReactNode;
};

function guardReason(root: KwT, g: { reasonKey?: string; reasonParams?: Record<string, string | number> }): string | undefined {
  if (!g.reasonKey) return undefined;
  return root.has && !root.has(g.reasonKey) ? undefined : root(g.reasonKey, g.reasonParams ?? {});
}

export function DemandCell({ row, t, demandLines }: { row: KeywordRowExt; t: KwT; demandLines: KeywordColumnsOpts['demandLines'] }) {
  const lines = demandLines(row.demand.inputs);
  if (row.demand.tier === null) {
    const tip = lines.map((l) => `${l.label}: ${l.value}`).join(' · ') || t('guard.notEnoughSignal');
    return (
      <Tooltip title={tip}>
        <Typography component="span" variant="caption" tabIndex={0} sx={{ color: neutral[500] }} data-testid="kw-demand-none">
          {t('guard.notEnoughSignal')}
        </Typography>
      </Tooltip>
    );
  }
  return <SignalDots tier={row.demand.tier} inputs={lines.filter((l) => l.ok).map(({ label, value }) => ({ label, value }))} />;
}

export function PriceBandCell({ row, fmt, t }: { row: KeywordRowExt; fmt: DsFormat; t: KwT }) {
  const b = row.priceBand;
  const ok = b.p25 !== null && b.p75 !== null && b.n >= 5;
  const value = ok ? t('kw.priceRange', { low: fmt.money(b.p25 as number, b.currency), high: fmt.money(b.p75 as number, b.currency) }) : null;
  return (
    <Metric
      value={value}
      kind="measured"
      guard={ok ? { ok: true } : { ok: false, reason: t('guard.small', { n: b.n }) }}
      tooltip={ok && b.n < 20 ? t('guard.small', { n: b.n }) : undefined}
    />
  );
}

export function RankCellView({ row, t }: { row: Pick<KeywordRowExt, 'rank'>; t: KwT }) {
  const c = rankCell(row.rank);
  if (c.kind === 'none') return <Typography component="span" variant="dense" sx={{ color: neutral[500] }}>{'—'}</Typography>;
  const delta =
    c.delta === null || c.delta === 0 ? null : (
      <Typography component="span" variant="caption" sx={{ ml: '4px', color: c.delta > 0 ? tone.success.fg : tone.danger.fg }}>
        {c.delta > 0 ? t('kw.rankUp', { n: c.delta }) : t('kw.rankDown', { n: Math.abs(c.delta) })}
      </Typography>
    );
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      {c.kind === 'rank' ? <Metric value={t('kw.rankValue', { rank: c.rank })} kind="measured" /> : (
        <Typography component="span" variant="dense" sx={{ color: neutral[600] }}>{t('kw.notInTop500')}</Typography>
      )}
      {delta}
    </Box>
  );
}

export function keywordColumns(o: KeywordColumnsOpts): Column<KeywordRowExt>[] {
  const { t, root, fmt, mkt, variant, view } = o;
  const etsy = mkt === 'etsy';
  const hasCompetition = mkt !== 'amazon';
  const cols: Column<KeywordRowExt>[] = [];

  cols.push({
    key: 'keyword',
    header: t('kw.col.keyword'),
    minWidth: 200,
    mobile: 'title',
    render: (r) => (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
        <Typography component="span" variant="body2" sx={{ color: neutral[900], fontWeight: 500 }} lang="en">{r.keyword}</Typography>
        {r.inCurrent ? <Typography component="span" variant="caption" sx={{ color: neutral[500] }}>{t('kw.inCurrent')}</Typography> : null}
        {r.length > 20 && etsy ? (
          <Tooltip title={t('kw.tooLongTag')}>
            <Typography component="span" variant="caption" tabIndex={0} sx={{ color: tone.warning.fg }}>{t('kw.chars', { count: r.length })}</Typography>
          </Tooltip>
        ) : null}
      </Box>
    ),
  });

  cols.push({
    key: 'demand',
    header: t('kw.col.demand'),
    width: 110,
    mobile: 'subtitle',
    render: (r) => <DemandCell row={r} t={t} demandLines={o.demandLines} />,
    mobileRender: (r) => (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <DemandCell row={r} t={t} demandLines={o.demandLines} />
        {hasCompetition && r.competition.guard.ok && r.competition.value !== null ? (
          <Typography component="span" variant="caption" sx={{ color: neutral[600] }}>{t('kw.competitionCard', { count: fmt.num(r.competition.value) })}</Typography>
        ) : null}
      </Box>
    ),
  });

  const top48Col: Column<KeywordRowExt> = {
    key: 'top48',
    header: t('kw.col.top48'),
    width: 120,
    align: 'right',
    mobile: 'meta',
    render: (r) => (
      <Metric
        value={r.top48.value !== null ? t('kw.top48Value', { count: r.top48.value }) : null}
        kind={r.top48.kind}
        guard={{ ok: r.top48.guard.ok, reason: guardReason(root, r.top48.guard) }}
      />
    ),
    mobileRender: (r) => {
      const parts: string[] = [];
      if (r.top48.guard.ok && r.top48.value !== null) parts.push(t('kw.usedByTop', { count: r.top48.value }));
      const b = r.priceBand;
      if (b.p25 !== null && b.p75 !== null && b.n >= 5) parts.push(t('kw.priceRange', { low: fmt.money(b.p25, b.currency), high: fmt.money(b.p75, b.currency) }));
      return parts.join(' · ');
    },
  };

  const competitionCol: Column<KeywordRowExt> = {
    key: 'competition',
    header: t('kw.col.competition'),
    width: 120,
    align: 'right',
    mobile: 'hidden',
    render: (r) => (
      <Metric
        value={r.competition.value !== null ? fmt.num(r.competition.value) : null}
        kind={r.competition.kind}
        guard={{ ok: r.competition.guard.ok, reason: guardReason(root, r.competition.guard) }}
        tooltip={t('kw.competitionTip')}
      />
    ),
  };

  if (variant === 'panel') {
    cols.push(top48Col, competitionCol);
    return cols;
  }

  if (hasCompetition) cols.push(competitionCol);
  if (etsy) cols.push(top48Col);
  if (hasCompetition) {
    cols.push({
      key: 'priceBand',
      header: t('kw.col.priceBand'),
      width: 130,
      align: 'right',
      mobile: etsy ? 'hidden' : 'meta',
      render: (r) => <PriceBandCell row={r} fmt={fmt} t={t} />,
    });
  }
  if (view === 'seasonal') {
    cols.push({
      key: 'peak',
      header: t('kw.col.peak'),
      width: 150,
      mobile: 'meta',
      render: (r) =>
        r.seasonal ? (
          <Metric
            value={t('kw.peakValue', { month: monthName(r.seasonal.peakMonth, o.locale), days: r.seasonal.inDays })}
            kind="signal"
            tooltip={t('kw.peakTip')}
          />
        ) : (
          <Typography component="span" variant="dense" sx={{ color: neutral[500] }}>{'—'}</Typography>
        ),
    });
  }
  if (etsy) {
    cols.push({
      key: 'inMyShop',
      header: t('kw.col.inMyShop'),
      width: 120,
      align: 'right',
      mobile: view === 'mine' ? 'trailing' : 'hidden',
      render: (r) =>
        r.inMyShop > 0 ? (
          <Tooltip title={(r.listings ?? []).slice(0, 8).map((l) => l.title).join(' · ')}>
            <Typography component="span" variant="dense" tabIndex={0} sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {t('kw.inMyShopValue', { count: r.inMyShop })}
            </Typography>
          </Tooltip>
        ) : (
          <Typography component="span" variant="dense" sx={{ color: neutral[500] }}>{'—'}</Typography>
        ),
    });
    if (o.volumeAvailable && o.renderVolume) {
      cols.push({
        key: 'etsyVolume',
        header: t('kw.col.etsyVolume'),
        width: 140,
        align: 'right',
        hideable: true,
        mobile: 'hidden',
        render: (r) => o.renderVolume!(r),
      });
    }
    if (o.hasListing) {
      cols.push({
        key: 'rank',
        header: t('kw.col.rank'),
        width: 120,
        align: 'right',
        mobile: 'trailing',
        render: (r) => <RankCellView row={r} t={t} />,
      });
    }
  }
  return cols;
}

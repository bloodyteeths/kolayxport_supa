// components/domain/research/listings/doctorColumns.tsx — Listing doctor table (research.md §7.1 desktop, §7.2 cards).
// Columns: thumb · Listing · Views 30d · Sales 30d · Conversion · Main keyword rank · Health · Biggest issue.
// Every number is a `Metric` with its kind (research §3.1); a failed guard renders "—" with the reason.
// Cards (< 900): title · "412 views · 0 sales (30 d)" · biggest issue as meta · health in the status slot.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Column } from '@/components/ds/data';
import { ScoreMeter } from '@/components/ds/data/ScoreMeter';
import { Metric } from '@/components/ds/research/Metric';
import type { DsFormat } from '@/components/ds/data/fmt';
import { neutral as n } from '@/lib/ds/tokens';
import type { DoctorRow, Guarded } from '@/lib/research/types';

/** Root translator (full-path keys: `research.*`, `listingScore.*`). */
export type DoctorT = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

export type DoctorColumnsCtx = { t: DoctorT; fmt: DsFormat };

const guardOf = (g: Guarded<number>) => ({ ok: g.guard.ok, reasonKey: g.guard.reasonKey, reasonParams: g.guard.reasonParams });

function usable(g: Guarded<number> | undefined): g is Guarded<number> & { value: number } {
  return Boolean(g && g.guard.ok && typeof g.value === 'number' && Number.isFinite(g.value));
}

/** "Price 38% above peers" — the server's check label + params; unknown keys fall back to the short issue label. */
export function biggestIssueText(row: DoctorRow, t: DoctorT): string | null {
  const bi = row.biggestIssue;
  if (!bi) return null;
  if (bi.label && t.has(bi.label)) return t(bi.label, bi.params ?? {});
  const short = `research.doc.issue.${bi.checkId}`;
  return t.has(short) ? t(short, bi.params ?? {}) : null;
}

/** Card subtitle: "412 views · 0 sales (30 d)"; guarded values are left out. */
export function statsLine(row: DoctorRow, t: DoctorT, fmt: DsFormat): string | null {
  const parts: string[] = [];
  if (usable(row.views30d)) parts.push(t('research.doc.card.views', { count: row.views30d.value, value: fmt.num(row.views30d.value) }));
  if (usable(row.sales30d)) parts.push(t('research.doc.card.sales', { count: row.sales30d.value, value: fmt.num(row.sales30d.value) }));
  if (!parts.length) return null;
  return t('research.doc.card.stats', { stats: parts.join(' · ') });
}

/** Rank cell text: "#212", "Not in top 500" (rank null on a tracked keyword), "—" without a main keyword. */
export function rankText(row: DoctorRow, t: DoctorT, fmt: DsFormat): string | null {
  const mk = row.mainKeyword;
  if (!mk || mk.source !== 'tracked') return null;
  if (mk.rank == null) return t('research.kw.notInTop500');
  return `#${fmt.num(mk.rank)}`;
}

export function doctorColumns({ t, fmt }: DoctorColumnsCtx): Column<DoctorRow>[] {
  const kindTip = t('research.doc.measuredHint');
  return [
    {
      key: 'thumb',
      header: '',
      width: 64,
      type: 'thumb',
      value: (r) => r.listing.thumbUrl,
      thumbAlt: (r) => r.listing.title,
      mobile: 'media',
    },
    {
      key: 'listing',
      header: t('research.doc.col.listing'),
      minWidth: 240,
      mobile: 'title',
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="dense" component="div" sx={{ color: n[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.listing.title}>
            {r.listing.title}
          </Typography>
          {r.listing.metaLine.length ? (
            <Typography variant="caption" component="div" sx={{ color: n[500], fontFamily: 'var(--kx-font-mono, monospace)' }}>
              {r.listing.metaLine.join(' · ')}
            </Typography>
          ) : null}
        </Box>
      ),
      mobileRender: (r) => r.listing.title,
    },
    {
      key: 'stats',
      header: t('research.doc.col.views30'),
      desktop: false,
      mobile: 'subtitle',
      render: (r) => statsLine(r, t, fmt) ?? '—',
    },
    {
      key: 'views30d',
      header: t('research.doc.col.views30'),
      width: 112,
      align: 'right',
      mobile: 'hidden',
      render: (r) => (
        <Metric value={usable(r.views30d) ? fmt.num(r.views30d.value) : null} kind={r.views30d.kind} guard={guardOf(r.views30d)} tooltip={kindTip} />
      ),
    },
    {
      key: 'sales30d',
      header: t('research.doc.col.sales30'),
      width: 112,
      align: 'right',
      mobile: 'hidden',
      render: (r) => (
        <Metric value={usable(r.sales30d) ? fmt.num(r.sales30d.value) : null} kind={r.sales30d.kind} guard={guardOf(r.sales30d)} tooltip={kindTip} />
      ),
    },
    {
      key: 'conversion',
      header: t('research.doc.col.conversion'),
      width: 112,
      align: 'right',
      mobile: 'hidden',
      hideable: true,
      render: (r) => (
        <Metric
          value={usable(r.conversion) ? fmt.percent(r.conversion.value, 1) : null}
          kind={r.conversion.kind}
          guard={guardOf(r.conversion)}
        />
      ),
    },
    {
      key: 'mainKw',
      header: t('research.doc.col.mainKw'),
      width: 128,
      align: 'right',
      mobile: 'hidden',
      hideable: true,
      render: (r) => {
        const text = rankText(r, t, fmt);
        const tip = r.mainKeyword ? t('research.doc.rankTip', { keyword: r.mainKeyword.keyword }) : undefined;
        return (
          <Box component="span" title={tip} sx={{ fontVariantNumeric: 'tabular-nums', color: text ? n[900] : n[500] }}>
            {text ?? '—'}
          </Box>
        );
      },
    },
    {
      key: 'health',
      header: t('research.doc.col.health'),
      width: 120,
      type: 'score',
      value: (r) => r.listing.health.score,
      mobile: 'status',
      render: (r) => <ScoreMeter variant="cell" score={r.listing.health.score} checksUsed={r.listing.health.used} checksTotal={r.listing.health.total} />,
    },
    {
      key: 'biggestIssue',
      header: t('research.doc.col.biggestIssue'),
      minWidth: 220,
      mobile: 'meta',
      render: (r) => {
        const text = biggestIssueText(r, t);
        if (!text) return <Box component="span" sx={{ color: n[500] }}>{'—'}</Box>;
        return (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
            <Box component="span" sx={{ color: n[800], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>
              {text}
            </Box>
            {r.issues > 1 ? (
              <Box component="span" sx={{ color: n[500], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }} aria-label={t('research.home.issues', { count: r.issues })}>
                {t('research.doc.issueCount', { count: r.issues, value: fmt.num(r.issues) })}
              </Box>
            ) : null}
          </Box>
        );
      },
      mobileRender: (r) => biggestIssueText(r, t) ?? '',
    },
  ];
}

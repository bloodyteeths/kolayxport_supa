// Compare mode (research.md §5.1 "Compare (+)"): up to 3 queries side by side (`?compare=q1|q2|q3`). One table,
// rows = metrics, columns = queries; Evidence per query is a single line. Mobile: one query at a time
// (SegmentedControl). Every price stays the robust median / p25–p75 (no mean), every number a Metric.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { DataTable, KeyValueList, type Column } from '@/components/ds/data';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { Metric } from '@/components/ds/research/Metric';
import { SignalDots } from '@/components/ds/research/SignalDots';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { Banner } from '@/components/ds/feedback/Banner';
import { SlowState } from '@/components/ds/state/SlowState';
import { TableSkeleton } from '@/components/ds/state/Skeletons';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { useDsFormat } from '@/components/ds/data/fmt';
import { icons } from '@/lib/ds/icons';
import { neutral } from '@/lib/ds/tokens';
import type { AsyncRegion } from '@/lib/ds/useAsyncState';
import type { ProductsResult, SourceNoteProps } from '@/lib/research/types';
import { priceDisplay } from '@/lib/research/stats';
import type { CompareEntry } from '@/lib/research/hooks/useResearchProducts';
import { ApiSourceNote } from './ApiSourceNote';

type MetricKey = 'evidence' | 'median' | 'band' | 'sample' | 'competition' | 'top5' | 'demand' | 'newcomers';
const METRICS: readonly MetricKey[] = ['evidence', 'median', 'band', 'sample', 'competition', 'top5', 'demand', 'newcomers'];

export type ComparePanelProps = {
  entries: CompareEntry[];
  region: AsyncRegion;
  source?: SourceNoteProps;
  onRemove: (query: string) => void;
};

export function ComparePanel({ entries, region, source, onRemove }: ComparePanelProps) {
  const t = useTranslations('research');
  const root = useTranslations();
  const fmt = useDsFormat();
  const mobile = useIsMobile();
  const [current, setCurrent] = React.useState(0);
  const locale = fmt.intlLocale;

  const cell = (key: MetricKey, r: ProductsResult | null, budget?: boolean): React.ReactNode => {
    if (!r) {
      // A query the Etsy budget breaker dropped: say why once (evidence row), "—" elsewhere.
      return (
        <Typography variant={budget && key === 'evidence' ? 'caption' : undefined} component="span" sx={{ color: neutral[500] }}>
          {budget && key === 'evidence' ? t('compare.budgetColumn') : '—'}
        </Typography>
      );
    }
    const pd = priceDisplay(r.price, locale);
    switch (key) {
      case 'evidence': {
        const f = r.evidence.facts[0];
        return <Typography variant="caption" component="span">{f && root.has(f.key) ? root(f.key, f.params) : '—'}</Typography>;
      }
      case 'median':
        return <Metric value={pd.value === '—' ? null : pd.value} kind="measured" guard={{ ok: pd.value !== '—', reasonKey: pd.quality === 'implausible' ? 'research.guard.implausible' : pd.quality === 'small' ? 'research.guard.small' : 'research.guard.insufficient', reasonParams: { n: r.price.n } }} />;
      case 'band':
        return <Metric value={pd.band} kind="measured" guard={{ ok: Boolean(pd.band) && pd.quality !== 'implausible' && pd.quality !== 'insufficient', reasonKey: 'research.guard.insufficient' }} />;
      case 'sample':
        return fmt.num(r.price.n);
      case 'competition':
        return <Metric value={r.competition.total.value === null ? null : fmt.num(r.competition.total.value)} kind={r.competition.total.kind} guard={r.competition.total.guard} />;
      case 'top5':
        return <Metric value={r.competition.top5Share.value === null ? null : fmt.percent(r.competition.top5Share.value)} kind={r.competition.top5Share.kind} guard={r.competition.top5Share.guard} />;
      case 'demand':
        return <SignalDots tier={r.demand.tier} inputs={[]} />;
      case 'newcomers':
        return <Metric value={r.newcomers.value === null ? null : fmt.percent(r.newcomers.value)} kind={r.newcomers.kind} guard={r.newcomers.guard} />;
    }
  };

  if (region.state === 'loading') return <TableSkeleton rows={8} />;
  if (region.state === 'slow') return <SlowState variant="inline" onRetry={region.retry} />;
  if (region.state === 'error') return <ErrorState variant="inline" title={t('error.generic')} onRetry={region.retry} />;

  const anyBudget = entries.some((e) => e.budget && !e.data);
  const header = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '8px', flexWrap: 'wrap' }}>
        <Typography variant="titleSm" component="h2" sx={{ m: 0, mr: 'auto' }}>{t('compare.title')}</Typography>
      </Box>
      {anyBudget ? (
        <Box sx={{ mb: '8px' }}>
          <Banner tone="info" title={t('error.budget')} data-testid="research-compare-budget" />
        </Box>
      ) : null}
    </>
  );

  if (mobile) {
    const idx = Math.min(current, Math.max(0, entries.length - 1));
    const entry = entries[idx];
    return (
      <Box sx={{ mb: '24px' }} data-testid="research-compare">
        {header}
        <SegmentedControl
          value={String(idx)}
          onChange={(v) => setCurrent(Number(v))}
          options={entries.map((e, i) => ({ value: String(i), label: e.query }))}
          fullWidth
          aria-label={t('compare.title')}
        />
        {entry ? (
          <Box sx={{ mt: '12px' }}>
            <KeyValueList items={METRICS.map((m) => ({ label: t(`compare.row.${m}`), value: cell(m, entry.data, entry.budget) }))} />
            <Box sx={{ mt: '8px' }}>
              <IconButton icon={icons.close} label={t('compare.remove', { q: entry.query })} onClick={() => onRemove(entry.query)} />
            </Box>
          </Box>
        ) : null}
        <ApiSourceNote source={source} />
      </Box>
    );
  }

  type Row = { id: MetricKey };
  const columns: Column<Row>[] = [
    { key: 'metric', header: t('compare.col.metric'), width: 200, render: (r) => t(`compare.row.${r.id}`), mobile: 'title' },
    ...entries.map((e, i) => ({
      key: `q${i}`,
      header: e.query,
      minWidth: 200,
      render: (r: Row) => cell(r.id, e.data, e.budget),
      mobile: 'meta' as const,
    })),
  ];

  return (
    <Box sx={{ mb: '24px' }} data-testid="research-compare">
      {header}
      <Box sx={{ display: 'flex', gap: '8px', mb: '8px', flexWrap: 'wrap' }}>
        {entries.map((e) => (
          <Box key={e.query} sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px', pl: '10px', border: `1px solid ${neutral[300]}`, borderRadius: '999px' }}>
            <Typography variant="body2" component="span">{e.query}</Typography>
            <IconButton icon={icons.close} size="sm" label={t('compare.remove', { q: e.query })} onClick={() => onRemove(e.query)} />
          </Box>
        ))}
      </Box>
      <DataTable
        rows={METRICS.map((id) => ({ id }))}
        columns={columns}
        getRowId={(r) => r.id}
        state="ready"
        columnStateKey="kx.research.compare"
        stickyHeader={false}
        layout="table"
        ariaLabel={t('compare.title')}
      />
      <Box sx={{ mt: '8px' }}>
        <ApiSourceNote source={source} />
      </Box>
    </Box>
  );
}

export default ComparePanel;

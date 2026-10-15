// components/domain/overview/KpiRow.tsx (overview G6, §3.1) — four KpiTiles: To ship · Overdue · Revenue (7 days) ·
// Needs reply (or Orders (7 days) when neither Wix nor Trendyol is connected). Every tile has a source and an
// as-of time (P6). A failed section shows `—` with a retry in the tile corner; a failed messages fetch shows `—`,
// never 0. Mixed currencies are never summed without `≈` and the FX note; unconverted currencies are named.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { KpiTile, LogoTile, type KpiDelta } from '@/components/ds/data';
import { Money, Num } from '@/components/ds/format';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { Tooltip } from '@/components/ds/overlay/Tooltip';
import { KpiSkeleton } from '@/components/ds/state/Skeletons';
import { icons } from '@/lib/ds/icons';
import { useFormatters } from '@/lib/format';
import { neutral, px, space } from '@/lib/ds/tokens';
import type { MessageCountsResponse } from '@/types/messages';
import type { OverviewSummary, Revenue7d } from '@/lib/overview/types';

/** Wix caps its unread count at this many (messages API `limit: 50`): shown as "50+". */
export const WIX_COUNT_CAP = 50;

export interface KpiRowMessages {
  counts: MessageCountsResponse;
  /** Client ms of the last good counts response; null = not fetched yet. */
  fetchedAt: number | null;
  failed: boolean;
  /** Connected message channels (only these are named in the caption). */
  wix: boolean;
  trendyol: boolean;
}

export interface KpiRowProps {
  summary: OverviewSummary | undefined;
  /**
   * First load: skeleton tiles. When false with no summary (the whole request failed or timed out), the
   * tiles render `—` with a corner retry instead (DS P6: never a stuck skeleton); Needs reply still reads
   * the message-count store.
   */
  loading: boolean;
  messages: KpiRowMessages;
  hrefs: { toShip: string; overdue: string; revenue: string; messages: string };
  onRetry: () => void;
}

/** Pure: "#1234" (a stored leading # is not doubled). */
export function orderNumberText(n: string): string {
  return `#${n.replace(/^#/, '')}`;
}

/** Pure: KPI delta, omitted when the previous value is 0 or unknown (KpiTile rule). */
export function kpiDelta(value: number | null, previous: number | null, period: string): KpiDelta | undefined {
  if (value == null || previous == null || previous === 0) return undefined;
  return { value: (value - previous) / previous, period, goodWhen: 'up' };
}

/** Pure: the "Needs reply" total display (null = unknown). `capped` when Wix hit its 50 cap. */
export function needsReplyValue(m: Pick<KpiRowMessages, 'counts' | 'failed' | 'fetchedAt'>): { value: number; capped: boolean } | null {
  if (m.failed || m.fetchedAt == null) return null;
  return { value: m.counts.total, capped: m.counts.wix >= WIX_COUNT_CAP };
}

function Retry({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <Box sx={{ position: 'absolute', top: px(space[2]), right: px(space[2]) }}>
      <IconButton icon={icons.pull} label={label} size="sm" onClick={onRetry} data-testid="kpi-retry" />
    </Box>
  );
}

function Dash({ tip }: { tip: string }) {
  return (
    <Tooltip title={tip}>
      <span>{'—'}</span>
    </Tooltip>
  );
}

function RevenueValue({ r, t }: { r: Revenue7d; t: ReturnType<typeof useTranslations> }) {
  const fmt = useFormatters();
  const excluded = r.unconverted.length
    ? t('kpi.fxExcluded', {
        list: r.unconverted.map((u) => t('kpi.fxExcludedItem', { currency: u.currency, count: u.orders })).join(', '),
      })
    : null;
  if (r.value != null) {
    const note = [
      r.ratesAsOf ? t('kpi.fxNote', { date: fmt.date(r.ratesAsOf, 'datetime') }) : null,
      r.ratesStale ? t('kpi.fxStale') : null,
      excluded,
    ]
      .filter(Boolean)
      .join('. ');
    return <Money amount={r.value} currency={r.currency} approx={r.approx} fxNote={note || undefined} compact />;
  }
  // No rates: per currency, never summed (DS §3.12), at most 2 shown, the rest in the tooltip.
  const parts = r.perCurrency.filter((p) => p.value !== 0);
  if (!parts.length) return <Money amount={0} currency={r.currency} compact />;
  const shown = parts.slice(0, 2);
  const rest = parts.slice(2);
  const body = (
    <span data-testid="kpi-revenue-per-currency">
      {shown.map((p, i) => (
        <React.Fragment key={p.currency}>
          {i > 0 ? ' · ' : null}
          <Money amount={p.value} currency={p.currency} compact />
        </React.Fragment>
      ))}
      {rest.length ? ` ${t('attention.more', { count: rest.length })}` : null}
    </span>
  );
  if (!rest.length) return body;
  return <Tooltip title={rest.map((p) => fmt.money(p.value, p.currency)).join(' · ')}>{body}</Tooltip>;
}

export function KpiRow({ summary, loading, messages, hrefs, onRetry }: KpiRowProps) {
  const t = useTranslations('overview');
  const fmt = useFormatters();
  if (loading) return <KpiSkeleton count={4} />;

  // No summary (whole request failed): as-of = the failed check, every summary tile shows `—` + retry.
  const asOf = summary ? new Date(summary.generatedAt) : new Date();
  const toShip = summary?.toShip ?? null;
  const kpis = summary?.kpis ?? null;
  const failTip = t('kpi.loadFailed');
  const showMessages = messages.wix || messages.trendyol;

  // ── To ship ──
  const toShipCaption = toShip
    ? [
        toShip.dueToday > 0 ? t('kpi.dueToday', { count: toShip.dueToday }) : null,
        toShip.withoutShipBy > 0 ? t('kpi.withoutShipBy', { count: toShip.withoutShipBy }) : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined
    : undefined;

  // ── Overdue ──
  const first = toShip?.firstOverdue ?? null;
  const overdueCaption = toShip ? (
    toShip.overdue > 0 && first ? (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: px(space[1]), minWidth: 0 }}>
        <LogoTile brand={first.channel} size={16} />
        <Box component="span" sx={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {orderNumberText(first.orderNumber)}
        </Box>
      </Box>
    ) : toShip.overdue === 0 ? (
      t('kpi.noneOverdue')
    ) : undefined
  ) : undefined;

  // ── Revenue ──
  const r = kpis?.revenue7d ?? null;
  const revenueDelta = r ? kpiDelta(r.value, r.previous, t('kpi.vsPrev7')) : undefined;
  const revenueCaption = r
    ? [
        r.previous === 0 && (r.value ?? 0) > 0 ? t('kpi.new') : null,
        r.ratesStale ? t('kpi.fxStale') : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined
    : undefined;

  // ── 4th tile ──
  let fourth: React.ReactNode;
  if (showMessages) {
    const nr = needsReplyValue(messages);
    const channels = [
      messages.trendyol ? `Trendyol ${fmt.num(messages.counts.trendyol)}` : null,
      messages.wix ? `Wix ${messages.counts.wix >= WIX_COUNT_CAP ? `${fmt.num(WIX_COUNT_CAP)}+` : fmt.num(messages.counts.wix)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    fourth =
      messages.fetchedAt == null && !messages.failed ? (
        <KpiTile label={t('kpi.needsReply')} value={null} loading source={t('kpi.sourceMessages')} asOf={new Date()} data-testid="kpi-needs-reply" />
      ) : (
        <KpiTile
          label={t('kpi.needsReply')}
          value={nr ? (nr.capped ? `${fmt.num(nr.value)}+` : <Num value={nr.value} />) : '—'}
          caption={nr ? channels || undefined : t('kpi.messagesFailed')}
          source={t('kpi.sourceMessages')}
          asOf={new Date(messages.fetchedAt ?? Date.now())}
          href={hrefs.messages}
          data-testid="kpi-needs-reply"
        />
      );
  } else {
    const o = kpis?.orders7d ?? null;
    fourth = (
      <Box sx={{ position: 'relative', height: '100%' }}>
        <KpiTile
          label={t('kpi.orders7d')}
          value={o ? <Num value={o.value} compact /> : <Dash tip={failTip} />}
          delta={o ? kpiDelta(o.value, o.previous, t('kpi.vsPrev7')) : undefined}
          caption={o && o.previous === 0 && o.value > 0 ? t('kpi.new') : undefined}
          source={t('kpi.sourceOrders')}
          asOf={asOf}
          href={o ? hrefs.revenue : undefined}
          data-testid="kpi-orders7d"
        />
        {o ? null : <Retry label={failTip} onRetry={onRetry} />}
      </Box>
    );
  }

  return (
    <Box
      data-testid="overview-kpis"
      sx={{
        display: 'grid',
        gap: { xs: px(space[2]), md: px(space[4]) },
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
        '@media (min-width: 1100px)': { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
      }}
    >
      <Box sx={{ position: 'relative', height: '100%' }}>
        <KpiTile
          label={t('kpi.toShip')}
          value={toShip ? <Num value={toShip.count} compact /> : <Dash tip={failTip} />}
          caption={toShipCaption}
          source={t('kpi.sourceOrders')}
          asOf={asOf}
          href={toShip ? hrefs.toShip : undefined}
          data-testid="kpi-to-ship"
        />
        {toShip ? null : <Retry label={failTip} onRetry={onRetry} />}
      </Box>
      <Box sx={{ position: 'relative', height: '100%' }}>
        <KpiTile
          label={t('kpi.overdue')}
          value={toShip ? <Num value={toShip.overdue} compact /> : <Dash tip={failTip} />}
          valueTone={toShip && toShip.overdue > 0 ? 'danger' : 'default'}
          caption={overdueCaption}
          source={t('kpi.sourceOrders')}
          asOf={asOf}
          href={toShip ? hrefs.overdue : undefined}
          data-testid="kpi-overdue"
        />
        {toShip ? null : <Retry label={failTip} onRetry={onRetry} />}
      </Box>
      <Box sx={{ position: 'relative', height: '100%' }}>
        <KpiTile
          label={t('kpi.revenue7d')}
          value={r ? <RevenueValue r={r} t={t} /> : <Dash tip={failTip} />}
          delta={revenueDelta}
          caption={revenueCaption}
          source={r && (r.approx || r.unconverted.length) ? t('kpi.sourceOrdersFx') : t('kpi.sourceOrders')}
          asOf={asOf}
          href={r ? hrefs.revenue : undefined}
          data-testid="kpi-revenue"
        />
        {r ? null : <Retry label={failTip} onRetry={onRetry} />}
      </Box>
      <Box sx={{ minWidth: 0, color: neutral[900] }}>{fourth}</Box>
    </Box>
  );
}

export default KpiRow;

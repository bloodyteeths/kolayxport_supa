// components/domain/overview/AttentionQueue.tsx (overview G6, §3.2) — "Needs your attention": one card, one row per
// kind (from `attentionRows.ts`), ≤ 7 visible + "Show N more" (in place, not persisted). Row CTAs are secondary
// (the page primary stays the only primary, P1). Mobile: no CTA, the whole 56px row is the link ("›").
// States: loading (client-cache rows + 3 skeleton rows), done, partial (one "Couldn't check …" row; never
// "All caught up"), whole error (client-cache rows stay), stale (older summary under "Showing data from …"),
// not connected, no orders yet. `j`/`k` move focus through the rows; Enter follows the focused row.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { LogoTile, ScoreMeter, Thumb } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Button } from '@/components/ds/inputs/Button';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { Bone } from '@/components/ds/state/Skeletons';
import { SlowState } from '@/components/ds/state/SlowState';
import { useNotificationText } from '@/components/notification-center/useNotificationText';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { icons } from '@/lib/ds/icons';
import { useFormatters } from '@/lib/format';
import { settingsHref } from '@/lib/nav/links';
import { accent, neutral, px, radius, space } from '@/lib/ds/tokens';
import type { SectionKey } from '@/lib/overview/types';
import {
  ATTENTION_VISIBLE_ROWS,
  type AttentionModel,
  type AttentionPill,
  type AttentionRow,
  type AttentionText,
  type QueueState,
} from './attentionRows';

export interface AttentionQueueProps {
  model: AttentionModel;
  state: QueueState;
  /** The first load passed 15 s: "Still loading… [Retry]" instead of the skeleton rows. */
  slow?: boolean;
  /** `summary.requestId` for "Copy error ID" on the partial row. */
  requestId?: string;
  /** An error over an older summary: "Showing data from {time} · Retry" above the rows. */
  staleSince?: Date | null;
  onRetry: () => void;
  retrying?: boolean;
  /** "No orders yet" → Refresh orders (click only). */
  onRefreshOrders: () => void;
  refreshing: boolean;
  refreshDisabledReason?: string;
  orderSyncLimit: number | null;
}

/** Renders one AttentionText. */
export function useAttentionText(): (text: AttentionText | null) => string {
  const t = useTranslations();
  const fmt = useFormatters();
  const { title: notificationTitle } = useNotificationText();
  return React.useCallback(
    (text: AttentionText | null): string => {
      if (!text) return '';
      switch (text.kind) {
        case 'raw':
          return text.text;
        case 'shipBy':
          return fmt.shipBy(text.date);
        case 'notification':
          return notificationTitle({ type: text.type, titleKey: text.titleKey, params: text.params });
        default:
          // Keys are built from a closed set in attentionRows.ts (full paths from the root).
          return t(text.key as never, text.values as never);
      }
    },
    [t, fmt, notificationTitle],
  );
}

function Pill({ pill }: { pill: AttentionPill }) {
  if (pill.kind === 'score') return <ScoreMeter score={pill.score} variant="cell" />;
  return <StatusPill domain={pill.domain} status={pill.status as never} />;
}

function Lead({ row }: { row: AttentionRow }) {
  const lead = row.lead;
  if (!lead) return null;
  if (lead.kind === 'logo') return <LogoTile brand={lead.brand} size={20} />;
  return <Thumb src={lead.src} alt={lead.alt} size={32} />;
}

function QueueRow({ row, mobile, text, index }: { row: AttentionRow; mobile: boolean; text: (t: AttentionText | null) => string; index: number }) {
  const t = useTranslations('overview');
  const title = text(row.title);
  const detail = text(row.detail);
  const more = row.more > 0 ? t('attention.more', { count: row.more }) : '';
  const ctaLabel = text(row.cta.label);
  const Chevron = icons.disclosure;

  const lines = (
    <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: mobile ? 'column' : 'row', alignItems: mobile ? 'flex-start' : 'center', gap: mobile ? 0 : px(space[2]) }}>
      <Typography variant="label" component="span" noWrap sx={{ color: neutral[900], minWidth: 0, maxWidth: '100%', flexShrink: 1 }}>
        {title}
      </Typography>
      {detail || more ? (
        <Typography variant="dense" component="span" noWrap sx={{ color: neutral[500], minWidth: 0, maxWidth: '100%', flexShrink: 2 }}>
          {[detail, more].filter(Boolean).join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );

  const rowSx = {
    display: 'flex',
    alignItems: 'center',
    gap: px(space[3]),
    minHeight: 56,
    px: px(space[4]),
    borderTop: index === 0 ? 'none' : `1px solid ${neutral[100]}`,
    minWidth: 0,
  } as const;

  if (mobile) {
    return (
      <Box
        component={NextLink}
        href={row.cta.href}
        data-testid={`attention-row-${row.id}`}
        data-kind={row.kind}
        data-attention-row=""
        aria-label={[title, detail, more, ctaLabel].filter(Boolean).join(', ')}
        sx={{ ...rowSx, px: px(space[3]), color: 'inherit', textDecoration: 'none', '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: -2 } }}
      >
        <Box sx={{ flexShrink: 0 }}>
          <Pill pill={row.pill} />
        </Box>
        <Lead row={row} />
        {lines}
        <Box component="span" sx={{ display: 'inline-flex', color: neutral[400], flexShrink: 0 }}>
          <Chevron size={16} aria-hidden />
        </Box>
      </Box>
    );
  }

  return (
    <Box data-testid={`attention-row-${row.id}`} data-kind={row.kind} sx={rowSx}>
      <Box sx={{ width: 140, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <Pill pill={row.pill} />
      </Box>
      <Lead row={row} />
      {lines}
      <Box sx={{ flexShrink: 0 }} data-attention-row="">
        <Button variant="secondary" size="sm" href={row.cta.href} data-testid={`attention-cta-${row.id}`}>
          {ctaLabel}
        </Button>
      </Box>
    </Box>
  );
}

function SkeletonRows() {
  return (
    <Box data-testid="attention-loading" aria-busy>
      {[0, 1, 2].map((i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: px(space[3]), minHeight: 56, px: px(space[4]), borderTop: i === 0 ? 'none' : `1px solid ${neutral[100]}` }}>
          <Bone w={96} h={20} />
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: px(space[1]) }}>
            <Bone w="45%" h={12} />
            <Bone w="30%" h={10} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** Pure: the section names in "Couldn't check {sections}". */
export function failedSectionsLabel(sections: readonly SectionKey[], label: (k: SectionKey) => string): string {
  return sections.map(label).join(', ');
}

export function AttentionQueue({
  model,
  state,
  slow,
  requestId,
  staleSince,
  onRetry,
  retrying,
  onRefreshOrders,
  refreshing,
  refreshDisabledReason,
  orderSyncLimit,
}: AttentionQueueProps) {
  const t = useTranslations('overview');
  const fmt = useFormatters();
  const mobile = useIsMobile();
  const text = useAttentionText();
  const [expanded, setExpanded] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const rows = model.rows;
  const visible = expanded ? rows : rows.slice(0, ATTENTION_VISIBLE_ROWS);
  const hidden = rows.length - visible.length;

  // j / k: move focus through the rows' links (desktop: the CTA; mobile: the row itself).
  const move = React.useCallback((dir: 1 | -1) => {
    const root = listRef.current;
    if (!root) return false;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-attention-row]')).map(
      (el) => (el.tagName === 'A' ? el : el.querySelector<HTMLElement>('a,button')) ?? el,
    );
    if (!targets.length) return false;
    const current = targets.findIndex((el) => el === document.activeElement);
    const next = current === -1 ? (dir === 1 ? 0 : targets.length - 1) : Math.min(targets.length - 1, Math.max(0, current + dir));
    targets[next]?.focus();
    return true;
  }, []);
  useShortcuts({ j: () => move(1), k: () => move(-1) });

  const partial = model.failedSections.length ? (
    <Box sx={{ px: px(space[4]), py: px(space[2]), borderTop: rows.length ? `1px solid ${neutral[100]}` : 'none' }} data-testid="attention-partial">
      <ErrorState
        variant="inline"
        title={t('attention.checkFailed', { sections: failedSectionsLabel(model.failedSections, (k) => t(`section.sources.${k}` as never)) })}
        errorId={requestId}
        onRetry={onRetry}
        retrying={retrying}
      />
    </Box>
  ) : null;

  let body: React.ReactNode = null;
  switch (state) {
    case 'loading':
      body = slow ? (
        <Box sx={{ px: px(space[4]), py: px(space[3]) }}>
          <SlowState variant="inline" onRetry={onRetry} data-testid="attention-slow" />
        </Box>
      ) : (
        <SkeletonRows />
      );
      break;
    case 'error':
      body = (
        <Box sx={{ px: px(space[4]), py: px(space[2]) }} data-testid="attention-error">
          <ErrorState variant="inline" title={t('attention.loadFailed')} onRetry={onRetry} retrying={retrying} />
        </Box>
      );
      break;
    case 'done':
      body = rows.length ? null : <EmptyState kind="done" compact title={t('attention.doneTitle')} body={t('attention.doneBody')} data-testid="attention-done" />;
      break;
    case 'doneWithErrors':
      body = (
        <Typography variant="dense" component="p" sx={{ m: 0, px: px(space[4]), pt: px(space[3]), color: neutral[600] }} data-testid="attention-done-errors">
          {t('attention.doneWithErrors', { count: model.failedSections.length })}
        </Typography>
      );
      break;
    case 'notConnected':
      body = (
        <EmptyState
          kind="first-use"
          compact
          title={t('attention.notConnectedTitle')}
          actionNode={
            <Button variant="secondary" size="sm" href={settingsHref('connections')} data-testid="attention-connect">
              {t('actions.connectStore')}
            </Button>
          }
          data-testid="attention-not-connected"
        />
      );
      break;
    case 'noOrders':
      body = (
        <EmptyState
          kind="first-use"
          compact
          title={t('attention.noOrdersTitle')}
          body={t('attention.noOrdersBody')}
          actionNode={
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefreshOrders}
              loading={refreshing}
              loadingLabel={t('meta.refreshing')}
              disabled={Boolean(refreshDisabledReason)}
              disabledReason={refreshDisabledReason}
              data-testid="attention-refresh"
            >
              {t('attention.refreshOrders')}
            </Button>
          }
          footnote={orderSyncLimit != null ? t('setup.quota', { limit: orderSyncLimit }) : undefined}
          data-testid="attention-no-orders"
        />
      );
      break;
    default:
      body = null;
  }

  return (
    <Section
      variant="card"
      flush
      title={t('attention.title')}
      headerSlot={
        rows.length > 0 ? (
          <Box
            component="span"
            className="tnum"
            aria-label={t('attention.count', { count: rows.length })}
            title={t('attention.count', { count: rows.length })}
            sx={{ fontSize: 12, lineHeight: '20px', px: px(space[2]), borderRadius: `${radius.full}px`, bgcolor: neutral[100], color: neutral[700] }}
            data-testid="attention-count"
          >
            {fmt.num(rows.length)}
          </Box>
        ) : undefined
      }
      data-testid="overview-attention"
    >
      {staleSince ? (
        <Box sx={{ px: px(space[4]), pt: px(space[2]) }}>
          <ErrorState variant="stale" staleSince={staleSince} onRetry={onRetry} retrying={retrying} />
        </Box>
      ) : null}
      <Box ref={listRef} role="list" aria-label={t('attention.title')}>
        {visible.map((r, i) => (
          <Box role="listitem" key={r.id}>
            <QueueRow row={r} mobile={mobile} text={text} index={i} />
          </Box>
        ))}
      </Box>
      {rows.length > ATTENTION_VISIBLE_ROWS ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: px(space[1]), borderTop: `1px solid ${neutral[100]}` }}>
          <Button variant="ghost" size={mobile ? 'lg' : 'sm'} onClick={() => setExpanded((e) => !e)} data-testid="attention-toggle">
            {expanded ? t('attention.showLess') : t('attention.showMore', { count: hidden })}
          </Button>
        </Box>
      ) : null}
      {body}
      {state === 'error' || state === 'loading' ? null : partial}
      {state === 'doneWithErrors' ? <Box sx={{ pb: px(space[2]) }} /> : null}
    </Section>
  );
}

export default AttentionQueue;

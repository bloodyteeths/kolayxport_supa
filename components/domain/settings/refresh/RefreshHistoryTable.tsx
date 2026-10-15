// components/domain/settings/refresh/RefreshHistoryTable.tsx — the run list of Settings › Refresh history
// (settings §8): DS DataTable compact (cards below 900px), "Load more" footer by cursor.
import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Button } from '@/components/ds/inputs';
import { EmptyState, ErrorState } from '@/components/ds/state';
import type { ActionSpec } from '@/components/ds/types/actions';
import { icons } from '@/lib/ds/icons';
import { useFormatters } from '@/lib/format';
import { neutral, px, space, tone } from '@/lib/ds/tokens';
import { canRetry, type RunRow } from './refreshModel';

/** Translated run type ("Full refresh", "Etsy refresh"); unknown types read "Refresh" (raw value in the tooltip). */
export function useRunTypeLabel(): (r: RunRow) => string {
  const t = useTranslations('settings.refresh.types');
  return useCallback((r: RunRow) => (r.typeKey === 'store' ? t('store', { store: r.store ?? '' }) : t(r.typeKey)), [t]);
}

export interface RefreshHistoryTableProps {
  rows: RunRow[];
  state: 'loading' | 'error' | 'empty' | 'ready';
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  onReload: () => void;
  onViewErrors: (row: RunRow) => void;
  onRetry: (row: RunRow) => void;
  retryingId: string | null;
  /** Empty state action ("Refresh all orders"). */
  emptyAction?: ActionSpec;
  /** Row whose errors panel is open. */
  activeRowId?: string | null;
}

export function RefreshHistoryTable(props: RefreshHistoryTableProps) {
  const {
    rows, state, hasMore, loadingMore, loadMoreFailed, onLoadMore, onReload, onViewErrors, onRetry, retryingId, emptyAction, activeRowId,
  } = props;
  const t = useTranslations('settings.refresh');
  const f = useFormatters();
  const typeLabel = useRunTypeLabel();

  const columns: Column<RunRow>[] = useMemo(() => [
    {
      key: 'type', header: t('col.type'), mobile: 'title', minWidth: 160,
      value: (r) => typeLabel(r), render: (r) => typeLabel(r), cellTooltip: (r) => r.rawType || null,
    },
    {
      key: 'status', header: t('col.status'), mobile: 'status', width: 120,
      render: (r) => <StatusPill domain="run" status={r.status} raw={r.rawStatus} />,
    },
    { key: 'startedAt', header: t('col.started'), type: 'date', dateMode: 'datetime', mobile: 'meta', width: 150 },
    {
      key: 'duration', header: t('col.duration'), align: 'right', mobile: 'meta', width: 110,
      value: (r) => r.durationMs, render: (r) => (r.durationMs === null ? '—' : f.duration(r.durationMs)),
    },
    {
      key: 'orders', header: t('col.orders'), align: 'right', mobile: 'trailing', width: 190,
      value: (r) => r.processed,
      render: (r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} aria-label={t('ordersAria', { processed: r.processed, successful: r.successful, failed: r.failed })}>
          {f.num(r.processed)}
          {' / '}
          {f.num(r.successful)}
          {' / '}
          <span style={r.failed > 0 ? { color: tone.danger.fg } : undefined}>{f.num(r.failed)}</span>
        </span>
      ),
    },
  ], [t, f, typeLabel]);

  const rowActions = useCallback((r: RunRow): ActionSpec[] => {
    const out: ActionSpec[] = [];
    if (r.errors.length > 0) out.push({ id: `view-errors-${r.id}`, label: t('viewErrors'), icon: icons.error, onClick: () => onViewErrors(r) });
    if (canRetry(r)) {
      out.push({
        id: `retry-${r.id}`, label: t('retry'), icon: icons.pull, onClick: () => onRetry(r),
        loading: retryingId === r.id, loadingLabel: t('retrying'),
        disabled: retryingId !== null && retryingId !== r.id, disabledReason: t('retryBusy'),
      });
    }
    return out;
  }, [t, onViewErrors, onRetry, retryingId]);

  return (
    <div data-testid="refresh-history-table">
      <DataTable<RunRow>
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        state={state}
        density="compact"
        columnStateKey="settings.refreshHistory.v1"
        ariaLabel={t('title')}
        rowActions={rowActions}
        activeRowId={activeRowId}
        empty={<EmptyState kind="first-use" icon={icons.history} title={t('empty.title')} body={t('empty.body')} action={emptyAction} />}
        error={<ErrorState variant="inline" title={t('loadFailed')} onRetry={onReload} />}
      />
      {state === 'ready' ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: px(space[2]), paddingTop: px(space[3]) }} data-testid="refresh-history-footer">
          {loadMoreFailed ? (
            <>
              <span style={{ color: neutral[600], fontSize: 13 }}>{t('loadMoreFailed')}</span>
              <Button variant="ghost" size="sm" onClick={onLoadMore}>{t('retry')}</Button>
            </>
          ) : hasMore ? (
            <Button variant="secondary" size="sm" onClick={onLoadMore} loading={loadingMore} loadingLabel={t('loadingMore')} data-testid="refresh-history-load-more">
              {t('loadMore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default RefreshHistoryTable;

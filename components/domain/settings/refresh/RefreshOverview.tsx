// components/domain/settings/refresh/RefreshOverview.tsx — Settings › Refresh history (`?tab=syncAdvanced`,
// settings §8). Heading + "Last successful refresh" meta + one secondary action "Refresh all orders"
// (confirm first; disabled with a reason while a run is going), the run table and the errors panel.
// No primary on this tab (nothing here is state-driven). No danger zone.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs';
import { useConfirm } from '@/components/ds/overlay';
import { useToast } from '@/components/ds/feedback';
import type { ActionSpec } from '@/components/ds/types/actions';
import { icons } from '@/lib/ds/icons';
import { usePageActions } from '@/lib/ds/usePageActions';
import { useFormatters } from '@/lib/format';
import { PanelHeading } from '../sender/PanelHeading';
import { lastSuccess, type RunRow } from './refreshModel';
import { useRefreshHistory } from './useRefreshHistory';
import { RefreshHistoryTable } from './RefreshHistoryTable';
import { SyncErrorsPanel } from './SyncErrorsPanel';

export interface RefreshOverviewProps {
  /** Default true: section title + description (settings §1.3). */
  heading?: boolean;
  /** Reports whether the newest run failed (nav "danger dot", settings §1.2). */
  onLastRunFailedChange?: (failed: boolean) => void;
}

export function RefreshOverview({ heading = true, onLastRunFailedChange }: RefreshOverviewProps) {
  const t = useTranslations('settings.refresh');
  const confirm = useConfirm();
  const toast = useToast();
  const f = useFormatters();
  const h = useRefreshHistory();
  const [errorsRunId, setErrorsRunId] = useState<string | null>(null);
  const errorsRun = useMemo(() => h.rows.find((r) => r.id === errorsRunId) ?? null, [h.rows, errorsRunId]);

  const lastFailed = h.rows[0]?.status === 'failed';
  useEffect(() => { onLastRunFailedChange?.(lastFailed); }, [lastFailed, onLastRunFailedChange]);

  const busy = h.running || h.startingFull;

  const refreshAll = useCallback(async () => {
    if (busy) return;
    const ok = await confirm({ title: t('confirm.title'), body: t('confirm.body'), confirmLabel: t('refreshAll') });
    if (!ok) return;
    const started = await h.startFullRefresh();
    if (started) toast.success(t('started'));
    else toast.error(t('startFailed'), { persist: false });
  }, [busy, confirm, h, t, toast]);

  const retry = useCallback(async (row: RunRow) => {
    const ok = await confirm({ title: t('retryConfirm.title'), body: t('retryConfirm.body'), confirmLabel: t('retry') });
    if (!ok) return;
    const started = await h.retry(row.id);
    if (started) toast.success(t('retryStarted'));
    else toast.error(t('retryFailed'), { persist: false });
  }, [confirm, h, t, toast]);

  const refreshAction: ActionSpec = {
    id: 'settings-refresh-all',
    label: t('refreshAll'),
    icon: icons.pull,
    onClick: () => { void refreshAll(); },
    loading: h.startingFull,
    loadingLabel: t('refreshing'),
    disabled: h.running,
    disabledReason: t('alreadyRunning'),
  };
  usePageActions([refreshAction]);

  const last = lastSuccess(h.rows);
  const meta = h.running
    ? t('refreshing')
    : last
      ? last.sources.length
        ? t('lastSuccess', { time: f.date(last.at, 'datetime'), sources: last.sources.join(', ') })
        : t('lastSuccessNoSources', { time: f.date(last.at, 'datetime') })
      : null;

  return (
    <div data-testid="refresh-overview">
      {heading ? (
        <PanelHeading
          title={t('title')}
          description={t('description')}
          meta={meta}
          action={(
            <Button
              variant="secondary"
              size="sm"
              icon={icons.pull}
              onClick={() => { void refreshAll(); }}
              loading={h.startingFull}
              loadingLabel={t('refreshing')}
              disabled={h.running}
              disabledReason={t('alreadyRunning')}
              data-testid="refresh-all"
            >
              {t('refreshAll')}
            </Button>
          )}
        />
      ) : null}
      <RefreshHistoryTable
        rows={h.rows}
        state={h.state}
        hasMore={h.hasMore}
        loadingMore={h.loadingMore}
        loadMoreFailed={h.loadMoreFailed}
        onLoadMore={h.loadMore}
        onReload={() => { void h.reload(); }}
        onViewErrors={(r) => setErrorsRunId(r.id)}
        onRetry={(r) => { void retry(r); }}
        retryingId={h.retryingId}
        emptyAction={{ ...refreshAction, id: 'settings-refresh-all-empty' }}
        activeRowId={errorsRunId}
      />
      <SyncErrorsPanel run={errorsRun} onClose={() => setErrorsRunId(null)} />
    </div>
  );
}

export default RefreshOverview;

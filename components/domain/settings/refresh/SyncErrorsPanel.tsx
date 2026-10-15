// components/domain/settings/refresh/SyncErrorsPanel.tsx — "View errors" for one refresh run (settings §8).
// SidePanel md, read-only rows "message · order #"; footer secondary "Copy error details" copies the JSON.
// Replaces the raw JSON ErrorDetailsDialog (legacy copy: components/legacy/settings/ErrorDetailsDialogLegacy.tsx).
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { DateText } from '@/components/ds/format';
import { useToast } from '@/components/ds/feedback';
import { EmptyState } from '@/components/ds/state';
import { icons } from '@/lib/ds/icons';
import { copyText } from '@/lib/hooks/useCopy';
import { font, neutral, px, space, type as typeScale } from '@/lib/ds/tokens';
import { errorDetailsText, type RunRow } from './refreshModel';
import { useRunTypeLabel } from './RefreshHistoryTable';

export interface SyncErrorsPanelProps {
  run: RunRow | null;
  onClose: () => void;
}

export function SyncErrorsPanel({ run, onClose }: SyncErrorsPanelProps) {
  const t = useTranslations('settings.refresh');
  const toast = useToast();
  const typeLabel = useRunTypeLabel();
  const open = Boolean(run);

  const copy = async () => {
    if (!run) return;
    const ok = await copyText(errorDetailsText(run));
    if (ok) toast.success(t('copied'));
    else toast.error(t('copyFailed'), { persist: false });
  };

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="md"
      title={t('errorsTitle')}
      status={run ? <StatusPill domain="run" status={run.status} raw={run.rawStatus} /> : null}
      meta={run ? (
        <span>
          {typeLabel(run)}
          {run.startedAt ? <>{' · '}<DateText value={run.startedAt} mode="datetime" /></> : null}
        </span>
      ) : null}
      secondary={run && run.errors.length ? { id: 'sync-errors-copy', label: t('copyErrors'), icon: icons.copy, onClick: () => { void copy(); } } : undefined}
      data-testid="sync-errors-panel"
    >
      {run && run.errors.length ? (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="sync-errors-list">
          {run.errors.map((e, i) => (
            <li
              key={i}
              style={{
                padding: `${px(space[2])} 0`, borderBottom: `1px solid ${neutral[100]}`,
                fontSize: typeScale.body[0], lineHeight: px(typeScale.body[1]), color: neutral[800], wordBreak: 'break-word',
              }}
            >
              <span>{e.message}</span>
              {e.orderId ? (
                <span style={{ color: neutral[500] }}>
                  {' · '}
                  <span style={{ fontFamily: font.mono, fontSize: 13 }}>{t('orderRef', { id: e.orderId })}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : run ? (
        <EmptyState kind="done" compact title={t('noErrors')} />
      ) : null}
    </SidePanel>
  );
}

export default SyncErrorsPanel;

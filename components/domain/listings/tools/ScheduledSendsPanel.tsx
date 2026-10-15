// components/domain/listings/tools/ScheduledSendsPanel.tsx — listings-grid §10 "Scheduled sends" (M5 G6).
// SidePanel md: a DataTable of drafts with `scheduledSendAt` (thumb, title, changed fields, date-time, sync pill).
// Row ⋯: Send now · Change time… · Unschedule. Empty → EmptyState done "Nothing scheduled".
// The server cron sends scheduled drafts with every tab closed (G4); this panel only lists and edits them.
// Safety: "Send now" never sends a conflict (it must be reviewed in the editor) and never a queued delete
// (deletions go through "Send deletion…" with type-to-confirm on the listing row).
//
// Data: `GET /api/listings?…&sync=pending,syncing,sync_failed,conflict&scheduled=1&size=250`, paged until the total
// is covered; rows without `sync.scheduledSendAt` are dropped client-side (so it also works before G1 honours
// `scheduled=1`, and shows nothing until BR-1a lands, when `scheduledSendAt` is always null).
import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay/SidePanel';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { DateTimeField } from '@/components/ds/inputs/DateTimeField';
import { DataTable, type Column } from '@/components/ds/data/DataTable';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { EmptyState } from '@/components/ds/state/EmptyState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';
import { useToast } from '@/components/ds/feedback/toast';
import type { ActionSpec } from '@/components/ds/types/actions';
import { useFormatters } from '@/lib/format';
import { icons } from '@/lib/ds/icons';
import { neutral as n } from '@/lib/ds/tokens';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import { fetchToolJson, storeSearchParams, textStyle, ToolFetchError, type ListingsToolContext, type ListingsToolPanelProps } from './ToolsMenuItems';

const PAGE_SIZE = 250;
const MAX_PAGES = 20;

export type ScheduledRow = ListingRow & { sync: NonNullable<ListingRow['sync']> & { scheduledSendAt: string } };

export function isScheduledRow(r: ListingRow): r is ScheduledRow {
  return !!r.sync?.scheduledSendAt;
}

/** Loads every open draft of the store and keeps the scheduled ones, soonest first. */
export async function loadScheduledRows(ctx: Pick<ListingsToolContext, 'query' | 'store' | 'marketplace'>): Promise<ScheduledRow[]> {
  const out: ScheduledRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const p = storeSearchParams(ctx);
    p.set('sync', 'pending,syncing,sync_failed,conflict');
    p.set('scheduled', '1');
    p.set('sort', 'updated.desc');
    p.set('size', String(PAGE_SIZE));
    p.set('page', String(page));
    const res = await fetchToolJson<ListingsResponse>(`/api/listings?${p.toString()}`);
    out.push(...res.rows.filter(isScheduledRow));
    if (page * PAGE_SIZE >= res.total || res.rows.length < PAGE_SIZE) break;
  }
  return out.sort((a, b) => Date.parse(a.sync.scheduledSendAt) - Date.parse(b.sync.scheduledSendAt));
}

/** Why "Send now" is not offered for a row, or null. */
export function sendNowBlock(r: ScheduledRow): 'conflict' | 'delete' | 'syncing' | null {
  if (r.sync.queuedDelete) return 'delete';
  if (r.sync.status === 'conflict') return 'conflict';
  if (r.sync.status === 'syncing') return 'syncing';
  return null;
}

const KNOWN_FIELDS = new Set(['title', 'price', 'quantity', 'tags', 'description']);

export function ScheduledSendsPanel({ open, onClose, ctx }: ListingsToolPanelProps) {
  const t = useTranslations('listings');
  const tOverlay = useTranslations('ds.overlay');
  const toast = useToast();
  const fmt = useFormatters();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: ScheduledRow; at: Date | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const key = open && ctx.store ? ['listings-scheduled', ctx.marketplace, ctx.query.store ?? ctx.store.id] : null;
  const { data, error, isLoading, mutate } = useSWR(key, () => loadScheduledRows(ctx), { revalidateOnFocus: false });

  const to = t('mp.to', { marketplace: ctx.marketplace });
  const on = t('mp.on', { marketplace: ctx.marketplace });

  const refresh = () => {
    ctx.onChanged?.();
    void mutate();
  };

  const sendNow = async (r: ScheduledRow) => {
    setBusyId(r.id);
    try {
      const res = await ctx.adapter.send([r.sync.draftId]);
      if (res.conflicts.length) toast.error(t('panel.conflict', { on }), { persist: false });
      else if (res.failed.length || !res.sent.length) toast.error(t('sched.sendFailed'), { persist: false });
      else toast.success(t('send.toastResult', { sent: res.sent.length, failed: 0, to }));
      refresh();
    } catch {
      toast.error(t('sched.sendFailed'), { persist: false });
    } finally {
      setBusyId(null);
    }
  };

  const reschedule = async (r: ScheduledRow, at: Date | null) => {
    setBusyId(r.id);
    try {
      await ctx.adapter.schedule([r.sync.draftId], at);
      toast.success(at ? t('sched.rescheduled') : t('sched.unscheduled'));
      refresh();
      return true;
    } catch {
      toast.error(t('cell.stageFailed'), { persist: false });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const columns = useMemo<Column<ScheduledRow>[]>(
    () => [
      { key: 'thumb', header: '', type: 'thumb', width: 64, value: (r) => r.thumbUrl, thumbAlt: (r) => r.title, mobile: 'media' },
      {
        key: 'listing',
        header: t('col.listing'),
        minWidth: 200,
        mobile: 'title',
        render: (r) => <span style={{ ...textStyle('body'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</span>,
        mobileRender: (r) => r.title,
      },
      {
        key: 'changes',
        header: t('col.changes'),
        minWidth: 140,
        mobile: 'subtitle',
        render: (r) => <span style={textStyle('dense', n[700])}>{changedText(t, r.sync.changedFields)}</span>,
        mobileRender: (r) => changedText(t, r.sync.changedFields),
      },
      { key: 'when', header: t('sched.when'), type: 'date', dateMode: 'datetime', width: 160, value: (r) => r.sync.scheduledSendAt, mobile: 'meta' },
      { key: 'sync', header: t('col.status'), type: 'status', width: 120, value: (r) => ({ domain: 'sync', status: r.sync.status }), mobile: 'status' },
    ],
    [t],
  );

  const rowActions = (r: ScheduledRow): ActionSpec[] => {
    const busy = busyId === r.id;
    const block = sendNowBlock(r);
    const reason =
      block === 'conflict' ? t('panel.conflict', { on }) : block === 'delete' ? t('sched.deleteNeedsReview') : block === 'syncing' ? t('cell.sending', { to }) : undefined;
    return [
      { id: 'sendNow', label: t('sched.sendNow'), icon: icons.push, onClick: () => void sendNow(r), disabled: busy || !!block, disabledReason: reason, loading: busy },
      { id: 'changeTime', label: t('sched.changeTime'), icon: icons.schedule, onClick: () => setEditing({ row: r, at: new Date(r.sync.scheduledSendAt) }), disabled: busy },
      { id: 'unschedule', label: t('sched.unschedule'), onClick: () => void reschedule(r, null), disabled: busy },
    ];
  };

  const loadError = error ? (error instanceof ToolFetchError ? error : new ToolFetchError(0)) : null;
  const now = new Date();

  return (
    <SidePanel open={open} onClose={onClose} size="md" title={t('tools.scheduled')} data-testid="listings-tool-scheduled">
      {loadError && !data ? (
        <ErrorState
          variant="inline"
          title={t('tools.loadFailed')}
          cause={loadError.status >= 500 || loadError.status === 0 ? t('error.serverNoResponse') : undefined}
          errorId={loadError.errorId}
          onRetry={() => void mutate()}
        />
      ) : isLoading || !data ? (
        <PanelSkeleton sections={2} />
      ) : data.length === 0 ? (
        <EmptyState kind="done" title={t('sched.none')} />
      ) : (
        <DataTable<ScheduledRow>
          rows={data}
          columns={columns}
          getRowId={(r) => r.sync.draftId}
          state="ready"
          rowActions={rowActions}
          density="compact"
          columnStateKey={`listings-scheduled-${ctx.marketplace}`}
          ariaLabel={t('tools.scheduled')}
          stickyHeader={false}
          caption={t('sched.timezone', { zone: fmt.timeZone })}
        />
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="sm"
        nested
        title={t('sched.title')}
        description={editing?.row.title}
        primary={{
          id: 'sched-save',
          label: t('sched.cta', { count: 1 }),
          icon: icons.schedule,
          loading: saving,
          disabled: !editing?.at || editing.at.getTime() <= now.getTime(),
          disabledReason: t('sched.pickFuture'),
          onClick: async () => {
            if (!editing?.at) return;
            setSaving(true);
            const ok = await reschedule(editing.row, editing.at);
            setSaving(false);
            if (ok) setEditing(null);
          },
        }}
        secondary={{ id: 'sched-cancel', label: tOverlay('cancel'), onClick: () => setEditing(null) }}
        data-testid="listings-sched-modal"
      >
        <FormField label={t('sched.date')}>
          <DateTimeField
            value={editing?.at ?? null}
            onChange={(at) => setEditing((e) => (e ? { ...e, at } : e))}
            timezone={fmt.timeZone}
            min={now}
            minutesStep={15}
          />
        </FormField>
      </Modal>
    </SidePanel>
  );
}

type T = ReturnType<typeof useTranslations>;

function changedText(t: T, fields: string[]): string {
  const known = fields.filter((f) => KNOWN_FIELDS.has(f));
  const other = fields.length - known.length;
  const parts = known.map((f) => t(`csv.fields.${f}`));
  if (other > 0) parts.push(t('sched.moreEdits', { count: other }));
  return parts.join(', ');
}

export default ScheduledSendsPanel;

// components/domain/listing-editor/ScheduleModal.tsx — listing-editor §4.1 "Schedule", §7.1 G3, §10 Group H.
// Footer ⋯ "Schedule send…": Modal sm with the M1-b DateTimeField in the seller's account timezone (CRITIQUE C13:
// one picker, never a second one). It only sets `scheduledSendAt` on the draft through M5's
// `scheduleDraftSend` (PATCH /api/{etsy,ebay}-drafts/:id). The server cron (lib/drafts/scheduledSend.ts) sends at
// that time through the same executor as an explicit Send: conflicts are never forced, and a draft with a queued
// delete is never scheduled (refused here up front and by the server, SCHEDULE_DELETE_REFUSED).
// Render the ⋯ item only when scheduled sends are available (backend BR-1a deployed); a 503 here says so inline.
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { DateTimeField } from '@/components/ds/inputs/DateTimeField';
import { Banner } from '@/components/ds/feedback/Banner';
import { useFormatters } from '@/lib/format';
import { neutral } from '@/lib/ds/tokens';
import { scheduleDraftSend } from '@/lib/catalogDrafts/client';
import { minScheduleTime } from '@/components/domain/listings/bulk/ScheduleSendModal';

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';
const SETTINGS_KEY = '/api/user/settings';

type SettingsSlice = { preferences?: { timezone?: string | null } | null };

const settingsFetcher = async (url: string): Promise<SettingsSlice> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

/** Why scheduling is not possible right now, or null. Pure (exported for tests). */
export function scheduleBlock(opts: { at: Date | null; min: Date; hasQueuedDelete: boolean; draftId: string | null }): 'delete' | 'noDraft' | 'pickTime' | 'pickFuture' | null {
  if (opts.hasQueuedDelete) return 'delete';
  if (!opts.draftId) return 'noDraft';
  if (!opts.at) return 'pickTime';
  if (opts.at.getTime() < opts.min.getTime()) return 'pickFuture';
  return null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  marketplace: 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';
  /** The listing's open draft (EtsyListingDraft / EbayListingDraft id). */
  draftId: string | null;
  /** The draft's current `scheduledSendAt` (null = not scheduled). */
  scheduledAt?: Date | string | null;
  /** A queued delete can never be scheduled (founder rule). */
  hasQueuedDelete: boolean;
  /** Seller timezone; default: account preferences (`/api/user/settings`) → Europe/Istanbul. */
  timezone?: string;
  /** Flush autosave before scheduling so the send carries every edit (`useListingEditor().saveNow`). Resolves with the draft id. */
  ensureSaved?: () => Promise<string | null | void>;
  /** After a successful schedule (Date) or unschedule (null). */
  onScheduled: (at: Date | null) => void;
  /** Test seam. */
  now?: Date;
}

export function ScheduleModal({
  open, onClose, marketplace, draftId, scheduledAt, hasQueuedDelete, timezone: tzProp, ensureSaved, onScheduled, now,
}: ScheduleModalProps) {
  const t = useTranslations();
  const fmt = useFormatters();
  const { data: settings } = useSWR<SettingsSlice>(tzProp ? null : SETTINGS_KEY, settingsFetcher, { revalidateOnFocus: false, dedupingInterval: 300_000 });
  const timezone = tzProp || settings?.preferences?.timezone || DEFAULT_TIMEZONE;
  const current = toDate(scheduledAt);
  const [at, setAt] = useState<Date | null>(current);
  const [busy, setBusy] = useState<'schedule' | 'unschedule' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `open` re-computes the minimum each time the modal opens (a modal left open does not drift).
  const min = useMemo(() => minScheduleTime(now ?? new Date()), [now, open]);

  useEffect(() => {
    if (open) {
      setAt(toDate(scheduledAt));
      setBusy(null);
      setError(null);
    }
  }, [open, scheduledAt]);

  const block = scheduleBlock({ at, min, hasQueuedDelete, draftId });
  const reason = block === 'delete'
    ? t('listings.draftError.scheduleDeleteRefused')
    : block === 'noDraft'
      ? t('listingEditor.schedule.noDraft')
      : block === 'pickTime'
        ? t('listings.sched.pickTime')
        : block === 'pickFuture'
          ? t('listings.sched.pickFuture')
          : undefined;

  const errorFrom = (failed: { key?: string; code?: string } | undefined): string => {
    if (failed?.key && t.has(failed.key)) return t(failed.key);
    return t('listingEditor.schedule.failed');
  };

  const submit = async (next: Date | null) => {
    if (busy) return;
    if (next && block) return;
    setBusy(next ? 'schedule' : 'unschedule');
    setError(null);
    try {
      let id = draftId;
      if (next && ensureSaved) id = (await ensureSaved()) || draftId;
      if (!id) {
        setError(t('listingEditor.schedule.noDraft'));
        return;
      }
      const res = await scheduleDraftSend(marketplace, [id], next);
      if (res.failed.length) {
        setError(errorFrom(res.failed[0]));
        return;
      }
      onScheduled(next);
      onClose();
    } catch {
      setError(t('listingEditor.schedule.failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('listingEditor.schedule.title')}
      primary={{
        id: 'le-schedule',
        label: current ? t('listingEditor.schedule.change') : t('listingEditor.schedule.cta'),
        onClick: () => void submit(at),
        loading: busy === 'schedule',
        disabled: !!block || (busy !== null && busy !== 'schedule'),
        disabledReason: reason,
      }}
      secondary={current ? {
        id: 'le-unschedule',
        label: t('listings.sched.unschedule'),
        onClick: () => void submit(null),
        loading: busy === 'unschedule',
        disabled: busy === 'schedule',
      } : undefined}
      data-testid="le-schedule-modal"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {hasQueuedDelete ? <Banner tone="danger" title={t('listings.draftError.scheduleDeleteRefused')} data-testid="le-schedule-delete" /> : null}
        {current ? (
          <Box sx={{ fontSize: 14, lineHeight: '20px', color: neutral[700] }} data-testid="le-schedule-current">
            {t('listingEditor.schedule.scheduled', { date: fmt.date(current, 'datetime') })}
          </Box>
        ) : null}
        <FormField
          label={t('listingEditor.schedule.when')}
          helper={t('listingEditor.schedule.helper', { timezone })}
          error={error ?? (block === 'pickFuture' ? t('listings.sched.pickFuture') : null)}
        >
          <DateTimeField
            value={at}
            onChange={(v) => { setAt(v); setError(null); }}
            timezone={timezone}
            min={min}
            minutesStep={15}
            invalid={block === 'pickFuture' || !!error}
            disabled={hasQueuedDelete}
            data-testid="le-schedule-field"
          />
        </FormField>
        <Box sx={{ fontSize: 12, lineHeight: '16px', color: neutral[600] }}>{t('listings.sched.note')}</Box>
      </Box>
    </Modal>
  );
}

export default ScheduleModal;

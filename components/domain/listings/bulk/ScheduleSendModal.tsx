// components/domain/listings/bulk/ScheduleSendModal.tsx — listings-grid §10 "Schedule send…" (Modal sm, one
// DateTimeField in the account timezone, 15-min steps; CRITIQUE C13: the M1-b DateTimeField, never a second
// picker). The server cron sends at that time through the same executor (conflict check included, never forced).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { DateTimeField } from '@/components/ds/inputs/DateTimeField';
import { neutral } from '@/lib/ds/tokens';
import type { ListingsT } from '../columns';

export type ScheduleSendModalProps = {
  open: boolean;
  onClose: () => void;
  /** Drafts to schedule (one per listing). */
  count: number;
  /** Account timezone (NotificationSettings.timezone, BUILD_PLAN BR-2). */
  timezone: string;
  initial?: Date | null;
  onSchedule: (at: Date) => Promise<void>;
  t: ListingsT;
  /** Test seam. */
  now?: Date;
};

/** Earliest allowed time: 15 minutes from now (the cron runs every 5 min). */
export function minScheduleTime(now: Date): Date {
  return new Date(now.getTime() + 15 * 60_000);
}

export function ScheduleSendModal({ open, onClose, count, timezone, initial, onSchedule, t, now }: ScheduleSendModalProps) {
  const [at, setAt] = React.useState<Date | null>(initial ?? null);
  const [busy, setBusy] = React.useState(false);
  const min = React.useMemo(() => minScheduleTime(now ?? new Date()), [now, open]);

  React.useEffect(() => {
    if (open) {
      setAt(initial ?? null);
      setBusy(false);
    }
  }, [open, initial]);

  const tooEarly = at !== null && at.getTime() < min.getTime();
  const submit = async () => {
    if (!at || tooEarly || busy) return;
    setBusy(true);
    try {
      await onSchedule(at);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('listings.sched.title')}
      primary={{
        id: 'schedule',
        label: t('listings.sched.cta', { count }),
        onClick: () => void submit(),
        loading: busy,
        disabled: !at || tooEarly,
        disabledReason: !at ? t('listings.sched.pickTime') : tooEarly ? t('listings.sched.pickFuture') : undefined,
      }}
      data-testid="listings-schedule-send"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <FormField label={t('listings.sched.when')} error={tooEarly ? t('listings.sched.pickFuture') : null}>
          <DateTimeField value={at} onChange={setAt} timezone={timezone} min={min} minutesStep={15} invalid={tooEarly} />
        </FormField>
        <Typography variant="caption" sx={{ color: neutral[600] }}>
          {t('listings.sched.note')}
        </Typography>
      </Box>
    </Modal>
  );
}

export default ScheduleSendModal;

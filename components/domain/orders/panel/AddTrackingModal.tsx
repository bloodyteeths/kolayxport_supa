/**
 * Add tracking number (orders §2.8): Modal sm with 3 fields (tracking number, carrier, notify buyer).
 * Prefilled from the order's latest label, else its latest tracking submission. The primary names the
 * marketplace ("Send to Etsy" / "Etsy'ye gönder", ICU select). The result is reported honestly:
 * sent · queued for the Chrome extension (Etsy) · saved but not accepted by the marketplace.
 *
 * Body: POST /api/orders/:id/submit-tracking { trackingNumber, carrierId, notifyCustomer, updateRemoteOrder: true }.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { TextField } from '@/components/ds/inputs/TextField';
import { Select, type SelectOption } from '@/components/ds/inputs/Select';
import { Checkbox } from '@/components/ds/inputs/Checkbox';
import { ErrorState } from '@/components/ds/state/ErrorState';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { useToast } from '@/components/ds/feedback/toast';
import { icons } from '@/lib/ds/icons';
import { UsageLimitError } from '@/lib/fetchWithLimit';
import {
  TRACKING_CARRIERS,
  OTHER_CARRIER_ID,
  carrierToTrackingId,
  isValidTrackingNumber,
  marketplaceSelectKey,
} from '@/lib/shipping/trackingCarriers';
import type { OrderRow } from '@/lib/orders/types';
import type { TrackingInput, TrackingResult } from './useOrderActions';
import { ActionError } from './useOrderActions';

export interface AddTrackingModalProps {
  open: boolean;
  row: OrderRow | null;
  onClose: () => void;
  /** `useOrderActions().submitTracking` bound to the row. Throws on failure. */
  onSubmit: (input: TrackingInput) => Promise<TrackingResult>;
  /** Called after any 2xx (the list revalidates). */
  onDone?: (result: TrackingResult) => void;
}

/** Prefill: the latest label first (same source for number and carrier), else the latest submission. */
/** DHL eCommerce (MNG Kargo) in TRACKING_CARRIERS. */
const DOMESTIC_TR_CARRIER_ID = 10;

export function trackingPrefill(row: OrderRow | null): { trackingNumber: string; carrierId: number } {
  if (!row) return { trackingNumber: '', carrierId: OTHER_CARRIER_ID };
  if (row.label?.trackingNumber) {
    return { trackingNumber: row.label.trackingNumber, carrierId: carrierToTrackingId(row.label.carrier) };
  }
  if (row.trackingSubmission?.trackingNumber) {
    return { trackingNumber: row.trackingSubmission.trackingNumber, carrierId: carrierToTrackingId(row.trackingSubmission.carrierName) };
  }
  // Domestic Turkish orders mostly ship with DHL eCommerce (MNG): start there instead of "Other".
  return { trackingNumber: '', carrierId: (row.shipTo.country || '').toUpperCase() === 'TR' ? DOMESTIC_TR_CARRIER_ID : OTHER_CARRIER_ID };
}

export function AddTrackingModal({ open, row, onClose, onSubmit, onDone }: AddTrackingModalProps) {
  const t = useTranslations('orders');
  const toast = useToast();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrierId, setCarrierId] = useState<number>(OTHER_CARRIER_ID);
  const [notify, setNotify] = useState(true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mp = marketplaceSelectKey(row?.store.marketplace ?? row?.marketplace);

  useEffect(() => {
    if (!open) return;
    const p = trackingPrefill(row);
    setTrackingNumber(p.trackingNumber);
    setCarrierId(p.carrierId);
    setNotify(true);
    setFieldError(null);
    setSubmitError(null);
  }, [open, row?.id]);

  const options: SelectOption<number>[] = useMemo(
    () => TRACKING_CARRIERS.map((c) => ({ value: c.id, label: c.name ?? t('tracking.carrierOther') })),
    [t],
  );

  const submit = async () => {
    if (!row || submitting) return;
    if (!isValidTrackingNumber(trackingNumber)) {
      setFieldError(trackingNumber.trim() ? t('tracking.invalid') : t('tracking.required'));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await onSubmit({ trackingNumber, carrierId, notifyCustomer: notify });
      if (result.outcome === 'queued') toast.success(t('tracking.queued'));
      else if (result.outcome === 'saved_not_sent') toast.error(t('tracking.savedNotSent', { mp }), { persist: false });
      else toast.success(t('tracking.sent', { mp }));
      onDone?.(result);
      onClose();
    } catch (err) {
      // 402: the global limit dialog already shows; nothing else to say here.
      if (err instanceof UsageLimitError) return;
      // DS: never show API text. Known causes map to i18n; anything else gets the title only.
      const cause = err instanceof ActionError ? err.cause || '' : '';
      if (err instanceof ActionError && err.status === 400 && /tracking number/i.test(cause)) {
        setFieldError(t('tracking.invalid'));
        return;
      }
      if (err instanceof ActionError && /not connected/i.test(cause)) {
        setSubmitError(t('tracking.notConnected', { mp }));
        return;
      }
      setSubmitError(err instanceof TypeError ? t('tracking.network') : '');
    } finally {
      setSubmitting(false);
    }
  };

  const store = row ? (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span>{t('panel.title', { number: `#${row.orderNumber}` })}</span>
      <span aria-hidden>·</span>
      {!row.isManual && <LogoTile brand={row.store.marketplace} size={16} />}
      <span>{row.isManual ? t('row.manualStore') : row.storeName}</span>
    </Box>
  ) : undefined;

  return (
    <Modal
      open={open && !!row}
      onClose={submitting ? () => undefined : onClose}
      size="sm"
      title={t('tracking.title')}
      description={store}
      primary={{
        id: 'send-tracking',
        label: t('tracking.submit', { mp }),
        icon: icons.push,
        onClick: () => void submit(),
        loading: submitting,
        loadingLabel: t('tracking.sending'),
      }}
      data-testid="add-tracking-modal"
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {submitError !== null && (
          <ErrorState
            variant="inline"
            title={t('tracking.failed')}
            cause={submitError || undefined}
            onRetry={() => void submit()}
            data-testid="tracking-error"
          />
        )}
        <FormField label={t('tracking.number')} htmlFor="add-tracking-number" error={fieldError} required>
          <TextField
            id="add-tracking-number"
            value={trackingNumber}
            onChange={(v) => {
              setTrackingNumber(v);
              if (fieldError) setFieldError(null);
            }}
            onBlur={() => {
              if (trackingNumber.trim() && !isValidTrackingNumber(trackingNumber)) setFieldError(t('tracking.invalid'));
            }}
            mono
            autoFocus
            autoComplete="off"
            maxLength={60}
            data-testid="tracking-number"
          />
        </FormField>
        <FormField label={t('tracking.carrier')} htmlFor="add-tracking-carrier">
          <Select<number> id="add-tracking-carrier" value={carrierId} onChange={setCarrierId} options={options} data-testid="tracking-carrier" />
        </FormField>
        <Checkbox checked={notify} onChange={setNotify} label={t('tracking.notifyBuyer')} data-testid="tracking-notify" />
      </Box>
    </Modal>
  );
}

export default AddTrackingModal;

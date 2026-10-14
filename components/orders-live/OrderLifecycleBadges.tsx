import React, { useState } from 'react';
import { Box, Button, Chip, CircularProgress, Link, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import notify from '@/lib/notify';
import type { OrderLifecycleFlags } from '@/lib/orders/lifecycleFlags';

export interface OrderLifecycleBadgesProps {
  orderId: string;
  flags?: OrderLifecycleFlags | null;
  /** Called after a void / manual-cancel action so the parent can refetch flags. */
  onChanged?: () => void;
  /** Chips only, no action row (dense desktop table cells). */
  compact?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / DAY_MS);
}

/**
 * Order lifecycle badges for the labels page (mobile card + desktop row):
 * cancelled-after-label (red, with label cost and void / "I cancelled it
 * manually" actions), cancelled, shipped outside KolayXport, late, Etsy
 * dispatch state, delivered, return-window countdown.
 */
export default function OrderLifecycleBadges({ orderId, flags, onChanged, compact = false }: OrderLifecycleBadgesProps) {
  const t = useTranslations('orderPipeline');
  const [busy, setBusy] = useState<null | 'carrier' | 'confirm_manual'>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  if (!flags) return null;

  const runVoid = async (action: 'carrier' | 'confirm_manual') => {
    if (!flags.voidTargetId || busy) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(flags.voidTargetId)}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status });
      if (body?.code === 'MANUAL_VOID_REQUIRED') {
        setPortalUrl(body.carrierPortalUrl || null);
        notify.info('orderPipeline.void.manualRequired');
      } else {
        notify.success(action === 'confirm_manual' ? 'orderPipeline.void.confirmed' : 'orderPipeline.void.done');
      }
      onChanged?.();
    } catch (err) {
      notify.error(err, 'orderPipeline.void.failed');
    } finally {
      setBusy(null);
    }
  };

  const chips: React.ReactNode[] = [];
  const returnDays = daysLeft(flags.returnWindowEndsAt);

  if (flags.cancelledAfterLabel) {
    const cost =
      flags.labelCost !== null ? ` · ${t('badges.labelCost', { cost: flags.labelCost.toFixed(2), currency: flags.labelCostCurrency || '' })}` : '';
    chips.push(<Chip key="cal" size="small" color="error" label={`${t('badges.cancelledAfterLabel')}${cost}`} sx={{ fontWeight: 600 }} />);
  } else if (flags.cancelled) {
    chips.push(<Chip key="c" size="small" color="error" variant="outlined" label={t('badges.cancelled')} />);
  }
  if (flags.voidRequested) chips.push(<Chip key="vr" size="small" color="warning" variant="outlined" label={t('badges.voidRequested')} />);
  if (flags.shippedExternally) chips.push(<Chip key="se" size="small" color="info" variant="outlined" label={t('badges.shippedExternally')} />);
  if (flags.late) chips.push(<Chip key="late" size="small" color="error" variant="outlined" label={t('badges.late')} />);
  else if (flags.shippedLate) chips.push(<Chip key="sl" size="small" color="warning" variant="outlined" label={t('badges.shippedLate')} />);
  if (flags.dispatchState === 'label_not_pushed') {
    chips.push(
      <Tooltip key="lnp" title={t('badges.labelNotPushedHint')} enterTouchDelay={0}>
        <Chip size="small" color="warning" label={t('badges.labelNotPushed')} />
      </Tooltip>,
    );
  }
  if (flags.deliveredAt) chips.push(<Chip key="d" size="small" color="success" variant="outlined" label={t('badges.delivered')} />);
  if (returnDays !== null && returnDays >= 0 && flags.deliveredAt) {
    chips.push(<Chip key="rw" size="small" variant="outlined" label={t('badges.returnWindow', { days: returnDays })} />);
  }

  if (chips.length === 0) return null;

  const showActions = !compact && flags.cancelledAfterLabel && !!flags.voidTargetId;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.5} sx={{ minWidth: 0 }}>
        {chips}
      </Stack>
      {showActions && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          {flags.activeShipment?.trackingNumber ? (
            <Typography variant="caption" color="text.secondary" sx={{ width: '100%', wordBreak: 'break-all' }}>
              {t('badges.labelTracking', { carrier: flags.activeShipment.carrier, tracking: flags.activeShipment.trackingNumber })}
            </Typography>
          ) : null}
          <Button
            size="small"
            variant="contained"
            color="error"
            disableElevation
            disabled={!!busy}
            onClick={() => runVoid('carrier')}
            startIcon={busy === 'carrier' ? <CircularProgress size={12} color="inherit" /> : undefined}
            sx={{ minHeight: 36 }}
          >
            {t('void.voidLabel')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            disabled={!!busy}
            onClick={() => runVoid('confirm_manual')}
            startIcon={busy === 'confirm_manual' ? <CircularProgress size={12} color="inherit" /> : undefined}
            sx={{ minHeight: 36 }}
          >
            {t('void.confirmManual')}
          </Button>
          {portalUrl ? (
            <Link href={portalUrl} target="_blank" rel="noopener noreferrer" variant="body2">
              {t('void.openCarrierPortal')}
            </Link>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

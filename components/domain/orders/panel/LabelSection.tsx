/**
 * OrderPanel › Label & tracking (orders §2.4, §5, §7.2). One of:
 *  - FBA / MCF: "Amazon ships this order. No label needed." (no tracking action);
 *  - a label: carrier logo + name, tracking number (copy), created date, tracking push result;
 *  - a failed label attempt: "Label failed: {reason}";
 *  - nothing: "No label yet" + [Add tracking number] (not for manual orders: no push target).
 * Trendyol's / Hepsiburada's pre-assigned cargo number is shown as such, never as a label; Hepsiburada orders also
 * get "Pack & print label" (HepsiburadaLabelActions).
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { CopyText } from '@/components/ds/format/CopyText';
import { DateText } from '@/components/ds/format/DateText';
import { Button } from '@/components/ds/inputs/Button';
import { neutral as n, tone } from '@/lib/ds/tokens';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { logoDisplayName } from '@/lib/ds/logos';
import { useFormatters } from '@/lib/format';
import { marketplaceSelectKey } from '@/lib/shipping/trackingCarriers';
import type { OrderRow, TrackingSubmissionSummary } from '@/lib/orders/types';
import { HepsiburadaLabelActions } from './HepsiburadaLabelActions';

export interface LabelSectionProps {
  row: OrderRow;
  /** Opens AddTrackingModal; omitted = no tracking action (FBA, manual). */
  onAddTracking?: () => void;
}

export function carrierName(raw: string | null | undefined): string {
  return logoDisplayName(raw) ?? (raw || '').trim();
}

function PushLine({ sub, mp }: { sub: TrackingSubmissionSummary | null; mp: string }) {
  const t = useTranslations('orders');
  if (!sub) {
    return <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }} data-testid="tracking-push">{t('panel.trackingNotSent')}</Typography>;
  }
  const map = {
    sent: { text: t('panel.trackingSentTo', { mp }), color: tone.success.fg, Icon: icons.done },
    queued: { text: t('panel.trackingQueued'), color: tone.info.fg, Icon: icons.time },
    pending: { text: t('panel.trackingPending', { mp }), color: tone.info.fg, Icon: icons.time },
    failed: { text: t('row.trackingFailed'), color: tone.danger.fg, Icon: icons.error },
  } as const;
  const m = map[sub.state];
  const Icon = m.Icon;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', color: m.color }} data-testid="tracking-push" data-state={sub.state}>
      {Icon && <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />}
      <Typography variant="caption" component="span">{m.text}</Typography>
      {(sub.deliveredAt || sub.submittedAt) && (
        <Typography variant="caption" component="span" sx={{ color: n[500] }}>
          · <DateText value={sub.deliveredAt || sub.submittedAt} mode="datetime" />
        </Typography>
      )}
    </Box>
  );
}

export function LabelSection({ row, onAddTracking }: LabelSectionProps) {
  const t = useTranslations('orders');
  const mp = marketplaceSelectKey(row.store.marketplace);
  const label = row.label;
  const f = useFormatters();

  let body: React.ReactNode;
  if (row.isFBA || row.isMCF) {
    body = (
      <Box>
        <Typography variant="dense" component="p" sx={{ m: 0, color: n[800] }} data-testid="label-fba">{t('row.fbaNoLabel')}</Typography>
        <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>{row.isMCF ? t('row.mcf') : t('row.fba')}</Typography>
      </Box>
    );
  } else if (label) {
    const name = carrierName(label.carrier);
    body = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }} data-testid="label-current">
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          {label.carrier && <LogoTile brand={label.carrier} size={20} label={name} />}
          {name && <Typography variant="dense" component="span" sx={{ fontWeight: 500, color: n[900] }}>{name}</Typography>}
          {label.trackingNumber && <CopyText value={label.trackingNumber} mono data-testid="label-tracking" />}
          {label.createdAt && (
            <Typography variant="caption" component="span" sx={{ color: n[500] }} data-testid="label-created">
              {t('panel.labelCreatedOn', { date: f.date(label.createdAt, 'date') })}
            </Typography>
          )}
        </Box>
        {!row.isManual && <PushLine sub={row.trackingSubmission} mp={mp} />}
        {!label.labelHref && (
          <Typography variant="caption" component="p" sx={{ m: 0, color: n[500] }}>{t('panel.labelFileMissing')}</Typography>
        )}
      </Box>
    );
  } else {
    body = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {row.labelFailure ? (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: tone.danger.fg }} data-testid="label-failed">
            <icons.error size={16} strokeWidth={ICON_STROKE} aria-hidden style={{ marginTop: 1, flexShrink: 0 }} />
            <Typography variant="dense" component="p" sx={{ m: 0, overflowWrap: 'anywhere' }}>
              {row.labelFailure.errorMessage
                ? t('problem.labelFailed', { reason: row.labelFailure.errorMessage.slice(0, 200) })
                : t('panel.labelFailedNoReason')}
            </Typography>
          </Box>
        ) : (
          <Typography variant="dense" component="p" sx={{ m: 0, color: n[600] }} data-testid="label-none">{t('panel.noLabel')}</Typography>
        )}
        {row.trackingSubmission && !row.isManual && <PushLine sub={row.trackingSubmission} mp={mp} />}
      </Box>
    );
  }

  const showAdd = Boolean(onAddTracking) && !row.isFBA && !row.isMCF && !row.isManual;

  return (
    <SidePanelSection id="order-label" title={t('panel.labelTracking')}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>{body}</Box>
        {showAdd && (!label || !row.trackingSubmission || row.trackingSubmission.state === 'failed') && (
          <Button variant="ghost" size="sm" icon={icons.push} onClick={onAddTracking} data-testid="label-add-tracking">
            {t('actions.addTracking')}
          </Button>
        )}
      </Box>
      {row.marketplaceCargoNumber && !label && (
        <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} data-testid="label-cargo-number">
          <Typography variant="caption" component="span" sx={{ color: n[500] }}>{row.hepsiburada ? t('row.hepsiburadaCargo') : t('row.trendyolCargo')}</Typography>
          <CopyText value={row.marketplaceCargoNumber} mono />
        </Box>
      )}
      {row.hepsiburada && !label && <HepsiburadaLabelActions row={row} />}
    </SidePanelSection>
  );
}

export default LabelSection;

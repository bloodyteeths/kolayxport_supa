/**
 * CreateLabelPanel success body (orders §2.5 "Success state", §6.4): "Label created · {service}", the label
 * preview (`data:image/*` renders as an image; PDFs and URLs say "No preview for this file. Use Print label."),
 * the tracking number (CopyText), the tracking-push result line (sent / queued for the Chrome extension /
 * couldn't send · Retry), the ETGB line when chosen, and FedEx alerts as one warning Banner (text only).
 * The actions ([Next order ›] [Print label], ⋯ Download PDF) live in the SidePanel footer.
 */
import React from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ds/feedback/Banner';
import { CopyText } from '@/components/ds/format/CopyText';
import { Button } from '@/components/ds/inputs/Button';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { neutral as n, tone, radius } from '@/lib/ds/tokens';
import { marketplaceSelectKey, type CarrierKey } from '@/lib/shipping/labelDraft';
import { CARRIER_NAME } from '@/lib/shipping/carriers';
import type { TrackingPushStatus } from '@/lib/shipping/submit/tracking';

export type PushState = 'idle' | 'sending' | TrackingPushStatus;

export interface LabelSuccessProps {
  /** Raw carrier (CarrierKey for a label made here, or the stored carrier string of an existing label). */
  carrier: CarrierKey | string | null;
  /** Service product name for the title; falls back to the carrier name. */
  serviceName?: string | null;
  trackingNumber: string | null;
  labelHref: string | null;
  marketplace: string;
  /** Tracking push state; 'idle' renders no line (option off, manual order, existing label). */
  push: PushState;
  onRetryPush?: () => void;
  etgb?: { status: 'sent' | 'failed'; email?: string | null } | null;
  alerts?: readonly string[];
  /** Popup blocked when opening the label. */
  openFailed?: boolean;
  /** "This order already has a label" (opened on an existing label). */
  existing?: boolean;
}

function carrierBrand(c: string | null): string {
  const s = (c || '').toLowerCase();
  if (s.includes('fedex')) return 'fedex';
  if (s.includes('ups')) return 'ups';
  if (s.includes('dhl') || s.includes('mng')) return 'dhl';
  return s || 'other';
}

function Line({ icon, color, children }: { icon: React.ElementType; color: string; children: React.ReactNode }) {
  const Icon = icon as React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 13, lineHeight: '20px', color }}>
      <Icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
      <Box component="span" sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

export function LabelSuccess({
  carrier, serviceName, trackingNumber, labelHref, marketplace, push, onRetryPush, etgb, alerts, openFailed, existing,
}: LabelSuccessProps) {
  const t = useTranslations('createLabel');
  const brand = carrierBrand(carrier);
  const carrierName = (CARRIER_NAME as Record<string, string>)[brand] ?? (carrier || '');
  const isImage = !!labelHref && /^data:image\//i.test(labelHref);
  const mp = marketplaceSelectKey(marketplace);

  return (
    <Box sx={{ p: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }} data-testid="label-success">
      {openFailed ? <Banner tone="warning" title={t('success.openFailed')} /> : null}
      {alerts && alerts.length > 0 ? (
        <Banner tone="warning" title={t('success.alertTitle', { carrier: carrierName })}>
          {alerts.join(' · ')}
        </Banner>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Box component="span" sx={{ display: 'inline-flex', color: existing ? n[600] : tone.success.fg }}>
          <icons.check size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </Box>
        <Box component="h3" sx={{ m: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: n[900] }} data-testid="label-success-title">
          {existing ? t('existing.title') : t('success.title', { service: serviceName || carrierName })}
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '240px 1fr' }, gap: '20px', alignItems: 'start' }}>
        <Box
          role="img"
          aria-label={t('success.preview')}
          sx={{ border: `1px solid ${n[200]}`, borderRadius: `${radius.md}px`, bgcolor: n[50], minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', p: isImage ? 0 : '16px' }}
          data-testid="label-preview"
        >
          {isImage ? (
            <img src={labelHref as string} alt="" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
          ) : (
            <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: n[500], textAlign: 'center' }}>{t('success.previewUnavailable')}</Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <Box>
            <Box sx={{ fontSize: 12, lineHeight: '16px', color: n[500], mb: '4px' }}>{t('success.tracking')}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <LogoTile brand={brand} size={20} />
              {trackingNumber ? <CopyText value={trackingNumber} mono data-testid="label-tracking" /> : <Box component="span" sx={{ color: n[500] }}>—</Box>}
            </Box>
          </Box>
          {push === 'sending' ? <Line icon={icons.time} color={n[600]}>{t('success.trackingSending')}</Line> : null}
          {push === 'sent' ? <Line icon={icons.check} color={tone.success.fg}>{t('success.trackingSent', { mp })}</Line> : null}
          {push === 'queued' ? <Line icon={icons.time} color={tone.info.fg}>{t('success.trackingQueued')}</Line> : null}
          {push === 'failed' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} data-testid="tracking-failed">
              <Line icon={icons.error} color={tone.danger.fg}>{t('success.trackingFailed')}</Line>
              {onRetryPush ? <Button variant="ghost" size="sm" onClick={onRetryPush}>{t('success.retry')}</Button> : null}
            </Box>
          ) : null}
          {etgb?.status === 'sent' ? <Line icon={icons.check} color={tone.success.fg}>{t('success.etgbSent', { email: etgb.email || '' })}</Line> : null}
          {etgb?.status === 'failed' ? <Line icon={icons.error} color={tone.danger.fg}>{t('success.etgbFailed')}</Line> : null}
        </Box>
      </Box>
    </Box>
  );
}

export default LabelSuccess;

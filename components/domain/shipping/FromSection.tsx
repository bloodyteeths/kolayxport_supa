/**
 * CreateLabelPanel › From (orders §2.5): one summary line of the sender profile with "Change" (opens Settings ›
 * Sender profile). When the profile is incomplete (§6.3) a danger Banner with [Open sender profile] replaces
 * nothing else: the panel also disables its primary with `createLabel.senderMissing.reason`.
 */
import React from 'react';
import { Box } from '@mui/material';
import { useTranslations } from 'next-intl';
import { SidePanelSection } from '@/components/ds/overlay/SidePanelSection';
import { Banner } from '@/components/ds/feedback/Banner';
import { CopyText } from '@/components/ds/format/CopyText';
import { neutral as n } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import { SENDER_PROFILE_HREF } from '@/lib/shipping/carriers';
import { senderSummary } from '@/lib/shipping/useSenderProfile';
import type { SenderProfile } from '@/lib/shipping/labelDraft';

export interface FromSectionProps {
  sender: SenderProfile | null;
  /** Missing required sender fields (`useSenderProfile().missing`). */
  missing: readonly string[];
  /** Compact one-line variant for the bulk panel. */
  compact?: boolean;
}

export function FromSection({ sender, missing, compact }: FromSectionProps) {
  const t = useTranslations('createLabel');
  const summary = senderSummary(sender);
  const incomplete = missing.length > 0;
  return (
    <SidePanelSection
      id="label-from"
      title={t('from')}
      action={{ id: 'change-sender', label: t('change'), href: SENDER_PROFILE_HREF, icon: icons.externalLink }}
      data-testid="label-from"
    >
      {incomplete ? (
        <Box sx={{ mb: summary ? '12px' : 0 }}>
          <Banner
            tone="danger"
            title={t('senderMissing.title')}
            action={{ id: 'open-sender', label: t('senderMissing.action'), href: SENDER_PROFILE_HREF }}
            data-testid="sender-missing"
          />
        </Box>
      ) : null}
      {summary ? (
        <Box sx={{ fontSize: 13, lineHeight: '20px', color: n[700], minWidth: 0 }} data-testid="sender-summary">
          {compact ? (
            <Box component="span" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</Box>
          ) : (
            <CopyText value={summary} />
          )}
        </Box>
      ) : null}
    </SidePanelSection>
  );
}

export default FromSection;

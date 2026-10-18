// components/domain/messages/PlatformBanners.tsx (messages G5) — one Banner per failed platform above the list
// (messages §5.1 "Platform warning banners"; replaces today's hex-colored chips). The `code` contract of
// `platformErrors` is unchanged. Rows of the healthy platform stay listed; the failed one keeps its last rows.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Banner, type Tone } from '@/components/ds/feedback/Banner';
import type { ActionSpec } from '@/components/ds/types/actions';
import { getLogo } from '@/lib/ds/logos';
import type { MessagePlatform, PlatformError, PlatformErrorCode } from '@/types/messages';

export const SETTINGS_CONNECTIONS_HREF = '/ayarlar?tab=connections';
export const SETTINGS_API_KEYS_HREF = '/ayarlar?tab=apiKeys';

/** Where the seller fixes a connection: Wix is an OAuth connection, Trendyol / Hepsiburada API keys. */
export function settingsHrefFor(platform: MessagePlatform): string {
  return platform === 'wix' ? SETTINGS_CONNECTIONS_HREF : SETTINGS_API_KEYS_HREF;
}

export interface BannerModel {
  platform: MessagePlatform;
  code: PlatformErrorCode;
  tone: Tone;
  action: { kind: 'reconnect' | 'finishSetup'; href: string } | { kind: 'retry' };
}

/** Pure: error → banner tone + action (messages §5.1 table). */
export function bannerModel(e: PlatformError): BannerModel {
  switch (e.code) {
    case 'permission':
      return { platform: e.platform, code: e.code, tone: 'warning', action: { kind: 'reconnect', href: settingsHrefFor(e.platform) } };
    case 'auth':
      return { platform: e.platform, code: e.code, tone: 'warning', action: { kind: 'reconnect', href: settingsHrefFor(e.platform) } };
    case 'credentials':
      return { platform: e.platform, code: e.code, tone: 'warning', action: { kind: 'finishSetup', href: settingsHrefFor(e.platform) } };
    case 'rateLimited':
      return { platform: e.platform, code: e.code, tone: 'info', action: { kind: 'retry' } };
    case 'unavailable':
    default:
      return { platform: e.platform, code: e.code, tone: 'warning', action: { kind: 'retry' } };
  }
}

export interface PlatformBannersProps {
  errors: PlatformError[];
  onRetry: () => void;
  retrying?: boolean;
}

export function PlatformBanners({ errors, onRetry, retrying = false }: PlatformBannersProps) {
  const t = useTranslations('messages.platformBanners');
  if (errors.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', mb: '8px' }} data-testid="platform-banners">
      {errors.map((e) => {
        const m = bannerModel(e);
        const name = getLogo(e.platform)?.name ?? e.platform;
        const action: ActionSpec =
          m.action.kind === 'retry'
            ? { id: `retry-${e.platform}`, label: t('retry'), onClick: onRetry, loading: retrying }
            : { id: `${m.action.kind}-${e.platform}`, label: m.action.kind === 'reconnect' ? t('reconnect', { name }) : t('finishSetup'), href: m.action.href };
        return <Banner key={e.platform} tone={m.tone} title={t(e.code, { name })} action={action} data-testid={`platform-banner-${e.platform}`} />;
      })}
    </Box>
  );
}

export default PlatformBanners;

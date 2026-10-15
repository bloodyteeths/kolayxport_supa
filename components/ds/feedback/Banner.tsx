import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { neutral as n, radius, tone as toneTokens, type ToneKey } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from '../overlay/actions';
import { IconAction } from '../overlay/IconAction';
import { AttentionIcon, CloseIcon, DangerIcon, InfoIcon, SuccessIcon, WarningIcon, type LucideIcon } from '../overlay/icons.internal';

export type Tone = ToneKey;

export interface BannerProps {
  tone: Tone;
  /** One line, already translated. */
  title: string;
  /** Optional inline continuation (kept on the same line on desktop, wraps on mobile). */
  children?: React.ReactNode;
  /** At most one action. */
  action?: ActionSpec;
  /**
   * Non-blocking banners only: shows ✕ and persists the dismissal in localStorage under
   * `kx.banner.dismissed.<dismissKey>` (try/catch; falls back to in-memory for the session).
   */
  dismissKey?: string;
  /** Called after a dismissal (persisted or not). */
  onDismiss?: () => void;
  className?: string;
  'data-testid'?: string;
}

const ICON: Record<Tone, LucideIcon> = {
  success: SuccessIcon, warning: WarningIcon, danger: DangerIcon, info: InfoIcon, attention: AttentionIcon, neutral: InfoIcon,
};

export const BANNER_STORAGE_PREFIX = 'kx.banner.dismissed.';
const memoryDismissed = new Set<string>();

export function isBannerDismissed(key: string): boolean {
  if (memoryDismissed.has(key)) return true;
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(BANNER_STORAGE_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

export function dismissBanner(key: string): void {
  memoryDismissed.add(key);
  try {
    window.localStorage.setItem(BANNER_STORAGE_PREFIX + key, '1');
  } catch {
    /* private mode / blocked storage: in-memory only */
  }
}

/**
 * DS §3.13 Banner: inline at the top of the region it affects; 1px border, soft tone background, one
 * line, at most one action. Never used for marketing (shell-nav `AccountBanner` is the only account
 * banner). danger/warning announce as `alert`, others as `status`.
 */
export function Banner({ tone, title, children, action, dismissKey, onDismiss, className, ...rest }: BannerProps) {
  const t = useTranslations('ds.feedback');
  // A dismissible (dismissKey) banner starts hidden on SSR and first paint and is revealed after mount
  // only if it was not dismissed earlier, so a dismissed banner never flashes or shifts the layout.
  const [dismissed, setDismissed] = useState<boolean>(!!dismissKey);
  useEffect(() => {
    setDismissed(!!dismissKey && isBannerDismissed(dismissKey));
  }, [dismissKey]);
  if (dismissed) return null;

  const c = toneTokens[tone];
  const Icon = ICON[tone];
  const urgent = tone === 'danger' || tone === 'warning';

  return (
    <Box
      role={urgent ? 'alert' : 'status'}
      className={className}
      data-testid={rest['data-testid'] ?? `banner-${tone}`}
      data-tone={tone}
      sx={{
        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minHeight: 40, px: '12px', py: '6px',
        bgcolor: c.bg, border: `1px solid ${c.border}`, borderRadius: `${radius.md}px`, color: n[800], fontSize: 13, lineHeight: '18px',
      }}
    >
      <Box component="span" sx={{ display: 'inline-flex', color: c.fg, flexShrink: 0 }}>
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <Box component="span" sx={{ fontWeight: 500, color: c.fg }}>{title}</Box>
        {children && <Box component="span" sx={{ color: n[700] }}>{children}</Box>}
      </Box>
      {action && <ActionButton action={action} variant="ghost" size="sm" />}
      {dismissKey && (
        <IconAction
          icon={CloseIcon}
          label={t('banner.dismiss')}
          data-testid="banner-dismiss"
          onClick={() => {
            dismissBanner(dismissKey);
            setDismissed(true);
            onDismiss?.();
          }}
        />
      )}
    </Box>
  );
}

export default Banner;

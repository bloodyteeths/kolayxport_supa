// components/ds/shell/NotificationsButton.tsx — the TopBar bell (shell-nav §3.3, §3.4; BUILD_PLAN §3/§4 M2).
//
// Replaces components/NotificationBell.tsx (deleted by group F). The list body is the backend-owned
// `NotificationPanel` (components/notification-center, import only): Today / Earlier, severity dot,
// mark-all-read, "See all" and the preferences gear. Data: `useNotifications()` (one SWR key app-wide,
// 60 s poll, 120 s while the live stream is up, optimistic mark-read).
//
// Badge: a `micro` tabular pill (16 px, neutral-900, white). It turns danger only when an unread item
// has severity `error` (send failed, reconnect, order import failed): notifications are news, not alarms.
// Desktop: a 380 px Popover (z popover 1600, e2, radius 8). Mobile (< 900): a full-height right Drawer
// (z modal 1500) with a close button, as the panel's own contract asks ("Mobile: full-height Drawer").
// No sound here: the new-order chime belongs to the live order event (LiveSoundToggle sits next to this).
import * as React from 'react';
import { useRouter } from 'next/router';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Popover from '@mui/material/Popover';
import { useTranslations } from 'next-intl';
import NotificationPanel, { type PanelItem } from '@/components/notification-center/NotificationPanel';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { icons } from '@/lib/ds/icons';
import { elevation, neutral as n, px, radius, tone, zIndex } from '@/lib/ds/tokens';
import { useNotifications, type NotificationItem } from '@/lib/hooks/useNotifications';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { formatNavCount } from './SideNavItem';

export type NotificationsButtonProps = {
  /** Poll only while signed in. Default true. */
  enabled?: boolean;
  /** Force the mobile drawer (MobileTopBar) or the desktop popover; default follows the viewport. */
  mobile?: boolean;
  /** IconButton size: `sm` 32 on the desktop TopBar, `lg` 44 on the mobile TopBar. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  'data-testid'?: string;
};

/** Pure: pill tone. Danger only while an unread badge-counted item (not `badge: false`) has severity `error`. */
export function notificationBadgeTone(items: Pick<NotificationItem, 'readAt' | 'severity' | 'badge'>[]): 'neutral' | 'danger' {
  return items.some((i) => !i.readAt && i.severity === 'error' && i.badge !== false) ? 'danger' : 'neutral';
}

export function NotificationsButton({ enabled = true, mobile, size = 'sm', className, 'data-testid': testId = 'notifications-button' }: NotificationsButtonProps) {
  const router = useRouter();
  const t = useTranslations('shell');
  const tDs = useTranslations('ds.overlay');
  const locale = useLocaleStore((s) => s.locale) || 'tr';
  const viewportMobile = useIsMobile();
  const isMobile = mobile ?? viewportMobile;
  const { items, unreadCount, isLoading, markRead, markAllRead } = useNotifications(enabled);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const open = isMobile ? drawerOpen : Boolean(anchorEl);
  const panelId = React.useId();

  const close = React.useCallback(() => {
    setAnchorEl(null);
    setDrawerOpen(false);
  }, []);

  // Navigation closes it (the shell persists across routes).
  React.useEffect(() => {
    const events = router?.events;
    if (!events) return undefined;
    events.on('routeChangeStart', close);
    return () => events.off('routeChangeStart', close);
  }, [router, close]);

  const onItemClick = (item: PanelItem) => {
    if (!item.readAt) void markRead([item.id]);
    close();
    if (item.link) void router.push(item.link);
  };

  const badgeTone = notificationBadgeTone(items);
  const label = unreadCount > 0 ? t('topbar.notificationsUnread', { count: unreadCount }) : t('topbar.notifications');
  const badge =
    unreadCount > 0 ? (
      <Box
        component="span"
        aria-hidden
        data-testid="notifications-badge"
        data-tone={badgeTone}
        sx={{
          minWidth: 16,
          height: 16,
          px: px(4),
          boxSizing: 'border-box',
          borderRadius: px(radius.full),
          bgcolor: badgeTone === 'danger' ? tone.danger.solid : n[900],
          color: n[0],
          fontSize: 11,
          lineHeight: '16px',
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'center',
          boxShadow: `0 0 0 2px ${n[0]}`,
          transform: 'translate(40%, -30%)',
        }}
      >
        {formatNavCount(unreadCount)}
      </Box>
    ) : undefined;

  const panel = (
    <NotificationPanel
      items={items}
      unreadCount={unreadCount}
      isLoading={isLoading}
      locale={locale}
      fullHeight={isMobile}
      onItemClick={onItemClick}
      onMarkAllRead={() => void markAllRead()}
      onNavigate={close}
    />
  );

  return (
    <>
      <IconButton
        icon={icons.notifications}
        label={label}
        size={size}
        badge={badge}
        noTooltip={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(e) => (isMobile ? setDrawerOpen(true) : setAnchorEl(e.currentTarget))}
        className={className}
        data-testid={testId}
      />
      {isMobile ? (
        <Drawer
          anchor="right"
          open={drawerOpen}
          onClose={close}
          sx={{ zIndex: zIndex.modal }}
          PaperProps={{
            id: panelId,
            role: 'dialog',
            'aria-label': t('topbar.notifications'),
            sx: {
              width: '100%',
              maxWidth: '100vw',
              height: '100%',
              pt: 'env(safe-area-inset-top, 0px)',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: px(8), pt: px(4), flexShrink: 0 }}>
            <IconButton icon={icons.close} label={tDs('close')} size="lg" onClick={close} noTooltip data-testid="notifications-close" />
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>{panel}</Box>
        </Drawer>
      ) : (
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={close}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          sx={{ zIndex: zIndex.popover }}
          slotProps={{
            paper: {
              id: panelId,
              role: 'dialog',
              'aria-label': t('topbar.notifications'),
              sx: { mt: px(8), width: 380, maxHeight: 480, borderRadius: px(radius.md), boxShadow: elevation.e2, border: `1px solid ${n[200]}` },
            } as Record<string, unknown>,
          }}
        >
          {panel}
        </Popover>
      )}
    </>
  );
}

export default NotificationsButton;

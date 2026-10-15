import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import { Popover, Drawer } from '@mui/material';
import { Bell, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import useScreenSize from '../hooks/useScreenSize';
import { useNotifications } from '@/lib/hooks/useNotifications';
import NotificationPanel, { type PanelItem } from '@/components/notification-center/NotificationPanel';

/**
 * Header bell (W5 integration). The list body is the backend-owned
 * `NotificationPanel` (Today / Earlier, severity dot, "See all", settings gear,
 * type texts via useNotificationText). Desktop: Popover; mobile: full-height
 * right Drawer (z-index 1500) with a close button, since it covers the screen.
 *
 * The badge is `unreadCount` from the API, which counts only badge=true rows.
 * No sound is played here: the new-order chime comes from W6's order event,
 * never from `notification.raised`.
 */
interface NotificationBellProps {
  /** Disable polling (e.g. while signed out). */
  enabled?: boolean;
}

export default function NotificationBell({ enabled = true }: NotificationBellProps) {
  const router = useRouter();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale) || 'tr';
  const { isMobile } = useScreenSize();
  const { items, unreadCount, isLoading, markRead, markAllRead } = useNotifications(enabled);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const close = useCallback(() => setAnchorEl(null), []);

  const handleItemClick = (item: PanelItem) => {
    if (!item.readAt) void markRead([item.id]);
    close();
    if (item.link) router.push(item.link);
  };

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const buttonLabel = unreadCount > 0 ? `${tNav('notifications')} (${unreadCount})` : tNav('notifications');

  const panel = (
    <NotificationPanel
      items={items}
      unreadCount={unreadCount}
      isLoading={isLoading}
      locale={locale}
      fullHeight={isMobile}
      onItemClick={handleItemClick}
      onMarkAllRead={() => void markAllRead()}
      onNavigate={close}
    />
  );

  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        className="relative w-11 h-11 sm:w-auto sm:h-auto sm:p-2 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
        title={tNav('notifications')}
        aria-label={buttonLabel}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 sm:-top-0.5 sm:-right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-white px-1">
            {badgeLabel}
          </span>
        )}
      </button>

      {isMobile ? (
        <Drawer
          anchor="right"
          open={open}
          onClose={close}
          sx={{ zIndex: 1500 }}
          PaperProps={{
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
          <div className="flex justify-end px-2 pt-1 flex-shrink-0">
            <button
              type="button"
              onClick={close}
              aria-label={tCommon('close')}
              className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 min-h-0">{panel}</div>
        </Drawer>
      ) : (
        <Popover
          open={open}
          anchorEl={anchorEl}
          onClose={close}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          PaperProps={{ sx: { mt: 1, borderRadius: 2, boxShadow: '0 10px 30px -8px rgba(15,23,42,0.2)' } }}
        >
          {panel}
        </Popover>
      )}
    </>
  );
}

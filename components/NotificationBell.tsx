import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import { Popover, Drawer } from '@mui/material';
import { Bell, Info, AlertTriangle, AlertCircle, CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import useScreenSize from '../hooks/useScreenSize';
import { useNotifications, type NotificationItem, type NotificationSeverity } from '@/lib/hooks/useNotifications';

const SEVERITY_STYLE: Record<NotificationSeverity, { Icon: typeof Info; color: string; bg: string }> = {
  info: { Icon: Info, color: '#2563eb', bg: '#eff6ff' },
  warning: { Icon: AlertTriangle, color: '#d97706', bg: '#fffbeb' },
  error: { Icon: AlertCircle, color: '#dc2626', bg: '#fef2f2' },
};

/** ICU arguments each known notification type needs (see lib/notifications.ts emitters). */
const REQUIRED_PARAMS: Record<string, string[]> = {
  draftSyncFailed: ['title'],
  draftConflict: ['title'],
  reauthRequired: ['provider'],
  orderSyncFailed: ['provider'],
  usageNearLimit: ['kind', 'used', 'limit'],
  usageLimitReached: ['kind'],
};

const UNITS:Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  }
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(0, 'minute');
}

interface NotificationBellProps {
  /** Disable polling (e.g. while signed out). */
  enabled?: boolean;
}

export default function NotificationBell({ enabled = true }: NotificationBellProps) {
  const router = useRouter();
  const tNav = useTranslations('nav');
  const tN = useTranslations('notifications');
  const locale = useLocaleStore((s) => s.locale) || 'tr';
  const { isMobile } = useScreenSize();
  const { items, unreadCount, isLoading, markRead, markAllRead } = useNotifications(enabled);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const close = useCallback(() => setAnchorEl(null), []);

  const titleFor = (item: NotificationItem): string => {
    // Unknown keys (backend ahead of the client's messages) or missing ICU
    // params fall back to a generic line. next-intl does NOT throw on a
    // missing argument (it returns the key path), so params are checked first.
    try {
      if (!tN.has(item.titleKey as any)) return tN('fallback');
      const raw = (item.params ?? {}) as Record<string, string | number>;
      const typeName = item.titleKey.startsWith('types.') ? item.titleKey.slice(6) : item.type;
      const required = REQUIRED_PARAMS[typeName];
      if (required && required.some((p) => raw[p] === undefined || raw[p] === null || raw[p] === '')) {
        return tN('fallback');
      }
      const params: Record<string, string | number> = { ...raw };
      // Backend enum values (e.g. kind='label') must not leak into the sentence.
      if (typeof params.kind === 'string') {
        const kindKey = `kinds.${params.kind}`;
        params.kind = tN.has(kindKey as any) ? tN(kindKey as any) : tN('kinds.generic');
      }
      return tN(item.titleKey as any, params as any);
    } catch {
      return tN('fallback');
    }
  };

  const handleItemClick = (item: NotificationItem) => {
    if (!item.readAt) void markRead([item.id]);
    close();
    if (item.link) router.push(item.link);
  };

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
  const buttonLabel = unreadCount > 0 ? `${tNav('notifications')} (${unreadCount})` : tNav('notifications');

  const list = (
    <div className="flex flex-col" style={{ maxHeight: isMobile ? '75vh' : 480, width: isMobile ? '100%' : 360 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <span className="text-sm font-semibold text-slate-800">{tNav('notifications')}</span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 rounded-lg hover:bg-blue-50"
            style={{ minHeight: 44 }}
          >
            <CheckCheck size={14} />
            {tN('markAllRead')}
          </button>
        )}
      </div>
      <div className="overflow-y-auto flex-1" style={{ paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : undefined }}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-10">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Bell size={18} className="text-slate-400" />
            </div>
            <p className="text-sm text-slate-500">{isLoading ? tN('loading') : tNav('noNotifications')}</p>
          </div>
        ) : (
          <ul>
            {items.map((item) => {
              const { Icon, color, bg } = SEVERITY_STYLE[item.severity] || SEVERITY_STYLE.info;
              const unread = !item.readAt;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      unread ? 'bg-blue-50/40' : ''
                    }`}
                    style={{ minHeight: 56 }}
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: bg }}
                      aria-hidden="true"
                    >
                      <Icon size={16} style={{ color }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[13px] leading-snug ${unread ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                        {titleFor(item)}
                      </span>
                      <span className="block text-[11px] text-slate-400 mt-0.5">{relativeTime(item.createdAt, locale)}</span>
                    </span>
                    {unread && (
                      <>
                        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-2" aria-hidden="true" />
                        <span className="sr-only">{tN('unread')}</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
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
          anchor="bottom"
          open={open}
          onClose={close}
          PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}
        >
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="w-10 h-1 rounded-full bg-slate-200" />
          </div>
          {list}
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
          {list}
        </Popover>
      )}
    </>
  );
}

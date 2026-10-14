/**
 * Bell dropdown body (owner W5) — presentational, for components/NotificationBell.tsx
 * (owned by the UI session; see docs/integration/parts/W5-notifications.md).
 *
 * Today / Earlier groups, severity dot, mark-all-read, click = mark read +
 * navigate (handled by the parent via onItemClick), and a "See all" link to
 * /app/bildirimler. Desktop: put it in a 380px Popover. Mobile: put it in a
 * full-height Drawer (z-index 1500) and pass fullHeight.
 */
import React from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SEVERITY_COLOR, relativeTime, splitByDay, type ClientSeverity } from './shared';
import { useNotificationText } from './useNotificationText';

export interface PanelItem {
  id: string;
  type: string;
  severity: ClientSeverity | string;
  titleKey: string;
  params: Record<string, string | number> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPanelProps {
  items: PanelItem[];
  unreadCount: number;
  isLoading?: boolean;
  locale: string;
  onItemClick: (item: PanelItem) => void;
  onMarkAllRead: () => void;
  /** Called before navigating to the full page / preferences (close the popover). */
  onNavigate?: () => void;
  /** Mobile drawer: fill the available height instead of max 480px. */
  fullHeight?: boolean;
  seeAllHref?: string;
}

export default function NotificationPanel({
  items,
  unreadCount,
  isLoading = false,
  locale,
  onItemClick,
  onMarkAllRead,
  onNavigate,
  fullHeight = false,
  seeAllHref = '/app/bildirimler',
}: NotificationPanelProps) {
  const tNav = useTranslations('nav');
  const tN = useTranslations('notifications');
  const tC = useTranslations('notificationCenter');
  const { title } = useNotificationText();
  const { today, earlier } = splitByDay(items);

  const renderItem = (item: PanelItem) => {
    const sev = (SEVERITY_COLOR as Record<string, (typeof SEVERITY_COLOR)['info']>)[item.severity] || SEVERITY_COLOR.info;
    const unread = !item.readAt;
    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => onItemClick(item)}
          className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${unread ? 'bg-blue-50/40' : ''}`}
          style={{ minHeight: 56 }}
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: sev.dot }} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className={`block text-[13px] leading-snug break-words ${unread ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
              {title({ type: item.type, titleKey: item.titleKey, params: item.params })}
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
  };

  const section = (label: string, list: PanelItem[]) =>
    list.length ? (
      <section aria-label={label}>
        <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</h3>
        <ul>{list.map(renderItem)}</ul>
      </section>
    ) : null;

  return (
    <div
      className="flex flex-col w-full sm:w-[380px]"
      style={{ maxHeight: fullHeight ? '100%' : 480, height: fullHeight ? '100%' : undefined }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 flex-shrink-0" style={{ minHeight: 52 }}>
        <span className="text-sm font-semibold text-slate-800">{tNav('notifications')}</span>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 px-2 rounded-lg hover:bg-blue-50"
              style={{ minHeight: 44 }}
            >
              <CheckCheck size={14} />
              {tN('markAllRead')}
            </button>
          )}
          <Link
            href={`${seeAllHref}?tab=preferences`}
            onClick={onNavigate}
            aria-label={tC('panel.settings')}
            title={tC('panel.settings')}
            className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50"
          >
            <Settings size={16} />
          </Link>
        </div>
      </div>
      <div className="overflow-y-auto flex-1" style={{ paddingBottom: fullHeight ? 'env(safe-area-inset-bottom, 0px)' : undefined }}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-10">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Bell size={18} className="text-slate-400" />
            </div>
            <p className="text-sm text-slate-500">{isLoading ? tN('loading') : tC('panel.empty')}</p>
          </div>
        ) : (
          <>
            {section(tC('page.today'), today)}
            {section(tC('page.earlier'), earlier)}
          </>
        )}
      </div>
      <div className="border-t border-slate-100 flex-shrink-0">
        <Link
          href={seeAllHref}
          onClick={onNavigate}
          className="flex items-center justify-center text-sm font-medium text-blue-600 hover:bg-blue-50"
          style={{ minHeight: 48 }}
        >
          {tC('panel.seeAll')}
        </Link>
      </div>
    </div>
  );
}

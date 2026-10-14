import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LayoutDashboard, FileText, Store, Mail, Target, Menu as MenuIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Visible height of the bar, excluding the safe-area inset. */
export const MOBILE_TAB_BAR_HEIGHT = 60;

/**
 * CSS custom property set on <html> while the bar is mounted, so fixed
 * bottom UI elsewhere (FABs, toasts) can sit above it:
 *   bottom: calc(16px + var(--kx-bottom-nav, 0px))
 */
export const BOTTOM_NAV_CSS_VAR = '--kx-bottom-nav';

interface MobileTabBarProps {
  /** First connected marketplace's listings page, or the connections settings tab. */
  listingsHref: string;
  /** Paths that count as "Listings" for the active state. */
  listingsPaths: string[];
  /** Messages tab replaces Research when a messaging marketplace is connected. */
  showMessages: boolean;
  messageCount?: number;
  /** Red dot on "More" (e.g. a connection needs re-authorisation). */
  moreDot?: boolean;
  moreOpen?: boolean;
  onMore: () => void;
}

const ORDERS_PATHS = ['/app/labels', '/app/senkron'];
const RESEARCH_PATHS = ['/app/etsy-research', '/app/ebay-research', '/app/trendyol-arastirma', '/app/amazon-research'];

interface Tab {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  active: boolean;
  badge?: number;
  dot?: boolean;
  onClick?: () => void;
}

export default function MobileTabBar({
  listingsHref,
  listingsPaths,
  showMessages,
  messageCount = 0,
  moreDot = false,
  moreOpen = false,
  onMore,
}: MobileTabBarProps) {
  const t = useTranslations('nav');
  const router = useRouter();
  const path = router.pathname;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(BOTTOM_NAV_CSS_VAR, `calc(${MOBILE_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`);
    return () => {
      root.style.removeProperty(BOTTOM_NAV_CSS_VAR);
    };
  }, []);

  const tabs: Tab[] = [
    { key: 'home', label: t('home'), icon: LayoutDashboard, href: '/app', active: path === '/app' },
    { key: 'orders', label: t('labelsNav'), icon: FileText, href: '/app/labels', active: ORDERS_PATHS.includes(path) },
    { key: 'listings', label: t('listings'), icon: Store, href: listingsHref, active: listingsPaths.includes(path) },
    showMessages
      ? { key: 'messages', label: t('messages'), icon: Mail, href: '/app/mesajlar', active: path === '/app/mesajlar', badge: messageCount }
      : { key: 'research', label: t('research'), icon: Target, href: '/app/etsy-research', active: RESEARCH_PATHS.includes(path) },
    { key: 'more', label: t('more'), icon: MenuIcon, active: moreOpen, dot: moreDot, onClick: onMore },
  ];

  return (
    <nav
      aria-label={t('mainNavigation')}
      className="fixed bottom-0 left-0 right-0 z-30 bg-white"
      style={{
        borderTop: '1px solid rgba(226, 232, 240, 0.9)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -4px 16px -8px rgba(15, 23, 42, 0.08)',
      }}
    >
      <ul className="flex items-stretch" style={{ height: MOBILE_TAB_BAR_HEIGHT }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const color = tab.active ? '#2563eb' : '#64748b';
          const badge = tab.badge && tab.badge > 0 ? (tab.badge > 99 ? '99+' : String(tab.badge)) : null;
          const content = (
            <>
              <span className="relative inline-flex">
                <Icon size={21} style={{ color }} aria-hidden="true" />
                {badge && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full ring-2 ring-white px-1">
                    {badge}
                  </span>
                )}
                {!badge && tab.dot && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />
                )}
              </span>
              <span
                className="text-[10.5px] leading-tight mt-1 truncate max-w-full px-1"
                style={{ color, fontWeight: tab.active ? 600 : 500 }}
              >
                {tab.label}
              </span>
            </>
          );
          const className =
            'w-full h-full flex flex-col items-center justify-center select-none active:bg-slate-50 transition-colors';
          const ariaLabel = badge ? `${tab.label} (${tab.badge})` : tab.label;
          return (
            <li key={tab.key} className="flex-1 min-w-0 relative">
              {tab.active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-full bg-blue-600" aria-hidden="true" />
              )}
              {tab.href ? (
                <Link
                  href={tab.href}
                  className={className}
                  aria-current={tab.active ? 'page' : undefined}
                  aria-label={ariaLabel}
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={tab.onClick}
                  className={className}
                  aria-label={ariaLabel}
                  aria-expanded={tab.active}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

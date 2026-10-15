// components/ds/shell/MobileTabBar.tsx — the mobile tab bar (< 900px; shell-nav §2.2, §4.1; DS §2.8, §2.10).
//
// Slots 1–4 come from `useNavModel().tabs` (Home, Orders, Listings, Messages-or-Research); slot 5 "More" is
// chrome and opens the More sheet. 56px plus the bottom safe area, z 1050 (`zIndex.tabBar`), neutral-0,
// 1px top border, no shadow. Active: neutral-900 icon + label at 600 and a 2×24px neutral-900 bar on the
// top edge (no accent blue, same colour rule as the sidebar). Counts are the neutral pill, danger when
// orders are overdue; 0 / unknown renders nothing.
//
// While mounted it sets `--kx-bottom-nav: calc(56px + env(safe-area-inset-bottom))` on <html> (it was 60);
// StickyActionBar, Page bottom padding and the Toaster offset read it. Removed on unmount.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { icons, type LucideIcon } from '@/lib/ds/icons';
import { accent, layout, motion, neutral as n, tone, type as typeScale, zIndex } from '@/lib/ds/tokens';
import { useNotifications } from '@/lib/hooks/useNotifications';
import type { MobileTab } from '@/lib/nav/useNavModel';
import { useShellStore } from '@/lib/nav/useShellStore';
import type { AppShellContext } from './AppShell';
import { useMobileTopBarState } from './MobileTopBar';

/** Visible bar height, excluding the safe-area inset (DS §2.10). */
export const MOBILE_TAB_BAR_HEIGHT = layout.tabBar;
/** CSS custom property set on <html> while the bar is mounted. */
export const BOTTOM_NAV_CSS_VAR = '--kx-bottom-nav';
export const BOTTOM_NAV_VALUE = `calc(${MOBILE_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`;

/** `99+` cap for tab and sheet count pills. */
export function formatCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** The More-tab dot: reconnect (warning) wins over unread notifications parked in the sheet. */
export type MoreDot = 'warning' | 'unread';

export function resolveMoreDot(opts: { moreDot?: 'warning'; bellInMore?: boolean; notificationsUnread?: number | null }): MoreDot | undefined {
  if (opts.moreDot === 'warning') return 'warning';
  if (opts.bellInMore && (opts.notificationsUnread ?? 0) > 0) return 'unread';
  return undefined;
}

export type MobileTabBarProps = {
  /** `useNavModel().tabs` (slots 1–4). */
  tabs: MobileTab[];
  /** `useNavModel().moreDot` (reconnect needed). */
  moreDot?: 'warning';
  /**
   * Unread notifications while the bell lives in the More sheet (the page's TopBar shows ⋯). Shows an
   * unread dot on More when there is no warning dot.
   */
  bellInMore?: boolean;
  notificationsUnread?: number | null;
  /** Default: `useShellStore` `moreOpen` / `setMoreOpen(!moreOpen)`. */
  moreOpen?: boolean;
  onMore?: () => void;
  className?: string;
  'data-testid'?: string;
};

export function MobileTabBar({ tabs, moreDot, bellInMore, notificationsUnread, moreOpen: moreOpenProp, onMore, className, ...rest }: MobileTabBarProps) {
  const t = useTranslations('shell');
  const storeMoreOpen = useShellStore((s) => s.moreOpen);
  const setMoreOpen = useShellStore((s) => s.setMoreOpen);
  const moreOpen = moreOpenProp ?? storeMoreOpen;
  const toggleMore = onMore ?? (() => setMoreOpen(!moreOpen));

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(BOTTOM_NAV_CSS_VAR, BOTTOM_NAV_VALUE);
    return () => {
      root.style.removeProperty(BOTTOM_NAV_CSS_VAR);
    };
  }, []);

  const dot = resolveMoreDot({ moreDot, bellInMore, notificationsUnread });
  const dotLabel =
    dot === 'warning'
      ? t('badge.settingsReconnect')
      : dot === 'unread'
        ? t('topbar.notificationsUnread', { count: notificationsUnread ?? 0 })
        : undefined;
  // More reads as the current section when the route is a More destination (no tab is active) or the sheet is open.
  const moreActive = moreOpen || !tabs.some((x) => x.active);

  return (
    <Box
      component="nav"
      aria-label={t('mainNav')}
      className={className}
      data-testid={rest['data-testid'] ?? 'mobile-tabbar'}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: zIndex.tabBar,
        bgcolor: n[0],
        borderTop: `1px solid ${n[200]}`,
        pb: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', alignItems: 'stretch', height: MOBILE_TAB_BAR_HEIGHT }}>
        {tabs.map((tab) => {
          const hasCount = typeof tab.count === 'number' && tab.count > 0;
          const ariaLabel = hasCount ? `${tab.label}, ${tab.countLabel ?? formatCount(tab.count as number)}` : tab.label;
          return (
            <Box component="li" key={tab.id} sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <TabButton
                href={tab.href}
                icon={tab.icon}
                label={tab.label}
                ariaLabel={ariaLabel}
                active={tab.active}
                count={hasCount ? (tab.count as number) : undefined}
                countTone={tab.countTone}
                testId={`mobile-tab-${tab.id}`}
              />
            </Box>
          );
        })}
        <Box component="li" sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <TabButton
            icon={icons.menu}
            label={t('mobile.more')}
            ariaLabel={dotLabel ? `${t('mobile.more')}, ${dotLabel}` : t('mobile.more')}
            active={moreActive}
            dot={dot}
            onClick={toggleMore}
            expanded={moreOpen}
            testId="mobile-tab-more"
          />
        </Box>
      </Box>
    </Box>
  );
}

export type MobileTabBarConnectedProps = { ctx: Pick<AppShellContext, 'model' | 'signedIn'> };

/**
 * Rendered as JSX from AppShell `renderMobileTabBar` (see the wiring contract in MobileTopBar.tsx). Derives
 * `bellInMore` from the shared page meta and the unread count from the app-wide notifications SWR key.
 */
export function MobileTabBarConnected({ ctx }: MobileTabBarConnectedProps) {
  const { showBell } = useMobileTopBarState();
  const { unreadCount } = useNotifications(ctx.signedIn);
  return <MobileTabBar tabs={ctx.model.tabs} moreDot={ctx.model.moreDot} bellInMore={!showBell} notificationsUnread={unreadCount} />;
}

type TabButtonProps = {
  href?: string;
  onClick?: () => void;
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  active: boolean;
  count?: number;
  countTone?: 'neutral' | 'danger';
  dot?: MoreDot;
  expanded?: boolean;
  testId: string;
};

function TabButton({ href, onClick, icon: Icon, label, ariaLabel, active, count, countTone, dot, expanded, testId }: TabButtonProps) {
  const color = active ? n[900] : n[500];
  const linkProps = href
    ? { component: NextLink, href, 'aria-current': active ? ('page' as const) : undefined }
    : { type: 'button' as const, onClick, 'aria-haspopup': 'dialog' as const, 'aria-expanded': Boolean(expanded) };
  return (
    <ButtonBase
      {...(linkProps as Record<string, unknown>)}
      aria-label={ariaLabel}
      data-testid={testId}
      data-active={active ? 'true' : undefined}
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px',
        color,
        WebkitTapHighlightColor: 'transparent',
        transition: `background-color ${motion.instant}ms linear`,
        '&:active': { bgcolor: n[50] },
        '&.Mui-focusVisible': { outline: `2px solid ${accent[500]}`, outlineOffset: '-2px' },
      }}
    >
      {active && (
        <Box aria-hidden sx={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 24, height: 2, borderRadius: '0 0 2px 2px', bgcolor: n[900] }} />
      )}
      <Box component="span" sx={{ position: 'relative', display: 'inline-flex' }}>
        <Icon size={18} strokeWidth={active ? 2 : 1.75} aria-hidden />
        {typeof count === 'number' && <CountPill count={count} tone={countTone} />}
        {count === undefined && dot && (
          <Box
            component="span"
            aria-hidden
            data-testid={`${testId}-dot`}
            data-dot={dot}
            sx={{
              position: 'absolute',
              top: -2,
              right: -3,
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: dot === 'warning' ? tone.warning.solid : n[900],
              boxShadow: `0 0 0 2px ${n[0]}`,
            }}
          />
        )}
      </Box>
      <Box
        component="span"
        sx={{
          maxWidth: '100%',
          px: '4px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: typeScale.micro[0],
          lineHeight: `${typeScale.micro[1]}px`,
          letterSpacing: typeScale.micro[3],
          fontWeight: active ? 600 : typeScale.micro[2],
        }}
      >
        {label}
      </Box>
    </ButtonBase>
  );
}

/**
 * Neutral tabular pill (danger when overdue). Same spec as the bell badge in NotificationsButton (shell-nav
 * §3.3 / §4.1): 16px, `micro` type, neutral-900 on white. Used by the tab bar and the More sheet rows.
 */
export function CountPill({ count, tone: pillTone = 'neutral', inline }: { count: number; tone?: 'neutral' | 'danger'; inline?: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      data-testid="count-pill"
      data-tone={pillTone}
      sx={{
        ...(inline ? {} : { position: 'absolute', top: -6, left: '60%' }),
        minWidth: 16,
        height: 16,
        px: '4px',
        borderRadius: '8px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: typeScale.micro[0],
        lineHeight: '16px',
        fontWeight: typeScale.micro[2],
        letterSpacing: typeScale.micro[3],
        fontVariantNumeric: 'tabular-nums',
        color: n[0],
        bgcolor: pillTone === 'danger' ? tone.danger.solid : n[900],
        boxShadow: inline ? 'none' : `0 0 0 2px ${n[0]}`,
      }}
    >
      {formatCount(count)}
    </Box>
  );
}

export default MobileTabBar;

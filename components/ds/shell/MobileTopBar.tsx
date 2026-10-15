// components/ds/shell/MobileTopBar.tsx — the 48px mobile TopBar (< 900px; shell-nav §4.1, CRITIQUE C2, X7).
//
// Left: back chevron (drill-in pages only) and the page title (the only place a TopBar shows a title).
// Right, in this fixed order on every surface (CRITIQUE C2):
//   1. search ⌕ (opens the palette sheet), omitted on drill-in pages;
//   2. at most one `<Page mobileAction>` as a labeled 40px button;
//   3. the page ⋯ (`mobileOverflow`) when the page has secondary/overflow actions, otherwise the bell.
// When the bell is not shown here it becomes the first row of the More sheet (`MoreSheet notificationsFirst`)
// and the More tab carries the unread dot; `useMobileTopBarState().showBell` tells the shell which case it is.
//
// While mounted it sets `--kx-topbar-current: 48px` on <html> (sticky elements read it; the tokens.css
// default is 52px), the same way MobileTabBar sets `--kx-bottom-nav`.
//
// WIRING CONTRACT (group F):
//   - A page that emits meta through `onShellMetaChange` MUST also pass `shellManaged`:
//       <Page shellManaged onShellMetaChange={usePageMetaSink()} …>
//     `PageShellMeta` does not carry `shellManaged`, and this bar treats every `<Page>` meta
//     (`source === 'page'`) as shell-owned: it renders the title as the page h1 and the ⋯ menu. PageHeader
//     hides its own mobile h1 and ⋯ only when `shellManaged` is set, so emitting one without the other
//     gives two h1s and two ⋯ menus. (`shellManaged` and the sink are one switch: never set them apart.)
//   - Do NOT call this module's hooks (or `usePullToRefresh`) inside AppShell's `render*` callbacks: those
//     run as plain functions only under `mobile && signedIn`, so hook counts would change with the viewport.
//     Render the connected components as JSX instead; each owns its hooks:
//       renderMobileTopBar={(ctx) => <MobileTopBarConnected ctx={ctx} />}
//       renderMobileTabBar={(ctx) => <MobileTabBarConnected ctx={ctx} />}
//       renderMoreSheet={(ctx) => <MoreSheetConnected ctx={ctx} />}
//     `showBell` is derived in each of them from the shared page meta (ShellContext), and the unread count
//     from the app-wide `useNotifications()` SWR key, so nothing has to be threaded through callbacks.
import * as React from 'react';
import Box from '@mui/material/Box';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ds/inputs/IconButton';
import { ActionButton } from '@/components/ds/overlay/actions';
import { OverflowMenu } from '@/components/ds/overlay/OverflowMenu';
import type { ActionSpec } from '@/components/ds/types/actions';
import { icons } from '@/lib/ds/icons';
import { elevation, layout, motion, neutral as n, type as typeScale, zIndex } from '@/lib/ds/tokens';
import { NAV_CONFIG, normalizePath } from '@/lib/nav/navConfig';
import { usePageMeta, type ShellPageMeta } from '@/lib/nav/ShellContext';
import { useShellStore } from '@/lib/nav/useShellStore';
import type { AppShellContext } from './AppShell';
import { PULL_MAX, PULL_THRESHOLD, usePullToRefresh, type PullToRefreshState } from './usePullToRefresh';

/** CSS variable sticky elements use for the current TopBar height (CRITIQUE X7). */
export const TOPBAR_CURRENT_CSS_VAR = '--kx-topbar-current';

// ── Pure resolution ─────────────────────────────────────────────────────────────────────────────────

const LISTING_ROW_HREFS: string[] = NAV_CONFIG.flatMap((g) => g.items)
  .filter((i) => i.listingRow)
  .map((i) => i.href);

function splitPath(asPath: string): { pathname: string; query: URLSearchParams } {
  const raw = String(asPath || '/');
  const noHash = raw.split('#')[0];
  const q = noHash.indexOf('?');
  const query = new URLSearchParams(q >= 0 ? noHash.slice(q + 1) : '');
  return { pathname: normalizePath(noHash), query };
}

/**
 * Parent of a drill-in route, or null when the route is a top-level page (shell-nav §4.1):
 * `/app/etsy-listings/123` → `/app/etsy-listings` (any listing row sub-path), `/ayarlar?tab=x` → `/ayarlar`.
 */
export function drillInParent(asPath: string): string | null {
  const { pathname, query } = splitPath(asPath);
  for (const href of LISTING_ROW_HREFS) {
    if (pathname.startsWith(`${href}/`) && pathname.length > href.length + 1) return href;
  }
  if (pathname === '/ayarlar' && query.get('tab')) return '/ayarlar';
  return null;
}

export type MobileTopBarState = {
  title: string;
  /** Back chevron target; null on top-level pages. */
  backHref: string | null;
  showSearch: boolean;
  action: ActionSpec | null;
  overflow: ActionSpec[];
  /** Slot 3 is the bell (no page overflow). False → the bell moves to the More sheet. */
  showBell: boolean;
  /**
   * The title is the page heading. Keyed on `<Page>` meta: per the wiring contract above, a page that emits
   * meta is always `shellManaged`, so its PageHeader hides its own mobile h1.
   */
  isPageHeading: boolean;
};

export function resolveMobileTopBar(meta: ShellPageMeta | null, asPath: string, fallbackTitle = ''): MobileTopBarState {
  const backHref = meta?.backHref || drillInParent(asPath);
  const overflow = (meta?.mobileOverflow ?? []).filter(Boolean);
  return {
    title: meta?.title || fallbackTitle || '',
    backHref: backHref || null,
    showSearch: !backHref,
    action: meta?.mobileAction ?? null,
    overflow,
    showBell: overflow.length === 0,
    isPageHeading: meta?.source === 'page',
  };
}

/** Hook form (reads `usePageMeta()` and the route). AppShell may call it too, to know `showBell`. */
export function useMobileTopBarState(fallbackTitle?: string): MobileTopBarState {
  const meta = usePageMeta();
  const router = useRouter();
  const asPath = router?.asPath ?? '/';
  return React.useMemo(() => resolveMobileTopBar(meta, asPath, fallbackTitle), [meta, asPath, fallbackTitle]);
}

// ── Component ───────────────────────────────────────────────────────────────────────────────────────

export type MobileTopBarProps = {
  /** Title when no page registered one yet (e.g. the active nav row's `ariaLabel`). */
  fallbackTitle?: string;
  /**
   * The bell (group C's `<NotificationsButton/>`, which renders the backend NotificationPanel in a sheet).
   * Rendered in slot 3 only when the page has no overflow actions.
   */
  notifications?: React.ReactNode;
  /** Search ⌕. Default: opens the palette (`useShellStore.setPaletteOpen(true)`). */
  onSearch?: () => void;
  /** Pull-to-refresh state from `usePullToRefresh(mainRef, …)`; the indicator slides out below the bar. */
  pull?: PullToRefreshState;
  className?: string;
  'data-testid'?: string;
};

const ICON_SLOT = layout.topBarMobile - 4; // 44px targets inside a 48px bar

export function MobileTopBar({ fallbackTitle, notifications, onSearch, pull, className, ...rest }: MobileTopBarProps) {
  const t = useTranslations('shell');
  const tPage = useTranslations('ds.page');
  const state = useMobileTopBarState(fallbackTitle);
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);
  const search = onSearch ?? (() => setPaletteOpen(true));

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(TOPBAR_CURRENT_CSS_VAR, `${layout.topBarMobile}px`);
    return () => {
      root.style.removeProperty(TOPBAR_CURRENT_CSS_VAR);
    };
  }, []);

  const titleSx = {
    m: 0,
    flex: 1,
    minWidth: 0,
    fontSize: typeScale.titleMd[0],
    lineHeight: `${typeScale.titleMd[1]}px`,
    fontWeight: typeScale.titleMd[2],
    letterSpacing: typeScale.titleMd[3],
    color: n[900],
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as const;

  return (
    <Box
      component="header"
      className={className}
      data-testid={rest['data-testid'] ?? 'mobile-topbar'}
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: zIndex.topBar,
        flexShrink: 0,
        bgcolor: n[0],
        borderBottom: `1px solid ${n[200]}`,
        pt: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <Box sx={{ height: layout.topBarMobile, display: 'flex', alignItems: 'center', gap: '4px', px: `${layout.gutterMobile}px` }}>
        {state.backHref && (
          <Box sx={{ ml: '-12px', display: 'inline-flex' }}>
            <IconButton icon={icons.back} label={t('topbar.back')} href={state.backHref} size="lg" noTooltip data-testid="mobile-topbar-back" />
          </Box>
        )}
        <Box component={state.isPageHeading ? 'h1' : 'div'} sx={titleSx} data-testid="mobile-topbar-title">
          {state.title}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, mr: '-8px' }}>
          {state.showSearch && (
            <IconButton icon={icons.search} label={t('topbar.search')} onClick={search} size="lg" noTooltip aria-haspopup="dialog" data-testid="mobile-topbar-search" />
          )}
          {state.action && (
            <ActionButton action={state.action} variant="secondary" size="md" data-testid="mobile-topbar-action" />
          )}
          {state.showBell ? (
            notifications ? (
              <Box sx={{ display: 'inline-flex', minWidth: ICON_SLOT, justifyContent: 'center' }} data-testid="mobile-topbar-bell">
                {notifications}
              </Box>
            ) : null
          ) : (
            <OverflowMenu items={state.overflow} label={tPage('moreActions')} size="md" data-testid="mobile-topbar-overflow" />
          )}
        </Box>
      </Box>
      {pull && pull.phase !== 'idle' && <PullToRefreshIndicator state={pull} />}
    </Box>
  );
}

// ── Connected form (rendered as JSX from AppShell `renderMobileTopBar`) ─────────────────────────────

export type MobileTopBarConnectedProps = {
  ctx: Pick<AppShellContext, 'mainRef' | 'mobileNotifications' | 'model'>;
};

/** Owns `usePullToRefresh(ctx.mainRef)` so the hook lives in a component, not in a render callback. */
export function MobileTopBarConnected({ ctx }: MobileTopBarConnectedProps) {
  const pull = usePullToRefresh(ctx.mainRef, { enabled: true });
  const active = ctx.model.groups.flatMap((g) => g.items).find((i) => i.active);
  return <MobileTopBar fallbackTitle={active?.ariaLabel} notifications={ctx.mobileNotifications} pull={pull} />;
}

// ── Pull-to-refresh indicator (shell-nav §4.1: 24px RefreshCw, neutral-500 on a neutral-0 circle, e2) ──

export type PullToRefreshIndicatorProps = { state: PullToRefreshState };

export function PullToRefreshIndicator({ state }: PullToRefreshIndicatorProps) {
  const t = useTranslations('shell.pull');
  const Icon = icons.pull;
  const refreshing = state.phase === 'refreshing';
  const label = refreshing ? t('refreshing') : state.phase === 'release' ? t('release') : t('pull');
  const size = 40;
  // Slides from under the bar: hidden at 0, fully out (8px below the bar) at the threshold. The wrapper
  // starts at the bar's bottom edge and clips (overflow hidden), so the part of the circle still "inside"
  // the bar is never painted over the title and icons.
  const offset = Math.min(state.distance, PULL_THRESHOLD) - size + 8;
  return (
    <Box
      data-testid="pull-indicator"
      data-phase={state.phase}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '100%',
        height: PULL_MAX + size,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          width: size,
          height: size,
          mt: `${offset}px`,
          borderRadius: '50%',
          bgcolor: n[0],
          boxShadow: elevation.e2,
          color: n[500],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: refreshing ? 1 : Math.max(0.2, state.progress),
          transition: state.dragging ? 'none' : `margin-top ${motion.base}ms ${motion.ease}`,
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            transform: refreshing ? undefined : `rotate(${Math.round(state.progress * 270)}deg)`,
            ...(refreshing && {
              animation: 'kx-pull-spin 0.8s linear infinite',
              '@keyframes kx-pull-spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }),
          }}
        >
          <Icon size={24} strokeWidth={1.75} aria-hidden />
        </Box>
      </Box>
      <Box
        component="span"
        role="status"
        aria-live="polite"
        sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {label}
      </Box>
    </Box>
  );
}

export default MobileTopBar;

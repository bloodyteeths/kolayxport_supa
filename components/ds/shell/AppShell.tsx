// components/ds/shell/AppShell.tsx — the persistent app shell (shell-nav §0, §3, §5, §7; DS §3.1, §4.2).
//
// Mounted ONCE in pages/_app.tsx for app routes (group F: `/app/**` except `/app/print/**`, `/ayarlar`,
// `/faturalar`), so the sidebar, polling and palette survive navigation. It owns:
//   - `<ShellProvider>` (page meta → TopBar breadcrumbs, MobileTopBar, palette, `<title>`);
//   - the nav model (`useNavModel`, called once here) fed by `useNavCounts`, the session user id and the
//     settings `billingProvider`; message-count polling;
//   - the usage model for the sidebar footer and the blocking `AccountBanner` (`deriveShellUsage`,
//     the `useEntitlement` fallback until settings D ships that hook);
//   - desktop chrome (≥ 900): `SideNav` (expanded / rail / 900–1199 overlay) + `TopBar`;
//   - global keys: `[` sidebar, `?` shortcut sheet (not on `pointer: coarse`), `Esc` closes the topmost
//     shell layer (palette → shortcut sheet → overlay → More sheet). ⌘K, `/` and `g`-chords are owned
//     by the palette (group E: `CommandPalette` hotkeys + `useGoShortcuts`), mounted through
//     `renderPalette`;
//   - route change: closes transient layers and moves focus to `<main id="kx-main">`;
//   - the skip link ("Skip to content").
// Mobile chrome (< 900: MobileTopBar, MobileTabBar, MoreSheet, pull-to-refresh) is group D's, and the
// palette is group E's: they plug in through the `render*` slots, which receive `AppShellContext`.
//
// States: no session (and not loading) → children bare, no chrome (the `/app` login screen). Session
// loading → brand row + skeleton rows, search trigger and avatar skeleton; the page renders its own
// skeleton (withAuth returns null meanwhile).
import * as React from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslations } from 'next-intl';
import LiveSoundToggle from '@/components/live/LiveSoundToggle';
import { SoundToggleHost } from './SoundToggleHost';
import { useAuth } from '@/lib/auth-context';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { focusRing, neutral as n, px, radius, zIndex } from '@/lib/ds/tokens';
import { ShellProvider, usePageMeta, type ShellPageMeta } from '@/lib/nav/ShellContext';
import { useNavCounts } from '@/lib/nav/useNavCounts';
import { mergeBreadcrumbs, useMessageCountPolling, useNavModel, type NavModel } from '@/lib/nav/useNavModel';
import { resolveSidebarMode, useShellStore, viewportFromWidth, type ShellViewport } from '@/lib/nav/useShellStore';
import type { UserSettingsResponse } from '@/lib/hooks/useSettings';
import { AccountBanner } from './AccountBanner';
import { clearNavConnCache, type AccountUser } from './AccountMenu';
import { NotificationsButton } from './NotificationsButton';
import { ShortcutSheet } from './ShortcutSheet';
import { SideNav } from './SideNav';
import { deriveShellUsage, type ShellUsage } from './SideNavFooter';
import { TopBar } from './TopBar';

/** Same SWR key as `_app` DsAppProviders and LimitReachedDialog read from the cache. */
export const SETTINGS_KEY = '/api/user/settings';
export const MAIN_ID = 'kx-main';
/** Legacy AppLayout content padding (p-1.5 / sm:p-3 / lg:p-4) for pages that do not render <Page> yet. */
const LEGACY_PAD = { xs: '6px', sm: '12px', lg: '16px' } as const;

type SettingsPayload = Pick<UserSettingsResponse, 'subscription'> | null;

const settingsFetcher = async (url: string): Promise<SettingsPayload> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
};

/** What the mobile / palette slots receive. */
export type AppShellContext = {
  model: NavModel;
  /** null until mounted (SSR and the first client render). */
  viewport: ShellViewport | null;
  /** `undefined` while loading, `null` when unknown / errored. */
  usage: ShellUsage | null | undefined;
  /** The scroll container (`<main id="kx-main">`), for `usePullToRefresh(mainRef, …)`. */
  mainRef: React.RefObject<HTMLElement | null>;
  meta: ShellPageMeta | null;
  signedIn: boolean;
  user: AccountUser | null;
  shopifyFree: boolean;
  /** `subscription.billingProvider` (undefined while settings load). */
  billingProvider: string | null | undefined;
  /** The bell for the mobile TopBar (drawer variant, 44 px). */
  mobileNotifications: React.ReactNode;
  /**
   * The live new-order sound toggle (backend `LiveSoundToggle`) for the mobile chrome: MobileTopBar (next
   * to the bell) or MoreSheet must render it, so a phone user can unlock audio in the `needsGesture` state.
   */
  mobileSoundToggle: React.ReactNode;
  /** Clears the nav cache, then signs out. */
  signOut: () => Promise<void>;
};

export type AppShellProps = {
  children: React.ReactNode;
  /** < 900 px: the 48 px TopBar (group D `MobileTopBar`). */
  renderMobileTopBar?: (ctx: AppShellContext) => React.ReactNode;
  /** < 900 px: the tab bar (group D `MobileTabBar`; it sets `--kx-bottom-nav`). */
  renderMobileTabBar?: (ctx: AppShellContext) => React.ReactNode;
  /** < 900 px: the More sheet (group D `MoreSheet`). */
  renderMoreSheet?: (ctx: AppShellContext) => React.ReactNode;
  /** Every viewport: the ⌘K palette and the `g`-chords (group E). */
  renderPalette?: (ctx: AppShellContext) => React.ReactNode;
  /** Write `<title>` from the page meta (default true). */
  documentTitle?: boolean;
};

/** Saved `<main>` offsets for back / forward restore; bounded so a long session does not grow it. */
const SCROLL_MEMO_MAX = 50;
function saveScroll(memo: Map<string, number>, asPath: string, top: number) {
  memo.delete(asPath);
  memo.set(asPath, top);
  if (memo.size > SCROLL_MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
}

/** Pathname of an asPath / URL (no query, no hash). */
function pathOf(url: string): string {
  return (url || '/').split(/[?#]/)[0] || '/';
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/** Viewport bucket after mount (null before: SSR-safe). */
export function useShellViewport(): ShellViewport | null {
  const atLeastMd = useMediaQuery('(min-width:900px)');
  const atLeastLg = useMediaQuery('(min-width:1200px)');
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return viewportFromWidth(atLeastLg ? 1200 : atLeastMd ? 900 : 0);
}

export function AppShell({ children, documentTitle = true, ...slots }: AppShellProps) {
  return (
    <ShellProvider documentTitle={documentTitle}>
      <ShellFrame {...slots}>{children}</ShellFrame>
    </ShellProvider>
  );
}

function ShellFrame({ children, renderMobileTopBar, renderMobileTabBar, renderMoreSheet, renderPalette }: Omit<AppShellProps, 'documentTitle'>) {
  const t = useTranslations('shell');
  const router = useRouter();
  const { user, session, isLoading, supabaseSignOut } = useAuth() as unknown as {
    user: (AccountUser & { id?: string }) | null;
    session: unknown;
    isLoading: boolean;
    supabaseSignOut: () => Promise<void>;
  };
  const signedIn = Boolean(session);
  const viewport = useShellViewport();
  const meta = usePageMeta();
  const mainRef = React.useRef<HTMLElement | null>(null);

  // ── data ──
  const { data: settings, error: settingsError } = useSWR<SettingsPayload>(signedIn ? SETTINGS_KEY : null, settingsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    keepPreviousData: true,
  });
  const sub = settings?.subscription ?? null;
  const settingsKnown = settings !== undefined;
  const shopifyFree = sub?.billingProvider === 'shopify_free' || sub?.subscriptionPlan === 'shopify_free';
  const billingProvider: string | null | undefined = !settingsKnown ? undefined : shopifyFree ? 'shopify_free' : sub?.billingProvider ?? null;
  const usage: ShellUsage | null | undefined = settingsKnown
    ? deriveShellUsage(sub)
    : settingsError
      ? null
      : undefined;

  const counts = useNavCounts({ enabled: signedIn });
  const model = useNavModel({ userId: user?.id ?? null, counts: counts.data ?? null, billingProvider });
  useMessageCountPolling(signedIn && model.messagesEnabled);

  // ── shell state ──
  const collapsed = useShellStore((s) => s.collapsed);
  const instant = useShellStore((s) => s.instant);
  const overlayOpen = useShellStore((s) => s.overlayOpen);
  const paletteOpen = useShellStore((s) => s.paletteOpen);
  const shortcutsOpen = useShellStore((s) => s.shortcutsOpen);
  const hydrateCollapsed = useShellStore((s) => s.hydrateCollapsed);
  const clearInstant = useShellStore((s) => s.clearInstant);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const setOverlayOpen = useShellStore((s) => s.setOverlayOpen);
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);
  const setShortcutsOpen = useShellStore((s) => s.setShortcutsOpen);
  const closeTransient = useShellStore((s) => s.closeTransient);
  const closeTopmost = useShellStore((s) => s.closeTopmost);

  useIsomorphicLayoutEffect(() => {
    hydrateCollapsed();
  }, [hydrateCollapsed]);
  React.useEffect(() => {
    if (!instant) return undefined;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => clearInstant()));
    return () => cancelAnimationFrame(id);
  }, [instant, clearInstant]);

  // Leaving the 900–1199 band closes the overlay (it only exists there).
  React.useEffect(() => {
    if (viewport !== 'narrow' && overlayOpen) setOverlayOpen(false);
  }, [viewport, overlayOpen, setOverlayOpen]);

  // Route change: close transient layers; when the pathname changed, focus <main> so screen readers start
  // at the new page. Shallow / query-only changes (filters through useUrlState) never move focus.
  const lastPathRef = React.useRef<string | null>(null);
  const lastAsPathRef = React.useRef<string>('');
  const scrollMemoRef = React.useRef<Map<string, number>>(new Map());
  React.useEffect(() => {
    const events = router?.events;
    if (!events) return undefined;
    lastPathRef.current = pathOf(router.asPath ?? '');
    lastAsPathRef.current = router.asPath ?? '';
    // <main> is the scroll container (the window never scrolls), so Next's own scroll reset / restore
    // never reaches it: reset it to the top on a new pathname, and restore the saved offset on back /
    // forward (popstate), the way Next restores the window.
    let popPending = false;
    const onPop = () => {
      popPending = true;
    };
    const onStart = (_url?: string, opts?: { shallow?: boolean }) => {
      if (opts?.shallow) return;
      const main = mainRef.current;
      if (main && lastAsPathRef.current) saveScroll(scrollMemoRef.current, lastAsPathRef.current, main.scrollTop);
    };
    const onDone = (url?: string, opts?: { shallow?: boolean }) => {
      const wasPop = popPending;
      popPending = false;
      if (opts?.shallow) return;
      closeTransient();
      const asPath = url ?? router.asPath ?? '';
      const next = pathOf(asPath);
      const changed = next !== lastPathRef.current;
      lastPathRef.current = next;
      lastAsPathRef.current = asPath;
      if (!changed) return;
      const main = mainRef.current;
      if (main) {
        const top = wasPop ? scrollMemoRef.current.get(asPath) ?? 0 : 0;
        main.scrollTop = top;
      }
      if (main && typeof main.focus === 'function') {
        try {
          main.focus({ preventScroll: true });
        } catch {
          main.focus();
        }
      }
    };
    if (typeof window !== 'undefined') window.addEventListener('popstate', onPop);
    events.on('routeChangeStart', onStart);
    events.on('routeChangeComplete', onDone);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('popstate', onPop);
      events.off('routeChangeStart', onStart);
      events.off('routeChangeComplete', onDone);
    };
  }, [router?.events, closeTransient]);

  // The first frame after the viewport is known applies its width without animating (no 240 → 64 slide
  // on load at 1024 px), like the stored-collapse `instant` flag.
  const [animReady, setAnimReady] = React.useState(false);
  React.useEffect(() => {
    if (!viewport || animReady) return undefined;
    let id2 = 0;
    const id = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setAnimReady(true));
    });
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(id2);
    };
  }, [viewport, animReady]);

  const coarse = useMediaQuery('(pointer: coarse)');
  const desktop = viewport === 'narrow' || viewport === 'wide';
  useShortcuts(
    {
      '[': { handler: () => (viewport ? toggleSidebar(viewport) : undefined), enabled: desktop },
      '?': { handler: () => setShortcutsOpen(true), enabled: !coarse },
      escape: { handler: () => closeTopmost(), preventDefault: false },
    },
    { scope: 'global', enabled: signedIn },
  );

  const signOut = React.useCallback(async () => {
    clearNavConnCache();
    await supabaseSignOut();
  }, [supabaseSignOut]);

  // ── no session: no chrome ──
  if (!signedIn && !isLoading) return <>{children}</>;

  const loading = !signedIn; // isLoading
  const ctx: AppShellContext = {
    model,
    viewport,
    usage,
    mainRef,
    meta,
    signedIn,
    user: user ?? null,
    shopifyFree,
    billingProvider,
    mobileNotifications: signedIn ? <NotificationsButton enabled mobile size="lg" /> : null,
    mobileSoundToggle: signedIn ? (
      <SoundToggleHost size="touch" data-testid="mobile-sound-host">
        <LiveSoundToggle size="small" />
      </SoundToggleHost>
    ) : null,
    signOut,
  };

  const mobile = viewport === 'mobile';
  // Before mount the desktop chrome renders (hidden below md by CSS) so SSR markup is stable.
  const showDesktopChrome = viewport === null || desktop;
  const sidebarViewport = viewport === 'narrow' ? 'narrow' : 'wide';
  const resolved = viewport ? resolveSidebarMode(viewport, collapsed) : collapsed ? 'rail' : 'expanded';
  const mode: 'rail' | 'expanded' = resolved === 'expanded' ? 'expanded' : 'rail';
  const legacyPage = meta?.source !== 'page';

  return (
    <Box
      data-testid="app-shell"
      data-viewport={viewport ?? 'unknown'}
      sx={{ display: 'flex', height: '100dvh', minHeight: 0, bgcolor: n[50] }}
    >
      <Box
        component="a"
        href={`#${MAIN_ID}`}
        data-testid="skip-link"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        sx={{
          position: 'fixed',
          left: px(8),
          top: px(8),
          zIndex: zIndex.tooltip,
          px: px(12),
          py: px(8),
          bgcolor: n[0],
          color: n[900],
          border: `1px solid ${n[300]}`,
          borderRadius: px(radius.sm),
          fontSize: 13,
          textDecoration: 'none',
          transform: 'translateY(-200%)',
          '&:focus': { transform: 'none', outline: 'none', boxShadow: focusRing },
        }}
      >
        {t('skipToContent')}
      </Box>

      {showDesktopChrome ? (
        <Box sx={{ display: { xs: viewport === null ? 'none' : 'block', md: 'block' }, height: '100%', flexShrink: 0 }}>
          <SideNav
            model={loading ? null : model}
            viewport={sidebarViewport}
            mode={mode}
            overlayOpen={overlayOpen}
            instant={instant || !animReady}
            usage={usage}
            onToggle={() => toggleSidebar(viewport ?? 'wide')}
            onCloseOverlay={() => setOverlayOpen(false)}
          />
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {showDesktopChrome ? (
          <Box sx={{ display: { xs: viewport === null ? 'none' : 'block', md: 'block' } }}>
            <TopBar
              breadcrumbs={loading ? [] : mergeBreadcrumbs(model.breadcrumbs, meta?.breadcrumbs)}
              user={loading ? null : user ?? null}
              signedIn={signedIn}
              shopifyFree={shopifyFree}
              paletteOpen={paletteOpen}
              onOpenPalette={() => setPaletteOpen(true)}
              onShowShortcuts={() => setShortcutsOpen(true)}
              onSignOut={signOut}
            />
          </Box>
        ) : null}
        {mobile && signedIn ? renderMobileTopBar?.(ctx) : null}

        <Box
          component="main"
          id={MAIN_ID}
          ref={mainRef}
          tabIndex={-1}
          data-testid="app-main"
          data-legacy={legacyPage ? 'true' : undefined}
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            bgcolor: n[50],
            outline: 'none',
            // Legacy pages (AppLayout shim, no <Page>) keep the old content padding; <Page> owns its gutters.
            ...(legacyPage ? { pt: LEGACY_PAD, px: LEGACY_PAD } : null),
            // Tab-bar clearance lives in one place: here for legacy pages, in <Page> (xs pb) otherwise.
            pb: legacyPage
              ? mobile
                ? `calc(var(--kx-bottom-nav, 0px) + ${px(8)})`
                : `calc(${px(16)} + env(safe-area-inset-bottom, 0px))`
              : mobile
                ? 0
                : 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {signedIn ? <AccountBanner usage={usage} /> : null}
          {children}
        </Box>
      </Box>

      {mobile && signedIn ? renderMobileTabBar?.(ctx) : null}
      {mobile && signedIn ? renderMoreSheet?.(ctx) : null}
      {signedIn ? renderPalette?.(ctx) : null}
      {signedIn && !coarse ? <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} /> : null}
    </Box>
  );
}

export default AppShell;

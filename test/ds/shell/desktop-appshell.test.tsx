// @vitest-environment jsdom
// AppShell: bare children without a session, persistent desktop chrome, `[` / `?` / Esc keys, route change,
// skip link + <main id="kx-main">, slots for groups D/E, account banner, legacy padding.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

type Handler = (url?: string, opts?: { shallow?: boolean }) => void;
const routeHandlers = new Map<string, Set<Handler>>();
const router = {
  asPath: '/app/labels',
  pathname: '/app/labels',
  push: vi.fn(),
  events: {
    on: (e: string, h: Handler) => {
      if (!routeHandlers.has(e)) routeHandlers.set(e, new Set());
      routeHandlers.get(e)!.add(h);
    },
    off: (e: string, h: Handler) => routeHandlers.get(e)?.delete(h),
  },
};
vi.mock('next/router', () => ({ useRouter: () => router }));

let auth: { user: unknown; session: unknown; isLoading: boolean; supabaseSignOut: () => Promise<void> };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth }));
vi.mock('@/components/live/LiveSoundToggle', () => ({ default: () => <span data-testid="live-sound-toggle" /> }));
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ items: [], unreadCount: 0, isLoading: false, error: undefined, markRead: async () => {}, markAllRead: async () => {}, refresh: async () => undefined }),
}));
vi.mock('@/lib/nav/useNavCounts', () => ({
  useNavCounts: () => ({ data: { orders: { toShip: 4, overdue: 0 }, drafts: { etsy: 0, ebay: 0 }, generatedAt: '', receivedAt: Date.now() } }),
}));
let conns: unknown = null;
vi.mock('@/lib/hooks/useConnections', () => ({ useConnections: () => ({ connections: conns, needsReauth: [] }) }));

import { AppShell } from '@/components/ds/shell/AppShell';
import { usePageMetaSink, usePageTitle } from '@/lib/nav/ShellContext';
import { __resetShellStoreForTests, useShellStore, SIDEBAR_COLLAPSED_KEY } from '@/lib/nav/useShellStore';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { connsOf, renderShell, type Viewport } from './desktop-helpers';

let settingsBody: unknown = {
  subscription: {
    subscriptionPlan: 'trial',
    subscriptionStatus: 'trialing',
    trialExpiresAt: '2020-01-01T00:00:00Z',
    usageResetAt: null,
    orderSyncCount: 0,
    labelCount: 0,
    billingProvider: 'stripe',
  },
};

beforeEach(() => {
  __resetShellStoreForTests();
  window.localStorage.clear();
  routeHandlers.clear();
  conns = connsOf(['etsy']);
  auth = { user: { id: 'u1', name: 'Tamer Samsar', email: 's@example.com' }, session: { user: {} }, isLoading: false, supabaseSignOut: vi.fn(async () => {}) };
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => settingsBody })) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  __resetShortcutsForTests();
});

function LegacyPage() {
  usePageTitle('Etsy Listings - KolayXport');
  return <div data-testid="page">page</div>;
}
function DsPage() {
  const sink = usePageMetaSink();
  React.useLayoutEffect(() => {
    sink?.({ title: 'Orders', mobileOverflow: [], headerActions: [] } as never);
  }, [sink]);
  return <div data-testid="page">page</div>;
}

function mount(ui: React.ReactNode, viewport: Viewport = 'wide', slots: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return renderShell(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AppShell {...slots}>{ui}</AppShell>
    </SWRConfig>,
    { viewport },
  );
}

describe('AppShell', () => {
  it('no session: renders the page bare (no chrome)', () => {
    auth = { ...auth, user: null, session: null, isLoading: false };
    mount(<LegacyPage />);
    expect(screen.getByTestId('page')).toBeTruthy();
    expect(screen.queryByTestId('app-shell')).toBeNull();
    expect(screen.queryByTestId('sidenav')).toBeNull();
  });

  it('session loading: chrome skeletons around the page', () => {
    auth = { ...auth, user: null, session: null, isLoading: true };
    mount(<LegacyPage />);
    expect(screen.getByTestId('sidenav-skeleton')).toBeTruthy();
    expect(screen.getByTestId('search-trigger')).toBeTruthy();
    expect(screen.getByTestId('account-menu-skeleton')).toBeTruthy();
  });

  it('signed in at 1440: expanded sidebar, TopBar breadcrumbs, skip link and <main id="kx-main">', async () => {
    mount(<LegacyPage />);
    await waitFor(() => expect(screen.getByTestId('app-shell').getAttribute('data-viewport')).toBe('wide'));
    expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('expanded');
    expect(screen.getByTestId('nav-item-orders').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('nav-count-orders').textContent).toBe('4');
    expect(screen.getByTestId('breadcrumbs').textContent).toBe('Orders');
    const main = screen.getByTestId('app-main');
    expect(main.id).toBe('kx-main');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByTestId('skip-link').getAttribute('href')).toBe('#kx-main');
    // legacy page (title shim only) keeps the old content padding
    expect(main.getAttribute('data-legacy')).toBe('true');
    expect(screen.getByTestId('live-sound-toggle')).toBeTruthy();
  });

  it('a <Page> registered through the sink drops the legacy padding', async () => {
    mount(<DsPage />);
    await waitFor(() => expect(screen.getByTestId('app-main').getAttribute('data-legacy')).toBeNull());
  });

  it('`[` toggles and persists the ≥ 1200 choice; it is ignored inside inputs', async () => {
    mount(
      <>
        <LegacyPage />
        <input data-testid="field" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('app-shell').getAttribute('data-viewport')).toBe('wide'));
    fireEvent.keyDown(screen.getByTestId('field'), { key: '[' });
    expect(useShellStore.getState().collapsed).toBe(false);
    fireEvent.keyDown(window, { key: '[' });
    expect(useShellStore.getState().collapsed).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    await waitFor(() => expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('rail'));
    fireEvent.keyDown(window, { key: '[' });
    expect(useShellStore.getState().collapsed).toBe(false);
  });

  it('at 1024 the rail is automatic; `[` opens the overlay, Esc closes it', async () => {
    mount(<LegacyPage />, 'narrow');
    await waitFor(() => expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('rail'));
    fireEvent.keyDown(window, { key: '[' });
    await waitFor(() => expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('overlay'));
    expect(useShellStore.getState().collapsed).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('sidenav').getAttribute('data-mode')).toBe('rail'));
  });

  it('`?` opens the shortcut sheet; a route change closes transient layers and focuses <main>', async () => {
    mount(<LegacyPage />);
    await waitFor(() => expect(screen.getByTestId('app-shell').getAttribute('data-viewport')).toBe('wide'));
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(useShellStore.getState().shortcutsOpen).toBe(true);
    expect(await screen.findByTestId('shortcut-sheet')).toBeTruthy();
    act(() => useShellStore.getState().setPaletteOpen(true));
    const fire = (url: string, opts?: { shallow?: boolean }) =>
      act(() => routeHandlers.get('routeChangeComplete')?.forEach((h) => h(url, opts)));
    // query-only change on the same page: layers close, focus stays where the user is
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fire('/app/labels?status=to_ship');
    expect(useShellStore.getState().shortcutsOpen).toBe(false);
    expect(useShellStore.getState().paletteOpen).toBe(false);
    expect(document.activeElement).toBe(field);
    // shallow change: nothing happens
    act(() => useShellStore.getState().setPaletteOpen(true));
    fire('/app/mesajlar', { shallow: true });
    expect(useShellStore.getState().paletteOpen).toBe(true);
    // a new page: focus moves to <main>
    fire('/app/mesajlar');
    expect(useShellStore.getState().paletteOpen).toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId('app-main'));
    field.remove();
  });

  it('a new pathname resets the <main> scroll; shallow / query changes keep it; back restores it', async () => {
    mount(<LegacyPage />);
    await waitFor(() => expect(screen.getByTestId('app-shell').getAttribute('data-viewport')).toBe('wide'));
    const main = screen.getByTestId('app-main');
    const start = (url: string, opts?: { shallow?: boolean }) =>
      act(() => routeHandlers.get('routeChangeStart')?.forEach((h) => h(url, opts)));
    const done = (url: string, opts?: { shallow?: boolean }) =>
      act(() => routeHandlers.get('routeChangeComplete')?.forEach((h) => h(url, opts)));
    main.scrollTop = 3000;
    start('/app/labels?status=to_ship', { shallow: true });
    done('/app/labels?status=to_ship', { shallow: true });
    expect(main.scrollTop).toBe(3000);
    start('/app/labels?status=shipped');
    done('/app/labels?status=shipped');
    expect(main.scrollTop).toBe(3000);
    // a new page starts at the top
    start('/app/etsy');
    done('/app/etsy');
    expect(main.scrollTop).toBe(0);
    // back (popstate) to the list restores its offset
    main.scrollTop = 120;
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    start('/app/labels?status=shipped');
    done('/app/labels?status=shipped');
    expect(main.scrollTop).toBe(3000);
    // a forward push (no popstate) to a visited page still starts at the top
    start('/app/etsy');
    done('/app/etsy');
    expect(main.scrollTop).toBe(0);
  });

  it('mobile: a <Page> route gets no tab-bar padding from <main> (Page owns it); the sound toggle is in the context', async () => {
    const renderMobileTopBar = vi.fn((ctx: { mobileSoundToggle: React.ReactNode }) => <div data-testid="m-top">{ctx.mobileSoundToggle}</div>);
    mount(<DsPage />, 'mobile', { renderMobileTopBar });
    await waitFor(() => expect(screen.getByTestId('app-main').getAttribute('data-legacy')).toBeNull());
    expect(window.getComputedStyle(screen.getByTestId('app-main')).paddingBottom).toBe('0px');
    expect(screen.getByTestId('m-top').querySelector('[data-testid="live-sound-toggle"]')).toBeTruthy();
  });

  it('blocked account: the danger banner renders above the page', async () => {
    mount(<LegacyPage />);
    expect(await screen.findByTestId('account-banner')).toBeTruthy();
  });

  it('mobile (< 900): no sidebar or desktop TopBar; group D/E slots render with the context', async () => {
    const renderMobileTopBar = vi.fn(() => <div data-testid="m-top" />);
    const renderMobileTabBar = vi.fn(() => <div data-testid="m-tabs" />);
    const renderMoreSheet = vi.fn(() => <div data-testid="m-more" />);
    const renderPalette = vi.fn(() => <div data-testid="palette" />);
    mount(<LegacyPage />, 'mobile', { renderMobileTopBar, renderMobileTabBar, renderMoreSheet, renderPalette });
    await waitFor(() => expect(screen.getByTestId('app-shell').getAttribute('data-viewport')).toBe('mobile'));
    expect(screen.queryByTestId('sidenav')).toBeNull();
    expect(screen.queryByTestId('topbar')).toBeNull();
    for (const id of ['m-top', 'm-tabs', 'm-more', 'palette']) expect(screen.getByTestId(id)).toBeTruthy();
    const ctx = renderMobileTabBar.mock.calls.at(-1)![0] as { model: { tabs: unknown[] }; mainRef: { current: HTMLElement | null } };
    expect(ctx.model.tabs.length).toBe(4);
    expect(ctx.mainRef.current?.id).toBe('kx-main');
  });

  it('the palette slot also renders on desktop', async () => {
    mount(<LegacyPage />, 'wide', { renderPalette: () => <div data-testid="palette" /> });
    expect(screen.getByTestId('palette')).toBeTruthy();
  });
});

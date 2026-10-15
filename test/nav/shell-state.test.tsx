// @vitest-environment jsdom
// useShellStore (collapse persistence, toggle per viewport, Esc order) and ShellContext (page meta sink,
// shim title, `<Page>` meta wins, clear on unmount, suffix stripping).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  LEGACY_SIDEBAR_PIN_KEY,
  SIDEBAR_COLLAPSED_KEY,
  __resetShellStoreForTests,
  resolveSidebarMode,
  useShellStore,
  viewportFromWidth,
} from '@/lib/nav/useShellStore';
import {
  ShellProvider,
  mergeShellMeta,
  stripTitleSuffix,
  usePageMeta,
  usePageMetaSink,
  usePageTitle,
  type ShellPageMeta,
} from '@/lib/nav/ShellContext';
import type { PageShellMeta } from '@/components/ds/page/PageContext';

beforeEach(() => {
  window.localStorage.clear();
  __resetShellStoreForTests();
});
afterEach(cleanup);

describe('useShellStore', () => {
  it('hydrates the collapsed choice once, snaps instantly, and removes the legacy pin key', () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    window.localStorage.setItem(LEGACY_SIDEBAR_PIN_KEY, '1');
    useShellStore.getState().hydrateCollapsed();
    expect(useShellStore.getState()).toMatchObject({ collapsed: true, hydrated: true, instant: true });
    expect(window.localStorage.getItem(LEGACY_SIDEBAR_PIN_KEY)).toBeNull();
    useShellStore.getState().clearInstant();
    expect(useShellStore.getState().instant).toBe(false);
  });

  it('toggleSidebar: wide persists collapsed, narrow toggles the overlay, mobile does nothing', () => {
    const s = () => useShellStore.getState();
    s().toggleSidebar('wide');
    expect(s().collapsed).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    s().toggleSidebar('narrow');
    expect(s().overlayOpen).toBe(true);
    s().toggleSidebar('mobile');
    expect(s()).toMatchObject({ collapsed: true, overlayOpen: true });
  });

  it('closeTopmost closes palette, then overlay, then the More sheet', () => {
    const s = () => useShellStore.getState();
    useShellStore.setState({ paletteOpen: true, overlayOpen: true, moreOpen: true });
    expect(s().closeTopmost()).toBe(true);
    expect(s().paletteOpen).toBe(false);
    s().closeTopmost();
    expect(s().overlayOpen).toBe(false);
    s().closeTopmost();
    expect(s().moreOpen).toBe(false);
    expect(s().closeTopmost()).toBe(false);
  });

  it('closeTransient closes every transient surface (route change)', () => {
    useShellStore.setState({ paletteOpen: true, overlayOpen: true, moreOpen: true, shortcutsOpen: true });
    useShellStore.getState().closeTransient();
    expect(useShellStore.getState()).toMatchObject({ paletteOpen: false, overlayOpen: false, moreOpen: false, shortcutsOpen: false });
  });

  it('resolveSidebarMode / viewportFromWidth follow the DS breakpoints', () => {
    expect([390, 899, 900, 1199, 1200, 1440].map(viewportFromWidth)).toEqual(['mobile', 'mobile', 'narrow', 'narrow', 'wide', 'wide']);
    expect(resolveSidebarMode('mobile', false)).toBe('hidden');
    expect(resolveSidebarMode('narrow', false)).toBe('rail');
    expect(resolveSidebarMode('wide', false)).toBe('expanded');
    expect(resolveSidebarMode('wide', true)).toBe('rail');
  });
});

const messages = { ds: { page: { documentTitle: '{title} · KolayXport' } } };
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShellProvider>{children}</ShellProvider>
    </NextIntlClientProvider>
  );
}

const meta = (title: string): PageShellMeta => ({ title, width: 'list', mobileOverflow: [], headerActions: [] });

describe('ShellContext', () => {
  it('stripTitleSuffix removes every legacy suffix form', () => {
    expect(stripTitleSuffix('Etsy Listings - KolayXport')).toBe('Etsy Listings');
    expect(stripTitleSuffix('eBay Listings — KolayXport')).toBe('eBay Listings');
    expect(stripTitleSuffix('Orders · KolayXport')).toBe('Orders');
    expect(stripTitleSuffix('KolayXport Dashboard')).toBe('');
    expect(stripTitleSuffix('Settings')).toBe('Settings');
  });

  it('mergeShellMeta: Page meta wins over the shim title', () => {
    expect(mergeShellMeta(meta('Orders'), 'Legacy')?.title).toBe('Orders');
    expect(mergeShellMeta(null, 'Legacy')).toMatchObject({ title: 'Legacy', source: 'title', headerActions: [] });
    expect(mergeShellMeta(null, null)).toBeNull();
  });

  it('usePageTitle registers a title and clears it on unmount', () => {
    let seen: ShellPageMeta | null = null;
    function Reader() {
      seen = usePageMeta();
      return null;
    }
    function Shim({ title }: { title: string }) {
      usePageTitle(title);
      return null;
    }
    const { rerender } = render(
      <Providers>
        <Reader />
        <Shim title="Etsy Listings - KolayXport" />
      </Providers>,
    );
    expect(seen).toMatchObject({ title: 'Etsy Listings', source: 'title' });
    rerender(
      <Providers>
        <Reader />
      </Providers>,
    );
    expect(seen).toBeNull();
  });

  it('usePageMetaSink stores Page meta (winning over the shim) and clears it on unmount', () => {
    let seen: ShellPageMeta | null = null;
    let sink: ((m: PageShellMeta) => void) | undefined;
    function Reader() {
      seen = usePageMeta();
      return null;
    }
    function PageLike() {
      sink = usePageMetaSink();
      usePageTitle('Legacy');
      return null;
    }
    const { rerender } = render(
      <Providers>
        <Reader />
        <PageLike />
      </Providers>,
    );
    expect(seen).toMatchObject({ title: 'Legacy' });
    act(() => sink!(meta('Orders')));
    expect(seen).toMatchObject({ title: 'Orders', source: 'page', width: 'list' });
    rerender(
      <Providers>
        <Reader />
      </Providers>,
    );
    expect(seen).toBeNull();
  });

  it('route change between two <Page>s never renders a null-meta frame', () => {
    const seen: (string | null)[] = [];
    function Reader() {
      const m = usePageMeta();
      seen.push(m?.title ?? null);
      return null;
    }
    // Mirrors Page.tsx: emit from a passive effect.
    function PageLike({ title }: { title: string }) {
      const sink = usePageMetaSink();
      React.useEffect(() => sink?.(meta(title)), [sink, title]);
      return null;
    }
    const { rerender } = render(
      <Providers>
        <Reader />
        <PageLike key="a" title="Orders" />
      </Providers>,
    );
    expect(seen.at(-1)).toBe('Orders');
    seen.length = 0;
    rerender(
      <Providers>
        <Reader />
        <PageLike key="b" title="Messages" />
      </Providers>,
    );
    expect(seen.at(-1)).toBe('Messages');
    expect(seen).not.toContain(null);
  });

  it('writers do not re-render when the meta they wrote changes', () => {
    let writerRenders = 0;
    let sink: ((m: PageShellMeta) => void) | undefined;
    function Writer() {
      writerRenders += 1;
      sink = usePageMetaSink();
      usePageTitle('Legacy');
      return null;
    }
    function Reader() {
      usePageMeta();
      return null;
    }
    render(
      <Providers>
        <Reader />
        <Writer />
      </Providers>,
    );
    const before = writerRenders;
    act(() => sink!(meta('Orders')));
    act(() => sink!(meta('Orders 2')));
    expect(writerRenders).toBe(before);
  });

  it('outside the shell the sink is undefined and the reader is null', () => {
    const { result } = renderHook(() => ({ sink: usePageMetaSink(), meta: usePageMeta() }));
    expect(result.current.sink).toBeUndefined();
    expect(result.current.meta).toBeNull();
  });
});

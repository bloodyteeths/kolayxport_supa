// @vitest-environment jsdom
// Group D (shell-nav §12): MobileTopBar, MobileTabBar, MoreSheet.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ConnectionsMap } from '@/lib/hooks/useConnections';

const router = { asPath: '/app/labels', pathname: '/app/labels', replace: vi.fn(async () => true), push: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));

const signOut = vi.fn(async () => {});
let authUser: { name?: string; email?: string; image?: string | null } | null = { name: 'Tamer Samsar', email: 'tamer@example.com', image: null };
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: authUser, supabaseSignOut: signOut }),
}));

import { buildNavModel, NAV_CONN_CACHE_KEY, type NavModel } from '@/lib/nav/useNavModel';
import { ShellProvider, usePageMetaSink, usePageTitle } from '@/lib/nav/ShellContext';
import { useShellStore, __resetShellStoreForTests } from '@/lib/nav/useShellStore';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import type { PageShellMeta } from '@/components/ds/page/PageContext';
import {
  MobileTopBar,
  MobileTopBarConnected,
  PullToRefreshIndicator,
  TOPBAR_CURRENT_CSS_VAR,
  drillInParent,
  resolveMobileTopBar,
} from '@/components/ds/shell/MobileTopBar';
import {
  BOTTOM_NAV_CSS_VAR,
  MOBILE_TAB_BAR_HEIGHT,
  MobileTabBar,
  formatCount,
  resolveMoreDot,
} from '@/components/ds/shell/MobileTabBar';
import { LOCALE_ENDONYMS, MoreSheet, buildMoreSheetGroups } from '@/components/ds/shell/MoreSheet';
import { LOCALES, m, navT, renderIntl, wrap, type Locale } from './mobile-messages';

function connsOf(connected: string[], reauth: string[] = []): ConnectionsMap {
  const map = {} as ConnectionsMap;
  for (const p of ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo'] as const) {
    map[p] = { connected: connected.includes(p), accounts: [], needsReauth: reauth.includes(p) };
  }
  return map;
}

function model(locale: Locale, opts: { path?: string; connected?: string[]; reauth?: string[]; toShip?: number; overdue?: number; unread?: number } = {}): NavModel {
  return buildNavModel({
    t: navT(locale),
    path: opts.path ?? '/app/labels',
    connections: connsOf(opts.connected ?? ['etsy', 'ebay', 'trendyol'], opts.reauth ?? []),
    counts: { orders: { toShip: opts.toShip ?? 0, overdue: opts.overdue ?? 0 }, drafts: { etsy: 2, ebay: 0 } },
    messagesUnread: opts.unread ?? 0,
    billingProvider: null,
  });
}

beforeEach(() => {
  __resetShellStoreForTests();
  router.asPath = '/app/labels';
  authUser = { name: 'Tamer Samsar', email: 'tamer@example.com', image: null };
  signOut.mockClear();
  window.localStorage.clear();
});
// jsdom cannot navigate: stop the anchor default action after React handled the click.
const stopNav = (e: Event) => e.preventDefault();
beforeEach(() => window.addEventListener('click', stopNav));
afterEach(() => {
  window.removeEventListener('click', stopNav);
  cleanup();
});

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────────────

describe('mobile chrome: pure helpers', () => {
  it('drillInParent: listing sub-paths and settings tabs are drill-ins, top-level pages are not', () => {
    expect(drillInParent('/app/etsy-listings/123?x=1')).toBe('/app/etsy-listings');
    expect(drillInParent('/app/ebay-listings/bulk')).toBe('/app/ebay-listings');
    expect(drillInParent('/ayarlar?tab=billing')).toBe('/ayarlar');
    expect(drillInParent('/ayarlar')).toBeNull();
    expect(drillInParent('/app/etsy-listings')).toBeNull();
    expect(drillInParent('/app/etsy-listings/')).toBeNull();
    expect(drillInParent('/app/labels')).toBeNull();
  });

  it('resolveMobileTopBar: fixed slot order rules (CRITIQUE C2)', () => {
    const base = { title: 'Orders', mobileOverflow: [], headerActions: [], source: 'page' as const };
    const top = resolveMobileTopBar(base, '/app/labels');
    expect(top).toMatchObject({ title: 'Orders', backHref: null, showSearch: true, showBell: true, action: null, isPageHeading: true });
    const withOverflow = resolveMobileTopBar({ ...base, mobileOverflow: [{ id: 'x', label: 'Export' }] }, '/app/labels');
    expect(withOverflow.showBell).toBe(false);
    const drill = resolveMobileTopBar({ ...base, title: 'Blanket' }, '/app/etsy-listings/42');
    expect(drill).toMatchObject({ backHref: '/app/etsy-listings', showSearch: false });
    const explicit = resolveMobileTopBar({ ...base, backHref: '/ayarlar?tab=billing' }, '/faturalar');
    expect(explicit.backHref).toBe('/ayarlar?tab=billing');
    expect(resolveMobileTopBar(null, '/app/labels', 'Orders')).toMatchObject({ title: 'Orders', isPageHeading: false, showBell: true });
  });

  it('resolveMoreDot: warning wins, unread only when the bell is parked in the sheet', () => {
    expect(resolveMoreDot({ moreDot: 'warning', bellInMore: true, notificationsUnread: 3 })).toBe('warning');
    expect(resolveMoreDot({ bellInMore: true, notificationsUnread: 3 })).toBe('unread');
    expect(resolveMoreDot({ bellInMore: false, notificationsUnread: 3 })).toBeUndefined();
    expect(resolveMoreDot({ bellInMore: true, notificationsUnread: 0 })).toBeUndefined();
    expect(formatCount(7)).toBe('7');
    expect(formatCount(140)).toBe('99+');
  });

  it('buildMoreSheetGroups: never repeats tab-bar rows; lifts Notifications when the bell is in the sheet', () => {
    const nav = model('en', { connected: ['etsy', 'wix'] });
    const groups = buildMoreSheetGroups(nav.groups, nav.tabs);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('home');
    expect(ids).not.toContain('orders');
    expect(ids).not.toContain('messages'); // slot 4 is Messages (Wix connected)
    expect(ids).toContain('research');
    expect(ids).toContain('listings-etsy');
    const lifted = buildMoreSheetGroups(nav.groups, nav.tabs, { notificationsFirst: true });
    expect(lifted[0].items.map((i) => i.id)).toEqual(['notifications']);
    expect(lifted.flatMap((g) => g.items).filter((i) => i.id === 'notifications')).toHaveLength(1);

    const noMsg = model('en', { connected: ['etsy'] });
    const noMsgIds = buildMoreSheetGroups(noMsg.groups, noMsg.tabs).flatMap((g) => g.items.map((i) => i.id));
    expect(noMsgIds).not.toContain('research'); // slot 4 is Research
  });
});

// ── MobileTabBar ────────────────────────────────────────────────────────────────────────────────────

describe.each(LOCALES)('MobileTabBar (%s)', (locale) => {
  it('sets --kx-bottom-nav (56 + safe area) while mounted and removes it on unmount', () => {
    const { unmount } = renderIntl(<MobileTabBar tabs={model(locale).tabs} />, locale);
    expect(MOBILE_TAB_BAR_HEIGHT).toBe(56);
    expect(document.documentElement.style.getPropertyValue(BOTTOM_NAV_CSS_VAR)).toBe('calc(56px + env(safe-area-inset-bottom, 0px))');
    unmount();
    expect(document.documentElement.style.getPropertyValue(BOTTOM_NAV_CSS_VAR)).toBe('');
  });

  it('renders 4 nav tabs plus More; the active tab has aria-current="page"; counts are pills with a text equivalent', () => {
    const nav = model(locale, { toShip: 12, overdue: 3 });
    renderIntl(<MobileTabBar tabs={nav.tabs} />, locale);
    const bar = screen.getByRole('navigation', { name: m(locale, 'shell.mainNav') });
    expect(within(bar).getAllByRole('link')).toHaveLength(4);
    const orders = screen.getByTestId('mobile-tab-orders');
    expect(orders.getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('mobile-tab-home').getAttribute('aria-current')).toBeNull();
    const pill = within(orders).getByTestId('count-pill');
    expect(pill.textContent).toBe('12');
    expect(pill.getAttribute('data-tone')).toBe('danger');
    expect(orders.getAttribute('aria-label')).toContain(m(locale, 'nav.items.orders'));
    expect(orders.getAttribute('aria-label')).toMatch(/12/);
    expect(orders.getAttribute('aria-label')).toMatch(/3/);
    expect(screen.getByTestId('mobile-tab-more').textContent).toContain(m(locale, 'shell.mobile.more'));
  });

  it('a zero count renders nothing (never a "0" placeholder)', () => {
    renderIntl(<MobileTabBar tabs={model(locale, { toShip: 0 }).tabs} />, locale);
    expect(within(screen.getByTestId('mobile-tab-orders')).queryByTestId('count-pill')).toBeNull();
  });

  it('More toggles the shell store sheet and exposes aria-expanded', () => {
    renderIntl(<MobileTabBar tabs={model(locale).tabs} />, locale);
    const more = screen.getByTestId('mobile-tab-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(useShellStore.getState().moreOpen).toBe(true);
    expect(screen.getByTestId('mobile-tab-more').getAttribute('aria-expanded')).toBe('true');
  });

  it('a reconnect dot on More has a text equivalent', () => {
    const nav = model(locale, { reauth: ['etsy'] });
    expect(nav.moreDot).toBe('warning');
    renderIntl(<MobileTabBar tabs={nav.tabs} moreDot={nav.moreDot} />, locale);
    const more = screen.getByTestId('mobile-tab-more');
    expect(within(more).getByTestId('mobile-tab-more-dot').getAttribute('data-dot')).toBe('warning');
    expect(more.getAttribute('aria-label')).toContain(m(locale, 'shell.badge.settingsReconnect'));
  });

  it('unread dot on More only when the bell is parked in the sheet', () => {
    const { rerender } = renderIntl(<MobileTabBar tabs={model(locale).tabs} bellInMore notificationsUnread={4} />, locale);
    const more = screen.getByTestId('mobile-tab-more');
    expect(within(more).getByTestId('mobile-tab-more-dot').getAttribute('data-dot')).toBe('unread');
    expect(more.getAttribute('aria-label')).toContain(m(locale, 'shell.topbar.notificationsUnread', { count: 4 }));
    rerender(wrap(<MobileTabBar tabs={model(locale).tabs} bellInMore={false} notificationsUnread={4} />, locale));
    expect(within(screen.getByTestId('mobile-tab-more')).queryByTestId('mobile-tab-more-dot')).toBeNull();
  });
});

// ── MobileTopBar ────────────────────────────────────────────────────────────────────────────────────

function PageMeta({ meta }: { meta: PageShellMeta }) {
  const sink = usePageMetaSink();
  React.useLayoutEffect(() => {
    sink?.(meta);
  }, [sink, meta]);
  return null;
}

function TitleOnly({ title }: { title: string }) {
  usePageTitle(title);
  return null;
}

const bell = <button type="button" data-testid="bell-slot">{'bell'}</button>;

describe.each(LOCALES)('MobileTopBar (%s)', (locale) => {
  it('top-level page: title, search, bell; sets --kx-topbar-current to 48px while mounted', () => {
    const { unmount } = renderIntl(
      <ShellProvider documentTitle={false}>
        <TitleOnly title="Orders - KolayXport" />
        <MobileTopBar notifications={bell} />
      </ShellProvider>,
      locale,
    );
    expect(screen.getByTestId('mobile-topbar-title').textContent).toBe('Orders');
    expect(screen.getByTestId('mobile-topbar-title').tagName).toBe('DIV'); // shim title: legacy page keeps its own H1
    expect(screen.getByRole('button', { name: m(locale, 'shell.topbar.search') })).toBeTruthy();
    expect(screen.getByTestId('bell-slot')).toBeTruthy();
    expect(screen.queryByTestId('mobile-topbar-back')).toBeNull();
    expect(document.documentElement.style.getPropertyValue(TOPBAR_CURRENT_CSS_VAR)).toBe('48px');
    unmount();
    expect(document.documentElement.style.getPropertyValue(TOPBAR_CURRENT_CSS_VAR)).toBe('');
  });

  it('search opens the palette', () => {
    renderIntl(<ShellProvider documentTitle={false}><MobileTopBar fallbackTitle="Orders" /></ShellProvider>, locale);
    fireEvent.click(screen.getByTestId('mobile-topbar-search'));
    expect(useShellStore.getState().paletteOpen).toBe(true);
  });

  it('<Page> meta: h1 title, ≤1 mobileAction, ⋯ replaces the bell when the page has overflow actions', () => {
    const onNew = vi.fn();
    const meta: PageShellMeta = {
      title: 'Etsy listings',
      width: 'list',
      mobileAction: { id: 'new', label: 'New', onClick: onNew },
      mobileOverflow: [{ id: 'export', label: 'Export CSV' }],
      headerActions: [],
    };
    renderIntl(
      <ShellProvider documentTitle={false}>
        <PageMeta meta={meta} />
        <MobileTopBar notifications={bell} />
      </ShellProvider>,
      locale,
    );
    expect(screen.getByTestId('mobile-topbar-title').tagName).toBe('H1');
    fireEvent.click(screen.getByTestId('mobile-topbar-action'));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('bell-slot')).toBeNull();
    expect(screen.getByTestId('mobile-topbar-overflow').getAttribute('aria-label')).toBe(m(locale, 'ds.page.moreActions'));
  });

  it('drill-in route: back chevron to the parent, no search', () => {
    router.asPath = '/app/etsy-listings/42';
    renderIntl(<ShellProvider documentTitle={false}><MobileTopBar fallbackTitle="Blanket" notifications={bell} /></ShellProvider>, locale);
    const back = screen.getByTestId('mobile-topbar-back');
    expect(back.getAttribute('aria-label')).toBe(m(locale, 'shell.topbar.back'));
    expect(back.getAttribute('href')).toBe('/app/etsy-listings');
    expect(screen.queryByTestId('mobile-topbar-search')).toBeNull();
  });

  it('connected form: owns its pull hook, uses the shell bell and the active row as fallback title', () => {
    const nav = model(locale, { path: '/app/labels' });
    const mainRef = { current: document.createElement('main') };
    renderIntl(
      <ShellProvider documentTitle={false}>
        <MobileTopBarConnected ctx={{ model: nav, mainRef, mobileNotifications: bell }} />
      </ShellProvider>,
      locale,
    );
    const active = nav.groups.flatMap((g) => g.items).find((i) => i.active);
    expect(screen.getByTestId('mobile-topbar-title').textContent).toBe(active?.ariaLabel ?? '');
    expect(screen.getByTestId('bell-slot')).toBeTruthy();
  });

  it('pull indicator clips under the bar edge (overflow hidden)', () => {
    renderIntl(<PullToRefreshIndicator state={{ distance: 10, progress: 0.1, phase: 'pull', dragging: true }} />, locale);
    expect(getComputedStyle(screen.getByTestId('pull-indicator')).overflow).toBe('hidden');
  });

  it('pull indicator announces its phase', () => {
    renderIntl(<PullToRefreshIndicator state={{ distance: 90, progress: 1, phase: 'release', dragging: true }} />, locale);
    expect(screen.getByRole('status').textContent).toBe(m(locale, 'shell.pull.release'));
  });
});

// ── MoreSheet ───────────────────────────────────────────────────────────────────────────────────────

describe.each(LOCALES)('MoreSheet (%s)', (locale) => {
  it('renders the nav with real logos, badges with text equivalents, usage slot and account rows', () => {
    const nav = model(locale, { reauth: ['trendyol'] });
    useShellStore.setState({ moreOpen: true });
    renderIntl(<MoreSheet groups={nav.groups} tabs={nav.tabs} usage={<div data-testid="usage-slot" />} />, locale);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(m(locale, 'shell.mobile.menu'))).toBeTruthy();
    // tab-bar rows not repeated
    expect(within(sheet).queryByTestId('more-row-home')).toBeNull();
    expect(within(sheet).queryByTestId('more-row-orders')).toBeNull();
    // brand rows: label is the brand, aria is "Etsy listings"
    const etsy = within(sheet).getByTestId('more-row-listings-etsy');
    expect(etsy.textContent).toContain('Etsy');
    expect(etsy.getAttribute('aria-label')).toContain(m(locale, 'nav.items.listingsOf', { marketplace: 'Etsy' }));
    expect(within(etsy).getByTestId('more-row-listings-etsy-dot').getAttribute('data-dot')).toBe('attention');
    // reconnect: words instead of the dot, plus the text equivalent
    const trendyol = within(sheet).getByTestId('more-row-listings-trendyol');
    expect(within(trendyol).getByTestId('more-row-listings-trendyol-reconnect').textContent).toBe(m(locale, 'shell.badge.reconnectShort'));
    expect(trendyol.getAttribute('aria-label')).toContain(m(locale, 'shell.badge.reconnect', { marketplace: 'Trendyol' }));
    // settings warning dot
    expect(within(within(sheet).getByTestId('more-row-settings')).getByTestId('more-row-settings-dot')).toBeTruthy();
    expect(within(sheet).getByTestId('usage-slot')).toBeTruthy();
    expect(within(sheet).getByTestId('more-sheet-account').getAttribute('href')).toBe('/ayarlar');
    expect(within(sheet).getByText('Tamer Samsar')).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: LOCALE_ENDONYMS.en })).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: LOCALE_ENDONYMS.tr })).toBeTruthy();
  });

  it('the active row has aria-current="page"; tapping a row closes the sheet', () => {
    const nav = model(locale, { path: '/app/financials' });
    useShellStore.setState({ moreOpen: true });
    renderIntl(<MoreSheet groups={nav.groups} tabs={nav.tabs} />, locale);
    const finance = screen.getByTestId('more-row-finance');
    expect(finance.getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('more-row-help').getAttribute('aria-current')).toBeNull();
    fireEvent.click(finance);
    expect(useShellStore.getState().moreOpen).toBe(false);
  });

  it('the Notifications row pill carries the bell tone (danger on an unread error)', () => {
    const nav = model(locale);
    renderIntl(<MoreSheet open onClose={() => {}} groups={nav.groups} tabs={nav.tabs} notificationsFirst notificationsUnread={2} notificationsTone="danger" />, locale);
    const row = screen.getByTestId('more-row-notifications');
    expect(within(row).getByTestId('count-pill').getAttribute('data-tone')).toBe('danger');
  });

  it('notificationsFirst: Notifications is the first row with its unread count', () => {
    const nav = model(locale);
    renderIntl(<MoreSheet open onClose={() => {}} groups={nav.groups} tabs={nav.tabs} notificationsFirst notificationsUnread={5} />, locale);
    const rows = screen.getAllByTestId(/^more-row-[a-z-]+$/);
    expect(rows[0].getAttribute('data-testid')).toBe('more-row-notifications');
    expect(within(rows[0]).getByTestId('count-pill').textContent).toBe('5');
    expect(rows[0].getAttribute('aria-label')).toMatch(/5/);
  });

  it('language switch sets the locale; Sign out clears the nav cache and signs out', async () => {
    const nav = model(locale);
    useLocaleStore.setState({ locale: 'tr' });
    window.localStorage.setItem(NAV_CONN_CACHE_KEY, JSON.stringify({ uid: 'u1', flags: {} }));
    renderIntl(<MoreSheet open onClose={() => {}} groups={nav.groups} tabs={nav.tabs} />, locale);
    fireEvent.click(screen.getByRole('radio', { name: LOCALE_ENDONYMS.en }));
    expect(useLocaleStore.getState().locale).toBe('en');
    await act(async () => {
      fireEvent.click(screen.getByTestId('more-sheet-signout'));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(NAV_CONN_CACHE_KEY)).toBeNull();
  });

  it('no session: no account row', () => {
    authUser = null;
    const nav = model(locale);
    renderIntl(<MoreSheet open onClose={() => {}} groups={nav.groups} tabs={nav.tabs} />, locale);
    expect(screen.queryByTestId('more-sheet-account')).toBeNull();
    expect(screen.getByTestId('more-sheet-signout')).toBeTruthy();
  });
});

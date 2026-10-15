// @vitest-environment jsdom
// TopBar, Breadcrumbs, SearchTrigger, AccountMenu, NotificationsButton, AccountBanner, ShortcutSheet.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ asPath: '/', pathname: '/', push, events: { on() {}, off() {} } }) }));
vi.mock('@/components/live/LiveSoundToggle', () => ({
  default: () => <button type="button" data-testid="live-sound-toggle" aria-label="sound" />,
}));

type Item = { id: string; type: string; severity: 'info' | 'warning' | 'error'; titleKey: string; params: null; link: string | null; readAt: string | null; createdAt: string };
let notifState: { items: Item[]; unreadCount: number } = { items: [], unreadCount: 0 };
const markRead = vi.fn(async () => {});
const markAllRead = vi.fn(async () => {});
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ ...notifState, isLoading: false, error: undefined, markRead, markAllRead, refresh: async () => undefined }),
}));
vi.mock('@/components/notification-center/NotificationPanel', () => ({
  default: (p: { items: Item[]; onItemClick: (i: Item) => void }) => (
    <div data-testid="notification-panel">
      {p.items.map((i) => (
        <button key={i.id} type="button" data-testid={`notif-${i.id}`} onClick={() => p.onItemClick(i)}>
          {i.titleKey}
        </button>
      ))}
    </div>
  ),
}));

import { TopBar } from '@/components/ds/shell/TopBar';
import { Breadcrumbs } from '@/components/ds/shell/Breadcrumbs';
import { AccountBanner } from '@/components/ds/shell/AccountBanner';
import { ShortcutSheet } from '@/components/ds/shell/ShortcutSheet';
import { deriveShellUsage } from '@/components/ds/shell/SideNavFooter';
import { NAV_CONN_CACHE_KEY, mergeBreadcrumbs } from '@/lib/nav/useNavModel';
import useLocaleStore from '@/lib/stores/useLocaleStore';
import { useShortcuts, __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { renderShell, sampleModel } from './desktop-helpers';

const user = { name: 'Tamer Samsar', email: 'seller@example.com', image: null };

beforeEach(() => {
  notifState = { items: [], unreadCount: 0 };
  push.mockReset();
  markRead.mockClear();
  useLocaleStore.setState({ locale: 'en' });
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  __resetShortcutsForTests();
});

function renderTopBar(over: Partial<React.ComponentProps<typeof TopBar>> = {}, locale: 'en' | 'tr' = 'en') {
  const props = {
    breadcrumbs: sampleModel('/app/etsy-listings', locale).breadcrumbs,
    user,
    signedIn: true,
    onOpenPalette: vi.fn(),
    onShowShortcuts: vi.fn(),
    onSignOut: vi.fn(),
    ...over,
  };
  renderShell(<TopBar {...props} />, { locale });
  return props;
}

describe('TopBar', () => {
  it.each(['en', 'tr'] as const)('breadcrumbs, centred search trigger, live sound toggle, bell and avatar (%s)', (locale) => {
    const props = renderTopBar({}, locale);
    const crumbs = screen.getByRole('navigation', { name: locale === 'en' ? 'Breadcrumb' : 'Konum' });
    expect(crumbs.textContent).toContain(locale === 'en' ? 'Listings' : 'İlanlar');
    expect(crumbs.textContent).toContain('Etsy');
    expect(within(crumbs).getByText('Etsy').closest('[aria-current="page"]')).toBeTruthy();
    expect(crumbs.querySelector('[data-brand="etsy"]')).toBeTruthy();
    const search = screen.getByTestId('search-trigger');
    expect(search.getAttribute('aria-label')).toBe(locale === 'en' ? 'Search or jump to…' : 'Ara veya git…');
    fireEvent.click(search);
    expect(props.onOpenPalette).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('live-sound-toggle')).toBeTruthy();
    expect(screen.getByTestId('notifications-button')).toBeTruthy();
    expect(screen.getByTestId('account-menu')).toBeTruthy();
    // never the page title
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('signed out / loading: no bell, no sound toggle, avatar skeleton', () => {
    renderTopBar({ signedIn: false, user: null, breadcrumbs: [] });
    expect(screen.queryByTestId('live-sound-toggle')).toBeNull();
    expect(screen.queryByTestId('notifications-button')).toBeNull();
    expect(screen.getByTestId('account-menu-skeleton')).toBeTruthy();
  });
});

describe('Breadcrumbs', () => {
  it('appends page crumbs, collapses past 3 and shows a skeleton for a crumb still loading', () => {
    const nav = sampleModel('/app/etsy-listings/42').breadcrumbs;
    const items = mergeBreadcrumbs(nav, [{ label: 'BelleCoutureGifts', menu: [{ label: 'Other shop', href: '/app/etsy-listings?shop=2' }] }, { label: '' }]);
    renderShell(<Breadcrumbs items={items} />);
    const el = screen.getByTestId('breadcrumbs');
    expect(el.textContent).toContain('Listings');
    expect(el.textContent).toContain('…');
    expect(el.textContent).not.toContain('Etsy'); // the middle collapsed
    expect(el.textContent).toContain('BelleCoutureGifts');
  });

  it('a crumb with menu options opens a menu of links', () => {
    renderShell(<Breadcrumbs items={[{ label: 'Listings' }, { label: 'Shop A', current: true, menu: [{ label: 'Shop B', href: '/x?shop=b' }] }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Shop A/ }));
    expect(screen.getByRole('menuitem', { name: 'Shop B' }).getAttribute('href')).toBe('/x?shop=b');
  });
});

describe('AccountMenu', () => {
  it('lists account rows; language switch applies at once and keeps the menu open; Shopify-free reads "Plan"', () => {
    renderTopBar({ shopifyFree: true });
    fireEvent.click(screen.getByTestId('account-menu'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Tamer Samsar')).toBeTruthy();
    expect(within(menu).getByText('seller@example.com')).toBeTruthy();
    expect(screen.getByTestId('account-settings').getAttribute('href')).toBe('/ayarlar');
    expect(screen.getByTestId('account-billing').textContent).toBe('Plan');
    expect(screen.getByTestId('account-billing').getAttribute('href')).toBe('/ayarlar?tab=billing');
    expect(screen.getByTestId('account-help').getAttribute('href')).toBe('/app/nasil-kullanirim');
    const tr = screen.getByTestId('account-lang-tr');
    expect(tr.textContent).toBe('Türkçe');
    expect(screen.getByTestId('account-lang-en').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(tr);
    expect(useLocaleStore.getState().locale).toBe('tr');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('paid account reads "Plan & billing"; shortcuts row opens the sheet; sign out clears the nav cache first', () => {
    window.localStorage.setItem(NAV_CONN_CACHE_KEY, JSON.stringify({ uid: 'u1', flags: { etsy: true } }));
    const props = renderTopBar();
    fireEvent.click(screen.getByTestId('account-menu'));
    expect(screen.getByTestId('account-billing').textContent).toBe('Plan & billing');
    fireEvent.click(screen.getByTestId('account-shortcuts'));
    expect(props.onShowShortcuts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('account-menu'));
    fireEvent.click(screen.getByTestId('account-signout'));
    expect(window.localStorage.getItem(NAV_CONN_CACHE_KEY)).toBeNull();
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationsButton', () => {
  const item = (id: string, severity: Item['severity'], readAt: string | null = null): Item => ({
    id,
    type: 't',
    severity,
    titleKey: `title-${id}`,
    params: null,
    link: `/app/labels?n=${id}`,
    readAt,
    createdAt: '2026-10-15T10:00:00Z',
  });

  it('neutral unread pill and label; danger only for an unread error; opens the backend panel', () => {
    notifState = { items: [item('a', 'warning')], unreadCount: 3 };
    const { unmount } = renderShell(<TopBar breadcrumbs={[]} user={user} signedIn onOpenPalette={() => {}} onShowShortcuts={() => {}} onSignOut={() => {}} />);
    const btn = screen.getByTestId('notifications-button');
    expect(btn.getAttribute('aria-label')).toBe('Notifications (3 unread)');
    expect(screen.getByTestId('notifications-badge').getAttribute('data-tone')).toBe('neutral');
    expect(screen.getByTestId('notifications-badge').textContent).toBe('3');
    fireEvent.click(btn);
    expect(screen.getByTestId('notification-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('notif-a'));
    expect(markRead).toHaveBeenCalledWith(['a']);
    expect(push).toHaveBeenCalledWith('/app/labels?n=a');
    unmount();

    notifState = { items: [item('b', 'error')], unreadCount: 1 };
    renderShell(<TopBar breadcrumbs={[]} user={user} signedIn onOpenPalette={() => {}} onShowShortcuts={() => {}} onSignOut={() => {}} />);
    expect(screen.getByTestId('notifications-badge').getAttribute('data-tone')).toBe('danger');
  });

  it('no unread: plain label, no pill', () => {
    renderTopBar();
    expect(screen.getByTestId('notifications-button').getAttribute('aria-label')).toBe('Notifications');
    expect(screen.queryByTestId('notifications-badge')).toBeNull();
  });
});

describe('AccountBanner', () => {
  const base = { trialExpiresAt: null, usageResetAt: null, orderSyncCount: 0, labelCount: 0 } as const;
  it.each(['en', 'tr'] as const)('trial ended → danger banner with Choose a plan (%s)', (locale) => {
    const usage = deriveShellUsage({ ...base, subscriptionPlan: 'trial', subscriptionStatus: 'trialing', trialExpiresAt: '2020-01-01T00:00:00Z' });
    renderShell(<AccountBanner usage={usage} />, { locale });
    const b = screen.getByTestId('account-banner');
    expect(b.getAttribute('data-tone')).toBe('danger');
    expect(b.textContent).toContain(locale === 'en' ? 'Your trial has ended' : 'Deneme süreniz bitti');
    expect(within(b).getByRole('link', { name: locale === 'en' ? 'Choose a plan' : 'Plan seç' }).getAttribute('href')).toBe('/ayarlar?tab=billing');
    expect(screen.queryByTestId('banner-dismiss')).toBeNull();
  });

  it('limit reached → warning with the limit and kind', () => {
    const usage = deriveShellUsage({ ...base, subscriptionPlan: 'starter', subscriptionStatus: 'active', labelCount: 100, limits: { orderSync: 200, label: 100 } });
    renderShell(<AccountBanner usage={usage} />);
    const b = screen.getByTestId('account-banner');
    expect(b.getAttribute('data-tone')).toBe('warning');
    expect(b.textContent).toContain("You've used all 100 labels for this period.");
  });

  it('nothing for Shopify-free, an active plan under its limits, or unknown usage', () => {
    for (const usage of [
      deriveShellUsage({ ...base, subscriptionPlan: 'shopify_free', subscriptionStatus: null }),
      deriveShellUsage({ ...base, subscriptionPlan: 'growth', subscriptionStatus: 'active', limits: { orderSync: 2000, label: 500 } }),
      null,
      undefined,
    ]) {
      const { unmount } = renderShell(<AccountBanner usage={usage} />);
      expect(screen.queryByTestId('account-banner')).toBeNull();
      unmount();
    }
  });
});

describe('ShortcutSheet', () => {
  function PageKeys() {
    useShortcuts({ j: { handler: () => {}, description: 'Next order' } }, { scope: 'page', describe: true });
    return null;
  }
  it('lists the global rows then the page rows', async () => {
    renderShell(
      <>
        <PageKeys />
        <ShortcutSheet open onClose={() => {}} />
      </>,
    );
    await act(async () => {});
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Keyboard shortcuts')).toBeTruthy();
    for (const label of ['Search or jump', 'Go to a page (g, then a letter)', 'Collapse or expand the sidebar', 'Show shortcuts', 'Close or clear', 'Next order']) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
  });
});

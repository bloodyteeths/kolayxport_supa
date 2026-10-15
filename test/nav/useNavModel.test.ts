// shell-nav §13: useNavModel gating parity with the legacy AppLayout tri-state rules, plus listingsHref,
// mobile tabs, badges, breadcrumbs, g-map and palette destinations. Pure builder only (no React).
import { describe, expect, it } from 'vitest';
import {
  billingProviderFromSettings,
  buildNavModel,
  flagsFromConnections,
  mergeBreadcrumbs,
  providersUnlocked,
  type BuildNavModelInput,
  type NavCounts,
} from '@/lib/nav/useNavModel';
import { matchPath, normalizePath } from '@/lib/nav/navConfig';
import type { ConnectionsMap } from '@/lib/hooks/useConnections';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

const PROVIDERS = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo'] as const;

function conns(connected: string[], reauth: string[] = []): ConnectionsMap {
  const map = {} as ConnectionsMap;
  for (const p of PROVIDERS) {
    map[p] = { connected: connected.includes(p), accounts: [], needsReauth: reauth.includes(p) };
  }
  return map;
}

const build = (over: Partial<BuildNavModelInput>) =>
  buildNavModel({ t, path: '/app/labels', connections: null, billingProvider: null, ...over });

const ids = (m: ReturnType<typeof buildNavModel>) => m.groups.flatMap((g) => g.items.map((i) => i.id));

const ALWAYS = ['home', 'orders', 'research', 'finance', 'notifications', 'settings', 'help'];

describe('gating parity with legacy AppLayout (6 fixtures)', () => {
  it('1. unknown, no cache: every gated row is shown, no Connect CTA', () => {
    const m = build({ connections: null, cachedFlags: null });
    expect(ids(m)).toEqual([
      'home', 'orders', 'messages',
      'listings-etsy', 'listings-ebay', 'listings-trendyol', 'listings-wix', 'listings-shopify', 'stock-sync',
      'research', 'finance',
      'notifications', 'settings', 'help',
    ]);
    expect(m.showConnectCta).toBe(false);
    expect(m.hasReauth).toBe(false);
  });

  it('2. unknown, cache for this user: cached flags decide', () => {
    const m = build({ connections: null, cachedFlags: flagsFromConnections(conns(['etsy'])) });
    expect(ids(m)).toEqual(
      expect.arrayContaining(['listings-etsy', 'connect-store', ...ALWAYS]),
    );
    expect(ids(m)).not.toContain('listings-ebay');
    expect(ids(m)).not.toContain('messages');
    expect(ids(m)).not.toContain('stock-sync'); // 1 store only
  });

  it('3. cache from another user id is ignored by readNavConnCache → behaves as no cache', () => {
    // readNavConnCache(uid) returns null on a uid mismatch; the builder then sees no cache.
    const m = build({ connections: null, cachedFlags: null });
    expect(ids(m)).toContain('listings-shopify');
  });

  it('4. live: Etsy + eBay connected, the rest not', () => {
    const m = build({ connections: conns(['etsy', 'ebay']) });
    expect(ids(m)).toEqual([
      'home', 'orders',
      'listings-etsy', 'listings-ebay', 'stock-sync', 'connect-store',
      'research', 'finance',
      'notifications', 'settings', 'help',
    ]);
    expect(m.showConnectCta).toBe(true);
  });

  it('5. live: nothing connected: only Connect a store under Listings; Listings tab goes to connections', () => {
    const m = build({ connections: conns([]) });
    expect(m.groups.find((g) => g.id === 'listings')?.items.map((i) => i.id)).toEqual(['connect-store']);
    expect(m.listingsHref).toBe('/ayarlar?tab=connections');
    expect(m.goShortcuts.find((g) => g.key === 'l')).toBeUndefined();
  });

  it('6. live: every store connected: no Connect CTA, Messages shown', () => {
    const m = build({ connections: conns(['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada']) });
    expect(ids(m)).toContain('messages');
    expect(ids(m)).not.toContain('connect-store');
    expect(m.messagesEnabled).toBe(true);
  });

  it('providersUnlocked: any-of, unknown shows', () => {
    const known = (p: string) => ({ a: true, b: false }[p] as boolean | undefined);
    expect(providersUnlocked(['a', 'b'], known)).toBe(true);
    expect(providersUnlocked(['b'], known)).toBe(false);
    expect(providersUnlocked(['b', 'c'], known)).toBe(true);
  });

  it('stock sync row: shown with ≥ 2 stores, or when configured', () => {
    expect(ids(build({ connections: conns(['wix']) }))).not.toContain('stock-sync');
    expect(ids(build({ connections: conns(['wix']), stockSyncConfigured: true }))).toContain('stock-sync');
    expect(ids(build({ connections: conns(['wix', 'amazon']) }))).toContain('stock-sync');
  });

  it('stock sync stays a ⌘K destination for a one-store user (legacy: any store), never twice', () => {
    const one = build({ connections: conns(['etsy']) });
    expect(ids(one)).not.toContain('stock-sync');
    const dest = one.destinations.filter((d) => d.id === 'stock-sync');
    expect(dest).toHaveLength(1);
    expect(dest[0]).toMatchObject({ href: '/app/stok-senkron', label: 'nav.items.stockSync', section: 'nav.groups.listings' });
    const two = build({ connections: conns(['etsy', 'ebay']) });
    expect(two.destinations.filter((d) => d.id === 'stock-sync')).toHaveLength(1);
    expect(build({ connections: conns([]) }).destinations.some((d) => d.id === 'stock-sync')).toBe(false);
    expect(build({ connections: conns(['etsy']), path: '/app/stok-senkron' }).breadcrumbs.at(-1)).toMatchObject({
      label: 'nav.items.stockSync',
      current: true,
    });
  });
});

describe('labels, icons and brands', () => {
  it('brand rows use the proper noun and listingsOf for aria/tooltip', () => {
    const m = build({ connections: conns(['etsy']) });
    const etsy = m.groups.flatMap((g) => g.items).find((i) => i.id === 'listings-etsy')!;
    expect(etsy.label).toBe('Etsy');
    expect(etsy.ariaLabel).toBe('nav.items.listingsOf(marketplace=Etsy)');
    expect(etsy.brand).toBe('etsy');
    expect(etsy.icon).toBeUndefined();
  });

  it('Home points at the analytics page (founder decision) and no Overview/Reports row exists yet', () => {
    const m = build({});
    const home = m.groups[0].items[0];
    expect(home.id).toBe('home');
    expect(home.href).toBe('/app/analytics');
    expect(ids(m)).not.toContain('reports');
  });
});

describe('active row and breadcrumbs', () => {
  it.each([
    ['/app', 'home'],
    ['/app/analytics', 'home'],
    ['/app/labels?view=to_ship', 'orders'],
    ['/app/print/batch', 'orders'],
    ['/app/etsy-listings/123', 'listings-etsy'],
    ['/app/etsy-listings/bulk?ids=1,2', 'listings-etsy'],
    ['/app/etsy-aktivite', 'listings-etsy'],
    ['/app/ebay-research', 'research'],
    ['/app/amazon-research', 'research'],
    ['/faturalar', 'settings'],
    ['/ayarlar?tab=billing', 'settings'],
    ['/app/entegrasyonlar-ve-rehberler', 'help'],
    ['/app/bildirimler?tab=preferences', 'notifications'],
    ['/app/stok-senkron', 'stock-sync'],
  ])('%s → %s', (path, id) => {
    const m = build({ path, connections: null });
    expect(m.activeId).toBe(id);
    const active = m.groups.flatMap((g) => g.items).filter((i) => i.active);
    expect(active.map((i) => i.id)).toEqual([id]);
  });

  it('Connect a store is never active', () => {
    const m = build({ path: '/ayarlar', connections: conns([]) });
    expect(m.groups.flatMap((g) => g.items).find((i) => i.id === 'connect-store')?.active).toBe(false);
  });

  it('breadcrumbs: Orders; Listings › Etsy; Listings › Etsy › Activity; Settings › Invoices', () => {
    expect(build({ path: '/app/labels' }).breadcrumbs.map((c) => c.label)).toEqual(['nav.items.orders']);
    const etsy = build({ path: '/app/etsy-listings' }).breadcrumbs;
    expect(etsy.map((c) => c.label)).toEqual(['nav.groups.listings', 'Etsy']);
    expect(etsy[1]).toMatchObject({ brand: 'etsy', href: '/app/etsy-listings', current: true });
    expect(build({ path: '/app/etsy-aktivite' }).breadcrumbs.map((c) => c.label)).toEqual([
      'nav.groups.listings', 'Etsy', 'nav.items.activity',
    ]);
    expect(build({ path: '/faturalar' }).breadcrumbs.map((c) => c.label)).toEqual(['nav.items.settings', 'nav.items.invoices']);
    expect(build({ path: '/unknown' }).breadcrumbs).toEqual([]);
  });

  it('mergeBreadcrumbs appends page crumbs and moves `current` to the last one', () => {
    const nav = build({ path: '/app/etsy-listings/1' }).breadcrumbs;
    const merged = mergeBreadcrumbs(nav, [{ label: 'Personalized Baby Blanket' }]);
    expect(merged.map((c) => c.label)).toEqual(['nav.groups.listings', 'Etsy', 'Personalized Baby Blanket']);
    expect(merged.map((c) => Boolean(c.current))).toEqual([false, false, true]);
  });
});

describe('badges (counts, dots)', () => {
  const counts: NavCounts = { orders: { toShip: 12, overdue: 3 }, drafts: { etsy: 7, ebay: 0 }, generatedAt: '2026-10-15T11:59:00Z' };

  it('orders count turns danger when overdue; drafts give an attention dot', () => {
    const m = build({ connections: conns(['etsy', 'ebay']), counts });
    const flat = m.groups.flatMap((g) => g.items);
    const orders = flat.find((i) => i.id === 'orders')!;
    expect(orders).toMatchObject({ count: 12, countTone: 'danger' });
    expect(orders.countLabel).toContain('shell.badge.overdue(count=3)');
    expect(flat.find((i) => i.id === 'listings-etsy')).toMatchObject({ dot: 'attention', dotLabel: 'shell.badge.unsent(count=7)' });
    expect(flat.find((i) => i.id === 'listings-ebay')?.dot).toBeUndefined();
    expect(m.tabs[1]).toMatchObject({ id: 'orders', count: 12, countTone: 'danger' });
  });

  it('zero and missing counts render nothing (stale data arrives as undefined from useNavCounts)', () => {
    const zero = build({ counts: { ...counts, orders: { toShip: 0, overdue: 0 } } });
    expect(zero.groups[0].items.find((i) => i.id === 'orders')?.count).toBeUndefined();
    expect(build({ counts: null }).groups[0].items.find((i) => i.id === 'orders')?.count).toBeUndefined();
    expect(build({ counts: undefined }).groups[0].items.find((i) => i.id === 'orders')?.count).toBeUndefined();
  });

  it('reconnect: warning dot on the row (beats attention), on Settings and on the More tab', () => {
    const m = build({ connections: conns(['etsy'], ['etsy']), counts });
    const flat = m.groups.flatMap((g) => g.items);
    expect(flat.find((i) => i.id === 'listings-etsy')).toMatchObject({ dot: 'warning', dotLabel: 'shell.badge.reconnect(marketplace=Etsy)' });
    expect(flat.find((i) => i.id === 'settings')).toMatchObject({ dot: 'warning', dotLabel: 'shell.badge.settingsReconnect' });
    expect(m.moreDot).toBe('warning');
  });

  it('no reconnect dot is invented from cache or unknown state', () => {
    const m = build({ connections: null, cachedFlags: { etsy: true } });
    expect(m.groups.flatMap((g) => g.items).some((i) => i.dot === 'warning')).toBe(false);
    expect(m.moreDot).toBeUndefined();
  });

  it('messages unread count', () => {
    const m = build({ connections: conns(['wix']), messagesUnread: 4 });
    expect(m.groups[0].items.find((i) => i.id === 'messages')).toMatchObject({ count: 4, countLabel: 'shell.badge.unread(count=4)' });
  });
});

describe('listingsHref and mobile tabs', () => {
  it('listingsHref: first known-connected row, else first visible row', () => {
    expect(build({ connections: conns(['wix', 'shopify']) }).listingsHref).toBe('/app/wix-urunler');
    expect(build({ connections: null }).listingsHref).toBe('/app/etsy-listings');
    expect(build({ connections: null, cachedFlags: { etsy: false, ebay: true } }).listingsHref).toBe('/app/ebay-listings');
  });

  it('tab 4 is Messages, or Research when Wix and Trendyol are both known not connected', () => {
    expect(build({ connections: null }).tabs.map((x) => x.id)).toEqual(['home', 'orders', 'listings', 'messages']);
    expect(build({ connections: conns(['etsy']) }).tabs.map((x) => x.id)).toEqual(['home', 'orders', 'listings', 'research']);
  });

  it('the Listings tab is active on any listings-group route', () => {
    expect(build({ path: '/app/etsy-aktivite' }).tabs[2].active).toBe(true);
    expect(build({ path: '/app/stok-senkron' }).tabs[2].active).toBe(true);
    expect(build({ path: '/app/labels' }).tabs[2].active).toBe(false);
  });
});

describe('g-shortcuts and palette destinations', () => {
  it('g map: h o l m r f s, unique, only visible destinations', () => {
    const m = build({ connections: conns(['etsy', 'wix']) });
    const keys = m.goShortcuts.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.fromEntries(m.goShortcuts.map((g) => [g.key, g.href]))).toEqual({
      h: '/app/analytics',
      o: '/app/labels',
      m: '/app/mesajlar',
      r: '/app/research',
      f: '/app/financials',
      s: '/ayarlar',
      l: '/app/etsy-listings',
    });
    expect(build({ connections: conns(['etsy']) }).goShortcuts.some((g) => g.key === 'm')).toBe(false);
  });

  it('Etsy activity, Invoices and Guides are palette destinations, not rows', () => {
    const m = build({ connections: conns(['etsy']), billingProvider: 'stripe' });
    const dest = m.destinations.map((d) => d.id);
    expect(dest).toEqual(expect.arrayContaining(['etsy-activity', 'invoices', 'guides']));
    expect(ids(m)).not.toEqual(expect.arrayContaining(['etsy-activity']));
    expect(m.destinations.find((d) => d.id === 'listings-etsy')?.label).toBe('nav.items.listingsOf(marketplace=Etsy)');
  });

  it('Shopify-free accounts never see Invoices (and neither does an unknown billing provider)', () => {
    expect(build({ billingProvider: 'shopify_free' }).destinations.some((d) => d.id === 'invoices')).toBe(false);
    expect(build({ billingProvider: undefined }).destinations.some((d) => d.id === 'invoices')).toBe(false);
    expect(build({ billingProvider: null }).destinations.some((d) => d.id === 'invoices')).toBe(true);
  });

  it('billingProviderFromSettings: loaded settings without a subscription map to null (Invoices shown)', () => {
    expect(billingProviderFromSettings(undefined)).toBeUndefined();
    expect(billingProviderFromSettings(null)).toBeUndefined();
    expect(billingProviderFromSettings({})).toBeNull();
    expect(billingProviderFromSettings({ subscription: null })).toBeNull();
    expect(billingProviderFromSettings({ subscription: {} })).toBeNull();
    expect(billingProviderFromSettings({ subscription: { billingProvider: 'stripe' } })).toBe('stripe');
    expect(billingProviderFromSettings({ subscription: { billingProvider: 'shopify_free' } })).toBe('shopify_free');
    const loadedNoSub = build({ billingProvider: billingProviderFromSettings({}) });
    expect(loadedNoSub.destinations.some((d) => d.id === 'invoices')).toBe(true);
  });

  it('Etsy activity is hidden when Etsy is known not connected', () => {
    expect(build({ connections: conns(['wix']) }).destinations.some((d) => d.id === 'etsy-activity')).toBe(false);
  });
});

describe('path matching', () => {
  it('exact, sub-path and prefix patterns', () => {
    expect(matchPath('/app', '/app')).toBe(true);
    expect(matchPath('/app', '/app/labels')).toBe(false);
    expect(matchPath('/app/x/*', '/app/x')).toBe(false);
    expect(matchPath('/app/x/*', '/app/x/1')).toBe(true);
    expect(matchPath('/app/x*', '/app/xy')).toBe(true);
    expect(normalizePath('/ayarlar/?tab=billing#a')).toBe('/ayarlar');
  });
});

describe('reports flag (M9: Home is the Reports overview)', () => {
  it('flag off: the legacy Finance row stays and Reports tabs are not destinations', () => {
    const m = build({ path: '/app/analytics' });
    expect(ids(m)).toContain('finance');
    expect(m.destinations.map((d) => d.id)).not.toContain('reports-profit');
  });

  it('flag on: no Finance row, no Reports row, `g f` gone, Home active on every Reports tab', () => {
    for (const path of ['/app/analytics', '/app/reports', '/app/reports/profit', '/app/reports/payouts?mp=ebay', '/app/reports/transactions']) {
      const m = build({ path, reportsV2: true });
      expect(ids(m)).not.toContain('finance');
      expect(ids(m)).not.toContain('reports');
      expect(m.activeId, path).toBe('home');
      expect(m.tabs.find((x) => x.id === 'home')?.active, path).toBe(true);
      expect(m.goShortcuts.map((g) => g.key)).not.toContain('f');
    }
  });

  it('flag on: Profit/Payouts/Transactions are ⌘K destinations and crumbs under Home (hidden for shopify_free)', () => {
    const m = build({ path: '/app/reports/profit', reportsV2: true, billingProvider: 'stripe' });
    const dest = m.destinations.filter((d) => d.id.startsWith('reports-'));
    expect(dest.map((d) => [d.id, d.href, d.label])).toEqual([
      ['reports-profit', '/app/reports/profit', 'nav.items.reportsProfit'],
      ['reports-payouts', '/app/reports/payouts', 'nav.items.reportsPayouts'],
      ['reports-transactions', '/app/reports/transactions', 'nav.items.reportsTransactions'],
    ]);
    expect(m.breadcrumbs.map((c) => c.label)).toEqual(['nav.items.home', 'reports.tabs.profit']);
    const free = build({ path: '/app/reports', reportsV2: true, billingProvider: 'shopify_free' });
    expect(free.destinations.some((d) => d.id.startsWith('reports-'))).toBe(false);
  });
});

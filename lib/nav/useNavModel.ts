// lib/nav/useNavModel.ts — the resolved navigation model (shell-nav §2, §5 "Nav gating", §7, §8).
//
// `buildNavModel(input)` is pure (unit-tested); `useNavModel(options)` feeds it from the app:
// connections (`useConnections`, tri-state), the per-user cached flags (`kx.nav.connections.v1`), the route,
// translations, and the messages unread count. Orders/draft counts come from group B's `useNavCounts()` and
// are passed in by the caller, so this module has no fetch of its own besides the shared connections SWR key.
//
// Gating keeps the legacy AppLayout tri-state rules (AppLayout.js:62–101, 224–237), with one spec change:
// the Stock sync row needs ≥ 2 stores (or `stockSyncConfigured`), per BUILD_PLAN §7 item 6, where legacy
// showed it for any store. While hidden for that reason it stays a ⌘K destination (any store), so it is
// never unreachable. The tri-state rule:
//   known true  → show; known false → hide; unknown (loading / errored with no data) → cached flag for this
//   user id, and **show** when there is no cache (never hide a connected user's features on a slow load).
// Dots are never invented from unknown state (P6): reconnect dots read only live `connections`.
import * as React from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useConnections, type ConnectionsMap } from '@/lib/hooks/useConnections';
import useMessageCountStore from '@/lib/stores/useMessageCountStore';
import { icons, type IconKey, type LucideIcon } from '@/lib/ds/icons';
import { LOGOS } from '@/lib/ds/logos';
import type { MarketplaceKey } from '@/components/ds/data/types';
import type { PageBreadcrumb } from '@/components/ds/page/types';
import {
  CONNECTIONS_HREF,
  G_LISTINGS_KEY,
  NAV_CONFIG,
  NAV_EXTRA_DESTINATIONS,
  REPORTS_EXTRA_DESTINATIONS,
  RESEARCH_HOME,
  STORE_PROVIDERS,
  matchPath,
  matchScore,
  normalizePath,
  type NavExtraDestination,
  type NavGroupConfig,
  type NavGroupId,
  type NavItemConfig,
  type NavItemId,
  type NavRequires,
} from './navConfig';

// ── Types ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `GET /api/nav/counts` (shell-nav §9.1). Structurally identical to `NavCountsResponse` in group B's
 * `lib/nav/useNavCounts.ts`, which also hides loading / error / stale (> 10 min, client clock) data by
 * returning `undefined`; this module renders whatever it is given and nothing for 0.
 */
export type NavCounts = {
  orders: { toShip: number; overdue: number };
  drafts: { etsy: number; ebay: number };
  generatedAt?: string;
};

export type NavDot = 'warning' | 'danger' | 'attention';

/** A resolved, renderable row (DS §4.2 `NavItem` + shell-nav §14 additions). Labels are translated. */
export type NavItem = {
  id: NavItemId;
  href: string;
  /** Visible label (brand rows: the proper noun, e.g. "Etsy"). */
  label: string;
  /** Tooltip / aria-label / palette label (brand rows: "Etsy listings"). Equals `label` otherwise. */
  ariaLabel: string;
  /** Registry key and component; absent on brand rows. */
  iconKey?: IconKey;
  icon?: LucideIcon;
  /** Marketplace mark: render `<LogoTile brand={brand} size={16} />`. */
  brand?: MarketplaceKey;
  /** Right-aligned tabular count; absent when 0, unknown or stale (never a "0" placeholder). */
  count?: number;
  countTone?: 'neutral' | 'danger';
  /** Text equivalent of the count for screen readers / tooltip ("12 to ship · 3 overdue"). */
  countLabel?: string;
  dot?: NavDot;
  /** Text equivalent of the dot (shell-nav §13: a reconnect dot has a text equivalent). */
  dotLabel?: string;
  /** Second key of the `g` chord, shown in the rail tooltip as `g o`. */
  gKey?: string;
  match: readonly string[];
  listingRow: boolean;
  active: boolean;
};

export type NavGroup = {
  id: NavGroupId;
  /** Translated sentence-case label, absent for unlabeled groups. */
  label?: string;
  bottom: boolean;
  items: NavItem[];
};

export type NavCrumb = PageBreadcrumb & {
  /** Marketplace mark before the label (`Listings › [E] Etsy`). */
  brand?: MarketplaceKey;
  /** Last crumb of the nav trail (the current destination). */
  current?: boolean;
};

/** ⌘K "Go to" entry (group E) and More sheet extras. */
export type NavDestination = {
  id: NavItemId | NavExtraDestination['id'] | 'listings';
  href: string;
  label: string;
  /** Group label for the palette section (e.g. "Listings"), if any. */
  section?: string;
  iconKey?: IconKey;
  icon?: LucideIcon;
  brand?: MarketplaceKey;
  /** `g` chord second key, if any. */
  gKey?: string;
  /** Search keywords (route words, brand name). */
  keywords: string[];
};

export type GoShortcut = { key: string; href: string; label: string };

export type MobileTab = {
  id: 'home' | 'orders' | 'listings' | 'messages' | 'research';
  href: string;
  label: string;
  iconKey: IconKey;
  icon: LucideIcon;
  active: boolean;
  count?: number;
  countTone?: 'neutral' | 'danger';
  countLabel?: string;
};

export type NavModel = {
  /** Visible groups in render order (top groups first, then `bottom` groups). Empty groups are dropped. */
  groups: NavGroup[];
  topGroups: NavGroup[];
  bottomGroups: NavGroup[];
  /** Id of the active row (most specific `match`; extras resolve to their parent row). */
  activeId: NavItemId | null;
  /** First visible listing row known connected, else the first visible listing row, else Connections. */
  listingsHref: string;
  /** True when the current route is any listings-group route (incl. Etsy activity, Stock sync). */
  listingsActive: boolean;
  /** Connections tri-state resolved per provider (live, else cached, else undefined). */
  known: Partial<Record<MarketplaceKey | 'veeqo' | 'shippo', boolean | undefined>>;
  showConnectCta: boolean;
  /** Messages row is visible (Wix or Trendyol connected or unknown). */
  messagesAvailable: boolean;
  /** Wix or Trendyol is known connected: poll message counts (legacy rule, AppLayout.js:285–304). */
  messagesEnabled: boolean;
  /** Any connected provider needs reauth (live data only). */
  hasReauth: boolean;
  /** Mobile tab bar slots 1–4 (slot 5 "More" is chrome, see `moreDot`). shell-nav §2.2. */
  tabs: MobileTab[];
  /** Warning dot on the More tab when anything in the sheet needs attention (reconnect). */
  moreDot?: 'warning';
  /** Breadcrumb trail for the route, from navConfig (group label › item label [› extra]). */
  breadcrumbs: NavCrumb[];
  /** `g` chord map (shell-nav §7): h, o, l, m, r, p, f, s, only for visible destinations. */
  goShortcuts: GoShortcut[];
  /** ⌘K "Go to" destinations: every visible row plus visible extras (Etsy activity, Invoices, Guides). */
  destinations: NavDestination[];
};

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type BuildNavModelInput = {
  t: Translate;
  /** `router.asPath` (query/hash are stripped). */
  path: string;
  /** Live connections (`useConnections().connections`), null while unknown. */
  connections: ConnectionsMap | null;
  /** Cached flags for this user (`readNavConnCache(uid)`), used only while `connections` is null. */
  cachedFlags?: Record<string, boolean> | null;
  counts?: NavCounts | null;
  /** Wix + Trendyol unread total. */
  messagesUnread?: number | null;
  /**
   * `subscription.billingProvider`; `undefined` = not known yet (Invoices stays hidden until known), `null` =
   * known, no provider. Derive it with `billingProviderFromSettings` so a loaded settings payload without a
   * subscription maps to `null` (Invoices shown) instead of a permanent `undefined`.
   */
  billingProvider?: string | null;
  /** Stock sync has been configured (shows the row even with < 2 stores). */
  stockSyncConfigured?: boolean;
};

/**
 * `billingProvider` for the nav from the `/api/user/settings` payload (`useSettings().settingsData`):
 * `undefined` while settings are not loaded, `null` when loaded without a provider, else the provider.
 * AppShell must use this rather than `settingsData?.subscription?.billingProvider`, which stays `undefined`
 * for a loaded payload with no subscription object and would hide Invoices for every Stripe user.
 */
export function billingProviderFromSettings(
  settingsData: { subscription?: { billingProvider?: string | null } | null } | null | undefined,
): string | null | undefined {
  if (!settingsData) return undefined;
  return settingsData.subscription?.billingProvider ?? null;
}

// ── Cache (kx.nav.connections.v1, tagged with the user id) ──────────────────────────────────────────

export const NAV_CONN_CACHE_KEY = 'kx.nav.connections.v1';

export function readNavConnCache(uid: string | null | undefined): Record<string, boolean> | null {
  if (!uid) return null;
  try {
    const raw = window.localStorage.getItem(NAV_CONN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.uid !== uid) return null;
    const flags = parsed.flags;
    return flags && typeof flags === 'object' && !Array.isArray(flags) ? (flags as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

export function writeNavConnCache(uid: string | null | undefined, flags: Record<string, boolean>): void {
  if (!uid) return;
  try {
    window.localStorage.setItem(NAV_CONN_CACHE_KEY, JSON.stringify({ uid, flags }));
  } catch {
    // storage blocked: the nav falls back to "show while unknown"
  }
}

/** Connected flags from a live map (what the cache stores). */
export function flagsFromConnections(connections: ConnectionsMap): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const p of Object.keys(connections)) flags[p] = Boolean(connections[p as keyof ConnectionsMap]?.connected);
  return flags;
}

// ── Pure builder ──────────────────────────────────────────────────────────────────────────────────────

type Known = (provider: string) => boolean | undefined;

function knownFn(connections: ConnectionsMap | null, cached: Record<string, boolean> | null | undefined): Known {
  return (provider) => {
    if (connections) return Boolean((connections as Record<string, { connected?: boolean } | undefined>)[provider]?.connected);
    if (cached && typeof cached[provider] === 'boolean') return cached[provider];
    return undefined;
  };
}

/** Legacy `isUnlocked`: any-of, unknown → show. */
export function providersUnlocked(providers: readonly string[], known: Known): boolean {
  const states = providers.map(known);
  if (states.some((v) => v === true)) return true;
  if (states.every((v) => v === false)) return false;
  return true;
}

function isVisible(req: NavRequires | undefined, known: Known, ctx: { showConnectCta: boolean; stockSyncConfigured: boolean }) {
  if (!req) return true;
  if (req.kind === 'providers') {
    if (req.knownOnly) return req.providers.some((p) => known(p) === true);
    return providersUnlocked(req.providers, known);
  }
  if (req.kind === 'connectCta') return ctx.showConnectCta;
  // stockSync: ≥ 2 stores connected (unknown counts as maybe), or configured.
  if (ctx.stockSyncConfigured) return true;
  const states = STORE_PROVIDERS.map(known);
  const maybe = states.filter((v) => v !== false).length;
  return maybe >= 2;
}

function itemLabel(cfg: Pick<NavItemConfig, 'brand' | 'labelKey'>, t: Translate): { label: string; ariaLabel: string } {
  if (cfg.brand) {
    const name = LOGOS[cfg.brand as keyof typeof LOGOS]?.name ?? cfg.brand;
    return { label: name, ariaLabel: t('nav.items.listingsOf', { marketplace: name }) };
  }
  const label = cfg.labelKey ? t(cfg.labelKey) : '';
  return { label, ariaLabel: label };
}

function bestMatch<T extends { match: readonly string[] }>(entries: readonly T[], path: string): { entry: T; score: number } | null {
  let best: { entry: T; score: number } | null = null;
  for (const entry of entries) {
    for (const pattern of entry.match) {
      if (!matchPath(pattern, path)) continue;
      const score = matchScore(pattern);
      if (!best || score > best.score) best = { entry, score };
    }
  }
  return best;
}

export function buildNavModel(input: BuildNavModelInput): NavModel {
  const { t, connections } = input;
  const path = normalizePath(input.path);
  const navConfig = NAV_CONFIG;
  const extras: readonly NavExtraDestination[] = [...NAV_EXTRA_DESTINATIONS, ...REPORTS_EXTRA_DESTINATIONS];
  const known = knownFn(connections, input.cachedFlags);

  const storeStates = STORE_PROVIDERS.map(known);
  const showConnectCta = storeStates.every((v) => v !== undefined) && storeStates.some((v) => v === false);
  const ctx = { showConnectCta, stockSyncConfigured: Boolean(input.stockSyncConfigured) };

  // Reauth from live data only (P6: never invented from cache or unknown).
  const reauth = new Set<string>();
  if (connections) {
    for (const [p, entry] of Object.entries(connections)) {
      if (entry?.connected && entry?.needsReauth) reauth.add(p);
    }
  }
  const hasReauth = reauth.size > 0;

  const counts = input.counts ?? null;

  // Active row: most specific match over rows and extras (extras resolve to their parent).
  const visibleExtras = extras.filter((x) => {
    // Unknown provider (undefined) hides it too, so a Shopify-free account never sees it flash in.
    if (x.hideForShopifyFree && (input.billingProvider === undefined || input.billingProvider === 'shopify_free')) {
      return false;
    }
    return isVisible(x.requires, known, ctx);
  });
  const allRows = navConfig.flatMap((g) => g.items.filter((i) => !i.neverActive));
  const rowHit = bestMatch(allRows, path);
  const extraHit = bestMatch(extras, path);
  let activeId: NavItemId | null = null;
  let activeExtra: NavExtraDestination | null = null;
  if (extraHit && (!rowHit || extraHit.score > rowHit.score)) {
    activeExtra = extraHit.entry;
    activeId = extraHit.entry.parentId;
  } else if (rowHit) {
    activeId = rowHit.entry.id;
  }

  const resolveItem = (cfg: NavItemConfig): NavItem => {
    const { label, ariaLabel } = itemLabel(cfg, t);
    const item: NavItem = {
      id: cfg.id,
      href: cfg.href,
      label,
      ariaLabel,
      iconKey: cfg.icon,
      icon: cfg.icon ? icons[cfg.icon] : undefined,
      brand: cfg.brand,
      gKey: cfg.gKey,
      match: cfg.match,
      listingRow: Boolean(cfg.listingRow),
      active: !cfg.neverActive && activeId === cfg.id,
    };
    applyBadge(item, cfg, { t, counts, messagesUnread: input.messagesUnread, reauth, hasReauth });
    return item;
  };

  const groups: NavGroup[] = [];
  for (const g of navConfig as readonly NavGroupConfig[]) {
    const items = g.items.filter((i) => isVisible(i.requires, known, ctx)).map(resolveItem);
    if (items.length === 0) continue;
    groups.push({ id: g.id, label: g.labelKey ? t(g.labelKey) : undefined, bottom: Boolean(g.bottom), items });
  }
  const topGroups = groups.filter((g) => !g.bottom);
  const bottomGroups = groups.filter((g) => g.bottom);
  const ordered = [...topGroups, ...bottomGroups];
  const flat = ordered.flatMap((g) => g.items);
  const byId = new Map(flat.map((i) => [i.id, i]));

  // Listings target (legacy AppLayout.js:259–265).
  const listingRows = flat.filter((i) => i.listingRow);
  const firstKnownConnected = listingRows.find((i) => i.brand && known(i.brand) === true);
  const listingsHref = (firstKnownConnected ?? listingRows[0])?.href ?? CONNECTIONS_HREF;
  const listingsGroupIds = new Set(navConfig.find((g) => g.id === 'listings')?.items.map((i) => i.id) ?? []);
  const listingsActive = activeId !== null && listingsGroupIds.has(activeId);

  const messagesAvailable = byId.has('messages');
  const messagesEnabled = known('wix') === true || known('trendyol') === true;

  // Mobile tabs (shell-nav §2.2). Slot 4: Messages, or Research when Wix and Trendyol are both known off.
  const tab = (id: MobileTab['id'], href: string, labelKey: string, iconKey: IconKey, active: boolean, src?: NavItem): MobileTab => ({
    id,
    href,
    label: t(labelKey),
    iconKey,
    icon: icons[iconKey],
    active,
    ...(src?.count ? { count: src.count, countTone: src.countTone, countLabel: src.countLabel } : {}),
  });
  const home = byId.get('home');
  const orders = byId.get('orders');
  const messages = byId.get('messages');
  const research = byId.get('research');
  const wixTrendyolOff = known('wix') === false && known('trendyol') === false;
  const tabs: MobileTab[] = [
    tab('home', home?.href ?? '/app/analytics', 'nav.items.home', 'overview', activeId === 'home'),
    tab('orders', orders?.href ?? '/app/labels', 'nav.items.orders', 'order', activeId === 'orders', orders),
    tab('listings', listingsHref, 'nav.groups.listings', 'listing', listingsActive),
    !wixTrendyolOff && messages
      ? tab('messages', messages.href, 'nav.items.messages', 'message', activeId === 'messages', messages)
      : tab('research', research?.href ?? RESEARCH_HOME, 'nav.items.research', 'research', activeId === 'research'),
  ];

  // Breadcrumbs (shell-nav §2.3).
  const breadcrumbs: NavCrumb[] = [];
  if (activeId) {
    const groupCfg = navConfig.find((g) => g.items.some((i) => i.id === activeId));
    const rowCfg = groupCfg?.items.find((i) => i.id === activeId);
    if (groupCfg?.labelKey) breadcrumbs.push({ label: t(groupCfg.labelKey) });
    if (rowCfg) {
      const { label } = itemLabel(rowCfg, t);
      breadcrumbs.push({ label, href: rowCfg.href, ...(rowCfg.brand ? { brand: rowCfg.brand } : {}) });
    }
    if (activeExtra) breadcrumbs.push({ label: t(activeExtra.crumbKey ?? activeExtra.labelKey), href: activeExtra.href });
    if (breadcrumbs.length) breadcrumbs[breadcrumbs.length - 1].current = true;
  }

  // `g` chord map.
  const goShortcuts: GoShortcut[] = [];
  for (const i of flat) if (i.gKey) goShortcuts.push({ key: i.gKey, href: i.href, label: i.ariaLabel });
  if (listingRows.length) {
    goShortcuts.push({ key: G_LISTINGS_KEY, href: listingsHref, label: t('nav.groups.listings') });
  }

  // ⌘K destinations.
  const groupLabelOf = new Map<NavItemId, string | undefined>();
  for (const g of ordered) for (const i of g.items) groupLabelOf.set(i.id, g.label);
  const destinations: NavDestination[] = flat.map((i) => ({
    id: i.id,
    href: i.href,
    label: i.ariaLabel,
    section: groupLabelOf.get(i.id),
    iconKey: i.iconKey,
    icon: i.icon,
    brand: i.brand,
    gKey: i.gKey,
    keywords: keywordsFor(i.href, i.brand ? [i.label] : []),
  }));
  // Stock sync stays reachable from ⌘K while its row is hidden (< 2 stores and no `stockSyncConfigured`
  // source yet): legacy AppLayout showed it for any connected store, and a one-store user may already use
  // Etsy-managed stock. Gated like the legacy row (any store, unknown shows).
  if (!byId.has('stock-sync') && providersUnlocked(STORE_PROVIDERS, known)) {
    const cfg = navConfig.flatMap((g) => g.items).find((i) => i.id === 'stock-sync');
    if (cfg) {
      const { label } = itemLabel(cfg, t);
      destinations.push({
        id: cfg.id,
        href: cfg.href,
        label,
        section: t('nav.groups.listings'),
        iconKey: cfg.icon,
        icon: cfg.icon ? icons[cfg.icon] : undefined,
        keywords: keywordsFor(cfg.href, []),
      });
    }
  }
  for (const x of visibleExtras) {
    const parent = byId.get(x.parentId);
    if (!parent) continue;
    destinations.push({
      id: x.id,
      href: x.href,
      label: t(x.labelKey),
      section: groupLabelOf.get(x.parentId),
      iconKey: x.icon,
      icon: icons[x.icon],
      keywords: keywordsFor(x.href, parent.brand ? [parent.label] : []),
    });
  }

  return {
    groups: ordered,
    topGroups,
    bottomGroups,
    activeId,
    listingsHref,
    listingsActive,
    known: Object.fromEntries(
      [...STORE_PROVIDERS, 'veeqo', 'shippo'].map((p) => [p, known(p)]),
    ) as NavModel['known'],
    showConnectCta,
    messagesAvailable,
    messagesEnabled,
    hasReauth,
    tabs,
    moreDot: hasReauth ? 'warning' : undefined,
    breadcrumbs,
    goShortcuts,
    destinations,
  };
}

function keywordsFor(href: string, extra: string[]): string[] {
  const words = normalizePath(href)
    .split(/[/?=&-]+/)
    .filter((w) => w && w !== 'app');
  return [...extra, ...words];
}

function applyBadge(
  item: NavItem,
  cfg: NavItemConfig,
  ctx: {
    t: Translate;
    counts: NavCounts | null;
    messagesUnread?: number | null;
    reauth: Set<string>;
    hasReauth: boolean;
  },
): void {
  const { t } = ctx;
  switch (cfg.badge) {
    case 'ordersToShip': {
      const toShip = ctx.counts?.orders.toShip ?? 0;
      const overdue = ctx.counts?.orders.overdue ?? 0;
      if (toShip > 0) {
        item.count = toShip;
        item.countTone = overdue > 0 ? 'danger' : 'neutral';
        item.countLabel =
          overdue > 0
            ? `${t('shell.badge.toShip', { count: toShip })} · ${t('shell.badge.overdue', { count: overdue })}`
            : t('shell.badge.toShip', { count: toShip });
      }
      return;
    }
    case 'messagesUnread': {
      const n = ctx.messagesUnread ?? 0;
      if (n > 0) {
        item.count = n;
        item.countTone = 'neutral';
        item.countLabel = t('shell.badge.unread', { count: n });
      }
      return;
    }
    case 'marketplace': {
      const brand = cfg.brand;
      if (!brand) return;
      const name = LOGOS[brand as keyof typeof LOGOS]?.name ?? brand;
      if (ctx.reauth.has(brand)) {
        item.dot = 'warning';
        item.dotLabel = t('shell.badge.reconnect', { marketplace: name });
        return;
      }
      const drafts = brand === 'etsy' ? ctx.counts?.drafts.etsy : brand === 'ebay' ? ctx.counts?.drafts.ebay : undefined;
      if (drafts && drafts > 0) {
        item.dot = 'attention';
        item.dotLabel = t('shell.badge.unsent', { count: drafts });
      }
      return;
    }
    case 'settingsReauth': {
      if (ctx.hasReauth) {
        item.dot = 'warning';
        item.dotLabel = t('shell.badge.settingsReconnect');
      }
      return;
    }
    default:
      return;
  }
}

/** Nav crumbs followed by the page's own crumbs (`<Page breadcrumbs>`, shell-nav §2.3, §6.1). */
export function mergeBreadcrumbs(nav: NavCrumb[], page?: PageBreadcrumb[] | null): NavCrumb[] {
  if (!page || page.length === 0) return nav;
  const head = nav.map((c) => ({ ...c, current: false }));
  const tail = page.map((c, i) => ({ ...c, current: i === page.length - 1 }));
  // Drop a repeated label where the nav trail and the page trail meet ("Research › Research › Keywords").
  const merged: NavCrumb[] = [];
  for (const c of [...head, ...tail]) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === c.label) merged[merged.length - 1] = { ...prev, ...c, href: c.href ?? prev.href };
    else merged.push(c);
  }
  return merged;
}

// ── Hook ──────────────────────────────────────────────────────────────────────────────────────────────

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export type UseNavModelOptions = {
  /** Session user id (`useAuth().user?.id`): tags the `kx.nav.connections.v1` cache. Null = no cache. */
  userId?: string | null;
  /** From group B's `useNavCounts()` (undefined while loading / errored / stale). */
  counts?: NavCounts | null;
  /**
   * `billingProviderFromSettings(settingsData)`: `undefined` only while settings are loading, `null` once
   * loaded with no provider. Never pass `settingsData?.subscription?.billingProvider` directly.
   */
  billingProvider?: string | null;
  /** Stock sync is set up (e.g. `/api/stock/settings` enabled). No source wired in M2; see the ⌘K fallback. */
  stockSyncConfigured?: boolean;
};

/**
 * The resolved nav for the current user and route. Call it once in `AppShell` and pass the result down
 * (SideNav, MobileTabBar, MoreSheet, TopBar breadcrumbs, CommandPalette, useGoShortcuts), so the cache
 * effects and the memo run once per render of the shell.
 */
export function useNavModel(options: UseNavModelOptions = {}): NavModel {
  const tRoot = useTranslations();
  const router = useRouter();
  const uid = options.userId ?? null;
  const { connections } = useConnections();
  const messagesUnread = useMessageCountStore((s) => s.counts.total);

  const [cachedFlags, setCachedFlags] = React.useState<Record<string, boolean> | null>(null);
  useIsomorphicLayoutEffect(() => {
    setCachedFlags(readNavConnCache(uid));
  }, [uid]);

  // Stable key so the write effect does not re-run on every render.
  const connKey = connections
    ? Object.keys(connections)
        .sort()
        .map((p) => `${p}:${connections[p as keyof ConnectionsMap]?.connected ? 1 : 0}`)
        .join(',')
    : '';
  React.useEffect(() => {
    if (!connections) return;
    const flags = flagsFromConnections(connections);
    writeNavConnCache(uid, flags);
    setCachedFlags(flags);
  }, [connKey, uid]);

  const t = React.useCallback<Translate>((key, values) => tRoot(key as never, values as never) as string, [tRoot]);
  const path = router?.asPath ?? '/';

  const countsKey = options.counts
    ? `${options.counts.orders.toShip}|${options.counts.orders.overdue}|${options.counts.drafts.etsy}|${options.counts.drafts.ebay}`
    : '';

  return React.useMemo(
    () =>
      buildNavModel({
        t,
        path,
        connections,
        cachedFlags,
        counts: options.counts ?? null,
        messagesUnread,
        billingProvider: options.billingProvider,
        stockSyncConfigured: options.stockSyncConfigured,
      }),
    [t, path, connections, cachedFlags, countsKey, messagesUnread, options.billingProvider, options.stockSyncConfigured],
  );
}

/**
 * Messages count polling (legacy AppLayout.js:295–304): every 3 min, only while Wix or Trendyol is known
 * connected, paused while the tab is hidden. Call once in `AppShell` with `model.messagesEnabled`.
 */
export function useMessageCountPolling(enabled: boolean): void {
  const fetchCounts = useMessageCountStore((s) => s.fetch);
  React.useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void fetchCounts();
    };
    tick();
    const interval = setInterval(tick, 180_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, fetchCounts]);
}

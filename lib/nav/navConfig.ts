// lib/nav/navConfig.ts — shell-nav §2.1: the single source of app destinations.
//
// One typed array drives the sidebar, the rail, the mobile tab bar, the More sheet, breadcrumbs, the
// `g`-shortcuts and the ⌘K "Go to" group. Nothing else defines destinations.
//
// Owner: M2 shell-A, then the integrator only (BUILD_PLAN §2): the `RESEARCH_HOME` flip (R1 PR) and the
// Reports merge (M9 PR: `REPORTS_HOME` → '/app/reports', delete the `finance` row and its `g f` key).
//
// Founder decisions applied over the spec (2026-10-15):
// - `/app` redirects to `/app/analytics` (next.config.js), so the analytics page is **Home**. The first row
//   is `home` → '/app/analytics'. The Overview page is not a destination until M8 redesigns it.
// - Because Home already is the analytics page, the `reports` row stays out of the nav until the Reports
//   hub exists (`REPORTS_HOME = null`); the M9 PR sets it to '/app/reports'.
// - Real marketplace logos: listing rows carry `brand` and render through `<LogoTile>` (lib/ds/logos.ts).
// - Backend nav entries (BUILD_PLAN §7 item 6): "Stock sync" row in Listings, "Notifications" row in the
//   account group. "Etsy activity" is NOT a nav row: it is a palette/breadcrumb destination under Etsy.
//
// Labels are stored as message-key paths (root namespace) so this file has no user-facing strings.
// Brand rows have no label key: their visible label is the proper noun from `LOGOS[brand].name`, and their
// tooltip / aria-label / palette label use `nav.items.listingsOf`.
import type { IconKey } from '@/lib/ds/icons';
import type { MarketplaceKey } from '@/components/ds/data/types';

/** Research hub landing (shell-nav §2.1). The old research routes redirect into the hub (lib/research/legacyRoutes.ts). */
export const RESEARCH_HOME = '/app/research';

/**
 * Reports hub landing. `null` = no Reports row. M9 (integrator) keeps it `null`: founder decision "analytics is Home"
 * makes Home the Reports overview (the Sales tab), so a second "Reports" row would point at the same page. The Home
 * row is active on every `/app/reports/*` tab, and `REPORTS_EXTRA_DESTINATIONS` are ⌘K destinations (the old
 * `/app/financials` URL redirects to Profit; finance-analytics §0.2 A1 adapted: one nav item for the whole Reports
 * area, and it is Home).
 */
export const REPORTS_HOME: string | null = null;

/** Home landing: the analytics dashboard (founder decision; `/app` redirects here). */
export const HOME_HREF = '/app/analytics';

/** Where "Connect a store" and the empty Listings tab go. */
export const CONNECTIONS_HREF = '/ayarlar?tab=connections';

/**
 * Store-type providers a user can connect (Settings › Connections). Used for "Connect a store" and the
 * Stock sync row. Veeqo/Shippo are aggregators and carriers are not stores (legacy AppLayout.js:59).
 */
export const STORE_PROVIDERS = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada'] as const;
export type StoreProvider = (typeof STORE_PROVIDERS)[number];

export type NavGroupId = 'main' | 'listings' | 'insights' | 'account';

export type NavItemId =
  | 'home'
  | 'orders'
  | 'messages'
  | 'listings-etsy'
  | 'listings-ebay'
  | 'listings-trendyol'
  | 'listings-wix'
  | 'listings-shopify'
  | 'stock-sync'
  | 'connect-store'
  | 'research'
  | 'reports'
  | 'notifications'
  | 'settings'
  | 'help';

/** Badge source for a row; resolved by `useNavModel` from `/api/nav/counts`, messages counts, connections. */
export type NavBadgeSource =
  /** count = orders to ship; tone danger when any is overdue. */
  | 'ordersToShip'
  /** count = unread messages (Wix + Trendyol). */
  | 'messagesUnread'
  /** dot warning when the row's marketplace needs reconnecting; dot attention when it has unsent drafts. */
  | 'marketplace'
  /** dot warning when any connected store needs reconnecting. */
  | 'settingsReauth';

/**
 * Gating rule. `providers`: tri-state "any of" (shown when any is known connected; hidden only when all are
 * known not connected; shown while unknown). `connectCta`: shown only when every store provider is known and
 * at least one is not connected. `stockSync`: shown when ≥ 2 stores are connected (unknown counts as maybe),
 * or when the caller reports stock sync is configured.
 */
export type NavRequires =
  | { kind: 'providers'; providers: readonly MarketplaceKey[] }
  | { kind: 'connectCta' }
  | { kind: 'stockSync' };

export type NavItemConfig = {
  id: NavItemId;
  /** Message key (root namespace). Omitted on brand rows (the brand name is the label). */
  labelKey?: string;
  href: string;
  /** Registry icon (lib/ds/icons.ts). Exactly one of `icon` / `brand`. */
  icon?: IconKey;
  /** Marketplace mark rendered with <LogoTile>. */
  brand?: MarketplaceKey;
  requires?: NavRequires;
  badge?: NavBadgeSource;
  /** Second key of the `g` chord (shell-nav §7). Unique across items. */
  gKey?: string;
  /** Active-state path patterns (shell-nav §14.2). `'/x'` exact, `'/x/*'` any sub-path, `'/x*'` prefix. */
  match: readonly string[];
  /** A row of the listings group: feeds `listingsHref` and the mobile Listings tab. */
  listingRow?: boolean;
  /** Never shows as the active row (e.g. "Connect a store"). */
  neverActive?: boolean;
};

export type NavGroupConfig = {
  id: NavGroupId;
  /** Sentence-case group label key; omitted for unlabeled groups. */
  labelKey?: string;
  /** Pinned to the foot of the sidebar. */
  bottom?: boolean;
  items: readonly NavItemConfig[];
};

/**
 * Destinations that are not sidebar rows but are reachable from ⌘K "Go to" and get breadcrumbs
 * (shell-nav §2.1 notes; BUILD_PLAN §7 item 6). `parentId` is the row that shows active on them and that
 * prefixes their breadcrumb.
 */
export type NavExtraDestination = {
  id: 'etsy-activity' | 'invoices' | 'guides' | 'reports-profit' | 'reports-payouts' | 'reports-transactions';
  /** Palette label key. */
  labelKey: string;
  /** Breadcrumb label key (defaults to `labelKey`). */
  crumbKey?: string;
  href: string;
  icon: IconKey;
  parentId: NavItemId;
  match: readonly string[];
  requires?: NavRequires;
  /** Hidden for Shopify-free accounts (App Store rule 1.2.1; legacy AppLayout.js:244–249). */
  hideForShopifyFree?: boolean;
};

const marketplaceRow = (
  brand: 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify',
  href: string,
  extra: Partial<NavItemConfig> = {},
): NavItemConfig => ({
  id: `listings-${brand}` as NavItemId,
  href,
  brand,
  requires: { kind: 'providers', providers: [brand] },
  badge: 'marketplace',
  match: [href, `${href}/*`],
  listingRow: true,
  ...extra,
});

export const NAV_CONFIG: readonly NavGroupConfig[] = [
  {
    id: 'main',
    items: [
      {
        id: 'home',
        labelKey: 'nav.items.home',
        href: HOME_HREF,
        icon: 'overview',
        gKey: 'h',
        // `/app` itself redirects to Home; Home is the Reports overview.
        match: ['/app', HOME_HREF, `${HOME_HREF}/*`, '/app/reports', '/app/reports/*'],
      },
      {
        id: 'orders',
        labelKey: 'nav.items.orders',
        href: '/app/labels',
        icon: 'order',
        badge: 'ordersToShip',
        gKey: 'o',
        match: ['/app/labels', '/app/labels/*', '/app/print/*'],
      },
      {
        id: 'messages',
        labelKey: 'nav.items.messages',
        href: '/app/mesajlar',
        icon: 'message',
        requires: { kind: 'providers', providers: ['wix', 'trendyol'] },
        badge: 'messagesUnread',
        gKey: 'm',
        match: ['/app/mesajlar', '/app/mesajlar/*'],
      },
    ],
  },
  {
    id: 'listings',
    labelKey: 'nav.groups.listings',
    items: [
      // `g l` goes to the first visible listing row (resolved by useNavModel), so no row owns a gKey.
      marketplaceRow('etsy', '/app/etsy-listings'),
      marketplaceRow('ebay', '/app/ebay-listings'),
      marketplaceRow('trendyol', '/app/trendyol-urunler'),
      marketplaceRow('wix', '/app/wix-urunler'),
      marketplaceRow('shopify', '/app/shopify-urunler'),
      {
        id: 'stock-sync',
        labelKey: 'nav.items.stockSync',
        href: '/app/stok-senkron',
        icon: 'stockSync',
        requires: { kind: 'stockSync' },
        match: ['/app/stok-senkron', '/app/stok-senkron/*'],
      },
      {
        id: 'connect-store',
        labelKey: 'nav.items.connectStore',
        href: CONNECTIONS_HREF,
        icon: 'add',
        requires: { kind: 'connectCta' },
        match: [],
        neverActive: true,
      },
    ],
  },
  {
    id: 'insights',
    items: [
      {
        id: 'research',
        labelKey: 'nav.items.research',
        href: RESEARCH_HOME,
        icon: 'research',
        gKey: 'r',
        match: ['/app/research', '/app/research/*'],
      },
      ...(REPORTS_HOME
        ? [
            {
              id: 'reports',
              labelKey: 'nav.items.reports',
              href: REPORTS_HOME,
              icon: 'reports',
              gKey: 'p',
              match: ['/app/reports', '/app/reports/*'],
            } satisfies NavItemConfig,
          ]
        : []),
    ],
  },
  {
    id: 'account',
    bottom: true,
    items: [
      {
        id: 'notifications',
        labelKey: 'nav.items.notifications',
        href: '/app/bildirimler',
        icon: 'notifications',
        match: ['/app/bildirimler'],
      },
      {
        id: 'settings',
        labelKey: 'nav.items.settings',
        href: '/ayarlar',
        icon: 'settings',
        badge: 'settingsReauth',
        gKey: 's',
        match: ['/ayarlar', '/ayarlar/*', '/app/settings'],
      },
      {
        id: 'help',
        labelKey: 'nav.items.help',
        href: '/app/nasil-kullanirim',
        icon: 'help',
        match: ['/app/nasil-kullanirim'],
      },
    ],
  },
];

export const NAV_EXTRA_DESTINATIONS: readonly NavExtraDestination[] = [
  {
    id: 'etsy-activity',
    // Backend-owned key (same string the legacy AppLayout used), so the label has one source.
    labelKey: 'listingHistory.navLabel',
    crumbKey: 'nav.items.activity',
    href: '/app/etsy-aktivite',
    icon: 'etsyActivity',
    parentId: 'listings-etsy',
    match: ['/app/etsy-aktivite'],
    requires: { kind: 'providers', providers: ['etsy'] },
  },
  {
    id: 'invoices',
    labelKey: 'nav.items.invoices',
    href: '/faturalar',
    icon: 'billing',
    parentId: 'settings',
    match: ['/faturalar'],
    hideForShopifyFree: true,
  },
  {
    id: 'guides',
    labelKey: 'nav.items.guides',
    href: '/app/entegrasyonlar-ve-rehberler',
    icon: 'connections',
    parentId: 'help',
    match: ['/app/entegrasyonlar-ve-rehberler'],
  },
];

/**
 * Reports › Profit / Payouts / Transactions as ⌘K "Go to" entries and breadcrumbs under Home (finance-analytics §10 F
 * "⌘K tab commands"). They are the `financials` Pro feature: hidden for
 * Shopify-free accounts (pro-gating §2 neutral rule); Stripe accounts without the feature reach the locked tab.
 */
export const REPORTS_EXTRA_DESTINATIONS: readonly NavExtraDestination[] = [
  {
    id: 'reports-profit',
    labelKey: 'nav.items.reportsProfit',
    crumbKey: 'reports.tabs.profit',
    href: '/app/reports/profit',
    icon: 'finance',
    parentId: 'home',
    match: ['/app/reports/profit', '/app/financials'],
    hideForShopifyFree: true,
  },
  {
    id: 'reports-payouts',
    labelKey: 'nav.items.reportsPayouts',
    crumbKey: 'reports.tabs.payouts',
    href: '/app/reports/payouts',
    icon: 'finance',
    parentId: 'home',
    match: ['/app/reports/payouts'],
    hideForShopifyFree: true,
  },
  {
    id: 'reports-transactions',
    labelKey: 'nav.items.reportsTransactions',
    crumbKey: 'reports.tabs.transactions',
    href: '/app/reports/transactions',
    icon: 'finance',
    parentId: 'home',
    match: ['/app/reports/transactions'],
    hideForShopifyFree: true,
  },
];

/** `g l` target id: resolved to `listingsHref` at runtime (first visible listing row). */
export const G_LISTINGS_KEY = 'l';

/** Every configured item, flat (config order). */
export const ALL_NAV_ITEMS: readonly NavItemConfig[] = NAV_CONFIG.flatMap((g) => g.items);

export function navItemById(id: NavItemId): NavItemConfig | undefined {
  return ALL_NAV_ITEMS.find((i) => i.id === id);
}

/**
 * Path pattern match (shell-nav §14.2). `path` must be a pathname without query or hash.
 * `'/x'` matches exactly (a trailing slash is ignored), `'/x/*'` matches any path below `/x`,
 * `'/x*'` matches any path that starts with `/x`.
 */
export function matchPath(pattern: string, path: string): boolean {
  const p = normalizePath(path);
  if (pattern.endsWith('/*')) return p.startsWith(pattern.slice(0, -1)) && p.length > pattern.length - 1;
  if (pattern.endsWith('*')) return p.startsWith(pattern.slice(0, -1));
  return p === normalizePath(pattern);
}

/** Specificity of a match: longer literal prefixes win; exact beats wildcard of the same length. */
export function matchScore(pattern: string): number {
  const literal = pattern.replace(/\/?\*$/, '');
  return literal.length * 2 + (pattern.endsWith('*') ? 0 : 1);
}

/** Strips query and hash, and a trailing slash (except for '/'). */
export function normalizePath(asPath: string): string {
  const bare = (asPath || '/').split(/[?#]/)[0] || '/';
  return bare.length > 1 && bare.endsWith('/') ? bare.slice(0, -1) : bare;
}

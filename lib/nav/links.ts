// lib/nav/links.ts — deep links that must survive the UI flag flips (overview §4.4, G4).
//
// One place builds every cross-surface href, so the Overview queue, KPI tiles and best sellers land on the right
// screen whichever version of it is on. Each builder switches between the legacy query and the v2 keys by the
// flags in `lib/ds/uiFlags.ts`:
//   orders            /app/labels   legacy `label=…&status=…&sort=…&from=all`, `mp`, `qt`, `highlight`
//                                   v2     `view=…`, `store`, `q`, `in`, `open=<orderId>`, `panel=label`
//   listings-<mp>     listing grid  legacy route only (the legacy pages read no view key)
//                                   v2     `view=…`, `open=<listingId>` (QuickView)
//   editor-etsy|ebay  full editor   `/app/{etsy|ebay}-listings/<id>`
//   reports           `/app/reports` (else `/app/analytics`, CRITIQUE C3)
//   research          `/app/research/listings` (Listing doctor, R1)
//
// Every builder is pure when `flags` is passed (tests, server). Without it the flags are read from the build
// default plus the viewer's `?ui=` override — client only, and not during the first render (hydration): React
// callers use `useNavLinks()`, which binds the hook values of `useUiFlag`.
import { useMemo } from 'react';
import { defaultUiFlags, readClientUiOverride, resolveUiFlag, useUiFlag, type UiFlagKey } from '@/lib/ds/uiFlags';
import type { OrderViewKey } from '@/lib/orders/types';

/** Flag values the builders read. A missing key counts as off. */
export type LinkFlags = Partial<Record<UiFlagKey, boolean>>;

/** The flags `links.ts` depends on (`useNavLinks` subscribes to exactly these). */
export const LINK_FLAG_KEYS = [
  'orders',
  'listings-etsy',
  'listings-ebay',
  'listings-trendyol',
  'listings-wix',
  'listings-shopify',
  'editor-etsy',
  'editor-ebay',
  'reports',
  'research',
] as const satisfies readonly UiFlagKey[];

/** Current flag values outside React (build default + `?ui=` override). Client-side; on the server = defaults. */
export function currentLinkFlags(): LinkFlags {
  const defaults = defaultUiFlags();
  const override = readClientUiOverride();
  const out: LinkFlags = {};
  for (const k of LINK_FLAG_KEYS) out[k] = resolveUiFlag(k, defaults, override);
  return out;
}

type Pair = [string, string];

function withPairs(path: string, pairs: Pair[]): string {
  const kept = pairs.filter(([, v]) => v !== '');
  if (!kept.length) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of kept) qs.append(k, v);
  return `${path}?${qs.toString()}`;
}

const enc = (s: string) => encodeURIComponent(s);
const clean = (s: string | null | undefined): string => (typeof s === 'string' ? s.trim() : '');

// ── orders ──────────────────────────────────────────────────────────────────────────────────────────────

export const ORDERS_ROUTE = '/app/labels';

/** A built-in Orders view, one order (`orderId`) or a search (`q`). */
export type OrdersLinkView = OrderViewKey | 'order' | 'search';

export interface OrdersLinkOptions {
  /** Open the order's Create label panel (v2 `panel=label`; legacy opens the order search/highlight). */
  createLabel?: boolean;
  /** The order's display number: legacy `'order'` links search for it (`qt=order`); v2 ignores it. */
  orderNumber?: string | null;
}

/** Legacy `/app/labels` filters per view (labels.tsx `label` / `status` / `sort`). */
const LEGACY_ORDER_VIEW: Record<OrderViewKey, Pair[]> = {
  to_ship: [['label', 'unlabeled'], ['status', 'onaylandi'], ['sort', 'shipBy']],
  // The legacy page has no overdue filter: To ship sorted by ship-by puts the overdue orders first.
  overdue: [['label', 'unlabeled'], ['status', 'onaylandi'], ['sort', 'shipBy']],
  label_created: [['label', 'labeled']],
  shipped: [['label', 'all'], ['status', 'kargolandi']],
  problems: [['label', 'failed']],
  all: [['label', 'all']],
};

/**
 * Orders deep link (overview §3.1–§3.4).
 *   ordersHref('to_ship')                                   KPI To ship
 *   ordersHref('overdue')                                   KPI Overdue
 *   ordersHref('problems')                                  queue: labels failed
 *   ordersHref('order', id, null, null, { createLabel: true, orderNumber })   queue: overdue → Create label
 *   ordersHref('label_created', null, 'etsy')               queue: tracking not sent
 *   ordersHref('search', null, null, sku || name)           best sellers row
 * `store` is a DB `Order.marketplace` value (v2 `store`, legacy `mp`).
 */
export function ordersHref(
  view: OrdersLinkView,
  orderId?: string | null,
  store?: string | null,
  q?: string | null,
  opts: OrdersLinkOptions = {},
  flags: LinkFlags = currentLinkFlags(),
): string {
  const id = clean(orderId);
  const st = clean(store);
  const query = clean(q);

  if (flags.orders) {
    const pairs: Pair[] = [];
    const isBuiltIn = view !== 'order' && view !== 'search';
    // One order or a search needs every order in scope: "All" (search ignores dates server-side).
    pairs.push(['view', isBuiltIn ? view : 'all']);
    if (view === 'search' && query) pairs.push(['q', query]);
    if (st) pairs.push(['store', st]);
    if (id) {
      pairs.push(['open', id]);
      if (opts.createLabel) pairs.push(['panel', 'label']);
    }
    return withPairs(ORDERS_ROUTE, pairs);
  }

  const pairs: Pair[] = [];
  if (view === 'order') {
    const number = clean(opts.orderNumber) || query;
    if (number) pairs.push(['q', number], ['qt', 'order'], ['label', 'all']);
    else if (id) pairs.push(['highlight', id], ['label', 'all']);
    else pairs.push(['label', 'all']);
  } else if (view === 'search') {
    if (query) pairs.push(['q', query]);
    pairs.push(['label', 'all']);
  } else {
    pairs.push(...LEGACY_ORDER_VIEW[view]);
    // A specific order inside a view: the legacy page expands it (`?highlight=`, W6).
    if (id) pairs.push(['highlight', id]);
  }
  if (st) pairs.push(['mp', st]);
  pairs.push(['from', 'all']);
  return withPairs(ORDERS_ROUTE, pairs);
}

/** Shorthand for the queue's "Create label" CTA: `ordersHref('order', id, null, null, { createLabel: true, orderNumber })`. */
export function createLabelHref(orderId: string, orderNumber?: string | null, flags: LinkFlags = currentLinkFlags()): string {
  return ordersHref('order', orderId, null, null, { createLabel: true, orderNumber }, flags);
}

// ── listings ────────────────────────────────────────────────────────────────────────────────────────────

export type ListingsLinkMarketplace = 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify';

/** Built-in grid views (components/domain/listings/config/*.ts). `changes_not_sent` is overview §3.2's alias of `not_sent`. */
export type ListingsLinkView =
  | 'all'
  | 'active'
  | 'not_sent'
  | 'changes_not_sent'
  | 'send_failed'
  | 'needs_work'
  | 'sold_out'
  | 'inactive'
  | 'review';

/** Same routes as `components/domain/listings/config/<mp>.ts` `route`. */
export const LISTINGS_ROUTES: Record<ListingsLinkMarketplace, string> = {
  etsy: '/app/etsy-listings',
  ebay: '/app/ebay-listings',
  trendyol: '/app/trendyol-urunler',
  wix: '/app/wix-urunler',
  shopify: '/app/shopify-urunler',
};

const LISTINGS_FLAG: Record<ListingsLinkMarketplace, UiFlagKey> = {
  etsy: 'listings-etsy',
  ebay: 'listings-ebay',
  trendyol: 'listings-trendyol',
  wix: 'listings-wix',
  shopify: 'listings-shopify',
};

/** Marketplaces with a full-page editor route (pages/app/{etsy,ebay}-listings/[id].tsx). */
const EDITOR_FLAG: Partial<Record<ListingsLinkMarketplace, UiFlagKey>> = {
  etsy: 'editor-etsy',
  ebay: 'editor-ebay',
};

/** Listing grid, optionally on a view. Legacy pages read no view key, so they get the bare route. */
export function listingsHref(
  mp: ListingsLinkMarketplace,
  view: ListingsLinkView = 'all',
  flags: LinkFlags = currentLinkFlags(),
): string {
  const route = LISTINGS_ROUTES[mp];
  if (!flags[LISTINGS_FLAG[mp]]) return route;
  const v = view === 'changes_not_sent' ? 'not_sent' : view;
  return v === 'all' ? route : withPairs(route, [['view', v]]);
}

/**
 * One listing: the full editor when its flag is on (Etsy/eBay), else the grid with `?open=<id>` (v2 QuickView;
 * the legacy pages land on the list). `shop` scopes an Etsy link to a shop (`?shop=`), optional.
 * `listingId` is the Etsy listing id (BigInt as string) or the eBay `listingId ?? sku` (overview §4 `DraftRef`).
 */
export function listingHref(
  mp: ListingsLinkMarketplace,
  listingId: string,
  flags: LinkFlags = currentLinkFlags(),
  opts: { shop?: string | null } = {},
): string {
  const route = LISTINGS_ROUTES[mp];
  const id = clean(listingId);
  const shop = mp === 'etsy' ? clean(opts.shop) : '';
  if (!id) return route;
  const editorFlag = EDITOR_FLAG[mp];
  if (editorFlag && flags[editorFlag]) return withPairs(`${route}/${enc(id)}`, shop ? [['shop', shop]] : []);
  const pairs: Pair[] = [];
  if (shop) pairs.push(['shop', shop]);
  pairs.push(['open', id]);
  return withPairs(route, pairs);
}

/**
 * Queue row 10 "Open Listing doctor" (overview §3.2): the R1 doctor when `research` is on, else the Etsy grid's
 * Needs work view (M5), else `null` — the row is hidden (legacy has no needs-work list).
 */
export function listingDoctorHref(flags: LinkFlags = currentLinkFlags()): string | null {
  if (flags.research) return '/app/research/listings';
  if (flags['listings-etsy']) return listingsHref('etsy', 'needs_work', flags);
  return null;
}

// ── reports / settings ──────────────────────────────────────────────────────────────────────────────────

/** Revenue KPI target: `/app/reports` once the `reports` flag is on, else the analytics page (CRITIQUE C3). */
export function reportsHref(flags: LinkFlags = currentLinkFlags()): string {
  return flags.reports ? '/app/reports' : '/app/analytics';
}

export type SettingsLinkTab = 'connections' | 'billing' | 'senderProfile' | 'apiKeys';

/** `/ayarlar?tab=…` (settings_spec §2); `provider` opens that connection's drawer. Not flag-dependent. */
export function settingsHref(tab: SettingsLinkTab, provider?: string | null): string {
  const p = clean(provider);
  return withPairs('/ayarlar', p && tab === 'connections' ? [['tab', tab], ['provider', p]] : [['tab', tab]]);
}

// ── React binding ───────────────────────────────────────────────────────────────────────────────────────

export interface NavLinks {
  flags: LinkFlags;
  ordersHref: (view: OrdersLinkView, orderId?: string | null, store?: string | null, q?: string | null, opts?: OrdersLinkOptions) => string;
  createLabelHref: (orderId: string, orderNumber?: string | null) => string;
  listingsHref: (mp: ListingsLinkMarketplace, view?: ListingsLinkView) => string;
  listingHref: (mp: ListingsLinkMarketplace, listingId: string, opts?: { shop?: string | null }) => string;
  listingDoctorHref: () => string | null;
  reportsHref: () => string;
  settingsHref: typeof settingsHref;
}

/** The builders bound to the hook values of `useUiFlag` (SSR-safe: build defaults first, override after mount). */
export function useNavLinks(): NavLinks {
  const orders = useUiFlag('orders');
  const le = useUiFlag('listings-etsy');
  const lb = useUiFlag('listings-ebay');
  const lt = useUiFlag('listings-trendyol');
  const lw = useUiFlag('listings-wix');
  const ls = useUiFlag('listings-shopify');
  const ee = useUiFlag('editor-etsy');
  const eb = useUiFlag('editor-ebay');
  const reports = useUiFlag('reports');
  const research = useUiFlag('research');
  return useMemo<NavLinks>(() => {
    const flags: LinkFlags = {
      orders,
      'listings-etsy': le,
      'listings-ebay': lb,
      'listings-trendyol': lt,
      'listings-wix': lw,
      'listings-shopify': ls,
      'editor-etsy': ee,
      'editor-ebay': eb,
      reports,
      research,
    };
    return {
      flags,
      ordersHref: (view, orderId, store, q, opts) => ordersHref(view, orderId, store, q, opts, flags),
      createLabelHref: (orderId, orderNumber) => createLabelHref(orderId, orderNumber, flags),
      listingsHref: (mp, view) => listingsHref(mp, view, flags),
      listingHref: (mp, listingId, opts) => listingHref(mp, listingId, flags, opts),
      listingDoctorHref: () => listingDoctorHref(flags),
      reportsHref: () => reportsHref(flags),
      settingsHref,
    };
  }, [orders, le, lb, lt, lw, ls, ee, eb, reports, research]);
}

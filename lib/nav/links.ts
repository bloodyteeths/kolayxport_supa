// lib/nav/links.ts — cross-surface deep links (overview §4.4, G4).
//
// One place builds every cross-surface href, so the Overview queue, KPI tiles and best sellers land on the right
// screen:
//   orders            /app/labels   `view=…`, `store`, `q`, `open=<orderId>`, `panel=label`
//   listings-<mp>     listing grid  `view=…`
//   editor-<mp>       full editor   `/app/{etsy|ebay}-listings/<id>`, `/app/{trendyol|wix|shopify}-urunler/<id>` (M6b)
//   reports           `/app/reports`
//   research          `/app/research/listings` (Listing doctor, R1)
//
// Every builder is pure. React callers may use `useNavLinks()`, which returns the same builders.
import { useMemo } from 'react';
import type { OrderViewKey } from '@/lib/orders/types';

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
  /** Open the order's Create label panel (`panel=label`). */
  createLabel?: boolean;
}

/**
 * Orders deep link (overview §3.1–§3.4).
 *   ordersHref('to_ship')                                   KPI To ship
 *   ordersHref('overdue')                                   KPI Overdue
 *   ordersHref('problems')                                  queue: labels failed
 *   ordersHref('order', id, null, null, { createLabel: true })   queue: overdue → Create label
 *   ordersHref('label_created', null, 'etsy')               queue: tracking not sent
 *   ordersHref('search', null, null, sku || name)           best sellers row
 * `store` is a DB `Order.marketplace` value.
 */
export function ordersHref(
  view: OrdersLinkView,
  orderId?: string | null,
  store?: string | null,
  q?: string | null,
  opts: OrdersLinkOptions = {},
): string {
  const id = clean(orderId);
  const st = clean(store);
  const query = clean(q);
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

/** Shorthand for the queue's "Create label" CTA: `ordersHref('order', id, null, null, { createLabel: true })`. */
export function createLabelHref(orderId: string): string {
  return ordersHref('order', orderId, null, null, { createLabel: true });
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

/** Listing grid, optionally on a view. */
export function listingsHref(mp: ListingsLinkMarketplace, view: ListingsLinkView = 'all'): string {
  const route = LISTINGS_ROUTES[mp];
  const v = view === 'changes_not_sent' ? 'not_sent' : view;
  return v === 'all' ? route : withPairs(route, [['view', v]]);
}

/**
 * One listing: the full editor (pages/app/{etsy,ebay}-listings/[id].tsx, pages/app/{trendyol,wix,shopify}-urunler/[id].tsx).
 * `shop` scopes an Etsy link to a shop (`?shop=`), optional.
 * `listingId` is the Etsy listing id (BigInt as string) or the eBay `listingId ?? sku` (overview §4 `DraftRef`).
 */
export function listingHref(mp: ListingsLinkMarketplace, listingId: string, opts: { shop?: string | null } = {}): string {
  const route = LISTINGS_ROUTES[mp];
  const id = clean(listingId);
  const shop = mp === 'etsy' ? clean(opts.shop) : '';
  if (!id) return route;
  return withPairs(`${route}/${enc(id)}`, shop ? [['shop', shop]] : []);
}

/**
 * Queue row 10 "Open Listing doctor" (overview §3.2): the Research hub's Listing doctor.
 */
export function listingDoctorHref(): string {
  return '/app/research/listings';
}

// ── reports / settings ──────────────────────────────────────────────────────────────────────────────────

/** Revenue KPI target (CRITIQUE C3). */
export function reportsHref(): string {
  return '/app/reports';
}

export type SettingsLinkTab = 'connections' | 'billing' | 'senderProfile' | 'apiKeys';

/** `/ayarlar?tab=…` (settings_spec §2); `provider` opens that connection's drawer. */
export function settingsHref(tab: SettingsLinkTab, provider?: string | null): string {
  const p = clean(provider);
  return withPairs('/ayarlar', p && tab === 'connections' ? [['tab', tab], ['provider', p]] : [['tab', tab]]);
}

// ── React binding ───────────────────────────────────────────────────────────────────────────────────────

export interface NavLinks {
  ordersHref: typeof ordersHref;
  createLabelHref: typeof createLabelHref;
  listingsHref: typeof listingsHref;
  listingHref: typeof listingHref;
  listingDoctorHref: typeof listingDoctorHref;
  reportsHref: typeof reportsHref;
  settingsHref: typeof settingsHref;
}

/** The builders as one object (kept for React callers; every builder is pure). */
export function useNavLinks(): NavLinks {
  return useMemo<NavLinks>(
    () => ({ ordersHref, createLabelHref, listingsHref, listingHref, listingDoctorHref, reportsHref, settingsHref }),
    [],
  );
}

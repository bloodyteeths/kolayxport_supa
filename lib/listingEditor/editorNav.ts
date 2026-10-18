// lib/listingEditor/editorNav.ts — ‹ › / j k between listings and editor routes (listing-editor §1).
// The list writes `sessionStorage['kx:editorNav']` when it opens the editor; the editor reads it. Every
// storage access is wrapped (private windows, blocked storage, thumbnail capture): without it the arrows
// are simply not rendered.
import type { EditorMarketplace, EditorNavState } from './types';

export const EDITOR_NAV_KEY = 'kx:editorNav';

const MARKETPLACES: readonly EditorMarketplace[] = ['etsy', 'ebay', 'trendyol', 'wix', 'shopify', 'hepsiburada'];
const MAX_IDS = 500;

/** Validates an untrusted value read from storage. */
export function parseEditorNav(raw: unknown): EditorNavState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.marketplace !== 'string' || !(MARKETPLACES as readonly string[]).includes(r.marketplace)) return null;
  if (!Array.isArray(r.ids)) return null;
  const ids = r.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128).slice(0, MAX_IDS);
  if (!ids.length) return null;
  return {
    marketplace: r.marketplace as EditorMarketplace,
    shopId: typeof r.shopId === 'string' && r.shopId ? r.shopId : null,
    ids,
    query: typeof r.query === 'string' ? r.query.slice(0, 2000) : undefined,
  };
}

export function readEditorNav(): EditorNavState | null {
  try {
    if (typeof window === 'undefined') return null;
    const text = window.sessionStorage.getItem(EDITOR_NAV_KEY);
    if (!text) return null;
    return parseEditorNav(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Called by the list page (integrator wiring) when it opens the editor. Returns false when storage is blocked. */
export function writeEditorNav(state: EditorNavState): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const clean = parseEditorNav(state);
    if (!clean) return false;
    window.sessionStorage.setItem(EDITOR_NAV_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/** The list's URL state for the editor's Back link, without the quick view / tool panel params. */
export function listQueryForEditor(search?: string): string | undefined {
  let raw = search;
  if (raw === undefined) {
    try {
      raw = typeof window === 'undefined' ? '' : window.location.search;
    } catch {
      raw = '';
    }
  }
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  params.delete('open');
  params.delete('tool');
  const qs = params.toString();
  return qs ? `?${qs}` : undefined;
}

/** Previous / next ids around `id` in the list's current page; null at the ends or when `id` is not in it. */
export function editorNeighbors(
  nav: EditorNavState | null,
  marketplace: EditorMarketplace,
  shopId: string | null,
  id: string,
): { prev: string | null; next: string | null; index: number; total: number } | null {
  if (!nav || nav.marketplace !== marketplace) return null;
  if (nav.shopId && shopId && nav.shopId !== shopId) return null;
  const index = nav.ids.indexOf(id);
  if (index < 0) return null;
  return {
    prev: index > 0 ? nav.ids[index - 1] : null,
    next: index < nav.ids.length - 1 ? nav.ids[index + 1] : null,
    index,
    total: nav.ids.length,
  };
}

const LIST_ROUTE: Record<EditorMarketplace, string> = {
  etsy: '/app/etsy-listings',
  ebay: '/app/ebay-listings',
  trendyol: '/app/trendyol-urunler',
  wix: '/app/wix-urunler',
  shopify: '/app/shopify-urunler',
  hepsiburada: '/app/hepsiburada-urunler',
};

const STORE_PARAM: Record<EditorMarketplace, string | null> = {
  etsy: 'shop',
  ebay: null,
  trendyol: null,
  wix: 'site',
  shopify: 'shop',
  hepsiburada: null,
};

function withStore(path: string, marketplace: EditorMarketplace, storeId: string | null | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  const param = STORE_PARAM[marketplace];
  if (param && storeId) params.set(param, storeId);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** List route (Back target when the referrer is not the list). */
export function listHref(marketplace: EditorMarketplace, storeId?: string | null, query?: string): string {
  const base = withStore(LIST_ROUTE[marketplace], marketplace, storeId);
  if (!query) return base;
  // `query` is the list's own URL state (filters, sort, page); keep the store param from it when present.
  const q = query.startsWith('?') ? query.slice(1) : query;
  return q ? `${LIST_ROUTE[marketplace]}?${q}` : base;
}

export function editorHref(marketplace: EditorMarketplace, id: string, storeId?: string | null): string {
  return withStore(`${LIST_ROUTE[marketplace]}/${encodeURIComponent(id)}`, marketplace, storeId);
}

export function newListingHref(
  marketplace: EditorMarketplace,
  storeId?: string | null,
  extra?: { draft?: string; copy?: string; prefill?: 'session'; crosslist?: string },
): string {
  const params: Record<string, string> = {};
  if (extra?.draft) params.draft = extra.draft;
  if (extra?.copy) params.copy = extra.copy;
  if (extra?.prefill) params.prefill = extra.prefill;
  if (extra?.crosslist) params.crosslist = extra.crosslist;
  return withStore(`${LIST_ROUTE[marketplace]}/new`, marketplace, storeId, params);
}

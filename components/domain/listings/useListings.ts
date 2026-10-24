// components/domain/listings/useListings.ts — listings-grid §5 URL state, §7 states, §9.1 read API, §9.2 pull (G5).
//
// - URL state (`useUrlState`): `?shop|site=&view=&q=&status=&section=&health=&f.<key>=&sort=&page=&size=&open=&tool=`.
//   A reload restores view, filters, sort, page, the open quick view and the open tool panel.
// - Reads `GET /api/listings` (DB caches only, never the marketplace) through SWR with `keepPreviousData`.
// - Live refresh (BUILD_PLAN §7 item 3): `listing.changed` / `listing.removed` / `sync.finished` revalidate the
//   same DB-only request (never a live marketplace read).
// - Pull ("Refresh from Etsy") uses the existing sync endpoints (config.pull), then revalidates.
import * as React from 'react';
import useSWR from 'swr';
import { urlField, type UrlStateOf } from '@/lib/ds/useUrlState';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import { useLiveRevalidate } from '@/components/live/useLiveEvent';
import {
  BUILT_IN_VIEW_QUERY,
  DEFAULT_LISTING_SORT,
  HEALTH_FILTER_KEYS,
  LISTING_SORT_FIELDS,
  LISTING_STATUS_KEYS,
  isBuiltInViewKey,
  toListingsSearchParams,
  type ApprovalFilterKey,
  type BuiltInViewKey,
  type HealthFilterKey,
  type ListingPageSize,
  type ListingRow,
  type ListingSortKey,
  type ListingsErrorCode,
  type ListingsQuery,
  type ListingsResponse,
  type PhotosFilterKey,
  type StockFilterKey,
} from '@/lib/listings/types';
import type { FilterValue, FilterValues } from '@/components/ds/toolbar/types';
import type { ListingFilterKey, ListingsConfig } from './config/types';
import { LISTINGS_TOOL_KEYS } from './tools/ToolsMenuItems';

// ─── URL schema ─────────────────────────────────────────────────────────────

export const LISTING_SORT_KEYS = LISTING_SORT_FIELDS.flatMap((f) => [`${f}.asc`, `${f}.desc`]) as ListingSortKey[];

const BOOL_VALUES = ['1', '0'] as const;

export const LISTINGS_URL_SCHEMA = {
  shop: urlField.string(undefined, { maxLength: 64 }),
  site: urlField.string(undefined, { maxLength: 64 }),
  view: urlField.string(undefined, { maxLength: 64 }),
  q: urlField.string(undefined, { maxLength: 200 }),
  status: urlField.list({ values: LISTING_STATUS_KEYS, format: 'comma' }),
  health: urlField.optionalEnum(HEALTH_FILTER_KEYS),
  section: urlField.string(undefined, { maxLength: 64 }),
  condition: urlField.string(undefined, { maxLength: 64 }),
  category: urlField.string(undefined, { maxLength: 200 }),
  collection: urlField.string(undefined, { maxLength: 64 }),
  productType: urlField.string(undefined, { maxLength: 200 }),
  'f.brand': urlField.string(undefined, { maxLength: 200 }),
  'f.vendor': urlField.string(undefined, { maxLength: 200 }),
  'f.format': urlField.string(undefined, { maxLength: 32 }),
  'f.hasVideo': urlField.optionalEnum(BOOL_VALUES),
  'f.personalizable': urlField.optionalEnum(BOOL_VALUES),
  'f.visible': urlField.optionalEnum(BOOL_VALUES),
  'f.photos': urlField.optionalEnum(['lt5', '5-9', 'gte10'] as const),
  'f.stock': urlField.optionalEnum(['in', 'out'] as const),
  'f.approval': urlField.optionalEnum(['approved', 'in_review', 'rejected'] as const),
  'f.priceMin': urlField.string(undefined, { maxLength: 16 }),
  'f.priceMax': urlField.string(undefined, { maxLength: 16 }),
  sort: urlField.enum(LISTING_SORT_KEYS, DEFAULT_LISTING_SORT),
  page: urlField.int(1, { min: 1 }),
  size: urlField.int(50, { allowed: [50, 100, 250] }),
  open: urlField.string(undefined, { maxLength: 64 }),
  tool: urlField.optionalEnum(LISTINGS_TOOL_KEYS),
};

export type ListingsUrlState = UrlStateOf<typeof LISTINGS_URL_SCHEMA>;
type UrlKey = keyof ListingsUrlState;

/** Filter fields a view switch or "Clear all" resets. */
export const FILTER_URL_KEYS: UrlKey[] = [
  'status',
  'health',
  'section',
  'condition',
  'category',
  'collection',
  'productType',
  'f.brand',
  'f.vendor',
  'f.format',
  'f.hasVideo',
  'f.personalizable',
  'f.visible',
  'f.photos',
  'f.stock',
  'f.approval',
  'f.priceMin',
  'f.priceMax',
];

/** URL key(s) of a config filter key. */
export function urlKeysOf(key: ListingFilterKey): UrlKey[] {
  switch (key) {
    case 'status':
    case 'health':
    case 'section':
    case 'condition':
    case 'category':
    case 'collection':
    case 'productType':
      return [key];
    case 'price':
      return ['f.priceMin', 'f.priceMax'];
    default:
      return [`f.${key}` as UrlKey];
  }
}

export function storeOf(url: ListingsUrlState, config: Pick<ListingsConfig, 'storeParam'>): string | undefined {
  if (config.storeParam === 'shop') return url.shop;
  if (config.storeParam === 'site') return url.site;
  return undefined;
}

export function activeViewOf(url: ListingsUrlState, config: Pick<ListingsConfig, 'defaultView'>): string {
  return url.view ?? config.defaultView;
}

function numOrUndef(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function boolOrUndef(v: '1' | '0' | undefined): boolean | undefined {
  return v === '1' ? true : v === '0' ? false : undefined;
}

/** URL state → `GET /api/listings` query (pure, unit-tested). A built-in view contributes its §5 query. */
export function toListingsQuery(url: ListingsUrlState, config: Pick<ListingsConfig, 'marketplace' | 'storeParam' | 'defaultView'>): ListingsQuery {
  const view = activeViewOf(url, config);
  const viewQuery = isBuiltInViewKey(view) ? BUILT_IN_VIEW_QUERY[view] : {};
  const q: ListingsQuery = {
    marketplace: config.marketplace,
    sort: url.sort,
    page: url.page,
    size: url.size as ListingPageSize,
  };
  const store = storeOf(url, config);
  if (store) q.store = store;
  if (url.q) q.q = url.q;
  const status = url.status.length ? url.status : viewQuery.status;
  if (status?.length) q.status = status;
  if (viewQuery.sync?.length) q.sync = viewQuery.sync;
  const health = (url.health as HealthFilterKey | undefined) ?? viewQuery.health;
  if (health) q.health = health;
  if (url.section) q.section = url.section;
  if (url.condition) q.condition = url.condition;
  if (url.category) q.category = url.category;
  if (url.collection) q.collection = url.collection;
  if (url.productType) q.productType = url.productType;
  if (url['f.brand']) q.brand = url['f.brand'];
  if (url['f.vendor']) q.vendor = url['f.vendor'];
  if (url['f.format']) q.format = url['f.format'];
  const hasVideo = boolOrUndef(url['f.hasVideo']);
  if (hasVideo !== undefined) q.hasVideo = hasVideo;
  const personalizable = boolOrUndef(url['f.personalizable']);
  if (personalizable !== undefined) q.personalizable = personalizable;
  const visible = boolOrUndef(url['f.visible']);
  if (visible !== undefined) q.visible = visible;
  if (url['f.photos']) q.photos = url['f.photos'] as PhotosFilterKey;
  if (url['f.stock']) q.stock = url['f.stock'] as StockFilterKey;
  if (url['f.approval']) q.approval = url['f.approval'] as ApprovalFilterKey;
  const priceMin = numOrUndef(url['f.priceMin']);
  if (priceMin !== undefined) q.priceMin = priceMin;
  const priceMax = numOrUndef(url['f.priceMax']);
  if (priceMax !== undefined) q.priceMax = priceMax;
  return q;
}

/** URL state → Toolbar values, keyed by the config filter keys. */
export function toFilterValues(url: ListingsUrlState, filters: Pick<ListingsConfig, 'filters'>['filters']): FilterValues {
  const out: FilterValues = {};
  for (const f of filters) {
    if (f.key === 'price') {
      const min = numOrUndef(url['f.priceMin']);
      const max = numOrUndef(url['f.priceMax']);
      out.price = min === undefined && max === undefined ? undefined : { min, max };
      continue;
    }
    const [k] = urlKeysOf(f.key);
    const v = url[k];
    if (f.type === 'boolean') out[f.key] = v === '1' ? true : undefined;
    else if (f.type === 'multiselect') out[f.key] = Array.isArray(v) && v.length ? v : undefined;
    else out[f.key] = typeof v === 'string' && v ? v : undefined;
  }
  return out;
}

/** Toolbar values → URL patch (every config filter key is written, so cleared values are removed). */
export function fromFilterValues(values: FilterValues, filters: Pick<ListingsConfig, 'filters'>['filters']): Partial<ListingsUrlState> {
  const patch: Record<string, unknown> = {};
  for (const f of filters) {
    const v: FilterValue = values[f.key];
    if (f.key === 'price') {
      const r = v && typeof v === 'object' && !Array.isArray(v) && !('from' in v) ? (v as { min?: number; max?: number }) : {};
      patch['f.priceMin'] = typeof r.min === 'number' && Number.isFinite(r.min) ? String(r.min) : undefined;
      patch['f.priceMax'] = typeof r.max === 'number' && Number.isFinite(r.max) ? String(r.max) : undefined;
      continue;
    }
    const [k] = urlKeysOf(f.key);
    if (f.type === 'boolean') patch[k] = v === true ? '1' : undefined;
    else if (f.type === 'multiselect') patch[k] = Array.isArray(v) ? v : [];
    else patch[k] = typeof v === 'string' && v ? v : undefined;
  }
  return patch as Partial<ListingsUrlState>;
}

/** The URL patch that applies a view: built-in = its key and no filters; user view = its stored query. */
export function viewPatch(
  viewId: string,
  userViews: { id: string; query?: Record<string, string | string[]> }[],
  config: Pick<ListingsConfig, 'defaultView'>,
): Partial<ListingsUrlState> {
  const cleared: Record<string, unknown> = { q: undefined };
  for (const k of FILTER_URL_KEYS) cleared[k] = k === 'status' ? [] : undefined;
  const user = userViews.find((v) => v.id === viewId);
  if (user) {
    const stored = user.query ?? {};
    const out: Record<string, unknown> = { ...cleared, view: viewId };
    for (const [k, v] of Object.entries(stored)) {
      if (k === 'status') out.status = (Array.isArray(v) ? v : String(v).split(',')).filter(Boolean);
      else if (k === 'q' || (FILTER_URL_KEYS as string[]).includes(k)) out[k] = Array.isArray(v) ? v[0] : v;
    }
    return out as Partial<ListingsUrlState>;
  }
  // A built-in view changes only the view: the seller's search and filters stay and combine with it (the same rule
  // as Orders; choosing a view never silently resets a filter). A saved view (above) is a full snapshot.
  return { view: viewId === config.defaultView ? undefined : viewId } as Partial<ListingsUrlState>;
}

/** The query a "Save view…" stores (filters + search; the built-in base view as `base`). */
export function savedViewQuery(url: ListingsUrlState): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (url.q) out.q = url.q;
  for (const k of FILTER_URL_KEYS) {
    const v = url[k];
    if (Array.isArray(v) ? v.length : v) out[k] = v as string | string[];
  }
  return out;
}

export function hasActiveFilters(url: ListingsUrlState): boolean {
  return Boolean(url.q) || FILTER_URL_KEYS.some((k) => {
    const v = url[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
}

// ─── Read API ───────────────────────────────────────────────────────────────

export class ListingsFetchError extends Error {
  status: number;
  code?: ListingsErrorCode;
  errorId?: string;
  constructor(status: number, code?: ListingsErrorCode, errorId?: string) {
    super(`listings ${status}${code ? ` ${code}` : ''}`);
    this.status = status;
    this.code = code;
    this.errorId = errorId;
  }
}

export async function listingsFetcher(key: string): Promise<ListingsResponse> {
  const res = await fetch(key, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: ListingsErrorCode; errorId?: string };
    throw new ListingsFetchError(res.status, body.error, body.errorId);
  }
  return res.json();
}

export function listingsKey(query: ListingsQuery): string {
  return `/api/listings?${toListingsSearchParams(query).toString()}`;
}

/** Live events that revalidate the list (DB-only). */
export const LISTINGS_LIVE_EVENTS = ['listing.changed', 'listing.removed', 'sync.finished'] as const;

export type UseListingsResult = {
  data: ListingsResponse | undefined;
  rows: ListingRow[];
  total: number | undefined;
  state: AsyncState;
  /** The visible data belongs to a previous query while the new one loads (60% opacity rule, §7). */
  refetching: boolean;
  isValidating: boolean;
  error: ListingsFetchError | undefined;
  retry: () => void;
  mutate: () => Promise<unknown>;
  /** When the stale data was last good (ErrorState stale). */
  lastGoodAt: Date | null;
};

// ─── Last-visit seed (per viewer, per query) ────────────────────────────────

/** localStorage key of the last-visit seed. Per-viewer convenience only: the server list always replaces it. */
export const LISTINGS_SEED_STORAGE_KEY = 'kx.listings.seed.v1';
/** Queries remembered (most recent first) and how long a seed may be shown. */
export const LISTINGS_SEED_MAX = 4;
export const LISTINGS_SEED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type SeedEntry = { scope: string; key: string; at: number; data: ListingsResponse };

function readSeeds(): SeedEntry[] {
  try {
    const raw = window.localStorage.getItem(LISTINGS_SEED_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as SeedEntry[]).filter((e) => e && typeof e.key === 'string' && typeof e.scope === 'string' && e.data && Array.isArray(e.data.rows)) : [];
  } catch {
    return [];
  }
}

/** The remembered response for this viewer + query, or undefined (pure over storage; never throws). */
export function readListingsSeed(scope: string | null | undefined, key: string | null, now = Date.now()): ListingsResponse | undefined {
  if (!scope || !key || typeof window === 'undefined') return undefined;
  const hit = readSeeds().find((e) => e.scope === scope && e.key === key);
  return hit && now - hit.at <= LISTINGS_SEED_MAX_AGE_MS ? hit.data : undefined;
}

/** Remembers the latest response (other viewers' entries are dropped: one browser, one seller at a time). */
export function writeListingsSeed(scope: string | null | undefined, key: string | null, data: ListingsResponse, now = Date.now()): void {
  if (!scope || !key || typeof window === 'undefined') return;
  try {
    const rest = readSeeds().filter((e) => e.scope === scope && e.key !== key);
    const next = [{ scope, key, at: now, data }, ...rest].slice(0, LISTINGS_SEED_MAX);
    window.localStorage.setItem(LISTINGS_SEED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the page works without the seed */
  }
}

export function useListings(query: ListingsQuery | null, opts: { live?: boolean; cacheScope?: string | null } = {}): UseListingsResult {
  const key = query ? listingsKey(query) : null;
  const scope = opts.cacheScope ?? null;
  // Rows from the viewer's last visit (same query) render instantly; SWR still fetches and replaces them, and
  // `refetching` dims them meanwhile. The skeleton shows only on a true first load.
  const seed = React.useMemo(() => readListingsSeed(scope, key), [scope, key]);
  const swr = useSWR<ListingsResponse, ListingsFetchError>(key, listingsFetcher, {
    fallbackData: seed,
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    shouldRetryOnError: (err: unknown) => !(err instanceof ListingsFetchError && err.status < 500),
  });
  const region = useAsyncRegion(swr, { isEmpty: () => false });

  const [lastGoodAt, setLastGoodAt] = React.useState<Date | null>(null);
  React.useEffect(() => {
    if (swr.data && !swr.error) setLastGoodAt(new Date());
  }, [swr.data, swr.error]);
  // Remember only server responses (not the seed itself) for the next visit.
  React.useEffect(() => {
    if (swr.data && swr.data !== seed && !swr.isLoading && !swr.error) writeListingsSeed(scope, key, swr.data);
  }, [swr.data, swr.isLoading, swr.error, seed, scope, key]);

  const mutate = React.useCallback(() => swr.mutate(), [swr]);
  useLiveRevalidate(LISTINGS_LIVE_EVENTS, mutate, { throttleMs: 2000, enabled: opts.live !== false && Boolean(key) });

  const data = swr.data;
  return {
    data,
    rows: data?.rows ?? [],
    total: data ? data.total : undefined,
    state: region.state,
    refetching: Boolean(data && swr.isLoading),
    isValidating: swr.isValidating,
    error: swr.error,
    retry: region.retry,
    mutate,
    lastGoodAt,
  };
}

// ─── Pull ("Refresh from …") ────────────────────────────────────────────────

export type PullState = 'idle' | 'pulling' | 'failed';

export type UsePullResult = {
  state: PullState;
  /** 402 from the pull (usage limit, CRITIQUE C6). */
  limitHit: boolean;
  /** The pull answered 200 with `partial: true` (some pages failed, W3 §2d). */
  partial: boolean;
  run: () => Promise<{ ok: boolean; synced?: number }>;
};

export function usePull(
  config: Pick<ListingsConfig, 'pull'>,
  ctx: { storeId: string | null; userId: string | null },
  onDone: () => Promise<unknown> | void,
): UsePullResult {
  const [state, setState] = React.useState<PullState>('idle');
  const [limitHit, setLimitHit] = React.useState(false);
  const [partial, setPartial] = React.useState(false);
  const busy = React.useRef(false);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  const run = React.useCallback(async () => {
    if (busy.current) return { ok: false };
    busy.current = true;
    setState('pulling');
    try {
      const req = config.pull(ctx);
      const res = await fetch(req.url, { method: req.method, credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as { partial?: boolean; synced?: number };
      if (res.status === 402) {
        setLimitHit(true);
        setState('idle');
        return { ok: false };
      }
      if (!res.ok) {
        setState('failed');
        return { ok: false };
      }
      setLimitHit(false);
      setPartial(Boolean(body.partial));
      setState('idle');
      await onDoneRef.current();
      return { ok: true, synced: typeof body.synced === 'number' ? body.synced : undefined };
    } catch {
      setState('failed');
      return { ok: false };
    } finally {
      busy.current = false;
    }
  }, [config, ctx]);

  return { state, limitHit, partial, run };
}

export type { BuiltInViewKey };

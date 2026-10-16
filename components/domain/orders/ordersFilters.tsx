// components/domain/orders/ordersFilters.tsx (orders G2) — URL state, built-in views, view defaults and the
// toolbar filter definitions of the Orders list (orders §1.2, §1.3, §3.2).
//
// Everything here is pure except `ordersFilterDefs`' render callback (it renders the DS DateRangeField).
// The server query object handed to `useOrdersList` is built in ONE place (`toOrdersQuery`).
import * as React from 'react';
import { urlField, type UrlQuery, type UrlStateOf } from '@/lib/ds/useUrlState';
import { DateRangeField, resolvePreset, type DateRangeValue, type PresetKey } from '@/components/ds/inputs/DateRangeField';
import { LogoTile } from '@/components/ds/data/LogoTile';
import type { FilterDef, FilterValues, SavedView } from '@/components/ds/toolbar';
import type {
  OrderSearchIn,
  OrderSortKey as ApiSortKey,
  OrderStatusFilterKey,
  OrderViewKey as ApiViewKey,
  OrdersQuery,
  SortDir as ApiSortDir,
  ViewCounts,
} from '@/lib/orders/types';
import { migrateLegacyOrdersQuery } from '@/lib/orders/legacyQuery';
import { ORDER_VIEWS as API_ORDER_VIEWS } from '@/lib/orders/views';

// ── vocabularies ────────────────────────────────────────────────────────────────────────────────────────

export const ORDER_VIEWS = ['all', 'to_ship', 'overdue', 'label_created', 'shipped', 'problems'] as const satisfies readonly ApiViewKey[];
export type OrderViewKey = (typeof ORDER_VIEWS)[number];

export const SEARCH_IN = ['all', 'customer', 'order', 'tracking', 'product', 'sku', 'city', 'phone', 'note'] as const satisfies readonly OrderSearchIn[];
export type SearchInKey = (typeof SEARCH_IN)[number];

/** Normalized order status keys (DS §3.9 order domain), the values of the Status filter. */
export const STATUS_FILTER_KEYS = [
  'to_ship',
  'overdue',
  'label_created',
  'shipped',
  'delivered',
  'on_hold',
  'problem',
  'cancelled',
  'refunded',
  'label_failed',
] as const satisfies readonly OrderStatusFilterKey[];
export type StatusFilterKey = (typeof STATUS_FILTER_KEYS)[number];

export const SORT_KEYS = ['orderedAt', 'shipBy', 'total', 'customer', 'store'] as const satisfies readonly ApiSortKey[];
export type OrderSortKey = (typeof SORT_KEYS)[number];
export type SortDir = ApiSortDir;

/** `any` = the user cleared a view's default dates ("Any date"). */
export const DATE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'last90', 'thisMonth', 'lastMonth', 'thisYear', 'custom', 'any'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];
export const TOOLBAR_DATE_PRESETS: PresetKey[] = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth', 'thisYear', 'custom'];

export const PANELS = ['label', 'bulk-label', 'manual'] as const;
export type OrdersPanelKey = (typeof PANELS)[number];

export const PAGE_SIZES = [50, 100, 250] as const;

/** Mobile "Sort" select (orders §3.2): one option = sort + dir. */
export const SORT_OPTIONS = [
  { id: 'orderedAtDesc', sort: 'orderedAt', dir: 'desc' },
  { id: 'orderedAtAsc', sort: 'orderedAt', dir: 'asc' },
  { id: 'shipByAsc', sort: 'shipBy', dir: 'asc' },
  { id: 'totalDesc', sort: 'total', dir: 'desc' },
  { id: 'totalAsc', sort: 'total', dir: 'asc' },
  { id: 'customerAsc', sort: 'customer', dir: 'asc' },
] as const satisfies readonly { id: string; sort: OrderSortKey; dir: SortDir }[];

// ── URL schema (orders §1.2) ────────────────────────────────────────────────────────────────────────────

export const ORDERS_URL_SCHEMA = {
  /** A built-in view key or a user saved-view id (`u_…`). */
  view: urlField.string('all', { maxLength: 64 }),
  /** Built-in base of a user saved view (only meaningful while `view` is a user view). */
  base: urlField.optionalEnum(ORDER_VIEWS),
  q: urlField.string(undefined, { maxLength: 200 }),
  in: urlField.enum(SEARCH_IN, 'all'),
  store: urlField.list(),
  status: urlField.list({ values: STATUS_FILTER_KEYS }),
  from: urlField.date(),
  to: urlField.date(),
  preset: urlField.optionalEnum(DATE_PRESETS),
  sort: urlField.optionalEnum(SORT_KEYS),
  dir: urlField.optionalEnum(['asc', 'desc'] as const),
  page: urlField.int(1, { min: 1 }),
  size: urlField.int(50, { allowed: PAGE_SIZES }),
  open: urlField.string(undefined, { maxLength: 64 }),
  panel: urlField.optionalEnum(PANELS),
};
export type OrdersUrlSchema = typeof ORDERS_URL_SCHEMA;
export type OrdersUrlState = UrlStateOf<OrdersUrlSchema>;

/** Keys a saved view remembers (never page, open or panel). */
export const SAVED_VIEW_KEYS = ['q', 'in', 'store', 'status', 'from', 'to', 'preset', 'sort', 'dir'] as const;

// ── views (orders §1.3) ─────────────────────────────────────────────────────────────────────────────────

export type ViewDefaults = { preset?: Exclude<PresetKey, 'custom'>; sort: OrderSortKey; dir: SortDir; showCount: boolean };

/** UI view of G1's `ORDER_VIEWS` (lib/orders/views.ts), the single definition of each view's defaults. */
export const VIEW_DEFAULTS: Record<OrderViewKey, ViewDefaults> = Object.fromEntries(
  ORDER_VIEWS.map((v) => {
    const def = API_ORDER_VIEWS[v];
    const preset = def.defaultPreset === 'any' ? undefined : (def.defaultPreset as Exclude<PresetKey, 'custom'>);
    const sort = (SORT_KEYS as readonly string[]).includes(def.sort) ? (def.sort as OrderSortKey) : 'orderedAt';
    return [v, { preset, sort, dir: def.dir, showCount: def.counted }];
  }),
) as Record<OrderViewKey, ViewDefaults>;

export function isBuiltInView(id: string | undefined | null): id is OrderViewKey {
  return (ORDER_VIEWS as readonly string[]).includes(String(id));
}

/** The built-in view the server filters on: the view itself, or a user view's base (default To ship). */
export function baseViewOf(state: Pick<OrdersUrlState, 'view' | 'base'>): OrderViewKey {
  if (isBuiltInView(state.view)) return state.view;
  return state.base ?? 'all';
}

const VIEW_LABEL_KEY: Record<OrderViewKey, string> = {
  to_ship: 'toShip',
  overdue: 'overdue',
  label_created: 'labelCreated',
  shipped: 'shipped',
  problems: 'problems',
  all: 'all',
};

export function viewLabelKey(view: OrderViewKey): string {
  return `views.${VIEW_LABEL_KEY[view]}`;
}

const COUNT_KEY: Partial<Record<OrderViewKey, keyof ViewCounts>> = {
  to_ship: 'to_ship',
  overdue: 'overdue',
  label_created: 'label_created',
  problems: 'problems',
};

/** Count shown next to a built-in view; undefined when the view shows none or counts are unknown. */
export function viewCount(view: OrderViewKey, counts: ViewCounts | null | undefined): number | undefined {
  const key = COUNT_KEY[view];
  if (!key || !counts || !VIEW_DEFAULTS[view].showCount) return undefined;
  const n = (counts as Record<string, unknown>)[key as string];
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** SavedViews entries: the six built-ins (with counts) then the viewer's own views. */
export function builtInViews(
  t: (key: string) => string,
  counts: ViewCounts | null | undefined,
  userViews: readonly SavedView[] = [],
): SavedView[] {
  const builtIns: SavedView[] = ORDER_VIEWS.map((v) => ({
    id: v,
    label: t(viewLabelKey(v)),
    builtIn: true,
    count: viewCount(v, counts),
    countTone: v === 'overdue' && (viewCount(v, counts) ?? 0) > 0 ? 'danger' : 'neutral',
  }));
  return [...builtIns, ...userViews.map((u) => ({ ...u, builtIn: false }))];
}

/** The query a user saved view stores (current filters + its built-in base). */
export function savedViewQuery(state: OrdersUrlState): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = { base: baseViewOf(state) };
  for (const k of SAVED_VIEW_KEYS) {
    const v = state[k];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (k === 'in' && v === 'all') continue;
    out[k] = Array.isArray(v) ? [...v] : String(v);
  }
  return out;
}

/** URL patch that applies a view: a built-in resets every filter; a user view restores its query. */
export function applyViewPatch(id: string, userViews: readonly SavedView[]): Partial<OrdersUrlState> {
  const cleared: Partial<OrdersUrlState> = {
    base: undefined,
    q: undefined,
    in: 'all',
    store: [],
    status: [],
    from: undefined,
    to: undefined,
    preset: undefined,
    sort: undefined,
    dir: undefined,
    page: 1,
  };
  if (isBuiltInView(id)) return { ...cleared, view: id };
  const saved = userViews.find((v) => v.id === id);
  if (!saved) return { ...cleared, view: 'all' };
  const q = saved.query ?? {};
  const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
  const list = (k: string) => (Array.isArray(q[k]) ? (q[k] as string[]) : typeof q[k] === 'string' ? [q[k] as string] : []);
  const pick = <T extends string>(k: string, allowed: readonly T[]): T | undefined => {
    const v = str(k);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  return {
    ...cleared,
    view: id,
    base: pick('base', ORDER_VIEWS),
    q: str('q'),
    in: pick('in', SEARCH_IN) ?? 'all',
    store: list('store'),
    status: list('status').filter((s): s is StatusFilterKey => (STATUS_FILTER_KEYS as readonly string[]).includes(s)),
    from: str('from'),
    to: str('to'),
    preset: pick('preset', DATE_PRESETS),
    sort: pick('sort', SORT_KEYS),
    dir: pick('dir', ['asc', 'desc'] as const),
  };
}

// ── effective values (view defaults applied) ────────────────────────────────────────────────────────────

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(day: string | undefined): Date | null {
  const m = day ? DAY_RE.exec(day) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDay(d: Date | null | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when the URL carries an explicit date choice (otherwise the view default applies). */
export function hasExplicitDates(state: Pick<OrdersUrlState, 'from' | 'to' | 'preset'>): boolean {
  return Boolean(state.preset || state.from || state.to);
}

/**
 * The date range in force: explicit URL choice, else the view default (Shipped / All = last 30 days).
 * Search ignores dates (current API behavior, orders §1.2), so a query `q` returns no range.
 */
export function effectiveDateRange(state: OrdersUrlState, now: Date = new Date()): { from: Date | null; to: Date | null; preset?: PresetKey } {
  if (state.q) return { from: null, to: null };
  if (state.preset === 'any') return { from: null, to: null };
  if (state.preset && state.preset !== 'custom') {
    const r = resolvePreset(state.preset, now);
    return { ...r, preset: state.preset };
  }
  if (state.preset === 'custom' || state.from || state.to) {
    return { from: parseDay(state.from), to: parseDay(state.to), preset: 'custom' };
  }
  const def = VIEW_DEFAULTS[baseViewOf(state)].preset;
  if (def) return { ...resolvePreset(def, now), preset: def };
  return { from: null, to: null };
}

export function effectiveSort(state: OrdersUrlState): { key: OrderSortKey; dir: SortDir } {
  const def = VIEW_DEFAULTS[baseViewOf(state)];
  if (state.sort) return { key: state.sort, dir: state.dir ?? (state.sort === 'shipBy' ? 'asc' : 'desc') };
  return { key: def.sort, dir: def.dir };
}

/** The one place the server query is built (handed to G1's `useOrdersList`). */
export function toOrdersQuery(state: OrdersUrlState, now: Date = new Date()): OrdersQuery {
  const view = baseViewOf(state);
  const range = effectiveDateRange(state, now);
  const sort = effectiveSort(state);
  const from = toDay(range.from);
  const to = toDay(range.to);
  const query: OrdersQuery = {
    view,
    in: state.in,
    sort: sort.key,
    dir: sort.dir,
    page: state.page,
    size: state.size,
  };
  if (state.q) query.q = state.q;
  if (state.store.length) query.store = [...state.store];
  if (state.status.length) query.status = [...state.status];
  if (from) query.from = from;
  if (to) query.to = to;
  // No range on a view that has default dates (Shipped/All, or a search): tell the server "any date",
  // otherwise it would apply the view's last-30-days default again.
  if (!from && !to && (VIEW_DEFAULTS[view].preset || state.preset === 'any')) query.preset = 'any';
  return query;
}

/** True when any filter differs from the view defaults (drives the no-results vs view-done empty state). */
export function hasActiveFilters(state: OrdersUrlState): boolean {
  return Boolean(state.q || state.store.length || state.status.length || hasExplicitDates(state) || state.in !== 'all');
}

// ── legacy query migration on mount (orders §1.2, BUILD_PLAN §7 item 9) ────────────────────────────────

/**
 * Runs once when the router is ready (useUrlState `migrate`): G1's `migrateLegacyOrdersQuery` rewrites
 * bookmarks and notification links (`label=unlabeled`, `mp`, `qt`, raw statuses, legacy sort) and the live
 * new-order link `?highlight=<id>` → `?open=<id>` (BUILD_PLAN §7 item 9). Returns null when nothing changes.
 */
export function migrateOrdersQuery(query: UrlQuery): UrlQuery | null {
  const { query: next, changed } = migrateLegacyOrdersQuery(query);
  return changed ? (next as UrlQuery) : null;
}

// ── toolbar filters (DS §3.3, orders §0.2) ──────────────────────────────────────────────────────────────

export type StoreOption = { value: string; label: string; count?: number; brand?: string | null };

export type OrdersFilterLabels = {
  store: string;
  storeAll: string;
  status: string;
  orderDate: string;
  anyDate: string;
  searchIn: string;
  sort: string;
  statusLabel: (key: StatusFilterKey) => string;
  searchInLabel: (key: SearchInKey) => string;
  sortLabel: (id: (typeof SORT_OPTIONS)[number]['id']) => string;
};

/** Store · Status · Order date (pinned), then Search in and (mobile only) Sort inside the FiltersSheet. */
export function ordersFilterDefs(
  labels: OrdersFilterLabels,
  stores: readonly StoreOption[],
  opts: {
    mobile: boolean;
    /** The view's default range, shown in the field while the URL has no explicit date (Shipped/All: 30 days). */
    dateDefault?: DateRangeValue | null;
  },
): FilterDef[] {
  const defs: FilterDef[] = [
    {
      key: 'store',
      label: labels.store,
      type: 'multiselect',
      pinned: true,
      allLabel: labels.storeAll,
      options: stores.map((s) => ({
        value: s.value,
        label: s.label,
        count: s.count,
        leading: <LogoTile brand={s.brand || s.value} size={16} />,
      })),
    },
    {
      key: 'status',
      label: labels.status,
      type: 'multiselect',
      pinned: true,
      options: STATUS_FILTER_KEYS.map((k) => ({ value: k, label: labels.statusLabel(k) })),
    },
    {
      key: 'date',
      label: labels.orderDate,
      type: 'daterange',
      pinned: true,
      render: ({ value, onChange, placement }) => (
        <DateRangeField
          value={(value as DateRangeValue | undefined) ?? opts.dateDefault ?? { from: null, to: null }}
          onChange={(v) => onChange(v)}
          presets={TOOLBAR_DATE_PRESETS}
          label={placement === 'toolbar' ? labels.orderDate : undefined}
          placeholder={labels.anyDate}
          size="sm"
          data-testid={`orders-date-${placement}`}
        />
      ),
    },
    {
      key: 'in',
      label: labels.searchIn,
      type: 'select',
      allLabel: labels.searchInLabel('all'),
      options: SEARCH_IN.filter((k) => k !== 'all').map((k) => ({ value: k, label: labels.searchInLabel(k) })),
    },
  ];
  if (opts.mobile) {
    defs.push({
      key: 'sort',
      label: labels.sort,
      type: 'select',
      options: SORT_OPTIONS.map((o) => ({ value: o.id, label: labels.sortLabel(o.id) })),
    });
  }
  return defs;
}

/** URL state → FilterBar values. The date value is only set for an explicit choice (chips = non-default). */
export function toFilterValues(state: OrdersUrlState, now: Date = new Date()): FilterValues {
  const values: FilterValues = {
    store: state.store,
    status: state.status,
    in: state.in === 'all' ? undefined : state.in,
  };
  if (hasExplicitDates(state)) {
    // `any` on a dated view is a real choice ("Any date"), but it has no range: chip-free, field empty.
    if (state.preset !== 'any') {
      const r = effectiveDateRange({ ...state, q: undefined }, now);
      values.date = { from: r.from, to: r.to, preset: r.preset };
    }
  }
  if (state.sort) {
    const dir = effectiveSort(state).dir;
    const opt = SORT_OPTIONS.find((o) => o.sort === state.sort && o.dir === dir);
    if (opt) values.sort = opt.id;
  }
  return values;
}

/** Same date choice (a named preset compares by key, a custom range by its days). */
function sameDateValue(a: DateRangeValue | undefined, b: DateRangeValue | undefined): boolean {
  if (!a || !b) return !a && !b;
  const named = (v: DateRangeValue) => (v.preset && v.preset !== 'custom' ? v.preset : null);
  if (named(a) || named(b)) return named(a) === named(b);
  return toDay(a.from) === toDay(b.from) && toDay(a.to) === toDay(b.to);
}

/**
 * FilterBar values → URL patch. Every filter change sets `page: 1` explicitly (useUrlState also resets it).
 * The date keys are only written when the date value itself changed: FilterBar re-emits every value on
 * any change, and a view's default range (Shipped / All: last 30 days) is not in the values, so an
 * untouched date must not read as "cleared" (that would write preset=any and widen the list).
 */
export function fromFilterValues(values: FilterValues, state: OrdersUrlState, now: Date = new Date()): Partial<OrdersUrlState> {
  const patch: Partial<OrdersUrlState> = {
    store: Array.isArray(values.store) ? (values.store as string[]) : [],
    status: (Array.isArray(values.status) ? (values.status as string[]) : []).filter((s): s is StatusFilterKey =>
      (STATUS_FILTER_KEYS as readonly string[]).includes(s),
    ),
    in: typeof values.in === 'string' && (SEARCH_IN as readonly string[]).includes(values.in) ? (values.in as SearchInKey) : 'all',
    page: 1,
  };
  const date = values.date as DateRangeValue | undefined;
  const prevDate = toFilterValues(state, now).date as DateRangeValue | undefined;
  if (sameDateValue(date, prevDate)) {
    // Date untouched: keep from/to/preset as they are.
  } else if (!date || (!date.from && !date.to && (!date.preset || date.preset === 'custom'))) {
    // Cleared in the field: a view with default dates (Shipped, All) needs an explicit "Any date",
    // otherwise its last-30-days default would silently come back. ("Clear all" resets to the view instead.)
    const viewHasDefault = Boolean(VIEW_DEFAULTS[baseViewOf(state)].preset);
    Object.assign(patch, { from: undefined, to: undefined, preset: viewHasDefault ? 'any' : undefined });
  } else if (date.preset && date.preset !== 'custom') {
    Object.assign(patch, { preset: date.preset, from: undefined, to: undefined });
  } else {
    Object.assign(patch, { preset: 'custom', from: toDay(date.from), to: toDay(date.to) });
  }
  if ('sort' in values) {
    const opt = SORT_OPTIONS.find((o) => o.id === values.sort);
    Object.assign(patch, opt ? { sort: opt.sort, dir: opt.dir } : { sort: undefined, dir: undefined });
  }
  return patch;
}

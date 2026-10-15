/**
 * Legacy `/app/labels` URL params → the new Orders URL state (orders §1.2 "Legacy params").
 *
 * Bookmarks and notification links still carry the old keys (`label`, `mp`, `qt`, Turkish
 * status groups, `sort=newest`, `?highlight=`). `migrateLegacyOrdersQuery` rewrites them once
 * on load (OrdersPage, G2: `router.replace` with `changed === true`). Pure.
 */
import type { OrderSortKey, OrderStatusFilterKey, OrderViewKey, SortDir } from './types';

export type QueryRecord = Record<string, string | string[] | undefined>;

const LABEL_TO_VIEW: Record<string, OrderViewKey> = {
  unlabeled: 'to_ship',
  labeled: 'label_created',
  failed: 'problems',
  all: 'all',
};

/** Legacy status groups (STATUS_FILTER_GROUPS keys) → normalized keys. Matched case-insensitively. */
const LEGACY_STATUS: Record<string, OrderStatusFilterKey> = {
  onaylandi: 'to_ship',
  kargolandi: 'shipped',
  iptal: 'cancelled',
  delivered: 'delivered',
};

/** Legacy `sort` options (labels.tsx SORT_PARAMS) → sort + dir. `shipBy` and `customer` are also new keys. */
const LEGACY_SORT: Record<string, { sort: OrderSortKey; dir: SortDir }> = {
  newest: { sort: 'orderedAt', dir: 'desc' },
  oldest: { sort: 'orderedAt', dir: 'asc' },
  shipBy: { sort: 'shipBy', dir: 'asc' },
  priceHigh: { sort: 'total', dir: 'desc' },
  priceLow: { sort: 'total', dir: 'asc' },
  customer: { sort: 'customer', dir: 'asc' },
};

/** Old `from=all` meant "no start date". */
const LEGACY_NO_START = 'all';

const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((s) => String(s)).filter((s) => s.trim() !== '');
const first = (v: string | string[] | undefined): string | undefined => list(v)[0];

/** Whether the query uses any legacy key or value (cheap check before rewriting). */
export function hasLegacyOrdersParams(query: QueryRecord): boolean {
  if (['label', 'mp', 'qt', 'highlight'].some((k) => query[k] !== undefined)) return true;
  if (list(query.status).some((s) => LEGACY_STATUS[s.toLowerCase()] !== undefined && s !== 'delivered')) return true;
  const sort = first(query.sort);
  if (sort && query.dir === undefined && LEGACY_SORT[sort]) return true;
  return first(query.from) === LEGACY_NO_START;
}

/**
 * Rewrites legacy params. Unknown keys pass through unchanged; new-format keys win over
 * legacy ones when both are present (`view` over `label`, `store` over `mp`, `in` over `qt`,
 * `open` over `highlight`).
 */
export function migrateLegacyOrdersQuery(query: QueryRecord): { query: Record<string, string | string[]>; changed: boolean } {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(query)) if (v !== undefined) out[k] = v;
  if (!hasLegacyOrdersParams(query)) return { query: out, changed: false };

  const label = first(query.label);
  delete out.label;
  if (label && out.view === undefined && LABEL_TO_VIEW[label]) out.view = LABEL_TO_VIEW[label];

  const mp = list(query.mp);
  delete out.mp;
  if (mp.length > 0 && out.store === undefined) out.store = mp.length === 1 ? mp[0] : mp;

  const qt = first(query.qt);
  delete out.qt;
  if (qt && out.in === undefined) out.in = qt;

  const highlight = first(query.highlight);
  delete out.highlight;
  if (highlight && out.open === undefined) out.open = highlight;

  const statuses = list(query.status);
  if (statuses.length > 0) {
    const mapped = Array.from(new Set(statuses.map((s) => LEGACY_STATUS[s.toLowerCase()] ?? s)));
    out.status = mapped.length === 1 ? mapped[0] : mapped;
  }

  const sort = first(query.sort);
  if (sort && query.dir === undefined && LEGACY_SORT[sort]) {
    out.sort = LEGACY_SORT[sort].sort;
    out.dir = LEGACY_SORT[sort].dir;
  }

  if (first(query.from) === LEGACY_NO_START) {
    delete out.from;
    if (out.preset === undefined) out.preset = 'any';
  }

  return { query: out, changed: true };
}

// DS §1 P3 / §4.1: `useUrlState(schema)`. Filters, sort, search, saved view, page, page size and the
// open record live in the URL query (shareable, survive reload).
//
// - Pages Router (`next/router`), shallow `router.replace` by default (no data refetch by Next, no scroll).
// - Values equal to the field default are omitted from the URL; unrelated query params are preserved.
// - Invalid values (unknown enum, NaN, out of range) read as the default; they are never thrown.
// - `list` fields are written as repeated params (`store=etsy&store=ebay`) or comma lists (`format: 'comma'`)
//   and read in either form.
// - Changing any field resets `page` (when the schema has one) unless the same patch sets `page`.
// - `migrate(query)` runs once when the router is ready (legacy bookmarks, e.g. orders `label=unlabeled`);
//   return a new query to rewrite the URL, or null to keep it.
// - Writes compose across hook instances: the latest written-but-not-yet-navigated query is shared at
//   module level (valid while `router.asPath` is still the one it was written from), so two instances
//   setting in the same tick do not clobber each other.
// - Prefer ONE schema per page, with literal namespaced keys where needed (`'f.material': urlField.list()`),
//   so the page reset rule covers them. A second, prefixed instance must pass `resetsPage: 'page'` to
//   send the user back to page 1 when its filters change.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';

export type UrlQuery = Record<string, string | string[] | undefined>;

type Base<T> = { default: T };
export type StringField = Base<string | undefined> & { type: 'string'; maxLength?: number };
export type IntField = Base<number> & { type: 'int'; min?: number; max?: number; allowed?: readonly number[] };
export type EnumField<V extends string = string> = Base<V> & { type: 'enum'; values: readonly V[] };
export type OptEnumField<V extends string = string> = Base<V | undefined> & { type: 'enum?'; values: readonly V[] };
export type ListField<V extends string = string> = Base<V[]> & { type: 'list'; values?: readonly V[]; format?: 'repeat' | 'comma' };
export type BoolField = Base<boolean> & { type: 'bool' };
export type DateField = Base<string | undefined> & { type: 'date' };

export type UrlField = StringField | IntField | EnumField | OptEnumField | ListField | BoolField | DateField;
export type UrlSchema = Record<string, UrlField>;
export type UrlStateOf<S extends UrlSchema> = { [K in keyof S]: S[K]['default'] };
export type UrlStatePatch<S extends UrlSchema> = Partial<UrlStateOf<S>>;

/** Field constructors (typed defaults). */
export const urlField = {
  string: (def?: string, opts: { maxLength?: number } = {}): StringField => ({ type: 'string', default: def, ...opts }),
  int: (def: number, opts: { min?: number; max?: number; allowed?: readonly number[] } = {}): IntField => ({ type: 'int', default: def, ...opts }),
  enum: <V extends string>(values: readonly V[], def: V): EnumField<V> => ({ type: 'enum', values, default: def }),
  optionalEnum: <V extends string>(values: readonly V[]): OptEnumField<V> => ({ type: 'enum?', values, default: undefined }),
  list: <V extends string = string>(opts: { values?: readonly V[]; default?: V[]; format?: 'repeat' | 'comma' } = {}): ListField<V> => ({
    type: 'list',
    values: opts.values,
    default: opts.default ?? [],
    format: opts.format ?? 'repeat',
  }),
  bool: (def = false): BoolField => ({ type: 'bool', default: def }),
  /** ISO day `YYYY-MM-DD`. */
  date: (def?: string): DateField => ({ type: 'date', default: def }),
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseField(field: UrlField, raw: string | string[] | undefined): unknown {
  switch (field.type) {
    case 'string': {
      const v = first(raw);
      if (v == null || v === '') return field.default;
      return field.maxLength ? v.slice(0, field.maxLength) : v;
    }
    case 'int': {
      const v = first(raw);
      if (v == null || !/^-?\d+$/.test(v)) return field.default;
      const n = Number(v);
      if (field.allowed && !field.allowed.includes(n)) return field.default;
      if (field.min != null && n < field.min) return field.default;
      if (field.max != null && n > field.max) return field.default;
      return n;
    }
    case 'enum':
    case 'enum?': {
      const v = first(raw);
      return v != null && (field.values as readonly string[]).includes(v) ? v : field.default;
    }
    case 'list': {
      if (raw == null) return field.default;
      // An explicit empty value (`store=`) means "none", which differs from a non-empty default.
      if (raw === '' || (Array.isArray(raw) && raw.every((s) => s === ''))) return [];
      const items = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
      const allowed = field.values as readonly string[] | undefined;
      const valid = allowed ? items.filter((s) => allowed.includes(s)) : items;
      const unique = Array.from(new Set(valid));
      return unique.length ? unique : field.default;
    }
    case 'bool': {
      const v = first(raw);
      if (v === '1' || v === 'true') return true;
      if (v === '0' || v === 'false') return false;
      return field.default;
    }
    case 'date': {
      const v = first(raw);
      return v && DAY.test(v) ? v : field.default;
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return a === b;
}

function serializeField(field: UrlField, value: unknown): string | string[] | undefined {
  if (value == null || sameValue(value, field.default)) return undefined;
  switch (field.type) {
    case 'list': {
      const arr = (value as string[]).filter(Boolean);
      if (!arr.length) return field.default.length ? '' : undefined;
      return field.format === 'comma' ? arr.join(',') : arr;
    }
    case 'bool':
      return value ? '1' : '0';
    case 'int':
      return String(value);
    default:
      return value === '' ? undefined : String(value);
  }
}

/** Pure: read typed state from a query object. */
export function parseUrlState<S extends UrlSchema>(schema: S, query: UrlQuery, prefix = ''): UrlStateOf<S> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) out[key] = parseField(field, query[prefix + key]);
  return out as UrlStateOf<S>;
}

/** Pure: write typed state into a query object, preserving keys the schema does not own. */
export function writeUrlState<S extends UrlSchema>(schema: S, base: UrlQuery, state: UrlStateOf<S>, prefix = ''): UrlQuery {
  const next: UrlQuery = { ...base };
  for (const [key, field] of Object.entries(schema)) {
    const v = serializeField(field, (state as Record<string, unknown>)[key]);
    if (v === undefined) delete next[prefix + key];
    else next[prefix + key] = v;
  }
  return next;
}

/** Pure: apply a patch with the page-reset rule. */
export function applyUrlPatch<S extends UrlSchema>(schema: S, prev: UrlStateOf<S>, patch: UrlStatePatch<S>): UrlStateOf<S> {
  const next = { ...prev, ...patch } as UrlStateOf<S>;
  const changedOther = Object.keys(patch).some((k) => k !== 'page' && !sameValue((prev as Record<string, unknown>)[k], (patch as Record<string, unknown>)[k]));
  if ('page' in schema && changedOther && !('page' in patch)) {
    (next as Record<string, unknown>).page = schema.page.default;
  }
  return next;
}

export type UseUrlStateOptions = {
  /** Namespaces the keys (`f.` → `f.status`), e.g. for marketplace-specific filters. */
  prefix?: string;
  /** Default 'replace'. */
  history?: 'replace' | 'push';
  migrate?: (query: UrlQuery) => UrlQuery | null;
  /**
   * An unprefixed query key (usually `'page'`) this instance deletes (back to its default) whenever one
   * of its own fields changes. For a prefixed instance living next to the page's main schema.
   */
  resetsPage?: string;
};

// The last query written but not yet reflected in the router, shared by every instance (see header).
let pendingWrite: { from: string; query: UrlQuery } | null = null;

type RouterLike = { asPath?: string; query?: UrlQuery } | null | undefined;

function baseQuery(router: RouterLike): UrlQuery {
  const asPath = router?.asPath ?? '';
  if (pendingWrite && pendingWrite.from === asPath) return pendingWrite.query;
  pendingWrite = null;
  return (router?.query ?? {}) as UrlQuery;
}

/** Test helper: forget a pending write (module state survives between tests). */
export function __resetUrlStateForTests() {
  pendingWrite = null;
}

export type SetUrlState<S extends UrlSchema> = (
  patch: UrlStatePatch<S> | ((prev: UrlStateOf<S>) => UrlStatePatch<S>),
  opts?: { history?: 'replace' | 'push' },
) => void;

export type UrlStateHelpers<S extends UrlSchema> = {
  /** False until the router has parsed the query (state equals defaults until then). */
  ready: boolean;
  /** Reset every schema field to its default (keeps unrelated params). */
  reset: (opts?: { keep?: (keyof S)[] }) => void;
  /** Build an href query for links (e.g. "Open in grid" with the current view). */
  toQuery: (patch?: UrlStatePatch<S>) => UrlQuery;
  /** Schema keys whose value differs from the default (for "Clear all" / chips). */
  dirtyKeys: (keyof S)[];
};

export function useUrlState<S extends UrlSchema>(
  schema: S,
  options: UseUrlStateOptions = {},
): [UrlStateOf<S>, SetUrlState<S>, UrlStateHelpers<S>] {
  const router = useRouter();
  const { prefix = '', history = 'replace', migrate, resetsPage } = options;
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const query = (router?.query ?? {}) as UrlQuery;
  const ready = Boolean(router?.isReady);

  // Re-parse only when a key we own changes (query object identity changes on every navigation).
  const ownedKey = Object.keys(schema)
    .map((k) => `${k}=${JSON.stringify(query[prefix + k] ?? null)}`)
    .join('&');
  const state = useMemo(() => parseUrlState(schemaRef.current, query, prefix), [ownedKey, prefix]);

  // A navigation landed: a pending write from an older URL no longer applies.
  useEffect(() => {
    if (pendingWrite && pendingWrite.from !== router?.asPath) pendingWrite = null;
  }, [router?.asPath]);

  const navigate = useCallback(
    (nextQuery: UrlQuery, mode: 'replace' | 'push') => {
      pendingWrite = { from: router?.asPath ?? '', query: nextQuery };
      const clean: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(nextQuery)) if (v !== undefined) clean[k] = v;
      const go = mode === 'push' ? router.push : router.replace;
      void go.call(router, { pathname: router.pathname, query: clean }, undefined, { shallow: true, scroll: false });
    },
    [router],
  );

  const setState = useCallback<SetUrlState<S>>(
    (patchOrFn, opts) => {
      const base = baseQuery(router as RouterLike);
      const prev = parseUrlState(schemaRef.current, base, prefix);
      const patch = typeof patchOrFn === 'function' ? patchOrFn(prev) : patchOrFn;
      const next = applyUrlPatch(schemaRef.current, prev, patch);
      const out = writeUrlState(schemaRef.current, base, next, prefix);
      if (resetsPage && Object.keys(patch).some((k) => !sameValue((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k]))) {
        delete out[resetsPage];
      }
      navigate(out, opts?.history ?? history);
    },
    [router, prefix, history, navigate, resetsPage],
  );

  const migrated = useRef(false);
  const migrateRef = useRef(migrate);
  migrateRef.current = migrate;
  useEffect(() => {
    if (!ready || migrated.current || !migrateRef.current) return;
    migrated.current = true;
    const rewritten = migrateRef.current((router.query ?? {}) as UrlQuery);
    if (rewritten) navigate(rewritten, 'replace');
  }, [ready, router, navigate]);

  const helpers = useMemo<UrlStateHelpers<S>>(() => {
    const defaults = parseUrlState(schemaRef.current, {}, prefix);
    return {
      ready,
      reset: (opts) => {
        const base = baseQuery(router as RouterLike);
        const keep = new Set<string>((opts?.keep ?? []) as string[]);
        const current = parseUrlState(schemaRef.current, base, prefix) as Record<string, unknown>;
        const next = { ...defaults } as Record<string, unknown>;
        keep.forEach((k) => {
          next[k] = current[k];
        });
        const out = writeUrlState(schemaRef.current, base, next as UrlStateOf<S>, prefix);
        if (resetsPage) delete out[resetsPage];
        navigate(out, history);
      },
      toQuery: (patch) => {
        const next = patch ? applyUrlPatch(schemaRef.current, state, patch) : state;
        return writeUrlState(schemaRef.current, (router?.query ?? {}) as UrlQuery, next, prefix);
      },
      dirtyKeys: (Object.keys(schemaRef.current) as (keyof S)[]).filter(
        (k) => !sameValue((state as Record<string, unknown>)[k as string], (defaults as Record<string, unknown>)[k as string]),
      ),
    };
  }, [ready, router, prefix, history, navigate, state, resetsPage]);

  return [state, setState, helpers];
}

// lib/research/hooks/useResearchProducts.ts (research R1-C) — client data for Product finder (research.md §5, §10).
//
// GET /api/research/products?q&mkt&country&taxonomyId&sort → `ResearchResponse<ProductsData>` (R1-A contract in
// lib/research/types.ts). Compare mode repeats `q` (≤ 3) on the same endpoint and reads `data.compare`.
// Also: `requestSeeds` (POST /api/research/seeds, Turkish → English seeds, 1 AI credit) and `requestExplain`
// (POST /api/research/explain, 1 AI credit). Nothing here writes to a marketplace.
//
// The payload is normalised defensively (`normalizeProducts`): a missing or malformed field renders "—" instead
// of crashing; every price stays a `PriceSummary` from lib/research/stats (no mean anywhere).
import useSWR from 'swr';
import { useMemo } from 'react';
import { useAsyncRegion, type AsyncRegion } from '@/lib/ds/useAsyncState';
import { decodeEntities, type PriceSummary } from '@/lib/research/stats';
import type {
  BuyerWord,
  DemandInput,
  DemandSignal,
  ExplainData,
  ExplainTool,
  Fact,
  Guarded,
  ProductsData,
  ProductsResult,
  ResearchMkt,
  ResearchResponse,
  ResearchSectionError,
  SeedsData,
  SourceNoteProps,
  TopListing,
} from '@/lib/research/types';

/** Same values as the server (`pages/api/research/products.ts` SORTS). */
export type ProductSort = 'sales' | 'relevance' | 'price.asc' | 'price.desc' | 'favorites' | 'newest';
export const PRODUCT_SORTS: readonly ProductSort[] = ['sales', 'relevance', 'price.asc', 'price.desc', 'favorites', 'newest'];

export type ProductsParams = {
  q: string;
  mkt: ResearchMkt;
  country?: string;
  taxonomyId?: string;
  sort?: ProductSort;
};

// ─── Keys and fetchers ──────────────────────────────────────────────────────────────────────────────────

export class ResearchFetchError extends Error {
  status: number;
  /** i18n key from the error body (`ResearchErrorBody.key`), e.g. `research.error.etsy`. */
  key?: string;
  /** `ResearchErrorBody.error` code. */
  code?: string;
  constructor(status: number, key?: string, code?: string) {
    super(`research request failed (${status})`);
    this.status = status;
    this.key = key;
    this.code = code;
  }
}

function searchParams(p: Omit<ProductsParams, 'q'>, queries: string[]): URLSearchParams {
  const sp = new URLSearchParams();
  for (const q of queries) sp.append('q', q);
  sp.set('mkt', p.mkt);
  if (p.country) sp.set('country', p.country);
  if (p.taxonomyId) sp.set('taxonomyId', p.taxonomyId);
  if (p.sort && p.sort !== 'relevance') sp.set('sort', p.sort);
  return sp;
}

/** SWR key (`/api/research/products?…`), or null when there is nothing to search. */
export function productsKey(p: ProductsParams | null): string | null {
  const q = p?.q?.trim();
  if (!p || !q) return null;
  return `/api/research/products?${searchParams(p, [q]).toString()}`;
}

/** Compare key: `q` repeated (2–3 queries), or null below 2. */
export function compareKey(queries: string[], base: Omit<ProductsParams, 'q'>): string | null {
  const list = Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean))).slice(0, 3);
  if (list.length < 2) return null;
  return `/api/research/products?${searchParams(base, list).toString()}`;
}

async function readError(res: Response): Promise<ResearchFetchError> {
  let key: string | undefined;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: unknown; key?: unknown };
    if (typeof body?.key === 'string') key = body.key;
    if (typeof body?.error === 'string') code = body.error;
  } catch {
    /* non-JSON error body */
  }
  return new ResearchFetchError(res.status, key, code);
}

export async function fetchResearch<T>(url: string): Promise<ResearchResponse<T>> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ResearchResponse<T>;
}

// ─── Normalisation (tolerant of partial payloads) ───────────────────────────────────────────────────────

type Loose = Record<string, unknown>;

const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const params = (v: unknown): Record<string, string | number> => (isObj(v) ? (v as Record<string, string | number>) : {});

function guarded(v: unknown): Guarded<number> {
  if (isObj(v) && 'kind' in v) {
    const g = isObj(v.guard) ? v.guard : {};
    const value = num(v.value);
    return {
      value,
      kind: (v.kind as Guarded<number>['kind']) ?? 'measured',
      guard: { ok: g.ok === undefined ? value !== null : g.ok !== false, reasonKey: str(g.reasonKey) ?? undefined, reasonParams: isObj(g.reasonParams) ? params(g.reasonParams) : undefined },
    };
  }
  const n = num(v);
  return { value: n, kind: 'measured', guard: { ok: n !== null } };
}

export function normalizeTopListing(raw: unknown, fallbackCurrency: string): TopListing | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id) ?? str(raw.listingId) ?? str(raw.listing_id);
  if (!id) return null;
  const priceObj = isObj(raw.price) ? raw.price : null;
  const amount = priceObj ? num(priceObj.amount) : num(raw.price);
  const shopObj = isObj(raw.shop) ? raw.shop : {};
  const convObj = isObj(raw.priceConverted) ? raw.priceConverted : null;
  const convAmount = convObj ? num(convObj.amount) : null;
  const convCurrency = convObj ? str(convObj.currency) : null;
  return {
    id,
    title: decodeEntities(str(raw.title) ?? ''),
    url: str(raw.url),
    thumbUrl: str(raw.thumbUrl) ?? str(raw.imageUrl),
    price: amount === null ? null : { amount, currency: (priceObj ? str(priceObj.currency) : null) ?? str(raw.currency) ?? fallbackCurrency },
    priceConverted: convAmount !== null && convCurrency ? { amount: convAmount, currency: convCurrency } : null,
    favorites: num(raw.favorites),
    ageDays: num(raw.ageDays),
    shop: { id: str(shopObj.id), name: decodeEntities(str(shopObj.name) ?? '') || null, url: str(shopObj.url) },
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => decodeEntities(t)) : [],
    orderBadge: str(raw.orderBadge),
    ratingCount: num(raw.ratingCount),
  };
}

export const EMPTY_PRICE: PriceSummary = {
  n: 0, total: 0, trimmed: 0, median: null, p25: null, p75: null, min: null, max: null,
  currency: 'USD', sampled: 0, excludedNoFx: 0, excludedImplausible: 0, quality: 'insufficient',
};

function factOf(v: unknown): Fact | null {
  return isObj(v) && typeof v.key === 'string' ? { key: v.key, params: params(v.params) } : null;
}

const DEMAND_KEYS: readonly DemandInput['key'][] = ['googleTrends', 'autocomplete', 'engagement'];

function demandOf(v: unknown): DemandSignal {
  const d = isObj(v) ? v : {};
  const tierN = num(d.tier);
  const tier = tierN !== null && tierN >= 1 && tierN <= 5 ? (Math.round(tierN) as 1 | 2 | 3 | 4 | 5) : null;
  const inputs: DemandInput[] = Array.isArray(d.inputs)
    ? d.inputs.filter(isObj).filter((i) => (DEMAND_KEYS as readonly unknown[]).includes(i.key)).map((i) => ({
        key: i.key as DemandInput['key'],
        value: num(i.value),
        normalized: num(i.normalized),
        ok: i.ok !== false && num(i.value) !== null,
        reasonKey: str(i.reasonKey) ?? undefined,
      }))
    : [];
  return { tier, inputs, kind: 'signal' };
}

export function normalizeProducts(raw: unknown, fallback: { query: string; mkt: ResearchMkt; country?: string }): ProductsResult {
  const r = isObj(raw) ? raw : {};
  const price = isObj(r.price) ? ({ ...EMPTY_PRICE, ...(r.price as Partial<PriceSummary>) } as PriceSummary) : EMPTY_PRICE;
  const ev = isObj(r.evidence) ? r.evidence : {};
  const comp = isObj(r.competition) ? r.competition : {};
  const buyerWords: BuyerWord[] = Array.isArray(r.buyerWords)
    ? r.buyerWords.filter(isObj).map((w) => ({ tag: decodeEntities(String(w.tag ?? '')), share: num(w.share) ?? 0, count: num(w.count) ?? 0 })).filter((w) => w.tag)
    : [];
  return {
    query: str(r.query) ?? fallback.query,
    mkt: (str(r.mkt) as ResearchMkt | null) ?? fallback.mkt,
    country: str(r.country) ?? fallback.country ?? 'US',
    evidence: {
      facts: Array.isArray(ev.facts) ? ev.facts.map(factOf).filter((f): f is Fact => f !== null).slice(0, 4) : [],
      confidence: ev.confidence === 'high' || ev.confidence === 'medium' ? ev.confidence : 'low',
      basis: factOf(ev.basis) ?? { key: 'research.evidence.noVolume', params: {} },
    },
    price,
    competition: { total: guarded(comp.total), top5Share: guarded(comp.top5Share) },
    demand: demandOf(r.demand),
    newcomers: guarded(r.newcomers),
    buyerWords,
    top: Array.isArray(r.top) ? r.top.map((t) => normalizeTopListing(t, price.currency)).filter((t): t is TopListing => t !== null) : [],
    categoryHint: str(r.categoryHint),
    draftTags: Array.isArray(r.draftTags) ? r.draftTags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : [],
    fetchedAt: str(r.fetchedAt) ?? new Date(0).toISOString(),
    cached: r.cached === true,
  };
}

/** Pure: "no result" = nothing sampled and no top listing. */
export function isEmptyResult(d: ProductsResult): boolean {
  return d.top.length === 0 && (d.price.sampled ?? 0) === 0;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────────────────────────────────

export type ProductsHookResult = {
  data: ProductsResult | undefined;
  source: SourceNoteProps | undefined;
  errors: ResearchSectionError[];
  /** The Etsy budget breaker fired: results are cached-only (`research.error.budget` banner). */
  budget: boolean;
  /** Fetch error (status + optional i18n key) when the region is `error` / `stale`. */
  error: ResearchFetchError | undefined;
  /** `data: null` that is informational (marketplace not served yet, or budget with nothing cached): an info state. */
  notice: ResearchSectionError | undefined;
  region: AsyncRegion;
  isValidating: boolean;
  mutate: () => void;
};

const SWR_OPTS = { revalidateOnFocus: false, keepPreviousData: true, dedupingInterval: 60_000, shouldRetryOnError: false } as const;

export function errorsOf(res: { errors?: unknown } | undefined): ResearchSectionError[] {
  return Array.isArray(res?.errors) ? (res!.errors as ResearchSectionError[]).filter((e) => e && typeof e.key === 'string' && typeof e.section === 'string') : [];
}

/**
 * `data: null` that is NOT an error (§3.2: an unavailable marketplace is never an error page): the marketplace is
 * not served yet (`section: 'marketplace'`, e.g. Trendyol) or the Etsy budget breaker fired with nothing cached.
 */
export function infoNotice(res: ResearchResponse<unknown> | undefined): ResearchSectionError | undefined {
  if (!res || res.data !== null) return undefined;
  return errorsOf(res).find((e) => e.section === 'marketplace' || e.key === 'research.error.budget');
}

/** `data: null` with any other section error = the tool is unavailable (e.g. eBay unreachable): an error, not "no results". */
function wholeToolError(res: ResearchResponse<unknown> | undefined): ResearchFetchError | undefined {
  if (!res || res.data !== null || infoNotice(res)) return undefined;
  const e = errorsOf(res)[0];
  return new ResearchFetchError(200, e?.key);
}

/** One Product finder search. `params === null` (no query) = idle. */
export function useResearchProducts(p: ProductsParams | null): ProductsHookResult {
  const key = productsKey(p);
  const swr = useSWR<ResearchResponse<ProductsData>>(key, (u: string) => fetchResearch<ProductsData>(u), SWR_OPTS);
  const q = p?.q ?? '';
  const mkt = p?.mkt ?? 'etsy';
  const country = p?.country;
  const unavailable = wholeToolError(swr.data);
  const data = useMemo(
    () => (swr.data && swr.data.data !== null ? normalizeProducts(swr.data.data, { query: q, mkt, country }) : undefined),
    [swr.data, q, mkt, country],
  );
  const error = (swr.error as ResearchFetchError | undefined) ?? unavailable;
  const region = useAsyncRegion(
    { data, error, isLoading: swr.isLoading, isValidating: swr.isValidating, mutate: swr.mutate },
    { isEmpty: isEmptyResult },
  );
  const errors = errorsOf(swr.data);
  return {
    data,
    source: swr.data?.source,
    errors,
    budget: errors.some((e) => e.key === 'research.error.budget'),
    error,
    notice: infoNotice(swr.data),
    region,
    isValidating: swr.isValidating,
    mutate: () => void swr.mutate(),
  };
}

export type CompareEntry = { query: string; data: ProductsResult | null; /** No result: the Etsy budget breaker dropped it. */ budget?: boolean };

/** Same key the server uses for a query (products.ts MAX_QUERY_LEN slice), compared case-insensitively. */
const compareQueryKey = (q: string) => q.trim().slice(0, 120).toLowerCase();

/**
 * Pure: pair each compare query with ITS result by `result.query`, never by position. The server drops a query
 * the Etsy budget breaker stopped (`compare` has no gap), so index matching would shift every later column.
 * Falls back to position only when no result carries a usable `query` and the counts match.
 */
export function matchCompareResults(list: string[], results: unknown[]): (unknown | null)[] {
  const byQuery = new Map<string, unknown>();
  for (const r of results) {
    const q = isObj(r) && typeof r.query === 'string' ? compareQueryKey(r.query) : '';
    if (q && !byQuery.has(q)) byQuery.set(q, r);
  }
  if (byQuery.size === 0 && results.length === list.length) return list.map((_, i) => results[i] ?? null);
  return list.map((q) => byQuery.get(compareQueryKey(q)) ?? null);
}

/** Compare mode: 2–3 queries in one request (`q` repeated → `data.compare`, in order). */
export function useResearchCompare(queries: string[], base: Omit<ProductsParams, 'q'>) {
  const key = compareKey(queries, base);
  const swr = useSWR<ResearchResponse<ProductsData>>(key, (u: string) => fetchResearch<ProductsData>(u), SWR_OPTS);
  const list = useMemo(() => Array.from(new Set(queries.map((q) => q.trim()).filter(Boolean))).slice(0, 3), [queries]);
  const entries = useMemo<CompareEntry[] | undefined>(() => {
    const d = swr.data?.data;
    if (!swr.data) return undefined;
    const results: unknown[] = d && Array.isArray(d.compare) && d.compare.length ? d.compare : d ? [d] : [];
    const budget = errorsOf(swr.data).some((e) => (e.section === 'compare' || e.section === 'all') && e.key === 'research.error.budget');
    const matched = matchCompareResults(list, results);
    return list.map((q, i) => {
      const raw = matched[i];
      return raw
        ? { query: q, data: normalizeProducts(raw, { query: q, mkt: base.mkt, country: base.country }) }
        : { query: q, data: null, budget };
    });
  }, [swr.data, list, base.mkt, base.country]);
  const region = useAsyncRegion({ data: entries, error: swr.error, isLoading: swr.isLoading, isValidating: swr.isValidating, mutate: swr.mutate });
  return { entries: entries ?? [], source: swr.data?.source, errors: errorsOf(swr.data), region, mutate: () => void swr.mutate() };
}

// ─── Actions (AI, 1 credit each) ────────────────────────────────────────────────────────────────────────

/** POST /api/research/seeds → English seeds (≤ 5). Throws `ResearchFetchError` (402 = no AI credits). */
export async function requestSeeds(text: string, mkt: ResearchMkt): Promise<string[]> {
  const res = await fetch('/api/research/seeds', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mkt }),
  });
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as ResearchResponse<SeedsData>;
  const seeds: unknown[] = Array.isArray(body?.data?.seeds) ? body.data.seeds : [];
  return seeds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()).slice(0, 5);
}

/** POST /api/research/explain → numbers-checked text (≤ 600 chars) in the UI locale, or null when unusable. */
export async function requestExplain(tool: ExplainTool, metrics: Record<string, unknown>, locale: 'en' | 'tr'): Promise<ExplainData | null> {
  const res = await fetch('/api/research/explain', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, metrics, locale }),
  });
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as ResearchResponse<ExplainData>;
  const text = body?.data?.text;
  // AI output guard: a non-empty string, capped. Anything else (array, object, empty) = failed.
  if (typeof text !== 'string' || !text.trim()) return null;
  return { text: text.trim().slice(0, 600), locale: body.data!.locale === 'tr' ? 'tr' : 'en', stripped: num(body.data!.stripped) ?? 0 };
}

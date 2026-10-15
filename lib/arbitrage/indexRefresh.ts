/**
 * Keeps the shared Price gap indexes filled (research R4, research.md §9) now that the legacy ArbitrageScanner — the
 * only caller of `/api/clawd/arbitrage` refresh_index — is gone.
 *
 * Per Trendyol category (TRENDYOL_CATEGORIES):
 *   1. Trendyol bestsellers → `TrendyolProductIndex` (HTML scrape, free; rows live 6 h, so every run re-reads them).
 *   2. eBay US active listings → `EbayProductIndex` (Browse API, app token, 1–3 calls; rows live 48 h) — only when the
 *      category's newest eBay row is older than EBAY_REFRESH_AFTER_MS, so the Browse quota is spent ~once a day.
 *   3. Offline AI matches → `ArbitrageMatch` (`matchAndCalculateCategory`: reuses unexpired matches; one AI call per
 *      category only when there are none, i.e. ~once a day).
 *
 * Writes only the shared index tables (no user rows, nothing on a marketplace). Used by the scheduler job
 * `arbitrage-index-refresh` (lib/scheduler/jobs.ts) and by the Price gap "Refresh prices" action
 * (`POST /api/research/price-gap/refresh`, one category, Pro).
 */
import prisma from '../prisma';
import { logger } from '../logger';
import { getApplicationToken } from '../integrations/ebayClient';
import { TRENDYOL_CATEGORIES } from '../integrations/trendyolSearch';
import { CATEGORY_SEARCH_QUERIES, indexEbayCategory } from './ebayIndexer';
import { indexTrendyolCategory } from './trendyolIndexer';
import { matchAndCalculateCategory } from './matcher';

const HOUR_MS = 3_600_000;
/** eBay rows expire after 48 h; refresh a category once its newest row is older than this. */
export const EBAY_REFRESH_AFTER_MS = 20 * HOUR_MS;
/** A manual refresh within this window of the last Trendyol read does nothing (the prices are already that fresh). */
export const MANUAL_REFRESH_COOLDOWN_MS = HOUR_MS;
/** The scheduler cadence: the Trendyol rows live 6 h, so a 6-hourly run keeps the table from going empty. */
export const INDEX_REFRESH_INTERVAL_MINUTES = 6 * 60;

/** Defaults of the legacy scanner (the margin itself is recomputed per viewer on the client). */
const MATCH_PARAMS = { shippingCostUsd: 15, includeInternationalFee: true, highDefectRate: false } as const;

export const INDEXED_CATEGORY_SLUGS: readonly string[] = TRENDYOL_CATEGORIES.map((c) => c.slug);

export function isIndexedCategory(slug: unknown): slug is string {
  return typeof slug === 'string' && INDEXED_CATEGORY_SLUGS.includes(slug);
}

/** Pure: does the eBay side of a category need a new read? `newest` = newest `EbayProductIndex.fetchedAt`. */
export function ebayIndexStale(newest: Date | string | null | undefined, nowMs: number): boolean {
  if (!newest) return true;
  const t = new Date(newest).getTime();
  return !Number.isFinite(t) || nowMs - t >= EBAY_REFRESH_AFTER_MS;
}

/** Newest Trendyol index read of a category (unexpired rows only), or null. */
export async function trendyolIndexUpdatedAt(slug: string, now = new Date()): Promise<Date | null> {
  const row = await prisma.trendyolProductIndex.findFirst({
    where: { categorySlug: slug, expiresAt: { gt: now } },
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true },
  });
  return row?.fetchedAt ?? null;
}

async function ebayIndexUpdatedAt(slug: string): Promise<Date | null> {
  const queries = CATEGORY_SEARCH_QUERIES[slug] ?? [];
  if (queries.length === 0) return null;
  const row = await prisma.ebayProductIndex.findFirst({
    where: { searchQuery: { in: queries } },
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true },
  });
  return row?.fetchedAt ?? null;
}

export interface CategoryRefreshResult {
  slug: string;
  trendyol: number;
  /** null = the eBay side was still fresh (not read). */
  ebay: number | null;
  matched: number | null;
  errors: string[];
}

/** One category: Trendyol re-read, eBay re-read when stale (or `forceEbay`), matches (cached or one AI call). */
export async function refreshArbitrageCategory(
  slug: string,
  opts: { appToken?: () => Promise<string>; nowMs?: number; forceEbay?: boolean } = {},
): Promise<CategoryRefreshResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const out: CategoryRefreshResult = { slug, trendyol: 0, ebay: null, matched: null, errors: [] };
  const tr = await indexTrendyolCategory(slug);
  out.trendyol = tr.indexed;
  if (tr.error) out.errors.push(`trendyol: ${tr.error}`);

  try {
    if (opts.forceEbay || ebayIndexStale(await ebayIndexUpdatedAt(slug), nowMs)) {
      const token = await (opts.appToken ?? getApplicationToken)();
      const eb = await indexEbayCategory(slug, token);
      out.ebay = eb.indexed;
      out.errors.push(...eb.errors.map((e) => `ebay: ${e}`));
    }
  } catch (err) {
    out.errors.push(`ebay: ${(err as Error)?.message ?? String(err)}`);
  }

  try {
    const m = await matchAndCalculateCategory(slug, { ...MATCH_PARAMS });
    out.matched = m.matchStats.exact + m.matchStats.equivalent + m.matchStats.similar;
  } catch (err) {
    out.errors.push(`match: ${(err as Error)?.message ?? String(err)}`);
  }
  return out;
}

export interface IndexRefreshSummary {
  categories: number;
  done: number;
  trendyolRows: number;
  ebayCategories: number;
  failed: number;
  aborted: boolean;
}

/** Every indexed category, sequentially, with a polite pause between Trendyol reads. Stops on abort. */
export async function runArbitrageIndexRefresh(
  opts: { signal?: AbortSignal; slugs?: readonly string[]; nowMs?: number; pauseMs?: number } = {},
): Promise<IndexRefreshSummary> {
  const slugs = opts.slugs ?? INDEXED_CATEGORY_SLUGS;
  const summary: IndexRefreshSummary = { categories: slugs.length, done: 0, trendyolRows: 0, ebayCategories: 0, failed: 0, aborted: false };
  // One app token for the whole run (fetched lazily: a run where every eBay side is fresh asks for none).
  let token: Promise<string> | null = null;
  const appToken = () => (token ??= getApplicationToken());
  const pauseMs = opts.pauseMs ?? 1_000;
  for (const slug of slugs) {
    if (opts.signal?.aborted) {
      summary.aborted = true;
      break;
    }
    try {
      const r = await refreshArbitrageCategory(slug, { appToken, nowMs: opts.nowMs });
      summary.done++;
      summary.trendyolRows += r.trendyol;
      if (r.ebay !== null) summary.ebayCategories++;
      if (r.errors.length) {
        summary.failed++;
        logger.warn('[arbitrage-index-refresh] category had errors', { slug, errors: r.errors.slice(0, 3) });
      }
    } catch (err) {
      summary.failed++;
      logger.warn('[arbitrage-index-refresh] category failed', { slug, error: (err as Error)?.message });
    }
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return summary;
}

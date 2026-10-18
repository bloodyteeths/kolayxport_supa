/**
 * Niche library: the research tool is never empty on a seller's first visit.
 *
 * Every day the `research-niche-library` job researches a fixed list of niches sellers commonly start with (Etsy,
 * official API, US) exactly as Product finder does (`researchEtsy`), registers each niche's top listings with the
 * market index (lib/research/marketIndex) and reads their sales once (lib/etsy/listingStats `getBatchListingStats`).
 * Because it runs daily, those shops get snapshots one day apart and the niche shows MEASURED sales, not estimates.
 * The search result is also left in the shared research cache, so a seller searching one of these niches gets the
 * answer instantly.
 *
 * Each niche's summary (score, typical price, competition, sales and revenue per month over the counted listings)
 * is stored in the shared cache and listed on Research Home ("Strong niches today", /api/research/niches).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { etsyBudgetLimited, formattersFor, readShared, sha1, normalizeQuery, writeShared } from './etsySearch';
import { opportunityOf } from './opportunityScore';
import { registerMarketSet } from './marketIndex';

export const NICHE_TTL_MS = 3 * 86_400_000;
export const NICHE_PREFIX = 'public:niche:etsy:';
export const NICHE_INDEX_KEY = 'public:niche:etsy:index';
const TOP_N = 48;

/** Niches Turkish sellers commonly sell abroad (handmade, home, gifts, jewelry, textile, wedding, baby, ceramics). */
export const SEED_NICHES: readonly string[] = [
  'wooden jewelry box', 'personalized jewelry box', 'ring box', 'keepsake box', 'engraved wooden box', 'watch box',
  'turkish towel', 'peshtemal', 'turkish rug', 'kilim pillow', 'turkish ceramic bowl', 'evil eye bracelet',
  'evil eye necklace', 'nazar boncuk', 'turkish lamp', 'mosaic lamp', 'copper coffee pot', 'turkish tea glasses',
  'leather wallet', 'personalized leather wallet', 'leather bag', 'leather journal', 'leather keychain', 'leather belt',
  'gold necklace', 'name necklace', 'initial necklace', 'birthstone necklace', 'pearl earrings', 'hoop earrings',
  'sterling silver ring', 'stacking rings', 'charm bracelet', 'anklet', 'body chain', 'gemstone ring',
  'wedding guest book', 'wedding sign', 'bridesmaid gift', 'groomsmen gift', 'ring bearer box', 'wedding favors',
  'baby name sign', 'baby blanket', 'baby milestone blanket', 'nursery decor', 'baby keepsake box', 'baby shoes',
  'personalized gift for mom', 'personalized gift for dad', 'grandma gift', 'teacher gift', 'best friend gift', 'couple gift',
  'macrame wall hanging', 'wall art print', 'boho wall decor', 'abstract painting', 'wooden wall art', 'metal wall art',
  'ceramic vase', 'ceramic mug', 'handmade pottery', 'ceramic planter', 'candle holder', 'scented candle',
  'soy candle', 'wax melts', 'incense holder', 'crystal decor', 'resin coaster', 'epoxy table',
  'linen tablecloth', 'linen napkins', 'kitchen towel', 'apron', 'cutting board', 'charcuterie board',
  'wooden spoon', 'olive wood bowl', 'serving tray', 'wine rack', 'spice rack', 'floating shelf',
  'crochet bag', 'knitted sweater', 'wool scarf', 'silk scarf', 'kimono robe', 'linen dress',
  'embroidered pillow', 'pillow cover', 'throw blanket', 'quilt', 'bath robe', 'beach towel',
  'pet collar', 'dog bandana', 'cat bed', 'pet portrait', 'dog tag', 'pet memorial',
  'custom portrait', 'family portrait', 'digital planner', 'wedding invitation', 'birthday card', 'sticker',
  'hair clip', 'scrunchie', 'tote bag', 'makeup bag', 'phone case', 'keychain',
  'christmas ornament', 'advent calendar', 'christmas stocking', 'halloween decor', 'easter basket', 'valentines gift',
];

export interface NicheSummary {
  q: string;
  mkt: 'etsy';
  score: number | null;
  band: 'good' | 'ok' | 'hard' | null;
  typicalPrice: number | null;
  currency: string;
  total: number | null;
  /** Over the counted listings (measured or estimated), per month. */
  salesMonthly: number | null;
  revenueMonthly: number | null;
  counted: number;
  measured: number;
  updatedAt: string;
}

export function nicheKey(q: string): string {
  return `${NICHE_PREFIX}${sha1(normalizeQuery(q))}`;
}

/**
 * Pure: sales/revenue totals over a batch (only real monthly numbers; upper bounds are not added up). Revenue is in
 * each listing's own currency (Turkish shops price in TRY), so it is converted with `fx` (1 unit → target) first;
 * a listing whose currency has no rate is left out of the revenue, never added as if it were the target.
 */
export function totalsOf(listings: Record<string, any>, target = 'USD', fx: Record<string, number> = {}): { sales: number | null; revenue: number | null; counted: number; measured: number } {
  let sales = 0;
  let revenue = 0;
  let counted = 0;
  let measured = 0;
  let revCount = 0;
  for (const s of Object.values(listings)) {
    const m = s?.sales?.monthlySales;
    if (typeof m !== 'number' || (s.sales.kind !== 'measured' && s.sales.kind !== 'estimated')) continue;
    counted++;
    sales += m;
    if (s.sales.kind === 'measured') measured++;
    if (typeof s.sales.monthlyRevenue === 'number') {
      const cur = String(s.currency || target).toUpperCase();
      const rate = cur === target ? 1 : fx[cur];
      if (rate) { revenue += s.sales.monthlyRevenue * rate; revCount++; }
    }
  }
  return { sales: counted ? Math.round(sales) : null, revenue: revCount ? Math.round(revenue) : null, counted, measured };
}

/** One niche: research it, register + read its top listings, store the summary. */
export async function refreshNiche(q: string): Promise<NicheSummary | null> {
  const { researchEtsy } = await import('@/pages/api/research/products');
  const { getBatchListingStats } = await import('@/lib/etsy/listingStats');
  const { result } = await researchEtsy(q, { country: 'US', taxonomyId: null, sort: 'relevance', fmt: formattersFor('en') });
  const ids = result.top.slice(0, TOP_N).map((t) => t.id).filter(Boolean);
  if (!ids.length) return null;
  await registerMarketSet(ids);
  let listings: Record<string, any> = {};
  let want = ids;
  for (let pass = 0; pass < 3 && want.length; pass++) {
    const res = await getBatchListingStats(want, { maxNewShops: 25 });
    listings = { ...listings, ...res.listings };
    want = res.pendingIds;
  }
  const target = result.price?.currency ?? 'USD';
  const { buildFxTable } = await import('./stats');
  const { convertCurrency } = await import('@/lib/finance/fx');
  const fx = await buildFxTable(Object.values(listings).map((l: any) => l?.currency), target, convertCurrency).catch(() => ({}));
  const tot = totalsOf(listings, target, fx);
  const opp = opportunityOf(result);
  const summary: NicheSummary = {
    q,
    mkt: 'etsy',
    score: opp.score,
    band: opp.band,
    typicalPrice: result.price?.median ?? null,
    currency: result.price?.currency ?? 'USD',
    total: result.competition?.total?.guard?.ok ? result.competition.total.value : null,
    salesMonthly: tot.sales,
    revenueMonthly: tot.revenue,
    counted: tot.counted,
    measured: tot.measured,
    updatedAt: new Date().toISOString(),
  };
  await writeShared(nicheKey(q), summary, NICHE_TTL_MS);
  return summary;
}

/** Daily job body: refresh the seed list within the Etsy budget; keep an index of the latest summaries. */
export async function runNicheLibrary(signal?: AbortSignal, list: readonly string[] = SEED_NICHES): Promise<Record<string, unknown>> {
  const summaries: NicheSummary[] = [];
  let failed = 0;
  let stoppedForBudget = false;
  for (const q of list) {
    if (signal?.aborted) break;
    if (etsyBudgetLimited()) { stoppedForBudget = true; break; }
    try {
      const s = await refreshNiche(q);
      if (s) summaries.push(s);
    } catch (err) {
      failed++;
      logger.warn('[nicheLibrary] niche failed', { q, error: (err as Error)?.message });
    }
  }
  // Keep yesterday's summaries for niches not refreshed today (budget/abort).
  const prev = await readShared<NicheSummary[]>(NICHE_INDEX_KEY);
  const byQ = new Map((prev?.data ?? []).map((s) => [s.q, s]));
  for (const s of summaries) byQ.set(s.q, s);
  await writeShared(NICHE_INDEX_KEY, [...byQ.values()], NICHE_TTL_MS);
  return { niches: list.length, refreshed: summaries.length, failed, stoppedForBudget };
}

/** Pure: the cards for Research Home: scored niches with sales, best first. */
export function rankNiches(all: NicheSummary[], limit = 12): NicheSummary[] {
  return all
    .filter((s) => s.score != null && s.salesMonthly != null && s.counted >= 5)
    .sort((a, b) => (b.score as number) - (a.score as number) || (b.revenueMonthly ?? 0) - (a.revenueMonthly ?? 0))
    .slice(0, limit);
}

/** Every stored niche summary (one shared cache row each), so cards appear as soon as a niche is refreshed. */
export async function readNiches(limit = 12): Promise<{ niches: NicheSummary[]; updatedAt: string | null }> {
  const rows = await prisma.researchCache.findMany({
    where: { userId: '__public__', cacheKey: { startsWith: NICHE_PREFIX, not: NICHE_INDEX_KEY } },
    select: { data: true },
    take: 500,
  });
  const all = rows.map((r) => (r.data as any)?.data as NicheSummary).filter((s) => s && typeof s.q === 'string');
  const latest = rows.reduce<string | null>((m, r) => { const at = (r.data as any)?.fetchedAt as string | undefined; return at && (!m || at > m) ? at : m; }, null);
  return { niches: rankNiches(all, limit), updatedAt: latest };
}

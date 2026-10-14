/**
 * SEO experiments built on listing versions + daily stats (owner W3).
 *
 * Cohorts:
 *  - one experiment per batchKey (a bulk/draft sync of N listings = 1 cohort),
 *  - one per listing (per hour) for external Etsy-side edits.
 *  Only title / tags / images changes on ACTIVE listings start a cohort.
 *
 * At creation: before-window views < 30 -> status 'low_traffic' (keeps collecting).
 * seasonal: either window overlaps a holiday range (Nov 15 – Jan 5).
 *
 * Daily evaluator (after the after-window closed):
 *   before = [t-14d, t)       after = [t+1d, t+15d)
 *   control = shop listings with no SEO-relevant versions in either window;
 *             < 5 -> listings of the same taxonomy among them ('category');
 *             none -> 'none' (confidence capped at low).
 *   lift = difference-in-differences on the log rate ratio,
 *   confidence from the Poisson log-rate-ratio z: |z| >= 2.58 high, >= 1.96 medium.
 *   insufficient_data when treated before-views < 30 (or orders < 5 without views).
 *   Overlapping cohorts on the same listing -> 'confounded'.
 *   Rank deltas from RankTrackedKeyword / RankSnapshot.
 * Users get one weekly rollup notification (seoExperimentReady, escalateOn count).
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notify } from '@/lib/notifications';
import { seoChangeKinds } from './listingNormalize';
import { utcDate } from './listingStatsDaily';

const DAY_MS = 24 * 60 * 60_000;
export const DEFAULT_WINDOW_DAYS = 14;
export const MIN_BEFORE_VIEWS = 30;
export const MIN_ORDERS_WITHOUT_VIEWS = 5;
export const MIN_SHOP_CONTROLS = 5;

/** [month (1-12), day] inclusive ranges that wrap the new year when start > end. */
export const HOLIDAY_RANGES: Array<{ start: [number, number]; end: [number, number] }> = [{ start: [11, 15], end: [1, 5] }];

export type Windows = { beforeStart: Date; beforeEnd: Date; afterStart: Date; afterEnd: Date };

export function experimentWindows(changedAt: Date, windowDays = DEFAULT_WINDOW_DAYS): Windows {
  const t = utcDate(changedAt).getTime();
  return {
    beforeStart: new Date(t - windowDays * DAY_MS),
    beforeEnd: new Date(t),
    afterStart: new Date(t + DAY_MS),
    afterEnd: new Date(t + (windowDays + 1) * DAY_MS),
  };
}

function inHoliday(d: Date, ranges = HOLIDAY_RANGES): boolean {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const v = m * 100 + day;
  return ranges.some((r) => {
    const s = r.start[0] * 100 + r.start[1];
    const e = r.end[0] * 100 + r.end[1];
    return s <= e ? v >= s && v <= e : v >= s || v <= e;
  });
}

/** Pure: does [beforeStart, afterEnd) touch a holiday range? */
export function isSeasonal(changedAt: Date, windowDays = DEFAULT_WINDOW_DAYS, ranges = HOLIDAY_RANGES): boolean {
  const w = experimentWindows(changedAt, windowDays);
  for (let t = w.beforeStart.getTime(); t < w.afterEnd.getTime(); t += DAY_MS) {
    if (inHoliday(new Date(t), ranges)) return true;
  }
  return false;
}

/** Pure: cohort key for a version. */
export function cohortKeyFor(a: { batchKey?: string | null; shopId: string; listingId: string | bigint; changedAt: Date }): string {
  if (a.batchKey) return `batch:${a.batchKey}`;
  const hour = new Date(Math.floor(a.changedAt.getTime() / 3_600_000) * 3_600_000).toISOString().slice(0, 13);
  return `ext:${a.shopId}:${String(a.listingId)}:${hour}`;
}

export type Confidence = 'high' | 'medium' | 'low';

export type DidResult = { lift: number | null; logRatio: number | null; se: number | null; z: number | null; confidence: Confidence };

/**
 * Pure: Poisson difference-in-differences on counts.
 * logRatio = ln(Ta/Tb) - ln(Ca/Cb); SE = sqrt(1/Ta + 1/Tb + 1/Ca + 1/Cb).
 * Zero counts get a 0.5 continuity correction. Without a control the
 * treated before/after ratio is used and confidence is capped at 'low'.
 */
export function poissonDid(c: { tb: number; ta: number; cb?: number | null; ca?: number | null }): DidResult {
  const fix = (n: number) => (n > 0 ? n : 0.5);
  if (!(c.tb >= 0) || !(c.ta >= 0)) return { lift: null, logRatio: null, se: null, z: null, confidence: 'low' };
  const tb = fix(c.tb);
  const ta = fix(c.ta);
  const hasControl = c.cb !== null && c.cb !== undefined && c.ca !== null && c.ca !== undefined && (c.cb > 0 || c.ca > 0);
  let logRatio = Math.log(ta / tb);
  let variance = 1 / ta + 1 / tb;
  if (hasControl) {
    const cb = fix(Number(c.cb));
    const ca = fix(Number(c.ca));
    logRatio -= Math.log(ca / cb);
    variance += 1 / ca + 1 / cb;
  }
  const se = Math.sqrt(variance);
  const z = se > 0 ? logRatio / se : 0;
  let confidence: Confidence = Math.abs(z) >= 2.58 ? 'high' : Math.abs(z) >= 1.96 ? 'medium' : 'low';
  if (!hasControl) confidence = 'low';
  return { lift: Math.exp(logRatio) - 1, logRatio, se, z, confidence };
}

export type WindowTotals = { viewsBefore: number; viewsAfter: number; ordersBefore: number; ordersAfter: number; viewsKnown: boolean; listings: number };

export type Classification = {
  status: 'ready' | 'insufficient_data' | 'confounded';
  verdict: 'improved' | 'worse' | 'inconclusive' | null;
  confidence: Confidence | null;
  views: DidResult | null;
  orders: DidResult | null;
};

/** Pure: final status / verdict for an experiment. */
export function classifyExperiment(a: {
  treated: WindowTotals;
  control: WindowTotals | null;
  controlType: 'shop' | 'category' | 'none';
  confounded: boolean;
}): Classification {
  if (a.confounded) return { status: 'confounded', verdict: null, confidence: null, views: null, orders: null };
  const t = a.treated;
  const insufficient = t.viewsKnown ? t.viewsBefore < MIN_BEFORE_VIEWS : t.ordersBefore + t.ordersAfter < MIN_ORDERS_WITHOUT_VIEWS;
  if (insufficient) return { status: 'insufficient_data', verdict: null, confidence: null, views: null, orders: null };
  const c = a.controlType === 'none' ? null : a.control;
  const views = t.viewsKnown ? poissonDid({ tb: t.viewsBefore, ta: t.viewsAfter, cb: c?.viewsBefore, ca: c?.viewsAfter }) : null;
  const orders = poissonDid({ tb: t.ordersBefore, ta: t.ordersAfter, cb: c?.ordersBefore, ca: c?.ordersAfter });
  const primary = views || orders;
  let confidence: Confidence = primary.confidence;
  if (a.controlType === 'none') confidence = 'low';
  const verdict = confidence === 'low' || primary.lift === null ? 'inconclusive' : primary.lift > 0 ? 'improved' : 'worse';
  return { status: 'ready', verdict, confidence, views, orders };
}

/** Pure: ids of experiments that overlap another experiment on a shared listing. */
export function findConfounded(
  exps: Array<{ id: string; listingIds: Array<string | bigint>; changedAt: Date; windowDays: number }>,
): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < exps.length; i++) {
    for (let j = i + 1; j < exps.length; j++) {
      const a = exps[i];
      const b = exps[j];
      const aIds = new Set(a.listingIds.map(String));
      if (!b.listingIds.some((id) => aIds.has(String(id)))) continue;
      const wa = experimentWindows(a.changedAt, a.windowDays);
      const wb = experimentWindows(b.changedAt, b.windowDays);
      // b's change falls inside a's measured span (or vice versa).
      const overlap = wa.beforeStart < wb.afterEnd && wb.beforeStart < wa.afterEnd;
      if (overlap) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB: cohort upsert
// ---------------------------------------------------------------------------

async function viewsInWindow(shopIds: string[], listingIds: bigint[], start: Date, end: Date) {
  if (!listingIds.length) return { views: 0, orders: 0, viewsKnown: false };
  const agg = await prisma.etsyListingDailyStat.aggregate({
    where: { etsyShopId: { in: shopIds }, etsyListingId: { in: listingIds }, date: { gte: start, lt: end } },
    _sum: { views: true, orders: true },
    _count: { views: true },
  });
  return { views: agg._sum.views ?? 0, orders: agg._sum.orders ?? 0, viewsKnown: (agg._count.views ?? 0) > 0 };
}

export async function upsertSeoCohort(a: {
  userId: string;
  shopId: string;
  listingId: bigint;
  versionId: string;
  changedKeys: string[];
  batchKey: string | null;
  changedAt: Date;
  state: string;
}): Promise<string | null> {
  const kinds = seoChangeKinds(a.changedKeys);
  if (!kinds.length || a.state !== 'active') return null;
  const cohortKey = cohortKeyFor({ batchKey: a.batchKey, shopId: a.shopId, listingId: a.listingId, changedAt: a.changedAt });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await prisma.seoExperiment.findUnique({ where: { cohortKey } });
      if (existing) {
        if (!['collecting', 'low_traffic'].includes(existing.status)) return existing.id;
        const listingIds = Array.from(new Set([...existing.listingIds.map(String), String(a.listingId)])).map((s) => BigInt(s));
        const versionIds = Array.from(new Set([...existing.versionIds, a.versionId]));
        const changeKinds = Array.from(new Set([...existing.changeKinds, ...kinds]));
        const w = experimentWindows(existing.changedAt, existing.windowDays);
        const before = await viewsInWindow([a.shopId], listingIds, w.beforeStart, w.beforeEnd);
        await prisma.seoExperiment.update({
          where: { id: existing.id },
          data: { listingIds, versionIds, changeKinds, status: before.views < MIN_BEFORE_VIEWS ? 'low_traffic' : 'collecting' },
        });
        return existing.id;
      }
      const w = experimentWindows(a.changedAt);
      const before = await viewsInWindow([a.shopId], [a.listingId], w.beforeStart, w.beforeEnd);
      try {
        const row = await prisma.seoExperiment.create({
          data: {
            userId: a.userId,
            etsyShopId: a.shopId,
            cohortKey,
            listingIds: [a.listingId],
            versionIds: [a.versionId],
            changeKinds: kinds,
            changedAt: a.changedAt,
            windowDays: DEFAULT_WINDOW_DAYS,
            status: before.views < MIN_BEFORE_VIEWS ? 'low_traffic' : 'collecting',
            seasonal: isSeasonal(a.changedAt),
          },
          select: { id: true },
        });
        return row.id;
      } catch (err: any) {
        if (err?.code === 'P2002') continue; // raced with another refresh of the same batch
        throw err;
      }
    }
  } catch (err: any) {
    logger.warn('upsertSeoCohort failed', { shopId: a.shopId, listingId: String(a.listingId), error: err?.message });
  }
  return null;
}

// ---------------------------------------------------------------------------
// DB: evaluation
// ---------------------------------------------------------------------------

async function totalsFor(shopIds: string[], listingIds: bigint[], w: Windows): Promise<WindowTotals> {
  const [b, a] = await Promise.all([
    viewsInWindow(shopIds, listingIds, w.beforeStart, w.beforeEnd),
    viewsInWindow(shopIds, listingIds, w.afterStart, w.afterEnd),
  ]);
  return {
    viewsBefore: b.views,
    viewsAfter: a.views,
    ordersBefore: b.orders,
    ordersAfter: a.orders,
    viewsKnown: b.viewsKnown && a.viewsKnown,
    listings: listingIds.length,
  };
}

async function pickControls(exp: { userId: string; etsyShopId: string; listingIds: bigint[] }, w: Windows) {
  const treated = new Set(exp.listingIds.map(String));
  const statRows = await prisma.etsyListingDailyStat.findMany({
    where: { etsyShopId: exp.etsyShopId, date: { gte: w.beforeStart, lt: w.afterEnd }, views: { not: null } },
    select: { etsyListingId: true, taxonomyId: true },
    distinct: ['etsyListingId'],
    take: 2000,
  });
  const changed = await prisma.etsyListingVersion.findMany({
    where: {
      etsyShopId: exp.etsyShopId,
      capturedAt: { gte: w.beforeStart, lt: w.afterEnd },
      changedKeys: { hasSome: ['title', 'tags', 'images'] },
    },
    select: { etsyListingId: true },
    distinct: ['etsyListingId'],
  });
  const changedSet = new Set(changed.map((c) => String(c.etsyListingId)));
  const candidates = statRows.filter((r) => !treated.has(String(r.etsyListingId)) && !changedSet.has(String(r.etsyListingId)));
  if (candidates.length >= MIN_SHOP_CONTROLS) {
    return { controlType: 'shop' as const, ids: candidates.slice(0, 500).map((c) => c.etsyListingId) };
  }
  const treatedTax = await prisma.etsyListing.findMany({
    where: { etsyShopId: exp.etsyShopId, etsyListingId: { in: exp.listingIds } },
    select: { taxonomyId: true },
  });
  const tax = new Set(treatedTax.map((t) => t.taxonomyId).filter((x): x is number => x !== null));
  const category = candidates.filter((c) => c.taxonomyId !== null && tax.has(c.taxonomyId));
  if (category.length > 0) return { controlType: 'category' as const, ids: category.map((c) => c.etsyListingId) };
  return { controlType: 'none' as const, ids: [] as bigint[] };
}

async function rankDeltas(userId: string, listingIds: bigint[], w: Windows) {
  const keywords = await prisma.rankTrackedKeyword.findMany({
    where: { userId, etsyListingId: { in: listingIds.map(String) } },
    select: { id: true, keyword: true, etsyListingId: true },
    take: 100,
  });
  const items: Array<{ keyword: string; listingId: string; before: number | null; after: number | null; delta: number | null }> = [];
  for (const k of keywords) {
    const [b, a] = await Promise.all([
      prisma.rankSnapshot.findFirst({
        where: { keywordId: k.id, checkedAt: { gte: w.beforeStart, lt: w.beforeEnd } },
        orderBy: { checkedAt: 'desc' },
        select: { rank: true },
      }),
      prisma.rankSnapshot.findFirst({
        where: { keywordId: k.id, checkedAt: { gte: w.afterStart, lt: w.afterEnd } },
        orderBy: { checkedAt: 'desc' },
        select: { rank: true },
      }),
    ]);
    if (!b && !a) continue;
    const before = b?.rank ?? null;
    const after = a?.rank ?? null;
    items.push({ keyword: k.keyword, listingId: k.etsyListingId, before, after, delta: before !== null && after !== null ? before - after : null });
  }
  const deltas = items.map((i) => i.delta).filter((d): d is number => d !== null);
  return {
    keywords: items.length,
    avgDelta: deltas.length ? Math.round((deltas.reduce((s, d) => s + d, 0) / deltas.length) * 10) / 10 : null,
    items: items.slice(0, 10),
  };
}

export async function evaluateDueExperiments(opts: { now?: Date; signal?: AbortSignal; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const due = await prisma.seoExperiment.findMany({
    where: {
      status: { in: ['collecting', 'low_traffic'] },
      changedAt: { lte: new Date(now.getTime() - (DEFAULT_WINDOW_DAYS + 2) * DAY_MS) },
    },
    orderBy: { changedAt: 'asc' },
    take: opts.limit ?? 200,
  });
  const readyByUser = new Map<string, number>();
  const firstReadyTitle = new Map<string, string>();
  let evaluated = 0;
  for (const exp of due) {
    if (opts.signal?.aborted) break;
    try {
      const w = experimentWindows(exp.changedAt, exp.windowDays);
      const neighbours = await prisma.seoExperiment.findMany({
        where: {
          etsyShopId: exp.etsyShopId,
          id: { not: exp.id },
          status: { not: 'cancelled' },
          listingIds: { hasSome: exp.listingIds },
          changedAt: { gte: new Date(w.beforeStart.getTime() - exp.windowDays * DAY_MS), lt: w.afterEnd },
        },
        select: { id: true, listingIds: true, changedAt: true, windowDays: true },
      });
      const confounded = findConfounded([
        { id: exp.id, listingIds: exp.listingIds, changedAt: exp.changedAt, windowDays: exp.windowDays },
        ...neighbours,
      ]).has(exp.id);
      const treated = await totalsFor([exp.etsyShopId], exp.listingIds, w);
      const controls = await pickControls(exp, w);
      const control = controls.ids.length ? await totalsFor([exp.etsyShopId], controls.ids, w) : null;
      const cls = classifyExperiment({ treated, control, controlType: controls.controlType, confounded });
      const rank = await rankDeltas(exp.userId, exp.listingIds, w).catch(() => null);
      await prisma.seoExperiment.update({
        where: { id: exp.id },
        data: {
          status: cls.status,
          controlType: controls.controlType,
          evaluatedAt: now,
          verdict: cls.verdict,
          confidence: cls.confidence,
          metrics: {
            treated,
            control,
            views: cls.views,
            orders: cls.orders,
            rank,
            windows: {
              before: [w.beforeStart.toISOString(), w.beforeEnd.toISOString()],
              after: [w.afterStart.toISOString(), w.afterEnd.toISOString()],
            },
          } as any,
        },
      });
      evaluated++;
      if (cls.status === 'ready') {
        readyByUser.set(exp.userId, (readyByUser.get(exp.userId) || 0) + 1);
        if (!firstReadyTitle.has(exp.userId)) {
          const l = await prisma.etsyListing
            .findFirst({ where: { etsyShopId: exp.etsyShopId, etsyListingId: { in: exp.listingIds } }, select: { title: true } })
            .catch(() => null);
          firstReadyTitle.set(exp.userId, (l?.title || `#${String(exp.listingIds[0] ?? '')}`).slice(0, 120));
        }
      }
    } catch (err: any) {
      logger.warn('SEO experiment evaluation failed', { id: exp.id, error: err?.message });
    }
  }
  for (const userId of Array.from(readyByUser.keys())) {
    const weekStart = isoWeekStart(now);
    const count = await prisma.seoExperiment.count({ where: { userId, status: 'ready', evaluatedAt: { gte: weekStart } } }).catch(() => 0);
    if (count > 0) {
      void notify(userId, {
        type: 'seoExperimentReady',
        severity: 'info',
        titleKey: 'types.seoExperimentReady',
        // {title} = one of the listings (the W5 template), {count} = experiments ready this week.
        params: { count, title: firstReadyTitle.get(userId) || '' },
        link: '/app/etsy-aktivite?tab=seo',
        dedupeKey: `seo:ready:${weekStart.toISOString().slice(0, 10)}`,
        escalateOn: 'count',
      });
    }
  }
  return { due: due.length, evaluated, usersNotified: readyByUser.size };
}

export function isoWeekStart(d: Date): Date {
  const day = utcDate(d);
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - dow * DAY_MS);
}

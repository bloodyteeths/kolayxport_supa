/**
 * GET /api/research/listings — Listing doctor rows (research.md §7, §10). DB only: never calls a marketplace.
 *
 * Query: `mkt` = etsy | ebay (default etsy) · `shop?` (Etsy shop id; default the user's default shop) ·
 *        `sort` = opportunity | health | views | sales (default opportunity) · `issue?` / `f.issue?` (failing listing
 *        check id, e.g. `photos_count`) · `health?` / `f.health?` = lt50 | 50-74 | 75-89 | gte90 · `q?` (title
 *        contains, or the exact listing id) · `page` (1-based) · `size` = 50 | 100 | 250 (Home uses 3).
 * 200 → ResearchResponse<DoctorData>. Not connected → `data.connected: false` (UI renders ConnectState).
 *
 * Health is computed on read from the cache row with the same `lib/listingScore` scorer the grid and the
 * editor use (the BR-1a stored columns are not required). Views/sales 30 d: `EtsyListingDailyStat` sums
 * (Etsy, "Collecting daily stats" under 7 rows) / `OrderItem.listingRef` quantities (eBay; guarded until eBay
 * order sync stores the item id). Draft overlay: the M5 grid engine (`lib/listings/query.ts` loadRowSync).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { listingStatus } from '@/lib/ds/status';
import { healthFailTokens, scoreCacheRow } from '@/lib/listingScore';
import type { ScoreResult } from '@/lib/listingScore/types';
import type { ListingRow } from '@/lib/listings/types';
import { loadRowSync, schemaCaps, type StoreContext } from '@/lib/listings/query';
import { etsyAdapter } from '@/lib/listings/adapters/etsy';
import { ebayAdapter } from '@/lib/listings/adapters/ebay';
import { decodeEntities } from '@/lib/research/stats';
import { firstParam } from '@/lib/research/etsySearch';
import {
  DOCTOR_WINDOW_DAYS, biggestIssue, ebayDoctorMetrics, etsyDoctorMetrics, failingChecks, sortDoctor, type OpportunityInput,
} from '@/lib/research/opportunity';
import {
  DOCTOR_HEALTH_BANDS, DOCTOR_SORTS, type DoctorData, type DoctorHealthBand, type DoctorRow, type DoctorSort, type DoctorStore, type MainKeyword, type ResearchErrorBody,
  type ResearchResponse, type SourceNoteProps,
} from '@/lib/research/types';

export const DOCTOR_PAGE_SIZES = [3, 50, 100, 250] as const;
const DAY = 86_400_000;

export interface DoctorQuery {
  mkt: 'etsy' | 'ebay';
  shop?: string;
  sort: DoctorSort;
  issue?: string;
  health?: DoctorHealthBand;
  q?: string;
  page: number;
  size: number;
}

/** Health band membership (unscored listings match no band). */
export function inHealthBand(score: number | null, band: DoctorHealthBand): boolean {
  if (score == null) return false;
  if (band === 'lt50') return score < 50;
  if (band === '50-74') return score >= 50 && score < 75;
  if (band === '75-89') return score >= 75 && score < 90;
  return score >= 90;
}

export function parseDoctorQuery(raw: Record<string, unknown>): DoctorQuery | null {
  const mkt = firstParam(raw.mkt) ?? 'etsy';
  if (mkt !== 'etsy' && mkt !== 'ebay') return null;
  const sortRaw = firstParam(raw.sort) ?? 'opportunity';
  const sort = (DOCTOR_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as DoctorSort) : 'opportunity';
  const page = Math.max(1, parseInt(firstParam(raw.page) ?? '1', 10) || 1);
  const sizeRaw = parseInt(firstParam(raw.size) ?? '50', 10);
  const size = (DOCTOR_PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : 50;
  const issue = firstParam(raw.issue) ?? firstParam(raw['f.issue']);
  const healthRaw = firstParam(raw.health) ?? firstParam(raw['f.health']);
  const health = (DOCTOR_HEALTH_BANDS as readonly string[]).includes(healthRaw ?? '') ? (healthRaw as DoctorHealthBand) : undefined;
  return {
    mkt, shop: firstParam(raw.shop), sort, issue: issue && /^[a-z_]{2,40}$/.test(issue) ? issue : undefined,
    ...(health ? { health } : {}), q: firstParam(raw.q)?.slice(0, 120), page, size,
  };
}

interface Scored {
  row: ListingRow;
  score: ScoreResult;
  input: OpportunityInput;
  metrics: Pick<DoctorRow, 'views30d' | 'sales30d' | 'conversion'>;
  mainKeyword?: MainKeyword;
}

const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const tsIso = (sec: number | null | undefined) => (sec && sec > 0 ? new Date(sec * 1000).toISOString() : null);

function health(score: ScoreResult): ListingRow['health'] {
  return {
    score: score.checksUsed > 0 ? score.score : null,
    used: score.checksUsed,
    total: score.checksTotal,
    fails: score.checksUsed > 0 ? healthFailTokens(score) : [],
  };
}

function failingGain(score: ScoreResult): number {
  return failingChecks(score.checks).reduce((s, c) => s + (c.gain ?? 0), 0);
}

function toDoctorRow(s: Scored, rank: number, rule: DoctorRow['opportunity']['rule']): DoctorRow {
  const big = biggestIssue(s.score.checks);
  return {
    listing: s.row,
    ...s.metrics,
    ...(s.mainKeyword ? { mainKeyword: s.mainKeyword } : {}),
    ...(big ? { biggestIssue: { checkId: big.id, label: big.label, params: big.params ?? {}, gain: big.gain ?? 0 } } : {}),
    issues: failingChecks(s.score.checks).length,
    opportunity: { rule, rank },
  };
}

// ─── Etsy ───────────────────────────────────────────────────────────────────

async function loadEtsy(userId: string, q: DoctorQuery, now: Date): Promise<{ data: DoctorData; scored: Scored[] }> {
  const shops = await prisma.etsyShop.findMany({
    where: { userId, isActive: true },
    select: { shopId: true, shopName: true, isDefault: true, lastListingSyncAt: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  const stores = shops.map((s) => ({ id: s.shopId, name: s.shopName || s.shopId }));
  const empty = (store: DoctorStore | null, connected: boolean): DoctorData => ({
    connected, store, stores, rows: [], total: 0, needsWorkTotal: 0, statsSince: null, statsUpdatedAt: null, page: q.page, size: q.size,
  });
  if (shops.length === 0) return { data: empty(null, false), scored: [] };
  const shop = shops.find((s) => s.shopId === q.shop) ?? shops[0];
  const since = new Date(now.getTime() - DOCTOR_WINDOW_DAYS * DAY);

  const [listings, stats, statRange, tracked] = await Promise.all([
    prisma.etsyListing.findMany({
      where: { etsyShopId: shop.shopId, state: 'active' },
      select: {
        etsyListingId: true, title: true, description: true, tags: true, materials: true, priceAmount: true, priceDivisor: true,
        priceCurrencyCode: true, imageCount: true, hasVideo: true, shippingProfileId: true, processingMin: true, itemWeight: true,
        quantity: true, state: true, url: true, views: true, numFavorers: true, hasVariations: true, thumbnailUrl170x135: true,
        thumbnailUrl570xN: true, thumbnailUrl75x75: true, etsyCreatedTimestamp: true, etsyUpdatedTimestamp: true,
      },
      take: 5000,
    }),
    prisma.etsyListingDailyStat.groupBy({
      by: ['etsyListingId'],
      where: { etsyShopId: shop.shopId, date: { gte: since } },
      _sum: { views: true, unitsSold: true },
      _count: { _all: true },
      _min: { date: true },
    }),
    prisma.etsyListingDailyStat.aggregate({ where: { etsyShopId: shop.shopId }, _min: { date: true }, _max: { date: true } }),
    prisma.rankTrackedKeyword.findMany({
      where: { userId, etsyShopId: shop.shopId, isActive: true },
      select: { etsyListingId: true, keyword: true, snapshots: { orderBy: { checkedAt: 'desc' }, take: 1, select: { rank: true } } },
    }),
  ]);

  const statsSince = statRange._min.date ? statRange._min.date.toISOString().slice(0, 10) : null;
  const statBy = new Map(stats.map((s) => [String(s.etsyListingId), s]));
  const trackedBy = new Map<string, Array<{ keyword: string; rank: number | null }>>();
  for (const t of tracked) {
    const arr = trackedBy.get(t.etsyListingId) ?? [];
    arr.push({ keyword: t.keyword, rank: t.snapshots[0]?.rank ?? null });
    trackedBy.set(t.etsyListingId, arr);
  }

  const scored: Scored[] = listings.map((l) => {
    const id = String(l.etsyListingId);
    const score = scoreCacheRow({
      title: l.title, description: l.description, tags: l.tags, materials: l.materials, priceAmount: l.priceAmount,
      priceDivisor: l.priceDivisor, imageCount: l.imageCount, hasVideo: l.hasVideo, shippingProfileId: l.shippingProfileId,
      processingMin: l.processingMin, itemWeight: l.itemWeight,
    }, 'etsy');
    const st = statBy.get(id);
    const sums = { views: st?._sum.views ?? null, sales: st?._sum.unitsSold ?? 0, days: st?._count._all ?? 0 };
    const listingSince = st?._min.date ? st._min.date.toISOString().slice(0, 10) : statsSince;
    const m = etsyDoctorMetrics(sums, listingSince);
    const kw = (trackedBy.get(id) ?? []).sort((a, b) => (a.rank ?? 10_000) - (b.rank ?? 10_000))[0];
    const divisor = l.priceDivisor > 0 ? l.priceDivisor : 100;
    const row: ListingRow = {
      id,
      title: decodeEntities(l.title),
      metaLine: [`ID ${id}`],
      thumbUrl: l.thumbnailUrl170x135 ?? l.thumbnailUrl570xN ?? l.thumbnailUrl75x75 ?? null,
      price: l.priceAmount > 0 ? { amount: l.priceAmount / divisor, currency: l.priceCurrencyCode } : null,
      qty: l.quantity,
      editable: l.hasVariations ? { price: false, qty: false, reason: 'variations' } : { price: true, qty: true },
      status: listingStatus({ state: l.state }, 'etsy'),
      statusRaw: l.state,
      health: health(score),
      updatedAt: tsIso(l.etsyUpdatedTimestamp),
      createdAt: tsIso(l.etsyCreatedTimestamp),
      extra: { views: l.views, favorites: l.numFavorers, photos: l.imageCount, hasVideo: l.hasVideo },
      externalUrl: l.url || `https://www.etsy.com/listing/${id}`,
      sync: null,
    };
    return {
      row,
      score,
      metrics: { views30d: m.views30d, sales30d: m.sales30d, conversion: m.conversion },
      ...(kw ? { mainKeyword: { keyword: kw.keyword, source: 'tracked' as const, rank: kw.rank } } : {}),
      input: {
        id,
        views30d: m.measured ? m.views30d.value : null,
        sales30d: m.measured ? m.sales30d.value : null,
        collecting: !m.measured,
        tracked: !!kw,
        rank: kw?.rank ?? null,
        health: row.health.score,
        failingGain: failingGain(score),
      },
    };
  });

  const store: DoctorStore = {
    id: shop.shopId,
    name: shop.shopName || shop.shopId,
    currency: listings[0]?.priceCurrencyCode ?? null,
    lastPulledAt: isoOrNull(shop.lastListingSyncAt),
  };
  const data = empty(store, true);
  data.statsSince = statsSince;
  data.statsUpdatedAt = statRange._max.date ? statRange._max.date.toISOString() : null;
  return { data, scored };
}

/**
 * Draft overlay on the visible rows: the M5 grid engine (`loadRowSync` + the adapters' draft specs), so the doctor and
 * the listings grid show the same pill, changed fields, send error key and queued-delete state for the same draft.
 */
async function attachDrafts(userId: string, mkt: 'etsy' | 'ebay', store: DoctorStore, rows: DoctorRow[], now: Date): Promise<void> {
  if (rows.length === 0) return;
  const adapter = mkt === 'ebay' ? ebayAdapter : etsyAdapter;
  const ctx: StoreContext = {
    userId,
    store: { id: store.id, name: store.name, currency: store.currency ?? 'USD', lastPulledAt: store.lastPulledAt },
    stores: [],
    storeWhere: {},
    meta: {},
  };
  const sync = await loadRowSync(prisma, adapter.drafts, ctx, schemaCaps(adapter), rows.map((r) => r.listing.id), now);
  for (const r of rows) r.listing.sync = sync.get(r.listing.id) ?? null;
}

// ─── eBay ───────────────────────────────────────────────────────────────────

async function loadEbay(userId: string, q: DoctorQuery, now: Date): Promise<{ data: DoctorData; scored: Scored[] }> {
  const cred = await prisma.credential.findUnique({ where: { userId }, select: { ebayRefreshToken: true } });
  const connected = !!cred?.ebayRefreshToken;
  const base: DoctorData = {
    connected, store: null, stores: [], rows: [], total: 0, needsWorkTotal: 0, statsSince: null, statsUpdatedAt: null, page: q.page, size: q.size,
  };
  if (!connected) return { data: base, scored: [] };
  const since = new Date(now.getTime() - DOCTOR_WINDOW_DAYS * DAY);
  const listings = await prisma.ebayListing.findMany({
    where: { userId, status: { equals: 'PUBLISHED', mode: 'insensitive' } },
    select: {
      sku: true, listingId: true, title: true, description: true, imageCount: true, imageUrls: true, imageUrl: true, aspects: true,
      condition: true, conditionDescription: true, categoryId: true, fulfillmentPolicyId: true, paymentPolicyId: true, returnPolicyId: true,
      weightValue: true, lengthValue: true, widthValue: true, heightValue: true, priceValue: true, priceCurrency: true, isLegacy: true,
      quantity: true, status: true, listingUrl: true, syncedAt: true,
    },
    take: 5000,
  });
  const itemIds = listings.map((l) => l.listingId).filter((s): s is string => !!s);
  // eBay order sync does not store the item id on OrderItem.listingRef yet (BR request). Until any eBay order item
  // carries one, sales are not measured: a confident 0 would be invented, so every row is guarded instead.
  const refsStored = itemIds.length
    ? (await prisma.orderItem.count({
      where: { listingRef: { not: null }, order: { userId, marketplace: { contains: 'ebay', mode: 'insensitive' } } },
    })) > 0
    : false;
  const sales = refsStored
    ? await prisma.orderItem.groupBy({
      by: ['listingRef'],
      where: { listingRef: { in: itemIds }, order: { userId, createdAt: { gte: since } } },
      _sum: { quantity: true },
    })
    : [];
  const salesBy = new Map(sales.map((s) => [String(s.listingRef), s._sum.quantity ?? 0]));
  const scored: Scored[] = listings.map((l) => {
    const score = scoreCacheRow({
      title: l.title, description: l.description, imageCount: l.imageCount, imageUrls: l.imageUrls, aspects: l.aspects,
      condition: l.condition, conditionDescription: l.conditionDescription, categoryId: l.categoryId,
      fulfillmentPolicyId: l.fulfillmentPolicyId, paymentPolicyId: l.paymentPolicyId, returnPolicyId: l.returnPolicyId,
      weightValue: l.weightValue, lengthValue: l.lengthValue, widthValue: l.widthValue, heightValue: l.heightValue,
      priceValue: l.priceValue, isLegacy: l.isLegacy,
    }, 'ebay');
    const s30 = refsStored && l.listingId ? salesBy.get(l.listingId) ?? 0 : null;
    const m = ebayDoctorMetrics(s30);
    const price = Number(l.priceValue);
    const row: ListingRow = {
      id: l.sku,
      title: decodeEntities(l.title),
      metaLine: [`SKU ${l.sku}`],
      thumbUrl: l.imageUrl ?? l.imageUrls[0] ?? null,
      price: Number.isFinite(price) && price > 0 ? { amount: price, currency: l.priceCurrency } : null,
      qty: l.quantity,
      editable: { price: true, qty: true },
      status: listingStatus({ status: l.status, quantity: l.quantity }, 'ebay'),
      statusRaw: l.status,
      health: health(score),
      updatedAt: isoOrNull(l.syncedAt),
      createdAt: null,
      extra: { photos: l.imageCount, itemId: l.listingId ?? null },
      externalUrl: l.listingUrl ?? (l.listingId ? `https://www.ebay.com/itm/${l.listingId}` : null),
      sync: null,
    };
    return {
      row,
      score,
      metrics: m,
      input: { id: l.sku, views30d: null, sales30d: m.sales30d.value, tracked: false, rank: null, health: row.health.score, failingGain: failingGain(score) },
    };
  });
  return { data: { ...base, stores: [{ id: 'ebay', name: 'eBay' }], store: { id: 'ebay', name: 'eBay', currency: listings[0]?.priceCurrency ?? null, lastPulledAt: null } }, scored };
}

// ─── Shared loader (also used by /api/research/home) ───────────────────────

export async function loadDoctor(userId: string, q: DoctorQuery, now = new Date()): Promise<DoctorData> {
  const { data, scored } = q.mkt === 'ebay' ? await loadEbay(userId, q, now) : await loadEtsy(userId, q, now);
  if (!data.connected || scored.length === 0) return data;
  data.needsWorkTotal = scored.filter((s) => s.row.health.score != null && s.row.health.score < 50).length;
  const ranked = sortDoctor(scored, (s) => s.input, q.sort);
  const needle = q.q?.toLowerCase();
  const filtered = ranked.filter(({ item }) =>
    (!needle || item.row.title.toLowerCase().includes(needle) || item.row.id === q.q)
    && (!q.issue || failingChecks(item.score.checks).some((c) => c.id === q.issue))
    && (!q.health || inHealthBand(item.row.health.score, q.health)));
  data.total = filtered.length;
  const start = (q.page - 1) * q.size;
  data.rows = filtered.slice(start, start + q.size).map(({ item, rank, rule }) => toDoctorRow(item, rank, rule));
  if (data.store) {
    const store = data.store;
    await attachDrafts(userId, q.mkt, store, data.rows, now).catch((err) => logger.warn('[research/listings] draft overlay failed', { error: (err as Error)?.message }));
  }
  return data;
}

export function doctorSource(data: DoctorData, mkt: 'etsy' | 'ebay'): SourceNoteProps {
  return {
    source: mkt === 'ebay' ? 'research.sourceName.doctorEbay' : 'research.sourceName.doctorEtsy',
    fetchedAt: data.statsUpdatedAt ?? new Date().toISOString(),
    sample: data.total,
    sampleUnit: 'listings',
    kind: 'measured',
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);
  const q = parseDoctorQuery(req.query as Record<string, unknown>);
  if (!q) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  try {
    const data = await loadDoctor(user.id, q);
    const body: ResearchResponse<DoctorData> = { data, source: doctorSource(data, q.mkt) };
    return res.status(200).json(body);
  } catch (err) {
    logger.error('[research/listings] failed', err as Error, { mkt: q.mkt });
    return res.status(500).json({ error: 'server_error' } satisfies ResearchErrorBody);
  }
}

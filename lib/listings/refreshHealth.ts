// lib/listings/refreshHealth.ts: recompute and store listing health on the DB caches (listings-grid §9.3).
// Called after every pull (sync handlers, listings G2), after a successful draft send for the sent ids,
// and by scripts/backfill-listing-health.ts. Reads only the cache, never a marketplace.
//
// The BR-1a columns (`healthScore`, `healthChecksUsed`, `healthChecksTotal`, `healthFails`) are written
// with raw SQL, and only after information_schema confirms they exist. Until the backend session deploys
// the migration, the call is a no-op that returns `skipped: 'columns_missing'`. It never throws: a health
// refresh must never fail a sync.
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  scoreCacheRow,
  toHealthColumns,
  type CacheRowFor,
  type HealthColumns,
  type ListingScoreMarketplace,
  type ScoreBand,
} from '@/lib/listingScore';

/**
 * Which rows to refresh.
 * - etsy:     storeId = EtsyShop.shopId, ids = Etsy listing ids (strings)
 * - ebay:     storeId = User.id (one eBay account per user), ids = SKUs
 * - trendyol: storeId = supplierId, userId recommended, ids = barcodes
 * - wix:      storeId = WixSite.id, ids = wixProductId
 * - shopify:  storeId = ShopifyShop.id, ids = shopifyProductId
 * `ids` omitted = every row of the store.
 */
export interface RefreshHealthScope {
  storeId: string;
  userId?: string;
  ids?: string[];
}

export interface RefreshHealthOptions {
  /** Injected client (tests, scripts). Defaults to the app singleton `@/lib/prisma`. */
  db?: HealthDb;
  /** Rows per read/write round trip. Default 500. */
  batchSize?: number;
  /** Score only; nothing is written (the column check is skipped too). */
  dryRun?: boolean;
}

export interface RefreshHealthResult {
  marketplace: ListingScoreMarketplace;
  storeId: string;
  /** Rows read and scored. */
  scored: number;
  /** Rows updated in the DB (0 on dry run or when skipped). */
  written: number;
  /** Unscored rows (no check could run). */
  unscored: number;
  bands: Record<ScoreBand, number>;
  skipped: null | 'columns_missing' | 'bad_scope';
  /** Error message when the refresh failed part-way (rows before the failure stay written). */
  error?: string;
}

export type HealthDb = Pick<
  PrismaClient,
  'etsyListing' | 'ebayListing' | 'trendyolProduct' | 'wixProduct' | 'shopifyProduct' | '$queryRaw' | '$executeRaw'
>;

// ---------------------------------------------------------------------------
// Per-marketplace cache access (selects match the scorer's CacheRow types)
// ---------------------------------------------------------------------------

const ETSY_SELECT = {
  id: true, title: true, description: true, tags: true, materials: true, priceAmount: true, priceDivisor: true,
  imageCount: true, hasVideo: true, shippingProfileId: true, processingMin: true, itemWeight: true,
} as const satisfies Prisma.EtsyListingSelect;

const EBAY_SELECT = {
  id: true, title: true, description: true, imageCount: true, imageUrls: true, aspects: true, condition: true,
  conditionDescription: true, categoryId: true, fulfillmentPolicyId: true, paymentPolicyId: true, returnPolicyId: true,
  weightValue: true, lengthValue: true, widthValue: true, heightValue: true, priceValue: true, isLegacy: true,
} as const satisfies Prisma.EbayListingSelect;

const TRENDYOL_SELECT = {
  id: true, title: true, brandName: true, categoryName: true, description: true, images: true, imageCount: true,
  attributes: true, listPrice: true, salePrice: true, quantity: true, approved: true, rejected: true,
  blacklisted: true, dimensionalWeight: true,
} as const satisfies Prisma.TrendyolProductSelect;

const WIX_SELECT = {
  id: true, title: true, description: true, images: true, imageCount: true, collectionIds: true,
} as const satisfies Prisma.WixProductSelect;

const SHOPIFY_SELECT = {
  id: true, title: true, description: true, images: true, imageCount: true, seoTitle: true, seoDescription: true, tags: true,
} as const satisfies Prisma.ShopifyProductSelect;

/** Postgres table per marketplace (constant identifiers; never user input). */
export const HEALTH_TABLE: Record<ListingScoreMarketplace, string> = {
  etsy: 'EtsyListing',
  ebay: 'EbayListing',
  trendyol: 'TrendyolProduct',
  wix: 'WixProduct',
  shopify: 'ShopifyProduct',
};

type Row<M extends ListingScoreMarketplace> = CacheRowFor[M] & { id: string };

function etsyIds(ids: string[]): bigint[] {
  const out: bigint[] = [];
  for (const id of ids) {
    if (/^\d+$/.test(String(id).trim())) out.push(BigInt(String(id).trim()));
  }
  return out;
}

async function readPage(
  db: HealthDb,
  marketplace: ListingScoreMarketplace,
  scope: RefreshHealthScope,
  afterId: string | null,
  take: number,
): Promise<Array<Row<ListingScoreMarketplace>>> {
  const idCursor = afterId ? { id: { gt: afterId } } : {};
  const ids = scope.ids;
  switch (marketplace) {
    case 'etsy':
      return db.etsyListing.findMany({
        where: { etsyShopId: scope.storeId, ...(ids ? { etsyListingId: { in: etsyIds(ids) } } : {}), ...idCursor },
        select: ETSY_SELECT, orderBy: { id: 'asc' }, take,
      });
    case 'ebay':
      return db.ebayListing.findMany({
        where: { userId: scope.storeId, ...(ids ? { sku: { in: ids } } : {}), ...idCursor },
        select: EBAY_SELECT, orderBy: { id: 'asc' }, take,
      });
    case 'trendyol':
      return db.trendyolProduct.findMany({
        where: {
          supplierId: scope.storeId,
          ...(scope.userId ? { userId: scope.userId } : {}),
          ...(ids ? { barcode: { in: ids } } : {}),
          ...idCursor,
        },
        select: TRENDYOL_SELECT, orderBy: { id: 'asc' }, take,
      });
    case 'wix':
      return db.wixProduct.findMany({
        where: {
          wixSiteId: scope.storeId,
          ...(scope.userId ? { userId: scope.userId } : {}),
          ...(ids ? { wixProductId: { in: ids } } : {}),
          ...idCursor,
        },
        select: WIX_SELECT, orderBy: { id: 'asc' }, take,
      });
    case 'shopify':
      return db.shopifyProduct.findMany({
        where: {
          shopifyShopId: scope.storeId,
          ...(scope.userId ? { userId: scope.userId } : {}),
          ...(ids ? { shopifyProductId: { in: ids } } : {}),
          ...idCursor,
        },
        select: SHOPIFY_SELECT, orderBy: { id: 'asc' }, take,
      });
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Column presence (BR-1a guard)
// ---------------------------------------------------------------------------

const COLUMN_CHECK_TTL_MS = 10 * 60 * 1000;
let columnCache: { at: number; tables: Set<string> } | null = null;

/** Tables that have every health column. Cached for 10 minutes (a migration deploy restarts the service anyway). */
export async function healthColumnTables(db: HealthDb, now = Date.now()): Promise<Set<string>> {
  if (columnCache && now - columnCache.at < COLUMN_CHECK_TTL_MS) return columnCache.tables;
  const rows = await db.$queryRaw<Array<{ table_name: string; n: number | bigint }>>(Prisma.sql`
    SELECT table_name, COUNT(*)::int AS n
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('healthScore', 'healthChecksUsed', 'healthChecksTotal', 'healthFails')
    GROUP BY table_name
  `);
  const tables = new Set(rows.filter((r) => Number(r.n) === 4).map((r) => r.table_name));
  columnCache = { at: now, tables };
  return tables;
}

/** Test hook: forget the cached column check. */
export function resetHealthColumnCache(): void {
  columnCache = null;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

async function writeColumns(
  db: HealthDb,
  table: string,
  items: Array<{ id: string; cols: HealthColumns }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const ids = items.map((i) => i.id);
  // Scores travel as text so a null score survives the array parameter ('' → NULL).
  const scores = items.map((i) => (i.cols.healthScore === null ? '' : String(i.cols.healthScore)));
  const used = items.map((i) => i.cols.healthChecksUsed);
  const total = items.map((i) => i.cols.healthChecksTotal);
  // Tokens are [a-z_] ids, so a comma join is lossless.
  const fails = items.map((i) => i.cols.healthFails.join(','));
  const count = await db.$executeRaw(Prisma.sql`
    UPDATE ${Prisma.raw(`"${table}"`)} AS t
    SET "healthScore" = NULLIF(v.s, '')::int,
        "healthChecksUsed" = v.u,
        "healthChecksTotal" = v.n,
        "healthFails" = COALESCE(string_to_array(NULLIF(v.f, ''), ','), ARRAY[]::text[])
    FROM unnest(${ids}::text[], ${scores}::text[], ${used}::int[], ${total}::int[], ${fails}::text[]) AS v(id, s, u, n, f)
    WHERE t.id = v.id
  `);
  return Number(count) || 0;
}

async function defaultDb(): Promise<HealthDb> {
  const mod = await import('@/lib/prisma');
  return mod.default as unknown as HealthDb;
}

function emptyBands(): Record<ScoreBand, number> {
  return { needs_work: 0, fair: 0, good: 0, great: 0 };
}

/**
 * Recomputes health for a store (or some of its rows) and stores it in the BR-1a columns.
 * Never throws; check `skipped` / `error`.
 */
export interface RefreshHealthRequest extends RefreshHealthScope {
  marketplace: ListingScoreMarketplace;
}

/**
 * Two call forms, same behaviour:
 * - `refreshHealth('etsy', { storeId, userId?, ids? }, opts?)` (sync routes, backfill)
 * - `refreshHealth({ marketplace: 'etsy', storeId, userId?, ids? }, opts?)`
 */
export function refreshHealth(
  marketplace: ListingScoreMarketplace,
  scope: RefreshHealthScope,
  opts?: RefreshHealthOptions,
): Promise<RefreshHealthResult>;
export function refreshHealth(request: RefreshHealthRequest, opts?: RefreshHealthOptions): Promise<RefreshHealthResult>;
export async function refreshHealth(
  a: ListingScoreMarketplace | RefreshHealthRequest,
  b?: RefreshHealthScope | RefreshHealthOptions,
  c?: RefreshHealthOptions,
): Promise<RefreshHealthResult> {
  let marketplace: ListingScoreMarketplace;
  let scope: RefreshHealthScope;
  let opts: RefreshHealthOptions;
  if (a && typeof a === 'object') {
    const { marketplace: m, ...rest } = a;
    marketplace = m;
    scope = rest;
    opts = (b as RefreshHealthOptions | undefined) ?? {};
  } else {
    marketplace = a;
    scope = b as RefreshHealthScope;
    opts = c ?? {};
  }
  const result: RefreshHealthResult = {
    marketplace, storeId: scope?.storeId ?? '', scored: 0, written: 0, unscored: 0, bands: emptyBands(), skipped: null,
  };
  if (!scope || !scope.storeId || !HEALTH_TABLE[marketplace]) {
    result.skipped = 'bad_scope';
    return result;
  }
  if (Array.isArray(scope.ids) && scope.ids.length === 0) return result;

  try {
    const db = opts.db ?? (await defaultDb());
    const table = HEALTH_TABLE[marketplace];
    if (!opts.dryRun) {
      const tables = await healthColumnTables(db);
      if (!tables.has(table)) {
        result.skipped = 'columns_missing';
        return result;
      }
    }

    const take = Math.max(1, Math.min(opts.batchSize ?? 500, 1000));
    let afterId: string | null = null;
    for (;;) {
      const rows = await readPage(db, marketplace, scope, afterId, take);
      if (rows.length === 0) break;
      const items = rows.map((row) => {
        const cols = toHealthColumns(scoreCacheRow(row, marketplace));
        result.scored += 1;
        if (cols.healthScore === null) result.unscored += 1;
        else result.bands[cols.healthScore >= 90 ? 'great' : cols.healthScore >= 75 ? 'good' : cols.healthScore >= 50 ? 'fair' : 'needs_work'] += 1;
        return { id: row.id, cols };
      });
      if (!opts.dryRun) result.written += await writeColumns(db, table, items);
      afterId = rows[rows.length - 1].id;
      if (rows.length < take) break;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

/** Every store that has cached rows, per marketplace (backfill). */
export async function listHealthStores(
  marketplace: ListingScoreMarketplace,
  db: HealthDb,
): Promise<RefreshHealthScope[]> {
  switch (marketplace) {
    case 'etsy': {
      const g = await db.etsyListing.groupBy({ by: ['etsyShopId'] });
      return g.map((r) => ({ storeId: r.etsyShopId }));
    }
    case 'ebay': {
      const g = await db.ebayListing.groupBy({ by: ['userId'] });
      return g.map((r) => ({ storeId: r.userId, userId: r.userId }));
    }
    case 'trendyol': {
      const g = await db.trendyolProduct.groupBy({ by: ['userId', 'supplierId'] });
      return g.map((r) => ({ storeId: r.supplierId, userId: r.userId }));
    }
    case 'wix': {
      const g = await db.wixProduct.groupBy({ by: ['userId', 'wixSiteId'] });
      return g.map((r) => ({ storeId: r.wixSiteId, userId: r.userId }));
    }
    case 'shopify': {
      const g = await db.shopifyProduct.groupBy({ by: ['userId', 'shopifyShopId'] });
      return g.map((r) => ({ storeId: r.shopifyShopId, userId: r.userId }));
    }
    default:
      return [];
  }
}

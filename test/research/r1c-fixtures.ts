// research R1-C fixtures: API responses shaped like lib/research/types (R1-A contract).
import type { DoctorRow, HomeData, ProductsData, ResearchResponse, SeasonsData } from '@/lib/research/types';

export const FETCHED_AT = '2026-10-15T10:00:00.000Z';

export const SOURCE = {
  source: 'research.source.etsySearchName',
  fetchedAt: FETCHED_AT,
  sample: 287,
  sampleTotal: 300,
  sampleUnit: 'listings' as const,
  excluded: { count: 13, reasonKey: 'research.guard.noFx' },
  kind: 'measured' as const,
};

/** "halloween decor": mixed currencies + a $9,999 placeholder → robust median under $200, 13 excluded. */
export function productsData(over: Partial<ProductsData> = {}): ProductsData {
  return {
    query: 'halloween decor',
    mkt: 'etsy',
    country: 'US',
    evidence: {
      facts: [
        { key: 'research.evidence.priceBand', params: { p25: '$24.00', p75: '$58.00', median: '$38.00' } },
        { key: 'research.evidence.competing', params: { count: '18,420' } },
      ],
      confidence: 'medium',
      basis: { key: 'research.evidence.noVolume', params: {} },
    },
    price: {
      n: 287, total: 300, trimmed: 0, median: 38, p25: 24, p75: 58, min: 6, max: 140,
      currency: 'USD', sampled: 300, excludedNoFx: 13, excludedImplausible: 1, quality: 'ok',
    },
    competition: {
      total: { value: 18420, kind: 'measured', guard: { ok: true } },
      top5Share: { value: 0.28, kind: 'measured', guard: { ok: true } },
    },
    demand: {
      tier: 3,
      inputs: [
        { key: 'googleTrends', value: 54, normalized: 0.54, ok: true },
        { key: 'autocomplete', value: 2, normalized: 0.66, ok: true },
        { key: 'engagement', value: null, normalized: null, ok: false },
      ],
      kind: 'signal',
    },
    newcomers: { value: 0.3, kind: 'measured', guard: { ok: true } },
    buyerWords: [
      { tag: 'halloween decor', share: 0.62, count: 30 },
      { tag: 'spooky decor', share: 0.48, count: 23 },
      { tag: 'fall decor', share: 0.4, count: 19 },
      { tag: 'witch decor', share: 0.31, count: 15 },
      { tag: 'pumpkin sign', share: 0.29, count: 14 },
      { tag: 'gothic home decor', share: 0.2, count: 10 },
    ],
    top: [
      {
        id: '111', title: 'Spooky &amp; Cute Halloween Sign', url: 'https://www.etsy.com/listing/111/spooky', thumbUrl: null,
        price: { amount: 45, currency: 'USD' }, favorites: 1204, ageDays: 800,
        shop: { id: '9', name: 'WoodAndWords', url: 'https://www.etsy.com/shop/WoodAndWords' }, tags: ['halloween decor', 'spooky sign'],
      },
      {
        id: '222', title: 'Witch Hat Garland', url: 'https://www.etsy.com/listing/222/witch', thumbUrl: null,
        price: { amount: 30, currency: 'USD' }, favorites: null, ageDays: 40,
        shop: { id: '10', name: 'MemoryCrafts', url: null }, tags: [],
      },
    ],
    categoryHint: '1234',
    draftTags: ['halloween decor', 'spooky decor', 'fall decor'],
    fetchedAt: FETCHED_AT,
    cached: true,
    ...over,
  };
}

export function productsResponse(over: Partial<ProductsData> = {}, extra: Partial<ResearchResponse<ProductsData>> = {}): ResearchResponse<ProductsData> {
  return { data: productsData(over), source: SOURCE, ...extra };
}

export function doctorRow(id: string, title: string, score: number, views: number | null, sales: number | null, issues: number): DoctorRow {
  return {
    listing: {
      id, title, metaLine: [`ID ${id}`], thumbUrl: null, price: { amount: 40, currency: 'USD' }, qty: 1,
      editable: { price: true, qty: true }, status: 'active', statusRaw: 'active',
      health: { score, used: 11, total: 12, fails: [] }, updatedAt: null, createdAt: null, extra: {}, externalUrl: null, sync: null,
    },
    views30d: { value: views, kind: 'measured', guard: { ok: views !== null } },
    sales30d: { value: sales, kind: 'measured', guard: { ok: sales !== null } },
    conversion: { value: null, kind: 'measured', guard: { ok: false } },
    issues,
    opportunity: { rule: 'health_gaps', rank: 1 },
  };
}

export function homeResponse(over: Partial<HomeData> = {}): ResearchResponse<HomeData> {
  return {
    data: {
      connected: { etsy: true, ebay: false },
      needsWorkMkt: 'etsy',
      needsWork: [doctorRow('1490012234', 'Baby Name Puzzle', 45, 412, 0, 4), doctorRow('1490012235', 'Wooden Keepsake Box', 61, 30, 2, 2)],
      needsWorkTotal: 18,
      recentWatched: [{ kind: 'keyword', label: '"baby keepsake box"', href: '/app/research/keywords?q=baby+keepsake+box', at: '2026-10-15T08:00:00.000Z' }],
      ...over,
    },
    source: { source: 'research.source.listingsHealth', fetchedAt: FETCHED_AT, kind: 'measured' },
  };
}

export function seasonsResponse(): ResearchResponse<SeasonsData> {
  return {
    data: {
      productionDays: 3,
      events: [
        {
          key: 'christmas', country: 'US', date: '2026-12-25', listBy: '2026-10-25', daysToListBy: 10,
          lastShip: { carrier: 'FedEx', date: '2026-12-15', transitDays: { value: 4, kind: 'measured', guard: { ok: true } }, sample: 23 },
          productionDays: 3, seed: 'christmas ornament personalized',
        },
        {
          key: 'valentines', country: 'US', date: '2027-02-14', listBy: '2026-12-01', daysToListBy: 47,
          lastShip: { carrier: 'FedEx', date: '2027-02-04', transitDays: { value: 4, kind: 'measured', guard: { ok: true } }, sample: 23 },
          productionDays: 3, seed: 'valentines gift personalized',
        },
      ],
    },
    source: { source: 'research.source.yourLabels', fetchedAt: FETCHED_AT, sample: 23, sampleUnit: 'items', kind: 'measured' },
  };
}

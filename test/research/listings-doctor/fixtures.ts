// research R1-D fixtures: DoctorRow / PeersData shaped exactly like lib/research/types (R1-A contract).
import type { ListingRow } from '@/lib/listings/types';
import type { DoctorData, DoctorRow, PeersData, ResearchResponse } from '@/lib/research/types';

export const NOW = new Date('2026-10-15T09:00:00Z');

export function listingRow(over: Partial<ListingRow> = {}): ListingRow {
  return {
    id: '1490012234',
    title: 'Baby Name Puzzle, Personalized Wooden Toy',
    metaLine: ['ID 1490012234'],
    thumbUrl: null,
    price: { amount: 58, currency: 'USD' },
    qty: 4,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: 45, used: 11, total: 12, fails: ['photos_count', 'tags_quality', 'title_short'] },
    updatedAt: '2026-10-14T08:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    extra: { favorites: 18 },
    externalUrl: 'https://www.etsy.com/listing/1490012234',
    sync: null,
    ...over,
  };
}

export function doctorRow(over: Partial<DoctorRow> = {}, listing: Partial<ListingRow> = {}): DoctorRow {
  return {
    listing: listingRow(listing),
    views30d: { value: 412, kind: 'measured', guard: { ok: true } },
    sales30d: { value: 0, kind: 'measured', guard: { ok: true } },
    conversion: { value: 0, kind: 'measured', guard: { ok: true } },
    mainKeyword: { keyword: 'baby name puzzle', source: 'tracked', rank: 212 },
    biggestIssue: { checkId: 'photos_count', label: 'research.doc.issue.photos_count', params: { count: 5 }, gain: 14 },
    issues: 4,
    opportunity: { rule: 'traffic_no_sales', rank: 1 },
    ...over,
  };
}

export function listResponse(rows: DoctorRow[], over: Partial<DoctorData> = {}, errors?: ResearchResponse<DoctorData>['errors']): ResearchResponse<DoctorData> {
  return {
    data: {
      connected: true,
      store: { id: 'S1', name: 'Belle Couture Gifts', currency: 'USD', lastPulledAt: '2026-10-15T06:00:00Z' },
      stores: [{ id: 'S1', name: 'Belle Couture Gifts' }],
      rows,
      total: rows.length,
      needsWorkTotal: rows.filter((r) => (r.listing.health.score ?? 0) < 50).length,
      statsSince: '2026-09-01',
      statsUpdatedAt: '2026-10-15T06:00:00Z',
      page: 1,
      size: 50,
      ...over,
    },
    source: { source: 'research.doc.statsSourceName', fetchedAt: '2026-10-15T06:00:00Z', kind: 'measured' },
    errors,
  };
}

export function peersResponse(over: Partial<PeersData> = {}, errors?: ResearchResponse<PeersData>['errors']): ResearchResponse<PeersData> {
  const g = (value: number) => ({ value, kind: 'measured' as const, guard: { ok: true } });
  return {
    data: {
      keyword: { keyword: 'baby name puzzle', source: 'tracked', rank: 212 },
      peers: {
        n: 48,
        price: { n: 45, total: 48, trimmed: 3, median: 42, p25: 35, p75: 49, min: 20, max: 90, currency: 'USD', sampled: 48, excludedNoFx: 0, excludedImplausible: 0, quality: 'ok' },
        titleLen: g(118),
        photos: g(9),
        videoShare: g(0.61),
        freeShippingShare: g(0.73),
        topTags: [],
      },
      checks: [
        { id: 'price_vs_peers', label: 'research.doc.issue.price_vs_peers', status: 'fail', impact: 0, group: 'peers' },
      ],
      fetchedAt: '2026-10-15T08:00:00Z',
      ...over,
    },
    source: { source: 'research.doc.statsSourceName', fetchedAt: '2026-10-15T08:00:00Z', sample: 48, kind: 'measured' },
    errors,
  };
}

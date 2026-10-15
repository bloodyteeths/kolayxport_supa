import { describe, expect, it } from 'vitest';
import { STATUS_VOCABULARY } from '@/lib/ds/status';
import {
  BUILT_IN_VIEW_KEYS,
  BUILT_IN_VIEW_QUERY,
  LISTING_STATUS_KEYS,
  builtInViewCount,
  defaultViewFor,
  isListingSortKey,
  parseListingsQuery,
  splitSortKey,
  toListingsSearchParams,
  unsentCount,
  sendableCount,
  LISTING_EDITABLE_REASON_I18N,
  type ListingsCounts,
} from '@/lib/listings/types';

const counts: ListingsCounts = {
  all: 312,
  status: { active: 248, sold_out: 9, inactive: 30, draft: 5, expired: 20 },
  sync: { pending: 5, syncing: 1, failed: 1, conflict: 1, queuedDeletes: 1 },
  needsWork: 40,
  unscored: 12,
};

describe('listing status keys', () => {
  it('mirrors the M1-a listing vocabulary exactly', () => {
    expect([...LISTING_STATUS_KEYS].sort()).toEqual(Object.keys(STATUS_VOCABULARY.listing).sort());
  });
});

describe('parseListingsQuery', () => {
  it('requires a known marketplace', () => {
    expect(parseListingsQuery({}).ok).toBe(false);
    expect(parseListingsQuery({ marketplace: 'amazon' }).ok).toBe(false);
  });

  it('applies defaults', () => {
    const r = parseListingsQuery({ marketplace: 'etsy' });
    expect(r).toEqual({ ok: true, query: { marketplace: 'etsy', sort: 'updated.desc', page: 1, size: 50 } });
  });

  it('parses every filter and drops invalid values', () => {
    const r = parseListingsQuery({
      marketplace: 'trendyol',
      store: 's1',
      q: '  blanket ',
      status: 'active,bogus,in_review,active',
      sync: ['pending', 'conflict'],
      health: 'lt50',
      brand: 'Belle',
      hasVideo: 'true',
      visible: 'nope',
      photos: 'lt5',
      stock: 'out',
      approval: 'rejected',
      priceMin: '10',
      priceMax: '-3',
      sort: 'price.asc',
      page: '3',
      size: '100',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query).toEqual({
      marketplace: 'trendyol',
      store: 's1',
      q: 'blanket',
      status: ['active', 'in_review'],
      sync: ['pending', 'conflict'],
      health: 'lt50',
      brand: 'Belle',
      hasVideo: true,
      photos: 'lt5',
      stock: 'out',
      approval: 'rejected',
      priceMin: 10,
      sort: 'price.asc',
      page: 3,
      size: 100,
    });
  });

  it('falls back on bad sort, page and size', () => {
    const r = parseListingsQuery({ marketplace: 'wix', sort: 'price.up', page: '0', size: '75' });
    expect(r.ok && r.query).toMatchObject({ sort: 'updated.desc', page: 1, size: 50 });
  });

  it('round-trips through toListingsSearchParams', () => {
    const r = parseListingsQuery({ marketplace: 'etsy', status: 'active', section: '42', personalizable: 'false', sort: 'health.asc', page: '2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const params = toListingsSearchParams(r.query);
    expect(params.toString()).toBe('marketplace=etsy&status=active&section=42&personalizable=false&sort=health.asc&page=2');
    const again = parseListingsQuery(Object.fromEntries(params.entries()));
    expect(again).toEqual(r);
  });
});

describe('sort keys', () => {
  it('validates and splits', () => {
    expect(isListingSortKey('views.desc')).toBe(true);
    expect(isListingSortKey('views')).toBe(false);
    expect(isListingSortKey('views.desc.x')).toBe(false);
    expect(splitSortKey('created.asc')).toEqual({ field: 'created', dir: 'asc' });
  });
});

describe('views', () => {
  it('has a query for every built-in view', () => {
    for (const v of BUILT_IN_VIEW_KEYS) expect(BUILT_IN_VIEW_QUERY[v]).toBeDefined();
  });

  it('counts per §5', () => {
    expect(builtInViewCount('all', counts)).toBe(312);
    expect(builtInViewCount('active', counts)).toBe(248);
    expect(builtInViewCount('not_sent', counts)).toBe(5);
    expect(builtInViewCount('send_failed', counts)).toBe(2);
    expect(builtInViewCount('needs_work', counts)).toBe(40);
    expect(builtInViewCount('sold_out', counts)).toBe(9);
    expect(builtInViewCount('inactive', counts)).toBe(55);
    expect(builtInViewCount('review', counts)).toBe(0);
  });

  it('defaults Etsy to active, others to all', () => {
    expect(defaultViewFor('etsy')).toBe('active');
    expect(defaultViewFor('shopify')).toBe('all');
  });

  it('counts unsent changes without syncing drafts', () => {
    expect(unsentCount(counts)).toBe(7);
  });

  it('sendable excludes conflicts and queued deletes without double-counting', () => {
    // pending 5 + failed 1 - queuedDeletes 1 (a subset of pending+failed); conflict 1 never sent.
    expect(sendableCount(counts)).toBe(5);
    const withConflictOnly: ListingsCounts = { ...counts, sync: { pending: 0, syncing: 0, failed: 0, conflict: 2, queuedDeletes: 0 } };
    expect(sendableCount(withConflictOnly)).toBe(0);
    expect(unsentCount(withConflictOnly)).toBe(2);
    const allDeletes: ListingsCounts = { ...counts, sync: { pending: 2, syncing: 0, failed: 1, conflict: 0, queuedDeletes: 3 } };
    expect(sendableCount(allDeletes)).toBe(0);
  });
});

describe('editable reasons', () => {
  it('maps every read-only reason to a listings.cell key', () => {
    expect(LISTING_EDITABLE_REASON_I18N).toEqual({
      variations: 'listings.cell.variationsReadOnly',
      not_tracked: 'listings.cell.notTracked',
      stock_managed: 'listings.cell.stockManaged',
    });
  });
});

// Founder follow-ups (listings): stored draft error keys (lastSyncErrorKey) with ICU params and the legacy text
// fallback, for the grid (lib/listings/query.ts) and the editor banner; Etsy SKUs from EtsyListingOffering.sku.
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import {
  attemptErrorParams,
  draftSendError,
  icuArgNames,
  legacySendErrorKey,
  renderSendError,
  type SendErrorTranslator,
} from '@/lib/listings/sendError';
import { listListings, loadRowSync, sendErrorKey, schemaCaps, setSchemaFieldOverrideForTests, type StoreContext } from '@/lib/listings/query';
import { parseListingsQuery } from '@/lib/listings/types';
import { etsyAdapter, etsySkus } from '@/lib/listings/adapters/etsy';
import { ebayAdapter } from '@/lib/listings/adapters/ebay';
import { etsyFailureCauseKey } from '@/components/domain/listing-editor/adapters/etsy';
import { ebayFailureCauseKey } from '@/components/domain/listing-editor/adapters/ebay';
import { storedDraftSendError, storedDraftSendErrorParams } from '@/components/domain/listing-editor/draftSendError';
import { makeDb } from './g1-fakeDb';

const NOW = new Date('2026-10-15T12:00:00Z');
afterEach(() => setSchemaFieldOverrideForTests(null));

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), messages);
}

/** A tiny root translator over the real catalog (ICU args substituted naively; enough for these strings). */
function makeT(messages: unknown): SendErrorTranslator {
  const t = ((key: string, values?: Record<string, string | number>) => {
    const tpl = lookup(messages, key);
    if (typeof tpl !== 'string') return key;
    return tpl.replace(/\{(\w+)\}/g, (m, n) => (values && n in values ? String(values[n]) : m));
  }) as SendErrorTranslator;
  t.has = (key) => typeof lookup(messages, key) === 'string';
  t.raw = (key) => lookup(messages, key);
  return t;
}

describe('draftSendError', () => {
  it('prefers lastSyncErrorKey over the English text the API puts back into lastSyncError', () => {
    expect(
      draftSendError({ status: 'failed', lastSyncErrorKey: 'etsy.draftSync.rateLimited', lastSyncError: 'Etsy API 401 invalid token' }),
    ).toEqual({ errorKey: 'etsy.draftSync.rateLimited' });
  });

  it('passes a DB key through and attaches the latest failed attempt params', () => {
    const attempts = [
      { status: 'running', result: null },
      { status: 'failed', result: { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1, max: 3, junk: { x: 1 } } } },
      { status: 'failed', result: { errorParams: { min: 9, max: 9 } } },
    ];
    expect(draftSendError({ status: 'failed', lastSyncError: 'etsy.draftSync.processingNotMapped', syncAttempts: attempts })).toEqual({
      errorKey: 'etsy.draftSync.processingNotMapped',
      errorParams: { min: 1, max: 3 },
    });
    expect(attemptErrorParams('nope', 'etsy.draftSync.processingNotMapped')).toBeUndefined();
  });

  it('skips a newer failed attempt that did not record the stored key (concurrent send / stale recovery)', () => {
    const attempts = [
      // eBay's concurrent-send attempt: failed, no result, newest.
      { status: 'failed', result: null },
      // Stale recovery / another error's attempt with its own params.
      { status: 'failed', result: { errorKey: 'ebay.draftSync.unavailable', errorParams: { min: 7 } } },
      { status: 'failed', result: { errorKey: 'ebay.draftSync.missingAspects', errorParams: { aspects: 'Color, Size' } } },
    ];
    expect(draftSendError({ status: 'failed', lastSyncErrorKey: 'ebay.draftSync.missingAspects', syncAttempts: attempts })).toEqual({
      errorKey: 'ebay.draftSync.missingAspects',
      errorParams: { aspects: 'Color, Size' },
    });
    // No attempt recorded the key → no params (never another error's params).
    expect(draftSendError({ status: 'failed', lastSyncErrorKey: 'ebay.draftSync.skuExists', syncAttempts: attempts })).toEqual({
      errorKey: 'ebay.draftSync.skuExists',
    });
    // A bare stored key matches the attempt under either spelling.
    expect(attemptErrorParams([{ status: 'failed', result: { errorKey: 'draftSync.x', errorParams: { n: 1 } } }], ['draftSync.x', 'etsy.draftSync.x'])).toEqual({ n: 1 });
  });

  it('falls back to the coarse families for legacy English rows and ignores non-failure statuses', () => {
    expect(draftSendError({ status: 'failed', lastSyncError: 'Sync interrupted by a server restart — retry Sync to Etsy' })).toEqual({ errorKey: 'listings.sendError.interrupted' });
    expect(draftSendError({ status: 'conflict', lastSyncError: 'changed remotely' })).toEqual({ errorKey: 'listings.sendError.conflict' });
    expect(draftSendError({ status: 'synced', lastSyncError: 'Synced with warnings: x' })).toBeNull();
    expect(draftSendError({ status: 'draft', lastSyncErrorKey: 'etsy.draftSync.failed' })).toBeNull();
    expect(legacySendErrorKey('failed', null)).toBe('listings.sendError.generic');
  });

  it('prefixes a namespace-less stored key', () => {
    expect(draftSendError({ status: 'failed', lastSyncError: 'draftSync.readinessStateRequired' }, { prefix: 'etsy.' })).toEqual({ errorKey: 'etsy.draftSync.readinessStateRequired' });
    expect(draftSendError({ status: 'failed', lastSyncError: 'listings.validate.priceInvalid' }, { prefix: 'etsy.' })).toEqual({ errorKey: 'listings.validate.priceInvalid' });
  });

  it('grid wrapper keeps its contract', () => {
    expect(sendErrorKey('failed', 'ebay.draftSync.unavailable')).toEqual({ errorKey: 'ebay.draftSync.unavailable' });
    expect(sendErrorKey('failed', 'etsy.draftSync.copyImagesFailed', [{ status: 'failed', result: { errorKey: 'etsy.draftSync.copyImagesFailed', errorParams: { attempted: 4 } } }])).toEqual({
      errorKey: 'etsy.draftSync.copyImagesFailed',
      errorParams: { attempted: 4 },
    });
  });
});

describe('renderSendError', () => {
  const t = makeT(en);
  it('renders a key with its params', () => {
    expect(renderSendError(t, { errorKey: 'etsy.draftSync.copyImagesFailed', errorParams: { attempted: 4 } })).toContain('4');
  });
  it('falls back to generic when params are missing or the key is unknown', () => {
    const generic = (en as any).listings.sendError.generic;
    expect(renderSendError(t, { errorKey: 'etsy.draftSync.processingNotMapped' })).toBe(generic);
    expect(renderSendError(t, { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1 } })).toBe(generic);
    expect(renderSendError(t, { errorKey: 'etsy.draftSync.nopeNotAKey' })).toBe(generic);
    expect(renderSendError(t, null)).toBe(generic);
  });
  it('icuArgNames reads top-level args only', () => {
    expect(icuArgNames('No profile matches {min}-{max} days')).toEqual(['min', 'max']);
    expect(icuArgNames('{count, plural, one {# photo} other {# photos}} of {total}')).toEqual(['count', 'total']);
    expect(icuArgNames('plain')).toEqual([]);
  });
});

describe('every documented draft error key exists in en and tr', () => {
  const KEYS = [
    'etsy.draftSync.interrupted', 'etsy.draftSync.conflict', 'etsy.draftSync.remoteChanged', 'etsy.draftSync.deletedOnEtsy',
    'etsy.draftSync.mediaFileMissing', 'etsy.draftSync.inventoryPatchRequired', 'etsy.draftSync.readinessStateRequired',
    'etsy.draftSync.stockOverrideFailed', 'etsy.validation.shopSectionNotFound', 'etsy.draftSync.reauthRequired',
    'etsy.draftSync.rateLimited', 'etsy.draftSync.whoMadeRequired', 'etsy.draftSync.shippingProfileInvalid',
    'etsy.draftSync.notFoundOnEtsy', 'etsy.draftSync.etsyUnavailable', 'etsy.draftSync.rejected', 'etsy.draftSync.failed',
    'etsy.draftSync.processingNotMapped', 'etsy.draftSync.copyImagesFailed',
    'ebay.draftSync.conflict', 'ebay.draftSync.itemMissing', 'ebay.draftSync.reauthRequired', 'ebay.draftSync.rateLimited',
    'ebay.draftSync.notFound', 'ebay.draftSync.unavailable', 'ebay.draftSync.rejected', 'ebay.draftSync.failed', 'ebay.draftSync.interrupted',
    'listings.sendError.generic', 'listings.sendError.conflict', 'listings.sendError.interrupted', 'listings.sendError.reconnect',
    'listings.sendError.rateLimited', 'listings.sendError.notFound', 'listings.sendError.rejected',
  ];
  it.each(KEYS)('%s', (key) => {
    expect(typeof lookup(en, key)).toBe('string');
    expect(typeof lookup(tr, key)).toBe('string');
  });
});

describe('editor failed-banner cause', () => {
  const raw = (o: Record<string, unknown>) => ({ raw: o });
  it('Etsy: uses lastSyncErrorKey, not the English text', () => {
    expect(
      etsyFailureCauseKey({ status: 'failed', lastSyncError: 'Etsy API 429 Too Many Requests', ...raw({ lastSyncErrorKey: 'etsy.draftSync.whoMadeRequired' }) }),
    ).toBe('etsy.draftSync.whoMadeRequired');
    // Legacy row (key null): text bucket as before.
    expect(etsyFailureCauseKey({ status: 'failed', lastSyncError: 'invalid_grant: token expired', ...raw({ lastSyncErrorKey: null }) })).toBe('listings.sendError.reconnect');
  });
  it('eBay: uses lastSyncErrorKey (also over the conflict default)', () => {
    expect(ebayFailureCauseKey({ status: 'failed', lastSyncError: 'weird', ...raw({ lastSyncErrorKey: 'ebay.draftSync.unavailable' }) })).toBe('ebay.draftSync.unavailable');
    expect(ebayFailureCauseKey({ status: 'conflict', lastSyncError: 'Inventory item no longer exists on eBay', ...raw({ lastSyncErrorKey: 'ebay.draftSync.itemMissing' }) })).toBe('ebay.draftSync.itemMissing');
    expect(ebayFailureCauseKey({ status: 'failed', lastSyncError: 'weird', ...raw({ lastSyncErrorKey: null }) })).toBe('listings.sendError.generic');
  });
  it('storedDraftSendError carries the attempt params', () => {
    expect(
      storedDraftSendError({
        status: 'failed',
        raw: { lastSyncErrorKey: 'etsy.draftSync.processingNotMapped', syncAttempts: [{ status: 'failed', result: { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 2, max: 5 } } }] },
      }),
    ).toEqual({ errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 2, max: 5 } });
    expect(storedDraftSendError({ status: 'failed', raw: { lastSyncErrorKey: null } })).toBeNull();
    expect(storedDraftSendError(null)).toBeNull();
  });
  it('storedDraftSendErrorParams finds params for a bare stored key the adapter namespaced', () => {
    const d = { status: 'failed', raw: { lastSyncErrorKey: 'draftSync.processingNotMapped', syncAttempts: [{ status: 'failed', result: { errorKey: 'draftSync.processingNotMapped', errorParams: { min: 2, max: 5 } } }] } };
    expect(etsyFailureCauseKey({ ...d, lastSyncError: 'x' })).toBe('etsy.draftSync.processingNotMapped');
    expect(storedDraftSendErrorParams(d, 'etsy.draftSync.processingNotMapped')).toEqual({ min: 2, max: 5 });
    expect(storedDraftSendErrorParams(d, 'listings.sendError.generic')).toBeUndefined();
    expect(storedDraftSendErrorParams(null, 'etsy.draftSync.processingNotMapped')).toBeUndefined();
  });
});

describe('grid row loader includes the latest failed attempt (Etsy / eBay only)', () => {
  it('asks Prisma for syncAttempts and maps errorParams', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 'd1', etsyListingId: BigInt(1001), status: 'failed', fieldPatch: {}, queuedActions: [], updatedAt: NOW, syncedAt: null,
        lastSyncError: 'etsy.draftSync.processingNotMapped',
        syncAttempts: [{ status: 'failed', result: { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1, max: 3 } } }],
      },
    ]);
    const ctx = { userId: 'u1', store: { id: 'shop1', name: 'S', currency: 'USD', lastPulledAt: null }, stores: [], storeWhere: {}, meta: {} } as StoreContext;
    const out = await loadRowSync({ etsyListingDraft: { findMany } }, etsyAdapter.drafts, ctx, { health: false, skus: false, scheduledSendAt: false, drafts: true }, ['1001'], NOW);
    const args = (findMany.mock.calls[0] as unknown[])[0] as { include?: Record<string, unknown> };
    expect(args.include).toHaveProperty('syncAttempts');
    expect(out.get('1001')).toMatchObject({ status: 'sync_failed', errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1, max: 3 } });
    expect(ebayAdapter.drafts.attemptsRelation).toBe('syncAttempts');
  });

  it('filters, orders and limits the attempts it includes (fake DB applies the include spec)', async () => {
    const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
    const fake = makeDb({
      etsyListingDraft: [
        {
          id: 'd1', etsyShopId: 'shop1', userId: 'u1', etsyListingId: BigInt(1001), status: 'failed', fieldPatch: {}, queuedActions: [],
          updatedAt: NOW, syncedAt: null, lastSyncError: 'etsy.draftSync.processingNotMapped',
          // Stored oldest first on purpose; the loader must sort newest first and keep only failed / conflict ones.
          syncAttempts: [
            { status: 'failed', startedAt: at(90), result: { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 9, max: 9 } } },
            { status: 'failed', startedAt: at(30), result: { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1, max: 3 } } },
            { status: 'success', startedAt: at(10), result: { errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 5, max: 5 } } },
            { status: 'failed', startedAt: at(5), result: null },
          ],
        },
      ],
    });
    const ctx = { userId: 'u1', store: { id: 'shop1', name: 'S', currency: 'USD', lastPulledAt: null }, stores: [], storeWhere: {}, meta: {} } as StoreContext;
    const caps = { health: false, skus: false, scheduledSendAt: false, drafts: true };
    const out = await loadRowSync(fake, etsyAdapter.drafts, ctx, caps, ['1001'], NOW);
    expect(out.get('1001')).toMatchObject({ errorKey: 'etsy.draftSync.processingNotMapped', errorParams: { min: 1, max: 3 } });
  });
});

describe('Etsy SKUs from EtsyListingOffering.sku', () => {
  const caps = { health: false, skus: false, scheduledSendAt: false, drafts: true, offeringSkus: true };
  it('etsySkus de-duplicates and skips blanks', () => {
    expect(etsySkus({ offerings: [{ sku: ' BB-PINK ' }, { sku: '' }, { sku: null }, { sku: 'BB-PINK' }, { sku: 'BB-BLUE' }] }, caps)).toEqual(['BB-PINK', 'BB-BLUE']);
    expect(etsySkus({ offerings: [{ sku: 'X' }] }, { ...caps, offeringSkus: false })).toEqual([]);
  });

  function db() {
    const base = {
      etsyShopId: 'shop1', tags: [], priceDivisor: 100, priceCurrencyCode: 'USD', state: 'active', url: null, shopSectionId: null,
      views: 0, numFavorers: 0, isPersonalizable: false, thumbnailUrl75x75: null, thumbnailUrl170x135: null, thumbnailUrl570xN: null,
      imageCount: 5, hasVideo: false, hasVariations: true, etsyCreatedTimestamp: 1_700_000_000,
    };
    return makeDb({
      etsyShop: [{ userId: 'u1', shopId: 'shop1', shopName: 'Belle', isActive: true, isDefault: true, createdAt: new Date(1), lastListingSyncAt: NOW }],
      etsyListing: [
        { ...base, id: 'c1', etsyListingId: BigInt(1001), title: 'Box', priceAmount: 1000, quantity: 3, etsyUpdatedTimestamp: 1_700_000_100,
          offerings: [{ variantKey: 'b', sku: 'BOX-L' }, { variantKey: 'a', sku: 'BOX-S' }, { variantKey: 'c', sku: '' }] },
        { ...base, id: 'c2', etsyListingId: BigInt(1002), title: 'Sign', priceAmount: 2000, quantity: 1, etsyUpdatedTimestamp: 1_700_000_050, offerings: [] },
      ],
      etsyListingDraft: [],
    });
  }
  const q = (raw: Record<string, string>) => {
    const p = parseListingsQuery({ marketplace: 'etsy', ...raw });
    if (!p.ok) throw new Error(p.message);
    return p.query;
  };

  it('shows the first offering SKU on the meta line and finds listings by (partial) SKU', async () => {
    setSchemaFieldOverrideForTests((model, field) => model !== 'CatalogDraft' && !['healthScore', 'skus', 'scheduledSendAt'].includes(field));
    expect(schemaCaps(etsyAdapter)).toMatchObject({ skus: false, offeringSkus: true });
    const all = await listListings(db(), etsyAdapter, 'u1', q({}), { now: NOW });
    expect(all.rows.find((r) => r.id === '1001')!.metaLine).toEqual(['ID 1001', 'BOX-S']);
    expect(all.rows.find((r) => r.id === '1002')!.metaLine).toEqual(['ID 1002']);
    expect((await listListings(db(), etsyAdapter, 'u1', q({ q: 'box-l' }), { now: NOW })).rows.map((r) => r.id)).toEqual(['1001']);
  });

  it('does not touch offerings when the generated client lacks EtsyListingOffering.sku', async () => {
    setSchemaFieldOverrideForTests((model, field) => model !== 'CatalogDraft' && model !== 'EtsyListingOffering' && !['healthScore', 'skus', 'scheduledSendAt'].includes(field));
    const all = await listListings(db(), etsyAdapter, 'u1', q({}), { now: NOW });
    expect(all.rows.find((r) => r.id === '1001')!.metaLine).toEqual(['ID 1001']);
    expect((await listListings(db(), etsyAdapter, 'u1', q({ q: 'BOX-L' }), { now: NOW })).rows).toEqual([]);
  });

  it('export / duplicates read the first offering SKU', () => {
    expect(etsyAdapter.exportFields({ offerings: [{ sku: 'BOX-S' }], tags: [], description: null }, caps).sku).toBe('BOX-S');
  });
});

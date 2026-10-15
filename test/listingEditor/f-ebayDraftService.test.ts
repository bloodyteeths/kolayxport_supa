// M6 editor Group F: lib/ebay/draftService.ts against an in-memory Prisma and a scripted eBay API.
// Covers F1 (create → sync runs the creator's calls, never overwrites an existing SKU, resumes from progress,
// never syncs create+delete), F2 (typed errors, conflict result with fields) and F3 (diff / resolve).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const db = { drafts: [] as Row[], media: [] as Row[], attempts: [] as Row[] };
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && Array.isArray((v as Row).in)) return (v as Row).in.includes(row[k]);
      return row[k] === v;
    });
  const withRel = (d: Row | undefined) =>
    d ? { ...d, media: db.media.filter((m) => m.draftId === d.id), syncAttempts: db.attempts.filter((a) => a.draftId === d.id) } : null;
  const prisma = {
    ebayListingDraft: {
      findFirst: vi.fn(async ({ where }: Row) => withRel(db.drafts.filter((d) => matches(d, where)).sort((a, b) => b.updatedAt - a.updatedAt)[0])),
      findUnique: vi.fn(async ({ where }: Row) => withRel(db.drafts.find((d) => d.id === where.id))),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: id('d'), status: 'draft', variationPatch: null, offerId: null, listingId: null, lastSyncError: null, ...data, updatedAt: Date.now() };
        db.drafts.push(row);
        return withRel(row);
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = db.drafts.find((d) => d.id === where.id)!;
        Object.assign(row, data, { updatedAt: Date.now() });
        return withRel(row);
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.drafts.filter((d) => matches(d, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
      delete: vi.fn(async ({ where }: Row) => {
        db.drafts = db.drafts.filter((d) => d.id !== where.id);
      }),
    },
    ebayDraftMedia: {
      findMany: vi.fn(async ({ where }: Row) => db.media.filter((m) => m.draftId === where.draftId)),
      createMany: vi.fn(async ({ data }: Row) => {
        for (const m of data) db.media.push({ id: id('m'), ...m });
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.media.filter((m) => matches(m, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    ebayDraftSyncAttempt: {
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: id('a'), startedAt: new Date(), ...data };
        db.attempts.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: Row) => Object.assign(db.attempts.find((a) => a.id === where.id)!, data)),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  /** Scripted eBay: route handlers by "METHOD path". */
  const ebay = {
    items: new Map<string, Row>(),
    offers: new Map<string, Row>(),
    calls: [] as string[],
    failPublish: null as string | null,
  };
  const call = vi.fn(async (url: string, opts: Row = {}) => {
    const method = (opts.options?.method || 'GET') as string;
    const path = url.replace('https://api.ebay.com/sell/inventory/v1/', '');
    ebay.calls.push(`${method} ${path}`);
    const body = opts.options?.body ? JSON.parse(opts.options.body) : undefined;
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^inventory_item\/([^/?]+)$/))) {
      const sku = decodeURIComponent(m[1]);
      if (method === 'GET') {
        if (!ebay.items.has(sku)) throw new Error('eBay API 404: not found');
        return ebay.items.get(sku);
      }
      if (method === 'PUT') { ebay.items.set(sku, body); return { success: true }; }
    }
    if (path.startsWith('offer?sku=')) return { offers: [] };
    if (path.startsWith('location')) return { locations: [{ merchantLocationKey: 'LOC1' }] };
    if (path === 'offer' && method === 'POST') {
      const offerId = `O-${body.sku}`;
      ebay.offers.set(offerId, body);
      return { offerId };
    }
    if ((m = path.match(/^offer\/([^/]+)\/publish$/))) {
      if (ebay.failPublish) throw new Error(ebay.failPublish);
      return { listingId: `L-${m[1]}` };
    }
    if (path === 'offer/publish_by_inventory_item_group') return { listingId: 'L-GROUP' };
    if ((m = path.match(/^offer\/([^/?]+)$/)) && method === 'PUT') {
      const offerId = decodeURIComponent(m[1]);
      ebay.offers.set(offerId, { ...(ebay.offers.get(offerId) || {}), ...body });
      return {};
    }
    if ((m = path.match(/^offer\/([^/?]+)$/)) && method === 'GET') {
      const o = ebay.offers.get(decodeURIComponent(m[1]));
      if (!o) throw new Error('eBay API 404');
      return o;
    }
    if (path.startsWith('inventory_item_group/')) return { success: true };
    return { success: true };
  });
  return { db, prisma, ebay, call, reset: () => { db.drafts = []; db.media = []; db.attempts = []; ebay.items.clear(); ebay.offers.clear(); ebay.calls = []; ebay.failPublish = null; } };
});

vi.mock('@/lib/prisma', () => ({ default: h.prisma }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/integrations/ebayClient', () => ({ getUserAccessToken: vi.fn(async () => 'tok') }));
vi.mock('@/lib/integrations/ebayRateLimiter', () => ({ callEbayRateLimited: h.call }));

import { discardDraft, getDraftDiff, removeQueuedActions, resolveDraft, syncDraft, upsertDraftPatch } from '@/lib/ebay/draftService';

const inventory = {
  product: { title: 'Wooden Keepsake Box', description: '<p>Hand made</p>', imageUrls: ['https://i/1.jpg'] },
  condition: 'NEW',
  availability: { shipToLocationAvailability: { quantity: 2 } },
};
const offer = {
  pricingSummary: { price: { value: '24.99', currency: 'USD' } },
  listingPolicies: { fulfillmentPolicyId: 'F', returnPolicyId: 'R', paymentPolicyId: 'P' },
  categoryId: '99',
};

beforeEach(() => h.reset());

describe('F1 create drafts', () => {
  it('staging a new listing never reads eBay and syncing runs item → location → offer → publish', async () => {
    const draft = await upsertDraftPatch({
      userId: 'u1', sku: 'KX-NEW', inventoryFields: inventory, offerFields: offer, replaceFields: true,
      queuedActions: [{ type: 'create', publish: true }],
    });
    expect(h.ebay.calls).toEqual([]);
    expect(draft!.baseSnapshotInventory).toEqual({});

    const result: any = await syncDraft(draft!.id, 'u1');
    expect(result).toMatchObject({ status: 'success', created: true, sku: 'KX-NEW', offerId: 'O-KX-NEW', listingId: 'L-O-KX-NEW', published: true });
    expect(h.ebay.calls).toEqual([
      'GET inventory_item/KX-NEW',
      'PUT inventory_item/KX-NEW',
      'GET location?limit=1',
      'POST offer',
      'POST offer/O-KX-NEW/publish',
    ]);
    expect(h.ebay.offers.get('O-KX-NEW')).toMatchObject({ merchantLocationKey: 'LOC1', availableQuantity: 2, listingDescription: '<p>Hand made</p>' });
    const row = h.db.drafts.find((d) => d.id === draft!.id)!;
    expect(row).toMatchObject({ status: 'synced', offerId: 'O-KX-NEW', listingId: 'L-O-KX-NEW' });
  });

  it('refuses to overwrite an existing eBay item with the same SKU', async () => {
    h.ebay.items.set('KX-TAKEN', { product: { title: 'Someone else' } });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-TAKEN', inventoryFields: inventory, offerFields: offer, queuedActions: [{ type: 'create' }] });
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'SKU_EXISTS', status: 409, key: 'draftSync.skuExists' });
    expect(h.ebay.calls.filter((c) => c.startsWith('PUT'))).toEqual([]);
    expect(h.db.drafts[0].status).toBe('failed');
  });

  it('a failed publish keeps progress; the retry re-sends the item and offer (no new offer) and publishes', async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-P', inventoryFields: inventory, offerFields: offer, queuedActions: [{ type: 'create', publish: true }] });
    h.ebay.failPublish = 'eBay API 400: something odd';
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({
      code: 'CREATED_NOT_PUBLISHED', key: 'draftSync.createdNotPublished', params: { sku: 'KX-P', cause: 'draftSync.rejected' },
    });
    const progress = h.db.drafts[0].queuedActions[0].progress;
    expect(progress).toMatchObject({ sku: 'KX-P', itemsCreated: ['KX-P'], offerIds: { 'KX-P': 'O-KX-P' } });

    h.ebay.failPublish = null;
    h.ebay.calls = [];
    const result: any = await syncDraft(draft!.id, 'u1');
    expect(result.status).toBe('success');
    // No existence check for our own SKU, no second offer POST.
    expect(h.ebay.calls).toEqual(['PUT inventory_item/KX-P', 'GET location?limit=1', 'PUT offer/O-KX-P', 'POST offer/O-KX-P/publish']);
  });

  it('edits made after a failed publish reach eBay on the retry (aspects on the item, category / policy on the offer)', async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-R', inventoryFields: inventory, offerFields: offer, replaceFields: true, queuedActions: [{ type: 'create', publish: true }] });
    h.ebay.failPublish = 'eBay API 400: The item specific Brand is missing.';
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'MISSING_ASPECTS', extra: { createdOnEbay: true, sku: 'KX-R' } });

    // The seller fixes the listing in the editor (autosave restages the whole content).
    await upsertDraftPatch({
      userId: 'u1', sku: 'KX-R', replaceFields: true,
      inventoryFields: { ...inventory, product: { ...inventory.product, aspects: { Brand: ['Belle'] } } },
      offerFields: { ...offer, categoryId: '123', listingPolicies: { ...offer.listingPolicies, returnPolicyId: 'R2' } },
    });
    h.ebay.failPublish = null;
    h.ebay.calls = [];
    const result: any = await syncDraft(draft!.id, 'u1');
    expect(result.status).toBe('success');
    expect(h.ebay.calls).not.toContain('POST offer');
    expect(h.ebay.items.get('KX-R')!.product.aspects).toEqual({ Brand: ['Belle'] });
    expect(h.ebay.offers.get('O-KX-R')).toMatchObject({ categoryId: '123', listingPolicies: { returnPolicyId: 'R2' }, merchantLocationKey: 'LOC1' });
  });

  it("uses the seller's own SKU on eBay and re-keys the draft only after the send succeeds", async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-LOCAL', inventoryFields: inventory, offerFields: offer, queuedActions: [{ type: 'create', publish: true, sku: 'BB-PINK' }] });
    h.ebay.failPublish = 'eBay API 400: odd';
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'CREATED_NOT_PUBLISHED' });
    // Still keyed locally (the editor stages by its local key), but the SKU on eBay is locked.
    expect(h.db.drafts[0].sku).toBe('KX-LOCAL');
    expect(h.db.drafts[0].queuedActions[0].progress.sku).toBe('BB-PINK');

    // Changing the SKU field after something exists on eBay changes nothing.
    await upsertDraftPatch({ userId: 'u1', sku: 'KX-LOCAL', queuedActions: [{ type: 'create', publish: true, sku: 'OTHER' }] });
    h.ebay.failPublish = null;
    h.ebay.calls = [];
    const result: any = await syncDraft(draft!.id, 'u1');
    expect(result).toMatchObject({ status: 'success', sku: 'BB-PINK', offerId: 'O-BB-PINK' });
    expect(h.ebay.calls.every((c) => !c.includes('OTHER') && !c.includes('KX-LOCAL'))).toBe(true);
    expect(h.db.drafts[0].sku).toBe('BB-PINK');
  });

  it("refuses the seller's SKU when another open draft uses it", async () => {
    await upsertDraftPatch({ userId: 'u1', sku: 'BB-PINK', inventoryFields: { product: { title: 'x' } }, queuedActions: [{ type: 'create' }] });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-2', inventoryFields: inventory, offerFields: offer, queuedActions: [{ type: 'create', sku: 'BB-PINK' }] });
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'SKU_EXISTS', params: { sku: 'BB-PINK' } });
    expect(h.ebay.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
  });

  it('a new listing that already exists on eBay cannot be discarded; one with nothing on eBay can', async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-D', inventoryFields: inventory, offerFields: offer, queuedActions: [{ type: 'create', publish: true }] });
    h.ebay.failPublish = 'eBay API 400: odd';
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'CREATED_NOT_PUBLISHED' });
    await expect(discardDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'CREATED_ON_EBAY', status: 409, key: 'draftSync.createdOnEbay', params: { sku: 'KX-D' } });
    expect(h.db.drafts).toHaveLength(1);

    const fresh = await upsertDraftPatch({ userId: 'u1', sku: 'KX-F', inventoryFields: inventory, queuedActions: [{ type: 'create' }] });
    await expect(discardDraft(fresh!.id, 'u1')).resolves.toEqual({ success: true });
  });

  it('a new multi-variation listing: item per variant, group, offer per variant, publish by group', async () => {
    const draft = await upsertDraftPatch({
      userId: 'u1', sku: 'KX-V', inventoryFields: inventory, offerFields: offer, replaceFields: true,
      variationFields: {
        specifications: [{ name: 'Color', values: ['Pink', 'Blue'] }],
        variants: [
          { sku: 'KX-V-PINK', combination: { Color: 'Pink' }, quantity: 2, price: '20.00' },
          { sku: 'KX-V-BLUE', combination: { Color: 'Blue' }, quantity: 3, price: null },
        ],
      },
      queuedActions: [{ type: 'create', publish: true }],
    });
    const result: any = await syncDraft(draft!.id, 'u1');
    expect(result).toMatchObject({ status: 'success', listingId: 'L-GROUP' });
    expect(h.ebay.calls.filter((c) => !c.startsWith('GET'))).toEqual([
      'PUT inventory_item/KX-V-PINK',
      'PUT inventory_item/KX-V-BLUE',
      'PUT inventory_item_group/KX-V',
      'POST offer',
      'POST offer',
      'POST offer/publish_by_inventory_item_group',
    ]);
    expect(h.ebay.offers.get('O-KX-V-BLUE')).toMatchObject({ pricingSummary: { price: { value: '24.99' } }, availableQuantity: 3 });
  });

  it('blocks a send when required content is missing, before touching eBay', async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-E', inventoryFields: { product: { title: 'x' } }, queuedActions: [{ type: 'create' }] });
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'CREATE_INCOMPLETE', status: 422 });
    expect(h.ebay.calls).toEqual([]);
  });

  it('never accepts a delete on a new listing (and never syncs one)', async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'KX-D', inventoryFields: inventory, queuedActions: [{ type: 'create' }] });
    await expect(upsertDraftPatch({ userId: 'u1', sku: 'KX-D', queuedActions: [{ type: 'delete' }] })).rejects.toMatchObject({ code: 'DELETE_ON_NEW' });
    h.db.drafts[0].queuedActions.push({ type: 'delete' });
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'DELETE_ON_NEW' });
    expect(h.ebay.calls).toEqual([]);
  });

  it('a create action cannot hijack an open draft of an existing item', async () => {
    h.ebay.items.set('EXIST', { product: { title: 'Live' } });
    await upsertDraftPatch({ userId: 'u1', sku: 'EXIST', inventoryFields: { product: { title: 'edit' } } });
    await expect(upsertDraftPatch({ userId: 'u1', sku: 'EXIST', queuedActions: [{ type: 'create' }] })).rejects.toMatchObject({ code: 'SKU_EXISTS' });
  });
});

describe('F2 typed errors + conflicts', () => {
  it('missing draft → DRAFT_NOT_FOUND 404', async () => {
    await expect(syncDraft('nope', 'u1')).rejects.toMatchObject({ code: 'DRAFT_NOT_FOUND', status: 404 });
  });

  it('a conflict returns the field list and writes nothing', async () => {
    h.ebay.items.set('S1', { product: { title: 'A' }, condition: 'NEW' });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'S1', inventoryFields: { product: { title: 'B' } } });
    h.ebay.items.set('S1', { product: { title: 'A' }, condition: 'USED_GOOD' });
    h.ebay.calls = [];
    const result: any = await syncDraft(draft!.id, 'u1');
    expect(result).toMatchObject({ status: 'conflict', field: 'condition', fields: ['condition'], key: 'draftSync.conflict' });
    expect(h.ebay.calls.filter((c) => !c.startsWith('GET'))).toEqual([]);
  });

  it('preserveConflict keeps a conflict draft in conflict while autosaving', async () => {
    h.ebay.items.set('S2', { product: { title: 'A' } });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'S2', inventoryFields: { product: { title: 'B' } } });
    h.db.drafts[0].status = 'conflict';
    h.db.drafts[0].lastSyncError = 'x';
    const after = await upsertDraftPatch({ userId: 'u1', sku: 'S2', inventoryFields: { product: { title: 'C' } }, replaceFields: true, preserveConflict: true });
    expect(after).toMatchObject({ id: draft!.id, status: 'conflict', lastSyncError: 'x' });
    // Legacy re-edit (no flag) re-bases as before.
    const legacy = await upsertDraftPatch({ userId: 'u1', sku: 'S2', inventoryFields: { product: { title: 'D' } } });
    expect(legacy!.status).toBe('draft');
  });
});

describe('F3 diff / resolve + queued action removal', () => {
  it('diff compares base vs live vs patch; resolve drops eBay-kept fields and re-bases', async () => {
    h.ebay.items.set('S3', { product: { title: 'Old', description: 'd' }, availability: { shipToLocationAvailability: { quantity: 5 } } });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'S3', inventoryFields: { product: { title: 'Mine', description: 'mine too' } } });
    h.ebay.items.set('S3', { product: { title: 'Theirs', description: 'd' }, availability: { shipToLocationAvailability: { quantity: 4 } } });

    const diff = await getDraftDiff(draft!.id, 'u1');
    // The Inventory API has no modification time: never claim one.
    expect(diff.remoteUpdatedAt).toBeNull();
    expect(diff.fields.map((f) => [f.key, f.inDraft, f.changedRemotely])).toEqual([
      ['title', true, true],
      ['description', true, false],
      ['quantity', false, true],
    ]);

    const resolved: any = await resolveDraft(draft!.id, 'u1', []);
    expect(resolved.status).toBe('draft');
    expect(resolved.inventoryPatch).toEqual({ product: { description: 'mine too' } });
    expect(resolved.baseSnapshotInventory.product.title).toBe('Theirs');
    // Resolve never sends.
    expect(h.ebay.calls.some((c) => c.startsWith('PUT') || c.startsWith('POST'))).toBe(false);
  });

  it('removes a queued delete without touching anything else', async () => {
    h.ebay.items.set('S4', { product: { title: 'x' } });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'S4', queuedActions: [{ type: 'delete' }, { type: 'publish' }] });
    const after: any = await removeQueuedActions(draft!.id, 'u1', ['delete']);
    expect(after.queuedActions).toEqual([{ type: 'publish' }]);
  });
});

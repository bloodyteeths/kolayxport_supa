// eBay listing video in the staged-draft engine (lib/ebay/draftService + draftPlan + legacyTrading), against an
// in-memory Prisma, a scripted Inventory API and a mocked Media API / Trading API. Never reaches eBay.
// Covers: staging (one video per listing, legacy accepts only video media, removal rows), send for a new listing
// (create plan carries product.videoIds), an existing Inventory listing (inventory item PUT), a variation group,
// a legacy listing (ReviseFixedPriceItem VideoDetails / DeletedField), "still processing" (rest sent, draft kept,
// no re-upload on retry), rejected, and the reconnect refusal before any listing call.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  // Staged files go to a temp dir (UPLOAD_ROOT is read when draftService loads).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('os') as typeof import('os');
  process.env.EBAY_IMAGE_UPLOAD_DIR = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'kx-ebay-uploads-'));
  const db = { drafts: [] as Row[], media: [] as Row[], attempts: [] as Row[] };
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'NOT') return !matches(row, v as Row);
      if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
      if (k === 'draft') return true;
      if (v && typeof v === 'object' && Array.isArray((v as Row).in)) return (v as Row).in.includes(row[k]);
      return row[k] === v;
    });
  const withRel = (d: Row | undefined) =>
    d ? { ...d, media: db.media.filter((m) => m.draftId === d.id), syncAttempts: db.attempts.filter((a) => a.draftId === d.id), _count: { media: db.media.filter((m) => m.draftId === d.id).length } } : null;
  const prisma = {
    ebayListingDraft: {
      findFirst: vi.fn(async ({ where }: Row) => withRel(db.drafts.filter((d) => matches(d, where)).sort((a, b) => b.updatedAt - a.updatedAt)[0])),
      findUnique: vi.fn(async ({ where }: Row) => withRel(db.drafts.find((d) => d.id === where.id))),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: id('d'), status: 'draft', variationPatch: null, offerId: null, listingId: null, lastSyncError: null, scheduledSendAt: null, ...data, updatedAt: Date.now() };
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
      delete: vi.fn(async ({ where }: Row) => { db.drafts = db.drafts.filter((d) => d.id !== where.id); }),
    },
    ebayDraftMedia: {
      findMany: vi.fn(async ({ where }: Row) => db.media.filter((m) => matches(m, where))),
      count: vi.fn(async ({ where }: Row) => db.media.filter((m) => matches(m, where)).length),
      create: vi.fn(async ({ data }: Row) => {
        const row = { id: id('m'), createdAt: new Date(), ...data };
        db.media.push(row);
        return row;
      }),
      createMany: vi.fn(async ({ data }: Row) => { for (const m of data) db.media.push({ id: id('m'), createdAt: new Date(), ...m }); }),
      update: vi.fn(async ({ where, data }: Row) => Object.assign(db.media.find((m) => m.id === where.id)!, data)),
      deleteMany: vi.fn(async ({ where }: Row) => {
        const before = db.media.length;
        db.media = db.media.filter((m) => !matches(m, where));
        return { count: before - db.media.length };
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.media.filter((m) => matches(m, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    ebayDraftSyncAttempt: {
      create: vi.fn(async ({ data }: Row) => { const row = { id: id('a'), startedAt: new Date(), ...data }; db.attempts.push(row); return row; }),
      update: vi.fn(async ({ where, data }: Row) => Object.assign(db.attempts.find((a) => a.id === where.id)!, data)),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    ebayListing: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const ebay = { items: new Map<string, Row>(), groups: new Map<string, Row>(), offers: new Map<string, Row>(), calls: [] as string[] };
  const call = vi.fn(async (url: string, opts: Row = {}) => {
    const method = (opts.options?.method || 'GET') as string;
    const p = url.replace('https://api.ebay.com/sell/inventory/v1/', '');
    ebay.calls.push(`${method} ${p}`);
    const body = opts.options?.body ? JSON.parse(opts.options.body) : undefined;
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^inventory_item\/([^/?]+)$/))) {
      const sku = decodeURIComponent(m[1]);
      if (method === 'GET') { if (!ebay.items.has(sku)) throw new Error('eBay API 404: not found'); return ebay.items.get(sku); }
      if (method === 'PUT') { ebay.items.set(sku, body); return {}; }
    }
    if ((m = p.match(/^inventory_item_group\/([^/?]+)$/))) {
      const key = decodeURIComponent(m[1]);
      if (method === 'GET') { if (!ebay.groups.has(key)) throw new Error('eBay API 404'); return { inventoryItemGroupKey: key, ...ebay.groups.get(key) }; }
      if (method === 'PUT') { ebay.groups.set(key, body); return {}; }
    }
    if (p.startsWith('offer?sku=')) return { offers: [] };
    if (p.startsWith('location')) return { locations: [{ merchantLocationKey: 'LOC1' }] };
    if (p === 'offer' && method === 'POST') { const offerId = `O-${body.sku}`; ebay.offers.set(offerId, body); return { offerId }; }
    if ((m = p.match(/^offer\/([^/]+)\/publish$/))) return { listingId: `L-${m[1]}` };
    if (p === 'offer/publish_by_inventory_item_group') return { listingId: 'L-GROUP' };
    return {};
  });
  const media = {
    uploadEbayVideoFile: vi.fn(async () => 'EV-1'),
    waitForEbayVideo: vi.fn(async (_t: string, videoId: string) => ({ state: 'live', videoId })),
  };
  const legacy = {
    item: { itemId: '555', status: 'Active', title: 'Old', description: 'd', price: { value: '5', currency: 'USD' }, quantity: 1, hasVariations: false, videoId: 'OLDV' } as Row,
    getLegacyItem: vi.fn(async () => legacy.item),
    setLegacyItemVideo: vi.fn(async () => undefined),
    removeLegacyItemVideo: vi.fn(async () => undefined),
  };
  return {
    db, prisma, ebay, call, media, legacy,
    reset: () => {
      db.drafts = []; db.media = []; db.attempts = [];
      ebay.items.clear(); ebay.groups.clear(); ebay.offers.clear(); ebay.calls = [];
    },
  };
});

vi.mock('@/lib/prisma', () => ({ default: h.prisma }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/integrations/ebayClient', () => ({ getUserAccessToken: vi.fn(async () => 'tok') }));
vi.mock('@/lib/integrations/ebayRateLimiter', () => ({ callEbayRateLimited: h.call }));
vi.mock('@/lib/ebay/mediaApi', async (orig) => ({ ...(await orig<typeof import('@/lib/ebay/mediaApi')>()), ...h.media }));
vi.mock('@/lib/ebay/legacyTrading', async (orig) => ({
  ...(await orig<typeof import('@/lib/ebay/legacyTrading')>()),
  getLegacyItem: h.legacy.getLegacyItem,
  setLegacyItemVideo: h.legacy.setLegacyItemVideo,
  removeLegacyItemVideo: h.legacy.removeLegacyItemVideo,
}));

import { EbayMediaError } from '@/lib/ebay/mediaApi';
import {
  createDraftMediaFile,
  dropOtherVideoRows,
  legacyStageParams,
  removeDraftMediaRows,
  syncDraft,
  upsertDraftPatch,
} from '@/lib/ebay/draftService';
import { buildCreatePlan, videoIntent, withVideo } from '@/lib/ebay/draftPlan';
import { legacyVideoRemoveXml, legacyVideoXml, parseLegacyItem } from '@/lib/ebay/legacyTrading';

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

function tempVideo() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kx-ebay-draft-video-')), 'in.mp4');
  fs.writeFileSync(file, Buffer.alloc(64, 1));
  return file;
}

async function stageVideo(draftId: string, sku: string) {
  const media = await createDraftMediaFile({ userId: 'u1', draftId, sku, kind: 'video', operation: 'upload', tempPath: tempVideo(), filename: 'clip.mp4', contentType: 'video/mp4' });
  await dropOtherVideoRows(draftId, media.id);
  return media;
}

beforeEach(() => {
  h.reset();
  h.media.uploadEbayVideoFile.mockReset().mockResolvedValue('EV-1');
  h.media.waitForEbayVideo.mockReset().mockImplementation(async (_t: string, videoId: string) => ({ state: 'live', videoId }));
  h.legacy.getLegacyItem.mockClear();
  h.legacy.setLegacyItemVideo.mockClear();
  h.legacy.removeLegacyItemVideo.mockClear();
});

describe('pure helpers', () => {
  it('videoIntent: newest upload wins over a removal; a removal alone removes', () => {
    expect(videoIntent([])).toBeNull();
    expect(videoIntent([{ kind: 'image', operation: 'upload' }])).toBeNull();
    const a = { id: 'a', kind: 'video', operation: 'upload' };
    const b = { id: 'b', kind: 'video', operation: 'upload' };
    const d = { id: 'd', kind: 'video', operation: 'delete' };
    expect(videoIntent([d, a, b])).toEqual({ type: 'set', row: b });
    expect(videoIntent([d])).toEqual({ type: 'remove', row: d });
  });
  it('withVideo sets one id or drops the field', () => {
    expect(withVideo({ title: 't', videoIds: ['x'] }, 'y')).toEqual({ title: 't', videoIds: ['y'] });
    expect(withVideo({ title: 't', videoIds: ['x'] }, null)).toEqual({ title: 't' });
  });
  it('create plan: product.videoIds on the item; variations: the group carries videoIds; video rows never become photos', () => {
    const media = [{ kind: 'video', operation: 'upload', localPath: '/x.mp4' }] as any;
    const simple = buildCreatePlan({ sku: 'S1', action: { type: 'create' }, inventoryPatch: inventory, offerPatch: offer, variationPatch: null, media, videoId: 'EV-1' });
    expect(simple.calls[0].body!.product.videoIds).toEqual(['EV-1']);
    expect(simple.calls[0].body!.product.imageUrls).toEqual(['https://i/1.jpg']);
    const none = buildCreatePlan({ sku: 'S1', action: { type: 'create' }, inventoryPatch: inventory, offerPatch: offer, variationPatch: null, media });
    expect(none.calls[0].body!.product.videoIds).toBeUndefined();
    const vars = buildCreatePlan({
      sku: 'G1', action: { type: 'create' }, inventoryPatch: inventory, offerPatch: offer, media, videoId: 'EV-2',
      variationPatch: { variants: [{ sku: 'G1-R', combination: { Color: 'Red' }, quantity: 1, price: 5 }], specifications: [{ name: 'Color', values: ['Red'] }] },
    });
    expect(vars.calls.find((c) => c.step === 'inventory_item_group')!.body!.videoIds).toEqual(['EV-2']);
  });
  it('legacy Trading XML: VideoDetails.VideoID to set, DeletedField to remove; GetItem parses the video', () => {
    expect(legacyVideoXml('123', 'EV<1>')).toBe('<Item><ItemID>123</ItemID><VideoDetails><VideoID>EV&lt;1&gt;</VideoID></VideoDetails></Item>');
    expect(legacyVideoRemoveXml('123')).toBe('<Item><ItemID>123</ItemID></Item><DeletedField>Item.VideoDetails.VideoID</DeletedField>');
    const xml = '<GetItemResponse><Ack>Success</Ack><Item><Title>T</Title><VideoDetails><VideoID>V42</VideoID></VideoDetails><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus></Item></GetItemResponse>';
    expect(parseLegacyItem(xml, '1').videoId).toBe('V42');
    expect(parseLegacyItem('<Item><Title>T</Title></Item>', '1').videoId).toBeUndefined();
  });
  it('legacy listings stage a video but still refuse photos', () => {
    expect(() => legacyStageParams({ media: [{ kind: 'video', operation: 'delete', payload: { videoId: 'V' } }] })).not.toThrow();
    expect(() => legacyStageParams({ media: [{ kind: 'image', operation: 'upload' }] })).toThrow(/Only title/);
  });
});

describe('staging', () => {
  it('one staged video per listing: a new upload drops the earlier upload and a staged removal', async () => {
    h.ebay.items.set('SKU1', inventory);
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU1', media: [{ kind: 'video', operation: 'delete', payload: { videoId: 'OLD' } }] });
    const first = await stageVideo(draft!.id, 'SKU1');
    const second = await stageVideo(draft!.id, 'SKU1');
    const rows = h.db.media.filter((m) => m.draftId === draft!.id);
    expect(rows.map((r) => r.id)).toEqual([second.id]);
    expect(first.localPath).not.toBe(second.localPath);
    await vi.waitFor(() => expect(fs.existsSync(first.localPath!)).toBe(false));
    expect(fs.existsSync(second.localPath!)).toBe(true);
    expect(h.ebay.calls.filter((c) => c.startsWith('PUT'))).toEqual([]);
  });
  it('staged files live under the configured upload root, not the repo', async () => {
    h.ebay.items.set('SKU0', inventory);
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU0', inventoryFields: {} });
    const row = await stageVideo(draft!.id, 'SKU0');
    expect(row.localPath!.startsWith(process.env.EBAY_IMAGE_UPLOAD_DIR!)).toBe(true);
  });
  it('removing a staged row is local only and closes a draft left empty', async () => {
    h.ebay.items.set('SKU2', inventory);
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU2', inventoryFields: {} });
    const row = await stageVideo(draft!.id, 'SKU2');
    const after = await removeDraftMediaRows(draft!.id, 'u1', [row.id]);
    expect(h.db.media).toHaveLength(0);
    expect(after!.status).toBe('cancelled');
    expect(h.media.uploadEbayVideoFile).not.toHaveBeenCalled();
  });
});

describe('send', () => {
  it('new listing: uploads, waits for LIVE, the inventory item carries product.videoIds', async () => {
    const draft = await upsertDraftPatch({
      userId: 'u1', sku: 'KX-NEW', inventoryFields: inventory, offerFields: offer, replaceFields: true,
      queuedActions: [{ type: 'create', publish: true }],
    });
    await stageVideo(draft!.id, 'KX-NEW');
    const r: any = await syncDraft(draft!.id, 'u1');
    expect(r.status).toBe('success');
    expect(r.created).toBe(true);
    expect(h.media.uploadEbayVideoFile).toHaveBeenCalledTimes(1);
    expect(h.ebay.items.get('KX-NEW')!.product.videoIds).toEqual(['EV-1']);
    expect(h.db.drafts[0].status).toBe('synced');
  });

  it('existing listing: PUT inventory item with videoIds (other fields kept); removal drops videoIds', async () => {
    h.ebay.items.set('SKU3', { ...inventory, product: { ...inventory.product, videoIds: ['OLD'] } });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU3', inventoryFields: {} });
    await stageVideo(draft!.id, 'SKU3');
    await syncDraft(draft!.id, 'u1');
    expect(h.ebay.items.get('SKU3')!.product).toMatchObject({ title: 'Wooden Keepsake Box', imageUrls: ['https://i/1.jpg'], videoIds: ['EV-1'] });

    const d2 = await upsertDraftPatch({ userId: 'u1', sku: 'SKU3', media: [{ kind: 'video', operation: 'delete', payload: { videoId: 'EV-1' } }] });
    await syncDraft(d2!.id, 'u1');
    expect(h.ebay.items.get('SKU3')!.product.videoIds).toBeUndefined();
    expect(h.ebay.items.get('SKU3')!.product.title).toBe('Wooden Keepsake Box');
  });

  it('variation listing (group key): the group gets videoIds', async () => {
    h.ebay.groups.set('GRP', { title: 'Box', variantSKUs: ['GRP-R'], imageUrls: ['https://i/1.jpg'] });
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'GRP', inventoryFields: {} });
    await stageVideo(draft!.id, 'GRP');
    await syncDraft(draft!.id, 'u1');
    expect(h.ebay.groups.get('GRP')).toMatchObject({ title: 'Box', variantSKUs: ['GRP-R'], videoIds: ['EV-1'] });
    expect(h.ebay.groups.get('GRP')!.inventoryItemGroupKey).toBeUndefined();
  });

  it('legacy listing: ReviseFixedPriceItem VideoDetails to set, DeletedField to remove', async () => {
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'legacy-555', inventoryFields: {} });
    await stageVideo(draft!.id, 'legacy-555');
    const r: any = await syncDraft(draft!.id, 'u1');
    expect(r.status).toBe('success');
    expect(h.legacy.setLegacyItemVideo).toHaveBeenCalledWith('tok', '555', 'EV-1');

    const d2 = await upsertDraftPatch({ userId: 'u1', sku: 'legacy-555', media: [{ kind: 'video', operation: 'delete', payload: { videoId: 'OLDV' } }] });
    await syncDraft(d2!.id, 'u1');
    expect(h.legacy.removeLegacyItemVideo).toHaveBeenCalledWith('tok', '555');
  });

  it('still processing: the rest is sent, the draft keeps only the video row, a retry polls without re-uploading', async () => {
    h.ebay.items.set('SKU4', inventory);
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU4', inventoryFields: { product: { title: 'New Title' } } });
    const row = await stageVideo(draft!.id, 'SKU4');
    h.media.waitForEbayVideo.mockResolvedValueOnce({ state: 'processing', videoId: 'EV-1' });
    const r: any = await syncDraft(draft!.id, 'u1');
    expect(r).toMatchObject({ status: 'success', video: { state: 'processing' }, warnings: [{ key: 'ebay.draftSync.videoProcessing' }] });
    expect(h.ebay.items.get('SKU4')!.product.title).toBe('New Title');
    expect(h.ebay.items.get('SKU4')!.product.videoIds).toBeUndefined();
    const d = h.db.drafts[0];
    expect(d).toMatchObject({ status: 'failed', lastSyncError: 'ebay.draftSync.videoProcessing', inventoryPatch: {}, queuedActions: [] });
    expect(h.db.media.map((m) => m.id)).toEqual([row.id]);
    expect(h.db.media[0].payload.ebayVideoId).toBe('EV-1');

    const again: any = await syncDraft(d.id, 'u1');
    expect(again.status).toBe('success');
    expect(h.media.uploadEbayVideoFile).toHaveBeenCalledTimes(1);
    expect(h.ebay.items.get('SKU4')!.product.videoIds).toEqual(['EV-1']);
    expect(h.db.drafts[0].status).toBe('synced');
  });

  it('new listing still processing: listed without the video, the draft becomes an edit draft of the new SKU', async () => {
    const draft = await upsertDraftPatch({
      userId: 'u1', sku: 'local-1', inventoryFields: inventory, offerFields: offer, replaceFields: true,
      queuedActions: [{ type: 'create', publish: true, sku: 'MY-SKU' }],
    });
    await stageVideo(draft!.id, 'local-1');
    h.media.waitForEbayVideo.mockResolvedValueOnce({ state: 'processing', videoId: 'EV-1' });
    const r: any = await syncDraft(draft!.id, 'u1');
    expect(r).toMatchObject({ status: 'success', created: true, sku: 'MY-SKU', video: { state: 'processing' } });
    expect(h.db.drafts[0]).toMatchObject({ sku: 'MY-SKU', status: 'failed', queuedActions: [], offerId: 'O-MY-SKU' });
    expect(h.db.media[0].sku).toBe('MY-SKU');
    await syncDraft(h.db.drafts[0].id, 'u1');
    expect(h.ebay.items.get('MY-SKU')!.product.videoIds).toEqual(['EV-1']);
  });

  it('rejected by eBay: the rest is sent, the row is flagged, a retry does not upload again', async () => {
    h.ebay.items.set('SKU5', inventory);
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU5', inventoryFields: {} });
    await stageVideo(draft!.id, 'SKU5');
    h.media.waitForEbayVideo.mockRejectedValueOnce(new EbayMediaError('REJECTED', 'eBay video BLOCKED'));
    const r: any = await syncDraft(draft!.id, 'u1');
    expect(r.video).toEqual({ state: 'rejected' });
    expect(h.db.drafts[0].lastSyncError).toBe('ebay.draftSync.videoRejected');
    expect(h.db.media[0].payload.rejected).toBe(true);
    await syncDraft(h.db.drafts[0].id, 'u1');
    expect(h.media.uploadEbayVideoFile).toHaveBeenCalledTimes(1);
  });

  it('reconnect needed: refused before any listing call, the draft is kept as failed with videoReconnect', async () => {
    h.ebay.items.set('SKU6', inventory);
    const draft = await upsertDraftPatch({ userId: 'u1', sku: 'SKU6', inventoryFields: { product: { title: 'X' } } });
    await stageVideo(draft!.id, 'SKU6');
    h.media.uploadEbayVideoFile.mockRejectedValueOnce(new EbayMediaError('RECONNECT', 'eBay createVideo 403', 403));
    h.ebay.calls = [];
    await expect(syncDraft(draft!.id, 'u1')).rejects.toMatchObject({ code: 'VIDEO_RECONNECT', key: 'draftSync.videoReconnect' });
    expect(h.ebay.calls.filter((c) => c.startsWith('PUT'))).toEqual([]);
    expect(h.db.drafts[0]).toMatchObject({ status: 'failed', lastSyncError: 'ebay.draftSync.videoReconnect' });
  });
});

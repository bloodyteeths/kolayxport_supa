// M7-E PhotoStudio pure model: strip building (staged uploads / deletes / reorders), filters, and the operation
// planner for every op × source, including the safety rules (queued delete, sending, 20-photo limit, last photo).
import { describe, expect, it } from 'vitest';
import {
  AI_BATCH_CAP,
  DEFAULT_PLAN_INPUT,
  batchWaves,
  buildListingPhotoView,
  buildListingVideoView,
  draftsByListing,
  makePrimaryOps,
  matchesFilter,
  normalizeEtsyImages,
  parseStudioIds,
  planBlocker,
  planOperation,
  planVideo,
  reorderTileOps,
  safeBackHref,
  topSkipReason,
  type ListingPhotoView,
  type PlanInput,
  type StudioDraft,
} from '@/components/domain/photo-studio/studioModel';
import type { EtsyImageLike } from '@/components/domain/listing-editor/sections/photosModel';

const img = (id: number, rank: number, alt = ''): EtsyImageLike => ({
  listing_image_id: id, rank, alt_text: alt, url_570xN: `https://i.etsystatic.com/${id}_570.jpg`, url_fullxfull: `https://i.etsystatic.com/${id}_full.jpg`,
});
const imgs = (n: number, base = 100, alt = 'alt') => Array.from({ length: n }, (_, i) => img(base + i, i + 1, alt));
const draft = (listingId: string, media: StudioDraft['media'], extra: Partial<StudioDraft> = {}): StudioDraft => ({ id: `d-${listingId}`, listingId, status: 'draft', media, queuedDelete: false, ...extra });
const plan = (over: Partial<PlanInput>) => ({ ...DEFAULT_PLAN_INPUT, ...over });
const views = (entries: Array<[string, ListingPhotoView]>) => new Map(entries);

describe('input parsing', () => {
  it('parseStudioIds keeps unique numeric ids, max 250', () => {
    expect(parseStudioIds('1,2, 2,abc,3')).toEqual(['1', '2', '3']);
    expect(parseStudioIds(undefined)).toEqual([]);
    expect(parseStudioIds(Array.from({ length: 300 }, (_, i) => String(i + 1)).join(','))).toHaveLength(250);
  });
  it('safeBackHref accepts only same-app /app paths', () => {
    expect(safeBackHref('/app/etsy-listings/bulk?view=active')).toBe('/app/etsy-listings/bulk?view=active');
    expect(safeBackHref('https://evil.example')).toBeNull();
    expect(safeBackHref('//evil.example/app/')).toBeNull();
    expect(safeBackHref('/settings')).toBeNull();
  });
  it('normalizeEtsyImages sorts by rank and drops rows without an id', () => {
    const out = normalizeEtsyImages({ images: [{ listing_image_id: 2, rank: 2, url_570xN: 'b' }, { listing_image_id: 0 }, { listing_image_id: 1, rank: 1, url_570xN: 'a' }] });
    expect(out.map((i) => i.listing_image_id)).toEqual([1, 2]);
  });
  it('draftsByListing keeps the newest live draft and reads a queued delete', () => {
    const map = draftsByListing({ drafts: [
      { id: 'a', etsyListingId: '5', status: 'draft', media: [], queuedActions: [{ type: 'delete' }] },
      { id: 'b', etsyListingId: '5', status: 'failed', media: [] },
      { id: 'c', etsyListingId: '6', status: 'synced', media: [] },
    ] });
    expect(map.get('5')?.id).toBe('a');
    expect(map.get('5')?.queuedDelete).toBe(true);
    expect(map.has('6')).toBe(false);
  });
});

describe('buildListingPhotoView', () => {
  it('orders staged reorders, inserts staged uploads at their rank and flags AI uploads', () => {
    const d = draft('1', [
      { id: 'm1', kind: 'image', operation: 'reorder', etsyMediaId: '102', rank: 1 },
      { id: 'm2', kind: 'image', operation: 'ai_upload', rank: 2, sourceUrl: null },
      { id: 'm3', kind: 'image', operation: 'delete', etsyMediaId: '101' },
    ]);
    const v = buildListingPhotoView(imgs(3), d);
    expect(v.tiles.map((t) => t.id)).toEqual(['img:102', 'new:m2', 'img:100', 'img:101']);
    expect(v.tiles[1]).toMatchObject({ pending: true, ai: true, staged: 'add', src: '/api/etsy-drafts/media-preview?id=m2' });
    expect(v.tiles[3].staged).toBe('delete');
    expect(v.liveCount).toBe(3);
    expect(v.slotsUsed).toBe(4);
    expect(v.room).toBe(16);
  });
  it('counts missing alt text on Etsy photos only', () => {
    const v = buildListingPhotoView([img(1, 1, ''), img(2, 2, 'ok')], null);
    expect(v.missingAlt).toBe(1);
    expect(matchesFilter('missingAlt', v)).toBe(true);
    expect(matchesFilter('noPhotos', v)).toBe(false);
    expect(matchesFilter('lt5', v)).toBe(true);
    expect(matchesFilter('missingAlt', null)).toBe(true); // not loaded yet: never hidden
  });
});

describe('planOperation', () => {
  const sel = [{ id: '1', title: 'A' }, { id: '2', title: 'B' }];
  const v1 = buildListingPhotoView(imgs(3), null);
  const v2 = buildListingPhotoView(imgs(20, 200), null);

  it('blocks until the op row is complete', () => {
    expect(planBlocker(plan({}), 0)).toBe('noSelection');
    expect(planBlocker(plan({ source: 'upload', fileCount: 0 }), 2)).toBe('chooseFiles');
    expect(planBlocker(plan({ source: 'url', url: 'http://x' }), 2)).toBe('enterUrl');
    expect(planBlocker(plan({ op: 'alt', altMode: 'manual', altText: ' ' }), 2)).toBe('enterAlt');
    expect(planBlocker(plan({ op: 'copy' }), 2)).toBe('pickCopySource');
    expect(planBlocker(plan({ source: 'url', url: 'https://x.test/a.jpg' }), 2)).toBeNull();
  });

  it('Add files fans out to free slots and skips full listings', () => {
    const p = planOperation(plan({ source: 'upload', fileCount: 2 }), sel, views([['1', v1], ['2', v2]]));
    expect(p.uploads).toEqual([{ listingId: '1', fileIndex: 0, rank: 4 }, { listingId: '1', fileIndex: 1, rank: 5 }]);
    expect(p.skipped).toEqual([{ listingId: '2', reason: 'full' }]);
    expect(p.changes).toBe(2);
    expect(p.listings).toBe(1);
  });

  it('Add by link stages one URL upload per listing at the chosen position', () => {
    const p = planOperation(plan({ source: 'url', url: 'https://x.test/a.jpg', position: 2 }), sel.slice(0, 1), views([['1', v1]]));
    expect(p.items).toEqual([{ listingId: '1', media: [{ kind: 'image', operation: 'upload', sourceUrl: 'https://x.test/a.jpg', rank: 2 }] }]);
  });

  it('never touches a listing with a queued delete or one being sent', () => {
    const p = planOperation(plan({ source: 'url', url: 'https://x.test/a.jpg' }), [{ id: '1', title: 'A', queuedDelete: true }, { id: '2', title: 'B', syncing: true }], views([['1', v1], ['2', v1]]));
    expect(p.items).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual(['queuedDelete', 'sending']);
  });

  it('Delete at a position never removes the last photo; a not-loaded listing is skipped', () => {
    const one = buildListingPhotoView(imgs(1, 300), null);
    const p = planOperation(plan({ op: 'delete', position: 1 }), [{ id: '1', title: 'A' }, { id: '3', title: 'C' }, { id: '4', title: 'D' }], views([['1', v1], ['3', one]]));
    expect(p.items).toEqual([{ listingId: '1', media: [{ kind: 'image', operation: 'delete', etsyMediaId: 100 }] }]);
    expect(p.skipped).toEqual([{ listingId: '3', reason: 'lastPhoto' }, { listingId: '4', reason: 'notLoaded' }]);
  });

  it('Replace by link = delete + upload at the same rank, counted as one change', () => {
    const p = planOperation(plan({ op: 'replace', source: 'url', url: 'https://x.test/n.jpg', position: 2 }), sel.slice(0, 1), views([['1', v1]]));
    expect(p.items[0].media).toEqual([
      { kind: 'image', operation: 'delete', etsyMediaId: 101 },
      { kind: 'image', operation: 'upload', sourceUrl: 'https://x.test/n.jpg', rank: 2 },
    ]);
    expect(p.changes).toBe(1);
  });

  it('Replace with a file records the photo to delete first', () => {
    const p = planOperation(plan({ op: 'replace', source: 'upload', fileCount: 1, position: 3 }), sel.slice(0, 1), views([['1', v1]]));
    expect(p.uploads).toEqual([{ listingId: '1', fileIndex: 0, rank: 3, replaceImageId: 102 }]);
  });

  it('Move fully specifies the new order (reorder ops for every Etsy photo that moved)', () => {
    const p = planOperation(plan({ op: 'move', position: 3, moveTo: 1 }), sel.slice(0, 1), views([['1', v1]]));
    expect(p.items[0].media).toEqual([
      { kind: 'image', operation: 'reorder', etsyMediaId: 102, rank: 1 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 100, rank: 2 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 101, rank: 3 },
    ]);
    const same = planOperation(plan({ op: 'move', position: 2, moveTo: 2 }), sel.slice(0, 1), views([['1', v1]]));
    expect(same.skipped[0].reason).toBe('samePosition');
  });

  it('Alt text (typed) on every photo skips photos that already have it', () => {
    const v = buildListingPhotoView([img(1, 1, 'same'), img(2, 2, '')], null);
    const p = planOperation(plan({ op: 'alt', altMode: 'manual', altText: 'same', altAll: true }), sel.slice(0, 1), views([['1', v]]));
    expect(p.items[0].media).toEqual([{ kind: 'image', operation: 'update_alt', etsyMediaId: 2, altText: 'same' }]);
  });

  it('AI alt text costs 1 credit per photo; AI images 10 per listing; runs are capped', () => {
    const alt = planOperation(plan({ op: 'alt', altMode: 'ai', altAll: true }), sel.slice(0, 1), views([['1', v1]]));
    expect(alt.ai).toHaveLength(3);
    expect(alt.credits).toBe(3);
    const enhance = planOperation(plan({ op: 'enhance', position: 1 }), sel.slice(0, 1), views([['1', v1]]));
    expect(enhance.ai[0]).toMatchObject({ kind: 'image', rank: 1, targetImageId: 100, refUrl: 'https://i.etsystatic.com/100_full.jpg' });
    expect(enhance.credits).toBe(10);
    const many = Array.from({ length: 70 }, (_, i) => ({ id: String(i + 10), title: 'L' }));
    const big = planOperation(plan({ op: 'add', source: 'ai' }), many, new Map(many.map((l) => [l.id, v1])));
    expect(big.ai).toHaveLength(AI_BATCH_CAP);
    expect(big.capped).toBe(10);
    expect(big.listings).toBe(AI_BATCH_CAP);
  });

  it('Copy from appends the source photos (with alt text) to the other selected listings', () => {
    const src = buildListingPhotoView([img(9, 1, 'hero')], null);
    const p = planOperation(plan({ op: 'copy', copyFromId: 'S' }), [{ id: 'S', title: 'S' }, { id: '1', title: 'A' }], views([['S', src], ['1', v1]]));
    expect(p.items).toEqual([{ listingId: '1', media: [{ kind: 'image', operation: 'upload', sourceUrl: 'https://i.etsystatic.com/9_full.jpg', rank: 4, altText: 'hero' }] }]);
    expect(p.skipped).toEqual([{ listingId: 'S', reason: 'isSource' }]);
    expect(topSkipReason(p.skipped)).toBe('isSource');
  });
});

describe('single-tile edits', () => {
  it('reorder refuses to move a staged upload; make primary moves to 1', () => {
    const v = buildListingPhotoView(imgs(2), draft('1', [{ id: 'u', kind: 'image', operation: 'upload', rank: 3, sourceUrl: 'https://x.test/u.jpg' }]));
    expect(reorderTileOps(v, ['new:u', 'img:100', 'img:101'])).toBeNull();
    expect(makePrimaryOps(v, 'img:101')).toEqual([
      { kind: 'image', operation: 'reorder', etsyMediaId: 101, rank: 1 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 100, rank: 2 },
    ]);
  });
});

describe('video', () => {
  it('add skips listings that already have a video; remove only listings with one', () => {
    const has = buildListingVideoView([{ videoId: 7 }], null);
    const none = buildListingVideoView([], null);
    const sel = [{ id: '1', title: 'A' }, { id: '2', title: 'B' }];
    const vv = new Map([['1', has], ['2', none]]);
    const add = planVideo('add', 'upload', '', true, sel, vv);
    expect(add.uploads).toEqual(['2']);
    expect(add.skipped).toEqual([{ listingId: '1', reason: 'hasVideo' }]);
    const rm = planVideo('remove', 'upload', '', false, sel, vv);
    expect(rm.items).toEqual([{ listingId: '1', media: [{ kind: 'video', operation: 'delete', etsyMediaId: 7 }] }]);
  });
});

describe('batchWaves', () => {
  it('keeps one listing per wave so two writes to one draft never run together', () => {
    const waves = batchWaves([{ listingId: 'a' }, { listingId: 'b' }, { listingId: 'a' }]);
    expect(waves.map((w) => w.map((i) => i.listingId))).toEqual([['a', 'b'], ['a']]);
  });
});

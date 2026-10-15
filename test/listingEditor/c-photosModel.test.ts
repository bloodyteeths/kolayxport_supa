// M6 editor Group C: pure photo-strip model (staged media → tiles, reorder guard, staging ops, summaries).
import { describe, expect, it } from 'vitest';
import {
  ALT_TEXT_MAX, EMPTY_STAGED_OPS, applyTileOrder, buildPhotoTiles, cleanAltText, collectStagedOps, parseImageLinks,
  reorderOpsFor, sameUrlList, splitImageFiles, summarizeEbayPhotos, summarizeEtsyPhotos, tileIdFor,
  type EtsyImageLike,
} from '@/components/domain/listing-editor/sections/photosModel';
import { flatKeys } from './c-messages';

const img = (id: number, rank: number, alt = ''): EtsyImageLike => ({
  listing_image_id: id, url_570xN: `https://i.etsystatic.com/${id}.jpg`, url_fullxfull: `https://i.etsystatic.com/${id}-full.jpg`, rank, alt_text: alt,
});
const pending = (mediaId: string, rank: number): EtsyImageLike => ({
  listing_image_id: -rank, url_570xN: `/api/etsy-drafts/media-preview?id=${mediaId}`, rank, is_pending_upload: true, pending_media_id: mediaId,
});
const original = (list: EtsyImageLike[]) => new Map(list.filter((i) => !i.is_pending_upload).map((i) => [i.listing_image_id, i.rank]));

describe('collectStagedOps', () => {
  it('reads image deletes, alt text (decoded), reorder ranks and video ops from live drafts only', () => {
    const ops = collectStagedOps([
      {
        status: 'draft',
        media: [
          { id: 'm1', kind: 'image', operation: 'delete', etsyMediaId: '11' },
          { id: 'm2', kind: 'image', operation: 'update_alt', etsyMediaId: '12', altText: 'Baby&#39;s blanket' },
          { id: 'm3', kind: 'image', operation: 'reorder', etsyMediaId: '13', rank: 1 },
          { id: 'm4', kind: 'video', operation: 'delete', etsyMediaId: '99' },
          { id: 'm5', kind: 'video', operation: 'upload', filename: 'clip.mp4' },
          { id: 'm6', kind: 'image', operation: 'upload', rank: 4 },
        ],
      },
      { status: 'synced', media: [{ id: 'old', kind: 'image', operation: 'delete', etsyMediaId: '14' }] },
    ]);
    expect(ops.imageDeletes.get(11)).toBe('m1');
    expect(ops.imageDeletes.has(14)).toBe(false);
    expect(ops.imageAlts.get(12)).toBe("Baby's blanket");
    expect(ops.imageAltRows.get(12)).toBe('m2');
    expect(ops.imageReorders.get(13)).toBe(1);
    expect(ops.videoDeletes.get(99)).toBe('m4');
    expect(ops.videoUploads.map((m) => m.id)).toEqual(['m5']);
  });

  it('tolerates null / missing input', () => {
    expect(collectStagedOps(null).imageDeletes.size).toBe(0);
    expect(collectStagedOps([{ status: 'draft', media: null }]).videoUploads).toEqual([]);
  });
});

describe('buildPhotoTiles', () => {
  it('marks staged add / delete / reorder, decodes alt text and lets a staged alt win', () => {
    const local = [img(2, 1, 'Second'), img(1, 2, 'one&#39;s first'), img(3, 3), pending('p1', 4)];
    const ops = collectStagedOps([{ status: 'draft', media: [
      { id: 'd', kind: 'image', operation: 'delete', etsyMediaId: '3' },
      { id: 'a', kind: 'image', operation: 'update_alt', etsyMediaId: '2', altText: 'New &amp; better' },
    ] }]);
    const tiles = buildPhotoTiles(local, ops, new Map([[1, 1], [2, 2], [3, 3]]));
    expect(tiles.map((t) => t.id)).toEqual(['img:2', 'img:1', 'img:3', 'new:p1']);
    expect(tiles.map((t) => t.staged)).toEqual(['reorder', 'reorder', 'delete', 'add']);
    expect(tiles[0].alt).toBe('New & better');
    expect(tiles[0].altStaged).toBe(true);
    expect(tiles[1].alt).toBe("one's first");
    expect(tiles[1].altStaged).toBe(false);
    expect(tiles[3]).toMatchObject({ pending: true, mediaId: 'p1', imageId: null });
    expect(tileIdFor(pending('p1', 4))).toBe('new:p1');
  });
});

describe('applyTileOrder', () => {
  const tiles = buildPhotoTiles([img(1, 1), img(2, 2), img(3, 3), pending('p', 4)], EMPTY_STAGED_OPS, original([img(1, 1), img(2, 2), img(3, 3)]));

  it('reorders photos that are on Etsy', () => {
    const next = applyTileOrder(tiles, ['img:3', 'img:1', 'img:2', 'new:p']);
    expect(next?.map((t) => t.id)).toEqual(['img:3', 'img:1', 'img:2', 'new:p']);
  });

  it('refuses to move a staged upload, or a list that does not match', () => {
    expect(applyTileOrder(tiles, ['new:p', 'img:1', 'img:2', 'img:3'])).toBeNull();
    expect(applyTileOrder(tiles, ['img:1', 'img:2'])).toBeNull();
    expect(applyTileOrder(tiles, ['img:1', 'img:2', 'img:3', 'img:9'])).toBeNull();
  });
});

describe('reorderOpsFor', () => {
  it('stages only photos whose position differs from Etsy, skipping staged uploads', () => {
    const ops = reorderOpsFor([img(2, 1), img(1, 2), img(3, 3), pending('p', 4)], new Map([[1, 1], [2, 2], [3, 3]]));
    expect(ops).toEqual([
      { kind: 'image', operation: 'reorder', etsyMediaId: 2, rank: 1 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 1, rank: 2 },
    ]);
  });

  it('overwrites a stale staged reorder when a photo moves back to its Etsy place', () => {
    const ops = reorderOpsFor([img(1, 1), img(2, 2)], new Map([[1, 1], [2, 2]]), new Map([[1, 2], [2, 1]]));
    expect(ops).toEqual([
      { kind: 'image', operation: 'reorder', etsyMediaId: 1, rank: 1 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 2, rank: 2 },
    ]);
  });

  it('does not repeat a reorder that is already staged with the same rank', () => {
    expect(reorderOpsFor([img(2, 1), img(1, 2)], new Map([[1, 1], [2, 2]]), new Map([[2, 1], [1, 2]]))).toEqual([]);
  });
});

describe('replace in the middle of the strip', () => {
  // Replace on photo 3 of A B C D E: the upload sits at C's rank while C waits for its staged delete.
  const local = [img(1, 1), img(2, 2), img(3, 3), pending('r', 3), img(4, 4), img(5, 5)];
  const etsy = new Map([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
  const ops = collectStagedOps([{ status: 'draft', media: [{ id: 'd', kind: 'image', operation: 'delete', etsyMediaId: '3' }] }]);

  it('marks no photo after it as moved and stages no reorder', () => {
    const tiles = buildPhotoTiles(local, ops, etsy);
    expect(tiles.map((t) => t.staged)).toEqual([undefined, undefined, 'delete', 'add', undefined, undefined]);
    expect(summarizeEtsyPhotos(tiles, { has: false, staged: false }).changes.order).toBe(false);
    expect(reorderOpsFor(local, etsy)).toEqual([]);
  });

  it('a later move ranks photos among the Etsy photos only', () => {
    const moved = [img(4, 4), img(1, 1), img(2, 2), img(3, 3), pending('r', 3), img(5, 5)];
    expect(reorderOpsFor(moved, etsy)).toEqual([
      { kind: 'image', operation: 'reorder', etsyMediaId: 4, rank: 1 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 1, rank: 2 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 2, rank: 3 },
      { kind: 'image', operation: 'reorder', etsyMediaId: 3, rank: 4 },
    ]);
  });

  it('a staged removal still holds its slot until Send (uploads go before deletes)', () => {
    const s = summarizeEtsyPhotos(buildPhotoTiles(local, ops, etsy), { has: false, staged: false });
    expect(s.count).toBe(5);
    expect(s.slots).toBe(6);
  });
});

describe('summaries', () => {
  it('Etsy: counts what will be on the listing after Send and the change groups', () => {
    const ops = collectStagedOps([{ status: 'draft', media: [
      { id: 'd', kind: 'image', operation: 'delete', etsyMediaId: '3' },
      { id: 'a', kind: 'image', operation: 'update_alt', etsyMediaId: '1', altText: 'x' },
    ] }]);
    const tiles = buildPhotoTiles([img(2, 1, 'b'), img(1, 2), img(3, 3), pending('p', 4)], ops, new Map([[1, 1], [2, 2], [3, 3]]));
    const s = summarizeEtsyPhotos(tiles, { has: true, staged: false });
    expect(s.count).toBe(3);
    expect(s.max).toBe(20);
    expect(s.missingAlt).toBe(0);
    expect(s.images.map((i) => i.id)).toEqual(['img:2', 'img:1', 'new:p']);
    expect(s.images[2].staged).toBe('add');
    expect(s.changes).toEqual({ added: 1, removed: 1, order: true, alt: 1, video: false });
    expect(s.changeGroups).toBe(3);
  });

  it('Etsy: photos still on Etsy without alt text are counted, staged uploads are not', () => {
    const tiles = buildPhotoTiles([img(1, 1), img(2, 2, 'ok'), pending('p', 3)], EMPTY_STAGED_OPS, new Map([[1, 1], [2, 2]]));
    expect(summarizeEtsyPhotos(tiles, { has: false, staged: false }).missingAlt).toBe(1);
  });

  it('eBay: added / removed / order against the baseline', () => {
    const s = summarizeEbayPhotos(['b', 'a', 'c'], ['a', 'b', 'd']);
    expect(s.changes).toEqual({ added: 1, removed: 1, order: true, alt: 0, video: false });
    expect(s.max).toBe(24);
    expect(s.images[2].staged).toBe('add');
    expect(summarizeEbayPhotos(['a', 'b'], ['a', 'b']).changeGroups).toBe(0);
    expect(sameUrlList(['a'], ['a'])).toBe(true);
    expect(sameUrlList(['a'], ['b'])).toBe(false);
  });
});

describe('input helpers', () => {
  it('parseImageLinks keeps https links up to the free slots', () => {
    const r = parseImageLinks('https://a.com/1.jpg\nhttp://b.com/2.jpg, https://a.com/1.jpg not-a-url https://c.com/3.png https://d.com/4.png', 2);
    expect(r.urls).toEqual(['https://a.com/1.jpg', 'https://c.com/3.png']);
    expect(r.rejected).toBe(4);
  });

  it('cleanAltText decodes entities, collapses spaces and caps at 250', () => {
    expect(cleanAltText('  Mom&#39;s   gift &amp; card ')).toBe("Mom's gift & card");
    expect(cleanAltText('x'.repeat(300))).toHaveLength(ALT_TEXT_MAX);
  });

  it('splitImageFiles drops other types and files beyond the free slots', () => {
    const f = (name: string, type: string) => new File(['x'], name, { type });
    const r = splitImageFiles([f('a.jpg', 'image/jpeg'), f('b.pdf', 'application/pdf'), f('c.png', 'image/png'), f('d.webp', 'image/webp')], 2);
    expect(r.accepted.map((x) => x.name)).toEqual(['a.jpg', 'c.png']);
    expect(r.badType).toBe(1);
    expect(r.overLimit).toBe(1);
  });
});

describe('Group C i18n fragment', () => {
  it('has EN and TR for every key, real Turkish characters, no "Sync" wording and no ASCII-Turkish', () => {
    const rows = flatKeys();
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) {
      expect(r.en, r.key).toBeTruthy();
      expect(r.tr, r.key).toBeTruthy();
      expect(r.en).not.toMatch(/\bsync/i);
      expect(r.tr).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
      // Dative after a marketplace name is never hand-written (CRITIQUE C11).
      expect(r.tr).not.toMatch(/\{marketplace\}'(e|a|ye|ya)\b/);
    }
  });
});

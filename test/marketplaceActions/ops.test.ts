import { describe, it, expect, vi } from 'vitest';
import {
  applyWixCollectionChange,
  applyWixMediaOps,
  diffCollectionIds,
  parseWixMediaInputs,
  parseWixMediaOps,
  WIX_MEDIA_MAX,
} from '@/lib/integrations/wixProductOps';
import {
  applyShopifyImageOps,
  parseShopifyImageAdd,
  parseShopifyImageOps,
} from '@/lib/integrations/shopifyImageOps';
import { isPublicHttpsUrl, opCodeOfError, OP_KEYS } from '@/lib/integrations/productOpResults';
import { WIX_ALL_PRODUCTS_COLLECTION_ID } from '@/lib/integrations/wixClient';
import en from '@/messages/en.json';
import newKeys from './newI18nKeys.json';

function hasKey(tree: any, key: string): boolean {
  return typeof key.split('.').reduce((n: any, k) => (n && typeof n === 'object' ? n[k] : undefined), tree) === 'string';
}

// ---------------------------------------------------------------------------
describe('productOpResults', () => {
  it('accepts only public https urls', () => {
    expect(isPublicHttpsUrl('https://kolayxport.com/api/img/a.jpg?sig=1')).toBe(true);
    for (const bad of ['http://x.com/a.jpg', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.3/a', 'https://192.168.1.1/a', 'ftp://x', '', 42]) {
      expect(isPublicHttpsUrl(bad)).toBe(false);
    }
  });

  it('maps client errors to codes', () => {
    expect(opCodeOfError(new Error('Wix API 401: x'))).toBe('NOT_CONNECTED');
    expect(opCodeOfError(new Error('Shopify API PUT /x failed: 404 - y'))).toBe('REMOTE_MISSING');
    expect(opCodeOfError(new Error('Wix API 429: slow'))).toBe('RATE_LIMITED');
    expect(opCodeOfError(new Error('weird'))).toBe('FAILED');
    expect(opCodeOfError({ code: 'COLLECTION_PROTECTED' })).toBe('COLLECTION_PROTECTED');
    expect(OP_KEYS.FAILED).toBe('listings.draftError.remoteFailed');
  });

  it('every OP_KEYS key exists in messages or in the returned new keys (en + tr)', () => {
    for (const key of Object.values(OP_KEYS)) {
      const known = hasKey(en, key) || (hasKey(newKeys.en, key) && hasKey(newKeys.tr, key));
      expect(known, key).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('wixProductOps parsing', () => {
  it('parses media inputs and ops', () => {
    expect(parseWixMediaInputs([{ url: 'https://a.test/1.jpg' }, { mediaId: 'm1' }])).toEqual({ ok: true, value: [{ url: 'https://a.test/1.jpg' }, { mediaId: 'm1' }] });
    expect(parseWixMediaInputs([{ url: 'http://a.test/1.jpg' }])).toMatchObject({ ok: false, code: 'INVALID_URL' });
    expect(parseWixMediaInputs(Array.from({ length: WIX_MEDIA_MAX + 1 }, () => ({ mediaId: 'x' })))).toMatchObject({ ok: false });
    expect(parseWixMediaOps([{ op: 'add', url: 'https://a.test/1.jpg' }, { op: 'remove', mediaId: 'm1' }, { op: 'reorder', ids: ['a', 'b', 'a'] }]))
      .toEqual({ ok: true, value: [{ op: 'add', url: 'https://a.test/1.jpg' }, { op: 'remove', mediaId: 'm1' }, { op: 'reorder', ids: ['a', 'b'] }] });
    expect(parseWixMediaOps([{ op: 'add', url: 'nope' }])).toMatchObject({ ok: false, code: 'INVALID_URL' });
    expect(parseWixMediaOps([{ op: 'move' }])).toMatchObject({ ok: false });
  });

  it('diffs a collection target set and never touches All products', () => {
    expect(diffCollectionIds(['a', 'b', WIX_ALL_PRODUCTS_COLLECTION_ID], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
    expect(diffCollectionIds(null, [WIX_ALL_PRODUCTS_COLLECTION_ID, 'x'])).toEqual({ add: ['x'], remove: [] });
  });
});

// ---------------------------------------------------------------------------
function fakeWix(initial: string[]) {
  let media = [...initial];
  const c = {
    getProduct: vi.fn(async () => ({ id: 'p1', media: { items: media.map((id) => ({ id })) } })),
    addProductMedia: vi.fn(async (_p: string, items: any[]) => {
      items.forEach((m, i) => media.push(m.mediaId ?? `new${media.length + i}`));
    }),
    removeProductMedia: vi.fn(async (_p: string, ids: string[]) => {
      media = media.filter((id) => !ids.includes(id));
    }),
    reorderProductMedia: vi.fn(async (_p: string, order: string[]) => {
      media = [...order];
      return { order, changed: true };
    }),
    addProductsToCollection: vi.fn(async () => undefined),
    removeProductsFromCollection: vi.fn(async () => undefined),
  };
  return { c: c as any, get media() { return media; } };
}

describe('applyWixMediaOps', () => {
  it('removes, adds, then reorders; stale ids are skipped', async () => {
    const f = fakeWix(['m1', 'm2', 'm3']);
    const { results, mediaIds } = await applyWixMediaOps(f.c, 'p1', [
      { op: 'reorder', ids: ['m3', 'm1'] },
      { op: 'remove', mediaId: 'm2' },
      { op: 'remove', mediaId: 'm2' },
      { op: 'remove', mediaId: 'gone' },
      { op: 'add', url: 'https://a.test/x.jpg' },
    ]);
    expect(f.c.removeProductMedia).toHaveBeenCalledWith('p1', ['m2']);
    expect(f.c.addProductMedia).toHaveBeenCalledWith('p1', [{ url: 'https://a.test/x.jpg' }]);
    // reorder keeps listed ids first and appends the new media
    expect(f.c.reorderProductMedia).toHaveBeenCalledWith('p1', ['m3', 'm1', 'new2']);
    expect(mediaIds).toEqual(['m3', 'm1', 'new2']);
    expect(results.map((r) => [r.index, r.ok, r.skipped ?? false, r.code ?? null])).toEqual([
      [0, true, false, null],
      [1, true, false, null],
      [2, true, true, null],
      [3, true, true, 'NOT_FOUND'],
      [4, true, false, null],
    ]);
  });

  it('refuses adds beyond the cap before writing', async () => {
    const f = fakeWix(Array.from({ length: WIX_MEDIA_MAX }, (_, i) => `m${i}`));
    const { results } = await applyWixMediaOps(f.c, 'p1', [{ op: 'add', url: 'https://a.test/x.jpg' }]);
    expect(f.c.addProductMedia).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ ok: false, code: 'TOO_MANY', key: 'listingEditor.media.tooMany', params: { max: WIX_MEDIA_MAX } });
  });

  it('a failed add is reported per op with an i18n key', async () => {
    const f = fakeWix(['m1']);
    f.c.addProductMedia.mockRejectedValueOnce(new Error('Wix API 500: x'));
    const { results } = await applyWixMediaOps(f.c, 'p1', [{ op: 'add', url: 'https://a.test/x.jpg' }]);
    expect(results[0]).toMatchObject({ ok: false, code: 'FAILED', key: 'listings.draftError.remoteFailed' });
  });

  it('a failed remove does not free room for adds', async () => {
    const f = fakeWix(Array.from({ length: WIX_MEDIA_MAX }, (_, i) => `m${i}`));
    f.c.removeProductMedia.mockRejectedValueOnce(new Error('Wix API 500: x'));
    const { results } = await applyWixMediaOps(f.c, 'p1', [
      { op: 'remove', mediaId: 'm0' },
      { op: 'add', url: 'https://a.test/x.jpg' },
    ]);
    expect(f.c.addProductMedia).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ ok: false, code: 'FAILED' });
    expect(results[1]).toMatchObject({ ok: false, code: 'TOO_MANY', params: { max: WIX_MEDIA_MAX } });
  });

  it('reports a lost-media reorder with its own code and the original ids', async () => {
    const f = fakeWix(['m1', 'm2']);
    f.c.reorderProductMedia.mockRejectedValueOnce(Object.assign(new Error('lost'), { code: 'MEDIA_RESTORE_FAILED', params: { productId: 'p1', mediaIds: 'm1,m2' } }));
    const { results } = await applyWixMediaOps(f.c, 'p1', [{ op: 'reorder', ids: ['m2', 'm1'] }]);
    expect(results[0]).toMatchObject({ ok: false, code: 'MEDIA_RESTORE_FAILED', key: 'listingEditor.media.restoreFailed', params: { mediaIds: 'm1,m2' } });
  });

  it('an unchanged reorder writes nothing', async () => {
    const f = fakeWix(['m1', 'm2']);
    const { results } = await applyWixMediaOps(f.c, 'p1', [{ op: 'reorder', ids: ['m1', 'm2'] }]);
    expect(f.c.reorderProductMedia).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ ok: true, skipped: true });
  });
});

describe('applyWixCollectionChange', () => {
  it('one call per collection; failures do not stop the rest', async () => {
    const f = fakeWix([]);
    f.c.addProductsToCollection.mockRejectedValueOnce(new Error('Wix API 404: nope'));
    const results = await applyWixCollectionChange(f.c, 'p1', 'add', ['c1', WIX_ALL_PRODUCTS_COLLECTION_ID, 'c2']);
    expect(f.c.addProductsToCollection).toHaveBeenCalledTimes(2);
    expect(f.c.addProductsToCollection).toHaveBeenLastCalledWith('c2', ['p1']);
    expect(results.map((r) => [r.id, r.ok, r.code ?? null])).toEqual([
      ['c1', false, 'REMOTE_MISSING'],
      [WIX_ALL_PRODUCTS_COLLECTION_ID, false, 'COLLECTION_PROTECTED'],
      ['c2', true, null],
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('shopifyImageOps parsing', () => {
  it('needs src xor attachment and strips data-url prefixes', () => {
    expect(parseShopifyImageAdd({ src: 'https://a.test/1.jpg', alt: 'Blue', position: 1 })).toEqual({ ok: true, value: { op: 'add', src: 'https://a.test/1.jpg', alt: 'Blue', position: 1 } });
    expect(parseShopifyImageAdd({ attachment: 'data:image/png;base64,QUJD', filename: 'a.png' })).toEqual({ ok: true, value: { op: 'add', attachment: 'QUJD', filename: 'a.png' } });
    expect(parseShopifyImageAdd({})).toMatchObject({ ok: false });
    expect(parseShopifyImageAdd({ src: 'https://a.test/1.jpg', attachment: 'QUJD' })).toMatchObject({ ok: false });
    expect(parseShopifyImageAdd({ src: 'http://a.test/1.jpg' })).toMatchObject({ ok: false, code: 'INVALID_URL' });
    expect(parseShopifyImageAdd({ attachment: 'not base64!' })).toMatchObject({ ok: false });
    expect(parseShopifyImageAdd({ src: 'https://a.test/1.jpg', alt: 'x'.repeat(513) })).toMatchObject({ ok: false });
    expect(parseShopifyImageAdd({ src: 'https://a.test/1.jpg', position: 0 })).toMatchObject({ ok: false });
  });

  it('parses op lists and rejects bad ids', () => {
    expect(parseShopifyImageOps([{ op: 'delete', id: 5 }, { op: 'reorder', id: '6', position: 2 }, { op: 'alt', id: '7', alt: '' }]))
      .toEqual({ ok: true, value: [{ op: 'delete', id: '5' }, { op: 'reorder', id: '6', position: 2 }, { op: 'alt', id: '7', alt: '' }] });
    expect(parseShopifyImageOps([{ op: 'delete', id: 'abc' }])).toMatchObject({ ok: false });
    expect(parseShopifyImageOps([])).toMatchObject({ ok: false });
  });
});

function fakeShopify(ids: number[]) {
  let images = ids.map((id, i) => ({ id, position: i + 1 }));
  let next = 900;
  const c = {
    getProductImages: vi.fn(async () => images.map((x) => ({ ...x }))),
    createProductImage: vi.fn(async (_p: string, img: any) => {
      const created = { id: next++, position: images.length + 1, ...img };
      images.push(created);
      return created;
    }),
    updateProductImage: vi.fn(async (_p: string, id: string, u: any) => ({ id: Number(id), ...u })),
    deleteProductImage: vi.fn(async (_p: string, id: string) => {
      images = images.filter((x) => String(x.id) !== id);
    }),
  };
  return c as any;
}

describe('applyShopifyImageOps', () => {
  it('deletes, adds, then one update per image with the latest alt and position', async () => {
    const c = fakeShopify([1, 2, 3]);
    const { results, images } = await applyShopifyImageOps(c, '10', [
      { op: 'alt', id: '2', alt: 'old' },
      { op: 'delete', id: '1' },
      { op: 'delete', id: '1' },
      { op: 'add', src: 'https://a.test/n.jpg', alt: 'New' },
      { op: 'alt', id: '2', alt: 'new' },
      { op: 'reorder', id: '3', position: 1 },
      { op: 'alt', id: '1', alt: 'deleted anyway' },
      { op: 'delete', id: '77' },
    ]);
    expect(c.deleteProductImage).toHaveBeenCalledTimes(1);
    expect(c.createProductImage).toHaveBeenCalledWith('10', { src: 'https://a.test/n.jpg', alt: 'New' });
    // position updates first (ascending), then alt-only updates
    expect(c.updateProductImage.mock.calls).toEqual([
      ['10', '3', { position: 1 }],
      ['10', '2', { alt: 'new' }],
    ]);
    const byIndex = Object.fromEntries(results.map((r) => [r.index, r]));
    expect(byIndex[0]).toMatchObject({ ok: true, skipped: true });
    expect(byIndex[2]).toMatchObject({ ok: true, skipped: true });
    expect(byIndex[3]).toMatchObject({ ok: true, id: '900' });
    expect(byIndex[4]).toMatchObject({ ok: true, id: '2' });
    expect(byIndex[6]).toMatchObject({ ok: true, skipped: true });
    expect(byIndex[7]).toMatchObject({ ok: true, skipped: true, code: 'NOT_FOUND' });
    expect(results).toHaveLength(8);
    expect(images.map((x: any) => x.id)).toEqual([2, 3, 900]);
  });

  it('keeps going after a failed write and reports it per op', async () => {
    const c = fakeShopify([1, 2]);
    c.deleteProductImage.mockRejectedValueOnce(new Error('Shopify API DELETE /x failed: 429 - slow'));
    const { results } = await applyShopifyImageOps(c, '10', [
      { op: 'delete', id: '1' },
      { op: 'reorder', id: '2', position: 1 },
    ]);
    expect(results[0]).toMatchObject({ ok: false, code: 'RATE_LIMITED', key: 'listings.draftError.rateLimited' });
    expect(results[1]).toMatchObject({ ok: true });
  });

  it('a failed delete does not free room for adds', async () => {
    const c = fakeShopify(Array.from({ length: 250 }, (_, i) => i + 1));
    c.deleteProductImage.mockRejectedValueOnce(new Error('Shopify API DELETE /x failed: 500 - x'));
    const { results } = await applyShopifyImageOps(c, '10', [
      { op: 'delete', id: '1' },
      { op: 'add', src: 'https://a.test/n.jpg' },
    ]);
    expect(c.createProductImage).not.toHaveBeenCalled();
    expect(results[1]).toMatchObject({ ok: false, code: 'TOO_MANY', params: { max: 250 } });
  });

  it('refuses adds beyond 250 images', async () => {
    const c = fakeShopify(Array.from({ length: 250 }, (_, i) => i + 1));
    const { results } = await applyShopifyImageOps(c, '10', [{ op: 'add', src: 'https://a.test/n.jpg' }]);
    expect(c.createProductImage).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ ok: false, code: 'TOO_MANY', params: { max: 250 } });
  });
});

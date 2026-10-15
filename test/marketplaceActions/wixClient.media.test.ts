import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WixApiClient,
  WixClientInputError,
  WIX_ALL_PRODUCTS_COLLECTION_ID,
  wixProductMediaIds,
} from '@/lib/integrations/wixClient';

type Call = { url: string; method: string; body: any };
let calls: Call[];
let responder: (c: Call) => { status?: number; json?: any; text?: string };

function jsonResponse(status: number, payload: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  };
}

beforeEach(() => {
  calls = [];
  responder = () => ({ json: {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const c: Call = { url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const r = responder(c);
    return jsonResponse(r.status ?? 200, r.json ?? r.text ?? {});
  }));
});
afterEach(() => vi.unstubAllGlobals());

function client() {
  // A valid, unexpired plaintext token: no OAuth call is made.
  return new WixApiClient({ siteId: 's1', instanceId: 'i1', accessToken: 'tok', tokenExpiresAt: new Date(Date.now() + 3_600_000) });
}

const product = (ids: string[]) => ({ product: { id: 'p1', media: { items: ids.map((id) => ({ id, mediaType: 'image' })) } } });

describe('wixClient collection methods', () => {
  it('addProductsToCollection posts productIds to the collection', async () => {
    await client().addProductsToCollection('c1', ['p1']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://www.wixapis.com/stores/v1/collections/c1/productIds');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ productIds: ['p1'] });
  });

  it('removeProductsFromCollection posts to /productIds/delete', async () => {
    await client().removeProductsFromCollection('c 2', ['p1', 'p2']);
    expect(calls[0].url).toBe('https://www.wixapis.com/stores/v1/collections/c%202/productIds/delete');
    expect(calls[0].body).toEqual({ productIds: ['p1', 'p2'] });
  });

  it('refuses the automatic All products collection without a request', async () => {
    await expect(client().addProductsToCollection(WIX_ALL_PRODUCTS_COLLECTION_ID, ['p1'])).rejects.toBeInstanceOf(WixClientInputError);
    await expect(client().removeProductsFromCollection(WIX_ALL_PRODUCTS_COLLECTION_ID, ['p1'])).rejects.toMatchObject({ code: 'COLLECTION_PROTECTED' });
    expect(calls).toHaveLength(0);
  });

  it('surfaces Wix HTTP errors with the status in the message', async () => {
    responder = () => ({ status: 404, text: 'not found' });
    await expect(client().addProductsToCollection('c1', ['p1'])).rejects.toThrow(/Wix API 404/);
  });
});

describe('wixClient media methods', () => {
  it('addProductMedia sends url and mediaId items', async () => {
    await client().addProductMedia('p1', [{ url: 'https://x.test/a.jpg' }, { mediaId: 'm9' }]);
    expect(calls[0].url).toBe('https://www.wixapis.com/stores/v1/products/p1/media');
    expect(calls[0].body).toEqual({ media: [{ url: 'https://x.test/a.jpg' }, { mediaId: 'm9' }] });
  });

  it('removeProductMedia posts mediaIds; empty lists make no request', async () => {
    const c = client();
    await c.removeProductMedia('p1', []);
    await c.addProductMedia('p1', []);
    expect(calls).toHaveLength(0);
    await c.removeProductMedia('p1', ['m1']);
    expect(calls[0].url).toBe('https://www.wixapis.com/stores/v1/products/p1/media/delete');
    expect(calls[0].body).toEqual({ mediaIds: ['m1'] });
  });

  it('reorderProductMedia detaches all and re-attaches in the new order', async () => {
    responder = (c) => (c.method === 'GET' ? { json: product(['m1', 'm2', 'm3']) } : { json: {} });
    const r = await client().reorderProductMedia('p1', ['m3', 'm1', 'm2']);
    expect(r).toEqual({ order: ['m3', 'm1', 'm2'], changed: true });
    const writes = calls.filter((c) => c.method === 'POST');
    expect(writes[0].body).toEqual({ mediaIds: ['m1', 'm2', 'm3'] });
    expect(writes[1].body).toEqual({ media: [{ mediaId: 'm3' }, { mediaId: 'm1' }, { mediaId: 'm2' }] });
  });

  it('reorderProductMedia makes no write when the order is unchanged', async () => {
    responder = () => ({ json: product(['m1', 'm2']) });
    const r = await client().reorderProductMedia('p1', ['m1', 'm2']);
    expect(r.changed).toBe(false);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('reorderProductMedia refuses a different id set before writing', async () => {
    responder = () => ({ json: product(['m1', 'm2']) });
    await expect(client().reorderProductMedia('p1', ['m1'])).rejects.toMatchObject({ code: 'MEDIA_SET_MISMATCH' });
    await expect(client().reorderProductMedia('p1', ['m1', 'mX'])).rejects.toMatchObject({ code: 'MEDIA_SET_MISMATCH' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('reorderProductMedia restores the original order when re-attach fails', async () => {
    let adds = 0;
    responder = (c) => {
      if (c.method === 'GET') return { json: product(['m1', 'm2']) };
      if (c.url.endsWith('/media')) {
        adds++;
        return adds === 1 ? { status: 500, text: 'boom' } : { json: {} };
      }
      return { json: {} };
    };
    await expect(client().reorderProductMedia('p1', ['m2', 'm1'])).rejects.toThrow(/Wix API 500/);
    const restore = calls.filter((c) => c.url.endsWith('/media')).pop();
    expect(restore?.body).toEqual({ media: [{ mediaId: 'm1' }, { mediaId: 'm2' }] });
  });

  it('reorderProductMedia refuses before writing when option choices have linked media', async () => {
    responder = () => ({
      json: { product: { ...product(['m1', 'm2']).product, productOptions: [{ name: 'Color', choices: [{ value: 'Red', media: { items: [{ id: 'm2' }] } }] }] } },
    });
    await expect(client().reorderProductMedia('p1', ['m2', 'm1'])).rejects.toMatchObject({ code: 'MEDIA_CHOICE_LINKED' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('reorderProductMedia throws MEDIA_RESTORE_FAILED with the original ids when the restore also fails', async () => {
    responder = (c) => {
      if (c.method === 'GET') return { json: product(['m1', 'm2']) };
      if (c.url.endsWith('/media')) return { status: 500, text: 'boom' };
      return { json: {} };
    };
    const err = await client().reorderProductMedia('p1', ['m2', 'm1']).catch((e) => e);
    expect(err).toBeInstanceOf(WixClientInputError);
    expect(err).toMatchObject({ code: 'MEDIA_RESTORE_FAILED', params: { productId: 'p1', mediaIds: 'm1,m2' } });
  });

  it('wixProductMediaIds reads media.items ids in order without duplicates', () => {
    expect(wixProductMediaIds({ media: { items: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, {}] } })).toEqual(['a', 'b']);
    expect(wixProductMediaIds(null)).toEqual([]);
  });
});

// @vitest-environment jsdom
// M6b-C routes: /app/{trendyol,wix,shopify}-urunler/{[id],new}, store resolution, connect state,
// create bootstraps, and the rail health over the catalog scorers. The frame itself is stubbed (its own tests cover it).
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const router = {
  isReady: true,
  query: {} as Record<string, string>,
  replace: vi.fn(async () => true),
};
const editorProps: Array<Record<string, any>> = [];
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((k: string) => k, { has: () => true }),
  useFormatter: () => ({ dateTime: () => '' }),
}));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/ds/feedback/toast', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('@/components/ds/page/Page', () => ({ Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ds/state/ConnectState', () => ({ ConnectState: ({ title, brand }: { title: string; brand: string }) => <div data-testid={`connect-${brand}`}>{title}</div> }));
vi.mock('@/components/ds/state/ErrorState', () => ({ ErrorState: ({ title }: { title: string }) => <div data-testid="error">{title}</div> }));
vi.mock('@/components/domain/listing-editor/catalogSectionMap', async () => {
  const R = await import('react');
  return { CATALOG_SECTIONS: { trendyol: {}, wix: {}, shopify: {} }, CatalogCopyContext: R.createContext({ translateCopy: false }) };
});
vi.mock('@/components/domain/listing-editor/ListingEditor', () => ({
  ListingEditor: (p: Record<string, any>) => {
    editorProps.push(p);
    return <div data-testid="editor" data-mp={p.marketplace} data-mode={p.mode} data-id={p.listingId ?? ''} data-shop={p.shopId} />;
  },
}));

import TrendyolEdit from '@/pages/app/trendyol-urunler/[id]';
import WixEdit from '@/pages/app/wix-urunler/[id]';
import ShopifyNew from '@/pages/app/shopify-urunler/new';
import WixNew from '@/pages/app/wix-urunler/new';
import TrendyolNew from '@/pages/app/trendyol-urunler/new';
import {
  computeCatalogHealth,
  copyBootKey,
  fitCopyToStore,
  parseCatalogCreateQuery,
  parseCatalogId,
} from '@/components/domain/listing-editor/CatalogEditorRoute';
import { copyPickQuery, copyPickerRows, copySourcesFor } from '@/components/domain/listing-editor/CatalogCopyPicker';
import { trendyolFieldsFromProduct } from '@/components/domain/listing-editor/adapters/trendyol';
import type { FieldMap, ListingView } from '@/lib/listingEditor/types';

const fetches: string[] = [];
function stubListings(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetches.push(url);
    return { ok: status < 400, status, json: async () => body } as Response;
  }));
}

afterEach(() => {
  cleanup();
  router.isReady = true;
  router.query = {};
  router.replace.mockClear();
  editorProps.length = 0;
  fetches.length = 0;
  vi.unstubAllGlobals();
});

describe('route params', () => {
  it('validates ids per marketplace', () => {
    expect(parseCatalogId('trendyol', '8690000000017')).toBe('8690000000017');
    expect(parseCatalogId('trendyol', 'AK-001.b')).toBe('AK-001.b');
    expect(parseCatalogId('shopify', 'abc')).toBeNull();
    expect(parseCatalogId('shopify', '123')).toBe('123');
    expect(parseCatalogId('wix', 'c1a2-33ff')).toBe('c1a2-33ff');
    expect(parseCatalogId('wix', '../x')).toBeNull();
  });
  it('create bootstraps: draft wins, then copy, then cross-list', () => {
    expect(parseCatalogCreateQuery('trendyol', { draft: 'd1', copy: '869' })).toEqual({ draftId: 'd1', copyFromId: null, crosslist: null });
    expect(parseCatalogCreateQuery('trendyol', { copy: '869' })).toMatchObject({ copyFromId: '869' });
    expect(parseCatalogCreateQuery('trendyol', { crosslist: 'etsy:123' }).crosslist).toEqual({ from: 'etsy', id: '123' });
    expect(parseCatalogCreateQuery('trendyol', { crosslist: 'ebay:SKU-1' }).crosslist).toEqual({ from: 'ebay', id: 'SKU-1' });
    expect(parseCatalogCreateQuery('trendyol', { crosslist: 'etsy:abc' }).crosslist).toBeNull();
  });
  it('a new copy pick restarts the creator; ?draft= alone never does', () => {
    expect(copyBootKey({ draft: 'd1' })).toBe('|');
    expect(copyBootKey({ copy: '12' })).toBe('12|');
    expect(copyBootKey({ crosslist: 'etsy:9' })).toBe('|etsy:9');
  });
  it('cross-list price is kept only in the store currency (no $25 → ₺25)', () => {
    const copy = { title: 'T', description: '', tags: [], price: 25 };
    expect(fitCopyToStore(copy, 'USD', 'TRY')).toEqual({ copy: { title: 'T', description: '', tags: [] }, priceCleared: true });
    expect(fitCopyToStore(copy, null, 'TRY').priceCleared).toBe(true);
    expect(fitCopyToStore(copy, 'try', 'TRY')).toEqual({ copy, priceCleared: false });
    expect(fitCopyToStore({ title: 'T', description: '', tags: [] }, 'USD', 'TRY').priceCleared).toBe(false);
  });
  it('copy picker: Trendyol cross-lists from Etsy / eBay, Wix / Shopify copy their own products', () => {
    expect(copySourcesFor('trendyol')).toEqual(['etsy', 'ebay']);
    expect(copySourcesFor('wix')).toEqual(['wix']);
    expect(copyPickQuery('trendyol', { source: 'ebay', id: 'SKU-1' })).toEqual({ crosslist: 'ebay:SKU-1' });
    expect(copyPickQuery('shopify', { source: 'shopify', id: '101' })).toEqual({ copy: '101' });
    expect(copyPickerRows({ rows: [{ id: '1', title: 'A', thumbUrl: null, metaLine: ['ID 1', 'SKU'] }, { title: 'no id' }] })).toEqual([
      { id: '1', title: 'A', thumbUrl: null, meta: 'ID 1 · SKU' },
    ]);
  });
});

describe('editor routes', () => {
  it('resolves the store and mounts the workspace on the product', async () => {
    router.query = { id: '8690000000017' };
    stubListings({ rows: [], store: { id: 'sup1', name: 'Belle', currency: 'TRY' }, stores: [] });
    render(<TrendyolEdit />);
    const el = await screen.findByTestId('editor');
    expect(el.dataset).toMatchObject({ mp: 'trendyol', mode: 'edit', id: '8690000000017', shop: 'sup1' });
    expect(fetches[0]).toBe('/api/listings?marketplace=trendyol&ids=8690000000017');
    expect(editorProps[0].adapter.marketplace).toBe('trendyol');
    expect(editorProps[0].backHref).toBe('/app/trendyol-urunler');
    // Health comes from the catalog scorers, never the Etsy default.
    expect(typeof editorProps[0].health).toBe('function');
    // A create on this route is never re-created: the page moves to the product's own URL.
    editorProps[0].onCreated('8690000000099');
    expect(router.replace).toHaveBeenCalledWith('/app/trendyol-urunler/8690000000099');
  });

  it('Wix keeps the ?site= store in the read and in links', async () => {
    router.query = { id: 'p-1', site: 'site9' };
    stubListings({ rows: [], store: { id: 'site9', name: 'Shop', currency: 'USD' } });
    render(<WixEdit />);
    await screen.findByTestId('editor');
    expect(fetches[0]).toBe('/api/listings?marketplace=wix&ids=p-1&store=site9');
    expect(editorProps[0].backHref).toBe('/app/wix-urunler?site=site9');
  });

  it('not connected → ConnectState instead of the workspace', async () => {
    router.query = { id: 'p-1' };
    stubListings({ error: 'not_connected' }, 404);
    render(<WixEdit />);
    expect((await screen.findByTestId('connect-wix')).textContent).toBe('catalog.connectTitle');
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('create: ?draft= resumes; the first save replaces the URL shallowly with ?draft=', async () => {
    router.query = { shop: 'sh1', draft: 'd1' };
    stubListings({ rows: [], store: { id: 'sh1', name: 'S', currency: 'USD' } });
    render(<ShopifyNew />);
    const el = await screen.findByTestId('editor');
    expect(el.dataset).toMatchObject({ mp: 'shopify', mode: 'create', id: '', shop: 'sh1' });
    expect(editorProps[0].draftId).toBe('d1');
    editorProps[0].onDraftCreated({ id: 'd2' });
    expect(router.replace).toHaveBeenCalledWith('/app/shopify-urunler/new?shop=sh1&draft=d2', undefined, { shallow: true });
    // Start faster: the M6b-D card (Copy one of your products…) on an untouched workspace only.
    expect(editorProps[0].slots.startFaster({ editor: { mode: 'create', changes: [], draft: null } })).not.toBeNull();
    expect(editorProps[0].slots.startFaster({ editor: { mode: 'create', changes: [{}], draft: null } })).toBeNull();
  });

  it('create: a Send that returns a non-numeric id (Wix GUID) moves to the edit route', async () => {
    router.query = { site: 'site9' };
    stubListings({ rows: [], store: { id: 'site9', name: 'S', currency: 'USD' } });
    render(<WixNew />);
    await screen.findByTestId('editor');
    const adapter = editorProps[editorProps.length - 1].adapter;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ draftId: 'd9', status: 'success', externalId: 'f1e2-guid' }], sent: ['d9'], failed: [], conflicts: [], pending: [], skipped: [] }),
    }) as Response));
    const draft = { id: 'd9', status: 'draft', listingId: '-cnew', fieldPatch: {}, queuedActions: [{ type: 'create_listing', payload: {}, completedAt: null }], media: [], syncAttempts: [] };
    const r = await adapter.send(draft);
    expect(r.listingId).toBe('f1e2-guid');
    expect(router.replace).toHaveBeenCalledWith('/app/wix-urunler/f1e2-guid?site=site9');
  });

  it('create: a cross-list in another currency opens without its price', async () => {
    router.query = { crosslist: 'ebay:SKU-1' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetches.push(url);
      if (url.startsWith('/api/listings')) return { ok: true, status: 200, json: async () => ({ rows: [], store: { id: 'sup1', name: '', currency: 'TRY' } }) } as Response;
      if (url.startsWith('/api/clawd/ebay')) {
        return { ok: true, status: 200, json: async () => ({ product: { title: 'Box', description: 'd' }, offers: [{ pricingSummary: { price: { value: '25.00', currency: 'USD' } } }] }) } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }));
    render(<TrendyolNew />);
    await screen.findByTestId('editor');
    const copy = editorProps[editorProps.length - 1].copy;
    expect(copy?.title).toBe('Box');
    expect(copy?.price).toBeUndefined();
  });

  it('create: a failed cross-list source still opens a blank workspace', async () => {
    router.query = { crosslist: 'etsy:123' };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetches.push(url);
      if (url.startsWith('/api/listings')) return { ok: true, status: 200, json: async () => ({ rows: [], store: { id: 'sup1', name: '', currency: 'TRY' } }) } as Response;
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }));
    render(<TrendyolNew />);
    const el = await screen.findByTestId('editor');
    expect(el.dataset.mode).toBe('create');
    expect(editorProps[editorProps.length - 1].copy).toBeNull();
  });
});

describe('catalog health', () => {
  it('scores the draft view with the Trendyol scorer and shows "after you send"', () => {
    const remote = trendyolFieldsFromProduct({
      barcode: '1', title: 'Kısa', images: [{ url: 'https://cdn.dsmcdn.com/1.jpg' }], salePrice: 10, listPrice: 12, quantity: 1, vatRate: 20,
      brand: 'Belle', categoryName: 'Kutular',
    }) as unknown as FieldMap;
    const longer = { ...remote, title: 'Belle Kutular kişiye özel ahşap anı kutusu isim baskılı doğum günü hediyesi bebek için ideal seçim' };
    const view = { marketplace: 'trendyol', mode: 'edit', fields: longer, meta: { images: [], raw: { approved: true } }, facts: {} } as unknown as ListingView<FieldMap>;
    const h = computeCatalogHealth('trendyol', view, remote);
    expect(h.result.checksTotal).toBeGreaterThan(0);
    expect(h.score).not.toBeNull();
    expect(h.afterScore === null || h.afterScore > (h.score ?? 0)).toBe(true);
    const empty = computeCatalogHealth('wix', { ...view, marketplace: 'wix', fields: { title: '', images: [] } } as unknown as ListingView<FieldMap>, null);
    expect(empty.score).toBeNull();
  });
});

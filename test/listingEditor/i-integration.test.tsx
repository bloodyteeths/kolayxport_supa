// @vitest-environment jsdom
// M6 integrator seams: list → editor hand-offs, the `kx:editorNav` Back query, and `#field` deep links from the
// Listing doctor.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { editorHandoffHref } from '@/lib/listings/legacyHandoff';
import { resolveEditorHash } from '@/lib/listingEditor/sections';
import { listHref, listQueryForEditor } from '@/lib/listingEditor/editorNav';

const router = {
  isReady: true,
  query: {} as Record<string, string>,
  replace: vi.fn(async () => true),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/domain/listings/ListingsPage', () => ({
  default: ({ marketplace }: { marketplace: string }) => <div data-testid={`new-${marketplace}`} />,
}));

import EtsyRoute from '@/pages/app/etsy-listings';
import EbayRoute from '@/pages/app/ebay-listings';

afterEach(() => {
  cleanup();
  router.isReady = true;
  router.query = {};
  router.replace.mockClear();
});

describe('editorHandoffHref', () => {
  it('sends research prefill to the create route, keeping the Etsy shop', () => {
    expect(editorHandoffHref('etsy', { prefill: 'session', shop: '42' })).toBe('/app/etsy-listings/new?shop=42&prefill=session');
    expect(editorHandoffHref('ebay', { prefill: 'session', shop: '42' })).toBe('/app/ebay-listings/new?prefill=session');
  });
  it('sends Etsy → eBay cross-list to the eBay create route', () => {
    expect(editorHandoffHref('ebay', { crosslist: 'etsy:123' })).toBe('/app/ebay-listings/new?crosslist=etsy%3A123');
  });
  it('sends eBay → Etsy cross-list to the Etsy create route', () => {
    expect(editorHandoffHref('etsy', { crosslist: 'ebay:SKU-1' })).toBe('/app/etsy-listings/new?crosslist=ebay%3ASKU-1');
  });
  it('returns null for hand-offs the editor cannot bootstrap (the grid ignores them)', () => {
    expect(editorHandoffHref('etsy', { crosslist: 'etsy:123' })).toBeNull();
    expect(editorHandoffHref('ebay', { crosslist: 'etsy:abc' })).toBeNull();
    expect(editorHandoffHref('etsy', {})).toBeNull();
    expect(editorHandoffHref('etsy', { view: 'not_sent' })).toBeNull();
  });
});

describe.each([
  ['etsy', EtsyRoute],
  ['ebay', EbayRoute],
] as Array<[string, React.ComponentType]>)('%s listings route hand-offs', (mp, Route) => {
  it('?prefill=session → replaces to the create route, never mounts the grid', async () => {
    router.query = { prefill: 'session' };
    const { container } = render(<Route />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/app/${mp}-listings/new?prefill=session`));
    expect(container.innerHTML).toBe('');
  });
  it('no hand-off → the list', () => {
    render(<Route />);
    expect(screen.getByTestId(`new-${mp}`)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('listQueryForEditor', () => {
  it('keeps the list state and drops the quick view / tool panel', () => {
    expect(listQueryForEditor('?shop=1&view=active&open=99&tool=duplicates&page=2')).toBe('?shop=1&view=active&page=2');
    expect(listQueryForEditor('?open=99')).toBeUndefined();
    expect(listQueryForEditor('')).toBeUndefined();
  });
  it('round-trips into the editor Back link', () => {
    expect(listHref('etsy', '1', listQueryForEditor('?shop=1&q=ring&open=5'))).toBe('/app/etsy-listings?shop=1&q=ring');
  });
});

describe('resolveEditorHash', () => {
  it('maps a section id or a field key to a scroll target', () => {
    expect(resolveEditorHash('#photos', 'etsy', 'edit')).toEqual({ section: 'photos' });
    expect(resolveEditorHash('#price', 'etsy', 'edit')).toEqual({ section: 'price' });
    expect(resolveEditorHash('#description', 'etsy', 'edit')).toEqual({ section: 'title', field: 'description' });
    expect(resolveEditorHash('#taxonomy_id', 'etsy', 'edit')).toEqual({ section: 'details', field: 'taxonomy_id' });
  });
  it('ignores unknown keys and sections the marketplace does not render', () => {
    expect(resolveEditorHash('', 'etsy', 'edit')).toBeNull();
    expect(resolveEditorHash('#nope', 'etsy', 'edit')).toBeNull();
    expect(resolveEditorHash('#tags', 'ebay', 'edit')).toBeNull();
    expect(resolveEditorHash('#aspects', 'etsy', 'edit')).toBeNull();
    expect(resolveEditorHash('#%E0%A4%A', 'etsy', 'edit')).toBeNull();
  });
});

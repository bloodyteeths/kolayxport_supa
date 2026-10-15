// @vitest-environment jsdom
// listings G7: the five listings routes render the shared ListingsPage for their marketplace (behind withAuth)
// (listings-grid §13–§14). Etsy/eBay forward old research/cross-list hand-offs to the create route.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const replace = vi.fn(() => Promise.resolve(true));
const router: { isReady: boolean; query: Record<string, string>; replace: typeof replace } = { isReady: true, query: {}, replace };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/domain/listings/ListingsPage', () => ({
  default: ({ marketplace }: { marketplace: string }) => <div data-testid={`new-${marketplace}`} />,
}));

import EtsyRoute from '@/pages/app/etsy-listings';
import EbayRoute from '@/pages/app/ebay-listings';
import TrendyolRoute from '@/pages/app/trendyol-urunler';
import WixRoute from '@/pages/app/wix-urunler';
import ShopifyRoute from '@/pages/app/shopify-urunler';

afterEach(() => {
  cleanup();
  replace.mockClear();
  router.isReady = true;
  router.query = {};
});

const ROUTES: Array<[string, React.ComponentType]> = [
  ['etsy', EtsyRoute],
  ['ebay', EbayRoute],
  ['trendyol', TrendyolRoute],
  ['wix', WixRoute],
  ['shopify', ShopifyRoute],
];

describe.each(ROUTES)('%s listings route', (mp, Route) => {
  it(`renders ListingsPage marketplace="${mp}"`, () => {
    render(<Route />);
    expect(screen.getByTestId(`new-${mp}`)).toBeTruthy();
  });
});

describe.each([
  ['etsy', EtsyRoute],
  ['ebay', EbayRoute],
] as Array<[string, React.ComponentType]>)('%s listings route: hand-offs (lib/listings/legacyHandoff.ts)', (mp, Route) => {
  it('?prefill=session → replaces with the create route, grid not mounted', () => {
    router.query = { prefill: 'session' };
    const { container } = render(<Route />);
    expect(container.innerHTML).toBe('');
    expect(replace).toHaveBeenCalledWith(`/app/${mp}-listings/new?prefill=session`);
  });
  it('unknown cross-list value → grid, no redirect', () => {
    router.query = { crosslist: 'x:1' };
    render(<Route />);
    expect(screen.getByTestId(`new-${mp}`)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
  it('router not ready → renders nothing (the grid never mounts before the query is known)', () => {
    router.isReady = false;
    const { container } = render(<Route />);
    expect(container.innerHTML).toBe('');
  });
});

// @vitest-environment jsdom
// listings G7: the five listings routes are flag switches (listings-grid §13–§14, BUILD_PLAN §3).
// Flag on → the shared ListingsPage for that marketplace (behind withAuth); off → the legacy page moved
// unchanged to components/legacy/listings/*Legacy.tsx.
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const flags = new Set<string>();
const router: { isReady: boolean; query: Record<string, string> } = { isReady: true, query: {} };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@/lib/ds/uiFlags', () => ({ useUiFlag: (key: string) => flags.has(key) }));
vi.mock('@/components/withAuth', () => ({ default: (C: React.ComponentType) => C }));
vi.mock('@/components/domain/listings/ListingsPage', () => ({
  default: ({ marketplace }: { marketplace: string }) => <div data-testid={`new-${marketplace}`} />,
}));
vi.mock('@/components/legacy/listings/EtsyListingsLegacy', () => ({ default: () => <div data-testid="legacy-etsy" /> }));
vi.mock('@/components/legacy/listings/EbayListingsLegacy', () => ({ default: () => <div data-testid="legacy-ebay" /> }));
vi.mock('@/components/legacy/listings/TrendyolListingsLegacy', () => ({ default: () => <div data-testid="legacy-trendyol" /> }));
vi.mock('@/components/legacy/listings/WixListingsLegacy', () => ({ default: () => <div data-testid="legacy-wix" /> }));
vi.mock('@/components/legacy/listings/ShopifyListingsLegacy', () => ({ default: () => <div data-testid="legacy-shopify" /> }));

import EtsyRoute from '@/pages/app/etsy-listings';
import EbayRoute from '@/pages/app/ebay-listings';
import TrendyolRoute from '@/pages/app/trendyol-urunler';
import WixRoute from '@/pages/app/wix-urunler';
import ShopifyRoute from '@/pages/app/shopify-urunler';

afterEach(() => {
  cleanup();
  flags.clear();
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

describe.each(ROUTES)('%s listings route flag switch', (mp, Route) => {
  it('flag off → legacy page', () => {
    render(<Route />);
    expect(screen.getByTestId(`legacy-${mp}`)).toBeTruthy();
    expect(screen.queryByTestId(`new-${mp}`)).toBeNull();
  });
  it(`flag listings-${mp} on → ListingsPage marketplace="${mp}"`, () => {
    flags.add(`listings-${mp}`);
    render(<Route />);
    expect(screen.getByTestId(`new-${mp}`)).toBeTruthy();
    expect(screen.queryByTestId(`legacy-${mp}`)).toBeNull();
  });
  it('another marketplace flag does not switch this route', () => {
    for (const [other] of ROUTES) if (other !== mp) flags.add(`listings-${other}`);
    render(<Route />);
    expect(screen.getByTestId(`legacy-${mp}`)).toBeTruthy();
  });
});

describe.each([
  ['etsy', EtsyRoute],
  ['ebay', EbayRoute],
] as Array<[string, React.ComponentType]>)('%s listings route: legacy hand-offs (lib/listings/legacyHandoff.ts)', (mp, Route) => {
  it('flag on + ?prefill=session → legacy page (its creator reads the research prefill)', () => {
    flags.add(`listings-${mp}`);
    router.query = { prefill: 'session' };
    render(<Route />);
    expect(screen.getByTestId(`legacy-${mp}`)).toBeTruthy();
  });
  it('stays on the legacy page after it drops the param (no swap under the open creator)', () => {
    flags.add(`listings-${mp}`);
    router.query = { crosslist: 'x:1' };
    const { rerender } = render(<Route />);
    router.query = {};
    rerender(<Route />);
    expect(screen.getByTestId(`legacy-${mp}`)).toBeTruthy();
    expect(screen.queryByTestId(`new-${mp}`)).toBeNull();
  });
  it('flag on, router not ready → renders nothing (the grid never mounts before the query is known)', () => {
    flags.add(`listings-${mp}`);
    router.isReady = false;
    const { container } = render(<Route />);
    expect(container.innerHTML).toBe('');
  });
});

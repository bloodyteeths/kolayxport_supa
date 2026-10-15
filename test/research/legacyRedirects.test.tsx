// @vitest-environment jsdom
// research R1-E: old research routes redirect to the hub (research.md §2.3), flag-aware.
import * as React from 'react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GetServerSidePropsContext } from 'next';

const routerState: { isReady: boolean; query: Record<string, string>; replace: ReturnType<typeof vi.fn> } = {
  isReady: true,
  query: {},
  replace: vi.fn(() => Promise.resolve(true)),
};
vi.mock('next/router', () => ({ useRouter: () => routerState }));

import {
  legacyResearchGssp,
  legacyResearchTarget,
  researchFlagOnServer,
  withLegacyResearchRedirect,
  RESEARCH_TOOL_PAGE,
  SHIPPED_RESEARCH_TARGETS,
  type ResearchTool,
  type ShippedResearchKey,
} from '@/lib/research/legacyRedirects';
import { UI_OVERRIDE_STORAGE_KEY } from '@/lib/ds/uiFlags';

const MKTS = ['etsy', 'ebay', 'trendyol', 'amazon'] as const;
const ALL: ReadonlySet<ShippedResearchKey> = new Set<ShippedResearchKey>([
  ...(['products', 'keywords', 'listings', 'shops'] as const).flatMap((tool) =>
    MKTS.map((mkt) => `${tool}:${mkt}` as ShippedResearchKey),
  ),
  'price-gap',
  'financials',
]);

describe('shipped targets exist', () => {
  it.each([...SHIPPED_RESEARCH_TARGETS])('%s has its page file in this tree', (key) => {
    const tool = key.split(':')[0] as ResearchTool;
    expect(existsSync(resolve(__dirname, '../../pages', RESEARCH_TOOL_PAGE[tool]))).toBe(true);
  });
});

const R1_ONLY: ReadonlySet<ShippedResearchKey> = new Set<ShippedResearchKey>([
  'products:etsy',
  'products:ebay',
  'listings:etsy',
  'listings:ebay',
  'financials',
]);

describe('legacyResearchTarget — shipped set (R1 + R2 Keyword explorer + R3 Shop tracker for Etsy)', () => {
  it.each([
    [{}, '/app/research/products?mkt=etsy'],
    [{ tab: 'research' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'discover' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'unified' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'whatever' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'grader' }, '/app/research/listings?mkt=etsy'],
  ])('etsy %o → %s', (query, expected) => {
    expect(legacyResearchTarget('etsy', query)).toBe(expected);
  });

  it('ships keywords:etsy and shops:etsy, but not the eBay / Trendyol / Amazon keyword & shop tools or price-gap', () => {
    expect(SHIPPED_RESEARCH_TARGETS.has('keywords:etsy')).toBe(true);
    expect(SHIPPED_RESEARCH_TARGETS.has('shops:etsy')).toBe(true);
    for (const key of ['keywords:ebay', 'shops:ebay', 'products:trendyol', 'products:amazon', 'price-gap'] as const) {
      expect(SHIPPED_RESEARCH_TARGETS.has(key)).toBe(false);
    }
  });

  it.each([
    [{ tab: 'shopIntel' }, '/app/research/shops?mkt=etsy'],
    [{ tab: 'competitors' }, '/app/research/shops?mkt=etsy'],
    [{ tab: 'keywords' }, '/app/research/keywords?mkt=etsy'],
    [{ tab: 'keywords', q: 'oak box' }, '/app/research/keywords?mkt=etsy&q=oak+box'],
    [{ tab: 'ranks' }, '/app/research/keywords?mkt=etsy&view=tracked'],
  ])('etsy %o → %s now that Keyword explorer and Shop tracker shipped', (query, expected) => {
    expect(legacyResearchTarget('etsy', query)).toBe(expected);
  });

  it.each(['shopIntel', 'competitors', 'keywords', 'ranks'])('etsy ?tab=%s stays legacy when its tool is not shipped', (tab) => {
    expect(legacyResearchTarget('etsy', { tab }, R1_ONLY)).toBeNull();
  });

  it.each([
    [{}, '/app/research/products?mkt=ebay'],
    [{ tab: 'research', sub: 'product_database' }, '/app/research/products?mkt=ebay'],
    [{ tab: 'research', sub: 'niche_finder' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'marketplace_comparison' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'niche_comparison' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'category_explorer' }, '/app/research/products?mkt=ebay'],
    [{ tab: 'optimization', sub: 'listing_optimizer' }, '/app/research/listings?mkt=ebay'],
    [{ sub: 'ai_hub' }, '/app/research/listings?mkt=ebay'],
    [{ tab: 'ai_hub' }, '/app/research/listings?mkt=ebay'],
    [{ sub: 'financial' }, '/app/financials'],
    [{ tab: 'tracking' }, '/app/research/products?mkt=ebay'],
  ])('ebay %o → %s', (query, expected) => {
    expect(legacyResearchTarget('ebay', query)).toBe(expected);
  });

  it.each([
    'keyword_intelligence',
    'seo_analyzer',
    'product_tracker',
    'seller_tracker',
    'competitive_intelligence',
    'arbitrage',
  ])('ebay ?sub=%s stays legacy until its tool ships', (sub) => {
    expect(legacyResearchTarget('ebay', { sub })).toBeNull();
    expect(legacyResearchTarget('ebay', { tab: sub })).toBeNull();
  });

  it('trendyol and amazon stay legacy: the R1 Product finder cannot serve them yet', () => {
    expect(legacyResearchTarget('trendyol', {})).toBeNull();
    expect(legacyResearchTarget('trendyol', { tab: 'sellers' })).toBeNull();
    expect(legacyResearchTarget('amazon', {})).toBeNull();
  });

  it('carries the search text and the ui override', () => {
    expect(legacyResearchTarget('etsy', { q: ' jewelry box ', ui: 'research' })).toBe(
      '/app/research/products?mkt=etsy&q=jewelry+box&ui=research',
    );
    expect(legacyResearchTarget('ebay', { sub: 'product_database', keyword: 'lego' })).toBe(
      '/app/research/products?mkt=ebay&q=lego',
    );
    expect(legacyResearchTarget('etsy', { tab: 'grader', q: 'x' })).toBe('/app/research/listings?mkt=etsy');
    expect(legacyResearchTarget('etsy', { tab: ['grader', 'research'] })).toBe('/app/research/listings?mkt=etsy');
  });
});

describe('legacyResearchTarget — later releases (mapping already encoded)', () => {
  it.each<[Parameters<typeof legacyResearchTarget>[0], Record<string, string>, string]>([
    ['etsy', { tab: 'ranks' }, '/app/research/keywords?mkt=etsy&view=tracked'],
    ['etsy', { tab: 'keywords' }, '/app/research/keywords?mkt=etsy'],
    ['etsy', { tab: 'shopIntel' }, '/app/research/shops?mkt=etsy'],
    ['ebay', { sub: 'seo_analyzer' }, '/app/research/keywords?mkt=ebay'],
    ['ebay', { sub: 'seller_tracker' }, '/app/research/shops?mkt=ebay'],
    ['ebay', { sub: 'arbitrage' }, '/app/research/products?source=trendyol'],
    ['trendyol', { tab: 'sellers' }, '/app/research/products?mkt=trendyol'],
    ['amazon', {}, '/app/research/products?mkt=amazon'],
  ])('%s %o → %s', (route, query, expected) => {
    expect(legacyResearchTarget(route, query, ALL)).toBe(expected);
  });
});

describe('researchFlagOnServer', () => {
  it('never redirects on the build default alone (the stored opt-out is invisible to the server)', () => {
    expect(researchFlagOnServer({}, undefined)).toBe(false);
    expect(researchFlagOnServer({}, '')).toBe(false);
    expect(researchFlagOnServer({}, 'orders,research')).toBe(false);
    expect(researchFlagOnServer({}, 'all')).toBe(false);
    expect(researchFlagOnServer({ ui: 'garbage!' }, 'research')).toBe(false);
  });
  it('honours a ?ui= override on the request', () => {
    expect(researchFlagOnServer({ ui: 'research' }, 'none')).toBe(true);
    expect(researchFlagOnServer({ ui: '2' }, 'none')).toBe(true);
    expect(researchFlagOnServer({ ui: 'orders' }, 'research')).toBe(true);
    expect(researchFlagOnServer({ ui: 'reset' }, 'research')).toBe(true);
    expect(researchFlagOnServer({ ui: '1' }, 'research')).toBe(false);
    expect(researchFlagOnServer({ ui: 'orders' }, 'none')).toBe(false);
    expect(researchFlagOnServer({ ui: 'reset' }, 'none')).toBe(false);
  });
  it('with NEXT_PUBLIC_UI_V2 unset (default all) a ?ui= list or reset keeps research on; ?ui=1 turns it off', () => {
    expect(researchFlagOnServer({ ui: 'orders' }, undefined)).toBe(true);
    expect(researchFlagOnServer({ ui: 'reset' }, undefined)).toBe(true);
    expect(researchFlagOnServer({ ui: '2' }, undefined)).toBe(true);
    expect(researchFlagOnServer({ ui: '1' }, undefined)).toBe(false);
  });
});

describe('legacyResearchGssp', () => {
  const ctx = (query: Record<string, string>) => ({ query }) as unknown as GetServerSidePropsContext;
  const prevEnv = process.env.NEXT_PUBLIC_UI_V2;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NEXT_PUBLIC_UI_V2;
    else process.env.NEXT_PUBLIC_UI_V2 = prevEnv;
  });

  it('flag off → renders the legacy page', async () => {
    process.env.NEXT_PUBLIC_UI_V2 = 'none';
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'grader' }))).toEqual({ props: {} });
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'grader', ui: 'orders' }))).toEqual({ props: {} });
  });
  it('?ui=1 → legacy page even with the all-on default', async () => {
    delete process.env.NEXT_PUBLIC_UI_V2;
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'grader', ui: '1' }))).toEqual({ props: {} });
  });
  it('build default on, no ?ui= → legacy page (the client decides with the stored override)', async () => {
    process.env.NEXT_PUBLIC_UI_V2 = 'research';
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'grader' }))).toEqual({ props: {} });
  });
  it('?ui= turns it on → temporary redirect with the mapped tab and the override carried', async () => {
    process.env.NEXT_PUBLIC_UI_V2 = 'none';
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'grader', ui: 'research' }))).toEqual({
      redirect: { destination: '/app/research/listings?mkt=etsy&ui=research', permanent: false },
    });
  });
  it('flag on but the tool has not shipped → legacy page', async () => {
    expect(await legacyResearchGssp('ebay')(ctx({ sub: 'arbitrage', ui: '2' }))).toEqual({ props: {} });
    expect(await legacyResearchGssp('ebay')(ctx({ sub: 'seller_tracker', ui: '2' }))).toEqual({ props: {} });
  });
  it('etsy Keyword explorer / Shop tracker tabs redirect once ?ui= turns the flag on', async () => {
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'shopIntel', ui: '2' }))).toEqual({
      redirect: { destination: '/app/research/shops?mkt=etsy&ui=2', permanent: false },
    });
    expect(await legacyResearchGssp('etsy')(ctx({ tab: 'ranks', ui: 'research' }))).toEqual({
      redirect: { destination: '/app/research/keywords?mkt=etsy&view=tracked&ui=research', permanent: false },
    });
  });
  it('trendyol / amazon keep the legacy page in R1', async () => {
    expect(await legacyResearchGssp('amazon')(ctx({ ui: 'research' }))).toEqual({ props: {} });
    expect(await legacyResearchGssp('trendyol')(ctx({ ui: '2' }))).toEqual({ props: {} });
  });
});

describe('withLegacyResearchRedirect (client fallback for the stored override)', () => {
  const Legacy = () => <div data-testid="legacy" />;
  const Wrapped = withLegacyResearchRedirect('etsy', Legacy);
  const WrappedEbay = withLegacyResearchRedirect('ebay', Legacy);

  beforeEach(() => {
    routerState.query = {};
    routerState.isReady = true;
    routerState.replace.mockClear();
    window.history.replaceState(null, '', '/app/etsy-research');
    window.localStorage.clear();
  });
  afterEach(() => cleanup());

  it('no override, flag off (NEXT_PUBLIC_UI_V2=none) → legacy page, no navigation', () => {
    vi.stubEnv('NEXT_PUBLIC_UI_V2', 'none');
    try {
      render(<Wrapped />);
      expect(screen.getByTestId('legacy')).toBeTruthy();
      expect(routerState.replace).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('no override, NEXT_PUBLIC_UI_V2 unset (default all) → redirects on load', () => {
    const prev = process.env.NEXT_PUBLIC_UI_V2;
    delete process.env.NEXT_PUBLIC_UI_V2; // vitest 1.x stubEnv(undefined) would set the string "undefined"
    try {
      routerState.query = { tab: 'shopIntel' };
      render(<Wrapped />);
      expect(routerState.replace).toHaveBeenCalledWith('/app/research/shops?mkt=etsy');
    } finally {
      if (prev !== undefined) process.env.NEXT_PUBLIC_UI_V2 = prev;
    }
  });

  it('NEXT_PUBLIC_UI_V2=none + stored override on → redirects', () => {
    vi.stubEnv('NEXT_PUBLIC_UI_V2', 'none');
    try {
      window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, 'research');
      routerState.query = { tab: 'keywords' };
      render(<Wrapped />);
      expect(routerState.replace).toHaveBeenCalledWith('/app/research/keywords?mkt=etsy');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('stored override on → replaces the URL with the hub target', () => {
    window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, 'research');
    routerState.query = { tab: 'grader' };
    render(<Wrapped />);
    expect(routerState.replace).toHaveBeenCalledWith('/app/research/listings?mkt=etsy');
    expect(screen.queryByTestId('legacy')).toBeNull();
  });

  it('stored override on but the tab has no shipped tool → legacy stays', () => {
    window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, 'research');
    routerState.query = { sub: 'arbitrage' };
    render(<WrappedEbay />);
    expect(screen.getByTestId('legacy')).toBeTruthy();
    expect(routerState.replace).not.toHaveBeenCalled();
  });

  it('build default on + stored all-off → legacy page, no navigation', () => {
    vi.stubEnv('NEXT_PUBLIC_UI_V2', 'research');
    try {
      window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, '1');
      render(<Wrapped />);
      expect(screen.getByTestId('legacy')).toBeTruthy();
      expect(routerState.replace).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('build default on, no override → redirects on load', () => {
    vi.stubEnv('NEXT_PUBLIC_UI_V2', 'research');
    try {
      render(<Wrapped />);
      expect(routerState.replace).toHaveBeenCalledWith('/app/research/products?mkt=etsy');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('checks once: a later shallow tab change on a non-shipped tab does not redirect', () => {
    window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, 'research');
    routerState.query = { sub: 'seller_tracker' };
    const view = render(<WrappedEbay />);
    expect(routerState.replace).not.toHaveBeenCalled();
    routerState.query = { sub: 'listing_optimizer' }; // the legacy page's own shallow router.replace
    view.rerender(<WrappedEbay />);
    expect(routerState.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('legacy')).toBeTruthy();
  });

  it('waits for the router', () => {
    window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, 'research');
    routerState.isReady = false;
    render(<Wrapped />);
    expect(routerState.replace).not.toHaveBeenCalled();
  });
});

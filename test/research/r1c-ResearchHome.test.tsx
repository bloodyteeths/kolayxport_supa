// @vitest-environment jsdom
// research R1-C Home (research.md §4) + the route gate: search + chips, needs-work card (rows, ConnectState when no
// Etsy/eBay store), seasons with editable production days, recent searches, ⌘K `?q=` routing, EN/TR, mobile, and the
// `research` flag gate (off → legacy page).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { UI_OVERRIDE_STORAGE_KEY } from '@/lib/ds/uiFlags';
import { setViewport } from '../ds/m1e-helpers';
import { R1C_EN, R1C_TR } from './r1c-messages';
import { homeResponse, seasonsResponse } from './r1c-fixtures';

const router = {
  pathname: '/app/research',
  asPath: '/app/research',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (url: unknown) => {
    if (url && typeof url === 'object') router.query = (url as { query: Record<string, string> }).query;
    return true;
  }),
  push: vi.fn(async () => true),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ has: (p: string) => p === 'etsy', connections: {}, isLoading: false }),
}));

import { ResearchHome } from '@/components/domain/research/home/ResearchHome';
import { ResearchRouteGate } from '@/components/domain/research/ResearchLayout';
import { RECENT_KEY } from '@/components/domain/research/home/recentSearches';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const SERVER_EN = { research: { season: { christmas: 'Christmas', valentines: "Valentine's Day" }, source: { listingsHealth: 'Etsy listings · health', yourLabels: 'Your labels' } } };
const SERVER_TR = { research: { season: { christmas: 'Noel', valentines: 'Sevgililer Günü' }, source: { listingsHealth: 'Etsy ilanları · sağlık', yourLabels: 'Etiketleriniz' } } };
const MESSAGES = {
  en: deepMerge(deepMerge(en as Obj, R1C_EN as unknown as Obj), SERVER_EN),
  tr: deepMerge(deepMerge(tr as Obj, R1C_TR as unknown as Obj), SERVER_TR),
};
const NOW = new Date('2026-10-15T12:00:00Z');

let homeBody: unknown = homeResponse();
const fetchMock = vi.fn(async (url: string) => {
  const u = String(url);
  if (u.startsWith('/api/research/home')) return new Response(JSON.stringify(homeBody), { status: 200 });
  if (u.startsWith('/api/research/seasons')) return new Response(JSON.stringify(seasonsResponse()), { status: 200 });
  if (u.startsWith('/api/listings/export')) return new Response('id,title,tags\n', { status: 200 });
  return new Response('{}', { status: 200 });
});

function wrap(node: React.ReactNode, locale: 'en' | 'tr' = 'en') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>{node}</ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  homeBody = homeResponse();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Research Home', () => {
  it('desktop: subtitle, one primary search, five chips, needs-work rows, seasons', async () => {
    wrap(<ResearchHome now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('research-needswork-row-1490012234')).toBeTruthy());
    expect(screen.getByText('Find what to sell, how to price it, and which words buyers use')).toBeTruthy();
    expect(screen.getByTestId('research-home-submit').textContent).toBe('Research');
    for (const k of ['niche', 'price', 'tags', 'notSelling', 'competitors']) expect(screen.getByTestId(`research-q-${k}`)).toBeTruthy();
    expect(screen.getByText('412 views, 0 sales (30 days)')).toBeTruthy();
    expect(screen.getByText('2 issues')).toBeTruthy();
    expect(screen.getByText('18 listings under 50 · Open Listing doctor')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('research-season-christmas')).toBeTruthy());
    expect(screen.getByTestId('research-season-christmas').textContent).toContain('List by Oct 25 · in 10 days');
    expect(screen.getByTestId('research-season-christmas').getAttribute('href')).toBe('/app/research/products?mkt=etsy&q=christmas+ornament+personalized');
  });

  it('no Etsy/eBay store: the card becomes a ConnectState', async () => {
    homeBody = homeResponse({ needsWorkMkt: null, needsWork: [], needsWorkTotal: 0, connected: { etsy: false, ebay: false } });
    wrap(<ResearchHome now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('research-needswork-connect')).toBeTruthy());
  });

  it('production days edit re-bases list-by dates and persists per viewer', async () => {
    wrap(<ResearchHome now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('research-season-christmas')).toBeTruthy());
    fireEvent.click(screen.getByTestId('research-production-days'));
    const input = (await screen.findByTestId('research-production-days-input')).querySelector('input') ?? (screen.getByTestId('research-production-days-input') as HTMLInputElement);
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('research-production-days-save'));
    await waitFor(() => expect(screen.getByTestId('research-season-christmas').textContent).toContain('List by Oct 20 · in 5 days'));
    expect(window.localStorage.getItem('kx.research.productionDays')).toBe('8');
  });

  it('search routes plain text to Product finder and remembers it; recent searches render', async () => {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([{ q: 'wooden keepsake box', tool: 'products', mkt: 'etsy', at: '2026-10-15T10:00:00.000Z' }]));
    wrap(<ResearchHome now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('research-recent')).toBeTruthy());
    expect(screen.getByText('wooden keepsake box')).toBeTruthy();
    const input = screen.getByTestId('research-home-search').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'baby name puzzle' } });
    fireEvent.click(screen.getByTestId('research-home-submit'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/app/research/products?mkt=etsy&q=baby+name+puzzle'));
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')[0].q).toBe('baby name puzzle');
  });

  it('⌘K lands with ?q= → routed once', async () => {
    router.query = { q: 'https://www.etsy.com/shop/WoodAndWords' };
    wrap(<ResearchHome now={NOW} />);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    // Shop tracker (R3) is on the hub: the shop link opens "Watch a shop" prefilled.
    expect(router.push).toHaveBeenCalledWith('/app/research/shops?mkt=etsy&add=WoodAndWords');
  });

  it('a chip with an empty query focuses the search with that question as the hint', async () => {
    wrap(<ResearchHome now={NOW} />);
    await act(async () => {});
    fireEvent.click(screen.getByTestId('research-q-price'));
    const input = screen.getByTestId('research-home-search').querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('Type the product you want to price');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('TR and mobile (chips scroll, no sticky primary)', async () => {
    setViewport('mobile');
    wrap(<ResearchHome now={NOW} />, 'tr');
    await waitFor(() => expect(screen.getByTestId('research-needswork-row-1490012234')).toBeTruthy());
    expect(screen.getByText('Geliştirilmesi gereken ilanlarınız')).toBeTruthy();
    expect(screen.getByTestId('research-home-submit').textContent).toBe('Araştır');
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull();
  });
});

describe('ResearchRouteGate (flag `research`)', () => {
  it('flag off (build default off) → replaces with the legacy page for ?mkt', async () => {
    wrap(
      <ResearchRouteGate mkt="ebay">
        <div data-testid="hub" />
      </ResearchRouteGate>,
    );
    await act(async () => {});
    expect(screen.queryByTestId('hub')).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/app/ebay-research');
  });

  it('flag on (?ui override) → renders the hub', async () => {
    window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, 'research');
    wrap(
      <ResearchRouteGate>
        <div data-testid="hub" />
      </ResearchRouteGate>,
    );
    await act(async () => {});
    expect(screen.getByTestId('hub')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

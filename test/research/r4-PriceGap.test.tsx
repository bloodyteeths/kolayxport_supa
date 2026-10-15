// @vitest-environment jsdom
// research R4 Price gap UI (research.md §9, pro-gating §2): the source segment per plan (Pro plain, trial/locked
// with PlanTag, shopify_free not rendered), the region gate (locked / neutral locked instead of the table), the
// table (medians with n, estimates with "~", low-confidence collapsed), own shipping override, the MarginBox panel,
// and "List on eBay" writing a session prefill with no marketplace write.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { useFeatureLockStore } from '@/lib/http/limitInterceptor';
import { LISTING_PREFILL_KEY } from '@/components/etsy/research/shared/listingPrefill';
import { summarizeAmounts } from '@/lib/research/stats';
import type { PriceGapData, PriceGapRow } from '@/lib/research/priceGap';
import type { ResearchResponse } from '@/lib/research/types';
import { F } from '../billing/d-fixtures';
import { R4_EN, R4_TR } from './r4-messages';

const router = {
  pathname: '/app/research/products',
  asPath: '/app/research/products',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (url: { query: Record<string, string | string[]> }) => {
    router.query = url.query;
    return true;
  }),
  push: vi.fn(async () => true),
  events: { on: () => undefined, off: () => undefined },
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ has: (p: string) => p === 'trendyol', connections: {}, isLoading: false }),
}));

import { PriceGap, PriceGapSourceSegment, priceGapKey } from '@/components/domain/research/products/PriceGapTable';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, R4_EN as unknown as Obj), tr: deepMerge(tr as Obj, R4_TR as unknown as Obj) };

const gapRow = (o: Partial<PriceGapRow> = {}): PriceGapRow => ({
  id: '1',
  title: 'El yapımı bakır cezve',
  brand: 'Usta',
  url: 'https://www.trendyol.com/u/c-p-1',
  imageUrl: 'https://cdn.dsmcdn.com/1.jpg',
  images: ['https://cdn.dsmcdn.com/1.jpg'],
  trPriceTry: 640,
  category: { slug: 'cezve-x-c1', name: 'Cezve' },
  confidence: 'high',
  ebay: summarizeAmounts([40, 44, 46, 48, 50, 52], 'USD'),
  ebayCategoryId: '20625',
  matches: [{ itemId: 'e1', title: 'Turkish Copper Coffee Pot', price: 48, currency: 'USD', soldAllTime: 12, url: 'https://www.ebay.com/itm/e1', imageUrl: null, confidence: 0.9, matchType: 'exact' }],
  etsy: null,
  englishQuery: 'turkish copper coffee pot',
  fetchedAt: '2026-10-14T08:00:00.000Z',
  ...o,
});

function gapBody(over: Partial<PriceGapData> = {}): ResearchResponse<PriceGapData> {
  return {
    data: {
      from: 'category',
      category: 'cezve-x-c1',
      categories: [{ slug: 'cezve-x-c1', label: 'Coffee pots', labelTr: 'Cezve', products: 40 }],
      fx: { usdPerTry: 1 / 40, source: 'exchangerate-api.com', fetchedAt: '2026-10-15T09:00:00.000Z' },
      shipping: [{ carrier: 'fedex', band: '1', n: 12, medianUsd: 14.2, p25Usd: 13, p75Usd: 15, quality: 'small' }],
      shippingExcluded: 0,
      shippingExcludedDefaultWeight: 0,
      defaultWeightKg: 0.8,
      rows: [gapRow(), gapRow({ id: '2', title: 'Peştemal', confidence: 'low', ebay: summarizeAmounts([20, 22], 'USD') })],
      unmatched: 3,
      unresolved: 0,
      ...over,
    },
    source: { source: 'research.sourceName.priceGap', fetchedAt: '2026-10-14T08:00:00.000Z', sample: 2, sampleUnit: 'items', kind: 'measured' },
  };
}

let entitlement: unknown = F.pro();
let body: ResearchResponse<PriceGapData> = gapBody();
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  void init;
  const u = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (u.startsWith('/api/billing/entitlement')) return new Response(JSON.stringify(entitlement), { status: 200 });
  if (u.startsWith('/api/research/price-gap')) return new Response(JSON.stringify(body), { status: 200 });
  return new Response('{}', { status: 404 });
});

function renderUi(ui: React.ReactElement, locale: 'en' | 'tr' = 'en') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale] as never}
        timeZone="Europe/Istanbul"
        onError={(e) => { if (e.code === 'MISSING_MESSAGE') throw e; }}
      >
        <FormatProvider timeZone="Europe/Istanbul">
          <ThemeProvider theme={theme}>{ui}</ThemeProvider>
        </FormatProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

const gapCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/research/price-gap'));
const writes = () => fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') !== 'GET');

beforeEach(() => {
  __resetUrlStateForTests();
  useFeatureLockStore.getState().clear();
  router.query = { source: 'trendyol' };
  router.replace.mockClear();
  router.push.mockClear();
  entitlement = F.pro();
  body = gapBody();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PriceGapSourceSegment (pro-gating §2 "arbitrage" row)', () => {
  const seg = () => renderUi(<PriceGapSourceSegment value="search" onChange={() => undefined} />);

  it('Pro: "Search | From Trendyol", no PlanTag', async () => {
    seg();
    await waitFor(() => expect(screen.getByTestId('price-gap-source')).toBeTruthy());
    expect(screen.getByText('From Trendyol')).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId('price-gap-plan-tag')).toBeNull();
  });

  it('trial and Growth (Stripe): segment + PlanTag "Pro"', async () => {
    entitlement = F.trial();
    seg();
    await waitFor(() => expect(screen.getByTestId('price-gap-plan-tag')).toBeTruthy());
    cleanup();
    entitlement = F.growth();
    seg();
    await waitFor(() => expect(screen.getByTestId('price-gap-plan-tag').textContent).toBe('Pro'));
  });

  it('shopify_free: not rendered', async () => {
    entitlement = F.shopify();
    const view = seg();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/billing/entitlement'))).toBe(true));
    await act(async () => {});
    expect(screen.queryByTestId('price-gap-source')).toBeNull();
    expect(view.container.textContent).not.toMatch(/Pro\b/);
  });
});

describe('PriceGap region gate', () => {
  it('Growth: locked state ("Price gap is part of Pro" + See plans), no data request', async () => {
    entitlement = F.growth();
    renderUi(<PriceGap />);
    const locked = await screen.findByTestId('feature-locked-arbitrage');
    expect(locked.textContent).toContain('Price gap is part of Pro');
    expect(screen.getByTestId('action-see-plans').getAttribute('href')).toBe('/fiyatlandirma?plan=pro&from=arbitrage');
    expect(gapCalls()).toHaveLength(0);
  });

  it('shopify_free by URL: neutral locked, no Pro / pricing / currency', async () => {
    entitlement = F.shopify();
    renderUi(<PriceGap />);
    await screen.findByTestId('feature-locked-arbitrage');
    const html = document.body.innerHTML;
    expect(html).toContain("This isn't included in your plan");
    expect(html).not.toMatch(/Pro\b/);
    expect(html).not.toContain('/fiyatlandirma');
    expect(html).not.toMatch(/[₺$]/);
    expect(gapCalls()).toHaveLength(0);
  });

  it('server 402 featureLocked after load swaps the region to the locked state', async () => {
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-table');
    act(() => { useFeatureLockStore.getState().markLocked({ feature: 'arbitrage', at: Date.now() }); });
    expect(await screen.findByTestId('feature-locked-arbitrage')).toBeTruthy();
  });
});

describe('PriceGap table (Pro)', () => {
  it.each(['en', 'tr'] as const)('rows with measured medians (n), estimated landed cost + margin, low confidence collapsed (%s)', async (locale) => {
    const view = renderUi(<PriceGap />, locale);
    await screen.findByTestId('price-gap-table');
    expect(gapCalls()[0][0]).toBe('/api/research/price-gap?from=category');
    expect((gapCalls()[0][1] as RequestInit).headers).toMatchObject({ 'x-kx-limit-ui': 'inline' });
    expect(screen.getByText('El yapımı bakır cezve')).toBeTruthy();
    expect(screen.queryByText('Peştemal')).toBeNull();
    const toggle = screen.getByTestId('price-gap-toggle-low');
    expect(toggle.textContent).toBe(locale === 'en' ? 'Show 1 low-confidence matches' : 'Düşük güvenli 1 eşleşmeyi göster');
    expect(screen.getByTestId('gap-ebay-1').textContent).toContain('47');
    expect(screen.getByTestId('gap-landed-1').getAttribute('data-kind')).toBe('estimate');
    expect(screen.getByTestId('gap-landed-1').textContent).toMatch(/^~/);
    expect(screen.getByTestId('gap-margin-1').textContent).toMatch(/^~.*·/);
    expect(screen.getByTestId('price-gap-ship').textContent).toContain(locale === 'en' ? '12 labels' : '12 etiket');
    expect(screen.getByTestId('price-gap-unmatched')).toBeTruthy();
    expect(view.container.textContent ?? '').not.toMatch(/\bavg\b|average|ortalama/i);

    fireEvent.click(toggle);
    expect(await screen.findByText('Peştemal')).toBeTruthy();
    // thin eBay sample: no median, no margin
    expect(screen.getByTestId('gap-ebay-2').getAttribute('data-guarded')).toBe('true');
    expect(screen.getByTestId('gap-margin-2').getAttribute('data-guarded')).toBe('true');
  });

  it('no own label costs: margin hidden until the seller types a shipping cost (kind "You entered")', async () => {
    body = gapBody({ shipping: [] });
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-table');
    expect(screen.getByTestId('price-gap-ship-none')).toBeTruthy();
    expect(screen.getByTestId('gap-margin-1').getAttribute('data-guarded')).toBe('true');
    const input = screen.getByTestId('price-gap-own-ship').querySelector('input') ?? screen.getByLabelText('Your shipping cost');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByTestId('gap-margin-1').getAttribute('data-guarded')).toBeNull());
  });

  it('no FX rate: landed cost and margin hidden with the reason, FX line says so', async () => {
    body = gapBody({ fx: { usdPerTry: null, source: 'exchangerate-api.com', fetchedAt: '2026-10-15T09:00:00.000Z' } });
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-table');
    expect(screen.getByTestId('price-gap-fx').textContent).toContain('No TRY → USD rate today');
    expect(screen.getByTestId('gap-landed-1').getAttribute('aria-label')).toBe('No TRY → USD rate today');
  });

  it('row panel: MarginBox with cost → USD, shipping, fees, margin; eBay matches with "(all time)"', async () => {
    router.query = { source: 'trendyol', open: '1' };
    renderUi(<PriceGap />);
    const panel = await screen.findByTestId('price-gap-marginbox');
    expect(panel.textContent).toContain('Product cost');
    expect(panel.textContent).toContain('₺640');
    expect(panel.textContent).toContain('$14.20');
    expect(screen.getByTestId('price-gap-panel-margin').textContent).toMatch(/^~/);
    expect(screen.getByText(/12 sold \(all time\)/)).toBeTruthy();
    expect(screen.getByText('Not checked on Etsy yet')).toBeTruthy();
  });

  it('"List on eBay" writes the session prefill (English keywords, median price) and opens the creator; no writes', async () => {
    router.query = { source: 'trendyol', open: '1' };
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-marginbox');
    const btn = screen.getAllByText('List on eBay').find((el) => el.closest('button, a'))!;
    fireEvent.click(btn.closest('button, a') as HTMLElement);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/app/ebay-listings?prefill=session'));
    const prefill = JSON.parse(window.sessionStorage.getItem(LISTING_PREFILL_KEY) ?? '{}');
    expect(prefill).toMatchObject({ v: 1, target: 'ebay', source: 'arbitrage', price: 47, currency: 'USD' });
    expect(prefill.title).toBeUndefined();
    expect(prefill.keywords).toContain('copper');
    expect(writes()).toHaveLength(0);
  });

  it('category source: other sellers\' photos never become listing images (reference only)', async () => {
    router.query = { source: 'trendyol', open: '1' };
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-marginbox');
    const btn = screen.getAllByText('List on eBay').find((el) => el.closest('button, a'))!;
    fireEvent.click(btn.closest('button, a') as HTMLElement);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const prefill = JSON.parse(window.sessionStorage.getItem(LISTING_PREFILL_KEY) ?? '{}');
    expect(prefill.imageUrls ?? []).toEqual([]);
    expect(prefill.research.referenceImageUrls).toEqual(['https://cdn.dsmcdn.com/1.jpg']);
  });

  it('Etsy column: a thin Etsy sample says "Etsy listings", not "eBay matches"', async () => {
    body = gapBody({ rows: [gapRow({ etsy: { ...summarizeAmounts([20, 30], 'USD'), fetchedAt: '2026-10-13T10:00:00.000Z' } })] });
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-table');
    expect(screen.getByLabelText('Not enough Etsy listings (2 of 5)')).toBeTruthy();
  });

  it('default-weight labels are reported separately; carrier change clears the band', async () => {
    body = gapBody({
      shipping: [
        { carrier: 'fedex', band: '0.5', n: 8, medianUsd: 12, p25Usd: 11, p75Usd: 13, quality: 'small' },
        { carrier: 'ups', band: '2', n: 6, medianUsd: 30, p25Usd: 28, p75Usd: 32, quality: 'small' },
      ],
      defaultWeightKg: null,
      shippingExcludedDefaultWeight: 4,
    });
    router.query = { source: 'trendyol', carrier: 'ups' };
    renderUi(<PriceGap />);
    await screen.findByTestId('price-gap-table');
    expect(screen.getByTestId('price-gap-ship-default-weight').textContent).toContain('4 labels left out');
    expect(screen.getByTestId('price-gap-ship').textContent).toContain('$30');
  });

  it('link: a product not in the index shows one message (no "category" empty text)', async () => {
    body = gapBody({ from: 'link', rows: [] });
    body.errors = [{ section: 'source', key: 'research.gap.error.notIndexed' }];
    router.query = { source: 'trendyol', from: 'link', url: '123456' };
    renderUi(<PriceGap />);
    expect((await screen.findByTestId('price-gap-empty-rows')).textContent).toContain("This product isn't in the Trendyol index yet");
    expect(screen.queryByText('No eBay matches in this category yet')).toBeNull();
    expect(screen.getAllByText("This product isn't in the Trendyol index yet")).toHaveLength(1);
  });

  it('link source without a valid link: first-use state and no request; a bad link is marked invalid', async () => {
    router.query = { source: 'trendyol', from: 'link' };
    renderUi(<PriceGap />);
    expect(await screen.findByTestId('price-gap-empty-link')).toBeTruthy();
    const input = screen.getByTestId('price-gap-link').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com/x' } });
    fireEvent.click(screen.getByTestId('price-gap-link-submit'));
    await act(async () => {});
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(gapCalls()).toHaveLength(0);
  });

  it('priceGapKey', () => {
    expect(priceGapKey({ from: 'category', cat: 'a' })).toBe('/api/research/price-gap?from=category&cat=a');
    expect(priceGapKey({ from: 'mine', cat: 'a' })).toBe('/api/research/price-gap?from=mine');
    expect(priceGapKey({ from: 'link', url: 'nope' })).toBeNull();
    expect(priceGapKey({ from: 'link', url: 'https://www.trendyol.com/a/b-p-123456' })).toBe('/api/research/price-gap?from=link&url=123456');
  });
});

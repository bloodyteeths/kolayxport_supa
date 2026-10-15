// @vitest-environment jsdom
// research R3-B render tests (research.md §8, §16): table with Measured / guarded numbers, quota caption + "Compare
// plans" only with stripeUpsell, quota-full disabled primary, empty state, "Watch a shop" POST, `?add=` prefill, the
// panel (chart gaps, Draft a similar listing without their title, alerts PATCH), stop watching, an unserved
// marketplace, and the DoD spy: nothing writes to a marketplace (no /api/clawd, no etsy-drafts).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { LISTING_PREFILL_KEY } from '@/components/etsy/research/shared/listingPrefill';
import { setViewport } from '../../ds/m1e-helpers';
import { SHOPS_EN, SHOPS_TR } from './messages';
import { rawRow } from './fixtures';

const router = {
  pathname: '/app/research/shops',
  asPath: '/app/research/shops',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (url: { query?: Record<string, string | string[]> } | string) => {
    if (typeof url === 'object' && url.query) router.query = url.query;
    return true;
  }),
  push: vi.fn(async (url: { query?: Record<string, string | string[]> } | string) => {
    if (typeof url === 'object' && url.query) router.query = url.query;
    return true;
  }),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('react-apexcharts', () => ({ default: () => <div data-testid="apex" /> }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ has: (p: string) => p === 'etsy', get: () => undefined, anyMarketplace: true, connections: {} }),
}));
const ent = { stripeUpsell: false };
vi.mock('@/lib/billing/useEntitlement', () => ({ useEntitlement: () => ({ data: { stripeUpsell: ent.stripeUpsell, features: {} } }) }));
const toastSuccess = vi.fn();
vi.mock('@/components/ds/feedback/toast', async (orig) => {
  const actual = await orig<typeof import('@/components/ds/feedback/toast')>();
  return { ...actual, useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }) };
});

import { ShopTracker } from '@/components/domain/research/shops/ShopTracker';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, SHOPS_EN as Obj), tr: deepMerge(tr as Obj, SHOPS_TR as Obj) };
const NOW = new Date('2026-10-15T12:00:00Z');

const SOURCE = { source: 'research.shops.col.shop', fetchedAt: '2026-10-15T06:00:00Z', kind: 'measured' };
let listBody: unknown;
let detailBody: unknown;
let postResponse: (() => Response) | null = null;
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

function listOf(rows: unknown[], quota: Record<string, unknown> = { used: rows.length, limit: 10, plan: 'starter', stripeUpsell: true }) {
  return { data: { available: true, alertsAvailable: true, rows, quota, readingTimeUtc: '06:00' }, source: SOURCE };
}

function renderTracker(locale: 'en' | 'tr' = 'en') {
  const navigate = vi.fn();
  const cache = new Map();
  const tree = () => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ShopTracker navigate={navigate} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
  const view = render(tree());
  const sync = async () => {
    await act(async () => {});
    view.rerender(tree());
  };
  return { ...view, navigate, sync };
}

beforeEach(() => {
  __resetUrlStateForTests();
  __resetShortcutsForTests();
  setViewport('desktop');
  router.query = { mkt: 'etsy' };
  router.replace.mockClear();
  router.push.mockClear();
  ent.stripeUpsell = false;
  toastSuccess.mockClear();
  calls = [];
  postResponse = null;
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  listBody = listOf([
    rawRow(),
    rawRow({ id: 'w2', label: 'NewShop', refId: '999', snapshots: { count: 1, first: '2026-10-15', last: '2026-10-15' } }),
    rawRow({ id: 'e1', type: 'ebaySeller', marketplace: 'ebay', label: 'engrave_us', refId: 'engrave_us' }),
  ]);
  detailBody = {
    data: {
      watch: rawRow(),
      tagGapAvailable: true,
      shop: { since: '2021-03-04T00:00:00Z', rating: 4.9, reviewCount: 8100 },
      sales: [
        { date: '2026-10-12', value: 10 },
        { date: '2026-10-13', value: 12 },
        { date: '2026-10-14', value: null, dropped: true },
        { date: '2026-10-15', value: 15 },
      ],
      newListings: [{ id: 'n1', title: 'Personalized Recipe Box, Wooden Kitchen Gift', tags: ['recipe box'], url: 'https://www.etsy.com/listing/1' }],
      fastest: [{ id: 'f1', title: 'Recipe Card Box', favoritesDelta7d: { value: 142, kind: 'measured', guard: { ok: true } }, shareOfSales: { value: 0.31, kind: 'estimate', guard: { ok: true } } }],
      tagGap: [{ tag: 'kitchen keepsake', count: 5 }],
    },
    source: SOURCE,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        body = init?.body;
      }
      calls.push({ url, method, body });
      if (url === '/api/research/watches' && method === 'GET') return new Response(JSON.stringify(listBody), { status: 200 });
      if (url === '/api/research/watches' && method === 'POST') {
        if (postResponse) return postResponse();
        const b = body as { refId: string; label: string };
        return new Response(JSON.stringify({ data: { watch: rawRow({ id: 'w9', label: b.label, refId: '777', snapshots: { count: 0 } }), quota: { used: 4, limit: 10 }, created: true } }), { status: 201 });
      }
      if (url.startsWith('/api/research/watches/') && method === 'GET') return new Response(JSON.stringify(detailBody), { status: 200 });
      if (url.startsWith('/api/research/watches/') && method === 'PATCH') {
        const b = body as { alertRules: unknown };
        return new Response(JSON.stringify({ data: { watch: rawRow({ alertRules: b.alertRules }) } }), { status: 200 });
      }
      if (url.startsWith('/api/research/watches/') && method === 'DELETE') return new Response(null, { status: 204 });
      return new Response('{}', { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function noMarketplaceWrites() {
  for (const c of calls) {
    expect(c.url).not.toMatch(/\/api\/clawd\//);
    expect(c.url).not.toMatch(/etsy-drafts/);
    expect(c.url).not.toMatch(/\/sync\b/);
  }
}

describe('Shop tracker table', () => {
  it('shows the marketplace rows with Measured numbers and the first-reading guard', async () => {
    renderTracker();
    const table = await screen.findByTestId('shops-table');
    await within(table).findByText('WoodAndWords');
    expect(within(table).getByText('NewShop')).toBeTruthy();
    // eBay row is filtered out on the Etsy view
    expect(within(table).queryByText('engrave_us')).toBeNull();
    expect(within(table).getByText('14.3')).toBeTruthy();
    expect(within(table).getByText(/▲ 22/)).toBeTruthy();
    const guarded = within(table).getAllByLabelText('First reading taken today. Daily sales appear tomorrow.');
    expect(guarded.length).toBeGreaterThan(0);
    expect(screen.getByTestId('shops-quota').textContent).toContain('Watching 3 of 10 shops on your plan');
    expect(screen.queryByTestId('shops-compare-plans')).toBeNull();
    noMarketplaceWrites();
  });

  it('mobile cards: "14.3 sales/day · ▲ 22%" and "412 active · +9 new"', async () => {
    setViewport('mobile');
    renderTracker();
    await screen.findAllByText('WoodAndWords');
    expect(screen.getAllByText(/14\.3 sales\/day · ▲ 22/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('412 active · +9 new').length).toBeGreaterThan(0);
    expect(screen.getAllByText('First reading taken today. Daily sales appear tomorrow.').length).toBeGreaterThan(0);
  });

  it('"Compare plans" only when both the quota and the entitlement allow a Stripe upsell', async () => {
    ent.stripeUpsell = true;
    const { unmount } = renderTracker();
    await screen.findByText('WoodAndWords');
    expect(screen.getByTestId('shops-compare-plans').getAttribute('href')).toContain('from=billing');
    unmount();
    // shopify_free: the server says no upsell → never rendered, even if the entitlement says otherwise
    listBody = listOf([rawRow()], { used: 1, limit: 10, plan: 'shopify_free', stripeUpsell: false });
    renderTracker();
    await screen.findByText('WoodAndWords');
    expect(screen.queryByTestId('shops-compare-plans')).toBeNull();
  });

  it('before the backend migration ships (`available: false`) "Watch a shop" is disabled and says why', async () => {
    listBody = { ...listOf([]), data: { ...listOf([]).data, available: false }, errors: [{ section: 'watches', key: 'research.shops.unavailable' }] };
    renderTracker();
    expect(await screen.findByTestId('shops-unavailable-banner')).toBeTruthy();
    const btn = screen.getAllByRole('button', { name: /Watch a shop/ })[0];
    expect(btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('at the quota the primary is disabled with the reason', async () => {
    listBody = listOf([rawRow()], { used: 10, limit: 10, plan: 'starter', stripeUpsell: false });
    renderTracker();
    await screen.findByText('WoodAndWords');
    expect(screen.getByTestId('shops-quota').textContent).toContain("You're watching 10 of 10 shops. Remove one to add another");
    const btn = screen.getAllByRole('button', { name: /Watch a shop/ })[0];
    expect(btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('empty state for the marketplace', async () => {
    listBody = listOf([]);
    renderTracker();
    expect(await screen.findByTestId('shops-empty')).toBeTruthy();
    expect(screen.getByText('Watch a competitor to see their daily sales, new listings and price changes')).toBeTruthy();
  });

  it('an unserved marketplace says so (never an error)', async () => {
    router.query = { mkt: 'amazon' };
    renderTracker();
    expect(await screen.findByTestId('shops-unavailable')).toBeTruthy();
  });
});

describe('Watch a shop', () => {
  it('POSTs a watch row with the detected marketplace and default alerts', async () => {
    const { sync } = renderTracker();
    await screen.findByText('WoodAndWords');
    fireEvent.click(screen.getAllByRole('button', { name: /Watch a shop/ })[0]);
    const modal = await screen.findByTestId('shops-watch-modal');
    const input = within(modal).getByTestId('shops-watch-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://www.etsy.com/shop/MemoryCrafts' } });
    expect(within(modal).getByText('Etsy shop · MemoryCrafts')).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Watch' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/research/watches');
    expect(post.body).toEqual({
      input: 'MemoryCrafts',
      type: 'etsyShop',
      marketplace: 'etsy',
      refId: 'MemoryCrafts',
      label: 'MemoryCrafts',
      alertRules: { newListing: true, priceDropPct: 10, salesSpikeX: null },
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await sync();
    noMarketplaceWrites();
  });

  it('`?add=` opens the modal prefilled; a watched shop offers Open instead', async () => {
    router.query = { mkt: 'etsy', add: 'WoodAndWords' };
    renderTracker();
    const modal = await screen.findByTestId('shops-watch-modal');
    expect((within(modal).getByTestId('shops-watch-input').querySelector('input') as HTMLInputElement).value).toBe('WoodAndWords');
    expect(within(modal).getByText("You're already watching WoodAndWords")).toBeTruthy();
    expect(within(modal).getByRole('button', { name: 'Open' })).toBeTruthy();
  });
});

describe('Watch a shop: quota / availability apply to Etsy only (review R3-B)', () => {
  const full = { used: 10, limit: 10, plan: 'starter', stripeUpsell: false };

  it('eBay hub at the Etsy quota: "Watch a shop" stays enabled and an eBay seller can be added', async () => {
    router.query = { mkt: 'ebay' };
    listBody = { ...listOf([rawRow({ id: 'e1', type: 'ebaySeller', marketplace: 'ebay', label: 'engrave_us', refId: 'engrave_us' })], full), data: { ...listOf([], full).data, available: false, rows: [rawRow({ id: 'e1', type: 'ebaySeller', marketplace: 'ebay', label: 'engrave_us', refId: 'engrave_us' })] } };
    renderTracker();
    await screen.findByText('engrave_us');
    expect(screen.queryByTestId('shops-quota')).toBeNull();
    expect(screen.queryByTestId('shops-unavailable-banner')).toBeNull();
    const btn = screen.getAllByRole('button', { name: /Watch a shop/ })[0];
    expect(btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true').toBe(false);
    fireEvent.click(btn);
    const modal = await screen.findByTestId('shops-watch-modal');
    const input = within(modal).getByTestId('shops-watch-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ebay.com/usr/wood_seller' } });
    expect(within(modal).queryByTestId('shops-watch-quota')).toBeNull();
    fireEvent.click(within(modal).getByRole('button', { name: 'Watch' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  });

  it('at the quota, an already-watched shop can still be opened', async () => {
    router.query = { mkt: 'etsy', add: 'WoodAndWords' };
    listBody = listOf([rawRow()], full);
    renderTracker();
    const modal = await screen.findByTestId('shops-watch-modal');
    await within(modal).findByText("You're already watching WoodAndWords");
    expect(within(modal).queryByTestId('shops-watch-quota')).toBeNull();
    const open = within(modal).getByRole('button', { name: 'Open' });
    expect(open.hasAttribute('disabled') || open.getAttribute('aria-disabled') === 'true').toBe(false);
    fireEvent.click(open);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('a skipped first reading never says "First reading today"', async () => {
    postResponse = () =>
      new Response(JSON.stringify({ data: { watch: rawRow({ id: 'w9', label: 'MemoryCrafts', snapshots: { count: 0 } }), quota: { used: 4, limit: 10 }, created: true }, errors: [{ section: 'reading', key: 'research.error.budget' }] }), { status: 201 });
    renderTracker();
    await screen.findByText('WoodAndWords');
    fireEvent.click(screen.getAllByRole('button', { name: /Watch a shop/ })[0]);
    const modal = await screen.findByTestId('shops-watch-modal');
    const input = within(modal).getByTestId('shops-watch-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'MemoryCrafts' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Watch' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Watching MemoryCrafts · First reading at the next daily check'));
  });

  it('a 409 quota revalidates the page quota', async () => {
    postResponse = () => new Response(JSON.stringify({ error: 'quota_exceeded', key: 'research.shops.quotaFull', used: 10, limit: 10 }), { status: 409 });
    renderTracker();
    await screen.findByText('WoodAndWords');
    fireEvent.click(screen.getAllByRole('button', { name: /Watch a shop/ })[0]);
    const modal = await screen.findByTestId('shops-watch-modal');
    const input = within(modal).getByTestId('shops-watch-input').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'OtherShop' } });
    const before = calls.filter((c) => c.method === 'GET' && c.url === '/api/research/watches').length;
    fireEvent.click(within(modal).getByRole('button', { name: 'Watch' }));
    await within(modal).findByText("Your plan's shop limit is reached. Remove a shop to add another");
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/research/watches').length).toBeGreaterThan(before));
  });
});

describe('Shop panel', () => {
  it('with the editor flag off (NEXT_PUBLIC_UI_V2=none) "Draft similar" opens the legacy listings creator', async () => {
    vi.stubEnv('NEXT_PUBLIC_UI_V2', 'none');
    try {
      router.query = { mkt: 'etsy', open: 'w1' };
      const { navigate } = renderTracker();
      const panel = await screen.findByTestId('shop-panel');
      await within(panel).findByText('Personalized Recipe Box, Wooden Kitchen Gift');
      fireEvent.click(within(panel).getByTestId('shop-draft-similar'));
      expect(navigate).toHaveBeenCalledWith('/app/etsy-listings?prefill=session', undefined);
      noMarketplaceWrites();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows the detail, drafts a similar listing without their title, saves alerts', async () => {
    router.query = { mkt: 'etsy', open: 'w1' };
    const { navigate } = renderTracker();
    const panel = await screen.findByTestId('shop-panel');
    await within(panel).findByText('Personalized Recipe Box, Wooden Kitchen Gift');
    expect(within(panel).getByText(/Since 2021/)).toBeTruthy();
    expect(within(panel).getByText('1 daily reading left out (counter reset or unusual jump)')).toBeTruthy();
    expect(within(panel).getByText('+142 favorites')).toBeTruthy();
    expect(within(panel).getByText('kitchen keepsake')).toBeTruthy();

    fireEvent.click(within(panel).getByTestId('shop-draft-similar'));
    // editor-etsy is on by default (M10) → the new full-page creator.
    expect(navigate).toHaveBeenCalledWith('/app/etsy-listings/new?prefill=session', undefined);
    const prefill = JSON.parse(window.sessionStorage.getItem(LISTING_PREFILL_KEY) ?? '{}');
    expect(prefill.title).toBeUndefined();
    expect(prefill.tags).toEqual(['recipe box']);

    fireEvent.click(within(panel).getByTestId('shop-research-idea'));
    expect(navigate).toHaveBeenLastCalledWith('/app/research/products?mkt=etsy&q=personalized+recipe+box', undefined);

    const spike = within(panel).getByTestId('shop-alert-salesSpike').querySelector('input') as HTMLInputElement;
    fireEvent.click(spike);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/research/watches/w1');
    expect(patch.body).toEqual({ alertRules: { newListing: true, priceDropPct: 10, salesSpikeX: 2 } });
    noMarketplaceWrites();
  });

  it('stop watching asks first, then DELETEs', async () => {
    renderTracker();
    const table = await screen.findByTestId('shops-table');
    await within(table).findByText('WoodAndWords');
    const row = within(table).getByText('WoodAndWords').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /more|actions|⋯/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop watching' }));
    const confirm = await screen.findByTestId('shops-remove-confirm');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop watching' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/research/watches/w1')).toBe(true));
  });
});

// @vitest-environment jsdom
// research R1-D render tests (research.md §7, §16): the doctor table (Metric kinds, rank, biggest issue, source
// caption), states (connect, unavailable marketplace, first use, budget banner), and the panel flow
// "Set price… → Use this price → Stage 1 fix" which STAGES one draft (POST /api/etsy-drafts) and never sends:
// no `/sync`, no `bulk-sync`, no POST to `/api/clawd/etsy` (DoD: spy on fetch).
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
import { toastController } from '@/components/ds/feedback/toast';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { setViewport } from '../../ds/m1e-helpers';
import { DOCTOR_EN, DOCTOR_TR } from './messages';
import { NOW, doctorRow, listResponse, peersResponse } from './fixtures';

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/research/listings',
  asPath: '/app/research/listings',
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
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const conn: Record<string, boolean | undefined> = { etsy: true, ebay: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ has: (p: string) => conn[p], get: () => undefined, anyMarketplace: true, connections: {} }),
}));
vi.mock('@/lib/billing/useEntitlement', () => ({ useEntitlement: () => ({ data: { features: { bulkPhotoStudio: false } } }) }));

import { ListingDoctor } from '@/components/domain/research/listings/ListingDoctor';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, DOCTOR_EN as Obj), tr: deepMerge(tr as Obj, DOCTOR_TR as Obj) };

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let listBody: unknown = listResponse([doctorRow()]);
let peersBody: unknown = peersResponse();
let peersStatus = 200;
let probeBody: unknown = null;

function renderDoctor(props: Partial<React.ComponentProps<typeof ListingDoctor>> = {}, locale: 'en' | 'tr' = 'en') {
  const navigate = vi.fn();
  const cache = new Map();
  const tree = () => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ListingDoctor mkt="etsy" navigate={navigate} {...props} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>
  );
  const view = render(tree());
  /** The router mock has no state: re-render after a URL write (useUrlState reads `router.query`). */
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
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  conn.etsy = true;
  conn.ebay = false;
  calls = [];
  listBody = listResponse([doctorRow(), doctorRow({ issues: 2 }, { id: '222', title: 'Wooden Ring Box', health: { score: 61, used: 10, total: 12, fails: ['photos_count'] } })]);
  peersBody = peersResponse();
  peersStatus = 200;
  probeBody = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown = undefined;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      } catch {
        body = init?.body;
      }
      calls.push({ url, method, body });
      if (url.startsWith('/api/research/listings/') && url.includes('/peers')) {
        return peersStatus === 200 ? new Response(JSON.stringify(peersBody), { status: 200 }) : new Response('{}', { status: peersStatus });
      }
      if (probeBody && url.startsWith('/api/research/listings?') && url.includes('q=999')) return new Response(JSON.stringify(probeBody), { status: 200 });
      if (url.startsWith('/api/research/listings')) return new Response(JSON.stringify(listBody), { status: 200 });
      if (url.startsWith('/api/etsy-drafts') && method === 'POST') {
        return new Response(JSON.stringify({ draft: { id: 'd1', status: 'draft' } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const noSend = () => {
  expect(calls.some((c) => /\/sync\b|bulk-sync/.test(c.url))).toBe(false);
  expect(calls.some((c) => c.url.startsWith('/api/clawd/etsy') && c.method !== 'GET')).toBe(false);
};

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────
describe('Listing doctor table', () => {
  it('renders measured metrics, the rank, the biggest issue and the source caption', async () => {
    renderDoctor();
    const table = await screen.findByTestId('doctor-table');
    await within(table).findAllByText('Baby Name Puzzle, Personalized Wooden Toy');
    expect(calls[0].url).toBe('/api/research/listings?mkt=etsy');
    expect(within(table).getAllByText('412').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('#212').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Too few photos').length).toBeGreaterThan(0);
    expect(table.querySelector('[data-kind="measured"]')).toBeTruthy();
    expect(table.textContent).toMatch(/Views and sales: Etsy daily stats \+ your orders · last 30 days · updated/);
    noSend();
  });

  it('without a stats timestamp the API SourceNote sits under the table', async () => {
    listBody = listResponse([doctorRow()], { statsUpdatedAt: null });
    renderDoctor();
    expect((await screen.findByTestId('doctor-source')).textContent).toMatch(/Measured/);
  });

  it('a failed guard renders "—" with the reason (never a number)', async () => {
    listBody = listResponse([doctorRow({ views30d: { value: null, kind: 'measured', guard: { ok: false, reasonKey: 'research.doc.collecting', reasonParams: { date: '1 Oct' } } } })]);
    renderDoctor();
    const table = await screen.findByTestId('doctor-table');
    await within(table).findAllByText('Baby Name Puzzle, Personalized Wooden Toy');
    const guarded = table.querySelector('[data-guarded="true"]');
    expect(guarded?.getAttribute('aria-label')).toBe('Collecting daily stats since 1 Oct');
  });

  it('sends sort, issue and health filters as API params', async () => {
    router.query = { sort: 'views', 'f.issue': 'video', 'f.health': 'lt50' };
    renderDoctor();
    await screen.findByTestId('doctor-table');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/research/listings?mkt=etsy&sort=views&issue=video&health=lt50')).toBe(true));
  });

  it('Etsy budget → info Banner, results stay', async () => {
    listBody = listResponse([doctorRow()], {}, [{ section: 'peers', key: 'research.error.budget' }]);
    renderDoctor();
    expect(await screen.findByTestId('doctor-budget-banner')).toBeTruthy();
    expect(screen.getByTestId('doctor-table')).toBeTruthy();
  });

  it('every listing at 75+ → done state above the table', async () => {
    listBody = listResponse([doctorRow({ issues: 0, biggestIssue: undefined }, { health: { score: 88, used: 12, total: 12, fails: [] } })]);
    renderDoctor();
    expect(await screen.findByText('Nothing urgent: every listing scores 75 or more')).toBeTruthy();
  });
});

describe('Listing doctor states', () => {
  it('not connected → ConnectState, no list request', async () => {
    conn.etsy = false;
    renderDoctor();
    expect(await screen.findByTestId('doctor-connect')).toBeTruthy();
    expect(calls.filter((c) => c.url.startsWith('/api/research'))).toHaveLength(0);
  });

  it('Amazon / Trendyol → "works with Etsy and eBay" with a switch to Etsy', async () => {
    const onMktChange = vi.fn();
    renderDoctor({ mkt: 'amazon', onMktChange });
    expect(screen.getByTestId('doctor-unavailable')).toBeTruthy();
    fireEvent.click(screen.getByText('Use Etsy'));
    expect(onMktChange).toHaveBeenCalledWith('etsy');
  });

  it('connected, never pulled → first-use "Bring in your Etsy listings first"', async () => {
    listBody = listResponse([], { total: 0, store: { id: 'S1', name: 'Shop', currency: 'USD', lastPulledAt: null } });
    renderDoctor();
    expect(await screen.findByText('Bring in your Etsy listings first')).toBeTruthy();
  });

  it('mobile 390: cards with "412 views · 0 sales (30 d)" and the biggest issue as meta', async () => {
    setViewport('mobile');
    renderDoctor();
    const table = await screen.findByTestId('doctor-table');
    await waitFor(() => expect(table.textContent).toMatch(/412 views · 0 sales \(30 d\)/));
    expect(table.textContent).toMatch(/Too few photos/);
  });

  it('renders in Turkish', async () => {
    renderDoctor({}, 'tr');
    expect(await screen.findByText('En büyük sorun')).toBeTruthy();
  });
});

describe('Doctor panel: stage, never send', () => {
  it('Set price… → Use this price → Stage 1 fix writes ONE draft with the peer median', async () => {
    const { sync } = renderDoctor();
    const table = await screen.findByTestId('doctor-table');
    const titleCell = (await within(table).findAllByText('Baby Name Puzzle, Personalized Wooden Toy'))[0];
    fireEvent.click(titleCell);
    await sync();
    const panel = await screen.findByTestId('doctor-panel');
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/research/listings/1490012234/peers'))).toBe(true));
    await within(panel).findByText('Compared with peers');

    // Price fix of the peer check (labels come from the score panel's fix buttons).
    const setPrice = await within(panel).findByRole('button', { name: 'Set price…' });
    fireEvent.click(setPrice);
    const editor = await within(panel).findByTestId('doctor-price-editor');
    const input = within(editor).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toMatch(/42/);
    fireEvent.click(within(editor).getByTestId('doctor-price-use'));
    const staged = await within(panel).findByTestId('doctor-staged-here');
    expect(staged.textContent).toMatch(/Price \$58\.00 → \$42\.00/);

    const stage = screen.getByRole('button', { name: /Stage 1 fix/ });
    await act(async () => {
      fireEvent.click(stage);
    });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/etsy-drafts' && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.url === '/api/etsy-drafts' && c.method === 'POST');
    expect(post?.body).toMatchObject({ shop_id: 'S1', listing_id: '1490012234', fields: { price: 42 } });
    expect(calls.filter((c) => c.url === '/api/etsy-drafts' && c.method === 'POST')).toHaveLength(1);
    noSend();
  });

  it('variation listing: the price fix opens the editor instead of staging', async () => {
    listBody = listResponse([doctorRow({}, { editable: { price: false, qty: false, reason: 'variations' } })]);
    const { navigate, sync } = renderDoctor();
    const table = await screen.findByTestId('doctor-table');
    fireEvent.click((await within(table).findAllByText('Baby Name Puzzle, Personalized Wooden Toy'))[0]);
    await sync();
    const panel = await screen.findByTestId('doctor-panel');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Set price…' }));
    expect(navigate).toHaveBeenCalledWith('/app/etsy-listings/1490012234?shop=S1#price', undefined);
    expect(calls.some((c) => c.url.startsWith('/api/etsy-drafts'))).toBe(false);
  });
});

describe('Deep link ?open=<id> (research §4)', () => {
  it('a listing that is not on the loaded page is looked up by id and opens', async () => {
    router.query = { open: '999' };
    probeBody = listResponse([doctorRow({}, { id: '999', title: 'Engraved Keepsake Box Deep Link' })]);
    renderDoctor();
    const panel = await screen.findByTestId('doctor-panel');
    await within(panel).findAllByText('Engraved Keepsake Box Deep Link');
    expect(calls.some((c) => c.url.startsWith('/api/research/listings?') && c.url.includes('q=999'))).toBe(true);
  });

  it('an unknown id drops the dead ?open= from the URL', async () => {
    router.query = { open: '999' };
    probeBody = listResponse([]);
    renderDoctor();
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=999'))).toBe(true));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(router.query.open).toBeUndefined();
    expect(screen.queryByTestId('doctor-panel')).toBeNull();
  });
});

describe('Bulk "Apply suggested prices"', () => {
  async function selectAll() {
    const table = await screen.findByTestId('doctor-table');
    await within(table).findAllByText('Wooden Ring Box');
    const boxes = within(table).getAllByRole('checkbox');
    fireEvent.click(boxes[0]);
    return screen.findByTestId('doctor-bulk-bar');
  }

  it('a 429 stops the run; nothing is staged and nothing is reported as "no change needed"', async () => {
    peersStatus = 429;
    const enqueue = vi.spyOn(toastController, 'enqueue');
    renderDoctor();
    const bar = await selectAll();
    await act(async () => {
      fireEvent.click(within(bar).getByRole('button', { name: 'Stage fixes' }));
    });
    await waitFor(() => expect(enqueue.mock.calls.some(([i]) => /not checked · Try again in a minute/.test(String(i.message)))).toBe(true));
    expect(enqueue.mock.calls.some(([i]) => i.message === 'No suggested price fits these listings')).toBe(false);
    // The run stopped at the 429: at most one in-flight read per worker, not one per listing beyond that.
    expect(calls.filter((c) => c.url.includes('/peers')).length).toBeLessThanOrEqual(3);
    enqueue.mockRestore();
    expect(calls.some((c) => c.url.startsWith('/api/etsy-drafts'))).toBe(false);
    noSend();
  });

  it('eBay: the bulk price action is disabled and reads no peers', async () => {
    conn.ebay = true;
    renderDoctor({ mkt: 'ebay' });
    const bar = await selectAll();
    const btn = within(bar).getByRole('button', { name: 'Stage fixes' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await act(async () => {});
    expect(calls.some((c) => c.url.includes('/peers'))).toBe(false);
  });
});

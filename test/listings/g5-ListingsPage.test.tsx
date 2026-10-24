// @vitest-environment jsdom
// listings G5 render tests (listings-grid §6–§8, §15): header primary "Send N changes", the send flow that never
// sends conflicts or queued deletes, inline price staging with validation, read-only variation cells, the failure
// banner, not-connected state, quick view from ?open=, and TR wording.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import type { ListingsStagingAdapter, OpenDraft } from '@/components/domain/listings/useStagedChanges';
import { setViewport } from '../ds/m1e-helpers';
import { G5_EN, G5_TR } from './g5-messages';
import { toastController } from '@/components/ds/feedback/toast';

// ── module mocks ────────────────────────────────────────────────────────────────────────────────────────
const router = {
  pathname: '/app/etsy-listings',
  asPath: '/app/etsy-listings',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (u: { query: Record<string, string | string[]> }) => {
    router.query = u.query;
    return true;
  }),
  push: vi.fn(async (u: { query?: Record<string, string | string[]> } | string) => {
    if (typeof u === 'object' && u.query) router.query = u.query;
    return true;
  }),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
const conn = { connected: true as boolean | undefined, needsReauth: false };
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: {},
    error: undefined,
    has: () => conn.connected,
    get: () => ({ connected: conn.connected, needsReauth: conn.needsReauth }),
    mutate: vi.fn(),
  }),
}));
vi.mock('@/components/etsy-history/CacheFreshnessChip', () => ({ default: () => <span data-testid="freshness-chip" /> }));
const toolProps: Record<string, { open: boolean }> = {};
for (const [name, file] of [
  ['FindReplacePanel', 'FindReplacePanel'],
  ['DuplicatesPanel', 'DuplicatesPanel'],
  ['CsvImportPanel', 'CsvImportPanel'],
  ['ExportCsvModal', 'ExportCsvModal'],
  ['ScheduledSendsPanel', 'ScheduledSendsPanel'],
] as const) {
  vi.doMock(`@/components/domain/listings/tools/${file}`, () => ({
    [name]: (p: { open: boolean }) => {
      toolProps[name] = p;
      return p.open ? <div data-testid={`tool-${name}`} /> : null;
    },
  }));
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────
const NOW = new Date('2026-10-15T12:00:00Z');
function row(over: Partial<ListingRow>): ListingRow {
  return {
    id: '1',
    title: 'Wooden Keepsake Box',
    metaLine: ['ID 1'],
    thumbUrl: null,
    price: { amount: 54, currency: 'USD' },
    qty: 12,
    editable: { price: true, qty: true },
    status: 'active',
    statusRaw: 'active',
    health: { score: 61, used: 9, total: 12, fails: [] },
    updatedAt: '2026-10-14T12:00:00Z',
    createdAt: null,
    extra: {},
    externalUrl: 'https://www.etsy.com/listing/1',
    sync: null,
    ...over,
  };
}
const draft = (over: Partial<NonNullable<ListingRow['sync']>>): NonNullable<ListingRow['sync']> => ({
  draftId: 'd1',
  status: 'pending',
  changedFields: ['price'],
  draft: { price: 49 },
  queuedDelete: false,
  scheduledSendAt: null,
  syncedAt: null,
  ...over,
});
const ROWS: ListingRow[] = [
  row({ id: '1', sync: draft({}) }),
  row({ id: '2', title: 'Name Necklace Gold', editable: { price: false, qty: false, reason: 'variations' }, price: { amount: 38, currency: 'USD', from: true } }),
  row({ id: '3', title: 'Old Christmas Ornament', status: 'inactive', sync: draft({ draftId: 'd3', changedFields: [], draft: {}, queuedDelete: true }) }),
  row({ id: '4', title: 'Baby Name Sign', sync: draft({ draftId: 'd4', status: 'conflict', draft: {} }) }),
];
let response: ListingsResponse;
function makeResponse(rows: ListingRow[] = ROWS): ListingsResponse {
  return {
    rows,
    total: rows.length,
    counts: { all: 312, status: { active: 248, sold_out: 4 }, sync: { pending: 2, syncing: 0, failed: 0, conflict: 1, queuedDeletes: 1 }, needsWork: 12, unscored: 0 },
    store: { id: 'S1', name: 'Belle Couture Gifts', currency: 'USD', lastPulledAt: '2026-10-15T11:50:00Z' },
    stores: [{ id: 'S1', name: 'Belle Couture Gifts' }],
  };
}

function makeAdapter(open: OpenDraft[] = []): ListingsStagingAdapter {
  return {
    stage: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    send: vi.fn(async (ids: string[]) => ({ sent: ids, failed: [], conflicts: [] })),
    schedule: vi.fn(async () => undefined),
    listOpen: vi.fn(async () => open),
    sendDeletion: vi.fn(async (id: string) => ({ sent: [id], failed: [], conflicts: [] })),
  };
}

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = { en: deepMerge(en as Obj, G5_EN as Obj), tr: deepMerge(tr as Obj, G5_TR as Obj) };

let ListingsPage: typeof import('@/components/domain/listings/ListingsPage').ListingsPage;

async function renderPage(opts: { locale?: 'en' | 'tr'; adapter?: ListingsStagingAdapter; marketplace?: 'etsy' | 'wix' } = {}) {
  ListingsPage ??= (await import('@/components/domain/listings/ListingsPage')).ListingsPage;
  const locale = opts.locale ?? 'en';
  const adapter = opts.adapter ?? makeAdapter();
  const utils = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ConfirmProvider>
            <ListingsPage marketplace={opts.marketplace ?? 'etsy'} now={NOW} stagingAdapter={adapter} />
          </ConfirmProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  await screen.findAllByText('Wooden Keepsake Box').catch(() => undefined);
  return { ...utils, adapter };
}

beforeEach(() => {
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  router.replace.mockClear();
  router.push.mockClear();
  conn.connected = true;
  conn.needsReauth = false;
  response = makeResponse();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = String(input);
      if (u.startsWith('/api/listings?')) return new Response(JSON.stringify(response), { status: 200 });
      if (u.startsWith('/api/clawd/etsy?action=get_shop_sections')) return new Response(JSON.stringify({ results: [{ shop_section_id: 7, title: 'Boxes' }] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ListingsPage (Etsy, desktop)', () => {
  it('renders the header with the count, the send primary and the failure banner', async () => {
    await renderPage();
    const header = screen.getByTestId('listings-header');
    expect(within(header).getByText('Etsy listings')).toBeTruthy();
    expect(within(header).getByRole('button', { name: /Send 3 changes to Etsy/ })).toBeTruthy();
    // The fixture's only unsent problem is 1 conflict: worded as a choice, not as the seller's error (3c, 24 Oct).
    expect(screen.getByTestId('listings-failure-banner').textContent).toContain('changed on Etsy after your edit. Choose which version to keep.');
    expect(screen.getByTestId('listings-failure-banner').textContent).not.toContain('Fix them');
    expect(screen.getByTestId('listings-sync-meta')).toBeTruthy();
    expect(screen.getByTestId('freshness-chip')).toBeTruthy();
    // No "Sync" wording anywhere (listings-grid §15).
    expect(document.body.textContent).not.toMatch(/\bSync\b/);
    // The default Etsy view asks the API for active listings.
    const calls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith('/api/listings?marketplace=etsy') && u.includes('status=active'))).toBe(true);
  });

  it('shows the draft value with the live value in the tooltip, and the queued-delete line', async () => {
    await renderPage();
    const table = screen.getByTestId('listings-table');
    expect(within(table).getByText('$49.00')).toBeTruthy();
    expect(within(table).getAllByText('$54.00').length).toBeGreaterThan(0); // other rows still show their live price
    expect(within(table).getByTestId('listing-will-delete').textContent).toBe('Will be deleted on send');
  });

  it('Send N sends only plain drafts after confirming what waits (conflict, deletion)', async () => {
    const adapter = makeAdapter([
      { draftId: 'd1', id: '1', status: 'pending', queuedDelete: false, createsListing: false },
      { draftId: 'd5', id: '5', status: 'sync_failed', queuedDelete: false, createsListing: false },
      { draftId: 'd3', id: '3', status: 'pending', queuedDelete: true, createsListing: false },
      { draftId: 'd4', id: '4', status: 'conflict', queuedDelete: false, createsListing: false },
      { draftId: 'd9', id: '-1', status: 'pending', queuedDelete: false, createsListing: true },
    ]);
    await renderPage({ adapter });
    fireEvent.click(within(screen.getByTestId('listings-header')).getByRole('button', { name: /Send 3 changes to Etsy/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Send 2 changes to Etsy?');
    expect(dialog.textContent).toContain('Waiting for you: 1 listing changed on Etsy · 1 deletion · 1 new listing (send it from the editor).');
    expect(adapter.send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send 2 changes to Etsy' }));
    await waitFor(() => expect(adapter.send).toHaveBeenCalledTimes(1));
    expect(adapter.send).toHaveBeenCalledWith(['d1', 'd5']);
    expect(adapter.sendDeletion).not.toHaveBeenCalled();
  });

  it('Send N with nothing sendable says what waits instead of doing nothing', async () => {
    const adapter = makeAdapter([{ draftId: 'd9', id: '-1', status: 'pending', queuedDelete: false, createsListing: true }]);
    await renderPage({ adapter });
    fireEvent.click(within(screen.getByTestId('listings-header')).getByRole('button', { name: /Send 3 changes to Etsy/ }));
    await waitFor(() => expect(toastController.visible()?.message).toBe('Nothing to send yet. Waiting for you: 1 new listing (send it from the editor).'));
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('stages an inline price edit and validates Etsy\'s minimum', async () => {
    response = makeResponse([row({ id: '7', title: 'Plain Listing' })]);
    const { adapter } = await renderPage();
    const cell = await screen.findByRole('button', { name: 'Edit Price' });
    fireEvent.click(cell);
    const input = screen.getByRole('textbox', { name: 'Price' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(adapter.stage).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '41.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(adapter.stage).toHaveBeenCalledWith('7', { price: 41.5 }, undefined));
  });

  it('variation listings have read-only price and qty cells (no edit button)', async () => {
    response = makeResponse([row({ id: '2', title: 'Name Necklace Gold', editable: { price: false, qty: false, reason: 'variations' } })]);
    await renderPage();
    await screen.findAllByText('Name Necklace Gold');
    expect(screen.queryByRole('button', { name: 'Edit Price' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Qty' })).toBeNull();
  });

  it('opens the quick view from ?open= with the per-listing send primary', async () => {
    router.query = { open: '1' };
    const adapter = makeAdapter();
    await renderPage({ adapter });
    const panel = await screen.findByTestId('listings-quickview');
    const send = within(panel).getByRole('button', { name: 'Send changes to Etsy' });
    fireEvent.click(send);
    await waitFor(() => expect(adapter.send).toHaveBeenCalledWith(['d1']));
  });

  it('"Open editor" goes to the editor route and writes kx:editorNav for ‹ › and Back (M6)', async () => {
    window.sessionStorage.removeItem('kx:editorNav');
    try {
      router.query = { open: '1' };
      await renderPage();
      const panel = await screen.findByTestId('listings-quickview');
      fireEvent.click(await within(panel).findByRole('button', { name: 'Open editor' }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/etsy-listings\/1(\?|$)/)));
      const nav = JSON.parse(window.sessionStorage.getItem('kx:editorNav') ?? 'null');
      expect(nav?.marketplace).toBe('etsy');
      expect(nav?.ids).toContain('1');
      expect(String(nav?.query ?? '')).not.toContain('open=');
    } finally {
      window.sessionStorage.removeItem('kx:editorNav');
    }
  });

  it('a conflict opens the quick view without a send action', async () => {
    router.query = { open: '4' };
    await renderPage();
    const panel = await screen.findByTestId('listings-quickview');
    expect(within(panel).getByTestId('quickview-conflict')).toBeTruthy();
    const btn = within(panel).queryByRole('button', { name: 'Send changes to Etsy' });
    if (btn) expect(btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('renders ConnectState when the marketplace is not connected', async () => {
    conn.connected = false;
    await renderPage();
    expect(await screen.findByTestId('listings-connect')).toBeTruthy();
    expect(screen.queryByTestId('listings-table')).toBeNull();
  });

  it('reconnect needed: warning banner and Send disabled with the reason', async () => {
    conn.needsReauth = true;
    await renderPage();
    expect(screen.getByTestId('listings-reconnect')).toBeTruthy();
    const btn = within(screen.getByTestId('listings-header')).getByRole('button', { name: /Send 3 changes to Etsy/ });
    expect(btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('opens a G6 tool from ?tool=', async () => {
    router.query = { tool: 'duplicates' };
    await renderPage();
    expect(screen.getByTestId('tool-DuplicatesPanel')).toBeTruthy();
    expect(toolProps.FindReplacePanel.open).toBe(false);
  });
});

describe('ListingsPage queued deletes and mobile', () => {
  it('a queued deletion is sent only from the row menu after typing the shop name', async () => {
    response = makeResponse([row({ id: '3', title: 'Old Christmas Ornament', sync: draft({ draftId: 'd3', changedFields: [], draft: {}, queuedDelete: true }) })]);
    const adapter = makeAdapter();
    await renderPage({ adapter });
    const table = screen.getByTestId('listings-table');
    fireEvent.click(within(table).getAllByRole('button', { name: /more|⋯|actions/i }).pop()!);
    fireEvent.click(await screen.findByText('Send deletion…'));
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete now' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Belle Couture Gifts' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete now' }));
    await waitFor(() => expect(adapter.sendDeletion).toHaveBeenCalledWith('d3'));
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('mobile: cards plus the sticky "Send N changes" bar', async () => {
    setViewport('mobile');
    await renderPage();
    expect(screen.getByTestId('listings-send-bar').textContent).not.toContain('not sent yet'); // the button carries the count (no extra status row on phones)
    expect(screen.getByTestId('listings-table').getAttribute('data-layout')).toBe('cards');
  });
});

describe('ListingsPage wording', () => {
  it('Turkish: case suffix through ICU select', async () => {
    await renderPage({ locale: 'tr' });
    const header = screen.getByTestId('listings-header');
    expect(within(header).getByText('Etsy ilanları')).toBeTruthy();
    expect(within(header).getByRole('button', { name: /3 değişikliği Etsy'ye gönder/ })).toBeTruthy();
  });

  it('Wix uses its own title and no Etsy-only freshness chip', async () => {
    router.pathname = '/app/wix-urunler';
    response = { ...makeResponse([row({ id: 'w1', title: 'Wix Product' })]), counts: { ...makeResponse().counts, sync: { pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 } } };
    await renderPage({ marketplace: 'wix' });
    await act(async () => undefined);
    expect(within(screen.getByTestId('listings-header')).getByText('Wix products')).toBeTruthy();
    expect(screen.queryByTestId('freshness-chip')).toBeNull();
    expect(screen.queryByTestId('listings-failure-banner')).toBeNull();
    router.pathname = '/app/etsy-listings';
  });
});


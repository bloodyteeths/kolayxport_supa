// @vitest-environment jsdom
// Etsy legacy port, render level: "not on Etsy yet" drafts on the grid (open / discard), "Set field…" and
// "Copy to another shop…" in the bulk bar (both only stage), variation prices in Change price, profile delete.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { __resetUrlStateForTests } from '@/lib/ds/useUrlState';
import type { ListingRow, ListingsResponse } from '@/lib/listings/types';
import type { ListingsStagingAdapter, NewListingDraft } from '@/components/domain/listings/useStagedChanges';
import { setViewport } from '../ds/m1e-helpers';
import { G5_EN } from './g5-messages';
import { ETSY_PORT_EN } from './etsy-port-messages';

const router = {
  pathname: '/app/etsy-listings',
  asPath: '/app/etsy-listings',
  query: {} as Record<string, string | string[]>,
  isReady: true,
  replace: vi.fn(async (u: { query: Record<string, string | string[]> }) => {
    router.query = u.query;
    return true;
  }),
  push: vi.fn(async () => true),
};
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ connections: {}, error: undefined, has: () => true, get: () => ({ connected: true, needsReauth: false }), mutate: vi.fn() }),
}));
vi.mock('@/components/etsy-history/CacheFreshnessChip', () => ({ default: () => null }));
for (const [name, file] of [
  ['FindReplacePanel', 'FindReplacePanel'],
  ['DuplicatesPanel', 'DuplicatesPanel'],
  ['CsvImportPanel', 'CsvImportPanel'],
  ['ExportCsvModal', 'ExportCsvModal'],
  ['ScheduledSendsPanel', 'ScheduledSendsPanel'],
] as const) {
  vi.doMock(`@/components/domain/listings/tools/${file}`, async (orig) => ({
    ...((await orig()) as object),
    [name]: () => null,
  }));
}

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MESSAGES = deepMerge(deepMerge(en as Obj, G5_EN as Obj), ETSY_PORT_EN as Obj);

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
  } as ListingRow;
}
let response: ListingsResponse;
function makeResponse(stores = [{ id: 'S1', name: 'Belle Couture Gifts' }]): ListingsResponse {
  const rows = [row({ id: '1' }), row({ id: '2', title: 'Name Necklace Gold' })];
  return {
    rows,
    total: rows.length,
    counts: { all: 2, status: { active: 2 }, sync: { pending: 0, syncing: 0, failed: 0, conflict: 0, queuedDeletes: 0 }, needsWork: 0, unscored: 0 },
    store: { id: 'S1', name: 'Belle Couture Gifts', currency: 'USD', lastPulledAt: '2026-10-15T11:50:00Z' },
    stores,
  } as ListingsResponse;
}

const NEW_DRAFT: NewListingDraft = {
  draftId: 'n1',
  listingId: '-17',
  kind: 'create',
  title: 'Baby Blanket',
  photoCount: 2,
  thumbUrl: null,
  partialId: null,
  willPublish: true,
  targetShopId: null,
  status: 'pending',
  queuedDelete: false,
  updatedAt: null,
};

function makeAdapter(extra: Partial<ListingsStagingAdapter> = {}): ListingsStagingAdapter {
  return {
    stage: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    send: vi.fn(async (ids: string[]) => ({ sent: ids, failed: [], conflicts: [] })),
    schedule: vi.fn(async () => undefined),
    listOpen: vi.fn(async () => []),
    sendDeletion: vi.fn(async (id: string) => ({ sent: [id], failed: [], conflicts: [] })),
    stagesDescription: true,
    stagesEtsyExtras: true,
    stagesCopyToShop: true,
    ...extra,
  };
}

let ListingsPage: typeof import('@/components/domain/listings/ListingsPage').ListingsPage;
async function renderPage(adapter: ListingsStagingAdapter) {
  ListingsPage ??= (await import('@/components/domain/listings/ListingsPage')).ListingsPage;
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ConfirmProvider>
            <ListingsPage marketplace="etsy" now={NOW} stagingAdapter={adapter} />
          </ConfirmProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
  await screen.findAllByText('Wooden Keepsake Box');
}

function selectFirstRow() {
  const cell = screen.getAllByTestId('listing-title').find((el) => el.textContent === 'Wooden Keepsake Box')!;
  const r = cell.closest('[data-row-id]') as HTMLElement;
  fireEvent.click(within(r).getByRole('checkbox'));
}

beforeEach(() => {
  // The listings page remembers the selection per tab (sessionStorage); every test starts with none.
  try { sessionStorage.clear(); } catch { /* no storage */ }
  __resetShortcutsForTests();
  __resetUrlStateForTests();
  setViewport('desktop');
  router.query = {};
  response = makeResponse();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = String(input);
      if (u.startsWith('/api/listings?')) return new Response(JSON.stringify(response), { status: 200 });
      if (u.includes('action=get_shipping_profiles')) return new Response(JSON.stringify({ shipping_profiles: [{ shipping_profile_id: 3, title: 'US Free 3-5 d' }] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Etsy grid: new listings not on Etsy yet', { timeout: 30_000 }, () => {
  it('shows the drafts, links to the editor and discards after confirming', async () => {
    const adapter = makeAdapter({ listNewListings: vi.fn(async () => [NEW_DRAFT]) });
    await renderPage(adapter);
    const banner = await screen.findByTestId('listings-new-drafts');
    expect(banner.textContent).toContain('1 new listing is not on Etsy yet');
    fireEvent.click(within(banner).getByRole('button', { name: 'Show them' }));
    const item = screen.getByTestId('listings-new-draft-n1');
    expect(item.textContent).toContain('Baby Blanket');
    expect(item.textContent).toContain('2 photos · Goes live when sent');
    const open = screen.getByTestId('listings-new-draft-open-n1');
    expect(open.getAttribute('href')).toBe('/app/etsy-listings/-17?shop=S1');
    fireEvent.click(screen.getByTestId('listings-new-draft-discard-n1'));
    const dialog = await screen.findByRole('dialog');
    expect(adapter.discard).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(adapter.discard).toHaveBeenCalledWith(['n1']));
    // Discarding never sends anything.
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('renders nothing without such drafts', async () => {
    await renderPage(makeAdapter({ listNewListings: vi.fn(async () => []) }));
    expect(screen.queryByTestId('listings-new-drafts')).toBeNull();
  });
});

describe('Etsy grid: bulk Set field and Copy to another shop', { timeout: 30_000 }, () => {
  it('Set field stages the chosen shipping profile on the selected listings', async () => {
    const adapter = makeAdapter();
    await renderPage(adapter);
    selectFirstRow();
    const bar = await screen.findByRole('toolbar', { name: /selected/i });
    // Set field moved under ⋯ (the bar shows the six everyday jobs).
    fireEvent.click(within(bar).getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set field…' }));
    const dialog = await screen.findByTestId('listings-set-field');
    const select = within(dialog).getByTestId('set-field-shipping');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('action=get_shipping_profiles')));
    fireEvent.mouseDown(within(select).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'US Free 3-5 d' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage 1 change' }));
    await waitFor(() => expect(adapter.stage).toHaveBeenCalledWith('1', { etsy: { fields: { shipping_profile_id: 3 } } }));
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it('Copy to another shop is offered only with a second shop, and stages the queued copy', async () => {
    const one = makeAdapter();
    await renderPage(one);
    selectFirstRow();
    let bar = await screen.findByRole('toolbar', { name: /selected/i });
    fireEvent.click(within(bar).getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Copy to another shop…' })).toBeNull();
    cleanup();
    sessionStorage.clear(); // a fresh visit: the remembered selection of the first render must not come back
    __resetUrlStateForTests();

    response = makeResponse([
      { id: 'S1', name: 'Belle Couture Gifts' },
      { id: 'S2', name: 'Second Shop' },
    ]);
    const adapter = makeAdapter();
    await renderPage(adapter);
    selectFirstRow();
    bar = await screen.findByRole('toolbar', { name: /selected/i });
    fireEvent.click(within(bar).getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy to another shop…' }));
    const dialog = await screen.findByTestId('listings-copy-to-shop');
    // The only other shop is preselected.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stage 1 copy' }));
    await waitFor(() => expect(adapter.stage).toHaveBeenCalledWith('1', {}, { queuedActions: [{ type: 'copy', targetShopId: 'S2' }] }));
    expect(adapter.send).not.toHaveBeenCalled();
  });
});

describe('Change price on listings with variations (Etsy)', { timeout: 30_000 }, () => {
  it('stages variations as inventory instead of skipping them', async () => {
    const { ChangePriceModal } = await import('@/components/domain/listings/bulk/ChangePriceModal');
    const { useTranslations } = await import('next-intl');
    const onStage = vi.fn(async () => ({ ok: ['1'], failed: [] }));
    const onStageVariations = vi.fn(async () => undefined);
    const rows = [row({ id: '1' }), row({ id: '2', editable: { price: false, qty: false, reason: 'variations' } as ListingRow['editable'] })];
    function Harness() {
      const t = useTranslations() as unknown as (k: string, v?: Record<string, unknown>) => string;
      return (
        <ChangePriceModal
          open
          onClose={() => undefined}
          rows={rows}
          currency="USD"
          priceMin={0.2}
          currentPrice={(r) => r.price?.amount ?? null}
          formatMoney={(n) => `$${n.toFixed(2)}`}
          onStage={onStage}
          onStageVariations={onStageVariations}
          t={t as never}
        />
      );
    }
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <Harness />
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
    const dialog = await screen.findByTestId('listings-change-price');
    expect(within(dialog).getByTestId('listings-change-price-variations').textContent).toContain('1 listing has variations');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Stage 2 price changes/ }));
    await waitFor(() => expect(onStageVariations).toHaveBeenCalledTimes(1));
    expect(onStage).toHaveBeenCalledWith([{ id: '1', patch: { price: 59.4 } }]);
    expect(onStageVariations).toHaveBeenCalledWith([rows[1]], { mode: 'incPct', value: 10, round: 'none' });
  });
});

describe('Change price: every listing old → new', { timeout: 30_000 }, () => {
  it('lists each listing with its rounded new price before staging', async () => {
    const { ChangePriceModal } = await import('@/components/domain/listings/bulk/ChangePriceModal');
    const { useTranslations } = await import('next-intl');
    const rows = [row({ id: '1', title: 'Wooden Keepsake Box', price: { amount: 29, currency: 'USD' } } as Partial<ListingRow>), row({ id: '2', title: 'Name Necklace Gold', price: { amount: 40, currency: 'USD' } } as Partial<ListingRow>)];
    function Harness() {
      const t = useTranslations() as unknown as (k: string, v?: Record<string, unknown>) => string;
      return (
        <ChangePriceModal open onClose={() => undefined} rows={rows} currency="USD" priceMin={0.2} currentPrice={(r) => r.price?.amount ?? null}
          formatMoney={(n) => `$${n.toFixed(2)}`} onStage={vi.fn(async () => ({ ok: [], failed: [] }))} t={t as never} />
      );
    }
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <Harness />
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
    const dialog = await screen.findByTestId('listings-change-price');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: '10' } });
    const items = within(within(dialog).getByTestId('listings-change-price-list')).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Wooden Keepsake Box');
    expect(items[0]).toContain('$29.00 → $31.90');
    expect(items[1]).toContain('$40.00 → $44.00');
  });
});

describe('Profiles: delete', { timeout: 30_000 }, () => {
  it('deletes the chosen profile after confirming', async () => {
    const { ProfilesModal, PROFILE_STORAGE_KEY } = await import('@/components/domain/listing-editor/ProfilesModal');
    const m = new Map<string, string>([[PROFILE_STORAGE_KEY.etsy, JSON.stringify([{ id: 'p1', name: 'Baby blankets', createdAt: '2026-10-01T00:00:00Z', fields: { tags: ['a'] } }])]]);
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="Europe/Istanbul" now={NOW} onError={() => {}}>
        <ThemeProvider theme={theme}>
          <ConfirmProvider>
            <ProfilesModal open onClose={() => undefined} mode="apply" marketplace="etsy" fields={{}} setField={vi.fn()} storage={storage} />
          </ConfirmProvider>
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
    fireEvent.click(await screen.findByTestId('le-profile-delete'));
    const confirmDialog = await screen.findByText('Delete the profile "Baby blankets"?');
    fireEvent.click(within(confirmDialog.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Delete profile' }));
    await waitFor(() => expect(JSON.parse(m.get(PROFILE_STORAGE_KEY.etsy)!)).toEqual([]));
    expect(await screen.findByTestId('le-profile-empty')).toBeTruthy();
  });
});

describe('Etsy grid: selection survives a trip to another screen', { timeout: 30_000 }, () => {
  it('restores the selection on return with the same filters', async () => {
    await renderPage(makeAdapter());
    selectFirstRow();
    expect(await screen.findByRole('toolbar', { name: /selected/i })).toBeTruthy();
    cleanup(); // leave the page (e.g. to the grid or Photo Studio)
    __resetUrlStateForTests();
    await renderPage(makeAdapter());
    expect(await screen.findByRole('toolbar', { name: /selected/i })).toBeTruthy();
  });
});

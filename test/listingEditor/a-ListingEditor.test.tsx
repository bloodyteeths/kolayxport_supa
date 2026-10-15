// @vitest-environment jsdom
// M6 Group A: the frame. Founder complaints this replaces: one primary (Send) in a sticky footer and none when
// nothing changed, labelled save state, no "0 views · 0 favorites", decoded entities, EN/TR without mixing,
// conflict → Review differences (no force), queued delete banner. Sections are stubbed through the
// `sections` prop and talk to the engine only through `useListingEditor()` (the B/C/D contract).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { __resetShortcutsForTests } from '@/lib/ds/useShortcuts';
import { setViewport } from '../ds/m1e-helpers';
import { aEn, aTr } from './a-messages';
import { eEn, eTr } from './e-messages';

const router = { pathname: '/app/etsy-listings/[listingId]', asPath: '/', query: {} as Record<string, string>, isReady: true, events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() }, push: vi.fn(async () => true), replace: vi.fn(async () => true), reload: vi.fn(), back: vi.fn() };
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { ListingEditor } from '@/components/domain/listing-editor/ListingEditor';
import { etsyAdapter } from '@/components/domain/listing-editor/adapters/etsy';
import { useListingEditor } from '@/components/domain/listing-editor/useListingDraft';
import type { EtsyEditorFields, ListingSectionProps } from '@/lib/listingEditor/types';
import { sectionAnchorId } from '@/lib/listingEditor/sections';

type Obj = Record<string, unknown>;
function merge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k] as Obj, v as Obj) : v;
  return out;
}
const MESSAGES = { en: merge(merge(en as Obj, eEn as Obj), aEn as Obj), tr: merge(merge(tr as Obj, eTr as Obj), aTr as Obj) };

function StubTitle({ id }: ListingSectionProps) {
  const ed = useListingEditor<EtsyEditorFields>();
  return (
    <section id={sectionAnchorId(id)}>
      <label htmlFor="t">Title</label>
      <input id="t" value={ed.view.fields.title} onChange={(e) => ed.setField('title', e.target.value)} />
    </section>
  );
}
const SECTIONS = { title: StubTitle };

const LISTING = {
  listing_id: 111,
  title: 'Mommy&#39;s Little Girl Blanket',
  description: 'Soft',
  tags: ['baby'],
  materials: [],
  price: { amount: 2000, divisor: 100, currency_code: 'USD' },
  quantity: 3,
  state: 'active',
  views: 0,
  num_favorers: 0,
  updated_timestamp: 1_760_000_000,
  images: [],
};
let drafts: unknown[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('/api/clawd/etsy?action=listing')) return new Response(JSON.stringify(LISTING), { status: 200 });
  if (u.startsWith('/api/etsy-drafts?')) return new Response(JSON.stringify({ drafts }), { status: 200 });
  if (u === '/api/etsy-drafts' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ draft: { id: 'd1', status: 'draft', etsyListingId: '111', fieldPatch: body.fields, queuedActions: [], media: [], syncAttempts: [] } }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
});

function draft(extra: Obj = {}) {
  return { id: 'd1', status: 'draft', etsyListingId: '111', fieldPatch: {}, queuedActions: [], media: [], syncAttempts: [], updatedAt: '2026-10-15T09:00:00Z', ...extra };
}

function mount(locale: 'en' | 'tr' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Europe/Istanbul" onError={() => {}}>
      <ThemeProvider theme={theme}>
        <ListingEditor marketplace="etsy" adapter={etsyAdapter} shopId="42" shopName="Belle" mode="edit" listingId="111" backHref="/app/etsy-listings?shop=42" sections={SECTIONS} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  __resetShortcutsForTests();
  setViewport('desktop');
  drafts = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const footer = () => screen.getByTestId('le-footer');

describe('ListingEditor frame', () => {
  it('no changes: decoded title, no zero stats, "Up to date", no primary button', async () => {
    mount();
    await screen.findByDisplayValue("Mommy's Little Girl Blanket");
    expect(screen.getAllByText("Mommy's Little Girl Blanket").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/&#39;|0 views|0 favorites/);
    expect(footer().textContent).toContain('Up to date with Etsy');
    expect(footer().querySelectorAll('button').length).toBeLessThanOrEqual(1); // only ⋯
    expect(screen.queryByText('Send changes to Etsy')).toBeNull();
  });

  it('a staged draft (I0 8b overlay): one primary "Send changes to Etsy", Discard, edits count', async () => {
    drafts = [draft({ fieldPatch: { title: 'Draft title' } })];
    mount();
    await screen.findByDisplayValue('Draft title');
    expect(footer().textContent).toMatch(/1 edit not sent yet/);
    expect(screen.getAllByRole('button', { name: 'Send changes to Etsy' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    // the section-nav sees the change
    expect(screen.getByTestId('le-section-nav').textContent).toContain('Title & description');
  });

  it('typing marks the form unsaved and autosaves to the DB draft only', async () => {
    mount();
    const input = await screen.findByDisplayValue("Mommy's Little Girl Blanket");
    fireEvent.change(input, { target: { value: 'New title, Baby Gift' } });
    expect(footer().textContent).toContain('Unsaved changes');
    await act(async () => {
      fireEvent.keyDown(window, { key: 's', metaKey: true, ctrlKey: true });
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === '/api/etsy-drafts' && (i as RequestInit)?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([u, i]) => u === '/api/etsy-drafts' && (i as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ fields: { title: 'New title, Baby Gift' }, replaceFields: true });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/sync'))).toBe(false);
  });

  it('conflict: warning banner and the primary is Review differences (no force)', async () => {
    drafts = [draft({ status: 'conflict', fieldPatch: { title: 'Mine' } })];
    mount();
    await screen.findByDisplayValue('Mine');
    expect(screen.getByTestId('le-banner-conflict').textContent).toContain('Changed on Etsy since your draft');
    expect(screen.getAllByRole('button', { name: 'Review differences' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Send changes/ })).toBeNull();
  });

  it('queued delete: danger banner first with Remove delete', async () => {
    drafts = [draft({ queuedActions: [{ type: 'delete' }] })];
    mount();
    const banner = await screen.findByTestId('le-banner-delete');
    expect(banner.textContent).toContain('This draft will delete the listing on Etsy when sent');
    expect(screen.getByTestId('le-banners').firstElementChild?.getAttribute('data-testid')).toBe('le-banner-delete');
  });

  it('Turkish: no English leaks in the footer, dative via select', async () => {
    drafts = [draft({ fieldPatch: { title: 'Taslak' } })];
    mount('tr');
    await screen.findByDisplayValue('Taslak');
    expect(screen.getByRole('button', { name: "Değişiklikleri Etsy'ye gönder" })).toBeTruthy();
    expect(footer().textContent).toMatch(/düzenleme henüz gönderilmedi/);
    expect(footer().textContent).not.toMatch(/Send|Saved|Discard/);
  });

  it('mobile: short primary "Send to Etsy" with Preview as the secondary', async () => {
    setViewport('mobile');
    drafts = [draft({ fieldPatch: { title: 'Draft title' } })];
    mount();
    await screen.findByDisplayValue('Draft title');
    expect(screen.getByRole('button', { name: 'Send to Etsy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
  });

  it('load failure (404) shows the page error with a way back', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 }));
    mount();
    expect(await screen.findByText("This listing isn't on Etsy any more")).toBeTruthy();
    expect(screen.getAllByText('Etsy listings').length).toBeGreaterThan(0);
  });
});

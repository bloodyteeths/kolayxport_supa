// @vitest-environment jsdom
// M7-E PhotoStudio page: pro-gating §2 matrix on the direct URL (trial / Pro → studio; Growth → locked page with
// "See plans"; shopify_free → neutral locked, no Pro / Stripe / pricing / currency; unknown → studio), EN + TR,
// and a staging run: 60 listings × "Add by image link" → 2 batch-media requests (50 + 10), a queued-delete
// listing left out, and nothing sent to Etsy.
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import { FormatProvider } from '@/lib/format';
import { ConfirmProvider } from '@/lib/hooks/useConfirm';
import { useFeatureLockStore } from '@/lib/http/limitInterceptor';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { PhotoStudioPage } from '@/components/domain/photo-studio/PhotoStudioPage';
import { F } from '../billing/d-fixtures';
import { psEn, psPendingEn, psPendingTr, psTr } from './messages';

const h = vi.hoisted(() => ({
  router: { pathname: '/app/etsy-listings/photos', query: {}, isReady: true, push: vi.fn(() => Promise.resolve(true)), replace: vi.fn(), events: { on: () => undefined, off: () => undefined } },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('@/components/ds/feedback/toast', async (orig) => ({ ...(await orig<object>()), useToast: () => h.toast }));

type Obj = Record<string, unknown>;
const merge = (a: Obj, b: Obj): Obj => {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k] as Obj, v as Obj) : v;
  return out;
};
const MESSAGES = {
  en: merge(merge(en as Obj, psEn as Obj), psPendingEn as Obj),
  tr: merge(merge(tr as Obj, psTr as Obj), psPendingTr as Obj),
};

function renderPage(ui: ReactElement, locale: 'en' | 'tr' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <FormatProvider timeZone="Europe/Istanbul">
        <ThemeProvider theme={theme}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, shouldRetryOnError: false }}>
            <ConfirmProvider>{ui}</ConfirmProvider>
          </SWRConfig>
        </ThemeProvider>
      </FormatProvider>
    </NextIntlClientProvider>,
  );
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(1000 + i));
const row = (id: string, extra: Obj = {}) => ({
  id, title: `Listing ${id}`, metaLine: [], thumbUrl: null, price: null, qty: 1, editable: { price: true, qty: true }, status: 'active', statusRaw: 'active',
  health: { score: null, used: 0, total: 0, fails: [] }, updatedAt: null, createdAt: null, extra: {}, externalUrl: null, sync: null, ...extra,
});

interface Call { path: string; method: string; body: unknown }
let calls: Call[] = [];

function mockApi(entitlement: unknown, listingIds: string[], opts: { queuedDelete?: string } = {}) {
  calls = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch { body = null; }
    calls.push({ path, method, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (path.startsWith('/api/billing/entitlement')) return entitlement === 'error' ? json(500, {}) : json(200, entitlement);
    if (path.startsWith('/api/user/settings')) return json(500, {});
    if (path.startsWith('/api/listings')) {
      return json(200, {
        rows: listingIds.map((id) => row(id, id === opts.queuedDelete ? { sync: { draftId: 'dq', status: 'pending', changedFields: [], draft: {}, queuedDelete: true, scheduledSendAt: null, syncedAt: null } } : {})),
        total: listingIds.length, counts: {}, store: { id: '555', name: 'Shop', currency: 'USD', lastPulledAt: null }, stores: [],
      });
    }
    if (path.startsWith('/api/etsy-drafts/batch-media')) {
      const items = (body as { items: Array<{ listingId: string }> }).items;
      return json(200, { results: items.map((i) => ({ listingId: i.listingId, ok: true, draftId: `d-${i.listingId}`, status: 'draft', media: [{ id: `m-${i.listingId}`, kind: 'image', operation: 'upload', rank: 3, sourceUrl: 'https://cdn.test/new.jpg' }] })) });
    }
    if (path.startsWith('/api/etsy-drafts')) return json(200, { drafts: [] });
    if (path.startsWith('/api/clawd/etsy')) {
      return json(200, { images: [1, 2].map((r) => ({ listing_image_id: 10 + r, rank: r, url_570xN: `https://i.test/${r}.jpg`, alt_text: 'alt' })) });
    }
    return json(404, { error: 'not found' });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const page = (n: number, locale: 'en' | 'tr' = 'en') => renderPage(
  <PhotoStudioPage shopId="555" ids={ids(n)} tab="photos" onTabChange={() => undefined} backHref="/app/etsy-listings" />, locale,
);

beforeEach(() => {
  useFeatureLockStore.getState().clear();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.toast.info.mockClear();
});
afterEach(cleanup);

describe('PhotoStudio gating (direct URL)', () => {
  it.each(['en', 'tr'] as const)('trial (%s): the studio renders with the Pro tag and loads the listings', async (locale) => {
    mockApi(F.trial(), ids(3));
    page(3, locale);
    expect(await screen.findByTestId('photo-studio')).toBeTruthy();
    expect(await screen.findByTestId('photo-studio-row-1000')).toBeTruthy();
    expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
    expect(screen.getByText(locale === 'en' ? 'Photo studio' : 'Fotoğraf stüdyosu', { selector: 'h1, h1 *' })).toBeTruthy();
  });

  it('Pro: studio without the Pro tag', async () => {
    mockApi(F.pro(), ids(2));
    page(2);
    expect(await screen.findByTestId('photo-studio')).toBeTruthy();
    expect(screen.queryByText('Pro')).toBeNull();
  });

  it.each(['en', 'tr'] as const)('Growth (%s): locked page with "See plans", no studio, no listing fetch, no primary', async (locale) => {
    mockApi(F.growth(), ids(2));
    page(2, locale);
    const locked = await screen.findByTestId('photo-studio-gate');
    expect(locked.textContent).toContain(locale === 'en' ? 'Photo studio is part of Pro' : 'Fotoğraf stüdyosu Pro planına dahildir');
    expect(screen.getByTestId('action-see-plans').getAttribute('href')).toBe('/fiyatlandirma?plan=pro&from=bulkPhotoStudio');
    expect(screen.queryByTestId('photo-studio')).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/api/listings'))).toBe(false);
    expect(screen.queryByTestId('action-stage')).toBeNull();
  });

  it.each(['en', 'tr'] as const)('shopify_free (%s): neutral locked — no Pro, Stripe, pricing link or currency', async (locale) => {
    mockApi(F.shopify(), ids(2));
    page(2, locale);
    const locked = await screen.findByTestId('photo-studio-gate');
    expect(locked.textContent).toContain(locale === 'en' ? "This isn't included in your plan" : 'Bu özellik planınıza dahil değil');
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/Pro\b/);
    expect(html).not.toContain('Stripe');
    expect(html).not.toContain('/fiyatlandirma');
    expect(html).not.toMatch(/[₺$]/);
  });

  it('server 402 featureLocked swaps the studio to the locked page', async () => {
    mockApi(F.pro(), ids(1));
    page(1);
    expect(await screen.findByTestId('photo-studio')).toBeTruthy();
    act(() => { useFeatureLockStore.getState().markLocked({ feature: 'bulkPhotoStudio', neutral: false, at: Date.now() }); });
    expect((await screen.findByTestId('photo-studio-gate')).getAttribute('data-kind')).toBe('locked');
    expect(screen.queryByTestId('photo-studio')).toBeNull();
  });
});

describe('PhotoStudio staging run', () => {
  it('Add by image link on 60 listings: 2 batch-media requests (50 + 10), queued delete left out, nothing sent', async () => {
    mockApi(F.pro(), ids(61), { queuedDelete: '1060' });
    page(61);
    await screen.findByTestId('photo-studio-row-1059', {}, { timeout: 15000 });
    // wait for every strip to load (a not-loaded listing is skipped, never guessed)
    await waitFor(() => expect(screen.queryAllByTestId('photo-studio-strip-loading')).toHaveLength(0), { timeout: 15000 });
    expect(screen.getByTestId('photo-studio-applies').textContent).toBe('Applies to 60 selected');

    fireEvent.mouseDown(within(screen.getByTestId('photo-studio-source')).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Image link' }));
    const url = within(await screen.findByTestId('photo-studio-url')).getByRole('textbox');
    fireEvent.change(url, { target: { value: 'https://cdn.test/new.jpg' } });

    const stage = await screen.findByRole('button', { name: 'Stage 60 photo changes' });
    fireEvent.click(stage);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('60 changes saved to your drafts · not sent yet'), { timeout: 15000 });

    const batches = calls.filter((c) => c.path === '/api/etsy-drafts/batch-media');
    expect(batches.map((b) => (b.body as { items: unknown[] }).items.length)).toEqual([50, 10]);
    const first = (batches[0].body as { shopId: string; items: Array<{ listingId: string; media: unknown[] }> });
    expect(first.shopId).toBe('555');
    expect(first.items[0]).toEqual({ listingId: '1000', media: [{ kind: 'image', operation: 'upload', sourceUrl: 'https://cdn.test/new.jpg', rank: 3 }] });
    const all = batches.flatMap((b) => (b.body as { items: Array<{ listingId: string }> }).items.map((i) => i.listingId));
    expect(all).not.toContain('1060');
    expect(calls.some((c) => /bulk-sync|\/sync\b/.test(c.path))).toBe(false);
    expect(screen.getByText(/60 photo changes staged here · not sent yet/)).toBeTruthy();
  }, 45_000);
});

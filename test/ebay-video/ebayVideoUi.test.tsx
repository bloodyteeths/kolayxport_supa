// @vitest-environment jsdom
// eBay Photos section with the listing video (PhotosSection → EbayPhotos, components/ebay/VideoUploader) in a fake
// editor context, create and edit, EN and TR with strict i18n (a missing key throws). Draft calls are mocked: nothing
// reaches eBay. Also the small pure helpers (range header, studio return path, staged rows).
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

const h = vi.hoisted(() => ({
  router: { query: {} as Record<string, unknown>, pathname: '/app/ebay-listings/[sku]', push: vi.fn(), replace: vi.fn(), isReady: true },
  client: {
    fetchEbayDrafts: vi.fn(),
    fetchEbayVideoInfo: vi.fn(),
    removeEbayDraftMedia: vi.fn(),
    stageEbayAiVideo: vi.fn(),
    stageEbayDraft: vi.fn(),
    stageEbayDraftFile: vi.fn(),
  },
}));
vi.mock('next/router', () => ({ useRouter: () => h.router }));
vi.mock('@/lib/ebay/draftClient', () => h.client);
vi.mock('react-hot-toast', () => {
  const fn: any = vi.fn(() => 'toast-id');
  Object.assign(fn, { error: vi.fn(() => 'e'), success: vi.fn(() => 's'), custom: vi.fn(() => 'c'), dismiss: vi.fn(), remove: vi.fn(), loading: vi.fn() });
  return { toast: fn, default: fn, Toaster: () => null };
});

import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import { PhotosSection, ebayRemoteVideoId, ebayStudioReturnPath } from '@/components/domain/listing-editor/sections/PhotosSection';
import { stagedVideoOf } from '@/components/ebay/VideoUploader';
import { parseRange } from '@/lib/ebay/byteRange';
import { ebayVideoReturnHref, safeEditorReturn } from '@/components/domain/video-studio/VideoStudio';
import type { DraftSection } from '@/lib/listingEditor/types';

type Locale = 'en' | 'tr';
const MESSAGES = { en, tr } as const;

function makeCtx(mode: 'create' | 'edit', raw: unknown, draft: unknown = null) {
  const sections: DraftSection[] = [];
  const facts: unknown[] = [];
  const value = {
    marketplace: 'ebay',
    marketplaceName: 'eBay',
    mode,
    ctx: { shopId: 'ebay', listingId: mode === 'edit' ? 'SKU-1' : 'kx-local-1' },
    view: { marketplace: 'ebay', mode, fields: { title: 'Wooden Box', images: ['https://i.ebayimg.com/1.jpg'] }, meta: { id: 'SKU-1', currency: 'USD', images: [], raw, url: null }, facts: {} },
    remote: mode === 'edit' ? { images: ['https://i.ebayimg.com/1.jpg'] } : null,
    draft,
    changes: [],
    issues: [],
    defaultsApplied: [],
    readOnly: false,
    setField: vi.fn(),
    setFields: vi.fn(),
    revert: vi.fn(),
    isFieldDirty: () => false,
    register: (s: DraftSection) => { sections.push(s); return () => undefined; },
    stageActions: vi.fn(),
    saveNow: vi.fn(async () => true),
    reloadDraft: vi.fn(async () => draft),
    reportFacts: vi.fn((f: unknown) => facts.push(f)),
    notifyChange: vi.fn(),
  } as unknown as ListingEditorContextValue;
  return { value, sections, facts };
}

function renderIn(ctx: ListingEditorContextValue, locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <ListingEditorContext.Provider value={ctx}><PhotosSection /></ListingEditorContext.Provider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});
beforeEach(() => {
  h.router.query = {};
  h.router.push.mockReset();
  h.router.replace.mockReset();
  h.client.fetchEbayDrafts.mockReset().mockResolvedValue([]);
  h.client.fetchEbayVideoInfo.mockReset().mockResolvedValue({ videoId: 'EV-LIVE', status: 'LIVE', thumbnailUrl: 'https://i.ebayimg.com/thumb.jpg' });
  h.client.stageEbayDraftFile.mockReset().mockResolvedValue({ success: true });
  h.client.stageEbayDraft.mockReset().mockResolvedValue({ id: 'd1' });
  h.client.stageEbayAiVideo.mockReset().mockResolvedValue({ success: true });
  h.client.removeEbayDraftMedia.mockReset().mockResolvedValue({ id: 'd1' });
});
afterEach(cleanup);

const t = (locale: Locale, key: string) => key.split('.').reduce<any>((o, k) => o?.[k], MESSAGES[locale]) as string;

describe.each(['en', 'tr'] as Locale[])('eBay photos: video (%s)', (locale) => {
  it('create: shows the Add video tile and Create video; a picked MP4 is staged for the local SKU (isNew)', async () => {
    const { value, sections } = makeCtx('create', {});
    renderIn(value, locale);
    expect(sections.map((s) => s.key)).toEqual(expect.arrayContaining(['photos:images', 'photos:video']));
    expect(screen.getByRole('button', { name: t(locale, 'listingEditor.aiVideo.open') })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: t(locale, 'listingEditor.video.add') }).length).toBeGreaterThan(0);
    const input = screen.getByTestId('ebay-video-input') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    await waitFor(() => expect(h.client.stageEbayDraftFile).toHaveBeenCalledWith({ sku: 'kx-local-1', file, kind: 'video', operation: 'upload', isNew: true }));
    expect(value.saveNow).toHaveBeenCalled();
  });

  it('refuses a WebM (eBay takes MP4 / MOV) without staging', async () => {
    const { value } = makeCtx('create', {});
    renderIn(value, locale);
    const input = screen.getByTestId('ebay-video-input') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], 'a.webm', { type: 'video/webm' })] } }); });
    expect(h.client.stageEbayDraftFile).not.toHaveBeenCalled();
  });

  it('edit: the listing video is the trailing tile (eBay thumbnail); Remove stages a delete row, Undo drops it', async () => {
    const { value, facts } = makeCtx('edit', { product: { videoIds: ['EV-LIVE'] } });
    renderIn(value, locale);
    const tile = await screen.findByTestId('image-strip-video');
    await waitFor(() => expect(tile.querySelector('img')?.getAttribute('src')).toBe('https://i.ebayimg.com/thumb.jpg'));
    expect(h.client.fetchEbayVideoInfo).toHaveBeenCalledWith('EV-LIVE');
    expect(facts).toContainEqual(expect.objectContaining({ hasVideo: true }));
    expect(screen.queryByRole('button', { name: t(locale, 'listingEditor.video.add') })).toBeNull();

    fireEvent.click(tile.querySelector('button')!);
    const remove = await screen.findByRole('button', { name: t(locale, 'listingEditor.photos.remove') });
    await act(async () => { fireEvent.click(remove); });
    expect(h.client.stageEbayDraft).toHaveBeenCalledWith({ sku: 'SKU-1', media: [{ kind: 'video', operation: 'delete', payload: { videoId: 'EV-LIVE' } }] });
  });

  it('edit: a staged upload shows as New with the local preview; Remove un-stages it (no eBay call)', async () => {
    h.client.fetchEbayDrafts.mockResolvedValue([{ id: 'd1', sku: 'SKU-1', status: 'draft', media: [{ id: 'm1', kind: 'video', operation: 'upload', payload: null }] }]);
    const { value } = makeCtx('edit', {});
    renderIn(value, locale);
    const tile = await screen.findByTestId('image-strip-video');
    expect(tile.getAttribute('data-staged')).toBe('add');
    expect(tile.querySelector('video')?.getAttribute('src')).toBe('/api/ebay-drafts/media-preview?id=m1');
    fireEvent.click(tile.querySelector('button')!);
    const remove = await screen.findByRole('button', { name: t(locale, 'listingEditor.photos.remove') });
    await act(async () => { fireEvent.click(remove); });
    expect(h.client.removeEbayDraftMedia).toHaveBeenCalledWith('d1', ['m1']);
  });

  it('a video eBay is still processing / rejected / needs reconnect shows its note', async () => {
    h.client.fetchEbayDrafts.mockResolvedValue([{ id: 'd1', sku: 'SKU-1', status: 'failed', lastSyncError: 'ebay.draftSync.videoProcessing', media: [{ id: 'm1', kind: 'video', operation: 'upload', payload: { ebayVideoId: 'EV-2' } }] }]);
    const { value } = makeCtx('edit', {});
    renderIn(value, locale);
    expect((await screen.findByTestId('ebay-video-note')).textContent).toBe(t(locale, 'listingEditor.video.ebayProcessing'));
    cleanup();
    h.client.fetchEbayDrafts.mockResolvedValue([{ id: 'd1', sku: 'SKU-1', status: 'failed', lastSyncError: 'ebay.draftSync.videoReconnect', media: [{ id: 'm1', kind: 'video', operation: 'upload', payload: null }] }]);
    renderIn(makeCtx('edit', {}).value, locale);
    expect((await screen.findByTestId('ebay-video-note')).textContent).toBe(t(locale, 'listingEditor.video.ebayReconnect'));
  });

  it('legacy listing (made on eBay): pictures stay read-only, the video can still be added', async () => {
    const { value } = makeCtx('edit', { isLegacy: true });
    renderIn(value, locale);
    expect(screen.queryByRole('button', { name: t(locale, 'listingEditor.photos.choose') })).toBeNull();
    const add = screen.getAllByRole('button', { name: t(locale, 'listingEditor.video.add') });
    expect(add.length).toBeGreaterThan(0);
  });

  it('?aiVideo=<job> from the Video Studio stages that video server side and drops the parameter', async () => {
    h.router.query = { sku: 'SKU-1', aiVideo: 'job-7' };
    const { value } = makeCtx('edit', {});
    renderIn(value, locale);
    await waitFor(() => expect(h.client.stageEbayAiVideo).toHaveBeenCalledWith({ sku: 'SKU-1', jobId: 'job-7', isNew: false }));
    await waitFor(() => expect(h.router.replace).toHaveBeenCalled());
    expect(h.router.replace.mock.calls[0][0]).toMatchObject({ query: { sku: 'SKU-1' }, hash: 'photos' });
  });

  it('Create video opens the Video Studio for this listing with a return path', async () => {
    const { value } = makeCtx('edit', {});
    renderIn(value, locale);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t(locale, 'listingEditor.aiVideo.open') })); });
    await waitFor(() => expect(h.router.push).toHaveBeenCalled());
    const url = new URL(`https://x${h.router.push.mock.calls[0][0]}`);
    expect(url.pathname).toBe('/app/video-studio');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ mp: 'ebay', listing: 'SKU-1', ret: '/app/ebay-listings/SKU-1' });
  });
});

describe('pure helpers', () => {
  it('parseRange answers byte ranges (iPhone Safari video)', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=200-', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
  });
  it('studio return path: same-origin eBay editor paths only', () => {
    expect(ebayStudioReturnPath('edit', 'A B', null)).toBe('/app/ebay-listings/A%20B');
    expect(ebayStudioReturnPath('create', 'x', 'd9')).toBe('/app/ebay-listings/new?draft=d9');
    expect(safeEditorReturn('/app/ebay-listings/new?draft=d9')).toBe('/app/ebay-listings/new?draft=d9');
    expect(safeEditorReturn('https://evil.example/app/ebay-listings/x')).toBeNull();
    expect(safeEditorReturn('//evil.example')).toBeNull();
    expect(safeEditorReturn('/app/ebay-listings//evil')).toBeNull();
    expect(ebayVideoReturnHref('/app/ebay-listings/new?draft=d9', 'x', 'j1')).toBe('/app/ebay-listings/new?draft=d9&aiVideo=j1#photos');
    expect(ebayVideoReturnHref(null, 'SKU 1', 'j1')).toBe('/app/ebay-listings/SKU%201?aiVideo=j1#photos');
  });
  it('staged rows and the remote video id', () => {
    const s = stagedVideoOf([{ id: 'd', sku: 'S', media: [
      { id: 'a', kind: 'video', operation: 'upload' }, { id: 'b', kind: 'video', operation: 'upload' }, { id: 'c', kind: 'video', operation: 'delete' }, { id: 'i', kind: 'image', operation: 'upload' },
    ] }], 'S');
    expect([s.draftId, s.upload?.id, s.remove?.id]).toEqual(['d', 'b', 'c']);
    expect(stagedVideoOf([], 'S').draftId).toBeNull();
    expect(ebayRemoteVideoId({ product: { videoIds: ['V1'] } })).toBe('V1');
    expect(ebayRemoteVideoId({ product: {} })).toBeNull();
  });
});

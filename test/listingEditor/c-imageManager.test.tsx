// @vitest-environment jsdom
// M6 editor Group C: Etsy ImageManager `embedded` mode stages with the same draft calls as the legacy grid
// (delete / reorder media ops into the DB draft), shows staged state from EtsyDraftMedia rows, and exposes
// stage() / isDirty() for the editor's one autosave engine. Nothing calls Etsy.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import { cMessages } from './c-messages';

const draftClient = vi.hoisted(() => ({
  fetchEtsyDrafts: vi.fn(),
  stageEtsyDraft: vi.fn(),
  stageEtsyDraftFile: vi.fn(),
}));
vi.mock('@/lib/etsy/draftClient', () => draftClient);

import ImageManager, { type ImageManagerHandle } from '@/components/etsy/ImageManager';
import type { PhotosSummary } from '@/components/domain/listing-editor/sections/photosModel';

const images = [1, 2, 3].map((id) => ({
  listing_image_id: id,
  url_75x75: `https://i.etsystatic.com/${id}.jpg`,
  url_170x135: `https://i.etsystatic.com/${id}.jpg`,
  url_570xN: `https://i.etsystatic.com/${id}.jpg`,
  url_fullxfull: `https://i.etsystatic.com/${id}-full.jpg`,
  rank: id,
  alt_text: id === 1 ? 'Baby&#39;s blanket' : '',
}));

function mount(extra: Partial<React.ComponentProps<typeof ImageManager>> = {}) {
  const ref = createRef<ImageManagerHandle>();
  const onImagesChanged = vi.fn();
  const summaries: PhotosSummary[] = [];
  render(
    <NextIntlClientProvider locale="en" messages={cMessages('en') as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <ConfirmProvider>
          <ImageManager
            ref={ref}
            embedded
            listingId="100"
            shopId="9"
            images={images}
            onImagesChanged={onImagesChanged}
            onSummary={(s) => summaries.push(s)}
            writeAltText={null}
            {...extra}
          />
        </ConfirmProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
  return { ref, onImagesChanged, summaries };
}

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});
beforeEach(() => {
  draftClient.fetchEtsyDrafts.mockReset().mockResolvedValue([
    { status: 'draft', media: [{ id: 'row-del', kind: 'image', operation: 'delete', etsyMediaId: '3' }] },
  ]);
  draftClient.stageEtsyDraft.mockReset().mockImplementation(async (input: { media: unknown[] }) => ({
    status: 'draft',
    media: [{ id: 'row-del', kind: 'image', operation: 'delete', etsyMediaId: '3' }, ...(input.media as object[]).map((m, i) => ({ id: `n${i}`, ...m }))],
  }));
  draftClient.stageEtsyDraftFile.mockReset();
});
afterEach(cleanup);

describe('Etsy ImageManager embedded', () => {
  it('renders the DS strip with the staged delete from the draft and decoded alt text', async () => {
    const { summaries } = mount();
    expect(screen.getByTestId('etsy-photo-strip')).toBeTruthy();
    await screen.findByText('Will be removed');
    expect(draftClient.fetchEtsyDrafts).toHaveBeenCalledWith('9', '100');
    expect(screen.getByRole('listitem', { name: "Photo 1 of 3: Baby's blanket" })).toBeTruthy();
    await waitFor(() => expect(summaries.at(-1)?.count).toBe(2));
    expect(summaries.at(-1)?.changes.removed).toBe(1);
    expect(summaries.at(-1)?.missingAlt).toBe(1);
  });

  it('a photo move is dirty until stage() writes the reorder ops into the draft', async () => {
    const { ref, onImagesChanged } = mount();
    await screen.findByText('Will be removed');
    const first = screen.getByRole('listitem', { name: "Photo 1 of 3: Baby's blanket" });
    first.focus();
    fireEvent.keyDown(first, { key: ' ' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getAllByRole('listitem')[1], { key: ' ' });
    expect(ref.current?.isDirty()).toBe(true);
    await act(async () => { await ref.current?.stage(); });
    expect(draftClient.stageEtsyDraft).toHaveBeenCalledWith({
      shopId: '9',
      listingId: '100',
      media: [
        { kind: 'image', operation: 'reorder', etsyMediaId: 2, rank: 1 },
        { kind: 'image', operation: 'reorder', etsyMediaId: 1, rank: 2 },
      ],
    });
    expect(ref.current?.isDirty()).toBe(false);
    expect(onImagesChanged).toHaveBeenCalled();
  });

  it('removing a photo asks first (no undo route yet), then stages a delete op only', async () => {
    mount();
    await screen.findByText('Will be removed');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 2' }));
    const confirm = await screen.findByRole('button', { name: 'Remove' });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(draftClient.stageEtsyDraft).toHaveBeenCalledWith({
      shopId: '9', listingId: '100', media: [{ kind: 'image', operation: 'delete', etsyMediaId: 2 }],
    }));
  });

  it('with removeStagedMedia, a staged delete can be undone and removal needs no confirm', async () => {
    const removeStagedMedia = vi.fn().mockResolvedValue(undefined);
    mount({ removeStagedMedia });
    await screen.findByText('Will be removed');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(removeStagedMedia).toHaveBeenCalledWith('row-del'));
  });
});

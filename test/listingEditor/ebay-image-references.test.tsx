// @vitest-environment jsdom
// eBay "Generate photo": every listing photo goes to the image model as a reference by default (the AI keeps the
// real product instead of drawing one from the prompt); a photo tapped out of the references is not sent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import en from '@/messages/en.json';
import ImageManager, { type EbayImageManagerHandle } from '@/components/ebay/ImageManager';
import { AI_MAX_REFERENCE_IMAGES } from '@/lib/ai/referenceImages';

const photos = ['https://i.ebayimg.com/images/g/a/s-l1600.jpg', '/api/clawd/serve-image?f=b.jpg', '/api/clawd/serve-image?f=c.jpg'];

function mount(images = photos) {
  const ref = createRef<EbayImageManagerHandle>();
  render(
    <NextIntlClientProvider locale="en" messages={en as never} timeZone="Europe/Istanbul" onError={() => {}}>
      <ThemeProvider theme={theme}>
        <ConfirmProvider>
          <ImageManager ref={ref} images={images} onImagesChanged={vi.fn()} productTitle="Handmade Turkish Iznik ceramic bowl" />
        </ConfirmProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
  return ref;
}

function stubGenerate() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ image_base64: 'AAAA', mime_type: 'image/jpeg' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function generate(ref: React.RefObject<EbayImageManagerHandle | null>) {
  act(() => ref.current?.openGenerate());
  const button = await screen.findByRole('button', { name: en.ebay.imageManager.generateImage });
  await act(async () => fireEvent.click(button));
}

function sentBody(fetchMock: ReturnType<typeof stubGenerate>) {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/ai/generate-image'));
  expect(call).toBeTruthy();
  return JSON.parse(String((call![1] as RequestInit).body));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('eBay generate photo references', () => {
  it('sends every listing photo (cover first) as a reference by default', async () => {
    const fetchMock = stubGenerate();
    const ref = mount();
    await generate(ref);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock).reference_image_urls).toEqual(photos);
  });

  it('leaves out a photo the seller tapped out', async () => {
    const fetchMock = stubGenerate();
    const ref = mount();
    act(() => ref.current?.openGenerate());
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
    fireEvent.click(boxes[1]);
    expect(boxes[1].getAttribute('aria-checked')).toBe('false');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: en.ebay.imageManager.generateImage })));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock).reference_image_urls).toEqual([photos[0], photos[2]]);
  });

  it('caps the references at the model limit', async () => {
    const fetchMock = stubGenerate();
    const many = Array.from({ length: 12 }, (_, i) => `https://i.ebayimg.com/images/g/${i}/s-l1600.jpg`);
    const ref = mount(many);
    await generate(ref);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock).reference_image_urls).toEqual(many.slice(0, AI_MAX_REFERENCE_IMAGES));
  });
});

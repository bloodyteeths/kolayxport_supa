// @vitest-environment jsdom
// M6 editor Group C: photo panel + "Write alt text for N" panel (EN/TR, strict i18n, staging only via callbacks).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { AltTextBatchPanel, PhotoPanel, type PanelMedia } from '@/components/domain/listing-editor/sections/PhotoPanel';
import { cKeys, cMessages, type Locale } from './c-messages';

const LOCALES: Locale[] = ['en', 'tr'];

function renderC(ui: ReactElement, locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={cMessages(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
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
afterEach(cleanup);

const photo = (over: Partial<Extract<PanelMedia, { kind: 'photo' }>> = {}): PanelMedia => ({
  kind: 'photo', id: 'img:1', src: 'https://i.etsystatic.com/1.jpg', fullSrc: 'https://i.etsystatic.com/1-full.jpg',
  alt: '', position: 2, total: 5, pending: false, removing: false, ...over,
});

const k = (locale: Locale) => cKeys[locale] as unknown as { photos: Record<string, string>; ai: Record<string, string>; banner: Record<string, string> };

describe.each(LOCALES)('PhotoPanel (%s)', (locale) => {
  it('edits alt text and stages it only through onSave (decoded, trimmed)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderC(
      <PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={photo()} alt={{ editable: true, onSave }} onMakePrimary={() => {}} onReplace={() => {}} onRemove={() => {}} />,
      locale,
    );
    expect(screen.getByText(k(locale).photos.panelTitle.replace('{position}', '2').replace('{total}', '5'))).toBeTruthy();
    const save = screen.getByRole('button', { name: k(locale).photos.saveAlt });
    expect(save.hasAttribute('disabled') || save.getAttribute('aria-disabled') === 'true').toBe(true);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: '  Mom&#39;s   blanket  ' } });
    fireEvent.click(screen.getByRole('button', { name: k(locale).photos.saveAlt }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Mom's blanket"));
    expect(screen.getByRole('button', { name: k(locale).photos.makePrimary })).toBeTruthy();
    expect(screen.getByRole('button', { name: k(locale).photos.replace })).toBeTruthy();
  });

  it('a failed alt save keeps the typed text and raises no unhandled rejection', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('stage failed'));
    renderC(<PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={photo()} alt={{ editable: true, onSave }} />, locale);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pink blanket' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: k(locale).photos.saveAlt })); });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Pink blanket'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Pink blanket');
  });

  it('shows an AI proposal under the field; Use fills the field, nothing is saved by itself', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockResolvedValue('Pink personalized baby blanket folded on a white chair');
    renderC(<PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={photo()} alt={{ editable: true, onSave, write }} />, locale);
    fireEvent.click(screen.getByRole('button', { name: k(locale).photos.writeAltOne }));
    await screen.findByText('Pink personalized baby blanket folded on a white chair');
    expect(onSave).not.toHaveBeenCalled();
    const use = screen.getAllByRole('button').find((b) => b.textContent && /^(Use|Kullan)$/.test(b.textContent.trim()));
    expect(use).toBeTruthy();
    fireEvent.click(use as HTMLElement);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Pink personalized baby blanket folded on a white chair');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a staged upload cannot take alt text yet and cannot be made primary', () => {
    renderC(
      <PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={photo({ pending: true })} alt={{ editable: false, onSave: vi.fn() }} onMakePrimary={() => {}} />,
      locale,
    );
    expect(screen.getByText(k(locale).photos.pendingNote)).toBeTruthy();
    expect(screen.queryByRole('button', { name: k(locale).photos.makePrimary })).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('a photo staged for removal says so and offers Undo only when it can be undone', () => {
    const undo = vi.fn();
    const { unmount } = renderC(
      <PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={photo({ removing: true })} onRemove={() => {}} onUndoRemove={undo} />,
      locale,
    );
    expect(screen.getByText(k(locale).photos.willRemoveOnSend.replace('{marketplace}', 'Etsy'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: k(locale).banner.undo }));
    expect(undo).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: k(locale).photos.remove })).toBeNull();
    unmount();
    renderC(<PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={photo({ removing: true })} />, locale);
    expect(screen.queryByRole('button', { name: k(locale).banner.undo })).toBeNull();
  });

  it('renders a video with the player and no alt text field', () => {
    const { container } = renderC(
      <PhotoPanel open onClose={() => {}} marketplaceName="Etsy" media={{ kind: 'video', src: '/v.mp4', pending: false, removing: false }} onReplace={() => {}} onRemove={() => {}} />,
      locale,
    );
    expect(document.querySelector('video')).toBeTruthy();
    expect(container.ownerDocument.querySelector('textarea')).toBeNull();
  });
});

describe.each(LOCALES)('AltTextBatchPanel (%s)', (locale) => {
  it('writes one proposal per photo and stages them only on Use all', async () => {
    const write = vi.fn(async (item: { id: string }) => `Alt for ${item.id}`);
    const onUse = vi.fn().mockResolvedValue(undefined);
    renderC(
      <AltTextBatchPanel
        open
        onClose={() => {}}
        marketplaceName="Etsy"
        items={[{ id: 'img:1', src: '/1.jpg', position: 1 }, { id: 'img:2', src: '/2.jpg', position: 3 }]}
        write={write}
        onUse={onUse}
      />,
      locale,
    );
    await screen.findByText('Alt for img:2');
    expect(write).toHaveBeenCalledTimes(2);
    expect(onUse).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: k(locale).ai.useAll }));
    });
    expect(onUse).toHaveBeenCalledWith([{ id: 'img:1', alt: 'Alt for img:1' }, { id: 'img:2', alt: 'Alt for img:2' }]);
    await screen.findByText(k(locale).photos.altBatchDone);
  });

  it('Use on one photo keeps the other proposals and does not ask the AI again', async () => {
    const write = vi.fn(async (item: { id: string }) => `Alt for ${item.id}`);
    const all = [{ id: 'img:1', src: '/1.jpg', position: 1 }, { id: 'img:2', src: '/2.jpg', position: 2 }];
    function Harness() {
      // Like ImageManager: a photo that gets alt text leaves `items`.
      const [items, setItems] = useState(all);
      return (
        <AltTextBatchPanel
          open
          onClose={() => {}}
          marketplaceName="Etsy"
          items={items}
          write={write}
          onUse={async (accepted) => { setItems((cur) => cur.filter((i) => !accepted.some((a) => a.id === i.id))); }}
        />
      );
    }
    renderC(<Harness />, locale);
    await screen.findByText('Alt for img:2');
    expect(write).toHaveBeenCalledTimes(2);
    const useButtons = screen.getAllByRole('button').filter((b) => !b.hasAttribute('disabled') && /^(Use|Kullan)$/.test(b.textContent?.trim() ?? ''));
    await act(async () => { fireEvent.click(useButtons[0]); });
    await waitFor(() => expect(screen.queryByText('Alt for img:1')).toBeNull());
    expect(screen.getByText('Alt for img:2')).toBeTruthy();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('a failed suggestion shows the inline error and can be retried', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('Second try');
    renderC(
      <AltTextBatchPanel open onClose={() => {}} marketplaceName="Etsy" items={[{ id: 'img:1', src: '/1.jpg', position: 1 }]} write={write} onUse={vi.fn()} />,
      locale,
    );
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const retry = await screen.findByRole('button', { name: /Try again|Tekrar dene/ });
    fireEvent.click(retry);
    await screen.findByText('Second try');
  });
});

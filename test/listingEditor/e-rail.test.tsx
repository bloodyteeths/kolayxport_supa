// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RailHealth, computeListingHealth, etsyScoreInputFromSource } from '@/components/domain/listing-editor/RailHealth';
import { RailChanges, type RailChangeItem } from '@/components/domain/listing-editor/RailChanges';
import { RailHistory, useSendHistory } from '@/components/domain/listing-editor/RailHistory';
import { LOCALES, Providers, html, intlErrors, text } from './e-render';

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; });
afterEach(() => { expect(intlErrors).toEqual([]); vi.restoreAllMocks(); });

const draft = {
  title: 'Personalized Baby Blanket, Custom Name Gift',
  description: 'Short.',
  tags: ['soft knit throw', 'shower present', 'room decor'],
  images: [{ alt: 'a' }, { alt: '' }, { alt: 'b' }, { alt: 'c' }, { alt: 'd' }, { alt: 'e' }],
  hasVideo: false,
  materials: ['cotton'],
};
const sent = { ...draft, tags: [], images: [{ alt: '' }] };

describe.each(LOCALES)('RailHealth (%s)', (locale) => {
  it('header: sent score → draft score after send, denominator, open checks with fixes', () => {
    const health = computeListingHealth('etsy', draft, sent);
    const out = text(<RailHealth health={health} onFix={() => {}} />, locale);
    const markup = html(<RailHealth health={health} onFix={() => {}} />, locale);
    expect(out).toContain(`${health.score} / 100`);
    if (locale === 'en') {
      expect(out).toContain(`${health.score} → ${health.afterScore} after you send`);
      expect(out).toMatch(/Scored on \d+ of 12 checks/);
      expect(out).toContain('Add photos');
    } else {
      expect(out).toContain('İlan sağlığı');
      expect(out).toContain('Fotoğraf ekle');
    }
    // No research → price check is a neutral n/a row (never a warning / orange corner banner).
    expect(markup).toMatch(/data-check-id="price_market" data-status="na"/);
  });

  it('empty create workspace: no number, the empty line, no list of n/a rows', () => {
    const out = text(<RailHealth health={computeListingHealth('etsy', {}, null)} onFix={() => {}} />, locale);
    expect(out).toContain(locale === 'en' ? 'Add a photo and a title to get a score' : 'Puan için bir fotoğraf ve başlık ekleyin');
    expect(out).toContain(locale === 'en' ? 'Scored on 0 of 12 checks' : '12 kontrolün 0 tanesiyle puanlandı');
    expect(out).not.toContain('/ 100');
  });

  it('real create form (empty values, profiles loaded): still the empty line, no tiny score', () => {
    const createInput = etsyScoreInputFromSource({
      title: '', description: '', tags: [], materials: [], photos: [], shippingLoaded: true,
      shippingProfileId: null, processingMin: null, readinessStateId: null, itemWeight: null, price: null, market: null,
    });
    const health = computeListingHealth('etsy', createInput, null);
    expect(health.score).toBeNull();
    const out = text(<RailHealth health={health} onFix={() => {}} />, locale);
    expect(out).toContain(locale === 'en' ? 'Add a photo and a title to get a score' : 'Puan için bir fotoğraf ve başlık ekleyin');
    expect(out).not.toContain('/ 100');
    expect(out).not.toMatch(/Scored on|puanlandı/);
    expect(computeListingHealth('ebay', { title: '', imageCount: 0 }, null).score).toBeNull();
    // A title alone is enough to start scoring.
    expect(computeListingHealth('etsy', etsyScoreInputFromSource({ title: 'Wooden keepsake box', photos: [], shippingLoaded: true }), null).score).not.toBeNull();
  });

  it('a fix is handed back to the editor, nothing else happens', () => {
    const onFix = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<Providers locale={locale}><RailHealth health={computeListingHealth('etsy', draft, null)} onFix={onFix} /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add photos' : 'Fotoğraf ekle' }));
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ id: 'photos_count' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

const changes: RailChangeItem[] = [
  { id: 'title', group: 'title' },
  { id: 'tags', group: 'tags', added: 2, removed: 1 },
  { id: 'photoOrder', group: 'photoOrder' },
  { id: 'q-delete', queuedAction: 'delete' },
  { id: 'q-deact', queuedAction: 'deactivate', revertable: false },
];

describe.each(LOCALES)('RailChanges (%s)', (locale) => {
  it('lists groups with detail, queued delete first, count in the title', () => {
    const out = text(<RailChanges marketplace="etsy" changes={changes} onRevert={() => {}} />, locale);
    if (locale === 'en') {
      expect(out.startsWith('Not sent yet (5) Delete listing Removes the listing from Etsy when you send')).toBe(true);
      expect(out).toContain('Tags 2 added, 1 removed');
      expect(out).toContain('Photo order');
      expect(out).toContain('Deactivate on Etsy');
    } else {
      expect(out.startsWith('Henüz gönderilmedi (5) İlanı sil')).toBe(true);
      expect(out).toContain('2 eklendi, 1 kaldırıldı');
      expect(out).toContain('Etsy ilanını pasifleştir');
    }
  });

  it('Revert returns the row to the editor; non-revertable rows have no button', () => {
    const onRevert = vi.fn();
    render(<Providers locale={locale}><RailChanges marketplace="etsy" changes={changes} onRevert={onRevert} /></Providers>);
    const label = locale === 'en' ? 'Revert Tags' : 'Etiketler değişikliğini geri al';
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onRevert).toHaveBeenCalledWith(expect.objectContaining({ id: 'tags' }));
    expect(screen.getAllByRole('button', { name: locale === 'en' ? /^Revert / : /geri al$/ })).toHaveLength(4);
  });

  it('empty and create-mode "needed" states', () => {
    expect(text(<RailChanges marketplace="ebay" changes={[]} />, locale))
      .toContain(locale === 'en' ? 'No changes waiting to be sent' : 'Gönderilmeyi bekleyen değişiklik yok');
    const onSelect = vi.fn();
    render(
      <Providers locale={locale}>
        <RailChanges marketplace="etsy" changes={[]} needed={[{ id: 'title', labelKey: 'listingEditor.changes.group.title', onSelect }]} />
      </Providers>,
    );
    expect(screen.getByText(locale === 'en' ? 'Needed before sending (1)' : 'Göndermeden önce gerekli (1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Title' : 'Başlık' }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe.each(LOCALES)('RailHistory (%s)', (locale) => {
  it('attempts + sent drafts as a timeline, causes translated, never raw', () => {
    const out = text(
      <RailHistory
        marketplace="etsy"
        attempts={[{ id: '1', status: 'failed', startedAt: '2026-10-11T10:00:00Z', error: 'Invalid taxonomy_id 999' }]}
        sent={[{ id: 'd', syncedAt: '2026-10-12T10:00:00Z', changedKeys: ['title', 'tags', 'price'] }]}
      />,
      locale,
    );
    expect(out).not.toContain('taxonomy_id');
    if (locale === 'en') {
      expect(out).toContain('Recent sends');
      expect(out).toContain('Sent · 3 fields');
      expect(out).toContain('Failed · The marketplace rejected a value');
      expect(out.indexOf('Sent · 3 fields')).toBeLessThan(out.indexOf('Failed'));
    } else {
      expect(out).toContain('Son gönderimler');
      expect(out).toContain('Gönderildi · 3 alan');
      expect(out).toContain('Başarısız ·');
    }
  });

  it('empty, loading and error states', () => {
    expect(text(<RailHistory marketplace="etsy" />, locale))
      .toContain(locale === 'en' ? 'Nothing sent from KolayXport yet' : 'KolayXport’tan henüz gönderim yapılmadı');
    expect(text(<RailHistory marketplace="etsy" loading />, locale)).not.toMatch(/Nothing sent|henüz gönderim/);
    const onRetry = vi.fn();
    render(<Providers locale={locale}><RailHistory marketplace="etsy" error onRetry={onRetry} /></Providers>);
    expect(screen.getByText(locale === 'en' ? "Couldn't load recent sends" : 'Son gönderimler yüklenemedi')).toBeTruthy();
  });
});

function HistoryProbe(props: { listingId: string | null; marketplace?: 'etsy' | 'ebay' }) {
  const h = useSendHistory({ marketplace: props.marketplace ?? 'etsy', shopId: '42', listingId: props.listingId });
  return <span data-testid="probe">{JSON.stringify({ n: h.sent.length, loading: h.loading, error: h.error })}</span>;
}

describe('useSendHistory', () => {
  it('fetches the history route for an Etsy listing and parses it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ drafts: [{ id: 'd', syncedAt: '2026-10-12T10:00:00Z', changedKeys: ['title'] }] }), { status: 200 }),
    );
    render(<HistoryProbe listingId="1488223311" />);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('{"n":1,"loading":false,"error":false}'));
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/etsy-drafts/history?shop_id=42&listing_id=1488223311&limit=3');
  });

  it('reports errors; no request for eBay or a new (negative id) listing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    render(<HistoryProbe listingId="7" />);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"error":true'));
    cleanup();
    fetchSpy.mockClear();
    render(<HistoryProbe listingId="-3" />);
    render(<HistoryProbe listingId="9" marketplace="ebay" />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

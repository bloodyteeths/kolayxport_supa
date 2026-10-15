// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ScoreMeter, cellSegments, panelSegments } from '@/components/ds/data/ScoreMeter';
import { ScorePanel } from '@/components/ds/data/ScorePanel';
import { scoreEtsyListing } from '@/lib/listingScore/etsy';
import { finalizeScore } from '@/lib/listingScore/types';
import { LOCALES, Providers, intlErrors, text } from './m1d-render';

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; });
afterEach(() => { expect(intlErrors).toEqual([]); });

const result = scoreEtsyListing({
  title: 'Personalized Baby Blanket, Custom Name Gift',
  description: 'Short.',
  tags: ['soft knit throw', 'shower present', 'room decor', 'swaddle wrap', 'crib accessory', 'heirloom keepsake'],
  images: [{ alt: 'a' }, { alt: '' }, { alt: 'b' }, { alt: null }, { alt: 'c' }, { alt: 'd' }],
  hasVideo: false,
  materials: ['cotton'],
});

describe('ScoreMeter segments', () => {
  it('cell: 5 segments by band; panel: great = full bar', () => {
    expect([10, 34, 61, 78, 95].map(cellSegments)).toEqual([1, 2, 3, 4, 5]);
    expect([0, 45, 78, 89, 90].map(panelSegments)).toEqual([0, 5, 8, 9, 10]);
  });
});

describe.each(LOCALES)('ScoreMeter (%s)', (locale) => {
  it('cell shows the number and band tooltip label', () => {
    const out = text(<ScoreMeter variant="cell" score={78} checksUsed={9} checksTotal={12} />, locale);
    expect(out).toContain('78');
  });

  it('null renders a dash, not a fake number', () => {
    const out = text(<ScoreMeter variant="cell" score={null} />, locale);
    expect(out).toBe('—');
  });

  it('panel states the denominator and band', () => {
    const out = text(<ScoreMeter variant="panel" score={78} checksUsed={9} checksTotal={12} afterScore={86} />, locale);
    if (locale === 'en') {
      expect(out).toContain('Listing health');
      expect(out).toContain('78 / 100');
      expect(out).toContain('Good');
      expect(out).toContain('Scored on 9 of 12 checks');
      expect(out).toContain('78 → 86 after you send');
    } else {
      expect(out).toContain('İlan sağlığı');
      expect(out).toContain('İyi');
      expect(out).toContain('12 kontrolün 9 tanesiyle puanlandı');
    }
  });
});

describe.each(LOCALES)('ScorePanel (%s)', (locale) => {
  it('lists open checks with gain and fix, collapses passes, shows n/a with reason', () => {
    const out = text(<ScorePanel result={result} onFix={() => {}} />, locale);
    if (locale === 'en') {
      expect(out).toContain('Only 6 photos: add 4 more');
      expect(out).toContain('Add photos');
      expect(out).toContain('2 photos without alt text');
      expect(out).toContain('No research data');
      expect(out).toMatch(/\d+ checks? pass/);
      expect(out).toContain('n/a');
    } else {
      expect(out).toContain('Yalnızca 6 fotoğraf: 4 tane daha ekleyin');
      expect(out).toContain('Fotoğraf ekle');
      expect(out).toContain('Araştırma verisi yok');
      expect(out).toContain('kontrol geçti');
    }
    expect(out).toMatch(/\+\d+/);
  });

  it('calls onFix with the check and expands passes', () => {
    const onFix = vi.fn();
    render(<Providers locale={locale}><ScorePanel result={result} onFix={onFix} /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Add photos' : 'Fotoğraf ekle' }));
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ id: 'photos_count' }));
    const passes = screen.getByRole('button', { name: locale === 'en' ? /pass · Show/ : /geçti · Göster/ });
    fireEvent.click(passes);
    expect(document.querySelectorAll('[data-status="pass"]').length).toBeGreaterThan(0);
  });

  it('peer checks render in their own group; no-data result says so', () => {
    const peers = finalizeScore([
      ...result.checks,
      { id: 'price_vs_peers', label: 'listingScore.etsy.priceMarket.outside', status: 'fail', impact: 7, group: 'peers' },
    ]);
    const out = text(<ScorePanel result={peers} onFix={() => {}} />, locale);
    expect(out).toContain(locale === 'en' ? 'Compared with peers' : 'Rakiplerle karşılaştırma');
    const empty = text(<ScorePanel result={finalizeScore([])} onFix={() => {}} />, locale);
    expect(empty).toContain(locale === 'en' ? 'Not enough data to score' : 'yeterli veri yok');
  });
});

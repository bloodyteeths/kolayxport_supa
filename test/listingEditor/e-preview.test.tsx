// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MarketplacePreview, type PreviewModel } from '@/components/domain/MarketplacePreview';
import { EtsySearchCard } from '@/components/domain/preview/EtsySearchCard';
import { EtsyListingPage } from '@/components/domain/preview/EtsyListingPage';
import { EbaySearchRow } from '@/components/domain/preview/EbaySearchRow';
import { EbayItemPage } from '@/components/domain/preview/EbayItemPage';
import { LOCALES, Providers, html, intlErrors, text } from './e-render';

afterEach(cleanup);
beforeEach(() => { intlErrors.length = 0; });
afterEach(() => { expect(intlErrors).toEqual([]); });

const etsy: PreviewModel = {
  title: 'Personalized Baby Blanket, Custom Name Blanket, Newborn Gift for one&#39;s little girl, Monogram',
  description: 'Wrap your little one&#39;s nursery in soft cotton.\n\nHand embroidered.\nMade in our studio.\nFourth line here.',
  price: 69.99,
  currency: 'USD',
  images: [{ url: 'https://i.etsystatic.com/1.jpg', alt: 'Pink blanket' }, { url: 'https://i.etsystatic.com/2.jpg' }],
  shopName: 'Belle Couture Gifts',
  variations: [{ name: 'Color', options: ['Pink', 'Blue'] }],
  personalization: { instructions: 'Enter the name', required: true, charLimit: 20 },
  madeToOrder: true,
  processingDays: { min: 1, max: 3 },
};

const ebay: PreviewModel = {
  title: 'Vintage Brass Compass Nautical Pocket Gift Antique Style',
  subtitle: 'Ships fast',
  description: '<p>Solid brass.</p><script>alert(1)</script>',
  price: 24.5,
  currency: 'USD',
  images: [{ url: 'https://i.ebayimg.com/1.jpg' }],
  condition: 'New',
  specifics: Array.from({ length: 10 }, (_, i) => ({ name: `Aspect ${i + 1}`, value: `Value ${i + 1}` })),
};

describe.each(LOCALES)('Etsy preview (%s)', (locale) => {
  it('search card: decoded title, price, shop; no invented stars, reviews or badges', () => {
    const out = text(<EtsySearchCard listing={etsy} device="desktop" />, locale);
    expect(out).toContain("one's little girl");
    expect(out).not.toContain('&#39;');
    expect(out).toContain(locale === 'en' ? '$69.99' : '$69,99');
    expect(out).toContain('Belle Couture Gifts');
    expect(out).not.toMatch(/★|review|bestseller|değerlendirme|çok satan|free shipping|ücretsiz kargo/i);
  });

  it('search card on mobile shows only the ~55 characters Etsy shows', () => {
    const out = text(<EtsySearchCard listing={etsy} device="mobile" />, locale);
    expect(out).toContain('Personalized Baby Blanket, Custom Name Blanket, Newborn…');
    expect(out).not.toContain('Monogram');
  });

  it('listing page: variation select, personalization, processing, 3 description lines + learn more', () => {
    const out = text(<EtsyListingPage listing={etsy} device="desktop" />, locale);
    expect(out).toContain('Color');
    expect(out).toContain('Enter the name');
    expect(out).toContain("one's nursery");
    expect(out).toContain('Made in our studio.');
    expect(out).not.toContain('Fourth line here.');
    if (locale === 'en') {
      expect(out).toContain('Select an option');
      expect(out).toContain('Add your personalization');
      expect(out).toContain('20 characters max');
      expect(out).toContain('Made to order · Ready to ship in 1–3 business days');
      expect(out).toContain('Learn more about this item');
    } else {
      expect(out).toContain('Bir seçenek belirleyin');
      expect(out).toContain('En fazla 20 karakter');
      expect(out).toContain('1–3 iş günü içinde kargoya hazır');
      expect(out).toContain('Bu ürün hakkında daha fazla bilgi');
    }
  });

  it('variation price range renders min–max', () => {
    const out = text(<EtsySearchCard listing={{ ...etsy, priceRange: { min: 54, max: 79 } }} device="desktop" />, locale);
    expect(out).toMatch(locale === 'en' ? /\$54\.00 ?– ?\$79\.00/ : /\$54,00 ?– ?\$79,00/);
  });

  it('create mode: placeholder title, grey photo, no price', () => {
    const out = text(<EtsySearchCard listing={{ title: '', images: [] }} device="desktop" />, locale);
    expect(out).toBe(locale === 'en' ? 'Your title appears here' : 'Başlığınız burada görünür');
  });

  it('unknown shop currency: bare number, never a guessed $', () => {
    const out = text(<EtsySearchCard listing={{ title: 'Box', images: [], price: 24.5, currency: null }} device="desktop" />, locale);
    expect(out).toContain(locale === 'en' ? '24.50' : '24,50');
    expect(out).not.toMatch(/\$|US\$|USD/);
  });
});

describe.each(LOCALES)('eBay preview (%s)', (locale) => {
  it('search row: condition, price; free shipping only when known', () => {
    const unknown = text(<EbaySearchRow listing={ebay} device="desktop" />, locale);
    expect(unknown).toContain('New');
    expect(unknown).toContain(locale === 'en' ? '$24.50' : '$24,50');
    expect(unknown).not.toMatch(/free shipping|ücretsiz kargo/i);
    const free = text(<EbaySearchRow listing={{ ...ebay, freeShipping: true }} device="desktop" />, locale);
    expect(free).toMatch(locale === 'en' ? /Free shipping/ : /Ücretsiz kargo/);
  });

  it('item page: first 8 specifics, subtitle, sandboxed sanitized description', () => {
    const markup = html(<EbayItemPage listing={ebay} device="desktop" />, locale);
    const out = text(<EbayItemPage listing={ebay} device="desktop" />, locale);
    expect(out).toContain('Aspect 8');
    expect(out).not.toContain('Aspect 9');
    expect(out).toContain('Ships fast');
    expect(markup).toMatch(/<iframe[^>]*sandbox=""/);
    expect(markup).not.toContain('alert(1)');
  });
});

describe.each(LOCALES)('MarketplacePreview (%s)', (locale) => {
  it('switches surface and device, shows the mobile cut hint and the honesty caption', () => {
    render(<Providers locale={locale}><MarketplacePreview marketplace="etsy" listing={etsy} /></Providers>);
    expect(screen.getByTestId('etsy-search-card')).toBeTruthy();
    const hint = screen.getByTestId('preview-hint').textContent ?? '';
    expect(hint).toContain('55');
    expect(hint).toContain('Personalized Baby Blanket, Custom Name Blanket, Newborn');
    expect(document.body.textContent).toMatch(locale === 'en' ? /Preview\. Etsy's exact layout may differ/ : /Etsy sayfasındaki gerçek görünüm farklı olabilir/);

    fireEvent.click(screen.getByRole('radio', { name: locale === 'en' ? 'Listing' : 'İlan sayfası' }));
    expect(screen.getByTestId('etsy-listing-page')).toBeTruthy();
    expect(screen.queryByTestId('preview-show-crop')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: locale === 'en' ? 'Mobile' : 'Mobil' }));
    expect(screen.getByTestId('etsy-listing-page').getAttribute('data-device')).toBe('mobile');
  });

  it('forceDevice hides the device switch (mobile sheet)', () => {
    render(<Providers locale={locale}><MarketplacePreview marketplace="ebay" listing={ebay} forceDevice="mobile" /></Providers>);
    expect(screen.getByTestId('ebay-search-row').getAttribute('data-device')).toBe('mobile');
    expect(screen.queryByRole('radio', { name: locale === 'en' ? 'Desktop' : 'Masaüstü' })).toBeNull();
    expect(screen.queryByTestId('preview-hint')).toBeNull();
  });

  it('text is debounced 150 ms, photos update at once', async () => {
    const { rerender } = render(<Providers locale={locale}><MarketplacePreview marketplace="etsy" listing={etsy} /></Providers>);
    const next: PreviewModel = { ...etsy, title: 'Brand New Title', images: [{ url: 'https://i.etsystatic.com/9.jpg' }] };
    rerender(<Providers locale={locale}><MarketplacePreview marketplace="etsy" listing={next} /></Providers>);
    expect(screen.getByTestId('etsy-card-title').textContent).not.toContain('Brand New Title');
    expect(screen.getByTestId('etsy-card-photo').querySelector('img')?.getAttribute('src')).toBe('https://i.etsystatic.com/9.jpg');
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.getByTestId('etsy-card-title').textContent).toContain('Brand New Title');
  });

  it('Show crop renders the whole photo with the crop outline once it loads', () => {
    render(<Providers locale={locale}><MarketplacePreview marketplace="etsy" listing={etsy} /></Providers>);
    fireEvent.click(screen.getByRole('checkbox'));
    const img = screen.getByTestId('etsy-card-photo').querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 1000 });
    Object.defineProperty(img, 'naturalHeight', { value: 1000 });
    fireEvent.load(img);
    const outline = screen.getByTestId('etsy-crop-outline');
    expect(outline).toBeTruthy();
    expect(img.style.objectFit).toBe('contain');
  });
});

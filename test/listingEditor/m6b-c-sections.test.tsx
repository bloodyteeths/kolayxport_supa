// @vitest-environment jsdom
// M6b-C CatalogBasicSections (Photos, Title & description for Trendyol / Wix / Shopify) in a fake editor context,
// EN + TR with strict i18n (a missing key throws), plus the i18n coverage of every key the M6b-C files use.
import fs from 'fs';
import path from 'path';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import type { DraftSection, FieldMap } from '@/lib/listingEditor/types';
import {
  CatalogPhotosSection,
  CatalogTitleSection,
  capCatalogImages,
  catalogPhotoLimit,
} from '@/components/domain/listing-editor/sections/CatalogBasicSections';
import { M6BC_KEYS, withM6bC, type Locale } from './m6b-c-messages';

vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() }, default: { error: vi.fn(), success: vi.fn() } }));

function makeCtx(marketplace: 'trendyol' | 'wix' | 'shopify', fields: FieldMap, opts: { issues?: unknown[]; mode?: 'edit' | 'create' } = {}) {
  const setField = vi.fn();
  const sections: DraftSection[] = [];
  const value = {
    marketplace,
    marketplaceName: marketplace === 'trendyol' ? 'Trendyol' : marketplace === 'wix' ? 'Wix' : 'Shopify',
    mode: opts.mode ?? 'edit',
    ctx: { shopId: 's1', listingId: 'P-1' },
    view: { marketplace, mode: opts.mode ?? 'edit', fields, meta: { id: 'P-1', currency: null, images: [], raw: {}, url: null }, facts: {} },
    remote: fields,
    draft: null,
    changes: [],
    issues: opts.issues ?? [],
    defaultsApplied: [],
    readOnly: false,
    setField,
    setFields: vi.fn(),
    revert: vi.fn(),
    isFieldDirty: () => false,
    register: (s: DraftSection) => {
      sections.push(s);
      return () => undefined;
    },
    stageActions: vi.fn(),
    saveNow: vi.fn(async () => true),
    reportFacts: vi.fn(),
    notifyChange: vi.fn(),
  } as unknown as ListingEditorContextValue;
  return { value, setField, sections };
}

function renderIn(ui: React.ReactElement, ctx: ListingEditorContextValue, locale: Locale) {
  return render(
    <NextIntlClientProvider locale={locale} messages={withM6bC(locale) as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <ThemeProvider theme={theme}>
        <ListingEditorContext.Provider value={ctx}>{ui}</ListingEditorContext.Provider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe.each(['en', 'tr'] as Locale[])('CatalogTitleSection (%s)', (locale) => {
  it('shows the marketplace title limit and writes through setField only', () => {
    const { value, setField } = makeCtx('trendyol', { title: 'Kutu', description: '<p>Bir iki</p>' });
    renderIn(<CatalogTitleSection />, value, locale);
    expect(screen.getByText('4 / 100')).toBeTruthy();
    fireEvent.change(screen.getByTestId('le-catalog-title-input').querySelector('input') ?? screen.getByTestId('le-catalog-title-input'), { target: { value: 'Yeni başlık' } });
    expect(setField).toHaveBeenCalledWith('title', 'Yeni başlık');
  });
  it('renders a field issue inline (server key + params)', () => {
    const { value } = makeCtx('wix', { title: '', description: '' }, {
      issues: [{ field: 'title', section: 'title', severity: 'block_save', key: 'listings.draftError.invalidTitle', params: { max: 80 } }],
    });
    renderIn(<CatalogTitleSection />, value, locale);
    expect(screen.getByText('0 / 80')).toBeTruthy();
  });
  it('description has Edit / Preview; the preview is a sandboxed frame (no scripts)', () => {
    const { value } = makeCtx('wix', { title: 'x', description: '<p>Hi</p><script>alert(1)</script>' });
    renderIn(<CatalogTitleSection />, value, locale);
    fireEvent.click(screen.getByRole('radio', { name: locale === 'en' ? 'Preview' : 'Önizleme' }));
    const frame = screen.getByTestId('le-catalog-description-preview') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<p>Hi</p>');
  });
});

describe('catalog photo limits', () => {
  const many = Array.from({ length: 20 }, (_, i) => `https://static.wixstatic.com/media/${i}.jpg`);
  it('a Wix product with more than 15 photos keeps all of them on reorder / remove', () => {
    const reordered = [many[1], many[0], ...many.slice(2, 19)];
    expect(capCatalogImages(reordered, many, 'wix')).toEqual(reordered);
    expect(catalogPhotoLimit(reordered, many, 'wix')).toBe(19 + 15);
  });
  it('caps only new photos: Wix 15 per send, Trendyol 8 per product', () => {
    const fresh = Array.from({ length: 18 }, (_, i) => `https://n.example/${i}.jpg`);
    expect(capCatalogImages([...many, ...fresh], many, 'wix')).toHaveLength(20 + 15);
    expect(capCatalogImages(fresh, [], 'trendyol')).toHaveLength(8);
    expect(capCatalogImages(fresh.slice(0, 5), fresh.slice(0, 3), 'trendyol')).toHaveLength(5);
  });
});

describe.each(['en', 'tr'] as Locale[])('CatalogPhotosSection (%s)', (locale) => {
  it('renders the strip with the marketplace limit and registers the upload guard', () => {
    const { value, sections } = makeCtx('shopify', { title: 'x', images: ['https://cdn.shopify.com/1.jpg'] });
    renderIn(<CatalogPhotosSection banner={<div data-testid="banner" />} />, value, locale);
    expect(screen.getByTestId('le-section-photos')).toBeTruthy();
    expect(screen.getByTestId('banner')).toBeTruthy();
    expect(sections.map((s) => s.key)).toContain('photos:images');
    expect(sections[0].isDirty()).toBe(false);
  });
});

describe('i18n coverage of the M6b-C files', () => {
  const files = [
    'components/domain/listing-editor/adapters/catalog.ts',
    'components/domain/listing-editor/adapters/trendyol.ts',
    'components/domain/listing-editor/adapters/wix.ts',
    'components/domain/listing-editor/adapters/shopify.ts',
    'components/domain/listing-editor/CatalogEditorRoute.tsx',
    'components/domain/listing-editor/sections/CatalogBasicSections.tsx',
    'components/domain/listing-editor/CatalogCopyPicker.tsx',
    'components/domain/listing-editor/catalogSectionMap.tsx',
    'lib/listingEditor/sections.ts',
  ];
  const get = (tree: unknown, key: string) => key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), tree);
  it.each(['en', 'tr'] as Locale[])('every full key and listingEditor t() key exists (%s)', (locale) => {
    const messages = withM6bC(locale);
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
      for (const m of Array.from(src.matchAll(/'((?:listings|listingEditor)\.[A-Za-z0-9_.]+)'/g))) {
        if (typeof get(messages, m[1]) !== 'string') missing.push(`${f}: ${m[1]}`);
      }
      if (f.endsWith('.tsx')) {
        for (const m of Array.from(src.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g))) {
          if (typeof get(messages, `listingEditor.${m[1]}`) !== 'string') missing.push(`${f}: listingEditor.${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
  it.each(['en', 'tr'] as Locale[])('connect title uses the marketplace select (Turkish suffixes) (%s)', (locale) => {
    const tr = createTranslator({ locale, messages: withM6bC(locale) as never, namespace: 'listingEditor' as never });
    const out = ['trendyol', 'wix', 'shopify'].map((m) => (tr as unknown as (k: string, v: Record<string, string>) => string)('catalog.connectTitle', { marketplace: m }));
    if (locale === 'tr') expect(out).toEqual(["Ürünlerinizi düzenlemek için Trendyol'u bağlayın", "Ürünlerinizi düzenlemek için Wix'i bağlayın", "Ürünlerinizi düzenlemek için Shopify'ı bağlayın"]);
    else expect(out[1]).toBe('Connect Wix to edit your products');
  });
  it('returns EN and TR for every new key', () => {
    for (const [k, [e, t]] of Object.entries(M6BC_KEYS)) {
      expect(e.trim(), k).not.toBe('');
      expect(t.trim(), k).not.toBe('');
    }
  });
});

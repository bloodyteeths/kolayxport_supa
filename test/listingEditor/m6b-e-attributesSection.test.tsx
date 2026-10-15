// @vitest-environment jsdom
// M6b-E × M6b-D: `useListingAI('trendyol')` mounted together with `TrendyolAttributesSection` through the
// `aiAttributes={attributesAiFrom(ai)}` hand-off. The section's ✦ button calls `run()` with no argument; the hook loads
// the category attributes, asks the AI and shows proposals; nothing is written until the seller presses Use, and
// nothing is sent (only the metadata GET and the AI POST are requested).
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/lib/theme';
import { ListingEditorContext, type ListingEditorContextValue } from '@/components/domain/listing-editor/useListingDraft';
import type { FieldMap } from '@/lib/listingEditor/types';
import { TrendyolAttributesSection } from '@/components/domain/listing-editor/sections/TrendyolAttributesSection';
import { attributesAiFrom, useListingAI } from '@/components/domain/listing-editor/useListingAI';
import { mergeMessages } from './h-messages';
import { withM6bD, type Locale } from './m6bd-messages';
import { M6BE_EN, M6BE_TR } from './m6b-e-messages';

const CATEGORY_ATTRIBUTES = {
  categoryAttributes: [
    { allowCustom: false, required: true, attribute: { id: 47, name: 'Renk' }, attributeValues: [{ id: 101, name: 'Naturel' }, { id: 102, name: 'Beyaz' }] },
    { allowCustom: false, required: true, attribute: { id: 48, name: 'Materyal' }, attributeValues: [{ id: 201, name: 'Ahşap' }] },
  ],
};

type Call = { url: string; method: string };
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() });
    const body = url.includes('action=category_attributes')
      ? CATEGORY_ATTRIBUTES
      : url === '/api/ai/trendyol?action=suggest_attributes'
        ? { suggestions: [{ attributeId: 48, attributeValueId: 201 }] }
        : { error: 'not mocked' };
    const status = 'error' in body ? 404 : 200;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Editor({ setFieldSpy }: { setFieldSpy: (k: string, v: unknown) => void }) {
  const [fields, setFields] = React.useState<FieldMap>({
    title: 'Ahşap anı kutusu isim baskılı',
    categoryId: 1234,
    attributes: JSON.stringify([{ attributeId: 47, attributeValueId: 101 }]),
  });
  const fieldsRef = React.useRef(fields);
  fieldsRef.current = fields;
  const setField = React.useCallback((k: string, v: unknown) => {
    setFieldSpy(k, v);
    setFields((f) => ({ ...f, [k]: v as FieldMap[string] }));
  }, [setFieldSpy]);
  const ai = useListingAI({
    marketplace: 'trendyol',
    input: { title: String(fields.title), description: '', categoryId: String(fields.categoryId) },
    getField: (k) => fieldsRef.current[k],
    setField,
  });
  const ctx = {
    marketplace: 'trendyol',
    mode: 'edit',
    ctx: { shopId: 'store-1', listingId: 'P-1' },
    view: { marketplace: 'trendyol', mode: 'edit', fields, meta: { id: 'P-1', currency: 'TRY', images: [], raw: { categoryId: 1234 }, url: null }, facts: {} },
    remote: fields,
    draft: null,
    changes: [],
    issues: [],
    defaultsApplied: [],
    readOnly: false,
    setField,
    setFields: vi.fn(),
    revert: vi.fn(),
    isFieldDirty: () => false,
    register: () => () => undefined,
    stageActions: vi.fn(),
    saveNow: vi.fn(async () => true),
    reportFacts: vi.fn(),
    notifyChange: vi.fn(),
  } as unknown as ListingEditorContextValue;
  return (
    <ListingEditorContext.Provider value={ctx}>
      <TrendyolAttributesSection aiAttributes={attributesAiFrom(ai) ?? undefined} />
    </ListingEditorContext.Provider>
  );
}

describe.each<Locale>(['en', 'tr'])('Trendyol attributes section + AI hand-off (%s)', (locale) => {
  it('✦ button → metadata + suggest_attributes → proposal card; Use writes the canonical list; nothing sent', async () => {
    const messages = mergeMessages(withM6bD(locale), locale === 'en' ? M6BE_EN : M6BE_TR);
    const setFieldSpy = vi.fn();
    render(
      <NextIntlClientProvider locale={locale} messages={messages as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
        <ThemeProvider theme={theme}>
          <Editor setFieldSpy={setFieldSpy} />
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
    const button = await screen.findByRole('button', { name: locale === 'en' ? /Suggest attributes/ : /Özellik öner/ });
    fireEvent.click(button);
    const card = await screen.findByTestId('le-trendyol-attr-suggestions');
    expect(card.textContent).toContain('Materyal');
    expect(card.textContent).toContain('Ahşap');
    expect(setFieldSpy).not.toHaveBeenCalled();

    const use = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === (locale === 'en' ? 'Use' : 'Kullan'));
    expect(use).toBeTruthy();
    fireEvent.click(use!);
    expect(setFieldSpy).toHaveBeenLastCalledWith('attributes', '[{"attributeId":47,"attributeValueId":101},{"attributeId":48,"attributeValueId":201}]');
    // The accepted value is now staged, so the hand-off no longer offers it.
    await waitFor(() => expect(screen.queryByTestId('le-trendyol-attr-suggestions')).toBeNull());

    for (const c of calls) {
      expect(c.url).not.toMatch(/\/sync\b|bulk-sync|catalog-drafts|\/api\/trendyol\/products/);
    }
    expect(calls.filter((c) => c.url.startsWith('/api/ai/trendyol')).map((c) => c.method)).toEqual(['POST']);
  });
});

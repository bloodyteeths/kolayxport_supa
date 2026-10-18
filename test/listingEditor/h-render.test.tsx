// @vitest-environment jsdom
// Group H render tests (EN + TR, strict i18n): AI proposals never write until Use and never send; Start faster fills
// proposals then "Use all"; Review differences lists a queued delete first and resolves without sending; profiles
// fill only the chosen sections; scheduling refuses a queued delete. DoD spy: no request ever hits /sync,
// /bulk-sync or a direct Etsy mutation.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import theme from '@/lib/theme';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { toastController } from '@/components/ds/feedback/toast';
import { ConfirmProvider } from '@/components/ds/overlay/ConfirmDialog';
import { encodeAspects, decodeAspects } from '@/components/domain/listing-editor/adapters/ebay';
import { FieldSuggestion } from '@/components/ds/inputs/FieldSuggestion';
import { useListingAI, type AiListingInput, type UseListingAI } from '@/components/domain/listing-editor/useListingAI';
import { AiFillCard } from '@/components/domain/listing-editor/AiFillCard';
import { clearEbayCategoryLabels, ebayCategoryLabel } from '@/components/domain/listing-editor/ebayCategoryLabels';
import { ReviewDifferencesPanel } from '@/components/domain/listing-editor/ReviewDifferencesPanel';
import { ProfilesModal, PROFILE_STORAGE_KEY } from '@/components/domain/listing-editor/ProfilesModal';
import { ScheduleModal } from '@/components/domain/listing-editor/ScheduleModal';
import { H_EN, H_TR, mergeMessages } from './h-messages';
import { ETSY_PORT_EN, ETSY_PORT_TR } from '../listings/etsy-port-messages';
// AI credit costs are hidden for Shopify-connected accounts (useAiCostsVisible reads the credit balance). Shown here,
// without the balance request, unless a test switches them off.
const aiCosts = vi.hoisted(() => ({ visible: true }));
vi.mock('@/components/domain/credits/useCredits', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useAiCostsVisible: () => aiCosts.visible }));


type Locale = 'en' | 'tr';
// + the listings-etsy port keys (profile delete) until messages/*.json are merged.
const MESSAGES = { en: mergeMessages(mergeMessages(en, H_EN), ETSY_PORT_EN), tr: mergeMessages(mergeMessages(tr, H_TR), ETSY_PORT_TR) };

function wrap(ui: React.ReactElement, locale: Locale = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ThemeProvider theme={theme}>{ui}</ThemeProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let route: (c: Call) => { status?: number; json: unknown } | undefined;

beforeEach(() => {
  calls = [];
  route = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const c: Call = { url, method: (init?.method ?? 'GET').toUpperCase(), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = route(c) ?? { status: 404, json: { error: 'not mocked' } };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json } as Response;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const neverSent = () => {
  for (const c of calls) {
    expect(c.url).not.toMatch(/\/sync\b|bulk-sync|\/api\/clawd\/etsy\?action=(update|delete|publish|renew|deactivate)/);
    if (c.url.startsWith('/api/clawd/etsy')) expect(c.method).toBe('GET');
  }
};

const SEARCH = {
  items: Array.from({ length: 48 }, () => ({})),
  priceStats: { p25: 38, p75: 62, median: 49, n: 44, currency: 'USD' },
  tagFrequency: [], titleKeywords: [], fetchedAt: '2026-10-15T10:00:00.000Z',
};

// ── useListingAI through a tiny harness ───────────────────────────────────────────────────────────────────────

function AiHarness({ input, setField, getField, onAi }: { input: AiListingInput; setField: (k: string, v: unknown) => void; getField: (k: string) => unknown; onAi?: (ai: UseListingAI) => void }) {
  const ai = useListingAI({ marketplace: 'etsy', input, setField, getField });
  onAi?.(ai);
  const p = ai.suggestionProps('title');
  const b = ai.buttonState('title');
  return (
    <div>
      <button type="button" onClick={() => void ai.suggestTitle()} aria-label={b.costLabel} disabled={b.disabled}>go</button>
      {p ? <FieldSuggestion {...p} /> : null}
    </div>
  );
}

describe.each<Locale>(['en', 'tr'])('useListingAI (%s)', (locale) => {
  const input: AiListingInput = { title: 'Personalized Baby Blanket, Custom Name', description: 'Soft blanket', tags: ['baby gift'], currency: 'USD' };

  it('proposes a decoded title; Use writes it with Undo; nothing is sent', async () => {
    route = (c) => {
      if (c.url.includes('search_market')) return { json: SEARCH };
      if (c.url === '/api/ai/etsy') return { json: { optimized_title: 'personalized baby blanket | mom&#39;s gift', explanation: 'Türkçe gerekçe' } };
      return undefined;
    };
    const setField = vi.fn();
    const enqueue = vi.spyOn(toastController, 'enqueue');
    wrap(<AiHarness input={input} setField={setField} getField={() => 'Old Title'} />, locale);
    fireEvent.click(screen.getByText('go'));
    const card = await screen.findByTestId('ai-suggestion-title');
    expect(within(card).getByText("Personalized Baby Blanket, Mom's Gift")).toBeTruthy();
    // Rationale follows the UI locale: the API writes it in Turkish, so EN hides it.
    expect(within(card).queryByText('Türkçe gerekçe')).toBe(locale === 'tr' ? within(card).getByText('Türkçe gerekçe') : null);
    expect(within(card).getByText(locale === 'en' ? 'Based on 48 Etsy listings for "Personalized Baby Blanket"' : '"Personalized Baby Blanket" için 48 Etsy ilanına göre')).toBeTruthy();
    expect(setField).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole('button', { name: locale === 'en' ? 'Use' : 'Kullan' }));
    expect(setField).toHaveBeenCalledWith('title', "Personalized Baby Blanket, Mom's Gift");
    const toast = enqueue.mock.calls.at(-1)?.[0];
    expect(toast?.message).toBe(locale === 'en' ? 'Title replaced' : 'Başlık değiştirildi');
    act(() => toast?.action?.onClick());
    expect(setField).toHaveBeenLastCalledWith('title', 'Old Title');
    neverSent();
  });

  it('is single-flight per action and shows the credit cost', async () => {
    let resolve!: (v: unknown) => void;
    route = (c) => {
      if (c.url.includes('search_market')) return { json: SEARCH };
      return undefined;
    };
    const pending = new Promise((r) => { resolve = r; });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (u: string, init?: RequestInit) => {
      calls.push({ url: String(u), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(u).includes('search_market')) return { ok: true, status: 200, json: async () => SEARCH } as Response;
      await pending;
      return { ok: true, status: 200, json: async () => ({ optimized_title: 'Personalized Baby Blanket, Newborn Gift' }) } as Response;
    });
    wrap(<AiHarness input={input} setField={vi.fn()} getField={() => ''} />, locale);
    expect(screen.getByLabelText(locale === 'en' ? '1 credit' : '1 kredi')).toBeTruthy();
    fireEvent.click(screen.getByText('go'));
    fireEvent.click(screen.getByText('go'));
    await act(async () => { resolve(null); });
    await screen.findByTestId('ai-suggestion-title');
    expect(calls.filter((c) => c.url === '/api/ai/etsy')).toHaveLength(1);
  });

  it('402 disables the action with the credits reason, no raw server text', async () => {
    route = (c) => (c.url === '/api/ai/etsy' ? { status: 402, json: { error: 'Payment Required RAW' } } : { json: SEARCH });
    let api: UseListingAI | null = null;
    wrap(<AiHarness input={input} setField={vi.fn()} getField={() => ''} onAi={(a) => { api = a; }} />, locale);
    fireEvent.click(screen.getByText('go'));
    const card = await screen.findByTestId('ai-suggestion-title');
    expect(within(card).getByText(locale === 'en' ? "You've used all AI credits on your plan" : 'Planınızdaki AI kredileri bitti')).toBeTruthy();
    expect(screen.queryByText(/RAW/)).toBeNull();
    expect(api!.limitReached).toBe(true);
    expect((screen.getByText('go') as HTMLButtonElement).disabled).toBe(true);
  });
});

// ── useListingAI: dismiss / single-flight / eBay specifics / credits ──────────────────────────────────────────

function Bare({ marketplace = 'etsy', input, setField = () => undefined, getField = () => '', onAi }: {
  marketplace?: 'etsy' | 'ebay'; input: AiListingInput; setField?: (k: string, v: unknown) => void; getField?: (k: string) => unknown; onAi: (ai: UseListingAI) => void;
}) {
  const ai = useListingAI({ marketplace, input, setField, getField });
  onAi(ai);
  return null;
}

function deferredFetch(handler: (url: string, body: unknown) => Promise<unknown> | unknown) {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (u: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(u), method: init?.method ?? 'GET', body });
    const json = await handler(String(u), body);
    return { ok: true, status: 200, json: async () => json } as Response;
  });
}

describe('useListingAI guards', () => {
  const input: AiListingInput = { title: 'Personalized Baby Blanket, Custom Name', description: 'Soft blanket', tags: [], currency: 'USD' };

  it('Dismiss + Try again keeps one call in flight at a time (the old run never frees the new run\'s slot)', async () => {
    const gates: Array<() => void> = [];
    deferredFetch(async (u) => {
      if (u.includes('search_market')) return SEARCH;
      await new Promise<void>((r) => gates.push(r));
      return { optimized_title: 'Personalized Baby Blanket, Newborn Gift' };
    });
    let ai!: UseListingAI;
    wrap(<Bare input={input} onAi={(a) => { ai = a; }} />);
    act(() => { void ai.suggestTitle(); });
    await waitFor(() => expect(gates).toHaveLength(1));
    act(() => ai.dismiss('title'));
    act(() => { void ai.suggestTitle(); }); // retry: a second run is allowed after Dismiss
    await waitFor(() => expect(gates).toHaveLength(2));
    await act(async () => { gates[0](); }); // the dismissed run finishes
    act(() => { void ai.suggestTitle(); }); // must join the running retry, not start a third call
    await act(async () => { await Promise.resolve(); });
    expect(calls.filter((c) => c.url === '/api/ai/etsy')).toHaveLength(2);
    await act(async () => { gates[1](); });
    await waitFor(() => expect(ai.get('title').status).toBe('ready'));
  });

  it('a proposal dismissed while Start faster runs does not come back', async () => {
    let releaseTitle!: () => void;
    deferredFetch(async (u, body) => {
      if (u.includes('search_market')) return SEARCH;
      const action = (body as { action: string }).action;
      if (action === 'optimize_title') {
        await new Promise<void>((r) => { releaseTitle = r; });
        return { optimized_title: 'Wooden Baby Name Sign, Nursery Wall Decor' };
      }
      if (action === 'generate_description') return { description: 'A hand cut wooden name sign for the nursery wall, painted in soft colours and made to order in our small workshop.' };
      return { suggestions: ['shower present'] };
    });
    let ai!: UseListingAI;
    wrap(<Bare input={{ title: '', description: '', tags: [] }} onAi={(a) => { ai = a; }} />);
    let job!: Promise<void>;
    act(() => { job = ai.fillListing({ seed: 'wooden baby name sign' }); });
    await waitFor(() => expect(ai.get('title').status).toBe('loading'));
    act(() => ai.dismiss('title'));
    await act(async () => { releaseTitle(); await job; });
    expect(ai.get('title').status).toBe('idle');
    expect(ai.get('description').status).toBe('ready');
  });

  it('eBay: accepting AI item specifics keeps the ones already on the listing (and the ones accepted before)', async () => {
    route = (c) => {
      if (c.url.startsWith('/api/clawd/ebay-ai?action=suggest_aspects')) return { json: { aspects: { Material: ['Brass'], Style: ['Vintage'] } } };
      if (c.url.startsWith('/api/clawd/ebay-research')) return { json: {} };
      return undefined;
    };
    let fields: Record<string, unknown> = { aspects: encodeAspects({ Brand: ['Acme'], Color: ['Gold'] }) };
    const setField = vi.fn((k: string, v: unknown) => { fields = { ...fields, [k]: v }; });
    let ai!: UseListingAI;
    wrap(<Bare marketplace="ebay" input={{ title: 'Brass candle holder', description: '' }} setField={setField} getField={(k) => fields[k]} onAi={(a) => { ai = a; }} />);
    await act(async () => { await ai.fillSpecifics(['Material', 'Style']); });
    expect(ai.get('specifics').status).toBe('ready');
    const sent = calls.find((c) => c.url.includes('suggest_aspects'))?.body as { currentAspects?: unknown };
    expect(sent.currentAspects).toEqual({ Brand: ['Acme'], Color: ['Gold'] });
    act(() => ai.acceptAspect('Material'));
    act(() => ai.acceptAspect('Style'));
    expect(decodeAspects(fields.aspects as string)).toEqual({ Brand: ['Acme'], Color: ['Gold'], Material: ['Brass'], Style: ['Vintage'] });
    neverSent();
  });

  it('402: Try again on the title card does nothing (no second paid call)', async () => {
    route = (c) => (c.url === '/api/ai/etsy' ? { status: 402, json: {} } : { json: SEARCH });
    let ai!: UseListingAI;
    wrap(<Bare input={input} onAi={(a) => { ai = a; }} />);
    await act(async () => { await ai.suggestTitle(); });
    expect(ai.get('title').limited).toBe(true);
    const n = calls.filter((c) => c.url === '/api/ai/etsy').length;
    await act(async () => { ai.fieldState('title').run(); await Promise.resolve(); });
    expect(calls.filter((c) => c.url === '/api/ai/etsy')).toHaveLength(n);
  });
});

// ── AiFillCard ────────────────────────────────────────────────────────────────────────────────────────────────

function FillHarness({ setField }: { setField: (k: string, v: unknown) => void }) {
  const ai = useListingAI({ marketplace: 'etsy', input: { title: '', description: '', tags: [] }, setField, getField: () => '' });
  return (
    <>
      <AiFillCard ai={ai} onApplyProfile={() => undefined} />
      {(['title', 'description'] as const).map((k) => {
        const p = ai.suggestionProps(k);
        return p ? <FieldSuggestion key={k} {...p} /> : null;
      })}
    </>
  );
}

describe.each<Locale>(['en', 'tr'])('AiFillCard (%s)', (locale) => {
  it('Etsy: needs the one-line description, fills proposals only, then Use all writes them', async () => {
    route = (c) => {
      if (c.url.includes('search_market')) return { json: SEARCH };
      if (c.url !== '/api/ai/etsy') return undefined;
      const action = (c.body as { action: string }).action;
      if (action === 'optimize_title') return { json: { optimized_title: 'Wooden Baby Name Sign, Nursery Wall Decor, New Mom Gift' } };
      if (action === 'generate_description') return { json: { description: 'A hand cut wooden name sign for the nursery wall, painted in soft colours and made to order in our small workshop.' } };
      if (action === 'suggest_tags') return { json: { suggestions: ['shower present', 'kids room art'] } };
      return undefined;
    };
    const setField = vi.fn();
    wrap(<FillHarness setField={setField} />, locale);
    const run = screen.getByTestId('le-ai-fill-run') as HTMLButtonElement;
    expect(run.textContent).toBe(locale === 'en' ? 'Fill with AI' : 'AI ile doldur');
    expect(run.disabled).toBe(true);
    fireEvent.change(within(screen.getByTestId('le-ai-fill-seed')).getByRole('textbox'), { target: { value: 'wooden baby name sign for nursery' } });
    fireEvent.click(screen.getByTestId('le-ai-fill-run'));
    const useAll = await screen.findByTestId('le-ai-fill-use-all');
    expect(useAll.textContent).toBe(locale === 'en' ? 'Use all (3)' : 'Hepsini kullan (3)');
    expect(setField).not.toHaveBeenCalled();
    expect(await screen.findByTestId('ai-suggestion-title')).toBeTruthy();
    fireEvent.click(useAll);
    expect(setField).toHaveBeenCalledWith('title', 'Wooden Baby Name Sign, Nursery Wall Decor, New Mom Gift');
    expect(setField).toHaveBeenCalledWith('description', expect.stringContaining('wooden name sign'));
    expect(setField).toHaveBeenCalledWith('tags', ['shower present', 'kids room art']);
    neverSent();
  });
});

function EbayFillHarness({ setField, photoUrls }: { setField: (k: string, v: unknown) => void; photoUrls?: string[] }) {
  const ai = useListingAI({ marketplace: 'ebay', input: { title: '', description: '' }, setField, getField: () => '' });
  return <AiFillCard ai={ai} photoUrls={photoUrls} />;
}

describe.each<Locale>(['en', 'tr'])('AiFillCard eBay (%s)', (locale) => {
  it('Shopify-connected accounts see no credit cost (App Store 1.2.1)', () => {
    aiCosts.visible = false;
    try {
      wrap(<EbayFillHarness setField={vi.fn()} />, locale);
      expect(screen.queryByTestId('le-ai-fill-cost')).toBeNull();
      expect(screen.getByTestId('le-ai-fill-run').getAttribute('aria-label') ?? '').not.toMatch(/credit|kredi/i);
    } finally {
      aiCosts.visible = true;
    }
  });
  it('shows every proposal (no eBay section renders the frame\'s) and the real cost before Use all', async () => {
    route = (c) => {
      if (c.url.startsWith('/api/clawd/ebay-research')) return { json: {} };
      if (c.url.startsWith('/api/clawd/ebay?action=category_suggestions')) return { json: { categorySuggestions: [{ category: { categoryId: '123', categoryName: 'Candle Holders' } }] } };
      if (c.url.startsWith('/api/clawd/ebay?action=item_aspects')) return { json: { aspects: [{ localizedAspectName: 'Material', aspectConstraint: { aspectRequired: true } }] } };
      if (c.url.includes('optimize_title')) return { json: { optimizedTitle: 'Vintage Solid Brass Candle Holder Pair' } };
      if (c.url.includes('suggest_aspects')) return { json: { aspects: { Material: ['Brass'] } } };
      if (c.url.includes('suggest_price')) return { json: {} };
      if (c.url.includes('generate_description')) return { json: { description: `<p>${'Solid brass candle holder with a hand polished finish. '.repeat(3)}</p>` } };
      return undefined;
    };
    const setField = vi.fn();
    wrap(<EbayFillHarness setField={setField} />, locale);
    expect(screen.getByTestId('le-ai-fill-cost').textContent).toBe(locale === 'en' ? '4 credits' : '4 kredi');
    fireEvent.change(within(screen.getByTestId('le-ai-fill-seed')).getByRole('textbox'), { target: { value: 'brass candle holder' } });
    fireEvent.click(screen.getByTestId('le-ai-fill-run'));
    await screen.findByTestId('le-ai-fill-use-all');
    expect(within(screen.getByTestId('le-ai-fill-proposal-title')).getByText('Vintage Solid Brass Candle Holder Pair')).toBeTruthy();
    expect(within(screen.getByTestId('le-ai-fill-proposal-category')).getByText('Candle Holders')).toBeTruthy();
    expect(within(screen.getByTestId('le-ai-fill-proposal-specifics')).getByText('Material: Brass')).toBeTruthy();
    expect(screen.getByTestId('le-ai-fill-proposal-description').textContent).not.toContain('<p>');
    expect(setField).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('le-ai-fill-use-all'));
    expect(setField).toHaveBeenCalledWith('categoryId', '123');
    expect(setField).not.toHaveBeenCalledWith('categoryName', expect.anything());
    neverSent();
  });

  // The captured tutorial run (a photo of a NEW Iznik bowl): identify said LIKE_NEW, the category field showed
  // "Category #262366", the description field showed HTML source.
  it('fill from photos: NEW condition checked against the category, category name kept, plain-text description', async () => {
    clearEbayCategoryLabels();
    route = (c) => {
      if (c.url.includes('identify_product')) return { json: { seed: 'handmade Turkish ceramic bowl blue tulip floral Iznik style pottery', productName: 'Ceramic decorative bowl', keywords: ['iznik pottery'], suggestedCondition: 'LIKE_NEW', notes: '' } };
      if (c.url.startsWith('/api/clawd/ebay-research')) return { json: {} };
      if (c.url.startsWith('/api/clawd/ebay?action=category_suggestions')) return { json: { categorySuggestions: [{ category: { categoryId: '262366', categoryName: 'Bowls' }, categoryTreeNodeAncestors: [{ categoryName: 'Pottery & Glass' }] }] } };
      if (c.url.startsWith('/api/clawd/ebay?action=item_conditions')) return { json: { categoryId: '262366', itemConditions: [], conditionRequired: false } };
      if (c.url.startsWith('/api/clawd/ebay?action=item_aspects')) return { json: { aspects: [{ localizedAspectName: 'Material', aspectConstraint: { aspectRequired: true } }] } };
      if (c.url.includes('optimize_title')) return { json: { optimizedTitle: 'Turkish Iznik Ceramic Bowl Blue Tulip Floral Handmade Pottery' } };
      if (c.url.includes('suggest_aspects')) return { json: { aspects: { Material: ['Ceramic'] } } };
      if (c.url.includes('suggest_price')) return { json: {} };
      if (c.url.includes('generate_description')) return { json: { description: '<div style="font-family: Arial"><h2>Turkish Iznik Bowl</h2><p>A hand painted ceramic bowl with a blue tulip pattern, new and unused.</p><ul><li>Blue and white</li></ul></div>' } };
      return undefined;
    };
    const setField = vi.fn();
    wrap(<EbayFillHarness setField={setField} photoUrls={['/api/clawd/serve-image?f=bowl.jpg']} />, locale);
    fireEvent.click(screen.getByTestId('le-ai-fill-run'));
    await screen.findByTestId('le-ai-fill-use-all');

    // Condition: LIKE_NEW from a clean photo → NEW, validated against the category's list.
    expect(calls.some((c) => c.url.startsWith('/api/clawd/ebay?action=item_conditions&category_id=262366'))).toBe(true);
    const desc = calls.find((c) => c.url.includes('generate_description'))!;
    expect(desc.body).toMatchObject({ condition: 'NEW', format: 'text' });
    expect(screen.getByTestId('le-ai-fill-proposal-condition').textContent).toContain(locale === 'en' ? 'New' : 'Yeni');

    fireEvent.click(screen.getByTestId('le-ai-fill-use-all'));
    expect(setField).toHaveBeenCalledWith('condition', 'NEW');
    // Category: the id is stored, the name the suggestion carried is kept for the category field.
    expect(setField).toHaveBeenCalledWith('categoryId', '262366');
    expect(ebayCategoryLabel('262366')).toBe('Bowls');
    // Description: the plain-text field gets text, no markup.
    const written = setField.mock.calls.find(([k]) => k === 'description')?.[1] as string;
    expect(written).toBe('Turkish Iznik Bowl\n\nA hand painted ceramic bowl with a blue tulip pattern, new and unused.\n\n• Blue and white');
    neverSent();
    clearEbayCategoryLabels();
  });
});

// ── ReviewDifferencesPanel ────────────────────────────────────────────────────────────────────────────────────

const DIFF = {
  remoteUpdatedAt: '2026-10-15T11:02:00.000Z',
  fields: [
    { key: 'title', base: 'A', remote: 'Etsy Title', draft: 'My Title', changedRemotely: true, inDraft: true },
    { key: 'price', base: 60, remote: 64.99, draft: 69.99, changedRemotely: true, inDraft: true },
    { key: 'quantity', base: 40, remote: 38, changedRemotely: true, inDraft: false },
    { key: 'tags', base: [], remote: [], draft: ['a'], changedRemotely: false, inDraft: true },
  ],
  queuedActions: [{ type: 'renew' }, { type: 'delete' }],
  hasQueuedDelete: true,
};

describe.each<Locale>(['en', 'tr'])('ReviewDifferencesPanel (%s)', (locale) => {
  it('lists the queued delete first, lets the seller pick per field, resolves without sending', async () => {
    route = (c) => {
      if (c.url === '/api/etsy-drafts/d1/diff') return { json: DIFF };
      if (c.url === '/api/etsy-drafts/d1/resolve') return { json: { draft: { id: 'd1', status: 'draft' } } };
      return undefined;
    };
    const onResolved = vi.fn();
    const onRemove = vi.fn(async () => undefined);
    wrap(<ReviewDifferencesPanel open onClose={() => undefined} marketplace="etsy" draftId="d1" draftStartedAt="2026-10-15T07:31:00.000Z" currency="USD" onResolved={onResolved} onRemoveQueuedAction={onRemove} />, locale);
    await screen.findByTestId('le-review-row-title');
    const queued = screen.getAllByTestId(/^le-review-queued-/);
    expect(queued[0].getAttribute('data-testid')).toBe('le-review-queued-delete');
    expect(screen.getByTestId('le-review-row-quantity').textContent).toContain(locale === 'en' ? 'Not in your draft' : 'Taslağınızda yok');

    const priceChoice = screen.getByTestId('le-review-choice-price');
    fireEvent.click(within(priceChoice).getByLabelText(locale === 'en' ? "Etsy's" : "Etsy'deki"));
    fireEvent.click(screen.getByTestId('le-review-remove-delete'));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('delete'));
    await waitFor(() => expect(screen.queryByTestId('le-review-queued-delete')).toBeNull());

    fireEvent.click(screen.getByTestId('action-review-keep'));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ id: 'd1', status: 'draft' }));
    const post = calls.find((c) => c.url === '/api/etsy-drafts/d1/resolve');
    expect(post?.method).toBe('POST');
    expect(post?.body).toEqual({ keep: ['title', 'tags'] });
    neverSent();
  });

  it('keeping choices with a delete still queued asks again (type the shop name); cancel keeps the conflict', async () => {
    route = (c) => {
      if (c.url === '/api/etsy-drafts/d1/diff') return { json: DIFF };
      if (c.url === '/api/etsy-drafts/d1/resolve') return { json: { draft: { id: 'd1', status: 'draft' } } };
      return undefined;
    };
    const onResolved = vi.fn();
    wrap(
      <ConfirmProvider>
        <ReviewDifferencesPanel open onClose={() => undefined} marketplace="etsy" draftId="d1" shopName="BelleCoutureGifts" onResolved={onResolved} onRemoveQueuedAction={vi.fn(async () => undefined)} />
      </ConfirmProvider>,
      locale,
    );
    await screen.findByTestId('le-review-queued-delete');
    fireEvent.click(screen.getByTestId('action-review-keep'));
    const dialog = await screen.findByTestId('ds-confirm');
    expect(dialog.textContent).toContain(locale === 'en' ? 'This will delete the listing on Etsy' : "ilan Etsy'den silinecek");
    fireEvent.click(within(dialog).getByTestId('action-cancel'));
    await waitFor(() => expect(screen.queryByTestId('ds-confirm')).toBeNull());
    expect(calls.some((c) => c.url.endsWith('/resolve'))).toBe(false);

    fireEvent.click(screen.getByTestId('action-review-keep'));
    const again = await screen.findByTestId('ds-confirm');
    const confirmBtn = within(again).getByTestId('action-confirm') as HTMLButtonElement;
    expect(confirmBtn.disabled || confirmBtn.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.change(within(again).getByTestId('confirm-type-input'), { target: { value: 'BelleCoutureGifts' } });
    fireEvent.click(within(again).getByTestId('action-confirm'));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    neverSent();
  });

  it('501 before backend BR-3: explains and offers the fallback, never a blind force', async () => {
    route = (c) => (c.url.endsWith('/diff') ? { status: 501, json: { code: 'NOT_AVAILABLE' } } : undefined);
    const discard = vi.fn();
    wrap(<ReviewDifferencesPanel open onClose={() => undefined} marketplace="etsy" draftId="d1" onResolved={vi.fn()} fallback={{ discard, refresh: vi.fn() }} />, locale);
    await screen.findByTestId('le-review-unavailable');
    fireEvent.click(screen.getByText(locale === 'en' ? 'Discard my changes' : 'Değişikliklerimi at'));
    expect(discard).toHaveBeenCalled();
    expect(calls.some((c) => (c.body as { force?: boolean } | undefined)?.force)).toBe(false);
  });
});

// ── ProfilesModal ─────────────────────────────────────────────────────────────────────────────────────────────

describe.each<Locale>(['en', 'tr'])('ProfilesModal (%s)', (locale) => {
  it('applies only the chosen sections to the draft, with one Undo', () => {
    const m = new Map<string, string>([[PROFILE_STORAGE_KEY.etsy, JSON.stringify([
      { id: 'p1', name: 'Baby blankets', createdAt: '2026-10-01T10:00:00.000Z', fields: { title: 'Other', tags: ['baby gift', 'newborn'], shipping_profile_id: 7 } },
    ])]]);
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const setField = vi.fn();
    const enqueue = vi.spyOn(toastController, 'enqueue');
    wrap(<ProfilesModal open onClose={() => undefined} mode="apply" marketplace="etsy" fields={{ tags: [], shipping_profile_id: '' }} setField={setField} storage={storage} />, locale);
    expect((within(screen.getByTestId('le-profile-section-title')).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect((within(screen.getByTestId('le-profile-section-tags')).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('action-le-profile-apply'));
    expect(setField).toHaveBeenCalledWith('tags', ['baby gift', 'newborn']);
    expect(setField).toHaveBeenCalledWith('shipping_profile_id', 7);
    expect(setField).not.toHaveBeenCalledWith('title', expect.anything());
    expect(enqueue.mock.calls.at(-1)?.[0].message).toBe(locale === 'en' ? 'Applied "Baby blankets"' : '"Baby blankets" uygulandı');
    neverSent();
    expect(calls).toHaveLength(0);
  });

  it('empty storage offers saving instead', () => {
    wrap(<ProfilesModal open onClose={() => undefined} mode="apply" marketplace="etsy" fields={{ tags: ['a'] }} setField={vi.fn()} storage={{ getItem: () => null, setItem: () => undefined }} />, locale);
    expect(screen.getByTestId('le-profile-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('action-le-profile-to-save'));
    expect(screen.getByTestId('le-profile-name')).toBeTruthy();
  });
});

// ── ScheduleModal ─────────────────────────────────────────────────────────────────────────────────────────────

describe.each<Locale>(['en', 'tr'])('ScheduleModal (%s)', (locale) => {
  it('a draft with a queued delete cannot be scheduled', () => {
    wrap(<ScheduleModal open onClose={() => undefined} marketplace="etsy" draftId="d1" hasQueuedDelete timezone="Europe/Istanbul" onScheduled={vi.fn()} />, locale);
    expect(screen.getByTestId('le-schedule-delete')).toBeTruthy();
    expect((screen.getByTestId('action-le-schedule') as HTMLButtonElement).disabled).toBe(true);
  });

  it('unschedules through PATCH scheduledSendAt: null (never sends)', async () => {
    route = (c) => (c.url === '/api/etsy-drafts/d1' && c.method === 'PATCH' ? { json: { draft: { id: 'd1' } } } : undefined);
    const onScheduled = vi.fn();
    wrap(<ScheduleModal open onClose={() => undefined} marketplace="etsy" draftId="d1" hasQueuedDelete={false} scheduledAt="2026-10-20T07:00:00.000Z" timezone="Europe/Istanbul" onScheduled={onScheduled} now={new Date('2026-10-15T10:00:00Z')} />, locale);
    expect(screen.getByTestId('le-schedule-current')).toBeTruthy();
    fireEvent.click(screen.getByTestId('action-le-unschedule'));
    await waitFor(() => expect(onScheduled).toHaveBeenCalledWith(null));
    expect(calls[0]).toMatchObject({ url: '/api/etsy-drafts/d1', method: 'PATCH', body: { scheduledSendAt: null } });
    neverSent();
  });
});

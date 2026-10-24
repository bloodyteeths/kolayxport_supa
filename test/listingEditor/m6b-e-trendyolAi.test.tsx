// @vitest-environment jsdom
// M6b-E: Trendyol AI actions on the shared useListingAI (marketplace-editors §1 AI) + the Trendyol required-attribute
// score check. Proposals never write until Use / accept, never send (no /sync, no catalog-drafts send, no Trendyol
// write endpoint); Wix and Shopify have no AI (no request, `supports` false); attribute value ids only from the list.
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { IntlMessageFormat } from 'intl-messageformat';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import {
  AI_CAPABILITIES,
  aiSupports,
  attributesAiFrom,
  attributesToAsk,
  creditsFor,
  decodeTrendyolAttributes,
  encodeTrendyolAttributes,
  fillCredits,
  mergeTrendyolAttributes,
  sanitizeAttributeSuggestions,
  sanitizeDescription,
  sanitizeTitle,
  titleLimit,
  titleSectionAiProps,
  toAiAttributes,
  toTrendyolHtml,
  TRENDYOL_AI_TITLE_MAX,
  useListingAI,
  type AiListingInput,
  type AiMarketplace,
  type UseListingAI,
} from '@/components/domain/listing-editor/useListingAI';
import { scoreTrendyolProduct, trendyolChecks, trendyolRequiredMissing } from '@/lib/listingScore/trendyol';
import { TITLE_MAX } from '@/lib/catalogDrafts/schemas';
import { mergeMessages } from './h-messages';
import { M6BE_EN, M6BE_TR } from './m6b-e-messages';
// AI credit costs are hidden for Shopify-connected accounts (useAiCostsVisible reads the credit balance). Shown here,
// without the balance request, unless a test switches them off.
const aiCosts = vi.hoisted(() => ({ visible: true }));
vi.mock('@/components/domain/credits/useCredits', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useAiCostsVisible: () => aiCosts.visible }));


type Locale = 'en' | 'tr';
const MESSAGES = { en: mergeMessages(en, M6BE_EN), tr: mergeMessages(tr, M6BE_TR) };

const aiMsg = (locale: Locale, key: string) => ((locale === 'en' ? M6BE_EN : M6BE_TR) as { listingEditor: { ai: Record<string, string> } }).listingEditor.ai[key];

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let route: (c: Call) => { status?: number; json: unknown } | undefined;

beforeEach(() => {
  calls = [];
  route = () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: init?.body ? JSON.parse(String(init.body)) : undefined };
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

/** DoD: AI never sends. Only /api/ai/trendyol POSTs; nothing touches sync, catalog-drafts or a Trendyol write. */
const neverSent = () => {
  for (const c of calls) {
    expect(c.url).not.toMatch(/\/sync\b|bulk-sync|catalog-drafts|\/api\/trendyol\/products|\/api\/(wix|shopify)\//);
    expect(c.url.startsWith('/api/ai/trendyol?action=')).toBe(true);
  }
};

function Harness({ marketplace = 'trendyol', input, setField, getField, onAi, titleMax }: {
  marketplace?: AiMarketplace; input: AiListingInput; setField: (k: string, v: unknown) => void; getField: (k: string) => unknown;
  onAi: (ai: UseListingAI) => void; titleMax?: number;
}) {
  const ai = useListingAI({ marketplace, input, setField, getField, titleMax });
  onAi(ai);
  return null;
}

function mount(props: Omit<React.ComponentProps<typeof Harness>, 'onAi'>, locale: Locale = 'en') {
  const ref: { current: UseListingAI | null } = { current: null };
  const utils = render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale] as never} timeZone="Europe/Istanbul" onError={(e) => { throw e; }}>
      <Harness {...props} onAi={(ai) => { ref.current = ai; }} />
    </NextIntlClientProvider>,
  );
  return { ref, ...utils };
}

const TR_TITLE = 'Belle Couture Kişiye Özel Ahşap Anı Kutusu, İsim Baskılı Doğum Günü Hediyesi, Naturel Renk 20x15 cm';
const TR_DESC = 'Doğal ahşaptan el yapımı anı kutusu, isim baskısı ile kişiye özel hazırlanır.\n\n- Ölçü: 20x15 cm\n- Malzeme: doğal ahşap\n- Doğum günü ve yıl dönümü için ideal hediye';

const CATEGORY_ATTRIBUTES = {
  id: 1234,
  name: 'Saklama Kutusu',
  categoryAttributes: [
    { allowCustom: false, required: true, attribute: { id: 47, name: 'Renk' }, attributeValues: [{ id: 101, name: 'Naturel' }, { id: 102, name: 'Beyaz' }] },
    { allowCustom: false, required: true, attribute: { id: 48, name: 'Materyal' }, attributeValues: [{ id: 201, name: 'Ahşap' }, { id: 202, name: 'Plastik' }] },
    { allowCustom: true, required: false, attribute: { id: 49, name: 'Boyut' }, attributeValues: [] },
    { allowCustom: false, required: false, attribute: { id: 50, name: 'Stil' }, attributeValues: [{ id: 301, name: 'Modern' }] },
  ],
};

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────

describe('Trendyol AI pure helpers', () => {
  it('capabilities: Trendyol title/description/attributes/fill only; Wix and Shopify have none', () => {
    expect(aiSupports('trendyol', 'title')).toBe(true);
    expect(aiSupports('trendyol', 'attributes')).toBe(true);
    expect(aiSupports('trendyol', 'price')).toBe(false);
    expect(aiSupports('trendyol', 'photo')).toBe(false);
    expect(aiSupports('trendyol', 'tags')).toBe(false);
    expect(aiSupports('etsy', 'alt:123')).toBe(true);
    expect(AI_CAPABILITIES.wix).toEqual([]);
    expect(AI_CAPABILITIES.shopify).toEqual([]);
    expect(fillCredits('trendyol')).toBe(0); // text AI is free
    expect(fillCredits('wix')).toBe(0);
    expect(fillCredits('etsy')).toBe(0);
    expect(fillCredits('ebay')).toBe(0);
    expect(creditsFor('attributes')).toBe(0);
  });

  it('sanitizeTitle(trendyol): decodes, strips quotes/markup, refuses raw JSON fallback, fits the limit at a word', () => {
    expect(sanitizeTitle('trendyol', '"Ahşap Anı Kutusu &amp; İsim Baskılı"')).toBe('Ahşap Anı Kutusu & İsim Baskılı');
    expect(sanitizeTitle('trendyol', '{"optimizedTitle": "x"')).toBe('');
    expect(sanitizeTitle('trendyol', ['Ahşap', 'Kutu'])).toBe('Ahşap Kutu');
    expect(sanitizeTitle('trendyol', 'a b c d e f g h')).toBe('');
    const long = `${TR_TITLE} ${TR_TITLE}`;
    const out = sanitizeTitle('trendyol', long);
    expect(out.length).toBeLessThanOrEqual(TRENDYOL_AI_TITLE_MAX);
    expect(long.startsWith(out)).toBe(true);
    expect(sanitizeTitle('trendyol', TR_TITLE, 60).length).toBeLessThanOrEqual(60);
    // Default cap = what the catalog draft accepts (a longer title is block_save), not the score's 150.
    expect(TRENDYOL_AI_TITLE_MAX).toBe(TITLE_MAX.trendyol);
    expect(titleLimit('trendyol')).toBe(TITLE_MAX.trendyol);
    expect(titleLimit('trendyol', 100)).toBe(100);
    expect(titleLimit('etsy')).toBe(140);
  });

  it('toTrendyolHtml: plain text → <p> + <ul><li>, escaped; HTML → allowlisted tags without attributes', () => {
    expect(toTrendyolHtml('Giriş satırı\n\n- Bir\n- İki <3')).toBe('<p>Giriş satırı</p><ul><li>Bir</li><li>İki &lt;3</li></ul>');
    expect(toTrendyolHtml('<p onclick="x()">Merhaba <a href="http://x">link</a></p><script>alert(1)</script><ul><li class="a">Bir</li></ul>'))
      .toBe('<p>Merhaba link</p><ul><li>Bir</li></ul>');
    expect(toTrendyolHtml('<h2>Başlık</h2><div>Metin</div>')).toBe('<p>Başlık</p><p>Metin</p>');
  });

  it('toTrendyolHtml: text between tags is escaped like the plain branch (entities never become markup)', () => {
    expect(toTrendyolHtml('<p>Tom &amp; Jerry 5 &lt; 10 cm, &lt;b&gt;kalın&lt;/b&gt; değil</p>'))
      .toBe('<p>Tom &amp; Jerry 5 &lt; 10 cm, &lt;b&gt;kalın&lt;/b&gt; değil</p>');
    expect(toTrendyolHtml('<p>5 < 10 & 3 > 2</p>')).toBe('<p>5 &lt; 10 &amp; 3 &gt; 2</p>');
    // Plain text: an encoded tag stays text; a wholly encoded HTML answer is still treated as HTML.
    expect(toTrendyolHtml('Kullanım: &lt;b&gt; yok')).toBe('<p>Kullanım: &lt;b&gt; yok</p>');
    expect(toTrendyolHtml('&lt;p&gt;Merhaba &amp;amp; selam&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;')).toBe('<p>Merhaba &amp; selam</p>');
    const long = 'Doğal ahşaptan el yapımı anı kutusu; isim baskısı ile kişiye özel hazırlanır, 5 &lt; 10 cm';
    expect(sanitizeDescription('trendyol', `<p>Tom &amp; Jerry ${long}</p>`)).toBe(`<p>Tom &amp; Jerry ${long}</p>`);
  });

  it('sanitizeDescription(trendyol): too short / garbled / raw JSON → empty; otherwise HTML', () => {
    expect(sanitizeDescription('trendyol', 'Kısa')).toBe('');
    expect(sanitizeDescription('trendyol', '{"description": "…"}')).toBe('');
    const html = sanitizeDescription('trendyol', TR_DESC);
    expect(html.startsWith('<p>Doğal ahşaptan')).toBe(true);
    expect(html).toContain('<li>Ölçü: 20x15 cm</li>');
  });

  it('toAiAttributes: raw metadata → value-list attributes only (custom-only ones stay the seller’s)', () => {
    const attrs = toAiAttributes(CATEGORY_ATTRIBUTES);
    expect(attrs.map((a) => a.attributeId)).toEqual([47, 48, 50]);
    expect(attrs[0]).toEqual({ attributeId: 47, name: 'Renk', required: true, allowedValues: [{ id: 101, name: 'Naturel' }, { id: 102, name: 'Beyaz' }] });
    expect(toAiAttributes(attrs)).toEqual(attrs); // idempotent on normalised rows
    expect(toAiAttributes(null)).toEqual([]);
    // TrendyolAttributesSection's parsed defs (`values`, not `attributeValues`) are read too.
    const defs = [
      { id: 47, name: 'Renk', required: true, allowCustom: false, varianter: false, values: [{ id: 101, name: 'Naturel' }] },
      { id: 49, name: 'Boyut', required: false, allowCustom: true, varianter: false, values: [] },
    ];
    expect(toAiAttributes(defs)).toEqual([{ attributeId: 47, name: 'Renk', required: true, allowedValues: [{ id: 101, name: 'Naturel' }] }]);
  });

  it('decodeTrendyolAttributes: array or JSON string, junk dropped, never throws', () => {
    expect(decodeTrendyolAttributes('[{"attributeId":47,"attributeValueId":101},{"attributeId":"x"}]')).toEqual([{ attributeId: 47, attributeValueId: 101 }]);
    expect(decodeTrendyolAttributes('{bad')).toEqual([]);
    expect(decodeTrendyolAttributes([{ attributeId: 49, customAttributeValue: '20x15' }])).toEqual([{ attributeId: 49, customAttributeValue: '20x15' }]);
    // Same canonical codec as the sections (encodeAttributes): sorted by id, so equal sets compare equal.
    expect(decodeTrendyolAttributes([{ attributeId: 50, attributeValueId: 301 }, { attributeId: 47, attributeValueId: 101 }]).map((a) => a.attributeId)).toEqual([47, 50]);
    expect(encodeTrendyolAttributes([{ attributeId: 50, attributeValueId: 301 }, { attributeId: 47, attributeValueId: 101 }]))
      .toBe('[{"attributeId":47,"attributeValueId":101},{"attributeId":50,"attributeValueId":301}]');
  });

  it('attributesToAsk: missing first, required before optional', () => {
    const attrs = toAiAttributes(CATEGORY_ATTRIBUTES);
    expect(attributesToAsk(attrs, [{ attributeId: 47, attributeValueId: 101 }]).map((a) => a.attributeId)).toEqual([48, 50]);
  });

  it('sanitizeAttributeSuggestions: only asked attributes, only listed value ids, one each, unchanged dropped', () => {
    const asked = toAiAttributes(CATEGORY_ATTRIBUTES);
    const raw = {
      suggestions: [
        { attributeId: 50, attributeValueId: 301, reason: 'Modern görünüm' },
        { attributeId: 48, attributeValueId: 999, reason: 'uydurma' }, // not in the list
        { attributeId: 48, attributeValueId: 201, reason: 'Ahşap kutu' },
        { attributeId: 48, attributeValueId: 202 }, // duplicate attribute
        { attributeId: 77, attributeValueId: 1 }, // not asked
        { attributeId: 47, attributeValueId: 101 }, // same as staged
        'junk',
      ],
    };
    const out = sanitizeAttributeSuggestions(raw, asked, [{ attributeId: 47, attributeValueId: 101 }], { keepReason: true });
    expect(out).toEqual([
      { attributeId: 48, attributeName: 'Materyal', attributeValueId: 201, valueName: 'Ahşap', required: true, reason: 'Ahşap kutu' },
      { attributeId: 50, attributeName: 'Stil', attributeValueId: 301, valueName: 'Modern', required: false, reason: 'Modern görünüm' },
    ]);
    expect(sanitizeAttributeSuggestions(raw, asked, [])[0].reason).toBeUndefined();
    const replacing = sanitizeAttributeSuggestions([{ attributeId: 47, attributeValueId: 102 }], asked, [{ attributeId: 47, attributeValueId: 101 }]);
    expect(replacing[0].replaces).toBe('Naturel');
  });

  it('mergeTrendyolAttributes: replaces by id, keeps everything else', () => {
    const merged = mergeTrendyolAttributes(
      [{ attributeId: 47, attributeValueId: 101 }, { attributeId: 49, customAttributeValue: '20x15' }],
      [{ attributeId: 47, attributeName: 'Renk', attributeValueId: 102, valueName: 'Beyaz', required: true }, { attributeId: 48, attributeName: 'Materyal', attributeValueId: 201, valueName: 'Ahşap', required: true }],
    );
    expect(merged).toEqual([{ attributeId: 47, attributeValueId: 102 }, { attributeId: 49, customAttributeValue: '20x15' }, { attributeId: 48, attributeValueId: 201 }]);
  });
});

// ── Hook ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe.each<Locale>(['en', 'tr'])('useListingAI trendyol (%s)', (locale) => {
  const input: AiListingInput = { title: 'Ahşap anı kutusu isim baskılı', description: '<p>Eski açıklama</p>', brandName: 'Belle Couture', categoryName: 'Saklama Kutusu', currency: 'TRY' };

  it('Suggest a title: Trendyol endpoint with brand + category, Turkish proposal, tip only in TR, nothing written until Use', async () => {
    route = (c) => (c.url === '/api/ai/trendyol?action=optimize_title' ? { json: { optimizedTitle: TR_TITLE, tips: ['Marka başta olmalı'] } } : undefined);
    const setField = vi.fn();
    const { ref } = mount({ input, setField, getField: () => input.title }, locale);
    await act(async () => { await ref.current!.suggestTitle(); });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toMatchObject({ title: input.title, brand: 'Belle Couture', categoryName: 'Saklama Kutusu' });
    const p = ref.current!.get<string>('title');
    expect(p.status).toBe('ready');
    expect(p.value).toBe(TR_TITLE);
    expect(p.rationale).toBe(locale === 'tr' ? 'Marka başta olmalı' : undefined);
    expect(setField).not.toHaveBeenCalled();
    expect(ref.current!.suggestionProps('title')?.counter).toEqual({ value: TR_TITLE.length, max: TRENDYOL_AI_TITLE_MAX });
    act(() => ref.current!.apply('title'));
    expect(setField).toHaveBeenCalledWith('title', TR_TITLE);
    neverSent();
  });

  it('Write description: optimize_description with the tag-stripped current text → HTML proposal', async () => {
    route = (c) => (c.url === '/api/ai/trendyol?action=optimize_description' ? { json: { description: TR_DESC, wordCount: 40 } } : undefined);
    const setField = vi.fn();
    const { ref } = mount({ input: { ...input, attributeLines: [{ name: 'Renk', value: 'Naturel' }] }, setField, getField: () => '' }, locale);
    await act(async () => { await ref.current!.writeDescription(); });
    expect(calls[0].body).toMatchObject({ description: 'Eski açıklama', attributes: [{ name: 'Renk', value: 'Naturel' }] });
    const p = ref.current!.get<string>('description');
    expect(p.status).toBe('ready');
    expect(String(p.value)).toContain('<ul><li>Ölçü: 20x15 cm</li>');
    expect(setField).not.toHaveBeenCalled();
    neverSent();
  });

  it('a garbled title is an error card, never a value', async () => {
    route = () => ({ json: { optimizedTitle: '{"optimizedTitle": "' } });
    const { ref } = mount({ input, setField: vi.fn(), getField: () => '' }, locale);
    await act(async () => { await ref.current!.suggestTitle(); });
    expect(ref.current!.get('title')).toMatchObject({ status: 'error', error: true });
  });

  it('402 → limit reached, buttons disabled', async () => {
    route = () => ({ status: 402, json: { error: 'limit' } });
    const { ref } = mount({ input, setField: vi.fn(), getField: () => '' }, locale);
    await act(async () => { await ref.current!.suggestTitle(); });
    await waitFor(() => expect(ref.current!.limitReached).toBe(true));
    expect(ref.current!.buttonState('title')).toMatchObject({ disabled: true, supported: true });
  });

  it('price check, tags, photo: not supported for Trendyol → no request', async () => {
    const { ref } = mount({ input, setField: vi.fn(), getField: () => '' }, locale);
    await act(async () => {
      await ref.current!.checkPrice();
      await ref.current!.getTagIdeas();
      expect(await ref.current!.generatePhoto({ prompt: 'kutu' })).toBeNull();
    });
    expect(calls).toHaveLength(0);
    expect(ref.current!.buttonState('price').supported).toBe(false);
    expect(titleSectionAiProps(ref.current!)).toHaveProperty('aiTitle');
  });

  it('Suggest attributes: asks missing ones, proposals only; accept one / accept all write the merged list with Undo', async () => {
    route = (c) => (c.url === '/api/ai/trendyol?action=suggest_attributes'
      ? { json: { suggestions: [{ attributeId: 48, attributeValueId: 201, reason: 'Ahşap' }, { attributeId: 50, attributeValueId: 301 }, { attributeId: 48, attributeValueId: 999 }] } }
      : undefined);
    let field: unknown = [{ attributeId: 47, attributeValueId: 101 }];
    const setField = vi.fn((k: string, v: unknown) => { if (k === 'attributes') field = v; });
    const { ref } = mount({ input, setField, getField: (k) => (k === 'attributes' ? field : '') }, locale);
    const handoff = attributesAiFrom(ref.current!)!;
    expect(handoff).not.toBeNull();
    expect(handoff.value).toBeNull();
    await act(async () => { await ref.current!.suggestAttributes(toAiAttributes(CATEGORY_ATTRIBUTES)); });
    const asked = (calls[0].body as { categoryAttributes: Array<{ attributeId: number }> }).categoryAttributes.map((a) => a.attributeId);
    expect(asked).toEqual([48, 50]);
    expect(setField).not.toHaveBeenCalled();
    const ready = attributesAiFrom(ref.current!)!;
    expect(ready.value).toEqual([{ attributeId: 48, attributeValueId: 201 }, { attributeId: 50, attributeValueId: 301 }]);
    expect(ref.current!.suggestionProps('attributes')?.value).toEqual(['Materyal: Ahşap', 'Stil: Modern']);

    act(() => ref.current!.acceptAttribute(48));
    expect(field).toEqual([{ attributeId: 47, attributeValueId: 101 }, { attributeId: 48, attributeValueId: 201 }]);
    expect(attributesAiFrom(ref.current!)!.value).toEqual([{ attributeId: 50, attributeValueId: 301 }]);

    act(() => { expect(ref.current!.acceptAllAttributes()).toBe(1); });
    expect(field).toEqual([{ attributeId: 47, attributeValueId: 101 }, { attributeId: 48, attributeValueId: 201 }, { attributeId: 50, attributeValueId: 301 }]);
    expect(ref.current!.get('attributes').status).toBe('idle');
    neverSent();
  });

  it('hand-off run() takes no argument: loads the category attributes itself (input.categoryId), proposals only', async () => {
    route = (c) => (c.url === '/api/trendyol/metadata?action=category_attributes&categoryId=1234'
      ? { json: CATEGORY_ATTRIBUTES }
      : c.url === '/api/ai/trendyol?action=suggest_attributes'
        ? { json: { suggestions: [{ attributeId: 47, attributeValueId: 102 }] } }
        : undefined);
    const setField = vi.fn();
    const { ref } = mount({ input: { ...input, categoryId: '1234' }, setField, getField: () => '[]' }, locale);
    await act(async () => { attributesAiFrom(ref.current!)!.run(); });
    await waitFor(() => expect(attributesAiFrom(ref.current!)!.value).toEqual([{ attributeId: 47, attributeValueId: 102 }]));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/trendyol/metadata?action=category_attributes&categoryId=1234',
      'POST /api/ai/trendyol?action=suggest_attributes',
    ]);
    expect(setField).not.toHaveBeenCalled();
  });

  it('hand-off run() without a category → "choose a category" error, no request', async () => {
    const { ref } = mount({ input, setField: vi.fn(), getField: () => '' }, locale);
    await act(async () => { attributesAiFrom(ref.current!)!.run(); });
    expect(calls).toHaveLength(0);
    expect(attributesAiFrom(ref.current!)!.error).toBe(aiMsg(locale, 'attributesNeedCategory'));
  });

  it('attributes stored as a JSON string stay a JSON string', async () => {
    route = () => ({ json: { suggestions: [{ attributeId: 47, attributeValueId: 102 }] } });
    let field: unknown = '[]';
    const setField = vi.fn((k: string, v: unknown) => { field = v; });
    const { ref } = mount({ input, setField, getField: () => field }, locale);
    await act(async () => { await ref.current!.suggestAttributes(toAiAttributes(CATEGORY_ATTRIBUTES)); });
    act(() => ref.current!.acceptAttribute(47));
    expect(field).toBe('[{"attributeId":47,"attributeValueId":102}]');
  });

  it('no category attributes → "choose a category" error, no request; nothing confident → its own line', async () => {
    const { ref } = mount({ input, setField: vi.fn(), getField: () => [] }, locale);
    await act(async () => { await ref.current!.suggestAttributes([]); });
    expect(calls).toHaveLength(0);
    expect(ref.current!.get('attributes').error).toBe(aiMsg(locale, 'attributesNeedCategory'));
    route = () => ({ json: { suggestions: [] } });
    await act(async () => { await ref.current!.suggestAttributes(toAiAttributes(CATEGORY_ATTRIBUTES)); });
    expect(ref.current!.get('attributes').error).toBe(aiMsg(locale, 'noAttributeIdeas'));
  });

  it('copy to Trendyol (fillListing): Turkish title then description from the source text; 2 calls, proposals only', async () => {
    route = (c) => {
      if (c.url.endsWith('optimize_title')) return { json: { optimizedTitle: TR_TITLE, tips: [] } };
      if (c.url.endsWith('optimize_description')) return { json: { description: TR_DESC } };
      return undefined;
    };
    const setField = vi.fn();
    const { ref } = mount({ input: { title: '', description: '' }, setField, getField: () => '' }, locale);
    await act(async () => { await ref.current!.fillListing({ seed: 'Personalized Wooden Keepsake Box', sourceDescription: '<p>Handmade wooden box with a name.</p>' }); });
    expect(calls.map((c) => c.url)).toEqual(['/api/ai/trendyol?action=optimize_title', '/api/ai/trendyol?action=optimize_description']);
    expect(calls[0].body).toMatchObject({ title: 'Personalized Wooden Keepsake Box' });
    expect(calls[1].body).toMatchObject({ title: TR_TITLE, description: 'Handmade wooden box with a name.' });
    expect(ref.current!.fill.steps.map((s) => [s.id, s.status])).toEqual([['title', 'done'], ['description', 'done']]);
    expect(setField).not.toHaveBeenCalled();
    act(() => { expect(ref.current!.applyAll()).toBe(2); });
    expect(setField).toHaveBeenCalledWith('title', TR_TITLE);
    neverSent();
  });
});

describe.each<AiMarketplace>(['wix', 'shopify'])('useListingAI %s (no AI in v1)', (marketplace) => {
  it('every action is a no-op with no request; supports() is false; no title props, no attributes hand-off', async () => {
    const setField = vi.fn();
    const { ref } = mount({ marketplace, input: { title: 'Wooden box', description: 'x' }, setField, getField: () => '' });
    await act(async () => {
      await ref.current!.suggestTitle();
      await ref.current!.writeDescription();
      await ref.current!.checkPrice();
      await ref.current!.fillListing({ seed: 'Wooden box' });
      await ref.current!.suggestAttributes(toAiAttributes(CATEGORY_ATTRIBUTES));
    });
    expect(calls).toHaveLength(0);
    expect(ref.current!.proposals).toEqual({});
    expect(ref.current!.supports('title')).toBe(false);
    expect(ref.current!.buttonState('fill').supported).toBe(false);
    expect(titleSectionAiProps(ref.current!)).toEqual({});
    expect(attributesAiFrom(ref.current!)).toBeNull();
    expect(setField).not.toHaveBeenCalled();
  });
});

// ── Score: required attributes ───────────────────────────────────────────────────────────────────────────────

describe('trendyol score: required attributes', () => {
  const base = { title: TR_TITLE, brandName: 'Belle Couture', categoryName: 'Saklama Kutusu', imageCount: 6, description: 'x'.repeat(320), attributeCount: 6, listPrice: 899, salePrice: 749, quantity: 4, approved: true, rejected: false, dimensionalWeight: 2 };

  it('missing required attributes fail the check whatever the count; unknown keeps the count rule', () => {
    const attr = (input: Parameters<typeof trendyolChecks>[0]) => trendyolChecks(input).find((c) => c.id === 'attributes')!;
    expect(attr({ ...base, requiredAttributesMissing: 2 })).toMatchObject({ status: 'fail', label: 'listingScore.trendyol.attributes.requiredMissing', params: { count: 2 }, fix: { field: 'attributes' } });
    expect(attr({ ...base, requiredAttributesMissing: 0 }).status).toBe('pass');
    expect(attr({ ...base, requiredAttributesMissing: null }).status).toBe('pass');
    expect(scoreTrendyolProduct({ ...base, requiredAttributesMissing: 2 }).score).toBeLessThan(scoreTrendyolProduct(base).score);
    expect(trendyolRequiredMissing({ required: 3, filled: 1 })).toBe(2);
    expect(trendyolRequiredMissing({ required: 2, filled: 5 })).toBe(0);
    expect(trendyolRequiredMissing(null)).toBeUndefined();
  });

  it.each<Locale>(['en', 'tr'])('requiredMissing label formats in %s', (locale) => {
    const msg = (MESSAGES[locale] as unknown as { listingScore: { trendyol: { attributes: { requiredMissing: string } } } }).listingScore.trendyol.attributes.requiredMissing;
    expect(new IntlMessageFormat(msg, locale).format({ count: 2 })).toMatch(/2/);
  });
});

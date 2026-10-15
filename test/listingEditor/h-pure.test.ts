// Group H pure logic: AI guards (entities decoded, garbled dropped, limits), research → band (median, never avg),
// review rows / keep list (a queued delete always first), profile patch + legacy storage round trip, schedule block.
import { describe, expect, it } from 'vitest';
import {
  FILL_LABEL_KEY, creditsFor, etsyMarketContext, fillCredits, fitWords, mergeAspects, ownImageUrls, priceBandFrom, researchFromEbayNiche, researchFromEtsySearch,
  researchQuery, sanitizeAltText, sanitizeAspects, sanitizeDescription, sanitizeTagIdeas, sanitizeTitle, toDecimalString,
  toMarketBand,
} from '@/components/domain/listing-editor/useListingAI';
import {
  FIELD_LABEL_KEYS, REVIEW_QUEUED_TYPES, buildReviewRows, defaultChoices, fieldLabelKey, humanizeKey, keepList, orderQueued, plainValue,
} from '@/components/domain/listing-editor/ReviewDifferencesPanel';
import { ETSY_FIELD_KEYS } from '@/components/domain/listing-editor/adapters/etsy';
import { EBAY_FIELD_KEYS, decodeAspects, encodeAspects } from '@/components/domain/listing-editor/adapters/ebay';
import { EBAY_DIFF_FIELDS } from '@/lib/ebay/draftPlan';
/** The stored eBay profile shape the old drawer read (components/ebay/ListingTemplates.tsx, deleted). */
type EbayListingTemplate = {
  fields: { price?: number; aspects?: Record<string, string[]>; listingPolicies?: Record<string, string>; [k: string]: unknown };
};
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { H_EN, H_TR, mergeMessages } from './h-messages';
import {
  PROFILE_STORAGE_KEY, buildProfileFields, buildProfilePatch, defaultSelection, loadProfiles, profileSections, saveProfile,
} from '@/components/domain/listing-editor/ProfilesModal';
import { scheduleBlock } from '@/components/domain/listing-editor/ScheduleModal';
import { flatKeys } from './h-messages';

const lookup = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), tree);

describe('AI guards', () => {
  it('Etsy title: decodes entities, applies house style, never returns entities', () => {
    const out = sanitizeTitle('etsy', 'personalized baby blanket | mom&#39;s gift - newborn');
    expect(out).toBe("Personalized Baby Blanket, Mom's Gift, Newborn");
    expect(out).not.toMatch(/&#?\w+;/);
  });

  it('title: garbled or empty model output becomes "" (shown as the inline error, never toasted)', () => {
    expect(sanitizeTitle('etsy', 'a b c d e f g h')).toBe('');
    expect(sanitizeTitle('etsy', '')).toBe('');
    expect(sanitizeTitle('ebay', ['%%%%', '!!!!!', '####'])).toBe('');
  });

  it('eBay title is cut at a word boundary to 80', () => {
    const long = 'Vintage Solid Brass Candle Holder Set of Two Hand Polished Mid Century Modern Table Decor Gift';
    const out = sanitizeTitle('ebay', long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(out)).toBe(true);
    expect(out.endsWith(' ')).toBe(false);
  });

  it('fitWords never cuts mid-word when a space is near', () => {
    expect(fitWords('alpha beta gamma', 12)).toBe('alpha beta');
    expect(fitWords('short', 12)).toBe('short');
  });

  it('description: arrays become paragraphs, entities decoded (Etsy), too short is rejected', () => {
    const para = 'Wrap your little one in a soft, personalized blanket that&#39;s made to order in our studio.';
    expect(sanitizeDescription('etsy', [para, para])).toBe(`${para.replace('&#39;', "'")}\n\n${para.replace('&#39;', "'")}`);
    expect(sanitizeDescription('etsy', 'Too short')).toBe('');
  });

  it('eBay description keeps HTML (eBay renders it) but measures the text', () => {
    const html = `<div><p>${'Solid brass candle holder with a hand polished finish. '.repeat(3)}</p></div>`;
    expect(sanitizeDescription('ebay', { description: html })).toBe(html);
    expect(sanitizeDescription('ebay', '<p>tiny</p>')).toBe('');
  });

  it('tag ideas: no title overlap, ≤ 20 chars, no near-duplicates of current tags', () => {
    const ideas = sanitizeTagIdeas(['newborn gift', 'baby blanket', 'swaddle for baby girl nursery', 'nursery decor', 'Nursery Decor'], 'Personalized Baby Blanket', ['nursery décor', 'newborn gifts']);
    expect(ideas).not.toContain('baby blanket'); // overlaps the title
    expect(ideas).not.toContain('swaddle for baby girl nursery'); // > 20
    expect(ideas).not.toContain('newborn gift'); // ≈ current "newborn gifts"
    expect(ideas.every((t) => t.length <= 20)).toBe(true);
  });

  it('alt text: decoded, ≤ 250, digits-only rejected', () => {
    expect(sanitizeAltText('Pink baby blanket with &quot;Ava&quot; embroidered')).toBe('Pink baby blanket with "Ava" embroidered');
    expect(sanitizeAltText('12')).toBe('');
    expect(sanitizeAltText('word '.repeat(80)).length).toBeLessThanOrEqual(250);
  });

  it('aspects: only asked names, values ≤ 65 chars (eBay payload rule)', () => {
    const out = sanitizeAspects({ Brand: ['Unbranded'], color: 'Blue', Material: ['x'.repeat(66)], Extra: ['nope'] }, ['Brand', 'Color', 'Material']);
    expect(out).toEqual({ Brand: ['Unbranded'], Color: ['Blue'] });
  });

  it('toDecimalString formats without toFixed', () => {
    expect(toDecimalString(49)).toBe('49.00');
    expect(toDecimalString(12.5)).toBe('12.50');
    expect(toDecimalString(0.205)).toBe('0.21');
  });

  it('credits: text 1, image 10 (CRITIQUE X6)', () => {
    expect(creditsFor('title')).toBe(1);
    expect(creditsFor('photo')).toBe(10);
    // One Start faster run is several billable calls, and the label says so (CRITIQUE X6).
    expect(fillCredits('etsy')).toBe(3);
    expect(fillCredits('ebay', true)).toBe(5);
    expect(fillCredits('ebay', false)).toBe(4);
    expect(creditsFor('fill', { marketplace: 'etsy' })).toBe(3);
    expect(creditsFor('fill', { marketplace: 'ebay' })).toBe(5);
  });

  it('identify_product gets only own-hosted photos, at most 4', () => {
    const own = 'https://kolayxport.com/api/clawd/serve-image?id=1';
    expect(ownImageUrls([own, 'https://evil.example/x.jpg', own, own, own, own])).toEqual([own, own, own, own]);
  });
});

describe('research and price band', () => {
  const search = {
    items: Array.from({ length: 48 }, () => ({})),
    priceStats: { p25: 38, p75: 62, median: 49, min: 10, max: 300, avg: 9999, n: 44, currency: 'USD', excludedNoFx: 2, excludedImplausible: 1 },
    tagFrequency: [{ tag: 'baby gift', pct: 40 }],
    titleKeywords: [{ keyword: 'blanket', pct: 80 }],
    fetchedAt: '2026-10-15T10:00:00.000Z',
  };

  it('research query is the first title phrase, decoded, ≤ 60', () => {
    expect(researchQuery('Baby&#39;s Name Blanket, Custom Gift')).toBe("Baby's Name Blanket");
  });

  it('Etsy research uses median / P25–P75, never avg', () => {
    const r = researchFromEtsySearch(search, 'baby name blanket');
    expect(r?.count).toBe(48);
    expect(r?.priceStats?.median).toBe(49);
    expect(JSON.stringify(etsyMarketContext(r))).not.toContain('9999');
    const band = priceBandFrom(r, 'etsy', 'USD');
    expect(band).toMatchObject({ p25: 38, p75: 62, median: 49, suggested: 49, usable: true, n: 44, excluded: 3 });
    expect(toMarketBand(band!)).toMatchObject({ p25: 38, median: 49, p75: 62, query: 'baby name blanket', fetchedAt: '2026-10-15T10:00:00.000Z' });
  });

  it('a band in another currency is shown but not usable (no Use button)', () => {
    const band = priceBandFrom(researchFromEtsySearch(search, 'q'), 'etsy', 'TRY');
    expect(band?.usable).toBe(false);
  });

  it('no research → no band (score check stays na, no orange corner warning)', () => {
    expect(priceBandFrom(null, 'etsy', 'USD')).toBeNull();
    expect(priceBandFrom(researchFromEtsySearch({ items: [], priceStats: null }, 'q'), 'etsy', 'USD')).toBeNull();
  });

  it('eBay: the model price is clamped into P25–P75', () => {
    const r = researchFromEbayNiche({ medianPrice: 20, priceStats: { p25: 15, p75: 25, median: 20, n: 30, sampled: 40, currency: 'USD' } }, 'brass candle holder');
    expect(r?.count).toBe(40);
    expect(priceBandFrom(r, 'ebay', 'USD', 99)?.suggested).toBe(25);
    expect(priceBandFrom(r, 'ebay', 'USD', 18)?.suggested).toBe(18);
    expect(r?.ebay.avgPrice).toBe(20); // the prompt's "average" slot carries the median
  });
});

describe('review differences model', () => {
  const diff = {
    fields: [
      { key: 'quantity', base: 40, remote: 38, draft: undefined, changedRemotely: true, inDraft: false },
      { key: 'tags', base: [], remote: [], draft: ['a'], changedRemotely: false, inDraft: true },
      { key: 'title', base: 'A', remote: 'B', draft: 'C', changedRemotely: true, inDraft: true },
      { key: 'price', base: 60, remote: 64.99, draft: 69.99, changedRemotely: true, inDraft: true },
    ],
  };

  it('conflicts first, then Etsy-only (read-only), then draft-only', () => {
    expect(buildReviewRows(diff).map((r) => `${r.kind}:${r.key}`)).toEqual(['conflict:title', 'conflict:price', 'remoteOnly:quantity', 'draftOnly:tags']);
  });

  it('defaults to Mine; keep list drops fields set to Etsy and always keeps draft-only fields', () => {
    const rows = buildReviewRows(diff);
    const choices = defaultChoices(rows);
    expect(choices).toEqual({ title: 'mine', price: 'mine' });
    expect(keepList(rows, { ...choices, price: 'remote' })).toEqual(['title', 'tags']);
    expect(keepList(rows, choices)).not.toContain('quantity');
  });

  it('a queued delete is always listed first; completed actions are hidden', () => {
    expect(orderQueued([{ type: 'renew' }, { type: 'delete' }, { type: 'publish', completedAt: '2026-10-01' }]).map((a) => a.type)).toEqual(['delete', 'renew']);
  });

  it('every field key and queued action has a translated label in EN and TR; unknown keys get a neutral one', () => {
    const msgs = { en: mergeMessages(en, H_EN), tr: mergeMessages(tr, H_TR) };
    const keys = new Set<string>([...ETSY_FIELD_KEYS, ...EBAY_FIELD_KEYS, ...EBAY_DIFF_FIELDS.map((f) => f.key), ...Object.keys(FIELD_LABEL_KEYS)]);
    for (const k of keys) {
      const full = fieldLabelKey(k);
      expect(full, k).not.toBe('listingEditor.review.fields.other');
      for (const l of ['en', 'tr'] as const) expect(typeof lookup(msgs[l], full), `${l}:${k}`).toBe('string');
    }
    expect(fieldLabelKey('product.conditionDescription')).toBe('listingEditor.field.conditionDescription');
    expect(fieldLabelKey('some_future_field')).toBe('listingEditor.review.fields.other');
    for (const type of [...REVIEW_QUEUED_TYPES, 'other']) {
      for (const l of ['en', 'tr'] as const) expect(typeof lookup(msgs[l], `listingEditor.review.queued.${type}`), `${l}:${type}`).toBe('string');
    }
    for (const k of Object.values(FILL_LABEL_KEY)) for (const l of ['en', 'tr'] as const) expect(typeof lookup(msgs[l], k), `${l}:${k}`).toBe('string');
  });

  it('object values show translated sub-labels, never raw API keys; item specifics keep their names', () => {
    const f = { money: (a: number, c: string) => `${c} ${a}`, num: (v: number) => String(v), yes: 'Evet', no: 'Hayır', label: (k: string) => (k === 'value' ? 'Değer' : null) };
    expect(plainValue({ fulfillmentPolicyId: 'F1', returnPolicyId: 'R1' }, f, 'listingPolicies')).toBe('F1; R1');
    expect(plainValue({ value: 2, unitOfMeasure: 'POUND' }, f, 'weight')).toBe('Değer: 2; POUND');
    expect(plainValue({ Brand: ['Acme'] }, f, 'aspects')).toBe('Brand: Acme');
  });

  it('values: entities decoded, HTML stripped, money for price, arrays shortened', () => {
    const f = { money: (a: number, c: string) => `${c} ${a}`, num: (v: number) => String(v), yes: 'Yes', no: 'No' };
    expect(plainValue('one&#39;s <b>blanket</b>', f, 'title')).toBe("one's blanket");
    expect(plainValue(69.99, f, 'price', 'USD')).toBe('USD 69.99');
    expect(plainValue({ amount: 6999, divisor: 100, currency_code: 'USD' }, f, 'price')).toBe('USD 69.99');
    expect(plainValue(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], f, 'tags')).toBe('a, b, c, d, e, f +2');
    expect(plainValue(true, f, 'is_supply')).toBe('Yes');
    expect(plainValue('', f, 'title')).toBeNull();
    expect(humanizeKey('item_weight_unit')).toBe('Item weight unit');
    expect(humanizeKey('product.conditionDescription')).toBe('Condition description');
  });
});

describe('profiles (legacy ListingTemplates storage)', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('sections present in a profile; title is off by default', () => {
    const p = { fields: { title: 'X', tags: ['a'], shipping_profile_id: 12, price: '' } };
    const sections = profileSections('etsy', p);
    expect(sections).toEqual(['title', 'tags', 'shipping']);
    expect(defaultSelection(sections)).toEqual(['tags', 'shipping']);
  });

  it('patch covers only chosen sections, skips empty values, decodes entities', () => {
    const p = { fields: { title: 'Mom&#39;s Gift', tags: ['mom&#39;s gift'], materials: [], shipping_profile_id: 12, processing_min: '' } };
    expect(buildProfilePatch('etsy', p, ['tags', 'shipping'])).toEqual({ tags: ["mom's gift"], shipping_profile_id: 12 });
  });

  it('eBay policies are flattened on apply and folded back on save', () => {
    const p = { fields: { listingPolicies: { fulfillmentPolicyId: 'F1', returnPolicyId: 'R1' }, aspects: { Brand: ['Unbranded'] } } };
    expect(buildProfilePatch('ebay', p, ['shipping', 'specifics'])).toEqual({ fulfillmentPolicyId: 'F1', returnPolicyId: 'R1', aspects: encodeAspects({ Brand: ['Unbranded'] }) });
    expect(buildProfileFields('ebay', { fulfillmentPolicyId: 'F1', paymentPolicyId: '', returnPolicyId: 'R1' }, ['shipping'])).toEqual({ listingPolicies: { fulfillmentPolicyId: 'F1', returnPolicyId: 'R1' } });
  });

  it('eBay save writes the legacy EbayListingTemplate shape (price number, aspects map); apply converts back', () => {
    const current = {
      title: 'Brass Candle Holder', price: '24.50', aspects: encodeAspects({ Brand: ['Acme'], Material: ['Brass'] }),
      condition: 'USED_EXCELLENT', categoryId: '123', fulfillmentPolicyId: 'F1',
    };
    const stored = buildProfileFields('ebay', current, ['title', 'specifics', 'price', 'details', 'shipping']);
    const legacy: EbayListingTemplate['fields'] = stored as EbayListingTemplate['fields'];
    expect(typeof legacy.price).toBe('number');
    expect(legacy.price).toBe(24.5);
    expect(legacy.aspects).toEqual({ Brand: ['Acme'], Material: ['Brass'] });
    expect(Object.keys(legacy.aspects!)).toHaveLength(2); // the legacy "N specifics" chip counts names, not characters
    expect(legacy.listingPolicies).toEqual({ fulfillmentPolicyId: 'F1' });
    // Legacy drawer renders `price.toFixed(2)`: must not throw.
    expect(() => legacy.price!.toFixed(2)).not.toThrow();

    const patch = buildProfilePatch('ebay', { fields: { ...stored, categoryName: 'Candle Holders' } }, ['title', 'specifics', 'price', 'details', 'shipping']);
    expect(patch.price).toBe('24.50');
    expect(decodeAspects(patch.aspects as string)).toEqual({ Brand: ['Acme'], Material: ['Brass'] });
    expect(patch).not.toHaveProperty('categoryName'); // not an editor field
    expect(patch).toMatchObject({ title: 'Brass Candle Holder', condition: 'USED_EXCELLENT', categoryId: '123', fulfillmentPolicyId: 'F1' });
  });

  it('save → load round trip in the legacy key and shape; same name replaces', () => {
    const s = memory();
    saveProfile('etsy', 'Baby blankets', { tags: ['a'] }, s, new Date('2026-10-15T10:00:00Z'));
    saveProfile('etsy', ' baby BLANKETS ', { tags: ['b'] }, s, new Date('2026-10-15T11:00:00Z'));
    const raw = JSON.parse(s.m.get(PROFILE_STORAGE_KEY.etsy)!);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ name: 'baby BLANKETS', fields: { tags: ['b'] }, createdAt: '2026-10-15T11:00:00.000Z' });
    expect(loadProfiles('etsy', s)[0].fields).toEqual({ tags: ['b'] });
  });

  it('broken or blocked storage never throws', () => {
    expect(loadProfiles('etsy', { getItem: () => '{not json' })).toEqual([]);
    expect(loadProfiles('etsy', { getItem: () => { throw new Error('blocked'); } })).toEqual([]);
    expect(saveProfile('etsy', 'x', {}, { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toBeNull();
  });
});

describe('AI item specifics merge', () => {
  it('existing specifics are kept: AI values are added on top (encoded field, map, or input fallback)', () => {
    const field = encodeAspects({ Brand: ['Acme'], Color: ['Gold'] });
    expect(mergeAspects(field, undefined, { Material: ['Brass'] })).toEqual({ Brand: ['Acme'], Color: ['Gold'], Material: ['Brass'] });
    expect(mergeAspects({ Brand: ['Acme'] }, undefined, { Brand: ['Other'] })).toEqual({ Brand: ['Other'] });
    expect(mergeAspects(undefined, { Brand: ['Acme'] }, { Material: ['Brass'] })).toEqual({ Brand: ['Acme'], Material: ['Brass'] });
    expect(mergeAspects('', { Brand: ['stale input'] }, { Material: ['Brass'] })).toEqual({ Material: ['Brass'] });
  });
});

describe('schedule', () => {
  const min = new Date('2026-10-15T10:15:00Z');
  it('a queued delete is never schedulable', () => {
    expect(scheduleBlock({ at: new Date('2026-10-16T10:00:00Z'), min, hasQueuedDelete: true, draftId: 'd1' })).toBe('delete');
  });
  it('needs a draft, a time, and a time after the minimum', () => {
    expect(scheduleBlock({ at: null, min, hasQueuedDelete: false, draftId: null })).toBe('noDraft');
    expect(scheduleBlock({ at: null, min, hasQueuedDelete: false, draftId: 'd1' })).toBe('pickTime');
    expect(scheduleBlock({ at: new Date('2026-10-15T10:00:00Z'), min, hasQueuedDelete: false, draftId: 'd1' })).toBe('pickFuture');
    expect(scheduleBlock({ at: new Date('2026-10-15T12:00:00Z'), min, hasQueuedDelete: false, draftId: 'd1' })).toBeNull();
  });
});

describe('i18n fragment', () => {
  const rows = flatKeys();
  it('every key has EN and TR, real Turkish characters, no ASCII-Turkish, no suffix after a number', () => {
    for (const r of rows) {
      expect(r.en, r.key).toBeTruthy();
      expect(r.tr, r.key).toBeTruthy();
      expect(r.tr, r.key).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
      expect(r.tr, r.key).not.toMatch(/\{(count|done|total|date|remoteTime|draftTime)\}'/);
    }
  });
  it('placeholders match between EN and TR', () => {
    const vars = (s: string) => Array.from(new Set((s.match(/\{(\w+)/g) ?? []).map((m) => m.slice(1)).filter((v) => !['plural', 'one', 'other', 'select'].includes(v)))).sort();
    for (const r of rows) expect(vars(r.tr), r.key).toEqual(vars(r.en));
  });
});

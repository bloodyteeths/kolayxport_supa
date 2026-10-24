import { describe, expect, it, vi } from 'vitest';
import { AI_TEXT_CHUNK, fieldsFor, guardAiTextItem, planAiTextRequests, runAiText, type AiTextInput } from '@/lib/bulk/aiText';

const input = (id: string, over: Partial<AiTextInput> = {}): AiTextInput => ({
  id, title: 'El Yapımı Bakır Cezve', description: 'Saf bakırdan el yapımı cezve. 350 ml.', tags: ['bakır cezve'], unsent: [], ...over,
});

describe('planning', () => {
  it('improve = description only; translate = chosen fields minus unsent ones', () => {
    expect(fieldsFor(input('a'), 'improve', ['title', 'tags'])).toEqual(['description']);
    expect(fieldsFor(input('a', { unsent: ['title'] }), 'translate', ['title', 'description', 'tags'])).toEqual(['description', 'tags']);
    expect(fieldsFor(input('a', { description: ' ' }), 'translate', ['description'])).toEqual([]);
  });
  it('groups by field set and chunks', () => {
    const many = Array.from({ length: 9 }, (_, i) => input(String(i)));
    const reqs = planAiTextRequests([...many, input('x', { unsent: ['title'] })], 'translate', ['title', 'description']);
    expect(reqs.map((r) => [r.fields.join('+'), r.items.length])).toEqual([['title+description', AI_TEXT_CHUNK], ['title+description', AI_TEXT_CHUNK], ['title+description', 1], ['description', 1]]);
  });
});

describe('guardAiTextItem', () => {
  it('keeps a usable translation; drops unchanged and garbled parts', () => {
    const r = guardAiTextItem(
      { listing_id: 'a', title: 'handmade copper turkish coffee pot, cezve', description: 'Handmade coffee pot of pure copper. 350 ml.', tags: ['gift for him', 'kitchen decor'] },
      input('a'),
      ['title', 'description', 'tags'],
    );
    expect(r?.title).toMatch(/^Handmade Copper Turkish Coffee Pot/);
    expect(r?.description).toBe('Handmade coffee pot of pure copper. 350 ml.');
    expect(r?.tags?.length).toBeGreaterThan(0);
    expect(guardAiTextItem({ description: 'Saf bakırdan el yapımı cezve. 350 ml.' }, input('a'), ['description'])).toBeNull();
    expect(guardAiTextItem(null, input('a'), ['description'])).toBeNull();
  });
});

describe('runAiText', () => {
  it('sends mode translate, applies guarded results, stops on 402', async () => {
    const calls: any[] = [];
    const fetcher = vi.fn(async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      if (calls.length > 1) return new Response(JSON.stringify({ limitType: 'editor' }), { status: 402 });
      return new Response(JSON.stringify({ optimized: body.listings.map((l: any) => ({ listing_id: l.listing_id, description: `EN ${l.listing_id} pure copper pot, 350 ml.` })) }), { status: 200 });
    });
    const inputs = Array.from({ length: 9 }, (_, i) => input(String(i)));
    const out = await runAiText(inputs, { mode: 'translate', fields: ['description'] }, fetcher as any);
    expect(calls[0]).toMatchObject({ action: 'bulk_optimize', mode: 'translate', fields: ['description'] });
    expect(out.results.length).toBe(AI_TEXT_CHUNK);
    expect(out.stop).toBe('limited');
  });
});

describe('English-only titles and tags (Etsy rule)', () => {
  it('drops tags and titles with Turkish-only letters', () => {
    const r = guardAiTextItem(
      { title: 'El Yapımı Bakır Cezve, Türk Kahvesi Makinesi', tags: ['bakır cezve', 'gift for him', 'kahve fincanı'], description: 'English text here, long enough.' },
      input('a'),
      ['title', 'tags', 'description'],
    );
    expect(r?.title).toBeUndefined();
    expect(r?.tags).toEqual(['gift for him']);
  });
});

import { alreadyEnglish, looksTurkish } from '@/lib/bulk/aiText';

describe('translate guard: already-English listings are never "translated"', () => {
  it('detects Turkish vs English', () => {
    expect(looksTurkish('El Yapımı Bakır Cezve')).toBe(true);
    expect(looksTurkish('Kisiye ozel isimli kolye ve kupe seti')).toBe(true);
    expect(looksTurkish('Iznik Tulip Decorative Plate, Hand Painted Turkish Ceramic Wall Plate')).toBe(false);
    expect(looksTurkish('Turkish Peshtemal Towel, Cotton Beach Towel, Hammam')).toBe(false);
  });
  it('English listings are skipped and counted, never sent', async () => {
    const calls: any[] = [];
    const fetcher = async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ optimized: [] }), { status: 200 }); };
    const en = { id: 'en', title: 'Iznik Tulip Decorative Plate, Hand Painted', description: 'A hand painted plate from Kutahya.', tags: ['plate'], unsent: [] };
    const tr = { id: 'tr', title: 'El Yapımı Bakır Cezve', description: 'Saf bakır.', tags: [], unsent: [] };
    expect(alreadyEnglish(en as any, 'translate')).toBe(true);
    expect(alreadyEnglish(en as any, 'improve')).toBe(false);
    const out = await runAiText([en, tr] as any, { mode: 'translate', fields: ['title', 'description'] }, fetcher as any);
    expect(out.alreadyEnglish).toBe(1);
    expect(calls.flatMap((c) => c.listings.map((l: any) => l.listing_id))).toEqual(['tr']);
    expect(calls[0].fields).toEqual(['title', 'description']);
  });
});

import { describe, expect, it } from 'vitest';
import { isRetryableAiError, parseAiJson, refineContents, refineFromBody } from '@/lib/ai/gemini';
import { mergePreferences, normalizePreference, preferencesBlock } from '@/lib/ai/preferences';
import { modelChain, thinkingConfigFor } from '@/lib/ai/models';

describe('lib/ai', () => {
  it('model chains start with the benchmarked models and always end on an older fallback', () => {
    expect(modelChain('fast')[0]).toBe('gemini-3.8-flash');
    expect(modelChain('deep')[0]).toBe('gemini-3.1-pro-preview');
    expect(modelChain('image')[0]).toBe('gemini-3-pro-image');
    for (const t of ['fast', 'deep', 'image'] as const) expect(modelChain(t).length).toBeGreaterThan(1);
  });

  it('buttons think low (3.x) / with a small budget (2.5); deep analysis keeps full thinking', () => {
    expect(thinkingConfigFor('fast', 'gemini-3.8-flash')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingConfigFor('fast', 'gemini-flash-latest')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingConfigFor('fast', 'gemini-2.5-flash')).toEqual({ thinkingBudget: 512 });
    expect(thinkingConfigFor('deep', 'gemini-3.1-pro-preview')).toBeUndefined();
  });

  it('falls back on retired / busy / timed-out models, not on bad requests', () => {
    expect(isRetryableAiError(new Error('[404 Not Found] models/x is not found'))).toBe(true);
    expect(isRetryableAiError(new Error('[429 Too Many Requests] Resource has been exhausted'))).toBe(true);
    expect(isRetryableAiError(new Error('[503 Service Unavailable] The model is overloaded'))).toBe(true);
    expect(isRetryableAiError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
    expect(isRetryableAiError(new Error('[400 Bad Request] Invalid JSON payload'))).toBe(false);
  });

  it('parses fenced or wrapped JSON', () => {
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseAiJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(parseAiJson('nope')).toBeNull();
  });

  it('refine turns: previous answer as the model turn, then the seller instruction', () => {
    const base = [{ role: 'user', parts: [{ text: 'write a title' }] }];
    const out = refineContents(base as any, { previous: { title: 'A' }, instruction: 'make it shorter' }, true);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ role: 'model', parts: [{ text: '{"title":"A"}' }] });
    expect((out[2].parts[0] as any).text).toMatch(/make it shorter[\s\S]*same JSON shape/);
    expect(refineContents(base as any, null, true)).toBe(base);
    expect(refineFromBody({ refine: { previous: 'x', instruction: '  ' } })).toBeNull();
    expect(refineFromBody({ refine: { previous: 'x', instruction: 'add `handmade` <b>' } })?.instruction).toBe('add handmade b');
  });

  it('preferences: normalised, merged (marketplace over all), rendered as one block', () => {
    const all = normalizePreference({ tone: 'warm', include: 'handmade, organic', avoid: ['cheap'] });
    const etsy = normalizePreference({ brand: 'Belle', include: ['gift ready'] });
    const m = mergePreferences(all, etsy);
    expect(m).toMatchObject({ tone: 'warm', brand: 'Belle', include: ['handmade', 'organic', 'gift ready'], avoid: ['cheap'] });
    const block = preferencesBlock(m);
    expect(block).toMatch(/Never use these words or claims: cheap/);
    expect(block).toMatch(/marketplace rule/);
    expect(preferencesBlock(normalizePreference({}))).toBe('');
  });
});

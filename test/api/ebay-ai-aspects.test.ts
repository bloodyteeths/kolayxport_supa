// /api/clawd/ebay-ai item specifics + seller facts (2026-10-18 re-capture on the Iznik bowl photo produced
// "Country of Origin: China", "Origin: Unknown", "Product Line: Tulip"). The model is mocked: the test reads the
// prompts the handler builds and what it returns for a placeholder-laden answer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const ai = vi.hoisted(() => ({ calls: [] as Array<{ system: string; user: unknown }>, answer: '{}' }));
vi.mock('@/lib/ai/gemini', () => ({
  getAiModel: (opts: { system: string }) => ({
    generateContent: async (user: unknown) => {
      ai.calls.push({ system: opts.system, user });
      return { response: { text: () => ai.answer } };
    },
  }),
  parseAiJson: (text: string) => { try { return JSON.parse(text); } catch { return null; } },
  refineFromBody: () => undefined,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ getAuthUser: async () => ({ id: 'u1' }) }));
vi.mock('@/lib/images/ownImage', () => ({ isReadablePhotoUrl: () => true, loadImageForUser: async () => null }));

import handler from '@/pages/api/clawd/ebay-ai';
import { GROUNDING_RULES } from '@/lib/ebay/aiPrompts';

async function call(action: string, body: Record<string, unknown>) {
  const req = { method: 'POST', query: { action }, body, headers: {} } as unknown as NextApiRequest;
  let status = 0;
  let json: any = null;
  const res = {
    status(s: number) { status = s; return this; },
    json(j: unknown) { json = j; return this; },
    setHeader() { return this; },
  } as unknown as NextApiResponse;
  await handler(req, res);
  return { status, json };
}

beforeEach(() => {
  ai.calls = [];
  ai.answer = '{}';
});

describe('suggest_aspects: only visible or given facts', () => {
  it('the prompt carries the grounding rule and never asks for the most likely country', async () => {
    ai.answer = JSON.stringify({ aspects: {} });
    await call('suggest_aspects', { title: 'Turkish Iznik Ceramic Bowl', aspectNames: ['Country/Region of Manufacture', 'Brand'] });
    const { system } = ai.calls[0];
    expect(system).toContain(GROUNDING_RULES);
    expect(system).not.toMatch(/most likely country/i);
    expect(system).not.toMatch(/reasonable guess/i);
    expect(system).not.toMatch(/Otherwise use "Unbranded"/);
    expect(system).toMatch(/Country\/Region of Manufacture.*NEVER guessed|NEVER guessed[^\n]*Country\/Region of Manufacture/);
    expect(system).toMatch(/Never answer with a placeholder such as "Unknown", "N\/A", "Does not apply"/);
  });

  it('placeholders are dropped; a required aspect keeps one only when eBay lists exactly that value', async () => {
    ai.answer = JSON.stringify({ aspects: { Origin: ['Unknown'], Brand: ['Unbranded'], 'Product Line': ['N/A'], Type: ['Does not apply'], Color: ['Blue'] } });
    const r1 = await call('suggest_aspects', { title: 'Ceramic bowl', aspectNames: ['Origin', 'Brand', 'Product Line', 'Type', 'Color'] });
    expect(r1.json).toEqual({ aspects: { Color: ['Blue'] } });

    const rules = [{ name: 'Brand', required: true, values: ['Unbranded', 'Iznik Co'] }, { name: 'Type', required: false, values: ['Does not apply'] }];
    const r2 = await call('suggest_aspects', { title: 'Ceramic bowl', aspectNames: ['Origin', 'Brand', 'Product Line', 'Type', 'Color'], aspectRules: rules });
    expect(r2.json).toEqual({ aspects: { Brand: ['Unbranded'], Color: ['Blue'] } });
    expect(ai.calls[1].system).toMatch(/Exception, only because the category requires these and eBay lists the value: Brand: Unbranded/);
  });

  it("the seller's facts reach the aspects, title and description prompts as given facts", async () => {
    ai.answer = JSON.stringify({ aspects: { 'Country/Region of Manufacture': ['Turkey'] } });
    const facts = 'handmade Turkish Iznik bowl';
    const r = await call('suggest_aspects', { title: 'Ceramic bowl', aspectNames: ['Country/Region of Manufacture'], sellerFacts: facts });
    expect(r.json).toEqual({ aspects: { 'Country/Region of Manufacture': ['Turkey'] } });
    expect(String(ai.calls[0].user)).toContain(`Seller's facts (stated by the seller, true for this item, may be used): ${facts}`);

    ai.answer = JSON.stringify({ optimizedTitle: 'x', suggestions: [], score: { before: 0, after: 0 } });
    await call('optimize_title', { title: 'ceramic bowl blue tulip', sellerFacts: facts });
    expect(String(ai.calls[1].user)).toContain(facts);
    expect(ai.calls[1].system).toMatch(/the seller's facts, the category and the given keywords/);

    ai.answer = JSON.stringify({ description: 'x' });
    await call('generate_description', { title: 'Iznik Bowl', sellerFacts: facts, format: 'text' });
    expect(String(ai.calls[2].user)).toContain(facts);
    expect(ai.calls[2].system).toContain(GROUNDING_RULES);
  });

  it('without seller facts nothing is added', async () => {
    ai.answer = JSON.stringify({ aspects: {} });
    await call('suggest_aspects', { title: 'Ceramic bowl', aspectNames: ['Color'] });
    expect(String(ai.calls[0].user)).not.toContain("Seller's facts");
  });
});

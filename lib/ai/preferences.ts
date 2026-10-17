// lib/ai/preferences.ts — the seller's standing AI instructions → a prompt block. Pure parts are ISOMORPHIC.

export type AiMarketplaceKey = 'all' | 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify' | 'amazon';
export const AI_PREF_MARKETPLACES: readonly AiMarketplaceKey[] = ['all', 'etsy', 'ebay', 'trendyol', 'wix', 'shopify', 'amazon'];

export type AiPreferenceValue = {
  tone?: string | null;
  include?: string[];
  avoid?: string[];
  brand?: string | null;
  notes?: string | null;
};

const LIMITS = { tone: 80, word: 40, words: 25, brand: 80, notes: 1000 } as const;

/** Bounded, de-fanged text (no template / markup characters reach the prompt). Pure. */
export function cleanPrefText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[`{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Normalises a preference payload (API input or DB row). Pure, exported for tests. */
export function normalizePreference(v: unknown): AiPreferenceValue {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const words = (x: unknown) =>
    Array.from(new Set((Array.isArray(x) ? x : typeof x === 'string' ? x.split(',') : [])
      .map((w) => cleanPrefText(w, LIMITS.word)).filter(Boolean))).slice(0, LIMITS.words);
  return {
    tone: cleanPrefText(o.tone, LIMITS.tone) || null,
    include: words(o.include),
    avoid: words(o.avoid),
    brand: cleanPrefText(o.brand, LIMITS.brand) || null,
    notes: cleanPrefText(o.notes, LIMITS.notes) || null,
  };
}

/** Marketplace preference over the 'all' defaults (lists are merged). Pure. */
export function mergePreferences(base: AiPreferenceValue | null, over: AiPreferenceValue | null): AiPreferenceValue {
  const a = base ?? {}; const b = over ?? {};
  return {
    tone: b.tone || a.tone || null,
    include: Array.from(new Set([...(a.include ?? []), ...(b.include ?? [])])),
    avoid: Array.from(new Set([...(a.avoid ?? []), ...(b.avoid ?? [])])),
    brand: b.brand || a.brand || null,
    notes: [a.notes, b.notes].filter(Boolean).join(' ') || null,
  };
}

/** The block added to every prompt; '' when the seller set nothing. Pure, exported for tests. */
export function preferencesBlock(p: AiPreferenceValue | null | undefined): string {
  if (!p) return '';
  const lines: string[] = [];
  if (p.tone) lines.push(`- Tone / style: ${p.tone}`);
  if (p.include?.length) lines.push(`- Always work these in where they fit naturally: ${p.include.join(', ')}`);
  if (p.avoid?.length) lines.push(`- Never use these words or claims: ${p.avoid.join(', ')}`);
  if (p.brand) lines.push(`- Brand / shop name: ${p.brand}`);
  if (p.notes) lines.push(`- Seller notes: ${p.notes}`);
  if (!lines.length) return '';
  return `SELLER PREFERENCES (follow them unless they break a marketplace rule or the required output format; keep the output language the task asks for):\n${lines.join('\n')}`;
}

// lib/ai/models.ts — which Gemini model each kind of AI work uses. ISOMORPHIC (no server imports).
//
// Benchmarked on production 2026-10-17 (same Etsy title task; same product photo):
//  - gemini-3.8-flash: rule-following titles in ~10 s → every interactive button.
//  - gemini-3.1-pro-preview: best reasoning, ~24 s → deep analysis and background bulk work.
//  - gemini-3-pro-image (Nano Banana Pro): whole product in frame, most faithful colours → all image generation.
// Env overrides let a model be swapped without a code change. Each tier falls back to older models when the first
// is unavailable (404 retired, 429 quota, 5xx, timeout) so a Google outage never surfaces as an error.

export type AiTier = 'fast' | 'deep' | 'image';

const env = (k: string) => (typeof process !== 'undefined' ? process.env?.[k] : undefined) || undefined;

export function modelChain(tier: AiTier): string[] {
  const chain =
    tier === 'image'
      ? [env('GEMINI_IMAGE_MODEL'), 'gemini-3-pro-image', 'gemini-nano-banana-2.1', 'gemini-3.1-flash-image']
      : tier === 'deep'
        ? [env('GEMINI_DEEP_MODEL'), 'gemini-3.1-pro-preview', 'gemini-pro-latest', 'gemini-3.8-flash', 'gemini-2.5-flash']
        : [env('GEMINI_TEXT_MODEL'), 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
  return Array.from(new Set(chain.filter((m): m is string => Boolean(m))));
}

/** Per-call timeout: buttons must not hang; deep/image work gets longer. */
export function timeoutFor(tier: AiTier): number {
  return tier === 'fast' ? 45_000 : tier === 'deep' ? 120_000 : 150_000;
}

/**
 * Thinking for a model on a tier. Buttons ('fast'): thinking 'low' — benchmarked 2026-10-17 on the editor's title
 * prompt (48 competitors): gemini-3.8-flash 18.1 s → 2.5 s with the same quality. Gemini 2.5 models take a token
 * budget instead of a level. 'deep' keeps the model default (full thinking). Pure, exported for tests.
 */
export function thinkingConfigFor(tier: AiTier, model: string): Record<string, unknown> | undefined {
  if (tier !== 'fast') return undefined;
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 512 };
  if (/^gemini-(3|4|flash-latest|pro-latest|flash-lite-latest)/.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

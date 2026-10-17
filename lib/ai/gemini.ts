// lib/ai/gemini.ts — the one Gemini text client every AI feature uses. SERVER ONLY.
//
// Drop-in for the old per-file `getGeminiModel()`: `getAiModel({...}).generateContent(prompt | parts)` returns the same
// `{ response: { text() } }` shape, so an endpoint switches with a one-line change. On top of the bare SDK it adds:
//  - the tier's model chain with fallback (404 retired / 429 / 5xx / timeout) and a per-call timeout (lib/ai/models);
//  - the seller's saved AI preferences ('all' + marketplace) as a system instruction (lib/ai/preferences);
//  - follow-up: `refine: { previous, instruction }` makes the call a revision of the model's previous answer;
//  - one AiUsage row per call (model, tokens, time, ok) — cost tracking and the base for credit enforcement.
import { GoogleGenerativeAI, type Content, type Part } from '@google/generative-ai';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { modelChain, thinkingConfigFor, timeoutFor, type AiTier } from './models';
import { cleanPrefText, mergePreferences, normalizePreference, preferencesBlock, type AiMarketplaceKey, type AiPreferenceValue } from './preferences';

export type AiRefine = { previous: unknown; instruction: string };

export type AiModelOptions = {
  /** 'fast' for buttons, 'deep' for analysis / background bulk work. */
  tier?: Exclude<AiTier, 'image'>;
  /** Stable feature id for the usage log: 'etsy.optimize_title', 'messages.draft_reply', … */
  feature: string;
  userId?: string | null;
  /** Loads the seller's preferences for this marketplace (+ 'all'). Omit for features that are not seller copy. */
  marketplace?: AiMarketplaceKey;
  /** The previous answer + what the seller asked to change. */
  refine?: AiRefine | null;
  /** JSON mode (default true: every feature parses JSON). */
  json?: boolean;
  /** Extra system instruction placed before the preferences. */
  system?: string;
  /** Lower = steadier (replies 0.4, research explanations 0.3); default is the model's. */
  temperature?: number;
};

type GenerateInput = string | Array<string | Part> | { contents: Content[] };

export class AiNotConfiguredError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not configured');
    this.name = 'AiNotConfiguredError';
  }
}

const PREF_TTL_MS = 60_000;
const prefCache = new Map<string, { at: number; value: AiPreferenceValue | null }>();

/** The seller's merged preferences ('all' + marketplace), cached a minute per process. */
export async function loadAiPreferences(userId: string, marketplace: AiMarketplaceKey): Promise<AiPreferenceValue | null> {
  const key = `${userId}:${marketplace}`;
  const hit = prefCache.get(key);
  if (hit && Date.now() - hit.at < PREF_TTL_MS) return hit.value;
  let value: AiPreferenceValue | null = null;
  try {
    const rows = await prisma.aiPreference.findMany({ where: { userId, marketplace: { in: marketplace === 'all' ? ['all'] : ['all', marketplace] } } });
    const all = rows.find((r) => r.marketplace === 'all');
    const mp = rows.find((r) => r.marketplace === marketplace && marketplace !== 'all');
    value = rows.length ? mergePreferences(all ? normalizePreference(all) : null, mp ? normalizePreference(mp) : null) : null;
  } catch (err: any) {
    logger.warn('AI preferences load failed', { userId, error: err?.message });
  }
  prefCache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateAiPreferences(userId: string) {
  for (const k of Array.from(prefCache.keys())) if (k.startsWith(`${userId}:`)) prefCache.delete(k);
}

/** A model failure worth trying the next model for. Pure, exported for tests. */
export function isRetryableAiError(err: unknown): boolean {
  const m = String((err as any)?.message || err || '').toLowerCase();
  if ((err as any)?.name === 'AbortError' || /timed? ?out|timeout|aborted/.test(m)) return true;
  return /\[(404|408|429|500|502|503|504)\b|\b(404|429|500|502|503|504)\b.*(not found|quota|exhausted|overloaded|unavailable|internal|deadline)|resource has been exhausted|model is overloaded|is not found|not supported for generatecontent/.test(m);
}

/** Strips ```json fences and parses; null when the text is not JSON. Pure. */
export function parseAiJson<T = any>(text: unknown): T | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Some models wrap JSON in a sentence: take the outermost object / array.
    const m = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (!m) return null;
    try { return JSON.parse(m[0]) as T; } catch { return null; }
  }
}

/** The refine turns appended to the original request. Pure, exported for tests. */
export function refineContents(base: Content[], refine: AiRefine | null | undefined, json: boolean): Content[] {
  if (!refine) return base;
  const instruction = cleanPrefText(refine.instruction, 600);
  if (!instruction) return base;
  const previous = typeof refine.previous === 'string' ? refine.previous : JSON.stringify(refine.previous ?? null);
  return [
    ...base,
    { role: 'model', parts: [{ text: previous.slice(0, 20_000) }] },
    {
      role: 'user',
      parts: [{
        text: `Revise your previous answer following this request from the seller: "${instruction}". Keep every rule and requirement given above${json ? ' and return exactly the same JSON shape' : ''}. Change only what the request asks for.`,
      }],
    },
  ];
}

function toContents(input: GenerateInput): Content[] {
  if (typeof input === 'string') return [{ role: 'user', parts: [{ text: input }] }];
  if (Array.isArray(input)) return [{ role: 'user', parts: input.map((p) => (typeof p === 'string' ? { text: p } : p)) }];
  return input.contents;
}

export async function logUsage(row: { userId?: string | null; feature: string; model: string; ok: boolean; usage?: any; ms: number; refine: boolean; error?: string; images?: number }) {
  try {
    await prisma.aiUsage.create({
      data: {
        userId: row.userId || null,
        feature: row.feature.slice(0, 80),
        model: row.model,
        ok: row.ok,
        inputTokens: Number(row.usage?.promptTokenCount) || 0,
        outputTokens: Number(row.usage?.candidatesTokenCount) || 0,
        thinkingTokens: Number(row.usage?.thoughtsTokenCount) || 0,
        images: row.images ?? 0,
        ms: Math.round(row.ms),
        refine: row.refine,
        error: row.error ? row.error.slice(0, 300) : null,
      },
    });
  } catch (err: any) {
    logger.warn('AI usage log failed', { feature: row.feature, error: err?.message });
  }
}

/**
 * `getAiModel({ feature, userId, marketplace, refine }).generateContent(prompt)` — same result shape as the SDK
 * (`result.response.text()`), plus `result.model` (the model that answered).
 */
export function getAiModel(opts: AiModelOptions) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  const tier = opts.tier ?? 'fast';
  const json = opts.json !== false;
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async generateContent(input: GenerateInput) {
      const prefs = opts.userId && opts.marketplace ? await loadAiPreferences(opts.userId, opts.marketplace) : null;
      const system = [opts.system, preferencesBlock(prefs)].filter(Boolean).join('\n\n');
      const contents = refineContents(toContents(input), opts.refine, json);
      let lastErr: unknown = null;
      for (const modelName of modelChain(tier)) {
        const started = Date.now();
        try {
          const model = genAI.getGenerativeModel(
            {
              model: modelName,
              ...(system ? { systemInstruction: system } : {}),
              generationConfig: {
                ...(json ? { responseMimeType: 'application/json' } : {}),
                ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
                ...(thinkingConfigFor(tier, modelName) ? { thinkingConfig: thinkingConfigFor(tier, modelName) } : {}),
              } as any,
            },
            { timeout: timeoutFor(tier) },
          );
          const result = await model.generateContent({ contents });
          void logUsage({ userId: opts.userId, feature: opts.feature, model: modelName, ok: true, usage: result.response.usageMetadata, ms: Date.now() - started, refine: Boolean(opts.refine) });
          return Object.assign(result, { model: modelName });
        } catch (err: any) {
          lastErr = err;
          void logUsage({ userId: opts.userId, feature: opts.feature, model: modelName, ok: false, ms: Date.now() - started, refine: Boolean(opts.refine), error: err?.message });
          if (!isRetryableAiError(err)) throw err;
          logger.warn('AI model unavailable, trying the next one', { feature: opts.feature, model: modelName, error: String(err?.message || err).slice(0, 200) });
        }
      }
      throw lastErr ?? new Error('No AI model available');
    },
  };
}

/** One call → parsed JSON (null when the model returned something that is not JSON). */
export async function aiJson<T = any>(opts: AiModelOptions, input: GenerateInput): Promise<T | null> {
  const result = await getAiModel({ ...opts, json: true }).generateContent(input);
  return parseAiJson<T>(result.response.text());
}

/** Reads `refine` from a request body (`{ refine: { previous, instruction } }`), validated. Pure. */
export function refineFromBody(body: unknown): AiRefine | null {
  const r = (body as any)?.refine;
  if (!r || typeof r !== 'object') return null;
  const instruction = cleanPrefText(r.instruction, 600);
  if (!instruction) return null;
  return { previous: r.previous ?? null, instruction };
}

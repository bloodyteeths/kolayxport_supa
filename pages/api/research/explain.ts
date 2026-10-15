/**
 * POST /api/research/explain — "Explain · 1 credit" (research.md §3.5, §10; RR §6.5).
 *
 * Body: ExplainRequest `{ tool: 'products'|'listing'|'keywords'|'shop', metrics: {...computed numbers...}, locale? }`.
 * 200 → ResearchResponse<ExplainData> `{ text, locale, stripped }`:
 *   - the model only rephrases numbers it was given; every number in the text must match an input number
 *     (± rounding, shares may appear as percents), otherwise that sentence is removed (numbers check);
 *   - ≤ 600 characters, commentary in the UI locale, keywords/tags stay English;
 *   - garbled or empty → 502 `{ error: 'ai_failed', key: 'research.explain.failed' }` (inline ErrorState, never a toast).
 * Cached per user and input hash for 24 h. Credits: the billing track's `aiCost` limiter is not built yet
 * (outOfScope); until then a per-user limiter (10/min) protects the Gemini key.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { coerceAiString, looksGarbled } from '@/lib/etsy/seoRules';
import { readShared, requestLocale, sha1, userRateLimit, writeShared } from '@/lib/research/etsySearch';
import { EXPLAIN_TOOLS, type ExplainData, type ExplainRequest, type ExplainTool, type ResearchErrorBody, type ResearchResponse } from '@/lib/research/types';

export const EXPLAIN_MAX_CHARS = 600;
const MAX_METRICS_JSON = 4_000;
const CACHE_TTL_MS = 24 * 3_600_000;

// ─── Gemini (JSON mode) ─────────────────────────────────────────────────────

/** One JSON-mode Gemini call; returns the parsed object or null (missing key, error, unparsable output). */
export async function geminiJson(prompt: string, timeoutMs = 25_000): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } as never,
    });
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!result) return null;
    const raw = result.response.text().trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch (err) {
    logger.warn('[research] Gemini call failed', { error: (err as Error)?.message });
    return null;
  }
}

// ─── Validation (hand-written: zod is not a direct dependency) ─────────────

type Leaf = number | string | boolean | null;
const isLeaf = (v: unknown): v is Leaf =>
  v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 160);

/** Metrics: an object of leaves, leaf arrays (≤ 20) or one nested level of the same. ≤ 4 KB as JSON. */
export function validateExplainRequest(body: unknown): { ok: true; value: ExplainRequest } | { ok: false } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  if (typeof b.tool !== 'string' || !(EXPLAIN_TOOLS as readonly string[]).includes(b.tool)) return { ok: false };
  const m = b.metrics;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false };
  const okValue = (v: unknown, depth: number): boolean => {
    if (isLeaf(v)) return true;
    if (Array.isArray(v)) return v.length <= 20 && v.every(isLeaf);
    if (depth < 1 && v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      return entries.length <= 40 && entries.every(([, x]) => okValue(x, depth + 1));
    }
    return false;
  };
  const entries = Object.entries(m as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 40 || !entries.every(([, v]) => okValue(v, 0))) return { ok: false };
  if (JSON.stringify(m).length > MAX_METRICS_JSON) return { ok: false };
  const locale = b.locale === 'tr' || b.locale === 'en' ? b.locale : undefined;
  return { ok: true, value: { tool: b.tool as ExplainTool, metrics: m as Record<string, unknown>, ...(locale ? { locale } : {}) } };
}

// ─── Numbers check (RR §6.5) ────────────────────────────────────────────────

/** Parses "1,820" · "1.820" · "4.5" · "4,5" · "$49" · "30%" into numbers. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /\d+(?:[.,\s  ]\d+)*/g;
  for (const m of String(text).match(re) ?? []) {
    let t = m.replace(/[\s  ]/g, '');
    const hasDot = t.includes('.');
    const hasComma = t.includes(',');
    if (hasDot && hasComma) {
      const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      t = t.split(thou).join('').replace(dec, '.');
    } else if (hasDot || hasComma) {
      const sep = hasDot ? '.' : ',';
      const parts = t.split(sep);
      const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3);
      t = thousands ? parts.join('') : parts.join('.');
    }
    const n = Number(t);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every number in the metrics (leaves, arrays, nested, and numbers written inside strings). */
export function allowedNumbers(metrics: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'string') out.push(...extractNumbers(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(metrics);
  return out;
}

/**
 * `n` restates allowed value `a` (as itself, or a share as a percent). Values ≥ 1 allow ± 0.5 rounding or 1 %; values
 * under 1 (shares, ratios) allow 1 % relative only, so 0.3 does not also "match" anything from 0 to 0.8.
 */
function matches(n: number, allowed: number[]): boolean {
  return allowed.some((a) => [a, a * 100].some((x) => {
    const d = Math.abs(n - x);
    return Math.abs(x) >= 1 ? d <= 0.5 || d <= Math.abs(x) * 0.01 : d <= Math.abs(x) * 0.01;
  }));
}

/**
 * Spelled-out quantities and multipliers ("three times", "twice", "half", "iki kat", "yarısı") cannot be checked
 * against the inputs, so a sentence holding one is removed. "one" / "bir" (also the indefinite article), Turkish
 * "on" / "altı" / "bin" (also English "on", "under", English "bin") are left out to avoid stripping ordinary sentences.
 */
const NUMBER_WORDS = [
  // EN
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands', 'million', 'millions', 'dozen', 'dozens',
  'twice', 'thrice', 'double', 'doubled', 'triple', 'tripled', 'quadruple', 'half', 'halved', 'quarter', 'tenfold', 'twofold', 'threefold',
  // TR
  'iki', 'üç', 'dört', 'beş', 'yedi', 'sekiz', 'dokuz', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen',
  'doksan', 'yüz', 'yüzlerce', 'binlerce', 'milyon', 'milyonlarca', 'düzine', 'yarı', 'yarısı', 'yarısına', 'yarım',
  'çeyrek', 'katı', 'katına', 'kat',
];
const NUMBER_WORD_RE = new RegExp(`(?<!\\p{L})(?:${NUMBER_WORDS.join('|')})(?!\\p{L})`, 'iu');

/** True when the sentence states a quantity in words (EN/TR) rather than digits. */
export function hasNumberWord(sentence: string): boolean {
  return NUMBER_WORD_RE.test(sentence.toLocaleLowerCase('tr').normalize('NFC')) || NUMBER_WORD_RE.test(sentence.toLowerCase());
}

/** Removes every sentence holding a number that is not in the input, or a spelled-out quantity. Returns the kept text and the removed count. */
export function numbersCheck(text: string, metrics: unknown): { text: string; stripped: number } {
  const allowed = allowedNumbers(metrics);
  const sentences = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const kept = sentences.filter((s) => !hasNumberWord(s) && extractNumbers(s).every((n) => matches(n, allowed)));
  return { text: kept.join(' ').trim(), stripped: sentences.length - kept.length };
}

/** Caps at `max` chars on a sentence boundary when possible, else on a word boundary with "…". */
export function capText(text: string, max = EXPLAIN_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > max * 0.5) return cut.slice(0, lastStop + 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max - 1).trimEnd()}…`;
}

const TOOL_CONTEXT: Record<ExplainTool, string> = {
  products: 'an Etsy/eBay product idea: price band, competing listings, demand signal (indirect, 1-5 dots), newcomer share of top shops',
  listing: "one of the seller's own listings compared with peer listings for its main keyword",
  keywords: 'keyword candidates for a listing: demand signal, competition counts, use among the top 48 listings',
  shop: "a competitor shop's measured sales per day, new listings and price changes",
};

export function explainPrompt(req: ExplainRequest, locale: 'en' | 'tr'): string {
  const lang = locale === 'tr' ? 'Turkish' : 'English';
  return [
    `You explain marketplace research numbers to a small seller. The numbers describe ${TOOL_CONTEXT[req.tool]}.`,
    `Write 2 to 4 short sentences in ${lang}. Keep product keywords, tags and titles in English exactly as given.`,
    'Rules: use ONLY numbers that appear in the JSON below, written the same way or rounded; never invent a number;',
    'never state search volume, sales or revenue that is not in the JSON; "demand signal" is an indirect indicator, not search volume;',
    'no headings, no lists, no emojis, under 500 characters.',
    'Return JSON: {"text": "..."}',
    `JSON: ${JSON.stringify(req.metrics)}`,
  ].join('\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies ResearchErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies ResearchErrorBody);
  const parsed = validateExplainRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  const input = parsed.value;
  const locale = input.locale ?? requestLocale(req);
  const cacheKey = `research:explain:${sha1(JSON.stringify([input.tool, locale, input.metrics]))}`;

  const hit = await readShared<ExplainData>(cacheKey, user.id);
  const reply = (data: ExplainData, fetchedAt: string) => {
    const body: ResearchResponse<ExplainData> = { data, source: { source: 'research.sourceName.ai', fetchedAt, kind: 'estimate' } };
    return res.status(200).json(body);
  };
  if (hit && hit.fresh) return reply(hit.data, hit.fetchedAt);
  if (!userRateLimit(user.id, 'research:explain', 10)) return res.status(429).json({ error: 'rate_limited' } satisfies ResearchErrorBody);

  const out = await geminiJson(explainPrompt(input, locale));
  const raw = coerceAiString(out?.text);
  if (!raw || looksGarbled(raw)) {
    return res.status(502).json({ error: 'ai_failed', key: 'research.explain.failed' } satisfies ResearchErrorBody);
  }
  const checked = numbersCheck(raw, input.metrics);
  const text = capText(checked.text);
  if (!text || looksGarbled(text)) {
    return res.status(502).json({ error: 'ai_failed', key: 'research.explain.failed' } satisfies ResearchErrorBody);
  }
  const data: ExplainData = { text, locale, stripped: checked.stripped };
  const fetchedAt = new Date().toISOString();
  await writeShared(cacheKey, data, CACHE_TTL_MS, fetchedAt, user.id);
  return reply(data, fetchedAt);
}

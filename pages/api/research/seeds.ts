/**
 * POST /api/research/seeds — "Translate to English keywords · 1 credit" (research.md §3.3, §10).
 *
 * Body: SeedsRequest `{ text, mkt? }` (Turkish or mixed idea, ≤ 200 chars).
 * 200 → ResearchResponse<SeedsData> `{ seeds: string[] (English, lowercase, 2–6 words, ≤ 5), from }`.
 * Model output is validated (array or comma string, no Turkish letters, not garbled, deduped); nothing usable →
 * 502 `{ error: 'ai_failed', key: 'research.translate.failed' }`. Cached per user and text for 7 days.
 * Credits: see explain.ts (billing `aiCost` limiter pending; per-user 10/min here).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { coerceAiStringArray, looksGarbled } from '@/lib/etsy/seoRules';
import { normalizeQuery, readShared, sha1, userRateLimit, writeShared } from '@/lib/research/etsySearch';
import { isResearchMkt, type ResearchErrorBody, type ResearchMkt, type ResearchResponse, type SeedsData } from '@/lib/research/types';
import { geminiJson } from './explain';

export const MAX_SEED_INPUT = 200;
export const MAX_SEEDS = 5;
const CACHE_TTL_MS = 7 * 24 * 3_600_000;

/** Keeps English marketplace phrases only. Pure. */
export function cleanSeeds(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of coerceAiStringArray(raw)) {
    const t = s.normalize('NFC').toLowerCase().replace(/[^a-z0-9 '&-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || /[çğıöşü]/i.test(s)) continue;
    const words = t.split(' ');
    if (t.length < 3 || t.length > 60 || words.length < 1 || words.length > 6 || looksGarbled(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_SEEDS) break;
  }
  return out;
}

export function seedsPrompt(text: string, mkt: ResearchMkt): string {
  const market = mkt === 'ebay' ? 'eBay US' : mkt === 'amazon' ? 'Amazon US' : 'Etsy US';
  return [
    `A seller from Türkiye describes a product idea, possibly in Turkish. Give 3 to 5 English search phrases that ${market} buyers type for this product.`,
    'Each phrase: lowercase, 2 to 5 words, no brand names, no punctuation, no Turkish words. Most common phrase first.',
    'Return JSON: {"seeds": ["...", "..."]}',
    `Idea: ${JSON.stringify(text)}`,
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

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_SEED_INPUT) : '';
  if (!text) return res.status(400).json({ error: 'bad_request' } satisfies ResearchErrorBody);
  const mkt: ResearchMkt = isResearchMkt(body.mkt) ? body.mkt : 'etsy';

  const cacheKey = `research:seeds:${sha1(`${normalizeQuery(text)}|${mkt}`)}`;
  const reply = (data: SeedsData, fetchedAt: string) => {
    const out: ResearchResponse<SeedsData> = { data, source: { source: 'research.sourceName.ai', fetchedAt, kind: 'estimate' } };
    return res.status(200).json(out);
  };
  const hit = await readShared<SeedsData>(cacheKey, user.id);
  if (hit && hit.fresh) return reply(hit.data, hit.fetchedAt);
  if (!userRateLimit(user.id, 'research:seeds', 10)) return res.status(429).json({ error: 'rate_limited' } satisfies ResearchErrorBody);

  const out = await geminiJson(seedsPrompt(text, mkt));
  const seeds = cleanSeeds(out?.seeds);
  if (seeds.length === 0) return res.status(502).json({ error: 'ai_failed', key: 'research.translate.failed' } satisfies ResearchErrorBody);
  const data: SeedsData = { seeds, from: text };
  const fetchedAt = new Date().toISOString();
  await writeShared(cacheKey, data, CACHE_TTL_MS, fetchedAt, user.id);
  return reply(data, fetchedAt);
}

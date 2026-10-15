/**
 * POST /api/research/keywords/note — "Etsy volume (You entered)" (research.md §6.1; RR §4.3; R2-A).
 *
 * Body KeywordNoteRequest `{ keyword, etsySearches30d }` (integer 0 – 10,000,000, from Etsy Marketplace Insights;
 * `null` removes the note) → 200 `{ data: KeywordNoteData }`.
 *
 * Guarded on backend request BR-1b (`ResearchKeywordNote`): until the migration is deployed and the Prisma client
 * regenerated, this answers 503 `{ error: 'unavailable', key: 'research.kw.volumeUnavailable' }` and
 * `GET /api/research/keywords` reports `volumeAvailable: false` so the UI hides "add ↗". Nothing else depends on it.
 * Writes only the user's own KolayXport row.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { userRateLimit } from '@/lib/research/etsySearch';
import { cleanCandidate, isMissingTableError, keywordNoteDelegate } from '@/lib/research/keywordPool';
import type { KeywordErrorBody, KeywordNoteData } from '@/lib/research/keywordTypes';

export const MAX_SEARCHES = 10_000_000;

/** Validates the body. `value: null` = delete. Returns null when invalid. */
export function parseNoteBody(raw: unknown): { keyword: string; value: number | null } | null {
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!b) return null;
  const keyword = cleanCandidate(b.keyword);
  if (!keyword) return null;
  const v = b.etsySearches30d;
  if (v === null) return { keyword, value: null };
  const n = typeof v === 'string' && v.trim() ? Number(v.replace(/[\s,.]/g, '')) : typeof v === 'number' ? v : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_SEARCHES) return null;
  return { keyword, value: n };
}

const unavailable = (res: NextApiResponse) => res.status(503).json({ error: 'unavailable', key: 'research.kw.volumeUnavailable' } satisfies KeywordErrorBody);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' } satisfies KeywordErrorBody);
  }
  const user = await getAuthUser(req, res);
  if (!user) return res.status(401).json({ error: 'unauthorized' } satisfies KeywordErrorBody);
  if (!userRateLimit(user.id, 'research:keywords:note', 30)) return res.status(429).json({ error: 'rate_limited' } satisfies KeywordErrorBody);

  let raw: unknown = req.body;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const parsed = parseNoteBody(raw);
  if (!parsed) return res.status(400).json({ error: 'bad_request' } satisfies KeywordErrorBody);

  const notes = keywordNoteDelegate();
  if (!notes) return unavailable(res);
  try {
    if (parsed.value === null) {
      await notes.deleteMany({ where: { userId: user.id, keyword: parsed.keyword } });
      return res.status(200).json({ data: { keyword: parsed.keyword, value: null, enteredAt: null } satisfies KeywordNoteData });
    }
    const enteredAt = new Date();
    const row = await notes.upsert({
      where: { userId_keyword: { userId: user.id, keyword: parsed.keyword } },
      create: { userId: user.id, keyword: parsed.keyword, etsySearches30d: parsed.value, enteredAt },
      update: { etsySearches30d: parsed.value, enteredAt },
    });
    return res.status(200).json({ data: { keyword: row.keyword, value: row.etsySearches30d, enteredAt: row.enteredAt.toISOString() } satisfies KeywordNoteData });
  } catch (err) {
    if (isMissingTableError(err)) return unavailable(res);
    logger.error('[research/keywords/note] failed', err as Error);
    return res.status(500).json({ error: 'server_error' } satisfies KeywordErrorBody);
  }
}

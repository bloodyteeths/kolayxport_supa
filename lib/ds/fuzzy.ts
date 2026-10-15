// lib/ds/fuzzy.ts — palette matching (shell-nav §3.6, §11). `fold` and `fuzzyScore` are moved unchanged from
// the legacy components/CommandPalette.tsx; `rankByQuery` is the ranking loop it ran inline.

/** Lowercase + strip diacritics so "siparis" matches "Siparişler" (and "ı" matches "i"). */
export function fold(s: string, locale: string): string {
  let out: string;
  try {
    out = s.toLocaleLowerCase(locale);
  } catch {
    out = s.toLowerCase();
  }
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

/**
 * Subsequence fuzzy score: higher is better, -1 = no match. Rewards contiguous runs and matches at word
 * starts; a plain substring match always wins. Both arguments must already be folded.
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  const idx = text.indexOf(query);
  if (idx >= 0) return 1000 - idx * 2 - (text.length - query.length) * 0.1;
  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < query.length; qi++) {
    const ch = query[qi];
    if (ch === ' ') continue;
    const found = text.indexOf(ch, ti);
    if (found < 0) return -1;
    score += found === prevMatch + 1 ? 8 : 1;
    if (found === 0 || text[found - 1] === ' ' || text[found - 1] === '-') score += 5;
    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

export type Rankable = { label: string; hint?: string | null; keywords?: readonly string[] };

/** Penalty for a match that only hits the hint/section or keywords (the label match wins on ties). */
export const SECONDARY_MATCH_PENALTY = 50;

/** Best score of one item for an already-folded query (-1 = no match). */
export function scoreItem(item: Rankable, foldedQuery: string, locale: string): number {
  if (!foldedQuery) return 0;
  const label = fold(item.label, locale);
  let best = fuzzyScore(label, foldedQuery);
  const extra = [item.hint ?? '', ...(item.keywords ?? [])].filter(Boolean).join(' ');
  if (extra) {
    const s = fuzzyScore(fold(`${extra} ${item.label}`, locale), foldedQuery);
    if (s >= 0) best = Math.max(best, s - SECONDARY_MATCH_PENALTY);
  }
  return best;
}

/**
 * Filters and sorts by score (stable for equal scores). An empty query returns the items unchanged.
 * `query` is raw user input; it is trimmed and folded here.
 */
export function rankByQuery<T extends Rankable>(items: readonly T[], query: string, locale: string): T[] {
  const q = fold(query.trim(), locale);
  if (!q) return [...items];
  return items
    .map((it, i) => ({ it, i, score: scoreItem(it, q, locale) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.it);
}

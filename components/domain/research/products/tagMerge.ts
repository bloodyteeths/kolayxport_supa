// "Add N tags to…" merge rules (research.md §3.4, §6.1): Etsy 13 tags × 20 characters, no near-duplicates, no
// tag that repeats a title word. Over 13 → the user picks which current tags to replace (weakest first by top-48
// use). Pure; built on lib/etsy/seoRules (read-only use).
import { TAG_MAX_COUNT, normalizeTags, tagKey, tagTitleOverlap } from '@/lib/etsy/seoRules';

export type TagAddPlan = {
  /** New tags that survive the rules (in input order). */
  add: string[];
  /** Rejected new tags. */
  rejected: { tag: string; reason: 'duplicate' | 'too_long' | 'invalid' | 'title_overlap' }[];
  /** current ∪ add, deduped, uncapped. */
  merged: string[];
  /** How many current tags must go to fit (0 = fits). */
  overflow: number;
};

export function planTagAdd(current: string[], incoming: string[], title: string, max = TAG_MAX_COUNT): TagAddPlan {
  const cur = normalizeTags(current, { max: 999 }).tags;
  const curKeys = new Set(cur.map((t) => tagKey(t) || t.toLowerCase()));
  const rejected: TagAddPlan['rejected'] = [];
  const { tags: cleaned, dropped } = normalizeTags(incoming, { max: 999 });
  for (const d of dropped) {
    if (d.reason === 'too_long' || d.reason === 'invalid' || d.reason === 'duplicate') rejected.push({ tag: d.tag, reason: d.reason });
  }
  const add: string[] = [];
  for (const tag of cleaned) {
    const k = tagKey(tag) || tag.toLowerCase();
    if (curKeys.has(k)) {
      rejected.push({ tag, reason: 'duplicate' });
      continue;
    }
    if (title && tagTitleOverlap(tag, title).length > 0) {
      rejected.push({ tag, reason: 'title_overlap' });
      continue;
    }
    curKeys.add(k);
    add.push(tag);
  }
  const merged = [...cur, ...add];
  return { add, rejected, merged, overflow: Math.max(0, merged.length - max) };
}

/** Current tags sorted weakest first (lowest top-48 share; unknown = 0), stable. */
export function weakestFirst(current: string[], shareOf: (tag: string) => number): string[] {
  return current
    .map((tag, i) => ({ tag, i, s: shareOf(tag) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.tag);
}

/** Final list after replacing `remove` (current tags) with the new ones, capped at `max`. */
export function applyReplace(current: string[], add: string[], remove: string[], max = TAG_MAX_COUNT): string[] {
  const gone = new Set(remove.map((t) => t.toLowerCase()));
  return [...current.filter((t) => !gone.has(t.toLowerCase())), ...add].slice(0, max);
}

// lib/text/decodeEntities.ts — DS P5: marketplace text is entity-decoded once at the mapper boundary, stored
// decoded, never re-encoded on push. The implementation lives in lib/research/stats.ts (R0); this is the
// canonical import path for every mapper, adapter and staging helper (CRITIQUE V2).
// Idempotent: decoding decoded text is a no-op, so read-time calls on old cache rows are safe.

import { decodeEntities } from '@/lib/research/stats';

export { decodeEntities };

/** Decodes every string in a list (tags, materials). Non-strings are dropped; null → []. */
export function decodeEntityList(list: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!list) return [];
  return list.filter((s): s is string => typeof s === 'string').map((s) => decodeEntities(s));
}

/** Decodes the given string fields of an object, returning a shallow copy (mapper helper). */
export function decodeEntityFields<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: readonly K[]): T {
  const out = { ...obj };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string') (out as Record<K, unknown>)[k] = decodeEntities(v);
    else if (Array.isArray(v)) (out as Record<K, unknown>)[k] = v.map((x) => (typeof x === 'string' ? decodeEntities(x) : x));
  }
  return out;
}

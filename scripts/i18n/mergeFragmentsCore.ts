/**
 * Pure core of scripts/i18n/merge-fragments.ts (owner W5). No fs access.
 *
 * Deep-merges i18n fragments (messages/fragments/<name>.{en,tr}.json) into the
 * base message files:
 *  - new leaves and new namespaces are appended (existing key order preserved)
 *  - an identical existing value is a no-op
 *  - a DIFFERENT existing value is a conflict (reported with its path)
 *  - a leaf/object shape clash is a conflict
 *  - an en fragment and its tr pair must have identical key sets
 * RELOCATIONS move a fragment subtree before merging, e.g. new notification
 * type texts live in the fragment at notificationCenter.types and belong at
 * notifications.types (titleKey resolves under the 'notifications' namespace).
 */

export type Json = { [k: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonValue[] | Json;

export const RELOCATIONS: { from: string; to: string }[] = [{ from: 'notificationCenter.types', to: 'notifications.types' }];

function isObj(v: unknown): v is Json {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function leafPaths(obj: unknown, prefix = ''): string[] {
  if (!isObj(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

function getAt(obj: Json, dotted: string): JsonValue | undefined {
  let node: JsonValue | undefined = obj;
  for (const part of dotted.split('.')) {
    if (!isObj(node)) return undefined;
    node = node[part];
  }
  return node;
}

function deleteAt(obj: Json, dotted: string): void {
  const parts = dotted.split('.');
  const last = parts.pop() as string;
  let node: JsonValue | undefined = obj;
  for (const part of parts) {
    if (!isObj(node)) return;
    node = node[part];
  }
  if (isObj(node)) delete node[last];
}

function setAt(obj: Json, dotted: string, value: JsonValue): void {
  const parts = dotted.split('.');
  const last = parts.pop() as string;
  let node: Json = obj;
  for (const part of parts) {
    if (!isObj(node[part])) node[part] = {};
    node = node[part] as Json;
  }
  node[last] = value;
}

/** Apply RELOCATIONS to a (deep-cloned) fragment. Empty parents are dropped. */
export function relocate(fragment: Json, relocations = RELOCATIONS): Json {
  const out = JSON.parse(JSON.stringify(fragment)) as Json;
  for (const r of relocations) {
    const v = getAt(out, r.from);
    if (v === undefined) continue;
    deleteAt(out, r.from);
    const parent = r.from.split('.').slice(0, -1).join('.');
    if (parent) {
      const pv = getAt(out, parent);
      if (isObj(pv) && Object.keys(pv).length === 0) deleteAt(out, parent);
    }
    const existing = getAt(out, r.to);
    if (isObj(existing) && isObj(v)) {
      setAt(out, r.to, deepMerge(existing, v, r.to, []).merged);
    } else {
      setAt(out, r.to, v);
    }
  }
  return out;
}

/**
 * Merge `source` into `target` (neither is mutated). Existing key order is
 * kept; new keys are appended in source order.
 */
export function deepMerge(
  target: Json,
  source: Json,
  path = '',
  conflicts: string[] = [],
): { merged: Json; conflicts: string[]; added: number } {
  const merged: Json = { ...target };
  let added = 0;
  for (const [k, v] of Object.entries(source)) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in merged)) {
      merged[k] = JSON.parse(JSON.stringify(v));
      added += isObj(v) ? leafPaths(v).length : 1;
      continue;
    }
    const cur = merged[k];
    if (isObj(cur) && isObj(v)) {
      const r = deepMerge(cur, v, p, conflicts);
      merged[k] = r.merged;
      added += r.added;
    } else if (isObj(cur) !== isObj(v)) {
      conflicts.push(p);
    } else if (JSON.stringify(cur) !== JSON.stringify(v)) {
      conflicts.push(p);
    }
  }
  return { merged, conflicts, added };
}

export interface FragmentPair {
  name: string;
  en: Json | null;
  tr: Json | null;
}

export interface MergeResult {
  en: Json;
  tr: Json;
  added: { en: number; tr: number };
  conflicts: string[];
  mismatches: string[];
}

export function mergeFragments(base: { en: Json; tr: Json }, fragments: FragmentPair[]): MergeResult {
  const conflicts: string[] = [];
  const mismatches: string[] = [];
  let en = base.en;
  let tr = base.tr;
  const added = { en: 0, tr: 0 };
  for (const f of [...fragments].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!f.en || !f.tr) {
      mismatches.push(`${f.name}: missing ${!f.en ? 'en' : 'tr'} fragment`);
      continue;
    }
    const enKeys = new Set(leafPaths(f.en));
    const trKeys = new Set(leafPaths(f.tr));
    const onlyEn = Array.from(enKeys).filter((k) => !trKeys.has(k));
    const onlyTr = Array.from(trKeys).filter((k) => !enKeys.has(k));
    if (onlyEn.length || onlyTr.length) {
      for (const k of onlyEn) mismatches.push(`${f.name}: only in en: ${k}`);
      for (const k of onlyTr) mismatches.push(`${f.name}: only in tr: ${k}`);
      continue;
    }
    const enC: string[] = [];
    const trC: string[] = [];
    const re = deepMerge(en, relocate(f.en), '', enC);
    const rt = deepMerge(tr, relocate(f.tr), '', trC);
    conflicts.push(...enC.map((p) => `${f.name} (en): ${p}`), ...trC.map((p) => `${f.name} (tr): ${p}`));
    en = re.merged;
    tr = rt.merged;
    added.en += re.added;
    added.tr += rt.added;
  }
  return { en, tr, added, conflicts, mismatches };
}

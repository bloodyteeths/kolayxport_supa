// lib/bulk/aiText.ts — Etsy bulk "AI description / translate" on the listings page (pure parts + the runner).
// Sends the selected listings to `/api/ai/etsy` `bulk_optimize` a few at a time (descriptions are long) and turns
// every usable answer into a staged-draft patch. Modes:
//   improve   → description rewritten in US English (the action's description rules)
//   translate → faithful US-English translation of the chosen fields (title / description / tags), `mode: 'translate'`
// Answers pass the same guards as the grid AI (useBulkAi): coerceAiString / looksGarbled / normalizeTitle (≤140) /
// normalizeTags (13 × 20, no title-word overlap). Listings with an unsent change to a field are not sent for that
// field. Nothing is staged here: the caller stages the returned patches; nothing reaches Etsy before the send.
import { mergeTranslatedTags, restorePercent, textFactViolations, type DroppedFactTag } from '@/lib/etsy/tagFacts';
import { TITLE_MAX, coerceAiString, looksGarbled, normalizeTags, normalizeTitle } from '@/lib/etsy/seoRules';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';

export type AiTextMode = 'improve' | 'translate';
export type AiTextField = 'title' | 'description' | 'tags';

export interface AiTextInput {
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** Fields with an unsent staged change (not sent, so the AI never overwrites the seller's own edit). */
  unsent: AiTextField[];
}

export interface AiTextResult {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  /** Translate: AI tags dropped because they state a fact the listing does not (shown in the review). */
  droppedTags?: DroppedFactTag[];
}

const TR_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;
const TR_WORDS = new Set(['ve', 'ile', 'için', 'icin', 'bir', 'bu', 'olan', 'adet', 'renk', 'beden', 'hediye', 'yapımı', 'yapimi', 'el', 'kadın', 'kadin', 'erkek', 'çocuk', 'cocuk', 'takı', 'kolye', 'küpe', 'kupe', 'yüzük', 'yuzuk', 'pamuk', 'deri', 'gümüş', 'gumus', 'özel', 'ozel', 'kişiye', 'kisiye', 'set', 'takım', 'takim', 'adet']);
/**
 * Pure: does this listing text look Turkish? Turkish letters, or at least two common Turkish words. Used to skip
 * listings that are already in English in the translate mode (never rewrite an English listing as a "translation").
 */
export function looksTurkish(text: string): boolean {
  if (TR_LETTERS.test(text)) return true;
  const words = text.toLocaleLowerCase('tr').split(/[^a-zçğıöşü]+/).filter(Boolean);
  let hits = 0;
  for (const w of words) if (TR_WORDS.has(w) && w !== 'set') hits += 1;
  return hits >= 2;
}

/** Translate mode only: listings that are already English are not sent. */
export function alreadyEnglish(input: AiTextInput, mode: AiTextMode): boolean {
  return mode === 'translate' && !looksTurkish(`${input.title}\n${input.description}`);
}

/** Listings per request: descriptions are long (a translation reads them in full). */
export const AI_TEXT_CHUNK = 4;
export const AI_TEXT_PARALLEL = 2;

/** Fields actually requested for one listing (mode fields minus unsent ones; descriptions need a source text). */
export function fieldsFor(input: AiTextInput, mode: AiTextMode, fields: AiTextField[]): AiTextField[] {
  if (alreadyEnglish(input, mode)) return [];
  const wanted = mode === 'improve' ? (['description'] as AiTextField[]) : fields;
  return wanted.filter((f) => !input.unsent.includes(f) && !(f === 'description' && !input.description.trim() && mode === 'translate'));
}

/** Groups listings that ask for the same fields into chunks (pure). */
export function planAiTextRequests(inputs: AiTextInput[], mode: AiTextMode, fields: AiTextField[]): Array<{ fields: AiTextField[]; items: AiTextInput[] }> {
  const groups = new Map<string, { fields: AiTextField[]; items: AiTextInput[] }>();
  for (const it of inputs) {
    const f = fieldsFor(it, mode, fields);
    if (!f.length) continue;
    const key = f.slice().sort().join(',');
    const g = groups.get(key) ?? { fields: f, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const out: Array<{ fields: AiTextField[]; items: AiTextInput[] }> = [];
  for (const g of groups.values()) for (let i = 0; i < g.items.length; i += AI_TEXT_CHUNK) out.push({ fields: g.fields, items: g.items.slice(i, i + AI_TEXT_CHUNK) });
  return out;
}

/** Letters that only Turkish uses: Etsy titles and tags must be English (founder rule), so these never pass. */
const TURKISH_ONLY = /[ğĞşŞıİ]/;

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.toLocaleLowerCase() === b[i].toLocaleLowerCase());

/** One `optimized[]` item → a guarded result, or null when nothing usable changed (pure). */
function isDroppedFactTag(v: unknown): v is DroppedFactTag {
  const d = v as DroppedFactTag;
  return !!d && typeof d.tag === 'string' && typeof d.term === 'string' && ['material', 'origin', 'religion', 'style', 'product'].includes(d.kind);
}

export function guardAiTextItem(item: unknown, input: AiTextInput, fields: AiTextField[], mode: AiTextMode = 'improve'): AiTextResult | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as Record<string, unknown>;
  const out: AiTextResult = { id: input.id };
  let title = input.title;
  const factSource = { title: input.title, description: input.description, tags: input.tags };
  const textDropped: DroppedFactTag[] = [];
  if (fields.includes('title')) {
    let t = normalizeTitle(it.title);
    if (mode === 'translate' && t) {
      t = restorePercent(t, `${input.title} ${input.description}`);
      const bad = textFactViolations(t, factSource);
      if (bad.length) { textDropped.push(...bad.map((d) => ({ ...d, field: 'title' as const }))); t = ''; }
    }
    if (t && t.length <= TITLE_MAX && !looksGarbled(t) && !TURKISH_ONLY.test(t) && t !== input.title) {
      out.title = t;
      title = t;
    }
  }
  if (fields.includes('description')) {
    let d = coerceAiString(it.description).trim();
    if (mode === 'translate' && d) {
      const bad = textFactViolations(d, factSource);
      if (bad.length) { textDropped.push(...bad.map((x) => ({ ...x, field: 'description' as const }))); d = ''; }
    }
    if (d && !looksGarbled(d) && d !== input.description.trim()) out.description = d.slice(0, 102400);
  }
  if (fields.includes('tags')) {
    // Improve: no title-word overlap (founder rule). Translate: the seller's own translated tags (`ownTags` from the
    // server) may repeat title words, every other tag may not, and the fact guard runs again here, so a tag naming a
    // material / origin / religious term / style the listing does not state never reaches a draft.
    const translate = mode === 'translate';
    const all = (Array.isArray(it.tags) ? (it.tags as unknown[]) : []).filter((x): x is string => typeof x === 'string' && !TURKISH_ONLY.test(x));
    const ownSet = new Set((Array.isArray(it.ownTags) ? (it.ownTags as unknown[]) : []).filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()));
    const guarded = translate
      ? mergeTranslatedTags(all.filter((x) => ownSet.has(x.toLowerCase())), all.filter((x) => !ownSet.has(x.toLowerCase())), title, { title: input.title, description: input.description, tags: input.tags })
      : { tags: normalizeTags(all, { title, dropTitleOverlap: true }).tags, dropped: [] as DroppedFactTag[] };
    const fromServer = Array.isArray(it.droppedTags) ? (it.droppedTags as unknown[]).filter(isDroppedFactTag) : [];
    const dropped = [...fromServer, ...guarded.dropped.filter((d) => !fromServer.some((x) => x.tag === d.tag)), ...textDropped.filter((d) => !fromServer.some((x) => x.tag === d.tag))];
    if (guarded.tags.length && !sameTags(guarded.tags, input.tags)) out.tags = guarded.tags;
    if (translate && dropped.length) out.droppedTags = dropped;
  }
  if (mode === 'translate' && !out.droppedTags && textDropped.length) out.droppedTags = textDropped;
  return out.title || out.description || out.tags ? out : null;
}

export type AiTextRunStop = 'limited' | 'rateLimited' | 'failed' | null;

export interface AiTextRunSummary {
  results: AiTextResult[];
  /** Listings sent whose answer was unusable or unchanged. */
  unusable: number;
  /** Listings not sent (every requested field had an unsent change, or no source text). */
  notSent: number;
  /** Translate mode: listings skipped because they are already in English. */
  alreadyEnglish: number;
  failed: number;
  stop: AiTextRunStop;
}

/** Runs the requests (AI_TEXT_PARALLEL lanes). `onProgress(done, total)` after each chunk. */
export async function runAiText(
  inputs: AiTextInput[],
  opts: { mode: AiTextMode; fields: AiTextField[]; instructions?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
  fetcher: typeof fetch = fetch,
): Promise<AiTextRunSummary> {
  const requests = planAiTextRequests(inputs, opts.mode, opts.fields);
  const sentCount = requests.reduce((n, r) => n + r.items.length, 0);
  const english = inputs.filter((i) => alreadyEnglish(i, opts.mode)).length;
  const summary: AiTextRunSummary = { results: [], unusable: 0, notSent: inputs.length - sentCount - english, failed: 0, stop: null, alreadyEnglish: english };
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < requests.length && !summary.stop && !opts.signal?.aborted) {
      const req = requests[next++];
      try {
        const res = await fetcher('/api/ai/etsy', {
          method: 'POST',
          credentials: 'same-origin',
          signal: opts.signal,
          headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
          body: JSON.stringify({
            action: 'bulk_optimize',
            fields: req.fields,
            ...(opts.mode === 'translate' ? { mode: 'translate' } : {}),
            ...(opts.instructions?.trim() ? { instructions: opts.instructions.trim() } : {}),
            listings: req.items.map((i) => ({ listing_id: i.id, title: i.title, description: i.description, tags: i.tags })),
          }),
        });
        const body = (await res.json().catch(() => null)) as { optimized?: unknown[] } | null;
        if (res.status === 402) summary.stop = 'limited';
        else if (res.status === 429) summary.stop = 'rateLimited';
        else if (res.status === 502) summary.unusable += req.items.length;
        else if (!res.ok) summary.failed += req.items.length;
        else {
          const byId = new Map<string, unknown>();
          for (const it of Array.isArray(body?.optimized) ? body!.optimized : []) {
            const id = it && typeof it === 'object' ? String((it as { listing_id?: unknown }).listing_id ?? '') : '';
            if (id && !byId.has(id)) byId.set(id, it);
          }
          for (const input of req.items) {
            const r = guardAiTextItem(byId.get(input.id), input, req.fields, opts.mode);
            if (r) summary.results.push(r);
            else summary.unusable += 1;
          }
        }
      } catch {
        if (opts.signal?.aborted) return;
        summary.failed += req.items.length;
      }
      done += req.items.length;
      opts.onProgress?.(done, sentCount);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_TEXT_PARALLEL, requests.length) }, lane));
  if (!summary.stop && summary.failed && !summary.results.length) summary.stop = 'failed';
  return summary;
}

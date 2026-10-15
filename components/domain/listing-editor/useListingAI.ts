// components/domain/listing-editor/useListingAI.ts — listing-editor §4.3, §10 Group H.
// The ONE place the editor talks to AI. Every result is a PROPOSAL: nothing is written into the draft until the
// seller presses Use (or "Use all" in the Start faster card), and nothing is ever sent to a marketplace from here
// (staging happens through the engine's setField → autosave; sending stays the footer's explicit Send).
//
// Endpoints (unchanged, import-only use):
//   Etsy  POST /api/ai/etsy { action: optimize_title | generate_description | suggest_tags | generate_alt_text }
//         GET  /api/clawd/etsy?action=search_market (research context + robust price band p25/p75/median)
//   eBay  POST /api/clawd/ebay-ai?action=optimize_title | generate_description | suggest_aspects | suggest_price |
//              identify_product
//         GET  /api/clawd/ebay-research?action=niche_analyze, /api/clawd/ebay?action=category_suggestions|item_aspects
//   Both  POST /api/ai/generate-image (returns base64; the caller stages it as a draft photo)
//
// Guards (feedback_ai_response_safety): coerceAiString / looksGarbled / normalizeTitle / normalizeTags from
// lib/etsy/seoRules; HTML entities are decoded on the way in (decodeEntities) so "one&#39;s" never reaches a field
// and is never sent back. Listing content stays English (P5); only the one-line rationale follows the UI locale
// (the Etsy title API writes its explanation in Turkish, so it is shown only in TR).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  TAG_MAX_COUNT,
  TITLE_MAX,
  aiErrorCode,
  coerceAiString,
  coerceAiStringArray,
  looksGarbled,
  normalizeTags,
  normalizeTitle,
  tagKey,
} from '@/lib/etsy/seoRules';
import { decodeEntities } from '@/lib/text/decodeEntities';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';
import { useToast } from '@/components/ds/feedback/toast';
import type { FieldSuggestionProps } from '@/components/ds/inputs/FieldSuggestion';
import type { FieldAiState, MarketBand } from './sections/sectionTypes';
import { normalizeCondition } from '@/lib/ebay/payloadRules';
import { decodeAspects } from './adapters/ebay';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AiMarketplace = 'etsy' | 'ebay';

/** Proposal slots. Alt text proposals are keyed `alt:<imageId>`. */
export type AiKey = 'title' | 'description' | 'tags' | 'specifics' | 'price' | 'category' | 'condition' | 'photo' | `alt:${string}`;

/** Keys that "Use all" (Start faster card) applies. */
export const FILL_KEYS = ['title', 'description', 'tags', 'category', 'specifics', 'price', 'condition'] as const;
export type FillKey = (typeof FILL_KEYS)[number];

export type AiProposalStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AiProposal<T = unknown> {
  status: AiProposalStatus;
  value?: T;
  /** "Based on 48 Etsy listings for 'baby name blanket'" (already translated). */
  basis?: string;
  /** One line from the model in the UI locale, or undefined. */
  rationale?: string;
  /** Translated error line; `true` = the FieldSuggestion default "The suggestion didn't come out right". */
  error?: string | true;
  /** The account ran out of AI credits (402): the action is disabled until the plan changes. */
  limited?: boolean;
}

/** Price check result (P6: median and P25–P75, never a mean). */
export interface AiPriceBand {
  p25: number | null;
  p75: number | null;
  median: number | null;
  /** Listings the band is computed from. */
  n: number;
  /** ISO 4217 of the band (Etsy research is USD-normalised). */
  currency: string;
  /** The price [Use …] would write: Etsy = median, eBay = the model's suggestion clamped to the band. */
  suggested: number | null;
  /** False when the band currency differs from the shop currency: show the band, offer no Use button. */
  usable: boolean;
  source: 'etsy_search' | 'ebay_research';
  query: string;
  /** When the research behind the band was fetched (SourceNote). */
  fetchedAt: string;
  /** Prices left out (no FX rate / implausible), when the server reports them. */
  excluded?: number;
}

export interface AiCategory {
  id: string;
  name: string;
  /** Other matches, first is the proposal. */
  alternatives?: Array<{ id: string; name: string }>;
}

export interface GeneratedPhoto {
  file: File;
  /** data: URL for an immediate preview tile. */
  previewUrl: string;
  mimeType: string;
}

/** What the AI reads. Pass the merged draft view (remote + staged), never only the remote listing. */
export interface AiListingInput {
  title: string;
  description: string;
  tags?: readonly string[];
  materials?: readonly string[];
  /** Category display name (Etsy taxonomy path leaf / eBay category name). */
  categoryName?: string | null;
  /** eBay category id (aspects lookup). */
  categoryId?: string | null;
  price?: number | null;
  /** Shop / listing currency (ISO 4217). */
  currency?: string | null;
  condition?: string | null;
  aspects?: Record<string, readonly string[]>;
}

/** Research the caller already has (session prefill from Research, `writeListingPrefill`). */
export interface AiResearchPrefill {
  query: string;
  topTags?: Array<{ tag: string; pct?: number; count?: number }>;
  topKeywords?: Array<{ keyword: string; pct?: number; count?: number }>;
  priceStats?: {
    p25?: number | null; p75?: number | null; median?: number | null; min?: number | null; max?: number | null;
    n?: number; currency?: string; excluded?: number;
  } | null;
  /** Listings analysed. */
  count?: number;
  /** ISO time the research was fetched (default: when the hook received it). */
  fetchedAt?: string;
}

export interface FillStepState {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
}

export interface FillState {
  running: boolean;
  steps: FillStepState[];
  /** Translated reason when the whole run could not start (no seed, no photos). */
  error?: string;
}

export interface UseListingAIOptions {
  marketplace: AiMarketplace;
  /** Latest merged view. Read through a ref at call time, so callbacks never see a stale title. */
  input: AiListingInput;
  /** Engine read of the current field value (for Undo). Group A: `useListingEditor().view.fields[key]`. */
  getField?(key: string): unknown;
  /** Engine write (marks dirty, schedules autosave). Group A: `useListingEditor().setField`. */
  setField?(key: string, value: unknown): void;
  /** Field key per proposal when the adapter names it differently (eBay: category → 'categoryId', specifics → 'aspects'). */
  fieldKeys?: Partial<Record<FillKey, string>>;
  /** Custom writers (e.g. eBay category id + name). Return value of getField before the write is used for Undo. */
  appliers?: Partial<Record<FillKey, (value: unknown) => void>>;
  research?: AiResearchPrefill | null;
  /** Test seam. */
  fetcher?: typeof fetch;
}

export interface AiButtonState {
  loading: boolean;
  loadingLabel: string;
  disabled: boolean;
  disabledReason?: string;
  /** "Suggest a title · 1 credit" (CRITIQUE X6) for the button tooltip / aria-label. */
  costLabel: string;
}

export interface UseListingAI {
  marketplace: AiMarketplace;
  proposals: Partial<Record<AiKey, AiProposal>>;
  get<T = unknown>(key: AiKey): AiProposal<T>;
  /** Credits ran out (402) on any AI call this session. */
  limitReached: boolean;
  /** Research used as `market_context` (prefill or lazy search_market / niche_analyze). */
  research: AiResearchPrefill | null;
  fill: FillState;

  suggestTitle(): Promise<void>;
  writeDescription(): Promise<void>;
  getTagIdeas(): Promise<void>;
  /** eBay: fill the given aspect names (required first). */
  fillSpecifics(aspectNames: string[]): Promise<void>;
  checkPrice(): Promise<void>;
  /** Etsy: one proposal per photo (`alt:<id>`). */
  writeAltText(images: Array<{ id: string; url: string }>): Promise<void>;
  /** Returns the image to stage (Group C stages it with an "AI" badge); never stages by itself. */
  generatePhoto(opts: { prompt: string; referenceUrls?: string[]; whiteBackground?: boolean }): Promise<GeneratedPhoto | null>;
  /** Start faster: Etsy = seed text → title → description → tags; eBay = photos/seed → research → title → category → specifics → price → description. */
  fillListing(opts: { seed?: string; imageUrls?: string[] }): Promise<void>;

  dismiss(key: AiKey): void;
  /** Writes a ready proposal into its field (dirty marker, autosave) with a 6s "… replaced · Undo" toast. */
  apply(key: FillKey): void;
  /** Applies every ready FILL_KEYS proposal, one toast with one Undo for all. Returns the count applied. */
  applyAll(): number;
  /** Adds one tag idea (Etsy) and removes it from the ideas. */
  acceptTag(tag: string): void;
  /** Adds tag ideas up to the free slots (13). */
  acceptAllTags(): void;
  /** eBay: write one suggested aspect / skip it. */
  acceptAspect(name: string): void;
  skipAspect(name: string): void;

  /** Props for `<FieldSuggestion>` under a field, or null while idle. `onUse` overrides the default writer (alt text). */
  suggestionProps(key: AiKey, opts?: { onUse?: (value: unknown) => void; useLabel?: string }): FieldSuggestionProps | null;
  /** Props for `<TagInput suggestions onAcceptSuggestion onAcceptAll>`. */
  tagSuggestionProps(): { suggestions: string[]; onAcceptSuggestion: (tag: string) => void; onAcceptAll: () => void };
  /**
   * Group B hand-off (`sections/sectionTypes.ts` FieldAiState): `aiTitle={ai.fieldState('title')}`,
   * `aiDescription={ai.fieldState('description')}`, `aiTags={ai.fieldState<string[]>('tags')}`.
   */
  fieldState<V = string>(key: 'title' | 'description' | 'tags'): FieldAiState<V>;
  /** Group B PriceSection props: `<PriceSection {...ai.priceSectionProps()} />`. */
  priceSectionProps(): { market: MarketBand | null | undefined; marketLoading: boolean; onCheckPrice: () => void };
  /** Props for the ghost `Sparkles` button that starts an action. */
  buttonState(key: AiKey | 'fill'): AiButtonState;
  isBusy(key: AiKey | 'fill'): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const EBAY_TITLE_MAX = 80;
export const ALT_TEXT_MAX = 250;
export const DESCRIPTION_MIN = 80;
/** AI credits per call (tiers.md AI_ACTION_COST: text 1, image 10). */
export const AI_CREDITS = { text: 1, image: 10 } as const;

/**
 * Billable AI calls in one Start faster run: Etsy = title, description, tags (research is a search, not AI);
 * eBay = title, item specifics, price, description, plus identify_product when photos are read.
 */
export function fillCredits(marketplace: AiMarketplace, readsPhotos = marketplace === 'ebay'): number {
  if (marketplace === 'etsy') return 3 * AI_CREDITS.text;
  return (4 + (readsPhotos ? 1 : 0)) * AI_CREDITS.text;
}

/** Credits one press costs. `fill` counts every call of the run (CRITIQUE X6); eBay defaults to "with photos". */
export function creditsFor(key: AiKey | 'fill', ctx?: { marketplace?: AiMarketplace; readsPhotos?: boolean }): number {
  if (key === 'fill') return fillCredits(ctx?.marketplace ?? 'etsy', ctx?.readsPhotos);
  return key === 'photo' ? AI_CREDITS.image : AI_CREDITS.text;
}

const NAMES: Record<AiMarketplace, string> = { etsy: 'Etsy', ebay: 'eBay' };

/** Cuts at the last space that fits (never mid-word). */
export function fitWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : text.slice(0, max)).replace(/[\s,]+$/, '');
}

/** AI title → field value, or '' when it is garbled / empty. */
export function sanitizeTitle(marketplace: AiMarketplace, raw: unknown): string {
  if (marketplace === 'etsy') {
    const t = normalizeTitle(decodeEntities(coerceAiString(raw)));
    if (!t || looksGarbled(t)) return '';
    return t.length > TITLE_MAX ? fitWords(t, TITLE_MAX) : t;
  }
  const t = decodeEntities(coerceAiString(raw)).replace(/\s+/g, ' ').trim();
  if (!t || looksGarbled(t)) return '';
  return fitWords(t, EBAY_TITLE_MAX);
}

/** Etsy descriptions are plain text (entities decoded); eBay descriptions are HTML and kept as returned. */
export function sanitizeDescription(marketplace: AiMarketplace, raw: unknown): string {
  const arr = Array.isArray(raw) && raw.every((p) => typeof p === 'string') ? (raw as string[]) : null;
  const text = arr ? arr.map((p) => p.trim()).filter(Boolean).join('\n\n') : coerceAiString(raw);
  const out = marketplace === 'etsy' ? decodeEntities(text).trim() : text.trim();
  const plain = marketplace === 'etsy' ? out : out.replace(/<[^>]+>/g, ' ');
  if (plain.trim().length < DESCRIPTION_MIN || looksGarbled(plain.replace(/\s+/g, ' ').trim())) return '';
  return out;
}

/** Etsy tag ideas: guarded by normalizeTags (≤ 20 chars, no title overlap) and minus the tags already there. */
export function sanitizeTagIdeas(raw: unknown, title: string, current: readonly string[]): string[] {
  const decoded = coerceAiStringArray(raw).map((s) => decodeEntities(s));
  const { tags } = normalizeTags(decoded, { title, dropTitleOverlap: true });
  const have = new Set(current.map((t) => tagKey(t) || t.toLowerCase()));
  return tags.filter((t) => !have.has(tagKey(t) || t));
}

export function sanitizeAltText(raw: unknown): string {
  const t = decodeEntities(coerceAiString(raw)).replace(/\s+/g, ' ').trim();
  if (!t || /^[\d\s.#-]+$/.test(t) || looksGarbled(t)) return '';
  return fitWords(t, ALT_TEXT_MAX);
}

/** eBay aspects: ≤ 65 chars per value (lib/ebay/payloadRules), only the names that were asked for. */
export function sanitizeAspects(raw: unknown, asked: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allowed = new Map(asked.map((n) => [n.toLowerCase(), n]));
  for (const [name, values] of Object.entries(raw as Record<string, unknown>)) {
    const canonical = allowed.get(name.toLowerCase());
    if (!canonical) continue;
    const kept = coerceAiStringArray(values)
      .map((v) => decodeEntities(v).trim())
      .filter((v) => v.length > 0 && v.length <= 65);
    if (kept.length) out[canonical] = kept;
  }
  return out;
}

/**
 * Item specifics to write when AI values are used: the listing's current specifics (engine field — the encoded
 * `aspects` string or a map — else the AI input's map) with the AI values on top. Never drops what is there.
 */
export function mergeAspects(currentField: unknown, inputAspects: Record<string, readonly string[]> | null | undefined, ai: unknown): Record<string, string[]> {
  const fromField = currentField !== undefined && currentField !== null ? decodeAspects(currentField as string | Record<string, unknown>) : null;
  const base = fromField ?? decodeAspects((inputAspects ?? null) as Record<string, unknown> | null);
  const add = ai && typeof ai === 'object' && !Array.isArray(ai) ? decodeAspects(ai as Record<string, unknown>) : {};
  return { ...base, ...add };
}

/** Decimal string for Etsy's price field ("49.00"), without toFixed (DS lint). */
export function toDecimalString(v: number): string {
  const cents = Math.round(v * 100);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** First phrase of a title, the research query the legacy editor used (`fetchQuickResearch`). */
export function researchQuery(title: string): string {
  return decodeEntities(title).split(',')[0].trim().slice(0, 60);
}

/** `search_market` JSON → research context (median-based; `avg` is never read, P6). */
export function researchFromEtsySearch(data: unknown, query: string): AiResearchPrefill | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const items = Array.isArray(d.items) ? d.items : [];
  const ps = d.priceStats && typeof d.priceStats === 'object' ? (d.priceStats as Record<string, unknown>) : null;
  const topTags = (Array.isArray(d.tagFrequency) ? d.tagFrequency : []).slice(0, 20) as AiResearchPrefill['topTags'];
  const topKeywords = (Array.isArray(d.titleKeywords) ? d.titleKeywords : []).slice(0, 15) as AiResearchPrefill['topKeywords'];
  if (!items.length && !ps) return null;
  return {
    query,
    topTags,
    topKeywords,
    count: items.length,
    priceStats: ps
      ? {
          p25: num(ps.p25), p75: num(ps.p75), median: num(ps.median), min: num(ps.min), max: num(ps.max),
          n: num(ps.n) ?? 0, currency: typeof ps.currency === 'string' ? ps.currency : 'USD',
          excluded: (num(ps.excludedNoFx) ?? 0) + (num(ps.excludedImplausible) ?? 0),
        }
      : null,
    fetchedAt: typeof d.fetchedAt === 'string' ? d.fetchedAt : new Date().toISOString(),
  };
}

/** `niche_analyze` JSON → research context + the creator's `marketResearch` shape for the eBay prompts. */
export function researchFromEbayNiche(data: unknown, query: string): (AiResearchPrefill & { ebay: Record<string, unknown> }) | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const ps = d.priceStats && typeof d.priceStats === 'object' ? (d.priceStats as Record<string, unknown>) : null;
  const n = num(ps?.n) ?? 0;
  return {
    query,
    count: num(ps?.sampled) ?? n,
    priceStats: ps
      ? {
          p25: num(ps.p25), p75: num(ps.p75), median: num(ps.median), min: num(ps.min), max: num(ps.max), n,
          currency: typeof ps.currency === 'string' ? ps.currency : 'USD',
          excluded: (num(ps.excludedNoFx) ?? 0) + (num(ps.excludedImplausible) ?? 0),
        }
      : null,
    fetchedAt: new Date().toISOString(),
    ebay: {
      avgPrice: d.medianPrice, // the eBay prompt's "average" slot carries the median (R0), never a mean
      medianPrice: d.medianPrice,
      priceRange: d.priceSpread,
      totalResults: d.totalResults,
      demandScore: d.demandScore,
      competitionScore: d.competitionScore,
      topSellers: d.topSellers,
      topProducts: d.topProducts,
      freeShippingPct: d.freeShippingPct,
      conditionBreakdown: d.conditionBreakdown,
    },
  };
}

/** `market_context` for /api/ai/etsy (min/max/median only; the server prompt prefers median). */
export function etsyMarketContext(r: AiResearchPrefill | null): Record<string, unknown> | undefined {
  if (!r) return undefined;
  const ps = r.priceStats;
  return {
    query: r.query,
    topTags: r.topTags ?? [],
    topKeywords: r.topKeywords ?? [],
    priceStats: ps && ps.median != null ? { min: ps.min ?? ps.p25, max: ps.max ?? ps.p75, median: ps.median } : null,
  };
}

/** Price band from research; `suggested` = median (Etsy) or the model price clamped into P25–P75 (eBay). */
export function priceBandFrom(
  r: AiResearchPrefill | null,
  marketplace: AiMarketplace,
  shopCurrency: string | null | undefined,
  modelPrice?: number | null,
): AiPriceBand | null {
  const ps = r?.priceStats;
  if (!r || !ps || ps.median == null || !(ps.n && ps.n > 0)) return null;
  const currency = (ps.currency || 'USD').toUpperCase();
  let suggested: number | null = ps.median;
  if (marketplace === 'ebay' && modelPrice != null && Number.isFinite(modelPrice) && modelPrice > 0) {
    const lo = ps.p25 ?? modelPrice;
    const hi = ps.p75 ?? modelPrice;
    suggested = Math.min(Math.max(modelPrice, lo), hi);
  }
  return {
    p25: ps.p25 ?? null,
    p75: ps.p75 ?? null,
    median: ps.median,
    n: ps.n ?? 0,
    currency,
    suggested: suggested != null ? Math.round(suggested * 100) / 100 : null,
    usable: !shopCurrency || shopCurrency.toUpperCase() === currency,
    source: marketplace === 'etsy' ? 'etsy_search' : 'ebay_research',
    query: r.query,
    fetchedAt: r.fetchedAt ?? new Date().toISOString(),
    excluded: ps.excluded || undefined,
  };
}

/** AiPriceBand → Group B's `MarketBand` (PriceSection). */
export function toMarketBand(b: AiPriceBand): MarketBand {
  return { p25: b.p25, median: b.median, p75: b.p75, n: b.n, currency: b.currency, query: b.query, fetchedAt: b.fetchedAt, excluded: b.excluded };
}

/** Own-hosted photo URLs only (identify_product rejects anything else). */
export function ownImageUrls(urls: readonly string[] | undefined): string[] {
  return (urls ?? []).filter((u) => /^https:\/\/[^/]+\/api\/clawd\/serve-image/.test(u)).slice(0, 4);
}

const DEFAULT_FIELD_KEYS: Record<AiMarketplace, Record<FillKey, string>> = {
  etsy: { title: 'title', description: 'description', tags: 'tags', category: 'taxonomy_id', specifics: 'aspects', price: 'price', condition: 'condition' },
  ebay: { title: 'title', description: 'description', tags: 'tags', category: 'categoryId', specifics: 'aspects', price: 'price', condition: 'condition' },
};

/** Field label (full i18n key) per proposal. */
export const FILL_LABEL_KEY: Record<FillKey, string> = {
  title: 'listingEditor.field.title',
  description: 'listingEditor.field.description',
  tags: 'listingEditor.section.tags',
  category: 'listingEditor.field.category',
  specifics: 'listingEditor.section.specifics',
  price: 'listingEditor.field.price',
  condition: 'listingEditor.field.condition',
};

const ETSY_STEPS = ['research', 'title', 'description', 'tags'];
const EBAY_STEPS = ['identify', 'research', 'title', 'category', 'specifics', 'price', 'description'];

type Resp = { ok: boolean; status: number; data: unknown };

class AiCallError extends Error {
  constructor(public status: number, public data: unknown) {
    super(`AI ${status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function useListingAI(options: UseListingAIOptions): UseListingAI {
  const { marketplace } = options;
  const t = useTranslations();
  const locale = useLocale();
  const toast = useToast();

  const opts = useRef(options);
  opts.current = options;

  const [proposals, setProposals] = useState<Partial<Record<AiKey, AiProposal>>>({});
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const [limitReached, setLimitReached] = useState(false);
  const [research, setResearch] = useState<AiResearchPrefill | null>(options.research ?? null);
  const [fill, setFill] = useState<FillState>({ running: false, steps: [] });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A research prefill passed later (session prefill read after mount) wins over a lazy search.
  useEffect(() => {
    if (options.research) setResearch(options.research);
  }, [options.research]);

  const inFlight = useRef(new Map<string, Promise<void>>());
  const gen = useRef(new Map<string, number>());
  const researchCache = useRef(new Map<string, Promise<(AiResearchPrefill & { ebay?: Record<string, unknown> }) | null>>());
  const ebayResearch = useRef<Record<string, unknown> | null>(null);
  const altUrls = useRef(new Map<string, string>());

  const mp = NAMES[marketplace];

  const set = useCallback((key: AiKey, p: AiProposal) => {
    if (!mounted.current) return;
    setProposals((prev) => ({ ...prev, [key]: p }));
  }, []);

  const http = useCallback(async (url: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<Resp> => {
    const f = opts.current.fetcher ?? fetch;
    const res = await f(url, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }, []);

  const etsyAi = useCallback(async (action: string, body: Record<string, unknown>) => {
    const r = await http('/api/ai/etsy', { method: 'POST', body: { action, ...body } });
    if (!r.ok || !r.data || typeof r.data !== 'object') throw new AiCallError(r.ok ? 502 : r.status, r.data);
    return r.data as Record<string, unknown>;
  }, [http]);

  const ebayAi = useCallback(async (action: string, body: Record<string, unknown>) => {
    const r = await http(`/api/clawd/ebay-ai?action=${encodeURIComponent(action)}`, { method: 'POST', body });
    if (!r.ok || !r.data || typeof r.data !== 'object') throw new AiCallError(r.ok ? 502 : r.status, r.data);
    return r.data as Record<string, unknown>;
  }, [http]);

  /** Error → proposal fields. Raw model / server text is never shown (only i18n keys). */
  const failure = useCallback((err: unknown): Pick<AiProposal, 'error' | 'limited'> => {
    const status = err instanceof AiCallError ? err.status : 0;
    if (status === 402) {
      setLimitReached(true);
      return { error: t('listingEditor.ai.limitReached'), limited: true };
    }
    const code = err instanceof AiCallError ? aiErrorCode(err.data) : null;
    if (code && code !== 'invalid_ai_response' && !code.endsWith('_failed')) return { error: t(`etsy.aiErrors.${code}`) };
    if (status === 429) return { error: t('etsy.aiErrors.rate_limited') };
    if (status === 401) return { error: t('etsy.aiErrors.unauthorized') };
    return { error: true };
  }, [t]);

  const basisFor = useCallback((r: AiResearchPrefill | null): string | undefined => {
    if (!r || !r.count) return undefined;
    return t('listingEditor.ai.basis', { count: r.count, marketplace: mp, query: r.query });
  }, [t, mp]);

  /** Research context: prefill → cached lazy search on the title's first phrase. Never throws. */
  const ensureResearch = useCallback(async (seed?: string): Promise<AiResearchPrefill | null> => {
    if (opts.current.research) return opts.current.research;
    const query = researchQuery(seed ?? opts.current.input.title ?? '');
    if (query.length < (marketplace === 'etsy' ? 10 : 3)) return null;
    let p = researchCache.current.get(query);
    if (!p) {
      p = (async () => {
        try {
          if (marketplace === 'etsy') {
            const qs = new URLSearchParams({ action: 'search_market', keywords: query, limit: '100', sort_on: 'score', sort_order: 'desc' });
            const r = await http(`/api/clawd/etsy?${qs.toString()}`);
            return r.ok ? researchFromEtsySearch(r.data, query) : null;
          }
          const qs = new URLSearchParams({ action: 'niche_analyze', q: query, marketplace_id: 'EBAY_US' });
          const r = await http(`/api/clawd/ebay-research?${qs.toString()}`);
          return r.ok ? researchFromEbayNiche(r.data, query) : null;
        } catch {
          return null;
        }
      })();
      researchCache.current.set(query, p);
    }
    const r = await p;
    if (r && mounted.current) {
      setResearch(r);
      if ('ebay' in r && r.ebay) ebayResearch.current = r.ebay;
    }
    return r;
  }, [http, marketplace]);

  /** Single-flight per key; a dismiss while loading discards the late result. */
  const run = useCallback((key: AiKey, work: (isCurrent: () => boolean) => Promise<void>): Promise<void> => {
    const existing = inFlight.current.get(key);
    if (existing) return existing;
    const myGen = (gen.current.get(key) ?? 0) + 1;
    gen.current.set(key, myGen);
    const isCurrent = () => mounted.current && gen.current.get(key) === myGen;
    const holder: { p?: Promise<void> } = {};
    const p = (async () => {
      try {
        await work(isCurrent);
      } finally {
        // A Dismiss + Try again may have registered a newer run under this key: only remove our own entry.
        if (inFlight.current.get(key) === holder.p) inFlight.current.delete(key);
      }
    })();
    holder.p = p;
    inFlight.current.set(key, p);
    return p;
  }, []);

  // ── Title ──────────────────────────────────────────────────────────────────────────────────────────────
  const titleFrom = useCallback(async (seedTitle: string, r: AiResearchPrefill | null): Promise<{ value: string; rationale?: string }> => {
    const input = opts.current.input;
    if (marketplace === 'etsy') {
      const data = await etsyAi('optimize_title', {
        title: seedTitle,
        description: input.description,
        tags: input.tags ?? [],
        category: input.categoryName ?? undefined,
        market_context: etsyMarketContext(r),
      });
      const value = sanitizeTitle('etsy', data.optimized_title ?? data.title);
      const explanation = coerceAiString(data.explanation);
      return { value, rationale: locale === 'tr' && explanation ? explanation.slice(0, 200) : undefined };
    }
    const data = await ebayAi('optimize_title', {
      title: seedTitle,
      categoryName: input.categoryName ?? undefined,
      marketResearch: ebayResearch.current ?? undefined,
    });
    return { value: sanitizeTitle('ebay', data.optimizedTitle) };
  }, [marketplace, etsyAi, ebayAi, locale]);

  const suggestTitle = useCallback(() => run('title', async (isCurrent) => {
    const title = opts.current.input.title.trim();
    if (!title) {
      set('title', { status: 'error', error: t('etsy.aiErrors.missing_title') });
      return;
    }
    set('title', { status: 'loading' });
    try {
      const r = await ensureResearch();
      const { value, rationale } = await titleFrom(title, r);
      if (!isCurrent()) return;
      set('title', value ? { status: 'ready', value, rationale, basis: basisFor(r) } : { status: 'error', error: true });
    } catch (err) {
      if (isCurrent()) set('title', { status: 'error', ...failure(err) });
    }
  }), [run, set, t, ensureResearch, titleFrom, basisFor, failure]);

  // ── Description ────────────────────────────────────────────────────────────────────────────────────────
  const descriptionFrom = useCallback(async (title: string, r: AiResearchPrefill | null): Promise<string> => {
    const input = opts.current.input;
    if (marketplace === 'etsy') {
      const data = await etsyAi('generate_description', {
        title,
        tags: input.tags ?? [],
        materials: input.materials ?? [],
        category: input.categoryName ?? undefined,
        existing_description: input.description || undefined,
        market_context: etsyMarketContext(r),
      });
      return sanitizeDescription('etsy', data.description);
    }
    const data = await ebayAi('generate_description', {
      title,
      aspects: input.aspects && Object.keys(input.aspects).length ? input.aspects : undefined,
      condition: input.condition ?? undefined,
      price: input.price ?? undefined,
      marketResearch: ebayResearch.current ?? undefined,
    });
    return sanitizeDescription('ebay', data.description);
  }, [marketplace, etsyAi, ebayAi]);

  const writeDescription = useCallback(() => run('description', async (isCurrent) => {
    const title = opts.current.input.title.trim();
    if (!title) {
      set('description', { status: 'error', error: t('etsy.aiErrors.missing_title') });
      return;
    }
    set('description', { status: 'loading' });
    try {
      const r = await ensureResearch();
      const value = await descriptionFrom(title, r);
      if (!isCurrent()) return;
      set('description', value ? { status: 'ready', value, basis: basisFor(r) } : { status: 'error', error: true });
    } catch (err) {
      if (isCurrent()) set('description', { status: 'error', ...failure(err) });
    }
  }), [run, set, t, ensureResearch, descriptionFrom, basisFor, failure]);

  // ── Tags (Etsy) ────────────────────────────────────────────────────────────────────────────────────────
  const tagsFrom = useCallback(async (title: string, description: string, r: AiResearchPrefill | null): Promise<string[]> => {
    const current = opts.current.input.tags ?? [];
    const data = await etsyAi('suggest_tags', {
      mode: 'add',
      title,
      description,
      tags_current: current,
      category: opts.current.input.categoryName ?? undefined,
      market_context: etsyMarketContext(r),
    });
    return sanitizeTagIdeas(data.suggestions ?? data.tags, title, current).slice(0, TAG_MAX_COUNT);
  }, [etsyAi]);

  const getTagIdeas = useCallback(() => run('tags', async (isCurrent) => {
    if (marketplace !== 'etsy') return;
    const { title, description } = opts.current.input;
    if (!title.trim()) {
      set('tags', { status: 'error', error: t('etsy.aiErrors.missing_title') });
      return;
    }
    set('tags', { status: 'loading' });
    try {
      const r = await ensureResearch();
      const ideas = await tagsFrom(title, description, r);
      if (!isCurrent()) return;
      set('tags', ideas.length ? { status: 'ready', value: ideas, basis: basisFor(r) } : { status: 'error', error: t('etsy.aiErrors.ai_tags_failed') });
    } catch (err) {
      if (isCurrent()) set('tags', { status: 'error', ...failure(err) });
    }
  }), [run, marketplace, set, t, ensureResearch, tagsFrom, basisFor, failure]);

  // ── Item specifics (eBay) ──────────────────────────────────────────────────────────────────────────────
  const specificsFrom = useCallback(async (title: string, names: string[], categoryName: string | undefined): Promise<Record<string, string[]>> => {
    const o = opts.current;
    const current = mergeAspects(o.getField?.(o.fieldKeys?.specifics ?? 'aspects'), o.input.aspects, null);
    const data = await ebayAi('suggest_aspects', {
      title,
      aspectNames: names,
      currentAspects: current,
      categoryName,
      marketResearch: ebayResearch.current ?? undefined,
    });
    return sanitizeAspects(data.aspects, names);
  }, [ebayAi]);

  const fillSpecifics = useCallback((aspectNames: string[]) => run('specifics', async (isCurrent) => {
    if (marketplace !== 'ebay') return;
    const title = opts.current.input.title.trim();
    const names = Array.from(new Set(aspectNames.filter(Boolean))).slice(0, 30);
    if (!title || !names.length) {
      set('specifics', { status: 'error', error: t('etsy.aiErrors.missing_title') });
      return;
    }
    set('specifics', { status: 'loading' });
    try {
      await ensureResearch();
      const value = await specificsFrom(title, names, opts.current.input.categoryName ?? undefined);
      if (!isCurrent()) return;
      set('specifics', Object.keys(value).length ? { status: 'ready', value } : { status: 'error', error: true });
    } catch (err) {
      if (isCurrent()) set('specifics', { status: 'error', ...failure(err) });
    }
  }), [run, marketplace, set, t, ensureResearch, specificsFrom, failure]);

  // ── Price ──────────────────────────────────────────────────────────────────────────────────────────────
  const priceFrom = useCallback(async (title: string, r: AiResearchPrefill | null): Promise<AiPriceBand | null> => {
    const input = opts.current.input;
    if (marketplace === 'etsy') return priceBandFrom(r, 'etsy', input.currency);
    let modelPrice: number | null = null;
    try {
      const data = await ebayAi('suggest_price', {
        title,
        condition: input.condition ?? undefined,
        categoryName: input.categoryName ?? undefined,
        marketResearch: ebayResearch.current ?? undefined,
      });
      modelPrice = num(data.suggestedPrice);
    } catch (err) {
      if (err instanceof AiCallError && err.status === 402) throw err;
      // The research band is still honest without the model price.
    }
    return priceBandFrom(r, 'ebay', input.currency, modelPrice);
  }, [marketplace, ebayAi]);

  const checkPrice = useCallback(() => run('price', async (isCurrent) => {
    const title = opts.current.input.title.trim();
    if (!title) {
      set('price', { status: 'error', error: t('etsy.aiErrors.missing_title') });
      return;
    }
    set('price', { status: 'loading' });
    try {
      const r = await ensureResearch();
      const band = await priceFrom(title, r);
      if (!isCurrent()) return;
      set('price', band ? { status: 'ready', value: band, basis: basisFor(r) } : { status: 'error', error: t('listingEditor.ai.noMarketData', { marketplace: mp }) });
    } catch (err) {
      if (isCurrent()) set('price', { status: 'error', ...failure(err) });
    }
  }), [run, set, t, mp, ensureResearch, priceFrom, basisFor, failure]);

  // ── Alt text (Etsy) ────────────────────────────────────────────────────────────────────────────────────
  const writeAltText = useCallback(async (images: Array<{ id: string; url: string }>) => {
    if (marketplace !== 'etsy') return;
    const { title, description } = opts.current.input;
    const queue = images.filter((im) => im && im.id);
    queue.forEach((im) => {
      altUrls.current.set(im.id, im.url);
      set(`alt:${im.id}`, { status: 'loading' });
    });
    const worker = async () => {
      for (let im = queue.shift(); im; im = queue.shift()) {
        const current = im;
        await run(`alt:${current.id}`, async (isCurrent) => {
          set(`alt:${current.id}`, { status: 'loading' });
          try {
            const data = await etsyAi('generate_alt_text', { title: title || current.id, description: description.slice(0, 1500), image_url: current.url });
            const value = sanitizeAltText(data.alt_text);
            if (isCurrent()) set(`alt:${current.id}`, value ? { status: 'ready', value } : { status: 'error', error: true });
          } catch (err) {
            if (isCurrent()) set(`alt:${current.id}`, { status: 'error', ...failure(err) });
          }
        });
      }
    };
    await Promise.all([worker(), worker()]);
  }, [marketplace, set, run, etsyAi, failure]);

  // ── Photo ──────────────────────────────────────────────────────────────────────────────────────────────
  const generatePhoto = useCallback(async (o: { prompt: string; referenceUrls?: string[]; whiteBackground?: boolean }): Promise<GeneratedPhoto | null> => {
    let out: GeneratedPhoto | null = null;
    await run('photo', async (isCurrent) => {
      const prompt = o.prompt.trim();
      if (!prompt) {
        set('photo', { status: 'error', error: t('etsy.aiErrors.missing_prompt') });
        return;
      }
      set('photo', { status: 'loading' });
      try {
        const r = await http('/api/ai/generate-image', {
          method: 'POST',
          body: {
            prompt,
            marketplace,
            reference_image_urls: (o.referenceUrls ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 3),
            ...(o.whiteBackground !== undefined ? { white_background: o.whiteBackground } : {}),
          },
        });
        const d = (r.data ?? {}) as Record<string, unknown>;
        if (!r.ok || typeof d.image_base64 !== 'string' || !d.image_base64) throw new AiCallError(r.ok ? 502 : r.status, r.data);
        const mimeType = typeof d.mime_type === 'string' ? d.mime_type : 'image/jpeg';
        const bin = atob(d.image_base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const file = new File([bytes], `ai-photo-${Date.now()}.${ext}`, { type: mimeType });
        // A generation dismissed while it ran is thrown away: nothing is handed back to stage.
        if (!isCurrent()) return;
        out = { file, previewUrl: `data:${mimeType};base64,${d.image_base64}`, mimeType };
        set('photo', { status: 'idle' });
      } catch (err) {
        out = null;
        if (isCurrent()) set('photo', { status: 'error', ...failure(err) });
      }
    });
    return out;
  }, [run, set, t, http, marketplace, failure]);

  // ── Start faster: fill the whole listing (proposals only) ─────────────────────────────────────────────
  const fillListing = useCallback(async (o: { seed?: string; imageUrls?: string[] }) => {
    if (inFlight.current.has('fill' as AiKey)) return inFlight.current.get('fill' as AiKey);
    const steps = (marketplace === 'etsy' ? ETSY_STEPS : EBAY_STEPS).map((id) => ({ id, status: 'pending' as FillStepState['status'] }));
    const mark = (id: string, status: FillStepState['status']) => {
      const s = steps.find((x) => x.id === id);
      if (s) s.status = status;
      if (mounted.current) setFill({ running: true, steps: steps.map((x) => ({ ...x })) });
    };
    const finish = (error?: string) => {
      if (mounted.current) setFill({ running: false, steps: steps.map((x) => ({ ...x })), error });
    };
    // Each step claims its key's generation (like `run`): a Dismiss, or a single-field run started meanwhile,
    // bumps it, and the step's late result is thrown away instead of bringing the card back.
    const claimed = new Map<AiKey, number>();
    const claim = (key: AiKey) => {
      const g = (gen.current.get(key) ?? 0) + 1;
      gen.current.set(key, g);
      claimed.set(key, g);
    };
    const current = (key: AiKey) => mounted.current && claimed.has(key) && gen.current.get(key) === claimed.get(key);
    const put = (key: AiKey, p: AiProposal) => {
      if (current(key)) set(key, p);
    };
    const job = (async () => {
      setFill({ running: true, steps: steps.map((x) => ({ ...x })) });
      let seed = decodeEntities((o.seed ?? '').trim()).slice(0, 200);
      let limited = false;
      const onError = (key: AiKey, err: unknown) => {
        const f = failure(err);
        if (f.limited) limited = true;
        put(key, { status: 'error', ...f });
      };

      if (marketplace === 'ebay') {
        const urls = ownImageUrls(o.imageUrls);
        if (urls.length) {
          mark('identify', 'running');
          claim('condition');
          claim('title');
          try {
            const data = await ebayAi('identify_product', { imageUrls: urls });
            const found = coerceAiString(data.seed).slice(0, 200);
            if (found) seed = found;
            const cond = coerceAiString(data.suggestedCondition).toUpperCase();
            // Bare VERY_GOOD / GOOD / ACCEPTABLE are not valid eBay conditions: mapped like every other writer.
            if (/^(NEW|LIKE_NEW|VERY_GOOD|GOOD|ACCEPTABLE)$/.test(cond)) put('condition', { status: 'ready', value: normalizeCondition(cond) ?? cond });
            mark('identify', found ? 'done' : 'error');
          } catch (err) {
            mark('identify', 'error');
            if (err instanceof AiCallError && err.status === 402) { onError('title', err); finish(); return; }
          }
        } else {
          mark('identify', 'skipped');
        }
      }
      if (!seed || seed.length < 3) {
        finish(t(marketplace === 'ebay' ? 'listingEditor.ai.fillNeedsSeedOrPhoto' : 'listingEditor.ai.fillNeedsSeed'));
        return;
      }

      mark('research', 'running');
      const r = await ensureResearch(seed);
      mark('research', r ? 'done' : 'error');
      const basis = basisFor(r);

      let workingTitle = seed;
      mark('title', 'running');
      claim('title');
      put('title', { status: 'loading' });
      try {
        const { value, rationale } = await titleFrom(seed, r);
        if (value) workingTitle = value;
        put('title', value ? { status: 'ready', value, rationale, basis } : { status: 'error', error: true });
        mark('title', value ? 'done' : 'error');
      } catch (err) {
        onError('title', err);
        mark('title', 'error');
      }
      if (limited) { finish(); return; }

      let category: AiCategory | null = null;
      if (marketplace === 'ebay') {
        mark('category', 'running');
        claim('category');
        try {
          const qs = new URLSearchParams({ action: 'category_suggestions', q: workingTitle });
          const res = await http(`/api/clawd/ebay?${qs.toString()}`);
          const list = (res.ok && res.data && typeof res.data === 'object' ? (res.data as { categorySuggestions?: unknown[] }).categorySuggestions : []) ?? [];
          const options = (list as Array<Record<string, any>>)
            .map((c) => ({ id: String(c?.category?.categoryId ?? c?.categoryId ?? ''), name: String(c?.category?.categoryName ?? c?.categoryName ?? c?.name ?? '') }))
            .filter((c) => c.id && c.name);
          if (options.length) {
            category = { ...options[0], alternatives: options.slice(1, 5) };
            put('category', { status: 'ready', value: category });
          }
          mark('category', category ? 'done' : 'error');
        } catch {
          mark('category', 'error');
        }

        mark('specifics', 'running');
        claim('specifics');
        try {
          if (!category) throw new Error('no category');
          const qs = new URLSearchParams({ action: 'item_aspects', category_id: category.id });
          const res = await http(`/api/clawd/ebay?${qs.toString()}`);
          const all = (res.ok && res.data && typeof res.data === 'object' ? (res.data as { aspects?: unknown[] }).aspects : []) ?? [];
          const metas = all as Array<{ localizedAspectName?: string; aspectConstraint?: { aspectRequired?: boolean } }>;
          const names = [
            ...metas.filter((a) => a?.aspectConstraint?.aspectRequired),
            ...metas.filter((a) => !a?.aspectConstraint?.aspectRequired),
          ].map((a) => a?.localizedAspectName).filter((n): n is string => typeof n === 'string' && !!n).slice(0, 15);
          if (!names.length) throw new Error('no aspects');
          put('specifics', { status: 'loading' });
          const value = await specificsFrom(workingTitle, names, category.name);
          put('specifics', Object.keys(value).length ? { status: 'ready', value } : { status: 'error', error: true });
          mark('specifics', Object.keys(value).length ? 'done' : 'error');
        } catch (err) {
          if (err instanceof AiCallError) onError('specifics', err);
          mark('specifics', 'error');
        }
        if (limited) { finish(); return; }

        mark('price', 'running');
        claim('price');
        put('price', { status: 'loading' });
        try {
          const band = await priceFrom(workingTitle, r);
          put('price', band ? { status: 'ready', value: band, basis } : { status: 'error', error: t('listingEditor.ai.noMarketData', { marketplace: mp }) });
          mark('price', band ? 'done' : 'error');
        } catch (err) {
          onError('price', err);
          mark('price', 'error');
        }
        if (limited) { finish(); return; }
      }

      mark('description', 'running');
      claim('description');
      put('description', { status: 'loading' });
      let description = '';
      try {
        description = await descriptionFrom(workingTitle, r);
        put('description', description ? { status: 'ready', value: description, basis } : { status: 'error', error: true });
        mark('description', description ? 'done' : 'error');
      } catch (err) {
        onError('description', err);
        mark('description', 'error');
      }
      if (limited) { finish(); return; }

      if (marketplace === 'etsy') {
        mark('tags', 'running');
        claim('tags');
        put('tags', { status: 'loading' });
        try {
          const ideas = await tagsFrom(workingTitle, description, r);
          put('tags', ideas.length ? { status: 'ready', value: ideas, basis } : { status: 'error', error: t('etsy.aiErrors.ai_tags_failed') });
          mark('tags', ideas.length ? 'done' : 'error');
        } catch (err) {
          onError('tags', err);
          mark('tags', 'error');
        }
      }
      finish();
    })();
    inFlight.current.set('fill' as AiKey, job);
    try {
      await job;
    } finally {
      inFlight.current.delete('fill' as AiKey);
    }
  }, [marketplace, set, t, mp, failure, ebayAi, ensureResearch, basisFor, titleFrom, http, specificsFrom, priceFrom, descriptionFrom, tagsFrom]);

  // ── Applying proposals ─────────────────────────────────────────────────────────────────────────────────
  const dismiss = useCallback((key: AiKey) => {
    gen.current.set(key, (gen.current.get(key) ?? 0) + 1);
    inFlight.current.delete(key);
    setProposals((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const fieldKey = useCallback((k: FillKey) => opts.current.fieldKeys?.[k] ?? DEFAULT_FIELD_KEYS[marketplace][k], [marketplace]);

  /**
   * Writes one proposal value. Returns null when nothing was written, otherwise the undo (undefined when the caller
   * gave no `getField`, so the previous value is unknown and no Undo is offered).
   */
  const write = useCallback((k: FillKey, value: unknown): { undo?: () => void } | null => {
    const o = opts.current;
    const key = fieldKey(k);
    const prev = o.getField ? o.getField(key) : undefined;
    const custom = o.appliers?.[k];
    let toWrite: unknown = value;
    if (k === 'price') {
      const band = value as AiPriceBand;
      if (!band || band.suggested == null || !band.usable) return null;
      toWrite = marketplace === 'etsy' ? toDecimalString(band.suggested) : band.suggested;
    } else if (k === 'tags') {
      const ideas = Array.isArray(value) ? (value as string[]) : [];
      const current = [...(o.input.tags ?? [])];
      const free = Math.max(0, TAG_MAX_COUNT - current.length);
      if (!free || !ideas.length) return null;
      toWrite = [...current, ...ideas.slice(0, free)];
    } else if (k === 'specifics') {
      toWrite = mergeAspects(o.getField ? o.getField(key) : undefined, o.input.aspects, value);
    } else if (k === 'category' && marketplace === 'ebay' && !custom) {
      // Only the contract's field (categoryId); the name follows from the id. A frame that also wants the name
      // stored passes `appliers.category`.
      const c = value as AiCategory;
      if (!c?.id) return null;
      toWrite = c.id;
    }
    if (custom) custom(toWrite);
    else if (o.setField) o.setField(key, toWrite);
    else return null;
    if (!o.getField) return {};
    return { undo: () => (custom ? custom(prev) : o.setField?.(key, prev)) };
  }, [fieldKey, marketplace]);

  const apply = useCallback((k: FillKey) => {
    const p = proposalsRef.current[k];
    if (!p || p.status !== 'ready') return;
    const done = write(k, p.value);
    dismiss(k);
    if (!done) return;
    toast.success(t('listingEditor.ai.replaced', { field: t(FILL_LABEL_KEY[k]) }), done.undo ? { undo: done.undo } : undefined);
  }, [write, dismiss, toast, t]);

  const applyAll = useCallback((): number => {
    const undos: Array<() => void> = [];
    let count = 0;
    for (const k of FILL_KEYS) {
      const p = proposalsRef.current[k];
      if (!p || p.status !== 'ready') continue;
      const done = write(k, p.value);
      dismiss(k);
      if (!done) continue;
      count += 1;
      if (done.undo) undos.push(done.undo);
    }
    if (count) {
      const undoAll = undos.length === count ? () => undos.slice().reverse().forEach((u) => u()) : undefined;
      toast.success(t('listingEditor.ai.usedAll', { count }), undoAll ? { undo: undoAll } : undefined);
    }
    return count;
  }, [write, dismiss, toast, t]);

  const acceptTag = useCallback((tag: string) => {
    const o = opts.current;
    const current = [...(o.input.tags ?? [])];
    if (current.length >= TAG_MAX_COUNT || !o.setField) return;
    const key = fieldKey('tags');
    const { tags } = normalizeTags([...current, tag], { max: TAG_MAX_COUNT });
    o.setField(key, tags);
    setProposals((prev) => {
      const p = prev.tags;
      if (!p || !Array.isArray(p.value)) return prev;
      const rest = (p.value as string[]).filter((x) => x !== tag);
      const next = { ...prev };
      if (rest.length) next.tags = { ...p, value: rest };
      else delete next.tags;
      return next;
    });
  }, [fieldKey]);

  const acceptAllTags = useCallback(() => {
    const p = proposalsRef.current.tags;
    if (!p || p.status !== 'ready') return;
    const done = write('tags', p.value);
    dismiss('tags');
    if (done) toast.success(t('listingEditor.ai.tagsAdded', { count: Math.min((p.value as string[]).length, TAG_MAX_COUNT - (opts.current.input.tags?.length ?? 0)) }), done.undo ? { undo: done.undo } : undefined);
  }, [write, dismiss, toast, t]);

  const acceptAspect = useCallback((name: string) => {
    const p = proposalsRef.current.specifics;
    const all = (p?.value ?? {}) as Record<string, string[]>;
    if (!all[name]) return;
    write('specifics', { [name]: all[name] });
    setProposals((prev) => {
      const cur = prev.specifics;
      if (!cur) return prev;
      const rest = { ...(cur.value as Record<string, string[]>) };
      delete rest[name];
      const next = { ...prev };
      if (Object.keys(rest).length) next.specifics = { ...cur, value: rest };
      else delete next.specifics;
      return next;
    });
  }, [write]);

  const skipAspect = useCallback((name: string) => {
    setProposals((prev) => {
      const cur = prev.specifics;
      if (!cur) return prev;
      const rest = { ...(cur.value as Record<string, string[]>) };
      delete rest[name];
      const next = { ...prev };
      if (Object.keys(rest).length) next.specifics = { ...cur, value: rest };
      else delete next.specifics;
      return next;
    });
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────────────────────────────────────
  const isBusy = useCallback((key: AiKey | 'fill') => (key === 'fill' ? fill.running : proposals[key]?.status === 'loading'), [fill.running, proposals]);

  const retryFor = useCallback((key: AiKey): (() => void) => {
    if (key === 'title') return () => void suggestTitle();
    if (key === 'description') return () => void writeDescription();
    if (key === 'tags') return () => void getTagIdeas();
    if (key === 'price') return () => void checkPrice();
    if (key === 'specifics') return () => void fillSpecifics(Object.keys((proposalsRef.current.specifics?.value ?? {}) as object));
    if (key.startsWith('alt:')) {
      return () => {
        const id = key.slice(4);
        const url = altUrls.current.get(id);
        if (url) void writeAltText([{ id, url }]);
      };
    }
    return () => undefined;
  }, [suggestTitle, writeDescription, getTagIdeas, checkPrice, fillSpecifics, writeAltText]);

  const suggestionProps = useCallback((key: AiKey, o?: { onUse?: (value: unknown) => void; useLabel?: string }): FieldSuggestionProps | null => {
    const p = proposals[key];
    if (!p || p.status === 'idle') return null;
    const v = p.value;
    let value: string | string[] = '';
    let counter: FieldSuggestionProps['counter'];
    if (typeof v === 'string') {
      value = v;
      if (key === 'title') counter = { value: v.length, max: marketplace === 'etsy' ? TITLE_MAX : EBAY_TITLE_MAX };
      if (key.startsWith('alt:')) counter = { value: v.length, max: ALT_TEXT_MAX };
    } else if (Array.isArray(v)) {
      value = v as string[];
    } else if (key === 'specifics' && v && typeof v === 'object') {
      value = Object.entries(v as Record<string, string[]>).map(([n, vals]) => `${n}: ${vals.join(', ')}`);
    } else if (key === 'category' && v && typeof v === 'object') {
      value = (v as AiCategory).name;
    }
    const fillable = (FILL_KEYS as readonly string[]).includes(key);
    return {
      value,
      counter,
      basis: p.basis,
      rationale: p.rationale,
      loading: p.status === 'loading',
      error: p.status === 'error' ? p.error ?? true : undefined,
      credits: creditsFor(key),
      useLabel: o?.useLabel,
      onUse: () => {
        if (o?.onUse) {
          o.onUse(p.value);
          dismiss(key);
        } else if (fillable) {
          apply(key as FillKey);
        }
      },
      onDismiss: () => dismiss(key),
      onRetry: p.limited ? () => undefined : retryFor(key),
      'data-testid': `ai-suggestion-${key.replace(':', '-')}`,
    };
  }, [proposals, marketplace, dismiss, apply, retryFor]);

  const tagSuggestionProps = useCallback(() => {
    const p = proposals.tags;
    const suggestions = p?.status === 'ready' && Array.isArray(p.value) ? (p.value as string[]) : [];
    return { suggestions, onAcceptSuggestion: acceptTag, onAcceptAll: acceptAllTags };
  }, [proposals.tags, acceptTag, acceptAllTags]);

  const buttonState = useCallback((key: AiKey | 'fill'): AiButtonState => {
    const loading = isBusy(key);
    const limitedReason = limitReached ? t('listingEditor.ai.limitReached') : undefined;
    return {
      loading,
      loadingLabel: t('listingEditor.ai.writing'),
      disabled: limitReached,
      disabledReason: limitedReason,
      costLabel: t('listingEditor.ai.cost', { count: creditsFor(key, { marketplace }) }),
    };
  }, [isBusy, limitReached, t, marketplace]);

  const fieldState = useCallback(<V,>(key: 'title' | 'description' | 'tags'): FieldAiState<V> => {
    const p = proposals[key];
    const runner = key === 'title' ? suggestTitle : key === 'description' ? writeDescription : getTagIdeas;
    // Out of credits (402): Try again would only fail the same way, so it does nothing.
    const limited = !!p?.limited || limitReached;
    return {
      run: limited ? () => undefined : () => void runner(),
      loading: p?.status === 'loading',
      value: p?.status === 'ready' && p.value !== undefined ? (p.value as V) : null,
      error: p?.status === 'error' ? p.error ?? true : undefined,
      basis: p?.basis,
      rationale: p?.rationale,
      dismiss: () => dismiss(key),
      credits: creditsFor(key),
    };
  }, [proposals, suggestTitle, writeDescription, getTagIdeas, dismiss, limitReached]);

  const priceSectionProps = useCallback(() => {
    const p = proposals.price;
    const market = !p || p.status === 'idle'
      ? undefined
      : p.status === 'ready' && p.value ? toMarketBand(p.value as AiPriceBand) : null;
    return { market, marketLoading: p?.status === 'loading', onCheckPrice: () => void checkPrice() };
  }, [proposals.price, checkPrice]);

  const get = useCallback(<T,>(key: AiKey): AiProposal<T> => (proposals[key] as AiProposal<T> | undefined) ?? { status: 'idle' }, [proposals]);

  return useMemo<UseListingAI>(() => ({
    marketplace,
    proposals,
    get,
    limitReached,
    research,
    fill,
    suggestTitle,
    writeDescription,
    getTagIdeas,
    fillSpecifics,
    checkPrice,
    writeAltText,
    generatePhoto,
    fillListing,
    dismiss,
    apply,
    applyAll,
    acceptTag,
    acceptAllTags,
    acceptAspect,
    skipAspect,
    suggestionProps,
    tagSuggestionProps,
    fieldState,
    priceSectionProps,
    buttonState,
    isBusy,
  }), [
    marketplace, proposals, get, limitReached, research, fill, suggestTitle, writeDescription, getTagIdeas, fillSpecifics,
    checkPrice, writeAltText, generatePhoto, fillListing, dismiss, apply, applyAll, acceptTag, acceptAllTags, acceptAspect,
    skipAspect, suggestionProps, tagSuggestionProps, fieldState, priceSectionProps, buttonState, isBusy,
  ]);
}

export default useListingAI;

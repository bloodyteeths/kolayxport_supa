// components/domain/research/keywords/keywordModel.ts (research R2-B) — pure model of the Keyword explorer
// (research.md §6): URL state, views per marketplace, filters ↔ URL, selection, "Add to title" planning, rank labels
// and the hrefs it links to. No React, unit-tested.
import { urlField } from '@/lib/ds/useUrlState';
import { contentWords } from '@/lib/etsy/seoRules';
import type { KeywordView, ResearchMkt } from '@/lib/research/types';
import { COMPETITION_BANDS, KEYWORD_VIEWS, type CompetitionBand, type KeywordFilters, type KeywordMkt, type KeywordRowExt } from '@/lib/research/keywordTypes';

export const KW_COUNTRIES = ['US', 'GB', 'DE', 'CA', 'AU', 'FR'] as const;
export type KwCountry = (typeof KW_COUNTRIES)[number];
export const DEMAND_MIN_VALUES = ['2', '3', '4', '5'] as const;
export type DemandMinValue = (typeof DEMAND_MIN_VALUES)[number];

/** `?q=|listing=<id>&shop=&mkt=&country=US&view=&f.<key>=&sel=` (research.md §2.1). `mkt` is the layout's. */
export const KEYWORDS_URL_SCHEMA = {
  q: urlField.string(undefined, { maxLength: 120 }),
  listing: urlField.string(undefined, { maxLength: 24 }),
  shop: urlField.string(undefined, { maxLength: 24 }),
  country: urlField.enum(KW_COUNTRIES, 'US'),
  view: urlField.enum(KEYWORD_VIEWS, 'suggested'),
  'f.notInTitle': urlField.bool(false),
  'f.maxLen': urlField.optionalEnum(['20'] as const),
  'f.competition': urlField.optionalEnum(COMPETITION_BANDS),
  'f.demand': urlField.optionalEnum(DEMAND_MIN_VALUES),
  /** Selected keywords, `|`-joined (shareable selection). */
  sel: urlField.string(undefined, { maxLength: 1200 }),
};

/** Max keywords one selection can carry (Etsy: 13 tags per listing). */
export const SELECTION_MAX = 13;
/** Rows shown in the panel variant before "Show more". */
export const PANEL_PAGE = 20;
/** Title limits (Etsy 140, eBay 80). */
export const TITLE_MAX: Record<'etsy' | 'ebay', number> = { etsy: 140, ebay: 80 };
/** Etsy Marketplace Insights (Shop Manager › Marketing). Opened in a new tab next to the "Etsy volume" popover. */
export const ETSY_INSIGHTS_URL = 'https://www.etsy.com/your/shops/me/marketplace-insights';
/** Backend SEO experiments list (we link, we never rebuild it). */
export const SEO_EXPERIMENTS_HREF = '/app/etsy-aktivite?tab=seo';

export type KeywordVariant = 'page' | 'panel';

export function isKeywordMkt(m: ResearchMkt | string | undefined | null): m is KeywordMkt {
  return m === 'etsy' || m === 'ebay' || m === 'amazon';
}

/**
 * Views per marketplace (research.md §3.2, §6.1): eBay has no tags (no "Used in my shop") and no rank tracking;
 * Amazon has autocomplete only (no competition, so no Long-tail). The panel variant shows Suggested + Used in my shop.
 */
export function viewsFor(mkt: KeywordMkt, variant: KeywordVariant = 'page'): KeywordView[] {
  if (variant === 'panel') return ['suggested', 'mine'];
  if (mkt === 'etsy') return [...KEYWORD_VIEWS];
  if (mkt === 'ebay') return ['suggested', 'longtail', 'seasonal'];
  return ['suggested', 'seasonal'];
}

/** A view the marketplace does not offer falls back to Suggested. */
export function effectiveView(view: KeywordView, mkt: KeywordMkt, variant: KeywordVariant = 'page'): KeywordView {
  return viewsFor(mkt, variant).includes(view) ? view : 'suggested';
}

export type KeywordUrlFilters = {
  'f.notInTitle': boolean;
  'f.maxLen'?: '20';
  'f.competition'?: CompetitionBand;
  'f.demand'?: DemandMinValue;
};

export function filtersFromUrl(u: KeywordUrlFilters, hasListing: boolean): KeywordFilters {
  const f: KeywordFilters = {};
  if (u['f.notInTitle'] && hasListing) f.notInTitle = true;
  if (u['f.maxLen'] === '20') f.maxLen20 = true;
  if (u['f.competition']) f.competition = u['f.competition'];
  if (u['f.demand']) f.demandMin = Number(u['f.demand']) as KeywordFilters['demandMin'];
  return f;
}

export function activeFilterCount(f: KeywordFilters): number {
  return [f.notInTitle, f.maxLen20, f.competition, f.demandMin].filter(Boolean).length;
}

// ─── Selection ──────────────────────────────────────────────────────────────

export function parseSel(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split('|').map((s) => s.trim().toLowerCase()).filter(Boolean))).slice(0, SELECTION_MAX);
}

export function serializeSel(list: string[]): string | undefined {
  const l = Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))).slice(0, SELECTION_MAX);
  return l.length ? l.join('|') : undefined;
}

/** Top-48 share per keyword (lower-cased) — "weakest first" order for the over-13 replace step. */
export function sharesOf(rows: KeywordRowExt[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.top48.value !== null && r.top48.guard.ok) out[r.keyword.toLowerCase()] = r.top48.value / 48;
  }
  return out;
}

// ─── "Add to title" (staged, never sent) ────────────────────────────────────

export type TitlePlan = {
  /** The proposed title (current + new phrases), ≤ max. */
  title: string;
  /** Phrases appended, in order. */
  added: string[];
  /** Phrases skipped: every content word already in the title, or no room left under the limit. */
  skipped: { keyword: string; reason: 'inTitle' | 'tooLong' }[];
};

/**
 * Appends the selected keywords to the title as comma-separated phrases (Title Case kept as typed; keywords are
 * English). A keyword whose content words are all in the title already is skipped; one that would push the title
 * over the marketplace limit is skipped (never truncated mid-phrase).
 */
export function planTitleAdd(current: string, keywords: string[], max: number): TitlePlan {
  let title = current.trim();
  const have = new Set(contentWords(title).map((w) => w.toLowerCase()));
  const added: string[] = [];
  const skipped: TitlePlan['skipped'] = [];
  for (const raw of keywords) {
    const k = raw.trim().replace(/\s+/g, ' ');
    if (!k) continue;
    const words = contentWords(k).map((w) => w.toLowerCase());
    if (words.length > 0 && words.every((w) => have.has(w))) {
      skipped.push({ keyword: k, reason: 'inTitle' });
      continue;
    }
    const phrase = k.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    const next = title ? `${title}, ${phrase}` : phrase;
    if (next.length > max) {
      skipped.push({ keyword: k, reason: 'tooLong' });
      continue;
    }
    title = next;
    added.push(phrase);
    for (const w of words) have.add(w);
  }
  return { title, added, skipped };
}

// ─── Rank / labels ──────────────────────────────────────────────────────────

export type RankCell =
  | { kind: 'none' }
  | { kind: 'notInTop'; delta: number | null }
  | { kind: 'rank'; rank: number; delta: number | null };

/** `now: null` = "Not in top 500" (never 0). `delta7 > 0` = moved up. Undefined rank = not tracked. */
export function rankCell(rank: { now: number | null; delta7: number | null } | undefined): RankCell {
  if (!rank) return { kind: 'none' };
  if (rank.now === null) return { kind: 'notInTop', delta: rank.delta7 };
  return { kind: 'rank', rank: rank.now, delta: rank.delta7 };
}

/** Seasonal marker: peak month index (1–12) → short month name in the UI locale. */
export function monthName(month: number, locale: string): string {
  const d = new Date(Date.UTC(2026, Math.max(0, Math.min(11, month - 1)), 15));
  try {
    return new Intl.DateTimeFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { month: 'short', timeZone: 'UTC' }).format(d);
  } catch {
    return String(month);
  }
}

/** Full explorer for one listing (the panel's "Open full Keyword explorer ↗"). */
export function explorerHref(listingId: string, shopId?: string | null, view: KeywordView = 'suggested'): string {
  const sp = new URLSearchParams({ listing: listingId });
  if (shopId) sp.set('shop', shopId);
  sp.set('mkt', 'etsy');
  if (view !== 'suggested') sp.set('view', view);
  return `/app/research/keywords?${sp.toString()}`;
}

/** Listings page "not sent" view (the toast's "Open"). */
export function notSentHref(mkt: 'etsy' | 'ebay'): string {
  return mkt === 'ebay' ? '/app/ebay-listings?view=not_sent' : '/app/etsy-listings?view=not_sent';
}

export function shorten(s: string, n = 32): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

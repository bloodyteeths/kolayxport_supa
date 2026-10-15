// components/domain/research/listings/doctorModel.ts — Listing doctor (research.md §7, R1-D): URL state,
// issue vocabulary, fix routing and the local "Staged here" proposal model. Pure: no React, no fetch.
//
// Safety (CLAUDE.md "Etsy editing", research §3.4): a proposal is local until the user presses
// "Stage N fixes"; staging writes a draft (`StagePatch`) and nothing here ever sends to a marketplace.
import { urlField, type UrlStateOf } from '@/lib/ds/useUrlState';
import { ETSY_IMPACT } from '@/lib/listingScore/etsy';
import { EBAY_IMPACT } from '@/lib/listingScore/ebay';
import { finalizeScore, type Check, type ScoreResult } from '@/lib/listingScore/types';
import type { ListingHealth, ListingRow, StagePatch } from '@/lib/listings/types';
import type { PriceSummary } from '@/lib/research/stats';
import { DOCTOR_SORTS, RESEARCH_MKTS, type DoctorSort, type ResearchMkt } from '@/lib/research/types';

export { DOCTOR_SORTS, RESEARCH_MKTS };
export type { DoctorSort };

// ─── Marketplaces, sort, filters ────────────────────────────────────────────

/** Marketplaces the Listing doctor serves (research §3.2: Amazon and Trendyol are hidden). */
export const DOCTOR_MKTS = ['etsy', 'ebay'] as const;
export type DoctorMkt = (typeof DOCTOR_MKTS)[number];

/** Every `?mkt=` value the research hub writes (ResearchLayout owns the switch). */
export type ResearchMktParam = ResearchMkt;

export function isDoctorMkt(v: unknown): v is DoctorMkt {
  return v === 'etsy' || v === 'ebay';
}

/** Health bands of the "Health" filter (same tokens as listings-grid `health`). */
export const DOCTOR_HEALTH_BANDS = ['lt50', '50-74', '75-89', 'gte90'] as const;
export type DoctorHealthBand = (typeof DOCTOR_HEALTH_BANDS)[number];

/** Research-only peer checks (research §7.1); never part of the stored `healthScore`. */
export const PEER_CHECK_IDS = ['price_vs_peers', 'title_vs_peers', 'photos_vs_peers', 'tags_vs_peers'] as const;
export type PeerCheckId = (typeof PEER_CHECK_IDS)[number];

export const ETSY_ISSUE_IDS = Object.keys(ETSY_IMPACT) as (keyof typeof ETSY_IMPACT)[];
export const EBAY_ISSUE_IDS = Object.keys(EBAY_IMPACT) as (keyof typeof EBAY_IMPACT)[];

/** Every check id the "Issue" filter and the "Biggest issue" cell can carry. */
export const DOCTOR_ISSUE_IDS: readonly string[] = Array.from(new Set<string>([...ETSY_ISSUE_IDS, ...EBAY_ISSUE_IDS, ...PEER_CHECK_IDS]));

/**
 * Issue filter options per marketplace: the listing checks the server can filter on (`issue=` matches the
 * scorer's failing checks). Peer checks are computed per listing on open, so they are not filter options.
 */
export function issueIdsFor(mkt: DoctorMkt): string[] {
  return mkt === 'etsy' ? [...ETSY_ISSUE_IDS] : [...EBAY_ISSUE_IDS];
}

/** i18n key of the short issue label ("Too few photos"); one key per check id, no params required. */
export function issueLabelKey(checkId: string): string {
  return `research.doc.issue.${checkId}`;
}

// ─── URL state (research §2.1) ──────────────────────────────────────────────

export const DOCTOR_PAGE_SIZES = [50, 100, 250] as const;

/** `?mkt=` is owned by ResearchLayout (`useResearchMkt('listings')`); this schema holds the tool's own keys. */
export const DOCTOR_URL_SCHEMA = {
  shop: urlField.string(undefined, { maxLength: 64 }),
  q: urlField.string(undefined, { maxLength: 200 }),
  sort: urlField.enum(DOCTOR_SORTS, 'opportunity'),
  'f.issue': urlField.optionalEnum(DOCTOR_ISSUE_IDS),
  'f.health': urlField.optionalEnum(DOCTOR_HEALTH_BANDS),
  open: urlField.string(undefined, { maxLength: 64 }),
  page: urlField.int(1, { min: 1 }),
  size: urlField.int(50, { allowed: DOCTOR_PAGE_SIZES }),
};

export type DoctorUrlState = UrlStateOf<typeof DOCTOR_URL_SCHEMA>;

/** True when a user filter (not sort/page) narrows the list. */
export function hasDoctorFilters(url: Pick<DoctorUrlState, 'q' | 'f.issue' | 'f.health'>): boolean {
  return Boolean(url.q || url['f.issue'] || url['f.health']);
}

// ─── Fix routing (ScorePanel `onFix`) ───────────────────────────────────────

/**
 * What a fix button does in the Doctor panel:
 * - `price`  → "Set price…" popover (MoneyField prefilled with the peer median) → proposal
 * - `title`  → "Suggest a title" FieldSuggestion inline (AI, 1 credit) → proposal
 * - `tags`   → Keyword explorer for this listing (R2 panel; a new tab until R2)
 * - `photos` → Photo studio (`features.bulkPhotoStudio`) or the editor `#photos`
 * - `editor` → the full editor at the check's field
 */
export type FixKind = 'price' | 'title' | 'tags' | 'photos' | 'editor';

export function fixKindFor(check: Pick<Check, 'id' | 'fix'>): FixKind {
  switch (check.id) {
    case 'price_vs_peers':
    case 'price_market':
      return 'price';
    case 'title_vs_peers':
    case 'title_length':
    case 'title_format':
      return 'title';
    case 'tags_vs_peers':
    case 'tags_count':
    case 'tags_quality':
      return 'tags';
    case 'photos_vs_peers':
    case 'photos_count':
    case 'photos_alt':
    case 'video':
      return 'photos';
    default:
      return 'editor';
  }
}

/** Editor anchor for a check (`#photos`, `#tags`, …). */
export function editorFieldFor(check: Pick<Check, 'id' | 'fix'>): string | undefined {
  if (check.fix?.field) return check.fix.field;
  switch (fixKindFor(check)) {
    case 'price':
      return 'price';
    case 'title':
      return 'title';
    case 'tags':
      return 'tags';
    case 'photos':
      return 'photos';
    default:
      return check.id === 'description' ? 'description' : undefined;
  }
}

/** Fix button label for a check (peer checks have no scorer fix label; research §7.1 wording). */
export function fixLabelKeyFor(check: Pick<Check, 'id' | 'fix'>): string {
  if (check.fix?.label) return check.fix.label;
  switch (fixKindFor(check)) {
    case 'price':
      return 'research.doc.fix.setPrice';
    case 'title':
      return 'research.doc.fix.suggestTitle';
    case 'tags':
      return 'listingScore.fix.getTagIdeas';
    case 'photos':
      return 'research.action.openPhotoStudio';
    default:
      return 'research.doc.fix.openEditor';
  }
}

// ─── Score result for the panel ─────────────────────────────────────────────

/**
 * Builds the panel's ScoreResult. Preferred source: the peers endpoint's `checks` (listing checks from
 * `lib/listingScore` + `group: 'peers'` checks). When the server returned no listing checks (eBay, budget
 * fallback, older server), the listing part falls back to the row's stored health: one `fail` per
 * `healthFails` token with its short issue label, and the stored score / denominators.
 */
export function buildDoctorScore(listing: Pick<ListingRow, 'health'>, serverChecks: Check[] | null | undefined): {
  result: ScoreResult;
  fromServer: boolean;
} {
  const checks = (serverChecks ?? []).map((c) => {
    const isPeer = c.group === 'peers' || (PEER_CHECK_IDS as readonly string[]).includes(c.id);
    // Every non-passing check gets a fix button (peer checks carry none from the scorer).
    const fix = c.fix ?? { label: fixLabelKeyFor(c), field: editorFieldFor(c) };
    return { ...c, fix, ...(isPeer ? { group: 'peers' as const } : {}) };
  });
  const listingChecks = checks.filter((c) => (c.group ?? 'listing') === 'listing');
  if (listingChecks.length > 0) return { result: finalizeScore(checks), fromServer: true };
  const peers = checks.filter((c) => c.group === 'peers').map((c) => ({ ...c, gain: 0 }));
  return { result: healthFallbackResult(listing.health, peers), fromServer: false };
}

/** Fallback ScoreResult from the stored health columns (no params, no gains). */
export function healthFallbackResult(health: ListingHealth, peers: Check[] = []): ScoreResult {
  const fails: Check[] = health.fails
    .filter((id) => id !== 'title_short')
    .map((id) => ({
      id,
      label: issueLabelKey(id),
      status: 'fail' as const,
      impact: 0,
      gain: 0,
      fix: { label: fixLabelKeyFor({ id }), field: editorFieldFor({ id }) },
    }));
  const score = health.score ?? 0;
  const used = health.score === null ? 0 : health.used;
  return {
    score,
    band: score >= 90 ? 'great' : score >= 75 ? 'good' : score >= 50 ? 'fair' : 'needs_work',
    checksUsed: used,
    checksTotal: health.total,
    checks: [...fails, ...peers],
  };
}

// ─── Proposals ("Staged here") ──────────────────────────────────────────────

export type DoctorProposal =
  | { field: 'price'; checkId: string; from: number | null; to: number; currency: string }
  | { field: 'title'; checkId: string; from: string; to: string }
  | { field: 'tags'; checkId: string; from: string[]; to: string[] };

/** One proposal per field: a newer proposal for the same field replaces the older one. */
export function upsertProposal(list: DoctorProposal[], p: DoctorProposal): DoctorProposal[] {
  return [...list.filter((x) => x.field !== p.field), p];
}

export function removeProposal(list: DoctorProposal[], field: DoctorProposal['field']): DoctorProposal[] {
  return list.filter((x) => x.field !== field);
}

/** The draft patch for one listing (one `stageEtsyDraft` / `stageEbayDraft` per listing). */
export function proposalsToPatch(list: DoctorProposal[]): StagePatch {
  const patch: StagePatch = {};
  for (const p of list) {
    if (p.field === 'price') patch.price = round2(p.to);
    else if (p.field === 'title') patch.title = p.to;
    else patch.tags = p.to;
  }
  return patch;
}

/** Variation listings change prices in the editor (research §3.4). */
export function priceProposalBlocked(listing: Pick<ListingRow, 'editable'>): boolean {
  return !listing.editable.price;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Peer price summary usable for a suggestion: enough sample and a median (never a mean). */
export function usablePeerMedian(price: Pick<PriceSummary, 'median' | 'quality' | 'currency'> | null | undefined): number | null {
  if (!price || price.median == null || !Number.isFinite(price.median)) return null;
  if (price.quality === 'insufficient' || price.quality === 'implausible') return null;
  return round2(price.median);
}

/**
 * Bulk "Apply suggested prices": the peer median for a listing whose price check FAILS (a `warn` is left for
 * per-listing review in the panel — research §7), when the listing's price is editable (no variations) and in the peers' currency. Null = skip the listing.
 */
export function suggestedPriceProposal(
  listing: Pick<ListingRow, 'price' | 'editable'>,
  peers: { price: Pick<PriceSummary, 'median' | 'quality' | 'currency'> | null } | null | undefined,
  checks: Pick<Check, 'id' | 'status'>[] | null | undefined,
): DoctorProposal | null {
  if (priceProposalBlocked(listing) || !listing.price) return null;
  const failing = (checks ?? []).some((c) => (c.id === 'price_vs_peers' || c.id === 'price_market') && c.status === 'fail');
  if (!failing) return null;
  const median = usablePeerMedian(peers?.price ?? null);
  if (median == null || median <= 0) return null;
  const peerCurrency = (peers?.price?.currency ?? '').toUpperCase();
  if (peerCurrency && peerCurrency !== listing.price.currency.toUpperCase()) return null;
  if (round2(listing.price.amount) === median) return null;
  return { field: 'price', checkId: 'price_vs_peers', from: listing.price.amount, to: median, currency: listing.price.currency };
}

/** Cleans an AI title: string only, one line, no surrounding quotes, ≤ max chars. Null = unusable. */
export function cleanAiTitle(raw: unknown, max = 140): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (t.length < 10 || t.length > max) return null;
  return t;
}

// ─── Links ──────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

/** Listings page "Not sent" view, where the send primary picks the staged change up. */
export function notSentHref(mkt: DoctorMkt, shop: string | null | undefined): string {
  const base = mkt === 'etsy' ? '/app/etsy-listings' : '/app/ebay-listings';
  return shop && mkt === 'etsy' ? `${base}?shop=${enc(shop)}&view=not_sent` : `${base}?view=not_sent`;
}

/** The full editor (listing-editor §1), optionally scrolled to a field (`#field`). */
export function editorHref(mkt: DoctorMkt, id: string, shop: string | null | undefined, field?: string): string {
  const hash = field ? `#${field}` : '';
  if (mkt === 'etsy') return `/app/etsy-listings/${enc(id)}${shop ? `?shop=${enc(shop)}` : ''}${hash}`;
  return `/app/ebay-listings/${enc(id)}${hash}`;
}

/** Keyword explorer for one listing (R2 panel; a new tab until R2 ships). */
export function keywordExplorerHref(mkt: DoctorMkt, id: string, shop: string | null | undefined): string {
  return `/app/research/keywords?listing=${enc(id)}${shop ? `&shop=${enc(shop)}` : ''}&mkt=${mkt}`;
}

/** Photo studio (Pro, `features.bulkPhotoStudio`) or the editor `#photos` (pro-gating §4). */
export function photoFixHref(mkt: DoctorMkt, id: string, shop: string | null | undefined, opts: { photoStudio: boolean }): string {
  if (mkt === 'etsy' && opts.photoStudio) return `/app/etsy-listings/photos?ids=${enc(id)}${shop ? `&shop=${enc(shop)}` : ''}`;
  return editorHref(mkt, id, shop, 'photos');
}

/** BulkGrid (M7) with the selection. */
export function bulkGridHref(mkt: DoctorMkt, ids: string[], shop: string | null | undefined): string {
  const base = mkt === 'etsy' ? '/app/etsy-listings/bulk' : '/app/ebay-listings/bulk';
  const q = new URLSearchParams();
  if (shop && mkt === 'etsy') q.set('shop', shop);
  q.set('ids', ids.join(','));
  return `${base}?${q.toString()}`;
}

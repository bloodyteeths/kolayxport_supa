// lib/listingScore/types.ts: one listing-health contract for every marketplace (DESIGN_SYSTEM §3.10).
// Pure types + helpers, no React, safe on the server and the client.

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';
export type ScoreBand = 'needs_work' | 'fair' | 'good' | 'great';
export type ScoreMarketplace = 'etsy' | 'ebay' | 'trendyol' | 'wix' | 'shopify' | 'amazon';

/** i18n params; numbers are formatted by ICU in the message. */
export type CheckParams = Record<string, string | number>;

export interface CheckFix {
  /** i18n key (full path from the root, e.g. `listingScore.fix.addPhotos`). */
  label: string;
  /** Field id to scroll to and focus (editor `SectionNav.scrollTo`). */
  field?: string;
  /** Action id that STAGES a proposal (never pushes to the marketplace), e.g. `ai_title`. */
  action?: string;
}

export interface Check {
  id: string;
  /** i18n key (full path from the root). Rendered with `params`. */
  label: string;
  params?: CheckParams;
  status: CheckStatus;
  /** Weight in points; the impacts of one scorer sum to 100. */
  impact: number;
  /** Points the overall score gains when this check passes (0 for pass and na). Filled by `finalizeScore`. */
  gain?: number;
  /** `peers` = research-only context checks (Listing doctor), never part of the stored score. */
  group?: 'listing' | 'peers';
  /** i18n key explaining why a check is `na` (missing data). */
  naReason?: string;
  fix?: CheckFix;
}

export interface ScoreResult {
  /** Integer 0–100. 0 with `checksUsed === 0` means "not enough data to score". */
  score: number;
  band: ScoreBand;
  /** Checks that counted (status !== 'na', group !== 'peers'). */
  checksUsed: number;
  /** All listing checks (group !== 'peers'), including `na`. */
  checksTotal: number;
  checks: Check[];
}

/** Bands: 0–49 needs work · 50–74 fair · 75–89 good · 90–100 great (DS §3.10). */
export function bandFor(score: number): ScoreBand {
  if (score >= 90) return 'great';
  if (score >= 75) return 'good';
  if (score >= 50) return 'fair';
  return 'needs_work';
}

export const BAND_TONE: Record<ScoreBand, 'danger' | 'warning' | 'success'> = {
  needs_work: 'danger',
  fair: 'warning',
  good: 'success',
  great: 'success',
};

export const STATUS_CREDIT: Record<Exclude<CheckStatus, 'na'>, number> = { pass: 1, warn: 0.5, fail: 0 };

/** Trendyol letter grades → 0–100 (DS §3.10). Letters are never shown. */
export const TRENDYOL_GRADE_SCORE: Record<string, number> = {
  'A+': 97, A: 93, 'B+': 87, B: 83, 'C+': 77, C: 73, D: 60, F: 40,
};

/**
 * Computes score, band, denominator and per-check `gain` from a list of checks.
 * `na` checks and `peers` checks leave the denominator.
 */
export function finalizeScore(checks: Check[]): ScoreResult {
  const listing = checks.filter((c) => (c.group ?? 'listing') === 'listing');
  const used = listing.filter((c) => c.status !== 'na');
  const usedImpact = used.reduce((s, c) => s + c.impact, 0);
  const earned = used.reduce((s, c) => s + c.impact * STATUS_CREDIT[c.status as Exclude<CheckStatus, 'na'>], 0);
  const score = usedImpact > 0 ? Math.max(0, Math.min(100, Math.round((earned / usedImpact) * 100))) : 0;
  const withGain = checks.map((c) => {
    if (c.status === 'na' || c.status === 'pass' || (c.group ?? 'listing') !== 'listing' || usedImpact === 0) {
      return { ...c, gain: 0 };
    }
    const credit = STATUS_CREDIT[c.status];
    return { ...c, gain: Math.round(((c.impact * (1 - credit)) / usedImpact) * 100) };
  });
  return { score, band: bandFor(score), checksUsed: used.length, checksTotal: listing.length, checks: withGain };
}

/** Panel order: failing/warning by gain (desc), then passes, then `na`. Stable within a status. */
export function sortChecks(checks: Check[]): Check[] {
  const rank = (c: Check) => (c.status === 'fail' || c.status === 'warn' ? 0 : c.status === 'pass' ? 1 : 2);
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (b.c.gain ?? 0) - (a.c.gain ?? 0) || b.c.impact - a.c.impact || a.i - b.i)
    .map((x) => x.c);
}

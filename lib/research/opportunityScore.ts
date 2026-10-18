/**
 * Opportunity score (0–100) for a Product finder result — the one number the answer card leads with.
 *
 * Built only from what the search measured (no invented search volume, research redesign §6 honesty guards), so it
 * is a *signal*, labelled as such:
 *   demand        40 %  Demand Signal tier 1–5 (Google Trends, autocomplete presence, favorites velocity)
 *   competition   25 %  listings matching the query, log scale: ≤ 500 → best, 500 k → worst
 *   newcomers     20 %  share of top-48 shops opened < 1 year ago (new sellers can still rank) — 40 %+ is best
 *   concentration 15 %  share of the top 48 held by the 5 biggest shops (low = the niche is not owned by a few)
 * Missing inputs drop out and the weights renormalise; demand plus one other input are required.
 *
 * Pure, client- and server-safe.
 */
import type { ProductsResult } from './types';

export type OpportunityBand = 'good' | 'ok' | 'hard';
export type Level = 'high' | 'medium' | 'low';

export interface OpportunityPart {
  key: 'demand' | 'competition' | 'newcomers' | 'concentration';
  /** 0–1, higher = better for a new seller. */
  value: number;
  weight: number;
}

export interface Opportunity {
  /** 0–100, null when there is not enough signal. */
  score: number | null;
  band: OpportunityBand | null;
  parts: OpportunityPart[];
  /** Plain levels for the verdict sentence and tiles. */
  demand: Level | null;
  competition: Level | null;
  newcomersOk: boolean | null;
  /** Top 5 shops hold ≥ 50 % of the top 48. */
  dominated: boolean | null;
  kind: 'signal';
}

const WEIGHTS = { demand: 0.4, competition: 0.25, newcomers: 0.2, concentration: 0.15 } as const;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Listings count → 0–1 (log scale). 500 → 1, 5 000 → 0.67, 50 000 → 0.33, 500 000+ → 0.05. */
export function competitionValue(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return clamp(1 - (Math.log10(total) - Math.log10(500)) / 3, 0.05, 1);
}

export function competitionLevel(total: number): Level {
  if (total < 3_000) return 'low';
  if (total < 30_000) return 'medium';
  return 'high';
}

export function demandLevel(tier: number | null): Level | null {
  if (tier == null) return null;
  if (tier >= 4) return 'high';
  if (tier === 3) return 'medium';
  return 'low';
}

export function opportunityOf(r: Pick<ProductsResult, 'demand' | 'competition' | 'newcomers'>): Opportunity {
  const parts: OpportunityPart[] = [];
  const tier = r.demand?.tier ?? null;
  if (tier != null) parts.push({ key: 'demand', value: (tier - 1) / 4, weight: WEIGHTS.demand });

  const total = r.competition?.total?.guard?.ok ? r.competition.total.value : null;
  if (total != null) parts.push({ key: 'competition', value: competitionValue(total), weight: WEIGHTS.competition });

  const newcomers = r.newcomers?.guard?.ok ? r.newcomers.value : null;
  if (newcomers != null) parts.push({ key: 'newcomers', value: clamp(newcomers / 0.4), weight: WEIGHTS.newcomers });

  const top5 = r.competition?.top5Share?.guard?.ok ? r.competition.top5Share.value : null;
  if (top5 != null) parts.push({ key: 'concentration', value: clamp(1 - top5), weight: WEIGHTS.concentration });

  const enough = tier != null && parts.length >= 2;
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  const score = enough && weightSum > 0 ? Math.round((parts.reduce((s, p) => s + p.value * p.weight, 0) / weightSum) * 100) : null;
  return {
    score,
    band: score == null ? null : score >= 70 ? 'good' : score >= 45 ? 'ok' : 'hard',
    parts,
    demand: demandLevel(tier),
    competition: total == null ? null : competitionLevel(total),
    newcomersOk: newcomers == null ? null : newcomers >= 0.25,
    dominated: top5 == null ? null : top5 >= 0.5,
    kind: 'signal',
  };
}

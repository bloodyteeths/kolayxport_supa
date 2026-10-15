// Home smart search (research.md §4.3). Detection and routing are R1-A's pure `detectQuery` / `routeForQuery`
// (lib/research/detectQuery.ts); this file adds what the pure module leaves to the UI: the own-listing check for a
// pasted Etsy listing link (async, DB cache via the listings export endpoint). Every tool is on the hub.
import { QUESTION_CHIPS, detectQuery, routeForQuery, type QuestionChip } from '@/lib/research/detectQuery';
import type { ResearchMkt } from '@/lib/research/types';

export type QuestionKey = QuestionChip;
export const QUESTION_KEYS: readonly QuestionKey[] = QUESTION_CHIPS;

export type RouteContext = {
  mkt: ResearchMkt;
  question?: QuestionKey;
  /** Whether an Etsy listing id belongs to the viewer's own shop (own → Listing doctor, else Product finder). */
  isOwnEtsyListing?: (id: string) => Promise<boolean>;
};

/** §4.3 routing. Returns the href to push. */
export async function routeResearchSearch(input: string, ctx: RouteContext): Promise<string> {
  const d = detectQuery(input);
  let own = false;
  if (d.kind === 'etsyListing' && ctx.isOwnEtsyListing) own = await ctx.isOwnEtsyListing(d.listingId).catch(() => false);
  return routeForQuery(input, { mkt: ctx.mkt, chip: ctx.question ?? null, isOwnListing: () => own });
}

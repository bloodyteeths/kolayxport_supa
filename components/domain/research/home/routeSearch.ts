// Home smart search (research.md §4.3). Detection and routing are R1-A's pure `detectQuery` / `routeForQuery`
// (lib/research/detectQuery.ts); this file adds the two things the pure module leaves to the UI:
//   1. the own-listing check for a pasted Etsy listing link (async, DB cache via the listings export endpoint);
//   2. tools that have not shipped on the hub yet (Keyword explorer R2, Shop tracker R3) go to their legacy page.
import { QUESTION_CHIPS, detectQuery, routeForQuery, type QuestionChip } from '@/lib/research/detectQuery';
import { isResearchMkt, type ResearchMkt } from '@/lib/research/types';
import { RESEARCH_TOOL_PATH, RESEARCH_TOOL_SHIPPED, researchToolHref, type ResearchTab } from '../ResearchLayout';

export type QuestionKey = QuestionChip;
export const QUESTION_KEYS: readonly QuestionKey[] = QUESTION_CHIPS;

const PATH_TOOL = new Map<string, ResearchTab>(Object.entries(RESEARCH_TOOL_PATH).map(([tool, path]) => [path, tool as ResearchTab]));

/** Pure: a hub href whose tool has not shipped → that tool's legacy page (same marketplace). */
export function toShippedHref(href: string, fallbackMkt: ResearchMkt): string {
  const [path, query = ''] = href.split('#')[0].split('?');
  const tool = PATH_TOOL.get(path);
  if (!tool || RESEARCH_TOOL_SHIPPED[tool]) return href;
  const m = new URLSearchParams(query).get('mkt');
  return researchToolHref(tool, isResearchMkt(m) ? m : fallbackMkt);
}

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
  const href = routeForQuery(input, { mkt: ctx.mkt, chip: ctx.question ?? null, isOwnListing: () => own });
  return toShippedHref(href, ctx.mkt);
}

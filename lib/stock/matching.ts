/**
 * SKU matching for the setup wizard (W2, T11). Pure — unit tested.
 *
 *  - Exact groups: candidates grouped by normalizeSku(sku). One-tap confirm
 *    unless the group needs review.
 *  - The same SKU on several listings of ONE channel is a shared pool (several
 *    links to one item). It is a conflict only when their quantities differ
 *    (then the seed must be entered manually).
 *  - Needs review: any quantity 0, any >= 100, or max/min > 5. Those groups
 *    are excluded from one-tap confirm and default to a manual seed.
 *  - Loose suggestions (foldSkuLoose: Turkish letters folded, -_./ stripped)
 *    and title-token suggestions are NEVER auto-linked.
 */
import { foldSkuLoose, normalizeSku } from './normalize';
import { groupNeedsReview } from './math';

export type RemoteCandidate = {
  channel: string;
  accountRef: string;
  accountLabel?: string | null;
  externalId: string;
  variantRef: string;
  variantValueKey?: string | null;
  sku: string | null;
  title: string | null;
  variantLabel?: string | null;
  imageUrl?: string | null;
  quantity: number;
  state?: string | null;
  supportsWrite: boolean;
  unsupportedReason?: string | null;
};

export type MatchGroup = {
  sku: string;
  displaySku: string;
  members: RemoteCandidate[];
  channels: string[];
  multiChannel: boolean;
  sharedPoolChannels: string[];
  conflict: boolean;
  needsReview: boolean;
  reviewReasons: string[];
};

export type LooseSuggestion = { key: string; skus: string[]; members: RemoteCandidate[] };
export type TitleSuggestion = { candidate: RemoteCandidate; matches: Array<{ candidate: RemoteCandidate; score: number }> };

export function candidateKey(c: Pick<RemoteCandidate, 'channel' | 'accountRef' | 'externalId' | 'variantRef'>): string {
  return `${c.channel}|${c.accountRef}|${c.externalId}|${c.variantRef}`;
}

export function reviewReasonsFor(members: Array<Pick<RemoteCandidate, 'quantity' | 'channel'>>): string[] {
  const q = members.map((m) => Math.trunc(Number(m.quantity) || 0));
  const reasons: string[] = [];
  if (q.some((n) => n <= 0)) reasons.push('zero');
  if (q.some((n) => n >= 100)) reasons.push('high');
  const pos = q.filter((n) => n > 0);
  if (pos.length && Math.max(...pos) / Math.min(...pos) > 5) reasons.push('ratio');
  if (!reasons.length && groupNeedsReview(q)) reasons.push('ratio');
  return reasons;
}

export function buildMatchSuggestions(
  candidates: RemoteCandidate[],
  opts: { linkedKeys?: ReadonlySet<string> } = {},
): { groups: MatchGroup[]; unmatched: RemoteCandidate[]; loose: LooseSuggestion[]; titles: TitleSuggestion[] } {
  const linked = opts.linkedKeys ?? new Set<string>();
  const open = candidates.filter((c) => !linked.has(candidateKey(c)));

  const bySku = new Map<string, RemoteCandidate[]>();
  const noSku: RemoteCandidate[] = [];
  for (const c of open) {
    const n = normalizeSku(c.sku);
    if (!n) {
      noSku.push(c);
      continue;
    }
    const list = bySku.get(n) || [];
    list.push(c);
    bySku.set(n, list);
  }

  const groups: MatchGroup[] = [];
  for (const [sku, members] of Array.from(bySku.entries())) {
    const channels = Array.from(new Set(members.map((m) => m.channel))).sort();
    const perChannel = new Map<string, RemoteCandidate[]>();
    for (const m of members) perChannel.set(m.channel, [...(perChannel.get(m.channel) || []), m]);
    const sharedPoolChannels = Array.from(perChannel.entries()).filter(([, l]) => l.length > 1).map(([ch]) => ch).sort();
    const conflict = sharedPoolChannels.some((ch) => new Set((perChannel.get(ch) || []).map((m) => m.quantity)).size > 1);
    const reviewReasons = reviewReasonsFor(members);
    if (conflict) reviewReasons.push('shared_pool_conflict');
    const group: MatchGroup = {
      sku,
      displaySku: String(members[0].sku || sku).trim(),
      members,
      channels,
      multiChannel: channels.length > 1,
      sharedPoolChannels,
      conflict,
      needsReview: reviewReasons.length > 0,
      reviewReasons,
    };
    groups.push(group);
  }
  groups.sort((a, b) => Number(b.multiChannel) - Number(a.multiChannel) || a.sku.localeCompare(b.sku));

  // Loose suggestions: distinct normalized SKUs whose loose fold collides.
  const byLoose = new Map<string, Set<string>>();
  for (const sku of Array.from(bySku.keys())) {
    const lk = foldSkuLoose(sku);
    if (!lk) continue;
    byLoose.set(lk, new Set([...Array.from(byLoose.get(lk) || []), sku]));
  }
  const loose: LooseSuggestion[] = [];
  for (const [key, skus] of Array.from(byLoose.entries())) {
    if (skus.size < 2) continue;
    const list = Array.from(skus).sort();
    loose.push({ key, skus: list, members: list.flatMap((s) => bySku.get(s) || []) });
  }

  // Title-token suggestions for Etsy offerings without a SKU.
  const titleTargets = open.filter((c) => (c.channel === 'trendyol' || c.channel === 'shopify') && c.title);
  const titles: TitleSuggestion[] = [];
  for (const c of noSku) {
    if (c.channel !== 'etsy' || !c.title) continue;
    const tokens = titleTokens(c.title);
    const matches = titleTargets
      .map((t) => ({ candidate: t, score: jaccard(tokens, titleTokens(t.title)) }))
      .filter((m) => m.score >= 0.4)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3);
    if (matches.length) titles.push({ candidate: c, matches });
  }

  return { groups, unmatched: noSku, loose, titles };
}

const STOP = new Set(['THE', 'AND', 'FOR', 'WITH', 'VE', 'ILE', 'BIR', 'IÇIN', 'ICIN', 'GIFT', 'HEDIYE', 'SET', 'OF', 'A', 'AN']);

export function titleTokens(title: string | null | undefined): Set<string> {
  const n = normalizeSku(title || '') || '';
  const folded = n.replace(/[ŞĞÇÖÜ]/g, (ch) => ({ 'Ş': 'S', 'Ğ': 'G', 'Ç': 'C', 'Ö': 'O', 'Ü': 'U' } as Record<string, string>)[ch] || ch);
  return new Set(
    folded
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of Array.from(a)) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

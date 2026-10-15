// lib/research/peers.ts — Listing doctor "Compared with peers" (research.md §7.1, §10; RR §6.3–§6.4). Pure.
//
// Peer checks are research context: `group: 'peers'`, so `finalizeScore` keeps them out of the stored
// health score. Every check is `na` when fewer than PEER_MIN listings were compared. Price is compared only
// in one currency (the listing's), after FX normalization (RR §6.4).

import { contentWords, stemWord, tagKey } from '@/lib/etsy/seoRules';
import type { Check } from '@/lib/listingScore/types';
import { summarizePrices, type FxTable, type PriceSummary } from './stats';
import { buyerWords } from './etsySearch';
import type { EtsyListingDetail, EtsySearchItem } from './etsySearch';
import type { Guarded, MainKeyword, PeersBlock } from './types';

/** research.md §7.1: peer checks are `na` when peers n < 20. */
export const PEER_MIN = 20;
export const PEER_IMPACT = { price_vs_peers: 7, title_vs_peers: 12, photos_vs_peers: 14, tags_vs_peers: 8 } as const;
export type PeerCheckId = keyof typeof PEER_IMPACT;

const K = 'research.doc.check';
const FIX = 'research.doc.fix';

export interface OwnListingForPeers {
  id: string;
  title: string;
  tags: string[];
  price: number | null;
  currency: string;
  imageCount: number | null;
  hasVideo: boolean | null;
}

const ok = (value: number, kind: Guarded<number>['kind'] = 'measured'): Guarded<number> => ({ value, kind, guard: { ok: true } });
const no = (reasonKey: string, reasonParams?: Record<string, string | number>): Guarded<number> =>
  ({ value: null, kind: 'measured', guard: { ok: false, reasonKey, ...(reasonParams ? { reasonParams } : {}) } });

function medianOf(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

function smallSample(n: number): Guarded<number> | null {
  return n < PEER_MIN ? no('research.guard.small', { n }) : null;
}

/** Peer listings: the search results minus the user's own listing, top 48. */
export function selectPeers(items: EtsySearchItem[], ownId: string, max = 48): EtsySearchItem[] {
  return items.filter((i) => i.listingId !== String(ownId)).slice(0, max);
}

/**
 * Main keyword when nothing is tracked: the title's lead phrase (before the first comma), at most 4 content
 * words. Deterministic stand-in for the AI pick (research.md §7.4), labelled `source: 'title'`.
 */
export function mainKeywordFromTitle(title: string): string {
  const lead = String(title || '').split(/[,|–—-]/)[0] || '';
  const words = contentWords(lead).slice(0, 4);
  return words.join(' ') || String(title || '').trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
}

/** Best tracked keyword (lowest rank, null last) or the title fallback. */
export function pickMainKeyword(title: string, tracked: Array<{ keyword: string; rank: number | null }>): MainKeyword {
  const best = [...tracked].sort((a, b) => (a.rank ?? 10_000) - (b.rank ?? 10_000))[0];
  if (best) return { keyword: best.keyword, source: 'tracked', rank: best.rank };
  return { keyword: mainKeywordFromTitle(title), source: 'title', rank: null };
}

export function computePeers(
  peers: EtsySearchItem[],
  details: Record<string, Pick<EtsyListingDetail, 'imageCount' | 'hasVideo' | 'freeShipping'>>,
  opts: { currency: string; fx?: FxTable },
): PeersBlock {
  const n = peers.length;
  const price: PriceSummary = summarizePrices(peers.map((p) => ({ amount: p.price, currency: p.currency })), { currency: opts.currency, fx: opts.fx });

  const titleMedian = medianOf(peers.map((p) => p.title.length));
  const titleLen = smallSample(n) ?? (titleMedian == null ? no('research.guard.insufficient') : ok(Math.round(titleMedian)));

  const withImages = peers.map((p) => details[p.listingId]?.imageCount).filter((v): v is number => typeof v === 'number');
  const photosMedian = medianOf(withImages);
  const photos = smallSample(withImages.length) ?? (photosMedian == null ? no('research.guard.insufficient') : ok(Math.round(photosMedian)));

  const videoKnown = peers.map((p) => details[p.listingId]?.hasVideo).filter((v): v is boolean => typeof v === 'boolean');
  const videoShare = smallSample(videoKnown.length) ?? ok(Math.round((videoKnown.filter(Boolean).length / videoKnown.length) * 1000) / 1000);

  const shipKnown = peers.map((p) => details[p.listingId]?.freeShipping).filter((v): v is boolean => typeof v === 'boolean');
  const freeShippingShare = smallSample(shipKnown.length) ?? ok(Math.round((shipKnown.filter(Boolean).length / shipKnown.length) * 1000) / 1000);

  return { n, price, titleLen, photos, videoShare, freeShippingShare, topTags: buyerWords(peers, 30) };
}

const naCheck = (id: PeerCheckId, label: string, naReason: string, params?: Record<string, string | number>): Check =>
  ({ id, label, status: 'na', impact: PEER_IMPACT[id], group: 'peers', naReason, ...(params ? { params } : {}) });

/**
 * Up to four research-only checks (research.md §7.1). Statuses:
 * - price: inside p25–p75 pass; outside warn; more than 25 % beyond the band fail.
 * - title: ≥ 80 % of the peer median pass; ≥ 60 % warn; else fail.
 * - photos: ≥ peer median pass; within 2 warn; else fail (video share in params).
 * - tags: own tags found among the 30 most used peer tags: ≥ 5 pass, 2–4 warn, else fail.
 */
export function peerChecks(own: OwnListingForPeers, peers: PeersBlock, money: (v: number, c: string) => string, percent: (v: number) => string): Check[] {
  const out: Check[] = [];
  const tooFew = peers.n < PEER_MIN;
  const reason = 'research.doc.peersTooFew';

  // Price
  const p = peers.price;
  if (tooFew || p.quality !== 'ok' || p.median == null || p.p25 == null || p.p75 == null) {
    out.push(naCheck('price_vs_peers', `${K}.priceVsPeers`, tooFew ? reason : 'research.guard.insufficient'));
  } else if (own.price == null || own.currency.toUpperCase() !== p.currency.toUpperCase()) {
    out.push(naCheck('price_vs_peers', `${K}.priceVsPeers`, 'research.doc.currencyMismatch'));
  } else {
    const above = own.price > p.p75;
    const below = own.price < p.p25;
    const far = own.price > p.p75 * 1.25 || own.price < p.p25 * 0.75;
    out.push({
      id: 'price_vs_peers', label: `${K}.priceVsPeers`, group: 'peers', impact: PEER_IMPACT.price_vs_peers,
      status: !above && !below ? 'pass' : far ? 'fail' : 'warn',
      params: { price: money(own.price, own.currency), median: money(p.median, p.currency), p75: money(p.p75, p.currency), p25: money(p.p25, p.currency) },
      fix: { label: `${FIX}.setPrice`, field: 'price', action: 'set_price' },
    });
  }

  // Title length
  const tl = peers.titleLen;
  if (!tl.guard.ok || tl.value == null) {
    out.push(naCheck('title_vs_peers', `${K}.titleVsPeers`, tooFew ? reason : 'research.guard.insufficient'));
  } else {
    const len = own.title.trim().length;
    const ratio = tl.value > 0 ? len / tl.value : 1;
    out.push({
      id: 'title_vs_peers', label: `${K}.titleVsPeers`, group: 'peers', impact: PEER_IMPACT.title_vs_peers,
      status: ratio >= 0.8 ? 'pass' : ratio >= 0.6 ? 'warn' : 'fail',
      params: { len, median: tl.value },
      fix: { label: `${FIX}.suggestTitle`, field: 'title', action: 'ai_title' },
    });
  }

  // Photos (+ video share as context)
  const ph = peers.photos;
  if (!ph.guard.ok || ph.value == null || own.imageCount == null) {
    out.push(naCheck('photos_vs_peers', `${K}.photosVsPeers`, !ph.guard.ok || ph.value == null ? (tooFew ? reason : 'research.doc.peerPhotosUnknown') : 'research.guard.insufficient'));
  } else {
    const params: Record<string, string | number> = { count: own.imageCount, median: ph.value };
    if (peers.videoShare.guard.ok && peers.videoShare.value != null) params.videoShare = percent(peers.videoShare.value);
    out.push({
      id: 'photos_vs_peers', label: `${K}.photosVsPeers`, group: 'peers', impact: PEER_IMPACT.photos_vs_peers,
      status: own.imageCount >= ph.value ? 'pass' : own.imageCount >= ph.value - 2 ? 'warn' : 'fail',
      params,
      fix: { label: 'research.action.openPhotoStudio', field: 'photos', action: 'photo_studio' },
    });
  }

  // Tags shared with the peers' most used tags
  if (tooFew || peers.topTags.length === 0) {
    out.push(naCheck('tags_vs_peers', `${K}.tagsVsPeers`, tooFew ? reason : 'research.guard.insufficient'));
  } else {
    const peerKeys = new Set(peers.topTags.map((t) => tagKey(t.tag) || t.tag));
    const peerStems = new Set(peers.topTags.flatMap((t) => contentWords(t.tag).map(stemWord)));
    const matched = own.tags.filter((t) => {
      if (peerKeys.has(tagKey(t) || t)) return true;
      const stems = contentWords(t).map(stemWord);
      return stems.length > 0 && stems.every((w) => peerStems.has(w));
    }).length;
    out.push({
      id: 'tags_vs_peers', label: `${K}.tagsVsPeers`, group: 'peers', impact: PEER_IMPACT.tags_vs_peers,
      status: matched >= 5 ? 'pass' : matched >= 2 ? 'warn' : 'fail',
      params: { count: matched, total: own.tags.length },
      fix: { label: `${FIX}.tagIdeas`, field: 'tags', action: 'tag_ideas' },
    });
  }
  return out;
}

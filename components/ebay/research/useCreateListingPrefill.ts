import { useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import {
  writeListingPrefill,
  listingPrefillPath,
  sanitizeListingPrefill,
  type ListingPrefillPayload,
} from './listingPrefill';

/** Words worth carrying as keywords from a product title (eBay has no tags; the creator's AI uses these). */
export function keywordsFromTitle(title: string, max = 13): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'new', 'set', 'of', 'in', 'to', 'a', 'an', 'by', 'on']);
  // Built at runtime: the TS target (ES2017) rejects \p{} regex literals.
  const nonWord = new RegExp("[^\\p{L}\\p{N}'&]", 'gu');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (title || '').toLowerCase().split(/[\s,|/()\-–—]+/)) {
    const w = raw.replace(nonWord, '');
    if (w.length < 3 || stop.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Returns a function that hands research data to a listing creator per the
 * prefill contract (sessionStorage 'kx:listingPrefill' + ?prefill=session).
 * Opens the creator only; nothing is published.
 */
export default function useCreateListingPrefill() {
  const router = useRouter();
  const t = useTranslations('ebayResearch');
  return useCallback(
    (payload: Omit<ListingPrefillPayload, 'v'>) => {
      const clean = sanitizeListingPrefill({ ...payload, v: 1 }, payload.target);
      if (!clean || !writeListingPrefill(clean)) {
        toast.error(t('createListingFailed'));
        return;
      }
      router.push(listingPrefillPath(clean.target));
    },
    [router, t],
  );
}

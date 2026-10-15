// Hand-offs the new listings grid (M5) does not read yet, so the route keeps serving the legacy page for them even
// with the `listings-*` flag on. The legacy page hosts the creator that consumes them:
//   - `?prefill=session`  research → creator (components/etsy/research/shared/listingPrefill.ts, sessionStorage
//                         `kx:listingPrefill`; written by the Research hub, the legacy research pages and arbitrage)
//   - `?crosslist=`       Etsy ⇄ eBay "Copy to …" (legacy rows; the new grid's copy waits for the M6 editor)
// Once the M6 editor ships `/app/{mkt}-listings/new?prefill=session`, writers move there and this list shrinks.
type Query = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return typeof v === 'string' ? v : '';
}

/** True when the URL carries a hand-off only the legacy listings page understands. */
export function needsLegacyListingsPage(query: Query): boolean {
  if (first(query.prefill) === 'session') return true;
  if (first(query.crosslist).trim()) return true;
  return false;
}

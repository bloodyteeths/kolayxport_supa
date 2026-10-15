// Hand-offs the listings grid does not read itself: the route wrapper forwards them to the editor's create route.
//   - `?prefill=session`  research → creator (lib/listings/listingPrefill.ts, sessionStorage
//                         `kx:listingPrefill`; written by the Research hub)
//   - `?crosslist=`       Etsy ⇄ eBay "Copy to …": `etsy:<listingId>` → eBay creator, `ebay:<sku>` → Etsy creator
// The new grid and editor link straight to `/app/{mkt}-listings/new?crosslist=…`; old links still land here.
type Query = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return typeof v === 'string' ? v : '';
}

/** `etsy:<listingId>` (digits). */
export const ETSY_CROSSLIST_RE = /^etsy:(\d{1,20})$/;
/** `ebay:<sku>`: up to 50 characters, no control characters (same rule as the catalog creator). */
export const EBAY_CROSSLIST_RE = /^ebay:([^\u0000-\u001f]{1,50})$/;

/** The eBay SKU of a `crosslist=ebay:<sku>` value, else null (pure). */
export function parseEbayCrosslist(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = EBAY_CROSSLIST_RE.exec(raw.trim());
  const sku = m ? m[1].trim() : '';
  return sku || null;
}

/** True when the URL carries a hand-off the route wrapper must forward before mounting the grid. */
export function hasListingsHandoff(query: Query): boolean {
  if (first(query.prefill) === 'session') return true;
  if (first(query.crosslist).trim()) return true;
  return false;
}

/**
 * Where a hand-off goes: the create route, which reads the same `kx:listingPrefill` / `crosslist` contract.
 * `null` → no editor hand-off (unknown or wrong-direction cross-list value, or no hand-off at all); the route then
 * shows the grid and ignores the param.
 */
export function editorHandoffHref(marketplace: 'etsy' | 'ebay', query: Query): string | null {
  const params = new URLSearchParams();
  const shop = first(query.shop).trim();
  if (marketplace === 'etsy' && shop) params.set('shop', shop);
  const cross = first(query.crosslist).trim();
  if (marketplace === 'ebay' && ETSY_CROSSLIST_RE.test(cross)) params.set('crosslist', cross);
  else if (marketplace === 'etsy' && parseEbayCrosslist(cross)) params.set('crosslist', `ebay:${parseEbayCrosslist(cross)}`);
  else if (cross) return null;
  else if (first(query.prefill) === 'session') params.set('prefill', 'session');
  else return null;
  return `/app/${marketplace}-listings/new?${params.toString()}`;
}

/**
 * "Copy to eBay" / "Copy to Etsy" from a listings row (pure): the other marketplace's create route with the
 * `crosslist` hand-off. Etsy → eBay needs a numeric Etsy listing id (a staged new Etsy listing has a negative local
 * id and is not on Etsy yet); eBay → Etsy takes the SKU (≤ 50 characters, no control characters). Null = not offered.
 */
export function crosslistCreateHref(action: 'copyToEbay' | 'copyToEtsy', from: string, id: string): string | null {
  const v = String(id ?? '').trim();
  if (action === 'copyToEbay') {
    if (from !== 'etsy' || !/^\d{1,20}$/.test(v)) return null;
    return `/app/ebay-listings/new?${new URLSearchParams({ crosslist: `etsy:${v}` }).toString()}`;
  }
  if (from !== 'ebay' || !parseEbayCrosslist(`ebay:${v}`)) return null;
  return `/app/etsy-listings/new?${new URLSearchParams({ crosslist: `ebay:${v}` }).toString()}`;
}

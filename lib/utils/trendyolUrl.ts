// Build a Trendyol product page URL from order rawData.
//
// Trendyol's canonical pattern is `/<brand-or-product-slug>-p-<contentId>` with
// an optional `?merchantId=...` query. The `-p-<contentId>` suffix is what
// Trendyol's router actually resolves, but a slug segment is required — we used
// to ship `/x/x-p-<id>` as a placeholder, which Trendyol now treats as a 404.
//
// We slugify `productName` (already in the Trendyol Order rawData line) and
// fall back to the marketplace search URL when no usable slug exists. Search
// by numeric contentId reliably surfaces the exact product.

const TR_CHARS: Record<string, string> = {
  ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g',
  ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
};

function slugify(input: string): string {
  if (!input) return '';
  // Lowercase and explicitly fold Turkish characters before NFD strips combining
  // marks — Turkish dotted/dotless i breaks `toLowerCase().normalize('NFD')`.
  let s = input;
  for (const [from, to] of Object.entries(TR_CHARS)) {
    s = s.split(from).join(to);
  }
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export interface TrendyolUrlInput {
  contentId?: number | string | null;
  productName?: string | null;
  merchantId?: number | string | null;
  /** Manufacturer barcode (EAN/UPC) from rawData.lines[].barcode. Universal,
   *  always unique to a seller's listing, and Trendyol's `/sr?q=` resolver
   *  lands on the exact product. Preferred over contentId/productCode which
   *  in Trendyol's order API are NOT the product-detail-page id. */
  barcode?: string | null;
}

export function buildTrendyolProductUrl({
  contentId,
  productName,
  merchantId: _merchantId,
  barcode,
}: TrendyolUrlInput): string {
  // The order-line `contentId`/`productCode` we get from Trendyol's
  // Integration API is NOT the same id Trendyol's storefront uses in
  // `/<slug>-p-<id>` URLs — emitting `/x/x-p-<contentId>` resolves to
  // an unrelated catalog product (e.g. a hardware seller's screws when
  // the order was for a kid's dress). The seller API also has no public
  // URL field. The only reliable way to deep-link is to scrape it, so
  // we route through `/api/trendyol/url?barcode=...` server-side which
  // resolves the canonical URL and caches it. The browser sees a 302 to
  // the real product page on first click.
  const barcodeStr = barcode && String(barcode).trim();
  if (barcodeStr) {
    const params = new URLSearchParams({ barcode: barcodeStr });
    if (contentId) params.set('contentId', String(contentId));
    if (productName) params.set('name', productName);
    return `/api/trendyol/url?${params.toString()}`;
  }
  // No barcode at all — fall back to Trendyol search by whatever we have.
  // Don't pass &wb=<merchantId>; that filter sometimes hides the result.
  const search = (contentId && String(contentId).trim()) || (productName ? slugify(productName) : '');
  return search ? `https://www.trendyol.com/sr?q=${encodeURIComponent(search)}` : 'https://www.trendyol.com';
}

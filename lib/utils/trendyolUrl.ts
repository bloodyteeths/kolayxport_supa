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
  merchantId,
  barcode,
}: TrendyolUrlInput): string {
  // Barcode search is the only resolver that reliably lands on the user's
  // exact product. Trendyol's order-line `contentId` / `productCode` look
  // like product ids but they're an internal listing reference; the
  // `https://www.trendyol.com/<slug>-p-<contentId>` URL gets matched to an
  // unrelated catalog entry, so a kid-dress order would deep-link to a
  // hardware seller's screws. Skip that whole path.
  const search = (barcode && String(barcode).trim()) || (contentId && String(contentId).trim()) || '';
  if (search) {
    const merchantPart = merchantId ? `&wb=${encodeURIComponent(String(merchantId))}` : '';
    return `https://www.trendyol.com/sr?q=${encodeURIComponent(search)}${merchantPart}`;
  }
  // Last-ditch fallback — the slug-only URL won't deep-link but at least
  // takes the user somewhere on Trendyol that surfaces relevant products.
  const slug = productName ? slugify(productName) : '';
  return slug ? `https://www.trendyol.com/sr?q=${encodeURIComponent(slug)}` : 'https://www.trendyol.com';
}

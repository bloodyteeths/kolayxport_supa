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
}

export function buildTrendyolProductUrl({ contentId, productName, merchantId }: TrendyolUrlInput): string {
  if (!contentId) return 'https://www.trendyol.com';
  const slug = productName ? slugify(productName) : '';
  if (slug.length >= 4) {
    const base = `https://www.trendyol.com/${slug}-p-${contentId}`;
    return merchantId ? `${base}?merchantId=${merchantId}` : base;
  }
  // No usable slug — Trendyol search resolves a numeric contentId straight to the
  // product, even though the URL surface is /sr?q=...
  return `https://www.trendyol.com/sr?q=${encodeURIComponent(String(contentId))}`;
}

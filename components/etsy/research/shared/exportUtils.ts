import type { EtsyMarketItem, TagData, ShopData, KeywordData, AutocompleteSuggestion } from './types';

/* ------------------------------------------------------------------ */
/*  CSV Export                                                         */
/* ------------------------------------------------------------------ */

export function exportToCSV(
  data: Record<string, any>[],
  filename: string,
  columns?: { key: string; label: string }[],
) {
  if (!data.length) return;

  const cols = columns ?? Object.keys(data[0]).map((k) => ({ key: k, label: k }));

  const escapeCell = (val: any): string => {
    if (val == null) return '';
    const str = Array.isArray(val) ? val.join('; ') : String(val);
    // Wrap in quotes if it contains comma, quote, or newline
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const header = cols.map((c) => escapeCell(c.label)).join(',');
  const rows = data.map((row) =>
    cols.map((c) => escapeCell(row[c.key])).join(','),
  );

  // BOM for Excel UTF-8 compatibility (handles Turkish characters)
  const BOM = '\uFEFF';
  const csv = BOM + [header, ...rows].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  PDF Export (browser print)                                         */
/* ------------------------------------------------------------------ */

export function exportToPDF(elementId: string, title: string) {
  const source = document.getElementById(elementId);
  if (!source) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const clone = source.cloneNode(true) as HTMLElement;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               padding: 24px; color: #333; }
        h1 { font-size: 18px; margin-bottom: 16px; color: #444; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; font-size: 12px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        img { max-width: 60px; max-height: 60px; }
        svg { max-width: 100%; }
        @media print {
          body { padding: 12px; }
          button, [role="button"] { display: none !important; }
        }
      </style>
    </head>
    <body>
      <h1>${title}</h1>
      ${clone.outerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();

  // Wait for content to render, then trigger print
  printWindow.addEventListener('load', () => {
    printWindow.focus();
    printWindow.print();
  });
  // Fallback for quick-loading content
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 500);
}

/* ------------------------------------------------------------------ */
/*  Data Formatters                                                    */
/* ------------------------------------------------------------------ */

export function formatNicheDataForExport(
  items: EtsyMarketItem[],
  summary?: { priceStats?: { min: number; avg: number; median: number; max: number } | null },
): Record<string, any>[] {
  return items.map((item) => ({
    title: item.title,
    price: item.price,
    currency: item.currency_code,
    favorites: item.num_favorers,
    views: item.views,
    quantity: item.quantity,
    tags: item.tags?.join('; ') ?? '',
    url: item.url,
  }));
}

export function getNicheCsvColumns(t: (key: string) => string) {
  return [
    { key: 'title', label: t('csvColumns.title') },
    { key: 'price', label: t('csvColumns.price') },
    { key: 'currency', label: t('csvColumns.currency') },
    { key: 'favorites', label: t('csvColumns.favorites') },
    { key: 'views', label: t('csvColumns.views') },
    { key: 'quantity', label: t('csvColumns.stock') },
    { key: 'tags', label: t('csvColumns.tags') },
    { key: 'url', label: t('csvColumns.url') },
  ];
}

export function formatTagDataForExport(
  tags: (TagData & { avgEngagement?: number; effectivenessScore?: number })[],
): Record<string, any>[] {
  return tags.map((t) => ({
    tag: t.tag,
    frequency: t.count,
    percentage: t.pct,
    avgEngagement: t.avgEngagement ?? '',
    effectivenessScore: t.effectivenessScore ?? '',
  }));
}

export function getTagCsvColumns(t: (key: string) => string) {
  return [
    { key: 'tag', label: t('csvColumns.tag') },
    { key: 'frequency', label: t('csvColumns.frequency') },
    { key: 'percentage', label: t('csvColumns.percentage') },
    { key: 'avgEngagement', label: t('csvColumns.avgEngagement') },
    { key: 'effectivenessScore', label: t('csvColumns.effectivenessScore') },
  ];
}

export function formatShopDataForExport(
  shops: (ShopData & { avgPrice?: number; listingCount?: number })[],
): Record<string, any>[] {
  return shops.map((s) => ({
    shopName: s.shop_name,
    totalSales: s.num_sales,
    rating: s.review_average,
    reviewCount: s.review_count,
    listingCount: s.listingCount ?? s.listing_active_count,
    avgPrice: s.avgPrice != null ? Number(s.avgPrice).toFixed(2) : '',
    url: s.url,
  }));
}

export function getShopCsvColumns(t: (key: string) => string) {
  return [
    { key: 'shopName', label: t('csvColumns.shopName') },
    { key: 'totalSales', label: t('csvColumns.totalSales') },
    { key: 'rating', label: t('csvColumns.rating') },
    { key: 'reviewCount', label: t('csvColumns.reviewCount') },
    { key: 'listingCount', label: t('csvColumns.listingCount') },
    { key: 'avgPrice', label: t('csvColumns.avgPrice') },
    { key: 'url', label: t('csvColumns.url') },
  ];
}

export function formatKeywordDataForExport(
  keywords: (KeywordData | AutocompleteSuggestion)[],
): Record<string, any>[] {
  return keywords.map((k: any) => ({
    keyword: k.keyword,
    count: k.count ?? k.frequency ?? '',
    percentage: k.pct ?? '',
    score: k.score ?? '',
    competition: k.competition ?? '',
    sources: k.sources ? k.sources.join(', ') : '',
  }));
}

export function getKeywordCsvColumns(t: (key: string) => string) {
  return [
    { key: 'keyword', label: t('csvColumns.keyword') },
    { key: 'count', label: t('csvColumns.frequency') },
    { key: 'percentage', label: t('csvColumns.percentage') },
    { key: 'score', label: t('csvColumns.score') },
    { key: 'competition', label: t('csvColumns.competition') },
    { key: 'sources', label: t('csvColumns.sources') },
  ];
}

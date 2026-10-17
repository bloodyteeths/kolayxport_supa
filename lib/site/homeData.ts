// Seller quotes on the home page: verbatim public posts (docs/gtm/pain-points.md), never invented.
// English versions are translations and say so.
export const HOME_PAINS = {
  tr: [
    { quote: '4 aylık Etsy mağazam, 134 ürün, 4 satış — bu normal mi?', source: 'Etsy Community, Türk Satıcılar forumu, 2026' },
    { quote: 'muhasebeci 4 dolar + kdv üzerinden keseceksin diyor … kafam karıştı.', source: 'Ekşi Sözlük, Mart 2026' },
    { quote: '4 dolara sattım … bana 99 lira kalmış.', source: 'Ekşi Sözlük, Mart 2026' },
  ],
  en: [
    { quote: 'My 4-month-old Etsy shop: 134 products, 4 sales — is this normal?', source: 'Etsy Community, Turkish sellers forum, 2026 (translated)' },
    { quote: 'My accountant says invoice it as $4 plus VAT … I’m confused.', source: 'Ekşi Sözlük, March 2026 (translated)' },
    { quote: 'I sold it for $4 … I was left with 99 lira.', source: 'Ekşi Sözlük, March 2026 (translated)' },
  ],
} as const;

/** Inventory rows behind every home-page claim (docs/gtm/feature-inventory.md), checked by scripts/gtm/check-claims.mjs. */
export const HOME_CLAIM_REFS = [
  'ai-listing-copy', 'ai-bulk-optimize', 'etsy-bulk-editor', 'scheduled-send', 'etsy-version-history', 'crosslist-etsy-ebay',
  'ai-image-gen', 'ai-alt-text', 'research-keywords', 'research-product-finder', 'research-listing-doctor', 'arbitrage-price-gap',
  'ext-research-overlay', 'orders-unified-list', 'label-fedex', 'label-ups', 'label-dhl-ecommerce', 'customs-commercial-invoice',
  'labels-bulk', 'etgb-excel-email', 'parasut-einvoice', 'reports-profit', 'trendyol-products', 'stock-sync', 'staged-drafts-send',
  'tracking-push-ebay', 'tracking-push-amazon',
];

export const HOME_INTEGRATIONS = ['etsy', 'ebay', 'amazon', 'trendyol', 'shopify', 'wix', 'fedex', 'ups', 'dhl-ecommerce', 'parasut'] as const;

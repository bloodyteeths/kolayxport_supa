// lib/research/legacyRoutes.ts — the old research routes → the Research hub (research.md §2.3).
//
// `/app/etsy-research`, `/app/ebay-research`, `/app/trendyol-arastirma` and `/app/amazon-research` have no UI any more
// (founder decision: no users yet, the legacy screens go now). They stay as URLs because the Chrome extension, emails
// and bookmarks link into them, so each one answers with a permanent redirect from `getServerSideProps`
// (`legacyResearchRedirect(route)`), mapping the old `?tab=` / `?sub=` to the tool that replaced it and carrying the
// search text. The page file for each route only needs:
//
//   export const getServerSideProps = legacyResearchRedirect('etsy');
//   export default function EtsyResearchRedirect() { return null; }
//
// Pure apart from the gssp wrapper (no React, no Prisma).
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import type { ResearchMkt } from '@/lib/research/types';

export type LegacyResearchRoute = 'etsy' | 'ebay' | 'trendyol' | 'amazon';

/** Destination tools. `financials` is not a research tool: eBay's fee calculator tab goes to Reports › Profit. */
export type ResearchTool = 'products' | 'keywords' | 'listings' | 'shops' | 'price-gap' | 'financials';

export const LEGACY_RESEARCH_PATHS: Record<LegacyResearchRoute, string> = {
  etsy: '/app/etsy-research',
  ebay: '/app/ebay-research',
  trendyol: '/app/trendyol-arastirma',
  amazon: '/app/amazon-research',
};

/** Page file (under `pages/`) each destination renders from; the "target exists" test checks these. */
export const RESEARCH_TOOL_PAGE: Record<ResearchTool, string> = {
  products: 'app/research/products.tsx',
  keywords: 'app/research/keywords.tsx',
  listings: 'app/research/listings.tsx',
  shops: 'app/research/shops.tsx',
  'price-gap': 'app/research/products.tsx',
  financials: 'app/reports/profit.tsx',
};

/** Reports › Profit (the old `/app/financials` page's replacement). */
export const FINANCIALS_PATH = '/app/reports/profit';

type Query = Record<string, string | string[] | undefined>;

interface Destination {
  tool: ResearchTool;
  /** Marketplace of the hub tool (`price-gap` and `financials` have none). */
  mkt?: ResearchMkt;
  params?: Record<string, string>;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}

// Etsy page: `?tab=research|grader|shopIntel` (verified against pages/app/etsy-research.tsx).
// The spec's older names (discover, unified, competitors, keywords, ranks) are accepted for bookmarks.
function etsyDestination(tab: string): Destination {
  switch (tab) {
    case 'grader':
      return { tool: 'listings', mkt: 'etsy' };
    case 'shopIntel':
    case 'competitors':
      return { tool: 'shops', mkt: 'etsy' };
    case 'keywords':
      return { tool: 'keywords', mkt: 'etsy' };
    case 'ranks':
      return { tool: 'keywords', mkt: 'etsy', params: { view: 'tracked' } };
    default:
      // '', research, discover, unified, anything unknown ("any tab")
      return { tool: 'products', mkt: 'etsy' };
  }
}

// eBay page: tool id in `?sub=` (`?tab=` holds the section). Old links put the tool id in `?tab=`.
// Unknown ids fall back to the page's DEFAULT_TOOL (`product_database`), like the legacy page did.
const EBAY_TOOL: Record<string, ResearchTool> = {
  product_database: 'products',
  niche_finder: 'products',
  marketplace_comparison: 'products',
  niche_comparison: 'products',
  category_explorer: 'products',
  keyword_intelligence: 'keywords',
  seo_analyzer: 'keywords',
  listing_optimizer: 'listings',
  ai_hub: 'listings',
  product_tracker: 'shops',
  seller_tracker: 'shops',
  competitive_intelligence: 'shops',
  arbitrage: 'price-gap',
  financial: 'financials',
};

function ebayDestination(sub: string, tab: string): Destination {
  const tool = EBAY_TOOL[sub] ?? EBAY_TOOL[tab] ?? 'products';
  return tool === 'price-gap' || tool === 'financials' ? { tool } : { tool, mkt: 'ebay' };
}

function destinationFor(route: LegacyResearchRoute, query: Query): Destination {
  const tab = first(query.tab).trim();
  if (route === 'etsy') return etsyDestination(tab);
  if (route === 'ebay') return ebayDestination(first(query.sub).trim(), tab);
  // Trendyol domestic research → the Product finder's Trendyol source (Price gap; a Trendyol mode is planned there).
  if (route === 'trendyol') return { tool: 'price-gap' };
  // Amazon research is gone (PA-API not eligible): the Shop tracker explains what the hub covers.
  return { tool: 'shops', mkt: 'amazon' };
}

/**
 * The hub URL an old research URL maps to. Carries the search text (`q`, or the old `keyword` / `query`) into the
 * Product finder and Keyword explorer. Pure.
 */
export function legacyResearchTarget(route: LegacyResearchRoute, query: Query): string {
  const dest = destinationFor(route, query);
  const params = new URLSearchParams();
  let path: string;
  if (dest.tool === 'financials') {
    path = FINANCIALS_PATH;
  } else if (dest.tool === 'price-gap') {
    path = '/app/research/products';
    params.set('source', 'trendyol');
  } else {
    path = `/app/research/${dest.tool}`;
    if (dest.mkt) params.set('mkt', dest.mkt);
    const q = (first(query.q) || first(query.keyword) || first(query.query)).trim().slice(0, 200);
    if (q && (dest.tool === 'products' || dest.tool === 'keywords')) params.set('q', q);
  }
  for (const [k, v] of Object.entries(dest.params ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** `getServerSideProps` of an old research route: always a permanent (308) redirect into the hub. */
export function legacyResearchRedirect(route: LegacyResearchRoute): GetServerSideProps {
  return async (ctx: GetServerSidePropsContext) => ({
    redirect: { destination: legacyResearchTarget(route, ctx.query as Query), permanent: true },
  });
}

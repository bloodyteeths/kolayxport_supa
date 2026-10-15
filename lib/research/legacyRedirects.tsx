// research R1-E: old research routes → the Research hub (research.md §2.3), flag-aware.
//
// Each legacy route (`/app/etsy-research`, `/app/ebay-research`, `/app/trendyol-arastirma`,
// `/app/amazon-research`) exports `getServerSideProps = legacyResearchGssp('<route>')` and wraps its
// default export in `withLegacyResearchRedirect('<route>', Page)`:
//   - server: redirects (307, never permanent: the flag can flip back) only when the request itself
//     carries a `?ui=` that resolves `research` on. The build default alone never redirects on the
//     server, because the viewer's stored `?ui=` opt-out (localStorage) is invisible there and must win;
//   - client: once per mount, the full decision (build default + stored override), like useUiFlag.
//     Flag off → the legacy page renders unchanged.
// A tab only redirects once the tool that replaces it has shipped *for that marketplace* (§2.3: "the
// redirect for a tab lands in the same PR as the tool that replaces it"). Everything else keeps the
// legacy page. R2/R3/R4 add their `tool:mkt` keys to `SHIPPED_RESEARCH_TARGETS`; the mapping is here.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import { useRouter } from 'next/router';
import { defaultUiFlags, parseUiOverride, readClientUiOverride, resolveUiFlag } from '@/lib/ds/uiFlags';
import type { ResearchMkt } from '@/lib/research/types';

export type LegacyResearchRoute = 'etsy' | 'ebay' | 'trendyol' | 'amazon';

/** Destination tools. `financials` is not a research tool: eBay's fee calculator tab goes to Financials. */
export type ResearchTool = 'products' | 'keywords' | 'listings' | 'shops' | 'price-gap' | 'financials';

/** `tool:mkt` for hub tools; `price-gap` and `financials` have no marketplace. */
export type ShippedResearchKey = `${Exclude<ResearchTool, 'price-gap' | 'financials'>}:${ResearchMkt}` | 'price-gap' | 'financials';

/**
 * Tool × marketplace pairs live in this release (R1: Product finder + Listing doctor for Etsy and eBay;
 * Home has no legacy tab). The R1 products API answers Trendyol ("later", R4) and Amazon ("ineligible")
 * with an unavailable state, so /app/trendyol-arastirma and /app/amazon-research keep the legacy page.
 */
export const SHIPPED_RESEARCH_TARGETS: ReadonlySet<ShippedResearchKey> = new Set<ShippedResearchKey>([
  'products:etsy',
  'products:ebay',
  'listings:etsy',
  'listings:ebay',
  // R2 Keyword explorer and R3 Shop tracker (backend ResearchWatch/ResearchSnapshot live since 1bf1e40).
  'keywords:etsy',
  'shops:etsy',
  'financials',
]);

/** Page file (under `pages/`) each destination tool renders from; used by the "target exists" test. */
export const RESEARCH_TOOL_PAGE: Record<ResearchTool, string> = {
  products: 'app/research/products.tsx',
  keywords: 'app/research/keywords.tsx',
  listings: 'app/research/listings.tsx',
  shops: 'app/research/shops.tsx',
  'price-gap': 'app/research/products.tsx',
  financials: 'app/financials.tsx',
};

function shippedKey(tool: ResearchTool, mkt: ResearchMkt): ShippedResearchKey {
  return tool === 'price-gap' || tool === 'financials' ? tool : `${tool}:${mkt}`;
}

export const LEGACY_RESEARCH_PATHS: Record<LegacyResearchRoute, string> = {
  etsy: '/app/etsy-research',
  ebay: '/app/ebay-research',
  trendyol: '/app/trendyol-arastirma',
  amazon: '/app/amazon-research',
};

/** Before M9 the Reports › Profit page does not exist; Financials is the target (§2.3). */
export const FINANCIALS_PATH = '/app/financials';

type Query = Record<string, string | string[] | undefined>;

interface Destination {
  tool: ResearchTool;
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
      return { tool: 'listings' };
    case 'shopIntel':
    case 'competitors':
      return { tool: 'shops' };
    case 'keywords':
      return { tool: 'keywords' };
    case 'ranks':
      return { tool: 'keywords', params: { view: 'tracked' } };
    default:
      // '', research, discover, unified, anything unknown ("any tab")
      return { tool: 'products' };
  }
}

// eBay page: tool id in `?sub=` (`?tab=` holds the section). Old links put the tool id in `?tab=`.
// Unknown ids fall back to the page's DEFAULT_TOOL (`product_database`), like the legacy page does.
const EBAY_TOOL_DESTINATION: Record<string, Destination> = {
  product_database: { tool: 'products' },
  niche_finder: { tool: 'products' },
  marketplace_comparison: { tool: 'products' },
  niche_comparison: { tool: 'products' },
  category_explorer: { tool: 'products' },
  keyword_intelligence: { tool: 'keywords' },
  seo_analyzer: { tool: 'keywords' },
  listing_optimizer: { tool: 'listings' },
  ai_hub: { tool: 'listings' },
  product_tracker: { tool: 'shops' },
  seller_tracker: { tool: 'shops' },
  competitive_intelligence: { tool: 'shops' },
  arbitrage: { tool: 'price-gap' },
  financial: { tool: 'financials' },
};

function ebayDestination(sub: string, tab: string): Destination {
  return EBAY_TOOL_DESTINATION[sub] ?? EBAY_TOOL_DESTINATION[tab] ?? EBAY_TOOL_DESTINATION.product_database;
}

const ROUTE_MKT: Record<LegacyResearchRoute, ResearchMkt> = {
  etsy: 'etsy',
  ebay: 'ebay',
  trendyol: 'trendyol',
  amazon: 'amazon',
};

function destinationFor(route: LegacyResearchRoute, query: Query): Destination {
  const tab = first(query.tab).trim();
  if (route === 'etsy') return etsyDestination(tab);
  if (route === 'ebay') return ebayDestination(first(query.sub).trim(), tab);
  return { tool: 'products' }; // Trendyol and Amazon: every section → Product finder
}

/**
 * The hub URL an old research URL maps to, or `null` when that tab's tool has not shipped (the
 * legacy page keeps serving it). Carries the search text (`q`, or the old `keyword`/`query`) and
 * the `ui` override so the new page persists it. Pure; no flag check.
 */
export function legacyResearchTarget(
  route: LegacyResearchRoute,
  query: Query,
  shipped: ReadonlySet<ShippedResearchKey> = SHIPPED_RESEARCH_TARGETS,
): string | null {
  const dest = destinationFor(route, query);
  if (!shipped.has(shippedKey(dest.tool, ROUTE_MKT[route]))) return null;

  const params = new URLSearchParams();
  let path: string;
  if (dest.tool === 'financials') {
    path = FINANCIALS_PATH;
  } else if (dest.tool === 'price-gap') {
    path = '/app/research/products';
    params.set('source', 'trendyol');
  } else {
    path = `/app/research/${dest.tool}`;
    params.set('mkt', ROUTE_MKT[route]);
    const q = (first(query.q) || first(query.keyword) || first(query.query)).trim();
    if (q && (dest.tool === 'products' || dest.tool === 'keywords')) params.set('q', q);
  }
  for (const [k, v] of Object.entries(dest.params ?? {})) params.set(k, v);
  const ui = first(query.ui).trim();
  if (ui) params.set('ui', ui);

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Server view of the `research` flag: true only when this request's `?ui=` is understood and resolves
 * `research` on (it replaces the stored override on the client too, and is carried to the target, so
 * the hub agrees). No `?ui=`, or one the client would ignore → false: the client wrapper decides with
 * the stored override, so a stored opt-out keeps the legacy page and the hub never bounces back.
 */
export function researchFlagOnServer(query: Query, env: string | undefined = process.env.NEXT_PUBLIC_UI_V2): boolean {
  const raw = first(query.ui);
  if (!raw.trim()) return false;
  const override = parseUiOverride(raw);
  if (override === undefined) return false;
  return resolveUiFlag('research', defaultUiFlags(env), override);
}

/** `getServerSideProps` for a legacy research route. */
export function legacyResearchGssp(route: LegacyResearchRoute): GetServerSideProps {
  return async (ctx: GetServerSidePropsContext) => {
    const query = ctx.query as Query;
    if (researchFlagOnServer(query)) {
      const destination = legacyResearchTarget(route, query);
      if (destination) return { redirect: { destination, permanent: false } };
    }
    return { props: {} };
  };
}

/**
 * Client decision (build default + stored `?ui=` override the server cannot read). Renders the legacy
 * page unchanged unless the flag resolves on and the tab has a shipped target, then replaces the URL.
 * Checked once, on the first ready render: the legacy pages' own shallow tab switches
 * (router.replace with ?tab=/?sub=) must not pull the viewer off a page they are already using.
 */
export function withLegacyResearchRedirect<P extends object>(
  route: LegacyResearchRoute,
  Page: React.ComponentType<P>,
): React.ComponentType<P> {
  function LegacyResearchRoutePage(props: P) {
    const router = useRouter();
    const [redirecting, setRedirecting] = useState(false);
    const checked = useRef(false);
    useEffect(() => {
      if (!router.isReady || checked.current) return;
      checked.current = true;
      if (!resolveUiFlag('research', defaultUiFlags(), readClientUiOverride())) return;
      const target = legacyResearchTarget(route, router.query as Query);
      if (!target) return;
      setRedirecting(true);
      void router.replace(target);
    }, [router, router.isReady]);
    if (redirecting) return null;
    return <Page {...props} />;
  }
  LegacyResearchRoutePage.displayName = `withLegacyResearchRedirect(${route})`;
  return LegacyResearchRoutePage;
}

// research: the old research routes always redirect into the hub (research.md §2.3; the legacy screens are deleted).
// lib/research/legacyRoutes.ts holds the mapping + the gssp redirect; each old page file is a gssp-only stub.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GetServerSidePropsContext } from 'next';
import {
  LEGACY_RESEARCH_PATHS,
  RESEARCH_TOOL_PAGE,
  legacyResearchRedirect,
  legacyResearchTarget,
  type LegacyResearchRoute,
} from '@/lib/research/legacyRoutes';

const ROOT = resolve(__dirname, '../..');

describe('every destination exists', () => {
  it.each(Object.entries(RESEARCH_TOOL_PAGE))('%s → pages/%s', (_tool, page) => {
    expect(existsSync(resolve(ROOT, 'pages', page))).toBe(true);
  });
});

describe('legacyResearchTarget — Etsy', () => {
  it.each<[Record<string, string | string[]>, string]>([
    [{}, '/app/research/products?mkt=etsy'],
    [{ tab: 'research' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'discover' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'unified' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'whatever' }, '/app/research/products?mkt=etsy'],
    [{ tab: 'grader' }, '/app/research/listings?mkt=etsy'],
    [{ tab: 'shopIntel' }, '/app/research/shops?mkt=etsy'],
    [{ tab: 'competitors' }, '/app/research/shops?mkt=etsy'],
    [{ tab: 'keywords' }, '/app/research/keywords?mkt=etsy'],
    [{ tab: 'ranks' }, '/app/research/keywords?mkt=etsy&view=tracked'],
  ])('etsy %o → %s', (query, expected) => {
    expect(legacyResearchTarget('etsy', query)).toBe(expected);
  });
});

describe('legacyResearchTarget — eBay', () => {
  it.each<[Record<string, string>, string]>([
    [{}, '/app/research/products?mkt=ebay'],
    [{ tab: 'research', sub: 'product_database' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'niche_finder' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'marketplace_comparison' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'niche_comparison' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'category_explorer' }, '/app/research/products?mkt=ebay'],
    [{ sub: 'keyword_intelligence' }, '/app/research/keywords?mkt=ebay'],
    [{ sub: 'seo_analyzer' }, '/app/research/keywords?mkt=ebay'],
    [{ tab: 'optimization', sub: 'listing_optimizer' }, '/app/research/listings?mkt=ebay'],
    [{ tab: 'ai_hub' }, '/app/research/listings?mkt=ebay'],
    [{ sub: 'product_tracker' }, '/app/research/shops?mkt=ebay'],
    [{ sub: 'seller_tracker' }, '/app/research/shops?mkt=ebay'],
    [{ tab: 'competitive_intelligence' }, '/app/research/shops?mkt=ebay'],
    [{ sub: 'arbitrage' }, '/app/research/products?source=trendyol'],
    [{ sub: 'financial' }, '/app/reports/profit'],
    [{ tab: 'tracking' }, '/app/research/products?mkt=ebay'],
  ])('ebay %o → %s', (query, expected) => {
    expect(legacyResearchTarget('ebay', query)).toBe(expected);
  });
});

describe('legacyResearchTarget — Trendyol and Amazon', () => {
  it('every Trendyol section → Product finder, source Trendyol (Price gap)', () => {
    expect(legacyResearchTarget('trendyol', {})).toBe('/app/research/products?source=trendyol');
    expect(legacyResearchTarget('trendyol', { tab: 'sellers', q: 'havlu' })).toBe('/app/research/products?source=trendyol');
  });
  it('Amazon research is gone (PA-API ineligible): the Shop tracker, whatever the extension passes', () => {
    expect(legacyResearchTarget('amazon', {})).toBe('/app/research/shops?mkt=amazon');
    expect(legacyResearchTarget('amazon', { asin: 'B0ABCDEFGH' })).toBe('/app/research/shops?mkt=amazon');
    expect(legacyResearchTarget('amazon', { q: 'lamp' })).toBe('/app/research/shops?mkt=amazon');
  });
});

describe('legacyResearchTarget — carried params', () => {
  it('carries the search text (q, keyword, query) into Product finder and Keyword explorer only, never ui', () => {
    expect(legacyResearchTarget('etsy', { q: ' jewelry box ', ui: 'orders' })).toBe('/app/research/products?mkt=etsy&q=jewelry+box');
    expect(legacyResearchTarget('ebay', { sub: 'product_database', keyword: 'lego' })).toBe('/app/research/products?mkt=ebay&q=lego');
    expect(legacyResearchTarget('ebay', { sub: 'seo_analyzer', query: 'denim' })).toBe('/app/research/keywords?mkt=ebay&q=denim');
    expect(legacyResearchTarget('etsy', { tab: 'grader', q: 'x' })).toBe('/app/research/listings?mkt=etsy');
    expect(legacyResearchTarget('etsy', { tab: ['grader', 'research'] })).toBe('/app/research/listings?mkt=etsy');
  });
  it('caps the carried text at 200 characters', () => {
    expect(legacyResearchTarget('etsy', { q: 'a'.repeat(300) })).toBe(`/app/research/products?mkt=etsy&q=${'a'.repeat(200)}`);
  });
});

const ctx = (query: Record<string, string>) => ({ query }) as unknown as GetServerSidePropsContext;

describe('legacyResearchRedirect (getServerSideProps)', () => {
  it.each<[LegacyResearchRoute, Record<string, string>, string]>([
    ['etsy', { tab: 'grader' }, '/app/research/listings?mkt=etsy'],
    ['ebay', { sub: 'seller_tracker' }, '/app/research/shops?mkt=ebay'],
    ['trendyol', {}, '/app/research/products?source=trendyol'],
    ['amazon', { asin: 'B0ABCDEFGH' }, '/app/research/shops?mkt=amazon'],
  ])('%s %o → permanent redirect to %s, for everyone (no flag)', async (route, query, destination) => {
    expect(await legacyResearchRedirect(route)(ctx(query))).toEqual({ redirect: { destination, permanent: true } });
    expect(await legacyResearchRedirect(route)(ctx({ ...query, ui: '1' }))).toMatchObject({ redirect: { permanent: true } });
  });
});

describe('the Chrome extension links land on a redirect', () => {
  // chrome-extension/** is backend-owned and keeps its links (/app/etsy-research, /app/ebay-research,
  // /app/amazon-research?asin=|q=): each linked route must keep a route file that wires the server redirect.
  it.each(Object.entries(LEGACY_RESEARCH_PATHS))('%s (%s) keeps a redirecting route file', (_route, path) => {
    const file = resolve(ROOT, `pages${path}.tsx`);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(/getServerSideProps\s*=\s*legacyResearchRedirect\(/);
  });
});

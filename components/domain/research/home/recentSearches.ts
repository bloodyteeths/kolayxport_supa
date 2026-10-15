// Recent research searches, per viewer (research.md §4.1 "Recent and watched"): localStorage
// `kx.research.recent`, newest first, at most 10, try/catch (private windows / blocked storage → empty).
import type { ResearchMkt } from '@/lib/research/types';
import type { ResearchTab } from '../ResearchLayout';

export const RECENT_KEY = 'kx.research.recent';
export const RECENT_MAX = 10;

export type RecentSearch = {
  q: string;
  tool: ResearchTab;
  mkt: ResearchMkt;
  at: string;
  /** The href the search actually opened (a pasted link may resolve to `?open=<id>`, a shop tracker…). Replayed as-is. */
  href?: string;
};

/** Same-origin app path only (never `//host` or a scheme). */
export function isSafeRecentHref(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') && v.length <= 600;
}

/** Pure: the research tab a resolved href belongs to (`/app/research/<tool>`), else `products`. */
export function toolOfHref(href: string): ResearchTab {
  const m = /^\/app\/research\/(products|keywords|listings|shops)(?:[/?#]|$)/.exec(href);
  return m ? (m[1] as ResearchTab) : 'products';
}

const TOOLS: readonly string[] = ['home', 'products', 'keywords', 'listings', 'shops'];
const MKTS: readonly string[] = ['etsy', 'ebay', 'amazon', 'trendyol'];

function valid(v: unknown): v is RecentSearch {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.q === 'string' &&
    r.q.trim().length > 0 &&
    TOOLS.includes(String(r.tool)) &&
    MKTS.includes(String(r.mkt)) &&
    typeof r.at === 'string' &&
    !Number.isNaN(Date.parse(r.at)) &&
    (r.href === undefined || isSafeRecentHref(r.href))
  );
}

export function readRecentSearches(): RecentSearch[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Pure: put `entry` first, drop an older copy of the same (q, tool, mkt), cap at 10. */
export function withRecent(list: RecentSearch[], entry: RecentSearch): RecentSearch[] {
  const k = (r: RecentSearch) => `${r.tool}|${r.mkt}|${r.q.trim().toLowerCase()}`;
  return [entry, ...list.filter((r) => k(r) !== k(entry))].slice(0, RECENT_MAX);
}

export function rememberSearch(entry: Omit<RecentSearch, 'at'> & { at?: string }): void {
  const q = entry.q.trim();
  if (!q) return;
  try {
    const { href, ...rest } = entry;
    const next = withRecent(readRecentSearches(), {
      ...rest,
      q: q.slice(0, 200),
      at: entry.at ?? new Date().toISOString(),
      ...(isSafeRecentHref(href) ? { href } : {}),
    });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}

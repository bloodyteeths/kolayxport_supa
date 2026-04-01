import type { SavedSearch } from './types';

export const fmt = (n: number) => `$${n.toFixed(2)}`;
export const pct = (n: number) => `${n.toFixed(1)}%`;

export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'are', 'was', 'were',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'not', 'no', 'set', '&', '-', '/', '|', '+', 'x',
]);

export function extractWords(title: string): string[] {
  return title.toLowerCase().split(/[\s,;:!?()[\]{}""''|\/\-]+/).filter(
    (w) => w.length > 1 && !STOP_WORDS.has(w) && !/^\d+$/.test(w),
  );
}

export function extractNgrams(titles: string[], n: number): { phrase: string; count: number; percentage: number }[] {
  const freq: Record<string, number> = {};
  titles.forEach((title) => {
    const words = extractWords(title);
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      freq[phrase] = (freq[phrase] || 0) + 1;
    }
  });
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([phrase, count]) => ({ phrase, count, percentage: Math.round((count / titles.length) * 100) }));
}

export const PRICE_RANGES = [
  { label: '$0 - $10', min: 0, max: 10 },
  { label: '$10 - $25', min: 10, max: 25 },
  { label: '$25 - $50', min: 25, max: 50 },
  { label: '$50 - $100', min: 50, max: 100 },
  { label: '$100 - $250', min: 100, max: 250 },
  { label: '$250+', min: 250, max: Infinity },
];

const SAVED_KEY = 'kolayxport_etsy_saved_searches';

export function loadSavedSearches(): SavedSearch[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}

export function saveSavedSearches(list: SavedSearch[]) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 20)));
}

export function sortArray<T>(arr: T[], key: string, dir: 'asc' | 'desc'): T[] {
  if (!key) return arr;
  return [...arr].sort((a: any, b: any) => {
    let va = a[key] ?? 0, vb = b[key] ?? 0;
    if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb as string).toLowerCase(); }
    return dir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
  });
}

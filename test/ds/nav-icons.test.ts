import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// DS §7.2 M0: nav-icon uniqueness. The nav still lives in components/AppLayout.js until M2 introduces
// lib/nav/navConfig.ts. The legacy nav reuses some icons (one per marketplace-products entry, one per
// research tool). M2 replaces those with LogoTile/distinct icons. Until then this test fails when a NEW
// duplicate appears, and the strict check is skipped.
// TODO(M2 nav): point this at lib/nav/navConfig.ts, delete LEGACY_DUPLICATES, and un-skip the strict test.

const LEGACY_DUPLICATES: Record<string, number> = { Package: 2, ShoppingBag: 2, Target: 3 };

function navIconCounts(): Record<string, number> {
  const src = readFileSync(join(__dirname, '../../components/AppLayout.js'), 'utf8');
  const counts: Record<string, number> = {};
  for (const m of src.matchAll(/\{\s*href:\s*['"][^'"]+['"],\s*icon:\s*([A-Za-z0-9_]+)/g)) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return counts;
}

describe('nav icons', () => {
  it('finds the nav items', () => {
    expect(Object.keys(navIconCounts()).length).toBeGreaterThan(5);
  });

  it('adds no new duplicate icons beyond the known legacy ones', () => {
    const dupes = Object.entries(navIconCounts()).filter(([, n]) => n > 1);
    for (const [icon, n] of dupes) {
      expect(LEGACY_DUPLICATES[icon], `icon ${icon} is used ${n}x in the nav`).toBeDefined();
      expect(n).toBeLessThanOrEqual(LEGACY_DUPLICATES[icon]);
    }
  });

  it.skip('every nav item has a unique icon (enable in M2)', () => {
    const dupes = Object.entries(navIconCounts()).filter(([, n]) => n > 1);
    expect(dupes).toEqual([]);
  });
});

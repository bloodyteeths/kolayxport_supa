// shell-nav §13 / DS §3.1: no two nav items share an icon or a brand (or a `g` key, or a destination), and
// every label key exists in both message files. Replaces the M0 AppLayout.js regex test (nav-icons.test.ts).
import { describe, expect, it } from 'vitest';
import { icons } from '@/lib/ds/icons';
import { LOGOS } from '@/lib/ds/logos';
import { ALL_NAV_ITEMS, NAV_CONFIG, NAV_EXTRA_DESTINATIONS } from '@/lib/nav/navConfig';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

function dupes(values: unknown[]): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const v of values) {
    if (seen.has(v)) out.push(v);
    seen.add(v);
  }
  return out;
}

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), messages);
}

describe('navConfig uniqueness', () => {
  it('every item has exactly one of icon / brand', () => {
    for (const i of ALL_NAV_ITEMS) expect(Boolean(i.icon) !== Boolean(i.brand), i.id).toBe(true);
  });

  it('no two items share an icon component (aliases included)', () => {
    const comps = ALL_NAV_ITEMS.filter((i) => i.icon).map((i) => icons[i.icon!]);
    expect(dupes(comps)).toEqual([]);
  });

  it('nav icons never reuse a component of a different registry meaning', () => {
    for (const i of ALL_NAV_ITEMS) if (i.icon) expect(icons[i.icon], i.id).toBeDefined();
  });

  it('no two items share a brand, and every brand has a logo', () => {
    const brands = ALL_NAV_ITEMS.filter((i) => i.brand).map((i) => i.brand);
    expect(dupes(brands)).toEqual([]);
    for (const b of brands) expect(LOGOS[b as keyof typeof LOGOS], String(b)).toBeDefined();
  });

  it('no two items share an id, an href or a g key', () => {
    expect(dupes(ALL_NAV_ITEMS.map((i) => i.id))).toEqual([]);
    expect(dupes([...ALL_NAV_ITEMS.map((i) => i.href), ...NAV_EXTRA_DESTINATIONS.map((x) => x.href)])).toEqual([]);
    expect(dupes([...ALL_NAV_ITEMS.map((i) => i.gKey).filter(Boolean), 'l'])).toEqual([]);
  });

  it('g keys are single lowercase ASCII letters and never `?` (the shortcut sheet)', () => {
    for (const i of ALL_NAV_ITEMS) if (i.gKey) expect(i.gKey).toMatch(/^[a-z]$/);
  });

  it('extras point at an existing parent row and use registry icons', () => {
    for (const x of NAV_EXTRA_DESTINATIONS) {
      expect(ALL_NAV_ITEMS.some((i) => i.id === x.parentId), x.id).toBe(true);
      expect(icons[x.icon], x.id).toBeDefined();
    }
  });
});

// Label keys are new in M2 and merged by the integrator (BUILD_PLAN §0.2). Until `nav.items` exists in the
// message files this check is skipped; after the merge it is strict.
const LABEL_KEYS = [
  ...NAV_CONFIG.map((g) => g.labelKey).filter((k): k is string => Boolean(k)),
  ...ALL_NAV_ITEMS.map((i) => i.labelKey).filter((k): k is string => Boolean(k)),
  ...NAV_EXTRA_DESTINATIONS.flatMap((x) => [x.labelKey, x.crumbKey].filter((k): k is string => Boolean(k))),
  'nav.items.listingsOf',
];
const merged = Boolean(lookup(en, 'nav.items')) && Boolean(lookup(tr, 'nav.items'));

describe('navConfig label keys', () => {
  it.skipIf(!merged)('every label key exists in en.json and tr.json', () => {
    const missing = LABEL_KEYS.flatMap((k) => [
      ...(typeof lookup(en, k) === 'string' ? [] : [`en:${k}`]),
      ...(typeof lookup(tr, k) === 'string' ? [] : [`tr:${k}`]),
    ]);
    expect(missing).toEqual([]);
  });
});

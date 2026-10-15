// Regression guard: UI test fixtures (the *messages*.ts, *-i18n.ts, *-harness.tsx and newI18nKeys.json files under test/) are
// overlaid on messages/*.json only inside tests. Any fixture key missing from the real message files renders
// as a raw key ("orders.panel.shipTo") in production, while the fixture-backed tests stay green. Values may
// differ (the message files hold the latest copy); the key must exist in both locales.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import tr from '../../messages/tr.json';
import { FIXTURES, get, leaves, type Tree } from './fixtureRegistry';

const MESSAGES: Record<'en' | 'tr', Tree> = { en: en as unknown as Tree, tr: tr as unknown as Tree };
const TEST_ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(path.relative(TEST_ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

describe('every test-fixture message exists in messages/en.json and messages/tr.json', () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    for (const locale of ['en', 'tr'] as const) {
      const leafs = leaves(fixture[locale]);
      expect(leafs.length, `${fixture.name} has no ${locale} leaves`).toBeGreaterThan(0);
      const missing = leafs.map(([p]) => p).filter((p) => {
        const v = get(MESSAGES[locale], p);
        return v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v));
      });
      expect(missing, `missing from messages/${locale}.json`).toEqual([]);
    }
  });

  it('registers every fixture file under test/', () => {
    const registered = new Set(FIXTURES.map((f) => f.name.replace(/\(.*\)$/, '')));
    const files = walk(TEST_ROOT)
      .filter((f) => /(^|\/)[^/]*messages[^/]*\.ts$|-i18n\.ts$|harness[^/]*\.tsx$|newI18nKeys\.json$/.test(f))
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('i18n/'))
      .map((f) => f.replace(/\.(ts|tsx)$/, ''));
    // Harnesses that only layer another registered fixture (no strings of their own).
    const noOwnStrings = new Set(['billing/d-harness', 'ds/m1b-harness', 'listings/tools/g6-harness', 'settings/b-harness', 'settings/c-harness']);
    const unregistered = files.filter((f) => !registered.has(f) && !noOwnStrings.has(f));
    expect(unregistered, 'add these fixtures to test/i18n/fixtureRegistry.ts').toEqual([]);
  });
});

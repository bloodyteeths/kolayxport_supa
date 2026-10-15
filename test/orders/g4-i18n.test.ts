// orders §13 G4 — `createLabel.*` key parity (EN/TR), same ICU arguments, proper Turkish characters, and no
// collision with keys already in messages/*.json.
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { flattenG4 } from './g4-messages';

const BRANCH = /\b(etsy|ebay|amazon|trendyol|wix|shopify|hepsiburada|other|one)\s*\{[^{}]*\}/g;
const args = (s: string) => Array.from(s.replace(BRANCH, '').matchAll(/\{(\w+)/g)).map((m) => m[1]).sort();

describe('createLabel.* messages', () => {
  const rows = flattenG4();
  it('every key has EN and TR text with the same arguments', () => {
    for (const r of rows) {
      expect(r.tr, r.key).not.toBe('');
      expect([...new Set(args(r.tr))], r.key).toEqual([...new Set(args(r.en))]);
    }
  });
  it('Turkish uses real characters (no ASCII transliteration)', () => {
    for (const r of rows) expect(r.tr, r.key).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
  });
  it('does not overwrite an existing different value in messages/en.json', () => {
    const existing = (en as Record<string, unknown>).createLabel as Record<string, unknown> | undefined;
    if (!existing) return;
    const get = (path: string) => path.split('.').slice(1).reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), existing);
    for (const r of rows) {
      const v = get(r.key);
      if (typeof v === 'string') expect(v, r.key).toBe(r.en);
    }
  });
});

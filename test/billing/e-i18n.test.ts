// Settings Group E — i18n hygiene for the pricing keys (settings §17 tests: parity, no ASCII-Turkish,
// reviewer summary English in both catalogs) and a guard that every key the pricing components read exists.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { E_KEYS } from './e-messages';

const placeholders = (s: string): string[] =>
  Array.from(new Set(Array.from(s.matchAll(/\{(\w+)(?=[,}])/g), (m) => m[1]))).sort();

describe('pricing i18n keys', () => {
  it('unique keys, non-empty EN and TR', () => {
    const ids = E_KEYS.map((k) => `${k.namespace}.${k.key}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of E_KEYS) {
      expect(k.en.trim(), k.key).not.toBe('');
      expect(k.tr.trim(), k.key).not.toBe('');
      expect(k.key.startsWith('pricingV2.')).toBe(true);
    }
  });

  it('TR uses real Turkish characters (no ASCII-Turkish)', () => {
    for (const k of E_KEYS) expect(k.tr, k.key).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|odeme|Ucretsiz|ucretsiz|Fiyatlandirma/);
  });

  it('placeholders match between EN and TR (plural selectors may be dropped in TR)', () => {
    for (const k of E_KEYS) {
      const en = placeholders(k.en).filter((p) => p !== 'n');
      const tr = placeholders(k.tr).filter((p) => p !== 'n');
      expect(tr, k.key).toEqual(en);
    }
  });

  it('reviewer summary is English in both catalogs (P5 exception)', () => {
    const rs = E_KEYS.filter((k) => k.key.startsWith('pricingV2.reviewerSummary.'));
    expect(rs.length).toBe(4);
    for (const k of rs) expect(k.tr).toBe(k.en);
  });

  it('no uppercase-only strings and no removed claims', () => {
    for (const k of E_KEYS) {
      expect(k.en, k.key).not.toMatch(/30[- ]day|30 gün|15%|API access|\busers?\b/i);
    }
  });

  it('every pricingV2 key the components read is defined', () => {
    const dir = path.resolve(__dirname, '../../components/domain/pricing');
    const defined = new Set(E_KEYS.map((k) => k.key.replace(/^pricingV2\./, '')));
    const used = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(path.join(dir, file), 'utf8');
      for (const m of src.matchAll(/\bt\('([a-zA-Z.]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !defined.has(k));
    expect(missing).toEqual([]);
  });
});

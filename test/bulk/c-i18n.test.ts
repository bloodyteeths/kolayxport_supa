// M7-C i18n: every literal key the bulk page uses exists (base messages + the M7-C fragment), EN/TR parity, ICU
// compiles in both locales, and no ASCII-Turkish in the TR copy (BUILD_PLAN §0.2).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { C_EN, C_TR, flatKeys } from './c-messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MERGED = { en: deepMerge(en as Obj, C_EN as Obj), tr: deepMerge(tr as Obj, C_TR as Obj) };
const get = (m: Obj, key: string): unknown => key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Obj)[p] : undefined), m);

const FILES = [
  'components/domain/bulk/BulkEditPage.tsx',
  'components/domain/bulk/BulkBanner.tsx',
  'components/domain/bulk/BulkToolbar.tsx',
  'components/domain/bulk/config/fields.ts',
  'components/domain/bulk/config/columns.tsx',
];

function literalKeys(): string[] {
  const keys = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'((?:bulk|listings|etsy)\.[A-Za-z0-9_.]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/'(bulk\.col\.[a-z]+)'/g)) keys.add(m[1]);
  }
  for (const v of ['all', 'edited', 'invalid']) keys.add(`bulk.show.${v}`);
  for (const a of ['deactivate', 'activate', 'renew']) keys.add(`listings.action.${a}`);
  return Array.from(keys).sort();
}

describe('M7-C i18n', () => {
  it('every key used by the bulk page resolves in EN and TR', () => {
    const missing = literalKeys().filter((k) => typeof get(MERGED.en, k) !== 'string' || typeof get(MERGED.tr, k) !== 'string');
    expect(missing).toEqual([]);
  });
  it('EN/TR parity of the fragment and ICU compiles', () => {
    const rows = flatKeys();
    expect(rows.length).toBeGreaterThan(40);
    for (const { key, en: e, tr: t } of rows) {
      expect(t, key).not.toBe('');
      for (const [locale, text] of [['en', e], ['tr', t]] as const) {
        const errors: string[] = [];
        const tt = createTranslator({ locale, messages: { x: { y: text } } as never, onError: (err) => errors.push(err.message) });
        tt('x.y' as never, { count: 2, listings: 3, edits: 4, rows: 1, cols: 1, invalid: 0, skipped: 0, page: 1, pages: 1, done: 1, total: 2, time: '10:42', to: 'Etsy', on: 'Etsy', marketplace: 'Etsy', qty: 7, reason: 'r', currency: 'EUR' } as never);
        expect(errors, `${locale} ${key}`).toEqual([]);
      }
    }
  });
  it('no ASCII-Turkish in TR copy', () => {
    const bad = flatKeys().filter(({ tr: t }) => /Olustur|Gonder|Siparis|Iptal|Odeme|gonder|duzen|Duzen/.test(t));
    expect(bad).toEqual([]);
  });
  it('fragment keys do not collide with existing base messages', () => {
    const clash = flatKeys().filter(({ key }) => get(en as Obj, `bulk.${key}`) !== undefined && get(en as Obj, `bulk.${key}`) !== get(C_EN, `bulk.${key}`));
    expect(clash).toEqual([]);
  });
});

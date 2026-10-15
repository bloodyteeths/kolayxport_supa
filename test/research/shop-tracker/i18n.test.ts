// research R3-B i18n: EN/TR parity of the returned keys, ICU syntax in both locales, no ASCII-Turkish, and every key
// the Shop tracker source uses resolves against messages/*.json + the returned keys.
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { ALERT_KEYS } from '@/components/domain/research/shops/shopModel';
import { KNOWN_REASON_KEYS } from '@/lib/research/hooks/useWatches';
import { SHOPS_EN, SHOPS_TR, flattenKeys } from './messages';
import { PORT_EN, PORT_TR } from '../legacy-port-messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MERGED = {
  en: deepMerge(deepMerge(en as Obj, SHOPS_EN as Obj), PORT_EN as unknown as Obj),
  tr: deepMerge(deepMerge(tr as Obj, SHOPS_TR as Obj), PORT_TR as unknown as Obj),
};
const PARAMS = { count: 2, value: '14.3', used: 3, limit: 10, marketplace: 'Etsy', shop: 'WoodAndWords', year: '2021', rating: '4.9', date: '1 Oct', tag: 'recipe box', items: 3, days: 6.5 };

describe('R3-B keys', () => {
  const keys = flattenKeys(SHOPS_EN, SHOPS_TR);

  it('EN and TR have the same keys, none empty', () => {
    expect(flattenKeys(SHOPS_TR, SHOPS_TR).map((k) => k.key).sort()).toEqual(flattenKeys(SHOPS_EN, SHOPS_EN).map((k) => k.key).sort());
    for (const k of keys) {
      expect(k.en, k.key).not.toBe('');
      expect(k.tr, k.key).not.toBe('');
    }
  });

  it('every message formats in both locales (ICU syntax)', () => {
    for (const locale of ['en', 'tr'] as const) {
      const errors: string[] = [];
      const t = createTranslator({ locale, messages: MERGED[locale], onError: (e) => errors.push(e.message) });
      for (const k of keys) t(k.key as never, PARAMS as never);
      expect(errors).toEqual([]);
    }
  });

  it('Turkish uses proper characters (no ASCII-Turkish)', () => {
    for (const k of keys) expect(k.tr, k.key).not.toMatch(/Olustur|Gonder|Magaza|Ilan |Satis |Uyari|Izle/);
  });

  it('every static key in the Shop tracker source resolves', () => {
    const t = createTranslator({ locale: 'en', messages: MERGED.en, onError: () => {} });
    const has = (k: string) => (t as unknown as { has: (k: string) => boolean }).has(k);
    const root = path.resolve(__dirname, '../../..');
    const files = [
      ...readdirSync(path.join(root, 'components/domain/research/shops')).map((f) => path.join(root, 'components/domain/research/shops', f)),
      path.join(root, 'lib/research/hooks/useWatches.ts'),
    ];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/'(research\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
    for (const k of ALERT_KEYS) used.add(`research.shops.alert.${k}`);
    expect(used.size).toBeGreaterThan(50);
    for (const k of used) expect(has(k), k).toBe(true);
  });

  it('every guard reason key the server (R3-A watchAdapter) can send resolves, and the client allow-list covers it', () => {
    const t = createTranslator({ locale: 'en', messages: MERGED.en, onError: () => {} });
    const has = (k: string) => (t as unknown as { has: (k: string) => boolean }).has(k);
    const root = path.resolve(__dirname, '../../..');
    const src = readFileSync(path.join(root, 'lib/research/watchAdapter.ts'), 'utf8');
    const reasons = new Set<string>();
    // ok(value, kind, 'key') / na('key') / NA_METRICS('key')
    for (const m of src.matchAll(/\b(?:na|NA_METRICS)\(\s*'(research\.[A-Za-z0-9_.]+)'/g)) reasons.add(m[1]);
    for (const m of src.matchAll(/\bok\([^;]*?'(research\.[A-Za-z0-9_.]+)'/g)) reasons.add(m[1]);
    for (const m of src.matchAll(/'(research\.shops\.(?:anomaly|noRecentReading|pointsDropped|atLeast))'/g)) reasons.add(m[1]);
    expect(reasons.size).toBeGreaterThan(10);
    for (const k of reasons) {
      expect(has(k), k).toBe(true);
      expect(KNOWN_REASON_KEYS, k).toContain(k);
    }
    for (const k of KNOWN_REASON_KEYS) expect(has(k), k).toBe(true);
  });
});

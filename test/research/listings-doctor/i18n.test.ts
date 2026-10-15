// research R1-D i18n: EN/TR parity of the returned keys, ICU syntax in both locales, no ASCII-Turkish, and every
// key the doctor builds dynamically (issue labels, sort, health bands, fix labels) resolves.
import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import tr from '@/messages/tr.json';
import { DOCTOR_ISSUE_IDS, DOCTOR_HEALTH_BANDS, DOCTOR_SORTS, fixLabelKeyFor, PEER_CHECK_IDS } from '@/components/domain/research/listings/doctorModel';
import { DOCTOR_EN, DOCTOR_TR, flattenKeys } from './messages';

type Obj = Record<string, unknown>;
function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k] as Obj, v as Obj) : v;
  }
  return out;
}
const MERGED = { en: deepMerge(en as Obj, DOCTOR_EN as Obj), tr: deepMerge(tr as Obj, DOCTOR_TR as Obj) };
const PARAMS = { count: 2, value: '2', n: 48, keyword: 'baby name puzzle', title: 'Box', from: '$58.00', to: '$42.00', time: '06:00', date: '1 Oct', marketplace: 'Etsy', reason: 'x', stats: 'a · b', skipped: 1, done: 3, total: 25, max: 25 };

describe('R1-D keys', () => {
  const keys = flattenKeys(DOCTOR_EN, DOCTOR_TR);

  it('EN and TR have the same keys, none empty', () => {
    const enKeys = flattenKeys(DOCTOR_EN, DOCTOR_EN).map((k) => k.key).sort();
    const trKeys = flattenKeys(DOCTOR_TR, DOCTOR_TR).map((k) => k.key).sort();
    expect(trKeys).toEqual(enKeys);
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
    for (const k of keys) expect(k.tr, k.key).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Duzelt|Ilan |Gorun|Satis /);
  });

  it('dynamic keys resolve: issues, sorts, health bands, fix labels', () => {
    const t = createTranslator({ locale: 'en', messages: MERGED.en, onError: () => {} });
    const has = (k: string) => (t as unknown as { has: (k: string) => boolean }).has(k);
    for (const id of DOCTOR_ISSUE_IDS) expect(has(`research.doc.issue.${id}`), id).toBe(true);
    for (const s of DOCTOR_SORTS) expect(has(`research.doc.sort.${s}`), s).toBe(true);
    for (const b of DOCTOR_HEALTH_BANDS) expect(has(`research.doc.filter.healthBand.${b}`), b).toBe(true);
    for (const id of [...PEER_CHECK_IDS, 'description', 'title_length']) expect(has(fixLabelKeyFor({ id })), id).toBe(true);
  });
});

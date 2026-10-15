// M9 Group D i18n: every `reports.*` key the Profit components use exists in EN and TR (the newI18nKeys handed to
// the integrator), EN/TR have the same keys, keys shared with Group E carry the same wording, and the Turkish copy
// has no ASCII-Turkish (BUILD_PLAN §0.2 check).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { D_EN, D_TR } from './d-messages';
import { E_EN, E_TR } from './e-messages';

type Obj = Record<string, unknown>;
const flat = (o: Obj, pre = ''): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (v && typeof v === 'object') Object.assign(acc, flat(v as Obj, `${pre}${k}.`));
    else acc[`${pre}${k}`] = String(v);
    return acc;
  }, {});
const DIR = path.resolve(__dirname, '../../components/domain/reports/profit');

describe('reports (group D) i18n keys', () => {
  const enKeys = flat(D_EN.reports as Obj);
  const trKeys = flat(D_TR.reports as Obj);

  it('EN and TR have the same keys', () => {
    expect(Object.keys(enKeys).sort()).toEqual(Object.keys(trKeys).sort());
  });

  it('every literal key used in the Profit components exists', () => {
    const used = new Set<string>();
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(path.join(DIR, file), 'utf8');
      if (!src.includes("useTranslations('reports')")) continue;
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/'(profit\.line\.[a-zA-Z]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(60);
    for (const k of used) expect(k in enKeys, k).toBe(true);
  });

  it('dynamic keys exist (granularity, skip reasons)', () => {
    for (const g of ['hour', 'day', 'week', 'month']) expect(`granularity.${g}` in enKeys).toBe(true);
    for (const r of ['noCode', 'badCost']) expect(`costs.reason.${r}` in enKeys).toBe(true);
  });

  it('keys shared with group E have the same wording', () => {
    const eEn = flat(E_EN.reports as Obj);
    const eTr = flat(E_TR.reports as Obj);
    for (const [k, v] of Object.entries(enKeys)) if (k in eEn) expect(eEn[k], k).toBe(v);
    for (const [k, v] of Object.entries(trKeys)) if (k in eTr) expect(eTr[k], k).toBe(v);
  });

  it('Turkish copy uses real Turkish characters', () => {
    const all = Object.values(trKeys).join('\n');
    expect(all).not.toMatch(/\b(Olustur|Gonder|Siparis|Iptal|Odeme|odeme|maliyetı|Kar\b|Urun|urun)/);
  });
});

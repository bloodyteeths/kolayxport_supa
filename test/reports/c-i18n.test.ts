// M9 Group C i18n: every literal `reports.*` key the Reports frame and the Sales tab use exists in the C fragment, EN/TR
// parity, ICU compiles in both locales, and no ASCII-Turkish in the TR copy (BUILD_PLAN §0.2).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createTranslator } from 'next-intl';
import { C_EN, C_TR, flatKeys } from './c-messages';

type Obj = Record<string, unknown>;
const get = (m: Obj, key: string): unknown => key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Obj)[p] : undefined), m);

const FILES = [
  'components/domain/reports/ReportsPage.tsx',
  'components/domain/reports/sales/SalesReport.tsx',
  'components/domain/reports/sales/SalesKpis.tsx',
  'components/domain/reports/sales/SalesTrendChart.tsx',
  'components/domain/reports/sales/StoreTable.tsx',
  'components/domain/reports/sales/TopProductsTable.tsx',
  'components/domain/reports/sales/StatusSummary.tsx',
];

function literalKeys(): string[] {
  const keys = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
  }
  // Template keys: tabs.${k}, granularity.${g}.
  for (const k of ['sales', 'profit', 'payouts', 'transactions']) keys.add(`tabs.${k}`);
  for (const g of ['hour', 'day', 'week', 'month']) keys.add(`granularity.${g}`);
  return Array.from(keys).sort();
}

describe('M9-C i18n', () => {
  it('every key used by the Reports frame and Sales resolves in EN and TR', () => {
    const keys = literalKeys();
    expect(keys.length).toBeGreaterThan(50);
    const missing = keys.filter((k) => typeof get(C_EN.reports as Obj, k) !== 'string' || typeof get(C_TR.reports as Obj, k) !== 'string');
    expect(missing).toEqual([]);
  });

  it('EN/TR parity and ICU compiles', () => {
    for (const { key, en: e, tr: t } of flatKeys()) {
      expect(t, key).not.toBe('');
      for (const [locale, text] of [['en', e], ['tr', t]] as const) {
        const errors: string[] = [];
        const tt = createTranslator({ locale, messages: { x: { y: text } } as never, onError: (err) => errors.push(err.message) });
        tt('x.y' as never, { count: 2, time: '10:42', source: 'exchangerate-api.com', date: '15 Oct', range: '1–31 Aug', symbol: '₺', name: 'Etsy', currencies: 'USD', q: 'box', days: 30 } as never);
        expect(errors, `${locale} ${key}`).toEqual([]);
      }
    }
  });

  it('no ASCII-Turkish in TR copy', () => {
    const bad = flatKeys().filter(({ tr: t }) => /\b(Olustur|Gonder|Siparis|Iptal|Odeme|Magaza|Satis|Urun|Guncelle|Doviz)/.test(t));
    expect(bad).toEqual([]);
  });
});

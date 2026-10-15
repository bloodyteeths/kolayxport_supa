import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { m1cKeyRows } from './m1c-messages';

const ROOT = join(__dirname, '../..');
const DIRS = ['components/ds/overlay', 'components/ds/feedback', 'components/ds/state'];

describe('M1-c i18n keys', () => {
  const rows = m1cKeyRows();

  it('EN and TR have the same keys and no empty values', () => {
    for (const r of rows) {
      expect(r.en, `${r.namespace}.${r.key} en`).toBeTruthy();
      expect(r.tr, `${r.namespace}.${r.key} tr`).toBeTruthy();
    }
  });

  it('TR uses real Turkish characters (no ASCII-Turkish)', () => {
    for (const r of rows) expect(r.tr).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Yukleniyor|Degisiklik|Kaydedilmemis/);
  });

  it('every t(...) key used in M1-c components exists', () => {
    const known = new Set(rows.map((r) => `${r.namespace}.${r.key}`));
    const missing: string[] = [];
    for (const dir of DIRS) {
      for (const f of readdirSync(join(ROOT, dir)).filter((x) => /\.tsx?$/.test(x))) {
        const src = readFileSync(join(ROOT, dir, f), 'utf8');
        const ns = [...src.matchAll(/useTranslations\('([^']+)'\)/g)].map((x) => x[1]);
        if (ns.length !== 1) continue;
        for (const call of src.matchAll(/\bt(?:\.rich)?\('([^'`]+)'/g)) {
          const full = `${ns[0]}.${call[1]}`;
          if (!known.has(full)) missing.push(`${f}: ${full}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

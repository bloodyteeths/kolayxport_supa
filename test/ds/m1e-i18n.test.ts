import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { flattenM1eKeys } from './m1e-messages';
import enMessages from '../../messages/en.json';

const ROOT = join(__dirname, '../..');
const DIRS = ['components/ds/page', 'components/ds/toolbar'];

function sources(): { file: string; src: string }[] {
  return DIRS.flatMap((d) =>
    readdirSync(join(ROOT, d))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => ({ file: `${d}/${f}`, src: readFileSync(join(ROOT, d, f), 'utf8') })),
  );
}

describe('M1-e i18n', () => {
  it('EN and TR have the same keys, none empty, no ASCII-Turkish', () => {
    for (const row of flattenM1eKeys()) {
      expect(row.tr, `${row.namespace}.${row.key}`).toBeTruthy();
      expect(row.en, `${row.namespace}.${row.key}`).toBeTruthy();
      expect(row.tr).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Gorunum|Secili|Tumu/);
    }
  });

  it('every t(key) used in components/ds/page|toolbar exists in its namespace (merged messages/en.json)', () => {
    const tree = enMessages as unknown as Record<string, Record<string, Record<string, string>>>;
    for (const { file, src } of sources()) {
      const ns = /useTranslations\('ds\.(\w+)'\)/.exec(src)?.[1];
      if (!ns) continue;
      for (const m of src.matchAll(/\bt\('([A-Za-z]+)'/g)) {
        expect(tree.ds[ns]?.[m[1]], `${file}: ds.${ns}.${m[1]}`).toBeTypeOf('string');
      }
    }
  });

  it('no uppercase / gradient / hex colors in the M1-e sources', () => {
    for (const { file, src } of sources()) {
      expect(src, file).not.toMatch(/uppercase|linear-gradient|radial-gradient/);
      expect(src, file).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/);
    }
  });
});

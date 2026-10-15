// M7-E PhotoStudio i18n: every `photoStudio.*` key the components use exists in EN and TR (the newI18nKeys handed
// to the integrator), EN/TR have the same keys, the namespace is new (no collision with messages/*.json), and the
// Turkish copy has no ASCII-Turkish (BUILD_PLAN §0.2 check).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { psEn, psTr } from './messages';
import { STUDIO_FILTERS, STUDIO_OPS } from '@/components/domain/photo-studio/studioModel';

type Obj = Record<string, unknown>;
const flat = (o: Obj, pre = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v as Obj, `${pre}${k}.`) : [`${pre}${k}`]));
const DIR = path.resolve(__dirname, '../../components/domain/photo-studio');

describe('photoStudio i18n keys', () => {
  const enKeys = new Set(flat(psEn.photoStudio));
  const trKeys = new Set(flat(psTr.photoStudio));

  it('EN and TR have the same keys', () => {
    expect([...enKeys].sort()).toEqual([...trKeys].sort());
  });

  it('the namespace is new (the integrator adds it as a whole)', () => {
    expect((en as Obj).photoStudio).toBeUndefined();
  });

  it('every literal key used in the components exists', () => {
    const used = new Set<string>();
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(path.join(DIR, file), 'utf8');
      // only files that read the photoStudio namespace with `t`
      if (!src.includes("useTranslations('photoStudio')")) continue;
      for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(40);
    for (const k of used) expect(enKeys.has(k), k).toBe(true);
  });

  it('dynamic keys (ops, filters, skip reasons, blockers) exist', () => {
    const dynamic = [
      ...STUDIO_OPS.map((o) => `op.${o}`),
      ...STUDIO_FILTERS.map((f) => `filter.${f}`),
      ...['notLoaded', 'queuedDelete', 'sending', 'full', 'noPhotoAtPosition', 'lastPhoto', 'pendingPhoto', 'samePosition', 'noVideo', 'hasVideo', 'isSource', 'nothingToCopy', 'noAltNeeded'].map((r) => `skip.${r}`),
      ...['noSelection', 'chooseFiles', 'chooseVideo', 'enterUrl', 'enterAlt', 'pickCopySource', 'nothing', 'running'].map((b) => `blocker.${b}`),
    ];
    for (const k of dynamic) expect(enKeys.has(k), k).toBe(true);
  });

  it('Turkish copy has no ASCII-Turkish', () => {
    const text = JSON.stringify(psTr);
    expect(text).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Fotograf|Yukle|Secili|Duzenle/);
  });
});

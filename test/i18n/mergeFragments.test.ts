import { describe, it, expect } from 'vitest';
import { deepMerge, mergeFragments, relocate, leafPaths } from '@/scripts/i18n/mergeFragmentsCore';

describe('merge-fragments core', () => {
  const base = {
    en: { nav: { home: 'Home' }, notifications: { types: { a: 'A' } } },
    tr: { nav: { home: 'Ana sayfa' }, notifications: { types: { a: 'A-tr' } } },
  };

  it('appends new namespaces/leaves, keeps key order, identical values are no-ops', () => {
    const r = deepMerge({ x: { a: '1', b: '2' } }, { x: { b: '2', c: '3' }, y: { z: 'z' } });
    expect(r.conflicts).toEqual([]);
    expect(Object.keys(r.merged)).toEqual(['x', 'y']);
    expect(Object.keys(r.merged.x as object)).toEqual(['a', 'b', 'c']);
    expect(r.added).toBe(2);
  });

  it('rejects a differing existing value and shape clashes', () => {
    expect(deepMerge({ a: { b: '1' } }, { a: { b: '2' } }).conflicts).toEqual(['a.b']);
    expect(deepMerge({ a: { b: '1' } }, { a: 'x' }).conflicts).toEqual(['a']);
  });

  it('relocates notificationCenter.types to notifications.types', () => {
    const out = relocate({ notificationCenter: { types: { orderNew: 'N' }, page: { t: 'T' } } });
    expect(out).toEqual({ notificationCenter: { page: { t: 'T' } }, notifications: { types: { orderNew: 'N' } } });
  });

  it('merges en/tr pairs and reports en/tr key mismatches', () => {
    const ok = mergeFragments(base, [
      { name: 'notificationCenter', en: { notificationCenter: { types: { b: 'B' }, x: 'X' } }, tr: { notificationCenter: { types: { b: 'B-tr' }, x: 'X-tr' } } },
    ]);
    expect(ok.conflicts).toEqual([]);
    expect(ok.mismatches).toEqual([]);
    expect((ok.en.notifications as any).types).toEqual({ a: 'A', b: 'B' });
    expect((ok.tr as any).notificationCenter).toEqual({ x: 'X-tr' });

    const bad = mergeFragments(base, [{ name: 'stockSync', en: { stockSync: { a: '1', b: '2' } }, tr: { stockSync: { a: '1' } } }]);
    expect(bad.mismatches).toEqual(['stockSync: only in en: stockSync.b']);

    const conflict = mergeFragments(base, [{ name: 'x', en: { nav: { home: 'HOME' } }, tr: { nav: { home: 'Ana sayfa' } } }]);
    expect(conflict.conflicts).toEqual(['x (en): nav.home']);

    const missing = mergeFragments(base, [{ name: 'y', en: { y: { a: '1' } }, tr: null }]);
    expect(missing.mismatches).toEqual(['y: missing tr fragment']);
  });

  it('the real notificationCenter fragments have identical en/tr key sets', async () => {
    const en = (await import('@/messages/fragments/notificationCenter.en.json')).default;
    const tr = (await import('@/messages/fragments/notificationCenter.tr.json')).default;
    expect(leafPaths(en).sort()).toEqual(leafPaths(tr).sort());
  });
});

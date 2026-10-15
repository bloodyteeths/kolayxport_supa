import { describe, expect, it } from 'vitest';
import { defaultUiFlags, parseUiOverride, resolveUiFlag, UI_FLAG_KEYS } from '@/lib/ds/uiFlags';

describe('uiFlags', () => {
  it('declares every surface key once', () => {
    expect(new Set(UI_FLAG_KEYS).size).toBe(UI_FLAG_KEYS.length);
    for (const k of ['orders', 'settings', 'pricing']) expect(UI_FLAG_KEYS).toContain(k);
  });

  it('parses NEXT_PUBLIC_UI_V2 comma lists, ignoring unknown keys', () => {
    expect([...defaultUiFlags('orders, Settings,nope')]).toEqual(['orders', 'settings']);
    expect(defaultUiFlags(undefined).size).toBe(0);
    expect(defaultUiFlags('all').size).toBe(UI_FLAG_KEYS.length);
  });

  it('parses ?ui= overrides', () => {
    expect(parseUiOverride('2')).toEqual({ mode: 'all-on' });
    expect(parseUiOverride('1')).toEqual({ mode: 'all-off' });
    expect(parseUiOverride('0')).toBeNull();
    expect(parseUiOverride('orders')).toEqual({ mode: 'list', keys: ['orders'] });
    expect(parseUiOverride('garbage')).toBeUndefined();
  });

  it('resolves override over build default', () => {
    const defaults = defaultUiFlags('settings');
    expect(resolveUiFlag('settings', defaults, null)).toBe(true);
    expect(resolveUiFlag('orders', defaults, null)).toBe(false);
    expect(resolveUiFlag('orders', defaults, { mode: 'all-on' })).toBe(true);
    expect(resolveUiFlag('settings', defaults, { mode: 'all-off' })).toBe(false);
    expect(resolveUiFlag('orders', defaults, { mode: 'list', keys: ['orders'] })).toBe(true);
  });
});

// Per-surface UI flags (DS §7.1.5, BUILD_PLAN §2). Every key is declared here once; nobody adds keys later.
// Sources, strongest first:
//   1. `?ui=` query override, persisted in localStorage (try/catch: private windows / blocked storage):
//        ?ui=2            every surface on      ?ui=1  every surface off
//        ?ui=orders,bulk  only those surfaces on (unlisted keys fall back to the build default)
//        ?ui=0 | ?ui=reset  forget the override
//   2. `NEXT_PUBLIC_UI_V2` — comma list inlined at build time (`orders,settings`, or `all`).
// The hook renders the build default on the server and on the first client render (no hydration
// mismatch), then applies the override in an effect.
import { useEffect, useState } from 'react';

export const UI_FLAG_KEYS = [
  'orders',
  'settings',
  'pricing',
  'listings-etsy',
  'listings-ebay',
  'listings-trendyol',
  'listings-wix',
  'listings-shopify',
  'editor-etsy',
  'editor-ebay',
  'editor-trendyol',
  'editor-wix',
  'editor-shopify',
  'bulk',
  'photo-studio',
  'overview',
  'messages',
  'reports',
  'research',
] as const;

export type UiFlagKey = (typeof UI_FLAG_KEYS)[number];

export const UI_OVERRIDE_STORAGE_KEY = 'kx-ui-override';

type Override = { mode: 'all-on' } | { mode: 'all-off' } | { mode: 'list'; keys: UiFlagKey[] };

function isFlagKey(value: string): value is UiFlagKey {
  return (UI_FLAG_KEYS as readonly string[]).includes(value);
}

function parseList(raw: string | undefined | null): UiFlagKey[] {
  if (!raw) return [];
  const parts = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes('all')) return [...UI_FLAG_KEYS];
  return parts.filter(isFlagKey);
}

/** Build-time default from NEXT_PUBLIC_UI_V2 (must be referenced literally so Next inlines it). */
export function defaultUiFlags(env: string | undefined = process.env.NEXT_PUBLIC_UI_V2): Set<UiFlagKey> {
  return new Set(parseList(env));
}

/** Parses a `?ui=` value. `null` = forget the override; `undefined` = value not understood. */
export function parseUiOverride(value: string): Override | null | undefined {
  const v = value.trim().toLowerCase();
  if (v === '2' || v === 'on' || v === 'all') return { mode: 'all-on' };
  if (v === '1' || v === 'off') return { mode: 'all-off' };
  if (v === '0' || v === 'reset' || v === 'clear') return null;
  const keys = parseList(v);
  return keys.length ? { mode: 'list', keys } : undefined;
}

export function resolveUiFlag(key: UiFlagKey, defaults: Set<UiFlagKey>, override: Override | null): boolean {
  if (!override) return defaults.has(key);
  if (override.mode === 'all-on') return true;
  if (override.mode === 'all-off') return false;
  return override.keys.includes(key) || defaults.has(key);
}

function readStoredOverride(): Override | null {
  try {
    const raw = window.localStorage.getItem(UI_OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseUiOverride(raw);
    return parsed ?? null;
  } catch {
    return null;
  }
}

function writeStoredOverride(raw: string | null): void {
  try {
    if (raw === null) window.localStorage.removeItem(UI_OVERRIDE_STORAGE_KEY);
    else window.localStorage.setItem(UI_OVERRIDE_STORAGE_KEY, raw);
  } catch {
    /* storage blocked — the override still applies to this page view */
  }
}

/** Reads the `?ui=` query (persisting it) or the stored override. Client only. */
export function readClientUiOverride(): Override | null {
  if (typeof window === 'undefined') return null;
  let query: string | null = null;
  try {
    query = new URLSearchParams(window.location.search).get('ui');
  } catch {
    query = null;
  }
  if (query !== null) {
    const parsed = parseUiOverride(query);
    if (parsed === null) {
      writeStoredOverride(null);
      return null;
    }
    if (parsed !== undefined) {
      writeStoredOverride(query.trim().toLowerCase());
      return parsed;
    }
  }
  return readStoredOverride();
}

export function useUiFlag(key: UiFlagKey): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => defaultUiFlags().has(key));
  useEffect(() => {
    setEnabled(resolveUiFlag(key, defaultUiFlags(), readClientUiOverride()));
  }, [key]);
  return enabled;
}

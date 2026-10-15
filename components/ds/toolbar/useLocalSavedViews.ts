// Per-viewer saved views in localStorage (orders §1.3: "Stored in localStorage per viewer"; server
// views are out of scope). Every storage access is wrapped: private mode / blocked storage → in-memory.
import { useCallback, useEffect, useState } from 'react';
import type { SavedView } from './types';

const PREFIX = 'kx.views.';
const MAX_VIEWS = 20;

function read(key: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v) => v && typeof v.id === 'string' && typeof v.label === 'string')
      .map((v) => ({ id: v.id, label: v.label, query: v.query ?? {}, builtIn: false as const }));
  } catch {
    return [];
  }
}

function write(key: string, views: SavedView[]) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(views.map(({ id, label, query }) => ({ id, label, query }))));
  } catch {
    // storage unavailable: keep the in-memory list
  }
}

export type LocalSavedViews = {
  views: SavedView[];
  save: (label: string, query: Record<string, string | string[]>) => SavedView;
  remove: (id: string) => void;
};

/** `storageKey` scopes the list per surface, e.g. "orders" or "listings.etsy". */
export function useLocalSavedViews(storageKey: string): LocalSavedViews {
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    setViews(read(storageKey));
  }, [storageKey]);

  const save = useCallback(
    (label: string, query: Record<string, string | string[]>) => {
      const view: SavedView = { id: `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, query, builtIn: false };
      setViews((prev) => {
        const next = [...prev, view].slice(-MAX_VIEWS);
        write(storageKey, next);
        return next;
      });
      return view;
    },
    [storageKey],
  );

  const remove = useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== id);
        write(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return { views, save, remove };
}

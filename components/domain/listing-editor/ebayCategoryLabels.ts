// components/domain/listing-editor/ebayCategoryLabels.ts — eBay category id → display name, shared by every
// writer of the eBay `categoryId` field and the Details section's category field.
//
// The eBay editor stores only `categoryId` (the Inventory API offer field); the name is display-only. The Details
// section learned names only from its own searches, so a category the AI fill applied (from `category_suggestions`)
// showed "Category #262366" instead of "Bowls". Writers that know the name remember it here; the section reads it
// and, for an id nobody named in this session (reload, existing listing), asks `category_info` once.
import { useSyncExternalStore } from 'react';

const labels = new Map<string, string>();
const listeners = new Set<() => void>();

export function rememberEbayCategoryLabel(id: unknown, name: unknown): void {
  const key = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '';
  const label = typeof name === 'string' ? name.trim() : '';
  if (!key || !label || labels.get(key) === label) return;
  labels.set(key, label);
  listeners.forEach((l) => l());
}

export function rememberEbayCategoryLabels(entries: Iterable<readonly [string, string]>): void {
  for (const [id, name] of entries) rememberEbayCategoryLabel(id, name);
}

export function ebayCategoryLabel(id: string | null | undefined): string | undefined {
  return id ? labels.get(String(id)) : undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The remembered name of `id` (re-renders when one arrives). */
export function useEbayCategoryLabel(id: string | null | undefined): string | undefined {
  return useSyncExternalStore(subscribe, () => ebayCategoryLabel(id), () => undefined);
}

/** Test seam. */
export function clearEbayCategoryLabels(): void {
  labels.clear();
}

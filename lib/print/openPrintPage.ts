// lib/print/openPrintPage.ts — orders §2.3 / §12: opens the existing print pages
// (`/app/print/packing-slips?ids=`, `/app/print/pick-list?ids=`) for a selection. Replaces
// `components/print/PrintSelectionActions.tsx` (kept for the legacy page until it is deleted).
//
// Popup rule: call it synchronously inside the click handler (no await before it), so pop-up blockers treat
// the new tab as a user gesture. Pure apart from `window.open`; the caller shows the returned outcome.
import { PRINT_MAX_IDS } from '@/components/print/types';

export type PrintPageKind = 'packing-slips' | 'pick-list';

export type OpenPrintPageResult =
  /** Opened with every id. */
  | { ok: true; truncated: false; opened: number }
  /** Opened with the first `PRINT_MAX_IDS` ids only (caller shows `printSlips.truncated`). */
  | { ok: true; truncated: true; opened: number; max: number }
  /** Nothing to print. */
  | { ok: false; reason: 'empty' }
  /** The browser blocked the tab (caller shows `printSlips.popupBlocked`). */
  | { ok: false; reason: 'blocked' };

export { PRINT_MAX_IDS };

/** The print page URL for at most `PRINT_MAX_IDS` unique, non-empty order ids. */
export function printPageUrl(kind: PrintPageKind, orderIds: readonly string[]): string {
  const ids = uniqueIds(orderIds).slice(0, PRINT_MAX_IDS);
  return `/app/print/${kind}?ids=${encodeURIComponent(ids.join(','))}`;
}

function uniqueIds(orderIds: readonly string[]): string[] {
  return Array.from(new Set(orderIds.map((id) => String(id ?? '').trim()).filter(Boolean)));
}

export function openPrintPage(
  kind: PrintPageKind,
  orderIds: readonly string[],
  opener: (url: string, target: string) => Window | null = (url, target) => window.open(url, target),
): OpenPrintPageResult {
  const ids = uniqueIds(orderIds);
  if (ids.length === 0) return { ok: false, reason: 'empty' };
  const win = opener(printPageUrl(kind, ids), '_blank');
  if (!win) return { ok: false, reason: 'blocked' };
  try {
    win.opener = null;
  } catch {
    /* cross-origin guard; ignore */
  }
  if (ids.length > PRINT_MAX_IDS) return { ok: true, truncated: true, opened: PRINT_MAX_IDS, max: PRINT_MAX_IDS };
  return { ok: true, truncated: false, opened: ids.length };
}

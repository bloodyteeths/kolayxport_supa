// components/domain/listings/useListingsShortcuts.ts — listings-grid §8 page shortcuts (G5).
// Row keys (j/k/↑/↓, x, ⌘A, Enter, e, Esc) are DataTable's; `/` is the SearchField's; ⌘S / ⌘↵ / j / k inside the
// quick view are the SidePanel's. This hook adds the page-level ones and publishes them to the `?` sheet.
import { useShortcuts } from '@/lib/ds/useShortcuts';

export type ListingsShortcutsOptions = {
  /** "Send N changes" (⌘↵ on the page). Omitted / disabled when N = 0 or Send is disabled. */
  onSend?: () => void;
  sendLabel?: string;
  /** "New listing" (`n`). Omitted when there is no create route. */
  onNew?: () => void;
  newLabel?: string;
  /** Off while a panel or modal owns the keyboard. */
  enabled?: boolean;
};

export function useListingsShortcuts({ onSend, sendLabel, onNew, newLabel, enabled = true }: ListingsShortcutsOptions): void {
  useShortcuts(
    {
      'mod+enter': onSend ? { handler: () => onSend(), description: sendLabel } : null,
      n: onNew ? { handler: () => onNew(), description: newLabel } : null,
    },
    { scope: 'page', enabled, describe: true },
  );
}

export default useListingsShortcuts;

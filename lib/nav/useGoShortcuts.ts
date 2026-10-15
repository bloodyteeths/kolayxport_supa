// lib/nav/useGoShortcuts.ts — `g` then a letter (shell-nav §7): h Home, o Orders, l first listings row,
// m Messages, r Research, p Reports (once it exists), f Finance, s Settings. The map is `NavModel.goShortcuts`
// (group A), which only holds visible destinations, so a hidden row never gets a chord.
//
// Matching goes through `useShortcuts` (KeyboardEvent.key lowercased with the 'en' locale, so Turkish Q and
// F layouts work; never inside text fields; second key within 1s). The hook also reports `pending` for that
// second, so the shell can show the small "g …" hint (`GoShortcutHint` in components/ds/shell/CommandPalette).
// Call it once, in AppShell: `const { pending } = useGoShortcuts(model.goShortcuts)`.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useShortcuts, type ShortcutMap } from '@/lib/ds/useShortcuts';
import type { GoShortcut } from './useNavModel';

/** Same window as useShortcuts' sequence timeout. */
export const GO_SEQUENCE_MS = 1000;

/** Pure: `{ 'g o': handler, … }`; the first shortcut wins on a duplicate key; keys are lowercased. */
export function goShortcutMap(shortcuts: readonly GoShortcut[], navigate: (href: string) => void): ShortcutMap {
  const map: ShortcutMap = {};
  for (const s of shortcuts) {
    const key = String(s.key || '').toLocaleLowerCase('en');
    if (key.length !== 1 || key === ' ') continue;
    const combo = `g ${key}`;
    if (map[combo]) continue;
    // Returning false leaves the key alone (no navigation, no preventDefault) while an overlay is open.
    map[combo] = {
      handler: (e: KeyboardEvent) => {
        if (overlayBlocksShortcuts(e?.target ?? null)) return false;
        navigate(s.href);
        return undefined;
      },
    };
  }
  return map;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return node.isContentEditable || node.getAttribute?.('contenteditable') === 'true';
}

// Dialogs, drawers, menus, popovers and listboxes. MUI renders every Dialog/Drawer/Menu/Popover/Select
// popup inside a `.MuiModal-root`; a closed keepMounted one carries `.MuiModal-hidden`.
const OVERLAY_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[aria-modal="true"],.MuiModal-root';
const OPEN_MODAL_SELECTOR = '.MuiModal-root:not(.MuiModal-hidden),[aria-modal="true"]';

/**
 * Pure-ish: is an overlay in the way of a global shortcut? True when the key comes from inside a dialog,
 * menu or listbox, or when a modal overlay is open at all (nothing registers a `modal` shortcut scope yet,
 * so the `g` chords and the palette's `/` check this themselves).
 */
export function overlayBlocksShortcuts(target: EventTarget | null, doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  const el = target as Element | null;
  if (el && typeof el.closest === 'function' && el.closest(OVERLAY_SELECTOR)) return true;
  return Boolean(doc?.querySelector?.(OPEN_MODAL_SELECTOR));
}

/** Pure: does this keydown start a `g` chord? (Shift+G does not: the binding requires no Shift.) */
export function isGoStart(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target' | 'defaultPrevented'>,
): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  if (String(e.key ?? '').toLocaleLowerCase('en') !== 'g') return false;
  if (isTypingTarget(e.target)) return false;
  return !overlayBlocksShortcuts(e.target);
}

export type UseGoShortcutsOptions = {
  enabled?: boolean;
  /** Override navigation (tests). Default `router.push(href)`. */
  navigate?: (href: string) => void;
};

export function useGoShortcuts(shortcuts: readonly GoShortcut[], options: UseGoShortcutsOptions = {}): { pending: boolean } {
  const router = useRouter();
  const enabled = (options.enabled ?? true) && shortcuts.length > 0;
  const navRef = useRef(options.navigate);
  navRef.current = options.navigate;
  const routerRef = useRef(router);
  routerRef.current = router;

  const key = shortcuts.map((s) => `${s.key}=${s.href}`).join('|');
  const map = useMemo(
    () =>
      goShortcutMap(shortcuts, (href) => {
        if (navRef.current) navRef.current(href);
        else void routerRef.current.push(href);
      }),
    // `shortcuts` is captured through `key`.
    [key],
  );
  useShortcuts(map, { scope: 'global', enabled });

  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setPending(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let armed = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      armed = false;
      setPending(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (['shift', 'control', 'meta', 'alt'].includes(String(e.key ?? '').toLowerCase())) return;
      if (armed) {
        clear();
        return;
      }
      if (!isGoStart(e)) return;
      armed = true;
      setPending(true);
      timer = setTimeout(clear, GO_SEQUENCE_MS);
    };
    // Capture phase: runs before the shortcut dispatcher can preventDefault the second key.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return { pending };
}

export default useGoShortcuts;

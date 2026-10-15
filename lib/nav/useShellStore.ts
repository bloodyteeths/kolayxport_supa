// lib/nav/useShellStore.ts — shell UI state (shell-nav §7, §11: replaces hooks/useSidebar.js).
//
// One zustand store, so SideNav, TopBar, MobileTabBar, MoreSheet and the palette share the same open/closed
// state without prop drilling. The shell is mounted once in _app (M2), so the module-level `pinnedMemo`
// hack of the legacy AppLayout is gone.
//
// Persistence: only `collapsed` (the user's choice at ≥ 1200px) is stored, under
// `localStorage['kx.sidebar.collapsed.v1'] = '1' | '0'` (try/catch: private windows and blocked storage
// fall back to the default). The old `kx.sidebar.pinned` key is ignored and removed once.
import { create } from 'zustand';

export const SIDEBAR_COLLAPSED_KEY = 'kx.sidebar.collapsed.v1';
export const LEGACY_SIDEBAR_PIN_KEY = 'kx.sidebar.pinned';

/** DS breakpoints (MUI md 900, lg 1200): mobile < 900 ≤ narrow < 1200 ≤ wide. */
export type ShellViewport = 'mobile' | 'narrow' | 'wide';

/** What the sidebar renders as. */
export type SidebarMode = 'hidden' | 'rail' | 'expanded';

export type ShellState = {
  /** User choice for ≥ 1200px. Default false (expanded). */
  collapsed: boolean;
  /** True once `hydrateCollapsed()` read storage (SideNav renders the first width without animating). */
  hydrated: boolean;
  /**
   * True for the render that applies the stored value on first mount: SideNav disables the width transition
   * while it is true (the legacy `instantRef` trick). Cleared by `clearInstant()` after paint.
   */
  instant: boolean;
  /** 900–1199px: the rail is open as an overlay (expanded over the content, `backdropPanel`). */
  overlayOpen: boolean;
  /** < 900px: the More bottom sheet. */
  moreOpen: boolean;
  /** ⌘K palette (group E). */
  paletteOpen: boolean;
  /** `?` shortcut sheet (group C). */
  shortcutsOpen: boolean;

  /** Reads storage once (call in a layout effect before paint). Removes the legacy pin key. */
  hydrateCollapsed: () => void;
  clearInstant: () => void;
  /** Sets and persists the ≥ 1200 choice. */
  setCollapsed: (collapsed: boolean) => void;
  /**
   * The `[` key and the footer toggle: at ≥ 1200 toggles (and persists) `collapsed`; at 900–1199 toggles the
   * overlay; below 900 does nothing.
   */
  toggleSidebar: (viewport: ShellViewport) => void;
  setOverlayOpen: (open: boolean) => void;
  setMoreOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setShortcutsOpen: (open: boolean) => void;
  /**
   * Route change (shell-nav §7): closes the More sheet, the overlay sidebar and the palette.
   * The shortcut sheet is a modal the user opened on purpose and is closed too.
   */
  closeTransient: () => void;
  /**
   * `Esc` order (shell-nav §7): palette → (menus/popovers close themselves) → overlay sidebar → sheet.
   * Returns true when something was closed, so the caller can stop the event.
   */
  closeTopmost: () => boolean;
};

function readCollapsed(): boolean {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts for this session only
  }
}

function removeLegacyPinKey(): void {
  try {
    window.localStorage.removeItem(LEGACY_SIDEBAR_PIN_KEY);
  } catch {
    // ignore
  }
}

export const useShellStore = create<ShellState>((set, get) => ({
  collapsed: false,
  hydrated: false,
  instant: false,
  overlayOpen: false,
  moreOpen: false,
  paletteOpen: false,
  shortcutsOpen: false,

  hydrateCollapsed: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    const collapsed = readCollapsed();
    removeLegacyPinKey();
    set({ collapsed, hydrated: true, instant: collapsed !== get().collapsed });
  },
  clearInstant: () => {
    if (get().instant) set({ instant: false });
  },
  setCollapsed: (collapsed) => {
    writeCollapsed(collapsed);
    set({ collapsed, instant: false });
  },
  toggleSidebar: (viewport) => {
    if (viewport === 'wide') get().setCollapsed(!get().collapsed);
    else if (viewport === 'narrow') set({ overlayOpen: !get().overlayOpen });
  },
  setOverlayOpen: (overlayOpen) => set({ overlayOpen }),
  setMoreOpen: (moreOpen) => set({ moreOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  closeTransient: () => {
    const s = get();
    if (s.moreOpen || s.overlayOpen || s.paletteOpen || s.shortcutsOpen) {
      set({ moreOpen: false, overlayOpen: false, paletteOpen: false, shortcutsOpen: false });
    }
  },
  closeTopmost: () => {
    const s = get();
    if (s.paletteOpen) set({ paletteOpen: false });
    else if (s.shortcutsOpen) set({ shortcutsOpen: false });
    else if (s.overlayOpen) set({ overlayOpen: false });
    else if (s.moreOpen) set({ moreOpen: false });
    else return false;
    return true;
  },
}));

/** Pure: what the sidebar renders as for a viewport and the user's choice (shell-nav §0, §3.2). */
export function resolveSidebarMode(viewport: ShellViewport, collapsed: boolean): SidebarMode {
  if (viewport === 'mobile') return 'hidden';
  if (viewport === 'narrow') return 'rail';
  return collapsed ? 'rail' : 'expanded';
}

/** Pure: viewport bucket from a width in CSS px (DS §2.10 breakpoints). */
export function viewportFromWidth(width: number): ShellViewport {
  if (width < 900) return 'mobile';
  if (width < 1200) return 'narrow';
  return 'wide';
}

/** Test helper: resets the store to its initial state. */
export function __resetShellStoreForTests(): void {
  useShellStore.setState({
    collapsed: false,
    hydrated: false,
    instant: false,
    overlayOpen: false,
    moreOpen: false,
    paletteOpen: false,
    shortcutsOpen: false,
  });
}

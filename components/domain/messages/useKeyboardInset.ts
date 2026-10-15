// components/domain/messages/useKeyboardInset.ts — messages §3.2 (group G6). iOS Safari does not shrink
// `100dvh` when the on-screen keyboard opens, so the sticky composer of the mobile thread sheet would sit
// behind it. This hook listens to `visualViewport` and publishes the covered height as the CSS variable
// `--kx-kb-inset` (on <html>), which the sheet uses as bottom padding. Returns the inset in px.
import { useEffect, useState } from 'react';

export const KB_INSET_VAR = '--kx-kb-inset';

/** Below this the difference is browser chrome (URL bar collapse), not a keyboard. */
export const KB_INSET_MIN = 80;

export interface ViewportLike {
  height: number;
  offsetTop: number;
}

/** Pure: px of the layout viewport covered by the keyboard (0 when none). */
export function keyboardInset(innerHeight: number, vv: ViewportLike | null | undefined): number {
  if (!vv || !Number.isFinite(innerHeight) || !Number.isFinite(vv.height)) return 0;
  const covered = Math.round(innerHeight - vv.height - (Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0));
  return covered >= KB_INSET_MIN ? covered : 0;
}

export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      const next = keyboardInset(window.innerHeight, vv);
      root.style.setProperty(KB_INSET_VAR, `${next}px`);
      setInset(next);
    };
    update();
    if (!vv) return () => root.style.removeProperty(KB_INSET_VAR);
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty(KB_INSET_VAR);
    };
  }, [enabled]);

  return enabled ? inset : 0;
}

export default useKeyboardInset;

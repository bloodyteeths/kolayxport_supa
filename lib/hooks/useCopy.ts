import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a hidden textarea + execCommand('copy') (older Safari, iOS
 * webviews, http:// / insecure contexts). Resolves true ONLY if the copy
 * actually succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof text !== 'string' || text.length === 0) return false;

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / document not focused — try the legacy path.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  // Keep it on-screen (iOS refuses to select off-screen nodes) but invisible,
  // and >= 16px so iOS does not zoom.
  Object.assign(ta.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    fontSize: '16px',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);
  document.body.appendChild(ta);

  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    try {
      active?.focus?.({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
  return ok;
}

export interface UseCopyOptions {
  /** Toast text on success. Default: ui.copy.copied ("Copied to clipboard"). */
  successMessage?: string;
  /** Toast text on failure. Default: ui.copy.failed. */
  errorMessage?: string;
  /** Suppress toasts (the caller shows its own feedback). */
  silent?: boolean;
  /** How long `copied` stays true, ms. Default 1500. */
  resetMs?: number;
}

export interface UseCopyResult {
  /** Copies `text`; resolves true on real success. */
  copy: (text: string | null | undefined, overrideSuccessMessage?: string) => Promise<boolean>;
  /** True briefly after a successful copy (for a check-icon state). */
  copied: boolean;
  /** The value most recently copied successfully (null after reset). */
  copiedValue: string | null;
}

export function useCopy(options: UseCopyOptions = {}): UseCopyResult {
  const t = useTranslations('ui');
  const { successMessage, errorMessage, silent = false, resetMs = 1500 } = options;
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (text: string | null | undefined, overrideSuccessMessage?: string) => {
      const value = text == null ? '' : String(text);
      const ok = value.length > 0 && (await copyText(value));
      if (ok) {
        setCopiedValue(value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiedValue(null), resetMs);
        if (!silent) notify.success(overrideSuccessMessage || successMessage || t('copy.copied'));
      } else if (!silent) {
        notify.error(errorMessage || t(value.length ? 'copy.failed' : 'copy.nothingToCopy'));
      }
      return ok;
    },
    [errorMessage, resetMs, silent, successMessage, t]
  );

  return { copy, copied: copiedValue !== null, copiedValue };
}

export default useCopy;

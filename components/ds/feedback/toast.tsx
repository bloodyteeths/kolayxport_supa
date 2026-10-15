import React, { useMemo } from 'react';
import { toast as hotToast } from 'react-hot-toast';
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { accent as a, elevation, neutral as n, radius, tone as toneTokens } from '@/lib/ds/tokens';
import { CloseIcon, DangerIcon, InfoIcon, SuccessIcon } from '../overlay/icons.internal';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  /** Default: ds.feedback.toast.retry for errors, ds.feedback.toast.undo for undo. */
  label?: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
  /** ms; `Infinity` = stays until dismissed. */
  duration: number;
  dismissLabel: string;
}

export interface ToastAdapter {
  show(item: ToastItem, onDismiss: () => void): void;
  hide(id: string): void;
}

export const TOAST_DURATION = { default: 4000, undo: 6000 } as const;
export const TOAST_MAX_CHARS = 80;

/**
 * One-visible queue (DS §3.14, tokens.md §4): a new toast replaces the visible one, unless the
 * visible one is persistent (an error), in which case the new toast waits in a queue and is shown
 * when the persistent one is dismissed. Timed toasts are dismissed by our own timer (react-hot-toast
 * gets `duration: Infinity`) so the queue always knows what is visible.
 */
export function createToastController(adapter: ToastAdapter) {
  let current: ToastItem | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: ToastItem[] = [];

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const show = (item: ToastItem) => {
    current = item;
    adapter.show(item, () => dismiss(item.id));
    if (Number.isFinite(item.duration)) timer = setTimeout(() => dismiss(item.id), item.duration);
  };

  const enqueue = (item: ToastItem): string => {
    if (!current) show(item);
    else if (!Number.isFinite(current.duration)) queue.push(item);
    else {
      clearTimer();
      adapter.hide(current.id);
      current = null;
      show(item);
    }
    return item.id;
  };

  function dismiss(id?: string): void {
    if (id === undefined) {
      queue.length = 0;
      if (current) dismiss(current.id);
      return;
    }
    if (!current || current.id !== id) {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
      return;
    }
    clearTimer();
    adapter.hide(id);
    current = null;
    const next = queue.shift();
    if (next) show(next);
  }

  return {
    enqueue,
    dismiss,
    /** Test/introspection helpers. */
    visible: () => current,
    queued: () => queue.slice(),
    reset: () => {
      clearTimer();
      if (current) adapter.hide(current.id);
      current = null;
      queue.length = 0;
    },
  };
}

const TONE_ICON = { success: SuccessIcon, error: DangerIcon, info: InfoIcon } as const;
const TONE_COLOR = { success: toneTokens.success.border, error: toneTokens.danger.border, info: a[200] } as const;

/** Toast ✕ / action buttons: 28px hit area, 44×44 on a coarse pointer (DS P3 / §2.4). */
const TOAST_BUTTON_SX = {
  background: 'transparent', border: 0, borderRadius: `${radius.sm}px`, cursor: 'pointer', flexShrink: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 28,
  '@media (pointer: coarse)': { minWidth: 44, minHeight: 44 },
} as const;

/** The toast surface: neutral-900, white 13px text, tone icon, optional action, ✕. */
export function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const Icon = TONE_ICON[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      data-testid={`toast-${item.tone}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, background: n[900], color: n[0], fontSize: 13, lineHeight: '18px',
        borderRadius: radius.md, padding: '8px 8px 8px 12px', maxWidth: 420, boxShadow: elevation.e3,
      }}
    >
      <span style={{ display: 'inline-flex', color: TONE_COLOR[item.tone], flexShrink: 0 }}>
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{item.message}</span>
      {item.action && (
        <Box
          component="button"
          type="button"
          data-testid="toast-action"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
          sx={{
            ...TOAST_BUTTON_SX, color: a[200], fontFamily: 'inherit', fontSize: 13, fontWeight: 500, px: '8px',
          }}
        >
          {item.action.label}
        </Box>
      )}
      <Box
        component="button"
        type="button"
        aria-label={item.dismissLabel}
        data-testid="toast-dismiss"
        onClick={onDismiss}
        sx={{ ...TOAST_BUTTON_SX, color: n[400], minWidth: 28, p: '4px' }}
      >
        <CloseIcon size={14} strokeWidth={1.75} aria-hidden />
      </Box>
    </div>
  );
}

const hotAdapter: ToastAdapter = {
  show(item, onDismiss) {
    hotToast.custom(<ToastView item={item} onDismiss={onDismiss} />, { id: item.id, duration: Infinity });
  },
  hide(id) {
    hotToast.dismiss(id);
  },
};

/** App-wide controller (the single `<Toaster>` in `_app`). */
export const toastController = createToastController(hotAdapter);

let seq = 0;
const nextId = () => `kx-toast-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function warnLength(message: string) {
  if (process.env.NODE_ENV !== 'production' && message.length > TOAST_MAX_CHARS) {
    console.warn(`[useToast] toast text is ${message.length} chars (max ${TOAST_MAX_CHARS}); shorten the i18n string.`);
  }
}

export interface ToastApi {
  /** 4s; with `undo` 6s and an "Undo" action. */
  success(message: string, opts?: { undo?: () => void; undoLabel?: string }): string;
  /** Persists until dismissed by default (DS §3.14); `persist: false` → 4s. `action` is Retry / Details. */
  error(message: string, opts?: { action?: ToastAction; persist?: boolean }): string;
  info(message: string, opts?: { action?: ToastAction }): string;
  /** Dismiss one toast (visible or queued), or all with no id. */
  dismiss(id?: string): void;
}

/**
 * `const toast = useToast(); toast.success(tListings('sent', { count }))`.
 * Message text must come from i18n, ≤ 80 chars; never raw API errors, JSON or AI output.
 */
export function useToast(): ToastApi {
  const t = useTranslations('ds.feedback.toast');
  return useMemo<ToastApi>(() => {
    const dismissLabel = t('dismiss');
    return {
      success(message, opts) {
        warnLength(message);
        return toastController.enqueue({
          id: nextId(), tone: 'success', message, dismissLabel,
          duration: opts?.undo ? TOAST_DURATION.undo : TOAST_DURATION.default,
          action: opts?.undo ? { label: opts.undoLabel ?? t('undo'), onClick: opts.undo } : undefined,
        });
      },
      error(message, opts) {
        warnLength(message);
        return toastController.enqueue({
          id: nextId(), tone: 'error', message, dismissLabel,
          duration: opts?.persist === false ? TOAST_DURATION.default : Infinity,
          action: opts?.action ? { label: opts.action.label ?? t('retry'), onClick: opts.action.onClick } : undefined,
        });
      },
      info(message, opts) {
        warnLength(message);
        return toastController.enqueue({
          id: nextId(), tone: 'info', message, dismissLabel, duration: TOAST_DURATION.default,
          action: opts?.action ? { label: opts.action.label ?? t('retry'), onClick: opts.action.onClick } : undefined,
        });
      },
      dismiss(id) {
        toastController.dismiss(id);
      },
    };
  }, [t]);
}

export default useToast;

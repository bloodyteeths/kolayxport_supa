/**
 * Private per-order note with autosave (orders §5 "Private note"). Port of the request-ordering logic in
 * the legacy `components/labels/OrderNoteField.tsx`:
 *  - saves 600 ms after typing stops, on blur, and on ⌘S (`flush`);
 *  - requests run strictly one after another (a promise chain), so the server applies them in the order
 *    the user typed them and responses can never arrive out of order;
 *  - an unchanged value is never sent twice; only the latest request's outcome updates the save state;
 *  - fresh server data (SWR revalidation) is adopted only while nothing is typed or in flight.
 *
 * Two deliberate differences from the legacy field (the panel shows a persistent TextArea, not a tap-to-edit chip):
 *  - on error the typed text is kept (not reverted) and the state becomes `error`; `flush()` retries;
 *  - switching orders (panel prev/next) or unmounting first sends a pending or failed edit for the previous order.
 *
 * Endpoint (unchanged): POST /api/orders/:id/updateNoteAndStatus { not: string | null } → { internalNote }.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Keep in sync with pages/api/orders/[orderId]/updateNoteAndStatus.ts. */
export const ORDER_NOTE_MAX_LENGTH = 1000;
export const NOTE_AUTOSAVE_MS = 600;

export type NoteSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseOrderNoteOptions {
  orderId: string | null;
  /** Saved note from the orders API (`senkronData.internalNote`). */
  note: string | null | undefined;
  /** After the server confirmed a save (stored value, null = cleared). Called for the order it was saved on. */
  onSaved?: (note: string | null, orderId: string) => void;
  /** The latest save failed (network error or HTTP status). */
  onError?: (err: unknown, orderId: string) => void;
  delayMs?: number;
}

export interface UseOrderNoteResult {
  value: string;
  setValue: (next: string) => void;
  /** Save now (blur, ⌘S, retry). */
  flush: () => void;
  state: NoteSaveState;
  max: number;
}

const normalize = (v: string | null | undefined) => (v ?? '').trim();

export class NoteSaveError extends Error {
  status: number;
  constructor(status: number) {
    super(`Note save failed (${status})`);
    this.name = 'NoteSaveError';
    this.status = status;
  }
}

export function useOrderNote({ orderId, note, onSaved, onError, delayMs = NOTE_AUTOSAVE_MS }: UseOrderNoteOptions): UseOrderNoteResult {
  const [value, setDraft] = useState<string>(normalize(note));
  const [state, setState] = useState<NoteSaveState>('idle');

  const draftRef = useRef(normalize(note));
  /** Last value the server accepted for the current order. */
  const confirmedRef = useRef(normalize(note));
  /** Last value queued for sending (dedupe). */
  const lastSentRef = useRef(normalize(note));
  const seqRef = useRef(0);
  const inFlightRef = useRef(0);
  /** Bumped on order switch so late responses for the previous order never touch the new state. */
  const epochRef = useRef(0);
  const orderIdRef = useRef(orderId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const cbRef = useRef({ onSaved, onError });
  cbRef.current = { onSaved, onError };

  const send = useCallback(async (id: string, v: string, seq: number, epoch: number) => {
    const current = () => epoch === epochRef.current;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/updateNoteAndStatus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        // Only the note: customStatus is left untouched by the API.
        body: JSON.stringify({ not: v || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new NoteSaveError(res.status);
      const stored = normalize((data as { internalNote?: string | null })?.internalNote ?? v);
      if (current()) {
        confirmedRef.current = stored;
        if (seq === seqRef.current) setState('saved');
      }
      cbRef.current.onSaved?.(stored || null, id);
    } catch (err) {
      if (!current()) {
        // The previous order's last save (sent on switch / close) failed: the state belongs to another
        // order now, but the user still has to hear about it.
        cbRef.current.onError?.(err, id);
      } else if (seq === seqRef.current) {
        // Let the next flush resend the typed text.
        lastSentRef.current = confirmedRef.current;
        setState('error');
        cbRef.current.onError?.(err, id);
      }
    } finally {
      if (current()) inFlightRef.current -= 1;
    }
  }, []);

  const saveFor = useCallback((id: string | null, raw: string) => {
    if (!id) return;
    const v = normalize(raw).slice(0, ORDER_NOTE_MAX_LENGTH);
    if (v === lastSentRef.current) {
      setState((s) => (s === 'dirty' ? (v === confirmedRef.current ? 'idle' : s) : s));
      return;
    }
    lastSentRef.current = v;
    const seq = ++seqRef.current;
    const epoch = epochRef.current;
    inFlightRef.current += 1;
    setState('saving');
    chainRef.current = chainRef.current.then(() => send(id, v, seq, epoch));
  }, [send]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  /** A debounce is pending, or the typed text differs from what the server accepted (e.g. after an error). */
  const unsaved = () => timerRef.current !== null || normalize(draftRef.current).slice(0, ORDER_NOTE_MAX_LENGTH) !== confirmedRef.current;

  // Order switch (prev/next) and server revalidation.
  useEffect(() => {
    const next = normalize(note);
    if (orderIdRef.current !== orderId) {
      // Send what was typed (or what failed to save) for the previous order before switching.
      if (unsaved()) {
        clearTimer();
        saveFor(orderIdRef.current, draftRef.current);
      }
      orderIdRef.current = orderId;
      epochRef.current += 1;
      inFlightRef.current = 0;
      confirmedRef.current = next;
      lastSentRef.current = next;
      draftRef.current = next;
      setDraft(next);
      setState('idle');
      return;
    }
    // Same order: adopt fresh server data only when nothing is typed or in flight.
    const typing = timerRef.current !== null || normalize(draftRef.current) !== lastSentRef.current;
    if (typing || inFlightRef.current > 0) return;
    confirmedRef.current = next;
    lastSentRef.current = next;
    draftRef.current = next;
    setDraft(next);
  }, [orderId, note, saveFor]);

  // Unmount (panel closed within the debounce, or after a failed save): send the pending edit.
  useEffect(() => () => {
    if (unsaved()) {
      clearTimer();
      saveFor(orderIdRef.current, draftRef.current);
    }
  }, [saveFor]);

  const setValue = useCallback((raw: string) => {
    const next = raw.slice(0, ORDER_NOTE_MAX_LENGTH);
    draftRef.current = next;
    setDraft(next);
    setState('dirty');
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveFor(orderIdRef.current, next);
    }, delayMs);
  }, [delayMs, saveFor]);

  const flush = useCallback(() => {
    clearTimer();
    saveFor(orderIdRef.current, draftRef.current);
  }, [saveFor]);

  return { value, setValue, flush, state, max: ORDER_NOTE_MAX_LENGTH };
}

export default useOrderNote;

/**
 * Lightweight outbox helpers imported by lib/notifications.ts (owner W5).
 *
 * Kept separate from dispatcher.ts so every module that calls notify() does
 * not statically pull in the email renderer (messages/*.json) — the
 * dispatcher is loaded lazily on the first kick.
 */
import { logger } from '@/lib/logger';

/** Delivery statuses that are still waiting to go out. */
export const OPEN_DELIVERY_STATUSES = ['pending', 'held', 'digest'] as const;

let kickTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let rerun = false;
const KICK_DEBOUNCE_MS = 1500;

/** In-process sending after notify(). Off in tests and with KX_DISABLE_INPROCESS_JOBS=1 (cron still runs the job). */
export function inProcessDispatchEnabled(): boolean {
  return process.env.KX_DISABLE_INPROCESS_JOBS !== '1' && process.env.NODE_ENV !== 'test' && !process.env.VITEST;
}

async function runKick() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    const { dispatchDueDeliveries } = await import('./dispatcher');
    do {
      rerun = false;
      await dispatchDueDeliveries();
    } while (rerun);
  } catch (e) {
    try {
      void Promise.resolve(
        logger.warn('notification dispatcher kick failed', { error: e instanceof Error ? e.message : String(e) }),
      ).catch(() => undefined);
    } catch {
      /* ignore */
    }
  } finally {
    running = false;
  }
}

/** Fire-and-forget: run the dispatcher shortly (debounced). Never throws. */
export function kickDispatcher(): void {
  try {
    if (!inProcessDispatchEnabled()) return;
    if (kickTimer) {
      rerun = running;
      return;
    }
    kickTimer = setTimeout(() => {
      kickTimer = null;
      void runKick();
    }, KICK_DEBOUNCE_MS);
    const t = kickTimer as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  } catch {
    /* never throw */
  }
}
